import simpleGit, { type SimpleGit } from "simple-git";
import { execCommand } from "../engines/base.ts";

/**
 * Push a branch to origin for GitLab
 */
export async function pushBranchGlab(branch: string, workDir = process.cwd()): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);

	try {
		await git.push("origin", branch, ["--set-upstream"]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a merge request using glab CLI
 */
export async function createMergeRequest(
	branch: string,
	baseBranch: string,
	title: string,
	body: string,
	draft = false,
	workDir = process.cwd(),
): Promise<string | null> {
	// Push branch first
	const pushed = await pushBranchGlab(branch, workDir);
	if (!pushed) {
		return null;
	}

	// Build glab mr create command args
	const args = [
		"mr",
		"create",
		"--target-branch",
		baseBranch,
		"--source-branch",
		branch,
		"--title",
		title,
		"--description",
		body,
		"--no-editor",
	];

	if (draft) {
		args.push("--draft");
	}

	// Execute glab CLI
	const { stdout, exitCode } = await execCommand("glab", args, workDir);

	if (exitCode !== 0) {
		return null;
	}

	// Return the MR URL (glab outputs the URL on success)
	return stdout.trim() || null;
}

/**
 * Check if glab CLI is available and authenticated
 */
export async function isGlabAvailable(): Promise<boolean> {
	try {
		const { exitCode } = await execCommand("glab", ["auth", "status"], process.cwd());
		return exitCode === 0;
	} catch {
		return false;
	}
}
