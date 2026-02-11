import type { TeaExecOptions } from "../gitea/tea.ts";
import { execTea, formatTeaError, parseTeaIssueList } from "../gitea/tea.ts";
import { logWarn } from "../ui/logger.ts";
import type { Task, TaskSource } from "./types.ts";

interface GiteaCache {
	openIssues: Task[];
	closedCount: number;
	lastFetched: number;
}

const CACHE_TTL_MS = 30_000;

export class GiteaTaskSource implements TaskSource {
	type = "gitea" as const;
	private repo: string;
	private label?: string;
	private cache: GiteaCache | null = null;
	private runner: typeof execTea;

	constructor(repo: string, label?: string, runner: typeof execTea = execTea) {
		if (!repo) {
			throw new Error("Gitea repo is required");
		}
		this.repo = repo;
		this.label = label || undefined;
		this.runner = runner;
	}

	private isCacheValid(): boolean {
		if (!this.cache) return false;
		return Date.now() - this.cache.lastFetched < CACHE_TTL_MS;
	}

	private invalidateCache(): void {
		this.cache = null;
	}

	private teaOptions(workDir = process.cwd()): TeaExecOptions {
		return {
			workDir,
			repo: this.repo,
		};
	}

	private async fetchOpenIssues(workDir = process.cwd()): Promise<Task[]> {
		if (this.isCacheValid() && this.cache) {
			return this.cache.openIssues;
		}

		const args = [
			"issues",
			"list",
			"--state",
			"open",
			"--output",
			"json",
			"--fields",
			"index,title,body",
		];
		if (this.label) {
			args.push("--labels", this.label);
		}

		const res = await this.runner(args, this.teaOptions(workDir));
		if (res.exitCode !== 0) {
			throw new Error(`tea issues list failed: ${formatTeaError(res)}`);
		}

		const issues = parseTeaIssueList(res.stdout);
		const tasks: Task[] = issues.map((issue) => ({
			id: `${issue.number}:${issue.title}`,
			title: issue.title,
			body: issue.body,
			completed: false,
		}));

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
		const issueNumber = Number.parseInt(id.split(":")[0], 10);
		if (Number.isNaN(issueNumber)) {
			throw new Error(`Invalid issue ID: ${id}`);
		}

		const res = await this.runner(["issues", "close", String(issueNumber)], this.teaOptions());
		if (res.exitCode !== 0) {
			throw new Error(`Failed to close issue #${issueNumber}: ${formatTeaError(res)}`);
		}

		this.invalidateCache();
	}

	async countRemaining(): Promise<number> {
		const tasks = await this.fetchOpenIssues();
		return tasks.length;
	}

	async countCompleted(): Promise<number> {
		if (this.isCacheValid() && this.cache && this.cache.closedCount >= 0) {
			return this.cache.closedCount;
		}

		const args = [
			"issues",
			"list",
			"--state",
			"closed",
			"--output",
			"json",
			"--fields",
			"index,title",
		];
		if (this.label) {
			args.push("--labels", this.label);
		}

		const res = await this.runner(args, this.teaOptions());
		if (res.exitCode !== 0) {
			// Best-effort: don't hard-fail runs if closed issues can't be listed.
			logWarn(`Failed to count closed Gitea issues (returning 0): ${formatTeaError(res)}`);
			return 0;
		}

		const closedCount = parseTeaIssueList(res.stdout).length;
		if (this.cache) {
			this.cache.closedCount = closedCount;
		}
		return closedCount;
	}
}
