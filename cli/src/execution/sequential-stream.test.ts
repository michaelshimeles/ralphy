import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AIEngine, AIResult, TextStreamCallback } from "../engines/types.ts";
import type { TaskSource } from "../tasks/types.ts";

// Mock spinner to avoid nanospinner side effects
mock.module("../ui/spinner.ts", () => ({
	ProgressSpinner: class {
		stop = mock(() => {});
		updateStep = mock(() => {});
		success = mock(() => {});
		error = mock(() => {});
	},
}));

// Mock logger to suppress output
mock.module("../ui/logger.ts", () => ({
	logDebug: () => {},
	logError: () => {},
	logInfo: () => {},
	logSuccess: () => {},
	logWarn: () => {},
	setVerbose: () => {},
	formatTokens: () => "",
	formatDuration: (ms: number) => `${ms}ms`,
}));

// Mock other side-effect modules
mock.module("../ui/notify.ts", () => ({
	notifyTaskComplete: () => {},
	notifyTaskFailed: () => {},
}));

mock.module("../config/writer.ts", () => ({
	logTaskProgress: () => {},
}));

mock.module("./deferred.ts", () => ({
	clearDeferredTask: () => {},
	recordDeferredTask: () => 0,
}));

mock.module("./prompt.ts", () => ({
	buildPrompt: () => "test prompt",
}));

import { type ExecutionOptions, runSequential } from "./sequential.ts";

let stdoutSpy: ReturnType<typeof spyOn>;
let consoleSpy: ReturnType<typeof spyOn>;

const OK_RESULT: AIResult = {
	success: true,
	response: "Done",
	inputTokens: 100,
	outputTokens: 50,
};

function createMockEngine(opts?: {
	onText?: (cb: TextStreamCallback) => void;
}): AIEngine {
	return {
		name: "mock",
		cliCommand: "mock",
		isAvailable: async () => true,
		execute: mock(async () => OK_RESULT),
		executeStreaming: mock(
			async (
				_prompt: string,
				_workDir: string,
				_onProgress: (step: string) => void,
				_options?: Record<string, unknown>,
				onText?: TextStreamCallback,
			) => {
				if (onText && opts?.onText) {
					opts.onText(onText);
				}
				return OK_RESULT;
			},
		),
	};
}

function createMockTaskSource(taskCount = 1): TaskSource {
	let calls = 0;
	const tasks = Array.from({ length: taskCount }, (_, i) => ({
		id: `task-${i}`,
		title: `Task ${i}`,
		body: `Do task ${i}`,
	}));

	return {
		type: "inline" as const,
		getNextTask: mock(async () => {
			if (calls >= tasks.length) return null;
			return tasks[calls++];
		}),
		markComplete: mock(async () => {}),
		countRemaining: mock(async () => Math.max(0, tasks.length - calls)),
	};
}

function baseOptions(overrides: Partial<ExecutionOptions> = {}): ExecutionOptions {
	return {
		engine: createMockEngine(),
		taskSource: createMockTaskSource(),
		workDir: "/tmp/test",
		skipTests: true,
		skipLint: true,
		dryRun: false,
		maxIterations: 10,
		maxRetries: 1,
		retryDelay: 0,
		branchPerTask: false,
		baseBranch: "main",
		createPr: false,
		draftPr: false,
		autoCommit: false,
		browserEnabled: "false",
		streamOutput: false,
		...overrides,
	};
}

beforeEach(() => {
	stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
	consoleSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	stdoutSpy.mockRestore();
	consoleSpy.mockRestore();
});

describe("sequential execution streaming", () => {
	it("should pass text callback to executeStreaming when streamOutput is true", async () => {
		let receivedCallback: TextStreamCallback | undefined;
		const engine = createMockEngine({
			onText: (cb) => {
				receivedCallback = cb;
			},
		});

		await runSequential(baseOptions({ engine, streamOutput: true }));

		expect(engine.executeStreaming).toHaveBeenCalledTimes(1);
		expect(receivedCallback).toBeDefined();
	});

	it("should not pass text callback when streamOutput is false", async () => {
		const engine = createMockEngine();

		await runSequential(baseOptions({ engine, streamOutput: false }));

		expect(engine.executeStreaming).toHaveBeenCalledTimes(1);
		const calls = (engine.executeStreaming as ReturnType<typeof mock>).mock.calls;
		const onTextArg = calls[0][4];
		expect(onTextArg).toBeUndefined();
	});

	it("should stream text to stdout via StreamRenderer when streamOutput is true", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("Hello ");
				cb("World");
			},
		});

		await runSequential(baseOptions({ engine, streamOutput: true }));

		expect(writtenChunks).toContain("Hello ");
		expect(writtenChunks).toContain("World");
	});

	it("should not stream text to stdout when streamOutput is false", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("Should not appear");
			},
		});

		await runSequential(baseOptions({ engine, streamOutput: false }));

		expect(writtenChunks).not.toContain("Should not appear");
	});

	it("should show stream borders when streamOutput is true", async () => {
		const loggedLines: string[] = [];
		consoleSpy.mockImplementation((...args: unknown[]) => {
			loggedLines.push(args.map(String).join(" "));
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("streamed text");
			},
		});

		await runSequential(baseOptions({ engine, streamOutput: true }));

		const borders = loggedLines.filter((l) => l.includes("─"));
		expect(borders.length).toBeGreaterThanOrEqual(2);
	});

	it("should use stream.success on completion when streaming", async () => {
		const loggedLines: string[] = [];
		consoleSpy.mockImplementation((...args: unknown[]) => {
			loggedLines.push(args.map(String).join(" "));
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("output");
			},
		});

		await runSequential(baseOptions({ engine, streamOutput: true }));

		const successLine = loggedLines.find((l) => l.includes("✔"));
		expect(successLine).toBeDefined();
	});

	it("should use stream.error on failure when streaming", async () => {
		const loggedLines: string[] = [];
		consoleSpy.mockImplementation((...args: unknown[]) => {
			loggedLines.push(args.map(String).join(" "));
		});

		const failEngine: AIEngine = {
			name: "mock",
			cliCommand: "mock",
			isAvailable: async () => true,
			execute: mock(async () => ({
				...OK_RESULT,
				success: false,
				error: "Something broke",
			})),
			executeStreaming: mock(
				async (
					_prompt: string,
					_workDir: string,
					_onProgress: (step: string) => void,
					_options?: Record<string, unknown>,
					onText?: TextStreamCallback,
				) => {
					if (onText) onText("partial output");
					return { ...OK_RESULT, success: false, error: "Something broke" };
				},
			),
		};

		await runSequential(baseOptions({ engine: failEngine, streamOutput: true }));

		const errorLine = loggedLines.find((l) => l.includes("✖"));
		expect(errorLine).toBeDefined();
	});

	it("should handle multiple tasks with streaming", async () => {
		let callCount = 0;
		const engine = createMockEngine({
			onText: (cb) => {
				callCount++;
				cb(`task ${callCount} output`);
			},
		});

		await runSequential(
			baseOptions({
				engine,
				taskSource: createMockTaskSource(3),
				streamOutput: true,
			}),
		);

		expect(engine.executeStreaming).toHaveBeenCalledTimes(3);
		expect(callCount).toBe(3);
	});
});
