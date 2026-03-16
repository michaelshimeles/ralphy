import type { RuntimeOptions } from "../../config/types.ts";
import { logInfo } from "../../ui/logger.ts";
import { type TaskRunResult, runTask } from "./task.ts";

type TaskRunner = (task: string, options: RuntimeOptions) => Promise<TaskRunResult>;
type InfoLogger = (message: string) => void;

export interface SingleTaskLoopResult {
	total: number;
	completed: number;
	failed: number;
}

/**
 * Run the single-task flow with optional repeat behavior.
 */
export async function runSingleTaskLoop(
	task: string,
	options: RuntimeOptions,
	deps?: {
		runTaskFn?: TaskRunner;
		logInfoFn?: InfoLogger;
	},
): Promise<SingleTaskLoopResult> {
	const runTaskFn = deps?.runTaskFn ?? runTask;
	const logInfoFn = deps?.logInfoFn ?? logInfo;

	const total = options.repeatCount;

	// Dry-run: show prompt once, skip repeat iterations
	if (options.dryRun) {
		await runTaskFn(task, options);
		return { total, completed: 0, failed: 0 };
	}

	let completed = 0;
	let failed = 0;

	for (let i = 1; i <= total; i++) {
		if (total > 1) {
			logInfoFn(`[${i}/${total}] Executing: ${task}`);
		}

		const result = await runTaskFn(task, options);
		if (result.success) {
			completed++;
			continue;
		}

		failed++;
		if (result.fatal || !options.continueOnFailure) {
			break;
		}
	}

	if (total > 1) {
		const skipped = total - completed - failed;
		const parts = [`${completed} succeeded`, `${failed} failed`];
		if (skipped > 0) parts.push(`${skipped} skipped`);
		logInfoFn(`Done: ${parts.join(", ")} of ${total}`);
	}

	return { total, completed, failed };
}
