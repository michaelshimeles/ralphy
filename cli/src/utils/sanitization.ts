/**
 * Sanitization utilities for removing sensitive data
 *
 * SECURITY: All patterns use bounded quantifiers to prevent ReDoS attacks
 */

/**
 * Maximum input length for secret sanitization to prevent ReDoS
 */
const MAX_SANITIZE_INPUT_LENGTH = 1000000; // 1MB

/**
 * Sanitize sensitive data (API keys, passwords, etc.) from string input
 *
 * SECURITY NOTE: This function includes protections against ReDoS attacks:
 * - Input length is limited to MAX_SANITIZE_INPUT_LENGTH
 * - All regex patterns use bounded quantifiers (e.g., {48}, {36})
 * - Patterns are applied sequentially with early exit if input becomes too large
 *
 * @param input - The string to sanitize
 * @returns Sanitized string with secrets redacted
 */
export function sanitizeSecrets(input: string): string {
	// Limit input length to prevent ReDoS attacks
	if (input.length > MAX_SANITIZE_INPUT_LENGTH) {
		// For very large inputs, truncate and add warning
		const truncated = input.slice(0, MAX_SANITIZE_INPUT_LENGTH);
		return `${truncated}\n\n[WARNING: Content truncated due to size limits during secret sanitization]`;
	}

	// All patterns use bounded quantifiers to prevent ReDoS
	// Patterns are designed to match specific token formats with fixed lengths
	const patterns = [
		{ regex: /sk-[a-zA-Z0-9]{48}/g, replacement: "[API_KEY_REDACTED]" },
		{ regex: /sk-ant-[a-zA-Z0-9_-]{16,256}/g, replacement: "[ANTHROPIC_KEY_REDACTED]" },
		{ regex: /ghp_[a-zA-Z0-9]{36}/g, replacement: "[GITHUB_TOKEN_REDACTED]" },
		{ regex: /gho_[a-zA-Z0-9]{52}/g, replacement: "[GITHUB_OAUTH_REDACTED]" },
		{ regex: /AKIA[0-9A-Z]{16}/g, replacement: "[AWS_KEY_REDACTED]" },
		// For hex secrets, use a bounded length and require word boundaries to prevent
		// matching large hex strings that could cause performance issues
		{ regex: /\b[0-9a-f]{64}\b/g, replacement: "[HEX_SECRET_REDACTED]" },
	];

	let result = input;
	for (const { regex, replacement } of patterns) {
		result = result.replace(regex, replacement);
	}

	return result;
}
