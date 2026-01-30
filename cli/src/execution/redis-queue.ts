/**
 * Redis-based task queue for horizontal scaling
 *
 * Enables distributed task processing across multiple machines
 * Requires Redis server to be running
 */

import type { Task } from "../tasks/types.ts";
import { logDebugContext, logErrorContext, logInfoContext } from "../ui/logger.ts";
import type { QueueItem, QueueStats, TaskPriority, TaskQueue } from "./queue.ts";

/**
 * Redis queue configuration
 */
export interface RedisQueueConfig {
	/** Redis connection URL (e.g., redis://localhost:6379) */
	url?: string;
	/** Redis host */
	host?: string;
	/** Redis port */
	port?: number;
	/** Redis password */
	password?: string;
	/** Redis database number */
	db?: number;
	/** Queue name/namespace */
	queueName: string;
	/** Key prefix for all keys */
	keyPrefix?: string;
	/** Lock timeout in seconds (for task ownership) */
	lockTimeoutSeconds?: number;
}

/**
 * Redis task queue implementation
 *
 * Features:
 * - Distributed across multiple machines
 * - Atomic operations using Redis transactions
 * - Task locking to prevent duplicate processing
 * - Automatic cleanup of stale locks
 * - Priority support using sorted sets
 */
export class RedisTaskQueue implements TaskQueue {
	readonly name: string;
	private config: RedisQueueConfig;
	private redis: RedisClient | null = null;
	private workerId: string;
	private lockTimeoutSeconds: number;

	// Priority mapping (lower number = higher priority)
	private priorityOrder: Record<TaskPriority, number> = {
		critical: 0,
		high: 1,
		normal: 2,
		low: 3,
	};

	constructor(config: RedisQueueConfig) {
		this.name = config.queueName;
		this.config = {
			host: "localhost",
			port: 6379,
			db: 0,
			keyPrefix: "ralphy:",
			lockTimeoutSeconds: 300, // 5 minutes default
			...config,
		};
		this.workerId = this.generateWorkerId();
		this.lockTimeoutSeconds = this.config.lockTimeoutSeconds || 300;
	}

	async initialize(): Promise<void> {
		logInfoContext("RedisTaskQueue", `Initializing queue: ${this.name}`);

		// Dynamic import of Redis client (optional dependency)
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ioredisModule: any = await import("ioredis").catch(() => null);
			if (!ioredisModule) {
				throw new Error("ioredis package not installed. Run: npm install ioredis");
			}
			const Redis = ioredisModule.default || ioredisModule;
			this.redis = new Redis({
				host: this.config.host,
				port: this.config.port,
				password: this.config.password,
				db: this.config.db,
				retryStrategy: (times: number) => {
					const delay = Math.min(times * 50, 2000);
					return delay;
				},
			});

			// Test connection
			await this.redis.ping();
			logInfoContext("RedisTaskQueue", `Connected to Redis at ${this.config.host}:${this.config.port}`);

			// Start cleanup interval for stale locks
			this.startStaleLockCleanup();
		} catch (error) {
			logErrorContext("RedisTaskQueue", `Failed to connect to Redis: ${error}`);
			throw new Error(`Redis connection failed: ${error}`);
		}
	}

	async enqueue(task: Task, priority: TaskPriority = "normal", maxAttempts = 3): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const item: QueueItem = {
			task,
			priority,
			enqueuedAt: new Date(),
			attempts: 0,
			maxAttempts,
		};

		const score = this.getPriorityScore(priority, item.enqueuedAt);
		const serialized = JSON.stringify({
			...item,
			enqueuedAt: item.enqueuedAt.toISOString(),
		});

		// Add to pending sorted set
		await this.redis.zadd(this.key("pending"), score, task.id);

		// Store task data in hash
		await this.redis.hset(this.key("tasks"), task.id, serialized);

		logDebugContext("RedisTaskQueue", `Enqueued task: ${task.id} (priority: ${priority}, score: ${score})`);
	}

	async dequeue(): Promise<QueueItem | null> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		// Use Lua script for atomic pop-and-lock operation
		const luaScript = `
			local taskId = redis.call('zrange', KEYS[1], 0, 0)[1]
			if not taskId then
				return nil
			end
			
			-- Remove from pending
			redis.call('zrem', KEYS[1], taskId)
			
			-- Add to running with lock
			local lockKey = KEYS[2] .. ':' .. taskId
			redis.call('setex', lockKey, ARGV[1], ARGV[2])
			
			-- Add to running set with timestamp
			redis.call('zadd', KEYS[3], ARGV[3], taskId)
			
			return taskId
		`;

		const now = Date.now();
		const taskId = (await this.redis.eval(
			luaScript,
			3, // number of keys
			this.key("pending"),
			this.key("locks"),
			this.key("running"),
			this.lockTimeoutSeconds,
			this.workerId,
			now,
		)) as string | null;

		if (!taskId) {
			return null;
		}

		// Get task data
		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (!data) {
			logErrorContext("RedisTaskQueue", `Task data not found: ${taskId}`);
			return null;
		}

		const parsed = JSON.parse(data);
		const item: QueueItem = {
			task: parsed.task,
			priority: parsed.priority,
			enqueuedAt: new Date(parsed.enqueuedAt),
			startedAt: new Date(),
			attempts: (parsed.attempts || 0) + 1,
			maxAttempts: parsed.maxAttempts || 3,
		};

		// Update task data
		await this.redis.hset(
			this.key("tasks"),
			taskId,
			JSON.stringify({
				...item,
				enqueuedAt: item.enqueuedAt.toISOString(),
				startedAt: item.startedAt?.toISOString(),
			}),
		);

		logDebugContext("RedisTaskQueue", `Dequeued task: ${taskId} by worker ${this.workerId}`);

		return item;
	}

	async markRunning(taskId: string): Promise<void> {
		// Already handled in dequeue
		logDebugContext("RedisTaskQueue", `Task marked as running: ${taskId}`);
	}

	async markComplete(taskId: string): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const now = Date.now();

		// Move from running to completed
		await this.redis.zrem(this.key("running"), taskId);
		await this.redis.zadd(this.key("completed"), now, taskId);

		// Update task data
		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (data) {
			const parsed = JSON.parse(data);
			parsed.completedAt = new Date().toISOString();
			await this.redis.hset(this.key("tasks"), taskId, JSON.stringify(parsed));
		}

		// Release lock
		await this.redis.del(`${this.key("locks")}:${taskId}`);

		logDebugContext("RedisTaskQueue", `Task completed: ${taskId}`);
	}

	async markFailed(taskId: string, error: string): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		// Get task data
		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (!data) {
			return;
		}

		const parsed = JSON.parse(data);
		const attempts = (parsed.attempts || 0) + 1;
		const maxAttempts = parsed.maxAttempts || 3;

		if (attempts < maxAttempts) {
			// Retry - move back to pending
			await this.redis.zrem(this.key("running"), taskId);

			const score = this.getPriorityScore(parsed.priority, new Date(parsed.enqueuedAt));
			await this.redis.zadd(this.key("pending"), score, taskId);

			parsed.attempts = attempts;
			parsed.error = error;
			parsed.startedAt = undefined;
			await this.redis.hset(this.key("tasks"), taskId, JSON.stringify(parsed));

			// Release lock
			await this.redis.del(`${this.key("locks")}:${taskId}`);

			logDebugContext("RedisTaskQueue", `Task failed (will retry ${attempts}/${maxAttempts}): ${taskId}`);
		} else {
			// Max retries reached
			const now = Date.now();
			await this.redis.zrem(this.key("running"), taskId);
			await this.redis.zadd(this.key("failed"), now, taskId);

			parsed.attempts = attempts;
			parsed.error = error;
			parsed.completedAt = new Date().toISOString();
			await this.redis.hset(this.key("tasks"), taskId, JSON.stringify(parsed));

			// Release lock
			await this.redis.del(`${this.key("locks")}:${taskId}`);

			logDebugContext("RedisTaskQueue", `Task failed (max retries): ${taskId}`);
		}
	}

	async markSkipped(taskId: string): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const now = Date.now();

		// Remove from pending/running and add to skipped
		await this.redis.zrem(this.key("pending"), taskId);
		await this.redis.zrem(this.key("running"), taskId);
		await this.redis.zadd(this.key("skipped"), now, taskId);

		// Update task data
		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (data) {
			const parsed = JSON.parse(data);
			parsed.completedAt = new Date().toISOString();
			await this.redis.hset(this.key("tasks"), taskId, JSON.stringify(parsed));
		}

		// Release lock if exists
		await this.redis.del(`${this.key("locks")}:${taskId}`);

		logDebugContext("RedisTaskQueue", `Task skipped: ${taskId}`);
	}

	async resetTask(taskId: string): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (!data) {
			return;
		}

		const parsed = JSON.parse(data);

		// Remove from failed/skipped
		await this.redis.zrem(this.key("failed"), taskId);
		await this.redis.zrem(this.key("skipped"), taskId);

		// Add to pending
		const score = this.getPriorityScore(parsed.priority, new Date(parsed.enqueuedAt));
		await this.redis.zadd(this.key("pending"), score, taskId);

		// Reset attempts
		parsed.attempts = 0;
		parsed.startedAt = undefined;
		parsed.completedAt = undefined;
		parsed.error = undefined;
		await this.redis.hset(this.key("tasks"), taskId, JSON.stringify(parsed));

		logDebugContext("RedisTaskQueue", `Task reset to pending: ${taskId}`);
	}

	async getPending(): Promise<QueueItem[]> {
		return this.getTasksFromSet("pending");
	}

	async getRunning(): Promise<QueueItem[]> {
		return this.getTasksFromSet("running");
	}

	async getCompleted(): Promise<QueueItem[]> {
		return this.getTasksFromSet("completed");
	}

	async getFailed(): Promise<QueueItem[]> {
		return this.getTasksFromSet("failed");
	}

	async getStats(): Promise<QueueStats> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const [pending, running, completed, failed, skipped] = await Promise.all([
			this.redis.zcard(this.key("pending")),
			this.redis.zcard(this.key("running")),
			this.redis.zcard(this.key("completed")),
			this.redis.zcard(this.key("failed")),
			this.redis.zcard(this.key("skipped")),
		]);

		return {
			total: pending + running + completed + failed + skipped,
			pending,
			running,
			completed,
			failed,
			skipped,
		};
	}

	async peek(): Promise<QueueItem | null> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const taskIds = await this.redis.zrange(this.key("pending"), 0, 0);
		if (taskIds.length === 0) {
			return null;
		}

		const data = await this.redis.hget(this.key("tasks"), taskIds[0]);
		if (!data) {
			return null;
		}

		return this.parseQueueItem(data);
	}

	async hasTask(taskId: string): Promise<boolean> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const exists = await this.redis.hexists(this.key("tasks"), taskId);
		return exists === 1;
	}

	async getTask(taskId: string): Promise<QueueItem | null> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const data = await this.redis.hget(this.key("tasks"), taskId);
		if (!data) {
			return null;
		}

		return this.parseQueueItem(data);
	}

	async remove(taskId: string): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		await Promise.all([
			this.redis.zrem(this.key("pending"), taskId),
			this.redis.zrem(this.key("running"), taskId),
			this.redis.zrem(this.key("completed"), taskId),
			this.redis.zrem(this.key("failed"), taskId),
			this.redis.zrem(this.key("skipped"), taskId),
			this.redis.hdel(this.key("tasks"), taskId),
			this.redis.del(`${this.key("locks")}:${taskId}`),
		]);

		logDebugContext("RedisTaskQueue", `Task removed: ${taskId}`);
	}

	async clear(): Promise<void> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const keys = [
			this.key("pending"),
			this.key("running"),
			this.key("completed"),
			this.key("failed"),
			this.key("skipped"),
			this.key("tasks"),
		];

		// Delete all keys
		await this.redis.del(...keys);

		logDebugContext("RedisTaskQueue", `Queue cleared: ${this.name}`);
	}

	async close(): Promise<void> {
		if (this.redis) {
			await this.redis.quit();
			this.redis = null;
			logInfoContext("RedisTaskQueue", `Queue closed: ${this.name}`);
		}
	}

	// Private helpers

	private key(suffix: string): string {
		return `${this.config.keyPrefix}${this.name}:${suffix}`;
	}

	private getPriorityScore(priority: TaskPriority, enqueuedAt: Date): number {
		const priorityValue = this.priorityOrder[priority];
		const timestamp = enqueuedAt.getTime();
		// Combine priority and timestamp: priority first, then FIFO within same priority
		return priorityValue * 1e15 + timestamp;
	}

	private generateWorkerId(): string {
		return `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private async getTasksFromSet(setName: string): Promise<QueueItem[]> {
		if (!this.redis) {
			throw new Error("Redis not initialized");
		}

		const taskIds = await this.redis.zrange(this.key(setName), 0, -1);
		if (taskIds.length === 0) {
			return [];
		}

		const data = await this.redis.hmget(this.key("tasks"), ...taskIds);

		return data
			.filter((d): d is string => d !== null)
			.map((d) => this.parseQueueItem(d))
			.filter((item): item is QueueItem => item !== null);
	}

	private parseQueueItem(data: string): QueueItem | null {
		try {
			const parsed = JSON.parse(data);
			return {
				task: parsed.task,
				priority: parsed.priority,
				enqueuedAt: new Date(parsed.enqueuedAt),
				startedAt: parsed.startedAt ? new Date(parsed.startedAt) : undefined,
				completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined,
				attempts: parsed.attempts || 0,
				maxAttempts: parsed.maxAttempts || 3,
			};
		} catch {
			return null;
		}
	}

	private startStaleLockCleanup(): void {
		// Clean up stale locks every 60 seconds
		setInterval(async () => {
			if (!this.redis) return;

			try {
				// Find tasks with expired locks
				const running = await this.redis.zrange(this.key("running"), 0, -1, "WITHSCORES");
				const now = Date.now();
				const staleThreshold = now - this.lockTimeoutSeconds * 1000;

				for (let i = 0; i < running.length; i += 2) {
					const taskId = running[i];
					const startTime = parseInt(running[i + 1], 10);

					if (startTime < staleThreshold) {
						// Lock is stale, move back to pending
						await this.redis.zrem(this.key("running"), taskId);

						const data = await this.redis.hget(this.key("tasks"), taskId);
						if (data) {
							const parsed = JSON.parse(data);
							const score = this.getPriorityScore(parsed.priority, new Date(parsed.enqueuedAt));
							await this.redis.zadd(this.key("pending"), score, taskId);
						}

						await this.redis.del(`${this.key("locks")}:${taskId}`);

						logDebugContext("RedisTaskQueue", `Cleaned up stale lock for task: ${taskId}`);
					}
				}
			} catch (error) {
				logErrorContext("RedisTaskQueue", `Error cleaning up stale locks: ${error}`);
			}
		}, 60000);
	}
}

/**
 * Redis client interface (minimal ioredis-compatible interface)
 */
interface RedisClient {
	ping(): Promise<string>;
	zadd(key: string, score: number, member: string): Promise<number>;
	zrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]>;
	zrem(key: string, ...members: string[]): Promise<number>;
	zcard(key: string): Promise<number>;
	hset(key: string, field: string, value: string): Promise<number>;
	hget(key: string, field: string): Promise<string | null>;
	hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
	hdel(key: string, ...fields: string[]): Promise<number>;
	hexists(key: string, field: string): Promise<number>;
	setex(key: string, seconds: number, value: string): Promise<string>;
	del(...keys: string[]): Promise<number>;
	eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
	quit(): Promise<string>;
}

// RedisQueueConfig already exported above
