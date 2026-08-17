import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { parseArgs } from "../cli/args.ts";
import * as baseModule from "./base.ts";
import { createEngine } from "./index.ts";
import {
	DEFAULT_MINIMAX_REGION,
	MINIMAX_REGION_BASE_URLS,
	MiniMaxEngine,
	resolveMiniMaxBaseUrl,
	resolveMiniMaxRegion,
} from "./minimax.ts";

const TRACKED_ENV_VARS = [
	"MINIMAX_API_KEY",
	"MINIMAX_REGION",
	"MINIMAX_BASE_URL",
	"ANTHROPIC_AUTH_TOKEN",
] as const;

const originalEnv = new Map<string, string | undefined>(
	TRACKED_ENV_VARS.map((name) => [name, process.env[name]]),
);

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	for (const [name, value] of originalEnv) {
		setEnv(name, value);
	}
});

function mockExecCommand(): {
	spy: ReturnType<typeof spyOn>;
	captured: { args: string[]; env?: Record<string, string> };
} {
	const captured: { args: string[]; env?: Record<string, string> } = { args: [] };
	const spy = spyOn(baseModule, "execCommand").mockImplementation(
		async (_command, args, _workDir, env) => {
			captured.args = args;
			captured.env = env;
			return {
				stdout: '{"type":"result","result":"Done","usage":{"input_tokens":1,"output_tokens":1}}',
				stderr: "",
				exitCode: 0,
			};
		},
	);

	return { spy, captured };
}

describe("MiniMax region resolution", () => {
	it("exposes an endpoint for every supported region", () => {
		expect(MINIMAX_REGION_BASE_URLS).toEqual({
			global_en: "https://api.minimax.io/anthropic",
			cn_zh: "https://api.minimaxi.com/anthropic",
		});
	});

	it("defaults to the global region", () => {
		expect(resolveMiniMaxRegion(undefined)).toBe(DEFAULT_MINIMAX_REGION);
		expect(resolveMiniMaxRegion("")).toBe("global_en");
		expect(resolveMiniMaxBaseUrl({})).toBe("https://api.minimax.io/anthropic");
	});

	it("selects the CN endpoint when the CN region is configured", () => {
		expect(resolveMiniMaxBaseUrl({ MINIMAX_REGION: "cn_zh" })).toBe(
			"https://api.minimaxi.com/anthropic",
		);
	});

	it("accepts region aliases and mixed formatting", () => {
		expect(resolveMiniMaxRegion("CN")).toBe("cn_zh");
		expect(resolveMiniMaxRegion(" cn-zh ")).toBe("cn_zh");
		expect(resolveMiniMaxRegion("Global")).toBe("global_en");
		expect(resolveMiniMaxRegion("global-en")).toBe("global_en");
	});

	it("rejects unknown regions", () => {
		expect(() => resolveMiniMaxRegion("moon")).toThrow(/Unknown MINIMAX_REGION/);
	});

	it("lets an explicit base URL win over the region", () => {
		expect(
			resolveMiniMaxBaseUrl({
				MINIMAX_REGION: "cn_zh",
				MINIMAX_BASE_URL: "https://proxy.internal/anthropic/",
			}),
		).toBe("https://proxy.internal/anthropic");
	});
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

	it("uses the default model and the global endpoint", async () => {
		setEnv("MINIMAX_API_KEY", "test-key");
		setEnv("MINIMAX_REGION", undefined);
		setEnv("MINIMAX_BASE_URL", undefined);
		const { spy, captured } = mockExecCommand();

		await new MiniMaxEngine().execute("test", process.cwd());

		const modelIndex = captured.args.indexOf("--model");
		expect(captured.args[modelIndex + 1]).toBe("MiniMax-M3");
		expect(captured.env).toEqual({
			ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
			ANTHROPIC_MODEL: "MiniMax-M3",
			ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M3",
			ANTHROPIC_AUTH_TOKEN: "test-key",
		});

		spy.mockRestore();
	});

	it("routes to the CN endpoint when the CN region is selected", async () => {
		setEnv("MINIMAX_API_KEY", "test-key");
		setEnv("MINIMAX_REGION", "cn_zh");
		setEnv("MINIMAX_BASE_URL", undefined);
		const { spy, captured } = mockExecCommand();

		await new MiniMaxEngine().execute("test", process.cwd());

		expect(captured.env?.ANTHROPIC_BASE_URL).toBe("https://api.minimaxi.com/anthropic");

		spy.mockRestore();
	});

	it("applies model overrides to command and environment", async () => {
		setEnv("MINIMAX_API_KEY", undefined);
		setEnv("ANTHROPIC_AUTH_TOKEN", "test-token");
		const { spy, captured } = mockExecCommand();

		await new MiniMaxEngine().execute("test", process.cwd(), {
			modelOverride: "MiniMax-M2.7",
		});

		const modelIndex = captured.args.indexOf("--model");
		expect(captured.args[modelIndex + 1]).toBe("MiniMax-M2.7");
		expect(captured.env?.ANTHROPIC_MODEL).toBe("MiniMax-M2.7");
		expect(captured.env?.ANTHROPIC_SMALL_FAST_MODEL).toBe("MiniMax-M2.7");
		expect(captured.env?.ANTHROPIC_AUTH_TOKEN).toBe("test-token");

		spy.mockRestore();
	});

	it("uses the configured endpoint for streaming execution", async () => {
		setEnv("MINIMAX_API_KEY", "test-key");
		setEnv("MINIMAX_REGION", "cn");
		setEnv("MINIMAX_BASE_URL", undefined);
		let capturedEnv: Record<string, string> | undefined;

		const spy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_command, _args, _workDir, onLine, env) => {
				capturedEnv = env;
				onLine('{"type":"result","result":"Done","usage":{"input_tokens":1,"output_tokens":1}}');
				return { exitCode: 0 };
			},
		);

		await new MiniMaxEngine().executeStreaming("test", process.cwd(), () => {});

		expect(capturedEnv?.ANTHROPIC_BASE_URL).toBe("https://api.minimaxi.com/anthropic");
		expect(capturedEnv?.ANTHROPIC_AUTH_TOKEN).toBe("test-key");

		spy.mockRestore();
	});
});
