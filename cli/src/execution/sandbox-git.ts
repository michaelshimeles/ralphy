import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { slugify } from "../git/branch.ts";
import { logDebug, logWarn } from "../ui/logger.ts";
import { standardizeError } from "../utils/errors.ts";
import { validatePath } from "./sandbox.ts";

/**
 * Simple mutex to serialize git operations and file writes across sandbox agents.
 * Prevents race conditions when multiple agents commit through shared .git.
 */
class GitMutex {
	private queue: Array<() => Promise<void>> = [];
	private active = false;
	private readonly GIT_MUTEX_MAX_QUEUE_SIZE = 1000;

	async acquire<T>(fn: () => Promise<T>): Promise<T> {
		// Check queue size limit
		if (this.queue.length >= this.GIT_MUTEX_MAX_QUEUE_SIZE) {
			const error = new Error(
				`Git mutex queue full (${this.queue.length}/${this.GIT_MUTEX_MAX_QUEUE_SIZE})`,
			);
			logWarn(error.message);
			throw error;
		}

		return new Promise((resolve, reject) => {
			const operation = async () => {
				try {
					const result = await fn();
					resolve(result);
				} catch (err) {
					reject(err);
				} finally {
					this.processNext();
				}
			};

			this.queue.push(operation);
			this.processNext();
		});
	}

	private processNext(): void {
		if (this.active || this.queue.length === 0) {
			return;
		}

		this.active = true;
		const nextOp = this.queue.shift();

		if (nextOp) {
			nextOp()
				.catch((err) => {
					logDebug(`Git operation failed: ${err}`);
				})
				.finally(() => {
					this.active = false;
					this.processNext();
				});
		} else {
			// Queue might have more items now, check and process
			this.active = false;
			this.processNext();
		}
	}
}

const gitMutex = new GitMutex();

/**
 * Generate a unique identifier for branch names
 */
function generateUniqueId(): string {
	return randomUUID();
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
		const copiedFiles: string[] = [];

		try {
			// Save current branch
			const currentBranch = (await git.branch()).current;

			// Create and checkout new branch from base
			await git.checkout(["-B", branchName, baseBranch]);

			// Copy modified files from sandbox to original (protected by mutex)
			for (const relPath of modifiedFiles) {
				// Validate paths before copying
				const sandboxPath = validatePath(sandboxDir, relPath);
				const originalPath = validatePath(originalDir, relPath);

				if (!sandboxPath || !originalPath) {
					logDebug(`Security: Invalid path rejected: ${relPath}`);
					continue;
				}

				// Additional validation: ensure file is within sandbox
				const resolvedSandboxPath = resolve(sandboxPath);
				const resolvedSandboxBase = resolve(sandboxDir);
				const resolvedRelative = relative(resolvedSandboxBase, resolvedSandboxPath);

				if (resolvedRelative.startsWith("..") || resolvedRelative.startsWith(`${sep}..`)) {
					logDebug(`Security: File outside sandbox: ${relPath}`);
					continue;
				}

				if (existsSync(sandboxPath)) {
					const parentDir = dirname(originalPath);
					if (!existsSync(parentDir)) {
						mkdirSync(parentDir, { recursive: true });
					}

					// Read from sandbox and write to original
					const content = readFileSync(sandboxPath);
					writeFileSync(originalPath, content);
					copiedFiles.push(relPath);
					logDebug(`Copied back validated file: ${relPath}`);
				}
			}

			if (copiedFiles.length === 0) {
				logWarn(`Agent ${agentNum}: No valid files copied from sandbox for commit`);
				await git.checkout(currentBranch);
				return {
					success: false,
					branchName,
					filesCommitted: 0,
					error: "No valid sandbox files to commit",
				};
			}

			// Stage all modified files
			await git.add(copiedFiles);

			// Commit
			const commitMessage = `feat: ${taskName}\n\nAutomated commit by Ralphy agent ${agentNum}`;
			await git.commit(commitMessage);

			logDebug(`Agent ${agentNum}: Committed ${copiedFiles.length} files to ${branchName}`);

			// Return to original branch
			await git.checkout(currentBranch);

			return {
				success: true,
				branchName,
				filesCommitted: copiedFiles.length,
			};
		} catch (error) {
			const errorMsg = standardizeError(error).message;

			// Try to return to a safe state
			try {
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
 */
export async function hasSandboxChanges(
	_sandboxDir: string,
	_originalDir: string,
	modifiedFiles: string[],
): Promise<boolean> {
	return modifiedFiles.length > 0;
}

/**
 * Initialize git configuration in sandbox.
 */
export async function initSandboxGit(sandboxDir: string, originalDir: string): Promise<void> {
	const gitDir = join(sandboxDir, ".git");
	if (!existsSync(gitDir)) {
		const git: SimpleGit = simpleGit(sandboxDir);
		await git.init();

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
