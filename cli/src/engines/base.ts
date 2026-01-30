import { spawn, spawnSync } from "node:child_process";
import type { z } from "zod";
import { DEFAULT_AI_ENGINE_TIMEOUT_MS, STREAM_HEARTBEAT_INTERVAL_MS } from "../config/constants.ts";
import { logDebug } from "../ui/logger.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import { formatParsedStep, parseAIStep } from "../utils/ai-output-parser.ts";
import { registerProcess } from "../utils/cleanup.ts";
import { ErrorSchema, parseJsonLine, StepFinishSchema } from "../utils/json-validation.ts";
import type { AIEngine, AIResult, EngineOptions, ProgressCallback } from "./types.ts";

// Check if running in Bun
const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";
const DEBUG = process.env.RALPHY_DEBUG === "true";

function debugLog(...args: unknown[]): void {
	// Use both DEBUG env and verboseMode for maximum visibility
	// biome-ignore lint/suspicious/noExplicitAny: Global config access
	if (DEBUG || (globalThis as any)?.verboseMode === true) {
		logDebug(args.map((a) => String(a)).join(" "));
	}
}

/**
 * Check if a command is available in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
	debugLog(`commandExists: Checking for '${command}'...`);
	try {
		const checkCommand = isWindows ? "where" : "which";
		debugLog(`commandExists: Using checkCommand='${checkCommand}', isBun=${isBun}`);
		if (isBun) {
			debugLog("commandExists: Using Bun.spawn for check");
			const proc = Bun.spawn([checkCommand, command], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			debugLog(`commandExists: Bun.spawn exited with code ${exitCode}`);
			return exitCode === 0;
		}
		// Node.js fallback - where/which don't need shell
		debugLog("commandExists: Using Node.js spawnSync");
		const result = spawnSync(checkCommand, [command], { stdio: "pipe" });
		debugLog(`commandExists: spawnSync status=${result.status}`);
		return result.status === 0;
	} catch (err) {
		debugLog(`commandExists: Exception - ${err}`);
		return false;
	}
}

/**
 * Execute a command and return stdout
 * @param stdinContent - Optional content to pass via stdin (useful for multi-line prompts on Windows)
 */
export async function execCommand(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	debugLog(`execCommand: ${command} ${args.join(" ")}`);
	debugLog(`execCommand: workDir=${workDir}, hasEnv=${!!env}, hasStdin=${!!stdinContent}`);

	if (isBun) {
		// Try shell approach first for proper session context
		const spawnArgs = [command, ...args];
		debugLog(`execCommand: spawning with Bun, spawnArgs=${spawnArgs.join(" ")}`);

		const proc = Bun.spawn(spawnArgs, {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			// Merge envVars first, then add process.env
			env: { ...process.env, ...(env || {}) },
		});

		debugLog(
			`execCommand: process spawned, PID=${proc.pid}, stdinContent length=${stdinContent?.length || 0}`,
		);

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
			debugLog("execCommand: stdin written and closed");
		}

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		debugLog(
			`execCommand: process exited, exitCode=${exitCode}, stdout=${stdout.length} chars, stderr=${stderr.length} chars`,
		);

		return { stdout, stderr, exitCode };
	}

	// Node.js fallback - use shell on Windows to execute .cmd wrappers
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
			shell: isWindows, // Required on Windows for npm global commands (.cmd wrappers)
		});

		// Track process for cleanup
		const unregister = registerProcess(proc);

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (exitCode) => {
			unregister();
			resolve({
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: exitCode ?? 1,
			});
		});
	});
}

/**
 * Read a stream line by line, calling onLine for each non-empty line
 */
async function readStream(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (line.trim()) onLine(line);
			}
		}
		if (buffer.trim()) onLine(buffer);
	} finally {
		reader.releaseLock();
	}
}

/**
 * Execute a command with streaming output, calling onLine for each line
 * @param stdinContent - Optional content to pass via stdin (useful for multi-line prompts on Windows)
 */
export async function execCommandStreaming(
	command: string,
	args: string[],
	workDir: string,
	onLine: (line: string) => void,
	env?: Record<string, string>,
	stdinContent?: string,
	debug = false,
	// biome-ignore lint/suspicious/noExplicitAny: Bun process type complexity
): Promise<{ exitCode: number; process?: any }> {
	debugLog(`execCommandStreaming: ${command} ${args.join(" ")}`);

	if (isBun) {
		// Try shell approach first for proper session context
		const spawnArgs = [command, ...args];
		debugLog(`execCommandStreaming: spawning with Bun, spawnArgs=${spawnArgs.join(" ")}`);

		const proc = Bun.spawn(spawnArgs, {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...(env || {}) },
		});

		debugLog(`Process spawned, PID: ${proc.pid}`);

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
			debugLog(`Wrote ${stdinContent.length} chars to stdin`);
		}

		// Add heartbeat to detect if process is hanging
		let lastOutputTime = Date.now();
		debugLog(`Heartbeat interval: ${STREAM_HEARTBEAT_INTERVAL_MS}ms`);

		const heartbeatCheck = setInterval(() => {
			const elapsed = Date.now() - lastOutputTime;
			debugLog(`Heartbeat check: ${elapsed}ms since last output`);
			if (elapsed > STREAM_HEARTBEAT_INTERVAL_MS) {
				// Log a heartbeat to show we're still running
				onLine(`[Still waiting... ${Math.floor(elapsed / 1000)}s with no output]`);
				debugLog(`No output for ${elapsed}ms, showing heartbeat`);
			}
		}, 10000);

		// Wrap onLine to track output time
		const trackedOnLine = (line: string) => {
			lastOutputTime = Date.now();
			// Always show ALL output in debug mode
			if (DEBUG || debug) {
				const display = StaticAgentDisplay.getInstance();
				const msg = `[RAW OPENCODE OUTPUT] ${line}`;
				if (display) {
					display.log(msg);
				} else {
					process.stdout.write(`${msg}\n`);
				}
			}
			debugLog(`Output: ${line.substring(0, 100)}${line.length > 100 ? "..." : ""}`);
			onLine(line);
		};

		// Process both stdout and stderr in parallel
		debugLog("Starting to read streams...");
		await Promise.all([
			readStream(proc.stdout, trackedOnLine),
			readStream(proc.stderr, trackedOnLine),
		]);

		clearInterval(heartbeatCheck);
		debugLog("Streams closed, waiting for process exit...");

		const exitCode = await proc.exited;
		debugLog(`Process exited with code: ${exitCode}`);
		return { exitCode, process: proc };
	}

	// Node.js fallback - use shell on Windows to execute .cmd wrappers
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
			shell: isWindows, // Required on Windows for npm global commands (.cmd wrappers)
		});

		// Track process for cleanup
		const unregister = registerProcess(proc);

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		let _stdout = "";
		let _stderr = "";

		const trackedOnLine = (line: string) => {
			if (DEBUG || debug) {
				const display = StaticAgentDisplay.getInstance();
				const msg = `[RAW OPENCODE OUTPUT] ${line}`;
				if (display) {
					display.log(msg);
				} else {
					process.stdout.write(`${msg}\n`);
				}
			}
			onLine(line);
		};

		proc.stdout?.on("data", (data) => {
			const text = data.toString();
			_stdout += text;
			for (const line of text.split("\n")) {
				if (line.trim()) trackedOnLine(line);
			}
		});

		proc.stderr?.on("data", (data) => {
			const text = data.toString();
			_stderr += text;
			for (const line of text.split("\n")) {
				if (line.trim()) trackedOnLine(line);
			}
		});

		proc.on("close", (exitCode) => {
			unregister();
			resolve({ exitCode: exitCode || 0, process: proc });
		});
	});
}

/**
 * Check for errors in stream-json output or general CLI output.
 */
export function checkForErrors(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		const trimmed = line.trim();
		// Try JSON parsing with schema validation
		if (trimmed.startsWith("{")) {
			const parsed = parseJsonLine(line);
			if (parsed && ErrorSchema.safeParse(parsed.event).success) {
				const errorData = parsed.event as z.infer<typeof ErrorSchema>;
				return errorData.error?.message || errorData.message || "Unknown error";
			}
		}

		// Look for common error patterns in plain text (case-insensitive)
		const lowerTrimmed = trimmed.toLowerCase();
		if (
			lowerTrimmed.includes("fatal:") ||
			lowerTrimmed.includes("error:") ||
			lowerTrimmed.includes("providermodelnotfounderror") ||
			lowerTrimmed.includes("modelnotfounderror") ||
			lowerTrimmed.includes("model not found") ||
			lowerTrimmed.includes("invalid model") ||
			lowerTrimmed.includes("not available")
		) {
			// Improve specific error messages
			if (lowerTrimmed.includes("rate limit")) {
				return "OpenCode Rate Limit: Too many requests. Try: Wait 30-60s";
			}
			if (lowerTrimmed.includes("quota")) {
				return "OpenCode Quota Exceeded: You've reached your usage limit. Check your OpenCode plan";
			}
			if (lowerTrimmed.includes("connection") || lowerTrimmed.includes("timeout")) {
				return "OpenCode Connection Error: Unable to connect to the service. Check internet connection";
			}
			return trimmed;
		}
	}

	// Secondary check for common fatal strings
	if (
		output.includes("Permission denied") ||
		output.includes("command not found") ||
		output.toLowerCase().includes("providermodelnotfounderror")
	) {
		return output.trim().split("\n").pop() || "Access or command error";
	}

	return null;
}

/**
 * Format a command failure with useful output context.
 */
export function formatCommandError(exitCode: number, output: string): string {
	const trimmed = output.trim();
	if (!trimmed) {
		return `Command failed with code ${exitCode} (no output)`;
	}

	// Try to find a meaningful error message first
	const extractedError = checkForErrors(output);
	if (extractedError) {
		return `Error (${exitCode}): ${extractedError}`;
	}

	const lines = trimmed.split("\n").filter(Boolean);
	// Take last 5 lines for context - usually more focused than 12
	const snippet = lines.slice(-5).join("\n");
	return `Exit code ${exitCode}. Last output:\n${snippet}`;
}

/**
 * Detect step from AI output
 */
export function parseStreamJsonResult(output: string): {
	response: string;
	inputTokens: number;
	outputTokens: number;
} {
	const lines = output.split("\n").filter(Boolean);
	let response = "";
	let inputTokens = 0;
	let outputTokens = 0;

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "result") {
				response = parsed.result || "Task completed";
				inputTokens = parsed.usage?.input_tokens || 0;
				outputTokens = parsed.usage?.output_tokens || 0;
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return { response: response || "Task completed", inputTokens, outputTokens };
}

/**
 * Extract token counts from JSON response
 */
export function extractTokenCounts(output: string): { input: number; output: number } | null {
	const lines = output.split("\n").filter(Boolean);
	for (const line of lines) {
		if (line.trim().startsWith("{")) {
			const parsed = parseJsonLine(line);
			if (!parsed) continue;

			const stepFinishResult = StepFinishSchema.safeParse(parsed.event);
			if (stepFinishResult.success) {
				const stepFinish = stepFinishResult.data;
				const tokens = stepFinish.part?.tokens || stepFinish.tokens;
				if (tokens) {
					return {
						input: tokens.input || 0,
						output: tokens.output || 0,
					};
				}
			}
		}
	}
	return null;
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

		// On Windows, always pass prompt via stdin to avoid shell argument escaping issues
		const needsStdin = isWindows;

		debugLog(`Starting ${this.name} engine with ${this.cliCommand}`);
		debugLog(`WorkDir: ${workDir}`);
		debugLog(`Args: ${args.join(" ")}`);

		// Add timeout to prevent indefinite hanging
		const timeout = Number.parseInt(
			process.env.RALPHY_EXECUTION_TIMEOUT || String(DEFAULT_AI_ENGINE_TIMEOUT_MS),
			10,
		);
		debugLog(`Timeout set to: ${Math.floor(timeout / 1000)}s`);

		let timedOut = false;
		// biome-ignore lint/suspicious/noExplicitAny: Child process type
		let childProcess: any = null;
		const _executionExitCode = 0;
		const timeoutId = setTimeout(() => {
			timedOut = true;
			onProgress(
				`[Warning: Process taking longer than ${Math.floor(timeout / 1000 / 60)} minutes...]`,
			);
			debugLog(`Timeout reached after ${timeout}ms`);

			// Kill the child process if it's still running
			if (childProcess?.kill) {
				try {
					childProcess.kill("SIGTERM");
					debugLog("Sent SIGTERM to timed out process");
					// Force kill after 5 seconds if still running
					setTimeout(() => {
						if (childProcess?.kill) {
							childProcess.kill("SIGKILL");
							debugLog("Sent SIGKILL to timed out process");
						}
					}, 5000);
				} catch (killError) {
					debugLog(`Failed to kill timed out process: ${killError}`);
				}
			}
		}, timeout);

		let accumulatedStdout = "";
		const accumulatedStderr = "";
		let finalExitCode = 0;

		try {
			const { exitCode: streamingExitCode, process: proc } = await execCommandStreaming(
				this.cliCommand,
				args,
				workDir,
				(step) => {
					// Filter out internal debug messages and empty lines
					if (!step.startsWith("[RAW OPENCODE OUTPUT]") && step.trim()) {
						// Always accumulate stdout for final processing
						accumulatedStdout += `${step}\n`;

						// Parse and format the step for progress reporting
						const parsed = parseAIStep(step);
						const formatted = formatParsedStep(parsed);
						// Only pass formatted output, skip raw JSON and unparsable content
						if (formatted !== null) {
							onProgress(formatted);
						} else if (!parsed.raw || !parsed.raw.startsWith("{")) {
							// Only pass raw if it's not JSON we failed to parse
							onProgress(step);
						}
					}
				},
				env,
				needsStdin ? prompt : undefined,
				options?.debugOpenCode || options?.debug,
			);

			finalExitCode = streamingExitCode;
			childProcess = proc;
			clearTimeout(timeoutId);
		} catch (error) {
			clearTimeout(timeoutId);
			if (timedOut) {
				return {
					success: false,
					error: `Process timed out after ${Math.floor(timeout / 1000 / 60)} minutes`,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
				};
			}
			throw error;
		}

		// Process the result using the accumulated output
		const result = this.processCliResult(
			accumulatedStdout,
			accumulatedStderr,
			finalExitCode,
			workDir,
		);

		if (timedOut) {
			result.success = false;
			result.error = "Process timed out";
		}

		return result;
	}

	/**
	 * Execute command with streaming output and return AI result
	 */
	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		if (options?.dryRun) {
			return { success: true, response: "(dry run) Skipped", inputTokens: 0, outputTokens: 0 };
		}

		debugLog(`Starting ${this.name} execution`);
		debugLog(`WorkDir: ${workDir}`);
		debugLog(`Prompt length: ${prompt.length} chars`);
		debugLog(`Model override: ${options?.modelOverride || "default"}`);

		const args = this.buildArgs(prompt, workDir, options);
		const env = this.getEnv(options);

		debugLog(`CLI command: ${this.cliCommand}`);
		debugLog(`Args: ${args.join(" ")}`);
		debugLog(`Environment keys: ${Object.keys(env || {}).join(", ")}`);

		// On Windows, always pass prompt via stdin to avoid shell argument escaping issues
		// This is safer than trying to detect if prompt is in args
		const needsStdin = isWindows;
		debugLog(`Using stdin for prompt: ${needsStdin}`);

		debugLog("Executing command...");

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			env,
			needsStdin ? prompt : undefined,
		);

		debugLog(`Command completed with exit code: ${exitCode}`);
		debugLog(`Stdout length: ${stdout.length} chars`);
		debugLog(`Stderr length: ${stderr.length} chars`);

		return this.processCliResult(stdout, stderr, exitCode, workDir);
	}
}
export function detectStepFromOutput(line: string, logThoughts = true): string | null {
	const trimmed = line.trim();

	// Skip non-useful lines
	if (!trimmed || trimmed.startsWith("[RAW OPENCODE OUTPUT]")) {
		return null;
	}

	// Filter out technical noise FIRST (before any processing)
	const lowerTrimmed = trimmed.toLowerCase();
	if (lowerTrimmed.includes("step finish")) return null;
	if (trimmed.includes("→") && trimmed.length < 20) return null;
	if (trimmed.startsWith('{"type":"step_finish"')) return null;
	if (lowerTrimmed.includes("starting planning")) return null;
	if (trimmed.startsWith("task st-")) return null;
	if (/^".*"$/.test(trimmed)) return null; // Any text wrapped in quotes
	if (lowerTrimmed.includes("tokens used")) return null;

	// Check for tool calls in JSON
	try {
		const parsed = JSON.parse(trimmed);

		// Handle file-based tool calls
		if (parsed?.tool && parsed?.file_path) {
			const filename = parsed.file_path.split("/").pop() || parsed.file_path;
			if (parsed.tool === "read") {
				return `Reading ${filename}`;
			}
			if (parsed.tool === "write" || parsed.tool === "edit" || parsed.tool === "create") {
				return `Implementing ${filename}`;
			}
		}

		// Handle bash tool calls
		if (parsed?.tool === "bash" && parsed?.command) {
			if (parsed.command.includes("test")) {
				return "Testing";
			}
			return `Running: ${parsed.command}`;
		}

		// Handle other tool calls
		if (parsed?.tool) {
			return `${parsed.tool}: ${JSON.stringify(parsed)}`;
		}
	} catch {
		// Not JSON, continue with text processing
	}

	// Skip thoughts if not requested
	if (!logThoughts) {
		// Filter out general AI thoughts - check for thought-starting patterns
		if (/^(i think|i need|need|should|could|will|going|can|might|let me)/i.test(trimmed)) {
			return null;
		}
		if (trimmed.includes(" think") || trimmed.includes("analyz") || trimmed.includes("consider")) {
			return null;
		}
		// Filter out long thoughts when not logging thoughts
		if (trimmed.length > 50) {
			return null;
		}
	}

	// Handle "Writing to" pattern specifically (before general patterns)
	const writingToMatch = trimmed.match(/^Writing to "([^"]+)"/);
	if (writingToMatch) {
		return `Implementing ${writingToMatch[1]}`;
	}

	// Handle "Reading file" pattern - return full text as-is
	const readingFileMatch = trimmed.match(/^Reading file "([^"]+)"/);
	if (readingFileMatch) {
		return trimmed;
	}

	// Handle cat command pattern
	const catMatch = trimmed.match(/^cat\s+(.+)$/);
	if (catMatch) {
		const filename = catMatch[1].split("/").pop() || catMatch[1];
		return `Reading ${filename}`;
	}

	// Handle "npm test" pattern
	if (trimmed === "npm test") {
		return "Testing";
	}

	// Handle validation/verifying/checking patterns
	if (/^(validating|verifying|checking|validated|verified)/i.test(trimmed)) {
		return logThoughts ? "Validating" : trimmed;
	}

	// Handle installing/installing pattern (before general building pattern)
	if (/^(installing|install)/i.test(trimmed)) {
		if (process.env.DEBUG) console.log(`Matched installing pattern: "${trimmed}"`);
		if (process.env.DEBUG) console.log(`Returning: "Installing"`);
		return "Installing";
	}

	// Handle building/compiling patterns
	if (/^(building|compiling)/i.test(trimmed)) {
		return logThoughts ? "Building" : trimmed;
	}

	// Truncate long thoughts when logThoughts is true
	if (logThoughts && trimmed.length > 50) {
		return `${trimmed.substring(0, 47)}...`;
	}

	// Check for patterns that indicate a step or action
	const stepPatterns = [
		// File operations (exclude "Writing" to prevent conflict with "Writing to" pattern)
		/^(Reading|Creating|Updating|Deleting|Modifying|Adding)\s+/i,
		/^(Created|Updated|Modified|Deleted|Added)\s+/i,
		// Code analysis
		/^(Analyzing|Examining|Scanning|Parsing)\s+/i,
		/^(Found|Located|Identified)\s+/i,
		// Test/Build operations
		/^(Running|Executing|Testing|Building)\s+/i,
		/^(Ran|Executed|Tested|Built)\s+/i,
		// Code generation
		/^(Generating|Creating|Implementing)\s+/i,
		// Git operations
		/^(Cloning|Committing|Pushing|Pulling)\s+/i,
	];

	for (const pattern of stepPatterns) {
		if (pattern.test(trimmed)) {
			return trimmed;
		}
	}

	// Return any non-empty, non-technical line as a step
	if (trimmed.length > 10 && !trimmed.includes("step_") && !trimmed.includes("session")) {
		return trimmed;
	}

	return null;
}
