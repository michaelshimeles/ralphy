import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { TelemetryExporter } from "../exporter.ts";
import { TelemetryWriter } from "../writer.ts";
import type { Session, ToolCall } from "../types.ts";

const TEST_DIR = "/tmp/ralphy-exporter-test";

describe("TelemetryExporter", () => {
	let exporter: TelemetryExporter;
	let writer: TelemetryWriter;

	beforeEach(async () => {
		// Clean up test directory
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
		await mkdir(TEST_DIR, { recursive: true });
		exporter = new TelemetryExporter(TEST_DIR);
		writer = new TelemetryWriter(TEST_DIR);

		// Write some test data
		const session: Session = {
			sessionId: "test-session-1",
			timestamp: Date.now(),
			engine: "claude",
			mode: "sequential",
			cliVersion: "1.0.0",
			platform: "darwin",
			totalTokensIn: 1000,
			totalTokensOut: 500,
			totalDurationMs: 30000,
			taskCount: 2,
			successCount: 2,
			failedCount: 0,
			toolCalls: [
				{
					toolName: "Read",
					callCount: 3,
					successCount: 3,
					failedCount: 0,
					avgDurationMs: 100,
				},
				{
					toolName: "Edit",
					callCount: 2,
					successCount: 2,
					failedCount: 0,
					avgDurationMs: 200,
				},
			],
		};

		const toolCalls: ToolCall[] = [
			{
				sessionId: "test-session-1",
				callIndex: 1,
				timestamp: Date.now(),
				toolName: "Read",
				durationMs: 100,
				success: true,
			},
			{
				sessionId: "test-session-1",
				callIndex: 2,
				timestamp: Date.now(),
				toolName: "Edit",
				durationMs: 200,
				success: true,
			},
		];

		await writer.write(session, toolCalls);
	});

	afterEach(async () => {
		// Clean up
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
	});

	it("should export to DeepEval JSON format", async () => {
		const outputPath = await exporter.exportDeepEval();

		expect(existsSync(outputPath)).toBe(true);

		const content = await readFile(outputPath, "utf-8");
		const data = JSON.parse(content);

		expect(data.test_cases).toBeDefined();
		expect(data.test_cases).toHaveLength(1);

		const testCase = data.test_cases[0];
		expect(testCase.metadata.session_id).toBe("test-session-1");
		expect(testCase.metadata.engine).toBe("claude");
		expect(testCase.tools).toContain("Read");
		expect(testCase.tools).toContain("Edit");
	});

	it("should export to OpenAI Evals JSONL format", async () => {
		const outputPath = await exporter.exportOpenAI();

		expect(existsSync(outputPath)).toBe(true);

		const content = await readFile(outputPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const entry = JSON.parse(lines[0]);
		expect(entry.metadata.session_id).toBe("test-session-1");
		expect(entry.metadata.engine).toBe("claude");
		expect(entry.metadata.tools_used).toContain("Read");
		expect(entry.metadata.tools_used).toContain("Edit");
		expect(entry.metadata.tokens_in).toBe(1000);
		expect(entry.metadata.tokens_out).toBe(500);
	});

	it("should export to raw JSONL format", async () => {
		const outputPath = await exporter.exportRaw();

		expect(existsSync(outputPath)).toBe(true);

		const content = await readFile(outputPath, "utf-8");
		const lines = content.trim().split("\n");

		// Should have 1 session + 2 tool calls
		expect(lines.length).toBeGreaterThanOrEqual(3);

		// Check types
		const entries = lines.map((l) => JSON.parse(l));
		const sessionEntry = entries.find((e) => e.type === "session");
		const toolCallEntries = entries.filter((e) => e.type === "tool_call");

		expect(sessionEntry).toBeDefined();
		expect(toolCallEntries).toHaveLength(2);
	});

	it("should export to all formats", async () => {
		const paths = await exporter.exportAll();

		expect(existsSync(paths.deepeval)).toBe(true);
		expect(existsSync(paths.openai)).toBe(true);
		expect(existsSync(paths.raw)).toBe(true);
	});

	it("should get summary statistics", async () => {
		const summary = await exporter.getSummary();

		expect(summary.sessionCount).toBe(1);
		expect(summary.toolCallCount).toBe(2);
		expect(summary.engines).toContain("claude");
		expect(summary.modes).toContain("sequential");
		expect(summary.toolsUsed).toContain("Read");
		expect(summary.toolsUsed).toContain("Edit");
		expect(summary.totalTokensIn).toBe(1000);
		expect(summary.totalTokensOut).toBe(500);
		expect(summary.successRate).toBe(100);
	});
});
