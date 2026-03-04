#!/usr/bin/env bun
import { parseArgs } from "./cli/args.ts";
import { addRule, showConfig } from "./cli/commands/config.ts";
import { runInit } from "./cli/commands/init.ts";
import { runLoop } from "./cli/commands/run.ts";
import { runTask } from "./cli/commands/task.ts";
import { logError } from "./ui/logger.ts";

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
			await runTask(task, options);
			return;
		}

		// PRD loop mode
		await runLoop(options);
	} catch (error) {
		logError(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

main();
