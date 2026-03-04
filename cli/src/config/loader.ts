import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { validateCommand } from "../engines/validation.ts";
import { logDebug, logError, logWarn } from "../ui/logger.ts";
import { type RalphyConfig, RalphyConfigSchema } from "./types.ts";

export const RALPHY_DIR = ".ralphy";

/**
 * Recursively check for prototype pollution keys in parsed data
 * BUG FIX: Uses recursive traversal instead of string matching to prevent Unicode escape bypasses
 */
function hasPrototypePollution(obj: unknown): boolean {
	const MAX_DEPTH = 20;
	const MAX_NODES = 10000;
	const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);

	if (typeof obj !== "object" || obj === null) return false;

	const visited = new Set<unknown>();
	const queue: Array<{ value: unknown; depth: number }> = [{ value: obj, depth: 0 }];
	let nodesVisited = 0;

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;

		nodesVisited++;
		if (nodesVisited > MAX_NODES) {
			throw new Error("Config file too complex to validate safely");
		}

		if (current.depth > MAX_DEPTH) {
			throw new Error("Config file nesting exceeds safety limits");
		}

		if (typeof current.value !== "object" || current.value === null) {
			continue;
		}

		if (visited.has(current.value)) {
			continue;
		}
		visited.add(current.value);

		for (const key of Object.keys(current.value)) {
			if (dangerousKeys.has(key)) return true;
			const value = (current.value as Record<string, unknown>)[key];
			queue.push({ value, depth: current.depth + 1 });
		}
	}

	return false;
}
export const CONFIG_FILE = "config.yaml";
export const PROGRESS_FILE = "progress.txt";

/**
 * Get the full path to the ralphy directory
 */
export function getRalphyDir(workDir = process.cwd()): string {
	return join(workDir, RALPHY_DIR);
}

/**
 * Get the full path to the config file
 */
export function getConfigPath(workDir = process.cwd()): string {
	return join(workDir, RALPHY_DIR, CONFIG_FILE);
}

/**
 * Get the full path to the progress file
 */
export function getProgressPath(workDir = process.cwd()): string {
	return join(workDir, RALPHY_DIR, PROGRESS_FILE);
}

/**
 * Check if ralphy is initialized in the directory
 */
export function isInitialized(workDir = process.cwd()): boolean {
	return existsSync(getConfigPath(workDir));
}

/**
 * Load the ralphy config from disk
 */
export function loadConfig(workDir = process.cwd()): RalphyConfig | null {
	const configPath = getConfigPath(workDir);

	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const content = readFileSync(configPath, "utf-8");
		const parsed = YAML.parse(content);

		// BUG FIX: Proper prototype pollution protection with recursive check
		// The old string-based check was bypassable via Unicode escapes
		if (hasPrototypePollution(parsed)) {
			throw new Error("Config file contains potentially malicious prototype pollution keys");
		}

		return RalphyConfigSchema.parse(parsed);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const isSecurityError =
			message.includes("too complex") ||
			message.includes("nesting exceeds") ||
			message.includes("prototype pollution");
		if (isSecurityError) {
			logError(`Config security violation at ${configPath}: ${message}. Refusing to load config.`);
			return null;
		}

		logWarn(`Invalid config file at ${configPath}: ${message}. Falling back to defaults.`);
		logDebug(`Config parse stack: ${error instanceof Error ? error.stack || message : message}`);
		return RalphyConfigSchema.parse({});
	}
}

/**
 * Get rules from config
 */
export function loadRules(workDir = process.cwd()): string[] {
	const config = loadConfig(workDir);
	return config?.rules ?? [];
}

/**
 * Get boundaries from config
 */
export function loadBoundaries(workDir = process.cwd()): string[] {
	const config = loadConfig(workDir);
	return config?.boundaries?.never_touch ?? [];
}

/**
 * Get test command from config
 */
export function loadTestCommand(workDir = process.cwd()): string {
	const config = loadConfig(workDir);
	const command = config?.commands.test ?? "";

	if (command && !validateCommand(command)) {
		logWarn(`Invalid test command in config: "${command}". Falling back to default.`);
		return "";
	}

	return command;
}

/**
 * Get lint command from config
 */
export function loadLintCommand(workDir = process.cwd()): string {
	const config = loadConfig(workDir);
	const command = config?.commands.lint ?? "";

	if (command && !validateCommand(command)) {
		logWarn(`Invalid lint command in config: "${command}". Falling back to default.`);
		return "";
	}

	return command;
}

/**
 * Get build command from config
 */
export function loadBuildCommand(workDir = process.cwd()): string {
	const config = loadConfig(workDir);
	const command = config?.commands.build ?? "";

	if (command && !validateCommand(command)) {
		logWarn(`Invalid build command in config: "${command}". Falling back to default.`);
		return "";
	}

	return command;
}

/**
 * Get project context as a formatted string
 */
export function loadProjectContext(workDir = process.cwd()): string {
	const config = loadConfig(workDir);
	if (!config) return "";

	const parts: string[] = [];
	if (config.project.name) parts.push(`Project: ${config.project.name}`);
	if (config.project.language) parts.push(`Language: ${config.project.language}`);
	if (config.project.framework) parts.push(`Framework: ${config.project.framework}`);
	if (config.project.description) parts.push(`Description: ${config.project.description}`);

	return parts.join("\n");
}
