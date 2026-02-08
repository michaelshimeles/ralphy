/**
 * Telemetry Writer
 *
 * Persists session and tool call data to JSONL files.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Session, SessionFull, ToolCall } from "./types.js";

const DEFAULT_OUTPUT_DIR = ".ralphy/telemetry";
const SESSIONS_FILE = "sessions.jsonl";
const TOOL_CALLS_FILE = "tool_calls.jsonl";

/**
 * Telemetry Writer
 *
 * Handles file persistence for telemetry data.
 * Writes to JSONL format for easy streaming and processing.
 */
export class TelemetryWriter {
	private outputDir: string;
	private initialized = false;

	constructor(outputDir?: string) {
		this.outputDir = outputDir || DEFAULT_OUTPUT_DIR;
	}

	/**
	 * Get the output directory path
	 */
	getOutputDir(): string {
		return this.outputDir;
	}

	/**
	 * Ensure output directory exists
	 */
	private async ensureDir(): Promise<void> {
		if (this.initialized) return;

		const sessionsPath = join(this.outputDir, SESSIONS_FILE);
		const dirPath = dirname(sessionsPath);

		if (!existsSync(dirPath)) {
			await mkdir(dirPath, { recursive: true });
		}

		this.initialized = true;
	}

	/**
	 * Append a session record to sessions.jsonl
	 */
	async writeSession(session: Session | SessionFull): Promise<void> {
		await this.ensureDir();
		const path = join(this.outputDir, SESSIONS_FILE);
		const line = `${JSON.stringify(session)}\n`;
		await appendFile(path, line, "utf-8");
	}

	/**
	 * Append tool call records to tool_calls.jsonl
	 */
	async writeToolCalls(toolCalls: ToolCall[]): Promise<void> {
		if (toolCalls.length === 0) return;

		await this.ensureDir();
		const path = join(this.outputDir, TOOL_CALLS_FILE);
		const lines = `${toolCalls.map((call) => JSON.stringify(call)).join("\n")}\n`;
		await appendFile(path, lines, "utf-8");
	}

	/**
	 * Write session and tool calls together
	 */
	async write(session: Session | SessionFull, toolCalls: ToolCall[]): Promise<void> {
		await Promise.all([this.writeSession(session), this.writeToolCalls(toolCalls)]);
	}

	/**
	 * Read all sessions from the JSONL file
	 */
	async readSessions(): Promise<Array<Session | SessionFull>> {
		const path = join(this.outputDir, SESSIONS_FILE);

		if (!existsSync(path)) {
			return [];
		}

		const content = await readFile(path, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		return lines.map((line) => JSON.parse(line) as Session | SessionFull);
	}

	/**
	 * Read all tool calls from the JSONL file
	 */
	async readToolCalls(): Promise<ToolCall[]> {
		const path = join(this.outputDir, TOOL_CALLS_FILE);

		if (!existsSync(path)) {
			return [];
		}

		const content = await readFile(path, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		return lines.map((line) => JSON.parse(line) as ToolCall);
	}

	/**
	 * Read tool calls for a specific session
	 */
	async readSessionToolCalls(sessionId: string): Promise<ToolCall[]> {
		const allCalls = await this.readToolCalls();
		return allCalls.filter((call) => call.sessionId === sessionId);
	}

	/**
	 * Check if any telemetry data exists
	 */
	async hasData(): Promise<boolean> {
		const sessionsPath = join(this.outputDir, SESSIONS_FILE);
		return existsSync(sessionsPath);
	}

	/**
	 * Get stats about collected data
	 */
	async getStats(): Promise<{
		sessionCount: number;
		toolCallCount: number;
		totalTokensIn: number;
		totalTokensOut: number;
		oldestTimestamp?: number;
		newestTimestamp?: number;
	}> {
		const sessions = await this.readSessions();

		if (sessions.length === 0) {
			return {
				sessionCount: 0,
				toolCallCount: 0,
				totalTokensIn: 0,
				totalTokensOut: 0,
			};
		}

		let totalTokensIn = 0;
		let totalTokensOut = 0;
		let toolCallCount = 0;
		let oldestTimestamp = sessions[0].timestamp;
		let newestTimestamp = sessions[0].timestamp;

		for (const session of sessions) {
			totalTokensIn += session.totalTokensIn;
			totalTokensOut += session.totalTokensOut;
			toolCallCount += session.toolCalls.reduce((sum, tc) => sum + tc.callCount, 0);

			if (session.timestamp < oldestTimestamp) {
				oldestTimestamp = session.timestamp;
			}
			if (session.timestamp > newestTimestamp) {
				newestTimestamp = session.timestamp;
			}
		}

		return {
			sessionCount: sessions.length,
			toolCallCount,
			totalTokensIn,
			totalTokensOut,
			oldestTimestamp,
			newestTimestamp,
		};
	}

	/**
	 * List available export files
	 */
	async listExports(): Promise<string[]> {
		const exportsDir = join(this.outputDir, "exports");

		if (!existsSync(exportsDir)) {
			return [];
		}

		const files = await readdir(exportsDir);
		return files.filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"));
	}
}
