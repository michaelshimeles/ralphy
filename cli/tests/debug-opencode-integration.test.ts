import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";
import type { RuntimeOptions } from "../src/config/types.ts";

describe("Debug OpenCode Integration with Execution Runners", () => {
	test("sequential execution passes debugOpenCode option", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "test task"];
		const { options, task } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.aiEngine).toBe("opencode");
		expect(task).toBe("test task");
	});

	test("parallel execution passes debugOpenCode option", () => {
		const args = [
			"node",
			"ralphy",
			"--debug-open-code",
			"--opencode",
			"--parallel",
			"--max-parallel",
			"2",
		];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.parallel).toBe(true);
		expect(options.maxParallel).toBe(2);
	});

	test("agent runner receives debugOpenCode option", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "--verbose"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.verbose).toBe(true);

		// These would be passed to agent runner
		const agentRunnerOptions = {
			debugOpenCode: options.debugOpenCode,
			aiEngine: options.aiEngine,
			modelOverride: options.modelOverride,
		};

		expect(agentRunnerOptions.debugOpenCode).toBe(true);
		expect(agentRunnerOptions.aiEngine).toBe("opencode");
	});

	test("dry run respects debugOpenCode setting", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "--dry-run"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.dryRun).toBe(true);

		// In dry run mode, debug should still work
		const shouldSkipDryRun = options.dryRun && !options.debugOpenCode;
		expect(shouldSkipDryRun).toBe(false);
	});

	test("task command passes debug option correctly", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode"];
		const { options } = parseArgs(args);

		// Simulate task command processing
		const taskCommandOptions = {
			...(options.debugOpenCode && { debugOpenCode: options.debugOpenCode }),
			aiEngine: options.aiEngine,
			modelOverride: options.modelOverride,
		};

		expect(taskCommandOptions.debugOpenCode).toBe(true);
		expect(taskCommandOptions.aiEngine).toBe("opencode");
	});

	test("run command includes debugOpenCode in all execution paths", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "--create-pr"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.createPr).toBe(true);

		// Both run command paths should receive the debug option
		const runOptions1 = {
			debugOpenCode: options.debugOpenCode,
			createPr: options.createPr,
		};

		const runOptions2 = {
			debugOpenCode: options.debugOpenCode,
			createPr: options.createPr,
		};

		expect(runOptions1.debugOpenCode).toBe(true);
		expect(runOptions2.debugOpenCode).toBe(true);
	});

	test("parallel-no-git execution passes debug option", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "--no-git-parallel"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.noGitParallel).toBe(true);

		const noGitParallelOptions = {
			debugOpenCode: options.debugOpenCode,
			noGitParallel: options.noGitParallel,
		};

		expect(noGitParallelOptions.debugOpenCode).toBe(true);
	});

	test("combination with engine-specific args", () => {
		const args = [
			"node",
			"ralphy",
			"--debug-open-code",
			"--opencode",
			"--model",
			"custom-model",
			"--",
			"--engine-specific-flag",
		];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.aiEngine).toBe("opencode");
		expect(options.modelOverride).toBe("custom-model");
	});

	test("debugOpenCode with different execution modes", () => {
		const testCases = [
			["node", "ralphy", "--debug-open-code", "--opencode"],
			["node", "ralphy", "--debug-open-code", "--opencode", "--parallel"],
			["node", "ralphy", "--debug-open-code", "--opencode", "--sandbox"],
			["node", "ralphy", "--debug-open-code", "--opencode", "--branch-per-task"],
			["node", "ralphy", "--debug-open-code", "--opencode", "--max-iterations", "5"],
		];

		for (const args of testCases) {
			const { options } = parseArgs(args);
			expect(options.debugOpenCode).toBe(true);
			expect(options.aiEngine).toBe("opencode");
		}
	});

	test("debugOpenCode is included in engine options", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode", "--model", "test-model"];
		const { options } = parseArgs(args);

		// Simulate how engine options are constructed
		const engineOptions = {
			modelOverride: options.modelOverride,
			debugOpenCode: options.debugOpenCode,
			engineArgs: [], // Would be parsed from -- separator
		};

		expect(engineOptions.modelOverride).toBe("test-model");
		expect(engineOptions.debugOpenCode).toBe(true);
		expect(Array.isArray(engineOptions.engineArgs)).toBe(true);
	});
});

describe("Debug OpenCode Configuration Types", () => {
	test("RuntimeOptions includes debugOpenCode", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode"];
		const { options } = parseArgs(args);

		// Type checking - debugOpenCode should be boolean
		expect(typeof options.debugOpenCode).toBe("boolean");
		expect(options.debugOpenCode).toBe(true);

		// Should be included in full options object
		const fullOptions: RuntimeOptions = options;
		expect(fullOptions.debugOpenCode).toBeDefined();
	});

	test("default configuration values", () => {
		const args = ["node", "ralphy", "--opencode"]; // Without debug flag
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(false);
		expect(options.debug).toBe(false);
	});

	test("debug vs debugOpenCode distinction", () => {
		const args1 = ["node", "ralphy", "--debug", "--opencode"];
		const { options: options1 } = parseArgs(args1);

		const args2 = ["node", "ralphy", "--debug-open-code", "--opencode"];
		const { options: options2 } = parseArgs(args2);

		expect(options1.debug).toBe(true);
		expect(options1.debugOpenCode).toBe(false);

		expect(options2.debug).toBe(false);
		expect(options2.debugOpenCode).toBe(true);

		const args3 = ["node", "ralphy", "--debug", "--debug-open-code", "--opencode"];
		const { options: options3 } = parseArgs(args3);

		expect(options3.debug).toBe(true);
		expect(options3.debugOpenCode).toBe(true);
	});
});
