import { loadBoundaries, loadProjectContext, loadRules } from "../config/loader.ts";
import { getBrowserInstructions, isBrowserAvailable } from "./browser.ts";

interface PromptOptions {
	task: string;
	autoCommit?: boolean;
	workDir?: string;
	browserEnabled?: "auto" | "true" | "false";
	skipTests?: boolean;
	skipLint?: boolean;
}

/**
 * Build the full prompt with project context, rules, boundaries, and task
 */
export function buildPrompt(options: PromptOptions): string {
	const { task, autoCommit = true, workDir = process.cwd(), browserEnabled = "auto", skipTests = false, skipLint = false } = options;

	const parts: string[] = [];

	// Add project context if available
	const context = loadProjectContext(workDir);
	if (context) {
		parts.push(`## Project Context\n${context}`);
	}

	// Add rules if available
	const rules = loadRules(workDir);
	if (rules.length > 0) {
		parts.push(`## Rules (you MUST follow these)\n${rules.join("\n")}`);
	}

	// Add boundaries
	const boundaries = loadBoundaries(workDir);
	if (boundaries.length > 0) {
		parts.push(`## Boundaries\nDo NOT modify these files/directories:\n${boundaries.join("\n")}`);
	}

	// Add browser instructions if available
	if (isBrowserAvailable(browserEnabled)) {
		parts.push(getBrowserInstructions());
	}

	// Add the task
	parts.push(`## Task\n${task}`);

	// Add instructions
	const instructions = ["1. Implement the task described above"];

	let step = 2;
	if (!skipTests) {
		instructions.push(`${step}. Write tests for the feature`);
		step++;
		instructions.push(`${step}. Run tests and ensure they pass before proceeding`);
		step++;
	}

	if (!skipLint) {
		instructions.push(`${step}. Run linting and ensure it passes`);
		step++;
	}

	instructions.push(`${step}. Ensure the code works correctly`);
	step++;

	if (autoCommit) {
		instructions.push(`${step}. Commit your changes with a descriptive message`);
	}

	parts.push(`## Instructions\n${instructions.join("\n")}`);

	// Add final note
	parts.push("Keep changes focused and minimal. Do not refactor unrelated code.");

	return parts.join("\n\n");
}

interface ParallelPromptOptions {
	task: string;
	progressFile: string;
	skipTests?: boolean;
	skipLint?: boolean;
	browserEnabled?: "auto" | "true" | "false";
}

/**
 * Build a prompt for parallel agent execution
 */
export function buildParallelPrompt(options: ParallelPromptOptions): string {
	const { task, progressFile, skipTests = false, skipLint = false, browserEnabled = "auto" } = options;

	const browserSection = isBrowserAvailable(browserEnabled) ? `\n\n${getBrowserInstructions()}` : "";

	const instructions = ["1. Implement this specific task completely"];

	let step = 2;
	if (!skipTests) {
		instructions.push(`${step}. Write tests for the feature`);
		step++;
		instructions.push(`${step}. Run tests and ensure they pass before proceeding`);
		step++;
	}

	if (!skipLint) {
		instructions.push(`${step}. Run linting and ensure it passes`);
		step++;
	}

	instructions.push(`${step}. Update ${progressFile} with what you did`);
	step++;
	instructions.push(`${step}. Commit your changes with a descriptive message`);

	return `You are working on a specific task. Focus ONLY on this task:

TASK: ${task}${browserSection}

Instructions:
${instructions.join("\n")}

Do NOT modify PRD.md or mark tasks complete - that will be handled separately.
Focus only on implementing: ${task}`;
}
