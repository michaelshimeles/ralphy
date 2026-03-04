/**
 * Result from AI engine execution
 */
export interface AIResult {
	success: boolean;
	response: string;
	inputTokens: number;
	outputTokens: number;
	/** Actual cost in dollars (if provided by engine) or duration in ms */
	cost?: string;
	error?: string;
	/** Session ID if the engine supports it (like OpenCode) */
	sessionId?: string;
}

/**
 * Options passed to engine execute methods
 */
export interface EngineOptions {
	/** Override the default model */
	modelOverride?: string;
	/** Additional arguments to pass to the engine CLI */
	engineArgs?: string[];
	/** Additional environment variables for the engine CLI */
	env?: Record<string, string>;
	/** Enable comprehensive OpenCode debugging */
	debugOpenCode?: boolean;
	/** Allow OpenCode to access sandbox directories without permission prompts */
	allowOpenCodeSandboxAccess?: boolean;
	/** General debug flag */
	debug?: boolean;
	/** Whether this is a dry run (no actual AI execution) */
	dryRun?: boolean;
	/** Log AI thoughts/reasoning to console */
	logThoughts?: boolean;
}

/**
 * Progress callback type for streaming execution
 */
export type ProgressCallback = (step: string) => void;

/**
 * Process reference type for child processes
 * Compatible with both Bun and Node.js child processes
 * BUG FIX: Use proper union type instead of any for type safety
 */
export type ChildProcess =
	| (Bun.Subprocess & { kill: (signal?: string) => void; pid: number; exited: Promise<number> })
	| (import("node:child_process").ChildProcess & {
			kill: (signal?: string) => void;
			pid: number;
			exited?: Promise<number>;
	  });

/**
 * AI Engine interface - one per AI tool
 */
export interface AIEngine {
	/** Display name of the engine */
	name: string;
	/** CLI command to invoke */
	cliCommand: string;
	/** Check if the engine CLI is available */
	isAvailable(): Promise<boolean>;
	/** Execute a prompt and return the result */
	execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult>;
	/** Execute with streaming progress updates (optional) */
	executeStreaming?(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult>;
}

/**
 * Supported AI engine names
 */
export type AIEngineName =
	| "claude"
	| "opencode"
	| "cursor"
	| "codex"
	| "qwen"
	| "droid"
	| "copilot"
	| "gemini";
