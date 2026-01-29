import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import { PROGRESS_FILE, RALPHY_DIR } from "../config/loader.ts";
import { logTaskProgress } from "../config/writer.ts";
import type { AIEngine, AIResult } from "../engines/types.ts";
import { getCurrentBranch, returnToBaseBranch } from "../git/branch.ts";
import { syncPrdToIssue } from "../git/issue-sync.ts";
import {
	abortMerge,
	analyzePreMerge,
	deleteLocalBranch,
	mergeAgentBranch,
	sortByConflictLikelihood,
} from "../git/merge.ts";
import {
	canUseWorktrees,
	cleanupAgentWorktree,
	createAgentWorktree,
	getWorktreeBase,
} from "../git/worktree.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { formatDuration, logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { resolveConflictsWithAI } from "./conflict-resolution.ts";
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import { buildParallelPrompt } from "./prompt.ts";
import { isRetryableError, withRetry } from "./retry.ts";
import { commitSandboxChanges } from "./sandbox-git.ts";
import { cleanupSandbox, createSandbox, getModifiedFiles, getSandboxBase } from "./sandbox.ts";
import type { ExecutionOptions, ExecutionResult } from "./sequential.ts";

interface ParallelAgentResult {
	task: Task;
	agentNum: number;
	worktreeDir: string;
	branchName: string;
	result: AIResult | null;
	error?: string;
	/** Whether this agent used sandbox mode */
	usedSandbox?: boolean;
}

/**
 * Run a single agent in a worktree
 */
async function runAgentInWorktree(
	engine: AIEngine,
	task: Task,
	agentNum: number,
	baseBranch: string,
	worktreeBase: string,
	originalDir: string,
	prdSource: string,
	prdFile: string,
	prdIsFolder: boolean,
	maxRetries: number,
	retryDelay: number,
	skipTests: boolean,
	skipLint: boolean,
	browserEnabled: "auto" | "true" | "false",
	modelOverride?: string,
	engineArgs?: string[],
): Promise<ParallelAgentResult> {
	let worktreeDir = "";
	let branchName = "";

	try {
		// Create worktree
		const worktree = await createAgentWorktree(
			task.title,
			agentNum,
			baseBranch,
			worktreeBase,
			originalDir,
		);
		worktreeDir = worktree.worktreeDir;
		branchName = worktree.branchName;

		logDebug(`Agent ${agentNum}: Created worktree at ${worktreeDir}`);

		// Copy PRD file or folder to worktree
		if (prdSource === "markdown" || prdSource === "yaml" || prdSource === "json") {
			const srcPath = join(originalDir, prdFile);
			const destPath = join(worktreeDir, prdFile);
			if (existsSync(srcPath)) {
				copyFileSync(srcPath, destPath);
			}
		} else if (prdSource === "markdown-folder" && prdIsFolder) {
			const srcPath = join(originalDir, prdFile);
			const destPath = join(worktreeDir, prdFile);
			if (existsSync(srcPath)) {
				cpSync(srcPath, destPath, { recursive: true });
			}
		}

		// Ensure .ralphy/ exists in worktree
		const ralphyDir = join(worktreeDir, RALPHY_DIR);
		if (!existsSync(ralphyDir)) {
			mkdirSync(ralphyDir, { recursive: true });
		}

		// Build prompt
		const prompt = buildParallelPrompt({
			task: task.title,
			progressFile: PROGRESS_FILE,
			prdFile,
			skipTests,
			skipLint,
			browserEnabled,
		});

		// Execute with retry
		const engineOptions = {
			...(modelOverride && { modelOverride }),
			...(engineArgs && engineArgs.length > 0 && { engineArgs }),
		};
		const result = await withRetry(
			async () => {
				const res = await engine.execute(prompt, worktreeDir, engineOptions);
				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}
				return res;
			},
			{ maxRetries, retryDelay },
		);

		return { task, agentNum, worktreeDir, branchName, result };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return { task, agentNum, worktreeDir, branchName, result: null, error: errorMsg };
	}
}

/**
 * Run a single agent in a lightweight sandbox.
 *
 * Sandboxes use symlinks for read-only dependencies (node_modules, .git, etc.)
 * and copy source files. This is much faster than git worktrees for large repos.
 */
async function runAgentInSandbox(
	engine: AIEngine,
	task: Task,
	agentNum: number,
	sandboxBase: string,
	originalDir: string,
	prdSource: string,
	prdFile: string,
	prdIsFolder: boolean,
	maxRetries: number,
	retryDelay: number,
	skipTests: boolean,
	skipLint: boolean,
	browserEnabled: "auto" | "true" | "false",
	modelOverride?: string,
	engineArgs?: string[],
): Promise<ParallelAgentResult> {
	const uniqueSuffix = Math.random().toString(36).substring(2, 8);
	const sandboxDir = join(sandboxBase, `agent-${agentNum}-${uniqueSuffix}`);
	const branchName = "";

	try {
		// Create sandbox
		const sandboxResult = await createSandbox({
			originalDir,
			sandboxDir,
			agentNum,
		});

		logDebug(
			`Agent ${agentNum}: Created sandbox (${sandboxResult.symlinksCreated} symlinks, ${sandboxResult.filesCopied} copies)`,
		);

		// Copy PRD file or folder to sandbox (same as worktree mode)
		if (prdSource === "markdown" || prdSource === "yaml" || prdSource === "json") {
			const srcPath = join(originalDir, prdFile);
			const destPath = join(sandboxDir, prdFile);
			if (existsSync(srcPath)) {
				copyFileSync(srcPath, destPath);
			}
		} else if (prdSource === "markdown-folder" && prdIsFolder) {
			const srcPath = join(originalDir, prdFile);
			const destPath = join(sandboxDir, prdFile);
			if (existsSync(srcPath)) {
				cpSync(srcPath, destPath, { recursive: true });
			}
		}

		// Ensure .ralphy/ exists in sandbox
		const ralphyDir = join(sandboxDir, RALPHY_DIR);
		if (!existsSync(ralphyDir)) {
			mkdirSync(ralphyDir, { recursive: true });
		}

		// Build prompt
		const prompt = buildParallelPrompt({
			task: task.title,
			progressFile: PROGRESS_FILE,
			prdFile,
			skipTests,
			skipLint,
			browserEnabled,
			allowCommit: false,
		});

		// Execute with retry
		const engineOptions = {
			...(modelOverride && { modelOverride }),
			...(engineArgs && engineArgs.length > 0 && { engineArgs }),
		};
		const result = await withRetry(
			async () => {
				const res = await engine.execute(prompt, sandboxDir, engineOptions);
				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}
				return res;
			},
			{ maxRetries, retryDelay },
		);

		return { task, agentNum, worktreeDir: sandboxDir, branchName, result, usedSandbox: true };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return {
			task,
			agentNum,
			worktreeDir: sandboxDir,
			branchName,
			result: null,
			error: errorMsg,
			usedSandbox: true,
		};
	}
}

/**
 * Run tasks in parallel using worktrees or sandboxes
 */
export async function runParallel(
	options: ExecutionOptions & {
		maxParallel: number;
		prdSource: string;
		prdFile: string;
		prdIsFolder?: boolean;
	},
): Promise<ExecutionResult> {
	const {
		engine,
		taskSource,
		workDir,
		skipTests,
		skipLint,
		dryRun,
		maxIterations,
		maxRetries,
		retryDelay,
		baseBranch,
		maxParallel,
		prdSource,
		prdFile,
		prdIsFolder = false,
		browserEnabled,
		modelOverride,
		skipMerge,
		useSandbox = false,
		engineArgs,
		syncIssue,
	} = options;

	const shouldFallbackToSandbox = (error: string | undefined): boolean => {
		if (!error) return false;
		return error.includes(".git/worktrees") || error.toLowerCase().includes("invalid path");
	};

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	// Determine isolation mode (worktree vs sandbox)
	let effectiveUseSandbox = useSandbox;
	if (!effectiveUseSandbox && !canUseWorktrees(workDir)) {
		logWarn("Worktrees unavailable in this repo; falling back to sandbox mode.");
		effectiveUseSandbox = true;
	}

	const isolationBase = effectiveUseSandbox ? getSandboxBase(workDir) : getWorktreeBase(workDir);
	logDebug(`${effectiveUseSandbox ? "Sandbox" : "Worktree"} base: ${isolationBase}`);

	if (effectiveUseSandbox) {
		logInfo("Using lightweight sandbox mode (faster for large repos)");
	}

	// Save starting branch to restore after merge phase
	const startingBranch = await getCurrentBranch(workDir);

	// Save original base branch for merge phase
	const originalBaseBranch = baseBranch || startingBranch;

	// Track completed branches for merge phase
	const completedBranches: string[] = [];

	// Global agent counter to ensure unique numbering across batches
	let globalAgentNum = 0;

	// Track processed tasks in dry-run mode (since we don't modify the source file)
	const dryRunProcessedIds = new Set<string>();

	// Process tasks in batches
	let iteration = 0;

	while (true) {
		// Check iteration limit
		if (maxIterations > 0 && iteration >= maxIterations) {
			logInfo(`Reached max iterations (${maxIterations})`);
			break;
		}

		// Get tasks for this batch
		let tasks: Task[] = [];

		const taskSourceWithGroups = taskSource as TaskSource & {
			getParallelGroup?: (title: string) => Promise<number>;
			getTasksInGroup?: (group: number) => Promise<Task[]>;
		};

		if (taskSourceWithGroups.getParallelGroup && taskSourceWithGroups.getTasksInGroup) {
			let nextTask = await taskSource.getNextTask();
			if (dryRun && nextTask && dryRunProcessedIds.has(nextTask.id)) {
				const allTasks = await taskSource.getAllTasks();
				nextTask = allTasks.find((task) => !dryRunProcessedIds.has(task.id)) || null;
			}
			if (!nextTask) break;

			const group = await taskSourceWithGroups.getParallelGroup(nextTask.title);
			if (group > 0) {
				tasks = await taskSourceWithGroups.getTasksInGroup(group);
				if (dryRun) {
					tasks = tasks.filter((task) => !dryRunProcessedIds.has(task.id));
				}
			} else {
				tasks = [nextTask];
			}
		} else {
			tasks = await taskSource.getAllTasks();
			if (dryRun) {
				tasks = tasks.filter((task) => !dryRunProcessedIds.has(task.id));
			}
		}

		if (tasks.length === 0) {
			logSuccess("All tasks completed!");
			break;
		}

		// Limit to maxParallel
		const batch = tasks.slice(0, maxParallel);
		iteration++;

		const batchStartTime = Date.now();
		logInfo(`Batch ${iteration}: ${batch.length} tasks in parallel`);

		if (dryRun) {
			logInfo("(dry run) Skipping batch");
			// Track processed tasks to avoid infinite loop
			for (const task of batch) {
				dryRunProcessedIds.add(task.id);
			}
			continue;
		}

		// Log task names being processed
		for (const task of batch) {
			logInfo(`  -> ${task.title}`);
		}

		// Run agents in parallel (using sandbox or worktree mode)
		const promises = batch.map((task) => {
			globalAgentNum++;

			const runInSandbox = () =>
				runAgentInSandbox(
					engine,
					task,
					globalAgentNum,
					getSandboxBase(workDir),
					workDir,
					prdSource,
					prdFile,
					prdIsFolder,
					maxRetries,
					retryDelay,
					skipTests,
					skipLint,
					browserEnabled,
					modelOverride,
					engineArgs,
				);

			if (effectiveUseSandbox) {
				return runInSandbox();
			}

			return runAgentInWorktree(
				engine,
				task,
				globalAgentNum,
				baseBranch,
				isolationBase,
				workDir,
				prdSource,
				prdFile,
				prdIsFolder,
				maxRetries,
				retryDelay,
				skipTests,
				skipLint,
				browserEnabled,
				modelOverride,
				engineArgs,
			).then((res) => {
				if (shouldFallbackToSandbox(res.error)) {
					logWarn(`Agent ${globalAgentNum}: Worktree unavailable, retrying in sandbox mode.`);
					if (res.worktreeDir) {
						cleanupAgentWorktree(res.worktreeDir, res.branchName, workDir).catch(() => {
							// Ignore cleanup failures during fallback
						});
					}
					return runInSandbox();
				}
				return res;
			});
		});

		const results = await Promise.all(promises);

		// Process results and collect worktrees for parallel cleanup
		let sawRetryableFailure = false;
		const worktreesToCleanup: Array<{ worktreeDir: string; branchName: string }> = [];

		for (const agentResult of results) {
			const {
				task,
				agentNum,
				worktreeDir,
				result: aiResult,
				error,
				usedSandbox: agentUsedSandbox,
			} = agentResult;
			let branchName = agentResult.branchName;
			let failureReason: string | undefined = error;
			let retryableFailure = false;
			let preserveSandbox = false;

			if (!failureReason && aiResult?.success && agentUsedSandbox && worktreeDir) {
				try {
					const modifiedFiles = await getModifiedFiles(worktreeDir, workDir);
					if (modifiedFiles.length > 0) {
						const commitResult = await commitSandboxChanges(
							workDir,
							modifiedFiles,
							worktreeDir,
							task.title,
							agentNum,
							originalBaseBranch,
						);

						if (commitResult.success) {
							branchName = commitResult.branchName;
							logDebug(
								`Agent ${agentNum}: Committed ${commitResult.filesCommitted} files to ${branchName}`,
							);
						} else {
							failureReason = commitResult.error || "Failed to commit sandbox changes";
							preserveSandbox = true; // Preserve work for manual recovery
						}
					}
				} catch (commitErr) {
					failureReason = commitErr instanceof Error ? commitErr.message : String(commitErr);
					preserveSandbox = true; // Preserve work for manual recovery
				}
			}

			if (failureReason) {
				retryableFailure = isRetryableError(failureReason);
				if (retryableFailure) {
					const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
					if (deferrals >= maxRetries) {
						logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${failureReason}`);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, failureReason);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						retryableFailure = false;
					} else {
						logWarn(`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${failureReason}`);
						result.tasksFailed++;
					}
				} else {
					logError(`Task "${task.title}" failed: ${failureReason}`);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, failureReason);

					// Mark failed task as complete to remove it from the queue
					// This prevents infinite retry loops - the task has already been retried maxRetries times
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
				}
			} else if (aiResult?.success) {
				logSuccess(`Task "${task.title}" completed`);
				result.totalInputTokens += aiResult.inputTokens;
				result.totalOutputTokens += aiResult.outputTokens;

				await taskSource.markComplete(task.id);
				logTaskProgress(task.title, "completed", workDir);
				result.tasksCompleted++;

				notifyTaskComplete(task.title);
				clearDeferredTask(taskSource.type, task, workDir, prdFile);

				// Track successful branch for merge phase
				if (branchName) {
					completedBranches.push(branchName);
				}
			} else {
				const errMsg = aiResult?.error || "Unknown error";
				retryableFailure = isRetryableError(errMsg);
				if (retryableFailure) {
					const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
					if (deferrals >= maxRetries) {
						logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errMsg}`);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						failureReason = errMsg;
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						retryableFailure = false;
					} else {
						logWarn(`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${errMsg}`);
						result.tasksFailed++;
						failureReason = errMsg;
					}
				} else {
					logError(`Task "${task.title}" failed: ${errMsg}`);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errMsg);
					failureReason = errMsg;

					// Mark failed task as complete to remove it from the queue
					// This prevents infinite retry loops - the task has already been retried maxRetries times
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
				}
			}

			// Cleanup sandbox inline or collect worktree for parallel cleanup
			if (worktreeDir) {
				if (agentUsedSandbox) {
					if (failureReason || preserveSandbox) {
						logWarn(`Sandbox preserved for manual review: ${worktreeDir}`);
					} else {
						// Sandbox cleanup is simpler - just delete the directory
						await cleanupSandbox(worktreeDir);
						logDebug(`Cleaned up sandbox: ${worktreeDir}`);
					}
				} else {
					// Collect worktree for parallel cleanup below
					worktreesToCleanup.push({ worktreeDir, branchName });
				}
			}

			if (retryableFailure) {
				sawRetryableFailure = true;
			}
		}

		// Cleanup all worktrees in parallel
		if (worktreesToCleanup.length > 0) {
			const cleanupResults = await Promise.all(
				worktreesToCleanup.map(({ worktreeDir, branchName }) =>
					cleanupAgentWorktree(worktreeDir, branchName, workDir).then((cleanup) => ({
						worktreeDir,
						leftInPlace: cleanup.leftInPlace,
					})),
				),
			);

			// Log any worktrees left in place
			for (const { worktreeDir, leftInPlace } of cleanupResults) {
				if (leftInPlace) {
					logInfo(`Worktree left in place (uncommitted changes): ${worktreeDir}`);
				}
			}
		}

		// Sync PRD to GitHub issue once per batch (after all tasks processed)
		// This prevents multiple concurrent syncs and reduces API calls
		if (syncIssue && prdFile && result.tasksCompleted > 0) {
			await syncPrdToIssue(prdFile, syncIssue, workDir);
		}

		// Log batch completion time
		const batchDuration = formatDuration(Date.now() - batchStartTime);
		logInfo(`Batch ${iteration} completed in ${batchDuration}`);
		// If any retryable failure occurred, stop the run to allow retry later
		if (sawRetryableFailure) {
			logWarn("Stopping early due to retryable errors. Try again later.");
			break;
		}
	}

	// Merge phase: merge completed branches back to base branch
	if (!skipMerge && !dryRun && completedBranches.length > 0) {
		const git = simpleGit(workDir);
		let stashed = false;
		try {
			const status = await git.status();
			const hasChanges = status.files.length > 0 || status.not_added.length > 0;
			if (hasChanges) {
				await git.stash(["push", "-u", "-m", "ralphy-merge-stash"]);
				stashed = true;
				logDebug("Stashed local changes before merge phase");
			}
		} catch (stashErr) {
			logWarn(`Failed to stash local changes: ${stashErr}`);
		}

		try {
			await mergeCompletedBranches(
				completedBranches,
				originalBaseBranch,
				engine,
				workDir,
				modelOverride,
				engineArgs,
			);

			// Restore starting branch if we're not already on it
			const currentBranch = await getCurrentBranch(workDir);
			if (currentBranch !== startingBranch) {
				logDebug(`Restoring starting branch: ${startingBranch}`);
				await returnToBaseBranch(startingBranch, workDir);
			}
		} finally {
			if (stashed) {
				try {
					await git.stash(["pop"]);
					logDebug("Restored stashed changes after merge phase");
				} catch (stashErr) {
					logWarn(`Failed to restore stashed changes: ${stashErr}`);
				}
			}
		}
	}

	return result;
}

/**
 * Merge completed branches back to the base branch.
 *
 * Optimized merge phase:
 * 1. Parallel pre-merge analysis (git diff doesn't require locks)
 * 2. Sort branches by conflict likelihood (merge clean ones first)
 * 3. Sequential merges (git locking requirement)
 * 4. Parallel branch deletion
 */
async function mergeCompletedBranches(
	branches: string[],
	targetBranch: string,
	engine: AIEngine,
	workDir: string,
	modelOverride?: string,
	engineArgs?: string[],
): Promise<void> {
	if (branches.length === 0) {
		return;
	}

	const mergeStartTime = Date.now();
	logInfo(`\nMerge phase: merging ${branches.length} branch(es) into ${targetBranch}`);

	// Stage 1: Parallel pre-merge analysis
	// Run git diff for all branches in parallel (doesn't require locks)
	logDebug("Analyzing branches for potential conflicts...");
	const analyses = await Promise.all(
		branches.map((branch) => analyzePreMerge(branch, targetBranch, workDir)),
	);

	// Stage 2: Sort by conflict likelihood (merge clean ones first)
	// This reduces the chance of early conflicts blocking later clean merges
	const sortedAnalyses = sortByConflictLikelihood(analyses);
	const sortedBranches = sortedAnalyses.map((a) => a.branch);

	if (sortedBranches[0] !== branches[0]) {
		logDebug("Reordered branches to minimize conflicts");
	}

	// Stage 3: Sequential merges (git operations require this)
	const merged: string[] = [];
	const failed: string[] = [];

	for (const branch of sortedBranches) {
		const analysis = analyses.find((a) => a.branch === branch);
		const fileCount = analysis?.fileCount ?? 0;
		logInfo(`Merging ${branch}... (${fileCount} file${fileCount === 1 ? "" : "s"} changed)`);

		const mergeResult = await mergeAgentBranch(branch, targetBranch, workDir);

		if (mergeResult.success) {
			logSuccess(`Merged ${branch}`);
			merged.push(branch);
		} else if (mergeResult.hasConflicts && mergeResult.conflictedFiles) {
			// Try AI-assisted conflict resolution
			logWarn(`Merge conflict in ${branch}, attempting AI resolution...`);

			const resolved = await resolveConflictsWithAI(
				engine,
				mergeResult.conflictedFiles,
				branch,
				workDir,
				modelOverride,
				engineArgs,
			);

			if (resolved) {
				logSuccess(`Resolved conflicts and merged ${branch}`);
				merged.push(branch);
			} else {
				logError(`Failed to resolve conflicts for ${branch}`);
				await abortMerge(workDir);
				failed.push(branch);
			}
		} else {
			logError(`Failed to merge ${branch}: ${mergeResult.error || "Unknown error"}`);
			failed.push(branch);
		}
	}

	// Stage 4: Parallel branch deletion
	// Delete all successfully merged branches in parallel
	if (merged.length > 0) {
		const deleteResults = await Promise.all(
			merged.map(async (branch) => {
				const deleted = await deleteLocalBranch(branch, workDir, true);
				return { branch, deleted };
			}),
		);

		for (const { branch, deleted } of deleteResults) {
			if (deleted) {
				logDebug(`Deleted merged branch: ${branch}`);
			}
		}
	}

	// Summary
	const mergeDuration = formatDuration(Date.now() - mergeStartTime);
	if (merged.length > 0) {
		logSuccess(`Successfully merged ${merged.length} branch(es) in ${mergeDuration}`);
	}
	if (failed.length > 0) {
		logWarn(`Failed to merge ${failed.length} branch(es): ${failed.join(", ")}`);
		logInfo("These branches have been preserved for manual review.");
	}
}
