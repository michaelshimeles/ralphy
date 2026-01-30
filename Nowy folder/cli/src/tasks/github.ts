import { Octokit } from "@octokit/rest";
import type { Task, TaskSource } from "./types.ts";

/**
 * GitHub Issues task source - reads tasks from GitHub issues
 */
export class GitHubTaskSource implements TaskSource {
	type = "github" as const;
	private octokit: Octokit;
	private owner: string;
	private repo: string;
	private label?: string;

	constructor(repoPath: string, label?: string) {
		// Parse owner/repo format
		const [owner, repo] = repoPath.split("/");
		if (!owner || !repo) {
			throw new Error(`Invalid repo format: ${repoPath}. Expected owner/repo`);
		}

		this.owner = owner;
		this.repo = repo;
		this.label = label;

		// Use GITHUB_TOKEN from environment
		this.octokit = new Octokit({
			auth: process.env.GITHUB_TOKEN,
		});
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
		// Extract issue number from "number:title" format
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

	/**
	 * Get full issue body for a task
	 */
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
