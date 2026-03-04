import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { parseCSV, rowsToCsv } from "./csv.ts";
import { hasPrototypePollution } from "./yaml.ts";

/**
 * Truncate description to save tokens
 */
function truncateDesc(desc: string | undefined, maxLen = 80): string {
	if (!desc) return "";
	const clean = desc.replace(/\s+/g, " ").trim();
	if (clean.length <= maxLen) return clean;
	return `${clean.slice(0, maxLen - 3)}...`;
}

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
 * Convert YAML task file content to CSV format
 */
export function yamlToCsv(yamlContent: string): string {
	const data = YAML.parse(yamlContent) as YamlTaskFile;
	if (hasPrototypePollution(data)) {
		throw new Error("YAML contains disallowed prototype pollution keys");
	}
	const tasks = data.tasks || [];

	const rows: string[][] = [["id", "title", "done", "group", "desc"]];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i];
		rows.push([
			String(i + 1),
			t.title || "",
			t.completed ? "1" : "0",
			String(t.parallel_group || 0),
			truncateDesc(t.description),
		]);
	}
	return rowsToCsv(rows);
}

/**
 * Convert Markdown task file content to CSV format
 */
export function mdToCsv(mdContent: string): string {
	const lines = mdContent.replace(/\r\n/g, "\n").split("\n");
	const rows: string[][] = [["id", "title", "done", "group", "desc"]];

	let id = 1;
	for (const line of lines) {
		// Match incomplete tasks: "- [ ] Task description"
		const incompleteMatch = line.match(/^- \[ \] (.+)$/);
		if (incompleteMatch) {
			rows.push([String(id), incompleteMatch[1].trim(), "0", "0", ""]);
			id++;
			continue;
		}

		// Match completed tasks: "- [x] Task description"
		const completeMatch = line.match(/^- \[x\] (.+)$/i);
		if (completeMatch) {
			rows.push([String(id), completeMatch[1].trim(), "1", "0", ""]);
			id++;
		}
	}

	return rowsToCsv(rows);
}

interface JsonTask {
	id?: string | number;
	title: string;
	completed?: boolean;
	parallel_group?: number;
	parallelGroup?: number;
	description?: string;
	body?: string;
}

/**
 * Convert JSON task file content to CSV format
 */
export function jsonToCsv(jsonContent: string): string {
	let data: unknown;
	try {
		data = JSON.parse(jsonContent);
	} catch (err) {
		throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	const tasks: JsonTask[] = Array.isArray(data)
		? data
		: (data as { tasks?: JsonTask[] })?.tasks || [];

	const rows: string[][] = [["id", "title", "done", "group", "desc"]];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i];
		rows.push([
			String(t.id || i + 1),
			t.title || "",
			t.completed ? "1" : "0",
			String(t.parallel_group || t.parallelGroup || 0),
			truncateDesc(t.description || t.body),
		]);
	}
	return rowsToCsv(rows);
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
}

/**
 * Parse SKILL.md file with YAML frontmatter
 */
function parseSkillFile(
	filePath: string,
): { name: string; description: string; content: string } | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

		if (frontmatterMatch) {
			const frontmatter = YAML.parse(frontmatterMatch[1]) as SkillFrontmatter;
			if (hasPrototypePollution(frontmatter)) {
				return null;
			}
			const body = frontmatterMatch[2].trim();

			return {
				name: frontmatter.name || "",
				description: frontmatter.description || "",
				content: truncateDesc(body, 200),
			};
		}

		// No frontmatter, use filename as name
		const name = filePath.split(/[/\\]/).pop()?.replace(".md", "") || "";
		return {
			name,
			description: "",
			content: truncateDesc(content, 200),
		};
	} catch {
		return null;
	}
}

/**
 * Convert a skills directory to compact CSV format
 */
export function skillsToCsv(skillDir: string): string {
	if (!existsSync(skillDir)) return "";

	const skills: Array<{ name: string; desc: string; content: string }> = [];

	// Find SKILL.md files in the directory
	const entries = readdirSync(skillDir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(skillDir, entry.name);

		if (entry.isDirectory()) {
			// Check for SKILL.md inside subdirectory
			const skillFile = join(fullPath, "SKILL.md");
			if (existsSync(skillFile)) {
				const parsed = parseSkillFile(skillFile);
				if (parsed) {
					skills.push({
						name: parsed.name || entry.name,
						desc: parsed.description,
						content: parsed.content,
					});
				}
			}
		} else if (entry.name.endsWith(".md")) {
			const parsed = parseSkillFile(fullPath);
			if (parsed) {
				skills.push({
					name: parsed.name || entry.name.replace(".md", ""),
					desc: parsed.description,
					content: parsed.content,
				});
			}
		}
	}

	if (skills.length === 0) return "";

	const rows: string[][] = [["skill", "desc", "summary"]];
	for (const s of skills) {
		rows.push([s.name, s.desc, s.content]);
	}
	return rowsToCsv(rows);
}

/**
 * Convert multiple skill directories to combined CSV
 */
export function allSkillsToCsv(skillDirs: string[]): string {
	const allRows: string[][] = [["skill", "desc", "summary"]];

	for (const dir of skillDirs) {
		const csv = skillsToCsv(dir);
		if (csv) {
			const parsedRows = parseCSV(csv);
			for (let i = 1; i < parsedRows.length; i++) {
				allRows.push(parsedRows[i]);
			}
		}
	}

	if (allRows.length <= 1) return "";
	return rowsToCsv(allRows);
}
