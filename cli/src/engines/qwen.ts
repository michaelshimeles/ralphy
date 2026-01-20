import {
	BaseAIEngine,
	checkForErrors,
	execCommand,
	execCommandStreaming,
	parseStreamJsonResult,
	detectStepFromOutput,
} from "./base.ts";
import type { AIResult, ProgressCallback } from "./types.ts";

/**
 * Qwen-Code AI Engine
 */
export class QwenEngine extends BaseAIEngine {
	name = "Qwen-Code";
	cliCommand = "qwen";

	async execute(prompt: string, workDir: string): Promise<AIResult> {
		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			["--output-format", "stream-json", "--approval-mode", "yolo", "-p", prompt],
			workDir
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

		// Parse result (same format as Claude)
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
		onProgress: ProgressCallback
	): Promise<AIResult> {
		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			["--output-format", "stream-json", "--approval-mode", "yolo", "-p", prompt],
			workDir,
			(line) => {
				outputLines.push(line);

				// Detect and report step changes
				const step = detectStepFromOutput(line);
				if (step) {
					onProgress(step);
				}
			}
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

		// Parse result (same format as Claude)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
		};
	}
}
