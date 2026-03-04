/**
 * Data Transformation Layer for Ralphy CLI
 *
 * Separates prompt building from execution logic with:
 * - Transform pipelines
 * - Data sanitization
 * - Context enrichment
 * - Format conversion
 */

import type { Task } from "../tasks/types.ts";
import { logDebugContext, logErrorContext } from "../ui/logger.ts";

/**
 * Context data for transformation
 */
export interface TransformContext {
	task: Task;
	workDir: string;
	engine: string;
	config?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Transformation result
 */
export interface TransformResult {
	/** Transformed data */
	data: string;
	/** Metadata about the transformation */
	metadata: {
		transformer: string;
		inputLength: number;
		outputLength: number;
		processingTimeMs: number;
	};
}

/**
 * Transformer function type
 */
export type Transformer = (input: string, context: TransformContext) => string;

/**
 * Transformer registration
 */
interface RegisteredTransformer {
	name: string;
	transformer: Transformer;
	priority: number;
}

/**
 * Data transformation pipeline
 */
export class TransformPipeline {
	private transformers: RegisteredTransformer[] = [];
	private enabled = true;

	/**
	 * Register a transformer
	 */
	register(name: string, transformer: Transformer, options?: { priority?: number }): () => void {
		const entry: RegisteredTransformer = {
			name,
			transformer,
			priority: options?.priority ?? 0,
		};

		this.transformers.push(entry);

		// Sort by priority (lower first)
		this.transformers.sort((a, b) => a.priority - b.priority);

		logDebugContext("TransformPipeline", `Registered transformer: ${name} (priority: ${entry.priority})`);

		// Return unregister function
		return () => {
			const index = this.transformers.findIndex((t) => t.name === name);
			if (index !== -1) {
				this.transformers.splice(index, 1);
				logDebugContext("TransformPipeline", `Unregistered transformer: ${name}`);
			}
		};
	}

	/**
	 * Execute the transformation pipeline
	 */
	async execute(input: string, context: TransformContext): Promise<TransformResult> {
		// Lazy-register built-in transformers to avoid circular dependency
		registerBuiltInTransformers();

		if (!this.enabled || this.transformers.length === 0) {
			return {
				data: input,
				metadata: {
					transformer: "passthrough",
					inputLength: input.length,
					outputLength: input.length,
					processingTimeMs: 0,
				},
			};
		}

		const startTime = Date.now();
		let result = input;
		const appliedTransformers: string[] = [];

		for (const entry of this.transformers) {
			try {
				result = await entry.transformer(result, context);
				appliedTransformers.push(entry.name);
			} catch (error) {
				logErrorContext("TransformPipeline", `Transformer ${entry.name} failed: ${error}`);
				// Continue with other transformers
			}
		}

		const processingTimeMs = Date.now() - startTime;

		logDebugContext("TransformPipeline", `Applied ${appliedTransformers.length} transformers in ${processingTimeMs}ms`);

		return {
			data: result,
			metadata: {
				transformer: appliedTransformers.join(","),
				inputLength: input.length,
				outputLength: result.length,
				processingTimeMs,
			},
		};
	}

	/**
	 * Enable/disable the pipeline
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		logDebugContext("TransformPipeline", `Pipeline ${enabled ? "enabled" : "disabled"}`);
	}

	/**
	 * Clear all transformers
	 */
	clear(): void {
		this.transformers = [];
		logDebugContext("TransformPipeline", "All transformers cleared");
	}

	/**
	 * Get registered transformer names
	 */
	getTransformerNames(): string[] {
		return this.transformers.map((t) => t.name);
	}
}

/**
 * Global transform pipeline instance
 */
let globalTransformPipeline: TransformPipeline = new TransformPipeline();

/**
 * Set global transform pipeline
 */
export function setTransformPipeline(pipeline: TransformPipeline): void {
	globalTransformPipeline = pipeline;
}

/**
 * Get global transform pipeline
 */
export function getTransformPipeline(): TransformPipeline {
	return globalTransformPipeline;
}

/**
 * Register a transformer (convenience function)
 */
export function registerTransformer(
	name: string,
	transformer: Transformer,
	options?: { priority?: number },
): () => void {
	return globalTransformPipeline.register(name, transformer, options);
}

/**
 * Execute transformation pipeline (convenience function)
 */
export async function transform(input: string, context: TransformContext): Promise<TransformResult> {
	return globalTransformPipeline.execute(input, context);
}

// ============== Built-in Transformers ==============

/**
 * Maximum input length for secret sanitization to prevent ReDoS
 */
const MAX_SANITIZE_INPUT_LENGTH = 1000000; // 1MB

/**
 * Sanitize sensitive data (API keys, passwords, etc.)
 *
 * SECURITY NOTE: This function includes protections against ReDoS attacks:
 * - Input length is limited to MAX_SANITIZE_INPUT_LENGTH
 * - All regex patterns use bounded quantifiers (e.g., {48}, {36})
 * - Patterns are applied sequentially with early exit if input becomes too large
 */
export const sanitizeSecretsTransformer: Transformer = (input) => {
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
};

/**
 * Truncate long content to fit within token limits
 */
export const truncateContentTransformer: Transformer = (input, context) => {
	const maxLength = (context.config?.maxPromptLength as number) || 50000;

	if (input.length <= maxLength) {
		return input;
	}

	// Smart truncation: try to break at a reasonable point
	const truncationPoint = input.lastIndexOf("\n\n", maxLength);
	const breakPoint = truncationPoint > maxLength * 0.8 ? truncationPoint : maxLength;

	return `${input.substring(0, breakPoint)}\n\n[Content truncated: ${input.length - breakPoint} characters omitted]`;
};

/**
 * Add metadata header to prompts
 */
export const addMetadataHeaderTransformer: Transformer = (input, context) => {
	const timestamp = new Date().toISOString();
	const header = `<!--
Task: ${context.task.title}
Engine: ${context.engine}
Timestamp: ${timestamp}
-->

`;
	return header + input;
};

/**
 * Normalize line endings
 */
export const normalizeLineEndingsTransformer: Transformer = (input) => {
	return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

/**
 * Remove excessive blank lines
 */
export const removeExcessiveWhitespaceTransformer: Transformer = (input) => {
	return input.replace(/\n{4,}/g, "\n\n\n");
};

/**
 * Format code blocks consistently
 */
export const formatCodeBlocksTransformer: Transformer = (input) => {
	// Ensure code blocks have language specifiers where detectable
	return input.replace(/```\n([\s\S]*?)```/g, (match, code) => {
		// Try to detect language from content
		let language = "";
		if (code.includes("import ") || code.includes("export ")) language = "typescript";
		else if (code.includes("function ") || code.includes("const ") || code.includes("let ")) language = "typescript";
		else if (code.includes("def ") || code.includes("import ")) language = "python";
		else if (code.includes("package ") || code.includes("import java.")) language = "java";

		if (language) {
			return `\`\`\`${language}\n${code}\`\`\``;
		}
		return match;
	});
};

/**
 * Strip HTML tags (for plain text output)
 */
export const stripHtmlTagsTransformer: Transformer = (input) => {
	return input.replace(/<[^>]*>/g, "");
};

/**
 * Enforce token limit estimate (rough approximation)
 */
export const enforceTokenLimitTransformer: Transformer = (input, context) => {
	const maxTokens = (context.config?.maxTokens as number) || 8000;
	// Rough estimate: 1 token ≈ 4 characters for English text
	const estimatedTokens = input.length / 4;

	if (estimatedTokens <= maxTokens) {
		return input;
	}

	const maxChars = maxTokens * 4;
	const truncationPoint = input.lastIndexOf("\n\n", maxChars * 0.9);
	const breakPoint = truncationPoint > maxChars * 0.7 ? truncationPoint : Math.floor(maxChars * 0.9);

	return `${input.substring(0, breakPoint)}\n\n[Token limit reached: ~${Math.floor(estimatedTokens)} tokens estimated, ${input.length - breakPoint} characters omitted]`;
};

/**
 * Add context from task configuration
 */
export const addTaskContextTransformer: Transformer = (input, context) => {
	// Get rules from task or config - safely access nested properties
	const taskWithContext = context.task as unknown as { context?: { rules?: string[] } };
	const rules = taskWithContext.context?.rules || [];
	if (rules.length === 0) {
		return input;
	}

	const rulesSection = `\n\n## Task Rules\n\n${rules.map((r: string) => `- ${r}`).join("\n")}`;
	return input + rulesSection;
};

// Register built-in transformers on module load
const BUILT_IN_TRANSFORMERS = [
	{ name: "sanitize-secrets", transformer: sanitizeSecretsTransformer, priority: -100 },
	{ name: "normalize-line-endings", transformer: normalizeLineEndingsTransformer, priority: -50 },
	{ name: "remove-excessive-whitespace", transformer: removeExcessiveWhitespaceTransformer, priority: -40 },
	{ name: "format-code-blocks", transformer: formatCodeBlocksTransformer, priority: -30 },
	{ name: "add-metadata-header", transformer: addMetadataHeaderTransformer, priority: 0 },
	{ name: "add-task-context", transformer: addTaskContextTransformer, priority: 10 },
	{ name: "truncate-content", transformer: truncateContentTransformer, priority: 90 },
	{ name: "enforce-token-limit", transformer: enforceTokenLimitTransformer, priority: 100 },
];

// Register built-in transformers lazily to avoid circular dependency issues
let transformersRegistered = false;
function registerBuiltInTransformers(): void {
	if (transformersRegistered) return;
	transformersRegistered = true;
	for (const { name, transformer, priority } of BUILT_IN_TRANSFORMERS) {
		globalTransformPipeline.register(name, transformer, { priority });
	}
}

// TransformPipeline is already exported above
