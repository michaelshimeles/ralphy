/**
 * Standardized error handling utilities for consistent error types across the codebase
 */

export class RalphyError extends Error {
	public readonly code: string;
	public readonly context?: Record<string, unknown>;

	constructor(message: string, code = "RALPHY_ERROR", context?: Record<string, unknown>) {
		super(message);
		this.name = "RalphyError";
		this.code = code;
		this.context = context;

		// Maintains proper stack trace for where our error was thrown (only available on V8)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, RalphyError);
		}
	}
}

export class ValidationError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "VALIDATION_ERROR", context);
		this.name = "ValidationError";
	}
}

export class TimeoutError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "TIMEOUT_ERROR", context);
		this.name = "TimeoutError";
	}
}

export class LockError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "LOCK_ERROR", context);
		this.name = "LockError";
	}
}

export class ProcessError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "PROCESS_ERROR", context);
		this.name = "ProcessError";
	}
}

export class SandboxError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "SANDBOX_ERROR", context);
		this.name = "SandboxError";
	}
}

/**
 * Convert any error to a standardized format
 */
export function standardizeError(error: unknown): RalphyError {
	if (error instanceof RalphyError) {
		return error;
	}

	if (error instanceof Error) {
		const withMetadata = error as Error & {
			code?: string;
			context?: Record<string, unknown>;
			cause?: unknown;
		};

		return new RalphyError(error.message, "UNKNOWN_ERROR", {
			originalName: error.name,
			originalStack: error.stack,
			...(withMetadata.code ? { originalCode: withMetadata.code } : {}),
			...(withMetadata.context ? { originalContext: withMetadata.context } : {}),
			...(withMetadata.cause ? { originalCause: String(withMetadata.cause) } : {}),
		});
	}

	if (typeof error === "string") {
		return new RalphyError(error, "STRING_ERROR");
	}

	return new RalphyError(String(error), "UNKNOWN_ERROR", { originalType: typeof error });
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	const standardized = standardizeError(error);

	const retryableCodes = ["TIMEOUT_ERROR", "LOCK_ERROR", "PROCESS_ERROR", "NETWORK_ERROR", "RATE_LIMIT_ERROR"];

	const retryableMessages = [
		"timeout",
		"connection refused",
		"network",
		"rate limit",
		"too many requests",
		"temporary failure",
		"try again",
		"locked",
		"conflict",
		"connection error",
		"unable to connect",
		"internet connection",
		"econnrefused",
		"econnreset",
		"socket hang up",
		"fetch failed",
	];

	const message = standardized.message.toLowerCase();

	// Check error code
	if (retryableCodes.includes(standardized.code)) {
		return true;
	}

	// Check error message
	return retryableMessages.some((pattern) => message.includes(pattern));
}

/**
 * Create error with context for logging
 */
export function createErrorWithContext(error: unknown, context: Record<string, unknown>): RalphyError {
	const standardized = standardizeError(error);

	if (standardized.context) {
		return new RalphyError(standardized.message, standardized.code, {
			...standardized.context,
			...context,
		});
	}

	return new RalphyError(standardized.message, standardized.code, context);
}
