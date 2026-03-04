import { createHash } from "node:crypto";
import {
	copyFileSync,
	createReadStream,
	existsSync,
	lstatSync,
	mkdirSync,
	type ReadStream,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join, sep } from "node:path";
import { DEFAULT_RECURSION_DEPTH, MAX_FILE_SIZE_FOR_HASH } from "../config/constants.ts";
import { logDebug } from "../ui/logger.ts";

export interface FileSnapshot {
	path: string;
	size: number;
	mtime: number;
	hash?: string;
}

/**
 * Enhanced ignore patterns for sandbox copying
 */
export const DEFAULT_IGNORE_PATTERNS = [
	// Dependencies and build artifacts
	"node_modules/**",
	".pnpm-store/**",
	".yarn/**",
	"bower_components/**",
	"dist/**",
	"build/**",
	"out/**",
	".next/**",
	".nuxt/**",
	".cache/**",
	".tmp/**",

	// Version control
	".git/**",
	".svn/**",
	".hg/**",

	// IDE and editor files
	".vscode/**",
	".idea/**",
	"*.swp",
	"*.swo",
	"*~",

	// OS files
	"Thumbs.db",
	".DS_Store",
	"Desktop.ini",

	// Logs and temp
	"*.log",
	"*.tmp",
	"temp/**",
	"tmp/**",
	"*.pid",

	// Test coverage
	"coverage/**",
	".coverage/**",
	".nyc_output/**",

	// Environment and secrets
	".env*",
	"*.key",
	"*.pem",
	"*.p12",
	"*.pfx",
];

export function copyIfExists(src: string, dest: string): void {
	if (!existsSync(src)) return;
	mkdirSync(join(dest, ".."), { recursive: true });
	try {
		copyFileSync(src, dest);
	} catch {
		// Ignore copy errors
	}
}

export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/");

	for (const pattern of ignorePatterns) {
		if (matchesGlob(normalizedPath, pattern)) {
			return true;
		}
	}

	return false;
}

function matchesGlob(filePath: string, pattern: string): boolean {
	// Handle ** patterns properly
	const regexPattern = globToRegex(pattern);
	return regexPattern.test(filePath);
}

/**
 * Maximum glob pattern length to prevent ReDoS attacks
 */
const MAX_GLOB_PATTERN_LENGTH = 1000;

function globToRegex(pattern: string): RegExp {
	const safePattern =
		pattern.length > MAX_GLOB_PATTERN_LENGTH
			? pattern.slice(0, MAX_GLOB_PATTERN_LENGTH)
			: pattern;

	// Limit pattern length to prevent ReDoS attacks
	if (safePattern.length < pattern.length) {
		logDebug(`Glob pattern too long (${pattern.length} > ${MAX_GLOB_PATTERN_LENGTH}), truncating`);
	}

	// Escape special regex characters except * and ?
	// Use a bounded approach to prevent catastrophic backtracking
	let regex = safePattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\0DOUBLESTAR\0") // Temporarily mark **
		.replace(/\*/g, "[^/]*") // Single * matches anything except /
		.replace(/\?/g, "[^/]"); // ? matches single char except /

	// Handle ** (match any number of directories) using non-capturing group
	// The (?:.*/)? pattern is bounded - it won't cause catastrophic backtracking
	regex = regex.replace(/\0DOUBLESTAR\0/g, "(?:.*/)?");

	// Handle directory separators
	regex = regex.replace(/\//g, "[/\\\\]");

	// Anchor to start
	regex = `^${regex}`;

	// Match at end if pattern doesn't end with /**
	if (!safePattern.endsWith("/**")) {
		regex += "$";
	}

	return new RegExp(regex, "i");
}

export function createFileSnapshot(filePath: string, maxSizeForHash = MAX_FILE_SIZE_FOR_HASH): FileSnapshot | null {
	if (!existsSync(filePath)) return null;

	try {
		const stat = statSync(filePath);
		const snapshot: FileSnapshot = {
			path: filePath,
			size: stat.size,
			mtime: stat.mtime.getTime(),
		};

		if (stat.size <= maxSizeForHash) {
			try {
				const content = readFileSync(filePath, "utf-8");
				snapshot.hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
			} catch {
				// Skip hash for unreadable files
			}
		}

		return snapshot;
	} catch (error) {
		// Log snapshot failures for debugging
		logDebug(`Failed to create snapshot for ${filePath}: ${error}`);
		return null;
	}
}

/**
 * Async streaming hash for large files
 */
export async function hashFileStreaming(filePath: string): Promise<string | null> {
	return new Promise((resolve) => {
		const hash = createHash("sha256");
		let stream: ReadStream | null = null;

		try {
			stream = createReadStream(filePath);
		} catch (err) {
			logDebug(`Failed to create read stream for ${filePath}: ${err}`);
			return resolve(null);
		}

		const handleError = (error: Error | unknown) => {
			if (stream) stream.destroy();
			logDebug(`Streaming hash failed for ${filePath}: ${error}`);
			resolve(null);
		};

		stream.on("data", (chunk: Buffer) => {
			try {
				hash.update(chunk);
			} catch (err) {
				handleError(err);
			}
		});

		stream.on("end", () => {
			resolve(hash.digest("hex").slice(0, 16));
		});

		stream.on("error", handleError);
	});
}

export function createDirectorySnapshot(
	dir: string,
	maxSizeForHash = MAX_FILE_SIZE_FOR_HASH,
	maxDepth = 50,
	currentDepth = 0,
): Map<string, FileSnapshot> {
	const snapshot = new Map<string, FileSnapshot>();

	if (!existsSync(dir)) return snapshot;

	// Prevent stack overflow on very deep structures
	if (currentDepth > maxDepth) {
		logDebug(`Directory depth limit reached (${maxDepth}) at: ${dir}`);
		return snapshot;
	}

	// Iterative DFS to avoid recursion overhead and improve cache locality
	const stack: Array<{ path: string; relPath: string }> = [{ path: dir, relPath: "" }];

	while (stack.length > 0) {
		const item = stack.pop();
		if (!item) break; // Safety check
		const { path: currentPath, relPath } = item;

		try {
			const entries = readdirSync(currentPath, { withFileTypes: true });
			for (const entry of entries) {
				const entryPath = join(currentPath, entry.name);
				const entryRelPath = relPath ? join(relPath, entry.name) : entry.name;

				if (entry.isDirectory()) {
					// Check current depth before pushing
					const pathDepth = entryRelPath.split(sep).length;
					if (pathDepth < maxDepth - currentDepth) {
						stack.push({ path: entryPath, relPath: entryRelPath });
					} else {
						logDebug(`Skipping deep directory: ${entryRelPath} (depth ${pathDepth})`);
					}
				} else {
					const fileSnapshot = createFileSnapshot(entryPath, maxSizeForHash);
					if (fileSnapshot) {
						snapshot.set(entryRelPath, fileSnapshot);
					}
				}
			}
		} catch (error) {
			// Log error but continue processing other directories
			logDebug(`Failed to read directory ${currentPath}: ${error}`);
		}
	}

	return snapshot;
}

/**
 * Create a selective snapshot of only specific files
 */
export function createSelectiveSnapshot(
	baseDir: string,
	files: string[],
	maxSizeForHash = MAX_FILE_SIZE_FOR_HASH,
): Map<string, FileSnapshot> {
	const snapshot = new Map<string, FileSnapshot>();

	for (const relPath of files) {
		const fullPath = join(baseDir, relPath);
		const fileSnapshot = createFileSnapshot(fullPath, maxSizeForHash);
		if (fileSnapshot) {
			snapshot.set(relPath, fileSnapshot);
		}
	}

	return snapshot;
}

export function compareSnapshots(
	before: Map<string, FileSnapshot>,
	after: Map<string, FileSnapshot>,
): { modified: string[]; added: string[]; deleted: string[] } {
	const modified: string[] = [];
	const added: string[] = [];
	const deleted: string[] = [];

	for (const [relPath, beforeSnap] of before) {
		const afterSnap = after.get(relPath);

		if (!afterSnap) {
			deleted.push(relPath);
		} else {
			const contentChanged =
				beforeSnap.hash && afterSnap.hash
					? beforeSnap.hash !== afterSnap.hash
					: beforeSnap.mtime !== afterSnap.mtime || beforeSnap.size !== afterSnap.size;

			if (contentChanged) {
				modified.push(relPath);
			}
		}
	}

	for (const [relPath] of after) {
		if (!before.has(relPath)) {
			added.push(relPath);
		}
	}

	return { modified, added, deleted };
}

export function collectFilesRecursively(
	dir: string,
	root: string,
	maxDepth = DEFAULT_RECURSION_DEPTH,
	currentDepth = 0,
): string[] {
	if (!existsSync(dir) || maxDepth < currentDepth) return [];

	const files: string[] = [];
	const entries = readdirSync(dir);
	const dirs: string[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const relPath = join(root, entry);

		try {
			const stat = lstatSync(fullPath);

			if (stat.isSymbolicLink()) {
				// Handle symlinks to prevent infinite loops
				logDebug(`Skipping symlink during file collection: ${relPath}`);
			} else if (stat.isDirectory()) {
				dirs.push(fullPath);
			}
			if (stat.isFile()) {
				files.push(relPath);
			}
		} catch (err) {
			logDebug(`Failed to stat ${fullPath}: ${err}`);
		}
	}

	for (const d of dirs) {
		files.push(...collectFilesRecursively(d, root, maxDepth, currentDepth + 1));
	}

	return files;
}

/**
 * Enhanced file modification detection for parallel agents
 */
export function getModifiedFiles(sandboxDir: string, originalDir: string, symlinkDirs: string[] = []): string[] {
	const modified: string[] = [];

	function scanDir(relPath: string) {
		const sandboxPath = join(sandboxDir, relPath);
		const originalPath = join(originalDir, relPath);

		if (!existsSync(sandboxPath)) return;

		const stat = lstatSync(sandboxPath);

		// Skip symlinks
		if (stat.isSymbolicLink()) return;

		// Skip known symlink directories if any
		if (relPath) {
			const topLevel = relPath.split(sep)[0];
			if (symlinkDirs.includes(topLevel)) return;
		}

		if (stat.isDirectory()) {
			try {
				const items = readdirSync(sandboxPath);
				for (const item of items) {
					scanDir(relPath ? join(relPath, item) : item);
				}
			} catch (err) {
				logDebug(`Failed to scan dir ${relPath}: ${err}`);
			}
		} else if (stat.isFile()) {
			let isModified = false;

			if (!existsSync(originalPath)) {
				isModified = true;
			} else {
				try {
					const originalStat = statSync(originalPath);

					// Check mtime and size
					const mtimeDifferent = stat.mtimeMs !== originalStat.mtimeMs;
					const sizeDifferent = stat.size !== originalStat.size;

					if (mtimeDifferent || sizeDifferent) {
						isModified = true;
					}
				} catch {
					isModified = true;
				}
			}

			if (isModified) {
				modified.push(relPath);
			}
		}
	}

	// Start scanning from root
	try {
		const items = readdirSync(sandboxDir);
		for (const item of items) {
			scanDir(item);
		}
	} catch (err) {
		logDebug(`Failed to read sandbox dir: ${err}`);
	}

	return modified;
}
