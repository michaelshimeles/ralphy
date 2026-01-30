import simpleGit from "simple-git";
import { logTaskProgress } from "../config/writer.ts";
import type { AIEngine } from "../engines/types.ts";
import { getCurrentBranch, returnToBaseBranch } from "../git/branch.ts";
import {
	abortMerge,
	analyzePreMerge,
	deleteLocalBranch,
	mergeAgentBranch,
	sortByConflictLikelihood,
} from "../git/merge.ts";
import { canUseWorktrees, cleanupAgentWorktree, getWorktreeBase } from "../git/worktree.ts";
import type { Task } from "../tasks/types.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import { type AgentRunnerOptions, runAgentInSandbox, runAgentInWorktree } from "./agent-runner.ts";
import { resolveConflictsWithAI } from "./conflict-resolution.ts";
import { clearDeferredTask } from "./deferred.ts";
import { batchByColor, buildConflictGraph, colorGraph, type PlannedTask } from "./graph-coloring.ts";
import { acquireFileLock, releaseFileLock } from "./locking.ts";
import { isRetryableError } from "./retry.ts";
import { cleanupSandbox, getModifiedFiles, getSandboxBase } from "./sandbox.ts";
import { commitSandboxChanges } from "./sandbox-git.ts";
import type { ExecutionOptions, ExecutionResult } from "./sequential.ts";
import { detectStateFormat, type StateFormat, TaskState, TaskStateManager } from "./task-state.ts";

const MERGE_LOCK_FILE = ".ralphy-merge.lock";

/**
 * Convert Task to PlannedTask for graph coloring by extracting file information.
 * Uses planning analysis if available, otherwise defaults to empty file list.
 */
function taskToPlannedTask(task: Task, planningAnalysis?: string): PlannedTask {
	let files: string[] = [];

	if (planningAnalysis) {
		try {
			const fileMatch = planningAnalysis.match(/files:?\s*\[([^\]]+)\]/i);
			if (fileMatch) {
				files = fileMatch[1].split(",").map((f) => f.trim().replace(/['"]/g, ""));
			}
		} catch (e) {
			logDebug(`Failed to extract files from planning analysis: ${e}`);
		}
	}

	return {
		task,
		files,
	};
}

/**
 * Run tasks in parallel using worktrees or sandboxes
 *
 * @param options - Execution options including maxParallel, taskSource, etc.
 * @returns Execution result with completed/failed task counts
 */
export async function runParallel(
	options: ExecutionOptions & {
		maxParallel: number;
		prdSource: string;
		prdFile: string;
		prdIsFolder?: boolean;
		taskStateManager?: TaskStateManager;
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
		debug,
		debugOpenCode,
		allowOpenCodeSandboxAccess,
		planningModel,
		testModel,
		noGitParallel,
		taskStateManager: externalTaskStateManager,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	// Initialize task state manager if not provided
	let taskStateManager: TaskStateManager;
	if (externalTaskStateManager) {
		taskStateManager = externalTaskStateManager;
	} else {
		// Detect format from prdFile extension
		const format: StateFormat = detectStateFormat(prdFile);

		taskStateManager = new TaskStateManager(workDir, taskSource.type, prdFile || "tasks.yaml", format);

		// Get all tasks and initialize state manager
		const allTasks = await taskSource.getAllTasks();
		await taskStateManager.initialize(allTasks);
	}

	// Determine isolation mode (worktree vs sandbox)
	let effectiveUseSandbox = useSandbox;
	if (!effectiveUseSandbox && !canUseWorktrees(workDir)) {
		logWarn("Worktrees unavailable in this repo; falling back to sandbox mode.");
		effectiveUseSandbox = true;
	}

	const isolationBase = effectiveUseSandbox ? getSandboxBase(workDir) : getWorktreeBase(workDir);
	const isolationMode = effectiveUseSandbox ? "sandbox" : "worktree";
	logDebug(`${isolationMode} base: ${isolationBase}`);

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
	const getNextAgentNum = () => ++globalAgentNum;

	// Track processed tasks in dry-run mode (since we don't modify the source file)
	const dryRunProcessedIds = new Set<string>();

	// Static agent display for rich output
	const staticAgentDisplay = StaticAgentDisplay.getInstance() || new StaticAgentDisplay();
	staticAgentDisplay.startDisplay();

	// Process tasks in batches
	let iteration = 0;

	try {
		while (true) {
			// Check iteration limit
			if (maxIterations > 0 && iteration >= maxIterations) {
				logInfo(`Reached max iterations (${maxIterations})`);
				break;
			}

			// Get pending tasks from state manager
			const pendingTasks = taskStateManager.getTasksByState(TaskState.PENDING);

			if (pendingTasks.length === 0) {
				logSuccess("All tasks completed!");
				break;
			}

			// Get all tasks from source to find full task objects
			const allSourceTasks = await taskSource.getAllTasks();

			// Map pending state entries to full task objects
			let tasks: Task[] = pendingTasks
				.map((pt) => allSourceTasks.find((t) => t.id === pt.id))
				.filter((t): t is Task => t !== undefined);

			// Filter out already processed tasks in dry-run mode
			if (dryRun) {
				tasks = tasks.filter((t) => !dryRunProcessedIds.has(t.id));
			}

			if (tasks.length === 0) {
				logSuccess("All tasks completed!");
				break;
			}

			// Filter out tasks that have exceeded max attempts
			const filteredTasks: Task[] = [];
			for (const task of tasks) {
				if (taskStateManager.hasExceededMaxAttempts(task.id, maxRetries)) {
					logWarn(`Task "${task.title}" has exceeded max attempts (${maxRetries}), skipping...`);
					await taskStateManager.transitionState(task.id, TaskState.SKIPPED);
					await taskSource.markComplete(task.id);
					result.tasksFailed++;
					notifyTaskFailed(task.title, "Exceeded maximum retry attempts");
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
				} else {
					filteredTasks.push(task);
				}
			}

			if (filteredTasks.length === 0) {
				// All tasks in this batch were skipped due to max attempts
				continue;
			}

			// Use graph coloring for optimal batching when tasks have file information
			let batch: Task[];
			const plannedTasks = filteredTasks.map((t) => taskToPlannedTask(t));
			const tasksWithFiles = plannedTasks.filter((pt) => pt.files.length > 0);

			if (tasksWithFiles.length === tasks.length && tasksWithFiles.length > 1) {
				logDebug("Using graph coloring for conflict-aware batching...");
				const graph = buildConflictGraph(plannedTasks);
				const colors = colorGraph(plannedTasks, graph);
				const batches = batchByColor(plannedTasks, colors, maxParallel);

				const batchKeys = Array.from(batches.keys()).sort((a, b) => a - b);
				if (batchKeys.length > 0) {
					const firstBatch = batches.get(batchKeys[0]);
					batch = firstBatch?.map((pt) => pt.task) || [];
					logInfo(`Graph coloring created ${batchKeys.length} batch(es), using batch 1 with ${batch.length} tasks`);
				} else {
					batch = tasks.slice(0, maxParallel);
				}
			} else {
				batch = filteredTasks.slice(0, maxParallel);
			}
			iteration++;

			logInfo(`Batch ${iteration}: ${batch.length} tasks in parallel`);

			if (dryRun && !options.debugOpenCode) {
				logInfo("(dry run) Skipping batch");
				// Track processed tasks to avoid infinite loop
				for (const task of batch) {
					dryRunProcessedIds.add(task.id);
				}
				continue;
			}

			// Initialize agent progress map for static display
			for (const task of batch) {
				const agentNum = getNextAgentNum();
				const initialPhase = planningModel ? "planning" : "execution";
				const initialModel = planningModel ? "planning" : "main";
				staticAgentDisplay.setAgentStatus(agentNum, task.title, "working", initialPhase, initialModel);
			}

			// Claim tasks for execution before starting
			const claimedTasks: Task[] = [];
			for (const task of batch) {
				const claimed = await taskStateManager.claimTaskForExecution(task.id);
				if (claimed) {
					claimedTasks.push(task);
				} else {
					logDebug(`Task "${task.title}" is already being executed, skipping...`);
				}
			}

			if (claimedTasks.length === 0) {
				// No tasks could be claimed, continue to next batch
				continue;
			}

			// Parallel execution
			const promises = claimedTasks.map((task) => {
				const agentNum = globalAgentNum - (claimedTasks.length - claimedTasks.indexOf(task) - 1);
				const agentOptions: AgentRunnerOptions = {
					engine,
					task,
					agentNum,
					originalDir: workDir,
					prdSource,
					prdFile,
					prdIsFolder,
					maxRetries,
					retryDelay,
					skipTests,
					skipLint,
					browserEnabled,
					modelOverride,
					planningModel,
					testModel,
					engineArgs,
					env: options.env,
					debug,
					debugOpenCode,
					allowOpenCodeSandboxAccess,
					logThoughts: options.logThoughts,
					onProgress: (step) => {
						// Detect OpenCode JSON and parse it properly
						if (
							step.includes('"type":"tool_use"') ||
							step.includes('"type":"step_') ||
							step.includes('"type":"text"')
						) {
							staticAgentDisplay.updateAgentFromOpenCode(agentNum, step);
						} else {
							staticAgentDisplay.updateAgent(agentNum, step);
						}
					},
					dryRun,
					noGitParallel: effectiveUseSandbox && noGitParallel,
				};

				if (effectiveUseSandbox) {
					return runAgentInSandbox(getSandboxBase(workDir), agentOptions);
				}

				return runAgentInWorktree(getWorktreeBase(workDir), originalBaseBranch, agentOptions);
			});

			const results = await Promise.allSettled(promises);

			// Process all results
			let sawRetryableFailure = false;
			const worktreesToCleanup: Array<{ worktreeDir: string; branchName: string }> = [];
			const allErrors: Array<{ task: Task; error: string }> = [];

			// Helper to determine if a rejection is planning-related
			const isPlanningRejection = (error: string): boolean => {
				const planningKeywords = ["planning", "timeout", "model", "analysis", "cache"];
				return planningKeywords.some((keyword) => error.toLowerCase().includes(keyword));
			};

			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				const task = claimedTasks[i];

				if (res.status === "rejected") {
					const error = res.reason;
					allErrors.push({ task, error: String(error) });
					logError(`Task "${task.title}" failed: ${error}`);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, String(error));

					// Check if failure is planning-related
					if (isPlanningRejection(error)) {
						// Planning phase failed - transition to failed state but don't mark complete
						logDebug(`Planning phase failed for task "${task.title}", transitioning to FAILED state`);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, String(error));
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						continue;
					}

					// Execution phase failure - transition to failed state
					await taskStateManager.transitionState(task.id, TaskState.FAILED, String(error));
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
					continue;
				}

				const agentResult = res.value;
				const {
					agentNum,
					worktreeDir,
					branchName,
					result: aiResult,
					error: failureReason,
					usedSandbox: agentUsedSandbox,
				} = agentResult;

				staticAgentDisplay.agentComplete(agentNum);

				let finalBranchName = branchName;
				let finalFailureReason = failureReason;
				let preserveSandbox = false;

				// Handle sandbox commit if successful
				if (!finalFailureReason && aiResult?.success && agentUsedSandbox && worktreeDir) {
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
								finalBranchName = commitResult.branchName;
								logDebug(`Agent ${agentNum}: Committed ${commitResult.filesCommitted} files to ${finalBranchName}`);
							} else {
								finalFailureReason =
									commitResult.error && typeof commitResult.error === "object" && "message" in commitResult.error
										? (commitResult.error as { message: string }).message
										: String(commitResult.error);
								preserveSandbox = true;
								logWarn(`Sandbox commit failed: ${finalFailureReason}`);
							}
						}
					} catch (commitErr) {
						finalFailureReason = commitErr instanceof Error ? commitErr.message : String(commitErr);
						preserveSandbox = true;
						logDebug(`Sandbox commit error for task "${task.title}": ${commitErr}`);
					}
				}

				if (finalFailureReason) {
					const retryable = isRetryableError(finalFailureReason);
					if (retryable) {
						sawRetryableFailure = true;
						logWarn(`Task "${task.title}" encountered retryable error: ${finalFailureReason}`);
						await taskStateManager.transitionState(task.id, TaskState.DEFERRED, finalFailureReason);
					} else {
						logError(`Task "${task.title}" failed: ${finalFailureReason}`);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, finalFailureReason);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, finalFailureReason);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
					}
				} else if (aiResult?.success) {
					logSuccess(`Task "${task.title}" completed`);
					result.totalInputTokens += aiResult.inputTokens;
					result.totalOutputTokens += aiResult.outputTokens;

					await taskStateManager.transitionState(task.id, TaskState.COMPLETED, undefined, {
						branch: finalBranchName || undefined,
					});
					await taskSource.markComplete(task.id);
					logTaskProgress(task.title, "completed", workDir);
					result.tasksCompleted++;
					notifyTaskComplete(task.title);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);

					if (finalBranchName) {
						completedBranches.push(finalBranchName);
					}
				}

				// Cleanup
				if (worktreeDir) {
					if (agentUsedSandbox) {
						if (finalFailureReason || preserveSandbox) {
							logWarn(`Sandbox preserved for manual review: ${worktreeDir}`);
						} else {
							await cleanupSandbox(worktreeDir);
							logDebug(`Cleaned up sandbox: ${worktreeDir}`);
						}
					} else {
						worktreesToCleanup.push({ worktreeDir, branchName: finalBranchName });
					}
				}
			}

			// Cleanup all worktrees in parallel
			if (worktreesToCleanup.length > 0) {
				const cleanupResults = await Promise.all(
					worktreesToCleanup.map(({ worktreeDir }) =>
						cleanupAgentWorktree(worktreeDir, workDir).then((cleanup) => ({
							worktreeDir,
							leftInPlace: cleanup.leftInPlace,
						})),
					),
				);

				for (const { worktreeDir, leftInPlace } of cleanupResults) {
					if (leftInPlace) {
						logInfo(`Worktree left in place (uncommitted changes): ${worktreeDir}`);
					}
				}
			}

			if (sawRetryableFailure) {
				logWarn("Stopping early due to retryable errors. Try again later.");
				break;
			}
		}

		// Merge phase: merge completed branches back to base branch
		if (!skipMerge && !dryRun && completedBranches.length > 0) {
			// NEW: Acquire merge lock before merge phase
			const mergeLockAcquired = acquireFileLock(MERGE_LOCK_FILE, workDir);
			if (!mergeLockAcquired) {
				logWarn("Could not acquire merge lock, another merge may be in progress");
				throw new Error("Merge conflict detected");
			}

			try {
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

					const currentBranch = await getCurrentBranch(workDir);
					if (currentBranch !== startingBranch) {
						logDebug(`Restoring starting branch: ${startingBranch}`);
						await returnToBaseBranch(startingBranch, workDir);
					}
				} finally {
					if (stashed) {
						try {
							await git.stash(["pop"]);
							logDebug("Restored local changes after merge phase");
						} catch (popErr) {
							logWarn(`Failed to restore local changes: ${popErr}`);
						}
					}
				}
			} finally {
				releaseFileLock(MERGE_LOCK_FILE, workDir);
			}
		}
	} finally {
		// Stop static display
		staticAgentDisplay.stopDisplay();
	}

	return result;
}

/**
 * Merge completed branches back to the base branch.
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

	logInfo(`\nMerge phase: merging ${branches.length} branch(es) into ${targetBranch}`);

	logDebug("Analyzing branches for potential conflicts...");
	const analyses = await Promise.all(branches.map((branch) => analyzePreMerge(branch, targetBranch, workDir)));

	const sortedAnalyses = sortByConflictLikelihood(analyses);
	const sortedBranches = sortedAnalyses.map((a) => a.branch);

	if (sortedBranches[0] !== branches[0]) {
		logDebug("Reordered branches to minimize conflicts");
	}

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

	if (merged.length > 0) {
		logSuccess(`Successfully merged ${merged.length} branch(es)`);
	}
	if (failed.length > 0) {
		logWarn(`Failed to merge ${failed.length} branch(es): ${failed.join(", ")}`);
		logInfo("These branches have been preserved for manual review.");
	}
}
