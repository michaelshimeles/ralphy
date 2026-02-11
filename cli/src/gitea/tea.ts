import { commandExists, execCommand, formatCommandError } from "../engines/base.ts";

export interface TeaExecOptions {
	workDir: string;
	/** Repo path or slug to pass to tea's --repo */
	repo?: string;
}

export interface TeaIssueSummary {
	number: number;
	title: string;
	body?: string;
}

export type TeaExecResult = { stdout: string; stderr: string; exitCode: number };

function withTeaContextArgs(args: string[], options: TeaExecOptions): string[] {
	const fullArgs = [...args];
	if (options.repo) {
		fullArgs.push("--repo", options.repo);
	}
	return fullArgs;
}

/**
 * Check if tea is available in PATH, and (best-effort) whether it is authenticated.
 */
export async function isTeaAvailable(workDir = process.cwd()): Promise<boolean> {
	const exists = await commandExists("tea");
	if (!exists) return false;

	const { exitCode } = await execCommand("tea", ["whoami"], workDir);
	return exitCode === 0;
}

/**
 * Execute tea command and return stdout/stderr/exitCode.
 */
export async function execTea(args: string[], options: TeaExecOptions): Promise<TeaExecResult> {
	return await execCommand("tea", withTeaContextArgs(args, options), options.workDir);
}

export function parseTeaIssueList(stdout: string): TeaIssueSummary[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];

	// Preferred: JSON output (-o json)
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed
				.map((row) => {
					const number = Number.parseInt(String(row.index ?? row.number ?? ""), 10);
					if (Number.isNaN(number)) return null;
					const title = String(row.title ?? "").trim();
					if (!title) return null;
					const bodyRaw = row.body;
					const body = typeof bodyRaw === "string" && bodyRaw.trim() ? bodyRaw : undefined;
					return { number, title, body };
				})
				.filter((v): v is TeaIssueSummary => v !== null);
		}
	} catch {
		// Fall through to table/simple parsing
	}

	// Best-effort: parse table output.
	// Example lines usually begin with issue index.
	const issues: TeaIssueSummary[] = [];
	for (const line of trimmed.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(.+)$/);
		if (!m) continue;
		const number = Number.parseInt(m[1], 10);
		if (Number.isNaN(number)) continue;
		issues.push({ number, title: m[2].trim() });
	}

	return issues;
}

export function formatTeaError(result: TeaExecResult): string {
	const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
	return formatCommandError(result.exitCode, combined);
}
