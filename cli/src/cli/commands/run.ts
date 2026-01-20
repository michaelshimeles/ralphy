import { existsSync } from "node:fs";
import type { AIEngineName } from "../../engines/types.ts";
import { createEngine, isEngineAvailable } from "../../engines/index.ts";
import { createTaskSource } from "../../tasks/index.ts";
import { runSequential } from "../../execution/sequential.ts";
import { runParallel } from "../../execution/parallel.ts";
import { isBrowserAvailable } from "../../execution/browser.ts";
import { getDefaultBaseBranch } from "../../git/branch.ts";
import { logError, logInfo, logSuccess, setVerbose, formatDuration, formatTokens } from "../../ui/logger.ts";
import { notifyAllComplete } from "../../ui/notify.ts";
import { buildActiveSettings } from "../../ui/settings.ts";
import type { RuntimeOptions } from "../../config/types.ts";

/**
 * Run the PRD loop (multiple tasks from file/GitHub)
 */
export async function runLoop(options: RuntimeOptions): Promise<void> {
	const workDir = process.cwd();
	const startTime = Date.now();

	// Set verbose mode
	setVerbose(options.verbose);

	// Validate PRD source
	if (options.prdSource === "markdown" || options.prdSource === "yaml") {
		if (!existsSync(options.prdFile)) {
			logError(`${options.prdFile} not found in current directory`);
			logInfo(`Create a ${options.prdFile} file with tasks`);
			process.exit(1);
		}
	}

	if (options.prdSource === "github" && !options.githubRepo) {
		logError("GitHub repository not specified. Use --github owner/repo");
		process.exit(1);
	}

	// Check engine availability
	const engine = createEngine(options.aiEngine as AIEngineName);
	const available = await isEngineAvailable(options.aiEngine as AIEngineName);

	if (!available) {
		logError(`${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`);
		process.exit(1);
	}

	// Create task source
	const taskSource = createTaskSource({
		type: options.prdSource,
		filePath: options.prdFile,
		repo: options.githubRepo,
		label: options.githubLabel,
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
	console.log("");

	// Build active settings for display
	const activeSettings = buildActiveSettings(options);

	// Run tasks
	let result;
	if (options.parallel) {
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
			activeSettings,
		});
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
		});
	}

	// Summary
	const duration = Date.now() - startTime;
	console.log("");
	console.log("=".repeat(50));
	logInfo("Summary:");
	console.log(`  Completed: ${result.tasksCompleted}`);
	console.log(`  Failed:    ${result.tasksFailed}`);
	console.log(`  Duration:  ${formatDuration(duration)}`);
	if (result.totalInputTokens > 0 || result.totalOutputTokens > 0) {
		console.log(`  Tokens:    ${formatTokens(result.totalInputTokens, result.totalOutputTokens)}`);
	}
	console.log("=".repeat(50));

	if (result.tasksCompleted > 0) {
		notifyAllComplete(result.tasksCompleted);
	}

	if (result.tasksFailed > 0) {
		process.exit(1);
	}
}
