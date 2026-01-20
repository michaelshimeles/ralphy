import pc from "picocolors";
import { loadConfig, isInitialized, getConfigPath } from "../../config/loader.ts";
import { addRule as addConfigRule } from "../../config/writer.ts";
import { logError, logSuccess, logWarn } from "../../ui/logger.ts";

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

	console.log("");
	console.log(`${pc.bold("Ralphy Configuration")} (${configPath})`);
	console.log("");

	// Project info
	console.log(pc.bold("Project:"));
	console.log(`  Name:      ${config.project.name || "Unknown"}`);
	console.log(`  Language:  ${config.project.language || "Unknown"}`);
	if (config.project.framework) console.log(`  Framework: ${config.project.framework}`);
	if (config.project.description) console.log(`  About:     ${config.project.description}`);
	console.log("");

	// Commands
	console.log(pc.bold("Commands:"));
	console.log(`  Test:  ${config.commands.test || pc.dim("(not set)")}`);
	console.log(`  Lint:  ${config.commands.lint || pc.dim("(not set)")}`);
	console.log(`  Build: ${config.commands.build || pc.dim("(not set)")}`);
	console.log("");

	// Rules
	console.log(pc.bold("Rules:"));
	if (config.rules.length > 0) {
		for (const rule of config.rules) {
			console.log(`  • ${rule}`);
		}
	} else {
		console.log(`  ${pc.dim('(none - add with: ralphy --add-rule "...")')}`);
	}
	console.log("");

	// Boundaries
	if (config.boundaries.never_touch.length > 0) {
		console.log(pc.bold("Never Touch:"));
		for (const path of config.boundaries.never_touch) {
			console.log(`  • ${path}`);
		}
		console.log("");
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
