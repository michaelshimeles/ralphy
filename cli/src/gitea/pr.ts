import { pushBranch } from "../git/pr.ts";
import { logWarn } from "../ui/logger.ts";
import { execTea, formatTeaError, isTeaAvailable } from "./tea.ts";

export interface CreateGiteaPrOptions {
	branch: string;
	baseBranch: string;
	title: string;
	body: string;
	draft?: boolean;
	workDir: string;
	repo?: string;
}

export async function createGiteaPullRequestWithTea(
	options: CreateGiteaPrOptions,
): Promise<string | null> {
	const teaAvailable = await isTeaAvailable(options.workDir);
	if (!teaAvailable) {
		return null;
	}

	if (options.draft) {
		logWarn("Draft PRs are not supported for Gitea via tea; creating a normal PR instead.");
	}

	const pushed = await pushBranch(options.branch, options.workDir);
	if (!pushed) {
		return null;
	}

	const args = [
		"pulls",
		"create",
		"--base",
		options.baseBranch,
		"--head",
		options.branch,
		"--title",
		options.title,
		"--description",
		options.body,
		"--output",
		"json",
		"--fields",
		"url",
	];

	// Tea doesn't currently expose a generic draft flag in CLI docs; leave for future.
	// options.draft is accepted for parity with GitHub path.

	const res = await execTea(args, {
		workDir: options.workDir,
		repo: options.repo,
	});
	if (res.exitCode !== 0) {
		throw new Error(`tea pulls create failed: ${formatTeaError(res)}`);
	}

	const out = res.stdout.trim();
	if (!out) return null;

	try {
		const parsed = JSON.parse(out);
		if (Array.isArray(parsed) && parsed.length > 0) {
			const url = parsed[0]?.url;
			return typeof url === "string" && url.trim() ? url.trim() : null;
		}
		if (typeof parsed === "object" && parsed && typeof parsed.url === "string") {
			return parsed.url.trim() || null;
		}
	} catch {
		// Fall back to plain output.
	}

	return out || null;
}
