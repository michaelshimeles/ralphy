import { logDebug, logWarn } from "../ui/logger.ts";

interface RetryOptions {
	maxRetries: number;
	retryDelay: number; // base delay in seconds
	onRetry?: (attempt: number, error?: string, nextDelayMs?: number) => void;
	/** Use exponential backoff (default: true) */
	exponentialBackoff?: boolean;
	/** Maximum delay in seconds (default: 60) */
	maxDelay?: number;
	/** Add random jitter to delay (default: true) */
	jitter?: boolean;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and optional jitter
 *
 * @param attempt - Current attempt number (1-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap in milliseconds
 * @param useJitter - Add random jitter (0-25% of delay)
 */
export function calculateBackoffDelay(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
	useJitter: boolean,
): number {
	// Exponential backoff: baseDelay * 2^(attempt-1)
	let delay = baseDelayMs * 2 ** (attempt - 1);

	// Cap at maximum delay
	delay = Math.min(delay, maxDelayMs);

	// Add jitter (0-25% of delay) to prevent thundering herd
	if (useJitter) {
		const jitter = delay * 0.25 * Math.random();
		delay += jitter;
	}

	return Math.floor(delay);
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * Features:
 * - Exponential backoff (2^attempt * baseDelay)
 * - Optional jitter to prevent thundering herd
 * - Configurable maximum delay cap
 * - Progress callbacks with next delay info
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
	const {
		maxRetries,
		retryDelay,
		onRetry,
		exponentialBackoff = true,
		maxDelay = 60,
		jitter = true,
	} = options;

	const baseDelayMs = retryDelay * 1000;
	const maxDelayMs = maxDelay * 1000;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt < maxRetries) {
				const errorMsg = lastError.message;

				// Calculate delay with exponential backoff
				const delayMs = exponentialBackoff
					? calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitter)
					: baseDelayMs;

				const delaySecs = (delayMs / 1000).toFixed(1);
				logWarn(`Attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);
				onRetry?.(attempt, errorMsg, delayMs);

				logDebug(`Waiting ${delaySecs}s before retry (exponential backoff)...`);
				await sleep(delayMs);
			}
		}
	}

	throw lastError || new Error("All retry attempts failed");
}

/**
 * Check if an error is retryable (e.g., rate limit, network error)
 */
export function isRetryableError(error: string): boolean {
	const retryablePatterns = [
		/rate limit/i,
		/rate_limit/i,
		/hit your limit/i,
		/quota/i,
		/too many requests/i,
		/429/,
		/timeout/i,
		/network/i,
		/connection/i,
		/ECONNRESET/,
		/ETIMEDOUT/,
		/ENOTFOUND/,
		/overloaded/i,
	];

	return retryablePatterns.some((pattern) => pattern.test(error));
}

/**
 * Check if an error is fatal and should abort all remaining tasks.
 * Fatal errors indicate a configuration or authentication problem that
 * will affect all subsequent tasks.
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
		/is not recognized/i, // Windows "command not recognized"
	];

	return fatalPatterns.some((pattern) => pattern.test(error));
}
