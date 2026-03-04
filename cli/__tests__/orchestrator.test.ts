import { describe, expect, test } from "bun:test";
import { executeWithOrchestrator, shouldUseOrchestrator } from "../src/execution/orchestrator.ts";
import type { AIEngine, AIResult } from "../src/engines/types.ts";

// Mock engine for testing - tracks calls per instance
function createMockEngine(responses: AIResult[]): AIEngine & { getCallCount(): number } {
	let callIndex = 0;
	return {
		name: "MockEngine",
		cliCommand: "mock",
		async isAvailable(): Promise<boolean> {
			return true;
		},
		async execute(_prompt: string, _workDir: string, _options?: { modelOverride?: string }): Promise<AIResult> {
			const response = responses[callIndex] ?? responses[responses.length - 1] ?? { success: false, response: "", inputTokens: 0, outputTokens: 0, error: "No responses" };
			callIndex++;
			return response;
		},
		getCallCount(): number {
			return callIndex;
		},
	};
}

describe("Orchestrator Pattern", () => {
	describe("shouldUseOrchestrator", () => {
		test("returns false when no testModel provided", () => {
			expect(shouldUseOrchestrator("implement feature", "build something", undefined)).toBe(false);
		});

		test("returns true for test-related keywords", () => {
			expect(shouldUseOrchestrator("add tests", "write test suite", "test-model")).toBe(true);
			expect(shouldUseOrchestrator("fix jest tests", "debug failing specs", "test-model")).toBe(true);
		});

		test("returns true for implementation keywords", () => {
			expect(shouldUseOrchestrator("implement login", "build auth system", "test-model")).toBe(true);
			expect(shouldUseOrchestrator("create feature", "develop new module", "test-model")).toBe(true);
		});

		test("returns true for fix/debug keywords", () => {
			expect(shouldUseOrchestrator("fix bug", "debug issue", "test-model")).toBe(true);
		});
	});

	describe("executeWithOrchestrator", () => {
		test("successfully completes when tests pass", async () => {
			const mainResponses: AIResult[] = [
				{
					success: true,
					response: "Implemented the feature successfully",
					inputTokens: 100,
					outputTokens: 50,
				},
			];
			const testResponses: AIResult[] = [
				{
					success: true,
					response: "All tests passed! ✓ 5 passed, 0 failed",
					inputTokens: 50,
					outputTokens: 25,
				},
			];

			const mainEngine = createMockEngine(mainResponses);
			const testEngine = createMockEngine(testResponses);

			const result = await executeWithOrchestrator(
				"Implement a login feature",
				{
					mainEngine,
					testEngine,
					mainModel: "main-model",
					testModel: "test-model",
					workDir: "/tmp/test",
				},
			);

			expect(result.success).toBe(true);
			expect(result.mainModelCalls).toBe(1);
			expect(result.testModelCalls).toBe(1);
			expect(result.iterations).toBe(1);
			expect(result.response).toContain("Implemented the feature");
			expect(result.response).toContain("All tests passed");
		});

		test("delegates to test model and requests fixes when tests fail", async () => {
			const mainResponses: AIResult[] = [
				{
					success: true,
					response: "Initial implementation with bug",
					inputTokens: 100,
					outputTokens: 50,
				},
				{
					success: true,
					response: "Fixed implementation, bug resolved",
					inputTokens: 100,
					outputTokens: 50,
				},
			];
			const testResponses: AIResult[] = [
				{
					success: true,
					response: "Tests failed! ✗ 2 failed\nError: null pointer exception",
					inputTokens: 50,
					outputTokens: 25,
				},
			];

			const mainEngine = createMockEngine(mainResponses);
			const testEngine = createMockEngine(testResponses);

			const result = await executeWithOrchestrator(
				"Implement feature",
				{
					mainEngine,
					testEngine,
					mainModel: "main-model",
					testModel: "test-model",
					workDir: "/tmp/test",
				},
			);

			expect(result.success).toBe(true);
			// Orchestrator runs: main -> test -> main(fix) = 2 main, 1 test
			expect(result.mainModelCalls).toBe(2);
			expect(result.testModelCalls).toBe(1);
			expect(result.response).toContain("Fixed implementation");
		});

		test("reports failure when main model fails", async () => {
			const mainResponses: AIResult[] = [
				{
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: "API rate limit exceeded",
				},
			];

			const mainEngine = createMockEngine(mainResponses);
			const testEngine = createMockEngine([]);

			const result = await executeWithOrchestrator(
				"Implement feature",
				{
					mainEngine,
					testEngine,
					mainModel: "main-model",
					testModel: "test-model",
					workDir: "/tmp/test",
				},
			);

			expect(result.success).toBe(false);
			expect(result.mainModelCalls).toBe(1);
			expect(result.testModelCalls).toBe(0); // Test model never called
			expect(result.error).toContain("API rate limit exceeded");
		});

		test("delegates to test model automatically without markers", async () => {
			let testPromptReceived = "";
			const mainEngine = createMockEngine([
				{
					success: true,
					response: "Code implementation complete",
					inputTokens: 100,
					outputTokens: 50,
				},
			]);
			const testEngine: AIEngine = {
				name: "TestEngine",
				cliCommand: "test",
				async isAvailable(): Promise<boolean> {
					return true;
				},
				async execute(prompt: string): Promise<AIResult> {
					testPromptReceived = prompt;
					return {
						success: true,
						response: "Tests verified implementation",
						inputTokens: 50,
						outputTokens: 25,
					};
				},
			};

			await executeWithOrchestrator(
				"Build auth system",
				{
					mainEngine,
					testEngine,
					mainModel: "main-model",
					testModel: "test-model",
					workDir: "/tmp/test",
				},
			);

			// Verify test model was called with appropriate prompt
			expect(testPromptReceived).toContain("test");
			expect(testPromptReceived).toContain("Code implementation complete");
		});

		test("handles test model failure gracefully", async () => {
			const mainEngine = createMockEngine([
				{
					success: true,
					response: "Implementation done",
					inputTokens: 100,
					outputTokens: 50,
				},
			]);
			// Test engine that returns failure (not connection error - those retry)
			const testEngine: AIEngine = {
				name: "TestEngine",
				cliCommand: "test",
				async isAvailable(): Promise<boolean> {
					return true;
				},
				async execute(): Promise<AIResult> {
					return {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error: "Test execution failed: compilation error",
					};
				},
			};

			const result = await executeWithOrchestrator(
				"Implement feature",
				{
					mainEngine,
					testEngine,
					mainModel: "main-model",
					testModel: "test-model",
					workDir: "/tmp/test",
				},
			);

			// Should still report success since main model succeeded
			// Test failure is noted in results but not fatal
			expect(result.success).toBe(true);
			expect(result.testModelCalls).toBe(1);
			expect(result.response).toContain("Test execution failed");
		});

		test("works with opencode/kimi-k2.5-free model and delegates to test model", async () => {
			let testPromptReceived = "";
			const mainEngine = createMockEngine([
				{
					success: true,
					response: "Created factorial function with TypeScript",
					inputTokens: 150,
					outputTokens: 80,
				},
			]);
			const testEngine: AIEngine & { getCallCount(): number } = {
				name: "TestEngine",
				cliCommand: "test",
				async isAvailable(): Promise<boolean> {
					return true;
				},
				async execute(prompt: string): Promise<AIResult> {
					testPromptReceived = prompt;
					return {
						success: true,
						response: "TEST RESULTS:\n- Framework: jest\n- Command: npm test\n- Passed: 5\n- Failed: 0\n- Status: PASS",
						inputTokens: 80,
						outputTokens: 40,
					};
				},
				getCallCount(): number {
					return 1;
				},
			};

			const result = await executeWithOrchestrator(
				"Create factorial function with tests",
				{
					mainEngine,
					testEngine,
					mainModel: "opencode/kimi-k2.5-free",
					testModel: "opencode/gpt-5-nano",
					workDir: "/tmp/test",
				},
			);

			expect(result.success).toBe(true);
			expect(result.mainModelCalls).toBe(1);
			expect(result.testModelCalls).toBe(1);
			// Verify test model received the prompt with test instructions
			expect(testPromptReceived).toContain("test runner");
			expect(testPromptReceived).toContain("npm test");
			expect(result.response).toContain("TEST RESULTS");
		});

		test("progress callback receives updates", async () => {
			const progressMessages: string[] = [];
			const mainEngine = createMockEngine([
				{
					success: true,
					response: "Done",
					inputTokens: 100,
					outputTokens: 50,
				},
			]);
			const testEngine = createMockEngine([
				{
					success: true,
					response: "Tests pass",
					inputTokens: 50,
					outputTokens: 25,
				},
			]);

			await executeWithOrchestrator(
				"Test task",
				{
					mainEngine,
					testEngine,
					workDir: "/tmp/test",
				},
				(msg) => progressMessages.push(msg),
			);

			expect(progressMessages.length).toBeGreaterThan(0);
			expect(progressMessages.some((m) => m.includes("main model"))).toBe(true);
			expect(progressMessages.some((m) => m.includes("test"))).toBe(true);
		});
	});
});
