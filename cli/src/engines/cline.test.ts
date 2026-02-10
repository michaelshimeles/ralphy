import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as baseModule from "./base.ts";
import { ClineEngine } from "./cline.ts";

describe("ClineEngine", () => {
	let engine: ClineEngine;
	const testWorkDir = join(tmpdir(), "cline-test");

	beforeEach(() => {
		engine = new ClineEngine();
	});

	it("should invoke cline with -y and --json", async () => {
		let capturedArgs: string[] = [];
		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: '{"type":"say","text":"Done","ts":1,"say":"text"}\n',
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test prompt", testWorkDir);

		expect(capturedArgs[0]).toBe("-y");
		expect(capturedArgs[1]).toBe("--json");
		spy.mockRestore();
	});

	it("should include --model when modelOverride is provided", async () => {
		let capturedArgs: string[] = [];
		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: '{"type":"say","text":"Done","ts":1,"say":"text"}\n',
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test", testWorkDir, { modelOverride: "gpt-4o" });

		const modelIndex = capturedArgs.indexOf("--model");
		expect(modelIndex).toBeGreaterThan(-1);
		expect(capturedArgs[modelIndex + 1]).toBe("gpt-4o");
		spy.mockRestore();
	});

	it("should append passthrough engineArgs", async () => {
		let capturedArgs: string[] = [];
		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: '{"type":"say","text":"Done","ts":1,"say":"text"}\n',
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test", testWorkDir, { engineArgs: ["--timeout", "600"] });

		expect(capturedArgs).toContain("--timeout");
		expect(capturedArgs).toContain("600");
		spy.mockRestore();
	});

	it("should parse the last say:text message as response", async () => {
		const output = [
			'{"type":"say","text":"I will do X","ts":1,"say":"text"}',
			'{"type":"say","text":"Tool output","ts":2,"say":"tool"}',
			'{"type":"say","text":"Final answer","ts":3,"say":"text"}',
		].join("\n");

		const spy = spyOn(baseModule, "execCommand").mockResolvedValue({
			stdout: `${output}\n`,
			stderr: "",
			exitCode: 0,
		});

		const result = await engine.execute("test", testWorkDir);
		expect(result.success).toBe(true);
		expect(result.response).toBe("Final answer");
		spy.mockRestore();
	});

	it("should ignore partial say:text messages", async () => {
		const output = [
			'{"type":"say","text":"Partial...","ts":1,"say":"text","partial":true}',
			'{"type":"say","text":"Complete","ts":2,"say":"text"}',
		].join("\n");

		const spy = spyOn(baseModule, "execCommand").mockResolvedValue({
			stdout: `${output}\n`,
			stderr: "",
			exitCode: 0,
		});

		const result = await engine.execute("test", testWorkDir);
		expect(result.success).toBe(true);
		expect(result.response).toBe("Complete");
		spy.mockRestore();
	});

	it("executeStreaming should call onProgress when step is detected", async () => {
		const lines = [
			'{"type":"say","text":"Using tool","ts":1,"say":"tool"}',
			'{"type":"say","text":"Final","ts":2,"say":"text"}',
		];

		const spy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd: string, _args: string[], _cwd: string, onLine: (line: string) => void) => {
				for (const line of lines) onLine(line);
				return { exitCode: 0 };
			},
		);

		const progressSteps: string[] = [];
		const result = await engine.executeStreaming("test", testWorkDir, (step) =>
			progressSteps.push(step),
		);

		expect(result.success).toBe(true);
		expect(progressSteps.length).toBeGreaterThan(0);
		spy.mockRestore();
	});
});
