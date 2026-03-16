#!/usr/bin/env bun
import { parseArgs } from "./cli/args.ts";
import { addRule, showConfig } from "./cli/commands/config.ts";
import { runInit } from "./cli/commands/init.ts";
import { runLoop } from "./cli/commands/run.ts";
import { runSingleTaskLoop } from "./cli/commands/single-task-loop.ts";
import { loadConfig } from "./config/loader.ts";
import { flushAllProgressWrites } from "./config/writer.ts";
import { sendNotifications } from "./notifications/webhook.ts";
import { logError } from "./ui/logger.ts";
import { notify } from "./ui/notify.ts";

async function main(): Promise<void> {
	try {
		const {
			options,
			task,
			initMode,
			showConfig: showConfigMode,
			addRule: rule,
		} = parseArgs(process.argv);

		// Handle --init
		if (initMode) {
			await runInit();
			return;
		}

		// Handle --config
		if (showConfigMode) {
			await showConfig();
			return;
		}

		// Handle --add-rule
		if (rule) {
			await addRule(rule);
			return;
		}

		// Single task mode (brownfield)
		if (task) {
			const result = await runSingleTaskLoop(task, options);

			if (!options.dryRun) {
				const config = loadConfig(process.cwd());
				await sendNotifications(config, result.failed > 0 ? "failed" : "completed", {
					tasksCompleted: result.completed,
					tasksFailed: result.failed,
				});

				if (options.repeatCount > 1) {
					const skipped = result.total - result.completed - result.failed;
					const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : "";
					if (result.failed > 0) {
						notify(
							"Ralphy - Error",
							`Repeated task finished: ${result.completed}/${result.total} succeeded, ${result.failed} failed${skippedSuffix}`,
						);
					} else {
						notify(
							"Ralphy",
							`Repeated task completed: ${result.completed}/${result.total} succeeded${skippedSuffix}`,
						);
					}
				}
			}

			if (result.failed > 0) {
				process.exitCode = 1;
			}
			return;
		}

		// PRD loop mode
		await runLoop(options);
	} catch (error) {
		logError(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		// Ensure all progress writes are flushed before exit
		await flushAllProgressWrites();
	}
}

main();
