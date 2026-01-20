import {
	BaseAIEngine,
	checkForErrors,
	execCommand,
	execCommandStreaming,
	detectStepFromOutput,
} from "./base.ts";
import type { AIResult, ProgressCallback } from "./types.ts";

/**
 * Cursor Agent AI Engine
 */
export class CursorEngine extends BaseAIEngine {
	name = "Cursor Agent";
	cliCommand = "agent";

	async execute(prompt: string, workDir: string): Promise<AIResult> {
		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			["--print", "--force", "--output-format", "stream-json", prompt],
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

		// Parse Cursor output
		const { response, durationMs } = this.parseOutput(output);

		return {
			success: exitCode === 0,
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
			} catch {
				// Ignore non-JSON lines
			}
		}

		return { response: response || "Task completed", durationMs };
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback
	): Promise<AIResult> {
		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			["--print", "--force", "--output-format", "stream-json", prompt],
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

		// Parse Cursor output
		const { response, durationMs } = this.parseOutput(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens: 0,
			outputTokens: 0,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}
}
