import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, normalize, resolve } from "node:path";
import process from "node:process";
import {
	LOCK_CLEANUP_INTERVAL_MS,
	LOCK_DIR,
	LOCK_MAX_LOCKS,
	LOCK_TIMEOUT_MS,
} from "../config/constants.ts";
import { logDebug, logWarn } from "../ui/logger.ts";
import { registerCleanup } from "../utils/cleanup.ts";

interface LockInfo {
	timestamp: number;
	timeout: number;
	owner: string; // Track lock owner
	refreshCount: number;
}

// Unified lock structure for better performance
const locks = new Map<string, LockInfo>();
const lockOwner = `${process.pid.toString()}-${Date.now()}`;
const sleepBuffer = new SharedArrayBuffer(4);
const sleepArray = new Int32Array(sleepBuffer);
function sleepBlocking(ms: number): void {
	if (ms <= 0) return;

	if (typeof Bun !== "undefined" && Bun.sleepSync) {
		Bun.sleepSync(ms);
		return;
	}

	try {
		// Node runtime fallback. If unavailable in current runtime/thread, skip blocking delay.
		Atomics.wait(sleepArray, 0, 0, ms);
	} catch {
		// No-op fallback.
	}
}

function refreshLock(normalizedPath: string, workDir: string): void {
	const lockInfo = locks.get(normalizedPath);
	if (!lockInfo) return;

	const updatedLockInfo: LockInfo = {
		...lockInfo,
		timestamp: Date.now(),
		refreshCount: lockInfo.refreshCount + 1,
	};

	// Update lock file on disk
	const lockFile = getLockFilePath(normalizedPath, workDir);
	try {
		writeFileSync(lockFile, JSON.stringify(updatedLockInfo));
		locks.set(normalizedPath, updatedLockInfo);
	} catch (err) {
		logDebug(`Failed to refresh lock ${normalizedPath}: ${err}`);
	}
}

// Define global state interface for type safety
declare global {
	interface RalphyGlobalState {
		_lockState?: {
			_lastLockCleanup?: number;
		};
		verboseMode?: boolean;
	}
}

// Register for global cleanup
registerCleanup(() => {
	locks.clear();
});

function getLockFilePath(normalizedPath: string, workDir: string): string {
	const hash = createHash("sha256").update(normalizedPath).digest("hex");
	const lockDir = join(workDir, LOCK_DIR);
	return join(lockDir, `${hash}.lock`);
}

function ensureLockDir(workDir: string): void {
	const lockDir = join(workDir, LOCK_DIR);
	try {
		mkdirSync(lockDir, { recursive: true });
	} catch (err) {
		// Directory may already exist, that's OK
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
			throw err;
		}
	}
}

function cleanupStaleLockFiles(workDir: string): void {
	const lockDir = join(workDir, LOCK_DIR);
	if (!existsSync(lockDir)) return;

	const files = readdirSync(lockDir);
	const now = Date.now();

	for (const file of files) {
		if (!file.endsWith(".lock")) continue;
		const filePath = join(lockDir, file);
		try {
			const content = readFileSync(filePath, "utf8");
			const lockInfo: LockInfo = JSON.parse(content);
			if (now - lockInfo.timestamp >= lockInfo.timeout) {
				try {
					unlinkSync(filePath);
				} catch {
					// Best-effort cleanup: lock may be removed by another process.
				}
			}
		} catch {
			try {
				unlinkSync(filePath);
			} catch {
				// Best-effort cleanup: lock may be removed by another process.
			}
		}
	}
}

export function normalizePathForLocking(filePath: string, workDir: string): string {
	// Resolve to absolute path first
	const absolutePath = resolve(workDir, filePath);

	// Normalize path separators and resolve .. etc.
	const normalized = normalize(absolutePath);

	// On Windows, convert to lowercase for case-insensitive comparison
	if (process.platform === "win32") {
		return normalized.toLowerCase();
	}

	return normalized;
}

export function isInRalphyDir(filePath: string): boolean {
	return filePath.includes(".ralphy") || filePath.includes(".ralphy-worktrees");
}

function getGlobalLockState(): NonNullable<RalphyGlobalState["_lockState"]> {
	if (!(globalThis as RalphyGlobalState)._lockState) {
		(globalThis as RalphyGlobalState)._lockState = { _lastLockCleanup: 0 };
	}
	// biome-ignore lint/style/noNonNullAssertion: guaranteed to be set above
	return (globalThis as RalphyGlobalState)._lockState!;
}

export function acquireFileLock(
	filePath: string,
	workDir: string,
	maxRetries = 5,
	allowReentrant = false,
): boolean {
	const normalizedPath = normalizePathForLocking(filePath, workDir);
	const now = Date.now();

	// CRITICAL FIX: Check in-memory lock FIRST before any file operations
	// This handles re-entrant locks without file I/O
	const existing = locks.get(normalizedPath);
	if (existing && now - existing.timestamp < existing.timeout) {
		if (existing.owner === lockOwner && allowReentrant) {
			refreshLock(normalizedPath, workDir);
			return true;
		}
		return false; // Someone else owns it
	}

	ensureLockDir(workDir);
	const lockState = getGlobalLockState();
	const lastCleanupTime = lockState._lastLockCleanup || 0;

	if (now - lastCleanupTime > LOCK_CLEANUP_INTERVAL_MS) {
		cleanupStaleLocks();
		cleanupStaleLockFiles(workDir);
		lockState._lastLockCleanup = now;
	}

	const lockFile = getLockFilePath(normalizedPath, workDir);

	// Atomic lock acquisition using writeFileSync with exclusive flag
	// This is the ONLY source of truth - in-memory cache is updated AFTER file succeeds
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const lockInfo = {
				timestamp: Date.now(),
				timeout: LOCK_TIMEOUT_MS,
				owner: lockOwner,
				refreshCount: 0,
			};

			// CRITICAL: Use writeFileSync with 'wx' flag for atomic creation
			// This is the race condition prevention - only one process can succeed
			writeFileSync(lockFile, JSON.stringify(lockInfo), { flag: "wx" });

			// ONLY update in-memory cache AFTER successful file write
			// This ensures file is the source of truth
			locks.set(normalizedPath, lockInfo);

			return true;
		} catch (_error) {
			const currentTime = Date.now();

			// Check if we should retry based on lock file state
			if (existsSync(lockFile)) {
				try {
					const content = readFileSync(lockFile, "utf8");

					// Handle empty or corrupt lock file
					if (!content || content.trim().length === 0) {
						logDebug(`Lock file ${lockFile} is empty, removing`);
						unlinkSync(lockFile);
						continue;
					}

					let fileLockInfo: unknown;
					try {
						fileLockInfo = JSON.parse(content);
					} catch (parseError) {
						logDebug(`Failed to parse lock file ${lockFile}: ${parseError}`);
						unlinkSync(lockFile);
						continue;
					}

					// Validate lock info and check if stale
					if (
						fileLockInfo &&
						typeof fileLockInfo === "object" &&
						"timestamp" in fileLockInfo &&
						typeof fileLockInfo.timestamp === "number" &&
						"timeout" in fileLockInfo &&
						typeof fileLockInfo.timeout === "number"
					) {
						// Check if lock is stale
						if (currentTime - fileLockInfo.timestamp >= fileLockInfo.timeout) {
							logDebug(`Removing stale lock file ${lockFile}`);
							unlinkSync(lockFile);
							continue; // Retry after removing stale lock
						}

						// Lock is valid and held by someone else
						logDebug(`Lock file ${lockFile} is held by another process`);

						// Check if it's our own lock (file exists but memory doesn't have it)
						// Use type assertion for owner/refreshCount which may not be in older lock files
						const typedLockInfo = fileLockInfo as LockInfo;
						if (typedLockInfo.owner === lockOwner && allowReentrant) {
							logDebug(`Reclaiming our own lock ${lockFile}`);
							// Reclaim the lock in memory
							locks.set(normalizedPath, {
								timestamp: typedLockInfo.timestamp,
								timeout: typedLockInfo.timeout,
								owner: typedLockInfo.owner,
								refreshCount: typedLockInfo.refreshCount || 0,
							});
							refreshLock(normalizedPath, workDir);
							return true;
						}
					}
				} catch (readError) {
					logDebug(`Error reading lock file ${lockFile}: ${readError}`);
					try {
						unlinkSync(lockFile);
					} catch (unlinkError) {
						logDebug(`Failed to remove lock file ${lockFile}: ${unlinkError}`);
					}
				}
			}

			// Exponential backoff with jitter - use non-blocking approach
			if (attempt < maxRetries) {
				const baseDelay = 2 ** attempt * 100; // 100, 200, 400, 800, 1600ms
				// Use cryptographically secure random for jitter (not Math.random())
				const jitter = Number.parseInt(randomBytes(2).toString("hex"), 16) % 50; // 0-50ms jitter
				const delay = Math.min(baseDelay + jitter, 5000); // Max 5 seconds

				logDebug(
					`Lock acquisition attempt ${attempt}/${maxRetries} failed, retrying in ${Math.round(delay)}ms`,
				);
				sleepBlocking(delay);
			}
		}
	}
	logDebug(`Failed to acquire lock after ${maxRetries} attempts: ${normalizedPath}`);
	return false;
}

export function releaseFileLock(filePath: string, workDir: string): void {
	const normalizedPath = normalizePathForLocking(filePath, workDir);
	const inMemory = locks.get(normalizedPath);
	if (inMemory && inMemory.owner !== lockOwner) {
		logDebug(`Skipping release of lock not owned by this process: ${normalizedPath}`);
		return;
	}
	locks.delete(normalizedPath);

	// Remove persistent lock file
	const lockFile = getLockFilePath(normalizedPath, workDir);
	if (existsSync(lockFile)) {
		try {
			const content = readFileSync(lockFile, "utf8");
			const fileLock = JSON.parse(content) as Partial<LockInfo>;
			if (fileLock.owner && fileLock.owner !== lockOwner) {
				logDebug(`Skipping delete of lock file owned by ${fileLock.owner}: ${lockFile}`);
				return;
			}
			unlinkSync(lockFile);
		} catch (err) {
			logDebug(`Failed to delete lock file ${lockFile}: ${err}`);
		}
	}
}

export function acquireLocksForFiles(files: string[], workDir: string): boolean {
	// Remove duplicates by normalizing paths first
	const fileMap = new Map<string, string>();

	for (const file of files) {
		const normalizedPath = normalizePathForLocking(file, workDir);
		if (!fileMap.has(normalizedPath)) {
			fileMap.set(normalizedPath, file);
		}
	}

	const uniqueFiles = Array.from(fileMap.values());
	const acquiredThisAttempt: string[] = [];

	try {
		for (const file of uniqueFiles) {
			if (acquireFileLock(file, workDir)) {
				acquiredThisAttempt.push(file);
			} else {
				// Rollback: release only locks acquired in THIS attempt
				for (const acquiredFile of acquiredThisAttempt) {
					releaseFileLock(acquiredFile, workDir);
				}
				return false;
			}
		}
		return true;
	} catch (err) {
		// Rollback on error
		for (const acquiredFile of acquiredThisAttempt) {
			releaseFileLock(acquiredFile, workDir);
		}
		throw err;
	}
}

export function releaseLocksForFiles(files: string[], workDir: string): void {
	for (const file of files) {
		releaseFileLock(file, workDir);
	}
}

export function clearAllLocks(): void {
	locks.clear();
}

export function getActiveLocks(): string[] {
	return Array.from(locks.keys());
}

export function cleanupStaleLocks(): void {
	const now = Date.now();
	const locksToEvict: string[] = [];

	// Remove expired locks first
	for (const [path, lockInfo] of locks.entries()) {
		if (now - lockInfo.timestamp > lockInfo.timeout) {
			locksToEvict.push(path);
		}
	}

	// Notify before eviction
	for (const path of locksToEvict) {
		const lockInfo = locks.get(path);
		if (lockInfo && lockInfo.owner !== lockOwner) {
			logDebug(`Evicting lock owned by ${lockInfo.owner}: ${path}`);
		}
		locks.delete(path);
	}

	// If still too many, remove oldest but check ownership
	if (locks.size > LOCK_MAX_LOCKS) {
		logWarn(
			`Lock registry size (${locks.size}) exceeded ${LOCK_MAX_LOCKS}. Evicting oldest non-own locks.`,
		);

		const sorted = Array.from(locks.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);

		// Keep all locks owned by this process, evict oldest of others first
		const others = sorted.filter(([_path, info]) => info.owner !== lockOwner);
		const overflow = locks.size - LOCK_MAX_LOCKS;
		const toEvictOthers = others.slice(0, Math.max(overflow, 0));

		for (const [path] of toEvictOthers) {
			logDebug(`Evicting lock from other process: ${path}`);
			locks.delete(path);
		}
	}
}
