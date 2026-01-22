import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	parseStreamJsonResult,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Trae Agent AI Engine
 */
export class TraeEngine extends BaseAIEngine {
	name = "Trae Agent";
	cliCommand = "trae";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = ["--print", "--force", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		args.push(prompt);

		const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);

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

		// Try parsing as stream-json first (Claude/Qwen format)
		const streamResult = parseStreamJsonResult(output);
		if (streamResult.inputTokens > 0 || streamResult.outputTokens > 0) {
			return {
				success: exitCode === 0,
				response: streamResult.response,
				inputTokens: streamResult.inputTokens,
				outputTokens: streamResult.outputTokens,
			};
		}

		// Fallback to custom parsing
		const { response, inputTokens, outputTokens, durationMs } = this.parseOutput(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
		durationMs: number;
	} {
		const lines = output.split("\n").filter(Boolean);
		let response = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let durationMs = 0;

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);

				// Check result line
				if (parsed.type === "result") {
					response = parsed.result || response;
					inputTokens = parsed.usage?.input_tokens ?? inputTokens;
					outputTokens = parsed.usage?.output_tokens ?? outputTokens;
				}

				// Check completion event (Droid format)
				if (parsed.type === "completion") {
					response = parsed.finalText || response;
					if (typeof parsed.durationMs === "number") {
						durationMs = parsed.durationMs;
					}
				}

				// Check assistant message (Cursor format)
				if (parsed.type === "assistant" && !response) {
					const content = parsed.message?.content;
					if (Array.isArray(content) && content[0]?.text) {
						response = content[0].text;
					} else if (typeof content === "string") {
						response = content;
					}
				}

				// Check duration_ms (Cursor format)
				if (typeof parsed.duration_ms === "number") {
					durationMs = parsed.duration_ms;
				}
			} catch {
				// Ignore non-JSON lines
			}
		}

		return {
			response: response || "Task completed",
			inputTokens,
			outputTokens,
			durationMs,
		};
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = ["--print", "--force", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		args.push(prompt);

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(this.cliCommand, args, workDir, (line) => {
			outputLines.push(line);

			// Detect and report step changes
			const step = detectStepFromOutput(line);
			if (step) {
				onProgress(step);
			}
		});

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

		// Try parsing as stream-json first
		const streamResult = parseStreamJsonResult(output);
		if (streamResult.inputTokens > 0 || streamResult.outputTokens > 0) {
			return {
				success: exitCode === 0,
				response: streamResult.response,
				inputTokens: streamResult.inputTokens,
				outputTokens: streamResult.outputTokens,
			};
		}

		// Fallback to custom parsing
		const { response, inputTokens, outputTokens, durationMs } = this.parseOutput(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}
}
