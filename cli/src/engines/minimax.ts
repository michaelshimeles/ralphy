import { ClaudeEngine } from "./claude.ts";
import type { EngineOptions } from "./types.ts";

/** Default MiniMax model used when no `--model` override is given */
const DEFAULT_MODEL = "MiniMax-M3";

/**
 * Anthropic-compatible endpoint for each supported MiniMax region.
 * The global and CN platforms are separate deployments with their own hosts,
 * so the region has to be selectable instead of hard-coded.
 */
export const MINIMAX_REGION_BASE_URLS = {
	global_en: "https://api.minimax.io/anthropic",
	cn_zh: "https://api.minimaxi.com/anthropic",
} as const;

export type MiniMaxRegion = keyof typeof MINIMAX_REGION_BASE_URLS;

/** Region used when nothing is configured */
export const DEFAULT_MINIMAX_REGION: MiniMaxRegion = "global_en";

/** Accepted spellings for each region, including short aliases */
const REGION_ALIASES: Record<string, MiniMaxRegion> = {
	global_en: "global_en",
	global: "global_en",
	en: "global_en",
	intl: "global_en",
	cn_zh: "cn_zh",
	cn: "cn_zh",
	zh: "cn_zh",
};

/**
 * Normalize a configured region name to a supported region key.
 * Throws on unknown values so a typo fails fast instead of silently
 * falling back to the wrong regional endpoint.
 */
export function resolveMiniMaxRegion(region?: string): MiniMaxRegion {
	const normalized = region
		?.trim()
		.toLowerCase()
		.replace(/[-\s]+/g, "_");
	if (!normalized) {
		return DEFAULT_MINIMAX_REGION;
	}

	const resolved = REGION_ALIASES[normalized];
	if (!resolved) {
		const supported = Object.keys(MINIMAX_REGION_BASE_URLS).join(", ");
		throw new Error(`Unknown MINIMAX_REGION "${region}". Supported regions: ${supported}`);
	}

	return resolved;
}

/**
 * Resolve the Anthropic-compatible base URL for MiniMax.
 * `MINIMAX_BASE_URL` wins so a custom or proxied endpoint stays possible,
 * otherwise the URL comes from `MINIMAX_REGION`.
 */
export function resolveMiniMaxBaseUrl(
	env: Record<string, string | undefined> = process.env,
): string {
	const explicitBaseUrl = env.MINIMAX_BASE_URL?.trim();
	if (explicitBaseUrl) {
		return explicitBaseUrl.replace(/\/+$/, "");
	}

	return MINIMAX_REGION_BASE_URLS[resolveMiniMaxRegion(env.MINIMAX_REGION)];
}

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
			ANTHROPIC_BASE_URL: resolveMiniMaxBaseUrl(),
			ANTHROPIC_MODEL: model,
			ANTHROPIC_SMALL_FAST_MODEL: model,
			...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
		};
	}
}
