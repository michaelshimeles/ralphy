import type { AIEngine, AIResult, ProgressCallback } from "./types.ts";

/**
 * Check if a command is available in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["which", command], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Execute a command and return stdout
 */
export async function execCommand(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn([command, ...args], {
		cwd: workDir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { stdout, stderr, exitCode };
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
 * Read a stream line by line, calling onLine for each non-empty line
 */
async function readStream(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
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
 */
export async function execCommandStreaming(
	command: string,
	args: string[],
	workDir: string,
	onLine: (line: string) => void,
	env?: Record<string, string>
): Promise<{ exitCode: number }> {
	const proc = Bun.spawn([command, ...args], {
		cwd: workDir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});

	// Process both stdout and stderr in parallel
	await Promise.all([
		readStream(proc.stdout, onLine),
		readStream(proc.stderr, onLine),
	]);

	const exitCode = await proc.exited;
	return { exitCode };
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

	abstract execute(prompt: string, workDir: string): Promise<AIResult>;

	/**
	 * Execute with streaming progress updates (optional implementation)
	 */
	executeStreaming?(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback
	): Promise<AIResult>;
}
