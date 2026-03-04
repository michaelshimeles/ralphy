import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, checkForErrors, execCommand, execCommandStreaming } from "./base.ts";
import { detectStepFromOutput, formatCommandError } from "./parsers.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * GitHub Copilot CLI AI Engine
 */
export class CopilotEngine extends BaseAIEngine {
	name = "GitHub Copilot";
	cliCommand = "copilot";
	private tempDir = join(tmpdir(), "ralphy-copilot");

	/**
	 * Build command arguments for Copilot CLI
	 * Returns args array and optional stdin content for Windows
	 */
	protected buildArgs(prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const { args } = this.buildArgsInternal(prompt, options);
		return args;
	}

	protected useStdin(): boolean {
		return false;
	}

	private buildArgsInternal(
		prompt: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string } {
		const args: string[] = [];

		// Add --yolo flag for non-interactive mode
		args.push("--yolo");

		// Copilot uses -p flag for prompt file
		args.push("-p");

		// Create temp file with prompt content
		const tempFile = this.createTempFile(prompt);
		args.push(tempFile);

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		return { args };
	}

	private createTempFile(prompt: string): string {
		this.cleanupOldTempFiles();

		// Ensure temp directory exists
		if (!existsSync(this.tempDir)) {
			mkdirSync(this.tempDir, { recursive: true });
		}

		// Create unique filename
		const uuid = randomUUID();
		const tempFile = join(this.tempDir, `prompt-${uuid}.md`);

		// Write prompt to file
		writeFileSync(tempFile, prompt, "utf-8");

		return tempFile;
	}

	private cleanupTempFile(filePath: string | undefined): void {
		if (!filePath) return;
		try {
			if (existsSync(filePath)) {
				rmSync(filePath);
			}
		} catch (err) {
			logDebug(`Failed to cleanup temp file: ${err}`);
		}
	}

	private getAuthenticationError(output: string): string | null {
		const firstLine = output.split("\n")[0]?.trim().toLowerCase() || "";
		if (firstLine.startsWith("not authenticated") || firstLine.startsWith("no authentication")) {
			return "GitHub Copilot is not authenticated. Please run `gh auth login` or check your Copilot subscription.";
		}
		return null;
	}

	/**
	 * Cleanup temp files older than 1 hour to prevent disk space exhaustion
	 */
	private cleanupOldTempFiles(): void {
		try {
			if (!existsSync(this.tempDir)) return;
			const files = readdirSync(this.tempDir);
			const oneHourAgo = Date.now() - 60 * 60 * 1000;
			for (const file of files) {
				const filePath = join(this.tempDir, file);
				try {
					const stats = statSync(filePath);
					if (stats.mtimeMs < oneHourAgo) {
						rmSync(filePath);
					}
				} catch {
					// File may have been deleted, skip
				}
			}
		} catch (err) {
			logDebug(`Failed to cleanup old temp files: ${err}`);
		}
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		let tempFile: string | undefined;

		const startTime = Date.now();
		try {
			const { args } = this.buildArgsInternal(prompt, options);
			const pIndex = args.indexOf("-p");
			tempFile = pIndex >= 0 && pIndex < args.length - 1 ? args[pIndex + 1] : undefined;

			const { stdout, stderr, exitCode } = await execCommand(
				this.cliCommand,
				args,
				workDir,
				this.getEnv(options),
			);
			const durationMs = Date.now() - startTime;

			const output = stdout + stderr;

			// Check for authentication errors first (check first line only)
			const authError = this.getAuthenticationError(output);
			if (authError) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: authError,
				};
			}

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
			const tokenCounts = this.parseTokenCounts(output);

			// If command failed with non-zero exit code, provide a meaningful error
			if (exitCode !== 0) {
				return {
					success: false,
					response,
					inputTokens: tokenCounts.input,
					outputTokens: tokenCounts.output,
					error: formatCommandError(exitCode, output),
				};
			}

			return {
				success: true,
				response,
				inputTokens: tokenCounts.input,
				outputTokens: tokenCounts.output,
				cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
			};
		} finally {
			// Always clean up temp file
			this.cleanupTempFile(tempFile);
		}
	}

	private parseTokenCounts(output: string): { input: number; output: number } {
		const lines = output.split("\n");
		for (const line of lines) {
			// Match pattern: "model-name X in, Y out, Z cached" or variations
			// Using atomic grouping to prevent ReDoS - \d+\.?\d* matches numbers without catastrophic backtracking
			const match = line.match(/(\d+\.?\d*)([km]?)\s+in,\s+(\d+\.?\d*)([km]?)\s+out/i);
			if (match) {
				let input = Number.parseFloat(match[1]);
				let output = Number.parseFloat(match[3]);

				// Handle k/m suffixes
				if (match[2] === "k") input *= 1000;
				if (match[2] === "m") input *= 1000000;
				if (match[4] === "k") output *= 1000;
				if (match[4] === "m") output *= 1000000;

				return { input: Math.round(input), output: Math.round(output) };
			}
		}
		return { input: 0, output: 0 };
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
				!trimmed.includes("Working on it...") && // Status messages
				!trimmed.match(/^\S+\s+\d+(\.\d+)?[km]?\s+in,\s+\d+(\.\d+)?[km]?\s+out/i) && // Token count lines
				!trimmed.match(/^Total usage:\s*\d+\s*tokens/i) // Total usage lines
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
		let tempFile: string | undefined;

		const outputLines: string[] = [];
		const startTime = Date.now();

		try {
			const { args } = this.buildArgsInternal(prompt, options);
			const pIndex = args.indexOf("-p");
			tempFile = pIndex >= 0 && pIndex < args.length - 1 ? args[pIndex + 1] : undefined;

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
				this.getEnv(options),
			);

			const durationMs = Date.now() - startTime;
			const output = outputLines.join("\n");

			const authError = this.getAuthenticationError(output);
			if (authError) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: authError,
				};
			}

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
			const tokenCounts = this.parseTokenCounts(output);

			// If command failed with non-zero exit code, provide a meaningful error
			if (exitCode !== 0) {
				return {
					success: false,
					response,
					inputTokens: tokenCounts.input,
					outputTokens: tokenCounts.output,
					error: formatCommandError(exitCode, output),
				};
			}

			return {
				success: true,
				response,
				inputTokens: tokenCounts.input,
				outputTokens: tokenCounts.output,
				cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
			};
		} finally {
			// Always clean up temp file
			this.cleanupTempFile(tempFile);
		}
	}

	protected processCliResult(
		stdout: string,
		stderr: string,
		exitCode: number,
		_workDir: string,
	): AIResult {
		const output = stdout + stderr;
		const response = this.parseOutput(output);
		const tokenCounts = this.parseTokenCounts(output);

		// Check for auth errors first (check first line only)
		const authError = this.getAuthenticationError(output);
		if (authError) {
			return {
				success: false,
				response,
				inputTokens: tokenCounts.input,
				outputTokens: tokenCounts.output,
				error: authError,
			};
		}

		// Check for CLI errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response,
				inputTokens: tokenCounts.input,
				outputTokens: tokenCounts.output,
				error,
			};
		}

		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens: tokenCounts.input,
				outputTokens: tokenCounts.output,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens: tokenCounts.input,
			outputTokens: tokenCounts.output,
		};
	}
}
