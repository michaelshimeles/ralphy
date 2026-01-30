import { z } from "zod";

/**
 * Project info schema
 */
export const ProjectSchema = z.object({
	name: z.string().default(""),
	language: z.string().default(""),
	framework: z.string().default(""),
	description: z.string().default(""),
});

/**
 * Lock configuration schema
 */
export const LockConfigSchema = z.object({
	timeout: z.number().default(30000).optional(),
	maxLocks: z.number().default(5000).optional(),
	cleanupInterval: z.number().default(60000).optional(),
});

/**
 * Notifications schema for webhook configuration
 */
export const NotificationsSchema = z.object({
	discord_webhook: z.string().default(""),
	slack_webhook: z.string().default(""),
	custom_webhook: z.string().default(""),
});

/**
 * Commands schema
 */
export const CommandsSchema = z.object({
	test: z.string().default(""),
	lint: z.string().default(""),
	build: z.string().default(""),
});

/**
 * Boundaries schema
 */
export const BoundariesSchema = z.object({
	never_touch: z
		.array(z.string())
		.nullable()
		.transform((v) => v ?? [])
		.default([]),
});

/**
 * Full Ralphy config schema
 */
export const RalphyConfigSchema = z.object({
	project: ProjectSchema.default({}),
	commands: CommandsSchema.default({}),
	rules: z
		.array(z.string())
		.nullable()
		.transform((v) => v ?? [])
		.default([]),
	boundaries: BoundariesSchema.default({}),
	notifications: NotificationsSchema.default({}),
	lockConfig: LockConfigSchema.default({}).optional(),
});

/**
 * Ralphy configuration from .ralphy/config.yaml
 */
export type RalphyConfig = z.infer<typeof RalphyConfigSchema>;

/**
 * Runtime options parsed from CLI args
 */
export interface RuntimeOptions {
	/** Skip running tests */
	skipTests: boolean;
	/** Skip running lint */
	skipLint: boolean;
	/** AI engine to use */
	aiEngine: string;
	/** Dry run mode (don't execute) */
	dryRun: boolean;
	/** Maximum iterations (0 = unlimited) */
	maxIterations: number;
	/** Maximum retries per task */
	maxRetries: number;
	/** Delay between retries in seconds */
	retryDelay: number;
	/** Verbose output */
	verbose: boolean;
	/** Create branch per task */
	branchPerTask: boolean;
	/** Base branch for PRs */
	baseBranch: string;
	/** Create PR after task */
	createPr: boolean;
	/** Create draft PR */
	draftPr: boolean;
	/** Run tasks in parallel */
	parallel: boolean;
	/** Maximum parallel agents */
	maxParallel: number;
	/** PRD source type */
	prdSource: "markdown" | "markdown-folder" | "yaml" | "csv" | "github";
	/** PRD file or folder path */
	prdFile: string;
	/** Whether PRD path is a folder */
	prdIsFolder: boolean;
	/** GitHub repo (owner/repo) */
	githubRepo: string;
	/** GitHub issue label filter */
	githubLabel: string;
	/** Auto-commit changes */
	autoCommit: boolean;
	/** Browser automation mode: 'auto' | 'true' | 'false' */
	browserEnabled: "auto" | "true" | "false";
	/** Override default model for engine */
	modelOverride?: string;
	/** Separate model for planning phase (cheaper/faster) */
	planningModel?: string;
	/** Skip automatic branch merging after parallel execution */
	skipMerge?: boolean;
	/** Force non-git parallel execution (sandboxes) even in git repos */
	noGitParallel?: boolean;
	/** Log AI thoughts/reasoning to console */
	logThoughts?: boolean;
	/** Enable full debug logging (cli errors, full ai responses) */
	debug?: boolean;
	/** Enable comprehensive OpenCode debugging with raw output, steps, and parsing */
	debugOpenCode?: boolean;
	/** Use lightweight sandboxes instead of git worktrees for parallel execution */
	useSandbox?: boolean;
	/** Additional arguments to pass to engine CLI */
	engineArgs?: string[];
	/** Lock configuration options */
	lockConfig?: {
		/** Lock timeout in milliseconds */
		timeout?: number;
		/** Maximum number of locks */
		maxLocks?: number;
		/** Cleanup interval in milliseconds */
		cleanupInterval?: number;
	};
}

/**
 * Default runtime options
 */
export const DEFAULT_OPTIONS: RuntimeOptions = {
	skipTests: false,
	skipLint: false,
	aiEngine: "claude",
	dryRun: false,
	maxIterations: 0,
	maxRetries: 3,
	retryDelay: 5,
	verbose: false,
	branchPerTask: false,
	baseBranch: "",
	createPr: false,
	draftPr: false,
	parallel: false,
	maxParallel: 3,
	prdSource: "markdown",
	prdFile: "PRD.md",
	prdIsFolder: false,
	githubRepo: "",
	githubLabel: "",
	autoCommit: true,
	browserEnabled: "auto",
	noGitParallel: false,
	logThoughts: true,
	debug: false,
	debugOpenCode: false,
};
