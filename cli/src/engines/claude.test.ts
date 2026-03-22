import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ClaudeEngine } from "./claude.ts";
import type { TextStreamCallback } from "./types.ts";

// Mock the base module to control execCommandStreaming behavior
const mockExecCommandStreaming = mock();

mock.module("./base.ts", () => {
	const actual = require("./base.ts");
	return {
		...actual,
		execCommandStreaming: mockExecCommandStreaming,
	};
});

describe("ClaudeEngine.executeStreaming", () => {
	let engine: ClaudeEngine;

	beforeEach(() => {
		engine = new ClaudeEngine();
		mockExecCommandStreaming.mockReset();
	});

	it("should call onText with extracted assistant text from stream lines", async () => {
		const textChunks: string[] = [];
		const onText: TextStreamCallback = (text) => textChunks.push(text);
		const onProgress = mock();

		mockExecCommandStreaming.mockImplementation(
			(_cmd: string, _args: string[], _workDir: string, onLine: (line: string) => void) => {
				// Simulate stream-json lines
				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: "Hello world" }] },
					}),
				);
				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: " more text" }] },
					}),
				);
				onLine(
					JSON.stringify({
						type: "result",
						result: "done",
						input_tokens: 10,
						output_tokens: 20,
					}),
				);
				return Promise.resolve({ exitCode: 0 });
			},
		);

		await engine.executeStreaming("test prompt", "/tmp", onProgress, undefined, onText);

		expect(textChunks).toEqual(["Hello world", " more text"]);
	});

	it("should not call onText for non-assistant lines", async () => {
		const textChunks: string[] = [];
		const onText: TextStreamCallback = (text) => textChunks.push(text);
		const onProgress = mock();

		mockExecCommandStreaming.mockImplementation(
			(_cmd: string, _args: string[], _workDir: string, onLine: (line: string) => void) => {
				onLine(JSON.stringify({ type: "system", message: "starting" }));
				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: "actual text" }] },
					}),
				);
				onLine(
					JSON.stringify({
						type: "result",
						result: "done",
						input_tokens: 5,
						output_tokens: 10,
					}),
				);
				return Promise.resolve({ exitCode: 0 });
			},
		);

		await engine.executeStreaming("test", "/tmp", onProgress, undefined, onText);

		expect(textChunks).toEqual(["actual text"]);
	});

	it("should work without onText callback", async () => {
		const onProgress = mock();

		mockExecCommandStreaming.mockImplementation(
			(_cmd: string, _args: string[], _workDir: string, onLine: (line: string) => void) => {
				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: "Hello" }] },
					}),
				);
				onLine(
					JSON.stringify({
						type: "result",
						result: "done",
						input_tokens: 5,
						output_tokens: 10,
					}),
				);
				return Promise.resolve({ exitCode: 0 });
			},
		);

		// Should not throw when onText is not provided
		const result = await engine.executeStreaming("test", "/tmp", onProgress);
		expect(result.success).toBe(true);
	});

	it("should still report progress steps when onText is provided", async () => {
		const textChunks: string[] = [];
		const onText: TextStreamCallback = (text) => textChunks.push(text);
		const progressSteps: string[] = [];
		const onProgress = (step: string) => progressSteps.push(step);

		mockExecCommandStreaming.mockImplementation(
			(_cmd: string, _args: string[], _workDir: string, onLine: (line: string) => void) => {
				onLine(
					JSON.stringify({
						type: "assistant",
						message: {
							content: [
								{
									type: "tool_use",
									name: "Read",
								},
							],
						},
					}),
				);
				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: "response" }] },
					}),
				);
				onLine(
					JSON.stringify({
						type: "result",
						result: "done",
						input_tokens: 5,
						output_tokens: 10,
					}),
				);
				return Promise.resolve({ exitCode: 0 });
			},
		);

		await engine.executeStreaming("test", "/tmp", onProgress, undefined, onText);

		expect(textChunks).toEqual(["response"]);
	});
});
