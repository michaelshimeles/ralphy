import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { commitSandboxChanges } from "./sandbox-git.ts";

const TEST_BASE = join(tmpdir(), "ralphy-sandbox-git-test");

async function makeGitRepo(): Promise<string> {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = join(TEST_BASE, id);
	mkdirSync(dir, { recursive: true });

	const git = simpleGit(dir);
	await git.init();
	await git.addConfig("user.name", "Test");
	await git.addConfig("user.email", "test@test.com");

	// Create initial commit so we have a branch
	writeFileSync(join(dir, "README.md"), "# Test");
	await git.add("README.md");
	await git.commit("initial commit");

	return dir;
}

describe("commitSandboxChanges", () => {
	let originalDir: string;
	let sandboxDir: string;

	beforeEach(async () => {
		rmSync(TEST_BASE, { recursive: true, force: true });
		originalDir = await makeGitRepo();
		sandboxDir = join(TEST_BASE, "sandbox");
		mkdirSync(sandboxDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("should return success with empty branch when no files provided", async () => {
		const result = await commitSandboxChanges(originalDir, [], sandboxDir, "empty task", 1, "main");

		expect(result.success).toBe(true);
		expect(result.branchName).toBe("");
		expect(result.filesCommitted).toBe(0);
	});

	it("should commit valid source files to a new branch", async () => {
		// Create a file in sandbox that will be copied to original
		writeFileSync(join(sandboxDir, "feature.ts"), "export const feature = true;");

		const git = simpleGit(originalDir);
		const baseBranch = (await git.branch()).current;

		const result = await commitSandboxChanges(
			originalDir,
			["feature.ts"],
			sandboxDir,
			"add feature",
			1,
			baseBranch,
		);

		expect(result.success).toBe(true);
		expect(result.branchName).toContain("ralphy/agent-1-");
		expect(result.branchName).toContain("add-feature");
		expect(result.filesCommitted).toBe(1);

		// Should return to the original branch
		const currentBranch = (await git.branch()).current;
		expect(currentBranch).toBe(baseBranch);
	});

	it("should filter out gitignored files and still commit valid ones", async () => {
		// Add a .gitignore to the repo
		writeFileSync(join(originalDir, ".gitignore"), ".DS_Store\n*.log\n");
		const git = simpleGit(originalDir);
		await git.add(".gitignore");
		await git.commit("add gitignore");

		const baseBranch = (await git.branch()).current;

		// Create files in sandbox -- one valid, two gitignored
		writeFileSync(join(sandboxDir, "feature.ts"), "export const f = 1;");
		writeFileSync(join(sandboxDir, ".DS_Store"), "binary junk");
		writeFileSync(join(sandboxDir, "debug.log"), "log output");

		const result = await commitSandboxChanges(
			originalDir,
			["feature.ts", ".DS_Store", "debug.log"],
			sandboxDir,
			"feature with ignored files",
			2,
			baseBranch,
		);

		expect(result.success).toBe(true);

		// Verify the commit only has the valid file
		await git.checkout(result.branchName);
		const diff = await git.diff(["--name-only", "HEAD~1", "HEAD"]);
		const committedFiles = diff.trim().split("\n").filter(Boolean);

		expect(committedFiles).toContain("feature.ts");
		expect(committedFiles).not.toContain(".DS_Store");
		expect(committedFiles).not.toContain("debug.log");

		await git.checkout(baseBranch);
	});

	it("should succeed with no commit when ALL files are gitignored", async () => {
		// Add a .gitignore to the repo
		writeFileSync(join(originalDir, ".gitignore"), ".DS_Store\nnode_modules/\n");
		const git = simpleGit(originalDir);
		await git.add(".gitignore");
		await git.commit("add gitignore");

		const baseBranch = (await git.branch()).current;

		// Only gitignored files
		writeFileSync(join(sandboxDir, ".DS_Store"), "binary junk");

		const result = await commitSandboxChanges(
			originalDir,
			[".DS_Store"],
			sandboxDir,
			"only ignored files",
			3,
			baseBranch,
		);

		expect(result.success).toBe(true);
		expect(result.branchName).toBe("");
		expect(result.filesCommitted).toBe(0);

		// Should still be on the original branch
		const currentBranch = (await git.branch()).current;
		expect(currentBranch).toBe(baseBranch);
	});

	it("should commit files in nested directories", async () => {
		const nestedDir = join(sandboxDir, "src", "utils");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(join(nestedDir, "helper.ts"), "export const h = 1;");

		const git = simpleGit(originalDir);
		const baseBranch = (await git.branch()).current;

		const result = await commitSandboxChanges(
			originalDir,
			[join("src", "utils", "helper.ts")],
			sandboxDir,
			"add helper",
			4,
			baseBranch,
		);

		expect(result.success).toBe(true);
		expect(result.filesCommitted).toBe(1);
	});

	it("should create branch name with agent number and slugified task name", async () => {
		writeFileSync(join(sandboxDir, "file.ts"), "export {};");

		const git = simpleGit(originalDir);
		const baseBranch = (await git.branch()).current;

		const result = await commitSandboxChanges(
			originalDir,
			["file.ts"],
			sandboxDir,
			"Implement POST /workloads/start with idempotent deployment",
			7,
			baseBranch,
		);

		expect(result.success).toBe(true);
		expect(result.branchName).toMatch(/^ralphy\/agent-7-\d+-[a-z0-9]+-implement-post-/);
	});

	it("should return to original branch after committing", async () => {
		writeFileSync(join(sandboxDir, "file.ts"), "export {};");

		const git = simpleGit(originalDir);
		const baseBranch = (await git.branch()).current;

		await commitSandboxChanges(originalDir, ["file.ts"], sandboxDir, "task", 1, baseBranch);

		const currentBranch = (await git.branch()).current;
		expect(currentBranch).toBe(baseBranch);
	});

	it("should return to base branch on error", async () => {
		// Provide a file that does not exist in sandbox -- writeFileSync skipped
		// so copying will silently skip, but staging a non-existent file may fail
		const git = simpleGit(originalDir);
		const baseBranch = (await git.branch()).current;

		await commitSandboxChanges(
			originalDir,
			["nonexistent-file.ts"],
			sandboxDir,
			"broken task",
			99,
			baseBranch,
		);

		// The file copy is skipped (existsSync check), then git.add on a file that
		// doesn't exist in the work tree may either error or succeed with nothing.
		// Either way, we should end up on the base branch.
		const currentBranch = (await git.branch()).current;
		expect(currentBranch).toBe(baseBranch);
	});
});
