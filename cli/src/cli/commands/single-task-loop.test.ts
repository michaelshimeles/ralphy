import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "../../config/types.ts";
import { runSingleTaskLoop } from "./single-task-loop.ts";

describe("runSingleTaskLoop", () => {
	it("stops on first non-fatal failure in fail-fast mode", async () => {
		let calls = 0;
		const result = await runSingleTaskLoop(
			"task",
			{
				...DEFAULT_OPTIONS,
				repeatCount: 3,
				continueOnFailure: false,
			},
			{
				runTaskFn: async () => {
					calls++;
					return { success: false, fatal: false, error: "boom" };
				},
				logInfoFn: () => {},
			},
		);

		expect(calls).toBe(1);
		expect(result.completed).toBe(0);
		expect(result.failed).toBe(1);
		expect(result.total).toBe(3);
	});

	it("continues on non-fatal failures when continue-on-failure is enabled", async () => {
		let call = 0;
		const sequence = [
			{ success: false, fatal: false, error: "first" },
			{ success: true, fatal: false },
			{ success: false, fatal: false, error: "last" },
		] as const;

		const result = await runSingleTaskLoop(
			"task",
			{
				...DEFAULT_OPTIONS,
				repeatCount: 3,
				continueOnFailure: true,
			},
			{
				runTaskFn: async () => sequence[call++] ?? sequence[sequence.length - 1],
				logInfoFn: () => {},
			},
		);

		expect(call).toBe(3);
		expect(result.completed).toBe(1);
		expect(result.failed).toBe(2);
		expect(result.total).toBe(3);
	});

	it("always stops on fatal failures", async () => {
		let calls = 0;
		const result = await runSingleTaskLoop(
			"task",
			{
				...DEFAULT_OPTIONS,
				repeatCount: 5,
				continueOnFailure: true,
			},
			{
				runTaskFn: async () => {
					calls++;
					return { success: false, fatal: true, error: "auth failed" };
				},
				logInfoFn: () => {},
			},
		);

		expect(calls).toBe(1);
		expect(result.completed).toBe(0);
		expect(result.failed).toBe(1);
		expect(result.total).toBe(5);
	});

	it("calls runTaskFn exactly once in dry-run mode regardless of repeatCount", async () => {
		let calls = 0;
		const result = await runSingleTaskLoop(
			"task",
			{ ...DEFAULT_OPTIONS, dryRun: true, repeatCount: 5 },
			{
				runTaskFn: async () => {
					calls++;
					return { success: true, fatal: false };
				},
				logInfoFn: () => {},
			},
		);
		expect(calls).toBe(1);
		expect(result.total).toBe(5);
		expect(result.completed).toBe(0);
		expect(result.failed).toBe(0);
	});
});
