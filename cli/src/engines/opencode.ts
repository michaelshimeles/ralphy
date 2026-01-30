import * as fs from "node:fs";
import * as path from "node:path";
import {
	extractSessionId,
	parseJsonLine,
	StepFinishSchema,
	TextSchema,
} from "../utils/json-validation.ts";
import {
	BaseAIEngine,
	detectStepFromOutput as baseDetectStepFromOutput,
	checkForErrors,
	execCommand,
	formatCommandError,
} from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

const isWindows = process.platform === "win32";

/** OpenCode AI Engine */
export class OpenCodeEngine extends BaseAIEngine {
	name = "OpenCode";
	cliCommand = "opencode";
	protected lastUsedModel?: string;

	/** Set up environment variables for OpenCode engine */
	protected getEnv(options?: EngineOptions): Record<string, string> | undefined {
		const env: Record<string, string> = {
			...(options?.env || {}),
			// Add rate limiting to prevent overwhelming the API
			OPENCODE_REQUEST_DELAY: "1000",
		};

		if (options?.debugOpenCode) {
			env.DEBUG_OPENCODE = "true";
			env.OPENCODE_PERMISSION = '{"*":"allow"}';
		}

		return env;
	}

	protected buildArgs(_prompt: string, _workDir: string, options?: EngineOptions): string[] {
		const args = ["run", "--format", "json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
			this.lastUsedModel = options.modelOverride;
		} else {
			this.lastUsedModel = "";
		}

		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		// Do not add prompt here - it will be handled in execute() for Windows compatibility
		return args;
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = this.buildArgs(prompt, workDir, options);

		// On Windows, pass prompt via stdin to avoid shell argument issues
		let stdinContent: string | undefined;
		if (isWindows) {
			stdinContent = prompt;
		} else {
			args.push(prompt);
		}

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			this.getEnv(options),
			stdinContent,
		);

		const output = stdout + stderr;

		// Diagnostics: capture session-related artifacts and environment hints
		try {
			const diagLogPath = path.join(workDir, "opencode_diag.log");
			const combined = output;
			let sessionId: string | undefined;
			// Attempt to extract a sessionId from any JSON lines in the output
			for (const line of combined.split(/\r?\n/)) {
				if (!line?.trim()) continue;
				try {
					const obj = JSON.parse(line);
					if (obj?.sessionID) {
						sessionId = String(obj.sessionID);
					} else if (obj?.sessionId) {
						sessionId = String(obj.sessionId);
					} else if (obj?.session_id) {
						sessionId = String(obj.session_id);
					}
				} catch {
					// ignore non-JSON lines
				}
			}

			const diag = {
				timestamp: new Date().toISOString(),
				command: `${this.cliCommand} ${args.join(" ")}`,
				workDir,
				isWindows,
				exitCode,
				sessionId,
				stateDirHint: process.env.XDG_STATE_HOME || process.env.OPENCODE_STATE_DIR || "",
				envSnapshot: {
					HOME: process.env.HOME || "",
					USERPROFILE: process.env.USERPROFILE || "",
					XDG_STATE_HOME: process.env.XDG_STATE_HOME || "",
				},
				stdoutSnippet: stdout.substring(0, 2000),
				stderrSnippet: stderr.substring(0, 2000),
			};
			// Ensure the log directory exists and append the diagnostic entry
			try {
				fs.mkdirSync(workDir, { recursive: true });
				fs.appendFileSync(diagLogPath, `${JSON.stringify(diag)}\n`);
			} catch {
				// ignore logging failures to avoid impacting the main flow
			}
		} catch {
			// If diagnostics fail for any reason, do not crash the engine
		}

		return this.processCliResult(stdout, stderr, exitCode, workDir);
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
		cost?: string;
		sessionId?: string;
	} {
		const lines = output.split("\n").filter(Boolean);
		let response = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let cost: string | undefined;
		let sessionId: string | undefined;

		// Find step_finish and other events for token counts and session ID
		for (const line of lines) {
			const result = parseJsonLine(line);
			if (!result) continue;
			const { event } = result;

			// Extract session ID from any event that has it
			const extractedSessionId = extractSessionId(event);
			if (extractedSessionId) {
				sessionId = extractedSessionId;
			}

			const stepFinishResult = StepFinishSchema.safeParse(event);
			if (stepFinishResult.success) {
				const stepFinish = stepFinishResult.data;
				const tokens = stepFinish.part?.tokens || stepFinish.tokens;
				inputTokens = tokens?.input || 0;
				outputTokens = tokens?.output || 0;
				cost = String(stepFinish.cost || stepFinish.part?.cost || "");
			}
		}

		// Get text response from text events
		const textParts: string[] = [];
		for (const line of lines) {
			const result = parseJsonLine(line);
			if (!result) continue;
			const { event } = result;

			const textResult = TextSchema.safeParse(event);
			if (textResult.success) {
				textParts.push(textResult.data.part.text);
			}
		}

		response = textParts.join("") || "Task completed";

		return { response, inputTokens, outputTokens, cost, sessionId };
	}

	/** Detect step from output for progress tracking */
	detectStepFromOutput(line: string, logThoughts = false): string | null {
		const trimmed = line.trim();
		const lowerLine = trimmed.toLowerCase();

		// Handle OpenCode JSON text events
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed?.type === "text" && parsed?.part?.text) {
				const text = parsed.part.text;
				// Truncate long text
				if (text.length > 150) {
					return text.substring(0, 150);
				}
				return text;
			}
		} catch {
			// Not JSON, continue with text processing
		}

		// OpenCode-specific step detection before base implementation
		if (lowerLine.includes("reading") || lowerLine.includes("loading")) {
			if (lowerLine.includes("file")) return "Reading code";
		}
		if (
			lowerLine.includes("writing") ||
			lowerLine.includes("editing") ||
			lowerLine.includes("implementing")
		) {
			if (lowerLine.includes("test")) return "Writing tests";
			return "Implementing";
		}

		// Use base implementation for other cases
		const baseResult = baseDetectStepFromOutput(line, logThoughts);
		if (baseResult !== null && baseResult !== undefined) {
			return baseResult;
		}

		// OpenCode-specific step detection
		if (lowerLine.includes("lint") || lowerLine.includes("formatting")) {
			return "Linting";
		}
		if (lowerLine.includes("commit")) return "Committing";
		if (lowerLine.includes("staging")) return "Staging";

		return null;
	}

	protected processCliResult(
		stdout: string,
		stderr: string,
		exitCode: number,
		_workDir: string,
	): AIResult {
		const _SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
		const _SESSION_MAX_COUNT = 100;
		const _SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
		const output = stdout + stderr;

		// Parse OpenCode JSON format
		const { response, inputTokens, outputTokens, cost, sessionId } = this.parseOutput(output);

		// Check for errors first
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
				sessionId,
			};
		}

		// If command failed with non-zero exit code, provide a meaningful error
		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: formatCommandError(exitCode, output),
				sessionId,
			};
		}

		return {
			success: true,
			response,
			inputTokens,
			outputTokens,
			cost,
			sessionId,
		};
	}
}
