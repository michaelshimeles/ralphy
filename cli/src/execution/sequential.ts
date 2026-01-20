import type { AIEngine, AIResult } from "../engines/types.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { createTaskBranch, returnToBaseBranch } from "../git/branch.ts";
import { createPullRequest } from "../git/pr.ts";
import { logTaskProgress } from "../config/writer.ts";
import { logDebug, logError, logInfo, logSuccess } from "../ui/logger.ts";
import { ProgressSpinner } from "../ui/spinner.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
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
	/** Active settings to display in spinner */
	activeSettings?: string[];
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
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	let iteration = 0;

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
						if (engine.executeStreaming) {
							return await engine.executeStreaming(prompt, workDir, (step) => {
								spinner.updateStep(step);
							});
						}

						const res = await engine.execute(prompt, workDir);

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
					}
				);

				if (aiResult.success) {
					spinner.success();
					result.totalInputTokens += aiResult.inputTokens;
					result.totalOutputTokens += aiResult.outputTokens;

					// Mark task complete
					await taskSource.markComplete(task.id);
					logTaskProgress(task.title, "completed", workDir);
					result.tasksCompleted++;

					notifyTaskComplete(task.title);

					// Create PR if needed
					if (createPr && branch && baseBranch) {
						const prUrl = await createPullRequest(
							branch,
							baseBranch,
							task.title,
							`Automated PR created by Ralphy\n\n${aiResult.response}`,
							draftPr,
							workDir
						);

						if (prUrl) {
							logSuccess(`PR created: ${prUrl}`);
						}
					}
				} else {
					spinner.error(aiResult.error || "Unknown error");
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, aiResult.error || "Unknown error");
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				spinner.error(errorMsg);
				logTaskProgress(task.title, "failed", workDir);
				result.tasksFailed++;
				notifyTaskFailed(task.title, errorMsg);
			}
		}

		// Return to base branch if we created one
		if (branchPerTask && baseBranch) {
			await returnToBaseBranch(baseBranch, workDir);
		}
	}

	return result;
}
