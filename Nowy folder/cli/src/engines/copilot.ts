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
 * GitHub Copilot CLI AI Engine
 */
export class CopilotEngine extends BaseAIEngine {
	name = "GitHub Copilot";
	cliCommand = "copilot";

	/**
	 * Build command arguments for Copilot CLI
	 * Returns args array and optional stdin content for Windows
	 */
	protected buildArgs(prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const { args } = this.buildArgsInternal(prompt, options);
		return args;
	}

	private buildArgsInternal(
		prompt: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string } {
		const args: string[] = [];

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p");
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		return { args, stdinContent };
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgsInternal(prompt, options);

		const startTime = Date.now();
		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			undefined,
			stdinContent,
		);
		const durationMs = Date.now() - startTime;

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

		// Parse Copilot output - extract response from output
		const response = this.parseOutput(output);

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
			inputTokens: 0, // Copilot CLI doesn't expose token counts in programmatic mode
			outputTokens: 0,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	private parseOutput(output: string): string {
		// Copilot CLI may output text responses
		// Extract the meaningful response, filtering out control characters and prompts
		// Note: These filter patterns are specific to current Copilot CLI behavior
		// and may need updates if the CLI output format changes
		const lines = output.split("\n").filter(Boolean);

		// Filter out empty lines and common CLI artifacts
		const meaningfulLines = lines.filter((line) => {
			const trimmed = line.trim();
			return (
				trimmed &&
				!trimmed.startsWith("?") && // Interactive prompts
				!trimmed.startsWith("❯") && // Command prompts
				!trimmed.includes("Thinking...") && // Status messages
				!trimmed.includes("Working on it...") // Status messages
			);
		});

		return meaningfulLines.join("\n") || "Task completed";
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgsInternal(prompt, options);

		const outputLines: string[] = [];
		const startTime = Date.now();

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

		const durationMs = Date.now() - startTime;
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

		// Parse Copilot output
		const response = this.parseOutput(output);

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
		const response = this.parseOutput(output);
		const error = checkForErrors(output);
		if (error) {
			return { success: false, response, inputTokens: 0, outputTokens: 0, error };
		}
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens: 0,
				outputTokens: 0,
				error: formatCommandError(exitCode, output),
			};
		}
		return { success: true, response, inputTokens: 0, outputTokens: 0 };
	}
}
