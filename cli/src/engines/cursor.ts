import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, checkForErrors, execCommand, execCommandStreaming } from "./base.ts";
import { detectStepFromOutput, formatCommandError } from "./parsers.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Cursor Agent AI Engine
 */
export class CursorEngine extends BaseAIEngine {
	name = "Cursor Agent";
	cliCommand = "agent";

	protected buildArgs(prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const { args } = this.buildArgsInternal(prompt, options);
		return args;
	}

	private buildArgsInternal(
		prompt: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string } {
		const args = ["--print", "--force", "--output-format", "stream-json"];
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

		// Parse Cursor output
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
			inputTokens: 0, // Cursor doesn't provide token counts
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

				// Check result line
				if (parsed.type === "result") {
					response = parsed.result || "Task completed";
					if (typeof parsed.duration_ms === "number") {
						durationMs = parsed.duration_ms;
					}
				}

				// Check assistant message as fallback
				if (parsed.type === "assistant" && !response) {
					const content = parsed.message?.content;
					if (Array.isArray(content) && content[0]?.text) {
						response = content[0].text;
					} else if (typeof content === "string") {
						response = content;
					}
				}
			} catch (_err) {
				logDebug(`Cursor: Failed to parse JSON line: ${_err}`);
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

		// Parse Cursor output
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
			return { success: false, response: "", inputTokens: 0, outputTokens: 0, error };
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
