import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import process from "node:process";
import { LOCK_CLEANUP_INTERVAL_MS, LOCK_DIR, LOCK_MAX_LOCKS, LOCK_TIMEOUT_MS } from "../config/constants.ts";
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

function refreshLock(normalizedPath: string, workDir: string): void {
	const lockInfo = locks.get(normalizedPath);
	if (!lockInfo) return;

	lockInfo.timestamp = Date.now();
	lockInfo.refreshCount++;

	// Update lock file on disk
	const lockFile = getLockFilePath(normalizedPath, workDir);
	try {
		writeFileSync(lockFile, JSON.stringify(lockInfo));
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
	if (!existsSync(lockDir)) {
		mkdirSync(lockDir, { recursive: true });
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
				unlinkSync(filePath);
			}
		} catch {
			unlinkSync(filePath);
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

export function acquireFileLock(filePath: string, workDir: string, maxRetries = 5, allowReentrant = false): boolean {
	const normalizedPath = normalizePathForLocking(filePath, workDir);

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const now = Date.now();

		ensureLockDir(workDir);
		const lockState = getGlobalLockState();
		const lastCleanupTime = lockState._lastLockCleanup || 0;

		if (now - lastCleanupTime > LOCK_CLEANUP_INTERVAL_MS) {
			cleanupStaleLocks();
			cleanupStaleLockFiles(workDir);
			lockState._lastLockCleanup = now;
		}

		const lockFile = getLockFilePath(normalizedPath, workDir);

		// Check in-memory lock with ownership verification
		const existing = locks.get(normalizedPath);
		if (existing && now - existing.timestamp < existing.timeout) {
			// Check if we own this lock (re-entrant)
			if (existing.owner === lockOwner && allowReentrant) {
				// Refresh our own lock
				refreshLock(normalizedPath, workDir);
				return true;
			}
			return false; // Someone else owns it, or we own it but re-entrancy not allowed
		}

		// Atomic lock acquisition using writeFileSync with exclusive flag
		// This is more atomic than openSync + writeFileSync pattern
		try {
			const lockInfo = {
				timestamp: now,
				timeout: LOCK_TIMEOUT_MS,
				owner: lockOwner,
				refreshCount: 0,
			};

			// Use writeFileSync with 'wx' flag for atomic creation
			// This fails if file already exists, preventing race conditions
			writeFileSync(lockFile, JSON.stringify(lockInfo), { flag: "wx" });
			locks.set(normalizedPath, lockInfo);

			return true;
		} catch (_error) {
			// Check if lock is stale
			if (existsSync(lockFile)) {
				try {
					const content = readFileSync(lockFile, "utf8");
					// Validate JSON structure before parsing
					if (!content || content.trim().length === 0) {
						logDebug(`Lock file ${lockFile} is empty, removing`);
						unlinkSync(lockFile);
						continue;
					}

					let lockInfo: unknown;
					try {
						lockInfo = JSON.parse(content);
					} catch (parseError) {
						logDebug(`Failed to parse lock file ${lockFile}: ${parseError}`);
						unlinkSync(lockFile);
						continue;
					}

					// Validate lock info structure with type guards
					if (
						lockInfo &&
						typeof lockInfo === "object" &&
						"timestamp" in lockInfo &&
						typeof lockInfo.timestamp === "number" &&
						"timeout" in lockInfo &&
						typeof lockInfo.timeout === "number" &&
						now - lockInfo.timestamp >= lockInfo.timeout
					) {
						// Lock is stale
						logDebug(`Removing stale lock file ${lockFile}`);
						unlinkSync(lockFile);
						// Continue to next attempt
						continue;
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

				logDebug(`Lock acquisition attempt ${attempt}/${maxRetries} failed, retrying in ${Math.round(delay)}ms`);
				// Use sync sleep that doesn't pin CPU
				// execSync("sleep 0.x") is portable and yields CPU unlike busy-wait
				try {
					const { execSync } = require("child_process");
					// Use ping for sub-second precision on Windows, sleep on Unix
					if (process.platform === "win32") {
						execSync(`ping -n ${Math.ceil(delay / 1000) || 1} 127.0.0.1 >nul`);
					} else {
						execSync(`sleep ${delay / 1000}`);
					}
				} catch {
					// Last resort: minimal busy-wait to avoid CPU pinning
					const start = Date.now();
					while (Date.now() - start < delay) {
						// Just check time, no nested loops
					}
				}
			}
		}
	}
	logDebug(`Failed to acquire lock after ${maxRetries} attempts: ${normalizedPath}`);
	return false;
}

export function releaseFileLock(filePath: string, workDir: string): void {
	const normalizedPath = normalizePathForLocking(filePath, workDir);
	locks.delete(normalizedPath);

	// Remove persistent lock file
	const lockFile = getLockFilePath(normalizedPath, workDir);
	if (existsSync(lockFile)) {
		try {
			unlinkSync(lockFile);
		} catch {
			// Ignore if delete fails
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
		logWarn(`Lock registry size (${locks.size}) exceeded ${LOCK_MAX_LOCKS}. Evicting oldest non-own locks.`);

		const sorted = Array.from(locks.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);

		// Keep all locks owned by this process, evict oldest of others
		const toKeep = sorted.filter(([_path, info]) => info.owner === lockOwner);
		const others = sorted.filter(([_path, info]) => info.owner !== lockOwner);
		const toEvictOthers = others.slice(0, Math.floor(LOCK_MAX_LOCKS / 2));

		for (const [path] of toEvictOthers) {
			logDebug(`Evicting lock from other process: ${path}`);
			locks.delete(path);
		}

		// Recreate with kept locks
		locks.clear();
		for (const [path, info] of toKeep) {
			locks.set(path, info);
		}
	}
}
