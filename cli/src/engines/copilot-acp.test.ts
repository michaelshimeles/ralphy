import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotAcpEngine } from "./copilot-acp.ts";
import * as baseModule from "./base.ts";

describe("CopilotAcpEngine", () => {
	let engine: CopilotAcpEngine;
	const testWorkDir = join(tmpdir(), "copilot-acp-test");

	beforeEach(() => {
		engine = new CopilotAcpEngine();
		mkdirSync(testWorkDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testWorkDir)) {
			rmSync(testWorkDir, { recursive: true, force: true });
		}
	});

	describe("Basic Properties", () => {
		it("should have correct name and command", () => {
			expect(engine.name).toBe("GitHub Copilot");
			expect(engine.cliCommand).toBe("copilot");
		});
	});

	describe("ACP Connection", () => {
		it("should build prompt content correctly", () => {
			const promptContent = (engine as any).buildPromptContent("test prompt");
			expect(promptContent).toEqual([{ type: "text", text: "test prompt" }]);
		});

		it("should prepend model override as instruction", () => {
			const promptContent = (engine as any).buildPromptContent("test prompt", {
				modelOverride: "gpt-4",
			});
			expect(promptContent).toHaveLength(2);
			expect(promptContent[0]).toEqual({ type: "text", text: "[Use model: gpt-4]" });
			expect(promptContent[1]).toEqual({ type: "text", text: "test prompt" });
		});

		it("should handle empty prompt", () => {
			const promptContent = (engine as any).buildPromptContent("");
			expect(promptContent).toEqual([{ type: "text", text: "" }]);
		});

		it("should preserve multiline prompts", () => {
			const multilinePrompt = "Line 1\nLine 2\nLine 3";
			const promptContent = (engine as any).buildPromptContent(multilinePrompt);
			expect(promptContent[0].text).toBe(multilinePrompt);
		});
	});

	describe("Prompt Content Building", () => {
		it("should handle various prompt content scenarios", async () => {
			// Test with model override
			const withModel = (engine as any).buildPromptContent("test", { modelOverride: "gpt-4" });
			expect(withModel[0].text).toContain("gpt-4");
			expect(withModel[1].text).toBe("test");

			// Test without model
			const withoutModel = (engine as any).buildPromptContent("test");
			expect(withoutModel).toHaveLength(1);
			expect(withoutModel[0].text).toBe("test");
		});
	});

	describe("Streaming Execution", () => {
		it("should have executeStreaming method available", () => {
			expect(engine.executeStreaming).toBeDefined();
			expect(typeof engine.executeStreaming).toBe("function");
		});
	});

	describe("Error Handling", () => {
		it("should check if copilot command is available", async () => {
			const isAvailable = await engine.isAvailable();
			// This will check actual system, but should not throw
			expect(typeof isAvailable).toBe("boolean");
		});
	});

	describe("Integration Properties", () => {
		it("should have correct engine properties", () => {
			expect(engine.name).toBe("GitHub Copilot");
			expect(engine.cliCommand).toBe("copilot");
		});

		it("should support model override in options", () => {
			const content = (engine as any).buildPromptContent("test", {
				modelOverride: "custom-model",
			});
			expect(content[0].text).toContain("custom-model");
		});
	});
});
