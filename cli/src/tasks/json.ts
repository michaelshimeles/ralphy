import { readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskSource } from "./types.ts";

interface JsonTask {
	title: string;
	completed?: boolean;
	parallel_group?: number;
	description?: string;
}

interface JsonTaskFile {
	name?: string;
	description?: string;
	tasks: JsonTask[];
}

export class JsonTaskSource implements TaskSource {
	type = "json" as const;
	private filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private readFile(): JsonTaskFile {
		try {
			const content = readFileSync(this.filePath, "utf-8");
			return JSON.parse(content) as JsonTaskFile;
		} catch (error) {
			throw new Error(
				`Failed to read JSON task file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private writeFile(data: JsonTaskFile): void {
		try {
		writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
		} catch (error) {
			throw new Error(
				`Failed to write JSON task file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async getAllTasks(): Promise<Task[]> {
		const data = this.readFile();
		if (!data.tasks || !Array.isArray(data.tasks)) {
			throw new Error("Invalid JSON task file: 'tasks' array is required");
		}
		const titles = new Set<string>();
		for (const task of data.tasks) {
			if (titles.has(task.title)) {
				throw new Error(`Duplicate JSON task title: ${task.title}`);
			}
			titles.add(task.title);
		}
		return data.tasks
			.filter((task) => !task.completed)
			.map((task) => ({
				id: task.title,
				title: task.title,
				body: task.description,
				parallelGroup: task.parallel_group,
				completed: false,
			}));
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const data = this.readFile();
		const task = data.tasks?.find((item) => item.title === id);
		if (task) {
			task.completed = true;
			this.writeFile(data);
		}
	}

	async countRemaining(): Promise<number> {
		const data = this.readFile();
		if (!data.tasks || !Array.isArray(data.tasks)) {
			throw new Error("Invalid JSON task file: 'tasks' array is required");
		}
		return data.tasks.filter((task) => !task.completed).length;
	}

	async countCompleted(): Promise<number> {
		const data = this.readFile();
		if (!data.tasks || !Array.isArray(data.tasks)) {
			throw new Error("Invalid JSON task file: 'tasks' array is required");
		}
		return data.tasks.filter((task) => task.completed).length;
	}

	async getTasksInGroup(group: number): Promise<Task[]> {
		const data = this.readFile();
		if (!data.tasks || !Array.isArray(data.tasks)) {
			throw new Error("Invalid JSON task file: 'tasks' array is required");
		}
		return data.tasks
			.filter((task) => !task.completed && (task.parallel_group || 0) === group)
			.map((task) => ({
				id: task.title,
				title: task.title,
				body: task.description,
				parallelGroup: task.parallel_group,
				completed: false,
			}));
	}

	async getParallelGroup(title: string): Promise<number> {
		const data = this.readFile();
		const task = data.tasks?.find((item) => item.title === title);
		return task?.parallel_group || 0;
	}
}
