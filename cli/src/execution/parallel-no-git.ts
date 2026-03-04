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
import { type StateFormat, TaskState, TaskStateManager, detectStateFormat } from "./task-state.ts";

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
		maxParallel,
		prdSource,
		prdFile,
		prdIsFolder = false,
		browserEnabled,
		modelOverride,
		planningModel,
		testModel,
		engineArgs,
		debug,
		debugOpenCode,
		allowOpenCodeSandboxAccess,
		logThoughts,
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

		taskStateManager = new TaskStateManager(
			workDir,
			taskSource.type,
			prdFile || "tasks.yaml",
			format,
		);

		// Get all tasks and initialize state manager
		const allTasks = await taskSource.getAllTasks();
		await taskStateManager.initialize(allTasks);
	}

	// Use lightweight sandbox mode
	logInfo("Using lightweight sandbox mode (no git worktrees)");

	const sandboxBase = getSandboxBase(workDir);

	// Global agent counter to ensure unique numbering across batches
	let globalAgentNum = 0;
	const getNextAgentNum = () => ++globalAgentNum;

	// Track processed tasks in dry-run mode (since we don't modify the source file)
	const dryRunProcessedIds = new Set<string>();

	// Static agent display - shows agents without constant refreshing
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

			// Limit to maxParallel
			const batch = filteredTasks.slice(0, maxParallel);
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

			// Claim tasks for execution before starting and assign stable agent numbers
			const claimedTasks: Array<{ task: Task; agentNum: number }> = [];
			for (const task of batch) {
				const claimed = await taskStateManager.claimTaskForExecution(task.id);
				if (claimed) {
					const agentNum = getNextAgentNum();
					const initialPhase = planningModel ? "planning" : "execution";
					const initialModel = planningModel ? "planning" : "main";
					staticAgentDisplay.setAgentStatus(
						agentNum,
						task.title,
						"working",
						initialPhase,
						initialModel,
					);
					claimedTasks.push({ task, agentNum });
				} else {
					logDebug(`Task "${task.title}" is already being executed, skipping...`);
				}
			}

			if (claimedTasks.length === 0) {
				// No tasks could be claimed, continue to next batch
				continue;
			}

			// Parallel execution with progress callback
			const promises = claimedTasks.map(({ task, agentNum }) => {
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
					logThoughts,
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
					noGitParallel: true,
				};

				return runAgentInSandbox(sandboxBase, agentOptions);
			});

			const results = await Promise.allSettled(promises);

			// Process results
			let sawRetryableFailure = false;

			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				const claimedTask = claimedTasks[i];
				const task = claimedTask.task;

				if (res.status === "rejected") {
					const error = res.reason;
					const retryableFailure = isRetryableError(error);
					if (retryableFailure) {
						sawRetryableFailure = true;
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${error}`);
							await taskStateManager.transitionState(task.id, TaskState.FAILED, String(error));
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, String(error));
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, prdFile);
							staticAgentDisplay.agentComplete(claimedTask.agentNum);
						} else {
							logWarn(`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${error}`);
							await taskStateManager.transitionState(task.id, TaskState.DEFERRED, String(error));
							result.tasksFailed++;
						}
					} else {
						logError(`Task "${task.title}" failed: ${error}`);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, String(error));
						logTaskProgress(task.title, "failed", workDir);
						result.tasksFailed++;
						notifyTaskFailed(task.title, String(error));
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						staticAgentDisplay.agentComplete(claimedTask.agentNum);
					}
					continue;
				}

				const agentResult = res.value;
				const { agentNum, worktreeDir, result: aiResult, error: failureReason } = agentResult;

				staticAgentDisplay.agentComplete(agentNum);

				if (failureReason) {
					const retryable = isRetryableError(failureReason);
					if (retryable) {
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
						sawRetryableFailure = true;
						if (deferrals >= maxRetries) {
							logError(
								`Task "${task.title}" failed after ${deferrals} deferrals: ${failureReason}`,
							);
							await taskStateManager.transitionState(task.id, TaskState.FAILED, failureReason);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, failureReason);
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, prdFile);
						} else {
							logWarn(
								`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${failureReason}`,
							);
							await taskStateManager.transitionState(task.id, TaskState.DEFERRED, failureReason);
						}
					} else {
						logError(`Task "${task.title}" failed: ${failureReason}`);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, failureReason);
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

					await taskStateManager.transitionState(task.id, TaskState.COMPLETED);
					await taskSource.markComplete(task.id);
					logTaskProgress(task.title, "completed", workDir);
					result.tasksCompleted++;
					notifyTaskComplete(task.title);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
				} else {
					// Logic failure (success=false) but no exception thrown (e.g. Planning Failed)
					const errorMsg = aiResult?.error || "Unknown logic failure";
					logError(`Task "${task.title}" failed (logic): ${errorMsg}`);
					await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMsg);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
					await taskSource.markComplete(task.id);
					clearDeferredTask(taskSource.type, task, workDir, prdFile);
				}

				// Cleanup sandbox
				if (worktreeDir) {
					try {
						await cleanupSandbox(worktreeDir);
						logDebug(`Cleaned up sandbox: ${worktreeDir}`);
					} catch (cleanupErr) {
						logWarn(`Failed to cleanup sandbox ${worktreeDir}: ${cleanupErr}`);
					}
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
