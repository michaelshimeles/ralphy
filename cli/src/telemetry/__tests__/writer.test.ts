import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TelemetryWriter } from "../writer.ts";
import type { Session, ToolCall } from "../types.ts";

const TEST_DIR = "/tmp/ralphy-telemetry-test";

describe("TelemetryWriter", () => {
	let writer: TelemetryWriter;

	beforeEach(async () => {
		// Clean up test directory
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
		await mkdir(TEST_DIR, { recursive: true });
		writer = new TelemetryWriter(TEST_DIR);
	});

	afterEach(async () => {
		// Clean up
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
	});

	it("should write session to JSONL file", async () => {
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
			],
		};

		await writer.writeSession(session);

		const content = await readFile(join(TEST_DIR, "sessions.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.sessionId).toBe("test-session-1");
		expect(parsed.engine).toBe("claude");
	});

	it("should write tool calls to JSONL file", async () => {
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

		await writer.writeToolCalls(toolCalls);

		const content = await readFile(join(TEST_DIR, "tool_calls.jsonl"), "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0]);
		expect(first.toolName).toBe("Read");
	});

	it("should read sessions back", async () => {
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
			toolCalls: [],
		};

		await writer.writeSession(session);
		const sessions = await writer.readSessions();

		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionId).toBe("test-session-1");
	});

	it("should check if data exists", async () => {
		expect(await writer.hasData()).toBe(false);

		const session: Session = {
			sessionId: "test-session-1",
			timestamp: Date.now(),
			engine: "claude",
			mode: "sequential",
			cliVersion: "1.0.0",
			platform: "darwin",
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalDurationMs: 0,
			taskCount: 0,
			successCount: 0,
			failedCount: 0,
			toolCalls: [],
		};

		await writer.writeSession(session);
		expect(await writer.hasData()).toBe(true);
	});

	it("should get statistics", async () => {
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
			],
		};

		await writer.writeSession(session);

		const stats = await writer.getStats();
		expect(stats.sessionCount).toBe(1);
		expect(stats.totalTokensIn).toBe(1000);
		expect(stats.totalTokensOut).toBe(500);
		expect(stats.toolCallCount).toBe(3);
	});
});
