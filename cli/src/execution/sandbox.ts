import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
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

const MAX_SYNC_DEPTH = 100;

/**
 * Smartly sync a directory from source to destination.
 * Only copies files that have changed (based on size/mtime) or are new.
 * Removes files in dest that are not in source.
 */
function syncDirectory(
	src: string,
	dest: string,
	ignorePatterns: (item: string) => boolean,
	currentDepth = 0,
	rootSrc: string = src,
): { filesCopied: number; filesDeleted: number } {
	// Prevent stack overflow from deeply nested directories
	if (currentDepth > MAX_SYNC_DEPTH) {
		logDebug(`Max sync depth ${MAX_SYNC_DEPTH} exceeded for ${src}, skipping subdirectories`);
		return { filesCopied: 0, filesDeleted: 0 };
	}

	let filesCopied = 0;
	let filesDeleted = 0;

	if (!existsSync(dest)) {
		mkdirSync(dest, { recursive: true });
	}

	const srcItems = new Set(readdirSync(src));
	const destItems = readdirSync(dest);

	// 1. Remove items in dest that are not in src
	for (const item of destItems) {
		if (!srcItems.has(item) && !ignorePatterns(item)) {
			const destPath = join(dest, item);
			rmSync(destPath, { recursive: true, force: true });
			filesDeleted++;
		}
	}

	// 2. Sync items from src to dest
	for (const item of srcItems) {
		if (ignorePatterns(item)) continue;

		const srcPath = join(src, item);
		const destPath = join(dest, item);

		// Skip if source is invalid (e.g. broken symlink)
		if (!existsSync(srcPath)) continue;

		const srcStat = lstatSync(srcPath);

		if (srcStat.isDirectory()) {
			if (existsSync(destPath) && !lstatSync(destPath).isDirectory()) {
				rmSync(destPath, { force: true });
			}
			const subResult = syncDirectory(srcPath, destPath, ignorePatterns, currentDepth + 1, rootSrc);
			filesCopied += subResult.filesCopied;
			filesDeleted += subResult.filesDeleted;
		} else if (srcStat.isFile()) {
			let shouldCopy = true;
			if (existsSync(destPath)) {
				const destStat = lstatSync(destPath);
				if (
					destStat.isFile() &&
					destStat.size === srcStat.size &&
					destStat.mtimeMs === srcStat.mtimeMs
				) {
					shouldCopy = false;
				}
			}

			if (shouldCopy) {
				copyFileSync(srcPath, destPath);
				try {
					utimesSync(destPath, srcStat.atime, srcStat.mtime);
				} catch (error) {
					logDebug(`Failed to set timestamp: ${error}`);
				}
				filesCopied++;
			}
		} else if (srcStat.isSymbolicLink()) {
			let shouldRecreate = true;
			if (existsSync(destPath) && lstatSync(destPath).isSymbolicLink()) {
				if (readlinkSync(srcPath) === readlinkSync(destPath)) {
					shouldRecreate = false;
				}
			}
			if (shouldRecreate) {
				if (existsSync(destPath)) rmSync(destPath, { force: true });
				const target = readlinkSync(srcPath);

				// Validate symlink target to prevent sandbox escape
				const resolvedTarget = resolve(dirname(srcPath), target);
				const resolvedSrcBase = resolve(rootSrc);
				const relativeTarget = relative(resolvedSrcBase, resolvedTarget);
				if (
					relativeTarget.startsWith("..") ||
					relativeTarget.includes("/..") ||
					relativeTarget.includes("\\..")
				) {
					logDebug(`Security: Symlink target escapes base directory, skipping: ${target}`);
					continue;
				}

				symlinkSync(target, destPath);
			}
		}
	}

	return { filesCopied, filesDeleted };
}

/**
 * Validate and canonicalize a path to prevent path traversal attacks.
 * Returns null if the path is invalid or escapes the base directory.
 */
export function validatePath(baseDir: string, targetPath: string, maxDepth = 10): string | null {
	// Validate baseDir exists and is a string
	if (!baseDir || typeof baseDir !== "string") {
		logDebug(`Security: Invalid base directory: ${baseDir}`);
		return null;
	}

	// Validate targetPath is a string
	if (typeof targetPath !== "string") {
		logDebug(`Security: Invalid target path type: ${typeof targetPath}`);
		return null;
	}

	// Reject null bytes which can be used to bypass path validation
	if (targetPath.includes("\0")) {
		logDebug(`Security: Null byte detected in path: ${targetPath}`);
		return null;
	}

	// Reject paths that try to escape via URL encoding
	if (targetPath.includes("%") && /%[0-9a-fA-F]{2}/.test(targetPath)) {
		logDebug(`Security: URL encoding detected in path: ${targetPath}`);
		return null;
	}

	const absoluteBase = realpathSync(resolve(baseDir));
	const candidateTarget = resolve(absoluteBase, targetPath);

	// SECURITY: Resolve existing targets with realpath. For non-existent targets,
	// require parent directories to resolve inside baseDir to prevent symlink escapes.
	let absoluteTarget: string;
	if (existsSync(candidateTarget)) {
		absoluteTarget = realpathSync(candidateTarget);
	} else {
		const parentDir = dirname(candidateTarget);
		const resolvedParent = existsSync(parentDir) ? realpathSync(parentDir) : null;
		if (!resolvedParent) {
			logDebug(`Security: Parent directory does not exist for path: ${targetPath}`);
			return null;
		}
		if (resolvedParent !== absoluteBase && !resolvedParent.startsWith(`${absoluteBase}${sep}`)) {
			logDebug(`Security: Parent directory escapes base after symlink resolution: ${targetPath}`);
			return null;
		}
		absoluteTarget = join(resolvedParent, relative(parentDir, candidateTarget));
	}

	// Check if the resolved path is within the base directory
	const relativePath = relative(absoluteBase, absoluteTarget);

	// If relative path starts with .., it escapes the base directory
	if (relativePath.startsWith("..") || relativePath.startsWith(`${sep}..`)) {
		logDebug(`Security: Path traversal attempt detected: ${targetPath}`);
		return null;
	}

	// Check for absolute path injection (paths starting with / or \ or drive letters)
	if (targetPath.startsWith("/") || targetPath.startsWith("\\") || /^[a-zA-Z]:/.test(targetPath)) {
		logDebug(`Security: Absolute path injection attempt detected: ${targetPath}`);
		return null;
	}

	// SECURITY: Double-check with startsWith after realpath resolution
	// This catches any remaining traversal attempts after symlink resolution
	if (!absoluteTarget.startsWith(absoluteBase + sep) && absoluteTarget !== absoluteBase) {
		logDebug(`Security: Path escapes base directory after symlink resolution: ${targetPath}`);
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
			// BUG FIX: Use realpathSync for atomic symlink resolution to prevent TOCTOU
			// This resolves the symlink target atomically, preventing race conditions
			const resolvedTarget = realpathSync(targetPath);
			const resolvedRelative = relative(baseDir, resolvedTarget);

			if (resolvedRelative.startsWith("..") || resolvedRelative.startsWith(`${sep}..`)) {
				logDebug(`Security: Symlink path traversal detected: ${targetPath}`);
				return null;
			}

			// Recursively check the symlink target (which is now fully resolved)
			return validatePathRecursive(
				baseDir,
				resolvedTarget,
				currentDepth + 1,
				maxDepth,
				new Set(visited),
			);
		}

		// Check parent directory for symlinks using realpathSync for atomicity
		const parentDir = dirname(targetPath);
		if (existsSync(parentDir)) {
			const parentReal = realpathSync(parentDir);
			const parentRelative = relative(baseDir, parentReal);

			if (parentRelative.startsWith("..") || parentRelative.startsWith(`${sep}..`)) {
				logDebug(`Security: Parent symlink path traversal: ${parentDir}`);
				return null;
			}

			// Recursively check parent if it's different from original
			if (parentReal !== parentDir) {
				return validatePathRecursive(
					baseDir,
					parentReal,
					currentDepth + 1,
					maxDepth,
					new Set(visited),
				);
			}
		}
	} catch (err) {
		// Path might not exist yet, validate parent
		logDebug(`Path validation error for ${targetPath}: ${err}`);
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

	// Check if we can do an incremental update
	const incremental = existsSync(sandboxDir);

	if (!incremental) {
		mkdirSync(sandboxDir, { recursive: true });
		createdDirs.push(sandboxDir);
	} else {
		logDebug(`Agent ${agentNum}: Reuse existing sandbox, performing incremental sync...`);
	}

	try {
		const items = readdirSync(originalDir);
		const itemsSet = new Set(items);

		// CLEANUP: Remove top-level items in sandbox that are not in original
		// This is critical for "Fresh Run" feel with persistent sandboxes
		if (incremental) {
			const sandboxItems = readdirSync(sandboxDir);
			for (const item of sandboxItems) {
				// Don't modify our symlinks or ignored items (unless they are deleted in source?)
				// Actually, if it's ignored in source, we shouldn't touch it?
				// But agent might have created "temp.log".
				// Safe bet: if it's not in original, delete it (unless it's one of our special directories)

				if (!itemsSet.has(item) && !symlinkDirs.includes(item)) {
					// Check if it's a file we should keep?
					// For strict cleanliness, if it's not in Source, it goes.
					// EXCEPT for .ralphy (agent state/config)
					if (item === ".ralphy") continue;

					const sPath = join(sandboxDir, item);
					try {
						rmSync(sPath, { recursive: true, force: true });
						logDebug(`Agent ${agentNum}: Cleaned up stale top-level item: ${item}`);
					} catch (e) {
						logDebug(`Agent ${agentNum}: Failed to cleanup ${item}: ${e}`);
					}
				}
			}
		}

		// Track which items we've handled
		const handled = new Set<string>();

		// Step 1: Create/Update symlinks for read-only dependencies
		for (const item of items) {
			if (symlinkDirs.includes(item)) {
				const originalPath = join(originalDir, item);
				const sandboxPath = join(sandboxDir, item);

				if (!existsSync(originalPath)) {
					// Clean up dead symlink in sandbox if it exists
					if (existsSync(sandboxPath)) rmSync(sandboxPath, { force: true });
					continue;
				}

				try {
					const stat = lstatSync(originalPath);
					// Use "junction" on Windows for directories, "dir" on Unix-like platforms
					const type = stat.isDirectory()
						? process.platform === "win32"
							? "junction"
							: "dir"
						: "file";

					// Check if symlink needs update
					let needsUpdate = true;
					if (existsSync(sandboxPath)) {
						const sandboxStat = lstatSync(sandboxPath);
						if (sandboxStat.isSymbolicLink()) {
							const currentTarget = readlinkSync(sandboxPath);
							// Ideally we'd compare resolved paths, but strict string eq is safer/faster here
							if (currentTarget === originalPath) needsUpdate = false;
						} else {
							rmSync(sandboxPath, { recursive: true, force: true });
						}
					}

					if (needsUpdate) {
						if (existsSync(sandboxPath)) rmSync(sandboxPath, { force: true });
						symlinkSync(originalPath, sandboxPath, type);

						// Verify
						if (!existsSync(sandboxPath)) throw new Error(`Symlink creation failed: ${item}`);
						symlinksCreated++;
						createdSymlinks.push(sandboxPath);
					}

					handled.add(item);
				} catch (err) {
					logDebug(`Agent ${agentNum}: Symlink failed for ${item} (${err}), will try copy`);
				}
			}
		}

		// Step 2: Copy/Sync everything else
		for (const item of items) {
			if (handled.has(item)) continue;
			if (shouldIgnore(item)) continue;

			const originalPath = join(originalDir, item);
			const sandboxPath = join(sandboxDir, item);
			const resolvedOriginalPath = resolve(originalPath);
			const resolvedSandboxDir = resolve(sandboxDir);

			// Extra check: ensure we don't try to copy the sandbox base itself if it's in the originalDir
			if (
				resolvedOriginalPath === resolvedSandboxDir ||
				resolvedSandboxDir.startsWith(`${resolvedOriginalPath}${sep}`)
			) {
				continue;
			}

			// Use syncDirectory for recursive optimization
			const ignoreFunc = (_name: string) => false; // Already filtered at top level

			if (lstatSync(originalPath).isDirectory()) {
				const syncRes = syncDirectory(originalPath, sandboxPath, ignoreFunc);
				filesCopied += syncRes.filesCopied;
			} else {
				// Single file copy logic
				const srcStat = lstatSync(originalPath);
				let shouldCopy = true;
				if (existsSync(sandboxPath)) {
					const destStat = lstatSync(sandboxPath);
					if (destStat.size === srcStat.size && destStat.mtimeMs === srcStat.mtimeMs) {
						shouldCopy = false;
					}
				}
				if (shouldCopy) {
					copyFileSync(originalPath, sandboxPath);
					try {
						utimesSync(sandboxPath, srcStat.atime, srcStat.mtime);
					} catch (err) {
						logDebug(`Agent ${agentNum}: Failed to set timestamps on ${sandboxPath}: ${err}`);
					}
					filesCopied++;
				}
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
	const HASH_THRESHOLD_SIZE = 1024 * 1024; // 1MB - threshold for potential hash verification
	const MAX_SCAN_DEPTH = 100;
	const visitedInodes = new Set<string>();

	function scanDir(relPath: string, currentDepth: number) {
		// Prevent stack overflow and infinite loops
		if (currentDepth > MAX_SCAN_DEPTH) {
			logDebug(`Max scan depth ${MAX_SCAN_DEPTH} exceeded at ${relPath}, stopping`);
			return;
		}

		const sandboxPath = join(sandboxDir, relPath);

		if (!existsSync(sandboxPath)) return;

		const stat = lstatSync(sandboxPath);

		// Detect and prevent symlink cycles using inode
		const inode = `${stat.dev}-${stat.ino}`;
		if (visitedInodes.has(inode)) {
			logDebug(`Cycle detected (inode ${inode}), skipping: ${relPath}`);
			return;
		}
		visitedInodes.add(inode);

		// Skip symlinks (they're shared, not modified)
		if (stat.isSymbolicLink()) return;

		// Skip known symlink directories
		const topLevel = relPath.split(sep)[0];
		if (symlinkDirs.includes(topLevel)) return;

		if (stat.isDirectory()) {
			const items = readdirSync(sandboxPath);
			for (const item of items) {
				scanDir(join(relPath, item), currentDepth + 1);
			}
		} else if (stat.isFile()) {
			let isModified = false;
			const originalPath = join(originalDir, relPath);

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
			scanDir(item, 1);
		} else if (itemStat.isFile()) {
			scanDir(item, 1);
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

	// Phase 3: Copy files with TOCTOU protection
	// SECURITY: Re-validate paths immediately before copy to prevent symlink attacks
	let synced = 0;
	for (const change of pendingChanges) {
		try {
			// Re-validate paths right before use to prevent TOCTOU attacks
			const sandboxPath = validatePath(sandboxDir, change.relPath);
			const originalPath = validatePath(originalDir, change.relPath);

			if (!sandboxPath || !originalPath) {
				logDebug(`Security: Path re-validation failed for ${change.relPath}`);
				continue;
			}

			// Verify file still exists and hasn't been swapped
			if (!existsSync(sandboxPath)) {
				logDebug(`Security: File disappeared or was swapped: ${change.relPath}`);
				continue;
			}

			copyFileSync(sandboxPath, originalPath);
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
	const allowedBase = resolve(join(tmpdir(), "ralphy-sandboxes"));
	const resolvedSandbox = resolve(sandboxDir);
	if (resolvedSandbox === allowedBase || !resolvedSandbox.startsWith(`${allowedBase}${sep}`)) {
		logDebug(`Security: refusing to cleanup path outside sandbox base: ${sandboxDir}`);
		return;
	}

	if (existsSync(resolvedSandbox)) {
		rmSync(resolvedSandbox, { recursive: true, force: true });
	}
}

/**
 * Get the base directory for sandboxes.
 * Uses system temp directory to ensure complete isolation.
 */
export function getSandboxBase(workDir: string): string {
	const projectHash = createHash("sha256").update(resolve(workDir)).digest("hex");
	const sandboxBase = join(tmpdir(), "ralphy-sandboxes", projectHash);

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
			// Create symlink with platform-specific handling
			const stat = lstatSync(originalPath);
			const isDir = stat.isDirectory();

			if (isDir) {
				// For directories, use 'junction' on Windows (more permissive) or 'dir' on Unix
				const type = process.platform === "win32" ? "junction" : "dir";
				symlinkSync(originalPath, sandboxPath, type);
			} else {
				// For files, use 'file' type on all platforms
				// On Windows, this may require Developer Mode or admin privileges
				// If it fails, the caller should handle the error and fall back to copying
				symlinkSync(originalPath, sandboxPath, "file");
			}
			logDebug(`Symlinked shared resource: ${resource}`);
		} catch (err) {
			// On Windows, file symlinks often fail without admin privileges
			// Log the error but don't crash - caller can fall back to copying
			logDebug(`Failed to symlink shared resource ${resource}: ${err}`);
			// Re-throw so caller knows to fall back
			throw err;
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

	// CLEAN SYNC: Remove files in sandbox that are NOT in the plan
	// This prevents "wandering off" by ensuring the agent only sees what it should
	if (existsSync(sandboxDir)) {
		const plannedSet = new Set(filesToCopy.map((f) => normalize(f)));

		// Helper to recursively scan and clean
		function cleanUnplanned(dir: string, base: string) {
			try {
				const items = readdirSync(dir);
				for (const item of items) {
					const fullPath = join(dir, item);
					const relPath = relative(base, fullPath);

					// Skip protected directories
					if (item === ".git" || item === "node_modules" || item === ".ralphy") continue;
					if (DEFAULT_SYMLINK_DIRS.includes(item)) continue;

					const stat = lstatSync(fullPath);

					if (stat.isDirectory()) {
						// Check if any planned file is inside this directory
						const isParentOfPlan = Array.from(plannedSet).some((p) => p.startsWith(relPath + sep));
						if (isParentOfPlan) {
							cleanUnplanned(fullPath, base);
							// If directory is empty after cleaning, remove it? keeping it is safer/faster
						} else {
							// Entire directory is unplanned
							rmSync(fullPath, { recursive: true, force: true });
						}
					} else {
						// If file is not in plan, delete it
						if (!plannedSet.has(relPath)) {
							rmSync(fullPath, { force: true });
						}
					}
				}
			} catch (e) {
				logDebug(`Failed to clean sandbox: ${e}`);
			}
		}

		cleanUnplanned(sandboxDir, sandboxDir);
	}

	for (const relPath of filesToCopy) {
		// Validate paths to prevent traversal attacks
		let validatedPath = validatePath(originalDir, relPath);

		if (!validatedPath) {
			logDebug(`Security: Invalid path rejected: ${relPath}`);
			rejectedFiles.push(relPath);
			continue;
		}

		// SECURITY FIX: Re-validate path immediately before file operations to prevent TOCTOU attacks
		// This ensures the path hasn't been swapped with a symlink between validation and use
		validatedPath = validatePath(originalDir, relPath);
		if (!validatedPath) {
			logDebug(`Security: Path re-validation failed for ${relPath}`);
			rejectedFiles.push(relPath);
			continue;
		}

		if (!existsSync(validatedPath)) {
			logDebug(`File not found in original directory: ${relPath}`);
			continue;
		}

		const sandboxPath = join(sandboxDir, relPath);

		try {
			// Ensure parent directory exists
			const parentDir = dirname(sandboxPath);
			if (!existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}

			// FINAL SECURITY CHECK: Re-validate immediately before copy to prevent TOCTOU
			// This is the last line of defense against path manipulation
			const finalPath = validatePath(originalDir, relPath);
			if (finalPath !== validatedPath) {
				logDebug(`Security: Path changed between validation and copy for ${relPath}`);
				rejectedFiles.push(relPath);
				continue;
			}
			validatedPath = finalPath;

			// Copy file preserving timestamps
			const stat = lstatSync(validatedPath);
			if (stat.isDirectory()) {
				cpSync(validatedPath, sandboxPath, { recursive: true, preserveTimestamps: true });
			} else if (stat.isFile()) {
				copyFileSync(validatedPath, sandboxPath);
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
// Track scheduled cleanup timers for potential cancellation
const scheduledCleanupTimers = new Set<NodeJS.Timeout>();

export function scheduleBackgroundCleanup(sandboxBase: string): NodeJS.Timeout {
	// Schedule cleanup after 5 minutes
	const timer = setTimeout(() => {
		scheduledCleanupTimers.delete(timer);
		cleanupStaleSandboxes(sandboxBase);
	}, SANDBOX_BACKGROUND_CLEANUP_DELAY_MS);

	// BUG FIX: Track timer for cleanup on exit
	scheduledCleanupTimers.add(timer);
	return timer;
}

/**
 * Cancel all scheduled background cleanup timers.
 * Call this on process exit to prevent timers from keeping the process alive.
 */
export function cancelScheduledCleanups(): void {
	for (const timer of scheduledCleanupTimers) {
		clearTimeout(timer);
	}
	scheduledCleanupTimers.clear();
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
