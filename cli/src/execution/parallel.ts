import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
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
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import {
	type PlannedTask,
	batchByColor,
	buildConflictGraph,
	colorGraph,
} from "./graph-coloring.ts";
import { isRetryableError } from "./retry.ts";
import { commitSandboxChanges } from "./sandbox-git.ts";
import { cleanupSandbox, getModifiedFiles, getSandboxBase } from "./sandbox.ts";
import type { ExecutionOptions, ExecutionResult } from "./sequential.ts";
import { type StateFormat, TaskState, TaskStateManager, detectStateFormat } from "./task-state.ts";

const GLOBAL_MERGE_LOCK_TIMEOUT_MS = 300000; // 5 minutes timeout for merge operations
const WORKTREE_TRACKING_FILE = ".ralphy-worktrees/tracked.json";

interface TrackedWorktree {
	worktreeDir: string;
	branchName: string;
	createdAt: number;
	pid: number;
}

/**
 * Read tracking file atomically using rename trick
 */
function readTrackingFile(wd: string): TrackedWorktree[] {
	const trackingFile = join(wd, WORKTREE_TRACKING_FILE);
	if (!existsSync(trackingFile)) return [];
	try {
		return JSON.parse(readFileSync(trackingFile, "utf8"));
	} catch (err) {
		logWarn(`Tracking file unreadable/corrupted: ${err}`);
		throw err;
	}
}

/**
 * Write tracking file atomically using rename (atomic on POSIX, best effort on Windows)
 */
function writeTrackingFile(wd: string, tracked: TrackedWorktree[]): void {
	const trackingFile = join(wd, WORKTREE_TRACKING_FILE);
	const trackingDir = join(wd, ".ralphy-worktrees");
	const tempFile = join(wd, `${WORKTREE_TRACKING_FILE}.tmp.${Date.now()}.${process.pid}`);
	try {
		if (!existsSync(trackingDir)) {
			mkdirSync(trackingDir, { recursive: true });
		}
		writeFileSync(tempFile, JSON.stringify(tracked, null, 2));
		renameSync(tempFile, trackingFile);
	} catch (err) {
		// Clean up temp file if it exists
		try {
			if (existsSync(tempFile)) unlinkSync(tempFile);
		} catch {
			/* ignore cleanup failure */
		}
		// Fallback: direct write if rename fails
		try {
			writeFileSync(trackingFile, JSON.stringify(tracked, null, 2));
		} catch (writeErr) {
			logDebug(`Failed to write tracking file: ${writeErr}`);
		}
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? (error as { code?: string }).code
				: undefined;
		// EPERM means process exists but we don't have permission to signal it.
		if (code === "EPERM") {
			return true;
		}
		return false;
	}
}

function isTrackedWorktreePathSafe(workDir: string, worktreeDir: string): boolean {
	const worktreeBase = getWorktreeBase(workDir);
	const baseResolved = resolve(worktreeBase);
	const targetResolved = resolve(worktreeDir);
	return targetResolved !== baseResolved && targetResolved.startsWith(`${baseResolved}${sep}`);
}

/**
 * Track a worktree for cleanup tracking (persistent across process crashes)
 */
function trackWorktree(wd: string, worktreeDir: string, branchName: string): void {
	try {
		const tracked = readTrackingFile(wd);
		tracked.push({
			worktreeDir,
			branchName,
			createdAt: Date.now(),
			pid: process.pid,
		});
		writeTrackingFile(wd, tracked);
	} catch (err) {
		logDebug(`Failed to track worktree: ${err}`);
	}
}

/**
 * Untrack a worktree after successful cleanup
 */
function untrackWorktree(wd: string, worktreeDir: string): void {
	try {
		const tracked = readTrackingFile(wd);
		const filtered = tracked.filter((t) => t.worktreeDir !== worktreeDir);
		writeTrackingFile(wd, filtered);
	} catch (err) {
		logDebug(`Failed to untrack worktree: ${err}`);
	}
}

/**
 * Cleanup orphaned worktrees from previous runs
 */
async function cleanupOrphanedWorktrees(wd: string): Promise<void> {
	const trackingFile = join(wd, WORKTREE_TRACKING_FILE);
	if (!existsSync(trackingFile)) return;

	try {
		const tracked: TrackedWorktree[] = JSON.parse(readFileSync(trackingFile, "utf8"));

		let cleaned = 0;
		const remaining: TrackedWorktree[] = [];

		for (const entry of tracked) {
			if (!isTrackedWorktreePathSafe(wd, entry.worktreeDir)) {
				logWarn(`Skipping unsafe tracked worktree path: ${entry.worktreeDir}`);
				continue;
			}

			// Check if worktree directory still exists
			if (existsSync(entry.worktreeDir)) {
				if (isProcessAlive(entry.pid)) {
					// Process still running, keep tracking
					remaining.push(entry);
					continue;
				}

				logDebug(`Process ${entry.pid} not running, cleaning worktree`);
				// Process dead - clean up stale worktree
				try {
					const git = simpleGit(wd);
					try {
						await git.raw(["worktree", "remove", "-f", entry.worktreeDir]);
						if (entry.branchName) {
							try {
								await git.raw(["branch", "-D", entry.branchName]);
							} catch (branchErr) {
								logDebug(`Branch cleanup skipped for ${entry.branchName}: ${branchErr}`);
							}
						}
					} catch (gitErr) {
						logDebug(`Git worktree remove failed: ${gitErr}`);
						if (existsSync(entry.worktreeDir)) {
							rmSync(entry.worktreeDir, { recursive: true, force: true });
						}
					}
					cleaned++;
				} catch (cleanupErr) {
					logDebug(`Failed to cleanup worktree ${entry.worktreeDir}: ${cleanupErr}`);
					// Keep in tracking if cleanup failed
					remaining.push(entry);
				}
			}
		}

		if (cleaned > 0) {
			logInfo(`Cleaned up ${cleaned} orphaned worktrees`);
		}

		writeTrackingFile(wd, remaining);
	} catch (err) {
		logDebug(`Failed to cleanup orphaned worktrees: ${err}`);
	}
}

/**
 * Acquire a global merge lock for cross-process coordination.
 * Uses atomic file operations to prevent race conditions between simultaneous ralphy runs.
 */
function acquireGlobalMergeLock(workDir: string): { release: () => void } | null {
	const lockDir = join(workDir, ".ralphy");
	const lockFile = join(lockDir, ".global-merge.lock");

	if (!existsSync(lockDir)) {
		mkdirSync(lockDir, { recursive: true });
	}

	try {
		writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), {
			flag: "wx",
		});
		logDebug(`Acquired global merge lock: ${lockFile}`);

		return {
			release: () => {
				try {
					if (existsSync(lockFile)) {
						unlinkSync(lockFile);
						logDebug("Released global merge lock");
					}
				} catch (err) {
					logDebug(`Failed to release global merge lock: ${err}`);
				}
			},
		};
	} catch (_error) {
		try {
			if (existsSync(lockFile)) {
				const staleFile = join(lockDir, `.stale-merge-${Date.now()}.lock`);
				try {
					renameSync(lockFile, staleFile);

					const content = readFileSync(staleFile, "utf8");
					let lockData: { timestamp?: number } = {};
					try {
						const parsed = JSON.parse(content) as unknown;
						if (parsed && typeof parsed === "object" && "timestamp" in parsed) {
							const candidate = parsed as { timestamp?: unknown };
							if (typeof candidate.timestamp === "number") {
								lockData = { timestamp: candidate.timestamp };
							}
						}
					} catch {
						logWarn("Global merge lock contained invalid JSON, treating as stale");
					}

					const age = Date.now() - (lockData.timestamp || 0);
					if (age > GLOBAL_MERGE_LOCK_TIMEOUT_MS) {
						logWarn("Found stale global merge lock, removing and retrying...");
						unlinkSync(staleFile);
						return acquireGlobalMergeLock(workDir);
					}

					renameSync(staleFile, lockFile);
					if (existsSync(staleFile)) {
						unlinkSync(staleFile);
					}
					return null;
				} catch {
					logDebug("Another process acquired merge lock during stale check");
					return null;
				}
			}
		} catch {
			try {
				const corruptFile = join(lockDir, `.corrupt-merge-${Date.now()}.lock`);
				renameSync(lockFile, corruptFile);
				unlinkSync(corruptFile);
				return acquireGlobalMergeLock(workDir);
			} catch (recoverErr) {
				logDebug(`Failed to recover from corrupt lock: ${recoverErr}`);
			}
		}

		return null;
	}
}

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

	// Cleanup orphaned worktrees from previous runs
	await cleanupOrphanedWorktrees(workDir);

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

	// Determine isolation mode (worktree vs sandbox)
	let effectiveUseSandbox = useSandbox;
	let worktreeFallbackToSandbox = false;
	if (!effectiveUseSandbox && !canUseWorktrees(workDir)) {
		logWarn("Worktrees unavailable in this repo; falling back to sandbox mode.");
		effectiveUseSandbox = true;
		worktreeFallbackToSandbox = true;
	}
	const effectiveNoGitParallel =
		effectiveUseSandbox && (noGitParallel || worktreeFallbackToSandbox);

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

			// Map pending state entries to full task objects (single pass)
			const tasks: Task[] = [];
			for (const pt of pendingTasks) {
				const task = allSourceTasks.find((t) => t.id === pt.id);
				if (task) {
					tasks.push(task);
				}
			}

			// Filter out already processed tasks in dry-run mode and tasks exceeding max attempts
			const filteredTasks: Task[] = [];
			for (const task of tasks) {
				// Skip already processed tasks in dry-run mode
				if (dryRun && dryRunProcessedIds.has(task.id)) {
					continue;
				}

				// Filter out tasks that have exceeded max attempts
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

			// Use graph coloring to select the next conflict-aware batch when file information is available.
			let batch: Task[] = [];
			const plannedTasks = filteredTasks.map((t) => taskToPlannedTask(t, t.body || ""));
			const tasksWithFiles = plannedTasks.filter((pt) => pt.files.length > 0);

			if (tasksWithFiles.length === filteredTasks.length && tasksWithFiles.length > 1) {
				logDebug("Using graph coloring to pick next conflict-aware batch...");
				const graph = buildConflictGraph(plannedTasks);
				const colors = colorGraph(plannedTasks, graph);
				const batches = batchByColor(plannedTasks, colors, maxParallel);

				const batchKeys = Array.from(batches.keys()).sort((a, b) => a - b);
				if (batchKeys.length > 0) {
					const firstBatch = batches.get(batchKeys[0]);
					batch = firstBatch?.map((pt) => pt.task) || [];
				} else {
					batch = filteredTasks.slice(0, maxParallel);
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

			// Claim tasks for execution before starting
			const claimedTasks: Array<{ task: Task; agentNum: number }> = [];
			for (const task of batch) {
				// Pass maxRetries for atomic check-and-claim
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
					logDebug(
						`Task "${task.title}" is already being executed or exceeded max attempts, skipping...`,
					);
				}
			}

			if (claimedTasks.length === 0) {
				// No tasks could be claimed, continue to next batch
				continue;
			}

			// Parallel execution
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
					onWorktreeCreated: (worktreeDir, branchName) => {
						trackWorktree(workDir, worktreeDir, branchName);
					},
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
					noGitParallel: effectiveNoGitParallel,
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
				const planningKeywords = ["planning phase", "plan task files", "file analysis"];
				return planningKeywords.some((keyword) => error.toLowerCase().includes(keyword));
			};

			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				// BUG FIX: Add bounds check to prevent undefined task access
				const claimedTask = claimedTasks[i];
				const task = claimedTask?.task;
				if (!task) {
					logError(`Task index ${i} out of bounds (claimedTasks.length=${claimedTasks.length})`);
					continue;
				}

				if (res.status === "rejected") {
					const error = res.reason;
					const errorMessage = String(error);
					allErrors.push({ task, error: String(error) });
					logError(`Task "${task.title}" failed: ${error}`);

					// Check if failure is planning-related
					if (isPlanningRejection(error)) {
						// Planning phase failed - transition to failed state but don't mark complete
						logDebug(
							`Planning phase failed for task "${task.title}", transitioning to FAILED state`,
						);
						await taskStateManager.transitionState(task.id, TaskState.FAILED, String(error));
						await taskSource.markComplete(task.id);
						clearDeferredTask(taskSource.type, task, workDir, prdFile);
						continue;
					}

					const retryable = isRetryableError(errorMessage);
					if (retryable) {
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
						sawRetryableFailure = true;
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errorMessage}`);
							await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMessage);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, errorMessage);
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, prdFile);
						} else {
							logWarn(
								`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${errorMessage}`,
							);
							await taskStateManager.transitionState(task.id, TaskState.DEFERRED, errorMessage);
						}
						continue;
					}

					// Execution phase failure - transition to failed state
					await taskStateManager.transitionState(task.id, TaskState.FAILED, errorMessage);
					logTaskProgress(task.title, "failed", workDir);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMessage);
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
								logDebug(
									`Agent ${agentNum}: Committed ${commitResult.filesCommitted} files to ${finalBranchName}`,
								);
							} else {
								finalFailureReason =
									commitResult.error &&
									typeof commitResult.error === "object" &&
									"message" in commitResult.error
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
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, prdFile);
						sawRetryableFailure = true;
						if (deferrals >= maxRetries) {
							logError(
								`Task "${task.title}" failed after ${deferrals} deferrals: ${finalFailureReason}`,
							);
							await taskStateManager.transitionState(task.id, TaskState.FAILED, finalFailureReason);
							logTaskProgress(task.title, "failed", workDir);
							result.tasksFailed++;
							notifyTaskFailed(task.title, finalFailureReason);
							await taskSource.markComplete(task.id);
							clearDeferredTask(taskSource.type, task, workDir, prdFile);
						} else {
							logWarn(
								`Task "${task.title}" deferred (${deferrals}/${maxRetries}): ${finalFailureReason}`,
							);
							await taskStateManager.transitionState(
								task.id,
								TaskState.DEFERRED,
								finalFailureReason,
							);
						}
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
						worktreesToCleanup.push({ worktreeDir, branchName: finalBranchName || "" });
					}
				}
			}

			// Cleanup all worktrees in parallel with coordination
			if (worktreesToCleanup.length > 0) {
				const cleanupResults = await Promise.allSettled(
					worktreesToCleanup.map(({ worktreeDir, branchName }) =>
						cleanupAgentWorktree(worktreeDir, branchName, workDir).then((cleanup) => ({
							worktreeDir,
							leftInPlace: cleanup.leftInPlace,
						})),
					),
				);

				for (let i = 0; i < cleanupResults.length; i++) {
					const result = cleanupResults[i];
					const { worktreeDir } = worktreesToCleanup[i];
					if (result.status === "fulfilled") {
						if (result.value.leftInPlace) {
							logInfo(`Worktree left in place (uncommitted changes): ${worktreeDir}`);
						} else {
							// Successfully cleaned up - remove from tracking
							untrackWorktree(workDir, worktreeDir);
						}
					} else {
						logWarn(`Failed to cleanup worktree ${worktreeDir}: ${result.reason}`);
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
			// CRITICAL FIX: Use global cross-process lock for merge coordination
			const globalLock = acquireGlobalMergeLock(workDir);
			if (!globalLock) {
				logWarn("Could not acquire global merge lock, another ralphy instance may be merging");
				logInfo("Skipping merge phase - branches are preserved for manual merge");
				logInfo(`Branches to merge: ${completedBranches.join(", ")}`);
				// BUG FIX: Stop display before early return to prevent resource leak
				staticAgentDisplay.stopDisplay();
				// Don't throw - just skip the merge and preserve branches
				return result;
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
				globalLock.release();
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
	const analysesResults = await Promise.allSettled(
		branches.map((branch) => analyzePreMerge(branch, targetBranch, workDir)),
	);
	const analyses = analysesResults
		.map((result, index) => {
			if (result.status === "fulfilled") {
				return result.value;
			}
			logWarn(`Failed to analyze branch ${branches[index]}: ${result.reason}`);
			return null;
		})
		.filter((a): a is NonNullable<typeof a> => a !== null);

	const sortedAnalyses = sortByConflictLikelihood(analyses);
	const sortedBranches = sortedAnalyses.map((a) => a.branch);

	// BUG FIX: Check array bounds before accessing first element
	if (sortedBranches.length > 0 && branches.length > 0 && sortedBranches[0] !== branches[0]) {
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
		const deleteResults = await Promise.allSettled(
			merged.map(async (branch) => {
				const deleted = await deleteLocalBranch(branch, workDir, true);
				return { branch, deleted };
			}),
		);

		for (let i = 0; i < deleteResults.length; i++) {
			const result = deleteResults[i];
			const branch = merged[i];
			if (result.status === "fulfilled") {
				if (result.value.deleted) {
					logDebug(`Deleted merged branch: ${branch}`);
				}
			} else {
				logWarn(`Failed to delete branch ${branch}: ${result.reason}`);
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
