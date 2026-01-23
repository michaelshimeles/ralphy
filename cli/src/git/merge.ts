import simpleGit, { type SimpleGit } from "simple-git";

/**
 * Result of a merge operation
 */
export interface MergeResult {
	success: boolean;
	hasConflicts: boolean;
	conflictedFiles?: string[];
	potentialConflictFiles?: string[];
	error?: string;
}

function parseGitFileList(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

async function getPotentialConflictFiles(
	branchName: string,
	targetBranch: string,
	workDir: string,
): Promise<string[]> {
	const git: SimpleGit = simpleGit(workDir);
	try {
		const mergeBase = (await git.raw(["merge-base", targetBranch, branchName])).trim();
		if (!mergeBase) {
			return [];
		}

		const [branchDiff, targetDiff] = await Promise.all([
			git.diff(["--name-only", `${mergeBase}..${branchName}`]),
			git.diff(["--name-only", `${mergeBase}..${targetBranch}`]),
		]);

		const branchFiles = new Set(parseGitFileList(branchDiff));
		const targetFiles = new Set(parseGitFileList(targetDiff));
		const overlap: string[] = [];

		for (const file of branchFiles) {
			if (targetFiles.has(file)) {
				overlap.push(file);
			}
		}

		return overlap;
	} catch {
		return [];
	}
}

/**
 * Merge an agent branch into a target branch
 */
export async function mergeAgentBranch(
	branchName: string,
	targetBranch: string,
	workDir: string,
): Promise<MergeResult> {
	const git: SimpleGit = simpleGit(workDir);
	const potentialConflictFiles = await getPotentialConflictFiles(branchName, targetBranch, workDir);
	const potentialConflicts = potentialConflictFiles.length > 0 ? potentialConflictFiles : undefined;

	try {
		// Checkout target branch
		await git.checkout(targetBranch);

		// Attempt merge
		try {
			await git.merge([branchName, "--no-ff", "-m", `Merge ${branchName} into ${targetBranch}`]);
			return { success: true, hasConflicts: false, potentialConflictFiles: potentialConflicts };
		} catch (mergeError) {
			// Check if we have conflicts
			const conflictedFiles = await getConflictedFiles(workDir);
			if (conflictedFiles.length > 0) {
				return {
					success: false,
					hasConflicts: true,
					conflictedFiles,
					potentialConflictFiles: potentialConflicts,
				};
			}
			// Some other merge error
			throw mergeError;
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			hasConflicts: false,
			potentialConflictFiles: potentialConflicts,
			error: errorMsg,
		};
	}
}

/**
 * Create an integration branch for a parallel group
 */
export async function createIntegrationBranch(
	groupNum: number,
	baseBranch: string,
	workDir: string,
): Promise<string> {
	const git: SimpleGit = simpleGit(workDir);
	const branchName = `ralphy/integration-group-${groupNum}`;

	// Checkout base branch first
	await git.checkout(baseBranch);

	// Delete the branch if it exists
	try {
		await git.deleteLocalBranch(branchName, true);
	} catch {
		// Branch might not exist
	}

	// Create new branch from base
	await git.checkoutLocalBranch(branchName);

	return branchName;
}

/**
 * Merge multiple source branches into a target branch
 * Returns lists of succeeded and failed branches
 */
export async function mergeIntoBranch(
	sourceBranches: string[],
	targetBranch: string,
	workDir: string,
): Promise<{ succeeded: string[]; failed: string[]; conflicted: string[] }> {
	const succeeded: string[] = [];
	const failed: string[] = [];
	const conflicted: string[] = [];

	for (const branch of sourceBranches) {
		const result = await mergeAgentBranch(branch, targetBranch, workDir);
		if (result.success) {
			succeeded.push(branch);
		} else if (result.hasConflicts) {
			conflicted.push(branch);
		} else {
			failed.push(branch);
		}
	}

	return { succeeded, failed, conflicted };
}

/**
 * Get list of files with merge conflicts
 */
export async function getConflictedFiles(workDir: string): Promise<string[]> {
	const git: SimpleGit = simpleGit(workDir);
	const status = await git.status();

	// Conflicted files are in the 'conflicted' array
	return status.conflicted;
}

/**
 * Abort an in-progress merge
 */
export async function abortMerge(workDir: string): Promise<void> {
	const git: SimpleGit = simpleGit(workDir);
	try {
		await git.merge(["--abort"]);
	} catch {
		// Ignore if no merge in progress
	}
}

/**
 * Delete a local branch
 */
export async function deleteLocalBranch(
	branchName: string,
	workDir: string,
	force = false,
): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);
	try {
		await git.deleteLocalBranch(branchName, force);
		return true;
	} catch {
		return false;
	}
}

/**
 * Complete a merge after conflicts have been resolved
 * Only stages the specific resolved files and commits if there are no remaining conflicts
 */
export async function completeMerge(workDir: string, resolvedFiles: string[]): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);
	try {
		// Verify no conflicts remain
		const remainingConflicts = await getConflictedFiles(workDir);
		if (remainingConflicts.length > 0) {
			return false;
		}

		// Stage only the specific resolved files to avoid staging unrelated changes
		for (const file of resolvedFiles) {
			await git.add(file);
		}

		// Use --no-edit to preserve Git's prepared merge message
		await git.commit([], ["--no-edit"]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a merge is currently in progress
 */
export async function isMergeInProgress(workDir: string): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);
	const status = await git.status();
	// If we have conflicted files or are in a merge state
	return status.conflicted.length > 0 || status.current?.includes("MERGING") || false;
}

/**
 * Check if a branch exists locally
 */
export async function branchExists(branchName: string, workDir: string): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);
	const branches = await git.branchLocal();
	return branches.all.includes(branchName);
}

/**
 * Result of pre-merge analysis
 */
export interface PreMergeAnalysis {
	branch: string;
	filesChanged: string[];
	fileCount: number;
}

/**
 * Analyze a branch before merging to predict potential conflicts.
 * Uses git diff --name-only which doesn't require locks and can run in parallel.
 */
export async function analyzePreMerge(
	branch: string,
	targetBranch: string,
	workDir: string,
): Promise<PreMergeAnalysis> {
	const git: SimpleGit = simpleGit(workDir);

	try {
		// Get list of files that differ between the branch and target
		// Using three-dot notation to show changes since the branches diverged
		const diffOutput = await git.diff([`${targetBranch}...${branch}`, "--name-only"]);
		const filesChanged = diffOutput
			.split("\n")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		return {
			branch,
			filesChanged,
			fileCount: filesChanged.length,
		};
	} catch {
		// If diff fails (e.g., branch doesn't exist), return empty analysis
		return {
			branch,
			filesChanged: [],
			fileCount: 0,
		};
	}
}

/**
 * Calculate conflict likelihood between branches based on file overlap.
 * Returns a score where higher = more likely to conflict.
 */
export function calculateConflictScore(
	branchAnalysis: PreMergeAnalysis,
	allAnalyses: PreMergeAnalysis[],
): number {
	let conflictScore = 0;
	const branchFiles = new Set(branchAnalysis.filesChanged);

	// Check overlap with other branches
	for (const other of allAnalyses) {
		if (other.branch === branchAnalysis.branch) continue;

		// Count overlapping files
		for (const file of other.filesChanged) {
			if (branchFiles.has(file)) {
				conflictScore++;
			}
		}
	}

	return conflictScore;
}

/**
 * Sort branches by conflict likelihood (lowest first).
 * Branches that touch fewer shared files should merge first.
 */
export function sortByConflictLikelihood(analyses: PreMergeAnalysis[]): PreMergeAnalysis[] {
	// Calculate conflict scores for each branch
	const withScores = analyses.map((analysis) => ({
		analysis,
		score: calculateConflictScore(analysis, analyses),
	}));

	// Sort by score (ascending) - merge least conflicting first
	// Secondary sort by file count (ascending) - simpler changes first
	withScores.sort((a, b) => {
		if (a.score !== b.score) {
			return a.score - b.score;
		}
		return a.analysis.fileCount - b.analysis.fileCount;
	});

	return withScores.map((ws) => ws.analysis);
}
