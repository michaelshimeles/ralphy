import { logTaskProgress } from "../config/writer.ts";
import type { Task } from "../tasks/types.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import { runAgentInSandbox } from "./agent-runner.ts";
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import { isRetryableError } from "./retry.ts";
import type { AgentRunnerOptions } from "./runner-types.ts";
import { cleanupSandbox, getSandboxBase } from "./sandbox.ts";
import type { ExecutionOptions, ExecutionResult } from "./sequential.ts";

/**
 * Run tasks in parallel using sandboxes only (no git worktrees)
 *
 * This is a simplified version of parallel.ts that:
 * - Always uses sandboxes (never git worktrees)
 * - Skips merge phase entirely
 * - Uses static display to show agents without constant refreshing
 * - Shows 5 static rows per agent with formatted AI output
 *
 * @param options - Execution options including maxParallel, taskSource, etc.
 * @returns Execution result with completed/failed task counts
 */
export async function runParallelNoGit(
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
		maxParallel,
		prdSource,
		prdFile,
		prdIsFolder = false,
		browserEnabled,
		modelOverride,
		planningModel,
		engineArgs,
		debug,
		debugOpenCode,
		logThoughts,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	// Use lightweight sandbox mode
	logInfo("Using lightweight sandbox mode (no git worktrees)");

	const sandboxBase = getSandboxBase(workDir);

	// Global agent counter to ensure unique numbering across batches
	let globalAgentNum = 0;
	const getNextAgentNum = () => ++globalAgentNum;

	// Track processed tasks in dry-run mode (since we don't modify the source file)
	const dryRunProcessedIds = new Set<string>();

	// Static agent display - shows agents without constant refreshing
	const staticAgentDisplay = new StaticAgentDisplay();
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

			// Get tasks for this batch
			let tasks: Task[] = [];

			// For YAML sources, try to get tasks from the same parallel group
			const isYamlSource =
				taskSource.constructor.name === "YamlTaskSource" ||
				taskSource.constructor.name === "CachedTaskSource";

			if (isYamlSource) {
				// In dry-run mode, find the first task not already processed
				let nextTask = await taskSource.getNextTask();
				if (dryRun && nextTask && dryRunProcessedIds.has(nextTask.id)) {
					const allTasks = await taskSource.getAllTasks();
					nextTask = allTasks.find((t) => !dryRunProcessedIds.has(t.id)) || null;
				}
				if (!nextTask) break;

				// Check for getParallelGroup method (YamlTaskSource only)
				let group = 0;
				if ("getParallelGroup" in taskSource && typeof taskSource.getParallelGroup === "function") {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic method access
					group = await (taskSource as any).getParallelGroup(nextTask.title);
				}

				if (
					group > 0 &&
					"getTasksInGroup" in taskSource &&
					typeof taskSource.getTasksInGroup === "function"
				) {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic method access
					tasks = await (taskSource as any).getTasksInGroup(group);
					// Filter out already processed tasks in dry-run mode
					if (dryRun) {
						tasks = tasks.filter((t) => !dryRunProcessedIds.has(t.id));
					}
				} else {
					tasks = [nextTask];
				}
			} else {
				// For other sources, get all remaining tasks
				tasks = await taskSource.getAllTasks();
				// Filter out already processed tasks in dry-run mode
				if (dryRun) {
					tasks = tasks.filter((t) => !dryRunProcessedIds.has(t.id));
				}
			}

			if (tasks.length === 0) {
				logSuccess("All tasks completed!");
				break;
			}

			// Limit to maxParallel
			const batch = tasks.slice(0, maxParallel);
			iteration++;

			logInfo(`Batch ${iteration}: ${batch.length} tasks in parallel`);

			if (dryRun && !debugOpenCode) {
				logInfo("(dry run) Skipping batch");
				// Track processed tasks to avoid infinite loop
				for (const task of batch) {
					dryRunProcessedIds.add(task.id);
				}
				continue;
			}

			// Initialize agent progress map for static display
			// Create a map to ensure consistent agent numbers between display and execution
			const taskAgentMap = new Map<string, number>();
			for (const task of batch) {
				const agentNum = getNextAgentNum();
				taskAgentMap.set(task.id, agentNum);
				staticAgentDisplay.setAgentStatus(agentNum, task.title, "working");
			}

			// Parallel execution with progress callback
			const promises = batch.map((task) => {
				const agentNum = taskAgentMap.get(task.id)!;
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
					engineArgs,
					env: options.env,
					debug,
					debugOpenCode,
					logThoughts,
					onProgress: (step) => {
						// Forward to static display
						staticAgentDisplay.updateAgent(agentNum, step);
					},
					dryRun,
					noGitParallel: true,
				};

				return runAgentInSandbox(sandboxBase, agentOptions);
			});

			const results = await Promise.allSettled(promises);

			// Process results
			let sawRetryableFailure = false;

			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				const task = batch[i];

				if (res.status === "rejected") {
					const error = res.reason;
					const retryableFailure = isRetryableError(error);
					if (retryableFailure) {
						sawRetryableFailure = true;
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${error}`);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, String(error));
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, prdFile);
							staticAgentDisplay.agentComplete(i + 1);
						} else {
							logWarn(`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${error}`);
							result.tasksFailed++;
						}
					} else {
						logError(`Task "${task.title}" failed: ${error}`);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, String(error));
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						staticAgentDisplay.agentComplete(i + 1);
					}
					continue;
				}

				const agentResult = res.value;
				const { agentNum, worktreeDir, result: aiResult, error: failureReason } = agentResult;

				staticAgentDisplay.agentComplete(agentNum);

				if (failureReason) {
					const retryable = isRetryableError(failureReason);
					if (retryable) {
						sawRetryableFailure = true;
						logWarn(`Task "${task.title}" encountered retryable error: ${failureReason}`);
					} else {
						logError(`Task "${task.title}" failed: ${failureReason}`);
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, failureReason);
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
				}

				// Cleanup sandbox
				if (worktreeDir) {
					await cleanupSandbox(worktreeDir);
					logDebug(`Cleaned up sandbox: ${worktreeDir}`);
				}
			}

			if (sawRetryableFailure) {
				logWarn("Stopping early due to retryable errors. Try again later.");
				break;
			}
		}
	} finally {
		// Stop static display
		staticAgentDisplay.stopDisplay();
	}

	return result;
}
