import type { Task } from "../tasks/types.ts";
import { logDebugContext, logErrorContext } from "../ui/logger.ts";
import type { QueueItem, QueueStats, TaskPriority, TaskQueue } from "./queue.ts";

/**
 * In-memory task queue implementation
 *
 * Features:
 * - Priority-based task ordering
 * - O(1) operations for common cases
 * - No persistence (data lost on process exit)
 * - Best for short-lived CLI sessions
 */
export class MemoryTaskQueue implements TaskQueue {
	readonly name: string;

	// Separate maps for different states
	private pending: Map<string, QueueItem> = new Map();
	private running: Map<string, QueueItem> = new Map();
	private completed: Map<string, QueueItem> = new Map();
	private failed: Map<string, QueueItem> = new Map();
	private skipped: Map<string, QueueItem> = new Map();

	// Priority order: critical=0, high=1, normal=2, low=3
	private priorityOrder: Record<TaskPriority, number> = {
		critical: 0,
		high: 1,
		normal: 2,
		low: 3,
	};

	constructor(name: string) {
		this.name = name;
	}

	async initialize(): Promise<void> {
		logDebugContext("MemoryTaskQueue", `Initialized queue: ${this.name}`);
		// Nothing to initialize for in-memory queue
	}

	async enqueue(task: Task, priority: TaskPriority = "normal", maxAttempts = 3): Promise<void> {
		if (this.pending.has(task.id) || this.running.has(task.id)) {
			throw new Error(`Task ${task.id} already exists in queue`);
		}

		const item: QueueItem = {
			task,
			priority,
			enqueuedAt: new Date(),
			attempts: 0,
			maxAttempts,
		};

		this.pending.set(task.id, item);
		logDebugContext("MemoryTaskQueue", `Enqueued task: ${task.id} (priority: ${priority})`);
	}

	async dequeue(): Promise<QueueItem | null> {
		// Find the highest priority pending task
		let highestPriorityItem: QueueItem | null = null;
		let highestPriorityValue = Infinity;

		for (const item of this.pending.values()) {
			const priorityValue = this.priorityOrder[item.priority];
			// Lower number = higher priority
			if (priorityValue < highestPriorityValue) {
				highestPriorityValue = priorityValue;
				highestPriorityItem = item;
			} else if (priorityValue === highestPriorityValue) {
				// Same priority - use FIFO (earlier enqueued first)
				if (!highestPriorityItem || item.enqueuedAt < highestPriorityItem.enqueuedAt) {
					highestPriorityItem = item;
				}
			}
		}

		if (highestPriorityItem) {
			// Move from pending to running
			this.pending.delete(highestPriorityItem.task.id);
			highestPriorityItem.startedAt = new Date();
			highestPriorityItem.attempts++;
			this.running.set(highestPriorityItem.task.id, highestPriorityItem);

			logDebugContext("MemoryTaskQueue", `Dequeued task: ${highestPriorityItem.task.id}`);
		}

		return highestPriorityItem;
	}

	async markRunning(taskId: string): Promise<void> {
		// Task is already moved to running in dequeue()
		// This is here for interface compatibility
		logDebugContext("MemoryTaskQueue", `Task marked as running: ${taskId}`);
	}

	async markComplete(taskId: string): Promise<void> {
		const item = this.running.get(taskId);
		if (!item) {
			logErrorContext("MemoryTaskQueue", `Cannot complete task ${taskId} - not in running state`);
			return;
		}

		item.completedAt = new Date();
		this.running.delete(taskId);
		this.completed.set(taskId, item);

		logDebugContext("MemoryTaskQueue", `Task completed: ${taskId}`);
	}

	async markFailed(taskId: string, error: string): Promise<void> {
		const item = this.running.get(taskId);
		if (!item) {
			logErrorContext("MemoryTaskQueue", `Cannot fail task ${taskId} - not in running state`);
			return;
		}

		item.attempts++;

		if (item.attempts < item.maxAttempts) {
			// Retry - move back to pending
			item.startedAt = undefined;
			this.running.delete(taskId);
			this.pending.set(taskId, item);
			logDebugContext(
				"MemoryTaskQueue",
				`Task failed (will retry ${item.attempts}/${item.maxAttempts}): ${taskId} - ${error}`,
			);
		} else {
			// Max retries reached - mark as failed
			item.completedAt = new Date();
			this.running.delete(taskId);
			this.failed.set(taskId, item);
			logDebugContext("MemoryTaskQueue", `Task failed (max retries reached): ${taskId} - ${error}`);
		}
	}

	async markSkipped(taskId: string): Promise<void> {
		const item = this.pending.get(taskId) || this.running.get(taskId);
		if (!item) {
			logErrorContext("MemoryTaskQueue", `Cannot skip task ${taskId} - not found`);
			return;
		}

		item.completedAt = new Date();
		this.pending.delete(taskId);
		this.running.delete(taskId);
		this.skipped.set(taskId, item);

		logDebugContext("MemoryTaskQueue", `Task skipped: ${taskId}`);
	}

	async resetTask(taskId: string): Promise<void> {
		// Can reset failed or skipped tasks
		const item = this.failed.get(taskId) || this.skipped.get(taskId);
		if (!item) {
			logErrorContext("MemoryTaskQueue", `Cannot reset task ${taskId} - not in failed/skipped state`);
			return;
		}

		item.attempts = 0;
		item.startedAt = undefined;
		item.completedAt = undefined;

		this.failed.delete(taskId);
		this.skipped.delete(taskId);
		this.pending.set(taskId, item);

		logDebugContext("MemoryTaskQueue", `Task reset to pending: ${taskId}`);
	}

	async getPending(): Promise<QueueItem[]> {
		return Array.from(this.pending.values()).sort((a, b) => {
			const priorityDiff = this.priorityOrder[a.priority] - this.priorityOrder[b.priority];
			if (priorityDiff !== 0) return priorityDiff;
			return a.enqueuedAt.getTime() - b.enqueuedAt.getTime();
		});
	}

	async getRunning(): Promise<QueueItem[]> {
		return Array.from(this.running.values());
	}

	async getCompleted(): Promise<QueueItem[]> {
		return Array.from(this.completed.values());
	}

	async getFailed(): Promise<QueueItem[]> {
		return Array.from(this.failed.values());
	}

	async getSkipped(): Promise<QueueItem[]> {
		return Array.from(this.skipped.values());
	}

	async getStats(): Promise<QueueStats> {
		return {
			total: this.pending.size + this.running.size + this.completed.size + this.failed.size + this.skipped.size,
			pending: this.pending.size,
			running: this.running.size,
			completed: this.completed.size,
			failed: this.failed.size,
			skipped: this.skipped.size,
		};
	}

	async peek(): Promise<QueueItem | null> {
		// Look at the next task without removing it
		let highestPriorityItem: QueueItem | null = null;
		let highestPriorityValue = Infinity;

		for (const item of this.pending.values()) {
			const priorityValue = this.priorityOrder[item.priority];
			if (priorityValue < highestPriorityValue) {
				highestPriorityValue = priorityValue;
				highestPriorityItem = item;
			} else if (priorityValue === highestPriorityValue) {
				if (!highestPriorityItem || item.enqueuedAt < highestPriorityItem.enqueuedAt) {
					highestPriorityItem = item;
				}
			}
		}

		return highestPriorityItem;
	}

	async hasTask(taskId: string): Promise<boolean> {
		return (
			this.pending.has(taskId) ||
			this.running.has(taskId) ||
			this.completed.has(taskId) ||
			this.failed.has(taskId) ||
			this.skipped.has(taskId)
		);
	}

	async getTask(taskId: string): Promise<QueueItem | null> {
		return (
			this.pending.get(taskId) ||
			this.running.get(taskId) ||
			this.completed.get(taskId) ||
			this.failed.get(taskId) ||
			this.skipped.get(taskId) ||
			null
		);
	}

	async remove(taskId: string): Promise<void> {
		this.pending.delete(taskId);
		this.running.delete(taskId);
		this.completed.delete(taskId);
		this.failed.delete(taskId);
		this.skipped.delete(taskId);

		logDebugContext("MemoryTaskQueue", `Task removed: ${taskId}`);
	}

	async clear(): Promise<void> {
		this.pending.clear();
		this.running.clear();
		this.completed.clear();
		this.failed.clear();
		this.skipped.clear();

		logDebugContext("MemoryTaskQueue", `Queue cleared: ${this.name}`);
	}

	async close(): Promise<void> {
		// Nothing to close for in-memory queue
		logDebugContext("MemoryTaskQueue", `Queue closed: ${this.name}`);
	}
}
