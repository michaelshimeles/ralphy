import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, checkForErrors, execCommand, execCommandStreaming } from "./base.ts";
import { detectStepFromOutput, formatCommandError } from "./parsers.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Factory Droid AI Engine
 */
export class DroidEngine extends BaseAIEngine {
	name = "Factory Droid";
	cliCommand = "droid";

	protected buildArgs(_prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const { args } = this.buildArgsInternal(_prompt, options);
		return args;
	}

	private buildArgsInternal(
		prompt: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string } {
		const args = ["exec", "--output-format", "stream-json", "--auto", "medium"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		return this.buildArgsWithStdin(args, prompt);
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgsInternal(prompt, options);

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

		// Parse Droid output
		const { response, durationMs } = this.parseOutput(output);

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens: 0,
				outputTokens: 0,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens: 0, // Droid doesn't expose token counts in exec mode
			outputTokens: 0,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	private parseOutput(output: string): { response: string; durationMs: number } {
		const lines = output.split("\n").filter(Boolean);
		let response = "";
		let durationMs = 0;

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);

				// Check completion event
				if (parsed.type === "completion") {
					response = parsed.finalText || "Task completed";
					if (typeof parsed.durationMs === "number") {
						durationMs = parsed.durationMs;
					}
				}
			} catch (_err) {
				logDebug(`Droid: Failed to parse JSON line: ${_err}`);
			}
		}

		return { response: response || "Task completed", durationMs };
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgsInternal(prompt, options);

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

		// Parse Droid output
		const { response, durationMs } = this.parseOutput(output);

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens: 0,
				outputTokens: 0,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens: 0,
			outputTokens: 0,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	protected processCliResult(
		stdout: string,
		stderr: string,
		exitCode: number,
		_workDir: string,
	): AIResult {
		const output = stdout + stderr;
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

		const { response, durationMs } = this.parseOutput(output);

		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens: 0,
				outputTokens: 0,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens: 0,
			outputTokens: 0,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}
}
