import { BaseAIEngine, checkForErrors, execCommand, formatCommandError } from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

const isWindows = process.platform === "win32";

/**
 * OpenCode AI Engine
 */
export class OpenCodeEngine extends BaseAIEngine {
	name = "OpenCode";
	cliCommand = "opencode";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["run", "--format", "json"];
		// If the user passed an Ollama model (eg. "ollama/gpt-oss:20b"), they probably
		// intended to use the Ollama engine. Return a friendly error rather than
		// forwarding that model name into OpenCode where it may route incorrectly.
		if (options?.modelOverride && options.modelOverride.startsWith("ollama/")) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: "Model names prefixed with 'ollama/' should be used with --ollama instead of --opencode. Try: --ollama --model gpt-oss:20b",
			};
		}

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
			stdinContent = prompt;
		} else {
			args.push(prompt);
		}

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			{ OPENCODE_PERMISSION: '{"*":"allow"}' },
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

		// Parse OpenCode JSON format
		const { response, inputTokens, outputTokens, cost } = this.parseOutput(output);

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
			cost,
		};
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
		cost?: string;
	} {
		const lines = output.split("\n").filter(Boolean);
		let response = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let cost: string | undefined;

		// Find step_finish for token counts
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				if (parsed.type === "step_finish") {
					inputTokens = parsed.part?.tokens?.input || 0;
					outputTokens = parsed.part?.tokens?.output || 0;
					if (parsed.part?.cost) {
						cost = String(parsed.part.cost);
					}
				}
			} catch {
				// Ignore non-JSON lines
			}
		}

		// Get text response from text events
		const textParts: string[] = [];
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				if (parsed.type === "text" && parsed.part?.text) {
					textParts.push(parsed.part.text);
				}
			} catch {
				// Ignore non-JSON lines
			}
		}

		response = textParts.join("") || "Task completed";

		return { response, inputTokens, outputTokens, cost };
	}
}
