import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { slugify } from "../git/branch.ts";
import { logDebug } from "../ui/logger.ts";

/**
 * Simple mutex to serialize git operations across sandbox agents.
 * Prevents race conditions when multiple agents commit through shared .git.
 */
class GitMutex {
	private queue: Promise<void> = Promise.resolve();

	async acquire<T>(fn: () => Promise<T>): Promise<T> {
		let release: (() => void) | undefined;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const prev = this.queue;
		this.queue = next;
		await prev;
		try {
			return await fn();
		} finally {
			release?.();
		}
	}
}

const gitMutex = new GitMutex();

/**
 * Generate a unique identifier for branch names
 */
function generateUniqueId(): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `${timestamp}-${random}`;
}

/**
 * Result of committing sandbox changes to a branch
 */
export interface SandboxCommitResult {
	success: boolean;
	branchName: string;
	filesCommitted: number;
	error?: string;
}

/**
 * Commit changes from a sandbox to a new branch in the original repo.
 *
 * This:
 * 1. Creates a new branch from the base branch
 * 2. Copies modified files from sandbox to original
 * 3. Stages and commits the changes
 * 4. Returns to the original branch
 */
export async function commitSandboxChanges(
	originalDir: string,
	modifiedFiles: string[],
	sandboxDir: string,
	taskName: string,
	agentNum: number,
	baseBranch: string,
): Promise<SandboxCommitResult> {
	if (modifiedFiles.length === 0) {
		return {
			success: true,
			branchName: "",
			filesCommitted: 0,
		};
	}

	const uniqueId = generateUniqueId();
	const branchName = `ralphy/agent-${agentNum}-${uniqueId}-${slugify(taskName)}`;

	// Serialize git operations to prevent race conditions
	return gitMutex.acquire(async () => {
		const git: SimpleGit = simpleGit(originalDir);

		try {
			// Save current branch
			const currentBranch = (await git.branch()).current;

			// Create and checkout new branch from base
			await git.checkout(["-B", branchName, baseBranch]);

			// Copy modified files from sandbox to original
			for (const relPath of modifiedFiles) {
				const sandboxPath = join(sandboxDir, relPath);
				const originalPath = join(originalDir, relPath);

				if (existsSync(sandboxPath)) {
					const parentDir = dirname(originalPath);
					if (!existsSync(parentDir)) {
						mkdirSync(parentDir, { recursive: true });
					}

					// Read from sandbox and write to original
					const content = readFileSync(sandboxPath);
					writeFileSync(originalPath, content);
				}
			}

			// Stage all modified files
			await git.add(modifiedFiles);

			// Commit
			const commitMessage = `feat: ${taskName}\n\nAutomated commit by Ralphy agent ${agentNum}`;
			await git.commit(commitMessage);

			logDebug(`Agent ${agentNum}: Committed ${modifiedFiles.length} files to ${branchName}`);

			// Return to original branch
			await git.checkout(currentBranch);

			return {
				success: true,
				branchName,
				filesCommitted: modifiedFiles.length,
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			// Try to return to a safe state
			try {
				const git: SimpleGit = simpleGit(originalDir);
				const branches = await git.branch();
				if (branches.current !== baseBranch) {
					await git.checkout(baseBranch);
				}
			} catch {
				// Ignore cleanup errors
			}

			return {
				success: false,
				branchName,
				filesCommitted: 0,
				error: errorMsg,
			};
		}
	});
}

/**
 * Check if there are uncommitted changes in a sandbox.
 * Since sandboxes don't have proper git, we check if any files
 * were modified compared to original.
 */
export async function hasSandboxChanges(
	sandboxDir: string,
	originalDir: string,
	modifiedFiles: string[],
): Promise<boolean> {
	return modifiedFiles.length > 0;
}

/**
 * Initialize git configuration in sandbox (if needed).
 * This is mainly for agents that require git to be present.
 */
export async function initSandboxGit(sandboxDir: string, originalDir: string): Promise<void> {
	// The .git directory should already be symlinked from createSandbox
	// This function is here for any additional git setup needed

	const gitDir = join(sandboxDir, ".git");
	if (!existsSync(gitDir)) {
		// If .git wasn't symlinked, create a minimal git init
		const git: SimpleGit = simpleGit(sandboxDir);
		await git.init();

		// Copy user config from original if available
		const originalGit: SimpleGit = simpleGit(originalDir);
		try {
			const userName = await originalGit.getConfig("user.name");
			const userEmail = await originalGit.getConfig("user.email");

			if (userName.value) {
				await git.addConfig("user.name", userName.value);
			}
			if (userEmail.value) {
				await git.addConfig("user.email", userEmail.value);
			}
		} catch {
			// Ignore config errors
		}
	}
}
