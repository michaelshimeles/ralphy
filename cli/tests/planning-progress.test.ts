import { describe, expect, test } from "bun:test";
import type { AIEngine, AIResult } from "../src/engines/types.ts";
import {
	normalizePlannedPath,
	type PlanningProgressCallback,
	type PlanningProgressEvent,
	parsePlannedFiles,
	planTaskFiles,
} from "../src/execution/planning.ts";
import type { Task } from "../src/tasks/types.ts";
import { ProgressDisplay } from "../src/ui/progress.ts";

// Platform-specific path separator
const sep = process.platform === "win32" ? "\\" : "/";

describe("PlanningProgressEvent type", () => {
	test("should accept valid progress event", () => {
		const event: PlanningProgressEvent = {
			taskId: "test-task",
			status: "started",
			timestamp: Date.now(),
			message: "Starting planning",
		};

		expect(event.taskId).toBe("test-task");
		expect(event.status).toBe("started");
		expect(typeof event.timestamp).toBe("number");
	});

	test("should accept event with reward and metadata", () => {
		const event: PlanningProgressEvent = {
			taskId: "test-task",
			status: "planning",
			timestamp: Date.now(),
			reward: 0.85,
			message: "Planning in progress",
			metadata: { fileCount: 5 },
		};

		expect(event.reward).toBe(0.85);
		expect(event.metadata?.fileCount).toBe(5);
	});

	test("should accept all valid status values", () => {
		const statuses: PlanningProgressEvent["status"][] = [
			"started",
			"thinking",
			"analyzing",
			"planning",
			"completed",
			"failed",
		];

		for (const status of statuses) {
			const event: PlanningProgressEvent = {
				taskId: "test-task",
				status,
				timestamp: Date.now(),
			};

			expect(event.status).toBe(status);
		}
	});
});

describe("planTaskFiles progress callback", () => {
	test("should call onProgress when planning starts", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-1",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(progressEvents.length).toBeGreaterThan(0);
		expect(progressEvents[0].status).toBe("started");
	});

	test("should call onProgress with completed status", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\nsrc/another.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-2",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		const result = await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(result.files.length).toBe(2);

		const completedEvents = progressEvents.filter((e) => e.status === "completed");
		expect(completedEvents.length).toBeGreaterThan(0);
		expect(completedEvents[0].metadata?.fileCount).toBe(2);
	});

	test("should call onProgress with failed status on error", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: false,
					error: "Empty output",
					response: "",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-3",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			0,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		const failedEvents = progressEvents.filter((e) => e.status === "failed");
		expect(failedEvents.length).toBeGreaterThan(0);
		expect(failedEvents[0].message).toBe("Empty output");
	});

	test("should work without onProgress callback (backward compatibility)", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-4",
			title: "Test task",
			completed: false,
		};

		const result = await planTaskFiles(mockEngine, task, "/tmp/test");

		expect(result.files.length).toBe(1);
	});

	test("should handle onProgress callback errors gracefully", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-5",
			title: "Test task",
			completed: false,
		};

		const onProgress: PlanningProgressCallback = () => {
			throw new Error("Callback error");
		};

		const result = await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(result.files.length).toBe(1);
	});

	test("should call onProgress with thinking status before non-streaming execution", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-6",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		const thinkingEvents = progressEvents.filter((e) => e.status === "thinking");
		expect(thinkingEvents.length).toBeGreaterThan(0);
		expect(thinkingEvents[0].message).toBe("Processing planning request...");
	});

	test("should preserve task title in progress events", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-7",
			title: "Implement feature X",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		for (const event of progressEvents) {
			expect(event.taskId).toBe("Implement feature X");
		}
	});
});

describe("ProgressDisplay integration with planning progress", () => {
	test("should update planning progress from events", () => {
		const display = new ProgressDisplay();

		const taskStatuses: {
			title: string;
			status: "pending" | "active" | "done" | "failed";
			currentStep?: string;
			reward?: number;
		}[] = [
			{ title: "Task 1", status: "pending" },
			{ title: "Task 2", status: "pending" },
		];

		display.showPlanningProgress(taskStatuses);

		const event1: PlanningProgressEvent = {
			taskId: "Task 1",
			status: "started",
			timestamp: Date.now(),
			message: "Starting",
		};

		display.updatePlanningProgress(event1);

		expect(taskStatuses[0].status).toBe("active");
		expect(taskStatuses[0].currentStep).toBe("Starting");
	});

	test("should update reward from progress events", () => {
		const display = new ProgressDisplay();

		const taskStatuses: {
			title: string;
			status: "pending" | "active" | "done" | "failed";
			reward?: number;
		}[] = [{ title: "Task 1", status: "pending" }];

		display.showPlanningProgress(taskStatuses);

		const event: PlanningProgressEvent = {
			taskId: "Task 1",
			status: "planning",
			timestamp: Date.now(),
			reward: 0.92,
			message: "High reward planning",
		};

		display.updatePlanningProgress(event);

		expect(taskStatuses[0].reward).toBe(0.92);
	});

	test("should handle unknown task by adding it", () => {
		const display = new ProgressDisplay();

		const taskStatuses: { title: string; status: "pending" | "active" | "done" | "failed" }[] = [
			{ title: "Task 1", status: "pending" },
		];

		display.showPlanningProgress(taskStatuses);

		const event: PlanningProgressEvent = {
			taskId: "Unknown Task",
			status: "started",
			timestamp: Date.now(),
		};

		display.updatePlanningProgress(event);

		expect(taskStatuses.length).toBe(2);
		expect(taskStatuses[1].title).toBe("Unknown Task");
	});

	test("should map progress status to task status correctly", () => {
		const display = new ProgressDisplay();

		const taskStatuses: { title: string; status: "pending" | "active" | "done" | "failed" }[] = [
			{ title: "Task 1", status: "pending" },
		];

		display.showPlanningProgress(taskStatuses);

		const statuses: PlanningProgressEvent["status"][] = [
			"started",
			"thinking",
			"analyzing",
			"planning",
			"completed",
			"failed",
		];

		for (const status of statuses) {
			const event: PlanningProgressEvent = {
				taskId: "Task 1",
				status,
				timestamp: Date.now(),
			};

			display.updatePlanningProgress(event);

			if (status === "completed") {
				expect(taskStatuses[0].status).toBe("done");
			} else if (status === "failed") {
				expect(taskStatuses[0].status).toBe("failed");
			} else {
				expect(taskStatuses[0].status).toBe("active");
			}
		}
	});
});

describe("parsePlannedFiles", () => {
	test("should parse files from <FILES> block", () => {
		const response = `
Some text here
<FILES>
src/index.ts
src/utils.ts
tests/test.ts
</FILES>
Some more text
		`;

		const files = parsePlannedFiles(response);

		expect(files).toEqual([`src${sep}index.ts`, `src${sep}utils.ts`, `tests${sep}test.ts`]);
	});

	test("should handle empty files list", () => {
		const response = `
<FILES>
</FILES>
		`;

		const files = parsePlannedFiles(response);

		expect(files).toEqual([]);
	});

	test("should ignore comments in files block", () => {
		const response = `
<FILES>
# This is a comment
src/index.ts
# Another comment
src/utils.ts
</FILES>
		`;

		const files = parsePlannedFiles(response);

		expect(files).toEqual([`src${sep}index.ts`, `src${sep}utils.ts`]);
	});

	test("should handle files with bullets and numbers", () => {
		const response = `
<FILES>
* src/index.ts
- src/utils.ts
1. src/test.ts
src/other.ts
</FILES>
		`;

		const files = parsePlannedFiles(response);

		expect(files).toEqual([
			`src${sep}index.ts`,
			`src${sep}utils.ts`,
			`src${sep}test.ts`,
			`src${sep}other.ts`,
		]);
	});

	test("should handle files with backticks", () => {
		const response = `
<FILES>
\`src/index.ts\`
\`src/utils.ts\`
src/normal.ts
</FILES>
		`;

		const files = parsePlannedFiles(response);

		expect(files).toEqual([`src${sep}index.ts`, `src${sep}utils.ts`, `src${sep}normal.ts`]);
	});
});

describe("normalizePlannedPath", () => {
	test("should strip leading bullets", () => {
		expect(normalizePlannedPath("* src/index.ts")).toBe(`src${sep}index.ts`);
		expect(normalizePlannedPath("- src/index.ts")).toBe(`src${sep}index.ts`);
		expect(normalizePlannedPath("+ src/index.ts")).toBe(`src${sep}index.ts`);
	});

	test("should strip leading numbering", () => {
		expect(normalizePlannedPath("1. src/index.ts")).toBe(`src${sep}index.ts`);
		expect(normalizePlannedPath("2) src/index.ts")).toBe(`src${sep}index.ts`);
		expect(normalizePlannedPath("3) src/index.ts")).toBe(`src${sep}index.ts`);
	});

	test("should strip wrapping backticks", () => {
		expect(normalizePlannedPath("`src/index.ts`")).toBe(`src${sep}index.ts`);
		expect(normalizePlannedPath("```src/index.ts```")).toBe(`src${sep}index.ts`);
	});

	test("should remove leading ./", () => {
		expect(normalizePlannedPath("./src/index.ts")).toBe(`src${sep}index.ts`);
	});

	test("should normalize path separators", () => {
		const path = normalizePlannedPath("src\\utils\\test.ts");
		expect(path).toContain("src");
		expect(path).toContain("utils");
		expect(path).toContain("test.ts");
	});
});

describe("Streaming progress with executeStreaming", () => {
	test("should call streaming callback with parsed rewards", async () => {
		const streamingSteps: string[] = [];
		const mockEngine: AIEngine = {
			async executeStreaming(
				_prompt: string,
				_workDir: string,
				onStep: (step: string) => void,
				_options?: unknown,
			): Promise<AIResult> {
				streamingSteps.push("analyzing codebase");
				onStep("analyzing codebase");

				streamingSteps.push("reward: 0.85");
				onStep("reward: 0.85");

				streamingSteps.push("planning files");
				onStep("planning files");

				streamingSteps.push("completed");
				onStep("completed");

				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
			execute: async () => ({
				success: true,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
			}),
		};

		const task: Task = {
			id: "test-8",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		const rewardEvents = progressEvents.filter((e) => e.reward !== undefined);
		expect(rewardEvents.length).toBeGreaterThan(0);
		expect(rewardEvents[0].reward).toBe(0.85);
	});

	test("should parse status from streaming steps", async () => {
		const mockEngine: AIEngine = {
			async executeStreaming(
				_prompt: string,
				_workDir: string,
				onStep: (step: string) => void,
				_options?: unknown,
			): Promise<AIResult> {
				onStep("thinking about the task");
				onStep("analyzing dependencies");
				onStep("planning implementation");
				onStep("completed");

				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
			execute: async () => ({
				success: true,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
			}),
		};

		const task: Task = {
			id: "test-9",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		const statuses = progressEvents.map((e) => e.status);
		expect(statuses).toContain("thinking");
		expect(statuses).toContain("analyzing");
		expect(statuses).toContain("planning");
		expect(statuses).toContain("completed");
	});

	test("should handle streaming callback errors gracefully", async () => {
		const mockEngine: AIEngine = {
			async executeStreaming(
				_prompt: string,
				_workDir: string,
				onStep: (step: string) => void,
				_options?: unknown,
			): Promise<AIResult> {
				onStep("planning");

				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
			execute: async () => ({
				success: true,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
			}),
		};

		const task: Task = {
			id: "test-10",
			title: "Test task",
			completed: false,
		};

		let callCount = 0;
		const onProgress: PlanningProgressCallback = () => {
			callCount++;
			if (callCount > 1) {
				throw new Error("Streaming callback error");
			}
		};

		const result = await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(result.files.length).toBe(1);
		expect(callCount).toBeGreaterThan(1);
	});
});

describe("Error handling and edge cases", () => {
	test("should handle empty response", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "Valid files",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-11",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		const result = await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			0,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(result.files.length).toBe(0);
		expect(progressEvents[progressEvents.length - 1].status).toBe("completed");
	});

	test("should handle malformed FILES block", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "Some text without proper FILES tags",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-12",
			title: "Test task",
			completed: false,
		};

		const result = await planTaskFiles(mockEngine, task, "/tmp/test");

		expect(result).toEqual({
			files: [],
			analysis: undefined,
			plan: undefined,
			optimization: undefined,
		});
	});

	test("should retry on failure when maxReplans > 0", async () => {
		let callCount = 0;
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				callCount++;
				if (callCount === 1) {
					return {
						success: false,
						error: "Temporary failure",
						response: "",
						inputTokens: 0,
						outputTokens: 0,
					};
				}
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-13",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		const result = await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		expect(result.files.length).toBe(1);
		expect(callCount).toBe(2);

		const failedEvents = progressEvents.filter((e) => e.status === "failed");
		expect(failedEvents.length).toBeGreaterThan(0);
	});

	test("should handle task without title", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-14",
			completed: false,
			title: "No title",
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		for (const event of progressEvents) {
			expect(event.taskId).toBe("test-14");
		}
	});

	test("should handle metadata in completed event", async () => {
		const mockEngine: AIEngine = {
			async execute(_prompt: string, _workDir: string, _options?: unknown): Promise<AIResult> {
				return {
					success: true,
					response: "<FILES>\nsrc/index.ts\nsrc/utils.ts\ntests/test.ts\n</FILES>",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
			name: "Mock",
			cliCommand: "mock",
			isAvailable: async () => true,
		};

		const task: Task = {
			id: "test-15",
			title: "Test task",
			completed: false,
		};

		const progressEvents: PlanningProgressEvent[] = [];
		const onProgress: PlanningProgressCallback = (event) => {
			progressEvents.push(event);
		};

		await planTaskFiles(
			mockEngine,
			task,
			"/tmp/test",
			undefined,
			1,
			undefined,
			undefined,
			undefined,
			onProgress,
		);

		const completedEvent = progressEvents.find((e) => e.status === "completed");
		expect(completedEvent).toBeDefined();
		expect(completedEvent?.metadata?.fileCount).toBe(3);
	});
});

describe("formatPlanningStep function", () => {
	test("should display standalone thinking words without emoji", () => {
		const display = new ProgressDisplay();
		const thinkingStep = (
			display as unknown as { formatPlanningStep: (step: string) => string }
		).formatPlanningStep("Thinking");
		expect(thinkingStep).toBe("Thinking");
	});

	test("should display standalone analyzing words without emoji", () => {
		const display = new ProgressDisplay();
		const analyzingStep = (
			display as unknown as { formatPlanningStep: (step: string) => string }
		).formatPlanningStep("Analyzing");
		expect(analyzingStep).toBe("Analyzing");
	});

	test("should display standalone planning words without emoji", () => {
		const display = new ProgressDisplay();
		const planningStep = (
			display as unknown as { formatPlanningStep: (step: string) => string }
		).formatPlanningStep("Planning");
		expect(planningStep).toBe("Planning");
	});

	test("should hide standalone tool words without context", () => {
		const display = new ProgressDisplay();
		const toolStep = (
			display as unknown as { formatPlanningStep: (step: string) => string }
		).formatPlanningStep("Tool");
		expect(toolStep).toBe("");
	});

	test("should hide standalone executing words without context", () => {
		const display = new ProgressDisplay();
		const executingStep = (
			display as unknown as { formatPlanningStep: (step: string) => string }
		).formatPlanningStep("Executing");
		expect(executingStep).toBe("");
	});

	test("should hide standalone processing words without context", () => {
		const display = new ProgressDisplay();
		const processingStep = display.formatPlanningStep("Processing");
		expect(processingStep).toBe("");
	});

	test("should preserve full context for thinking about something", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Thinking about test structure");
		expect(step).toBe("Thinking about test structure");
	});

	test("should preserve full context for analyzing something", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Analyzing dependencies");
		expect(step).toBe("Analyzing dependencies");
	});

	test("should preserve full context for planning something", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Planning implementation");
		expect(step).toBe("Planning implementation");
	});

	test("should preserve tool action with target", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Tool: grep on src/");
		expect(step).toBe("Tool → src/");
	});

	test("should preserve file read actions", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Read file: tests/player/xp.test.ts");
		expect(step).toBe("Read: tests/player/xp.test.ts");
	});

	test("should preserve file write actions", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("Write: src/index.ts");
		expect(step).toBe("Write: src/index.ts");
	});

	test("should format reward display", () => {
		const display = new ProgressDisplay();
		const step = display.formatPlanningStep("reward: 0.85");
		expect(step).toBe("Reward: 0.85");
	});

	test("should handle mixed case thinking words", () => {
		const display = new ProgressDisplay();
		const step1 = display.formatPlanningStep("thinking");
		expect(step1).toBe("thinking");
		const step2 = display.formatPlanningStep("THINKING");
		expect(step2).toBe("THINKING");
	});

	test("should truncate long messages", () => {
		const display = new ProgressDisplay();
		const longMessage =
			"This is a very long message that exceeds sixty characters and should be truncated";
		const step = display.formatPlanningStep(longMessage);
		expect(step).toBe(`${longMessage.substring(0, 57)}...`);
	});
});
