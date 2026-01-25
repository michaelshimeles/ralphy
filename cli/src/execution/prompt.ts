import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadBoundaries, loadProjectContext, loadRules } from "../config/loader.ts";
import type { Task } from "../tasks/types.ts";
import { getBrowserInstructions, isBrowserAvailable } from "./browser.ts";
import { getSkillsAsCsv } from "./skill-compress.ts";

interface PromptOptions {
	task: string;
	autoCommit?: boolean;
	workDir?: string;
	browserEnabled?: "auto" | "true" | "false";
	skipTests?: boolean;
	skipLint?: boolean;
	prdFile?: string;
}

/**
 * Detect skill/playbook directories that can guide to agent.
 * We keep this engine-agnostic: OpenCode can load skills via `skill` tool,
 * other engines can still read these docs as repo guidance.
 */
function detectAgentSkills(workDir: string): string[] {
	const candidates = [
		join(workDir, ".opencode", "skills"),
		join(workDir, ".claude", "skills"),
		join(workDir, ".skills"),
	];

	return candidates.filter((p) => existsSync(p));
}

/**
 * Build full prompt with project context, rules, boundaries, and task
 */
export function buildPrompt(options: PromptOptions): string {
	const {
		task,
		autoCommit = true,
		workDir = process.cwd(),
		browserEnabled = "auto",
		skipTests = false,
		skipLint = false,
		prdFile,
	} = options;

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

	// Agent skills/playbooks (optional)
	const skillsCsv = getSkillsAsCsv(workDir);
	if (skillsCsv) {
		parts.push(
			[
				"## Agent Skills",
				"This repo includes compressed skill/playbook documentation for token efficiency:",
				skillsCsv,
				"",
				"Before you start coding:",
				"- Read and follow any relevant skill docs from the compressed list above.",
				"- If your engine supports a `skill` tool (e.g. OpenCode), use it to load relevant skills before implementing.",
				"- If none apply, continue normally.",
			].join("\n"),
		);
	} else {
		const skillRoots = detectAgentSkills(workDir);
		if (skillRoots.length > 0) {
			parts.push(
				[
					"## Agent Skills",
					"This repo includes skill/playbook docs that describe preferred patterns, workflows, or tooling:",
					...skillRoots.map((p) => `- ${p}`),
					"",
					"Before you start coding:",
					"- Read and follow any relevant skill docs from the paths above.",
					"- If your engine supports a `skill` tool (e.g. OpenCode), use it to load relevant skills before implementing.",
					"- If none apply, continue normally.",
				].join("\n"),
			);
		}
	}

	// Add browser instructions if available
	if (isBrowserAvailable(browserEnabled)) {
		parts.push(getBrowserInstructions());
	}

	// Add task
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

	instructions.push(`${step}. Update progress.txt with what you did`);
	step++;
	if (autoCommit) {
		instructions.push(`${step}. Commit your changes with a descriptive message`);
	} else {
		instructions.push(`${step}. Do NOT run git commit; changes will be collected automatically`);
	}

	return `You are working on a specific task. Focus ONLY on this task:

TASK: ${task}

## Instructions
${instructions.join("\n")}

${prdFile ? `Do NOT modify ${prdFile}.` : "Do NOT modify the PRD file."}
Do NOT modify .ralphy/progress.txt, .ralphy-worktrees, or .ralphy-sandboxes.
Do NOT mark tasks complete - that will be handled separately.
Focus only on implementing: ${task}`;
}

export function buildPlanningPrompt(
	task: Task,
	_autoCommit?: boolean,
	fullTasksContext?: string,
): string {
	const prompt = `You are a senior engineering planner. Your job is to create a comprehensive plan for this task.

TASK: ${task.title || task.id}
${task.description ? `DESCRIPTION: ${task.description}` : ""}
${task.dependencies && task.dependencies.length > 0 ? `DEPENDENCIES: ${task.dependencies.join(", ")}` : ""}

${fullTasksContext ? `FULL PROJECT TASKS CONTEXT:\n${fullTasksContext}\n\n` : ""}

First, analyze this task thoroughly and provide structured output in this format:

<ANALYSIS>
- Problem: [What is the actual problem being solved?]
- Goal: [What is the desired end state?]
- Complexity: [low/medium/high]
- Risks: [Potential challenges or edge cases]
</ANALYSIS>

<PLAN>
1. [Step 1: What to do first]
2. [Step 2: Analysis or research needed]
3. [Step 3: Implementation approach]
4. [Step 4: Testing/validation]
5. [Step 5: Final integration or cleanup]
</PLAN>

<FILES>
path/to/file1.ext
path/to/file2.ext
...
</FILES>

<OPTIMIZATION>
- Most efficient approach: [How to implement this optimally]
- Key considerations: [Technical factors to remember]
- Potential shortcuts: [Ways to accomplish this faster/better]
</OPTIMIZATION>

Think step by step, explaining your reasoning clearly. Use tools to explore the codebase before finalizing your plan.`;

	return prompt;
}

interface ParallelPromptOptions {
	task: string;
	progressFile: string;
	prdFile?: string;
	skipTests?: boolean;
	skipLint?: boolean;
	browserEnabled?: "auto" | "true" | "false";
	allowCommit?: boolean;
	planningAnalysis?: string;
	planningSteps?: string[];
}

/**
 * Build a prompt for parallel agent execution
 */
export function buildExecutionPrompt(options: ParallelPromptOptions): string {
	const {
		task,
		progressFile,
		prdFile,
		skipTests = false,
		skipLint = false,
		browserEnabled = "auto",
		allowCommit = true,
		planningAnalysis,
		planningSteps,
	} = options;

	// Add planning context if available
	const planningSection =
		planningAnalysis && planningSteps
			? `
## Planning Analysis (Completed Earlier)
${planningAnalysis}

## Planned Implementation Steps
${planningSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Follow these steps. If they don't apply to the current situation, explain why and propose an alternative approach.
`
			: "";

	const browserSection = isBrowserAvailable(browserEnabled)
		? `\n\n${getBrowserInstructions()}`
		: "";

	// Parallel execution typically runs in a worktree; we still try to detect skills from CWD.
	// If callers pass a workDir in the future, prefer that instead.
	const skillsCsv = getSkillsAsCsv(process.cwd());
	const skillsSection = skillsCsv
		? `\n\nAgent Skills (Compressed for token efficiency):\n${skillsCsv}\nBefore coding, read relevant skills. If your engine supports a \`skill\` tool, load them before implementing.`
		: (() => {
				const skillRoots = detectAgentSkills(process.cwd());
				return skillRoots.length > 0
					? `\n\nAgent Skills:\nThis repo includes skill/playbook docs:\n${skillRoots
							.map((p) => `- ${p}`)
							.join(
								"\n",
							)}\nBefore coding, read relevant skills. If your engine supports a \`skill\` tool, load them before implementing.`
					: "";
			})();

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
	if (allowCommit) {
		instructions.push(`${step}. Commit your changes with a descriptive message`);
	} else {
		instructions.push(`${step}. Do NOT run git commit; changes will be collected automatically`);
	}

	return `You are working on a specific task. Focus ONLY on this task:

${planningSection}
## Task
${task}${browserSection}${skillsSection}

## Instructions
${instructions.join("\n")}

${prdFile ? `Do NOT modify ${prdFile}.` : "Do NOT modify the PRD file."}
Do NOT modify .ralphy/progress.txt, .ralphy-worktrees, or .ralphy-sandboxes.
Do NOT mark tasks complete - that will be handled separately.
Focus only on implementing: ${task}`;
}

/**
 * Build a prompt for parallel agent execution (backward compatibility)
 */
export function buildParallelPrompt(options: ParallelPromptOptions): string {
	// Extract planning context if provided
	// biome-ignore lint/suspicious/noExplicitAny: Temporary cast for flexible options
	const { planningAnalysis, planningSteps, ...otherOptions } = options as any;

	if (planningAnalysis && planningSteps) {
		return buildExecutionPrompt({
			...otherOptions,
			planningAnalysis,
			planningSteps,
		});
	}

	// Fallback to original behavior
	return buildExecutionPrompt(otherOptions);
}
