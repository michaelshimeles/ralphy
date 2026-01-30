import simpleGit, { type SimpleGit } from "simple-git";
import { execCommand } from "../engines/base.ts";

/**
 * Push a branch to origin
 */
export async function pushBranch(branch: string, workDir = process.cwd()): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);

	try {
		await git.push("origin", branch, ["--set-upstream"]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a pull request using gh CLI
 */
export async function createPullRequest(
	branch: string,
	baseBranch: string,
	title: string,
	body: string,
	draft = false,
	workDir = process.cwd(),
): Promise<string | null> {
	// Push branch first
	const pushed = await pushBranch(branch, workDir);
	if (!pushed) {
		return null;
	}

	// Build gh pr create command args
	const args = [
		"pr",
		"create",
		"--base",
		baseBranch,
		"--head",
		branch,
		"--title",
		title,
		"--body",
		body,
	];

	if (draft) {
		args.push("--draft");
	}

	// Execute gh CLI
	const { stdout, exitCode } = await execCommand("gh", args, workDir);

	if (exitCode !== 0) {
		return null;
	}

	// Return the PR URL (gh outputs the URL on success)
	return stdout.trim() || null;
}

/**
 * Check if gh CLI is available and authenticated
 */
export async function isGhAvailable(): Promise<boolean> {
	try {
		const { exitCode } = await execCommand("gh", ["auth", "status"], process.cwd());
		return exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Get the remote URL for origin
 */
export async function getOriginUrl(workDir = process.cwd()): Promise<string | null> {
	const git: SimpleGit = simpleGit(workDir);

	try {
		const remotes = await git.getRemotes(true);
		const origin = remotes.find((r) => r.name === "origin");
		return origin?.refs?.fetch || null;
	} catch {
		return null;
	}
}
