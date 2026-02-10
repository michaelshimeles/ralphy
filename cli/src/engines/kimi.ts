import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	formatCommandError,
	parseStreamJsonResult,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

const isWindows = process.platform === "win32";

/**
 * Kimi Code CLI AI Engine
 * https://github.com/MoonshotAI/kimi-cli
 */
export class KimiEngine extends BaseAIEngine {
	name = "Kimi Code";
	cliCommand = "kimi";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["--yolo", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p");
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			undefined,
			stdinContent,
		);

		const output = stdout + stderr;

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse result (same stream-json format as Claude/Qwen/Gemini)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens,
			outputTokens,
		};
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = ["--yolo", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p");
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			args,
			workDir,
			(line) => {
				outputLines.push(line);

				// Detect and report step changes
				const step = detectStepFromOutput(line);
				if (step) {
					onProgress(step);
				}
			},
			undefined,
			stdinContent,
		);

		const output = outputLines.join("\n");

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse result (same stream-json format as Claude/Qwen/Gemini)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens,
			outputTokens,
		};
	}
}
