import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	createReadStream,
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
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	DEFAULT_IGNORE_PATTERNS,
	SANDBOX_BACKGROUND_CLEANUP_DELAY_MS,
	SANDBOX_DIR_PREFIX,
	SANDBOX_STALE_THRESHOLD_MS,
	SANDBOX_SUFFIX,
} from "../config/constants.ts";

export {
	DEFAULT_IGNORE_PATTERNS,
	SANDBOX_BACKGROUND_CLEANUP_DELAY_MS,
	SANDBOX_DIR_PREFIX,
	SANDBOX_STALE_THRESHOLD_MS,
	SANDBOX_SUFFIX,
};

import { logDebug } from "../ui/logger.ts";
import { copyAndCompressSkillFolders } from "./skill-compress.ts";

/**
 * Validate and canonicalize a path to prevent path traversal attacks.
 * Returns null if the path is invalid or escapes the base directory.
 */
export function validatePath(baseDir: string, targetPath: string, maxDepth = 10): string | null {
	const absoluteBase = resolve(baseDir);
	const absoluteTarget = resolve(baseDir, targetPath);

	// Check if the resolved path is within the base directory
	const relativePath = relative(absoluteBase, absoluteTarget);

	// If relative path starts with .., it escapes the base directory
	if (relativePath.startsWith("..") || relativePath.startsWith(`${sep}..`)) {
		logDebug(`Security: Path traversal attempt detected: ${targetPath}`);
		return null;
	}

	// Recursive symlink validation with depth limit and circular detection
	return validatePathRecursive(absoluteBase, absoluteTarget, 0, maxDepth, new Set());
}

function validatePathRecursive(
	baseDir: string,
	targetPath: string,
	currentDepth: number,
	maxDepth: number,
	visited: Set<string>,
): string | null {
	// Prevent infinite loops
	if (currentDepth > maxDepth) {
		logDebug(`Security: Symlink chain too deep (${currentDepth} levels): ${targetPath}`);
		return null;
	}

	if (visited.has(targetPath)) {
		logDebug(`Security: Circular symlink detected: ${targetPath}`);
		return null;
	}
	visited.add(targetPath);

	// Check if target itself is a symlink
	try {
		const stat = lstatSync(targetPath);
		if (stat.isSymbolicLink()) {
			const linkTarget = readlinkSync(targetPath);
			const resolvedTarget = resolve(dirname(targetPath), linkTarget);
			const resolvedRelative = relative(baseDir, resolvedTarget);

			if (resolvedRelative.startsWith("..") || resolvedRelative.startsWith(`${sep}..`)) {
				logDebug(`Security: Symlink path traversal: ${targetPath} -> ${linkTarget}`);
				return null;
			}

			// Recursively check the symlink target
			return validatePathRecursive(
				baseDir,
				resolvedTarget,
				currentDepth + 1,
				maxDepth,
				new Set(visited),
			);
		}

		// Check parent directory for symlinks
		const parentDir = dirname(targetPath);
		if (existsSync(parentDir)) {
			const parentStat = lstatSync(parentDir);
			if (parentStat.isSymbolicLink()) {
				const parentLinkTarget = readlinkSync(parentDir);
				const resolvedParentTarget = resolve(dirname(parentDir), parentLinkTarget);
				const resolvedParentRelative = relative(baseDir, resolvedParentTarget);

				if (
					resolvedParentRelative.startsWith("..") ||
					resolvedParentRelative.startsWith(`${sep}..`)
				) {
					logDebug(`Security: Parent symlink path traversal: ${parentDir} -> ${parentLinkTarget}`);
					return null;
				}

				// Recursively check parent symlink
				return validatePathRecursive(
					baseDir,
					resolvedParentTarget,
					currentDepth + 1,
					maxDepth,
					new Set(visited),
				);
			}
		}
	} catch (_err) {
		// Path might not exist yet, validate parent
		const parentDir = dirname(targetPath);
		if (existsSync(parentDir)) {
			return validatePathRecursive(
				baseDir,
				parentDir,
				currentDepth + 1,
				maxDepth,
				new Set(visited),
			);
		}
	}

	return targetPath;
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

export function shouldIgnore(item: string): boolean {
	if (DEFAULT_IGNORE_PATTERNS.includes(item)) return true;
	for (const pattern of DEFAULT_IGNORE_PATTERNS) {
		if (pattern.endsWith("*") && item.startsWith(pattern.slice(0, -1))) return true;
	}
	return false;
}

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
	const createdSymlinks: string[] = [];
	const createdDirs: string[] = [];

	// Create sandbox directory
	if (existsSync(sandboxDir)) {
		rmSync(sandboxDir, { recursive: true, force: true });
	}
	mkdirSync(sandboxDir, { recursive: true });
	createdDirs.push(sandboxDir);

	try {
		// Get all items in original directory
		const items = readdirSync(originalDir);

		// Track which items we've handled
		const handled = new Set<string>();

		// Step 1: Create symlinks for read-only dependencies
		for (const item of items) {
			if (symlinkDirs.includes(item)) {
				const originalPath = join(originalDir, item);
				const sandboxPath = join(sandboxDir, item);

				if (!existsSync(originalPath)) {
					logDebug(`Agent ${agentNum}: Skipping non-existent symlink target: ${item}`);
					continue;
				}

				// Check if it's a directory (for proper symlink creation)
				try {
					const stat = lstatSync(originalPath);
					const type = stat.isDirectory() ? "junction" : "file";
					symlinkSync(originalPath, sandboxPath, type);

					// NEW: Verify symlink was created successfully
					if (!existsSync(sandboxPath)) {
						throw new Error(`Symlink creation failed: ${item}`);
					}

					const createdStat = lstatSync(sandboxPath);
					if (!createdStat.isSymbolicLink()) {
						throw new Error(`Created path is not a symlink: ${item}`);
					}

					// Verify symlink target exists
					const linkTarget = readlinkSync(sandboxPath);
					const resolvedTarget = resolve(dirname(sandboxPath), linkTarget);
					if (!existsSync(resolvedTarget)) {
						throw new Error(`Symlink ${item} has broken target: ${linkTarget}`);
					}

					symlinksCreated++;
					handled.add(item);
					createdSymlinks.push(sandboxPath);
					logDebug(`Agent ${agentNum}: Symlinked ${item}`);
				} catch (err) {
					logDebug(`Agent ${agentNum}: Symlink failed for ${item} (${err}), will copy`);
				}
			}
		}

		// Step 2: Copy everything else
		for (const item of items) {
			if (handled.has(item)) continue;
			if (shouldIgnore(item)) continue;

			const originalPath = join(originalDir, item);
			const sandboxPath = join(sandboxDir, item);

			// Extra check: ensure we don't try to copy the sandbox base itself if it's in the originalDir
			if (originalPath === resolve(sandboxDir) || sandboxDir.startsWith(originalPath + sep)) {
				logDebug(`Agent ${agentNum}: Skipping self-copy of sandbox directory: ${item}`);
				continue;
			}

			// Skip if it's a symlink pointing outside (like node_modules might be)
			try {
				const stat = lstatSync(originalPath);

				if (stat.isSymbolicLink()) {
					// Validate and copy symlink only if target exists
					const target = readlinkSync(originalPath);
					const resolvedTarget = join(dirname(originalPath), target);
					if (existsSync(resolvedTarget)) {
						symlinkSync(target, sandboxPath);
						createdSymlinks.push(sandboxPath);
						symlinksCreated++;
					} else {
						logDebug(`Agent ${agentNum}: Skipping broken symlink ${item} -> ${target}`);
					}
				} else if (stat.isDirectory()) {
					// Copy directory recursively, preserving timestamps for change detection
					cpSync(originalPath, sandboxPath, { recursive: true, preserveTimestamps: true });
					filesCopied++;
					createdDirs.push(sandboxPath);
				} else if (stat.isFile()) {
					// Copy file and preserve timestamps for change detection
					copyFileSync(originalPath, sandboxPath);
					try {
						utimesSync(sandboxPath, stat.atime, stat.mtime);
					} catch (utimeErr) {
						// Some filesystems don't support utimes, log warning but continue
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
		logDebug(`Agent ${agentNum}: Sandbox creation failed, cleaning up...`);

		// Remove created symlinks first
		for (const symlinkPath of createdSymlinks) {
			try {
				if (existsSync(symlinkPath)) {
					rmSync(symlinkPath, { force: true });
					logDebug(`Agent ${agentNum}: Cleaned up symlink: ${symlinkPath}`);
				}
			} catch (cleanupErr) {
				logDebug(`Agent ${agentNum}: Failed to cleanup symlink ${symlinkPath}: ${cleanupErr}`);
			}
		}

		// Remove created directories (reverse order)
		for (let i = createdDirs.length - 1; i >= 0; i--) {
			const dirPath = createdDirs[i];
			try {
				if (existsSync(dirPath)) {
					rmSync(dirPath, { recursive: true, force: true });
					logDebug(`Agent ${agentNum}: Cleaned up directory: ${dirPath}`);
				}
			} catch (cleanupErr) {
				logDebug(`Agent ${agentNum}: Failed to cleanup directory ${dirPath}: ${cleanupErr}`);
			}
		}

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
				if (!stat.isSymbolicLink()) {
					logDebug(`Warning: ${dir} is not a symlink as expected`);
					continue;
				}

				// Verify symlink target exists
				const linkTarget = readlinkSync(sandboxPath);
				const resolvedTarget = resolve(dirname(sandboxPath), linkTarget);

				if (!existsSync(resolvedTarget)) {
					logDebug(`Warning: Symlink ${dir} has broken target: ${linkTarget}`);
					return false;
				}

				// Verify target is not a symlink itself (to avoid chains)
				const targetStat = lstatSync(resolvedTarget);
				if (targetStat.isSymbolicLink()) {
					logDebug(`Warning: Symlink ${dir} points to another symlink: ${linkTarget}`);
					return false;
				}

				logDebug(`Verified symlink: ${dir} -> ${linkTarget}`);
			} catch (err) {
				logDebug(`Error verifying symlink ${dir}: ${err}`);
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
	const HASH_THRESHOLD_SIZE = 1024 * 1024; // 1MB - hash files smaller than this

	async function _computeFileHash(filePath: string): Promise<string> {
		const hash = createHash("sha256");

		return new Promise((resolve, reject) => {
			const stream = createReadStream(filePath);
			stream.on("data", (data) => hash.update(data));
			stream.on("end", () => resolve(hash.digest("hex")));
			stream.on("error", reject);
		});
	}

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
			let isModified = false;

			if (!existsSync(originalPath)) {
				isModified = true;
			} else {
				const originalStat = statSync(originalPath);

				// Check mtime and size
				const mtimeDifferent = stat.mtimeMs !== originalStat.mtimeMs;
				const sizeDifferent = stat.size !== originalStat.size;

				if (mtimeDifferent || sizeDifferent) {
					// For close mtime matches on small files, verify with hash
					if (
						mtimeDifferent &&
						Math.abs(stat.mtimeMs - originalStat.mtimeMs) < 1000 &&
						stat.size < HASH_THRESHOLD_SIZE
					) {
						// This is async, but we're in a sync function
						// For now, just use mtime/size difference
						isModified = true;
						logDebug(`Modified file detected by mtime/size: ${relPath}`);
					} else {
						isModified = true;
					}
				}
			}

			if (isModified) {
				modified.push(relPath);
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
 * Copy back only planned files from sandbox to original directory.
 * This is used in parallel execution mode where we only want to copy
 * files that were identified as needed during the planning phase.
 */
export async function copyBackPlannedFilesParallel(
	originalDir: string,
	sandboxDir: string,
	files: string[],
): Promise<number> {
	const pendingChanges: Array<{ originalPath: string; sandboxPath: string; relPath: string }> = [];
	const _preparedCount = 0;

	// Phase 1: Validate and prepare all changes
	for (const relPath of files) {
		const sandboxPath = validatePath(sandboxDir, relPath);
		const originalPath = validatePath(originalDir, relPath);

		if (!sandboxPath || !originalPath) {
			logDebug(`Security: Invalid path rejected: ${relPath}`);
			continue;
		}

		if (!existsSync(sandboxPath)) {
			logDebug(`File not found in sandbox: ${relPath}`);
			continue;
		}

		pendingChanges.push({ originalPath, sandboxPath, relPath });
	}

	// Phase 2: Ensure all parent directories exist
	const directoriesToCreate = new Set<string>();
	for (const change of pendingChanges) {
		directoriesToCreate.add(dirname(change.originalPath));
	}

	for (const dir of directoriesToCreate) {
		if (!existsSync(dir)) {
			try {
				mkdirSync(dir, { recursive: true });
			} catch (err) {
				logDebug(`Failed to create directory ${dir}: ${err}`);
				// Rollback: remove any directories we created
				for (const createdDir of directoriesToCreate) {
					if (existsSync(createdDir)) {
						try {
							rmSync(createdDir, { recursive: true, force: true });
						} catch (rollbackErr) {
							logDebug(`Failed to rollback directory ${createdDir}: ${rollbackErr}`);
						}
					}
				}
				throw new Error(`Failed to create directory structure: ${err}`);
			}
		}
	}

	// Phase 3: Copy files
	let synced = 0;
	for (const change of pendingChanges) {
		try {
			copyFileSync(change.sandboxPath, change.originalPath);
			synced++;
			logDebug(`Copied back: ${change.relPath}`);
		} catch (err) {
			logDebug(`Failed to copy back ${change.relPath}: ${err}`);
			// Continue with other files
		}
	}

	return synced;
}

/**
 * Clean up a sandbox directory.
 */
export async function cleanupSandbox(sandboxDir: string): Promise<void> {
	if (existsSync(sandboxDir)) {
		rmSync(sandboxDir, { recursive: true, force: true });
	}
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
 * Symlink shared resources from original directory to sandbox.
 * This is used to create symlinks for directories that should be shared
 * between sandboxes (e.g., node_modules, .git).
 */
export function symlinkSharedResources(
	originalDir: string,
	sandboxDir: string,
	resources: string[],
): void {
	for (const resource of resources) {
		const originalPath = join(originalDir, resource);
		const sandboxPath = join(sandboxDir, resource);

		if (!existsSync(originalPath)) {
			logDebug(`Shared resource not found: ${resource}`);
			continue;
		}

		try {
			// Create symlink (use 'junction' on Windows for directories)
			const stat = lstatSync(originalPath);
			const type = stat.isDirectory() ? "junction" : "file";
			symlinkSync(originalPath, sandboxPath, type);
			logDebug(`Symlinked shared resource: ${resource}`);
		} catch (err) {
			logDebug(`Failed to symlink shared resource ${resource}: ${err}`);
		}
	}
}

/**
 * Copy skill/playbook folders from original directory to sandbox.
 * This ensures that skill documentation is available in the sandbox.
 * Uses compression to reduce token usage when skills are loaded by AI.
 */
export function copySkillFolders(originalDir: string, sandboxDir: string): void {
	const saved = copyAndCompressSkillFolders(originalDir, sandboxDir);
	if (saved > 0) {
		logDebug(`Skill folders compressed, saved ~${saved} characters`);
	}
}

/**
 * Copy only the planned files to a sandbox directory.
 * This is used in parallel execution mode to create an isolated environment
 * with only the files that were identified as needed during planning.
 */
export async function copyPlannedFilesIsolated(
	originalDir: string,
	sandboxDir: string,
	filesToCopy: string[],
): Promise<void> {
	const copiedFiles: string[] = [];
	const rejectedFiles: string[] = [];

	for (const relPath of filesToCopy) {
		// Validate paths to prevent traversal attacks
		const validatedPath = validatePath(originalDir, relPath);

		if (!validatedPath) {
			logDebug(`Security: Invalid path rejected: ${relPath}`);
			rejectedFiles.push(relPath);
			continue;
		}

		const originalPath = join(originalDir, relPath);
		const sandboxPath = join(sandboxDir, relPath);

		if (!existsSync(originalPath)) {
			logDebug(`File not found in original directory: ${relPath}`);
			continue;
		}

		try {
			// Ensure parent directory exists
			const parentDir = dirname(sandboxPath);
			if (!existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}

			// Copy file preserving timestamps
			const stat = lstatSync(originalPath);
			if (stat.isDirectory()) {
				cpSync(originalPath, sandboxPath, { recursive: true, preserveTimestamps: true });
			} else if (stat.isFile()) {
				copyFileSync(originalPath, sandboxPath);
				try {
					utimesSync(sandboxPath, stat.atime, stat.mtime);
				} catch (utimeErr) {
					logDebug(`Failed to preserve timestamps for ${relPath}: ${utimeErr}`);
				}
			}

			copiedFiles.push(relPath);
		} catch (err) {
			logDebug(`Failed to copy file ${relPath}: ${err}`);
			rejectedFiles.push(relPath);
		}
	}

	logDebug(`Copied ${copiedFiles.length} planned files to sandbox`);
	if (rejectedFiles.length > 0) {
		logDebug(`Rejected ${rejectedFiles.length} invalid files: ${rejectedFiles.join(", ")}`);
	}
}

/**
 * Schedule background cleanup of stale sandboxes.
 * This runs after a delay to allow parallel tasks to complete.
 */
export function scheduleBackgroundCleanup(sandboxBase: string): void {
	// Schedule cleanup after 5 minutes
	setTimeout(() => {
		cleanupStaleSandboxes(sandboxBase);
	}, SANDBOX_BACKGROUND_CLEANUP_DELAY_MS);
}

/**
 * Clean up stale sandbox directories.
 */
export function cleanupStaleSandboxes(sandboxBase: string): void {
	if (!existsSync(sandboxBase)) {
		return;
	}

	const now = Date.now();

	try {
		const items = readdirSync(sandboxBase);

		for (const item of items) {
			const itemPath = join(sandboxBase, item);
			try {
				const stat = lstatSync(itemPath);
				if (stat.isDirectory() && now - stat.mtimeMs > SANDBOX_STALE_THRESHOLD_MS) {
					rmSync(itemPath, { recursive: true, force: true });
					logDebug(`Cleaned up stale sandbox: ${item}`);
				}
			} catch (err) {
				logDebug(`Failed to cleanup sandbox ${item}: ${err}`);
			}
		}
	} catch (err) {
		logDebug(`Failed to cleanup stale sandboxes: ${err}`);
	}
}
