import type { Task } from "../tasks/types.ts";

/**
 * Task priority levels
 */
export type TaskPriority = "low" | "normal" | "high" | "critical";

/**
 * Task queue statistics
 */
export interface QueueStats {
	/** Total tasks in queue */
	total: number;
	/** Pending tasks (not yet started) */
	pending: number;
	/** Currently running tasks */
	running: number;
	/** Completed tasks */
	completed: number;
	/** Failed tasks */
	failed: number;
	/** Skipped tasks */
	skipped: number;
}

/**
 * Queue item with metadata
 */
export interface QueueItem {
	task: Task;
	priority: TaskPriority;
	enqueuedAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	attempts: number;
	maxAttempts: number;
}

/**
 * Task queue abstraction interface
 *
 * Provides a unified interface for task queuing with support for:
 * - Multiple backends (memory, file, Redis)
 * - Priority queuing
 * - Persistence and crash recovery
 * - Statistics and monitoring
 */
export interface TaskQueue {
	/**
	 * Queue name/identifier
	 */
	readonly name: string;

	/**
	 * Initialize the queue (load persisted state, etc.)
	 */
	initialize(): Promise<void>;

	/**
	 * Add a task to the queue
	 * @param task - The task to add
	 * @param priority - Priority level (default: "normal")
	 * @param maxAttempts - Maximum retry attempts (default: 3)
	 */
	enqueue(task: Task, priority?: TaskPriority, maxAttempts?: number): Promise<void>;

	/**
	 * Get the next pending task from the queue
	 * Returns null if no tasks available
	 */
	dequeue(): Promise<QueueItem | null>;

	/**
	 * Mark a task as running
	 * Called when a worker starts processing the task
	 */
	markRunning(taskId: string): Promise<void>;

	/**
	 * Mark a task as completed
	 */
	markComplete(taskId: string): Promise<void>;

	/**
	 * Mark a task as failed (will retry if attempts remain)
	 */
	markFailed(taskId: string, error: string): Promise<void>;

	/**
	 * Mark a task as skipped
	 */
	markSkipped(taskId: string): Promise<void>;

	/**
	 * Reset a failed/skipped task back to pending (for retry)
	 */
	resetTask(taskId: string): Promise<void>;

	/**
	 * Get all pending tasks
	 */
	getPending(): Promise<QueueItem[]>;

	/**
	 * Get all running tasks
	 */
	getRunning(): Promise<QueueItem[]>;

	/**
	 * Get all completed tasks
	 */
	getCompleted(): Promise<QueueItem[]>;

	/**
	 * Get all failed tasks
	 */
	getFailed(): Promise<QueueItem[]>;

	/**
	 * Get queue statistics
	 */
	getStats(): Promise<QueueStats>;

	/**
	 * Peek at the next task without removing it
	 */
	peek(): Promise<QueueItem | null>;

	/**
	 * Check if a task exists in the queue
	 */
	hasTask(taskId: string): Promise<boolean>;

	/**
	 * Get a specific task by ID
	 */
	getTask(taskId: string): Promise<QueueItem | null>;

	/**
	 * Remove a task from the queue
	 */
	remove(taskId: string): Promise<void>;

	/**
	 * Clear all tasks from the queue
	 */
	clear(): Promise<void>;

	/**
	 * Close the queue (save state, cleanup resources)
	 */
	close(): Promise<void>;
}

/**
 * Factory function to create appropriate queue instance
 */
export function createTaskQueue(
	type: "memory" | "file",
	options?: { name?: string; filePath?: string; autoSaveIntervalMs?: number },
): TaskQueue {
	const name = options?.name ?? "default";

	switch (type) {
		case "memory": {
			// Dynamic import to avoid circular dependencies
			const { MemoryTaskQueue } = require("./memory-queue.ts");
			return new MemoryTaskQueue(name);
		}
		case "file": {
			if (!options?.filePath) {
				throw new Error("FileTaskQueue requires filePath option");
			}
			// Dynamic import to avoid circular dependencies
			const { FileTaskQueue } = require("./file-queue.ts");
			return new FileTaskQueue(name, options.filePath, {
				autoSaveIntervalMs: options?.autoSaveIntervalMs,
			});
		}
		default:
			throw new Error(`Unknown queue type: ${type}`);
	}
}

export { FileTaskQueue } from "./file-queue.ts";
// Re-export implementations for direct use
export { MemoryTaskQueue } from "./memory-queue.ts";
