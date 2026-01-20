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
	never_touch: z.array(z.string()).default([]),
});

/**
 * Full Ralphy config schema
 */
export const RalphyConfigSchema = z.object({
	project: ProjectSchema.default({}),
	commands: CommandsSchema.default({}),
	rules: z.array(z.string()).default([]),
	boundaries: BoundariesSchema.default({}),
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
	prdSource: "markdown" | "yaml" | "github";
	/** PRD file path */
	prdFile: string;
	/** GitHub repo (owner/repo) */
	githubRepo: string;
	/** GitHub issue label filter */
	githubLabel: string;
	/** Auto-commit changes */
	autoCommit: boolean;
	/** Browser automation mode: 'auto' | 'true' | 'false' */
	browserEnabled: "auto" | "true" | "false";
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
	githubRepo: "",
	githubLabel: "",
	autoCommit: true,
	browserEnabled: "auto",
};
