/**
 * File Indexer Module
 *
 * Provides semantic chunking for large codebases and file hash caching for unchanged files.
 * This module indexes the codebase with file metadata (path, hash, size, mtime, keywords)
 * and provides semantic search to find relevant files based on task keywords.
 */

import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
	mkdir as mkdirAsync,
	readdir as readdirAsync,
	readFile as readFileAsync,
	stat as statAsync,
	writeFile as writeFileAsync,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { CACHE_TTL_MS, DEFAULT_IGNORE_PATTERNS, MAX_FILE_SIZE_FOR_HASH } from "../config/constants.ts";
import { RALPHY_DIR } from "../config/loader.ts";
import { logDebug } from "../ui/logger.ts";

// Constants
const FILE_INDEX_CACHE = "file-index.json";
const MAX_KEYWORDS_PER_FILE = 20;
const MAX_CONTENT_PREVIEW_LENGTH = 500;
const RELEVANCE_THRESHOLD = 0.1;

/**
 * Maximum glob pattern length to prevent ReDoS attacks
 */
const MAX_GLOB_PATTERN_LENGTH = 1000;
const GLOB_REGEX_CACHE_MAX_ENTRIES = 500;
const GLOB_REGEX_CACHE_TTL_MS = 5 * 60 * 1000;

const globRegexCache = new Map<string, { regex: RegExp; expiresAt: number }>();

function isCacheFresh(index: FileIndex): boolean {
	return Date.now() - index.timestamp <= CACHE_TTL_MS;
}

/**
 * File metadata entry in the index
 */
export interface FileIndexEntry {
	/** Relative path from workspace root */
	path: string;
	/** File content hash (sha256, first 16 chars) */
	hash: string;
	/** File size in bytes */
	size: number;
	/** Last modification time (ms since epoch) */
	mtime: number;
	/** Extracted keywords from path and content */
	keywords: string[];
	/** Content preview for semantic analysis */
	preview?: string;
	/** File extension */
	extension: string;
	/** Directory depth */
	depth: number;
}

/**
 * The complete file index for a workspace
 */
export interface FileIndex {
	/** Version for cache invalidation */
	version: number;
	/** Timestamp of index creation */
	timestamp: number;
	/** Workspace root path */
	workDir: string;
	/** Map of relative paths to file entries */
	files: Map<string, FileIndexEntry>;
	/** Total files indexed */
	totalFiles: number;
	/** Total size of all indexed files */
	totalSize: number;
}

/**
 * Serialized version of FileIndex for JSON storage
 */
interface SerializedFileIndex {
	version: number;
	timestamp: number;
	workDir: string;
	files: Record<string, FileIndexEntry>;
	totalFiles: number;
	totalSize: number;
}

// In-memory cache of file indexes
const indexCache = new Map<string, FileIndex>();

// Track promises for workspaces being indexed to allow waiting
const indexingPromises = new Map<string, Promise<FileIndex>>();

/**
 * Deep clone a FileIndex to return an immutable copy
 * Prevents callers from modifying the shared cache
 */
function cloneFileIndex(index: FileIndex): FileIndex {
	return {
		version: index.version,
		timestamp: index.timestamp,
		workDir: index.workDir,
		files: new Map(index.files),
		totalFiles: index.totalFiles,
		totalSize: index.totalSize,
	};
}

/**
 * Get the path to the file index cache
 */
function getIndexCachePath(workDir: string): string {
	return join(workDir, RALPHY_DIR, FILE_INDEX_CACHE);
}

/**
 * Check if a file should be ignored based on patterns
 */
function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/");

	for (const pattern of ignorePatterns) {
		if (matchesGlob(normalizedPath, pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Convert glob pattern to regex
 */
function matchesGlob(filePath: string, pattern: string): boolean {
	// Handle ** patterns properly
	const regexPattern = globToRegex(pattern);
	return regexPattern.test(filePath);
}

/**
 * Convert glob pattern to regex
 *
 * SECURITY NOTE: This function includes protections against ReDoS attacks:
 * - Input length is limited to MAX_GLOB_PATTERN_LENGTH
 * - Uses non-backtracking patterns where possible
 */
function globToRegex(pattern: string): RegExp {
	const safePattern =
		pattern.length > MAX_GLOB_PATTERN_LENGTH
			? pattern.slice(0, MAX_GLOB_PATTERN_LENGTH)
			: pattern;

	const now = Date.now();
	const cached = globRegexCache.get(safePattern);
	if (cached && cached.expiresAt > now) {
		return cached.regex;
	}

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

	const compiled = new RegExp(regex, "i");

	if (globRegexCache.size >= GLOB_REGEX_CACHE_MAX_ENTRIES) {
		for (const [key, value] of globRegexCache) {
			if (value.expiresAt <= now) {
				globRegexCache.delete(key);
			}
		}
		if (globRegexCache.size >= GLOB_REGEX_CACHE_MAX_ENTRIES) {
			const oldestKey = globRegexCache.keys().next().value;
			if (oldestKey) {
				globRegexCache.delete(oldestKey);
			}
		}
	}

	globRegexCache.set(safePattern, { regex: compiled, expiresAt: now + GLOB_REGEX_CACHE_TTL_MS });
	return compiled;
}

/**
 * Extract keywords from a file path
 */
function extractPathKeywords(filePath: string): string[] {
	const keywords = new Set<string>();

	// Split path into components
	const parts = filePath.split(/[/\\]/);

	for (const part of parts) {
		// Skip empty parts and common non-descriptive names
		if (!part || part === "." || part === "..") continue;

		// Extract words from camelCase, PascalCase, snake_case, kebab-case
		const words = part
			.replace(/\.[^.]+$/, "") // Remove extension
			.split(/[_-]/) // Split by underscore and hyphen
			.flatMap((word) => {
				// Split camelCase/PascalCase
				return word
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.split(/\s+/)
					.filter((w) => w.length > 2);
			});

		for (const word of words) {
			const lower = word.toLowerCase();
			if (isSignificantKeyword(lower)) {
				keywords.add(lower);
			}
		}

		// Add the full filename (without extension) as a keyword
		const nameWithoutExt = part.replace(/\.[^.]+$/, "").toLowerCase();
		if (nameWithoutExt.length > 2 && !isCommonWord(nameWithoutExt)) {
			keywords.add(nameWithoutExt);
		}
	}

	// Add extension as keyword
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (ext && ext !== filePath) {
		keywords.add(ext);
	}

	return Array.from(keywords);
}

/**
 * Extract keywords from file content
 */
function extractContentKeywords(content: string, maxKeywords = 10): string[] {
	const keywords = new Set<string>();

	// Extract function/class/variable names from code
	const patterns = [
		// Function declarations
		/(?:function|def|fn|func)\s+(\w+)/g,
		// Class declarations
		/(?:class|interface|type|struct)\s+(\w+)/g,
		// Variable declarations (const, let, var)
		/(?:const|let|var)\s+(\w+)\s*[=:]/g,
		// Export declarations
		/export\s+(?:default\s+)?(?:class|function|const|let|var)?\s*(\w+)/g,
		// Import statements - extract imported names
		/import\s+{([^}]+)}/g,
		// Python imports
		/from\s+\S+\s+import\s+([^\n]+)/g,
		// Go/Rust function signatures
		/fn\s+(\w+)\s*\(/g,
		// React components (PascalCase functions)
		/const\s+([A-Z][a-zA-Z0-9]*)\s*[:=]/g,
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null = null;
		// biome-ignore lint/suspicious/noAssignInExpressions: Standard regex loop pattern
		while ((match = pattern.exec(content)) !== null) {
			const names = match[1]
				.split(/[,\s]+/)
				.map((n) => n.trim())
				.filter((n) => n.length > 2 && isSignificantKeyword(n.toLowerCase()));

			for (const name of names) {
				keywords.add(name.toLowerCase());
			}
		}
	}

	// Extract common words that appear frequently
	const words = content.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];

	const wordFreq = new Map<string, number>();
	for (const word of words) {
		if (!isCommonWord(word) && isSignificantKeyword(word)) {
			wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
		}
	}

	// Add most frequent words
	const sortedWords = Array.from(wordFreq.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxKeywords);

	for (const [word] of sortedWords) {
		keywords.add(word);
	}

	return Array.from(keywords).slice(0, maxKeywords);
}

/**
 * Check if a word is a common/insignificant word
 */
function isCommonWord(word: string): boolean {
	const commonWords = new Set([
		"the",
		"and",
		"for",
		"are",
		"but",
		"not",
		"you",
		"all",
		"can",
		"had",
		"her",
		"was",
		"one",
		"our",
		"out",
		"day",
		"get",
		"has",
		"him",
		"his",
		"how",
		"its",
		"may",
		"new",
		"now",
		"old",
		"see",
		"two",
		"who",
		"boy",
		"did",
		"she",
		"use",
		"way",
		"many",
		"oil",
		"sit",
		"set",
		"run",
		"eat",
		"far",
		"sea",
		"eye",
		"ago",
		"off",
		"too",
		"any",
		"say",
		"man",
		"try",
		"ask",
		"end",
		"why",
		"let",
		"put",
		"own",
		"tell",
		"very",
		"when",
		"come",
		"here",
		"just",
		"like",
		"long",
		"make",
		"over",
		"such",
		"take",
		"than",
		"them",
		"well",
		"were",
		"will",
		"with",
		"have",
		"from",
		"they",
		"know",
		"want",
		"been",
		"good",
		"much",
		"some",
		"time",
		"this",
		"that",
		"would",
		"there",
		"their",
		"what",
		"said",
		"each",
		"which",
		"about",
		"could",
		"other",
		"after",
		"first",
		"never",
		"these",
		"think",
		"where",
		"being",
		"every",
		"great",
		"might",
		"shall",
		"still",
		"those",
		"while",
		"true",
		"false",
		"null",
		"undefined",
		"return",
		"import",
		"export",
		"default",
		"async",
		"await",
		"yield",
		"throw",
		"catch",
		"finally",
		"break",
		"continue",
		"switch",
		"case",
		"try",
		"new",
	]);
	return commonWords.has(word.toLowerCase());
}

/**
 * Check if a keyword is significant (not too short, not numeric)
 */
function isSignificantKeyword(word: string): boolean {
	if (word.length < 3) return false;
	if (/^\d+$/.test(word)) return false;
	if (/^[0-9a-f]{8,}$/i.test(word)) return false; // Likely a hash
	return true;
}

/**
 * Extract keywords from a task description
 */
export function extractTaskKeywords(taskDescription: string): string[] {
	const keywords = new Set<string>();

	// Extract file paths mentioned in the task
	const pathMatches = taskDescription.match(/[\w\-./\\]+\.[\w]+/g) || [];
	for (const path of pathMatches) {
		const pathKeywords = extractPathKeywords(path);
		for (const kw of pathKeywords) {
			keywords.add(kw);
		}
	}

	// Extract camelCase/PascalCase words (likely identifiers)
	const identifierMatches = taskDescription.match(/\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g) || [];
	for (const id of identifierMatches) {
		const words = id
			.replace(/([a-z])([A-Z])/g, "$1 $2")
			.split(/\s+/)
			.filter((w) => w.length > 2);
		for (const word of words) {
			keywords.add(word.toLowerCase());
		}
	}

	// Extract technical terms and concepts
	const techTerms = taskDescription.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]+\b/g) || [];
	for (const term of techTerms) {
		keywords.add(term.toLowerCase());
	}

	// Extract words that look like file names or components
	const componentMatches =
		taskDescription.match(
			/\b[A-Z][a-zA-Z0-9]*(?:Component|Module|Service|Handler|Controller|Model|View|Util|Helper|Manager|Store|Context|Provider|Hook)\b/g,
		) || [];
	for (const comp of componentMatches) {
		keywords.add(comp.toLowerCase());
	}

	// Extract all significant words
	const allWords = taskDescription.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];

	for (const word of allWords) {
		if (!isCommonWord(word) && isSignificantKeyword(word)) {
			keywords.add(word);
		}
	}

	return Array.from(keywords);
}

/**
 * Calculate relevance score between task keywords and file entry
 */
function calculateRelevanceScore(taskKeywords: string[], fileEntry: FileIndexEntry): number {
	let score = 0;
	const fileKeywords = new Set(fileEntry.keywords);

	for (const taskKw of taskKeywords) {
		// Exact match in file keywords
		if (fileKeywords.has(taskKw)) {
			score += 1.0;
			continue;
		}

		// Partial match (task keyword is substring of file keyword or vice versa)
		for (const fileKw of fileKeywords) {
			if (fileKw.includes(taskKw) || taskKw.includes(fileKw)) {
				score += 0.5;
				break;
			}
		}

		// Check if keyword appears in path
		if (fileEntry.path.toLowerCase().includes(taskKw)) {
			score += 0.3;
		}
	}

	// Normalize by number of task keywords
	return taskKeywords.length > 0 ? score / taskKeywords.length : 0;
}

/**
 * Create a file index entry for a single file
 */
async function createFileIndexEntry(
	filePath: string,
	relPath: string,
	maxSizeForContent = MAX_FILE_SIZE_FOR_HASH,
): Promise<FileIndexEntry | null> {
	try {
		const stat = await statAsync(filePath);

		if (!stat.isFile()) return null;

		// Calculate hash
		let hash = "";
		let preview = "";
		let contentKeywords: string[] = [];

		if (stat.size <= maxSizeForContent) {
			try {
				const content = await readFileAsync(filePath, "utf-8");
				hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
				preview = content.slice(0, MAX_CONTENT_PREVIEW_LENGTH);
				contentKeywords = extractContentKeywords(content, 10);
			} catch {
				// Binary or unreadable file - use mtime+size as pseudo-hash
				hash = createHash("sha256").update(`${stat.mtimeMs}-${stat.size}`).digest("hex").slice(0, 16);
			}
		} else {
			// Large file - use mtime+size as pseudo-hash
			hash = createHash("sha256").update(`${stat.mtimeMs}-${stat.size}`).digest("hex").slice(0, 16);
		}

		// Extract path keywords
		const pathKeywords = extractPathKeywords(relPath);

		// Combine keywords
		const allKeywords = [...new Set([...pathKeywords, ...contentKeywords])].slice(0, MAX_KEYWORDS_PER_FILE);

		// Get extension
		const ext = relPath.split(".").pop()?.toLowerCase() || "";

		// Calculate depth
		const depth = relPath.split(/[/\\]/).length - 1;

		return {
			path: relPath,
			hash,
			size: stat.size,
			mtime: stat.mtimeMs,
			keywords: allKeywords,
			preview,
			extension: ext,
			depth,
		};
	} catch (error) {
		logDebug(`Failed to index file ${filePath}: ${error}`);
		return null;
	}
}

/**
 * Index all files in a directory recursively
 *
 * Thread-safe: Returns a cloned copy to prevent cache corruption.
 * Concurrent calls for the same workspace will wait for a single indexing operation.
 */
export async function indexWorkspace(
	workDir: string,
	options: {
		ignorePatterns?: string[];
		forceRebuild?: boolean;
		maxDepth?: number;
	} = {},
): Promise<FileIndex> {
	const { ignorePatterns = DEFAULT_IGNORE_PATTERNS, forceRebuild = false, maxDepth = 50 } = options;

	// Check memory cache first - return a clone to prevent mutation
	const cached = indexCache.get(workDir);
	if (!forceRebuild && cached) {
		if (isCacheFresh(cached)) {
			return cloneFileIndex(cached);
		}
		indexCache.delete(workDir);
	}

	// Check if another operation is already indexing this workspace
	const existingPromise = indexingPromises.get(workDir);
	if (existingPromise && !forceRebuild) {
		logDebug(`Waiting for concurrent indexing of ${workDir}...`);
		const result = await existingPromise;
		// Return a clone even from the concurrent operation's result
		return cloneFileIndex(result);
	}

	// Create the indexing promise to lock this workspace
	const indexingPromise = performIndexing(workDir, ignorePatterns, forceRebuild, maxDepth);
	indexingPromises.set(workDir, indexingPromise);

	try {
		const result = await indexingPromise;
		// Return a cloned copy to prevent cache corruption
		return cloneFileIndex(result);
	} finally {
		// Always clean up the promise lock
		indexingPromises.delete(workDir);
	}
}

/**
 * Perform the actual indexing operation
 */
async function performIndexing(
	workDir: string,
	ignorePatterns: string[],
	forceRebuild: boolean,
	maxDepth: number,
): Promise<FileIndex> {
	// Double-check cache after acquiring lock (another thread may have completed)
	const cached = indexCache.get(workDir);
	if (!forceRebuild && cached) {
		if (isCacheFresh(cached)) {
			return cached;
		}
		indexCache.delete(workDir);
	}

	// Try to load from disk cache
	if (!forceRebuild) {
		const diskCache = await loadIndexFromDisk(workDir);
		if (diskCache) {
			// Perform incremental update
			const updated = await incrementalUpdateIndex(workDir, diskCache, ignorePatterns, maxDepth);
			indexCache.set(workDir, updated);
			await saveIndexToDisk(workDir, updated);
			return updated;
		}
	}

	// Build fresh index
	const index: FileIndex = {
		version: 1,
		timestamp: Date.now(),
		workDir,
		files: new Map(),
		totalFiles: 0,
		totalSize: 0,
	};

	// Ensure .ralphy directory exists
	const ralphyDir = join(workDir, RALPHY_DIR);
	if (!existsSync(ralphyDir)) {
		await mkdirAsync(ralphyDir, { recursive: true });
	}

	// Collect all files
	const filesToIndex: string[] = [];

	async function collectFiles(dir: string, currentDepth: number): Promise<void> {
		if (currentDepth > maxDepth) return;

		try {
			const entries = await readdirAsync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dir, entry.name);
				const relPath = relative(workDir, fullPath);

				if (shouldIgnoreFile(relPath, ignorePatterns)) {
					continue;
				}

				if (entry.isDirectory()) {
					await collectFiles(fullPath, currentDepth + 1);
				} else if (entry.isFile()) {
					filesToIndex.push(fullPath);
				}
			}
		} catch (error) {
			logDebug(`Failed to read directory ${dir}: ${error}`);
		}
	}

	await collectFiles(workDir, 0);

	// Index all collected files
	for (const filePath of filesToIndex) {
		const relPath = relative(workDir, filePath);
		const entry = await createFileIndexEntry(filePath, relPath);
		if (entry) {
			index.files.set(relPath, entry);
			index.totalFiles++;
			index.totalSize += entry.size;
		}
	}

	// Cache and save
	indexCache.set(workDir, index);
	await saveIndexToDisk(workDir, index);

	logDebug(`Indexed ${index.totalFiles} files (${(index.totalSize / 1024 / 1024).toFixed(2)} MB)`);

	return index;
}

/**
 * Perform incremental update of file index
 */
async function incrementalUpdateIndex(
	workDir: string,
	existingIndex: FileIndex,
	ignorePatterns: string[],
	maxDepth: number,
): Promise<FileIndex> {
	const updatedIndex: FileIndex = {
		version: existingIndex.version,
		timestamp: Date.now(),
		workDir,
		files: new Map(existingIndex.files),
		totalFiles: 0,
		totalSize: 0,
	};

	const currentFiles = new Set<string>();
	let reindexedCount = 0;
	let unchangedCount = 0;
	let removedCount = 0;

	async function scanDirectory(dir: string, currentDepth: number): Promise<void> {
		if (currentDepth > maxDepth) return;

		try {
			const entries = await readdirAsync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dir, entry.name);
				const relPath = relative(workDir, fullPath);

				if (shouldIgnoreFile(relPath, ignorePatterns)) {
					continue;
				}

				if (entry.isDirectory()) {
					await scanDirectory(fullPath, currentDepth + 1);
				} else if (entry.isFile()) {
					currentFiles.add(relPath);

					const existingEntry = updatedIndex.files.get(relPath);
					const stat = await statAsync(fullPath);

					if (existingEntry && existingEntry.mtime === stat.mtimeMs && existingEntry.size === stat.size) {
						// File unchanged - keep existing entry
						unchangedCount++;
					} else {
						// File changed or new - reindex
						const newEntry = await createFileIndexEntry(fullPath, relPath);
						if (newEntry) {
							updatedIndex.files.set(relPath, newEntry);
							reindexedCount++;
						}
					}
				}
			}
		} catch (error) {
			logDebug(`Failed to scan directory ${dir}: ${error}`);
		}
	}

	await scanDirectory(workDir, 0);

	// Remove deleted files from index
	for (const [relPath] of updatedIndex.files) {
		if (!currentFiles.has(relPath)) {
			updatedIndex.files.delete(relPath);
			removedCount++;
		}
	}

	// Recalculate totals
	for (const entry of updatedIndex.files.values()) {
		updatedIndex.totalFiles++;
		updatedIndex.totalSize += entry.size;
	}

	logDebug(
		`Incremental index update: ${unchangedCount} unchanged, ${reindexedCount} reindexed, ${removedCount} removed`,
	);

	return updatedIndex;
}

/**
 * Load index from disk cache
 */
async function loadIndexFromDisk(workDir: string): Promise<FileIndex | null> {
	const cachePath = getIndexCachePath(workDir);

	if (!existsSync(cachePath)) {
		return null;
	}

	try {
		const content = await readFileAsync(cachePath, "utf-8");
		const serialized: SerializedFileIndex = JSON.parse(content);

		return {
			version: serialized.version,
			timestamp: serialized.timestamp,
			workDir: serialized.workDir,
			files: new Map(Object.entries(serialized.files)),
			totalFiles: serialized.totalFiles,
			totalSize: serialized.totalSize,
		};
	} catch (error) {
		logDebug(`Failed to load file index from disk: ${error}`);
		return null;
	}
}

/**
 * Save index to disk cache
 */
async function saveIndexToDisk(workDir: string, index: FileIndex): Promise<void> {
	const cachePath = getIndexCachePath(workDir);

	try {
		const serialized: SerializedFileIndex = {
			version: index.version,
			timestamp: index.timestamp,
			workDir: index.workDir,
			files: Object.fromEntries(index.files),
			totalFiles: index.totalFiles,
			totalSize: index.totalSize,
		};

		await writeFileAsync(cachePath, JSON.stringify(serialized, null, 2));
	} catch (error) {
		logDebug(`Failed to save file index to disk: ${error}`);
	}
}

/**
 * Get relevant files for a task based on semantic matching
 */
export async function getRelevantFilesForTask(
	workDir: string,
	taskDescription: string,
	options: {
		maxFiles?: number;
		minRelevance?: number;
		includeExtensions?: string[];
		excludeExtensions?: string[];
	} = {},
): Promise<string[]> {
	const {
		maxFiles = 50,
		minRelevance = RELEVANCE_THRESHOLD,
		includeExtensions,
		excludeExtensions = ["log", "lock", "map", "min.js", "min.css"],
	} = options;

	// Get or build file index
	const index = await indexWorkspace(workDir);

	// Extract keywords from task
	const taskKeywords = extractTaskKeywords(taskDescription);
	logDebug(`Task keywords: ${taskKeywords.join(", ")}`);

	if (taskKeywords.length === 0) {
		// No keywords extracted - return most recently modified files as fallback
		return Array.from(index.files.values())
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, maxFiles)
			.map((e) => e.path);
	}

	// Score all files
	const scoredFiles: Array<{ path: string; score: number; entry: FileIndexEntry }> = [];

	for (const [path, entry] of index.files) {
		// Filter by extension
		if (includeExtensions && !includeExtensions.includes(entry.extension)) {
			continue;
		}
		if (excludeExtensions.includes(entry.extension)) {
			continue;
		}

		const score = calculateRelevanceScore(taskKeywords, entry);
		if (score >= minRelevance) {
			scoredFiles.push({ path, score, entry });
		}
	}

	// Sort by score (descending), then by mtime (most recent first for ties)
	scoredFiles.sort((a, b) => {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return b.entry.mtime - a.entry.mtime;
	});

	// Take top N files
	const relevantFiles = scoredFiles.slice(0, maxFiles).map((s) => s.path);

	logDebug(`Found ${relevantFiles.length} relevant files for task (scored ${scoredFiles.length} total)`);

	return relevantFiles;
}

/**
 * Get file hash from index (useful for caching unchanged files)
 */
export async function getFileHashFromIndex(workDir: string, relPath: string): Promise<string | null> {
	const index = await indexWorkspace(workDir);
	const entry = index.files.get(relPath);
	return entry?.hash ?? null;
}

/**
 * Check if a file has changed based on index
 */
export async function hasFileChanged(workDir: string, relPath: string, expectedHash: string): Promise<boolean> {
	const currentHash = await getFileHashFromIndex(workDir, relPath);
	if (currentHash === null) {
		return true; // File not in index, assume changed
	}
	return currentHash !== expectedHash;
}

/**
 * Get file metadata from index
 */
export async function getFileMetadata(workDir: string, relPath: string): Promise<FileIndexEntry | null> {
	const index = await indexWorkspace(workDir);
	return index.files.get(relPath) ?? null;
}

/**
 * Clear the file index cache (both memory and disk)
 */
export function clearFileIndexCache(workDir: string): void {
	indexCache.delete(workDir);
	const cachePath = getIndexCachePath(workDir);
	try {
		if (existsSync(cachePath)) {
			rmSync(cachePath);
		}
	} catch (error) {
		logDebug(`Failed to clear file index cache: ${error}`);
	}
}

/**
 * Get index statistics
 */
export async function getIndexStats(workDir: string): Promise<{
	totalFiles: number;
	totalSize: number;
	avgFileSize: number;
	lastUpdated: number;
}> {
	const index = await indexWorkspace(workDir);
	return {
		totalFiles: index.totalFiles,
		totalSize: index.totalSize,
		avgFileSize: index.totalFiles > 0 ? index.totalSize / index.totalFiles : 0,
		lastUpdated: index.timestamp,
	};
}

/**
 * Force rebuild the file index
 */
export async function rebuildFileIndex(workDir: string): Promise<FileIndex> {
	clearFileIndexCache(workDir);
	return indexWorkspace(workDir, { forceRebuild: true });
}

/**
 * Find files by keyword (simple search)
 */
export async function findFilesByKeyword(
	workDir: string,
	keyword: string,
	options: { maxResults?: number } = {},
): Promise<FileIndexEntry[]> {
	const { maxResults = 20 } = options;
	const index = await indexWorkspace(workDir);
	const results: FileIndexEntry[] = [];
	const lowerKeyword = keyword.toLowerCase();

	for (const entry of index.files.values()) {
		// Check if keyword is in path
		if (entry.path.toLowerCase().includes(lowerKeyword)) {
			results.push(entry);
			continue;
		}

		// Check if keyword is in keywords
		if (entry.keywords.some((k) => k.includes(lowerKeyword) || lowerKeyword.includes(k))) {
			results.push(entry);
			continue;
		}

		// Check preview for code files
		if (entry.preview?.toLowerCase().includes(lowerKeyword)) {
			results.push(entry);
		}
	}

	return results.slice(0, maxResults);
}
