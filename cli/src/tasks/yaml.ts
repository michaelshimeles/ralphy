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

export function hasPrototypePollution(obj: unknown): boolean {
	const MAX_DEPTH = 20;
	const MAX_NODES = 10000;
	const dangerousKeys = new Set(["__proto__"]);

	if (typeof obj !== "object" || obj === null) return false;

	const visited = new Set<unknown>();
	const queue: Array<{ value: unknown; depth: number }> = [{ value: obj, depth: 0 }];
	let head = 0;
	let nodesVisited = 0;

	while (head < queue.length) {
		const current = queue[head++];
		if (!current) continue;

		nodesVisited++;
		if (nodesVisited > MAX_NODES) {
			throw new Error("YAML file too complex to validate safely");
		}

		if (current.depth > MAX_DEPTH) {
			throw new Error("YAML file nesting exceeds safety limits");
		}

		if (typeof current.value !== "object" || current.value === null) {
			continue;
		}

		if (visited.has(current.value)) {
			continue;
		}
		visited.add(current.value);

		for (const key of Object.keys(current.value)) {
			if (dangerousKeys.has(key)) return true;
			const value = (current.value as Record<string, unknown>)[key];
			queue.push({ value, depth: current.depth + 1 });
		}
	}

	return false;
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
		try {
			const content = readFileSync(this.filePath, "utf-8");
			const parsed = YAML.parse(content) as YamlTaskFile;

			if (hasPrototypePollution(parsed)) {
				throw new Error("YAML file contains potentially malicious prototype pollution keys");
			}

			return parsed;
		} catch (error) {
			throw new Error(
				`Failed to read/parse YAML file: ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	private writeFile(data: YamlTaskFile): void {
		try {
			writeFileSync(this.filePath, YAML.stringify(data), "utf-8");
		} catch (error) {
			throw new Error(
				`Failed to write YAML file: ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	async getAllTasks(): Promise<Task[]> {
		const data = this.readFile();
		return (data.tasks || [])
			.filter((t) => !t.completed)
			.map((t, _i) => ({
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
