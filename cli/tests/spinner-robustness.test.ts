import { describe, expect, test } from "bun:test";
import { ProgressSpinner } from "../src/ui/spinner.ts";

describe("ProgressSpinner robustness", () => {
	test("should create spinner without crashing", () => {
		const spinner = new ProgressSpinner("Test task");
		expect(spinner).toBeDefined();
		spinner.stop();
	});

	test("should handle rapid step updates", () => {
		const spinner = new ProgressSpinner("Test task");

		// Simulate rapid updates
		for (let i = 0; i < 10; i++) {
			spinner.updateStep(`Step ${i}`);
		}

		// Should not crash
		expect(() => spinner.updateStep("Final step")).not.toThrow();
		spinner.success();
	});

	test("should handle step updates with timer", async () => {
		const spinner = new ProgressSpinner("Test task with timer");

		// Wait for a few timer ticks
		await new Promise((resolve) => setTimeout(resolve, 2500));

		// Should not crash
		expect(() => spinner.updateStep("New step")).not.toThrow();
		spinner.success();
	});

	test("should handle multiple stop/start cycles", () => {
		const spinner = new ProgressSpinner("Test task");

		// Update and stop
		spinner.updateStep("Step 1");
		spinner.stop();

		// Create a new spinner
		const spinner2 = new ProgressSpinner("Test task 2");
		spinner2.updateStep("Step 2");
		spinner2.success();
	});

	test("should handle error and success calls", () => {
		const spinner = new ProgressSpinner("Test task");

		expect(() => spinner.error("Test error")).not.toThrow();

		const spinner2 = new ProgressSpinner("Test task 2");
		expect(() => spinner2.success("Test success")).not.toThrow();
	});

	test("should format long task names", () => {
		const spinner = new ProgressSpinner(
			"This is a very long task name that should be truncated to prevent display issues",
		);
		spinner.stop();
		// If we got here without crashing, it's good
		expect(true).toBe(true);
	});

	test("should handle settings array", () => {
		const spinner = new ProgressSpinner("Test task", ["option1", "option2"]);
		spinner.stop();
		expect(true).toBe(true);
	});

	test("should handle empty settings", () => {
		const spinner = new ProgressSpinner("Test task", []);
		spinner.stop();
		expect(true).toBe(true);
	});

	test("should handle undefined settings", () => {
		const spinner = new ProgressSpinner("Test task", undefined);
		spinner.stop();
		expect(true).toBe(true);
	});
});
