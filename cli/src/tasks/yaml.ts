import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import type { Task, TaskSource } from "./types.ts";

interface YamlTask {
	title: string;
	completed?: boolean;
	parallel_group?: number;
	description?: string;
	model?: string;
}

interface YamlTaskFile {
	tasks: Record<string, YamlTask[]> | YamlTask[];
}

/**
 * Normalized task entry with subsection info
 */
interface NormalizedTaskEntry {
	subsection: string;
	task: YamlTask;
	index: number;
}

/**
 * YAML task source - reads tasks from YAML files
 * Supports two formats:
 *
 * 1. Subsections format (with categories):
 * tasks:
 *   subsection-name:
 *     - title: "Task description"
 *       completed: false
 *       parallel_group: 1
 *       model: "opencode/kimi-k2.5-free"
 *
 * 2. Flat array format (no categories):
 * tasks:
 *   - title: "Task description"
 *     completed: false
 *     parallel_group: 1
 *     model: "opencode/kimi-k2.5-free"
 */
export class YamlTaskSource implements TaskSource {
	type = "yaml" as const;
	private filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private readFile(): YamlTaskFile {
		const content = readFileSync(this.filePath, "utf-8");
		return YAML.parse(content) as YamlTaskFile;
	}

	private writeFile(data: YamlTaskFile): void {
		writeFileSync(this.filePath, YAML.stringify(data), "utf-8");
	}

	/**
	 * Check if tasks is in flat array format or subsection format
	 */
	private isFlatArray(tasks: unknown): tasks is YamlTask[] {
		return Array.isArray(tasks);
	}

	/**
	 * Normalize tasks to a consistent format for processing
	 */
	private normalizeTasks(data: YamlTaskFile): NormalizedTaskEntry[] {
		const tasks = data.tasks || {};
		const entries: NormalizedTaskEntry[] = [];

		if (this.isFlatArray(tasks)) {
			// Flat array format - use "default" as subsection
			for (let i = 0; i < tasks.length; i++) {
				entries.push({
					subsection: "default",
					task: tasks[i],
					index: i,
				});
			}
		} else {
			// Subsection format
			for (const [subsection, taskList] of Object.entries(tasks)) {
				for (let i = 0; i < taskList.length; i++) {
					entries.push({
						subsection,
						task: taskList[i],
						index: i,
					});
				}
			}
		}

		return entries;
	}

	async getAllTasks(): Promise<Task[]> {
		const data = this.readFile();
		const entries = this.normalizeTasks(data);
		const tasks: Task[] = [];

		for (const entry of entries) {
			if (!entry.task.completed) {
				tasks.push({
					id: `${entry.subsection}:${entry.task.title}`,
					title: entry.task.title,
					body: entry.task.description,
					parallelGroup: entry.task.parallel_group,
					completed: false,
					model: entry.task.model,
				});
			}
		}

		return tasks;
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const data = this.readFile();
		const [subsection, title] = id.split(":", 2);

		if (!subsection || !title) {
			return;
		}

		const tasks = data.tasks || {};

		if (this.isFlatArray(tasks)) {
			// Flat array format - find by title
			const task = tasks.find((t) => t.title === title);
			if (task) {
				task.completed = true;
				this.writeFile(data);
			}
		} else {
			// Subsection format
			if (tasks[subsection]) {
				const task = tasks[subsection].find((t) => t.title === title);
				if (task) {
					task.completed = true;
					this.writeFile(data);
				}
			}
		}
	}

	async countRemaining(): Promise<number> {
		const data = this.readFile();
		const entries = this.normalizeTasks(data);
		return entries.filter((e) => !e.task.completed).length;
	}

	async countCompleted(): Promise<number> {
		const data = this.readFile();
		const entries = this.normalizeTasks(data);
		return entries.filter((e) => e.task.completed).length;
	}

	/**
	 * Get tasks in a specific parallel group
	 */
	async getTasksInGroup(group: number): Promise<Task[]> {
		const data = this.readFile();
		const entries = this.normalizeTasks(data);
		const tasks: Task[] = [];

		for (const entry of entries) {
			if (!entry.task.completed && (entry.task.parallel_group || 0) === group) {
				tasks.push({
					id: `${entry.subsection}:${entry.task.title}`,
					title: entry.task.title,
					body: entry.task.description,
					parallelGroup: entry.task.parallel_group,
					completed: false,
					model: entry.task.model,
				});
			}
		}

		return tasks;
	}

	/**
	 * Get the parallel group of a task
	 */
	async getParallelGroup(id: string): Promise<number> {
		const data = this.readFile();
		const [subsection, title] = id.split(":", 2);

		if (!subsection || !title) {
			return 0;
		}

		const tasks = data.tasks || {};

		if (this.isFlatArray(tasks)) {
			// Flat array format
			const task = tasks.find((t) => t.title === title);
			return task?.parallel_group || 0;
		}

		// Subsection format
		if (tasks[subsection]) {
			const task = tasks[subsection].find((t) => t.title === title);
			return task?.parallel_group || 0;
		}

		return 0;
	}
}
