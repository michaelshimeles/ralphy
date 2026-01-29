import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logDebug, logSuccess, logWarn } from "../ui/logger.ts";

/**
 * Check if gh CLI is available and authenticated
 */
async function isGhAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["gh", "auth", "status"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Sync PRD file content to a GitHub issue body.
 * This allows tracking task progress in a GitHub issue as documentation.
 *
 * @param prdFile - Path to the PRD file (relative or absolute)
 * @param issueNumber - GitHub issue number to sync to
 * @param workDir - Working directory for resolving relative paths
 * @returns true if sync succeeded, false otherwise
 */
export async function syncPrdToIssue(
	prdFile: string,
	issueNumber: number,
	workDir: string,
): Promise<boolean> {
	// Check if gh CLI is available
	const ghAvailable = await isGhAvailable();
	if (!ghAvailable) {
		logWarn("Cannot sync: gh CLI not installed or not authenticated");
		return false;
	}

	// Read PRD file content
	const prdPath = prdFile.startsWith("/") ? prdFile : join(workDir, prdFile);
	let prdContent: string;

	try {
		prdContent = readFileSync(prdPath, "utf-8");
	} catch (error) {
		logWarn(`Cannot sync: ${prdFile} not found`);
		return false;
	}

	// Update issue body using gh CLI
	logDebug(`Syncing ${prdFile} to issue #${issueNumber}`);

	try {
		const proc = Bun.spawn(["gh", "issue", "edit", String(issueNumber), "--body", prdContent], {
			cwd: workDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;

		if (proc.exitCode === 0) {
			logSuccess(`Synced PRD -> GitHub issue #${issueNumber}`);
			return true;
		}

		const stderr = await new Response(proc.stderr).text();
		logWarn(`Failed to sync PRD to issue #${issueNumber}: ${stderr}`);
		return false;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logWarn(`Failed to sync PRD to issue #${issueNumber}: ${errorMsg}`);
		return false;
	}
}
