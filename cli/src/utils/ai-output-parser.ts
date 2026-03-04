import { parseJsonLine, TextSchema, ToolUseSchema } from "./json-validation.ts";

export interface ParsedStep {
	thought?: string;
	tool?: string;
	toolArgs?: string;
	reading?: string;
	writing?: string;
	running?: string;
	executed?: string;
	raw?: string;
}

/**
 * Parse AI output step and extract structured information
 */
export function parseAIStep(step: string): ParsedStep {
	const parsed: ParsedStep = { raw: step };

	// Try to parse as JSON first
	const result = parseJsonLine(step);
	if (result) {
		const { event, remaining } = result;

		// If there's remaining text, treat it as a thought/progress message
		if (remaining) {
			parsed.thought = remaining;
		}

		// Extract text/response content
		const textResult = TextSchema.safeParse(event);
		if (textResult.success) {
			const textEvent = textResult.data;
			if (textEvent.part?.text) {
				const text = textEvent.part.text;

				// Try to categorize based on content patterns
				if (text.startsWith("[thinking") || text.startsWith("Thinking")) {
					parsed.thought = text;
				} else if (text.startsWith("Running") || text.startsWith("Executing")) {
					parsed.running = text;
				} else if (text.startsWith("Reading") || text.startsWith("Examining")) {
					parsed.reading = text;
				} else if (text.startsWith("Writing") || text.startsWith("Creating") || text.startsWith("Updating")) {
					parsed.writing = text;
				} else if (text.startsWith("Executed") || text.startsWith("Finished")) {
					parsed.executed = text;
				} else {
					// Default: if it's text content, treat as general progress
					parsed.thought = text;
				}
			}
		}

		// Extract tool use content
		const toolUseResult = ToolUseSchema.safeParse(event);
		if (toolUseResult.success) {
			const toolUse = toolUseResult.data;
			const toolName = toolUse.tool || toolUse.part?.tool || "";
			const toolInput = toolUse.part?.state?.input;

			if (toolName) {
				parsed.tool = toolName;

				// Extract meaningful summary of arguments
				let argSummary = "";
				if (toolInput) {
					if (typeof toolInput === "string") {
						argSummary = toolInput;
					} else if (typeof toolInput === "object" && toolInput !== null && !Array.isArray(toolInput)) {
						// Heuristics for common tools
						const input = toolInput as Record<string, unknown>;
						argSummary =
							String(input.pattern || "") ||
							String(input.path || "") ||
							String(input.filePath || "") ||
							String(input.command || "") ||
							JSON.stringify(toolInput);
					}
				}

				parsed.toolArgs = argSummary;

				// Map specific tools to display categories with refined messages
				const lowerTool = toolName.toLowerCase();
				const shortArgs = argSummary;

				if (lowerTool === "read") {
					parsed.reading = `Read: ${shortArgs} `;
				} else if (lowerTool === "glob") {
					parsed.reading = `Glob: ${shortArgs} `;
				} else if (lowerTool === "grep") {
					parsed.reading = `Grep: ${shortArgs} `;
				} else if (lowerTool === "ls") {
					parsed.reading = `List: ${shortArgs} `;
				} else if (lowerTool === "write" || lowerTool === "edit" || lowerTool === "create") {
					parsed.writing = `Write: ${shortArgs} `;
				} else if (lowerTool === "run" || lowerTool === "execute" || lowerTool === "terminal") {
					parsed.running = `Run: ${shortArgs} `;
				} else {
					// Catch-all for other tools
					parsed.tool = `${toolName}: ${shortArgs} `;
				}
			}
		}
	}

	return parsed;
}

/**
 * Format parsed step for display
 */
export function formatParsedStep(step: ParsedStep, agentNum?: number): string | null {
	const prefix = agentNum !== undefined ? `Agent ${agentNum}: ` : "";

	// Prioritize concrete actions over generic thoughts
	if (step.writing) {
		return `${prefix}${step.writing} `;
	}

	if (step.reading) {
		return `${prefix}${step.reading} `;
	}

	if (step.running) {
		return `${prefix}${step.running} `;
	}

	if (step.thought) {
		// Clean up common "Thinking:" prefixes since we wrap in {} later
		const cleanedThought = step.thought.replace(/^(Thinking|Analyzing|Considering|Warning|Waiting)[:\s]*/i, "").trim();
		return `${prefix}${cleanedThought} `;
	}

	if (step.executed) {
		return `${prefix} Done: ${step.executed.substring(0, 100)} `;
	}

	if (step.tool) {
		return `${prefix} Tool: ${step.tool} `;
	}

	// If raw but couldn't parse, truncate and show
	if (step.raw && step.raw.length > 0) {
		const trimmed = step.raw.trim();
		if (trimmed.startsWith("{") || trimmed.startsWith('"')) {
			// It's JSON we couldn't parse, skip it
			return null;
		}
		return `${prefix}${trimmed.substring(0, 100)} `;
	}

	return null;
}
