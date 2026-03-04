import type { ChildProcess } from "node:child_process";
import { DEFAULT_AI_ENGINE_TIMEOUT_MS } from "../config/constants.ts";
import { logDebug } from "../ui/logger.ts";

import { formatParsedStep, parseAIStep } from "../utils/ai-output-parser.ts";
import { ErrorSchema, parseJsonLine } from "../utils/json-validation.ts";
import { commandExists, execCommand, execCommandStreamingNew } from "./executor.ts";
import { detectStepFromOutput } from "./parsers.ts";
import type { AIEngine, AIResult, EngineOptions, ProgressCallback } from "./types.ts";

// Re-export functions from new modules for backward compatibility
export {
	commandExists,
	execCommand,
	execCommandStreaming,
	execCommandStreamingNew,
} from "./executor.ts";
export {
	checkForErrors,
	detectStepFromOutput,
	extractAuthenticationError,
	extractTokenCounts,
	formatCommandError,
	parseStreamJsonResult,
} from "./parsers.ts";
export { validateArgs, validateCommand, validateCommandAndArgs } from "./validation.ts";

const DEBUG = process.env.RALPHY_DEBUG === "true";

function debugLog(...args: unknown[]): void {
	if (DEBUG || (globalThis as { verboseMode?: boolean }).verboseMode === true) {
		logDebug(args.map((a) => String(a)).join(" "));
	}
}

/**
 * Base AI Engine implementation
 */
export abstract class BaseAIEngine implements AIEngine {
	abstract name: string;
	abstract cliCommand: string;

	/**
	 * Check if the CLI command is available
	 */
	async isAvailable(): Promise<boolean> {
		debugLog(`isAvailable: Checking if '${this.cliCommand}' (${this.name}) is available...`);
		const result = await commandExists(this.cliCommand);
		debugLog(`isAvailable: '${this.cliCommand}' (${this.name}) available = ${result}`);
		return result;
	}

	/**
	 * Build CLI arguments for engine
	 */
	protected abstract buildArgs(prompt: string, workDir: string, options?: EngineOptions): string[];

	/**
	 * Process CLI output into AIResult
	 */
	protected abstract processCliResult(
		stdout: string,
		stderr: string,
		exitCode: number,
		workDir: string,
	): AIResult;

	/**
	 * Get environment variables for engine
	 */
	protected getEnv(options?: EngineOptions): Record<string, string> | undefined {
		return options?.env;
	}

	/**
	 * Whether prompt should be passed through stdin.
	 * Engines that pass prompts via temp files should override this to false.
	 */
	protected useStdin(): boolean {
		return true;
	}

	/**
	 * Build args array with stdin handling
	 * Prompts are passed via stdin to avoid shell escaping issues and ensure
	 * cross-platform compatibility (Windows, Linux, macOS)
	 */
	protected buildArgsWithStdin(
		baseArgs: string[],
		prompt: string,
	): { args: string[]; stdinContent?: string } {
		// Always use stdin for prompts - this is the most reliable cross-platform approach
		// It avoids shell escaping issues and command line length limits on all platforms
		return { args: baseArgs, stdinContent: prompt };
	}

	/**
	 * Execute with streaming progress updates (optional implementation)
	 */
	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		if (options?.dryRun) {
			onProgress("Skipped (dry run)");
			return { success: true, response: "(dry run) Skipped", inputTokens: 0, outputTokens: 0 };
		}

		const args = this.buildArgs(prompt, workDir, options);
		const env = this.getEnv(options);

		// Always use stdin for prompts - most reliable cross-platform approach
		const stdinContent = this.useStdin() ? prompt : undefined;

		debugLog(`Starting ${this.name} engine with ${this.cliCommand}`);
		debugLog(`WorkDir: ${workDir}`);
		debugLog(`Args: ${args.join(" ")}`);

		const timeout = Number.parseInt(
			process.env.RALPHY_EXECUTION_TIMEOUT || String(DEFAULT_AI_ENGINE_TIMEOUT_MS),
			10,
		);
		debugLog(`Timeout set to: ${Math.floor(timeout / 1000)}s`);

		let timedOut = false;
		let childProcess: import("./types.ts").ChildProcess | null = null;
		const timeoutId = setTimeout(() => {
			timedOut = true;
			onProgress(
				`[Warning: Process taking longer than ${Math.floor(timeout / 1000 / 60)} minutes...]`,
			);
			debugLog(`Timeout reached after ${timeout}ms`);

			// BUG FIX: Check childProcess exists before attempting to kill
			// This prevents errors when timeout fires before process is assigned (fallback case)
			if (childProcess && typeof childProcess.kill === "function") {
				debugLog("Killing child process due to timeout");
				try {
					childProcess.kill();
				} catch (killErr) {
					debugLog(`Failed to kill child process: ${killErr}`);
				}
			}
		}, timeout);

		try {
			const result = await execCommandStreamingNew(
				this.cliCommand,
				args,
				workDir,
				env,
				stdinContent,
			);

			childProcess = result.process;
			let stdout = "";
			let stderr = "";
			let exitCode = 0;

			if (result.stdout?.getReader && result.stderr?.getReader) {
				const stdoutReader = result.stdout.getReader();
				const stderrReader = result.stderr.getReader();

				const readStdout = async () => {
					try {
						while (true) {
							const { done, value } = await stdoutReader.read();
							if (done) break;
							const chunk = new TextDecoder().decode(value);
							stdout += chunk;

							const lines = chunk.split("\n");
							for (const line of lines) {
								if (line.trim()) {
									const step = this.parseProgressLine(line, options?.logThoughts);
									if (step) {
										onProgress(step);
									}
								}
							}
						}
					} catch (err) {
						debugLog(`Error reading stdout: ${err}`);
					}
				};

				const readStderr = async () => {
					try {
						while (true) {
							const { done, value } = await stderrReader.read();
							if (done) break;
							const chunk = new TextDecoder().decode(value);
							stderr += chunk;
						}
					} catch (err) {
						debugLog(`Error reading stderr: ${err}`);
					}
				};

				const exitedPromise = childProcess?.exited
					? childProcess.exited
					: new Promise<number>((resolve) => {
							const nodeProcess = childProcess as unknown as ChildProcess;
							nodeProcess.once("close", (code) => resolve(code ?? 1));
							nodeProcess.once("error", () => resolve(1));
						});

				const [resolvedExitCode] = await Promise.all([exitedPromise, readStdout(), readStderr()]);
				exitCode = resolvedExitCode ?? 1;
			} else {
				// BUG FIX: Use stdinContent instead of undefined 'needsStdin' variable
				const result = await execCommand(this.cliCommand, args, workDir, env, stdinContent);
				stdout = result.stdout;
				stderr = result.stderr;
				exitCode = result.exitCode;
			}

			clearTimeout(timeoutId);

			if (timedOut) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: `Execution timed out after ${Math.floor(timeout / 1000 / 60)} minutes`,
				};
			}

			return this.processCliResult(stdout, stderr, exitCode, workDir);
		} catch (error) {
			clearTimeout(timeoutId);
			debugLog(`Error in executeStreaming: ${error}`);
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Execute the AI engine (non-streaming)
	 */
	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		if (options?.dryRun) {
			return { success: true, response: "(dry run) Skipped", inputTokens: 0, outputTokens: 0 };
		}

		const args = this.buildArgs(prompt, workDir, options);
		const env = this.getEnv(options);

		// Always use stdin for prompts - most reliable cross-platform approach
		const stdinContent = this.useStdin() ? prompt : undefined;

		debugLog(`Starting ${this.name} engine (non-streaming)`);
		debugLog(`WorkDir: ${workDir}`);
		debugLog(`Args: ${args.join(" ")}`);

		try {
			const result = await execCommand(this.cliCommand, args, workDir, env, stdinContent);

			return this.processCliResult(result.stdout, result.stderr, result.exitCode, workDir);
		} catch (error) {
			debugLog(`Error in execute: ${error}`);
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Parse a line of output to extract progress information
	 */
	protected parseProgressLine(line: string, logThoughts?: boolean): string | null {
		if (line.trim().startsWith("{")) {
			try {
				const parsed = parseJsonLine(line);
				if (parsed) {
					if (ErrorSchema.safeParse(parsed.event).success) {
						return null;
					}

					const event = parsed.event as Record<string, unknown>;
					if (event.type === "text" && event.part && typeof event.part === "object") {
						const part = event.part as { text?: string };
						if (part.text) {
							const step = detectStepFromOutput(part.text, logThoughts);
							if (step) return step;
						}
					}
				}
			} catch {
				// Not valid JSON, continue to plain text parsing
			}
		}

		const step = detectStepFromOutput(line, logThoughts);
		if (step) return step;

		const parsed = parseAIStep(line);
		if (parsed && !line.includes("[ERROR")) {
			return formatParsedStep(parsed);
		}

		return null;
	}
}
