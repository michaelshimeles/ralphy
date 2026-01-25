export * from "./base.ts";
export * from "./claude.ts";
export * from "./codex.ts";
export * from "./copilot.ts";
export * from "./cursor.ts";
export * from "./droid.ts";
export * from "./opencode.ts";
export * from "./qwen.ts";
export * from "./types.ts";

import { ClaudeEngine } from "./claude.ts";
import { CodexEngine } from "./codex.ts";
import { CopilotEngine } from "./copilot.ts";
import { CursorEngine } from "./cursor.ts";
import { DroidEngine } from "./droid.ts";
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
	// debugLog(`[DEBUG] isEngineAvailable: Checking '${name}'`);
	const engine = createEngine(name);
	// debugLog(
	// 	`[DEBUG] isEngineAvailable: Created engine '${engine.name}' with CLI '${engine.cliCommand}'`,
	// );
	const result = await engine.isAvailable();
	// debugLog(`[DEBUG] isEngineAvailable: Result for '${name}' = ${result}`);
	return result;
}
