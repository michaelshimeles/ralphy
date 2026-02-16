import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSandbox,
	getModifiedFiles,
	verifySandboxIsolation,
} from "./sandbox.ts";

const TEST_BASE = join(tmpdir(), "ralphy-sandbox-test");

function makeTestDir(): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = join(TEST_BASE, id);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("getModifiedFiles", () => {
	let originalDir: string;
	let sandboxDir: string;

	beforeEach(() => {
		originalDir = makeTestDir();
		sandboxDir = makeTestDir();
	});

	afterEach(() => {
		rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("should detect a new file in the sandbox", async () => {
		writeFileSync(join(sandboxDir, "new-file.ts"), "export const x = 1;");

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).toContain("new-file.ts");
	});

	it("should detect a modified file by size change", async () => {
		const original = "export const x = 1;";
		const changed = "export const x = 42; // updated";

		writeFileSync(join(originalDir, "file.ts"), original);
		writeFileSync(join(sandboxDir, "file.ts"), changed);

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).toContain("file.ts");
	});

	it("should detect a modified file by mtime change", async () => {
		const content = "export const x = 1;";
		writeFileSync(join(originalDir, "file.ts"), content);
		writeFileSync(join(sandboxDir, "file.ts"), content);

		// Force different mtime
		const past = new Date(2000, 0, 1);
		utimesSync(join(originalDir, "file.ts"), past, past);

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).toContain("file.ts");
	});

	it("should not report unchanged files", async () => {
		const content = "export const x = 1;";
		writeFileSync(join(originalDir, "file.ts"), content);
		writeFileSync(join(sandboxDir, "file.ts"), content);

		// Match timestamps
		const ts = new Date(2024, 0, 1);
		utimesSync(join(originalDir, "file.ts"), ts, ts);
		utimesSync(join(sandboxDir, "file.ts"), ts, ts);

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).not.toContain("file.ts");
	});

	it("should detect new files in nested directories", async () => {
		const nestedDir = join(sandboxDir, "src", "utils");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(join(nestedDir, "helper.ts"), "export const h = 1;");

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).toContain(join("src", "utils", "helper.ts"));
	});

	describe("skips gitignored entries", () => {
		it("should skip .DS_Store at the root", async () => {
			writeFileSync(join(sandboxDir, ".DS_Store"), "binary junk");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			expect(modified).not.toContain(".DS_Store");
		});

		it("should skip .DS_Store in nested directories", async () => {
			const nested = join(sandboxDir, "packages", "foo");
			mkdirSync(nested, { recursive: true });
			writeFileSync(join(nested, ".DS_Store"), "binary junk");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			const hasDSStore = modified.some((f) => f.includes(".DS_Store"));
			expect(hasDSStore).toBe(false);
		});

		it("should skip Thumbs.db", async () => {
			writeFileSync(join(sandboxDir, "Thumbs.db"), "binary junk");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			expect(modified).not.toContain("Thumbs.db");
		});

		it("should skip nested node_modules directories", async () => {
			const nestedNM = join(sandboxDir, "packages", "gateway", "node_modules", "lodash");
			mkdirSync(nestedNM, { recursive: true });
			writeFileSync(join(nestedNM, "index.js"), "module.exports = {};");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			const hasNodeModules = modified.some((f) => f.includes("node_modules"));
			expect(hasNodeModules).toBe(false);
		});

		it("should skip dist directories at any depth", async () => {
			const nestedDist = join(sandboxDir, "packages", "lib", "dist");
			mkdirSync(nestedDist, { recursive: true });
			writeFileSync(join(nestedDist, "index.js"), "built output");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			const hasDist = modified.some((f) => f.includes("dist"));
			expect(hasDist).toBe(false);
		});

		it("should skip .tsbuildinfo files", async () => {
			writeFileSync(join(sandboxDir, "tsconfig.tsbuildinfo"), "{}");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			const hasTsBuildInfo = modified.some((f) => f.includes(".tsbuildinfo"));
			expect(hasTsBuildInfo).toBe(false);
		});

		it("should skip __pycache__ directories", async () => {
			const pycache = join(sandboxDir, "src", "__pycache__");
			mkdirSync(pycache, { recursive: true });
			writeFileSync(join(pycache, "mod.cpython-312.pyc"), "bytecode");

			const modified = await getModifiedFiles(sandboxDir, originalDir);

			const hasPycache = modified.some((f) => f.includes("__pycache__"));
			expect(hasPycache).toBe(false);
		});
	});

	it("should skip symlinked directories", async () => {
		// Create a real directory in original and symlink it in sandbox
		const realDir = join(originalDir, "node_modules");
		mkdirSync(realDir, { recursive: true });
		writeFileSync(join(realDir, "pkg.json"), "{}");
		symlinkSync(realDir, join(sandboxDir, "node_modules"), "junction");

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		const hasNodeModules = modified.some((f) => f.includes("node_modules"));
		expect(hasNodeModules).toBe(false);
	});

	it("should still detect legitimate source changes alongside ignored files", async () => {
		// Legitimate change
		writeFileSync(join(sandboxDir, "app.ts"), "console.log('hello');");

		// Ignored entries
		writeFileSync(join(sandboxDir, ".DS_Store"), "junk");
		writeFileSync(join(sandboxDir, "tsconfig.tsbuildinfo"), "{}");

		const modified = await getModifiedFiles(sandboxDir, originalDir);

		expect(modified).toContain("app.ts");
		expect(modified).not.toContain(".DS_Store");
		expect(modified).not.toContain("tsconfig.tsbuildinfo");
		expect(modified).toHaveLength(1);
	});
});

describe("createSandbox", () => {
	let originalDir: string;
	let sandboxDir: string;

	beforeEach(() => {
		originalDir = makeTestDir();
		sandboxDir = join(TEST_BASE, `sandbox-${Date.now()}`);
	});

	afterEach(() => {
		rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("should create sandbox directory", async () => {
		writeFileSync(join(originalDir, "index.ts"), "export {};");

		const result = await createSandbox({
			originalDir,
			sandboxDir,
			agentNum: 1,
		});

		expect(result.sandboxDir).toBe(sandboxDir);
		expect(existsSync(sandboxDir)).toBe(true);
	});

	it("should copy source files into sandbox", async () => {
		writeFileSync(join(originalDir, "index.ts"), "export const x = 1;");
		writeFileSync(join(originalDir, "README.md"), "# Hello");

		await createSandbox({
			originalDir,
			sandboxDir,
			agentNum: 1,
		});

		expect(existsSync(join(sandboxDir, "index.ts"))).toBe(true);
		expect(existsSync(join(sandboxDir, "README.md"))).toBe(true);
	});

	it("should copy nested directories recursively", async () => {
		mkdirSync(join(originalDir, "src", "utils"), { recursive: true });
		writeFileSync(join(originalDir, "src", "utils", "helper.ts"), "export {};");

		await createSandbox({
			originalDir,
			sandboxDir,
			agentNum: 1,
		});

		expect(existsSync(join(sandboxDir, "src", "utils", "helper.ts"))).toBe(true);
	});

	it("should symlink specified directories instead of copying", async () => {
		const nmDir = join(originalDir, "test_deps");
		mkdirSync(nmDir, { recursive: true });
		writeFileSync(join(nmDir, "package.json"), "{}");

		await createSandbox({
			originalDir,
			sandboxDir,
			agentNum: 1,
			symlinkDirs: ["test_deps"],
		});

		const { lstatSync } = await import("node:fs");
		const stat = lstatSync(join(sandboxDir, "test_deps"));
		expect(stat.isSymbolicLink()).toBe(true);
	});

	it("should return correct counts", async () => {
		writeFileSync(join(originalDir, "file1.ts"), "a");
		writeFileSync(join(originalDir, "file2.ts"), "b");

		const result = await createSandbox({
			originalDir,
			sandboxDir,
			agentNum: 1,
			symlinkDirs: [],
		});

		expect(result.filesCopied).toBe(2);
		expect(result.symlinksCreated).toBe(0);
	});
});

describe("verifySandboxIsolation", () => {
	let sandboxDir: string;
	let originalDir: string;

	beforeEach(() => {
		originalDir = makeTestDir();
		sandboxDir = makeTestDir();
	});

	afterEach(() => {
		rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("should return true when specified dirs are symlinked", () => {
		const realDir = join(originalDir, "deps");
		mkdirSync(realDir, { recursive: true });
		symlinkSync(realDir, join(sandboxDir, "deps"), "junction");

		const result = verifySandboxIsolation(sandboxDir, ["deps"]);

		expect(result).toBe(true);
	});

	it("should return true when symlink dirs do not exist in sandbox", () => {
		const result = verifySandboxIsolation(sandboxDir, ["nonexistent"]);

		expect(result).toBe(true);
	});
});
