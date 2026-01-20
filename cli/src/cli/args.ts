import { Command } from "commander";
import type { RuntimeOptions } from "../config/types.ts";

const VERSION = "4.0.0";

/**
 * Create the CLI program with all options
 */
export function createProgram(): Command {
	const program = new Command();

	program
		.name("ralphy")
		.description("Autonomous AI Coding Loop - Supports Claude Code, OpenCode, Codex, Cursor, Qwen-Code and Factory Droid")
		.version(VERSION)
		.argument("[task]", "Single task to execute (brownfield mode)")
		.option("--init", "Initialize .ralphy/ configuration")
		.option("--config", "Show current configuration")
		.option("--add-rule <rule>", "Add a rule to config")
		.option("--no-tests, --skip-tests", "Skip running tests")
		.option("--no-lint, --skip-lint", "Skip running lint")
		.option("--fast", "Skip both tests and lint")
		.option("--claude", "Use Claude Code (default)")
		.option("--opencode", "Use OpenCode")
		.option("--cursor", "Use Cursor Agent")
		.option("--codex", "Use Codex")
		.option("--qwen", "Use Qwen-Code")
		.option("--droid", "Use Factory Droid")
		.option("--dry-run", "Show what would be done without executing")
		.option("--max-iterations <n>", "Maximum iterations (0 = unlimited)", "0")
		.option("--max-retries <n>", "Maximum retries per task", "3")
		.option("--retry-delay <n>", "Delay between retries in seconds", "5")
		.option("--parallel", "Run tasks in parallel using worktrees")
		.option("--max-parallel <n>", "Maximum parallel agents", "3")
		.option("--branch-per-task", "Create a branch for each task")
		.option("--base-branch <branch>", "Base branch for PRs")
		.option("--create-pr", "Create pull request after each task")
		.option("--draft-pr", "Create PRs as draft")
		.option("--prd <file>", "PRD file (markdown)", "PRD.md")
		.option("--yaml <file>", "YAML task file")
		.option("--github <repo>", "GitHub repo for issues (owner/repo)")
		.option("--github-label <label>", "Filter GitHub issues by label")
		.option("--no-commit", "Don't auto-commit changes")
		.option("--browser", "Enable browser automation (agent-browser)")
		.option("--no-browser", "Disable browser automation")
		.option("-v, --verbose", "Verbose output");

	return program;
}

/**
 * Parse command line arguments into RuntimeOptions
 */
export function parseArgs(args: string[]): {
	options: RuntimeOptions;
	task: string | undefined;
	initMode: boolean;
	showConfig: boolean;
	addRule: string | undefined;
} {
	const program = createProgram();
	program.parse(args);

	const opts = program.opts();
	const [task] = program.args;

	// Determine AI engine
	let aiEngine = "claude";
	if (opts.opencode) aiEngine = "opencode";
	else if (opts.cursor) aiEngine = "cursor";
	else if (opts.codex) aiEngine = "codex";
	else if (opts.qwen) aiEngine = "qwen";
	else if (opts.droid) aiEngine = "droid";

	// Determine PRD source
	let prdSource: "markdown" | "yaml" | "github" = "markdown";
	let prdFile = opts.prd || "PRD.md";

	if (opts.yaml) {
		prdSource = "yaml";
		prdFile = opts.yaml;
	} else if (opts.github) {
		prdSource = "github";
	}

	// Handle --fast
	const skipTests = opts.fast || opts.skipTests || !opts.tests;
	const skipLint = opts.fast || opts.skipLint || !opts.lint;

	const options: RuntimeOptions = {
		skipTests,
		skipLint,
		aiEngine,
		dryRun: opts.dryRun || false,
		maxIterations: parseInt(opts.maxIterations, 10) || 0,
		maxRetries: parseInt(opts.maxRetries, 10) || 3,
		retryDelay: parseInt(opts.retryDelay, 10) || 5,
		verbose: opts.verbose || false,
		branchPerTask: opts.branchPerTask || false,
		baseBranch: opts.baseBranch || "",
		createPr: opts.createPr || false,
		draftPr: opts.draftPr || false,
		parallel: opts.parallel || false,
		maxParallel: parseInt(opts.maxParallel, 10) || 3,
		prdSource,
		prdFile,
		githubRepo: opts.github || "",
		githubLabel: opts.githubLabel || "",
		autoCommit: opts.commit !== false,
		browserEnabled: opts.browser === true ? "true" : opts.browser === false ? "false" : "auto",
	};

	return {
		options,
		task,
		initMode: opts.init || false,
		showConfig: opts.config || false,
		addRule: opts.addRule,
	};
}

/**
 * Print version
 */
export function printVersion(): void {
	console.log(`ralphy v${VERSION}`);
}

/**
 * Print help
 */
export function printHelp(): void {
	const program = createProgram();
	program.outputHelp();
}
