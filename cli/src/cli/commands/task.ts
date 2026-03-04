import { loadConfig } from "../../config/loader.ts";
import type { RuntimeOptions } from "../../config/types.ts";
import { logTaskProgress } from "../../config/writer.ts";
import { createEngine, isEngineAvailable } from "../../engines/index.ts";
import type { AIEngineName } from "../../engines/types.ts";
import { isBrowserAvailable } from "../../execution/browser.ts";
import { buildPrompt } from "../../execution/prompt.ts";
import { isRetryableError, withRetry } from "../../execution/retry.ts";
import { sendNotifications } from "../../notifications/webhook.ts";
import { formatTokens, logInfo, setVerbose } from "../../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../../ui/notify.ts";
import { buildActiveSettings } from "../../ui/settings.ts";
import { ProgressSpinner } from "../../ui/spinner.ts";
import { standardizeError } from "../../utils/errors.ts";

/**
 * Run a single task (brownfield mode)
 */
export async function runTask(task: string, options: RuntimeOptions): Promise<void> {
	const workDir = process.cwd();
	const config = loadConfig(workDir);

	// Set verbose mode
	setVerbose(options.verbose);

	// Check engine availability
	const engine = createEngine(options.aiEngine as AIEngineName);
	const available = await isEngineAvailable(options.aiEngine as AIEngineName);

	if (!available) {
		throw new Error(
			`${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`,
		);
	}

	logInfo(`Running task with ${engine.name}...`);

	// Check browser availability
	if (isBrowserAvailable(options.browserEnabled)) {
		logInfo("Browser automation enabled (agent-browser)");
	}

	// Build prompt
	const prompt = buildPrompt({
		task,
		autoCommit: options.autoCommit,
		workDir,
		browserEnabled: options.browserEnabled,
		skipTests: options.skipTests,
		skipLint: options.skipLint,
	});

	// Build active settings for display
	const activeSettings = buildActiveSettings(options);

	// Execute with spinner
	const spinner = new ProgressSpinner(task, activeSettings);

	if (options.dryRun) {
		spinner.success("(dry run) Would execute task");
		logInfo("\nPrompt preview hidden in dry-run to avoid leaking sensitive content.");
		logInfo(`Prompt length: ${prompt.length} chars`);
		return;
	}

	try {
		const result = await withRetry(
			async () => {
				spinner.updateStep("Working");

				// Build engine options
				const engineOptions = {
					...(options.modelOverride && { modelOverride: options.modelOverride }),
					...(options.engineArgs &&
						options.engineArgs.length > 0 && { engineArgs: options.engineArgs }),
					...(options.debugOpenCode && { debugOpenCode: options.debugOpenCode }),
					...(options.dryRun && { dryRun: true }),
				};

				// Use streaming if available
				if (engine.executeStreaming) {
					return await engine.executeStreaming(
						prompt,
						workDir,
						(step) => {
							spinner.updateStep(step);
						},
						engineOptions,
					);
				}

				const res = await engine.execute(prompt, workDir, engineOptions);

				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}

				return res;
			},
			{
				maxRetries: options.maxRetries,
				retryDelay: options.retryDelay,
				onRetry: (attempt) => {
					spinner.updateStep(`Retry ${attempt}`);
				},
			},
		);

		if (result.success) {
			const tokens = formatTokens(result.inputTokens, result.outputTokens);
			spinner.success(`Done ${tokens}`);

			logTaskProgress(task, "completed", workDir);
			await sendNotifications(config, "completed", {
				tasksCompleted: 1,
				tasksFailed: 0,
			});
			notifyTaskComplete(task);

			// Show response summary
			if (result.response && result.response !== "Task completed") {
				logInfo("\nResult:");
				logInfo(result.response.slice(0, 500));
				if (result.response.length > 500) {
					logInfo("...");
				}
			}
		} else {
			throw new Error(result.error || "Task failed");
		}
	} catch (error) {
		const errorMsg = standardizeError(error).message;
		spinner.error(errorMsg);
		logTaskProgress(task, "failed", workDir);
		await sendNotifications(config, "failed", {
			tasksCompleted: 0,
			tasksFailed: 1,
		});
		notifyTaskFailed(task, errorMsg);
		throw error;
	}
}
