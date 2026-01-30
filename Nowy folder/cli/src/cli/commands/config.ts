import pc from "picocolors";
import { getConfigPath, isInitialized, loadConfig } from "../../config/loader.ts";
import { addRule as addConfigRule } from "../../config/writer.ts";
import { logError, logInfo, logSuccess, logWarn } from "../../ui/logger.ts";

/**
 * Handle --config command (show configuration)
 */
export async function showConfig(workDir = process.cwd()): Promise<void> {
	if (!isInitialized(workDir)) {
		logWarn("No config found. Run 'ralphy --init' first.");
		return;
	}

	const config = loadConfig(workDir);
	if (!config) {
		logError("Failed to load config");
		return;
	}

	const configPath = getConfigPath(workDir);

	logInfo("");
	logInfo(`${pc.bold("Ralphy Configuration")} (${configPath})`);
	logInfo("");

	// Project info
	logInfo(pc.bold("Project:"));
	logInfo(`  Name:      ${config.project.name || "Unknown"}`);
	logInfo(`  Language:  ${config.project.language || "Unknown"}`);
	if (config.project.framework) logInfo(`  Framework: ${config.project.framework}`);
	if (config.project.description) logInfo(`  About:     ${config.project.description}`);
	logInfo("");

	// Commands
	logInfo(pc.bold("Commands:"));
	logInfo(`  Test:  ${config.commands.test || pc.dim("(not set)")}`);
	logInfo(`  Lint:  ${config.commands.lint || pc.dim("(not set)")}`);
	logInfo(`  Build: ${config.commands.build || pc.dim("(not set)")}`);
	logInfo("");

	// Rules
	logInfo(pc.bold("Rules:"));
	if (config.rules.length > 0) {
		for (const rule of config.rules) {
			logInfo(`  • ${rule}`);
		}
	} else {
		logInfo(`  ${pc.dim('(none - add with: ralphy --add-rule "...")')}`);
	}
	logInfo("");

	// Boundaries
	if (config.boundaries.never_touch.length > 0) {
		logInfo(pc.bold("Never Touch:"));
		for (const path of config.boundaries.never_touch) {
			logInfo(`  • ${path}`);
		}
		logInfo("");
	}
}

/**
 * Handle --add-rule command
 */
export async function addRule(rule: string, workDir = process.cwd()): Promise<void> {
	if (!isInitialized(workDir)) {
		logError("No config found. Run 'ralphy --init' first.");
		return;
	}

	try {
		addConfigRule(rule, workDir);
		logSuccess(`Added rule: ${rule}`);
	} catch (error) {
		logError(`Failed to add rule: ${error}`);
	}
}
