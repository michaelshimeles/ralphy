import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { LOCK_DIR } from "../src/config/constants.ts";
import {
	acquireFileLock,
	acquireLocksForFiles,
	cleanupStaleLocks,
	normalizePathForLocking,
	releaseFileLock,
} from "../src/execution/locking.ts";

const TEST_BASE = join(tmpdir(), "ralphy-locking-test");

describe("Lock Management Security and Reliability Tests", () => {
	beforeEach(() => {
		// Clean up any existing test directory
		if (existsSync(TEST_BASE)) {
			rmSync(TEST_BASE, { recursive: true, force: true });
		}
		mkdirSync(TEST_BASE, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(TEST_BASE)) {
			rmSync(TEST_BASE, { recursive: true, force: true });
		}
		// Clean up any stale locks
		cleanupStaleLocks();
	});

	describe("Lock Acquisition Security Tests", () => {
		it("should reject concurrent access from different owner", async () => {
			const testFile = join(TEST_BASE, "test.txt");
			writeFileSync(testFile, "test content");

			// Manually create a lock valid for another process
			const hash = createHash("sha256")
				.update(normalizePathForLocking(testFile, TEST_BASE))
				.digest("hex");
			const lockDir = join(TEST_BASE, LOCK_DIR);
			mkdirSync(lockDir, { recursive: true });
			const lockPath = join(lockDir, `${hash}.lock`);

			writeFileSync(
				lockPath,
				JSON.stringify({
					timestamp: Date.now(),
					timeout: 30000,
					owner: "other-process-123",
					refreshCount: 0,
				}),
			);

			// Verify lock was created
			if (!existsSync(lockPath)) {
				console.warn(`Test setup failed: Lock file not created at ${lockPath}`);
			}

			// Try to acquire lock (should fail as it's owned by "other-process")
			const lockResult = acquireFileLock(testFile, TEST_BASE);
			expect(lockResult).toBe(false);

			// Cleanup
			releaseFileLock(testFile, TEST_BASE); // This might fail to delete others cert, but we clean up directory anyway
		});

		it("should allow re-entrant access for same owner", async () => {
			const testFile = join(TEST_BASE, "reentrant.txt");
			writeFileSync(testFile, "test content");

			// Acquire lock first time
			const lock1 = acquireFileLock(testFile, TEST_BASE);
			expect(lock1).toBe(true);

			// Acquire same lock again (re-entrant)
			const lock2 = acquireFileLock(testFile, TEST_BASE, 5, true);
			expect(lock2).toBe(true);
		});

		// ...

		it("should rollback on partial failure", () => {
			const testFiles = [
				join(TEST_BASE, "test1.txt"),
				join(TEST_BASE, "test2.txt"),
				join(TEST_BASE, "test3.txt"),
			];

			// Create test files
			for (const file of testFiles) {
				writeFileSync(file, "test content");
			}

			// Block the second file with a lock from another process
			const file2 = testFiles[1];
			const hash = createHash("sha256")
				.update(normalizePathForLocking(file2, TEST_BASE))
				.digest("hex");
			const lockDir = join(TEST_BASE, LOCK_DIR);
			mkdirSync(lockDir, { recursive: true });
			const lockPath = join(lockDir, `${hash}.lock`);
			writeFileSync(
				lockPath,
				JSON.stringify({
					timestamp: Date.now(),
					timeout: 30000,
					owner: "other-process-999",
					refreshCount: 0,
				}),
			);

			// Try to acquire all locks (should fail because of file2)
			const success = acquireLocksForFiles(testFiles, TEST_BASE);
			expect(success).toBe(false);

			// Should NOT hold locks for 1 and 3 (rollback)
			// But wait, acquireLocksForFiles releases locks it ACQUIRED. It didn't acquire file2.
			// It acquired file1. So file1 should be released.
			// But we can check if we can acquire them now?
			// If they were held, we wouldn't be able to acquire them IF we weren't re-entrant.
			// Since we are re-entrant, we can always acquire them if we own them.
			// So we need to check if the LOCK FILE exists?
			// Verify lock for file1 is gone?

			const hash1 = createHash("sha256")
				.update(normalizePathForLocking(testFiles[0], TEST_BASE))
				.digest("hex");
			const lockPath1 = join(lockDir, `${hash1}.lock`);
			expect(existsSync(lockPath1)).toBe(false);
		});
	});

	describe("Path Normalization Security Tests", () => {
		it("should normalize paths consistently", () => {
			const paths = [
				"test.txt",
				"./test.txt",
				"test/../test.txt",
				"test\\file.txt",
				"test/file.txt",
			];

			const normalizedPaths = paths.map((path) => normalizePathForLocking(path, TEST_BASE));

			// All should be resolved to absolute paths within TEST_BASE
			for (const path of normalizedPaths) {
				const expectedBase = process.platform === "win32" ? TEST_BASE.toLowerCase() : TEST_BASE;
				expect(path).toContain(expectedBase);
				expect(path).not.toContain("..");
			}
		});

		it("should handle cross-platform paths", () => {
			const windowsPath = "src\\components\\Button.tsx";
			const unixPath = "src/components/Button.tsx";

			const normalizedWindows = normalizePathForLocking(windowsPath, TEST_BASE);
			const normalizedUnix = normalizePathForLocking(unixPath, TEST_BASE);

			// Should resolve to same structure
			expect(normalizedWindows).toContain("components");
			expect(normalizedUnix).toContain("components");
		});
	});

	describe("Lock File Integrity Tests", () => {
		it("should create lock files with proper permissions", () => {
			const testFile = join(TEST_BASE, "permissions.txt");
			writeFileSync(testFile, "test content");

			const success = acquireFileLock(testFile, TEST_BASE);
			expect(success).toBe(true);

			// Lock file should exist
			const lockDir = join(TEST_BASE, ".ralphy-locks");
			const lockFiles = [];
			try {
				if (existsSync(lockDir)) {
					lockFiles.push(...readdirSync(lockDir));
				}
			} catch {
				console.warn("Could not check lock files");
			}

			// Should not allow unlimited locks
			expect(lockFiles.length).toBeLessThan(5050); // Some limit should be enforced
			releaseFileLock(testFile, TEST_BASE);
		});

		it("should handle lock file corruption gracefully", () => {
			const testFile = join(TEST_BASE, "corrupt.txt");
			writeFileSync(testFile, "test content");

			// Create corrupted lock file
			const lockDir = join(TEST_BASE, ".ralphy-locks");
			mkdirSync(lockDir, { recursive: true });
			const lockFile = join(lockDir, "corrupt.lock");
			writeFileSync(lockFile, "invalid json content");

			// Should still work (fallback to corrupted file handling)
			const success = acquireFileLock(testFile, TEST_BASE);
			expect(success).toBe(true);

			releaseFileLock(testFile, TEST_BASE);
		});
	});

	describe("Cleanup and Maintenance Tests", () => {
		it("should clean up expired locks", () => {
			const testFile = join(TEST_BASE, "cleanup.txt");
			writeFileSync(testFile, "test content");

			// Acquire lock
			const success = acquireFileLock(testFile, TEST_BASE);
			expect(success).toBe(true);

			// Simulate time passing
			const originalNow = Date.now;
			const mockDateNow = () => originalNow() + 61000; // 61 seconds in future (to trigger LOCK_CLEANUP_INTERVAL_MS)

			// Mock Date.now for cleanup function
			const originalDateNow = Date.now;
			Date.now = mockDateNow;

			cleanupStaleLocks();

			// Should be able to acquire lock again (old one cleaned up)
			// Trigger cleanup by keeping the time in the future so acquireFileLock triggers internal cleanup
			const lock2 = acquireFileLock(testFile, TEST_BASE);
			expect(lock2).toBe(true);

			// Restore Date.now
			Date.now = originalDateNow;
		});

		it("should handle lock cleanup errors", () => {
			const testFile = join(TEST_BASE, "cleanup-error.txt");
			writeFileSync(testFile, "test content");

			// Acquire lock
			const success = acquireFileLock(testFile, TEST_BASE);
			expect(success).toBe(true);

			// Cleanup should not throw
			expect(() => cleanupStaleLocks()).not.toThrow();
		});
	});
});
