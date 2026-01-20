import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import type { Task, TaskSource } from "./types.ts";

interface YamlTask {
	title: string;
	completed?: boolean;
	parallel_group?: number;
	description?: string;
}

interface YamlTaskFile {
	tasks: YamlTask[];
}

/**
 * YAML task source - reads tasks from YAML files
 * Format:
 * tasks:
 *   - title: "Task description"
 *     completed: false
 *     parallel_group: 1  # optional
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

	async getAllTasks(): Promise<Task[]> {
		const data = this.readFile();
		return (data.tasks || [])
			.filter((t) => !t.completed)
			.map((t, i) => ({
				id: t.title, // Use title as ID for YAML tasks
				title: t.title,
				body: t.description,
				parallelGroup: t.parallel_group,
				completed: false,
			}));
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const data = this.readFile();
		const task = data.tasks?.find((t) => t.title === id);
		if (task) {
			task.completed = true;
			this.writeFile(data);
		}
	}

	async countRemaining(): Promise<number> {
		const data = this.readFile();
		return (data.tasks || []).filter((t) => !t.completed).length;
	}

	async countCompleted(): Promise<number> {
		const data = this.readFile();
		return (data.tasks || []).filter((t) => t.completed).length;
	}

	/**
	 * Get tasks in a specific parallel group
	 */
	async getTasksInGroup(group: number): Promise<Task[]> {
		const data = this.readFile();
		return (data.tasks || [])
			.filter((t) => !t.completed && (t.parallel_group || 0) === group)
			.map((t) => ({
				id: t.title,
				title: t.title,
				body: t.description,
				parallelGroup: t.parallel_group,
				completed: false,
			}));
	}

	/**
	 * Get the parallel group of a task
	 */
	async getParallelGroup(title: string): Promise<number> {
		const data = this.readFile();
		const task = data.tasks?.find((t) => t.title === title);
		return task?.parallel_group || 0;
	}
}
