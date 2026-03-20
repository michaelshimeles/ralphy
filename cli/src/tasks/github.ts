import { Octokit } from "@octokit/rest";
import type { Task, TaskSource } from "./types.ts";

/**
 * Cached GitHub issues data
 */
interface GitHubCache {
	openIssues: Task[];
	closedCount: number;
	lastFetched: number;
}

/** Cache TTL in milliseconds (30 seconds) */
const CACHE_TTL_MS = 30_000;

/**
 * GitHub Issues task source - reads tasks from GitHub issues
 *
 * Performance optimized: caches issue data to avoid redundant API calls.
 * Cache is invalidated after TTL or when markComplete() is called.
 */
export class GitHubTaskSource implements TaskSource {
	type = "github" as const;
	private octokit: Octokit;
	private owner: string;
	private repo: string;
	private label?: string;
	private order?: number[];
	private cache: GitHubCache | null = null;

	constructor(repoPath: string, label?: string, order?: number[]) {
		// Parse owner/repo format
		const [owner, repo] = repoPath.split("/");
		if (!owner || !repo) {
			throw new Error(`Invalid repo format: ${repoPath}. Expected owner/repo`);
		}

		this.owner = owner;
		this.repo = repo;
		this.label = label;
		this.order = order;

		// Use GITHUB_TOKEN from environment
		this.octokit = new Octokit({
			auth: process.env.GITHUB_TOKEN,
		});
	}

	/**
	 * Check if cache is still valid
	 */
	private isCacheValid(): boolean {
		if (!this.cache) return false;
		return Date.now() - this.cache.lastFetched < CACHE_TTL_MS;
	}

	/**
	 * Invalidate the cache
	 */
	private invalidateCache(): void {
		this.cache = null;
	}

	/**
	 * Fetch and cache open issues
	 */
	private async fetchOpenIssues(): Promise<Task[]> {
		if (this.isCacheValid() && this.cache) {
			return this.cache.openIssues;
		}

		const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
			owner: this.owner,
			repo: this.repo,
			state: "open",
			labels: this.label,
			per_page: 100,
		});

		let tasks = issues.map((issue) => ({
			id: `${issue.number}:${issue.title}`,
			title: issue.title,
			body: issue.body || undefined,
			completed: false,
		}));

		// Sort by specified order if provided
		if (this.order && this.order.length > 0) {
			const orderMap = new Map(this.order.map((num, idx) => [num, idx]));
			tasks = tasks
				.filter((t) => {
					const issueNum = Number.parseInt(t.id.split(":")[0], 10);
					return orderMap.has(issueNum);
				})
				.sort((a, b) => {
					const aNum = Number.parseInt(a.id.split(":")[0], 10);
					const bNum = Number.parseInt(b.id.split(":")[0], 10);
					return (orderMap.get(aNum) ?? 0) - (orderMap.get(bNum) ?? 0);
				});
		}

		// Update cache (preserve closed count if we have it)
		this.cache = {
			openIssues: tasks,
			closedCount: this.cache?.closedCount ?? -1,
			lastFetched: Date.now(),
		};

		return tasks;
	}

	async getAllTasks(): Promise<Task[]> {
		return await this.fetchOpenIssues();
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.fetchOpenIssues();
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

		// Invalidate cache after modification
		this.invalidateCache();
	}

	async countRemaining(): Promise<number> {
		const tasks = await this.fetchOpenIssues();
		return tasks.length;
	}

	async countCompleted(): Promise<number> {
		// Check if we have a recent closed count
		if (this.isCacheValid() && this.cache && this.cache.closedCount >= 0) {
			return this.cache.closedCount;
		}

		const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
			owner: this.owner,
			repo: this.repo,
			state: "closed",
			labels: this.label,
			per_page: 100,
		});

		// When order is specified, only count closed issues that are in the order list
		let closedCount = issues.length;
		if (this.order && this.order.length > 0) {
			const orderSet = new Set(this.order);
			closedCount = issues.filter((issue) => orderSet.has(issue.number)).length;
		}

		// Update cache with closed count
		if (this.cache) {
			this.cache.closedCount = closedCount;
		}

		return closedCount;
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
