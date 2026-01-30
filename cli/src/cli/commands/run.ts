import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../config/loader.ts";
import type { RuntimeOptions } from "../../config/types.ts";
import { createEngine, isEngineAvailable } from "../../engines/index.ts";
import type { AIEngineName } from "../../engines/types.ts";
import { isBrowserAvailable } from "../../execution/browser.ts";
import { runParallel } from "../../execution/parallel.ts";
import { runParallelNoGit } from "../../execution/parallel-no-git.ts";
import { type ExecutionResult, runSequential } from "../../execution/sequential.ts";
import { getDefaultBaseBranch } from "../../git/branch.ts";
import { sendNotifications } from "../../notifications/webhook.ts";
import { CachedTaskSource, createTaskSource } from "../../tasks/index.ts";
import {
	formatDuration,
	formatTokens,
	logInfo,
	logSuccess,
	setDebug,
	setVerbose,
} from "../../ui/logger.ts";
import { notifyAllComplete } from "../../ui/notify.ts";
import { buildActiveSettings } from "../../ui/settings.ts";
import { registerCleanup } from "../../utils/cleanup.ts";

/**
 * Run the PRD loop (multiple tasks from file/GitHub)
 */
export async function runLoop(options: RuntimeOptions): Promise<void> {
	// Keep workDir as cwd - don't change based on prdFile location
	// This preserves relative path behavior expected by task code
	const workDir = process.cwd();

	const startTime = Date.now();
	const config = loadConfig(workDir);

	// Set verbose mode
	setVerbose(options.verbose);
	if (options.debug) {
		setDebug(true);
		// Also set environment variable for base.ts debug logging
		process.env.RALPHY_DEBUG = "true";
	}

	// Validate PRD source
	if (options.prdSource === "markdown" || options.prdSource === "yaml") {
		if (!existsSync(options.prdFile)) {
			throw new Error(
				`${options.prdFile} not found in current directory. Create a ${options.prdFile} file with tasks.`,
			);
		}
	} else if (options.prdSource === "markdown-folder") {
		if (!existsSync(options.prdFile)) {
			throw new Error(
				`PRD folder ${options.prdFile} not found. Create a ${options.prdFile}/ folder with markdown files containing tasks.`,
			);
		}
	}

	if (options.prdSource === "github" && !options.githubRepo) {
		throw new Error("GitHub repository not specified. Use --github owner/repo");
	}

	// Check engine availability
	const engine = createEngine(options.aiEngine as AIEngineName);
	const available = await isEngineAvailable(options.aiEngine as AIEngineName);

	if (!available) {
		throw new Error(
			`${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`,
		);
	}

	// Create task source with caching for better performance
	// Caching reduces file I/O by loading tasks once and batching writes
	const innerTaskSource = createTaskSource({
		type: options.prdSource,
		filePath: options.prdFile,
		repo: options.githubRepo,
		label: options.githubLabel,
	});
	const taskSource = new CachedTaskSource(innerTaskSource);

	// Register for cleanup
	registerCleanup(async () => {
		await taskSource.flush();
		taskSource.dispose();
	});

	// Check if there are tasks
	const remaining = await taskSource.countRemaining();
	if (remaining === 0) {
		logSuccess("No tasks remaining. All done!");
		return;
	}

	// Get base branch if needed
	let baseBranch = options.baseBranch;
	if ((options.branchPerTask || options.parallel || options.createPr) && !baseBranch) {
		baseBranch = await getDefaultBaseBranch(workDir);

		// Check if base branch is empty (unborn branch - no commits yet)
		if (!baseBranch) {
			throw new Error(
				"Cannot run in parallel/branch mode: repository has no commits yet. Please make an initial commit first.",
			);
		}
	}

	logInfo(`Starting Ralphy with ${engine.name}`);
	logInfo(`Tasks remaining: ${remaining}`);
	if (options.parallel) {
		logInfo(`Mode: Parallel (max ${options.maxParallel} agents)`);
	} else {
		logInfo("Mode: Sequential");
	}
	if (isBrowserAvailable(options.browserEnabled)) {
		logInfo("Browser automation enabled (agent-browser)");
	}
	logInfo("");

	// Note: planning model configuration checked implicitly during planning phase
	if (options.planningModel) {
		logInfo(`Planning model configured: ${options.planningModel}`);
	}

	// Build active settings for display
	const activeSettings = buildActiveSettings(options);

	// Run tasks
	let result: ExecutionResult;
	if (options.parallel) {
		if (options.noGitParallel) {
			result = await runParallelNoGit({
				engine,
				taskSource,
				workDir,
				skipTests: options.skipTests,
				skipLint: options.skipLint,
				dryRun: options.dryRun,
				maxIterations: options.maxIterations,
				maxRetries: options.maxRetries,
				retryDelay: options.retryDelay,
				branchPerTask: options.branchPerTask,
				baseBranch,
				createPr: options.createPr,
				draftPr: options.draftPr,
				autoCommit: options.autoCommit,
				browserEnabled: options.browserEnabled,
				maxParallel: options.maxParallel,
				prdSource: options.prdSource,
				prdFile: options.prdFile,
				prdIsFolder: options.prdIsFolder,
				activeSettings,
				modelOverride: options.modelOverride,
				debug: options.debug,
				debugOpenCode: options.debugOpenCode,
				planningModel: options.planningModel,
			});
		} else {
			result = await runParallel({
				engine,
				taskSource,
				workDir,
				skipTests: options.skipTests,
				skipLint: options.skipLint,
				dryRun: options.dryRun,
				maxIterations: options.maxIterations,
				maxRetries: options.maxRetries,
				retryDelay: options.retryDelay,
				branchPerTask: options.branchPerTask,
				baseBranch,
				createPr: options.createPr,
				draftPr: options.draftPr,
				autoCommit: options.autoCommit,
				browserEnabled: options.browserEnabled,
				maxParallel: options.maxParallel,
				prdSource: options.prdSource,
				prdFile: options.prdFile,
				prdIsFolder: options.prdIsFolder,
				activeSettings,
				useSandbox: options.useSandbox,
				modelOverride: options.modelOverride,
				skipMerge: options.skipMerge,
				engineArgs: options.engineArgs,
				noGitParallel: options.noGitParallel,
				planningModel: options.planningModel,
				logThoughts: options.logThoughts,
				debug: options.debug,
				debugOpenCode: options.debugOpenCode,
			});
		}
	} else {
		result = await runSequential({
			engine,
			taskSource,
			workDir,
			skipTests: options.skipTests,
			skipLint: options.skipLint,
			dryRun: options.dryRun,
			maxIterations: options.maxIterations,
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			branchPerTask: options.branchPerTask,
			baseBranch,
			createPr: options.createPr,
			draftPr: options.draftPr,
			autoCommit: options.autoCommit,
			browserEnabled: options.browserEnabled,
			activeSettings,
			prdFile: options.prdFile,
			modelOverride: options.modelOverride,
			skipMerge: options.skipMerge,
			engineArgs: options.engineArgs,
			planningModel: options.planningModel,
			logThoughts: options.logThoughts,
			debug: options.debug,
			debugOpenCode: options.debugOpenCode,
		});
	}

	// Flush any pending task completions to disk and cleanup
	await taskSource.flush();
	taskSource.dispose();

	// Summary
	const duration = Date.now() - startTime;
	logInfo("");
	logInfo("=".repeat(50));
	logInfo("Summary:");
	logInfo(`  Completed: ${result.tasksCompleted}`);
	logInfo(`  Failed:    ${result.tasksFailed}`);
	logInfo(`  Duration:  ${formatDuration(duration)}`);
	if (result.totalInputTokens > 0 || result.totalOutputTokens > 0) {
		logInfo(`  Tokens:    ${formatTokens(result.totalInputTokens, result.totalOutputTokens)}`);
	}
	logInfo("=".repeat(50));

	// Send webhook notifications
	const status = result.tasksFailed > 0 ? "failed" : "completed";
	await sendNotifications(config, status, {
		tasksCompleted: result.tasksCompleted,
		tasksFailed: result.tasksFailed,
	});

	if (result.tasksCompleted > 0) {
		notifyAllComplete(result.tasksCompleted);
	}

	if (result.tasksFailed > 0) {
		process.exit(1);
	}
}
