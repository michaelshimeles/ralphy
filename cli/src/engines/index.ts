export * from "./types.ts";
export * from "./base.ts";
export * from "./claude.ts";
export * from "./opencode.ts";
export * from "./cursor.ts";
export * from "./codex.ts";
export * from "./qwen.ts";
export * from "./droid.ts";
export * from "./copilot.ts";
export * from "./gemini.ts";

import { ClaudeEngine } from "./claude.ts";
import { CodexEngine } from "./codex.ts";
import { CopilotEngine } from "./copilot.ts";
import { CursorEngine } from "./cursor.ts";
import { DroidEngine } from "./droid.ts";
import { GeminiEngine } from "./gemini.ts";
import { OpenCodeEngine } from "./opencode.ts";
import { QwenEngine } from "./qwen.ts";
import type { AIEngine, AIEngineName } from "./types.ts";

/**
 * Create an AI engine by name
 */
export function createEngine(name: AIEngineName): AIEngine {
	switch (name) {
		case "claude":
			return new ClaudeEngine();
		case "opencode":
			return new OpenCodeEngine();
		case "cursor":
			return new CursorEngine();
		case "codex":
			return new CodexEngine();
		case "qwen":
			return new QwenEngine();
		case "droid":
			return new DroidEngine();
		case "copilot":
			return new CopilotEngine();
		case "gemini":
			return new GeminiEngine();
		default:
			throw new Error(`Unknown AI engine: ${name}`);
	}
}

/**
 * Get the display name for an engine
 */
export function getEngineName(name: AIEngineName): string {
	return createEngine(name).name;
}

/**
 * Check if an engine is available
 */
export async function isEngineAvailable(name: AIEngineName): Promise<boolean> {
	return createEngine(name).isAvailable();
}
