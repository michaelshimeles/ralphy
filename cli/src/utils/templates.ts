/**
 * Prompt Template System for Ralphy CLI
 *
 * Provides customizable prompt building with:
 * - Template variables
 * - Conditional sections
 * - Template inheritance
 * - Multiple output formats
 */

import { logDebugContext, logErrorContext } from "../ui/logger.ts";

const MAX_TEMPLATE_PATTERN_LENGTH = 200;
const MAX_TEMPLATE_VALUE_LENGTH = 2000;

function isUnsafeTemplateRegex(pattern: string): boolean {
	// Reject advanced features and nested quantifier forms that are common ReDoS vectors.
	if (/\\\d/.test(pattern)) return true;
	if (/\(\?(?:[:=!<])/.test(pattern)) return true;
	if (/\((?:[^()\\]|\\.)*[+*][^)]*\)[+*{]/.test(pattern)) return true;
	if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern)) return true;
	return false;
}

function hasOwnContextValue(context: TemplateContext, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(context, key);
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
	/** Variable name */
	name: string;
	/** Variable description */
	description: string;
	/** Default value */
	default?: string;
	/** Whether variable is required */
	required?: boolean;
	/** Validation regex pattern */
	pattern?: string;
}

/**
 * Template section
 */
export interface TemplateSection {
	/** Section name */
	name: string;
	/** Section content (can include variables) */
	content: string;
	/** Condition to include this section */
	condition?: string;
	/** Section priority (for ordering) */
	priority?: number;
}

/**
 * Prompt template definition
 */
export interface PromptTemplate {
	/** Template name */
	name: string;
	/** Template description */
	description: string;
	/** Template version */
	version: string;
	/** Variables used in template */
	variables: TemplateVariable[];
	/** Template sections */
	sections: TemplateSection[];
	/** Base template to extend (optional) */
	extends?: string;
	/** Output format */
	outputFormat?: "text" | "markdown" | "json";
}

/**
 * Template context with variable values
 */
export interface TemplateContext {
	[variableName: string]: string | number | boolean | string[];
}

/**
 * Rendered prompt result
 */
export interface RenderedPrompt {
	/** Rendered prompt text */
	prompt: string;
	/** Variables that were used */
	usedVariables: string[];
	/** Sections that were included */
	includedSections: string[];
	/** Template metadata */
	metadata: {
		templateName: string;
		version: string;
		renderedAt: string;
	};
}

/**
 * Template engine for building prompts
 */
export class TemplateEngine {
	private templates: Map<string, PromptTemplate> = new Map();
	private parentEngine?: TemplateEngine;

	constructor(parent?: TemplateEngine) {
		this.parentEngine = parent;
	}

	/**
	 * Register a template
	 */
	register(template: PromptTemplate): void {
		// Validate template
		this.validateTemplate(template);

		this.templates.set(template.name, template);
		logDebugContext("TemplateEngine", `Registered template: ${template.name} v${template.version}`);
	}

	/**
	 * Get a template by name
	 */
	getTemplate(name: string): PromptTemplate | undefined {
		return this.templates.get(name) || this.parentEngine?.getTemplate(name);
	}

	/**
	 * Check if template exists
	 */
	hasTemplate(name: string): boolean {
		return this.templates.has(name) || (this.parentEngine?.hasTemplate(name) ?? false);
	}

	/**
	 * Render a template with context
	 */
	render(templateName: string, context: TemplateContext): RenderedPrompt {
		const template = this.getTemplate(templateName);
		if (!template) {
			throw new Error(`Template not found: ${templateName}`);
		}

		// If template extends another, merge with parent
		let effectiveTemplate = template;
		if (template.extends) {
			const parentTemplate = this.getTemplate(template.extends);
			if (parentTemplate) {
				effectiveTemplate = this.mergeTemplates(parentTemplate, template);
			}
		}

		// Validate context
		this.validateContext(effectiveTemplate, context);

		// Render sections
		const includedSections: string[] = [];
		const renderedSections: string[] = [];

		// Sort sections by priority
		const sortedSections = [...effectiveTemplate.sections].sort(
			(a, b) => (a.priority ?? 0) - (b.priority ?? 0),
		);

		for (const section of sortedSections) {
			// Check condition
			if (section.condition && !this.evaluateCondition(section.condition, context)) {
				continue;
			}

			includedSections.push(section.name);

			// Render variables in section content
			let renderedContent = this.renderVariables(section.content, context);

			// Apply output format
			renderedContent = this.applyOutputFormat(renderedContent, effectiveTemplate.outputFormat);

			renderedSections.push(renderedContent);
		}

		const usedVariables = effectiveTemplate.variables.map((v) => v.name);

		return {
			prompt: renderedSections.join("\n\n"),
			usedVariables,
			includedSections,
			metadata: {
				templateName: template.name,
				version: template.version,
				renderedAt: new Date().toISOString(),
			},
		};
	}

	/**
	 * Render a template string directly with context
	 */
	renderString(templateString: string, context: TemplateContext): string {
		return this.renderVariables(templateString, context);
	}

	/**
	 * Get all registered template names
	 */
	getTemplateNames(): string[] {
		const names = Array.from(this.templates.keys());
		if (this.parentEngine) {
			const parentNames = this.parentEngine.getTemplateNames();
			return [...new Set([...names, ...parentNames])];
		}
		return names;
	}

	/**
	 * Unregister a template
	 */
	unregister(name: string): boolean {
		const deleted = this.templates.delete(name);
		if (deleted) {
			logDebugContext("TemplateEngine", `Unregistered template: ${name}`);
		}
		return deleted;
	}

	/**
	 * Clear all templates
	 */
	clear(): void {
		this.templates.clear();
		logDebugContext("TemplateEngine", "All templates cleared");
	}

	// Private helpers

	private validateTemplate(template: PromptTemplate): void {
		if (!template.name) {
			throw new Error("Template must have a name");
		}
		if (!template.sections || template.sections.length === 0) {
			throw new Error(`Template ${template.name} must have at least one section`);
		}

		// Check for duplicate variable names
		const varNames = new Set<string>();
		for (const variable of template.variables) {
			if (varNames.has(variable.name)) {
				throw new Error(`Duplicate variable name in template ${template.name}: ${variable.name}`);
			}
			varNames.add(variable.name);
		}

		// Validate variable references in sections
		for (const section of template.sections) {
			const varRefs = this.extractVariableReferences(section.content);
			for (const ref of varRefs) {
				if (!varNames.has(ref)) {
					logErrorContext(
						"TemplateEngine",
						`Template ${template.name} references undefined variable: ${ref}`,
					);
				}
			}
		}
	}

	private validateContext(template: PromptTemplate, context: TemplateContext): void {
		for (const variable of template.variables) {
			if (variable.required && !hasOwnContextValue(context, variable.name)) {
				throw new Error(
					`Missing required variable '${variable.name}' for template '${template.name}'`,
				);
			}

			if (variable.pattern && hasOwnContextValue(context, variable.name)) {
				const value = String(context[variable.name]);
				if (variable.pattern.length > MAX_TEMPLATE_PATTERN_LENGTH) {
					throw new Error(`Variable '${variable.name}' pattern is too long`);
				}
				if (isUnsafeTemplateRegex(variable.pattern)) {
					throw new Error(`Variable '${variable.name}' pattern uses unsafe regex constructs`);
				}
				if (value.length > MAX_TEMPLATE_VALUE_LENGTH) {
					throw new Error(`Variable '${variable.name}' value is too long for regex validation`);
				}
				let regex: RegExp;
				try {
					regex = new RegExp(variable.pattern);
				} catch {
					throw new Error(`Variable '${variable.name}' has invalid pattern '${variable.pattern}'`);
				}
				if (!regex.test(value)) {
					throw new Error(
						`Variable '${variable.name}' value '${value}' does not match pattern '${variable.pattern}'`,
					);
				}
			}
		}
	}

	private mergeTemplates(parent: PromptTemplate, child: PromptTemplate): PromptTemplate {
		// Merge sections (child overrides parent with same name)
		const parentSections = new Map(parent.sections.map((s) => [s.name, s]));
		const mergedSections: TemplateSection[] = [];

		for (const section of child.sections) {
			parentSections.set(section.name, section);
		}

		for (const section of parentSections.values()) {
			mergedSections.push(section);
		}

		// Merge variables (child overrides parent with same name)
		const parentVars = new Map(parent.variables.map((v) => [v.name, v]));
		for (const variable of child.variables) {
			parentVars.set(variable.name, variable);
		}

		return {
			name: child.name,
			description: child.description || parent.description,
			version: child.version,
			variables: Array.from(parentVars.values()),
			sections: mergedSections,
			outputFormat: child.outputFormat || parent.outputFormat,
		};
	}

	private extractVariableReferences(content: string): string[] {
		const regex = /\{\{(\w+)\}\}/g;
		const matches: string[] = [];
		let match: RegExpExecArray | null = null;

		while (true) {
			match = regex.exec(content);
			if (match === null) break;
			matches.push(match[1]);
		}

		return matches;
	}

	private renderVariables(content: string, context: TemplateContext): string {
		return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
			if (hasOwnContextValue(context, varName)) {
				const value = context[varName];
				if (Array.isArray(value)) {
					return value.join("\n");
				}
				return String(value);
			}
			return match; // Keep original if not found
		});
	}

	private evaluateCondition(condition: string, context: TemplateContext): boolean {
		// Simple condition evaluation
		// Supports: variable, !variable, variable=value, variable!=value
		const normalizedCondition = condition.trim();

		// Negation
		if (normalizedCondition.startsWith("!")) {
			const varName = normalizedCondition.slice(1);
			return hasOwnContextValue(context, varName) ? !context[varName] : true;
		}

		// Inequality check
		const neqMatch = normalizedCondition.match(/^(\w+)!=(.+)$/);
		if (neqMatch) {
			const [, varName, expectedValue] = neqMatch;
			if (!hasOwnContextValue(context, varName)) {
				return true;
			}
			return String(context[varName]) !== expectedValue;
		}

		// Equality check
		const eqMatch = normalizedCondition.match(/^(\w+)=(.+)$/);
		if (eqMatch) {
			const [, varName, expectedValue] = eqMatch;
			if (!hasOwnContextValue(context, varName)) {
				return false;
			}
			return String(context[varName]) === expectedValue;
		}

		// Simple truthy check
		return hasOwnContextValue(context, normalizedCondition) && !!context[normalizedCondition];
	}

	private applyOutputFormat(content: string, format?: string): string {
		switch (format) {
			case "markdown":
				// Ensure proper markdown formatting
				return content.trim();
			case "json":
				// Escape for JSON
				return JSON.stringify(content).slice(1, -1);
			default:
				return content;
		}
	}
}

/**
 * Global template engine instance
 */
let globalTemplateEngine: TemplateEngine = new TemplateEngine();

/**
 * Set global template engine
 */
export function setTemplateEngine(engine: TemplateEngine): void {
	globalTemplateEngine = engine;
}

/**
 * Get global template engine
 */
export function getTemplateEngine(): TemplateEngine {
	return globalTemplateEngine;
}

/**
 * Register a template (convenience function)
 */
export function registerTemplate(template: PromptTemplate): void {
	globalTemplateEngine.register(template);
}

/**
 * Render a template (convenience function)
 */
export function renderTemplate(templateName: string, context: TemplateContext): RenderedPrompt {
	return globalTemplateEngine.render(templateName, context);
}

/**
 * Built-in templates for common use cases
 */
export const builtInTemplates: PromptTemplate[] = [
	{
		name: "default-task",
		description: "Default template for task execution",
		version: "1.0.0",
		variables: [
			{ name: "task", description: "Task description", required: true },
			{ name: "project", description: "Project name", default: "unknown" },
			{ name: "language", description: "Programming language", default: "TypeScript" },
			{ name: "rules", description: "Additional rules", default: "" },
		],
		sections: [
			{
				name: "header",
				content: "# Task: {{task}}\n\nProject: {{project}}\nLanguage: {{language}}",
				priority: 0,
			},
			{
				name: "rules",
				content: "\n## Rules\n\n{{rules}}",
				condition: "rules",
				priority: 10,
			},
			{
				name: "instructions",
				content:
					"\n## Instructions\n\nPlease complete the above task following all specified rules.",
				priority: 100,
			},
		],
		outputFormat: "markdown",
	},
	{
		name: "code-review",
		description: "Template for code review tasks",
		version: "1.0.0",
		variables: [
			{ name: "file", description: "File to review", required: true },
			{ name: "content", description: "File content", required: true },
			{ name: "focus", description: "Review focus areas", default: "bugs,security,performance" },
		],
		sections: [
			{
				name: "header",
				content: "# Code Review: {{file}}\n\nFocus areas: {{focus}}",
				priority: 0,
			},
			{
				name: "code",
				content: "\n## Code\n\n```\n{{content}}\n```",
				priority: 10,
			},
			{
				name: "instructions",
				content:
					"\n## Instructions\n\nReview the code above focusing on the specified areas. Provide specific, actionable feedback.",
				priority: 100,
			},
		],
		outputFormat: "markdown",
	},
];

// Register built-in templates on module load
for (const template of builtInTemplates) {
	globalTemplateEngine.register(template);
}

// TemplateEngine is already exported above
