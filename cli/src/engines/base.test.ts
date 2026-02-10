import { describe, expect, it } from "bun:test";
import {
	checkForErrors,
	detectStepFromOutput,
	extractAuthenticationError,
	formatCommandError,
	parseStreamJsonResult,
} from "./base.ts";

describe("parseStreamJsonResult", () => {
	it("should parse valid stream-json output with result type", () => {
		const output = `{"type":"result","result":"Task completed","usage":{"input_tokens":100,"output_tokens":50}}`;

		const result = parseStreamJsonResult(output);

		expect(result.response).toBe("Task completed");
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});

	it("should handle multiple lines and extract result from last valid line", () => {
		const output = `{"type":"assistant","message":"Processing..."}
{"type":"result","result":"Final answer","usage":{"input_tokens":200,"output_tokens":75}}`;

		const result = parseStreamJsonResult(output);

		expect(result.response).toBe("Final answer");
		expect(result.inputTokens).toBe(200);
		expect(result.outputTokens).toBe(75);
	});

	it("should return default values when no result type found", () => {
		const output = `{"type":"assistant","message":"Just talking"}`;

		const result = parseStreamJsonResult(output);

		expect(result.response).toBe("Task completed");
		expect(result.inputTokens).toBe(0);
		expect(result.outputTokens).toBe(0);
	});

	it("should handle non-JSON lines gracefully", () => {
		const output = `Some plain text
{"type":"result","result":"Done","usage":{"input_tokens":50,"output_tokens":25}}
More text`;

		const result = parseStreamJsonResult(output);

		expect(result.response).toBe("Done");
		expect(result.inputTokens).toBe(50);
		expect(result.outputTokens).toBe(25);
	});
});

describe("checkForErrors", () => {
	it("should detect error type in stream-json output", () => {
		const output = `{"type":"error","error":{"message":"Network timeout"}}`;

		const error = checkForErrors(output);

		expect(error).toBe("Network timeout");
	});

	it("should extract message field when error field is missing", () => {
		const output = `{"type":"error","message":"Something went wrong"}`;

		const error = checkForErrors(output);

		expect(error).toBe("Something went wrong");
	});

	it("should return unknown error when no message available", () => {
		const output = `{"type":"error"}`;

		const error = checkForErrors(output);

		expect(error).toBe("Unknown error");
	});

	it("should return null when no error type found", () => {
		const output = `{"type":"result","result":"Success"}`;

		const error = checkForErrors(output);

		expect(error).toBeNull();
	});

	it("should handle multiple lines and return first error", () => {
		const output = `{"type":"assistant","message":"Processing..."}
{"type":"error","error":{"message":"First error"}}
{"type":"error","error":{"message":"Second error"}}`;

		const error = checkForErrors(output);

		expect(error).toBe("First error");
	});
});

describe("extractAuthenticationError", () => {
	it("should extract authentication error with 'Invalid API key' message", () => {
		const output = `{"type":"error","error":{"message":"Invalid API key · Please run /login"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should extract authentication error with 'not authenticated'", () => {
		const output = `{"type":"error","error":{"message":"User is not authenticated"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("User is not authenticated");
	});

	it("should extract authentication error with 'unauthorized'", () => {
		const output = `{"type":"error","error":{"message":"Unauthorized access to resource"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Unauthorized access to resource");
	});

	it("should extract authentication error with '/login' suggestion", () => {
		const output = `{"type":"error","error":{"message":"Please run /login to authenticate"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Please run /login to authenticate");
	});

	it("should return null for non-authentication errors", () => {
		const output = `{"type":"error","error":{"message":"Network timeout error"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBeNull();
	});

	it("should return null when no error type present", () => {
		const output = `{"type":"result","result":"Success"}`;

		const error = extractAuthenticationError(output);

		expect(error).toBeNull();
	});

	it("should handle message field instead of error field", () => {
		const output = `{"type":"error","message":"Invalid API key provided"}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key provided");
	});

	it("should be case-insensitive for keyword matching", () => {
		const output = `{"type":"error","error":{"message":"INVALID API KEY"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("INVALID API KEY");
	});

	it("should find authentication error among multiple JSON lines", () => {
		const output = `{"type":"system","subtype":"init","model":"test"}
{"type":"assistant","message":"Processing..."}
{"type":"error","error":{"message":"Invalid API key · Please run /login"}}
{"type":"result"}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should handle nested error structure variations", () => {
		const output = `{"type":"error","error":{"code":401,"message":"Authentication failed"}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Authentication failed");
	});

	it("should extract authentication error from result type with is_error flag", () => {
		const output = `{"type":"result","is_error":true,"result":"Invalid API key · Please run /login","duration_ms":100}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should extract authentication error from assistant type with error field", () => {
		const output = `{"type":"assistant","error":"authentication_failed","message":{"content":[{"type":"text","text":"Invalid API key · Please run /login"}]}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should handle Claude Code error response format from task description", () => {
		const output = `{"type":"system","subtype":"init"}
{"type":"assistant","message":{"error":"authentication_failed","content":[{"type":"text","text":"Invalid API key · Please run /login"}]}}
{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}`;

		const error = extractAuthenticationError(output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should not extract error from result type when is_error is false", () => {
		const output = `{"type":"result","is_error":false,"result":"Task completed"}`;

		const error = extractAuthenticationError(output);

		expect(error).toBeNull();
	});

	it("should not extract error from assistant type without authentication_failed error field", () => {
		const output = `{"type":"assistant","message":{"content":[{"type":"text","text":"Invalid API key · Please run /login"}]}}`;

		const error = extractAuthenticationError(output);

		expect(error).toBeNull();
	});
});

describe("formatCommandError", () => {
	it("should return exit code message when output is empty", () => {
		const error = formatCommandError(1, "");

		expect(error).toBe("Command failed with exit code 1");
	});

	it("should return authentication error when present in output", () => {
		const output = `{"type":"system","subtype":"init"}
{"type":"error","error":{"message":"Invalid API key · Please run /login"}}
{"type":"result"}`;

		const error = formatCommandError(1, output);

		expect(error).toBe("Invalid API key · Please run /login");
	});

	it("should return generic error with context when no auth error", () => {
		const output = `Line 1
Line 2
Line 3`;

		const error = formatCommandError(1, output);

		expect(error).toContain("Command failed with exit code 1");
		expect(error).toContain("Line 3");
	});

	it("should truncate to last 12 lines for non-auth errors", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");

		const error = formatCommandError(1, lines);

		// Should include lines 9-20 (last 12 lines)
		expect(error).toContain("Line 9");
		expect(error).toContain("Line 20");
		// Early lines should not appear in the snippet
		expect(error).not.toContain("Line 7");
		expect(error).not.toContain("Line 8");
	});

	it("should prioritize auth error over generic formatting", () => {
		const output = `Line with lots of unrelated content
{"type":"error","error":{"message":"Not authenticated"}}
More content that would normally appear`;

		const error = formatCommandError(1, output);

		expect(error).toBe("Not authenticated");
		expect(error).not.toContain("Command failed with exit code");
	});

	it("should handle various authentication error keywords", () => {
		const testCases = [
			'{"type":"error","error":{"message":"Invalid API key"}}',
			'{"type":"error","error":{"message":"Authentication required"}}',
			'{"type":"error","error":{"message":"Please run /login first"}}',
			'{"type":"error","error":{"message":"User is not authenticated"}}',
			'{"type":"error","error":{"message":"Unauthorized"}}',
		];

		for (const output of testCases) {
			const error = formatCommandError(1, output);
			expect(error).not.toContain("Command failed with exit code");
			expect(error).toBeTruthy();
		}
	});

	it("should show exit code and snippet for non-auth errors", () => {
		const output = "Some normal error output";

		const error = formatCommandError(127, output);

		expect(error).toContain("exit code 127");
		expect(error).toContain("Some normal error output");
	});

	it("should handle whitespace properly", () => {
		const output = `

		{"type":"error","error":{"message":"Invalid API key · Please run /login"}}
		  `;

		const error = formatCommandError(1, output);

		expect(error).toBe("Invalid API key · Please run /login");
	});
});

describe("detectStepFromOutput", () => {
	it("should detect step from Cline say:tool JSON", () => {
		const line = '{"type":"say","text":"Running tool","ts":1,"say":"tool"}';
		expect(detectStepFromOutput(line)).toBe("Implementing");
	});

	it("should detect step from Cline say:text JSON", () => {
		const line = '{"type":"say","text":"Working","ts":1,"say":"text"}';
		expect(detectStepFromOutput(line)).toBe("Implementing");
	});
});
