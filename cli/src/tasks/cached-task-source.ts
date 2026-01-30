import { logError } from "../ui/logger.ts";
import type { Task, TaskSource, TaskSourceType } from "./types.ts";
import { YamlTaskSource } from "./yaml.ts";

interface CachedTaskSourceOptions {
	/**
	 * How often to flush pending completions to disk (ms).
	 * Set to 0 to disable auto-flush (manual flush only).
	 * Default: 1000ms
	 */
	flushIntervalMs?: number;
}

/**
 * A caching wrapper around any TaskSource that:
 * - Loads tasks once and caches them in memory
 * - Tracks completions in memory for instant filtering
 * - Batches markComplete() writes with debouncing
 *
 * IMPORTANT: Caller must call flush() before process exit to persist changes.
 * This class does NOT use exit handlers - async operations can't be awaited
 * reliably in exit handlers, so explicit flush() is required.
 */
export class CachedTaskSource implements TaskSource {
	private inner: TaskSource;
	private cachedTasks: Task[] | null = null;
	private pendingCompletions: Set<string> = new Set();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushIntervalMs: number;
	private flushRetryCount = 0;
	private isFlushing = false;
	private flushQueued = false;
	private static readonly MAX_FLUSH_RETRIES = 3;

	constructor(inner: TaskSource, options?: CachedTaskSourceOptions) {
		this.inner = inner;
		this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
	}

	get type(): TaskSourceType {
		return this.inner.type;
	}

	/**
	 * Get the underlying task source (useful for type checks)
	 */
	getInner(): TaskSource {
		return this.inner;
	}

	/**
	 * Check if the inner source is a YamlTaskSource
	 */
	isYamlSource(): boolean {
		return this.inner instanceof YamlTaskSource;
	}

	async getAllTasks(): Promise<Task[]> {
		if (!this.cachedTasks) {
			this.cachedTasks = await this.inner.getAllTasks();
		}
		// Filter out tasks that have been marked complete (pending flush)
		return this.cachedTasks.filter((t) => !this.pendingCompletions.has(t.id));
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] ?? null;
	}

	async markComplete(id: string): Promise<void> {
		this.pendingCompletions.add(id);
		this.scheduleFlush();
	}

	async countRemaining(): Promise<number> {
		const tasks = await this.getAllTasks();
		return tasks.length;
	}

	async countCompleted(): Promise<number> {
		// Get completed count from inner source + pending completions
		const innerCompleted = await this.inner.countCompleted();
		return innerCompleted + this.pendingCompletions.size;
	}

	/**
	 * Get tasks in a specific parallel group (filters out pending completions)
	 */
	async getTasksInGroup(group: number): Promise<Task[]> {
		if (!this.inner.getTasksInGroup) {
			throw new Error("Inner task source does not support getTasksInGroup");
		}
		const tasks = await this.inner.getTasksInGroup(group);
		return tasks.filter((t) => !this.pendingCompletions.has(t.id));
	}

	/**
	 * Get the parallel group of a task (YamlTaskSource only)
	 */
	async getParallelGroup(title: string): Promise<number> {
		if (!(this.inner instanceof YamlTaskSource)) {
			return 0;
		}
		return this.inner.getParallelGroup(title);
	}

	/**
	 * Flush all pending completions to the underlying source.
	 * Safe to call multiple times - no-op if nothing pending.
	 * IMPORTANT: Always call this before process exit to ensure data is persisted.
	 */
	async flush(): Promise<void> {
		if (this.isFlushing) {
			this.flushQueued = true;
			return;
		}

		this.isFlushing = true;
		try {
			if (this.flushTimer) {
				clearTimeout(this.flushTimer);
				this.flushTimer = null;
			}

			if (this.pendingCompletions.size === 0) {
				return;
			}

			// Write pending completions, removing each after success to avoid duplicates on retry
			for (const id of this.pendingCompletions) {
				await this.inner.markComplete(id);
				this.pendingCompletions.delete(id);
			}

			// Invalidate cache so next read picks up any external changes
			this.cachedTasks = null;
		} finally {
			this.isFlushing = false;
			if (this.flushQueued) {
				this.flushQueued = false;
				this.scheduleFlush();
			}
		}
	}

	/**
	 * Invalidate the cache, forcing a fresh read on next access.
	 * Does NOT flush pending completions.
	 */
	invalidateCache(): void {
		this.cachedTasks = null;
	}

	/**
	 * Check if there are pending completions waiting to be flushed
	 */
	hasPendingWrites(): boolean {
		return this.pendingCompletions.size > 0;
	}

	/**
	 * Dispose of the cached task source, cancelling any pending flush timer.
	 * Call this when you're done with the source to prevent memory leaks.
	 */
	dispose(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private scheduleFlush(): void {
		if (this.flushIntervalMs === 0) {
			// Auto-flush disabled
			return;
		}
		if (this.flushTimer) {
			// Already scheduled
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush()
				.then(() => {
					// Reset retry count on success
					this.flushRetryCount = 0;
				})
				.catch((err) => {
					this.flushRetryCount++;
					if (this.flushRetryCount < CachedTaskSource.MAX_FLUSH_RETRIES) {
						logError(
							`CachedTaskSource: Failed to flush (retry ${this.flushRetryCount}/${CachedTaskSource.MAX_FLUSH_RETRIES}): ${err}`,
						);
						this.scheduleFlush(); // Retry on failure
					} else {
						logError(
							`CachedTaskSource: Failed to flush after ${CachedTaskSource.MAX_FLUSH_RETRIES} retries: ${err}`,
						);
						this.flushRetryCount = 0;
					}
				});
		}, this.flushIntervalMs);
	}
}

/**
 * Wrap a TaskSource with caching.
 * Convenience function that returns the same type hints.
 */
export function withCache(source: TaskSource, options?: CachedTaskSourceOptions): CachedTaskSource {
	return new CachedTaskSource(source, options);
}
