import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { StreamRenderer } from "./stream.ts";

// Minimal mock that satisfies the ProgressSpinner interface used by StreamRenderer
function createMockSpinner() {
	return {
		stop: mock(() => {}),
		updateStep: mock(() => {}),
		success: mock(() => {}),
		error: mock(() => {}),
	};
}

describe("StreamRenderer", () => {
	let stdoutWrite: ReturnType<typeof spyOn>;
	let consoleLog: ReturnType<typeof spyOn>;
	let written: string[];
	let logged: string[];

	beforeEach(() => {
		written = [];
		logged = [];
		stdoutWrite = spyOn(process.stdout, "write").mockImplementation(
			(chunk: string | Uint8Array) => {
				written.push(String(chunk));
				return true;
			},
		);
		consoleLog = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		});
	});

	afterEach(() => {
		stdoutWrite.mockRestore();
		consoleLog.mockRestore();
	});

	it("should stop spinner on first write", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		expect(spinner.stop).not.toHaveBeenCalled();
		renderer.write("hello");
		expect(spinner.stop).toHaveBeenCalledTimes(1);
	});

	it("should print border on first write", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("hello");

		// First console.log is the top border
		expect(logged.length).toBeGreaterThanOrEqual(1);
		expect(logged[0]).toContain("─");
	});

	it("should write text to stdout", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("hello ");
		renderer.write("world");

		expect(written).toContain("hello ");
		expect(written).toContain("world");
	});

	it("should only stop spinner once for multiple writes", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("a");
		renderer.write("b");
		renderer.write("c");

		expect(spinner.stop).toHaveBeenCalledTimes(1);
	});

	it("should not write after finish", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("before");
		renderer.finish();
		const writtenCount = written.length;
		renderer.write("after");

		expect(written.length).toBe(writtenCount);
	});

	it("should add newline on finish if last char was not newline", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("no newline at end");
		renderer.finish();

		expect(written).toContain("\n");
	});

	it("should not add extra newline on finish if text ends with newline", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("ends with newline\n");
		const countBefore = written.filter((w) => w === "\n").length;
		renderer.finish();
		const countAfter = written.filter((w) => w === "\n").length;

		expect(countAfter).toBe(countBefore);
	});

	it("should print bottom border on finish", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("text");
		renderer.finish();

		// Last two console.log calls should be borders (top + bottom)
		const borders = logged.filter((l) => l.includes("─"));
		expect(borders.length).toBe(2);
	});

	it("should not finish if never started", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.finish();

		// No borders should be printed
		const borders = logged.filter((l) => l.includes("─"));
		expect(borders.length).toBe(0);
	});

	it("should not finish twice", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("text");
		renderer.finish();
		const logCount = logged.length;
		renderer.finish();

		expect(logged.length).toBe(logCount);
	});

	it("success should finish stream and print success line", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("output");
		renderer.success("Task done");

		const successLine = logged.find((l) => l.includes("✔") && l.includes("Task done"));
		expect(successLine).toBeDefined();
	});

	it("success should include elapsed time", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("output");
		renderer.success();

		const successLine = logged.find((l) => l.includes("✔"));
		expect(successLine).toBeDefined();
		// Should contain time in brackets
		expect(successLine).toMatch(/\[.*\]/);
	});

	it("error should finish stream and print error line", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.write("output");
		renderer.error("Something failed");

		const errorLine = logged.find((l) => l.includes("✖") && l.includes("Something failed"));
		expect(errorLine).toBeDefined();
	});

	it("error without streaming should still print error line", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		renderer.error("Failed before streaming");

		const errorLine = logged.find((l) => l.includes("✖") && l.includes("Failed before streaming"));
		expect(errorLine).toBeDefined();
	});

	it("isActive should reflect stream state", () => {
		const spinner = createMockSpinner();
		const renderer = new StreamRenderer(spinner as never);

		expect(renderer.isActive).toBe(false);
		renderer.write("text");
		expect(renderer.isActive).toBe(true);
		renderer.finish();
		expect(renderer.isActive).toBe(false);
	});
});
