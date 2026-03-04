import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { DEFAULT_MAX_REPLANS, PLANNING_CACHE_FILE } from "../config/constants.ts";
import { RALPHY_DIR } from "../config/loader.ts";
import type { AIEngine, AIResult } from "../engines/types.ts";
import type { Task } from "../tasks/types.ts";
import { logDebug, logWarn } from "../ui/logger.ts";
import { extractTaskKeywords, getRelevantFilesForTask } from "../utils/file-indexer.ts";
import type { PlanningProgressCallback, PlanningProgressEvent } from "./progress-types.ts";
import { buildPlanningPrompt } from "./prompt.ts";

// Re-export PlanningProgressEvent from ui module for backward compatibility
export type { PlanningProgressCallback, PlanningProgressEvent } from "./progress-types.ts";

export function getPlanningCacheFile(workDir: string): string {
	return join(workDir, RALPHY_DIR, PLANNING_CACHE_FILE);
}

interface RepoFingerprint {
	fileStates: Map<string, { mtime: number; size: number; hash: string }>;
	dirHash: string;
	timestamp: number;
}

const fingerprintCache = new Map<string, RepoFingerprint>();

export function generateRepoFingerprint(workDir: string): string {
	const cached = fingerprintCache.get(workDir);
	const now = Date.now();

	// Check if cache is very recent (1 minute) for high-frequency calls
	if (cached && now - cached.timestamp < 60000) {
		return cached.dirHash;
	}

	const keyFiles = [
		"package.json",
		"pyproject.toml",
		"Cargo.toml",
		"go.mod",
		"requirements.txt",
		"pnpm-lock.yaml",
		"package-lock.json",
		"yarn.lock",
	];
	const fileStates = new Map<string, { mtime: number; size: number; hash: string }>();
	let changed = !cached;

	for (const file of keyFiles) {
		const filePath = join(workDir, file);
		if (existsSync(filePath)) {
			try {
				const stat = lstatSync(filePath);
				const mtime = stat.mtimeMs;
				const size = stat.size;

				const cachedState = cached?.fileStates.get(file);
				if (cachedState && cachedState.mtime === mtime && cachedState.size === size) {
					fileStates.set(file, cachedState);
				} else {
					const content = readFileSync(filePath);
					const hash = createHash("sha256").update(content).digest("hex");
					fileStates.set(file, { mtime, size, hash });
					changed = true;
				}
			} catch {
				// Ignore errors
			}
		}
	}

	// Also factor in top-level directory structure changes
	let dirFingerprint = "";
	try {
		const entries = readdirSync(workDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		dirFingerprint = entries.join(",");
		if (cached && cached.fileStates?.get("dirs")?.hash !== dirFingerprint) {
			changed = true;
		}
		fileStates.set("dirs", { mtime: 0, size: 0, hash: dirFingerprint });
	} catch {
		// Ignore errors
	}

	if (!changed && cached) {
		// Update timestamp but keep dirHash
		cached.timestamp = now;
		return cached.dirHash;
	}

	const combinedHashes = Array.from(fileStates.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([file, state]) => `${file}:${state.hash}`)
		.join("|");

	const dirHash = createHash("sha256").update(combinedHashes).digest("hex");

	fingerprintCache.set(workDir, {
		fileStates,
		dirHash,
		timestamp: now,
	});

	return dirHash;
}

export function loadPlanningCache(
	workDir: string,
): Map<string, { files: string[]; timestamp: number; repoFingerprint: string }> {
	const cacheFile = getPlanningCacheFile(workDir);
	const compressedCacheFile = `${cacheFile}.gz`;

	if (existsSync(compressedCacheFile)) {
		try {
			const compressed = readFileSync(compressedCacheFile);
			const data = JSON.parse(gunzipSync(compressed).toString("utf-8"));
			return new Map(Object.entries(data));
		} catch (error) {
			logWarn(`Failed to load compressed planning cache: ${error}`);
			// Fall through
		}
	}

	if (!existsSync(cacheFile)) {
		return new Map();
	}

	try {
		const data = JSON.parse(readFileSync(cacheFile, "utf-8"));
		return new Map(Object.entries(data));
	} catch (error) {
		logWarn(`Failed to load planning cache: ${error}`);
		return new Map();
	}
}

export function savePlanningCache(
	workDir: string,
	cache: Map<string, { files: string[]; timestamp: number; repoFingerprint: string }>,
): void {
	const cacheFile = getPlanningCacheFile(workDir);
	const compressedCacheFile = `${cacheFile}.gz`;
	const data = Object.fromEntries(cache);
	const jsonStr = JSON.stringify(data);

	try {
		const compressed = gzipSync(Buffer.from(jsonStr, "utf-8"));
		writeFileSync(compressedCacheFile, compressed);

		if (existsSync(cacheFile)) {
			try {
				unlinkSync(cacheFile);
			} catch {}
		}
	} catch {
		writeFileSync(cacheFile, JSON.stringify(data, null, 2));
	}
}

export function generateTaskHash(task: Task): string {
	const raw = `${task.id}:${task.title}`;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function normalizePlannedPath(filePath: string): string {
	let processed = filePath.trim();

	// Strip leading bullets (*, -, +)
	processed = processed.replace(/^[*\-+]\s+/, "");

	// Strip leading numbering (1., 1), etc.)
	processed = processed.replace(/^\d+[.)]\s+/, "");

	// Strip wrapping backticks if present
	processed = processed.replace(/^`+|`+$/g, "");

	// Remove leading ./
	if (processed.startsWith("./")) {
		processed = processed.substring(2);
	}

	// Normalize path separators
	processed = normalize(processed);

	if (!processed || isAbsolute(processed) || processed.startsWith("..")) {
		return "";
	}

	return processed;
}

export function parsePlannedFiles(response: string): string[] {
	const files = new Set<string>();

	// Robust Regex approach for <FILES> blocks
	const filesMatch = response.match(/<FILES>([\s\S]*?)<\/FILES>/i);
	if (filesMatch) {
		const content = filesMatch[1];
		const lines = content.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("<")) {
				const normalizedPath = normalizePlannedPath(trimmed);
				if (normalizedPath) {
					files.add(normalizedPath);
				}
			}
		}
	} else {
		// Fallback: look for lines that look like paths if the block tags are missing/broken
		const lines = response.split(/\r?\n/);
		let inManualBlock = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (
				trimmed.toUpperCase().includes("FILES") &&
				(trimmed.includes("<") || trimmed.includes("["))
			) {
				inManualBlock = true;
				continue;
			}
			if (inManualBlock && trimmed === "") continue;
			if (
				inManualBlock &&
				(trimmed.startsWith("/") ||
					trimmed.startsWith("./") ||
					trimmed.startsWith("../") ||
					/^[a-zA-Z0-9_\-.]+\/[a-zA-Z0-9_\-./]+/.test(trimmed))
			) {
				const normalizedPath = normalizePlannedPath(trimmed);
				if (normalizedPath) {
					files.add(normalizedPath);
				}
			}
		}
	}

	return Array.from(files);
}

function parseEnhancedPlanning(response: string): {
	analysis?: string;
	plan?: string[];
	optimization?: string;
} {
	// Use robust regex approach for tags
	const analysisMatch = response.match(/<ANALYSIS>([\s\S]*?)<\/ANALYSIS>/i);
	const planMatch = response.match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
	const optimizationMatch = response.match(/<OPTIMIZATION>([\s\S]*?)<\/OPTIMIZATION>/i);

	const analysis = analysisMatch ? analysisMatch[1].trim() : undefined;
	const optimization = optimizationMatch ? optimizationMatch[1].trim() : undefined;

	let plan: string[] | undefined;
	if (planMatch) {
		const content = planMatch[1];
		const lines = content.split(/\r?\n/);
		const planSteps: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed) {
				// Parse numbered steps (strip bullet points if present)
				let stepText = trimmed;
				if (stepText.startsWith("- ")) {
					stepText = stepText.substring(2);
				}
				const stepMatch = stepText.match(/^\d+\.\s*(.*)/);
				if (stepMatch) {
					planSteps.push(stepMatch[1]);
				} else if (!line.startsWith("<") && !line.startsWith("</") && stepText.length > 0) {
					planSteps.push(stepText);
				}
			}
		}
		if (planSteps.length > 0) {
			plan = planSteps;
		}
	}

	return {
		analysis,
		plan,
		optimization,
	};
}

export interface PlanningResult {
	files: string[];
	analysis?: string;
	plan?: string[];
	optimization?: string;
	noFilesNeeded?: boolean;
	error?: string;
}

export async function planTaskFiles(
	engine: AIEngine,
	task: Task,
	workDir: string,
	modelOverride?: string,
	maxReplans = DEFAULT_MAX_REPLANS,
	planningModel?: string,
	fullTasksContext?: string,
	debug?: boolean,
	onProgress?: PlanningProgressCallback,
	debugOpenCode?: boolean,
	logThoughts?: boolean,
	engineArgs?: string[],
): Promise<PlanningResult> {
	const taskId = task.title && task.title !== "No title" ? task.title : task.id || "unknown";

	// Use semantic chunking to get relevant files for this task
	let relevantFiles: string[] = [];
	try {
		const taskDescription = `${task.title || ""} ${task.description || ""}`;
		relevantFiles = await getRelevantFilesForTask(workDir, taskDescription, {
			maxFiles: 50,
			minRelevance: 0.1,
		});
		logDebug(`Semantic chunking found ${relevantFiles.length} relevant files for task "${taskId}"`);

		// Log extracted keywords for debugging
		const keywords = extractTaskKeywords(taskDescription);
		logDebug(`Task keywords: ${keywords.join(", ")}`);
	} catch (error) {
		logDebug(`Failed to get relevant files for task: ${error}`);
		// Continue without semantic chunking - planning will use full codebase
	}

	// Build prompt with relevant files context if available
	const prompt = buildPlanningPrompt(task, fullTasksContext, relevantFiles);

	// Emit planning started
	if (onProgress) {
		try {
			onProgress({
				taskId,
				status: "started",
				timestamp: Date.now(),
				message:
					relevantFiles.length > 0
						? `Planning with ${relevantFiles.length} relevant files...`
						: "Planning...",
			});
		} catch (error) {
			// Don't let progress callback errors break planning
			logDebug(`Progress callback error: ${error}`);
		}
	}

	// Use planningModel if provided, otherwise default to modelOverride or engine default
	const options = {
		modelOverride: planningModel || modelOverride || undefined,
		...(debugOpenCode && { debugOpenCode }),
		...(logThoughts !== undefined && { logThoughts }),
		...(engineArgs && engineArgs.length > 0 && { engineArgs }),
	};

	let result: AIResult;
	if (onProgress && engine.executeStreaming) {
		// Emit starting status
		try {
			onProgress({
				taskId,
				status: "started",
				timestamp: Date.now(),
				message: "Starting planning analysis...",
			});
		} catch (error) {
			logDebug(`Progress callback error: ${error}`);
		}

		// Create wrapper for streaming progress
		const streamingCallback = (step: string) => {
			try {
				// Parse step to determine status and extract meaningful action
				let status: PlanningProgressEvent["status"] = "thinking";
				let message = step;

				// Detect specific actions for better display
				if (step.includes("analyzing") || step.includes("I need to") || step.includes("I should")) {
					status = "analyzing";
				} else if (
					step.includes("planning") ||
					step.includes("I'll create") ||
					step.includes("Let me create")
				) {
					status = "planning";
				} else if (
					step.includes("Reading") ||
					step.includes("Looking at") ||
					step.includes("Let me examine")
				) {
					status = "analyzing";
					message = "Reading project structure and files";
				} else if (
					step.includes("identifying") ||
					step.includes("found") ||
					step.includes("need to modify")
				) {
					status = "planning";
					message = "Identifying files that need changes";
				} else if (step.includes("completed") || step.includes("done") || step.includes("ready")) {
					status = "completed";
					message = "Planning complete - ready to implement";
				} else if (step.includes("failed") || step.includes("error")) {
					status = "failed";
					message = "Planning encountered an issue";
				}

				// Extract reward if present in step (e.g., "reward: 0.85")
				const rewardMatch = step.match(/reward:\s*([0-9.]+)/i);
				const reward = rewardMatch ? Number.parseFloat(rewardMatch[1]) : undefined;

				onProgress({
					taskId,
					status,
					reward,
					message: message,
					timestamp: Date.now(),
				});
			} catch (error) {
				logDebug(`Streaming progress callback error: ${error}`);
			}
		};
		result = await engine.executeStreaming(prompt, workDir, streamingCallback, options);
	} else {
		// Non-streaming: emit thinking status before execution
		if (onProgress) {
			try {
				onProgress({
					taskId,
					status: "thinking",
					timestamp: Date.now(),
					message: "Processing planning request...",
				});
			} catch (error) {
				logDebug(`Progress callback error: ${error}`);
			}
		}
		result = await engine.execute(prompt, workDir, options);
	}

	if (!result.success) {
		const rawResponse = result.response || "";
		const error = result.error || "Planning failed";

		// Detect if AI returned raw tool_use JSON instead of structured planning
		const isRawToolUse = rawResponse.trim().startsWith('{"type":"tool_use"');

		if (isRawToolUse) {
			// Try to extract what file/tool the AI was trying to access
			let toolInfo = "";
			try {
				const parsed = JSON.parse(rawResponse);
				if (parsed.part?.tool) {
					toolInfo = ` (tool: ${parsed.part.tool})`;
				}
				if (parsed.part?.state?.input?.filePath) {
					toolInfo += ` file: ${parsed.part.state.input.filePath}`;
				}
			} catch {
				// Ignore parse errors
			}

			const helpfulError = `Planning failed: AI returned tool output${toolInfo} instead of planning analysis. The AI may have started executing prematurely. This usually indicates the planning prompt was too complex or the AI engine interrupted the planning phase.`;
			logDebug(
				`Raw tool use detected instead of planning format. Response: ${rawResponse.substring(0, 500)}...`,
			);

			if (onProgress) {
				try {
					onProgress({
						taskId,
						status: "failed",
						timestamp: Date.now(),
						message: helpfulError,
					});
				} catch (err) {
					logDebug(`Progress callback error: ${err}`);
				}
			}

			if (maxReplans > 0) {
				logDebug(
					`Planning failed with malformed response, retrying... (${maxReplans} attempts left)`,
				);
				return planTaskFiles(
					engine,
					task,
					workDir,
					modelOverride,
					maxReplans - 1,
					planningModel,
					fullTasksContext,
					debug,
					onProgress,
					debugOpenCode,
					logThoughts,
					engineArgs,
				);
			}
			return { files: [], error: helpfulError };
		}

		// Regular failure - emit failed status
		if (onProgress) {
			try {
				onProgress({
					taskId,
					status: "failed",
					timestamp: Date.now(),
					message: error,
				});
			} catch (err) {
				logDebug(`Progress callback error: ${err}`);
			}
		}

		if (maxReplans > 0) {
			// Check if this is a connection error that warrants a longer retry delay
			const isConnectionError =
				/connection|network|timeout|unable to connect|internet connection|econnrefused|econnreset/i.test(
					error,
				);
			const attemptNumber = DEFAULT_MAX_REPLANS - maxReplans + 1;

			if (isConnectionError) {
				// Exponential backoff for connection errors: 2s, 4s, 8s
				const delayMs = Math.min(2000 * 2 ** (attemptNumber - 1), 10000);
				logWarn(
					`Connection error detected. Retrying in ${delayMs}ms... (${maxReplans} attempts left)`,
				);

				if (onProgress) {
					try {
						onProgress({
							taskId,
							status: "thinking",
							timestamp: Date.now(),
							message: `Connection error. Retrying in ${delayMs}ms... (${maxReplans} attempts left)`,
						});
					} catch (err) {
						logDebug(`Progress callback error: ${err}`);
					}
				}

				await new Promise((resolve) => setTimeout(resolve, delayMs));
			} else {
				logDebug(`Planning failed, retrying... (${maxReplans} attempts left). Error: ${error}`);
			}

			return planTaskFiles(
				engine,
				task,
				workDir,
				modelOverride,
				maxReplans - 1,
				planningModel,
				fullTasksContext,
				debug,
				onProgress,
				debugOpenCode,
				logThoughts,
				engineArgs,
			);
		}
		return { files: [], error };
	}

	const files = parsePlannedFiles(result.response || "");
	const parsed = parseEnhancedPlanning(result.response || "");

	// Emit completed status
	if (onProgress) {
		try {
			onProgress({
				taskId,
				status: "completed",
				timestamp: Date.now(),
				message: `Planned ${files.length} files with ${parsed.plan?.length || 0} steps`,
				metadata: {
					fileCount: files.length,
					files: files.slice(0, 10),
					hasAnalysis: !!parsed.analysis,
					hasPlan: !!parsed.plan,
					hasOptimization: !!parsed.optimization,
				},
			});
		} catch (error) {
			logDebug(`Progress callback error: ${error}`);
		}
	}

	return {
		files,
		analysis: parsed.analysis,
		plan: parsed.plan,
		optimization: parsed.optimization,
	};
}
