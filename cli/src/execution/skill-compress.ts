/**
 * Skill File Compression Utilities
 * Reduces token usage by minifying markdown skill files
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logDebug } from "../ui/logger.ts";

/**
 * Compress a markdown file by removing excess whitespace and formatting
 */
export function compressMarkdown(content: string): string {
	const segments = content.split(/(```[\s\S]*?```)/g);
	const compressed = segments
		.map((segment) => {
			if (segment.startsWith("```")) {
				return segment;
			}

			return (
				segment
					// Remove multiple consecutive blank lines
					.replace(/\n{3,}/g, "\n\n")
					// Remove trailing whitespace from lines
					.replace(/[ \t]+$/gm, "")
					// Remove whitespace-only lines
					.replace(/^\s+$/gm, "")
					// Compress verbose phrases
					.replace(/Please note that /gi, "Note: ")
					.replace(/In order to /gi, "To ")
					.replace(/Make sure to /gi, "")
					.replace(/You should /gi, "")
					.replace(/You must /gi, "Must ")
					.replace(/It is important to /gi, "")
					.replace(/Keep in mind that /gi, "")
					// Remove redundant markdown emphasis in instructions
					.replace(/\*\*Note\*\*:/g, "Note:")
					.replace(/\*\*Important\*\*:/g, "Important:")
					// Technical Jargon Compression
					.replace(/\bimplementation\b/gi, "impl")
					.replace(/\binformation\b/gi, "info")
					.replace(/\bdirectory\b/gi, "dir")
					.replace(/\bdirectories\b/gi, "dirs")
					.replace(/\binitialization\b/gi, "init")
					.replace(/\bconfiguration\b/gi, "config")
					.replace(/\bparameters\b/gi, "params")
					.replace(/\benvironment\b/gi, "env")
					.replace(/\bdocumentation\b/gi, "docs")
			);
		})
		.join("");

	return compressed.trim();
}

function csvEscape(value: string): string {
	const escaped = value.replace(/"/g, '""');
	if (/[",\n\r]/.test(escaped)) {
		return `"${escaped}"`;
	}
	return escaped;
}

/**
 * Copy and compress skill folders
 */
export function copyAndCompressSkillFolders(originalDir: string, sandboxDir: string): number {
	const skillDirs = [".opencode/skills", ".claude/skills", ".skills"];
	let totalSaved = 0;

	for (const dir of skillDirs) {
		const srcPath = join(originalDir, dir);
		if (!existsSync(srcPath)) continue;

		const destPath = join(sandboxDir, dir);
		mkdirSync(destPath, { recursive: true });

		const saved = compressDirectory(srcPath, destPath);
		totalSaved += saved;
	}

	if (totalSaved > 0) {
		logDebug(`[SKILLS] Compressed skill files, saved ~${totalSaved} chars`);
	}

	return totalSaved;
}

/**
 * Recursively compress markdown files in a directory
 */
function compressDirectory(srcDir: string, destDir: string): number {
	let saved = 0;
	// Handle case where srcDir doesn't exist (though checked above)
	if (!existsSync(srcDir)) return 0;

	const entries = readdirSync(srcDir, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = join(srcDir, entry.name);
		const destPath = join(destDir, entry.name);

		if (entry.isDirectory()) {
			mkdirSync(destPath, { recursive: true });
			saved += compressDirectory(srcPath, destPath);
		} else if (entry.name.endsWith(".md")) {
			const original = readFileSync(srcPath, "utf-8");
			const compressed = compressMarkdown(original);
			writeFileSync(destPath, compressed, "utf-8");
			saved += original.length - compressed.length;
		} else {
			// Copy non-markdown files as-is
			const content = readFileSync(srcPath);
			writeFileSync(destPath, content);
		}
	}

	return saved;
}

/**
 * Get all skills as a compact CSV string for LLM context
 * Format: SkillName,Instructions
 */
export function getSkillsAsCsv(workDir: string): string {
	const skillDirs = [".opencode/skills", ".claude/skills", ".skills"];
	const rows: string[] = [];

	for (const dir of skillDirs) {
		const srcPath = join(workDir, dir);
		if (!existsSync(srcPath)) continue;

		const entries = readdirSync(srcPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				const content = readFileSync(join(srcPath, entry.name), "utf-8");
				const compressed = compressMarkdown(content).replace(/\n/g, " ");

				const name = entry.name.replace(".md", "");
				const nameFinal = csvEscape(name);
				const contentFinal = csvEscape(compressed);

				rows.push(`${nameFinal},${contentFinal}`);
			}
		}
	}

	if (rows.length === 0) return "";
	return `Name,Instructions\n${rows.join("\n")}`;
}
