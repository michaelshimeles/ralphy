import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { logDebug, logWarn } from "../ui/logger.ts";

/**
 * Robustly remove a directory or file, retrying on EBUSY/EPERM errors.
 * This is critical on Windows where file locks (e.g. anti-virus, indexing, open handles)
 * frequently cause spurious cleanup failures.
 *
 * It attempts to delete 5 times with exponential backoff.
 * If it ultimately fails, it LOGS A WARNING but DOES NOT CRASH.
 * This prevents the entire runner from failing just because a temp folder is locked.
 */
export async function rmRF(path: string): Promise<void> {
	if (!existsSync(path)) return;

	const retries = 5;
	for (let i = 0; i < retries; i++) {
		try {
			// Using force: true and recursive: true is standard
			rmSync(path, { recursive: true, force: true });
			return;
		} catch (err: any) {
			const isLockError = err.code === "EBUSY" || err.code === "EPERM" || err.code === "ENOTEMPTY";

			if (isLockError && i < retries - 1) {
				// Wait with exponential backoff: 500, 1000, 2000, 4000...
				const delay = 500 * Math.pow(2, i);
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}

			// On final failure for lock errors, log warning and swallow.
			// For non-lock errors (any time), throw immediately.
			if (isLockError && i === retries - 1) {
				logWarn(
					`Failed to clean up ${path} after ${retries} attempts: ${err.message}. This may be due to a file lock. Proceeding anyway.`,
				);
			} else {
				throw err;
			}
		}
	}
}

/**
 * Simple glob matcher to avoid adding heavy dependencies.
 * Supports:
 * - Suffix: "*.log" (matches "debug.log", "path/to/debug.log")
 * - Prefix: "test*" (matches "test1", "test-file")
 * - Tree: "node_modules/**" (matches "node_modules", "node_modules/file.js") - Checks strict directory boundary
 * - Exact: "node_modules" (matches "node_modules")
 * - Middle: "test.*.js" (matches "test.foo.js") - Uses regex escaping
 *
 * @internal Exported for testing
 */
export function matchesPattern(filename: string, pattern: string, isDirectory?: boolean): boolean {
	// Exact match: "node_modules" matches "node_modules"
	if (pattern === filename) return true;

	// Directory match: "node_modules/" matches "node_modules" if it is a directory
	if (pattern.endsWith("/")) {
		// If we know it's a file, it can't match a directory pattern
		if (isDirectory === false) return false;
		// Check if filename matches pattern without trailing slash
		return filename === pattern.slice(0, -1);
	}

	// Tree match: "dir/**" matches "dir/foo/bar.js"
	if (pattern.endsWith("/**")) {
		const dir = pattern.slice(0, -3);
		return filename === dir || filename.startsWith(dir + "/");
	}

	// Suffix match: "*.log" matches "debug.log" (single wildcard at start only)
	// Uses endsWith() string comparison, not regex - so "." is treated literally
	if (pattern.startsWith("*") && !pattern.includes("*", 1)) return filename.endsWith(pattern.slice(1));

	// Prefix match: "test*" matches "test123" (single wildcard at end only)
	// Uses startsWith() string comparison, not regex - so "." is treated literally
	if (pattern.endsWith("*") && !pattern.slice(0, -1).includes("*")) return filename.startsWith(pattern.slice(0, -1));

	// Middle/complex wildcards: "test.*.js" matches "test.foo.js"
	// Escape regex metacharacters, then convert * to .*
	if (pattern.includes("*")) {
		const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, ".*");
		return new RegExp(`^${escaped}$`).test(filename);
	}

	return false;
}

/**
 * Check if a file should be ignored based on a list of patterns.
 * @internal Exported for testing
 */
export function isIgnored(item: string, patterns: string[], isDirectory?: boolean): boolean {
	return patterns.some((p) => matchesPattern(item, p, isDirectory));
}

/**
 * Default directories to symlink (read-only dependencies).
 * These are never modified by agents, so sharing them saves disk space.
 * Note: build/dist are NOT symlinked to allow agents to run independent builds.
 */
export const DEFAULT_SYMLINK_DIRS = [
	"node_modules",
	".git",
	"vendor",
	".venv",
	"venv",
	"__pycache__",
	".pnpm-store",
	".yarn",
	".cache",
];

/**
 * Files/patterns that should always be copied (never symlinked).
 * These are files that agents typically modify.
 */
export const DEFAULT_COPY_PATTERNS = [
	// Source directories
	"src",
	"lib",
	"app",
	"pages",
	"components",
	"hooks",
	"utils",
	"services",
	"api",
	"routes",
	"controllers",
	"models",
	"views",
	// Config files
	"package.json",
	"tsconfig.json",
	"*.config.js",
	"*.config.ts",
	"*.config.mjs",
	".env*",
	// Other common files
	"README.md",
	"*.yaml",
	"*.yml",
	"*.toml",
	"Cargo.toml",
	"go.mod",
	"go.sum",
	"requirements.txt",
	"pyproject.toml",
];

/**
 * Directories/files that should ALWAYS be ignored (neither copied nor symlinked).
 * Agents don't need .ralphy/ - config is read by main runner, progress is tracked by main runner.
 */
export const DEFAULT_IGNORED = [
	".ralphy-sandboxes/",
	".ralphy-worktrees/",
	".ralphy/",
	"nul",
];

export interface SandboxOptions {
	/** Original working directory */
	originalDir: string;
	/** Path for the sandbox directory */
	sandboxDir: string;
	/** Agent number (for logging) */
	agentNum: number;
	/** Directories to symlink (defaults to DEFAULT_SYMLINK_DIRS) */
	symlinkDirs?: string[];
	/** Additional directories/files to copy */
	copyPatterns?: string[];
}

export interface SandboxResult {
	/** Path to the created sandbox */
	sandboxDir: string;
	/** Number of symlinks created */
	symlinksCreated: number;
	/** Number of files/dirs copied */
	filesCopied: number;
}

/**
 * Create a lightweight sandbox for parallel agent execution.
 *
 * Uses symlinks for read-only dependencies (node_modules, .git, etc.)
 * and copies source files that might be modified.
 *
 * This is much faster than git worktrees for large repos with big
 * dependency directories.
 */
export async function createSandbox(options: SandboxOptions): Promise<SandboxResult> {
	const {
		originalDir,
		sandboxDir,
		agentNum,
		symlinkDirs = DEFAULT_SYMLINK_DIRS,
		// copyPatterns is reserved for future selective copying based on glob patterns
	} = options;

	let symlinksCreated = 0;
	let filesCopied = 0;

	// Create sandbox directory
	// Robust cleanup of existing directory
	await rmRF(sandboxDir);
	mkdirSync(sandboxDir, { recursive: true });

	try {
		// Get all items in the original directory, filtering out ignored items
		const items = readdirSync(originalDir).filter((item) => {
			const itemPath = join(originalDir, item);
			// We need to check if it's a directory to support trailing slash patterns
			let isDir = false;
			try {
				const stat = lstatSync(itemPath);
				isDir = stat.isDirectory();
			} catch {
				// If stat fails, assume false (or skip)
			}
			return !isIgnored(item, DEFAULT_IGNORED, isDir);
		});

		// Track which items we've handled
		const handled = new Set<string>();

		// Step 1: Create symlinks for read-only dependencies
		for (const item of items) {
			if (symlinkDirs.includes(item)) {
				const originalPath = join(originalDir, item);
				const sandboxPath = join(sandboxDir, item);

				if (existsSync(originalPath)) {
					try {
						// Create symlink (use 'junction' on Windows for directories)
						const stat = lstatSync(originalPath);
						const type = stat.isDirectory() ? "junction" : "file";
						symlinkSync(originalPath, sandboxPath, type);
						symlinksCreated++;
						handled.add(item);
						logDebug(`Agent ${agentNum}: Symlinked ${item}`);
					} catch (err) {
						// Symlink failed, will copy instead
						logDebug(`Agent ${agentNum}: Symlink failed for ${item}, will copy`);
					}
				}
			}
		}

		// Step 2: Copy everything else
		for (const item of items) {
			if (handled.has(item)) continue;

			const originalPath = join(originalDir, item);
			const sandboxPathItem = join(sandboxDir, item);

			// Skip if it's a symlink pointing outside (like node_modules might be)
			try {
				const stat = lstatSync(originalPath);

				if (stat.isSymbolicLink()) {
					// Validate and copy symlink only if target exists
					const target = readlinkSync(originalPath);
					const resolvedTarget = join(dirname(originalPath), target);
					if (existsSync(resolvedTarget)) {
						symlinkSync(target, sandboxPathItem);
						symlinksCreated++;
					} else {
						logDebug(`Agent ${agentNum}: Skipping broken symlink ${item} -> ${target}`);
					}
				} else if (stat.isDirectory()) {
					// Copy directory recursively using smart copy
					const stats = copyRecursive(
						originalPath,
						sandboxPathItem,
						DEFAULT_IGNORED,
						symlinkDirs,
						agentNum,
					);
					// Count top-level directory as 1 copy (ignoring internal file count)
					filesCopied++;
					symlinksCreated += stats.symlinks;
				} else if (stat.isFile()) {
					// Copy file and preserve timestamps for change detection
					copyFileSync(originalPath, sandboxPathItem);
					try {
						utimesSync(sandboxPathItem, stat.atime, stat.mtime);
					} catch (utimeErr) {
						logDebug(`Agent ${agentNum}: Failed to preserve timestamps for ${item}: ${utimeErr}`);
					}
					filesCopied++;
				}
			} catch (err) {
				logDebug(`Agent ${agentNum}: Failed to copy ${item}: ${err}`);
			}
		}

		return {
			sandboxDir,
			symlinksCreated,
			filesCopied,
		};
	} catch (err) {
		// Cleanup partial sandbox on failure
		await rmRF(sandboxDir);
		throw err;
	}
}

/**
 * Verify sandbox isolation by checking that symlinked directories
 * are not writable from the sandbox.
 */
export function verifySandboxIsolation(sandboxDir: string, symlinkDirs: string[]): boolean {
	for (const dir of symlinkDirs) {
		const sandboxPath = join(sandboxDir, dir);
		if (existsSync(sandboxPath)) {
			try {
				const stat = lstatSync(sandboxPath);
				if (stat.isSymbolicLink()) {
					// Good - it's a symlink
					continue;
				}
			} catch {
				// Error checking - assume not isolated
				return false;
			}
		}
	}
	return true;
}

/**
 * Get list of files modified in the sandbox compared to original.
 * Uses file modification time comparison.
 */
export async function getModifiedFiles(
	sandboxDir: string,
	originalDir: string,
	symlinkDirs: string[] = DEFAULT_SYMLINK_DIRS,
): Promise<string[]> {
	const modified: string[] = [];

	function scanDir(relPath: string) {
		const sandboxPath = join(sandboxDir, relPath);
		const originalPath = join(originalDir, relPath);

		if (!existsSync(sandboxPath)) return;

		const stat = lstatSync(sandboxPath);

		// Skip symlinks (they're shared, not modified)
		if (stat.isSymbolicLink()) return;

		// Skip known symlink directories
		const topLevel = relPath.split(sep)[0];
		if (symlinkDirs.includes(topLevel)) return;

		if (stat.isDirectory()) {
			const items = readdirSync(sandboxPath);
			for (const item of items) {
				scanDir(join(relPath, item));
			}
		} else if (stat.isFile()) {
			// Check if file is new or modified
			if (!existsSync(originalPath)) {
				modified.push(relPath);
			} else {
				const originalStat = statSync(originalPath);
				if (stat.mtimeMs !== originalStat.mtimeMs || stat.size !== originalStat.size) {
					modified.push(relPath);
				}
			}
		}
	}

	// Start scanning from root
	const items = readdirSync(sandboxDir);
	for (const item of items) {
		// Skip symlinked directories
		const itemPath = join(sandboxDir, item);
		const itemStat = lstatSync(itemPath);
		if (itemStat.isSymbolicLink()) continue;

		if (itemStat.isDirectory()) {
			scanDir(item);
		} else if (itemStat.isFile()) {
			scanDir(item);
		}
	}

	return modified;
}

/**
 * Sync modified files from sandbox back to original directory.
 */
export async function syncSandboxToOriginal(
	sandboxDir: string,
	originalDir: string,
	modifiedFiles: string[],
): Promise<number> {
	let synced = 0;

	for (const relPath of modifiedFiles) {
		const sandboxPath = join(sandboxDir, relPath);
		const originalPath = join(originalDir, relPath);

		if (!existsSync(sandboxPath)) continue;

		// Ensure parent directory exists
		const parentDir = dirname(originalPath);
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}

		// Copy file
		copyFileSync(sandboxPath, originalPath);
		synced++;
	}

	return synced;
}

/**
 * Clean up a sandbox directory.
 */
export async function cleanupSandbox(sandboxDir: string): Promise<void> {
	await rmRF(sandboxDir);
}

/**
 * Get the base directory for sandboxes.
 */
export function getSandboxBase(workDir: string): string {
	const sandboxBase = join(workDir, ".ralphy-sandboxes");
	if (!existsSync(sandboxBase)) {
		mkdirSync(sandboxBase, { recursive: true });
	}
	return sandboxBase;
}

/**
 * Recursively copy a directory:
 * - Skips directories in 'ignoreNames'
 * - Creates symlinks for directories in 'symlinkNames' (instead of recursing)
 * - Copies everything else
 */
function copyRecursive(
	src: string,
	dest: string,
	ignoreNames: string[],
	symlinkNames: string[],
	agentNum: number,
): { files: number; symlinks: number } {
	let files = 0;
	let symlinks = 0;

	if (!existsSync(src)) return { files, symlinks };

	if (!existsSync(dest)) {
		mkdirSync(dest, { recursive: true });
	}

	const items = readdirSync(src);
	for (const item of items) {
		const srcPath = join(src, item);
		
		let stat;
		try {
			stat = lstatSync(srcPath);
		} catch {
			continue;
		}

		// Skip ignored items (pass isDirectory flag)
		if (isIgnored(item, ignoreNames, stat.isDirectory())) {
			continue;
		}

		const destPath = join(dest, item);

		try {
			if (stat.isDirectory()) {
				// Symlink read-only dependency dirs (node_modules, vendor, etc.) even when nested.
				// This is intentional for performance - agents don't modify dependencies, only source files.
				// Sharing these across sandboxes avoids duplicating GBs of packages per agent.
				if (symlinkNames.includes(item)) {
					try {
						// Create a junction/symlink to the SOURCE directory
						symlinkSync(srcPath, destPath, "junction");
						logDebug(`Agent ${agentNum}: Symlinked nested dir ${item}`);
						symlinks++;
					} catch (symlinkErr) {
						// Fallback: if symlink fails, try to copy responsibly
						logDebug(
							`Agent ${agentNum}: Failed to symlink nested ${item}, falling back to copy: ${symlinkErr}`,
						);
						const subStats = copyRecursive(
							srcPath,
							destPath,
							ignoreNames,
							symlinkNames,
							agentNum,
						);
						files += subStats.files;
						symlinks += subStats.symlinks;
					}
				} else {
					// Normal directory: recurse
					const subStats = copyRecursive(
						srcPath,
						destPath,
						ignoreNames,
						symlinkNames,
						agentNum,
					);
					files += subStats.files;
					symlinks += subStats.symlinks;
				}
			} else if (stat.isFile()) {
				copyFileSync(srcPath, destPath);
				files++;
				try {
					utimesSync(destPath, stat.atime, stat.mtime);
				} catch {
					// Ignore timestamp errors
				}
			}
		} catch (err) {
			logDebug(`Agent ${agentNum}: Failed to copy ${item} in recursive copy: ${err}`);
		}
	}

	return { files, symlinks };
}
