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

type BuildArgsResult = { args: string[]; stdinContent?: string };

/**
 * Cline CLI AI Engine
 *
 * Uses non-interactive JSON output for reliable parsing:
 *   cline -y --json
 */
export class ClineEngine extends BaseAIEngine {
	name = "Cline";
	cliCommand = "cline";

	private buildArgs(prompt: string, options?: EngineOptions): BuildArgsResult {
		const args: string[] = ["-y", "--json"];

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}

		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content.
		// Cline enters plain-text/JSON mode when stdin is piped.
		if (isWindows) {
			return { args, stdinContent: prompt };
		}

		args.push(prompt);
		return { args };
	}

	private parseJsonLines(output: string): { response: string } {
		const lines = output.split("\n").filter(Boolean);
		const textMessages: string[] = [];

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				if (parsed?.type === "say" && typeof parsed.text === "string") {
					const text = parsed.text.trim();
					if (!text) continue;

					// Prefer human-facing text messages; tool messages are usually progress noise.
					if (parsed.say === "text" || !parsed.say) {
						// Ignore partial fragments when present; keep final messages.
						if (parsed.partial === true) continue;
						textMessages.push(text);
					}
				}
			} catch {
				// Ignore non-JSON lines
			}
		}

		if (textMessages.length > 0) {
			return { response: textMessages.at(-1) ?? "Task completed" };
		}

		return { response: "Task completed" };
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgs(prompt, options);

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

		const { response } = this.parseJsonLines(output);

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

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const { args, stdinContent } = this.buildArgs(prompt, options);
		const outputLines: string[] = [];

		const startTime = Date.now();
		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			args,
			workDir,
			(line) => {
				outputLines.push(line);

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

		const { response } = this.parseJsonLines(output);

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
