import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { PROGRESS_FILE, RALPHY_DIR } from "../config/loader.ts";
import type { AIResult } from "../engines/types.ts";
import { createAgentWorktree } from "../git/worktree.ts";
import { logDebug, logWarn } from "../ui/logger.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import { standardizeError } from "../utils/errors.ts";
import { getRelevantFilesForTask } from "../utils/file-indexer.ts";
import {
	compareSnapshots,
	createDirectorySnapshot,
	createSelectiveSnapshot,
	getModifiedFiles,
	shouldIgnoreFile,
} from "./file-utils.ts";
import { isInRalphyDir, releaseLocksForFiles } from "./locking.ts";
import { executeWithOrchestrator, shouldUseOrchestrator } from "./orchestrator.ts";
import { type PlanningProgressEvent, planTaskFiles } from "./planning.ts";
import { buildExecutionPrompt } from "./prompt.ts";
import { isRetryableError, withRetry } from "./retry.ts";

export type { AgentRunnerOptions, ParallelAgentResult } from "./runner-types.ts";

import type { AgentRunnerOptions, ParallelAgentResult } from "./runner-types.ts";
import {
	DEFAULT_SYMLINK_DIRS,
	SANDBOX_DIR_PREFIX,
	copyBackPlannedFilesParallel,
	copyPlannedFilesIsolated,
	copySkillFolders,
	createSandbox,
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

function resolveSafeRelativePath(baseDir: string, candidatePath: string): string | null {
	if (!candidatePath || isAbsolute(candidatePath)) {
		return null;
	}

	const normalized = normalize(candidatePath);
	const resolved = resolve(baseDir, normalized);
	const rel = relative(baseDir, resolved);

	if (rel === "" || rel === ".") {
		return normalized;
	}

	if (rel.startsWith(`..${sep}`) || rel === "..") {
		return null;
	}

	if (isAbsolute(rel)) {
		return null;
	}

	return rel;
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
		StaticAgentDisplay.getInstance()?.setAgentStatus(
			options.agentNum,
			task.title,
			"working",
			"planning",
			"planning",
		);

		// Create planning progress callback
		const onPlanningProgress = (event: PlanningProgressEvent) => {
			let stepText = event.message;

			if (event.status === "started") {
				stepText = "Planning started - analyzing task...";
			} else if (event.status === "thinking" && event.message) {
				stepText = `Thinking: ${event.message}`;
			} else if (event.status === "completed") {
				stepText = `Planning complete! Identified ${event.metadata?.fileCount || 0} files`;
			} else if (!event.message) {
				stepText = event.status;
			}

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

			// Add explicit transition feedback
			const display = StaticAgentDisplay.getInstance();
			if (display) {
				display.setAgentStatus(options.agentNum, task.title, "working", "execution", "main");
				display.updateAgent(
					options.agentNum,
					`Starting execution with ${planningResult.files.length} planned files...`,
				);
				display.clearAgentSteps(options.agentNum);
			}
		} else {
			logDebug(`Agent ${options.agentNum}: Planning returned no useful files or steps.`);
			// Optional: Fallback or warning

			// Still transition to working phase even without planning results
			const display = StaticAgentDisplay.getInstance();
			if (display) {
				display.setAgentStatus(options.agentNum, task.title, "working", "execution", "main");
				display.updateAgent(options.agentNum, "Starting execution without planning...");
				display.clearAgentSteps(options.agentNum);
			}
		}
	}

	// Check if we should use orchestrator pattern for test model
	const useOrchestrator = Boolean(
		options.testModel &&
			shouldUseOrchestrator(task.title || "", task.description || "", options.testModel),
	);

	// Build execution prompt (with orchestrator instructions if enabled)
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
		enableOrchestrator: useOrchestrator,
	});

	if (useOrchestrator) {
		logDebug(
			`Agent ${options.agentNum}: Using orchestrator pattern with test model ${options.testModel}`,
		);

		// Status update
		if (!options.planningModel) {
			const display = StaticAgentDisplay.getInstance();
			if (display) {
				display.setAgentStatus(options.agentNum, task.title, "working", "execution", "main");
				display.clearAgentSteps(options.agentNum);
			}
		}

		// Execute with orchestrator
		const orchestratorResult = await executeWithOrchestrator(
			prompt,
			{
				mainEngine: engine,
				testEngine: engine, // Same engine, different model
				mainModel: options.modelOverride,
				testModel: options.testModel,
				workDir: targetDir,
				maxIterations: 5,
				debug,
				agentNum: options.agentNum,
			},
			options.onProgress,
		);

		const result: AIResult = orchestratorResult.success
			? {
					success: true,
					response: orchestratorResult.response,
					inputTokens: 0,
					outputTokens: 0,
				}
			: {
					success: false,
					response: orchestratorResult.response,
					inputTokens: 0,
					outputTokens: 0,
					error: orchestratorResult.error,
				};

		// Update final status in UI
		if (result.success) {
			StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "completed");
		} else {
			StaticAgentDisplay.getInstance()?.setAgentStatus(options.agentNum, task.title, "failed");
		}

		return result;
	}

	// Determine if this is a test-related task and select appropriate model and phase
	const isTestTask = /test|testing|tests?|spec|coverage/i.test(task.title || task.id);
	const effectiveModel =
		isTestTask && options.testModel ? options.testModel : options.modelOverride;

	// Set phase to testing for test tasks
	if (isTestTask) {
		StaticAgentDisplay.getInstance()?.setAgentStatus(
			options.agentNum,
			task.title,
			"working",
			"testing",
			options.testModel || "test",
		);
	}

	// Status is already set during planning → execution transition
	// Only update if planning was skipped (no planningModel)
	if (!options.planningModel) {
		const display = StaticAgentDisplay.getInstance();
		if (display) {
			display.setAgentStatus(options.agentNum, task.title, "working", "execution", "main");
			display.clearAgentSteps(options.agentNum);
		}
	}

	// Execute with retry
	const engineOptions = {
		...(effectiveModel && { modelOverride: effectiveModel }),
		...(engineArgs && engineArgs.length > 0 && { engineArgs }),
		...(options.env && { env: options.env }),
		...(options.debugOpenCode && { debugOpenCode: options.debugOpenCode }),
		// Default to true for autonomous operation - only disable if explicitly set to false
		allowOpenCodeSandboxAccess: options.allowOpenCodeSandboxAccess !== false,
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
	// Use cryptographically secure random for sandbox directory naming
	const uniqueSuffix = randomBytes(4).toString("hex");
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
		} else if (options.useSemanticChunking !== false) {
			// Use semantic chunking to determine relevant files
			try {
				const taskDescription = `${task.title || ""} ${task.description || ""}`;
				const relevantFiles = await getRelevantFilesForTask(originalDir, taskDescription, {
					maxFiles: 30,
					minRelevance: 0.15,
				});

				if (relevantFiles.length > 0) {
					// Copy skill folders and symlink shared resources
					copySkillFolders(originalDir, sandboxDir);
					symlinkSharedResources(originalDir, sandboxDir, getFilteredSymlinkDirs(!!noGitParallel));

					// Copy relevant files into sandbox
					await copyPlannedFilesIsolated(originalDir, sandboxDir, relevantFiles);
					logDebug(`Agent ${agentNum}: Semantic chunking selected ${relevantFiles.length} files`);

					// Continue with selective isolation using relevant files
					const beforeSnapshot = createSelectiveSnapshot(sandboxDir, relevantFiles);

					// Ensure .ralphy/ exists
					const ralphyDir = join(sandboxDir, RALPHY_DIR);
					if (!existsSync(ralphyDir)) mkdirSync(ralphyDir, { recursive: true });

					// Copy PRD resources
					copyPrdResources(originalDir, sandboxDir, prdSource, prdFile, prdIsFolder);

					// Run agent
					const result = await runAgent(sandboxDir, options);

					// Snapshot after execution and discover new files
					const afterSnapshot = createSelectiveSnapshot(sandboxDir, relevantFiles);
					const fullDirSnapshot = createDirectorySnapshot(sandboxDir);

					for (const [relPath, snap] of fullDirSnapshot) {
						if (!afterSnapshot.has(relPath) && !relevantFiles.includes(relPath)) {
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
						try {
							await copyBackPlannedFilesParallel(originalDir, sandboxDir, allChanges);
							logDebug(`Agent ${agentNum}: Copied back ${allChanges.length} modified/new files`);
						} catch (copyErr) {
							logWarn(`Agent ${agentNum}: Failed to copy back files: ${copyErr}`);
						}
					}

					// Release locks if they were held
					try {
						releaseLocksForFiles(relevantFiles, originalDir);
					} catch (lockErr) {
						logDebug(`Agent ${agentNum}: Failed to release locks: ${lockErr}`);
					}

					return {
						task,
						agentNum,
						worktreeDir: sandboxDir,
						branchName: "",
						result,
						usedSandbox: true,
					};
				}
			} catch (error) {
				logDebug(
					`Agent ${agentNum}: Semantic chunking failed, falling back to full sandbox: ${error}`,
				);
			}
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

		return {
			task,
			agentNum,
			worktreeDir: sandboxDir,
			branchName: "",
			result,
			usedSandbox: true,
		};
	} catch (error) {
		const errorMsg = standardizeError(error).message;
		if (filesToCopy) releaseLocksForFiles(filesToCopy, originalDir);

		// Enhanced error logging for engine execution issues
		if (errorMsg.includes("exitCode")) {
			const engineName = options.engine.name;
			logDebug(
				`Agent ${options.agentNum}: Engine execution error - possibly ${engineName} CLI/API issue: ${errorMsg}`,
			);
			logDebug(`Check ${engineName} CLI availability: '${options.engine.cliCommand} --help'`);
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
		options.onWorktreeCreated?.(worktreeDir, branchName);

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
		const errorMsg = standardizeError(error).message;
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
	const safePrdPath = resolveSafeRelativePath(originalDir, prdFile);
	if (!safePrdPath) {
		throw new Error(`Invalid PRD path outside project: ${prdFile}`);
	}

	if (
		prdSource === "markdown" ||
		prdSource === "yaml" ||
		prdSource === "json" ||
		prdSource === "csv"
	) {
		const srcPath = join(originalDir, safePrdPath);
		const destPath = join(targetDir, safePrdPath);
		if (existsSync(srcPath)) {
			mkdirSync(dirname(destPath), { recursive: true });
			copyFileSync(srcPath, destPath);
		}
	} else if (prdSource === "markdown-folder" && prdIsFolder) {
		const srcPath = join(originalDir, safePrdPath);
		const destPath = join(targetDir, safePrdPath);
		if (existsSync(srcPath)) {
			mkdirSync(dirname(destPath), { recursive: true });
			cpSync(srcPath, destPath, { recursive: true });
		}
	}
}
