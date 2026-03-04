import { describe, expect, it } from "bun:test";
import {
	ErrorSchema,
	ResultSchema,
	StepFinishSchema,
	TextSchema,
	extractSessionId,
	parseJsonLine,
} from "../src/utils/json-validation";

describe("JSON Validation", () => {
	describe("parseJsonLine", () => {
		it("should parse valid StepFinish event", () => {
			const line = JSON.stringify({
				type: "step_finish",
				part: {
					tokens: {
						input: 100,
						output: 200,
					},
				},
			});
			const result = parseJsonLine(line);
			expect(result).not.toBeNull();
			const stepFinish = StepFinishSchema.safeParse(result?.event);
			expect(stepFinish.success).toBe(true);
			if (stepFinish.success) {
				expect(stepFinish.data.type).toBe("step_finish");
			}
		});

		it("should parse valid Text event", () => {
			const line = JSON.stringify({
				type: "text",
				part: {
					text: "Test response",
				},
			});
			const result = parseJsonLine(line);
			expect(result).not.toBeNull();
			const textEvent = TextSchema.safeParse(result?.event);
			expect(textEvent.success).toBe(true);
			if (textEvent.success) {
				expect(textEvent.data.type).toBe("text");
				expect(textEvent.data.part.text).toBe("Test response");
			}
		});

		it("should parse valid Error event", () => {
			const line = JSON.stringify({
				type: "error",
				error: {
					message: "Test error",
				},
			});
			const result = parseJsonLine(line);
			expect(result).not.toBeNull();
			const errorEvent = ErrorSchema.safeParse(result?.event);
			expect(errorEvent.success).toBe(true);
			if (errorEvent.success) {
				expect(errorEvent.data.type).toBe("error");
			}
		});

		it("should parse valid Result event", () => {
			const line = JSON.stringify({
				type: "result",
				result: "Task completed",
				usage: {
					input_tokens: 100,
					output_tokens: 200,
				},
			});
			const result = parseJsonLine(line);
			expect(result).not.toBeNull();
			const resultEvent = ResultSchema.safeParse(result?.event);
			expect(resultEvent.success).toBe(true);
			if (resultEvent.success) {
				expect(resultEvent.data.type).toBe("result");
			}
		});

		it("should return null for invalid JSON", () => {
			const result = parseJsonLine("not valid json");
			expect(result).toBeNull();
		});

		it("should return null for empty string", () => {
			const result = parseJsonLine("");
			expect(result).toBeNull();
		});

		it("should return null for non-object JSON", () => {
			const result = parseJsonLine(JSON.stringify("string"));
			expect(result).toBeNull();
		});

		it("should return null for invalid schema", () => {
			const line = JSON.stringify({
				type: "invalid_type",
				data: "test",
			});
			const result = parseJsonLine(line);
			expect(result).toBeNull();
		});
	});

	describe("extractSessionId", () => {
		it("should extract sessionID (camelCase)", () => {
			const event = {
				type: "text",
				sessionID: "session-123",
			} as { type: string; sessionID?: string };
			const sessionId = extractSessionId(event);
			expect(sessionId).toBe("session-123");
		});

		it("should extract sessionId (camelCase variant)", () => {
			const event = {
				type: "text",
				sessionId: "session-456",
			} as { type: string; sessionId?: string };
			const sessionId = extractSessionId(event);
			expect(sessionId).toBe("session-456");
		});

		it("should extract session_id (snake_case)", () => {
			const event = {
				type: "text",
				session_id: "session-789",
			} as { type: string; session_id?: string };
			const sessionId = extractSessionId(event);
			expect(sessionId).toBe("session-789");
		});

		it("should return null when no session ID present", () => {
			const event = {
				type: "text",
				part: {
					text: "test",
				},
			} as { type: string; part?: { text?: string } };
			const sessionId = extractSessionId(event);
			expect(sessionId).toBeNull();
		});

		it("should prioritize sessionID over sessionId", () => {
			const event = {
				type: "text",
				sessionID: "session-1",
				sessionId: "session-2",
			} as { type: string; sessionID?: string; sessionId?: string };
			const sessionId = extractSessionId(event);
			expect(sessionId).toBe("session-1");
		});
	});
});
