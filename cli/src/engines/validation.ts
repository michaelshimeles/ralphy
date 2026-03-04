import { logDebug } from "../ui/logger.ts";

// Check platform
const isWindows = process.platform === "win32";
const DEBUG = process.env.RALPHY_DEBUG === "true";

/**
 * Maximum lengths to prevent DoS attacks
 */
const MAX_COMMAND_LENGTH = 1000;
const MAX_ARG_LENGTH = 10000;
const MAX_TOTAL_ARGS_LENGTH = 100000;
const MAX_ARG_COUNT = 1000;

function debugLog(...args: unknown[]): void {
	if (DEBUG || (globalThis as { verboseMode?: boolean }).verboseMode === true) {
		logDebug(args.map((a) => String(a)).join(" "));
	}
}

/**
 * Validate command name to prevent command injection
 * Only allows alphanumeric characters, hyphens, underscores, and dots
 * Also allows forward slashes for path-based commands (e.g., ./node_modules/.bin/cli)
 */
function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
	let match = regex.exec(command);
	while (match !== null) {
		tokens.push(match[1] ?? match[2] ?? match[0]);
		match = regex.exec(command);
	}

	return tokens;
}

export function validateCommand(command: string): string | null {
	const trimmedCommand = command.trim();
	if (!trimmedCommand) {
		debugLog("Command validation failed: command is empty");
		return null;
	}

	// Check command length to prevent DoS
	if (trimmedCommand.length > MAX_COMMAND_LENGTH) {
		debugLog(
			`Command validation failed: command too long (${trimmedCommand.length} > ${MAX_COMMAND_LENGTH})`,
		);
		return null;
	}

	// Block shell metacharacters and dangerous patterns
	const dangerousPatterns = [
		/[;&|`$]/, // Shell metacharacters
		/\$\{/, // Variable expansion
		/\$\(/, // Command substitution
		/`/, // Backtick substitution
		/\|\|/, // OR operator
		/&&/, // AND operator
		/[<>]/, // Redirection
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(trimmedCommand)) {
			debugLog(`Command validation failed: dangerous pattern detected in "${trimmedCommand}"`);
			return null;
		}
	}

	const tokens = tokenizeCommand(trimmedCommand);
	if (tokens.length === 0) {
		debugLog("Command validation failed: no command token found");
		return null;
	}

	const [commandToken, ...args] = tokens;

	// Allow executable characters: alphanumeric, hyphen, underscore, dot, slashes.
	// Windows also needs drive-letter colon support (e.g., C:\tools\bun.exe).
	const validCommandPattern = isWindows ? /^[a-zA-Z0-9._\-\\/:]+$/ : /^[a-zA-Z0-9._\-/]+$/;

	if (!validCommandPattern.test(commandToken)) {
		debugLog(`Command validation failed: invalid command token "${commandToken}"`);
		return null;
	}

	if (args.length > 0 && !validateArgs(args)) {
		debugLog(`Command validation failed: invalid args in "${trimmedCommand}"`);
		return null;
	}

	return trimmedCommand;
}

/**
 * Validate command arguments to prevent injection
 * Returns null if any argument contains dangerous patterns
 */
export function validateArgs(args: string[]): string[] | null {
	// Check argument count to prevent DoS
	if (args.length > MAX_ARG_COUNT) {
		debugLog(`Argument validation failed: too many arguments (${args.length} > ${MAX_ARG_COUNT})`);
		return null;
	}

	// Check total arguments length
	const totalLength = args.reduce((sum, arg) => sum + arg.length, 0);
	if (totalLength > MAX_TOTAL_ARGS_LENGTH) {
		debugLog(
			`Argument validation failed: total arguments too long (${totalLength} > ${MAX_TOTAL_ARGS_LENGTH})`,
		);
		return null;
	}

	const dangerousPatterns = [
		/[;&|`]/, // Shell metacharacters
		/\$\{/, // Variable expansion
		/\$\(/, // Command substitution
		/`/, // Backtick substitution
		/\|\|/, // OR operator
		/&&/, // AND operator
	];

	for (const arg of args) {
		// Check individual argument length
		if (arg.length > MAX_ARG_LENGTH) {
			debugLog(`Argument validation failed: argument too long (${arg.length} > ${MAX_ARG_LENGTH})`);
			return null;
		}

		for (const pattern of dangerousPatterns) {
			if (pattern.test(arg)) {
				debugLog(`Argument validation failed: dangerous pattern in "${arg}"`);
				return null;
			}
		}
	}

	return args;
}

/**
 * Validation result type
 */
export interface ValidationResult {
	valid: boolean;
	command?: string;
	args?: string[];
	error?: string;
}

/**
 * Validate both command and arguments in one call
 */
export function validateCommandAndArgs(command: string, args: string[]): ValidationResult {
	const validatedCommand = validateCommand(command);
	if (!validatedCommand) {
		return {
			valid: false,
			error: "Invalid command - potential command injection detected",
		};
	}

	const validatedArgs = validateArgs(args);
	if (!validatedArgs) {
		return {
			valid: false,
			error: "Invalid arguments - potential command injection detected",
		};
	}

	return {
		valid: true,
		command: validatedCommand,
		args: validatedArgs,
	};
}
