import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { loadBoundaries, loadProjectContext, loadRules } from "../config/loader.ts";
import type { Task } from "../tasks/types.ts";
import { logDebug } from "../ui/logger.ts";
import { getBrowserInstructions, isBrowserAvailable } from "./browser.ts";
import { getSkillsAsCsv } from "./skill-compress.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

const RALPHY_PROTECTED_PATHS = [
	".ralphy/progress.txt",
	".ralphy-worktrees",
	".ralphy-sandboxes",
] as const;

const SKILL_DIRECTORIES = [".opencode/skills", ".claude/skills", ".skills"] as const;

const PLANNING_SECTIONS = [
	"<ANALYSIS>",
	" - Problem: [What is the actual problem being solved?]",
	" - Goal: [What is the desired end state?]",
	" - Complexity: [low/medium/high]",
	" - Risks: [Potential challenges or edge cases]",
	"</ANALYSIS>",
	"",
	"<PLAN>",
	"1. [Step 1: What to do first]",
	"2. [Step 2: Analysis or research needed]",
	"3. [Step 3: Implementation approach]",
	"4. [Step 4: Testing/validation]",
	"5. [Step 5: Final integration or cleanup]",
	"</PLAN>",
	"",
	"<FILES>",
	"path/to/file1.ext",
	"path/to/file2.ext",
	"...",
	"</FILES>",
	"",
	"<OPTIMIZATION>",
	" - Most efficient approach: [How to implement this optimally]",
	" - Key considerations: [Technical factors to remember]",
	" - Potential shortcuts: [Ways to accomplish this faster/better]",
	"</OPTIMIZATION>",
] as const;

// Default rules that should always be included
const DEFAULT_RULES = ["Keep changes focused and minimal. Do not refactor unrelated code."];

// =============================================================================
// TYPES
// =============================================================================

interface PromptOptions {
	task: string;
	autoCommit?: boolean;
	workDir?: string;
	browserEnabled?: "auto" | "true" | "false";
	skipTests?: boolean;
	skipLint?: boolean;
	prdFile?: string;
	progressFile?: string;
}

interface ParallelPromptOptions extends PromptOptions {
	allowCommit?: boolean;
	planningAnalysis?: string;
	planningSteps?: string[];
	enableOrchestrator?: boolean;
}

interface EnvironmentInfo {
	language?: string;
	framework?: string;
	buildTool?: string;
	testFramework?: string;
	projectType?: string;
	packageManager?: string;
}

// =============================================================================
// CACHE
// =============================================================================

const envCache = new Map<string, EnvironmentInfo>();

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

export function detectEnvironment(workDir: string): EnvironmentInfo {
	const cached = envCache.get(workDir);
	if (cached) return cached;

	const result: EnvironmentInfo = {};

	const packageJsonPath = join(workDir, "package.json");
	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
			Object.assign(result, extractEnvironmentInfo(pkg));
		} catch (error) {
			logDebug(`Failed to parse package.json: ${error}`);
		}
	}

	if (existsSync(join(workDir, "pyproject.toml"))) {
		result.language = "Python";
		result.buildTool = "setuptools/poetry";
		result.packageManager = "pip/poetry";
	} else if (existsSync(join(workDir, "go.mod"))) {
		result.language = "Go";
		result.packageManager = "go mod";
	} else if (existsSync(join(workDir, "Cargo.toml"))) {
		result.language = "Rust";
		result.packageManager = "cargo";
	}

	envCache.set(workDir, result);
	return result;
}

function extractEnvironmentInfo(pkg: {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
	private?: boolean;
	workspaces?: unknown;
	bin?: unknown;
	bun?: unknown;
	packageManager?: string;
}): Partial<EnvironmentInfo> {
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	const scripts = pkg.scripts || {};

	return {
		language: detectLanguage(deps, scripts),
		framework: detectFramework(pkg.dependencies || {}),
		buildTool: detectBuildTool(scripts),
		testFramework: detectTestFramework(deps, scripts),
		projectType: detectProjectType(pkg),
		packageManager: detectPackageManager(pkg),
	};
}

function detectLanguage(
	deps: Record<string, string>,
	scripts: Record<string, string>,
): string | undefined {
	if (deps.typescript || deps["@types/node"] || deps["@types/react"]) {
		return "TypeScript/JavaScript";
	}
	if (deps.react || deps.vue || deps.angular || deps.express || deps.fastify) {
		return "TypeScript/JavaScript";
	}
	const scriptText = Object.values(scripts).join(" ").toLowerCase();
	if (scriptText.includes("python") || scriptText.includes("pytest")) return "Python";
	return undefined;
}

function detectFramework(deps: Record<string, string>): string | undefined {
	if (deps.next) return "Next.js";
	if (deps.nuxt) return "Nuxt.js";
	if (deps["@remix-run/react"]) return "Remix";
	if (deps["@astrojs/astro"]) return "Astro";
	if (deps.react || deps["react-dom"]) return "React";
	if (deps.vue) return "Vue.js";
	if (deps.svelte) return "Svelte";
	if (deps.angular) return "Angular";
	if (deps.express) return "Express.js";
	if (deps.fastify) return "Fastify";
	return undefined;
}

function detectBuildTool(scripts: Record<string, string>): string | undefined {
	const buildScript = scripts.build?.toLowerCase() || "";
	if (scripts.vite || /\bvite\b/.test(buildScript)) return "Vite";
	if (scripts.webpack || /\bwebpack\b/.test(buildScript)) return "Webpack";
	if (scripts.rollup || /\brollup\b/.test(buildScript)) return "Rollup";
	if (scripts.esbuild || /\besbuild\b/.test(buildScript)) return "esbuild";
	if (/\bnext\b/.test(buildScript)) return "Next.js Build";
	if (/\bnuxt\b/.test(buildScript)) return "Nuxt.js Build";
	if (scripts.tsc || /\btsc\b/.test(buildScript)) return "TypeScript Compiler";
	if (/\bbun\b/.test(buildScript)) return "Bun";
	return undefined;
}

function detectTestFramework(
	deps: Record<string, string>,
	scripts: Record<string, string>,
): string | undefined {
	if (deps.vitest || scripts.test?.includes("vitest")) return "Vitest";
	if (deps.jest || scripts.test?.includes("jest")) return "Jest";
	if (deps.cypress) return "Cypress";
	if (deps["@playwright/test"]) return "Playwright";
	if (deps.pytest) return "Pytest";
	return undefined;
}

function detectProjectType(pkg: {
	private?: boolean;
	workspaces?: unknown;
	bin?: unknown;
}): string | undefined {
	if (pkg.private) return "Private Package";
	if (pkg.workspaces) return "Monorepo";
	if (pkg.bin) return "CLI Tool/Library";
	return undefined;
}

function detectPackageManager(pkg: { bun?: unknown; packageManager?: string }): string {
	if (pkg.bun) return "Bun";
	if (pkg.packageManager?.startsWith("pnpm")) return "pnpm";
	if (pkg.packageManager?.startsWith("yarn")) return "Yarn";
	return "npm";
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function detectSymlinks(workDir: string): string[] {
	if (!existsSync(workDir)) return [];

	let dirents: Dirent[];
	try {
		dirents = readdirSync(workDir, { withFileTypes: true }) as Dirent[];
	} catch {
		return [];
	}

	return dirents
		.filter((d) => {
			try {
				return lstatSync(join(workDir, d.name as string)).isSymbolicLink();
			} catch {
				return false;
			}
		})
		.map((d) => d.name as string);
}

function buildEnvironmentSection(workDir: string): string {
	const env = detectEnvironment(workDir);
	const lines: string[] = [];

	const envFields = [
		["Language", env.language],
		["Framework", env.framework],
		["Build Tool", env.buildTool],
		["Test Framework", env.testFramework],
		["Project Type", env.projectType],
		["Package Manager", env.packageManager],
	].filter(([, val]) => val) as [string, string][];

	if (envFields.length > 0) {
		lines.push("## Environment Detection", "");
		for (const [label, value] of envFields) {
			lines.push(`**${label}:** ${value}`);
		}
		lines.push(
			"",
			"Use this information to:",
			"- Choose appropriate build/test commands based on detected framework",
			"- Consider framework-specific patterns and best practices",
			"- Understand project structure and conventions",
			"",
		);
	}

	const symlinks = detectSymlinks(workDir);
	if (symlinks.length > 0) {
		lines.push(
			"## Symlink Analysis",
			"",
			`**Detected ${symlinks.length} symlink(s):**`,
			...symlinks.map((s) => `- ${s}`),
			"",
			"Note: Symlinks can affect file system operations and tool behavior.",
			"",
		);
	}

	return lines.join("\n");
}

function buildSkillsSection(workDir: string): string {
	const skillsCsv = getSkillsAsCsv(workDir);
	if (skillsCsv) {
		return `## Agent Skills
This repo includes compressed skill/playbook documentation for token efficiency:
${skillsCsv}

Before you start coding:
- Read and follow any relevant skill docs from compressed list above.
- If your engine supports a \`skill\` tool (e.g. OpenCode), use it to load relevant skills before implementing.
- If none apply, continue normally.`;
	}

	const skillRoots = SKILL_DIRECTORIES.map((dir) => join(workDir, dir)).filter(existsSync);
	if (skillRoots.length > 0) {
		return `## Agent Skills
This repo includes skill/playbook docs that describe preferred patterns, workflows, or tooling:
${skillRoots.map((p) => `- ${p}`).join("\n")}

Before you start coding:
- Read and follow any relevant skill docs from paths above.
- If your engine supports a \`skill\` tool (e.g. OpenCode), use it to load relevant skills before implementing.
- If none apply, continue normally.`;
	}

	return "";
}

function buildInstructions(options: {
	skipTests: boolean;
	skipLint: boolean;
	autoCommit: boolean;
	progressFile: string;
}): string[] {
	const { skipTests, skipLint, autoCommit, progressFile } = options;
	const instructions: string[] = [];
	let step = 1;

	instructions.push(`${step++}. Implement the task described above`);

	if (!skipTests) {
		instructions.push(`${step++}. Write tests for the feature`);
		instructions.push(`${step++}. Run tests and ensure they pass before proceeding`);
	}

	if (!skipLint) {
		instructions.push(`${step++}. Run linting and ensure it passes`);
	}

	instructions.push(`${step++}. Update ${progressFile} with what you did`);

	if (autoCommit) {
		instructions.push(`${step++}. Commit your changes with a descriptive message`);
	} else {
		instructions.push(`${step++}. Do NOT run git commit; changes will be collected automatically`);
	}

	return instructions;
}

function buildProtectedPathsWarning(prdFile?: string, boundaries: string[] = []): string {
	const systemPaths = [
		`- ${prdFile || "the PRD file"}`,
		...RALPHY_PROTECTED_PATHS.map((p) => `- ${p}`),
	];
	const userPaths = boundaries.map((b) => (b.startsWith("- ") ? b : `- ${b}`));
	return [...systemPaths, ...userPaths].join("\n");
}

// =============================================================================
// MAIN PROMPT BUILDERS
// =============================================================================

export function buildPrompt(options: PromptOptions): string {
	const {
		task,
		autoCommit = true,
		workDir = process.cwd(),
		browserEnabled = "auto",
		skipTests = false,
		skipLint = false,
		prdFile,
		progressFile = "progress.txt",
	} = options;

	const instructions = buildInstructions({ skipTests, skipLint, autoCommit, progressFile });
	const boundaries = loadBoundaries(workDir);
	const sections = [
		buildEnvironmentSection(workDir),
		buildContextSection(workDir),
		buildSkillsSection(workDir),
		isBrowserAvailable(browserEnabled) ? getBrowserInstructions() : "",
		`## Boundaries\nDo NOT modify these files/directories:\n${buildProtectedPathsWarning(prdFile, boundaries)}`,
		`## Task\n${task}`,
		`## Instructions\n${instructions.join("\n")}`,
	].filter(Boolean);

	return `You are working on a specific task. Focus ONLY on this task:

TASK: ${task}

${sections.join("\n\n")}

Protected paths are listed in the Boundaries section.
Do NOT Read, Glob, or Search inside .ralphy-sandboxes or .ralphy-worktrees.
Do NOT mark tasks complete - that will be handled separately.
Focus only on implementing: ${task}`;
}

function buildContextSection(workDir: string): string {
	const context = loadProjectContext(workDir);
	const rules = loadRules(workDir);

	const sections: string[] = [];
	if (context) sections.push(`## Project Context\n${context}`);

	// Always include rules section with default rules
	const allRules = [...DEFAULT_RULES, ...rules];
	sections.push(`## Rules (you MUST follow these)\n${allRules.join("\n")}`);

	// Boundaries are included in the protected paths warning section.

	return sections.join("\n\n");
}

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
		enableOrchestrator,
		workDir = process.cwd(),
	} = options;
	const instructions = buildInstructions({
		skipTests,
		skipLint,
		autoCommit: allowCommit,
		progressFile: progressFile || ".progress.json",
	});

	const context = loadProjectContext(workDir);
	const rules = loadRules(workDir);
	const boundaries = loadBoundaries(workDir);

	// Build sections in the order tests expect
	const sections: string[] = [];

	// Task at the top
	sections.push(`TASK: ${task}`);

	// Environment section
	const envSection = buildEnvironmentSection(workDir);
	if (envSection) sections.push(envSection);

	// Context section
	if (context) sections.push(`## Project Context\n${context}`);

	// Rules section with specific format for tests
	const allRules = [...DEFAULT_RULES, ...rules];
	sections.push(`Rules (you MUST follow these):\n${allRules.join("\n")}`);

	// Boundaries section with specific format for tests - system first, then user
	const systemBoundaries = [
		`- ${prdFile || "the PRD file"}`,
		"- .ralphy/progress.txt",
		"- .ralphy-worktrees",
		"- .ralphy-sandboxes",
	];
	const userBoundaries = boundaries.map((b) => (b.startsWith("- ") ? b : `- ${b}`));
	const allBoundaries = [...systemBoundaries, ...userBoundaries];
	sections.push(`Boundaries - Do NOT modify:\n${allBoundaries.join("\n")}`);

	// Planning section if provided
	if (planningAnalysis && planningSteps) {
		sections.push(buildPlanningSection(planningAnalysis, planningSteps));
	}

	// Skills section
	const skillsSection = buildSkillsSection(workDir);
	if (skillsSection) sections.push(skillsSection);

	// Browser instructions
	if (isBrowserAvailable(browserEnabled)) {
		sections.push(getBrowserInstructions());
	}

	// Instructions section with specific format for tests
	const instructionLines = instructions.map((line) =>
		line.replace("Implement the task described above", "Implement this specific task completely"),
	);
	sections.push(`Instructions:\n${instructionLines.join("\n")}`);

	// Orchestrator section if enabled
	if (enableOrchestrator) {
		sections.push(buildOrchestratorSection());
	}

	return `You are working on a specific task. Focus ONLY on this task:

${sections.join("\n\n")}

Do NOT mark tasks complete - that will be handled separately.
Focus only on implementing: ${task}`;
}

function buildPlanningSection(analysis: string, steps: string[]): string {
	return `## Planning Analysis (Completed Earlier)
${analysis}

## Planned Implementation Steps
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Follow these steps. If they don't apply to the current situation, explain why and propose an alternative approach.`;
}

function buildOrchestratorSection(): string {
	return `## Test Delegation (Orchestrator Mode Enabled)

You have access to a specialized test model. When you need tests run, use these markers:

### Quick Test Request
Use [RUN_TESTS] or [RUN_TESTS:command] to request tests:
- \`[RUN_TESTS]\` - Run default test command
- \`[RUN_TESTS:npm test]\` - Run specific command

### Detailed Test Request
For complex testing scenarios, use:
\`\`\`
[TEST_REQUEST]
command: npm test -- --grep "feature name"
files: src/feature.ts, tests/feature.test.ts
context: Brief context about what to test
[/TEST_REQUEST]
\`\`\`

### Completion
When done, signal completion with:
\`\`\`
[TEST_COMPLETE]
Your final summary here
[/TEST_COMPLETE]
\`\`\`

The test model will analyze results and return them to you. You can iterate: implement → request tests → review results → fix → request tests again.`;
}

export function buildPlanningPrompt(
	task: Task,
	fullTasksContext?: string,
	relevantFiles?: string[],
): string {
	const relevantFilesSection = relevantFiles?.length
		? `\nRELEVANT FILES (prioritize these in your analysis):\n${relevantFiles
				.slice(0, 30)
				.map((f) => `- ${f}`)
				.join("\n")}\n`
		: "";

	return `You are a senior engineering planner. Your job is to create a comprehensive plan for this task.

TASK: ${task.title || task.id}
${task.description ? `DESCRIPTION: ${task.description}` : ""}
${task.dependencies?.length ? `DEPENDENCIES: ${task.dependencies.join(", ")}` : ""}
${relevantFilesSection}

${fullTasksContext ? `FULL PROJECT TASKS CONTEXT:\n${fullTasksContext}\n\n` : ""}

First, analyze this task thoroughly and provide structured output in this format:

${PLANNING_SECTIONS.join("\n")}

IMPORTANT INSTRUCTIONS FOR PLANNING PHASE:
1. You may use read/glob/grep tools to EXPLORE the codebase and understand the task
2. DO NOT write, edit, create, or modify any files during planning
3. DO NOT execute any implementation - this is a planning-only phase
4. After exploring, return the structured plan above in your final response
5. Your entire response must contain the <ANALYSIS>, <PLAN>, <FILES>, and <OPTIMIZATION> tags
6. Return ONLY the planning analysis, not partial results from tool exploration

Think step by step, explaining your reasoning clearly. Use tools to explore the codebase before finalizing your plan.`;
}

// Backward compatibility
export function buildParallelPrompt(options: ParallelPromptOptions): string {
	const { planningAnalysis, planningSteps, ...rest } = options;

	if (planningAnalysis && planningSteps) {
		return buildExecutionPrompt({ ...rest, planningAnalysis, planningSteps });
	}

	return buildExecutionPrompt(rest);
}
