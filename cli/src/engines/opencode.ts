import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logDebug as debugLog } from "../ui/logger.ts";
import {
	StepFinishSchema,
	TextSchema,
	extractSessionId,
	parseJsonLine,
} from "../utils/json-validation.ts";
import { BaseAIEngine, checkForErrors, execCommand, formatCommandError } from "./base.ts";
import { detectStepFromOutput as baseDetectStepFromOutput } from "./parsers.ts";
import type { AIResult, EngineOptions } from "./types.ts";

/** OpenCode AI Engine */
export class OpenCodeEngine extends BaseAIEngine {
	name = "OpenCode";
	cliCommand = "opencode";
	protected lastUsedModel?: string;

	/** Set up environment variables for OpenCode engine */
	protected getEnv(options?: EngineOptions): Record<string, string> | undefined {
		const env: Record<string, string> = {
			// Add rate limiting to prevent overwhelming the API
			OPENCODE_REQUEST_DELAY: "1000",
			...(options?.env || {}),
		};

		if (options?.debugOpenCode) {
			env.DEBUG_OPENCODE = "true";
		}

		// Allow OpenCode broad filesystem access only when explicitly opted in.
		if (options?.allowOpenCodeSandboxAccess === true) {
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
		// Prompt is passed via stdin by the execute() method for cross-platform compatibility
		return args;
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = this.buildArgs(prompt, workDir, options);

		// Pass prompt via stdin for cross-platform compatibility
		// This avoids shell escaping issues and argument length limits on all platforms
		const stdinContent = prompt;

		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			workDir,
			this.getEnv(options),
			stdinContent,
		);

		const combinedOutput = stdout + stderr;

		// Diagnostics: capture session-related artifacts only when explicit debug is enabled
		if (options?.debugOpenCode || process.env.RALPHY_DEBUG === "true") {
			try {
				const diagLogPath = path.join(os.tmpdir(), "ralphy-opencode_diag.log");
				let sessionId: string | undefined;
				// Attempt to extract a sessionId from any JSON lines in the output
				for (const line of combinedOutput.split(/\r?\n/)) {
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
						// Ignore non-JSON lines in diagnostic extraction.
					}
				}

				const diag = {
					timestamp: new Date().toISOString(),
					command: this.cliCommand,
					argsCount: args.length,
					workDir,
					platform: process.platform,
					exitCode,
					sessionId,
					stateDirHint: "[REDACTED]",
					envSnapshot: {
						HOME: "[REDACTED]",
						USERPROFILE: "[REDACTED]",
						XDG_STATE_HOME: "[REDACTED]",
					},
					stdoutBytes: Buffer.byteLength(stdout, "utf8"),
					stderrBytes: Buffer.byteLength(stderr, "utf8"),
					hasOutput: stdout.length > 0 || stderr.length > 0,
				};
				// Ensure the log directory exists and append the diagnostic entry
				try {
					fs.mkdirSync(path.dirname(diagLogPath), { recursive: true });
					// Check file size limit before appending
					const MAX_DIAG_SIZE = 10 * 1024 * 1024; // 10MB limit
					if (fs.existsSync(diagLogPath)) {
						const stats = fs.statSync(diagLogPath);
						if (stats.size > MAX_DIAG_SIZE) {
							// Rotate log file
							fs.renameSync(diagLogPath, `${diagLogPath}.old`);
						}
					}
					fs.appendFileSync(diagLogPath, `${JSON.stringify(diag)}\n`);
				} catch (err) {
					// Log but don't crash on logging failures
					debugLog(`Failed to write diagnostic log: ${err}`);
				}
			} catch (diagErr) {
				// If diagnostics fail for any reason, do not crash the engine
				debugLog(`OpenCode: Diagnostic error (non-critical): ${diagErr}`);
			}
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

		// Get text response from text events and tool_use events with file content
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

		// If no text parts found, check if this is a raw tool_use response (planning phase issue)
		// In this case, we return an empty response so the caller can detect this condition
		if (textParts.length === 0) {
			// Check for raw tool_use response
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('{"type":"tool_use"')) {
					// Return empty response - this will be detected by planning.ts
					return { response: "", inputTokens, outputTokens, cost, sessionId };
				}
			}
		}

		response = textParts.join("") || "Task completed";

		return { response, inputTokens, outputTokens, cost, sessionId };
	}

	/** Detect step from output for progress tracking */
	detectStepFromOutput(line: string, logThoughts = false): string | null {
		const trimmed = line.trim();
		const lowerLine = trimmed.toLowerCase();

		// Handle JSON tool calls first (specific to OpenCode)
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed?.tool && parsed?.file_path) {
				const fileName = parsed.file_path.split("/").pop() || parsed.file_path;
				switch (parsed.tool) {
					case "read":
						return `Reading ${fileName}`;
					case "write":
					case "edit":
						return `Implementing ${fileName}`;
					default:
						return `${parsed.tool.charAt(0).toUpperCase() + parsed.tool.slice(1)} ${fileName}`;
				}
			}
			if (parsed?.type === "text" && parsed?.part?.text) {
				const text = parsed.part.text;
				// Truncate long text
				if (text.length > 150) {
					return text.substring(0, 150);
				}
				return text;
			}
		} catch (err) {
			// Not JSON, continue with text processing
			debugLog(`OpenCode: JSON parse error in step detection: ${err}`);
		}

		// OpenCode-specific step detection before base implementation
		if (lowerLine.includes("reading") || lowerLine.includes("loading")) {
			// Check for "Reading file <filename>" pattern first
			const readingFileMatch = trimmed.match(/Reading\s+file\s+["']?([^"']+)["']?/i);
			if (readingFileMatch) {
				const fileName = readingFileMatch[1].split("/").pop() || readingFileMatch[1];
				return `Reading ${fileName}`;
			}
			// Extract filename if present
			const fileMatch = trimmed.match(/(?:file|reading)\s+(?:"?')?([^"'\s]+)/i);
			if (fileMatch) {
				const fileName = fileMatch[1].split("/").pop() || fileMatch[1];
				return `Reading ${fileName}`;
			}
			if (lowerLine.includes("file")) return "Reading code";
		}
		// Handle cat command pattern
		if (trimmed.startsWith("cat ")) {
			const fileMatch = trimmed.match(/cat\s+(?:"?')?([^"'\s]+)/i);
			if (fileMatch) {
				const fileName = fileMatch[1].split("/").pop() || fileMatch[1];
				return `Reading ${fileName}`;
			}
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
