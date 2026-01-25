import type { AgentProgress } from "../execution/progress-types.ts";
/**
 * Static agent display manager - shows static rows without constant refreshing
 */
export class StaticAgentDisplay {
	private static instance: StaticAgentDisplay | null = null;
	private agentProgressMap = new Map<number, AgentProgress>();
	private displayInterval: NodeJS.Timeout | null = null;
	private lastDisplayUpdate = new Map<number, string>();

	private lastLinesCount = 0;

	constructor() {
		StaticAgentDisplay.instance = this;
	}

	/**
	 * Get the active display instance
	 */
	static getInstance(): StaticAgentDisplay | null {
		return StaticAgentDisplay.instance;
	}

	/**
	 * Log a message safely to the terminal while the display is active
	 */
	log(message: string): void {
		// Clear previous lines to print above
		if (this.lastLinesCount > 0) {
			process.stdout.write(`\x1b[${this.lastLinesCount}A`);
		}

		// Print the log line
		process.stdout.write(`\x1b[K${message}\n`);

		// Redraw the display block
		if (this.lastLinesCount > 0) {
			const agents = Array.from(this.agentProgressMap.values());
			const output = this.buildDisplay(agents, Date.now());
			const lines = output.split("\n");
			for (const line of lines) {
				process.stdout.write(`\x1b[K${line}\n`);
			}
			this.lastLinesCount = lines.length;
		}
	}

	/**
	 * Update agent progress without forcing UI refresh
	 * Only stores data for periodic display updates
	 */
	updateAgent(agentNum: number, step: string): void {
		const current = this.agentProgressMap.get(agentNum);
		if (!current) return;

		// Ensure recentSteps is initialized
		if (!current.recentSteps) {
			current.recentSteps = [];
		}

		const cleanStep = step.trim();
		if (!cleanStep) return;

		// Skip duplicates
		if (
			current.recentSteps.length > 0 &&
			current.recentSteps[current.recentSteps.length - 1] === cleanStep
		) {
			return;
		}

		// Handle "heartbeat" messages - don't let them push out real work if possible
		const isHeartbeat = cleanStep.startsWith("[Still waiting");

		if (isHeartbeat && current.recentSteps.length > 0) {
			const lastStep = current.recentSteps[current.recentSteps.length - 1];
			// If last step was already a heartbeat, just update it instead of adding a new one
			if (lastStep.startsWith("[Still waiting")) {
				current.recentSteps[current.recentSteps.length - 1] = cleanStep;
				return;
			}
		}

		// If a new Non-heartbeat step comes in and the last was a heartbeat, overwrite the heartbeat
		if (!isHeartbeat && current.recentSteps.length > 0) {
			const lastStep = current.recentSteps[current.recentSteps.length - 1];
			if (lastStep.startsWith("[Still waiting")) {
				current.recentSteps[current.recentSteps.length - 1] = cleanStep;
				return;
			}
		}

		current.recentSteps.push(cleanStep);
		if (current.recentSteps.length > 5) {
			current.recentSteps.shift();
		}
	}

	/**
	 * Start periodic display refresh (every 500ms for responsiveness)
	 */
	startDisplay(): void {
		if (this.displayInterval) return;

		this.display();
		this.displayInterval = setInterval(() => {
			this.display();
		}, 500);
	}

	/**
	 * Stop periodic refresh
	 */
	stopDisplay(): void {
		if (this.displayInterval) {
			clearInterval(this.displayInterval);
			this.displayInterval = null;
		}
		// Final update to show completed state
		this.display();
		this.agentProgressMap.clear();
		this.lastDisplayUpdate.clear();
		this.lastLinesCount = 0;
	}

	/**
	 * Display static agent rows (called periodically)
	 */
	private display(): void {
		const agents = Array.from(this.agentProgressMap.values());
		const now = Date.now();
		const output = this.buildDisplay(agents, now);
		const lines = output.split("\n");

		// Clear previous lines
		if (this.lastLinesCount > 0) {
			process.stdout.write(`\x1b[${this.lastLinesCount}A`);
		}

		// Write new lines
		for (const line of lines) {
			process.stdout.write(`\x1b[K${line}\n`);
		}

		this.lastLinesCount = lines.length;
	}

	/**
	 * Build static display string
	 */
	private buildDisplay(agents: AgentProgress[], now: number): string {
		const lines: string[] = [];
		const columns = process.stdout.columns || 80;

		// Header
		lines.push(`[EXECUTION] ${agents.length} agents active`.substring(0, columns));

		// Agent rows
		for (const agent of agents) {
			const steps = agent.recentSteps || [];

			// Agent specific header with timer
			const elapsedMs = now - agent.startTime;
			const mins = Math.floor(elapsedMs / 60000);
			const secs = Math.floor((elapsedMs % 60000) / 1000);
			const timer = `[${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;

			let statusDisplay = agent.status.toUpperCase();
			let statusColor = "";

			if (agent.status === "completed") {
				statusColor = "\x1b[32m"; // Green
			} else if (agent.status === "failed") {
				statusColor = "\x1b[31m"; // Red
			} else if (agent.status === "planning") {
				statusColor = "\x1b[34m"; // Blue
			} else if (agent.status === "working") {
				statusColor = "\x1b[32m"; // Green

				// Try to detect current tool from last step
				if (steps.length > 0) {
					const lastStep = steps[steps.length - 1];
					const toolReg = /^(Read|Write|Edit|Create|Delete|Analyze|Glob|Grep|List|Run|Execute)/i;
					const toolMatch = lastStep.match(toolReg);
					if (toolMatch) {
						statusDisplay += `: ${toolMatch[1].toUpperCase()}`;
					}
				}
			}

			const resetCode = "\x1b[0m";
			const agentHeader = `Agent ${agent.agentNum} [${statusColor}${statusDisplay}${resetCode}]: ${agent.taskTitle} ${timer}`;
			lines.push(`${agentHeader.substring(0, columns + (statusColor ? 10 : 0))}`);

			// Always show exactly 5 lines
			for (let i = 0; i < 5; i++) {
				if (i < steps.length) {
					const step = steps[i];
					const formatted = this.formatStep(step);
					const colorCode = this.getColorForStep(step);
					const resetCode = "\x1b[0m";
					const prefix = `        ${i + 1}. `;

					// Length of prefix (8 chars) + formatted content
					const maxContentLength = columns - prefix.length;
					const truncated =
						formatted.length > maxContentLength
							? `${formatted.substring(0, maxContentLength - 3)}...`
							: formatted;

					lines.push(`${prefix}${colorCode}${truncated}${resetCode}`);
				} else {
					// Empty/placeholder line to maintain height
					lines.push(`        ${i + 1}. `.substring(0, columns));
				}
			}
		}

		return lines.join("\n");
	}

	/**
	 * Get ANSI color code based on step content
	 */
	private getColorForStep(step: string): string {
		const lowerS = step.toLowerCase();
		if (
			lowerS.includes("thinking") ||
			lowerS.includes("analyzing") ||
			lowerS.includes("considering") ||
			lowerS.includes("waiting") ||
			step.startsWith("{")
		) {
			return "\x1b[33m"; // Yellow
		}
		if (
			lowerS.includes("reading") ||
			lowerS.includes("loading") ||
			lowerS.includes("read:") ||
			lowerS.includes("glob:") ||
			lowerS.includes("grep:") ||
			lowerS.includes("list:")
		) {
			return "\x1b[36m"; // Cyan
		}
		if (
			lowerS.includes("writing") ||
			lowerS.includes("editing") ||
			lowerS.includes("implementing") ||
			lowerS.includes("modifying") ||
			lowerS.includes("write:") ||
			lowerS.includes("edit:") ||
			lowerS.includes("create:")
		) {
			return "\x1b[32m"; // Green
		}
		if (
			lowerS.includes("testing") ||
			lowerS.includes("running tests") ||
			lowerS.includes("built") ||
			lowerS.includes("reward:") ||
			lowerS.includes("run:") ||
			lowerS.includes("execute:")
		) {
			return "\x1b[35m"; // Magenta
		}
		if (lowerS.includes("planning")) {
			return "\x1b[34m"; // Blue
		}
		return "";
	}

	/**
	 * Format step for display
	 */
	private formatStep(step: string): string {
		if (!step) return "";

		let displayStep = step;

		// Pattern: "Read file: X" or "Writing: X"
		const fileActionMatch = step.match(
			/^(Read|Write|Edit|Create|Delete|Analyze|Glob|Grep|List|Run|Execute)\s*(?:file)?:\s*(.+)/i,
		);
		if (fileActionMatch) {
			const action = fileActionMatch[1].trim();
			const file = fileActionMatch[2].trim();
			return `${action}: ${file}`;
		}

		// Pattern: "reward: X.YZ"
		const rewardMatch = step.match(/^reward:\s*([0-9.]+)/i);
		if (rewardMatch) {
			return `Reward: ${rewardMatch[1]}`;
		}

		// Format "Thinking: X", "Analyzing: X", etc. as "{X}"
		// Match prefixes with optional colon and space
		const thoughtMatch =
			step.match(/^(?:Thinking|Analyzing|Considering|Warning|Waiting):\s*(.+)/i) ||
			step.match(/^(?:Thinking|Analyzing|Considering|Warning|Waiting)\s+(.+)/i);

		if (thoughtMatch) {
			displayStep = `{${thoughtMatch[1].trim()}}`;
		} else if (
			step.toLowerCase().includes("thinking") ||
			step.toLowerCase().includes("analyzing") ||
			step.toLowerCase().includes("waiting")
		) {
			// If it contains these keywords but didn't match the regex (e.g. no space after keyword),
			// wrap and clean up if not already wrapped
			if (!step.startsWith("{")) {
				displayStep = `{${step.replace(/^(?:Thinking|Analyzing|Considering|Warning|Waiting)[:\s]*/i, "").trim()}}`;
			}
		}

		return displayStep;
	}

	/**
	 * Set agent status
	 */
	setAgentStatus(
		agentNum: number,
		taskTitle: string,
		status: "planning" | "working" | "completed" | "failed",
	): void {
		const current = this.agentProgressMap.get(agentNum);
		if (!current) {
			this.agentProgressMap.set(agentNum, {
				agentNum,
				taskTitle,
				status,
				worktreeDir: "", // Will be updated when sandbox is created
				startTime: Date.now(),
				recentSteps: [],
			});
		} else {
			current.status = status;
		}
	}

	/**
	 * Mark agent as complete
	 */
	agentComplete(agentNum: number): void {
		this.agentProgressMap.delete(agentNum);
		this.lastDisplayUpdate.delete(agentNum);
	}
}
