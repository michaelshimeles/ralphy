import {
	BaseAIEngine,
	checkForErrors,
	execCommand,
	execCommandStreaming,
	logVerboseEvent,
} from "./base.ts";
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

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			args,
			workDir,
			(line) => {
				outputLines.push(line);
				logVerboseEvent(line);
			},
			{ OPENCODE_PERMISSION: '{"*":"allow"}' },
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

		// Parse OpenCode JSON format
		const { response, inputTokens, outputTokens, cost } = this.parseOutput(output);

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: `Command failed with exit code ${exitCode}`,
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
