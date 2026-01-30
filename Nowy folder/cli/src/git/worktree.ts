import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { logDebug } from "../ui/logger.ts";
import { slugify } from "./branch.ts";

/**
 * Generate a unique identifier for branch names
 */
function generateUniqueId(): string {
	return randomUUID();
}

/**
 * Create a worktree for parallel agent execution
 */
export async function createAgentWorktree(
	taskName: string,
	agentNum: number,
	baseBranch: string,
	worktreeBase: string,
	originalDir: string,
): Promise<{ worktreeDir: string; branchName: string }> {
	const uniqueId = generateUniqueId();
	const branchName = `ralphy/agent-${agentNum}-${uniqueId}-${slugify(taskName)}`;
	const worktreeDir = join(worktreeBase, `agent-${agentNum}-${uniqueId}`);

	const git: SimpleGit = simpleGit(originalDir);

	// Prune stale worktrees first
	await git.raw(["worktree", "prune"]);

	// Remove existing worktree dir if any (from previous failed runs)
	if (existsSync(worktreeDir)) {
		rmSync(worktreeDir, { recursive: true, force: true });
		// Prune again after removing directory
		await git.raw(["worktree", "prune"]);
	}

	// Use atomic -B flag to create/reset branch in one operation
	// This eliminates the race condition between delete and create
	await git.raw(["worktree", "add", "-B", branchName, worktreeDir, baseBranch]);

	return { worktreeDir, branchName };
}

/**
 * Cleanup a worktree after agent completes
 */
export async function cleanupAgentWorktree(
	worktreeDir: string,
	_branchName: string,
	originalDir: string,
): Promise<{ leftInPlace: boolean }> {
	// Check for uncommitted changes
	if (existsSync(worktreeDir)) {
		const worktreeGit = simpleGit(worktreeDir);
		const status = await worktreeGit.status();

		// Check all types of changes: staged, modified, new files, deleted, untracked
		const hasChanges =
			status.staged.length > 0 ||
			status.files.length > 0 ||
			status.created.length > 0 ||
			status.deleted.length > 0 ||
			status.not_added.length > 0;

		if (hasChanges) {
			// Leave worktree in place due to uncommitted changes
			return { leftInPlace: true };
		}
	}

	// Remove the worktree
	const git: SimpleGit = simpleGit(originalDir);
	try {
		await git.raw(["worktree", "remove", "-f", worktreeDir]);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logDebug(`Failed to remove worktree ${worktreeDir}: ${errorMsg}`);
	}

	// Don't delete branch - it may have commits we want to keep/PR
	return { leftInPlace: false };
}

/**
 * Check whether git worktrees are usable for this repo.
 * If .git is a file (linked worktree), nested worktrees can fail.
 */
export function canUseWorktrees(workDir: string): boolean {
	const gitPath = join(workDir, ".git");
	if (!existsSync(gitPath)) return false;

	try {
		const stat = lstatSync(gitPath);
		if (stat.isFile() || stat.isSymbolicLink()) {
			return false;
		}
	} catch {
		return false;
	}

	return true;
}

/**
 * Get worktree base directory (creates if needed)
 */
export function getWorktreeBase(workDir: string): string {
	const worktreeBase = join(workDir, ".ralphy-worktrees");
	if (!existsSync(worktreeBase)) {
		mkdirSync(worktreeBase, { recursive: true });
	}
	return worktreeBase;
}

/**
 * List all ralphy worktrees
 */
export async function listWorktrees(workDir: string): Promise<string[]> {
	const git: SimpleGit = simpleGit(workDir);
	const output = await git.raw(["worktree", "list", "--porcelain"]);

	const worktrees: string[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		if (line.startsWith("worktree ") && line.includes(".ralphy-worktrees")) {
			worktrees.push(line.replace("worktree ", ""));
		}
	}

	return worktrees;
}

/**
 * Clean up all ralphy worktrees
 */
export async function cleanupAllWorktrees(workDir: string): Promise<void> {
	const git: SimpleGit = simpleGit(workDir);
	const worktrees = await listWorktrees(workDir);

	for (const worktree of worktrees) {
		try {
			await git.raw(["worktree", "remove", "-f", worktree]);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logDebug(`Failed to remove worktree ${worktree}: ${errorMsg}`);
		}
	}

	// Prune any stale worktrees
	await git.raw(["worktree", "prune"]);
}
