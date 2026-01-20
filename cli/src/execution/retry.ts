import { logDebug, logWarn } from "../ui/logger.ts";

interface RetryOptions {
	maxRetries: number;
	retryDelay: number; // in seconds
	onRetry?: (attempt: number, error: string) => void;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions
): Promise<T> {
	const { maxRetries, retryDelay, onRetry } = options;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt < maxRetries) {
				const errorMsg = lastError.message;
				logWarn(`Attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);
				onRetry?.(attempt, errorMsg);

				logDebug(`Waiting ${retryDelay}s before retry...`);
				await sleep(retryDelay * 1000);
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
