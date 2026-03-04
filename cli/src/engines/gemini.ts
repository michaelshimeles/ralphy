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

/**
 * Gemini CLI AI Engine
 * https://github.com/google-gemini/gemini-cli
 */
export class GeminiEngine extends BaseAIEngine {
	name = "Gemini CLI";
	cliCommand = "gemini";

	/**
	 * Build CLI arguments for Gemini
	 */
	protected buildArgs(prompt: string, workDir: string, options?: EngineOptions): string[] {
		const args = ["--output-format", "stream-json", "--yolo"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		// Pass prompt via stdin
		args.push("-p");
		return args;
	}

	/**
	 * Process CLI output into AIResult
	 */
	protected processCliResult(
		_stdout: string,
		_stderr: string,
		_exitCode: number,
		_workDir: string,
	): AIResult {
		throw new Error("GeminiEngine: use execute() or executeStreaming() directly");
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = this.buildArgs(prompt, workDir, options);
		const stdinContent = prompt;

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			this.getEnv(options),
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

		// Parse result (same format as Claude/Qwen)
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
		const args = this.buildArgs(prompt, workDir, options);
		const stdinContent = prompt;

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
			this.getEnv(options),
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

		// Parse result (same format as Claude/Qwen)
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
