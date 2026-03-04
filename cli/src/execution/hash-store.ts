/**
 * Hash Storage System for Ralphy CLI
 *
 * Manages file hashes per task to avoid copying unchanged files and reduce token usage.
 * Stores file content, metadata, and hash references in .ralphy-hashes/<task-id>/
 */

import { createHash } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import {
	ENABLE_HASH_STORE,
	HASH_STORE_DIR,
	HASH_STORE_MAX_AGE_MS,
	MAX_FILE_SIZE_FOR_HASH,
} from "../config/constants.ts";
import { logDebug, logError, logWarn } from "../ui/logger.ts";

const COMPRESSION_TIMEOUT_MS = 30000; // 30 second timeout for compression/decompression

function validateTaskId(taskId: string): string {
	const trimmed = taskId.trim();
	if (!trimmed) {
		throw new HashStoreError("Task ID cannot be empty");
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
		throw new HashStoreError("Task ID contains invalid characters");
	}
	return trimmed;
}

/**
 * Wrap a promise with a timeout
 */
async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	let timeoutId: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata for a stored file hash
 */
export interface HashMetadata {
	/** Original file path (relative to project root) */
	originalPath: string;
	/** SHA256 hash of file content */
	hash: string;
	/** File size in bytes */
	size: number;
	/** Last modified timestamp */
	mtime: number;
	/** Content MIME type (if detectable) */
	mimeType?: string;
	/** Whether content is compressed */
	compressed: boolean;
	/** Original content size before compression */
	originalSize: number;
	/** Timestamp when hash was stored */
	storedAt: number;
	/** Task ID that owns this hash */
	taskId: string;
}

/**
 * Hash reference file structure
 */
export interface HashReference {
	/** Hash value */
	hash: string;
	/** Path to the hash file (relative to hash store root) */
	hashPath: string;
	/** Metadata path (relative to hash store root) */
	metadataPath: string;
}

/**
 * Task hash index - maps files to their hash references
 */
export interface TaskHashIndex {
	/** Task ID */
	taskId: string;
	/** Mapping of file paths to hash references */
	files: Record<string, HashReference>;
	/** Created timestamp */
	createdAt: number;
	/** Last updated timestamp */
	updatedAt: number;
}

/**
 * Options for adding a file to the hash store
 */
export interface AddFileOptions {
	/** Whether to compress the content */
	compress?: boolean;
	/** Minimum size threshold for compression (default: 1KB) */
	compressionThreshold?: number;
}

/**
 * Result of adding a file to the hash store
 */
export interface AddFileResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** The hash value (if successful) */
	hash?: string;
	/** Error message (if failed) */
	error?: string;
	/** Whether the hash was already in the store */
	alreadyExists?: boolean;
}

/**
 * Result of retrieving a file from the hash store
 */
export interface GetFileResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** File content buffer (if successful) */
	content?: Buffer;
	/** File metadata (if successful) */
	metadata?: HashMetadata;
	/** Error message (if failed) */
	error?: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error for hash store operations
 */
export class HashStoreError extends Error {
	constructor(
		message: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = "HashStoreError";
	}
}

/**
 * Error when hash store is disabled
 */
export class HashStoreDisabledError extends HashStoreError {
	constructor() {
		super("Hash store is disabled");
		this.name = "HashStoreDisabledError";
	}
}

/**
 * Error when file is not found in hash store
 */
export class HashNotFoundError extends HashStoreError {
	constructor(hash: string) {
		super(`Hash not found: ${hash}`);
		this.name = "HashNotFoundError";
	}
}

/**
 * Error when file reference is not found
 */
export class FileReferenceNotFoundError extends HashStoreError {
	constructor(filePath: string) {
		super(`File reference not found: ${filePath}`);
		this.name = "FileReferenceNotFoundError";
	}
}

// ============================================================================
// Hash Store Implementation
// ============================================================================

/**
 * FileHashStore - Manages file hashes per task
 *
 * This class provides:
 * - SHA256 hash generation for files
 * - Compressed storage of file content
 * - File reference tracking
 * - Automatic cleanup after task completion
 */
export class FileHashStore {
	/** Task identifier */
	private readonly taskId: string;
	/** Base directory for hash storage */
	private readonly baseDir: string;
	/** Task-specific directory */
	private readonly taskDir: string;
	/** Path to the hash index file */
	private readonly indexPath: string;
	/** In-memory hash index */
	private index: TaskHashIndex;
	/** Whether the store is initialized */
	private initialized = false;
	/** Whether the store has been cleaned up */
	private cleanedUp = false;

	/**
	 * Create a new FileHashStore instance
	 *
	 * @param taskId - Unique task identifier
	 * @param projectRoot - Project root directory (defaults to current working directory)
	 */
	constructor(
		taskId: string,
		private readonly projectRoot: string = process.cwd(),
	) {
		this.taskId = validateTaskId(taskId);
		this.baseDir = resolve(projectRoot, HASH_STORE_DIR);
		this.taskDir = join(this.baseDir, this.taskId);
		this.indexPath = join(this.taskDir, ".ralphy-hashes-ref.json");
		this.index = {
			taskId: this.taskId,
			files: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	/**
	 * Initialize the hash store
	 * Creates directories and loads existing index if present
	 */
	async initialize(): Promise<void> {
		if (!ENABLE_HASH_STORE) {
			logDebug("[HashStore] Hash store is disabled, skipping initialization");
			return;
		}

		if (this.initialized) {
			return;
		}

		try {
			// Create task directory
			mkdirSync(this.taskDir, { recursive: true });

			// Create content directory for hashes
			mkdirSync(join(this.taskDir, "content"), { recursive: true });

			// Load existing index if present
			if (existsSync(this.indexPath)) {
				try {
					const data = readFileSync(this.indexPath, "utf-8");
					// SECURITY: Validate JSON before parsing to prevent prototype pollution
					if (data.match(/"(__proto__|constructor|prototype)"\s*:/)) {
						throw new Error(
							"Hash index file contains potentially malicious prototype pollution keys",
						);
					}
					try {
						this.index = JSON.parse(data) as TaskHashIndex;
					} catch {
						throw new Error("Failed to parse hash index: invalid JSON");
					}
					logDebug(
						`[HashStore] Loaded existing index for task ${this.taskId} with ${Object.keys(this.index.files).length} files`,
					);
				} catch (error) {
					logWarn(`[HashStore] Failed to load existing index, creating new one: ${error}`);
					this.index = {
						taskId: this.taskId,
						files: {},
						createdAt: Date.now(),
						updatedAt: Date.now(),
					};
				}
			} else {
				logDebug(`[HashStore] Created new index for task ${this.taskId}`);
			}

			this.initialized = true;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logError(`[HashStore] Initialization failed: ${err.message}`);
			throw new HashStoreError("Failed to initialize hash store", err);
		}
	}

	/**
	 * Generate SHA256 hash for a file
	 *
	 * @param filePath - Path to the file
	 * @returns The SHA256 hash string
	 */
	async generateHash(filePath: string): Promise<string> {
		const absolutePath = resolve(this.projectRoot, filePath);
		const hash = createHash("sha256");

		// For small files, read entirely into memory
		const stats = statSync(absolutePath);
		if (stats.size <= MAX_FILE_SIZE_FOR_HASH) {
			const content = readFileSync(absolutePath);
			hash.update(content);
		} else {
			// Stream large files to avoid memory issues
			const stream = createReadStream(absolutePath);
			for await (const chunk of stream) {
				hash.update(chunk as Buffer);
			}
		}

		return hash.digest("hex");
	}

	/**
	 * Add a file to the hash store
	 *
	 * @param filePath - Path to the file (relative to project root)
	 * @param options - Options for adding the file
	 * @returns Result of the operation
	 */
	async addFile(filePath: string, options: AddFileOptions = {}): Promise<AddFileResult> {
		if (!ENABLE_HASH_STORE) {
			return { success: false, error: "Hash store is disabled" };
		}

		if (this.cleanedUp) {
			return { success: false, error: "Hash store has been cleaned up" };
		}

		await this.initialize();

		const {
			compress = true,
			compressionThreshold = 1024, // 1KB
		} = options;

		try {
			const absolutePath = resolve(this.projectRoot, filePath);

			// Check if file exists
			if (!existsSync(absolutePath)) {
				return { success: false, error: `File not found: ${filePath}` };
			}

			// Get file stats
			const stats = statSync(absolutePath);

			// Generate hash
			const hash = await this.generateHash(filePath);

			const compressedHashPath = join("content", `${hash}.gz`);
			const uncompressedHashPath = join("content", hash);
			const absoluteCompressedPath = join(this.taskDir, compressedHashPath);
			const absoluteUncompressedPath = join(this.taskDir, uncompressedHashPath);

			const hasCompressed = existsSync(absoluteCompressedPath);
			const hasUncompressed = existsSync(absoluteUncompressedPath);
			const alreadyExists = hasCompressed || hasUncompressed;
			const shouldCompress = compress && stats.size >= compressionThreshold;

			// Store content if not already present
			if (!alreadyExists) {
				if (shouldCompress) {
					// Compress and store
					await this.storeCompressed(absolutePath, absoluteCompressedPath);
				} else {
					// Store uncompressed
					await this.storeUncompressed(absolutePath, absoluteUncompressedPath);
				}

				// Store metadata
				const metadata: HashMetadata = {
					originalPath: filePath,
					hash,
					size: stats.size,
					mtime: stats.mtime.getTime(),
					compressed: shouldCompress,
					originalSize: stats.size,
					storedAt: Date.now(),
					taskId: this.taskId,
				};

				const metadataPath = join(this.taskDir, "content", `${hash}.json`);
				writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
			}

			// Update index
			const storedHashPath = alreadyExists
				? hasCompressed
					? compressedHashPath
					: uncompressedHashPath
				: shouldCompress
					? compressedHashPath
					: uncompressedHashPath;

			this.index.files[filePath] = {
				hash,
				hashPath: storedHashPath,
				metadataPath: join("content", `${hash}.json`),
			};
			this.index.updatedAt = Date.now();

			// Save index
			this.saveIndex();

			logDebug(
				`[HashStore] Added file ${filePath} with hash ${hash.slice(0, 16)}... (${alreadyExists ? "deduplicated" : "new"})`,
			);

			return {
				success: true,
				hash,
				alreadyExists,
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logError(`[HashStore] Failed to add file ${filePath}: ${err.message}`);
			return { success: false, error: err.message };
		}
	}

	/**
	 * Store file with compression
	 */
	private async storeCompressed(sourcePath: string, destPath: string): Promise<void> {
		const source = createReadStream(sourcePath);
		const gzip = createGzip({ level: 6 });
		const dest = createWriteStream(destPath);

		await withTimeout(pipeline(source, gzip, dest), COMPRESSION_TIMEOUT_MS, "File compression");
	}

	/**
	 * Store file without compression
	 */
	private async storeUncompressed(sourcePath: string, destPath: string): Promise<void> {
		const source = createReadStream(sourcePath);
		const dest = createWriteStream(destPath);

		await withTimeout(pipeline(source, dest), COMPRESSION_TIMEOUT_MS, "File copy");
	}

	/**
	 * Get a file from the hash store
	 *
	 * @param filePath - Path to the file (relative to project root)
	 * @returns Result with content and metadata
	 */
	async getFile(filePath: string): Promise<GetFileResult> {
		if (!ENABLE_HASH_STORE) {
			return { success: false, error: "Hash store is disabled" };
		}

		await this.initialize();

		try {
			const reference = this.index.files[filePath];
			if (!reference) {
				return { success: false, error: `File not in hash store: ${filePath}` };
			}

			// Load metadata
			const metadataPath = join(this.taskDir, reference.metadataPath);
			if (!existsSync(metadataPath)) {
				return { success: false, error: `Metadata not found for: ${filePath}` };
			}

			let metadata: HashMetadata;
			try {
				metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as HashMetadata;
			} catch {
				return { success: false, error: `Failed to parse metadata for: ${filePath}` };
			}

			// Load content
			const hashPath = join(this.taskDir, reference.hashPath);
			if (!existsSync(hashPath)) {
				return { success: false, error: `Content not found for: ${filePath}` };
			}

			let content: Buffer;
			if (metadata.compressed) {
				content = await this.loadCompressed(hashPath);
			} else {
				content = readFileSync(hashPath);
			}

			logDebug(`[HashStore] Retrieved file ${filePath} (${content.length} bytes)`);

			return {
				success: true,
				content,
				metadata,
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logError(`[HashStore] Failed to get file ${filePath}: ${err.message}`);
			return { success: false, error: err.message };
		}
	}

	/**
	 * Load compressed content
	 */
	private async loadCompressed(filePath: string): Promise<Buffer> {
		const chunks: Buffer[] = [];
		const source = createReadStream(filePath);
		const gunzip = createGunzip();

		await withTimeout(
			pipeline(source, gunzip, async function collectChunks(stream: AsyncIterable<unknown>) {
				for await (const chunk of stream) {
					chunks.push(chunk as Buffer);
				}
			}),
			COMPRESSION_TIMEOUT_MS,
			"File decompression",
		);

		return Buffer.concat(chunks);
	}

	/**
	 * Check if a file is in the hash store
	 *
	 * @param filePath - Path to the file (relative to project root)
	 * @returns True if the file is stored
	 */
	async hasFile(filePath: string): Promise<boolean> {
		if (!ENABLE_HASH_STORE || this.cleanedUp) {
			return false;
		}

		await this.initialize();

		return filePath in this.index.files;
	}

	/**
	 * Get the hash for a file
	 *
	 * @param filePath - Path to the file (relative to project root)
	 * @returns The hash string, or null if not found
	 */
	async getHash(filePath: string): Promise<string | null> {
		if (!ENABLE_HASH_STORE || this.cleanedUp) {
			return null;
		}

		await this.initialize();

		const reference = this.index.files[filePath];
		return reference?.hash ?? null;
	}

	/**
	 * Compare a file's current hash with the stored hash
	 *
	 * @param filePath - Path to the file (relative to project root)
	 * @returns True if the file has changed (or not in store), false if unchanged
	 */
	async hasChanged(filePath: string): Promise<boolean> {
		if (!ENABLE_HASH_STORE || this.cleanedUp) {
			return true; // Assume changed if store is unavailable
		}

		const storedHash = await this.getHash(filePath);
		if (!storedHash) {
			return true; // Not in store, treat as changed
		}

		try {
			const currentHash = await this.generateHash(filePath);
			return currentHash !== storedHash;
		} catch {
			return true; // Error reading file, treat as changed
		}
	}

	/**
	 * Get all files in the hash store for this task
	 *
	 * @returns Array of file paths
	 */
	async getStoredFiles(): Promise<string[]> {
		if (!ENABLE_HASH_STORE || this.cleanedUp) {
			return [];
		}

		await this.initialize();

		return Object.keys(this.index.files);
	}

	/**
	 * Get statistics about the hash store
	 */
	async getStats(): Promise<{
		totalFiles: number;
		totalSize: number;
		compressedSize: number;
		deduplicationRatio: number;
	}> {
		if (!ENABLE_HASH_STORE || this.cleanedUp) {
			return {
				totalFiles: 0,
				totalSize: 0,
				compressedSize: 0,
				deduplicationRatio: 0,
			};
		}

		await this.initialize();

		let totalSize = 0;
		let compressedSize = 0;
		const uniqueHashes = new Set<string>();

		for (const [_filePath, reference] of Object.entries(this.index.files)) {
			uniqueHashes.add(reference.hash);

			const metadataPath = join(this.taskDir, reference.metadataPath);
			if (existsSync(metadataPath)) {
				try {
					const metadata: HashMetadata = JSON.parse(
						readFileSync(metadataPath, "utf-8"),
					) as HashMetadata;
					totalSize += metadata.originalSize;
				} catch {
					// Skip files with corrupted metadata
				}
			}

			const hashPath = join(this.taskDir, reference.hashPath);
			if (existsSync(hashPath)) {
				const stats = statSync(hashPath);
				compressedSize += stats.size;
			}
		}

		const totalFiles = Object.keys(this.index.files).length;
		const deduplicationRatio = totalFiles > 0 ? (totalFiles - uniqueHashes.size) / totalFiles : 0;

		return {
			totalFiles,
			totalSize,
			compressedSize,
			deduplicationRatio,
		};
	}

	/**
	 * Save the index to disk
	 */
	private saveIndex(): void {
		try {
			writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logWarn(`[HashStore] Failed to save index: ${err.message}`);
		}
	}

	/**
	 * Clean up the hash store for this task
	 * Removes all stored files and the task directory
	 */
	async cleanup(): Promise<void> {
		if (this.cleanedUp) {
			return;
		}

		if (!ENABLE_HASH_STORE) {
			this.cleanedUp = true;
			return;
		}

		try {
			if (existsSync(this.taskDir)) {
				// Get stats before cleanup for logging
				const stats = await this.getStats();

				rmSync(this.taskDir, { recursive: true, force: true });

				logDebug(
					`[HashStore] Cleaned up task ${this.taskId} (${stats.totalFiles} files, ${(stats.compressedSize / 1024 / 1024).toFixed(2)} MB)`,
				);
			}

			this.cleanedUp = true;
			this.initialized = false;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logError(`[HashStore] Cleanup failed: ${err.message}`);
			// Don't throw - cleanup failures shouldn't break execution
		}
	}

	/**
	 * Clean up old hash stores across all tasks
	 * Should be called periodically to remove stale data
	 *
	 * @param maxAgeMs - Maximum age in milliseconds (defaults to HASH_STORE_MAX_AGE_MS)
	 */
	static async cleanupOldStores(
		projectRoot: string = process.cwd(),
		maxAgeMs: number = HASH_STORE_MAX_AGE_MS,
	): Promise<number> {
		if (!ENABLE_HASH_STORE) {
			return 0;
		}

		const baseDir = resolve(projectRoot, HASH_STORE_DIR);

		if (!existsSync(baseDir)) {
			return 0;
		}

		let cleanedCount = 0;
		const now = Date.now();

		try {
			const entries = readdirSync(baseDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const taskDir = join(baseDir, entry.name);
				const indexPath = join(taskDir, ".ralphy-hashes-ref.json");

				try {
					let shouldClean = false;

					if (existsSync(indexPath)) {
						const data = readFileSync(indexPath, "utf-8");
						try {
							const index: TaskHashIndex = JSON.parse(data) as TaskHashIndex;
							shouldClean = now - index.updatedAt > maxAgeMs;
						} catch {
							// If index is corrupted, clean it up
							shouldClean = true;
						}
					} else {
						// No index file, check directory modification time
						const stats = statSync(taskDir);
						shouldClean = now - stats.mtime.getTime() > maxAgeMs;
					}

					if (shouldClean) {
						rmSync(taskDir, { recursive: true, force: true });
						cleanedCount++;
						logDebug(`[HashStore] Cleaned up old store: ${entry.name}`);
					}
				} catch (error) {
					// Log but continue cleaning other stores
					logWarn(`[HashStore] Failed to check/clean ${entry.name}: ${error}`);
				}
			}
		} catch (error) {
			logWarn(`[HashStore] Failed to cleanup old stores: ${error}`);
		}

		if (cleanedCount > 0) {
			logDebug(`[HashStore] Cleaned up ${cleanedCount} old hash stores`);
		}

		return cleanedCount;
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a hash store for a task
 * Convenience function for creating and initializing a hash store
 *
 * @param taskId - Task identifier
 * @param projectRoot - Project root directory
 * @returns Initialized FileHashStore instance
 */
export async function createHashStore(
	taskId: string,
	projectRoot?: string,
): Promise<FileHashStore> {
	const store = new FileHashStore(taskId, projectRoot);
	await store.initialize();
	return store;
}

/**
 * Check if hash store is enabled
 */
export function isHashStoreEnabled(): boolean {
	return ENABLE_HASH_STORE;
}

/**
 * Get the path to the hash store directory
 */
export function getHashStorePath(projectRoot: string = process.cwd()): string {
	return resolve(projectRoot, HASH_STORE_DIR);
}
