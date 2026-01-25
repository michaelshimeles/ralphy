import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";
import { OpenCodeEngine } from "../src/engines/opencode.ts";
import type { EngineOptions } from "../src/engines/types.ts";

// Mock console.log to avoid cluttering test output
const originalConsoleLog = console.log;
const mockConsoleLog = mock(() => {});

describe("CLI Argument Parsing", () => {
	test("parses --debug-opencode flag correctly", () => {
		const args = ["node", "ralphy", "--debug-opencode", "--opencode"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.aiEngine).toBe("opencode");
	});

	test("parses --debug-open-code alias correctly", () => {
		const args = ["node", "ralphy", "--debug-open-code", "--opencode"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.aiEngine).toBe("opencode");
	});

	test("parses --debug-opencode with model override", () => {
		const args = [
			"node",
			"ralphy",
			"--debug-opencode",
			"--opencode",
			"--model",
			"opencode/big-pickle",
		];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.modelOverride).toBe("opencode/grok-code");
	});

	test("defaults debugOpenCode to false", () => {
		const args = ["node", "ralphy", "--opencode"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(false);
	});

	test("combines debug-opencode with other flags", () => {
		const args = ["node", "ralphy", "--debug-opencode", "--opencode", "--verbose", "--dry-run"];
		const { options } = parseArgs(args);

		expect(options.debugOpenCode).toBe(true);
		expect(options.verbose).toBe(true);
		expect(options.dryRun).toBe(true);
	});
});

describe("OpenCode Engine Debug Mode", () => {
	test("builds args with debug environment variables", () => {
		const engine = new OpenCodeEngine();
		const options: EngineOptions = { debugOpenCode: true };
		const env = engine.getEnv(options);

		expect(env?.DEBUG_OPENCODE).toBe("true");
		expect(env?.OPENCODE_PERMISSION).toContain("allow");
	});

	test("sets debug environment when debugOpenCode is true", () => {
		const engine = new OpenCodeEngine();
		const options: EngineOptions = { debugOpenCode: true };
		const env = engine.getEnv(options);

		expect(env?.DEBUG_OPENCODE).toBe("true");
	});

	test("does not set debug environment when debugOpenCode is false", () => {
		const engine = new OpenCodeEngine();
		const options: EngineOptions = { debugOpenCode: false };
		const env = engine.getEnv(options);

		expect(env?.DEBUG_OPENCODE).toBeUndefined();
	});

	test("includes request delay environment variable", () => {
		const engine = new OpenCodeEngine();
		const env = engine.getEnv({});

		expect(env.OPENCODE_REQUEST_DELAY).toBeDefined();
	});
});

describe("Debug Output Processing", () => {
	let engine: OpenCodeEngine;

	beforeEach(() => {
		engine = new OpenCodeEngine();
	});

	test("processes step_finish JSON responses correctly", () => {
		const json = '{"type": "step_finish", "part": {"tokens": {"input": 100, "output": 50}}}';
		const result = engine.processCliResult(json, "", 0, "/tmp");

		expect(result.success).toBe(true);
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});

	test("processes text JSON responses correctly", () => {
		const json = '{"type": "text", "part": {"text": "Hello world"}}';
		const result = engine.processCliResult(json, "", 0, "/tmp");

		expect(result.success).toBe(true);
		expect(result.response).toBe("Hello world");
	});

	test("handles mixed JSON and non-JSON output", () => {
		const output = 'Some noise\n{"type": "text", "part": {"text": "Real content"}}\nMore noise';
		const result = engine.processCliResult(output, "", 0, "/tmp");

		expect(result.success).toBe(true);
		expect(result.response).toBe("Real content");
	});

	test("detects and reports errors in output", () => {
		const output = "ERROR: Something went wrong";
		const result = engine.processCliResult(output, "", 0, "/tmp");

		expect(result.success).toBe(false);
		expect(result.error).toContain("Something went wrong");
	});

	test("handles malformed JSON gracefully", () => {
		const output = '{"type": "text", "part": {"text": "Valid"}}\n{"invalid": json';
		const result = engine.processCliResult(output, "", 0, "/tmp");

		expect(result.success).toBe(true);
		expect(result.response).toBe("Valid");
	});
});

describe("Step Detection", () => {
	test("detects reading step from output with filename", () => {
		const engine = new OpenCodeEngine();

		const step1 = engine.detectStepFromOutput('{"tool": "read", "file_path": "src/main.ts"}');
		const step2 = engine.detectStepFromOutput("Reading file src/utils.ts");
		const step3 = engine.detectStepFromOutput("cat src/index.ts");

		expect(step1).toBe("Reading main.ts");
		expect(step2).toBe("Reading code");
		expect(step3).toBe("Reading index.ts");
	});

	test("detects implementing step from output with filename", () => {
		const engine = new OpenCodeEngine();

		const step1 = engine.detectStepFromOutput('{"tool": "write", "file_path": "src/app.tsx"}');
		const step2 = engine.detectStepFromOutput("Writing content to src/style.css");

		expect(step1).toBe("Implementing app.tsx");
		expect(step2).toBe("Implementing");
	});

	test("filters out technical noise", () => {
		const engine = new OpenCodeEngine();

		expect(engine.detectStepFromOutput("Step finished (11139→51 tokens)")).toBeNull();
		expect(engine.detectStepFromOutput("10→22 tokens")).toBeNull();
		expect(engine.detectStepFromOutput('{"type":"step_finish",...}')).toBeNull();
		expect(engine.detectStepFromOutput("Starting planning")).toBeNull();
		expect(engine.detectStepFromOutput('📦 {"type":"step_start",...}')).toBeNull();

		// Should allow moderately long text from JSON
		const longText =
			"I will help you create tests for DayCycleManager. Let me first explore the codebase to understand the structure.";
		const json = JSON.stringify({ type: "text", part: { text: longText } });
		const step = engine.detectStepFromOutput(json);
		expect(step).not.toBeNull();
		expect(step?.length).toBeLessThanOrEqual(150);
	});
});

describe("Error Handling in Debug Mode", () => {
	let engine: OpenCodeEngine;

	beforeEach(() => {
		engine = new OpenCodeEngine();
		console.log = mockConsoleLog;
	});

	afterEach(() => {
		console.log = originalConsoleLog;
	});

	test("improves rate limit error messages", () => {
		const errorOutput = "Error: rate limit exceeded for user";
		const result = engine.processCliResult(errorOutput, "", 0, "/tmp");

		expect(result.success).toBe(false);
		expect(result.error).toContain("OpenCode Rate Limit");
		expect(result.error).toContain("Try: Wait 30-60s");
	});

	test("improves quota exceeded error messages", () => {
		const errorOutput = "Error: quota exceeded";
		const result = engine.processCliResult(errorOutput, "", 0, "/tmp");

		expect(result.success).toBe(false);
		expect(result.error).toContain("OpenCode Quota Exceeded");
		expect(result.error).toContain("Check your OpenCode plan");
	});

	test("improves connection error messages", () => {
		const errorOutput = "Error: connection timeout";
		const result = engine.processCliResult(errorOutput, "", 0, "/tmp");

		expect(result.success).toBe(false);
		expect(result.error).toContain("OpenCode Connection Error");
		expect(result.error).toContain("Check internet connection");
	});

	test("includes original error in reporting", () => {
		const errorOutput = "ERROR: Some generic error";
		const result = engine.processCliResult(errorOutput, "", 0, "/tmp");

		expect(result.success).toBe(false);
		expect(result.error).toContain("Some generic error");
	});
});
