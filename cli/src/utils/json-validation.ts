import { z } from "zod";

export const StepFinishSchema = z.object({
	type: z.literal("step_finish"),
	part: z
		.object({
			tokens: z
				.object({
					input: z.number().optional(),
					output: z.number().optional(),
				})
				.optional(),
			input: z.number().optional(),
			output: z.number().optional(),
			cost: z.number().optional(),
		})
		.optional(),
	tokens: z
		.object({
			input: z.number().optional(),
			output: z.number().optional(),
		})
		.optional(),
	cost: z.number().optional(),
	// Session ID fields (various naming conventions)
	sessionID: z.string().optional(),
	sessionId: z.string().optional(),
	session_id: z.string().optional(),
});

export const StepStartSchema = z.object({
	type: z.literal("step_start"),
});

export const TextSchema = z.object({
	type: z.literal("text"),
	part: z.object({
		text: z.string(),
	}),
});

export const ErrorSchema = z.object({
	type: z.literal("error"),
	error: z
		.object({
			message: z.string().optional(),
		})
		.optional(),
	message: z.string().optional(),
});

export const ResultSchema = z.object({
	type: z.literal("result"),
	result: z.string().optional(),
	usage: z
		.object({
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
		})
		.optional(),
});

export const ToolUseSchema = z.object({
	type: z.literal("tool_use"),
	part: z
		.object({
			tool: z.string().optional(),
			state: z
				.object({
					input: z
						.union([
							z.string(),
							z.number(),
							z.boolean(),
							z.object({}).passthrough(),
							z.array(z.unknown()),
						])
						.optional(),
					status: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
	tool: z.string().optional(),
	callID: z.string().optional(),
});

export const StreamJsonEventSchema = z.union([
	StepFinishSchema,
	StepStartSchema,
	TextSchema,
	ErrorSchema,
	ResultSchema,
	ToolUseSchema,
]);

export type StreamJsonEvent = z.infer<typeof StreamJsonEventSchema>;
export type StepFinish = z.infer<typeof StepFinishSchema>;
export type TextEvent = z.infer<typeof TextSchema>;
export type ToolUseEvent = z.infer<typeof ToolUseSchema>;

/**
 * Safely parse a JSON line with schema validation
 * Returns null if parsing fails or schema is invalid
 *
 * This function handles:
 * - Complete JSON objects
 * - JSON followed by additional text (splits at proper object boundary)
 * - Truncated JSON (attempts to recover)
 * - Special characters in strings (properly handles escape sequences)
 */
export function parseJsonLine(line: string): { event: StreamJsonEvent; remaining?: string } | null {
	try {
		const trimmed = line.trim();
		if (!trimmed) return null;

		// Handle cases where JSON is followed by text without a newline
		// Search for the end of the JSON object
		let jsonStr = trimmed;
		let remaining: string | undefined;

		if (trimmed.startsWith("{")) {
			let depth = 0;
			let inString = false;
			let isEscaped = false;
			let jsonEndIndex = -1;

			for (let i = 0; i < trimmed.length; i++) {
				const char = trimmed[i];
				if (isEscaped) {
					isEscaped = false;
					continue;
				}
				if (inString && char === "\\") {
					isEscaped = true;
					continue;
				}
				if (char === '"' && !isEscaped) {
					inString = !inString;
					continue;
				}
				if (!inString) {
					if (char === "{") depth++;
					if (char === "}") {
						depth--;
						if (depth === 0) {
							jsonEndIndex = i;
							break;
						}
					}
				}
			}

			// If we found a complete JSON object, split it from any remaining text
			if (jsonEndIndex >= 0) {
				jsonStr = trimmed.substring(0, jsonEndIndex + 1);
				remaining = trimmed.substring(jsonEndIndex + 1).trim();
			}
			// If we didn't find a complete object but started with '{',
			// it might be truncated - still try to parse what we have
		}

		const parsed = JSON.parse(jsonStr);
		const event = StreamJsonEventSchema.parse(parsed);
		return { event, remaining: remaining || undefined };
	} catch {
		return null;
	}
}

/**
 * Extract session ID from a parsed JSON event
 */
export function extractSessionId(event: StreamJsonEvent): string | null {
	if ("sessionID" in event && typeof event.sessionID === "string") {
		return event.sessionID;
	}
	if ("sessionId" in event && typeof event.sessionId === "string") {
		return event.sessionId;
	}
	if ("session_id" in event && typeof event.session_id === "string") {
		return event.session_id;
	}
	return null;
}
