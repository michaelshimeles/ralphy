/**
 * Task State Manager
 *
 * Centralized state management for task execution.
 * Provides a single source of truth for task states across all execution modes.
 * State is persisted in the same format as the input source (YAML, JSON, CSV, MD).
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { RALPHY_DIR } from "../config/loader.ts";
import type { Task, TaskSourceType } from "../tasks/types.ts";
import { logDebug, logError } from "../ui/logger.ts";

export enum TaskState {
	PENDING = "pending",
	RUNNING = "running",
	COMPLETED = "completed",
	FAILED = "failed",
	DEFERRED = "deferred",
	SKIPPED = "skipped",
}

export interface TaskStateEntry {
	id: string;
	title: string;
	state: TaskState;
	attemptCount: number;
	lastAttemptTime?: number;
	errorHistory: string[];
	executionContext?: {
		branch?: string;
		worktree?: string;
		sandbox?: string;
	};
}

interface StateFileFormat {
	version: number;
	lastUpdated: string;
	tasks: Record<string, TaskStateEntry>;
}

export type StateFormat = "yaml" | "json" | "csv" | "md";

export function detectStateFormat(filePath: string | undefined): StateFormat {
	if (!filePath) return "yaml";
	if (filePath.endsWith(".json")) return "json";
	if (filePath.endsWith(".csv")) return "csv";
	if (filePath.endsWith(".md")) return "md";
	return "yaml";
}

export class TaskStateManager {
	private stateFilePath: string;
	private tasks: Map<string, TaskStateEntry> = new Map();
	private format: StateFormat;
	private sourceType: TaskSourceType;
	private sourcePath: string;
	private static readonly STATE_VERSION = 1;
	private static readonly CLAIM_LOCK_TIMEOUT_MS = 5000;
	private static readonly CLAIM_LOCK_RETRY_MS = 50;

	constructor(
		workDir: string,
		sourceType: TaskSourceType,
		sourcePath: string,
		format: StateFormat = "yaml",
	) {
		this.sourceType = sourceType;
		this.sourcePath = sourcePath;
		this.format = format;
		this.stateFilePath = join(workDir, RALPHY_DIR, `task-state.${format}`);
	}

	/**
	 * Initialize the state manager with tasks from the source.
	 * Loads existing state if available, or creates new state from tasks.
	 */
	async initialize(tasksFromSource: Task[]): Promise<void> {
		// Ensure directory exists
		const dir = dirname(this.stateFilePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Try to load existing state
		if (existsSync(this.stateFilePath)) {
			await this.loadState();
		}

		// Reset any RUNNING tasks to PENDING (they were interrupted)
		// and any DEFERRED tasks that have exceeded max deferrals
		let resetCount = 0;
		for (const [_key, task] of this.tasks) {
			if (task.state === TaskState.RUNNING) {
				logDebug(`Resetting interrupted task ${task.id} from RUNNING to PENDING`);
				task.state = TaskState.PENDING;
				// Reset attemptCount on fresh program start to prevent accumulation
				// This ensures retries don't persist across program restarts
				task.attemptCount = 0;
				resetCount++;
			}
		}
		if (resetCount > 0) {
			logDebug(`Reset ${resetCount} interrupted tasks to PENDING (attempt counts cleared)`);
		}

		// Merge with new tasks from source
		for (const task of tasksFromSource) {
			const key = this.buildTaskKey(task.id);
			const existing = this.tasks.get(key);

			if (!existing) {
				// New task - add with pending state
				this.tasks.set(key, {
					id: task.id,
					title: task.title,
					state: TaskState.PENDING,
					attemptCount: 0,
					errorHistory: [],
				});
			} else {
				// Existing task - update title if changed
				existing.title = task.title;
			}
		}

		// Remove tasks that no longer exist in source
		const validKeys = new Set(tasksFromSource.map((t) => this.buildTaskKey(t.id)));
		for (const key of this.tasks.keys()) {
			if (!validKeys.has(key)) {
				this.tasks.delete(key);
			}
		}

		await this.persistState();
		logDebug(`TaskStateManager initialized with ${this.tasks.size} tasks`);
	}

	/**
	 * Atomically claim a task for execution.
	 * Returns true if the task was claimed (was in PENDING state), false otherwise.
	 */
	async claimTaskForExecution(taskId: string): Promise<boolean> {
		const release = await this.acquireClaimLock();

		try {
			await this.loadState();

			const key = this.buildTaskKey(taskId);
			const task = this.tasks.get(key);

			if (!task) {
				logError(`Task ${taskId} not found in state manager`);
				return false;
			}

			// Only allow claiming if task is pending
			if (task.state !== TaskState.PENDING) {
				logDebug(`Task ${taskId} cannot be claimed - state is ${task.state}`);
				return false;
			}

			// Atomically transition to running
			task.state = TaskState.RUNNING;
			task.attemptCount++;
			task.lastAttemptTime = Date.now();
			await this.persistState();

			logDebug(`Task ${taskId} claimed for execution (attempt ${task.attemptCount})`);
			return true;
		} finally {
			release();
		}
	}

	/**
	 * Transition a task to a new state.
	 */
	async transitionState(
		taskId: string,
		newState: TaskState,
		error?: string,
		executionContext?: TaskStateEntry["executionContext"],
	): Promise<void> {
		const key = this.buildTaskKey(taskId);
		const task = this.tasks.get(key);

		if (!task) {
			logError(`Task ${taskId} not found in state manager`);
			return;
		}

		const oldState = task.state;
		task.state = newState;

		if (error) {
			task.errorHistory.push(error);
		}

		if (executionContext) {
			task.executionContext = { ...task.executionContext, ...executionContext };
		}

		await this.persistState();
		logDebug(`Task ${taskId} transitioned from ${oldState} to ${newState}`);
	}

	/**
	 * Get the next pending task that can be executed.
	 */
	getNextPendingTask(): TaskStateEntry | null {
		for (const task of this.tasks.values()) {
			if (task.state === TaskState.PENDING) {
				return task;
			}
		}
		return null;
	}

	/**
	 * Get all tasks in a specific state.
	 */
	getTasksByState(state: TaskState): TaskStateEntry[] {
		return Array.from(this.tasks.values()).filter((t) => t.state === state);
	}

	/**
	 * Get the current state of a task.
	 */
	getTaskState(taskId: string): TaskState | null {
		const key = this.buildTaskKey(taskId);
		return this.tasks.get(key)?.state ?? null;
	}

	/**
	 * Check if a task has exceeded the maximum number of attempts.
	 */
	hasExceededMaxAttempts(taskId: string, maxRetries: number): boolean {
		const key = this.buildTaskKey(taskId);
		const task = this.tasks.get(key);
		if (!task) return false;
		return task.attemptCount >= maxRetries;
	}

	private async acquireClaimLock(): Promise<() => void> {
		const lockPath = `${this.stateFilePath}.claim.lock`;
		const deadline = Date.now() + TaskStateManager.CLAIM_LOCK_TIMEOUT_MS;

		while (true) {
			try {
				const fd = openSync(lockPath, "wx");
				writeFileSync(fd, String(process.pid));

				return () => {
					try {
						closeSync(fd);
					} catch {
						// ignore close errors
					}
					try {
						if (existsSync(lockPath)) {
							unlinkSync(lockPath);
						}
					} catch {
						// ignore unlock errors
					}
				};
			} catch {
				if (Date.now() >= deadline) {
					throw new Error("Timeout acquiring task-state claim lock");
				}
				await new Promise((resolve) => setTimeout(resolve, TaskStateManager.CLAIM_LOCK_RETRY_MS));
			}
		}
	}

	/**
	 * Get the number of remaining pending tasks.
	 */
	countPending(): number {
		return this.getTasksByState(TaskState.PENDING).length;
	}

	/**
	 * Get summary statistics.
	 */
	getStats(): {
		total: number;
		pending: number;
		running: number;
		completed: number;
		failed: number;
		deferred: number;
		skipped: number;
	} {
		return {
			total: this.tasks.size,
			pending: this.getTasksByState(TaskState.PENDING).length,
			running: this.getTasksByState(TaskState.RUNNING).length,
			completed: this.getTasksByState(TaskState.COMPLETED).length,
			failed: this.getTasksByState(TaskState.FAILED).length,
			deferred: this.getTasksByState(TaskState.DEFERRED).length,
			skipped: this.getTasksByState(TaskState.SKIPPED).length,
		};
	}

	/**
	 * Reset a task to pending state (for retrying failed/skipped tasks).
	 * Also resets the attempt count so retries don't accumulate across program restarts.
	 */
	async resetTask(taskId: string): Promise<void> {
		const key = this.buildTaskKey(taskId);
		const task = this.tasks.get(key);

		if (!task) {
			logError(`Task ${taskId} not found in state manager`);
			return;
		}

		task.state = TaskState.PENDING;
		task.attemptCount = 0;
		task.errorHistory = [];
		await this.persistState();
		logDebug(`Task ${taskId} reset to pending state`);
	}

	/**
	 * Reset all failed/skipped tasks to pending.
	 * Also resets the attempt count so retries don't accumulate across program restarts.
	 */
	async resetAllFailed(): Promise<number> {
		let count = 0;
		for (const [_key, task] of this.tasks) {
			if (task.state === TaskState.FAILED || task.state === TaskState.SKIPPED) {
				task.state = TaskState.PENDING;
				task.attemptCount = 0;
				task.errorHistory = [];
				count++;
			}
		}
		if (count > 0) {
			await this.persistState();
		}
		logDebug(`Reset ${count} failed/skipped tasks to pending`);
		return count;
	}

	/**
	 * Reset attempt counts for all tasks when starting a fresh run.
	 * This ensures retries don't persist across program restarts.
	 */
	async resetAllAttemptCounts(): Promise<void> {
		for (const task of this.tasks.values()) {
			task.attemptCount = 0;
		}
		await this.persistState();
		logDebug("Reset all task attempt counts");
	}

	/**
	 * Build a unique key for a task.
	 */
	private buildTaskKey(taskId: string): string {
		return `${this.sourceType}:${this.sourcePath}:${taskId}`;
	}

	/**
	 * Check for prototype pollution keys in data
	 */
	private hasPrototypePollution(data: unknown): boolean {
		if (data === null || typeof data !== "object") {
			return false;
		}

		const pollutionKeys = ["__proto__", "constructor", "prototype"];

		for (const key of Object.keys(data)) {
			if (pollutionKeys.includes(key)) {
				return true;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const value = (data as Record<string, unknown>)[key];
			if (typeof value === "object" && value !== null) {
				if (this.hasPrototypePollution(value)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Persist state to disk in the appropriate format.
	 */
	private async persistState(): Promise<void> {
		// Validate format before proceeding
		if (!this.format || !["yaml", "json", "csv", "md"].includes(this.format)) {
			throw new Error(`Invalid state format: ${this.format}`);
		}

		// Check for prototype pollution before persisting
		const rawTasks = Object.fromEntries(this.tasks);
		if (this.hasPrototypePollution(rawTasks)) {
			throw new Error("State contains potentially malicious prototype pollution keys");
		}

		const data: StateFileFormat = {
			version: TaskStateManager.STATE_VERSION,
			lastUpdated: new Date().toISOString(),
			tasks: rawTasks,
		};

		const tempPath = `${this.stateFilePath}.tmp`;

		try {
			let content: string;

			switch (this.format) {
				case "yaml":
					content = YAML.stringify(data);
					break;
				case "json":
					content = JSON.stringify(data, null, 2);
					break;
				case "csv":
					content = this.toCSV(data);
					break;
				case "md":
					content = this.toMarkdown(data);
					break;
				default:
					content = YAML.stringify(data);
			}

			// Write to temp file first, then rename for atomicity (TOCTOU-safe)
			writeFileSync(tempPath, content, "utf-8");
			renameSync(tempPath, this.stateFilePath);
		} catch (error) {
			// Clean up temp file on error to prevent stale file accumulation
			try {
				if (existsSync(tempPath)) {
					unlinkSync(tempPath);
				}
			} catch {
				// Ignore cleanup errors
			}
			logError(`Failed to persist task state: ${error}`);
			throw error;
		}
	}

	/**
	 * Load state from disk.
	 */
	private async loadState(): Promise<void> {
		// Validate format before proceeding
		if (!this.format || !["yaml", "json", "csv", "md"].includes(this.format)) {
			logError(`Invalid state format: ${this.format}`);
			this.tasks = new Map();
			return;
		}

		try {
			const content = readFileSync(this.stateFilePath, "utf-8");
			let data: StateFileFormat;

			switch (this.format) {
				case "yaml":
					data = YAML.parse(content) as StateFileFormat;
					break;
				case "json":
					// SECURITY: Parse JSON safely and check for prototype pollution
					try {
						data = JSON.parse(content) as StateFileFormat;
					} catch (parseError) {
						throw new Error(`Invalid JSON in state file: ${parseError}`);
					}
					break;
				case "csv":
					data = this.fromCSV(content);
					break;
				case "md":
					data = this.fromMarkdown(content);
					break;
				default:
					data = YAML.parse(content) as StateFileFormat;
			}

			// Validate data structure before using
			if (!data || typeof data !== "object") {
				throw new Error("State file contains invalid data structure");
			}

			// Validate no prototype pollution keys using deep check
			if (this.hasPrototypePollution(data)) {
				throw new Error("State file contains potentially malicious prototype pollution keys");
			}

			if (data.version !== TaskStateManager.STATE_VERSION) {
				logDebug(
					`Migrating state file from version ${data.version} to ${TaskStateManager.STATE_VERSION}`,
				);
			}

			// Validate tasks is an object before creating Map
			if (!data.tasks || typeof data.tasks !== "object") {
				logDebug("State file has no tasks or invalid tasks structure");
				this.tasks = new Map();
				return;
			}

			this.tasks = new Map(Object.entries(data.tasks));
			logDebug(`Loaded ${this.tasks.size} tasks from state file`);
		} catch (error) {
			logError(`Failed to load task state: ${error}`);
			this.tasks = new Map();
		}
	}

	/**
	 * Convert state to CSV format.
	 */
	private toCSV(data: StateFileFormat): string {
		const headers = [
			"key",
			"id",
			"title",
			"state",
			"attemptCount",
			"lastAttemptTime",
			"errorHistory",
		];
		const rows = Object.entries(data.tasks).map(([key, task]) => [
			key,
			task.id,
			task.title,
			task.state,
			task.attemptCount,
			task.lastAttemptTime ?? "",
			task.errorHistory.join("|"),
		]);

		return [
			headers.map((h) => this.csvField(h)).join(","),
			...rows.map((r) => r.map((v) => this.csvField(v)).join(",")),
		].join("\n");
	}

	/**
	 * Parse state from CSV format.
	 */
	private fromCSV(content: string): StateFileFormat {
		const records = this.parseCsvRecords(content);
		if (records.length < 2) {
			return {
				version: TaskStateManager.STATE_VERSION,
				lastUpdated: new Date().toISOString(),
				tasks: {},
			};
		}

		const tasks: Record<string, TaskStateEntry> = {};
		for (let i = 1; i < records.length; i++) {
			const line = records[i];
			if (!line || line.trim().length === 0) {
				continue;
			}

			const parts = this.parseCSVLine(line);
			if (parts.length >= 4) {
				const key = parts[0];
				const id = parts[1];
				const title = parts[2];
				const state = parts[3] as TaskState;
				const attemptCount = parts[4];
				const lastAttemptTime = parts[5];
				const errorHistory = parts[6];

				// Skip entries with invalid key
				if (!key) continue;

				// Validate state is a valid TaskState
				const validStates = Object.values(TaskState);
				if (!validStates.includes(state)) {
					logDebug(`Skipping CSV row with invalid state: ${state}`);
					continue;
				}

				tasks[key] = {
					id: id || key,
					title: title || "Unknown",
					state: state,
					attemptCount: attemptCount ? Number.parseInt(attemptCount, 10) || 0 : 0,
					lastAttemptTime: lastAttemptTime
						? Number.parseInt(lastAttemptTime, 10) || undefined
						: undefined,
					errorHistory: errorHistory ? errorHistory.split("|").filter(Boolean) : [],
				};
			}
		}

		return {
			version: TaskStateManager.STATE_VERSION,
			lastUpdated: new Date().toISOString(),
			tasks,
		};
	}

	private csvField(value: string | number): string {
		const str = String(value);
		if (str.includes(",") || str.includes('"') || str.includes("\n")) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	}

	private parseCsvRecords(content: string): string[] {
		const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const records: string[] = [];
		let current = "";
		let inQuotes = false;

		for (let i = 0; i < normalized.length; i++) {
			const char = normalized[i];

			if (char === '"') {
				if (inQuotes && normalized[i + 1] === '"') {
					current += '""';
					i++;
				} else {
					inQuotes = !inQuotes;
					current += char;
				}
				continue;
			}

			if (char === "\n" && !inQuotes) {
				records.push(current);
				current = "";
				continue;
			}

			current += char;
		}

		if (current.length > 0) {
			records.push(current);
		}

		return records.filter((record) => record.trim().length > 0);
	}

	private parseCSVLine(line: string): string[] {
		const parts: string[] = [];
		let current = "";
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = !inQuotes;
				}
				continue;
			}

			if (char === "," && !inQuotes) {
				parts.push(current.trim());
				current = "";
				continue;
			}

			current += char;
		}

		parts.push(current.trim());
		return parts;
	}

	/**
	 * Convert state to Markdown format.
	 */
	private toMarkdown(data: StateFileFormat): string {
		const lines = ["# Task State", "", `Last Updated: ${data.lastUpdated}`, ""];

		for (const [key, task] of Object.entries(data.tasks)) {
			lines.push(`## ${task.title} (${key})`);
			lines.push("");
			lines.push(`- **State**: ${task.state}`);
			lines.push(`- **Attempt Count**: ${task.attemptCount}`);
			if (task.lastAttemptTime) {
				lines.push(`- **Last Attempt**: ${new Date(task.lastAttemptTime).toISOString()}`);
			}
			if (task.errorHistory.length > 0) {
				lines.push(`- **Errors**: ${task.errorHistory.join(", ")}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Parse state from Markdown format.
	 */
	private fromMarkdown(content: string): StateFileFormat {
		const tasks: Record<string, TaskStateEntry> = {};
		const sections = content.split(/\n## /);

		for (const section of sections.slice(1)) {
			const lines = section.split("\n");
			const titleMatch = lines[0].match(/(.+) \((.+)\)/);
			if (!titleMatch) continue;

			const [, title, key] = titleMatch;
			const task: TaskStateEntry = {
				id: "",
				title,
				state: TaskState.PENDING,
				attemptCount: 0,
				errorHistory: [],
			};

			for (const line of lines) {
				if (line.startsWith("- **State**: ")) {
					task.state = line.replace("- **State**: ", "").trim() as TaskState;
				} else if (line.startsWith("- **Attempt Count**: ")) {
					task.attemptCount = Number.parseInt(line.replace("- **Attempt Count**: ", ""), 10) || 0;
				} else if (line.startsWith("- **Last Attempt**: ")) {
					const dateStr = line.replace("- **Last Attempt**: ", "").trim();
					task.lastAttemptTime = new Date(dateStr).getTime();
				} else if (line.startsWith("- **Errors**: ")) {
					task.errorHistory = line
						.replace("- **Errors**: ", "")
						.split(", ")
						.map((s) => s.trim())
						.filter(Boolean);
				}
			}

			// Extract ID from key
			const idMatch = key.match(/[^:]+:[^:]+:(.+)/);
			if (idMatch) {
				task.id = idMatch[1];
			}

			tasks[key] = task;
		}

		return {
			version: TaskStateManager.STATE_VERSION,
			lastUpdated: new Date().toISOString(),
			tasks,
		};
	}
}
