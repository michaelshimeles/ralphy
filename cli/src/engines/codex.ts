import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { BaseAIEngine, execCommand, formatCommandError } from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Codex AI Engine
 */
export class CodexEngine extends BaseAIEngine {
	name = "Codex";
	cliCommand = "codex";

	protected useStdin(): boolean {
		return false;
	}

	private buildArgsInternal(
		prompt: string,
		workDir: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string; lastMessageFile: string } {
		// Codex uses a separate file for the last message
		const lastMessageFile = join(
			workDir,
			`.codex-last-message-${Date.now()}-${process.pid}-${randomUUID()}.txt`,
		);

		const baseArgs = ["exec", "--full-auto", "--json", "--output-last-message", lastMessageFile];
		if (options?.modelOverride) {
			baseArgs.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			baseArgs.push(...options.engineArgs);
		}

		const { args, stdinContent } = this.buildArgsWithStdin(baseArgs, prompt);
		return { args, stdinContent, lastMessageFile };
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const { args, stdinContent, lastMessageFile } = this.buildArgsInternal(
			prompt,
			workDir,
			options,
		);

		try {
			const { stdout, stderr, exitCode } = await execCommand(
				this.cliCommand,
				args,
				workDir,
				this.getEnv(options),
				stdinContent,
			);

			const output = stdout + stderr;

			// Read the last message from the file
			let response = "";
			if (existsSync(lastMessageFile)) {
				response = readFileSync(lastMessageFile, "utf-8");
				// Remove the "Task completed successfully." prefix if present
				response = response.replace(/^Task completed successfully\.\s*/i, "").trim();
				// Clean up the temp file
				try {
					unlinkSync(lastMessageFile);
				} catch {
					// Ignore cleanup errors
				}
			}

			// Check for errors in output
			if (output.includes('"type":"error"')) {
				const errorMatch = output.match(/"message":"([^"]+)"/);
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: errorMatch?.[1] || "Unknown error",
				};
			}

			// If command failed with non-zero exit code, provide a meaningful error
			if (exitCode !== 0) {
				return {
					success: false,
					response: response || "Task completed",
					inputTokens: 0,
					outputTokens: 0,
					error: formatCommandError(exitCode, output),
				};
			}

			return {
				success: true,
				response: response || "Task completed",
				inputTokens: 0, // Codex doesn't expose token counts
				outputTokens: 0,
			};
		} finally {
			// Ensure cleanup
			if (existsSync(lastMessageFile)) {
				try {
					unlinkSync(lastMessageFile);
				} catch {
					// Ignore
				}
			}
		}
	}

	protected buildArgs(prompt: string, workDir: string, options?: EngineOptions): string[] {
		const { args } = this.buildArgsInternal(prompt, workDir, options);
		return args;
	}

	protected processCliResult(
		stdout: string,
		stderr: string,
		exitCode: number,
		_workDir: string,
	): AIResult {
		const output = stdout + stderr;

		if (output.includes('"type":"error"')) {
			const errorMatch = output.match(/"message":"([^"]+)"/);
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: errorMatch?.[1] || "Unknown error",
			};
		}

		if (exitCode !== 0) {
			return {
				success: false,
				response: "Task completed",
				inputTokens: 0,
				outputTokens: 0,
				error: formatCommandError(exitCode, output),
			};
		}

		return { success: true, response: "Task completed", inputTokens: 0, outputTokens: 0 };
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		onProgress("Running Codex");
		const result = await this.execute(prompt, workDir, options);
		onProgress(result.success ? "Completed" : "Failed");
		return result;
	}
}
