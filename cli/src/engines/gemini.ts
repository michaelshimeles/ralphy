import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	parseStreamJsonResult,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Gemini CLI AI Engine
 */
export class GeminiEngine extends BaseAIEngine {
	name = "Gemini CLI";
	cliCommand = "gemini";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["--approval-mode", "yolo", "-o", "stream-json"];
		if (options?.modelOverride) {
			args.push("-m", options.modelOverride);
		}
		// Gemini uses positional argument for prompt (not -p)
		args.push(prompt);

		const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);

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

		// Parse result (same format as Claude/Qwen)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		return {
			success: exitCode === 0,
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
		const args = ["--approval-mode", "yolo", "-o", "stream-json"];
		if (options?.modelOverride) {
			args.push("-m", options.modelOverride);
		}
		// Gemini uses positional argument for prompt (not -p)
		args.push(prompt);

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(this.cliCommand, args, workDir, (line) => {
			outputLines.push(line);

			// Detect and report step changes
			const step = detectStepFromOutput(line);
			if (step) {
				onProgress(step);
			}
		});

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

		// Parse result (same format as Claude/Qwen)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
		};
	}
}
