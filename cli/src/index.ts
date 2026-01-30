#!/usr/bin/env bun
import { parseArgs } from "./cli/args.ts";
import { addRule, showConfig } from "./cli/commands/config.ts";
import { runConvert } from "./cli/commands/convert.ts";
import { runInit } from "./cli/commands/init.ts";
import { runLoop } from "./cli/commands/run.ts";
import { runTask } from "./cli/commands/task.ts";
import { logError } from "./ui/logger.ts";
import { runCleanup, setupSignalHandlers } from "./utils/cleanup.ts";

// Setup global cleanup and signal handlers
setupSignalHandlers();

// Handle unhandled promise rejections globally
process.on("unhandledRejection", (reason, promise) => {
	logError(`Unhandled Promise Rejection: ${reason}`);
	logError(`Promise: ${promise}`);
	// Don't crash, but log and continue - prevent uncaught exception
});

// Handle uncaught exceptions globally
process.on("uncaughtException", (error) => {
	logError(`Uncaught Exception: ${error.message}`);
	logError(`Stack: ${error.stack}`);
	// Perform cleanup before exiting
	runCleanup()
		.then(() => {
			process.exit(1);
		})
		.catch(() => {
			process.exit(1);
		});
});

async function main(): Promise<void> {
	try {
		const {
			options,
			task,
			initMode,
			showConfig: showConfigMode,
			addRule: rule,
			convertFrom,
			convertTo,
		} = parseArgs(process.argv);

		// Handle --convert-from
		if (convertFrom) {
			const outputFile = convertTo || convertFrom.replace(/\.(yaml|yml|md|json)$/i, ".csv");
			await runConvert({ from: convertFrom, to: outputFile, verbose: options.verbose });
			return;
		}

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
		await runCleanup();
		process.exit(1);
	}
}

main();
