import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Task } from "../tasks/types.ts";
import { logDebugContext, logErrorContext, logInfoContext } from "../ui/logger.ts";
import { MemoryTaskQueue } from "./memory-queue.ts";
import type { QueueItem, QueueStats, TaskPriority, TaskQueue } from "./queue.ts";

/**
 * Serialized queue item for persistence
 */
interface SerializedQueueItem {
	task: Task;
	priority: TaskPriority;
	enqueuedAt: string;
	startedAt?: string;
	completedAt?: string;
	attempts: number;
	maxAttempts: number;
	state: "pending" | "running" | "completed" | "failed" | "skipped";
}

/**
 * Queue snapshot for persistence
 */
interface QueueSnapshot {
	name: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	items: SerializedQueueItem[];
}

/**
 * File-based persistent task queue
 *
 * Features:
 * - Persists queue state to JSON file
 * - Survives process crashes/restarts
 * - Atomic writes (write to temp file, then rename)
 * - Auto-save on state changes
 * - Best for long-running or resumable sessions
 */
export class FileTaskQueue implements TaskQueue {
	readonly name: string;
	private filePath: string;
	private memoryQueue: MemoryTaskQueue;
	private autoSaveInterval: number;
	private saveTimer?: NodeJS.Timeout;
	private lastSaveTime: number = 0;
	private minSaveIntervalMs = 1000; // Don't save more than once per second

	constructor(name: string, filePath: string, options?: { autoSaveIntervalMs?: number }) {
		this.name = name;
		this.filePath = filePath;
		this.memoryQueue = new MemoryTaskQueue(name);
		this.autoSaveInterval = options?.autoSaveIntervalMs ?? 5000;
	}

	async initialize(): Promise<void> {
		logInfoContext("FileTaskQueue", `Initializing queue: ${this.name} at ${this.filePath}`);

		// Ensure directory exists
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Load existing state if present
		if (existsSync(this.filePath)) {
			try {
				await this.load();
				logInfoContext(
					"FileTaskQueue",
					`Loaded existing queue state with ${await this.getStats().then((s) => s.total)} tasks`,
				);
			} catch (error) {
				logErrorContext("FileTaskQueue", `Failed to load queue state: ${error}. Starting fresh.`);
			}
		}

		// Start auto-save timer
		this.startAutoSave();
	}

	async enqueue(task: Task, priority: TaskPriority = "normal", maxAttempts = 3): Promise<void> {
		await this.memoryQueue.enqueue(task, priority, maxAttempts);
		this.scheduleSave();
	}

	async dequeue(): Promise<QueueItem | null> {
		const item = await this.memoryQueue.dequeue();
		if (item) {
			this.scheduleSave();
		}
		return item;
	}

	async markRunning(taskId: string): Promise<void> {
		await this.memoryQueue.markRunning(taskId);
		this.scheduleSave();
	}

	async markComplete(taskId: string): Promise<void> {
		await this.memoryQueue.markComplete(taskId);
		this.scheduleSave();
	}

	async markFailed(taskId: string, error: string): Promise<void> {
		await this.memoryQueue.markFailed(taskId, error);
		this.scheduleSave();
	}

	async markSkipped(taskId: string): Promise<void> {
		await this.memoryQueue.markSkipped(taskId);
		this.scheduleSave();
	}

	async resetTask(taskId: string): Promise<void> {
		await this.memoryQueue.resetTask(taskId);
		this.scheduleSave();
	}

	async getPending(): Promise<QueueItem[]> {
		return this.memoryQueue.getPending();
	}

	async getRunning(): Promise<QueueItem[]> {
		return this.memoryQueue.getRunning();
	}

	async getCompleted(): Promise<QueueItem[]> {
		return this.memoryQueue.getCompleted();
	}

	async getFailed(): Promise<QueueItem[]> {
		return this.memoryQueue.getFailed();
	}

	async getStats(): Promise<QueueStats> {
		return this.memoryQueue.getStats();
	}

	async peek(): Promise<QueueItem | null> {
		return this.memoryQueue.peek();
	}

	async hasTask(taskId: string): Promise<boolean> {
		return this.memoryQueue.hasTask(taskId);
	}

	async getTask(taskId: string): Promise<QueueItem | null> {
		return this.memoryQueue.getTask(taskId);
	}

	async remove(taskId: string): Promise<void> {
		await this.memoryQueue.remove(taskId);
		this.scheduleSave();
	}

	async clear(): Promise<void> {
		await this.memoryQueue.clear();
		await this.save();
	}

	async close(): Promise<void> {
		this.stopAutoSave();
		await this.save();
		await this.memoryQueue.close();
		logInfoContext("FileTaskQueue", `Queue closed and saved: ${this.name}`);
	}

	/**
	 * Force immediate save
	 */
	async forceSave(): Promise<void> {
		await this.save();
	}

	private async load(): Promise<void> {
		const content = readFileSync(this.filePath, "utf-8");
		const snapshot: QueueSnapshot = JSON.parse(content);

		if (snapshot.version !== 1) {
			throw new Error(`Unsupported queue snapshot version: ${snapshot.version}`);
		}

		// Clear existing state
		await this.memoryQueue.clear();

		// Restore items
		for (const serialized of snapshot.items) {
			const item: QueueItem = {
				task: serialized.task,
				priority: serialized.priority,
				enqueuedAt: new Date(serialized.enqueuedAt),
				startedAt: serialized.startedAt ? new Date(serialized.startedAt) : undefined,
				completedAt: serialized.completedAt ? new Date(serialized.completedAt) : undefined,
				attempts: serialized.attempts,
				maxAttempts: serialized.maxAttempts,
			};

			// Restore to appropriate state
			switch (serialized.state) {
				case "pending":
				case "running": // Running tasks become pending on reload
					await this.memoryQueue.enqueue(item.task, item.priority, item.maxAttempts);
					break;
				case "completed":
					await this.memoryQueue.enqueue(item.task, item.priority, item.maxAttempts);
					await this.memoryQueue.dequeue(); // Move to running
					await this.memoryQueue.markComplete(item.task.id);
					break;
				case "failed":
					await this.memoryQueue.enqueue(item.task, item.priority, item.maxAttempts);
					await this.memoryQueue.dequeue(); // Move to running
					await this.memoryQueue.markFailed(item.task.id, "Restored from persistence");
					break;
				case "skipped":
					await this.memoryQueue.enqueue(item.task, item.priority, item.maxAttempts);
					await this.memoryQueue.markSkipped(item.task.id);
					break;
			}
		}
	}

	private async save(): Promise<void> {
		const now = Date.now();
		if (now - this.lastSaveTime < this.minSaveIntervalMs) {
			return; // Too soon, skip save
		}

		try {
			const pending = await this.memoryQueue.getPending();
			const running = await this.memoryQueue.getRunning();
			const completed = await this.memoryQueue.getCompleted();
			const failed = await this.memoryQueue.getFailed();
			const skipped = await this.memoryQueue.getSkipped();

			type ItemWithState = QueueItem & { state: "pending" | "running" | "completed" | "failed" | "skipped" };

			const items: SerializedQueueItem[] = [
				...pending.map((item): ItemWithState => ({ ...item, state: "pending" })),
				...running.map((item): ItemWithState => ({ ...item, state: "running" })),
				...completed.map((item): ItemWithState => ({ ...item, state: "completed" })),
				...failed.map((item): ItemWithState => ({ ...item, state: "failed" })),
				...skipped.map((item): ItemWithState => ({ ...item, state: "skipped" })),
			].map((item: ItemWithState) => ({
				task: item.task,
				priority: item.priority,
				enqueuedAt: item.enqueuedAt.toISOString(),
				startedAt: item.startedAt?.toISOString(),
				completedAt: item.completedAt?.toISOString(),
				attempts: item.attempts,
				maxAttempts: item.maxAttempts,
				state: item.state,
			}));

			const snapshot: QueueSnapshot = {
				name: this.name,
				version: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				items,
			};

			// Atomic write: write to temp file, then rename
			const tempPath = `${this.filePath}.tmp`;
			writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), "utf-8");

			// Rename is atomic on most filesystems
			const { renameSync } = require("node:fs");
			renameSync(tempPath, this.filePath);

			this.lastSaveTime = now;
			logDebugContext("FileTaskQueue", `Queue saved: ${items.length} tasks`);
		} catch (error) {
			logErrorContext("FileTaskQueue", `Failed to save queue: ${error}`);
			throw error;
		}
	}

	private scheduleSave(): void {
		// Debounce saves to avoid writing too frequently
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
		}

		this.saveTimer = setTimeout(() => {
			this.save().catch((err) => {
				logErrorContext("FileTaskQueue", `Auto-save failed: ${err}`);
			});
		}, 100); // Wait 100ms after last change before saving
	}

	private startAutoSave(): void {
		this.saveTimer = setInterval(() => {
			this.save().catch((err) => {
				logErrorContext("FileTaskQueue", `Periodic auto-save failed: ${err}`);
			});
		}, this.autoSaveInterval);
	}

	private stopAutoSave(): void {
		if (this.saveTimer) {
			clearInterval(this.saveTimer);
			this.saveTimer = undefined;
		}
	}
}
