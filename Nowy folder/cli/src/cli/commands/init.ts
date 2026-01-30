import pc from "picocolors";
import { isInitialized } from "../../config/loader.ts";
import { initConfig } from "../../config/writer.ts";
import { logInfo, logSuccess, logWarn } from "../../ui/logger.ts";

/**
 * Handle --init command
 */
export async function runInit(workDir = process.cwd()): Promise<void> {
	// Check if already initialized
	if (isInitialized(workDir)) {
		logWarn(".ralphy/ already exists");

		// In a real CLI, we'd prompt the user
		// For now, just warn and return
		logWarn("To overwrite, delete .ralphy/ and run again");
		return;
	}

	// Initialize config
	const { detected } = initConfig(workDir);

	// Show what we detected
	logInfo("");
	logInfo(pc.bold("Detected:"));
	logInfo(`  Project:   ${pc.cyan(detected.name)}`);
	if (detected.language) logInfo(`  Language:  ${pc.cyan(detected.language)}`);
	if (detected.framework) logInfo(`  Framework: ${pc.cyan(detected.framework)}`);
	if (detected.testCmd) logInfo(`  Test:      ${pc.cyan(detected.testCmd)}`);
	if (detected.lintCmd) logInfo(`  Lint:      ${pc.cyan(detected.lintCmd)}`);
	if (detected.buildCmd) logInfo(`  Build:     ${pc.cyan(detected.buildCmd)}`);
	logInfo("");

	logSuccess("Created .ralphy/");
	logInfo("");
	logInfo(`  ${pc.cyan(".ralphy/config.yaml")}   - Your rules and preferences`);
	logInfo(`  ${pc.cyan(".ralphy/progress.txt")} - Progress log (auto-updated)`);
	logInfo("");
	logInfo(pc.bold("Next steps:"));
	logInfo(`  1. Add rules:  ${pc.cyan('ralphy --add-rule "your rule here"')}`);
	logInfo(`  2. Or edit:    ${pc.cyan(".ralphy/config.yaml")}`);
	logInfo(
		`  3. Run:        ${pc.cyan('ralphy "your task"')} or ${pc.cyan("ralphy")} (with PRD.md)`,
	);
}
