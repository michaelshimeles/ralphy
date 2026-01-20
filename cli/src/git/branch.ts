import simpleGit, { type SimpleGit } from "simple-git";

/**
 * Slugify text for branch names
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50);
}

/**
 * Create a task branch
 */
export async function createTaskBranch(
	task: string,
	baseBranch: string,
	workDir = process.cwd()
): Promise<string> {
	const git: SimpleGit = simpleGit(workDir);
	const branchName = `ralphy/${slugify(task)}`;

	// Stash any changes
	let stashed = false;
	const status = await git.status();
	if (status.files.length > 0) {
		await git.stash(["push", "-m", "ralphy-autostash"]);
		stashed = true;
	}

	try {
		// Checkout base branch and pull
		await git.checkout(baseBranch);
		await git.pull("origin", baseBranch).catch(() => {
			// Ignore pull errors
		});

		// Create new branch (or checkout if exists)
		try {
			await git.checkoutLocalBranch(branchName);
		} catch {
			await git.checkout(branchName);
		}
	} finally {
		// Pop stash if we stashed
		if (stashed) {
			await git.stash(["pop"]).catch(() => {
				// Ignore stash pop errors
			});
		}
	}

	return branchName;
}

/**
 * Return to the base branch
 */
export async function returnToBaseBranch(baseBranch: string, workDir = process.cwd()): Promise<void> {
	const git: SimpleGit = simpleGit(workDir);
	await git.checkout(baseBranch).catch(() => {
		// Ignore checkout errors
	});
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(workDir = process.cwd()): Promise<string> {
	const git: SimpleGit = simpleGit(workDir);
	const status = await git.status();
	return status.current || "";
}

/**
 * Get the default base branch (main or master)
 */
export async function getDefaultBaseBranch(workDir = process.cwd()): Promise<string> {
	const git: SimpleGit = simpleGit(workDir);

	// Try main first, then master
	const branches = await git.branchLocal();
	if (branches.all.includes("main")) return "main";
	if (branches.all.includes("master")) return "master";

	// Fall back to current branch
	return branches.current;
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(workDir = process.cwd()): Promise<boolean> {
	const git: SimpleGit = simpleGit(workDir);
	const status = await git.status();
	return status.files.length > 0;
}
