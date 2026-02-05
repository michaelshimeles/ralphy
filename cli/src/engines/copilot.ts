import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, checkForErrors, execCommand, formatCommandError } from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

/** Directory for temporary prompt files */
const TEMP_DIR = join(tmpdir(), "ralphy-copilot");

/**
 * GitHub Copilot CLI AI Engine (Legacy Implementation)
 *
 * This is the legacy implementation using text parsing of CLI output.
 * For new code, use CopilotAcpEngine which uses the Agent Client Protocol.
 *
 * Note: executeStreaming is intentionally not implemented for Copilot
 * because the streaming function can hang on Windows due to how
 * Bun handles cmd.exe stream completion. The non-streaming execute()
 * method works reliably.
 *
 * Note: All engine output is captured internally for parsing and not displayed
 * to the end user. This is by design - the spinner shows step progress while
 * the actual CLI output is processed silently.
 *
 * Note: Prompts are passed via temporary files to preserve markdown formatting.
 * The -p parameter accepts a file path, which avoids shell escaping issues and
 * maintains the full structure of markdown (newlines, code blocks, etc.) that
 * would be lost if passed as a command line string.
 *
 * @deprecated Use CopilotAcpEngine instead for better protocol-based communication
 */
export class CopilotEngine extends BaseAIEngine {
	name = "GitHub Copilot";
	cliCommand = "copilot";

	/**
	 * Create a temporary file containing the prompt.
	 * Uses a unique filename to support parallel execution.
	 * @returns The path to the temporary prompt file
	 */
	private createPromptFile(prompt: string): string {
		// Ensure temp directory exists - wrapped in try-catch to handle
		// potential race conditions when multiple processes create it simultaneously
		try {
			mkdirSync(TEMP_DIR, { recursive: true });
		} catch (err) {
			// EEXIST is expected if another process created the directory first
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
				throw err;
			}
		}

		// Generate unique filename using UUID for parallel safety
		const filename = `prompt-${randomUUID()}.md`;
		const filepath = join(TEMP_DIR, filename);

		// Write prompt to file preserving all formatting
		writeFileSync(filepath, prompt, "utf-8");
		logDebug(`[Copilot] Created prompt file: ${filepath}`);

		return filepath;
	}

	/**
	 * Clean up a temporary prompt file
	 */
	private cleanupPromptFile(filepath: string): void {
		try {
			unlinkSync(filepath);
			logDebug(`[Copilot] Cleaned up prompt file: ${filepath}`);
		} catch (err) {
			// Ignore cleanup errors - file may already be deleted
			logDebug(`[Copilot] Failed to cleanup prompt file: ${filepath}`);
		}
	}

	/**
	 * Build command arguments for Copilot CLI
	 * @param promptFilePath Path to the temporary file containing the prompt
	 */
	private buildArgs(promptFilePath: string, options?: EngineOptions): { args: string[] } {
		const args: string[] = [];

		// Use --yolo for non-interactive mode (allows all tools and paths)
		args.push("--yolo");

		// Pass prompt file path (Copilot CLI accepts file paths for -p)
		// NOTE: This is an undocumented feature of Copilot CLI but works reliably
		// since copilot is smart enough to detect file paths and read the content.
		// Do NOT quote the path - arguments are passed directly without shell interpretation
		// on non-Windows platforms, so quotes would become literal characters in the path.
		args.push("-p", promptFilePath);

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		return { args };
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		// Create temporary prompt file to preserve markdown formatting
		const promptFilePath = this.createPromptFile(prompt);

		try {
			const { args } = this.buildArgs(promptFilePath, options);

			// Debug logging
			logDebug(`[Copilot] Working directory: ${workDir}`);
			logDebug(`[Copilot] Prompt length: ${prompt.length} chars`);
			logDebug(`[Copilot] Prompt preview: ${prompt.substring(0, 200)}...`);
			logDebug(`[Copilot] Prompt file: ${promptFilePath}`);
			logDebug(`[Copilot] Command: ${this.cliCommand} ${args.join(" ")}`);

			const startTime = Date.now();
			const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);
			const durationMs = Date.now() - startTime;

			const output = stdout + stderr;

			// Debug logging
			logDebug(`[Copilot] Exit code: ${exitCode}`);
			logDebug(`[Copilot] Duration: ${durationMs}ms`);
			logDebug(`[Copilot] Output length: ${output.length} chars`);
			logDebug(`[Copilot] Output preview: ${output.substring(0, 500)}...`);

			// Check for JSON errors (from base)
			const jsonError = checkForErrors(output);
			if (jsonError) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: jsonError,
				};
			}

			// Check for Copilot-specific errors (plain text)
			const copilotError = this.checkCopilotErrors(output);
			if (copilotError) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: copilotError,
				};
			}

			// Parse Copilot output - extract response and token counts
			const { response, inputTokens, outputTokens } = this.parseOutput(output);

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
				cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
			};
		} finally {
			// Always clean up the temporary prompt file
			this.cleanupPromptFile(promptFilePath);
		}
	}

	/**
	 * Check for Copilot-specific errors in output
	 *
	 * IMPORTANT: We are intentionally very conservative with error detection here.
	 * We don't have documentation on Copilot CLI's error response formats, exit codes,
	 * or error messages. The response content might contain strings like "network error",
	 * "error:", "rate limit", etc. as part of valid output (e.g., test results, error
	 * handling discussions, feedback about code). We only detect errors that we have
	 * actually observed in practice.
	 *
	 * Currently known error: Authentication errors (observed when not logged in)
	 */
	private checkCopilotErrors(output: string): string | null {
		const trimmed = output.trim();
		const trimmedLower = trimmed.toLowerCase();

		// Authentication errors - the only error format we've actually observed
		// When not authenticated, Copilot CLI outputs a message starting with these phrases
		if (
			trimmedLower.startsWith("no authentication") ||
			trimmedLower.startsWith("not authenticated") ||
			trimmedLower.startsWith("authentication required") ||
			trimmedLower.startsWith("please authenticate")
		) {
			return "GitHub Copilot CLI is not authenticated. Run 'copilot' and use '/login' to authenticate, or set COPILOT_GITHUB_TOKEN environment variable.";
		}

		// Note: We intentionally do NOT check for:
		// - "rate limit" / "too many requests" - unknown format, could appear in response content
		// - "network error" / "connection refused" - unknown format, could appear in response content
		// - "error:" prefix - too generic, could appear in response content
		// - Non-zero exit codes - we don't know if Copilot uses them for errors
		//
		// If we encounter other error patterns in practice, we can add them here.

		return null;
	}

	/**
	 * Parse a token count string like "17.5k" or "73" into a number
	 */
	private parseTokenCount(str: string): number {
		const trimmed = str.trim().toLowerCase();
		if (trimmed.endsWith("k")) {
			const value = Number.parseFloat(trimmed.slice(0, -1));
			return Number.isNaN(value) ? 0 : Math.round(value * 1000);
		}
		if (trimmed.endsWith("m")) {
			const value = Number.parseFloat(trimmed.slice(0, -1));
			return Number.isNaN(value) ? 0 : Math.round(value * 1000000);
		}
		const value = Number.parseFloat(trimmed);
		return Number.isNaN(value) ? 0 : Math.round(value);
	}

	/**
	 * Extract token counts from Copilot CLI output
	 * Format: "model-name       17.5k in, 73 out, 11.8k cached (Est. 1 Premium request)"
	 */
	private parseTokenCounts(output: string): { inputTokens: number; outputTokens: number } {
		// Look for the token count line in the "Breakdown by AI model" section
		// Pattern: number followed by "in," and number followed by "out,"
		const tokenMatch = output.match(/(\d+(?:\.\d+)?[km]?)\s+in,\s+(\d+(?:\.\d+)?[km]?)\s+out/i);

		if (tokenMatch) {
			const inputTokens = this.parseTokenCount(tokenMatch[1]);
			const outputTokens = this.parseTokenCount(tokenMatch[2]);
			logDebug(`[Copilot] Parsed tokens: ${inputTokens} in, ${outputTokens} out`);
			return { inputTokens, outputTokens };
		}

		return { inputTokens: 0, outputTokens: 0 };
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
	} {
		// Extract token counts first
		const { inputTokens, outputTokens } = this.parseTokenCounts(output);

		// Copilot CLI may output text responses
		// Extract the meaningful response, filtering out control characters and prompts
		// Note: These filter patterns are specific to current Copilot CLI behavior
		// and may need updates if the CLI output format changes
		const lines = output.split("\n").filter(Boolean);

		// Filter out empty lines, CLI artifacts, and stats section
		const meaningfulLines = lines.filter((line) => {
			const trimmed = line.trim();
			return (
				trimmed &&
				!trimmed.startsWith("?") && // Interactive prompts
				!trimmed.startsWith("❯") && // Command prompts
				!trimmed.includes("Thinking...") && // Status messages
				!trimmed.includes("Working on it...") && // Status messages
				!trimmed.startsWith("Total usage") && // Stats section
				!trimmed.startsWith("API time") && // Stats section
				!trimmed.startsWith("Total session") && // Stats section
				!trimmed.startsWith("Total code") && // Stats section
				!trimmed.startsWith("Breakdown by") && // Stats section header
				!trimmed.match(
					/^\s*\S+\s+\d+(?:\.\d+)?[km]?\s+in,\s+\d+(?:\.\d+)?[km]?\s+out,\s+\d+(?:\.\d+)?[km]?\s+cached/,
				) // Token count lines (model stats: "model-name 17.5k in, 73 out, 11.8k cached")
			);
		});

		const response = meaningfulLines.join("\n").trim() || "Task completed";
		return { response, inputTokens, outputTokens };
	}
}
