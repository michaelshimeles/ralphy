import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { PROGRESS_FILE, RALPHY_DIR } from "../config/loader.ts";
import type { AIResult } from "../engines/types.ts";
import { createAgentWorktree } from "../git/worktree.ts";
import { logDebug } from "../ui/logger.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import {
	compareSnapshots,
	createDirectorySnapshot,
	createSelectiveSnapshot,
	getModifiedFiles,
	shouldIgnoreFile,
} from "./file-utils.ts";
import { isInRalphyDir, releaseLocksForFiles } from "./locking.ts";
import { type PlanningProgressEvent, planTaskFiles } from "./planning.ts";
import { buildExecutionPrompt } from "./prompt.ts";
import { isRetryableError, withRetry } from "./retry.ts";

export type { AgentRunnerOptions, ParallelAgentResult } from "./runner-types.ts";

import type { AgentRunnerOptions, ParallelAgentResult } from "./runner-types.ts";
import {
	copyBackPlannedFilesParallel,
	copyPlannedFilesIsolated,
	copySkillFolders,
	createSandbox,
	DEFAULT_SYMLINK_DIRS,
	SANDBOX_DIR_PREFIX,
	symlinkSharedResources,
	validatePath,
} from "./sandbox.ts";

// Add helper function at top of file
function getFilteredSymlinkDirs(noGitParallel: boolean): string[] {
	if (noGitParallel) {
		return DEFAULT_SYMLINK_DIRS.filter((dir) => dir !== ".git");
	}
	return DEFAULT_SYMLINK_DIRS;
}

/**
 * Common logic to run an agent in a specific directory
 */
async function runAgent(targetDir: string, options: AgentRunnerOptions): Promise<AIResult | null> {
	const {
		engine,
		prdFile,
		skipTests,
		skipLint,
		browserEnabled,
		engineArgs,
		maxRetries,
		retryDelay,
		debug,
		originalDir,
		task,
	} = options;

	// If planning model is provided, first determine which files are needed
	const filesToCopy = options.filesToCopy;
	if (options.planningModel && (!filesToCopy || filesToCopy.length === 0)) {
		// Signal planning phase
		StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "planning");

		// Create planning progress callback
		const onPlanningProgress = (event: PlanningProgressEvent) => {
			// Extract meaningful message from event for display
			let stepText = event.message;
			if (event.status === "thinking" && event.message) {
				stepText = `Thinking: ${event.message}`;
			} else if (!event.message) {
				stepText = event.status;
			}

			// Forward to main progress handler if available
			if (options.onProgress && stepText) {
				options.onProgress(stepText);
			}
		};

		const planningResult = await planTaskFiles(
			engine,
			task,
			originalDir,
			options.planningModel, // Use planningModel as modelOverride
			undefined, // maxReplans
			options.planningModel,
			undefined, // fullTasksContext
			debug,
			onPlanningProgress, // onProgress - NOW WITH CALLBACK!
			options.debugOpenCode,
			options.logThoughts,
			options.engineArgs,
		);

		if (planningResult.error) {
			logDebug(`Agent ${options.agentNum}: Planning failed: ${planningResult.error}`);
			// Signal failure if planning was required but failed
			StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "failed");
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: `Planning failed: ${planningResult.error}`,
			};
		}

		if (
			planningResult.files.length > 0 ||
			(planningResult.plan && planningResult.plan.length > 0)
		) {
			logDebug(
				`Agent ${options.agentNum}: Planning phase identified ${planningResult.files.length} files with ${planningResult.plan?.length || 0} steps`,
			);
			// Store planning results for execution phase
			options.planningAnalysis = planningResult.analysis;
			options.planningSteps = planningResult.plan;
			// Copy these files to the target directory if they aren't there already
			await copyPlannedFilesIsolated(originalDir, targetDir, planningResult.files);
			logDebug(
				`Agent ${options.agentNum}: Pre-copied ${planningResult.files.length} files based on plan`,
			);
		} else {
			logDebug(`Agent ${options.agentNum}: Planning returned no useful files or steps.`);
			// Optional: Fallback or warning
		}
	}

	// Build execution prompt
	const prompt = buildExecutionPrompt({
		task: task.title,
		progressFile: PROGRESS_FILE,
		prdFile,
		skipTests,
		skipLint,
		browserEnabled,
		allowCommit: false,
		planningAnalysis: options.planningAnalysis,
		planningSteps: options.planningSteps,
	});

	// Signal working phase
	StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "working");

	// Execute with retry
	const engineOptions = {
		...(options.modelOverride && { modelOverride: options.modelOverride }),
		...(engineArgs && engineArgs.length > 0 && { engineArgs }),
		...(options.env && { env: options.env }),
		...(options.debugOpenCode && { debugOpenCode: options.debugOpenCode }),
		...(options.logThoughts !== undefined && { logThoughts: options.logThoughts }),
		...(options.dryRun && { dryRun: options.dryRun }),
	};

	const result = await withRetry(
		async () => {
			let res: AIResult;
			if (options.onProgress && engine.executeStreaming) {
				res = await engine.executeStreaming(prompt, targetDir, options.onProgress, engineOptions);
			} else {
				res = await engine.execute(prompt, targetDir, engineOptions);
			}

			if (debug) {
				logDebug(`Agent ${options.agentNum}: Full AI Response:`, res.response);
				if (res.error) logDebug(`Agent ${options.agentNum}: Full AI Error:`, res.error);
			}
			if (!res.success && res.error && isRetryableError(res.error)) {
				throw new Error(res.error);
			}
			return res;
		},
		{ maxRetries, retryDelay },
	);

	// Update final status in UI
	if (result.success) {
		StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "completed");
	} else {
		StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "failed");
	}

	return result;
}

/**
 * Run a single agent in a lightweight sandbox
 */
export async function runAgentInSandbox(
	sandboxBase: string,
	options: AgentRunnerOptions,
): Promise<ParallelAgentResult> {
	const {
		agentNum,
		originalDir,
		prdSource,
		prdFile,
		prdIsFolder,
		task,
		filesToCopy,
		noGitParallel,
	} = options;
	const uniqueSuffix = Math.random().toString(36).substring(2, 8);
	const sandboxDir = join(
		sandboxBase,
		`${SANDBOX_DIR_PREFIX}${agentNum}-${Date.now()}-${uniqueSuffix}`,
	);

	try {
		mkdirSync(sandboxDir, { recursive: true });

		// If selective isolation is requested (filesToCopy provided)
		if (filesToCopy && Array.isArray(filesToCopy) && filesToCopy.length > 0) {
			// Copy skill folders and symlink shared resources
			copySkillFolders(originalDir, sandboxDir);
			symlinkSharedResources(originalDir, sandboxDir, getFilteredSymlinkDirs(!!noGitParallel));

			// Copy planned files into sandbox
			await copyPlannedFilesIsolated(originalDir, sandboxDir, filesToCopy);
			logDebug(
				`Agent ${agentNum}: Copied ${filesToCopy.length} planned files for selective isolation`,
			);

			// Snapshot before execution
			const beforeSnapshot = createSelectiveSnapshot(sandboxDir, filesToCopy);

			// Ensure .ralphy/ exists
			const ralphyDir = join(sandboxDir, RALPHY_DIR);
			if (!existsSync(ralphyDir)) mkdirSync(ralphyDir, { recursive: true });

			// Copy PRD resources
			copyPrdResources(originalDir, sandboxDir, prdSource, prdFile, prdIsFolder);

			// Run agent
			const result = await runAgent(sandboxDir, options);

			// Snapshot after execution and discover new files
			const afterSnapshot = createSelectiveSnapshot(sandboxDir, filesToCopy);
			const fullDirSnapshot = createDirectorySnapshot(sandboxDir);

			for (const [relPath, snap] of fullDirSnapshot) {
				if (!afterSnapshot.has(relPath) && !filesToCopy.includes(relPath)) {
					if (!shouldIgnoreFile(relPath, ["node_modules/**", ".git/**", ".ralphy/**"])) {
						afterSnapshot.set(relPath, snap);
					}
				}
			}

			const { modified, added } = compareSnapshots(beforeSnapshot, afterSnapshot);
			const allChanges = [...modified, ...added].filter(
				(file) => !isInRalphyDir(file) && normalize(file) !== normalize(prdFile),
			);

			if (allChanges.length > 0) {
				await copyBackPlannedFilesParallel(originalDir, sandboxDir, allChanges);
				logDebug(`Agent ${agentNum}: Copied back ${allChanges.length} modified/new files`);
			}

			// Release locks if they were held
			releaseLocksForFiles(filesToCopy, originalDir);

			return {
				task,
				agentNum,
				worktreeDir: sandboxDir,
				branchName: "",
				result,
				usedSandbox: true,
			};
		}

		// Traditional full isolation mode
		const sandboxResult = await createSandbox({
			originalDir,
			sandboxDir,
			agentNum,
			symlinkDirs: getFilteredSymlinkDirs(!!noGitParallel),
		});

		logDebug(
			`Agent ${agentNum}: Created full sandbox (${sandboxResult.symlinksCreated} symlinks, ${sandboxResult.filesCopied} copies)`,
		);

		// Copy PRD resources
		copyPrdResources(originalDir, sandboxDir, prdSource, prdFile, prdIsFolder);

		// Ensure .ralphy/ exists
		const ralphyDir = join(sandboxDir, RALPHY_DIR);
		if (!existsSync(ralphyDir)) mkdirSync(ralphyDir, { recursive: true });

		const result = await runAgent(sandboxDir, options);

		// NEW: Sync changes back to original directory
		try {
			const modifiedFiles = await getModifiedFiles(sandboxDir, originalDir);

			if (modifiedFiles.length > 0) {
				logDebug(`Agent ${agentNum}: Found ${modifiedFiles.length} modified files in sandbox`);

				for (const relPath of modifiedFiles) {
					// Validate path before copying
					const sandboxPath = validatePath(sandboxDir, relPath);
					const originalPath = validatePath(originalDir, relPath);

					if (!sandboxPath || !originalPath) {
						logDebug(`Security: Skipping invalid path: ${relPath}`);
						continue;
					}

					if (!existsSync(sandboxPath)) {
						logDebug(`File not found in sandbox: ${relPath}`);
						continue;
					}

					const parentDir = dirname(originalPath);
					if (!existsSync(parentDir)) {
						mkdirSync(parentDir, { recursive: true });
					}

					copyFileSync(sandboxPath, originalPath);
					logDebug(`Copied back modified file: ${relPath}`);
				}
			}
		} catch (error) {
			logDebug(`Agent ${agentNum}: Failed to sync changes: ${error}`);
			// Continue anyway - agent work might still be useful
		}

		return {
			task,
			agentNum,
			worktreeDir: sandboxDir,
			branchName: "",
			result,
			usedSandbox: true,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (filesToCopy) releaseLocksForFiles(filesToCopy, originalDir);

		// Enhanced error logging for planning issues
		if (errorMsg.includes("exitCode")) {
			logDebug(
				`Agent ${options.agentNum}: Planning execution error - possibly engine/API issue: ${errorMsg}`,
			);
			logDebug(`Check opencode CLI availability: 'opencode --help'`);
			logDebug(`Check model availability: 'opencode models'`);
			logDebug(`Check auth: 'opencode auth status'`);
		}

		return {
			task,
			agentNum,
			worktreeDir: sandboxDir,
			branchName: "",
			result: null,
			error: errorMsg,
			usedSandbox: true,
		};
	}
}

/**
 * Run a single agent in a git worktree
 */
export async function runAgentInWorktree(
	worktreeBase: string,
	baseBranch: string,
	options: AgentRunnerOptions,
): Promise<ParallelAgentResult> {
	const { agentNum, originalDir, prdSource, prdFile, prdIsFolder, task } = options;
	let worktreeDir = "";
	let branchName = "";

	try {
		// Create worktree
		const worktree = await createAgentWorktree(
			task.title,
			agentNum,
			baseBranch,
			worktreeBase,
			originalDir,
		);
		worktreeDir = worktree.worktreeDir;
		branchName = worktree.branchName;

		logDebug(`Agent ${agentNum}: Created worktree at ${worktreeDir}`);

		// Copy PRD file or folder to worktree
		copyPrdResources(originalDir, worktreeDir, prdSource, prdFile, prdIsFolder);

		// Ensure .ralphy/ exists in worktree
		const ralphyDir = join(worktreeDir, RALPHY_DIR);
		if (!existsSync(ralphyDir)) {
			mkdirSync(ralphyDir, { recursive: true });
		}

		const result = await runAgent(worktreeDir, options);

		return {
			task,
			agentNum,
			worktreeDir,
			branchName,
			result,
			usedSandbox: false,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return {
			task,
			agentNum,
			worktreeDir,
			branchName,
			result: null,
			error: errorMsg,
			usedSandbox: false,
		};
	}
}

function copyPrdResources(
	originalDir: string,
	targetDir: string,
	prdSource: string,
	prdFile: string,
	prdIsFolder: boolean,
) {
	if (prdSource === "markdown" || prdSource === "yaml") {
		const srcPath = join(originalDir, prdFile);
		const destPath = join(targetDir, prdFile);
		if (existsSync(srcPath)) {
			copyFileSync(srcPath, destPath);
		}
	} else if (prdSource === "markdown-folder" && prdIsFolder) {
		const srcPath = join(originalDir, prdFile);
		const destPath = join(targetDir, prdFile);
		if (existsSync(srcPath)) {
			cpSync(srcPath, destPath, { recursive: true });
		}
	}
}
