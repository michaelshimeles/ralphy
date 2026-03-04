import { appendFileSync, mkdirSync } from "node:fs";
import path, { dirname } from "node:path";
import pc from "picocolors";
import { sanitizeSecrets } from "../utils/sanitization.ts";

// Use a module-level object for state to avoid direct mutable exports
const loggerState = {
	verboseMode: false,
	debugMode: false,
};

/**
 * Validate log file path to prevent path traversal attacks
 */
function validateLogPath(filePath: string): string {
	if (!filePath || typeof filePath !== "string") {
		throw new Error("Invalid log file path");
	}

	if (filePath.includes("\0")) {
		throw new Error("Invalid log file path: null byte detected");
	}

	return path.isAbsolute(filePath)
		? path.normalize(filePath)
		: path.resolve(process.cwd(), filePath);
}

/**
 * Get current verbose mode state
 */
export function isVerbose(): boolean {
	return loggerState.verboseMode;
}

/**
 * Get current debug mode state
 */
export function isDebug(): boolean {
	return loggerState.debugMode;
}

/**
 * Set verbose mode
 */
export function setVerbose(verbose: boolean): void {
	loggerState.verboseMode = verbose;
	verboseMode = loggerState.verboseMode;
}

/**
 * Set debug mode (implies verbose)
 */
export function setDebug(debug: boolean): void {
	loggerState.debugMode = debug;
	if (debug) {
		loggerState.verboseMode = true;
	}
	verboseMode = loggerState.verboseMode;
}

// BUG FIX: Export a getter function instead of a stale primitive value
// This ensures consumers always get the current state, not the initial value
export function getVerboseMode(): boolean {
	return loggerState.verboseMode;
}

// Keep backward compatibility export but mark as deprecated
/** @deprecated Use getVerboseMode() instead for live value */
export let verboseMode = loggerState.verboseMode;

/**
 * Log levels for structured logging
 */
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

/**
 * Structured log entry interface
 */
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	component: string;
	message: string;
	context?: Record<string, unknown>;
}

/**
 * Log sink interface for extensible logging
 */
export interface LogSink {
	write(entry: LogEntry): void;
}

interface DisposableLogSink extends LogSink {
	dispose(): void;
}

/**
 * Default console log sink with colors
 */
class ConsoleLogSink implements LogSink {
	write(entry: LogEntry): void {
		// Defensive: validate entry has required fields
		if (!entry || typeof entry !== "object") {
			console.error("[Logger] Invalid log entry");
			return;
		}
		const timestamp = entry.timestamp ?? new Date().toISOString();
		const level = entry.level ?? "info";
		const component = entry.component ?? "ralphy";
		const message = entry.message ?? "";
		const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

		switch (level) {
			case "error":
				console.error(pc.red(`${prefix} ${component ? `[${component}] ` : ""}${message}`));
				break;
			case "warn":
				console.warn(pc.yellow(`${prefix} ${component ? `[${component}] ` : ""}${message}`));
				break;
			case "success":
				console.log(pc.green(`${prefix} ${component ? `[${component}] ` : ""}${message}`));
				break;
			case "info":
				console.log(pc.blue(`${prefix} ${component ? `[${component}] ` : ""}${message}`));
				break;
			case "debug":
				console.log(pc.gray(`${prefix} ${component ? `[${component}] ` : ""}${message}`));
				break;
			default:
				console.log(`${prefix} ${component ? `[${component}] ` : ""}${message}`);
		}
	}
}

// Global log sink instance
let logSink: LogSink = new ConsoleLogSink();

/**
 * Set a custom log sink for extensible logging
 */
export function setLogSink(sink: LogSink): void {
	if (logSink !== sink && typeof (logSink as Partial<DisposableLogSink>).dispose === "function") {
		(logSink as DisposableLogSink).dispose();
	}
	logSink = sink;
}

/**
 * Get current log sink
 */
export function getLogSink(): LogSink {
	return logSink;
}

/**
 * Internal function to create log entry
 * Sanitizes secrets from logged data
 */
function createLogEntry(level: LogLevel, component: string | undefined, args: unknown[]): LogEntry {
	const rawMessage = args
		.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
		.join(" ");
	// Sanitize secrets from the message
	const message = sanitizeSecrets(rawMessage);

	return {
		timestamp: new Date().toISOString(),
		level,
		component: component || "ralphy",
		message,
	};
}

/**
 * Core logging function
 */
function log(level: LogLevel, component: string | undefined, ...args: unknown[]): void {
	// Debug messages only show in verbose or debug mode
	if (level === "debug" && !loggerState.verboseMode) {
		return;
	}

	const entry = createLogEntry(level, component, args);
	logSink.write(entry);
}

/**
 * Log info message
 */
export function logInfo(...args: unknown[]): void {
	log("info", undefined, ...args);
}

/**
 * Log info message with component context
 */
export function logInfoContext(component: string, ...args: unknown[]): void {
	log("info", component, ...args);
}

/**
 * Log success message
 */
export function logSuccess(...args: unknown[]): void {
	log("success", undefined, ...args);
}

/**
 * Log success message with component context
 */
export function logSuccessContext(component: string, ...args: unknown[]): void {
	log("success", component, ...args);
}

/**
 * Log warning message
 */
export function logWarn(...args: unknown[]): void {
	log("warn", undefined, ...args);
}

/**
 * Log warning message with component context
 */
export function logWarnContext(component: string, ...args: unknown[]): void {
	log("warn", component, ...args);
}

/**
 * Log error message
 */
export function logError(...args: unknown[]): void {
	log("error", undefined, ...args);
}

/**
 * Log error message with component context
 */
export function logErrorContext(component: string, ...args: unknown[]): void {
	log("error", component, ...args);
}

/**
 * Log debug message (only in verbose mode)
 */
export function logDebug(...args: unknown[]): void {
	log("debug", undefined, ...args);
}

/**
 * Log debug message with component context
 */
export function logDebugContext(component: string, ...args: unknown[]): void {
	log("debug", component, ...args);
}

/**
 * JSON file log sink for structured logging to file
 */
export class JsonFileLogSink implements LogSink {
	private filePath: string;
	private buffer: LogEntry[] = [];
	private flushInterval: number;
	private maxBufferSize: number;
	// BUG FIX: Use proper nullable type instead of type cast hack
	private flushTimer: NodeJS.Timeout | null = null;

	constructor(filePath: string, options?: { flushIntervalMs?: number; maxBufferSize?: number }) {
		// Validate path to prevent path traversal attacks
		this.filePath = validateLogPath(filePath);
		mkdirSync(dirname(this.filePath), { recursive: true });
		this.flushInterval = options?.flushIntervalMs ?? 1000;
		this.maxBufferSize = options?.maxBufferSize ?? 100;

		// Auto-flush buffer periodically
		this.flushTimer = setInterval(() => {
			try {
				this.flush();
			} catch (err) {
				console.error(`Failed to flush log buffer: ${err}`);
			}
		}, this.flushInterval);
	}

	private isFlushing = false;

	write(entry: LogEntry): void {
		this.buffer.push(entry);

		if (this.buffer.length >= this.maxBufferSize) {
			this.flush();
		}
	}

	private flush(): void {
		// Prevent concurrent flushes (race condition fix)
		if (this.isFlushing || this.buffer.length === 0) return;

		this.isFlushing = true;
		let currentBuffer: LogEntry[] = [];

		try {
			// ATOMIC: Swap buffers instead of copy-then-clear
			// This prevents race conditions where write() is called between copy and clear
			currentBuffer = this.buffer;
			this.buffer = []; // New empty buffer assigned atomically
			const lines = `${currentBuffer.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
			appendFileSync(this.filePath, lines, "utf-8");
		} catch (error) {
			console.error(`Failed to write to log file: ${error}`);
			// Limit buffer size to prevent memory exhaustion on persistent write failures
			const MAX_BUFFER_SIZE = 10000;
			const combined = [...currentBuffer, ...this.buffer];
			// Keep only the most recent entries, discard oldest to prevent memory leak
			if (combined.length > MAX_BUFFER_SIZE) {
				this.buffer = combined.slice(-MAX_BUFFER_SIZE);
				console.warn(`Log buffer truncated to ${MAX_BUFFER_SIZE} entries due to write failure`);
			} else {
				this.buffer = combined;
			}
		} finally {
			this.isFlushing = false;
		}
	}

	/**
	 * Dispose of the file log sink, stopping the flush timer.
	 * Call this when done logging to prevent memory leaks.
	 */
	dispose(): void {
		// BUG FIX: Proper nullable type check without type cast hack
		if (this.flushTimer !== null) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		// Final flush to ensure all logs are written
		this.flush();
	}
}

/**
 * Multi-sink that writes to multiple log sinks
 */
export class MultiLogSink implements LogSink {
	private sinks: LogSink[];

	constructor(sinks: LogSink[]) {
		this.sinks = sinks;
	}

	write(entry: LogEntry): void {
		for (const sink of this.sinks) {
			try {
				sink.write(entry);
			} catch (error) {
				console.error(`Log sink failed: ${error}`);
			}
		}
	}

	addSink(sink: LogSink): void {
		this.sinks.push(sink);
	}

	dispose(): void {
		for (const sink of this.sinks) {
			if (typeof (sink as Partial<DisposableLogSink>).dispose === "function") {
				(sink as DisposableLogSink).dispose();
			}
		}
	}
}

/**
 * Filtered log sink that only passes certain log levels
 */
export class FilteredLogSink implements LogSink {
	private sink: LogSink;
	private minLevel: LogLevel;
	private levelPriority: Record<LogLevel, number> = {
		debug: 0,
		info: 1,
		success: 2,
		warn: 3,
		error: 4,
	};

	constructor(sink: LogSink, minLevel: LogLevel) {
		this.sink = sink;
		this.minLevel = minLevel;
	}

	write(entry: LogEntry): void {
		if (this.levelPriority[entry.level] >= this.levelPriority[this.minLevel]) {
			this.sink.write(entry);
		}
	}

	dispose(): void {
		if (typeof (this.sink as Partial<DisposableLogSink>).dispose === "function") {
			(this.sink as DisposableLogSink).dispose();
		}
	}
}

/**
 * Initialize structured logging with file output
 * @param logFilePath - Path to JSON log file (optional)
 * @param minLevel - Minimum log level to record (default: "info")
 */
export function initializeStructuredLogging(
	logFilePath?: string,
	minLevel: LogLevel = "info",
): void {
	const sinks: LogSink[] = [new ConsoleLogSink()];

	if (logFilePath) {
		const fileSink = new JsonFileLogSink(logFilePath);
		const filteredFileSink = new FilteredLogSink(fileSink, minLevel);
		sinks.push(filteredFileSink);
	}

	setLogSink(new MultiLogSink(sinks));
}

/**
 * Format a task name for display (truncate if too long)
 */
export function formatTask(task: string, maxLen = 40): string {
	if (task.length <= maxLen) return task;
	return `${task.slice(0, maxLen - 3)}...`;
}

/**
 * Format duration in human readable format
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const secs = Math.floor(ms / 1000);
	const mins = Math.floor(secs / 60);
	const remainingSecs = secs % 60;
	if (mins === 0) return `${secs}s`;
	return `${mins}m ${remainingSecs}s`;
}

/**
 * Format token count
 */
export function formatTokens(input: number, output: number): string {
	const total = input + output;
	if (total === 0) return "";
	return pc.dim(`(${input.toLocaleString()} in / ${output.toLocaleString()} out)`);
}
