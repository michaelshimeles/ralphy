import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	formatCommandError,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

const isWindows = process.platform === "win32";

/**
 * Factory Droid AI Engine
 */
export class DroidEngine extends BaseAIEngine {
	name = "Factory Droid";
	cliCommand = "droid";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["exec", "--output-format", "stream-json", "--auto", "medium"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues
		let stdinContent: string | undefined;
		if (isWindows) {
			stdinContent = prompt;
		} else {
			args.push(prompt);
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
			} catch {
				// Ignore non-JSON lines
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
		const args = ["exec", "--output-format", "stream-json", "--auto", "medium"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues
		let stdinContent: string | undefined;
		if (isWindows) {
			stdinContent = prompt;
		} else {
			args.push(prompt);
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

	protected buildArgs(_prompt: string, _workDir: string, _options?: EngineOptions): string[] {
		return [];
	}

	protected processCliResult(
		_stdout: string,
		_stderr: string,
		_exitCode: number,
		_workDir: string,
	): AIResult {
		return { success: true, response: "Not implemented", inputTokens: 0, outputTokens: 0 };
	}
}
