/**
 * Telemetry Collector
 *
 * In-memory collection of session and tool call data.
 * Tracks metrics during execution and produces final records.
 */

import { randomUUID } from 'node:crypto';
import type {
  Session,
  SessionFull,
  ToolCall,
  ToolCallSummary,
  TelemetryLevel,
  TelemetryOptions,
} from './types.js';

// Package version (loaded lazily)
let cachedVersion: string | undefined;

function getCliVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // In production, version comes from package.json
    cachedVersion = process.env.npm_package_version || '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * Internal tool call tracking (includes timing data)
 */
interface ToolCallTracker {
  callIndex: number;
  startTime: number;
  toolName: string;
  parameterKeys?: string[];
  parameters?: Record<string, unknown>;
}

/**
 * Telemetry Collector
 *
 * Collects session and tool call metrics during execution.
 * Call startSession() to begin, trackToolCall() for each tool,
 * and endSession() to finalize and get the complete records.
 */
export class TelemetryCollector {
  private sessionId: string;
  private sessionStartTime: number;
  private engine: string;
  private mode: string;
  private level: TelemetryLevel;
  private tags: string[];

  // Counters
  private taskCount = 0;
  private successCount = 0;
  private failedCount = 0;
  private totalTokensIn = 0;
  private totalTokensOut = 0;

  // Tool call tracking
  private toolCalls: ToolCall[] = [];
  private activeToolCall: ToolCallTracker | null = null;
  private callIndex = 0;

  // Full mode data
  private prompts: string[] = [];
  private responses: string[] = [];
  private filePaths: Set<string> = new Set();

  constructor(
    engine: string,
    mode: string,
    options: TelemetryOptions = {}
  ) {
    this.sessionId = randomUUID();
    this.sessionStartTime = Date.now();
    this.engine = engine;
    this.mode = mode;
    this.level = options.level || 'anonymous';
    this.tags = options.tags || [];
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Record task start
   */
  recordTaskStart(): void {
    this.taskCount++;
  }

  /**
   * Record task completion with token counts
   */
  recordTaskComplete(
    success: boolean,
    tokensIn: number,
    tokensOut: number,
    prompt?: string,
    response?: string
  ): void {
    if (success) {
      this.successCount++;
    } else {
      this.failedCount++;
    }

    this.totalTokensIn += tokensIn;
    this.totalTokensOut += tokensOut;

    // Store prompts/responses for full mode
    if (this.level === 'full') {
      if (prompt) this.prompts.push(prompt);
      if (response) this.responses.push(response);
    }
  }

  /**
   * Start tracking a tool call
   */
  startToolCall(
    toolName: string,
    parameters?: Record<string, unknown>
  ): void {
    this.callIndex++;
    this.activeToolCall = {
      callIndex: this.callIndex,
      startTime: Date.now(),
      toolName,
      parameterKeys: parameters ? Object.keys(parameters) : undefined,
      parameters: this.level === 'full' ? parameters : undefined,
    };

    // Track file paths in full mode
    if (this.level === 'full' && parameters) {
      const filePath = parameters.file_path || parameters.path;
      if (typeof filePath === 'string') {
        this.filePaths.add(filePath);
      }
    }
  }

  /**
   * Complete the current tool call
   */
  endToolCall(
    success: boolean,
    errorType?: string,
    result?: string
  ): void {
    if (!this.activeToolCall) return;

    const endTime = Date.now();
    const toolCall: ToolCall = {
      sessionId: this.sessionId,
      callIndex: this.activeToolCall.callIndex,
      timestamp: this.activeToolCall.startTime,
      toolName: this.activeToolCall.toolName,
      durationMs: endTime - this.activeToolCall.startTime,
      success,
      errorType: success ? undefined : errorType,
      parameterKeys: this.activeToolCall.parameterKeys,
    };

    // Add full mode data
    if (this.level === 'full') {
      toolCall.parameters = this.activeToolCall.parameters;
      if (result) toolCall.result = result;
    }

    this.toolCalls.push(toolCall);
    this.activeToolCall = null;
  }

  /**
   * Record a complete tool call (start + end in one)
   */
  recordToolCall(
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
    this.callIndex++;

    const toolCall: ToolCall = {
      sessionId: this.sessionId,
      callIndex: this.callIndex,
      timestamp: Date.now(),
      toolName,
      durationMs,
      success,
      errorType: success ? undefined : options?.errorType,
      parameterKeys: options?.parameterKeys,
    };

    if (this.level === 'full') {
      toolCall.parameters = options?.parameters;
      toolCall.result = options?.result;

      // Track file paths
      if (options?.parameters) {
        const filePath = options.parameters.file_path || options.parameters.path;
        if (typeof filePath === 'string') {
          this.filePaths.add(filePath);
        }
      }
    }

    this.toolCalls.push(toolCall);
  }

  /**
   * Add tags to the session
   */
  addTags(tags: string[]): void {
    this.tags.push(...tags);
  }

  /**
   * Compute tool call summaries from recorded calls
   */
  private computeToolCallSummaries(): ToolCallSummary[] {
    const summaryMap = new Map<string, {
      callCount: number;
      successCount: number;
      failedCount: number;
      totalDurationMs: number;
    }>();

    for (const call of this.toolCalls) {
      const existing = summaryMap.get(call.toolName);
      if (existing) {
        existing.callCount++;
        if (call.success) existing.successCount++;
        else existing.failedCount++;
        existing.totalDurationMs += call.durationMs;
      } else {
        summaryMap.set(call.toolName, {
          callCount: 1,
          successCount: call.success ? 1 : 0,
          failedCount: call.success ? 0 : 1,
          totalDurationMs: call.durationMs,
        });
      }
    }

    const summaries: ToolCallSummary[] = [];
    for (const [toolName, data] of summaryMap) {
      summaries.push({
        toolName,
        callCount: data.callCount,
        successCount: data.successCount,
        failedCount: data.failedCount,
        avgDurationMs: Math.round(data.totalDurationMs / data.callCount),
      });
    }

    return summaries.sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * End the session and return the final records
   */
  endSession(): {
    session: Session | SessionFull;
    toolCalls: ToolCall[];
  } {
    const endTime = Date.now();
    const totalDurationMs = endTime - this.sessionStartTime;

    const session: Session = {
      sessionId: this.sessionId,
      timestamp: this.sessionStartTime,
      engine: this.engine,
      mode: this.mode,
      cliVersion: getCliVersion(),
      platform: process.platform,
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      totalDurationMs,
      taskCount: this.taskCount,
      successCount: this.successCount,
      failedCount: this.failedCount,
      toolCalls: this.computeToolCallSummaries(),
      tags: this.tags.length > 0 ? this.tags : undefined,
    };

    // Add full mode fields
    if (this.level === 'full') {
      const fullSession = session as SessionFull;
      if (this.prompts.length > 0) {
        fullSession.prompt = this.prompts.join('\n\n---\n\n');
      }
      if (this.responses.length > 0) {
        fullSession.response = this.responses.join('\n\n---\n\n');
      }
      if (this.filePaths.size > 0) {
        fullSession.filePaths = Array.from(this.filePaths);
      }
      return { session: fullSession, toolCalls: this.toolCalls };
    }

    return { session, toolCalls: this.toolCalls };
  }

  /**
   * Get current metrics (for progress display)
   */
  getMetrics(): {
    taskCount: number;
    successCount: number;
    failedCount: number;
    toolCallCount: number;
    tokensIn: number;
    tokensOut: number;
  } {
    return {
      taskCount: this.taskCount,
      successCount: this.successCount,
      failedCount: this.failedCount,
      toolCallCount: this.toolCalls.length,
      tokensIn: this.totalTokensIn,
      tokensOut: this.totalTokensOut,
    };
  }
}
