import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { Task, TaskSource } from "./types.ts";

/**
 * Read file content and normalize line endings to Unix format
 */
function readFileNormalized(filePath: string): string {
	return readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Markdown folder task source - reads tasks from multiple markdown files in a folder
 * Each task ID includes the source file for proper tracking: "filename.md:lineNumber"
 */
export class MarkdownFolderTaskSource implements TaskSource {
	type = "markdown-folder" as const;
	private folderPath: string;
	private markdownFiles: string[] = [];

	constructor(folderPath: string) {
		this.folderPath = folderPath;
		this.markdownFiles = this.scanForMarkdownFiles();
	}

	/**
	 * Scan the folder for markdown files
	 */
	private scanForMarkdownFiles(): string[] {
		const files: string[] = [];

		try {
			const entries = readdirSync(this.folderPath);
			for (const entry of entries) {
				const fullPath = join(this.folderPath, entry);
				const stat = statSync(fullPath);

				if (stat.isFile() && entry.endsWith(".md")) {
					files.push(fullPath);
				}
			}
		} catch {
			// Folder doesn't exist or can't be read
		}

		// Sort files alphabetically for consistent ordering
		return files.sort();
	}

	/**
	 * Parse task ID into file path and line number
	 */
	private parseTaskId(id: string): { filePath: string; lineNumber: number } {
		const lastColon = id.lastIndexOf(":");
		if (lastColon === -1) {
			throw new Error(`Invalid task ID format: ${id}`);
		}
		const fileName = id.substring(0, lastColon);
		if (fileName !== basename(fileName) || !fileName.endsWith(".md")) {
			throw new Error(`Invalid task file in task ID: ${id}`);
		}
		const lineNumber = Number.parseInt(id.substring(lastColon + 1), 10);
		if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
			throw new Error(`Invalid task line number in task ID: ${id}`);
		}
		const filePath = join(this.folderPath, fileName);
		const baseResolved = resolve(this.folderPath);
		const fileResolved = resolve(filePath);
		if (
			fileResolved !== baseResolved &&
			!fileResolved.startsWith(`${baseResolved}${sep}`)
		) {
			throw new Error(`Task ID path escapes markdown folder: ${id}`);
		}
		return { filePath, lineNumber };
	}

	/**
	 * Create task ID from file path and line number
	 */
	private createTaskId(filePath: string, lineNumber: number): string {
		const fileName = basename(filePath);
		return `${fileName}:${lineNumber}`;
	}

	async getAllTasks(): Promise<Task[]> {
		const allTasks: Task[] = [];

		for (const filePath of this.markdownFiles) {
			const content = readFileNormalized(filePath);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// Match incomplete tasks
				const incompleteMatch = line.match(/^- \[ \] (.+)$/);
				if (incompleteMatch) {
					allTasks.push({
						id: this.createTaskId(filePath, i + 1),
						title: incompleteMatch[1].trim(),
						completed: false,
					});
				}
			}
		}

		return allTasks;
	}

	async getNextTask(): Promise<Task | null> {
		const tasks = await this.getAllTasks();
		return tasks[0] || null;
	}

	async markComplete(id: string): Promise<void> {
		const { filePath, lineNumber } = this.parseTaskId(id);
		const content = readFileNormalized(filePath);
		const lines = content.split("\n");
		const lineIndex = lineNumber - 1;

		if (lineIndex >= 0 && lineIndex < lines.length) {
			// Replace "- [ ]" with "- [x]"
			lines[lineIndex] = lines[lineIndex].replace(/^- \[ \] /, "- [x] ");
			writeFileSync(filePath, lines.join("\n"), "utf-8");
		}
	}

	async countRemaining(): Promise<number> {
		let count = 0;

		for (const filePath of this.markdownFiles) {
			const content = readFileNormalized(filePath);
			const matches = content.match(/^- \[ \] /gm);
			count += matches?.length || 0;
		}

		return count;
	}

	async countCompleted(): Promise<number> {
		let count = 0;

		for (const filePath of this.markdownFiles) {
			const content = readFileNormalized(filePath);
			const matches = content.match(/^- \[x\] /gim);
			count += matches?.length || 0;
		}

		return count;
	}

	/**
	 * Get list of markdown files in the folder
	 */
	getMarkdownFiles(): string[] {
		return [...this.markdownFiles];
	}
}
