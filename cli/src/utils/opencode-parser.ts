/**
 * OpenCode JSON Stream Parser
 *
 * Parses OpenCode's JSON output format and provides:
 * - Event type detection and classification
 * - Human-readable descriptions for UI display
 * - Filtering capabilities by event type, tool, status, etc.
 * - Session reconstruction from log files
 */

import { z } from "zod";

// =============================================================================
// Zod Schemas for OpenCode Events
// =============================================================================

export const ToolStateSchema = z.object({
	status: z.string(),
	input: z.any().optional(),
	output: z.any().optional(),
	title: z.string().optional(),
	metadata: z.record(z.any()).optional(),
	time: z
		.object({
			start: z.number(),
			end: z.number(),
		})
		.optional(),
});

export const ToolUsePartSchema = z.object({
	id: z.string(),
	sessionID: z.string(),
	messageID: z.string(),
	type: z.literal("tool"),
	callID: z.string(),
	tool: z.string(),
	state: ToolStateSchema,
	metadata: z.record(z.any()).optional(),
});

export const ToolUseEventSchema = z.object({
	type: z.literal("tool_use"),
	timestamp: z.number(),
	sessionID: z.string(),
	part: ToolUsePartSchema,
});

export const StepStartPartSchema = z.object({
	id: z.string(),
	sessionID: z.string(),
	messageID: z.string(),
	type: z.literal("step-start"),
	snapshot: z.string(),
});

export const StepStartEventSchema = z.object({
	type: z.literal("step_start"),
	timestamp: z.number(),
	sessionID: z.string(),
	part: StepStartPartSchema,
});

export const StepFinishPartSchema = z.object({
	id: z.string(),
	sessionID: z.string(),
	messageID: z.string(),
	type: z.literal("step-finish"),
	reason: z.string(),
	snapshot: z.string(),
	cost: z.number().optional(),
	tokens: z
		.object({
			input: z.number(),
			output: z.number(),
			reasoning: z.number().optional(),
			cache: z
				.object({
					read: z.number(),
					write: z.number(),
				})
				.optional(),
		})
		.optional(),
});

export const StepFinishEventSchema = z.object({
	type: z.literal("step_finish"),
	timestamp: z.number(),
	sessionID: z.string(),
	part: StepFinishPartSchema,
});

export const TextPartSchema = z.object({
	text: z.string(),
});

export const TextEventSchema = z.object({
	type: z.literal("text"),
	part: TextPartSchema,
});

export const ErrorEventSchema = z.object({
	type: z.literal("error"),
	error: z
		.object({
			message: z.string(),
		})
		.optional(),
	message: z.string().optional(),
});

export const OpenCodeEventSchema = z.union([
	ToolUseEventSchema,
	StepStartEventSchema,
	StepFinishEventSchema,
	TextEventSchema,
	ErrorEventSchema,
]);

// Type exports from schemas
export type ToolState = z.infer<typeof ToolStateSchema>;
export type ToolUsePart = z.infer<typeof ToolUsePartSchema>;
export type ToolUseEvent = z.infer<typeof ToolUseEventSchema>;
export type StepStartEvent = z.infer<typeof StepStartEventSchema>;
export type StepFinishEvent = z.infer<typeof StepFinishEventSchema>;
export type TextEvent = z.infer<typeof TextEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type OpenCodeEvent = z.infer<typeof OpenCodeEventSchema>;

// =============================================================================
// Extended Type Definitions
// =============================================================================

export type EventType = "tool_use" | "step_start" | "step_finish" | "text" | "error" | "plan" | "thinking" | "unknown";

// Tool types supported by OpenCode/Kimi
export type ToolType = "read" | "write" | "edit" | "glob" | "grep" | "bash" | "list" | "search" | "analyze" | string;

// Tool status types
export type ToolStatus = "completed" | "failed" | "in_progress" | "pending";

// File operation metadata
export interface FileOperation {
	filePath?: string;
	file_path?: string;
	path?: string;
	pattern?: string;
	query?: string;
	command?: string;
	content?: string;
	old_string?: string;
	new_string?: string;
}

// Extended tool state interface for runtime use (compatible with Zod schema)
export interface ExtendedToolState extends ToolState {
	metadata?: {
		count?: number;
		truncated?: boolean;
		preview?: string;
		lines?: number;
		bytes?: number;
	};
}

// Enhanced tool use event for runtime processing
export interface EnhancedToolUseEvent extends ToolUseEvent {
	part: ToolUsePart & {
		metadata?: Record<string, unknown>;
	};
}

export interface ParsedEvent {
	/** Original raw line */
	raw: string;
	/** Parsed event data */
	event: OpenCodeEvent | null;
	/** Event type classification */
	eventType: EventType;
	/** Whether parsing succeeded */
	isValid: boolean;
	/** Error message if parsing failed */
	parseError?: string;
	/** Line number in source file */
	lineNumber?: number;
}

export interface ToolUseDetails {
	tool: ToolType;
	status: string;
	description: string;
	filePath?: string;
	pattern?: string;
	command?: string;
	duration?: number;
	output?: string;
	metadata?: Record<string, unknown>;
}

export interface StepDetails {
	stepId: string;
	sessionId: string;
	reason?: string;
	tokens?: {
		input: number;
		output: number;
		reasoning?: number;
		cache?: { read: number; write: number };
	};
	cost?: number;
	duration?: number;
}

// =============================================================================
// Event Detection & Classification
// =============================================================================

/**
 * Detect event type from a JSON object
 */
export function detectEventType(obj: unknown): EventType {
	if (typeof obj !== "object" || obj === null) {
		return "unknown";
	}

	const type = (obj as Record<string, unknown>).type;
	if (typeof type !== "string") {
		return "unknown";
	}

	switch (type) {
		case "tool_use":
			return "tool_use";
		case "step_start":
			return "step_start";
		case "step_finish":
			return "step_finish";
		case "text":
			return "text";
		case "error":
			return "error";
		default:
			return "unknown";
	}
}

/**
 * Detect tool type from tool_use event
 */
export function detectToolType(event: ToolUseEvent): ToolType {
	return event.part.tool || "unknown";
}

/**
 * Get tool use details for UI display
 */
export function getToolUseDetails(event: ToolUseEvent): ToolUseDetails {
	const part = event.part;
	const state = part.state;
	const tool = part.tool;

	let description = `${tool}: `;
	let filePath: string | undefined;
	let pattern: string | undefined;
	let command: string | undefined;

	switch (tool) {
		case "read":
			filePath = state.input?.filePath || state.input?.file_path;
			description += `Reading ${filePath ? truncatePath(filePath) : "file"}`;
			break;
		case "write":
			filePath = state.input?.filePath || state.input?.file_path;
			description += `Writing ${filePath ? truncatePath(filePath) : "file"}`;
			break;
		case "edit":
			filePath = state.input?.filePath || state.input?.file_path;
			description += `Editing ${filePath ? truncatePath(filePath) : "file"}`;
			break;
		case "glob":
			pattern = state.input?.pattern;
			description += `Searching pattern "${pattern || "unknown"}"`;
			break;
		case "grep":
			pattern = state.input?.pattern || state.input?.query;
			description += `Grep "${pattern || "unknown"}"`;
			break;
		case "bash":
			command = state.input?.command;
			description += `Running: ${command ? truncateCommand(command) : "shell command"}`;
			break;
		case "list":
			filePath = state.input?.path;
			description += `Listing directory ${filePath || "."}`;
			break;
		default:
			description += `Executing ${tool}`;
	}

	if (state.status === "completed") {
		description += " ✓";
	} else if (state.status === "failed") {
		description += " ✗";
	} else if (state.status === "in_progress") {
		description += " ...";
	}

	const duration = state.time ? state.time.end - state.time.start : undefined;

	return {
		tool,
		status: state.status,
		description,
		filePath,
		pattern,
		command,
		duration,
		output: typeof state.output === "string" ? state.output : undefined,
		metadata: state.metadata,
	};
}

/**
 * Get step details for UI display
 */
export function getStepDetails(event: StepStartEvent | StepFinishEvent): StepDetails {
	const isFinish = event.type === "step_finish";
	const part = event.part;

	return {
		stepId: part.id,
		sessionId: part.sessionID,
		reason: isFinish ? (event as StepFinishEvent).part.reason : undefined,
		tokens: isFinish ? (event as StepFinishEvent).part.tokens : undefined,
		cost: isFinish ? (event as StepFinishEvent).part.cost : undefined,
	};
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse a single line of OpenCode JSON output
 */
export function parseOpenCodeLine(line: string, lineNumber?: number): ParsedEvent {
	const trimmed = line.trim();

	if (!trimmed) {
		return {
			raw: line,
			event: null,
			eventType: "unknown",
			isValid: false,
			lineNumber,
		};
	}

	// Handle [RAW OPENCODE OUTPUT] prefix
	const prefix = "[RAW OPENCODE OUTPUT] ";
	const jsonStr = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;

	try {
		const obj = JSON.parse(jsonStr);
		const eventType = detectEventType(obj);

		// Validate with Zod schema
		const parseResult = OpenCodeEventSchema.safeParse(obj);

		if (parseResult.success) {
			return {
				raw: line,
				event: parseResult.data,
				eventType,
				isValid: true,
				lineNumber,
			};
		}

		// If Zod validation fails but we have a valid type, still return it
		if (eventType !== "unknown") {
			return {
				raw: line,
				event: obj as OpenCodeEvent,
				eventType,
				isValid: true,
				lineNumber,
			};
		}

		return {
			raw: line,
			event: obj as OpenCodeEvent,
			eventType: "unknown",
			isValid: false,
			parseError: parseResult.error?.message,
			lineNumber,
		};
	} catch (error) {
		return {
			raw: line,
			event: null,
			eventType: "unknown",
			isValid: false,
			parseError: error instanceof Error ? error.message : "Unknown parse error",
			lineNumber,
		};
	}
}

/**
 * Parse entire OpenCode log content
 */
export function parseOpenCodeLog(content: string): ParsedEvent[] {
	const lines = content.split("\n");
	return lines.map((line, index) => parseOpenCodeLine(line, index + 1));
}

// =============================================================================
// Filtering Functions
// =============================================================================

export interface FilterOptions {
	/** Filter by event types */
	eventTypes?: EventType[];
	/** Filter by tool types (for tool_use events) */
	tools?: ToolType[];
	/** Filter by tool status */
	status?: string[];
	/** Include only events with errors */
	onlyErrors?: boolean;
	/** Filter by session ID */
	sessionId?: string;
	/** Filter by file path (for read/write/edit events) */
	filePath?: string;
	/** Search in output/content */
	searchText?: string;
}

/**
 * Filter parsed events based on options
 */
export function filterEvents(events: ParsedEvent[], options: FilterOptions): ParsedEvent[] {
	return events.filter((parsed) => {
		if (!parsed.isValid || !parsed.event) {
			return false;
		}

		// Filter by event type
		if (options.eventTypes && options.eventTypes.length > 0) {
			if (!options.eventTypes.includes(parsed.eventType)) {
				return false;
			}
		}

		// Filter by session ID
		if (options.sessionId) {
			const event = parsed.event as Record<string, unknown>;
			if (event.sessionID !== options.sessionId && event.sessionId !== options.sessionId) {
				return false;
			}
		}

		// Filter tool_use events
		if (parsed.eventType === "tool_use") {
			const toolEvent = parsed.event as ToolUseEvent;

			// Filter by tool type
			if (options.tools && options.tools.length > 0) {
				if (!options.tools.includes(toolEvent.part.tool)) {
					return false;
				}
			}

			// Filter by status
			if (options.status && options.status.length > 0) {
				if (!options.status.includes(toolEvent.part.state.status)) {
					return false;
				}
			}

			// Filter by file path
			const filterPath = options.filePath;
			if (filterPath) {
				const input = toolEvent.part.state.input || {};
				const filePaths = [input.filePath, input.file_path, input.path, input.pattern].filter(Boolean);

				if (!filePaths.some((fp) => fp?.includes(filterPath))) {
					return false;
				}
			}
		}

		// Filter errors
		if (options.onlyErrors) {
			if (parsed.eventType === "error") {
				return true;
			}
			if (parsed.eventType === "tool_use") {
				const toolEvent = parsed.event as ToolUseEvent;
				if (toolEvent.part.state.status !== "failed") {
					return false;
				}
			}
		}

		// Search text
		if (options.searchText) {
			const searchLower = options.searchText.toLowerCase();
			const textToSearch = parsed.raw.toLowerCase();
			if (!textToSearch.includes(searchLower)) {
				return false;
			}
		}

		return true;
	});
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Truncate a file path for display
 */
function truncatePath(path: string, maxLength: number = 40): string {
	if (path.length <= maxLength) return path;
	const parts = path.split(/[/\\]/);
	if (parts.length <= 2) return `...${path.slice(-maxLength + 3)}`;
	return `.../${parts.slice(-2).join("/")}`;
}

/**
 * Truncate a command for display
 */
function truncateCommand(command: string, maxLength: number = 50): string {
	if (command.length <= maxLength) return command;
	return `${command.slice(0, maxLength - 3)}...`;
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format token count with commas
 */
export function formatTokens(count: number): string {
	return count.toLocaleString();
}

/**
 * Get a human-readable summary of a parsed event for UI display
 */
export function getEventSummary(parsed: ParsedEvent): string {
	if (!parsed.isValid || !parsed.event) {
		return "Invalid or unparsable line";
	}

	switch (parsed.eventType) {
		case "tool_use": {
			const details = getToolUseDetails(parsed.event as ToolUseEvent);
			return details.description;
		}
		case "step_start": {
			const details = getStepDetails(parsed.event as StepStartEvent);
			return `Step started (${truncateId(details.stepId)})`;
		}
		case "step_finish": {
			const details = getStepDetails(parsed.event as StepFinishEvent);
			let summary = `Step finished (${truncateId(details.stepId)})`;
			if (details.tokens) {
				summary += ` - ${formatTokens(details.tokens.input)} → ${formatTokens(details.tokens.output)} tokens`;
			}
			if (details.cost !== undefined) {
				summary += ` - $${details.cost.toFixed(4)}`;
			}
			return summary;
		}
		case "text": {
			const text = (parsed.event as TextEvent).part.text;
			// Check for structured content sections
			const structuredSummary = extractStructuredSummary(text);
			if (structuredSummary) {
				return structuredSummary;
			}
			return truncateText(text, 60);
		}
		case "error": {
			const error = parsed.event as ErrorEvent;
			return `Error: ${error.message || error.error?.message || "Unknown error"}`;
		}
		default:
			return "Unknown event type";
	}
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Extract a summary from structured text content with sections like <ANALYSIS>, <PLAN>, <FILES>, <OPTIMIZATION>
 */
export function extractStructuredSummary(text: string): string | null {
	// Check for structured sections
	const hasAnalysis = text.includes("<ANALYSIS>");
	const hasPlan = text.includes("<PLAN>");
	const hasFiles = text.includes("<FILES>");
	const hasOptimization = text.includes("<OPTIMIZATION>");

	if (!hasAnalysis && !hasPlan && !hasFiles && !hasOptimization) {
		return null;
	}

	const parts: string[] = [];

	// Extract problem from ANALYSIS section
	if (hasAnalysis) {
		const problemMatch = text.match(/<ANALYSIS>\s*\n?\s*-\s*Problem:\s*([^\n]+)/i);
		if (problemMatch) {
			parts.push(`ANALYSIS: ${problemMatch[1].trim()}`);
		}
	}

	// Extract plan steps count
	if (hasPlan) {
		const planSteps = text.match(/\d+\./g);
		if (planSteps) {
			parts.push(`PLAN: ${planSteps.length} steps`);
		}
	}

	// Extract file count
	if (hasFiles) {
		const fileMatches = text.match(/[\w/]+\.(gd|cs|ts|js|py|yaml|json|md|txt)/gi);
		if (fileMatches) {
			const uniqueFiles = new Set(fileMatches);
			parts.push(`FILES: ${uniqueFiles.size} files`);
		}
	}

	// Extract optimization approach
	if (hasOptimization) {
		const approachMatch = text.match(/-\s*Most efficient approach:\s*([^\n]+)/i);
		if (approachMatch) {
			parts.push(`OPTIMIZATION: ${approachMatch[1].trim()}`);
		}
	}

	return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * Truncate ID for display
 */
function truncateId(id: string): string {
	if (id.length <= 12) return id;
	return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

// =============================================================================
// Session Analysis
// =============================================================================

export interface SessionSummary {
	sessionId: string;
	startTime?: number;
	endTime?: number;
	stepCount: number;
	toolUseCount: number;
	totalTokens: { input: number; output: number; reasoning?: number };
	totalCost: number;
	toolsUsed: Map<ToolType, number>;
	errors: string[];
}

/**
 * Analyze a session from parsed events
 */
export function analyzeSession(events: ParsedEvent[], sessionId: string): SessionSummary {
	const summary: SessionSummary = {
		sessionId,
		stepCount: 0,
		toolUseCount: 0,
		totalTokens: { input: 0, output: 0, reasoning: 0 },
		totalCost: 0,
		toolsUsed: new Map(),
		errors: [],
	};

	for (const parsed of events) {
		if (!parsed.isValid || !parsed.event) continue;

		// Check if event belongs to this session
		const event = parsed.event as Record<string, unknown>;
		if (event.sessionID !== sessionId && event.sessionId !== sessionId) {
			continue;
		}

		// Track timestamps
		if (typeof event.timestamp === "number") {
			if (!summary.startTime || event.timestamp < summary.startTime) {
				summary.startTime = event.timestamp;
			}
			if (!summary.endTime || event.timestamp > summary.endTime) {
				summary.endTime = event.timestamp;
			}
		}

		switch (parsed.eventType) {
			case "step_start":
				summary.stepCount++;
				break;
			case "step_finish": {
				const finishEvent = parsed.event as StepFinishEvent;
				if (finishEvent.part.tokens) {
					summary.totalTokens.input += finishEvent.part.tokens.input || 0;
					summary.totalTokens.output += finishEvent.part.tokens.output || 0;
					summary.totalTokens.reasoning =
						(summary.totalTokens.reasoning || 0) + (finishEvent.part.tokens.reasoning || 0);
				}
				if (finishEvent.part.cost !== undefined) {
					summary.totalCost += finishEvent.part.cost;
				}
				break;
			}
			case "tool_use": {
				summary.toolUseCount++;
				const toolEvent = parsed.event as ToolUseEvent;
				const tool = toolEvent.part.tool;
				summary.toolsUsed.set(tool, (summary.toolsUsed.get(tool) || 0) + 1);
				break;
			}
			case "error": {
				const errorEvent = parsed.event as ErrorEvent;
				summary.errors.push(errorEvent.message || errorEvent.error?.message || "Unknown error");
				break;
			}
		}
	}

	return summary;
}

/**
 * Extract all session IDs from parsed events
 */
export function extractSessionIds(events: ParsedEvent[]): string[] {
	const ids = new Set<string>();
	for (const parsed of events) {
		if (parsed.isValid && parsed.event) {
			const event = parsed.event as Record<string, unknown>;
			const sessionId = event.sessionID || event.sessionId;
			if (typeof sessionId === "string") {
				ids.add(sessionId);
			}
		}
	}
	return Array.from(ids);
}
