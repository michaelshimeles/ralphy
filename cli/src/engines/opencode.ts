import { BaseAIEngine, checkForErrors, execCommand } from "./base.ts";
import type { AIResult } from "./types.ts";

/**
 * OpenCode AI Engine
 */
export class OpenCodeEngine extends BaseAIEngine {
	name = "OpenCode";
	cliCommand = "opencode";

	async execute(prompt: string, workDir: string): Promise<AIResult> {
		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			["run", "--format", "json", prompt],
			workDir,
			{ OPENCODE_PERMISSION: '{"*":"allow"}' }
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

		return {
			success: exitCode === 0,
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
