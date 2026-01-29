import { logTaskProgress } from "../config/writer.ts";
import type { AIEngine, AIResult } from "../engines/types.ts";
import { createTaskBranch, returnToBaseBranch } from "../git/branch.ts";
import { syncPrdToIssue } from "../git/issue-sync.ts";
import { createPullRequest } from "../git/pr.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { ProgressSpinner } from "../ui/spinner.ts";
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import { buildPrompt } from "./prompt.ts";
import { isRetryableError, sleep, withRetry } from "./retry.ts";

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
	/** Use lightweight sandboxes instead of git worktrees for parallel execution */
	useSandbox?: boolean;
	/** Additional arguments to pass to the engine CLI */
	engineArgs?: string[];
	/** GitHub issue number to sync PRD with on each iteration */
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
		syncIssue,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	let iteration = 0;
	let abortDueToRetryableFailure = false;

	while (true) {
		// Check iteration limit
		if (maxIterations > 0 && iteration >= maxIterations) {
			logInfo(`Reached max iterations (${maxIterations})`);
			break;
		}

		// Get next task
		const task = await taskSource.getNextTask();
		if (!task) {
			logSuccess("All tasks completed!");
			break;
		}

		iteration++;
		const remaining = await taskSource.countRemaining();
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

		if (dryRun) {
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

				if (aiResult.success) {
					spinner.success(undefined, true); // Show timing breakdown
					result.totalInputTokens += aiResult.inputTokens;
					result.totalOutputTokens += aiResult.outputTokens;

					// Mark task complete
					await taskSource.markComplete(task.id);
					logTaskProgress(task.title, "completed", workDir);
					result.tasksCompleted++;

					// Sync PRD to GitHub issue if configured
					if (syncIssue && options.prdFile) {
						await syncPrdToIssue(options.prdFile, syncIssue, workDir);
					}

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
				} else {
					const errMsg = aiResult.error || "Unknown error";
					if (isRetryableError(errMsg)) {
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
						spinner.error(errMsg);
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errMsg}`);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, errMsg);
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
						} else {
							logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errMsg}`);
							result.tasksFailed++;
							abortDueToRetryableFailure = true;
						}
					} else {
						spinner.error(errMsg);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					}
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				if (isRetryableError(errorMsg)) {
					const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
					spinner.error(errorMsg);
					if (deferrals >= maxRetries) {
						logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errorMsg}`);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errorMsg);
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					} else {
						logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errorMsg}`);
						result.tasksFailed++;
						abortDueToRetryableFailure = true;
					}
				} else {
					spinner.error(errorMsg);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
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
