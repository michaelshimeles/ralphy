import { readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskSource } from "./types.ts";

/**
 * Simple CSV parser - handles basic CSV format with proper escaping
 */
export function parseCSV(content: string): string[][] {
	const lines = content.trim().split(/\r?\n/);
	return lines.map((line) => {
		const values: string[] = [];
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
			} else if (char === "," && !inQuotes) {
				values.push(current);
				current = "";
			} else {
				current += char;
			}
		}
		values.push(current);
		return values;
	});
}

/**
 * Escape a value for CSV output
 */
function escapeCSV(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Convert rows to CSV string
 */
function toCSV(rows: string[][]): string {
	return rows.map((row) => row.map(escapeCSV).join(",")).join("\n");
}

interface CsvTask {
	id: string;
	title: string;
	completed: boolean;
	parallelGroup: number;
	description: string;
}

/**
 * CSV task source - reads tasks from CSV files
 * Format: id,title,completed,group,desc
 */
export class CsvTaskSource implements TaskSource {
	type = "csv" as const;
	private filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private readFile(): CsvTask[] {
		const content = readFileSync(this.filePath, "utf-8");
		const rows = parseCSV(content);

		// Skip header row
		const tasks: CsvTask[] = [];
		for (let i = 1; i < rows.length; i++) {
			const row = rows[i];
			if (row.length >= 2) {
				tasks.push({
					id: row[0] || String(i),
					title: row[1] || "",
					completed: row[2] === "1" || row[2]?.toLowerCase() === "true",
					parallelGroup: Number.parseInt(row[3] || "0", 10) || 0,
					description: row[4] || "",
				});
			}
		}
		return tasks;
	}

	private writeFile(tasks: CsvTask[]): void {
		const rows: string[][] = [["id", "title", "done", "group", "desc"]];
		for (const task of tasks) {
			rows.push([
				task.id,
				task.title,
				task.completed ? "1" : "0",
				String(task.parallelGroup),
				task.description,
			]);
		}
		writeFileSync(this.filePath, toCSV(rows), "utf-8");
	}

	async getAllTasks(): Promise<Task[]> {
		const tasks = this.readFile();
		return tasks
			.filter((t) => !t.completed)
			.map((t) => ({
				id: t.id,
				title: t.title,
				body: t.description || undefined,
				parallelGroup: t.parallelGroup || undefined,
				completed: false,
			}));
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const tasks = this.readFile();
		const task = tasks.find((t) => t.id === id || t.title === id);
		if (task) {
			task.completed = true;
			this.writeFile(tasks);
		}
	}

	async countRemaining(): Promise<number> {
		const tasks = this.readFile();
		return tasks.filter((t) => !t.completed).length;
	}

	async countCompleted(): Promise<number> {
		const tasks = this.readFile();
		return tasks.filter((t) => t.completed).length;
	}

	/**
	 * Get tasks in a specific parallel group
	 */
	async getTasksInGroup(group: number): Promise<Task[]> {
		const tasks = this.readFile();
		return tasks
			.filter((t) => !t.completed && t.parallelGroup === group)
			.map((t) => ({
				id: t.id,
				title: t.title,
				body: t.description || undefined,
				parallelGroup: t.parallelGroup || undefined,
				completed: false,
			}));
	}
}

/**
 * Convert tasks array to compact CSV string for prompts
 */
export function tasksToCompactCsv(tasks: Task[]): string {
	if (tasks.length === 0) return "";

	const rows: string[][] = [["#", "task", "grp"]];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i];
		rows.push([String(i + 1), t.title, t.parallelGroup ? String(t.parallelGroup) : "0"]);
	}
	return toCSV(rows);
}
