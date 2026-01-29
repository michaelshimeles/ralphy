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
 * Ollama (via Claude Code CLI) AI Engine
 * 
 * Uses local Ollama models through Claude Code's Anthropic-compatible API.
 * Requires Ollama running locally (default: http://localhost:11434)
 * 
 * Recommended models: gpt-oss:20b, glm-4.7, gpt-oss:20b, gpt-oss:120b
 * Note: Requires models with at least 64k context window
 */
export class OllamaEngine extends BaseAIEngine {
	name = "Ollama (Claude Code)";
	cliCommand = "claude";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		
		// Default model for Ollama (can be overridden)
		const model = options?.modelOverride || "gpt-oss:20b";
		args.push("--model", model);

		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		// On other platforms, pass as argument for compatibility
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p"); // Enable print mode, prompt comes from stdin
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		// Set Ollama-specific environment variables for Claude Code
		const ollamaEnv = {
			ANTHROPIC_AUTH_TOKEN: "ollama",
			ANTHROPIC_API_KEY: "",
			ANTHROPIC_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
		};

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			ollamaEnv,
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

		// Parse result
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
		onProgress?: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		
		// Default model for Ollama (can be overridden)
		const model = options?.modelOverride || "gpt-oss:20b";
		args.push("--model", model);

		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		// On other platforms, pass as argument for compatibility
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p"); // Enable print mode, prompt comes from stdin
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		// Set Ollama-specific environment variables for Claude Code
		const ollamaEnv = {
			ANTHROPIC_AUTH_TOKEN: "ollama",
			ANTHROPIC_API_KEY: "",
			ANTHROPIC_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
		};

		const outputLines: string[] = [];
		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			args,
			workDir,
			(line: string) => {
				outputLines.push(line);
				if (onProgress) {
					const detectedStep = detectStepFromOutput(line);
					// Avoid showing literal "null" or empty lines as the step
					const safeLine = line && line.trim() !== "null" ? line : "Working";
					onProgress(detectedStep || safeLine);
				}
			},
			ollamaEnv,
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

		// Parse result
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
