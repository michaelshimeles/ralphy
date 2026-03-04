import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { Task, TaskSource } from "./types.ts";

/**
 * Read file content and normalize line endings to Unix format
 */
function readFileNormalized(filePath: string): string {
	return readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Cached file content with task counts for performance
 */
interface CachedContent {
	content: string;
	lines: string[];
	incompleteTasks: Task[];
	remainingCount: number;
	completedCount: number;
	fileMtime: number;
}

/**
 * Markdown task source - reads tasks from markdown files with checkbox format
 * Format: "- [ ] Task description" (incomplete) or "- [x] Task description" (complete)
 *
 * Performance optimized: caches file content and task counts to avoid redundant reads.
 */
export class MarkdownTaskSource implements TaskSource {
	type = "markdown" as const;
	private filePath: string;
	private cache: CachedContent | null = null;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	/**
	 * Get the file's modification time
	 */
	private getFileMtime(): number {
		try {
			return statSync(this.filePath).mtimeMs;
		} catch {
			return 0;
		}
	}

	/**
	 * Load and cache file content with parsed task data
	 */
	private loadCache(): CachedContent {
		const fileMtime = this.getFileMtime();
		const content = readFileNormalized(this.filePath);
		const lines = content.split("\n");
		const incompleteTasks: Task[] = [];
		let remainingCount = 0;
		let completedCount = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match incomplete tasks
			const incompleteMatch = line.match(/^- \[ \] (.+)$/);
			if (incompleteMatch) {
				incompleteTasks.push({
					id: String(i + 1), // Line number as ID
					title: incompleteMatch[1].trim(),
					completed: false,
				});
				remainingCount++;
			}

			// Match completed tasks
			if (/^- \[x\] /i.test(line)) {
				completedCount++;
			}
		}

		this.cache = {
			content,
			lines,
			incompleteTasks,
			remainingCount,
			completedCount,
			fileMtime,
		};

		return this.cache;
	}

	/**
	 * Get cached content or load fresh if file was modified externally
	 */
	private getCache(): CachedContent {
		if (!this.cache) {
			return this.loadCache();
		}
		// Check if file was modified externally
		const currentMtime = this.getFileMtime();
		if (currentMtime !== this.cache.fileMtime) {
			return this.loadCache();
		}
		return this.cache;
	}

	/**
	 * Invalidate cache (call after file modifications)
	 */
	private invalidateCache(): void {
		this.cache = null;
	}

	async getAllTasks(): Promise<Task[]> {
		return [...this.getCache().incompleteTasks];
	}

	async getNextTask(): Promise<Task | null> {
		const cache = this.getCache();
		return cache.incompleteTasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		// Force fresh read for modification to avoid stale data
		this.invalidateCache();
		const content = readFileNormalized(this.filePath);
		const lines = content.split("\n");
		const lineNumber = Number.parseInt(id, 10) - 1;

		if (lineNumber >= 0 && lineNumber < lines.length) {
			// Replace "- [ ]" with "- [x]"
			lines[lineNumber] = lines[lineNumber].replace(/^- \[ \] /, "- [x] ");
			try {
				writeFileSync(this.filePath, lines.join("\n"), "utf-8");
			} catch (error) {
				throw new Error(`Failed to write file: ${error instanceof Error ? error.message : error}`);
			}
			// Invalidate cache after modification
			this.invalidateCache();
		} else {
			throw new Error(`Invalid task ID: ${id}`);
		}
	}

	async countRemaining(): Promise<number> {
		return this.getCache().remainingCount;
	}

	async countCompleted(): Promise<number> {
		return this.getCache().completedCount;
	}
}
