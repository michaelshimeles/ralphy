import { readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskSource } from "./types.ts";

/**
 * Markdown task source - reads tasks from markdown files with checkbox format
 * Format: "- [ ] Task description" (incomplete) or "- [x] Task description" (complete)
 */
export class MarkdownTaskSource implements TaskSource {
	type = "markdown" as const;
	private filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async getAllTasks(): Promise<Task[]> {
		const content = readFileSync(this.filePath, "utf-8").replace(/\r/g, "");
		const tasks: Task[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match incomplete tasks (handle CRLF line endings)
			const incompleteMatch = line.match(/^- \[ \] (.+)$/);
			if (incompleteMatch) {
				tasks.push({
					id: String(i + 1), // Line number as ID
					title: incompleteMatch[1].trim(),
					completed: false,
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
		const content = readFileSync(this.filePath, "utf-8");
		const normalizedContent = content.replace(/\r/g, "");
		const lines = normalizedContent.split("\n");
		const lineNumber = Number.parseInt(id, 10) - 1;

		if (lineNumber >= 0 && lineNumber < lines.length) {
			// Replace "- [ ]" with "- [x]"
			lines[lineNumber] = lines[lineNumber].replace(/^- \[ \] /, "- [x] ");
			// Write back with original line endings preserved
			writeFileSync(this.filePath, lines.join("\n"), "utf-8");
		}
	}

	async countRemaining(): Promise<number> {
		const content = readFileSync(this.filePath, "utf-8").replace(/\r/g, "");
		const matches = content.match(/^- \[ \] /gm);
		return matches?.length || 0;
	}

	async countCompleted(): Promise<number> {
		const content = readFileSync(this.filePath, "utf-8").replace(/\r/g, "");
		const matches = content.match(/^- \[x\] /gim);
		return matches?.length || 0;
	}
}
