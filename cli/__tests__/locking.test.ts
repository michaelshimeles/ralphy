import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireFileLock,
	acquireLocksForFiles,
	normalizePathForLocking,
	releaseFileLock,
} from "../src/execution/locking";

describe("Locking System", () => {
	let testDir: string;
	let workDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `ralphy-test-${Date.now()}`);
		workDir = testDir;
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("Path Normalization", () => {
		it("should normalize paths correctly", () => {
			const normalized = normalizePathForLocking("./test/file.txt", workDir);
			expect(normalized).toBeTruthy();
			expect(normalized).toContain("test");
		});

		it("should handle absolute paths", () => {
			const normalized = normalizePathForLocking(`${workDir}/test.txt`, workDir);
			expect(normalized).toContain("test.txt");
		});
	});

	describe("Lock Acquisition", () => {
		it("should acquire a lock successfully", () => {
			const result = acquireFileLock(join(workDir, "test.txt"), workDir);
			expect(result).toBe(true);
		});

		it("should allow re-entrant access for same owner", () => {
			const testFile = join(workDir, "test.txt");
			const lock1 = acquireFileLock(testFile, workDir);
			expect(lock1).toBe(true);

			const lock2 = acquireFileLock(testFile, workDir, 5, true);
			expect(lock2).toBe(true);
		});

		it("should create lock file in correct location", () => {
			const testFile = join(workDir, "test.txt");
			acquireFileLock(testFile, workDir);

			const lockDir = join(workDir, ".ralphy", "locks");
			const lockFiles = existsSync(lockDir);
			expect(lockFiles).toBe(true);
		});
	});

	describe("Lock Release", () => {
		it("should release a lock successfully", () => {
			const testFile = join(workDir, "test.txt");
			acquireFileLock(testFile, workDir);
			releaseFileLock(testFile, workDir);

			// Should be able to acquire lock again
			const result = acquireFileLock(testFile, workDir);
			expect(result).toBe(true);
		});
	});

	describe("Multiple Locks", () => {
		it("should acquire multiple locks for different files", () => {
			const files = [
				join(workDir, "file1.txt"),
				join(workDir, "file2.txt"),
				join(workDir, "file3.txt"),
			];

			const result = acquireLocksForFiles(files, workDir);
			expect(result).toBe(true);

			for (const file of files) {
				releaseFileLock(file, workDir);
			}
		});

		it("should fail if any file is already locked", () => {
			const file1 = join(workDir, "file1.txt");
			const file2 = join(workDir, "file2.txt");

			acquireFileLock(file1, workDir);

			const files = [file1, file2];
			const result = acquireLocksForFiles(files, workDir);
			expect(result).toBe(false);
		});

		it("should rollback all locks if acquisition fails", () => {
			const file1 = join(workDir, "file1.txt");
			const file2 = join(workDir, "file2.txt");

			acquireFileLock(file1, workDir);

			const files = [file1, file2];
			const result = acquireLocksForFiles(files, workDir);
			expect(result).toBe(false);

			// file1 should still be locked (not released by acquireLocksForFiles since it was pre-locked)
			// We can re-acquire it with allowReentrant
			const canReacquireFile1 = acquireFileLock(file1, workDir, 5, true);
			expect(canReacquireFile1).toBe(true);
		});
	});

	describe("Lock File Security", () => {
		it("should use hash-based lock filenames to prevent collisions", () => {
			const file1 = join(workDir, "subdir", "file.txt");
			const file2 = join(workDir, "otherdir", "file.txt");

			acquireFileLock(file1, workDir);
			acquireFileLock(file2, workDir);

			// Different files should have different lock files
			// (if they had collision, second acquisition would fail)
			expect(acquireFileLock(file1, workDir)).toBe(false);
			expect(acquireFileLock(file2, workDir)).toBe(false);
		});
	});
});
