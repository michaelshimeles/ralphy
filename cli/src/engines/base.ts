import { spawn, spawnSync } from "node:child_process";
import type { AIEngine, AIResult, EngineOptions, ProgressCallback } from "./types.ts";

// Check if running in Bun
const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";

/**
 * Check if a command is available in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
	try {
		const checkCommand = isWindows ? "where" : "which";
		if (isBun) {
			const proc = Bun.spawn([checkCommand, command], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			return exitCode === 0;
		}
		// Node.js fallback - where/which don't need shell
		const result = spawnSync(checkCommand, [command], { stdio: "pipe" });
		return result.status === 0;
	} catch {
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
	if (isBun) {
		// On Windows, run through cmd.exe to handle .cmd wrappers (npm global packages)
		const spawnArgs = isWindows ? ["cmd.exe", "/c", command, ...args] : [command, ...args];
		const proc = Bun.spawn(spawnArgs, {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

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
			resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
		});

		proc.on("error", (err) => {
			// Maintain backward compatibility - don't reject, include error in stderr
			stderr += `\nSpawn error: ${err.message}`;
			resolve({ stdout, stderr, exitCode: 1 });
		});
	});
}

/**
 * Parse token counts from stream-json output (Claude/Qwen format)
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
 * Check for errors in stream-json output
 */
export function checkForErrors(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "error") {
				return parsed.error?.message || parsed.message || "Unknown error";
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

/**
 * Extract authentication error message from stream-json output.
 * Looks for error type messages or result messages with authentication-related keywords.
 * Returns the clean error message if found, null otherwise.
 */
export function extractAuthenticationError(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);

			// Check if this is any kind of error response
			if (
				parsed.type === "error" ||
				parsed.is_error === true ||
				parsed.error === "authentication_failed"
			) {
				// Extract message from content array (assistant type) or standard fields
				let message = "";
				const content = parsed.message?.content;
				if (Array.isArray(content)) {
					const textItem = content.find(
						(item: { type?: string; text?: string }) => item.type === "text" && item.text,
					);
					if (textItem) message = textItem.text;
				}
				if (!message) {
					message = parsed.result || parsed.error?.message || parsed.message || "";
				}

				if (message && isAuthenticationMessage(message.toLowerCase())) {
					return message;
				}
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

/**
 * Check if a message contains authentication-related keywords
 */
function isAuthenticationMessage(messageLower: string): boolean {
	return (
		messageLower.includes("invalid api key") ||
		messageLower.includes("authentication") ||
		messageLower.includes("not authenticated") ||
		messageLower.includes("unauthorized") ||
		messageLower.includes("/login")
	);
}

/**
 * Format a command failure with useful output context.
 * If the output contains an authentication error, returns just that error message.
 * Otherwise returns the full error with output context.
 */
export function formatCommandError(exitCode: number, output: string): string {
	const trimmed = output.trim();
	if (!trimmed) {
		return `Command failed with exit code ${exitCode}`;
	}

	// Check for authentication errors first - return the clean message if found
	const authError = extractAuthenticationError(output);
	if (authError) {
		return authError;
	}

	const lines = trimmed.split("\n").filter(Boolean);
	const snippet = lines.slice(-12).join("\n");
	return `Command failed with exit code ${exitCode}. Output:\n${snippet}`;
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
): Promise<{ exitCode: number }> {
	if (isBun) {
		// On Windows, run through cmd.exe to handle .cmd wrappers (npm global packages)
		const spawnArgs = isWindows ? ["cmd.exe", "/c", command, ...args] : [command, ...args];
		const proc = Bun.spawn(spawnArgs, {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		// Process both stdout and stderr in parallel
		await Promise.all([readStream(proc.stdout, onLine), readStream(proc.stderr, onLine)]);

		const exitCode = await proc.exited;
		return { exitCode };
	}

	// Node.js fallback - use shell on Windows to execute .cmd wrappers
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
			shell: isWindows, // Required on Windows for npm global commands (.cmd wrappers)
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		let stdoutBuffer = "";
		let stderrBuffer = "";

		const processBuffer = (buffer: string, isStderr = false) => {
			const lines = buffer.split("\n");
			const remaining = lines.pop() || "";
			for (const line of lines) {
				if (line.trim()) onLine(line);
			}
			return remaining;
		};

		proc.stdout?.on("data", (data) => {
			stdoutBuffer += data.toString();
			stdoutBuffer = processBuffer(stdoutBuffer);
		});

		proc.stderr?.on("data", (data) => {
			stderrBuffer += data.toString();
			stderrBuffer = processBuffer(stderrBuffer, true);
		});

		proc.on("close", (exitCode) => {
			// Process any remaining data
			if (stdoutBuffer.trim()) onLine(stdoutBuffer);
			if (stderrBuffer.trim()) onLine(stderrBuffer);
			resolve({ exitCode: exitCode ?? 1 });
		});

		proc.on("error", (err) => {
			// Maintain backward compatibility - don't reject, report error via onLine
			onLine(`Spawn error: ${err.message}`);
			resolve({ exitCode: 1 });
		});
	});
}

/**
 * Check if a file path looks like a test file
 */
function isTestFile(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return (
		lower.includes(".test.") ||
		lower.includes(".spec.") ||
		lower.includes("__tests__") ||
		lower.includes("_test.go")
	);
}

/**
 * Detect the current step from a JSON output line
 * Returns step name like "Reading code", "Implementing", etc.
 */
export function detectStepFromOutput(line: string): string | null {
	// Fast path: skip non-JSON lines
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);

		// Cline --json output (one object per line)
		// https://github.com/cline/cline
		if (parsed?.type === "say" && typeof parsed.say === "string") {
			if (parsed.say === "tool") return "Implementing";
			if (parsed.say === "text") return "Implementing";
		}

		// Extract specific fields for pattern matching (avoid stringifying entire object)
		const toolName =
			parsed.tool?.toLowerCase() ||
			parsed.name?.toLowerCase() ||
			parsed.tool_name?.toLowerCase() ||
			"";
		const command = parsed.command?.toLowerCase() || "";
		const filePath = (parsed.file_path || parsed.filePath || parsed.path || "").toLowerCase();
		const description = (parsed.description || "").toLowerCase();

		// Check tool name first to determine operation type
		const isReadOperation = toolName === "read" || toolName === "glob" || toolName === "grep";
		const isWriteOperation = toolName === "write" || toolName === "edit";

		// Reading code - check this early to avoid misclassifying reads of test files
		if (isReadOperation) {
			return "Reading code";
		}

		// Git commit
		if (command.includes("git commit") || description.includes("git commit")) {
			return "Committing";
		}

		// Git add/staging
		if (command.includes("git add") || description.includes("git add")) {
			return "Staging";
		}

		// Linting - check command for lint tools
		if (
			command.includes("lint") ||
			command.includes("eslint") ||
			command.includes("biome") ||
			command.includes("prettier")
		) {
			return "Linting";
		}

		// Testing - check command for test runners
		if (
			command.includes("vitest") ||
			command.includes("jest") ||
			command.includes("bun test") ||
			command.includes("npm test") ||
			command.includes("pytest") ||
			command.includes("go test")
		) {
			return "Testing";
		}

		// Writing tests - only for write operations to test files
		if (isWriteOperation && isTestFile(filePath)) {
			return "Writing tests";
		}

		// Writing/Editing code
		if (isWriteOperation) {
			return "Implementing";
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Base implementation for AI engines
 */
export abstract class BaseAIEngine implements AIEngine {
	abstract name: string;
	abstract cliCommand: string;

	async isAvailable(): Promise<boolean> {
		return commandExists(this.cliCommand);
	}

	abstract execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult>;

	/**
	 * Execute with streaming progress updates (optional implementation)
	 */
	executeStreaming?(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult>;
}
