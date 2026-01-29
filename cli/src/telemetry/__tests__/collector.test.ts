import { describe, it, expect, beforeEach } from "bun:test";
import { TelemetryCollector } from "../collector.ts";

describe("TelemetryCollector", () => {
	let collector: TelemetryCollector;

	beforeEach(() => {
		collector = new TelemetryCollector("claude", "sequential", {
			level: "anonymous",
		});
	});

	it("should generate a session ID", () => {
		const sessionId = collector.getSessionId();
		expect(sessionId).toBeDefined();
		expect(typeof sessionId).toBe("string");
		expect(sessionId.length).toBeGreaterThan(0);
	});

	it("should track task counts", () => {
		collector.recordTaskStart();
		collector.recordTaskComplete(true, 100, 50);
		collector.recordTaskStart();
		collector.recordTaskComplete(false, 80, 40);

		const metrics = collector.getMetrics();
		expect(metrics.taskCount).toBe(2);
		expect(metrics.successCount).toBe(1);
		expect(metrics.failedCount).toBe(1);
	});

	it("should track token counts", () => {
		collector.recordTaskStart();
		collector.recordTaskComplete(true, 100, 50);
		collector.recordTaskStart();
		collector.recordTaskComplete(true, 200, 100);

		const metrics = collector.getMetrics();
		expect(metrics.tokensIn).toBe(300);
		expect(metrics.tokensOut).toBe(150);
	});

	it("should track tool calls", () => {
		collector.recordToolCall("Read", 100, true, {
			parameterKeys: ["file_path"],
		});
		collector.recordToolCall("Edit", 200, true, {
			parameterKeys: ["file_path", "old_string", "new_string"],
		});
		collector.recordToolCall("Bash", 500, false, {
			errorType: "exit_code",
		});

		const metrics = collector.getMetrics();
		expect(metrics.toolCallCount).toBe(3);
	});

	it("should generate session with tool call summaries", () => {
		collector.recordToolCall("Read", 100, true);
		collector.recordToolCall("Read", 120, true);
		collector.recordToolCall("Edit", 200, true);
		collector.recordToolCall("Bash", 500, false, { errorType: "exit_code" });

		const { session, toolCalls } = collector.endSession();

		expect(session.sessionId).toBeDefined();
		expect(session.engine).toBe("claude");
		expect(session.mode).toBe("sequential");
		expect(session.platform).toBeDefined();

		// Check tool call summaries
		const readSummary = session.toolCalls.find((tc) => tc.toolName === "Read");
		expect(readSummary).toBeDefined();
		expect(readSummary?.callCount).toBe(2);
		expect(readSummary?.successCount).toBe(2);
		expect(readSummary?.avgDurationMs).toBe(110);

		const bashSummary = session.toolCalls.find((tc) => tc.toolName === "Bash");
		expect(bashSummary?.failedCount).toBe(1);

		// Check individual tool calls
		expect(toolCalls).toHaveLength(4);
	});

	it("should add tags to session", () => {
		collector.addTags(["eval", "test-run"]);
		const { session } = collector.endSession();
		expect(session.tags).toEqual(["eval", "test-run"]);
	});

	it("should handle start/end tool call pattern", () => {
		collector.startToolCall("Read", { file_path: "/test/file.ts" });
		// Simulate some time passing
		collector.endToolCall(true);

		const { toolCalls } = collector.endSession();
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].toolName).toBe("Read");
		expect(toolCalls[0].success).toBe(true);
	});

	it("should include full mode data when level is full", () => {
		const fullCollector = new TelemetryCollector("claude", "single", {
			level: "full",
		});

		fullCollector.recordTaskStart();
		fullCollector.recordTaskComplete(true, 100, 50, "Test prompt", "Test response");
		fullCollector.recordToolCall("Read", 100, true, {
			parameters: { file_path: "/test/file.ts" },
			result: "file contents",
		});

		const { session, toolCalls } = fullCollector.endSession();

		// Check session has full mode fields
		expect("prompt" in session).toBe(true);
		expect("response" in session).toBe(true);
		expect((session as { prompt?: string }).prompt).toBe("Test prompt");

		// Check tool calls have full mode fields
		expect(toolCalls[0].parameters).toBeDefined();
		expect(toolCalls[0].result).toBe("file contents");
	});
});
