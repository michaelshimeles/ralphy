import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logDebug, logSuccess, logWarn } from "../ui/logger.ts";
import { execTea, formatTeaError, isTeaAvailable } from "./tea.ts";

/**
 * Sync PRD file content to a Gitea issue.
 *
 * Implementation uses `tea issues edit --description` (reliable and avoids brittle comment parsing).
 */
export async function syncPrdToGiteaIssue(
	prdFile: string,
	issueNumber: number,
	workDir: string,
	options?: { repo?: string },
): Promise<boolean> {
	const teaAvailable = await isTeaAvailable(workDir);
	if (!teaAvailable) {
		logWarn("Cannot sync: tea CLI not installed or not authenticated");
		return false;
	}

	const prdPath = prdFile.startsWith("/") ? prdFile : join(workDir, prdFile);
	let prdContent: string;
	try {
		prdContent = readFileSync(prdPath, "utf-8");
	} catch {
		logWarn(`Cannot sync: ${prdFile} not found`);
		return false;
	}

	logDebug(`Syncing ${prdFile} to Gitea issue #${issueNumber}`);

	const res = await execTea(["issues", "edit", String(issueNumber), "--description", prdContent], {
		workDir,
		repo: options?.repo,
	});
	if (res.exitCode === 0) {
		logSuccess(`Synced PRD -> Gitea issue #${issueNumber}`);
		return true;
	}

	logWarn(`Failed to sync PRD to issue #${issueNumber}: ${formatTeaError(res)}`);
	return false;
}
