/**
 * AI Agent Eval Dataset Collection - Type Definitions
 *
 * Data models for collecting coding session metrics for eval datasets.
 * Supports two privacy levels:
 * - anonymous: Safe for external sharing (no content, just metrics)
 * - full: Personal use only (includes prompts, responses, file paths)
 */

/**
 * Summary of tool usage within a session
 */
export interface ToolCallSummary {
  toolName: string;
  callCount: number;
  successCount: number;
  failedCount: number;
  avgDurationMs: number;
}

/**
 * Base session record - always collected
 */
export interface Session {
  sessionId: string;           // UUID
  timestamp: number;           // Unix ms
  engine: string;              // claude, opencode, cursor, etc.
  mode: string;                // sequential, parallel, single
  cliVersion: string;
  platform: string;            // darwin, linux, win32

  // Aggregates
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  taskCount: number;
  successCount: number;
  failedCount: number;

  // Tool usage summary
  toolCalls: ToolCallSummary[];

  // Optional: user-provided tags for evals
  tags?: string[];
}

/**
 * Extended session record - full mode only
 */
export interface SessionFull extends Session {
  prompt?: string;            // User's task prompt
  response?: string;          // Final AI response
  filePaths?: string[];       // Files touched
}

/**
 * Individual tool call record
 */
export interface ToolCall {
  sessionId: string;
  callIndex: number;           // Order in session
  timestamp: number;
  toolName: string;            // Read, Edit, Bash, Grep, etc.
  durationMs: number;
  success: boolean;
  errorType?: string;          // timeout, permission, exit_code, etc.

  // Anonymous mode: parameter keys only (no values)
  parameterKeys?: string[];    // ["file_path", "command"]

  // Full mode only
  parameters?: Record<string, unknown>;  // Actual tool parameters
  result?: string;                       // Tool output
}

/**
 * Privacy levels for telemetry
 */
export type TelemetryLevel = 'anonymous' | 'full';

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  enabled: boolean;
  level: TelemetryLevel;
  outputDir: string;
}

/**
 * Runtime telemetry options (from CLI flags)
 */
export interface TelemetryOptions {
  enabled?: boolean;
  level?: TelemetryLevel;
  outputDir?: string;
  tags?: string[];
}

/**
 * Export format types
 */
export type ExportFormat = 'deepeval' | 'openai' | 'raw';

/**
 * DeepEval test case format
 */
export interface DeepEvalTestCase {
  input: string;
  actual_output: string;
  context: string[];
  tools: string[];
  metadata: {
    session_id: string;
    engine: string;
    tokens_in: number;
    tokens_out: number;
    success: boolean;
    duration_ms: number;
  };
}

/**
 * DeepEval export format
 */
export interface DeepEvalExport {
  test_cases: DeepEvalTestCase[];
}

/**
 * OpenAI Evals format (JSONL entries)
 */
export interface OpenAIEvalsEntry {
  metadata: {
    session_id: string;
    engine: string;
    mode: string;
    tools_used: string[];
    tokens_in: number;
    tokens_out: number;
    success: boolean;
    duration_ms: number;
    task_count: number;
    platform: string;
  };
  // Full mode only
  input?: Array<{ role: string; content: string }>;
  ideal?: string;
}

/**
 * Raw export entry (for custom processing)
 */
export interface RawExportEntry {
  type: 'session' | 'tool_call';
  data: Session | SessionFull | ToolCall;
}
