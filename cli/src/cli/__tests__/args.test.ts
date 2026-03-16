import { beforeAll, describe, expect, it, mock, spyOn } from "bun:test";

let parseArgs: typeof import("../args.ts").parseArgs;

beforeAll(async () => {
	mock.module("../../version.ts", () => ({
		VERSION: "test",
	}));
	({ parseArgs } = await import("../args.ts"));
});

function parseCliArgs(args: string[]) {
	return parseArgs(["bun", "ralphy", ...args]);
}

describe("parseArgs repeat options", () => {
	it("parses --repeat 5 with task", () => {
		const { options, task } = parseCliArgs(["--repeat", "5", "do something"]);
		expect(task).toBe("do something");
		expect(options.repeatCount).toBe(5);
		expect(options.continueOnFailure).toBe(false);
	});

	it("throws on --repeat 0", () => {
		expect(() => parseCliArgs(["--repeat", "0", "task"])).toThrow(
			"--repeat must be an integer between 1 and 10000",
		);
	});

	it("throws on --repeat -1", () => {
		expect(() => parseCliArgs(["--repeat", "-1", "task"])).toThrow(
			"--repeat must be an integer between 1 and 10000",
		);
	});

	it("throws on --repeat abc", () => {
		expect(() => parseCliArgs(["--repeat", "abc", "task"])).toThrow(
			"--repeat must be an integer between 1 and 10000",
		);
	});

	it("throws on --repeat 1.5", () => {
		expect(() => parseCliArgs(["--repeat", "1.5", "task"])).toThrow(
			"--repeat must be an integer between 1 and 10000",
		);
	});

	it("throws on --repeat 10001", () => {
		expect(() => parseCliArgs(["--repeat", "10001", "task"])).toThrow(
			"--repeat must be an integer between 1 and 10000",
		);
	});

	it("parses --repeat with --continue-on-failure", () => {
		const { options } = parseCliArgs(["--repeat", "3", "--continue-on-failure", "task"]);
		expect(options.repeatCount).toBe(3);
		expect(options.continueOnFailure).toBe(true);
	});

	it("throws when --repeat is used without task", () => {
		expect(() => parseCliArgs(["--repeat", "3"])).toThrow(
			"--repeat and --continue-on-failure require a task argument",
		);
	});

	it("throws when --continue-on-failure is used without task", () => {
		expect(() => parseCliArgs(["--continue-on-failure"])).toThrow(
			"--repeat and --continue-on-failure require a task argument",
		);
	});

	it("warns when --continue-on-failure is used without --repeat but with a task", () => {
		const warnSpy = spyOn(console, "warn");
		const { options } = parseCliArgs(["--continue-on-failure", "do something"]);
		expect(options.continueOnFailure).toBe(true);
		expect(options.repeatCount).toBe(1);
		expect(warnSpy).toHaveBeenCalledWith(
			"Warning: --continue-on-failure has no effect without --repeat",
		);
		warnSpy.mockRestore();
	});

	it("throws when repeat options are combined with task source flags", () => {
		expect(() => parseCliArgs(["--repeat", "3", "--yaml", "tasks.yaml", "task"])).toThrow(
			"--repeat and --continue-on-failure cannot be used with --prd, --yaml, --json, or --github",
		);
	});

	it("defaults to repeatCount 1", () => {
		const { options } = parseCliArgs(["task"]);
		expect(options.repeatCount).toBe(1);
		expect(options.continueOnFailure).toBe(false);
	});
});
