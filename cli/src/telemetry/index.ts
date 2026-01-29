/**
 * Telemetry Module - Main API
 *
 * Opt-in data collection for building AI eval datasets.
 * Exports session metrics and tool call data in formats
 * used by model providers (DeepEval, OpenAI Evals).
 *
 * Usage:
 *   import { initTelemetry, trackToolCall, endTelemetry } from './telemetry';
 *
 *   // At session start
 *   initTelemetry('claude', 'sequential', { enabled: true, level: 'anonymous' });
 *
 *   // Track tool calls
 *   trackToolCall('Read', 150, true, { parameterKeys: ['file_path'] });
 *
 *   // At session end
 *   await endTelemetry();
 */

import { TelemetryCollector } from './collector.js';
import { TelemetryWriter } from './writer.js';
import { TelemetryExporter } from './exporter.js';
import type {
  TelemetryOptions,
  ExportFormat,
  Session,
  SessionFull,
  ToolCall,
} from './types.js';

// Global state
let collector: TelemetryCollector | null = null;
let writer: TelemetryWriter | null = null;
let isEnabled = false;

/**
 * Initialize telemetry for a session
 *
 * @param engine - AI engine name (claude, opencode, cursor, etc.)
 * @param mode - Execution mode (sequential, parallel, single)
 * @param options - Telemetry options
 */
export function initTelemetry(
  engine: string,
  mode: string,
  options: TelemetryOptions = {}
): void {
  isEnabled = options.enabled ?? false;

  if (!isEnabled) {
    collector = null;
    writer = null;
    return;
  }

  collector = new TelemetryCollector(engine, mode, options);
  writer = new TelemetryWriter(options.outputDir);
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
  return isEnabled && collector !== null;
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | null {
  return collector?.getSessionId() ?? null;
}

/**
 * Record the start of a task
 */
export function recordTaskStart(): void {
  collector?.recordTaskStart();
}

/**
 * Record task completion
 *
 * @param success - Whether the task succeeded
 * @param tokensIn - Input tokens used
 * @param tokensOut - Output tokens generated
 * @param prompt - Task prompt (full mode only)
 * @param response - AI response (full mode only)
 */
export function recordTaskComplete(
  success: boolean,
  tokensIn: number,
  tokensOut: number,
  prompt?: string,
  response?: string
): void {
  collector?.recordTaskComplete(success, tokensIn, tokensOut, prompt, response);
}

/**
 * Start tracking a tool call
 *
 * @param toolName - Name of the tool (Read, Edit, Bash, etc.)
 * @param parameters - Tool parameters (full mode stores values)
 */
export function startToolCall(
  toolName: string,
  parameters?: Record<string, unknown>
): void {
  collector?.startToolCall(toolName, parameters);
}

/**
 * Complete the current tool call
 *
 * @param success - Whether the call succeeded
 * @param errorType - Error type if failed (timeout, permission, etc.)
 * @param result - Tool output (full mode only)
 */
export function endToolCall(
  success: boolean,
  errorType?: string,
  result?: string
): void {
  collector?.endToolCall(success, errorType, result);
}

/**
 * Record a complete tool call (start + end combined)
 *
 * @param toolName - Name of the tool
 * @param durationMs - Call duration in milliseconds
 * @param success - Whether the call succeeded
 * @param options - Additional options
 */
export function trackToolCall(
  toolName: string,
  durationMs: number,
  success: boolean,
  options?: {
    errorType?: string;
    parameterKeys?: string[];
    parameters?: Record<string, unknown>;
    result?: string;
  }
): void {
  collector?.recordToolCall(toolName, durationMs, success, options);
}

/**
 * Add tags to the current session
 *
 * @param tags - Tags to add
 */
export function addTags(tags: string[]): void {
  collector?.addTags(tags);
}

/**
 * Get current session metrics
 */
export function getMetrics(): {
  taskCount: number;
  successCount: number;
  failedCount: number;
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
} | null {
  return collector?.getMetrics() ?? null;
}

/**
 * End the telemetry session and write data to files
 *
 * @returns Session data and output path, or null if telemetry disabled
 */
export async function endTelemetry(): Promise<{
  session: Session | SessionFull;
  toolCalls: ToolCall[];
  outputDir: string;
} | null> {
  if (!collector || !writer) {
    return null;
  }

  const { session, toolCalls } = collector.endSession();
  await writer.write(session, toolCalls);

  const result = {
    session,
    toolCalls,
    outputDir: writer.getOutputDir(),
  };

  // Reset state
  collector = null;
  writer = null;
  isEnabled = false;

  return result;
}

/**
 * Export telemetry data to the specified format
 *
 * @param format - Export format (deepeval, openai, raw)
 * @param options - Export options
 * @returns Path to exported file
 */
export async function exportTelemetry(
  format: ExportFormat,
  options?: { outputDir?: string; outputPath?: string }
): Promise<string> {
  const exporter = new TelemetryExporter(options?.outputDir);
  return exporter.export(format, options?.outputPath);
}

/**
 * Export telemetry data to all formats
 *
 * @param options - Export options
 * @returns Paths to exported files
 */
export async function exportAllFormats(
  options?: { outputDir?: string }
): Promise<{ deepeval: string; openai: string; raw: string }> {
  const exporter = new TelemetryExporter(options?.outputDir);
  return exporter.exportAll();
}

/**
 * Get telemetry summary statistics
 *
 * @param options - Options
 * @returns Summary statistics
 */
export async function getTelemetrySummary(
  options?: { outputDir?: string }
): Promise<{
  sessionCount: number;
  toolCallCount: number;
  engines: string[];
  modes: string[];
  toolsUsed: string[];
  totalTokensIn: number;
  totalTokensOut: number;
  successRate: number;
}> {
  const exporter = new TelemetryExporter(options?.outputDir);
  return exporter.getSummary();
}

/**
 * Check if telemetry data exists
 *
 * @param options - Options
 * @returns Whether data exists
 */
export async function hasTelemetryData(
  options?: { outputDir?: string }
): Promise<boolean> {
  const writerInstance = new TelemetryWriter(options?.outputDir);
  return writerInstance.hasData();
}

// Re-export types and classes for advanced usage
export { TelemetryCollector } from './collector.js';
export { TelemetryWriter } from './writer.js';
export { TelemetryExporter } from './exporter.js';
export type {
  Session,
  SessionFull,
  ToolCall,
  ToolCallSummary,
  TelemetryLevel,
  TelemetryOptions,
  TelemetryConfig,
  ExportFormat,
  DeepEvalExport,
  DeepEvalTestCase,
  OpenAIEvalsEntry,
  RawExportEntry,
} from './types.js';
