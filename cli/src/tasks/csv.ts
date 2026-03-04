import { readFileSync, writeFileSync } from "node:fs";
import { logWarn } from "../ui/logger.ts";
import type { Task, TaskSource } from "./types.ts";

/**
 * Simple CSV parser - handles basic CSV format with proper escaping
 */
export function parseCSV(content: string): string[][] {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const rows: string[][] = [];
	let row: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];

		if (char === '"') {
			if (inQuotes && normalized[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (char === "," && !inQuotes) {
			row.push(current);
			current = "";
			continue;
		}

		if (char === "\n" && !inQuotes) {
			row.push(current);
			rows.push(row);
			row = [];
			current = "";
			continue;
		}

		current += char;
	}

	if (current.length > 0 || row.length > 0) {
		row.push(current);
		rows.push(row);
	}

	return rows;
}

function sanitizeCsvCell(value: string): string {
	if (/^[=+\-@]/.test(value)) {
		return `'${value}`;
	}
	return value;
}

/**
 * Escape a value for CSV output
 * Handles commas, quotes, newlines, and carriage returns
 */
export function escapeCsvValue(value: string): string {
	// Defensive: ensure value is a string
	if (value === null || value === undefined) {
		return "";
	}
	const strValue = String(value);
	const safeValue = sanitizeCsvCell(strValue);
	// Escape if contains special characters: comma, quote, newline, or carriage return
	if (/[",\n\r]/.test(safeValue)) {
		return `"${safeValue.replace(/"/g, '""')}"`;
	}
	return safeValue;
}

/**
 * Convert rows to CSV string
 */
export function rowsToCsv(rows: string[][]): string {
	return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
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
		const content = readFileSync(this.filePath, "utf-8");
		const rows = parseCSV(content);
		if (rows.length < 2) {
			return;
		}

		const header = rows[0].map((cell) => cell.trim().toLowerCase());
		const idIndex = header.indexOf("id");
		const titleIndex = header.indexOf("title");
		const doneIndex = Math.max(header.indexOf("done"), header.indexOf("completed"));
		const resolvedIdIndex = idIndex >= 0 ? idIndex : 0;
		const resolvedTitleIndex = titleIndex >= 0 ? titleIndex : 1;
		const resolvedDoneIndex = doneIndex >= 0 ? doneIndex : 2;
		if (doneIndex < 0) {
			logWarn(
				`CSV markComplete: no 'done'/'completed' header found for ${this.filePath}, falling back to column index 2.`,
			);
		}

		let updated = false;
		for (let i = 1; i < rows.length; i++) {
			const row = rows[i];
			const rowId = row[resolvedIdIndex] || "";
			const rowTitle = row[resolvedTitleIndex] || "";
			if (rowId === id || rowTitle === id) {
				while (row.length <= resolvedDoneIndex) {
					row.push("");
				}
				row[resolvedDoneIndex] = "1";
				updated = true;
				break;
			}
		}

		if (updated) {
			writeFileSync(this.filePath, rowsToCsv(rows), "utf-8");
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
	return rowsToCsv(rows);
}
