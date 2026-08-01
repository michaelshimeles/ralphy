import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { parseArgs } from "../cli/args.ts";
import * as baseModule from "./base.ts";
import { createEngine } from "./index.ts";
import { MiniMaxEngine } from "./minimax.ts";

const originalMiniMaxApiKey = process.env.MINIMAX_API_KEY;
const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	restoreEnvironment("MINIMAX_API_KEY", originalMiniMaxApiKey);
	restoreEnvironment("ANTHROPIC_AUTH_TOKEN", originalAnthropicAuthToken);
});

describe("MiniMaxEngine", () => {
	it("registers the minimax CLI option and engine", () => {
		const { options } = parseArgs(["node", "ralphy", "--minimax"]);
		const engine = createEngine("minimax");

		expect(options.aiEngine).toBe("minimax");
		expect(engine).toBeInstanceOf(MiniMaxEngine);
		expect(engine.name).toBe("MiniMax");
		expect(engine.cliCommand).toBe("claude");
	});

	it("uses the default model and MiniMax environment", async () => {
		process.env.MINIMAX_API_KEY = "test-key";
		let capturedArgs: string[] = [];
		let capturedEnvironment: Record<string, string> | undefined;

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_command, args, _workDir, environment) => {
				capturedArgs = args;
				capturedEnvironment = environment;
				return {
					stdout: '{"type":"result","result":"Done","usage":{"input_tokens":1,"output_tokens":1}}',
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await new MiniMaxEngine().execute("test", process.cwd());

		const modelIndex = capturedArgs.indexOf("--model");
		expect(capturedArgs[modelIndex + 1]).toBe("MiniMax-M3");
		expect(capturedEnvironment).toEqual({
			ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
			ANTHROPIC_MODEL: "MiniMax-M3",
			ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M3",
			ANTHROPIC_AUTH_TOKEN: "test-key",
		});

		spy.mockRestore();
	});

	it("applies model overrides to command and environment", async () => {
		process.env.ANTHROPIC_AUTH_TOKEN = "test-token";
		restoreEnvironment("MINIMAX_API_KEY", undefined);
		let capturedArgs: string[] = [];
		let capturedEnvironment: Record<string, string> | undefined;

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_command, args, _workDir, environment) => {
				capturedArgs = args;
				capturedEnvironment = environment;
				return {
					stdout: '{"type":"result","result":"Done","usage":{"input_tokens":1,"output_tokens":1}}',
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await new MiniMaxEngine().execute("test", process.cwd(), {
			modelOverride: "custom-model",
		});

		const modelIndex = capturedArgs.indexOf("--model");
		expect(capturedArgs[modelIndex + 1]).toBe("custom-model");
		expect(capturedEnvironment?.ANTHROPIC_MODEL).toBe("custom-model");
		expect(capturedEnvironment?.ANTHROPIC_SMALL_FAST_MODEL).toBe("custom-model");
		expect(capturedEnvironment?.ANTHROPIC_AUTH_TOKEN).toBe("test-token");

		spy.mockRestore();
	});

	it("uses the same environment for streaming execution", async () => {
		process.env.MINIMAX_API_KEY = "test-key";
		let capturedEnvironment: Record<string, string> | undefined;

		const spy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_command, _args, _workDir, onLine, environment) => {
				capturedEnvironment = environment;
				onLine('{"type":"result","result":"Done","usage":{"input_tokens":1,"output_tokens":1}}');
				return { exitCode: 0 };
			},
		);

		await new MiniMaxEngine().executeStreaming("test", process.cwd(), () => {});

		expect(capturedEnvironment?.ANTHROPIC_BASE_URL).toBe("https://api.minimax.io/anthropic");
		expect(capturedEnvironment?.ANTHROPIC_AUTH_TOKEN).toBe("test-key");

		spy.mockRestore();
	});
});
