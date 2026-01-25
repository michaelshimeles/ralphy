import { describe, expect, test } from "bun:test";
import { detectStepFromOutput } from "../src/engines/base.ts";

describe("detectStepFromOutput with logThoughts parameter", () => {
	test("should show concrete actions when logThoughts is false", () => {
		expect(detectStepFromOutput('Reading file "config.ts"', false)).toBe(
			'Reading file "config.ts"',
		);
		expect(detectStepFromOutput('Writing to "test.ts"', false)).toBe("Implementing test.ts");
		expect(detectStepFromOutput("npm test", false)).toBe("Testing");
		expect(detectStepFromOutput("validating configuration", false)).toBe("Validating");
		expect(detectStepFromOutput("verifying the output", false)).toBe("Validating");
		expect(detectStepFromOutput("checking dependencies", false)).toBe("Validating");
		expect(detectStepFromOutput('{"tool": "read", "file_path": "src/index.ts"}', false)).toBe(
			"Reading index.ts",
		);
	});

	test("should hide general AI thoughts when logThoughts is false", () => {
		expect(detectStepFromOutput("I need to check config file", false)).toBeNull();
		expect(detectStepFromOutput("Let me search for function", false)).toBeNull();
	});

	test("should show both actions and thoughts when logThoughts is true (default)", () => {
		expect(detectStepFromOutput('Reading file "config.ts"')).toBe('Reading file "config.ts"');
		expect(detectStepFromOutput("I need to check the config file")).toBe(
			"I need to check the config file",
		);
		expect(detectStepFromOutput('Writing to "test.ts"')).toBe("Implementing test.ts");
		expect(detectStepFromOutput("Let me search for the function")).toBe(
			"Let me search for the function",
		);
	});

	test("should filter out technical noise regardless of logThoughts", () => {
		expect(detectStepFromOutput("Step finished", false)).toBeNull();
		expect(detectStepFromOutput("Step finished", true)).toBeNull();
		expect(detectStepFromOutput("tokens used: 100", false)).toBeNull();
		expect(detectStepFromOutput("tokens used: 100", true)).toBeNull();
		expect(detectStepFromOutput("starting planning phase", false)).toBeNull();
		expect(detectStepFromOutput("starting planning phase", true)).toBeNull();
	});

	test("should handle JSON tool calls correctly", () => {
		expect(detectStepFromOutput('{"tool": "read", "file_path": "src/index.ts"}', false)).toBe(
			"Reading index.ts",
		);
		expect(detectStepFromOutput('{"tool": "write", "file_path": "src/test.ts"}', false)).toBe(
			"Implementing test.ts",
		);
		expect(detectStepFromOutput('{"tool": "bash", "command": "npm test"}', false)).toBe("Testing");
	});

	test("should handle truncated thoughts correctly", () => {
		const longThought =
			"This is a very long thought that should be truncated because it exceeds fifty characters";
		expect(detectStepFromOutput(longThought, true)).toBe(
			"This is a very long thought that should be trun...",
		);
		expect(detectStepFromOutput(longThought, false)).toBeNull();
	});

	test("should filter out lines with task IDs", () => {
		expect(detectStepFromOutput("task st-12345", false)).toBeNull();
		expect(detectStepFromOutput("task st-12345", true)).toBeNull();
	});

	test("should filter out dangling quotes", () => {
		expect(detectStepFromOutput('"some quoted text"', false)).toBeNull();
		expect(detectStepFromOutput('"some quoted text"', true)).toBeNull();
	});

	test("should detect validation patterns correctly", () => {
		expect(detectStepFromOutput("validating the code", false)).toBe("validating the code");
		expect(detectStepFromOutput("Validating input data", true)).toBe("Validating");
		expect(detectStepFromOutput("verifying implementation", false)).toBe("Validating");
		expect(detectStepFromOutput("checking dependencies", true)).toBe("Validating");
		expect(detectStepFromOutput("validated successfully", true)).toBe("Validating");
	});

	test("should detect building/installing patterns correctly", () => {
		expect(detectStepFromOutput("building the project", false)).toBe("building the project");
		expect(detectStepFromOutput("compiling TypeScript", true)).toBe("Building");
		expect(detectStepFromOutput("installing dependencies", false)).toBe("Installing");
		expect(detectStepFromOutput("Installing packages", true)).toBe("Installing");
	});
});
