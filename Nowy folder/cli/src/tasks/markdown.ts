import { readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskSource } from "./types.ts";

/**
 * Read file content and normalize line endings to Unix format
 */
function readFileNormalized(filePath: string): string {
	return readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

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
		const content = readFileNormalized(this.filePath);
		const tasks: Task[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match incomplete tasks
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
		const content = readFileNormalized(this.filePath);
		const lines = content.split("\n");
		const lineNumber = Number.parseInt(id, 10) - 1;

		if (lineNumber >= 0 && lineNumber < lines.length) {
			// Replace "- [ ]" with "- [x]"
			lines[lineNumber] = lines[lineNumber].replace(/^- \[ \] /, "- [x] ");
			writeFileSync(this.filePath, lines.join("\n"), "utf-8");
		}
	}

	async countRemaining(): Promise<number> {
		const content = readFileNormalized(this.filePath);
		const matches = content.match(/^- \[ \] /gm);
		return matches?.length || 0;
	}

	async countCompleted(): Promise<number> {
		const content = readFileNormalized(this.filePath);
		const matches = content.match(/^- \[x\] /gim);
		return matches?.length || 0;
	}
}
