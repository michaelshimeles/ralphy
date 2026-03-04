import { logTaskProgress } from "../config/writer.ts";
import type { AIEngine, AIResult } from "../engines/types.ts";
import { createTaskBranch, returnToBaseBranch } from "../git/branch.ts";
import { syncPrdToIssue } from "../git/issue-sync.ts";
import { createPullRequest } from "../git/pr.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { ProgressSpinner } from "../ui/spinner.ts";
import { standardizeError } from "../utils/errors.ts";
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import { buildPrompt } from "./prompt.ts";
import { isFatalError, isRetryableError, withRetry } from "./retry.ts";
import { type StateFormat, TaskState, TaskStateManager, detectStateFormat } from "./task-state.ts";

export interface ExecutionOptions {
	engine: AIEngine;
	taskSource: TaskSource;
	workDir: string;
	skipTests: boolean;
	skipLint: boolean;
	dryRun: boolean;
	maxIterations: number;
	maxRetries: number;
	retryDelay: number;
	branchPerTask: boolean;
	baseBranch: string;
	createPr: boolean;
	draftPr: boolean;
	autoCommit: boolean;
	browserEnabled: "auto" | "true" | "false";
	prdFile?: string;
	/** Active settings to display in spinner */
	activeSettings?: string[];
	/** Override default model for the engine */
	modelOverride?: string;
	/** Skip automatic branch merging after parallel execution */
	skipMerge?: boolean;
	/** Additional environment variables for the engine CLI */
	env?: Record<string, string>;
	/** Use lightweight sandboxes instead of git worktrees for parallel execution */
	useSandbox?: boolean;
	/** Additional arguments to pass to the engine CLI */
	engineArgs?: string[];
	/** Separate model for planning phase (cheaper/faster) */
	planningModel?: string;
	/** Separate model for test-related tasks (cheaper/faster) */
	testModel?: string;
	/** Force non-git parallel execution (sandboxes) even in git repos */
	noGitParallel?: boolean;
	/** Log AI thoughts/reasoning to console */
	logThoughts?: boolean;
	/** Enable full debug logging (cli errors, full ai responses) */
	debug?: boolean;
	/** Enable comprehensive OpenCode debugging */
	debugOpenCode?: boolean;
	/** Allow OpenCode to access sandbox directories without permission prompts */
	allowOpenCodeSandboxAccess?: boolean;
	/** Progress callback for progress reporting */
	onProgress?: (step: string) => void;
	/** Task state manager for centralized state tracking */
	taskStateManager?: TaskStateManager;
	/** Optional GitHub issue number to sync progress to */
	syncIssue?: number;
}

export interface ExecutionResult {
	tasksCompleted: number;
	tasksFailed: number;
	totalInputTokens: number;
	totalOutputTokens: number;
}

/**
 * Run tasks sequentially
 */
export async function runSequential(options: ExecutionOptions): Promise<ExecutionResult> {
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
		branchPerTask,
		baseBranch,
		createPr,
		draftPr,
		autoCommit,
		browserEnabled,
		activeSettings,
		modelOverride,
		engineArgs,
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
		const format: StateFormat = detectStateFormat(options.prdFile);

		taskStateManager = new TaskStateManager(
			workDir,
			taskSource.type,
			options.prdFile || "tasks.yaml",
			format,
		);

		// Get all tasks and initialize state manager
		const allTasks = await taskSource.getAllTasks();
		await taskStateManager.initialize(allTasks);
	}

	let iteration = 0;
	let abortDueToRetryableFailure = false;
	let taskIndex = new Map<string, Task>();

	for (const task of await taskSource.getAllTasks()) {
		taskIndex.set(task.id, task);
	}
	// BUG FIX: Safety counter to prevent infinite loops
	let safetyCounter = 0;
	const MAX_SAFETY_ITERATIONS = 10000;

	while (true) {
		// Safety check to prevent infinite loops
		if (safetyCounter++ > MAX_SAFETY_ITERATIONS) {
			throw new Error("Safety limit exceeded - possible infinite loop in sequential execution");
		}
		// Check iteration limit
		if (maxIterations > 0 && iteration >= maxIterations) {
			logInfo(`Reached max iterations (${maxIterations})`);
			break;
		}

		// Get next pending task from state manager
		const pendingTask = taskStateManager.getNextPendingTask();
		if (!pendingTask) {
			logSuccess("All tasks completed!");
			break;
		}

		// Find the full task in the source
		let task = taskIndex.get(pendingTask.id);
		if (!task) {
			for (const refreshedTask of await taskSource.getAllTasks()) {
				taskIndex.set(refreshedTask.id, refreshedTask);
			}
			task = taskIndex.get(pendingTask.id);
		}
		if (!task) {
			logError(`Task ${pendingTask.id} not found in source`);
			await taskStateManager.transitionState(pendingTask.id, TaskState.SKIPPED);
			continue;
		}

		// BUG FIX: Check max attempts and claim atomically in claimTaskForExecution
		// to prevent race condition where state could change between check and claim
		const claimed = await taskStateManager.claimTaskForExecution(task.id);
		if (!claimed) {
			// Task could be: already running, completed, or exceeded max attempts
			// Check if it was max attempts
			if (taskStateManager.hasExceededMaxAttempts(task.id, maxRetries)) {
				logWarn(`Task "${task.title}" has exceeded max attempts (${maxRetries}), skipping...`);
				await taskStateManager.transitionState(task.id, TaskState.SKIPPED);
				await taskSource.markComplete(task.id);
				result.tasksFailed++;
				notifyTaskFailed(task.title, "Exceeded maximum retry attempts");
				clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
			} else {
				logDebug(`Task "${task.title}" is already being executed, skipping...`);
			}
			continue;
		}

		iteration++;
		const remaining = taskStateManager.countPending();
		logInfo(`Task ${iteration}: ${task.title} (${remaining} remaining)`);

		// Create branch if needed
		let branch: string | null = null;
		if (branchPerTask && baseBranch) {
			try {
				branch = await createTaskBranch(task.title, baseBranch, workDir);
				logDebug(`Created branch: ${branch}`);
			} catch (error) {
				logError(`Failed to create branch: ${error}`);
			}
		}

		// Build prompt
		const prompt = buildPrompt({
			task: task.body || task.title,
			autoCommit,
			workDir,
			browserEnabled,
			skipTests,
			skipLint,
			prdFile: options.prdFile,
		});

		// Execute with spinner
		const spinner = new ProgressSpinner(task.title, activeSettings);
		let aiResult: AIResult | null = null;

		if (dryRun && !options.debugOpenCode) {
			spinner.success("(dry run) Skipped");
		} else {
			try {
				aiResult = await withRetry(
					async () => {
						spinner.updateStep("Working");

						// Use streaming if available
						const engineOptions = {
							...(modelOverride && { modelOverride }),
							...(engineArgs && engineArgs.length > 0 && { engineArgs }),
							...(options.debugOpenCode && { debugOpenCode: options.debugOpenCode }),
							...(options.logThoughts !== undefined && { logThoughts: options.logThoughts }),
							...(dryRun && { dryRun: true }),
						};

						if (engine.executeStreaming) {
							return await engine.executeStreaming(
								prompt,
								workDir,
								(step) => {
									spinner.updateStep(step);
								},
								engineOptions,
							);
						}

						const res = await engine.execute(prompt, workDir, engineOptions);

						if (!res.success && res.error && isRetryableError(res.error)) {
							throw new Error(res.error);
						}

						return res;
					},
					{
						maxRetries,
						retryDelay,
						onRetry: (attempt) => {
							spinner.updateStep(`Retry ${attempt}`);
						},
					},
				);

				if (options.debug) {
					logDebug("Full AI Response:", aiResult.response);
					if (aiResult.error) logDebug("Full AI Error:", aiResult.error);
				}

				if (aiResult.success) {
					spinner.success();
					result.totalInputTokens += aiResult.inputTokens;
					result.totalOutputTokens += aiResult.outputTokens;

					// Mark task complete in state manager
					await taskStateManager.transitionState(task.id, TaskState.COMPLETED, undefined, {
						branch: branch || undefined,
					});
					await taskSource.markComplete(task.id);
					logTaskProgress(task.title, "completed", workDir);
					result.tasksCompleted++;

					notifyTaskComplete(task.title);
					clearDeferredTask(taskSource.type, task, workDir, options.prdFile);

					// Create PR if needed
					if (createPr && branch && baseBranch) {
						const prUrl = await createPullRequest(
							branch,
							baseBranch,
							task.title,
							`Automated PR created by Ralphy\n\n${aiResult.response}`,
							draftPr,
							workDir,
						);

						if (prUrl) {
							logSuccess(`PR created: ${prUrl}`);
						}
					}

					if (options.syncIssue && options.prdFile) {
						await syncPrdToIssue(options.prdFile, options.syncIssue, workDir);
					}
				} else {
					const errMsg = aiResult.error || "Unknown error";
					if (isRetryableError(errMsg)) {
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
						spinner.error(errMsg);
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errMsg}`);
							await taskStateManager.transitionState(task.id, TaskState.FAILED, errMsg);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, errMsg);
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
						} else {
							logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errMsg}`);
							await taskStateManager.transitionState(task.id, TaskState.DEFERRED, errMsg);
							result.tasksFailed++;
							abortDueToRetryableFailure = true;
						}
					} else if (isFatalError(errMsg)) {
						spinner.error(errMsg);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, errMsg);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
						logError(`Fatal error: ${errMsg}`);
						logError("Aborting remaining tasks due to configuration/authentication issue.");
						if (branchPerTask && baseBranch) {
							await returnToBaseBranch(baseBranch, workDir);
						}
						return result;
					} else {
						spinner.error(errMsg);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, errMsg);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					}
				}
			} catch (error) {
				const errorMsg = standardizeError(error).message;
				if (isRetryableError(errorMsg)) {
					const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
					spinner.error(errorMsg);
					if (deferrals >= maxRetries) {
						logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errorMsg}`);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMsg);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errorMsg);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					} else {
						logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errorMsg}`);
						await taskStateManager.transitionState(task.id, TaskState.DEFERRED, errorMsg);
						result.tasksFailed++;
						abortDueToRetryableFailure = true;
					}
				} else if (isFatalError(errorMsg)) {
					spinner.error(errorMsg);
					await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMsg);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					logError(`Fatal error: ${errorMsg}`);
					logError("Aborting remaining tasks due to configuration/authentication issue.");
					if (branchPerTask && baseBranch) {
						await returnToBaseBranch(baseBranch, workDir);
					}
					return result;
				} else {
					spinner.error(errorMsg);
					await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMsg);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
				}
			}
		}

		// Return to base branch if we created one
		if (branchPerTask && baseBranch) {
			await returnToBaseBranch(baseBranch, workDir);
		}

		if (abortDueToRetryableFailure) {
			break;
		}
	}

	return result;
}
