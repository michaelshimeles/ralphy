import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { TextStreamCallback } from "../../engines/types.ts";

// Track executeStreaming calls
const mockExecuteStreaming = mock(async () => ({
	success: true,
	response: "Done",
	inputTokens: 100,
	outputTokens: 50,
}));

mock.module("../../engines/index.ts", () => ({
	createEngine: () => ({
		name: "mock-engine",
		cliCommand: "mock",
		isAvailable: async () => true,
		execute: mock(async () => ({
			success: true,
			response: "Done",
			inputTokens: 100,
			outputTokens: 50,
		})),
		executeStreaming: mockExecuteStreaming,
	}),
	isEngineAvailable: () => Promise.resolve(true),
}));

mock.module("../../config/loader.ts", () => ({
	loadConfig: () => null,
	loadProjectContext: () => "",
	loadRules: () => [],
	loadBoundaries: () => ({ neverTouch: [] }),
}));

mock.module("../../notifications/webhook.ts", () => ({
	sendNotifications: async () => {},
}));

mock.module("../../config/writer.ts", () => ({
	logTaskProgress: () => {},
}));

mock.module("../../ui/notify.ts", () => ({
	notifyTaskComplete: () => {},
	notifyTaskFailed: () => {},
}));

mock.module("../../execution/browser.ts", () => ({
	isBrowserAvailable: () => false,
	getBrowserInstructions: () => "",
}));

mock.module("../../ui/spinner.ts", () => ({
	ProgressSpinner: class {
		stop = mock(() => {});
		updateStep = mock(() => {});
		success = mock(() => {});
		error = mock(() => {});
	},
}));

mock.module("../../ui/logger.ts", () => ({
	logDebug: () => {},
	logError: () => {},
	logInfo: () => {},
	logSuccess: () => {},
	logWarn: () => {},
	setVerbose: () => {},
	formatTokens: () => "",
	formatDuration: (ms: number) => `${ms}ms`,
}));

mock.module("../../ui/settings.ts", () => ({
	buildActiveSettings: () => [],
}));

mock.module("../../execution/prompt.ts", () => ({
	buildPrompt: () => "test prompt",
}));

import type { RuntimeOptions } from "../../config/types.ts";
import { runTask } from "./task.ts";

let stdoutSpy: ReturnType<typeof spyOn>;
let consoleSpy: ReturnType<typeof spyOn>;

function baseOptions(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
	return {
		skipTests: true,
		skipLint: true,
		aiEngine: "claude",
		dryRun: false,
		maxIterations: 0,
		maxRetries: 1,
		retryDelay: 0,
		verbose: false,
		branchPerTask: false,
		baseBranch: "",
		createPr: false,
		draftPr: false,
		parallel: false,
		maxParallel: 1,
		prdSource: "markdown",
		prdFile: "PRD.md",
		prdIsFolder: false,
		githubRepo: "",
		githubLabel: "",
		autoCommit: false,
		browserEnabled: "false",
		streamOutput: false,
		...overrides,
	};
}

beforeEach(() => {
	stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
	consoleSpy = spyOn(console, "log").mockImplementation(() => {});
	mockExecuteStreaming.mockReset();
	mockExecuteStreaming.mockImplementation(async () => ({
		success: true,
		response: "Done",
		inputTokens: 100,
		outputTokens: 50,
	}));
});

afterEach(() => {
	stdoutSpy.mockRestore();
	consoleSpy.mockRestore();
});

describe("task mode streaming", () => {
	it("should pass text callback to executeStreaming when streamOutput is true", async () => {
		await runTask("test task", baseOptions({ streamOutput: true }));

		expect(mockExecuteStreaming).toHaveBeenCalledTimes(1);
		const calls = mockExecuteStreaming.mock.calls;
		const onTextArg = calls[0][4];
		expect(onTextArg).toBeFunction();
	});

	it("should not pass text callback when streamOutput is false", async () => {
		await runTask("test task", baseOptions({ streamOutput: false }));

		expect(mockExecuteStreaming).toHaveBeenCalledTimes(1);
		const calls = mockExecuteStreaming.mock.calls;
		const onTextArg = calls[0][4];
		expect(onTextArg).toBeUndefined();
	});

	it("should write streamed text directly to process.stdout", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		mockExecuteStreaming.mockImplementation(
			async (
				_prompt: string,
				_workDir: string,
				_onProgress: (step: string) => void,
				_options?: Record<string, unknown>,
				onText?: TextStreamCallback,
			) => {
				if (onText) {
					onText("Hello ");
					onText("from task");
				}
				return { success: true, response: "Done", inputTokens: 100, outputTokens: 50 };
			},
		);

		await runTask("test task", baseOptions({ streamOutput: true }));

		expect(writtenChunks).toContain("Hello ");
		expect(writtenChunks).toContain("from task");
	});

	it("should not write streamed text when streamOutput is false", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		mockExecuteStreaming.mockImplementation(
			async (
				_prompt: string,
				_workDir: string,
				_onProgress: (step: string) => void,
				_options?: Record<string, unknown>,
				onText?: TextStreamCallback,
			) => {
				if (onText) onText("should not appear");
				return { success: true, response: "Done", inputTokens: 100, outputTokens: 50 };
			},
		);

		await runTask("test task", baseOptions({ streamOutput: false }));

		expect(writtenChunks).not.toContain("should not appear");
	});

	it("should use process.stdout.write directly (not StreamRenderer)", async () => {
		let capturedCallback: TextStreamCallback | undefined;

		mockExecuteStreaming.mockImplementation(
			async (
				_prompt: string,
				_workDir: string,
				_onProgress: (step: string) => void,
				_options?: Record<string, unknown>,
				onText?: TextStreamCallback,
			) => {
				capturedCallback = onText;
				return { success: true, response: "Done", inputTokens: 100, outputTokens: 50 };
			},
		);

		await runTask("test task", baseOptions({ streamOutput: true }));

		expect(capturedCallback).toBeDefined();
		// Call the callback and verify it writes to stdout
		capturedCallback?.("direct output");
		expect(stdoutSpy).toHaveBeenCalledWith("direct output");
	});
});
