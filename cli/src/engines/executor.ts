import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { logDebug } from "../ui/logger.ts";
import { registerProcess } from "../utils/cleanup.ts";
import { validateCommandAndArgs } from "./validation.ts";

// Check if running in Bun
const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";
const DEBUG = process.env.RALPHY_DEBUG === "true";

function debugLog(...args: unknown[]): void {
	if (DEBUG || (globalThis as { verboseMode?: boolean }).verboseMode === true) {
		logDebug(args.map((a) => String(a)).join(" "));
	}
}

/**
 * Command execution result
 */
export interface ExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
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

		// Node.js fallback
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
 * @param stdinContent - Optional content to pass via stdin
 */
export async function execCommand(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<ExecutionResult> {
	debugLog(`execCommand: ${command} ${args.join(" ")}`);
	debugLog(`execCommand: workDir=${workDir}, hasEnv=${!!env}, hasStdin=${!!stdinContent}`);

	// Validate command and arguments for security (applies to both Bun and Node.js)
	const validation = validateCommandAndArgs(command, args);
	if (!validation.valid || !validation.command || !validation.args) {
		return Promise.resolve({
			stdout: "",
			stderr: `Error: ${validation.error}`,
			exitCode: 1,
		});
	}

	// Use validated values
	const validatedCommand = validation.command;
	const validatedArgs = validation.args;

	if (isBun) {
		return execWithBun(validatedCommand, validatedArgs, workDir, env, stdinContent);
	}

	return execWithNode(validatedCommand, validatedArgs, workDir, env, stdinContent);
}

/**
 * Execute command using Bun runtime
 */
async function execWithBun(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<ExecutionResult> {
	const spawnArgs = [command, ...args];
	debugLog(`execCommand: spawning with Bun, spawnArgs=${spawnArgs.join(" ")}`);

	const proc = Bun.spawn(spawnArgs, {
		cwd: workDir,
		stdin: stdinContent ? "pipe" : "ignore",
		stdout: "pipe",
		stderr: "pipe",
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

/**
 * Execute command using Node.js runtime
 */
function execWithNode(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<ExecutionResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
			shell: false, // Disable shell to prevent command injection
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

		proc.on("close", (code) => {
			unregister();
			resolve({
				stdout,
				stderr,
				exitCode: code ?? 1,
			});
		});

		proc.on("error", (err) => {
			unregister();
			const errorMessage = err.message || String(err);
			const mergedStderr = stderr ? `${stderr}\n${errorMessage}` : errorMessage;
			resolve({
				stdout,
				stderr: mergedStderr,
				exitCode: 1,
			});
		});
	});
}

/**
 * Streaming execution result
 */
export interface StreamingExecutionResult {
	process: import("./types.ts").ChildProcess;
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
}

/**
 * Execute a command with streaming output and callback
 * Legacy API for backward compatibility with existing engines
 */
export async function execCommandStreaming(
	command: string,
	args: string[],
	workDir: string,
	onLine: (line: string) => void,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<{ exitCode: number }> {
	debugLog(`execCommandStreaming (legacy): ${command} ${args.join(" ")}`);

	const {
		process: childProcess,
		stdout,
		stderr,
	} = await execCommandStreamingNew(command, args, workDir, env, stdinContent);

	const timeout = Number(globalThis.process.env.RALPHY_EXECUTION_TIMEOUT || 30 * 60 * 1000);
	let timedOut = false;

	const timeoutId = setTimeout(() => {
		timedOut = true;
		try {
			childProcess.kill("SIGTERM");
		} catch {
			// no-op
		}

		setTimeout(() => {
			if (!timedOut) return;
			try {
				childProcess.kill("SIGKILL");
			} catch {
				// no-op
			}
		}, 3000);
	}, timeout);

	const readStreamLines = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
		if (!stream) return;
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (line.trim()) {
						onLine(line);
					}
				}
			}

			buffer += decoder.decode();
			if (buffer.trim()) {
				onLine(buffer);
			}
		} finally {
			reader.releaseLock();
		}
	};

	const exitPromise = childProcess.exited
		? childProcess.exited
		: new Promise<number>((resolve) => {
				(childProcess as import("node:child_process").ChildProcess).once("close", (code) => {
					resolve(code ?? 1);
				});
				(childProcess as import("node:child_process").ChildProcess).once("error", () => {
					resolve(1);
				});
			});

	const [exitCode] = await Promise.all([
		exitPromise,
		readStreamLines(stdout),
		readStreamLines(stderr),
	]);
	clearTimeout(timeoutId);
	const didTimeOut = timedOut;
	timedOut = false;

	return { exitCode: didTimeOut ? 1 : (exitCode ?? 1) };
}

/**
 * Execute a command with streaming output (returns streams)
 * New API for use with BaseAIEngine streaming
 */
export async function execCommandStreamingNew(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<StreamingExecutionResult> {
	debugLog(`execCommandStreamingNew: ${command} ${args.join(" ")}`);

	const validation = validateCommandAndArgs(command, args);
	if (!validation.valid || !validation.command || !validation.args) {
		throw new Error(validation.error || "Command validation failed");
	}

	const validatedCommand = validation.command;
	const validatedArgs = validation.args;

	if (isBun) {
		const spawnArgs = [validatedCommand, ...validatedArgs];
		const proc = Bun.spawn(spawnArgs, {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...(env || {}) },
		});

		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		return {
			process: proc as unknown as import("./types.ts").ChildProcess,
			stdout: proc.stdout,
			stderr: proc.stderr,
		};
	}

	// Node.js fallback

	const proc = spawn(validatedCommand, validatedArgs, {
		cwd: workDir,
		env: { ...process.env, ...env },
		stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
		shell: false,
	});
	const unregister = registerProcess(proc);
	let cleaned = false;
	const unregisterOnce = () => {
		if (cleaned) return;
		cleaned = true;
		unregister();
	};
	proc.once("close", unregisterOnce);
	proc.once("error", unregisterOnce);

	if (stdinContent && proc.stdin) {
		proc.stdin.write(stdinContent);
		proc.stdin.end();
	}

	const exited = new Promise<number>((resolve) => {
		proc.once("close", (code) => resolve(code ?? 1));
		proc.once("error", () => resolve(1));
	});

	const processWithExit = Object.assign(proc, { exited }) as import("./types.ts").ChildProcess;

	const stdout = proc.stdout
		? (Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>)
		: null;
	const stderr = proc.stderr
		? (Readable.toWeb(proc.stderr) as unknown as ReadableStream<Uint8Array>)
		: null;

	return {
		process: processWithExit,
		stdout,
		stderr,
	};
}
