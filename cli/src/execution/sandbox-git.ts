import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { slugify } from "../git/branch.ts";
import { logDebug } from "../ui/logger.ts";
import { DEFAULT_IGNORED, matchesPattern } from "./sandbox.ts";

/**
 * Simple mutex to serialize git operations across sandbox agents.
 * Prevents race conditions when multiple agents commit through shared .git.
 */
class GitMutex {
	private queue: Promise<void> = Promise.resolve();

	async acquire<T>(fn: () => Promise<T>): Promise<T> {
		let release: () => void;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const prev = this.queue;
		this.queue = next;
		await prev;
		try {
			return await fn();
		} finally {
			release!();
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

/** Safe git add: batches files (avoids ENAMETOOLONG) and filters ignored files */
async function safeGitAdd(git: SimpleGit, files: string[], batchSize = 20): Promise<number> {
	if (!files?.length) return 0;

	// Filter out ignored files first
	const ignoredSet = new Set<string>();
	for (let i = 0; i < files.length; i += batchSize) {
		try {
			const result = await git.checkIgnore(files.slice(i, i + batchSize));
			result.forEach((f) => ignoredSet.add(f.replace(/\\/g, "/")));
		} catch { /* check-ignore exits 1 if nothing ignored */ }
	}
	const filtered = ignoredSet.size > 0
		? files.filter((f) => !ignoredSet.has(f.replace(/\\/g, "/")))
		: files;

	if (!filtered.length) return 0;

	// Add in batches with retry for lock contention
	for (let i = 0; i < filtered.length; i += batchSize) {
		const batch = filtered.slice(i, i + batchSize);
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				await git.add(batch);
				break;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if ((msg.includes("index.lock") || msg.includes("lock file")) && attempt < 3) {
					await new Promise((r) => setTimeout(r, attempt * 500));
					continue;
				}
				throw err;
			}
		}
	}
	return filtered.length;
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
	// Note: We don't return early even if modifiedFiles is empty,
	// because composer/npm may have installed files in symlinked directories
	// that we need to detect via git status in Phase 2.

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

			// TWO-PHASE STAGING APPROACH:
			// Phase 1: Stage the explicitly filtered files passed from parallel.ts
			// These are source files the agent intentionally modified
			if (modifiedFiles.length > 0) {
				const filesToStage = modifiedFiles.filter((f) => {
					const fullPath = join(originalDir, f);
					return existsSync(fullPath);
				});
				const staged = await safeGitAdd(git, filesToStage);
				if (staged > 0) {
					logDebug(`Agent ${agentNum}: Staged ${staged} filtered files`);
				}
			}

			// Phase 2: Find additional untracked/modified files via git status
			// This catches files installed by composer/npm in symlinked directories
			// that aren't detected by the sandbox file comparison
			const status = await git.status();
			const additionalFiles: string[] = [];

			// Collect untracked and modified files, excluding infrastructure
			// Uses same logic as parallel.ts for consistency
			for (const file of [...status.not_added, ...status.modified, ...status.created]) {
				const normalized = file.replace(/\\/g, "/");
				let isInfra = false;

				for (const pattern of DEFAULT_IGNORED) {
					if (pattern.endsWith("/")) {
						const dir = pattern.slice(0, -1);
						if (normalized === dir || normalized.startsWith(dir + "/")) {
							isInfra = true;
							break;
						}
					} else {
						const baseName = normalized.split("/").pop() || "";
						if (matchesPattern(baseName, pattern, false)) {
							isInfra = true;
							break;
						}
					}
				}

				// Exclude files already staged in Phase 1?
				// NO: We purposefully check EVERYTHING in Phase 2 as a safety net.
				// If Phase 1 failed to stage a file (e.g. path issues), Phase 2 MUST catch it.
				// Git handles duplicate 'add' operations gracefully (idempotent).
				if (!isInfra) {
					additionalFiles.push(file);
				}
			}

			if (additionalFiles.length > 0) {
				const staged = await safeGitAdd(git, additionalFiles);
				if (staged > 0) {
					logDebug(`Agent ${agentNum}: Staged ${staged} additional files (composer/npm installs)`);
				}
			}

			// Check if we have anything to commit
			const finalStatus = await git.status();
			if (finalStatus.staged.length === 0) {
				logDebug(`Agent ${agentNum}: No changes to commit after staging`);
				await git.checkout(currentBranch);
				return {
					success: true,
					branchName,
					filesCommitted: 0,
				};
			}

			// Commit
			const commitMessage = `feat: ${taskName}\n\nAutomated commit by Ralphy agent ${agentNum}`;
			await git.commit(commitMessage);

			logDebug(`Agent ${agentNum}: Committed ${finalStatus.staged.length} files to ${branchName}`);

			// Return to original branch
			await git.checkout(currentBranch);

			return {
				success: true,
				branchName,
				filesCommitted: finalStatus.staged.length,
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
