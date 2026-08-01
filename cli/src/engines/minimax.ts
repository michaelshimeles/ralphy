import { ClaudeEngine } from "./claude.ts";
import type { EngineOptions } from "./types.ts";

const DEFAULT_MODEL = "MiniMax-M3";
const ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic";

/**
 * MiniMax AI Engine using the Anthropic-compatible Claude Code transport.
 */
export class MiniMaxEngine extends ClaudeEngine {
	name = "MiniMax";

	protected getModel(options?: EngineOptions): string {
		return options?.modelOverride ?? DEFAULT_MODEL;
	}

	protected getEnvironment(options?: EngineOptions): Record<string, string> {
		const model = this.getModel(options);
		const authToken = process.env.MINIMAX_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;

		return {
			ANTHROPIC_BASE_URL,
			ANTHROPIC_MODEL: model,
			ANTHROPIC_SMALL_FAST_MODEL: model,
			...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
		};
	}
}
