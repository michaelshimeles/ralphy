import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AIEngine, AIResult } from "../engines/types.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { YamlTaskSource } from "../tasks/yaml.ts";
import { PROGRESS_FILE, RALPHY_DIR } from "../config/loader.ts";
import { logTaskProgress } from "../config/writer.ts";
import { logDebug, logError, logInfo, logSuccess } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import {
	cleanupAgentWorktree,
	createAgentWorktree,
	getWorktreeBase,
} from "../git/worktree.ts";
import { buildParallelPrompt } from "./prompt.ts";
import { isRetryableError, sleep, withRetry } from "./retry.ts";
import type { ExecutionOptions, ExecutionResult } from "./sequential.ts";

interface ParallelAgentResult {
	task: Task;
	worktreeDir: string;
	branchName: string;
	result: AIResult | null;
	error?: string;
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
	maxRetries: number,
	retryDelay: number,
	skipTests: boolean,
	skipLint: boolean,
	browserEnabled: "auto" | "true" | "false"
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
			originalDir
		);
		worktreeDir = worktree.worktreeDir;
		branchName = worktree.branchName;

		logDebug(`Agent ${agentNum}: Created worktree at ${worktreeDir}`);

		// Copy PRD file to worktree
		if (prdSource === "markdown" || prdSource === "yaml") {
			const srcPath = join(originalDir, prdFile);
			const destPath = join(worktreeDir, prdFile);
			if (existsSync(srcPath)) {
				copyFileSync(srcPath, destPath);
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
			skipTests,
			skipLint,
			browserEnabled,
		});

		// Execute with retry
		const result = await withRetry(
			async () => {
				const res = await engine.execute(prompt, worktreeDir);
				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}
				return res;
			},
			{ maxRetries, retryDelay }
		);

		return { task, worktreeDir, branchName, result };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return { task, worktreeDir, branchName, result: null, error: errorMsg };
	}
}

/**
 * Run tasks in parallel using worktrees
 */
export async function runParallel(
	options: ExecutionOptions & { maxParallel: number; prdSource: string; prdFile: string }
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
		browserEnabled,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	// Get worktree base directory
	const worktreeBase = getWorktreeBase(workDir);
	logDebug(`Worktree base: ${worktreeBase}`);

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

		// For YAML sources, try to get tasks from the same parallel group
		if (taskSource instanceof YamlTaskSource) {
			const nextTask = await taskSource.getNextTask();
			if (!nextTask) break;

			const group = await taskSource.getParallelGroup(nextTask.title);
			if (group > 0) {
				tasks = await taskSource.getTasksInGroup(group);
			} else {
				tasks = [nextTask];
			}
		} else {
			// For other sources, get all remaining tasks
			tasks = await taskSource.getAllTasks();
		}

		if (tasks.length === 0) {
			logSuccess("All tasks completed!");
			break;
		}

		// Limit to maxParallel
		const batch = tasks.slice(0, maxParallel);
		iteration++;

		logInfo(`Batch ${iteration}: ${batch.length} tasks in parallel`);

		if (dryRun) {
			logInfo("(dry run) Skipping batch");
			continue;
		}

		// Run agents in parallel
		const promises = batch.map((task, i) =>
			runAgentInWorktree(
				engine,
				task,
				i + 1,
				baseBranch,
				worktreeBase,
				workDir,
				prdSource,
				prdFile,
				maxRetries,
				retryDelay,
				skipTests,
				skipLint,
				browserEnabled
			)
		);

		const results = await Promise.all(promises);

		// Process results
		for (const agentResult of results) {
			const { task, worktreeDir, branchName, result: aiResult, error } = agentResult;

			if (error) {
				logError(`Task "${task.title}" failed: ${error}`);
				logTaskProgress(task.title, "failed", workDir);
				result.tasksFailed++;
				notifyTaskFailed(task.title, error);
			} else if (aiResult?.success) {
				logSuccess(`Task "${task.title}" completed`);
				result.totalInputTokens += aiResult.inputTokens;
				result.totalOutputTokens += aiResult.outputTokens;

				await taskSource.markComplete(task.id);
				logTaskProgress(task.title, "completed", workDir);
				result.tasksCompleted++;
				notifyTaskComplete(task.title);
			} else {
				const errMsg = aiResult?.error || "Unknown error";
				logError(`Task "${task.title}" failed: ${errMsg}`);
				logTaskProgress(task.title, "failed", workDir);
				result.tasksFailed++;
				notifyTaskFailed(task.title, errMsg);
			}

			// Cleanup worktree
			if (worktreeDir) {
				const cleanup = await cleanupAgentWorktree(worktreeDir, branchName, workDir);
				if (cleanup.leftInPlace) {
					logInfo(`Worktree left in place (uncommitted changes): ${worktreeDir}`);
				}
			}
		}
	}

	return result;
}
