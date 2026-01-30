import { BaseAIEngine, checkForErrors, formatCommandError, parseStreamJsonResult } from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

const isWindows = process.platform === "win32";

/**
 * Qwen-Code AI Engine
 */
export class QwenEngine extends BaseAIEngine {
	name = "Qwen-Code";
	cliCommand = "qwen";

	protected buildArgs(prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const args = ["--output-format", "stream-json", "--approval-mode", "yolo"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		if (options?.engineArgs) {
			args.push(...options.engineArgs);
		}
		if (isWindows) {
			args.push("-p");
		} else {
			args.push("-p", prompt);
		}
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
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: formatCommandError(exitCode, output),
			};
		}

		return { success: true, response, inputTokens, outputTokens };
	}
}
