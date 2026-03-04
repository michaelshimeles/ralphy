import { BaseAIEngine, checkForErrors } from "./base.ts";
import { createErrorResult, createSuccessResult, parseStreamJsonResult } from "./parsers.ts";
import type { AIResult, EngineOptions } from "./types.ts";

/**
 * Claude Code AI Engine
 */
export class ClaudeEngine extends BaseAIEngine {
	name = "Claude Code";
	cliCommand = "claude";

	protected buildArgs(_prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		if (options?.engineArgs) {
			args.push(...options.engineArgs);
		}
		// Note: The prompt is passed via stdin by the base engine for cross-platform compatibility
		// The -p flag tells Claude to read from stdin
		args.push("-p");
		return args;
	}

	protected processCliResult(stdout: string, stderr: string, exitCode: number): AIResult {
		const output = stdout + stderr;
		const error = checkForErrors(output);
		if (error) {
			return { success: false, response: "", inputTokens: 0, outputTokens: 0, error };
		}

		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		if (exitCode !== 0) {
			return createErrorResult(exitCode, output, response, inputTokens, outputTokens);
		}

		return createSuccessResult(response, inputTokens, outputTokens);
	}
}
