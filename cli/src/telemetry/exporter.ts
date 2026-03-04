/**
 * Telemetry Exporter
 *
 * Exports collected telemetry data to various formats:
 * - DeepEval JSON: For evaluation frameworks
 * - OpenAI Evals JSONL: For OpenAI-compatible eval pipelines
 * - Raw JSONL: For custom processing
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	DeepEvalExport,
	DeepEvalTestCase,
	ExportFormat,
	OpenAIEvalsEntry,
	RawExportEntry,
	Session,
	SessionFull,
	ToolCall,
} from "./types.js";
import { TelemetryWriter } from "./writer.js";

/**
 * Check if a session is a full session (has prompt/response)
 */
function isFullSession(session: Session | SessionFull): session is SessionFull {
	return "prompt" in session || "response" in session || "filePaths" in session;
}

/**
 * Telemetry Exporter
 *
 * Transforms and exports telemetry data to various formats
 * suitable for model provider eval pipelines.
 */
export class TelemetryExporter {
	private writer: TelemetryWriter;
	private outputDir: string;
	private exportsDir: string;

	constructor(outputDir?: string) {
		this.outputDir = outputDir || ".ralphy/telemetry";
		this.exportsDir = join(this.outputDir, "exports");
		this.writer = new TelemetryWriter(this.outputDir);
	}

	/**
	 * Ensure exports directory exists
	 */
	private async ensureExportsDir(): Promise<void> {
		if (!existsSync(this.exportsDir)) {
			await mkdir(this.exportsDir, { recursive: true });
		}
	}

	/**
	 * Export to DeepEval JSON format
	 */
	async exportDeepEval(outputPath?: string): Promise<string> {
		const sessions = await this.writer.readSessions();
		const toolCalls = await this.writer.readToolCalls();

		// Group tool calls by session
		const callsBySession = new Map<string, ToolCall[]>();
		for (const call of toolCalls) {
			const existing = callsBySession.get(call.sessionId) || [];
			existing.push(call);
			callsBySession.set(call.sessionId, existing);
		}

		const testCases: DeepEvalTestCase[] = sessions.map((session) => {
			const sessionCalls = callsBySession.get(session.sessionId) || [];
			const toolNames = [...new Set(sessionCalls.map((c) => c.toolName))];

			const testCase: DeepEvalTestCase = {
				input:
					isFullSession(session) && session.prompt
						? session.prompt
						: `[${session.engine}] Task session`,
				actual_output:
					isFullSession(session) && session.response
						? session.response
						: session.successCount > 0
							? "Task completed successfully"
							: "Task failed",
				context: isFullSession(session) && session.filePaths ? session.filePaths : [],
				tools: toolNames,
				metadata: {
					session_id: session.sessionId,
					engine: session.engine,
					tokens_in: session.totalTokensIn,
					tokens_out: session.totalTokensOut,
					success: session.successCount > 0 && session.failedCount === 0,
					duration_ms: session.totalDurationMs,
				},
			};

			return testCase;
		});

		const exportData: DeepEvalExport = { test_cases: testCases };

		await this.ensureExportsDir();
		const filePath = outputPath || join(this.exportsDir, "deepeval-dataset.json");
		await writeFile(filePath, JSON.stringify(exportData, null, 2), "utf-8");

		return filePath;
	}

	/**
	 * Export to OpenAI Evals JSONL format
	 */
	async exportOpenAI(outputPath?: string): Promise<string> {
		const sessions = await this.writer.readSessions();
		const toolCalls = await this.writer.readToolCalls();

		// Group tool calls by session
		const callsBySession = new Map<string, ToolCall[]>();
		for (const call of toolCalls) {
			const existing = callsBySession.get(call.sessionId) || [];
			existing.push(call);
			callsBySession.set(call.sessionId, existing);
		}

		const entries: string[] = sessions.map((session) => {
			const sessionCalls = callsBySession.get(session.sessionId) || [];
			const toolNames = [...new Set(sessionCalls.map((c) => c.toolName))];

			const entry: OpenAIEvalsEntry = {
				metadata: {
					session_id: session.sessionId,
					engine: session.engine,
					mode: session.mode,
					tools_used: toolNames,
					tokens_in: session.totalTokensIn,
					tokens_out: session.totalTokensOut,
					success: session.successCount > 0 && session.failedCount === 0,
					duration_ms: session.totalDurationMs,
					task_count: session.taskCount,
					platform: session.platform,
				},
			};

			// Add full mode fields
			if (isFullSession(session)) {
				if (session.prompt) {
					entry.input = [
						{ role: "system", content: "AI coding assistant" },
						{ role: "user", content: session.prompt },
					];
				}
				if (session.response) {
					entry.ideal = session.response;
				}
			}

			return JSON.stringify(entry);
		});

		await this.ensureExportsDir();
		const filePath = outputPath || join(this.exportsDir, "openai-evals.jsonl");
		await writeFile(filePath, `${entries.join("\n")}\n`, "utf-8");

		return filePath;
	}

	/**
	 * Export to raw JSONL format
	 */
	async exportRaw(outputPath?: string): Promise<string> {
		const sessions = await this.writer.readSessions();
		const toolCalls = await this.writer.readToolCalls();

		const entries: RawExportEntry[] = [];

		// Add sessions
		for (const session of sessions) {
			entries.push({ type: "session", data: session });
		}

		// Add tool calls
		for (const call of toolCalls) {
			entries.push({ type: "tool_call", data: call });
		}

		// Sort by timestamp
		entries.sort((a, b) => {
			const aTime = "timestamp" in a.data ? a.data.timestamp : 0;
			const bTime = "timestamp" in b.data ? b.data.timestamp : 0;
			return aTime - bTime;
		});

		await this.ensureExportsDir();
		const filePath = outputPath || join(this.exportsDir, "raw-telemetry.jsonl");
		const lines = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
		await writeFile(filePath, lines, "utf-8");

		return filePath;
	}

	/**
	 * Export to specified format
	 */
	async export(format: ExportFormat, outputPath?: string): Promise<string> {
		switch (format) {
			case "deepeval":
				return this.exportDeepEval(outputPath);
			case "openai":
				return this.exportOpenAI(outputPath);
			case "raw":
				return this.exportRaw(outputPath);
			default:
				throw new Error(`Unknown export format: ${format}`);
		}
	}

	/**
	 * Export to all formats
	 */
	async exportAll(): Promise<{ deepeval: string; openai: string; raw: string }> {
		const [deepeval, openai, raw] = await Promise.all([
			this.exportDeepEval(),
			this.exportOpenAI(),
			this.exportRaw(),
		]);

		return { deepeval, openai, raw };
	}

	/**
	 * Get summary statistics for export
	 */
	async getSummary(): Promise<{
		sessionCount: number;
		toolCallCount: number;
		engines: string[];
		modes: string[];
		toolsUsed: string[];
		totalTokensIn: number;
		totalTokensOut: number;
		successRate: number;
	}> {
		const sessions = await this.writer.readSessions();
		const toolCalls = await this.writer.readToolCalls();

		const engines = new Set<string>();
		const modes = new Set<string>();
		const tools = new Set<string>();

		let totalTokensIn = 0;
		let totalTokensOut = 0;
		let totalSuccess = 0;
		let totalFailed = 0;

		for (const session of sessions) {
			engines.add(session.engine);
			modes.add(session.mode);
			totalTokensIn += session.totalTokensIn;
			totalTokensOut += session.totalTokensOut;
			totalSuccess += session.successCount;
			totalFailed += session.failedCount;

			for (const tc of session.toolCalls) {
				tools.add(tc.toolName);
			}
		}

		const totalTasks = totalSuccess + totalFailed;
		const successRate = totalTasks > 0 ? (totalSuccess / totalTasks) * 100 : 0;

		return {
			sessionCount: sessions.length,
			toolCallCount: toolCalls.length,
			engines: Array.from(engines),
			modes: Array.from(modes),
			toolsUsed: Array.from(tools),
			totalTokensIn,
			totalTokensOut,
			successRate: Math.round(successRate * 100) / 100,
		};
	}
}
