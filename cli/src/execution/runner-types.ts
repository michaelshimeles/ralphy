import type { AIEngine, AIResult } from "../engines/types.ts";
import type { Task } from "../tasks/types.ts";

export interface AgentRunnerOptions {
	engine: AIEngine;
	task: Task;
	agentNum: number;
	originalDir: string;
	prdSource: string;
	prdFile: string;
	prdIsFolder: boolean;
	maxRetries: number;
	retryDelay: number;
	skipTests: boolean;
	skipLint: boolean;
	browserEnabled: "auto" | "true" | "false";
	modelOverride?: string;
	planningModel?: string;
	testModel?: string;
	planningAnalysis?: string;
	planningSteps?: string[];
	engineArgs?: string[];
	env?: Record<string, string>;
	debug?: boolean;
	debugOpenCode?: boolean;
	/** Allow OpenCode to access sandbox directories without permission prompts (default: true) */
	allowOpenCodeSandboxAccess?: boolean;
	logThoughts?: boolean;
	onProgress?: (step: string) => void;
	dryRun?: boolean;
	/** Files to specifically copy into the isolation directory (for planning-based mode) */
	filesToCopy?: string[];
	/** Skip git parallel execution (don't symlink .git in sandboxes) */
	noGitParallel?: boolean;
	/** Use semantic chunking to select relevant files (default: true) */
	useSemanticChunking?: boolean;
}

export interface ParallelAgentResult {
	task: Task;
	agentNum: number;
	worktreeDir: string;
	branchName: string;
	result: AIResult | null;
	error?: string;
	/** Whether this agent used sandbox mode */
	usedSandbox?: boolean;
	/** Optional performance metrics */
	metrics?: {
		inputTokens: number;
		outputTokens: number;
		durationMs: number;
	};
}
