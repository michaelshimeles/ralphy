import { Octokit } from "@octokit/rest";
import type { Task, TaskSource } from "./types.ts";

/**
 * GitHub token patterns for validation
 * Supports classic PATs (ghp_), fine-grained PATs (github_pat_), OAuth tokens (gho_),
 * and GitHub App installation tokens (ghs_).
 */
const GITHUB_TOKEN_PATTERNS = [
	/^ghp_[A-Za-z0-9]{36}$/, // Classic PAT
	/^github_pat_[A-Za-z0-9_]{82}$/, // Fine-grained PAT
	/^gho_[A-Za-z0-9]{52}$/, // OAuth token
	/^ghs_[A-Za-z0-9]{36}$/, // GitHub App installation token
];

function validateGitHubToken(token: string): boolean {
	return GITHUB_TOKEN_PATTERNS.some((pattern) => pattern.test(token));
}

export class GitHubTaskSource implements TaskSource {
	type = "github" as const;
	private octokit: Octokit;
	private owner: string;
	private repo: string;
	private label?: string;

	constructor(repoPath: string, label?: string) {
		const parts = repoPath.split("/").filter(Boolean);
		if (parts.length !== 2) {
			throw new Error(`Invalid repo format: ${repoPath}. Expected owner/repo`);
		}
		const [owner, repo] = parts;

		this.owner = owner;
		this.repo = repo;
		this.label = label;

		const token = process.env.GITHUB_TOKEN;
		if (!token) {
			throw new Error("GITHUB_TOKEN environment variable is not set");
		}

		if (!validateGitHubToken(token)) {
			throw new Error(
				"GITHUB_TOKEN has invalid format. Expected: ghp_***, github_pat_***, gho_***, or ghs_***",
			);
		}

		this.octokit = new Octokit({ auth: token });
	}

	async getAllTasks(): Promise<Task[]> {
		const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
			owner: this.owner,
			repo: this.repo,
			state: "open",
			labels: this.label,
			per_page: 100,
		});

		return issues.map((issue) => ({
			id: `${issue.number}:${issue.title}`,
			title: issue.title,
			body: issue.body || undefined,
			completed: false,
		}));
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const issueNumber = Number.parseInt(id.split(":")[0], 10);
		if (Number.isNaN(issueNumber)) {
			throw new Error(`Invalid issue ID: ${id}`);
		}

		await this.octokit.issues.update({
			owner: this.owner,
			repo: this.repo,
			issue_number: issueNumber,
			state: "closed",
		});
	}

	async countRemaining(): Promise<number> {
		const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
			owner: this.owner,
			repo: this.repo,
			state: "open",
			labels: this.label,
			per_page: 100,
		});

		return issues.length;
	}

	async countCompleted(): Promise<number> {
		const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
			owner: this.owner,
			repo: this.repo,
			state: "closed",
			labels: this.label,
			per_page: 100,
		});

		return issues.length;
	}

	async getIssueBody(id: string): Promise<string> {
		const issueNumber = Number.parseInt(id.split(":")[0], 10);
		if (Number.isNaN(issueNumber)) {
			return "";
		}

		const issue = await this.octokit.issues.get({
			owner: this.owner,
			repo: this.repo,
			issue_number: issueNumber,
		});

		return issue.data.body || "";
	}
}
