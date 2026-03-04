import { logDebug, logError, logWarn } from "../ui/logger.ts";
import { isRetryableError, standardizeError } from "../utils/errors.ts";

interface RetryOptions {
	maxRetries: number;
	retryDelay: number; // in seconds
	onRetry?: (attempt: number, error: string, delayMs: number) => void;
	/** Enable exponential backoff for connection errors */
	exponentialBackoff?: boolean;
	/** Maximum delay in seconds (default: 60) */
	maxDelay?: number;
	/** Add random jitter to delay (default: true) */
	jitter?: boolean;
	/** Optional task ID for tracking connection state */
	taskId?: string;
}

/**
 * Circuit breaker states
 */
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerConfig {
	/** Number of failures before opening the circuit */
	failureThreshold: number;
	/** Time in ms before attempting to close the circuit */
	resetTimeoutMs: number;
	/** Half-open max attempts to test if service recovered */
	halfOpenMaxAttempts: number;
}

/**
 * Connection state manager to track global connection health
 * Prevents infinite retries when connection is consistently failing
 */
class ConnectionStateManager {
	private static instance: ConnectionStateManager;
	private circuitState: CircuitState = "CLOSED";
	private consecutiveFailures = 0;
	private lastFailureTime: number | null = null;

	private halfOpenAttempts = 0;

	private readonly config: CircuitBreakerConfig = {
		failureThreshold: 3, // Open after 3 consecutive failures
		resetTimeoutMs: 30000, // Wait 30s before trying again
		halfOpenMaxAttempts: 2, // Try 2 times in half-open state
	};

	static getInstance(): ConnectionStateManager {
		if (!ConnectionStateManager.instance) {
			ConnectionStateManager.instance = new ConnectionStateManager();
		}
		return ConnectionStateManager.instance;
	}

	/**
	 * Check if we should attempt a request (circuit allows it)
	 */
	canAttempt(): { allowed: boolean; reason?: string } {
		const now = Date.now();

		switch (this.circuitState) {
			case "CLOSED":
				return { allowed: true };

			case "OPEN": {
				// Check if we should transition to half-open
				if (this.lastFailureTime && now - this.lastFailureTime > this.config.resetTimeoutMs) {
					this.circuitState = "HALF_OPEN";
					this.halfOpenAttempts = 0;
					logWarn("Circuit breaker entering HALF_OPEN state - testing connection...");
					return { allowed: true };
				}
				const remainingMs = this.config.resetTimeoutMs - (now - (this.lastFailureTime || 0));
				return {
					allowed: false,
					reason: `Connection circuit OPEN - too many failures. Waiting ${Math.ceil(remainingMs / 1000)}s before retry...`,
				};
			}

			case "HALF_OPEN":
				if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
					// BUG FIX: Too many attempts in half-open, go back to open and BLOCK the request
					this.circuitState = "OPEN";
					this.lastFailureTime = now;
					return {
						allowed: false,
						reason: `Connection circuit OPEN - service still unavailable after ${this.config.halfOpenMaxAttempts} test attempts`,
					};
				}
				this.halfOpenAttempts++;
				return { allowed: true };
		}
	}

	/**
	 * Record a successful request
	 */
	recordSuccess(): void {
		if (this.circuitState === "HALF_OPEN") {
			// Success in half-open closes the circuit
			this.circuitState = "CLOSED";
			this.consecutiveFailures = 0;
			this.halfOpenAttempts = 0;
			logWarn("Circuit breaker CLOSED - connection restored");
		} else {
			this.consecutiveFailures = 0;
		}
	}

	/**
	 * Record a failed request
	 */
	recordFailure(error: Error): void {
		const isConnectionError = this.isConnectionRelatedError(error);

		if (!isConnectionError) {
			// Non-connection errors don't affect circuit breaker
			return;
		}

		this.consecutiveFailures++;
		this.lastFailureTime = Date.now();

		if (this.circuitState === "HALF_OPEN") {
			// Failure in half-open goes back to open
			this.circuitState = "OPEN";
			logWarn(
				`Circuit breaker OPEN - connection failed in half-open state (failure ${this.consecutiveFailures})`,
			);
		} else if (this.consecutiveFailures >= this.config.failureThreshold) {
			this.circuitState = "OPEN";
			logError(
				`Circuit breaker OPEN - ${this.consecutiveFailures} consecutive connection failures. Stopping retries for ${this.config.resetTimeoutMs / 1000}s`,
			);
		}
	}

	/**
	 * Check if error is connection-related
	 */
	private isConnectionRelatedError(error: Error): boolean {
		return (
			isRetryableError(error) &&
			/connection|network|timeout|unable to connect|internet connection|econnrefused|econnreset|socket hang up|dns|ENOTFOUND/i.test(
				error.message,
			)
		);
	}

	/**
	 * Get current circuit state for debugging
	 */
	getState(): { state: CircuitState; consecutiveFailures: number; lastFailureTime: number | null } {
		return {
			state: this.circuitState,
			consecutiveFailures: this.consecutiveFailures,
			lastFailureTime: this.lastFailureTime,
		};
	}

	/**
	 * Force reset the circuit (for manual recovery)
	 */
	reset(): void {
		this.circuitState = "CLOSED";
		this.consecutiveFailures = 0;
		this.halfOpenAttempts = 0;
		this.lastFailureTime = null;
		logWarn("Circuit breaker manually reset to CLOSED");
	}
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Global circuit breaker instance
 */
export const circuitBreaker = ConnectionStateManager.getInstance();

/**
 * Check if connection is healthy enough to attempt requests
 */
export function canMakeConnectionAttempt(): { allowed: boolean; reason?: string } {
	return circuitBreaker.canAttempt();
}

/**
 * Reset connection circuit breaker (for manual recovery)
 */
export function resetConnectionCircuit(): void {
	circuitBreaker.reset();
}

/**
 * Get current connection health status
 */
export function getConnectionHealth(): {
	state: CircuitState;
	consecutiveFailures: number;
	lastFailureTime: number | null;
} {
	return circuitBreaker.getState();
}

/**
 * Calculate delay with exponential backoff for connection errors
 */
function calculateDelay(
	baseDelaySeconds: number,
	attempt: number,
	error: Error,
	exponentialBackoff: boolean,
	maxDelaySeconds: number,
	useJitter: boolean,
): number {
	const maxDelayMs = maxDelaySeconds * 1000;
	const baseDelayMs = baseDelaySeconds * 1000;

	if (!exponentialBackoff) {
		const delay = Math.min(baseDelayMs, maxDelayMs);
		if (!useJitter) return delay;
		const jitter = Math.floor(delay * 0.25 * Math.random());
		return Math.min(delay + jitter, maxDelayMs);
	}

	// Check if this is a connection/network error
	const isConnectionError =
		isRetryableError(error) &&
		/connection|network|timeout|unable to connect|internet connection|econnrefused|econnreset|socket hang up/i.test(
			error.message,
		);

	if (isConnectionError) {
		// Exponential backoff: 2s, 4s, 8s, max 30s
		let delayMs = Math.min(2000 * 2 ** (attempt - 1), maxDelayMs);
		if (useJitter) {
			delayMs = Math.min(delayMs + Math.floor(delayMs * 0.25 * Math.random()), maxDelayMs);
		}
		logDebug(`Connection error detected, using exponential backoff: ${delayMs}ms`);
		return delayMs;
	}

	let delay = Math.min(baseDelayMs, maxDelayMs);
	if (useJitter) {
		delay = Math.min(delay + Math.floor(delay * 0.25 * Math.random()), maxDelayMs);
	}
	return delay;
}

/**
 * Execute a function with retry logic and circuit breaker
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
	const {
		maxRetries,
		retryDelay,
		onRetry,
		exponentialBackoff = true,
		maxDelay = 60,
		jitter = true,
		taskId,
	} = options;
	let lastError: Error | null = null;

	// Check circuit breaker before attempting
	const circuitCheck = circuitBreaker.canAttempt();
	if (!circuitCheck.allowed) {
		logError(`Circuit breaker preventing retry: ${circuitCheck.reason}`);
		throw new Error(circuitCheck.reason || "Connection circuit open - too many failures");
	}

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const result = await fn();
			// Success - record it to close circuit if in half-open
			circuitBreaker.recordSuccess();
			return result;
		} catch (error) {
			lastError = standardizeError(error);

			// Record failure for circuit breaker tracking
			if (!lastError) {
				continue;
			}
			circuitBreaker.recordFailure(lastError);

			if (attempt < maxRetries) {
				const errorMsg = lastError.message;

				// Check if circuit is now open
				const currentState = circuitBreaker.canAttempt();
				if (!currentState.allowed) {
					logError(`Connection circuit opened after ${attempt} attempts: ${currentState.reason}`);
					// Don't throw immediately - finish current retry loop but warn user
					if (taskId) {
						logWarn(`Task ${taskId} will be paused due to connection issues`);
					}
				}

				const delayMs = calculateDelay(
					retryDelay,
					attempt,
					lastError,
					exponentialBackoff,
					maxDelay,
					jitter,
				);

				logWarn(
					`Attempt ${attempt}/${maxRetries} failed: ${errorMsg}. Retrying in ${delayMs}ms...`,
				);
				onRetry?.(attempt, errorMsg, delayMs);

				await sleep(delayMs);

				// Re-check circuit state before next attempt
				const recheck = circuitBreaker.canAttempt();
				if (!recheck.allowed) {
					throw new Error(recheck.reason || "Connection circuit open - stopping retries");
				}
			}
		}
	}

	throw lastError || new Error("All retry attempts failed");
}

/**
 * Connection fallback options for graceful degradation
 */
export interface ConnectionFallbackOptions {
	/** Save task state when connection fails */
	saveState?: () => Promise<void>;
	/** Skip current task and continue with next */
	skipTask?: () => void;
	/** Pause execution and wait for manual intervention */
	pauseExecution?: () => void;
}

/**
 * Handle connection failure with graceful degradation
 * This is called when all retries are exhausted due to connection issues
 */
export async function handleConnectionFailure(
	taskId: string,
	error: Error,
	options?: ConnectionFallbackOptions,
): Promise<{ action: "retry" | "skip" | "pause" | "abort"; message: string }> {
	const state = circuitBreaker.getState();

	logError(`Connection failure for task ${taskId}: ${error.message}`);
	logError(`Circuit state: ${state.state}, Failures: ${state.consecutiveFailures}`);

	// If circuit is open, we should not retry immediately
	if (state.state === "OPEN") {
		const message = `Connection lost. Circuit breaker OPEN. ${state.consecutiveFailures} consecutive failures.\nWaiting ${30000 / 1000}s before next attempt.\nYou can:\n1. Wait for automatic retry\n2. Press Ctrl+C to stop and resume later\n3. Check your internet connection`;

		logWarn(message);

		// Try to save state if provided
		if (options?.saveState) {
			try {
				await options.saveState();
				logWarn("Task state saved for later resumption");
			} catch (saveError) {
				logError(`Failed to save task state: ${saveError}`);
			}
		}

		return { action: "pause", message };
	}

	// For other cases, return the error
	return {
		action: "abort",
		message: `Connection failure after maximum retries: ${error.message}`,
	};
}

/**
 * Wait for connection to be restored with timeout
 */
export async function waitForConnectionRestore(timeoutMs = 300000): Promise<boolean> {
	const checkInterval = 5000; // Check every 5 seconds
	const startTime = Date.now();

	logWarn("Waiting for connection to be restored...");

	while (Date.now() - startTime < timeoutMs) {
		const state = circuitBreaker.canAttempt();

		if (state.allowed) {
			logWarn("Connection restored - resuming execution");
			return true;
		}

		const elapsed = Math.floor((Date.now() - startTime) / 1000);
		const remaining = Math.floor((timeoutMs - (Date.now() - startTime)) / 1000);
		logWarn(
			`Still waiting for connection... (${elapsed}s elapsed, ${remaining}s timeout remaining)`,
		);

		await sleep(checkInterval);
	}

	logError("Connection restore timeout reached");
	return false;
}

/**
 * Re-export isRetryableError from utils/errors.ts for backward compatibility
 */
export { isRetryableError } from "../utils/errors.ts";

/**
 * Check if an error is fatal and should abort all remaining tasks.
 */
export function isFatalError(error: string): boolean {
	const fatalPatterns = [
		/not authenticated/i,
		/no authentication/i,
		/authentication failed/i,
		/invalid.*token/i,
		/invalid.*api.?key/i,
		/unauthorized/i,
		/\b401\b/i,
		/\b403\b/i,
		/command not found/i,
		/not installed/i,
		/is not recognized/i,
	];

	return fatalPatterns.some((pattern) => pattern.test(error));
}
