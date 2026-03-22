import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AIEngine, AIResult, TextStreamCallback } from "../engines/types.ts";
import type { TaskSource } from "../tasks/types.ts";

// Mock git modules to avoid real git operations
mock.module("simple-git", () => ({
	default: () => ({
		status: async () => ({ files: [], not_added: [] }),
		stash: async () => {},
	}),
}));

mock.module("../git/branch.ts", () => ({
	getCurrentBranch: async () => "main",
	returnToBaseBranch: async () => {},
}));

mock.module("../git/worktree.ts", () => ({
	canUseWorktrees: () => true,
	getWorktreeBase: () => "/tmp/worktrees",
	createAgentWorktree: async (_title: string, agentNum: number) => ({
		worktreeDir: `/tmp/worktrees/agent-${agentNum}`,
		branchName: `agent-${agentNum}`,
	}),
	cleanupAgentWorktree: async () => ({ leftInPlace: false }),
}));

mock.module("../git/merge.ts", () => ({
	analyzePreMerge: async () => ({ branch: "", fileCount: 0 }),
	sortByConflictLikelihood: (a: unknown[]) => a,
	mergeAgentBranch: async () => ({ success: true }),
	deleteLocalBranch: async () => true,
	abortMerge: async () => {},
}));

mock.module("../git/issue-sync.ts", () => ({
	syncPrdToIssue: async () => {},
}));

mock.module("../config/loader.ts", () => ({
	PROGRESS_FILE: ".ralphy/progress.txt",
	RALPHY_DIR: ".ralphy",
}));

mock.module("../config/writer.ts", () => ({
	logTaskProgress: () => {},
}));

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

mock.module("../ui/notify.ts", () => ({
	notifyTaskComplete: () => {},
	notifyTaskFailed: () => {},
}));

mock.module("./deferred.ts", () => ({
	clearDeferredTask: () => {},
	recordDeferredTask: () => 0,
}));

mock.module("./prompt.ts", () => ({
	buildParallelPrompt: () => "test prompt",
}));

mock.module("./conflict-resolution.ts", () => ({
	resolveConflictsWithAI: async () => false,
}));

mock.module("./sandbox.ts", () => ({
	getSandboxBase: () => "/tmp/sandboxes",
	createSandbox: async () => ({ symlinksCreated: 0, filesCopied: 0 }),
	getModifiedFiles: async () => [],
	cleanupSandbox: async () => {},
}));

mock.module("./sandbox-git.ts", () => ({
	commitSandboxChanges: async () => ({ success: true, branchName: "test", filesCommitted: 0 }),
}));

// Stub fs calls used by parallel.ts for PRD copying
mock.module("node:fs", () => ({
	existsSync: () => true,
	copyFileSync: () => {},
	cpSync: () => {},
	mkdirSync: () => {},
}));

import { runParallel } from "./parallel.ts";
import type { ExecutionOptions } from "./sequential.ts";

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
	const tasks = Array.from({ length: taskCount }, (_, i) => ({
		id: `task-${i}`,
		title: `Task ${i}`,
		body: `Do task ${i}`,
	}));
	const completed = new Set<string>();

	return {
		type: "inline" as const,
		getNextTask: mock(async () => {
			const next = tasks.find((t) => !completed.has(t.id));
			return next || null;
		}),
		markComplete: mock(async (id: string) => {
			completed.add(id);
		}),
		countRemaining: mock(async () => tasks.filter((t) => !completed.has(t.id)).length),
		getAllTasks: mock(async () => tasks.filter((t) => !completed.has(t.id))),
	};
}

type ParallelOptions = ExecutionOptions & {
	maxParallel: number;
	prdSource: string;
	prdFile: string;
	prdIsFolder?: boolean;
};

function baseOptions(overrides: Partial<ParallelOptions> = {}): ParallelOptions {
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
		maxParallel: 4,
		prdSource: "markdown",
		prdFile: "PRD.md",
		...overrides,
	};
}

let stdoutSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
	stdoutSpy.mockRestore();
});

describe("parallel execution streaming", () => {
	it("should use executeStreaming when streamOutput is true", async () => {
		const engine = createMockEngine();

		await runParallel(baseOptions({ engine, streamOutput: true }));

		expect(engine.executeStreaming).toHaveBeenCalledTimes(1);
		expect(engine.execute).not.toHaveBeenCalled();
	});

	it("should use execute when streamOutput is false", async () => {
		const engine = createMockEngine();

		await runParallel(baseOptions({ engine, streamOutput: false }));

		expect(engine.execute).toHaveBeenCalledTimes(1);
		expect(engine.executeStreaming).not.toHaveBeenCalled();
	});

	it("should pass text callback with agent prefix when streaming", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("hello world");
			},
		});

		await runParallel(baseOptions({ engine, streamOutput: true }));

		const agentOutput = writtenChunks.find((c) => c.includes("[agent 1]"));
		expect(agentOutput).toBeDefined();
		expect(agentOutput).toContain("hello world");
	});

	it("should not write to stdout when streamOutput is false", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		const engine = createMockEngine({
			onText: (cb) => {
				cb("should not appear");
			},
		});

		await runParallel(baseOptions({ engine, streamOutput: false }));

		const agentOutput = writtenChunks.find((c) => c.includes("[agent"));
		expect(agentOutput).toBeUndefined();
	});

	it("should prefix output with correct agent number for multiple tasks", async () => {
		const writtenChunks: string[] = [];
		stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		let callCount = 0;
		const engine = createMockEngine({
			onText: (cb) => {
				callCount++;
				cb(`output ${callCount}`);
			},
		});

		await runParallel(
			baseOptions({
				engine,
				taskSource: createMockTaskSource(2),
				maxParallel: 4,
				streamOutput: true,
			}),
		);

		expect(engine.executeStreaming).toHaveBeenCalledTimes(2);
		const agent1Output = writtenChunks.find((c) => c.includes("[agent 1]"));
		const agent2Output = writtenChunks.find((c) => c.includes("[agent 2]"));
		expect(agent1Output).toBeDefined();
		expect(agent2Output).toBeDefined();
	});

	it("should fall back to execute when engine has no executeStreaming", async () => {
		const engine: AIEngine = {
			name: "mock",
			cliCommand: "mock",
			isAvailable: async () => true,
			execute: mock(async () => OK_RESULT),
		};

		await runParallel(baseOptions({ engine, streamOutput: true }));

		expect(engine.execute).toHaveBeenCalledTimes(1);
	});
});
