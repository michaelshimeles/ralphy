import type { z } from "zod";
import { ErrorSchema, StepFinishSchema, parseJsonLine } from "../utils/json-validation.ts";
import type { AIResult } from "./types.ts";

/**
 * Parsed result with token counts
 */
export interface ParsedResult {
	response: string;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Token counts
 */
export interface TokenCounts {
	input: number;
	output: number;
}

function isAuthenticationMessage(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("invalid api key") ||
		lower.includes("authentication") ||
		lower.includes("not authenticated") ||
		lower.includes("unauthorized") ||
		lower.includes("/login")
	);
}

export function extractAuthenticationError(output: string): string | null {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		let event: Record<string, unknown> | null = null;
		let rawEvent: Record<string, unknown> | null = null;

		if (line.startsWith("{")) {
			try {
				const parsed = JSON.parse(line);
				if (parsed && typeof parsed === "object") {
					rawEvent = parsed as Record<string, unknown>;
				}
			} catch {
				// ignore malformed JSON lines
			}
		}

		const parsedLine = parseJsonLine(line);
		if (parsedLine?.event && typeof parsedLine.event === "object") {
			event = parsedLine.event as Record<string, unknown>;
		} else if (rawEvent) {
			event = rawEvent;
		}

		if (!event) continue;

		const type = typeof event.type === "string" ? event.type : "";

		if (type === "error") {
			const errorObj = event.error;
			const errorMessage =
				errorObj &&
				typeof errorObj === "object" &&
				typeof (errorObj as { message?: unknown }).message === "string"
					? (errorObj as { message: string }).message
					: typeof event.message === "string"
						? event.message
						: "";
			if (errorMessage && isAuthenticationMessage(errorMessage)) return errorMessage;
		}

		const source = rawEvent || event;
		if (
			type === "result" &&
			source.is_error === true &&
			typeof source.result === "string" &&
			isAuthenticationMessage(source.result)
		) {
			return source.result;
		}

		if (type === "assistant") {
			const messageObj = event.message;
			const hasAuthError =
				event.error === "authentication_failed" ||
				(messageObj &&
					typeof messageObj === "object" &&
					(messageObj as { error?: unknown }).error === "authentication_failed");
			if (!hasAuthError) continue;

			if (messageObj && typeof messageObj === "object") {
				const content = (messageObj as { content?: unknown }).content;
				if (Array.isArray(content)) {
					for (const item of content) {
						if (!item || typeof item !== "object") continue;
						const text = (item as { text?: unknown }).text;
						if (typeof text === "string" && isAuthenticationMessage(text)) return text;
					}
				}
			}
		}
	}

	return null;
}

/**
 * Check for errors in stream-json output or general CLI output.
 */
export function checkForErrors(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		const trimmed = line.trim();
		// Try JSON parsing with schema validation
		if (trimmed.startsWith("{")) {
			const parsed = parseJsonLine(line);
			if (parsed && ErrorSchema.safeParse(parsed.event).success) {
				const errorData = parsed.event as z.infer<typeof ErrorSchema>;
				return errorData.error?.message || errorData.message || "Unknown error";
			}
		}

		// Look for common error patterns in plain text (case-insensitive)
		const lowerTrimmed = trimmed.toLowerCase();
		const hasExplicitErrorPrefix = lowerTrimmed.startsWith("fatal:");
		const hasKnownModelErrorToken =
			lowerTrimmed.includes("providermodelnotfounderror") ||
			lowerTrimmed.includes("modelnotfounderror") ||
			(lowerTrimmed.includes("model not found") && lowerTrimmed.includes("error")) ||
			(lowerTrimmed.includes("invalid model") && lowerTrimmed.includes("error"));

		if (hasExplicitErrorPrefix || hasKnownModelErrorToken) {
			// Improve specific error messages
			if (lowerTrimmed.includes("rate limit")) {
				return "OpenCode Rate Limit: Too many requests. Try: Wait 30-60s";
			}
			if (lowerTrimmed.includes("quota")) {
				return "OpenCode Quota Exceeded: You've reached your usage limit. Check your OpenCode plan";
			}
			if (lowerTrimmed.includes("connection") || lowerTrimmed.includes("timeout")) {
				return "OpenCode Connection Error: Unable to connect to the service. Check internet connection";
			}
			return trimmed;
		}
	}

	// Secondary check for common fatal strings
	const fatalTerms = ["Permission denied", "command not found"];
	const fatalLine = output.split("\n").find((line) => {
		const trimmedLine = line.trim();
		const lowerLine = trimmedLine.toLowerCase();
		const hasFatalPrefix = /^(fatal:|error:|err:|\/bin\/sh:|sh:|bash:|zsh:)/i.test(trimmedLine);
		return (
			(hasFatalPrefix && fatalTerms.some((term) => lowerLine.includes(term.toLowerCase()))) ||
			lowerLine.includes("providermodelnotfounderror")
		);
	});
	if (fatalLine) {
		return fatalLine.trim() || "Access or command error";
	}

	return null;
}

/**
 * Format a command failure with useful output context.
 */
export function formatCommandError(exitCode: number, output: string): string {
	const trimmed = output.trim();
	if (!trimmed) {
		return `Command failed with exit code ${exitCode}`;
	}

	// Try to find a meaningful error message first
	const authError = extractAuthenticationError(output);
	if (authError) {
		return authError;
	}

	const extractedError = checkForErrors(output);
	if (extractedError) {
		return `Command failed with exit code ${exitCode}. Output:\n${extractedError}`;
	}

	const lines = trimmed.split("\n").filter(Boolean);
	const snippet = lines.slice(-12).join("\n");
	return `Command failed with exit code ${exitCode}. Output:\n${snippet}`;
}

/**
 * Parse JSON result from AI output
 */
export function parseStreamJsonResult(output: string): ParsedResult {
	const lines = output.split("\n").filter(Boolean);
	let response = "";
	let inputTokens = 0;
	let outputTokens = 0;

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "result") {
				response = parsed.result || "Task completed";
				inputTokens = parsed.usage?.input_tokens || 0;
				outputTokens = parsed.usage?.output_tokens || 0;
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return { response: response || "Task completed", inputTokens, outputTokens };
}

/**
 * Extract token counts from JSON response
 */
export function extractTokenCounts(output: string): TokenCounts | null {
	const lines = output.split("\n").filter(Boolean);
	for (const line of lines) {
		if (line.trim().startsWith("{")) {
			const parsed = parseJsonLine(line);
			if (!parsed) continue;

			const stepFinishResult = StepFinishSchema.safeParse(parsed.event);
			if (stepFinishResult.success) {
				const stepFinish = stepFinishResult.data;
				const tokens = stepFinish.part?.tokens || stepFinish.tokens;
				if (tokens) {
					return {
						input: tokens.input || 0,
						output: tokens.output || 0,
					};
				}
			}
		}
	}
	return null;
}

/**
 * Detect step from AI output line
 */
export function detectStepFromOutput(line: string, logThoughts = true): string | null {
	const trimmed = line.trim();

	// Skip empty lines and obvious non-step lines
	if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("$") || trimmed.startsWith("{")) {
		return null;
	}

	// Skip markdown headings and list bullets - they often produce noisy false positives
	if (/^#{1,6}\s+/.test(trimmed) || /^[-*+]\s+/.test(trimmed)) {
		return null;
	}

	// Check for natural language patterns that indicate a step
	const stepPatterns = [
		// Action-oriented phrases
		/^(I will|I'll|Let me|Now I'll|Next I'll|First I'll|Then I'll|Finally I'll)\s+/i,
		// Status indicators
		/^(Step\s+\d+|Phase\s+\d+|Stage\s+\d+):?/i,
		// Progress markers
		/^(Working on|Starting|Proceeding with|Moving to|Switching to)\s+/i,
		// Analysis phrases
		/^(Analyzing|Examining|Reviewing|Checking|Investigating)\s+/i,
		// Action verbs at start
		/^(Reading|Writing|Editing|Creating|Deleting|Moving|Renaming|Running|Testing|Building|Searching|Finding|Getting|Setting|Updating|Modifying|Implementing|Adding|Removing|Fixing|Refactoring|Optimizing|Converting|Generating|Validating|Formatting|Organizing|Preparing|Executing|Completing)\s+/i,
		// Special markers
		/^\[(READ|WRITE|EDIT|CREATE|DELETE|RUN|TEST|BUILD|SEARCH|ANALYZE|FIX|REFACTOR)\]/i,
	];

	for (const pattern of stepPatterns) {
		const match = trimmed.match(pattern);
		if (match) {
			// Avoid generic assistant chatter being treated as an execution step
			if (/^(i can|i think|i need|it looks like|we should)\b/i.test(trimmed)) {
				return null;
			}

			// Extract the full action description (first sentence or up to 100 chars)
			let step = trimmed;
			const sentenceEnd = step.match(/[.!?](?:\s|$)/);
			if (sentenceEnd?.index && sentenceEnd.index < 100) {
				step = step.slice(0, sentenceEnd.index + 1);
			} else if (step.length > 100) {
				step = `${step.slice(0, 97)}...`;
			}

			// Don't log thoughts if disabled
			if (!logThoughts && /^(?:(?:Let me|I'll|I will) think|thinking|analyzing the)/i.test(step)) {
				return null;
			}

			return step;
		}
	}

	return null;
}

/**
 * Extract the most meaningful line from output for display
 */
export function extractMeaningfulLine(output: string): string | null {
	const lines = output.split("\n").filter((line) => line.trim());

	for (const line of lines) {
		const step = detectStepFromOutput(line, false);
		if (step) {
			return step;
		}
	}

	return lines[0] || null;
}

/**
 * Create error result from exit code and output
 */
export function createErrorResult(
	exitCode: number,
	output: string,
	response = "",
	inputTokens = 0,
	outputTokens = 0,
): AIResult {
	return {
		success: false,
		response,
		inputTokens,
		outputTokens,
		error: formatCommandError(exitCode, output),
	};
}

/**
 * Create success result with response and token counts
 */
export function createSuccessResult(
	response: string,
	inputTokens: number,
	outputTokens: number,
	extra?: Record<string, unknown>,
): AIResult {
	return {
		success: true,
		response,
		inputTokens,
		outputTokens,
		...extra,
	};
}
