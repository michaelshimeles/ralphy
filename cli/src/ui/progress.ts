import { execSync } from "node:child_process";
import pc from "picocolors";
import type { AgentProgress } from "../execution/progress-types.ts";
import type { PlanningProgressEvent, PlanningTaskStatus } from "./index.ts";
import { verboseMode } from "./logger.ts";

// Re-export types for backward compatibility
export type { PlanningProgressEvent, PlanningTaskStatus } from "./index.ts";

let ansiSupportChecked = false;
let ansiSupported = true;

function checkAnsiSupport(): void {
	if (ansiSupportChecked) return;
	ansiSupportChecked = true;

	if (process.platform !== "win32") {
		ansiSupported = true;
		return;
	}

	try {
		execSync("chcp 65001 > nul 2>&1", { stdio: "ignore" });
		ansiSupported = true;
	} catch {
		ansiSupported = false;
	}
}

checkAnsiSupport();

function sanitizeTerminalText(value: string): string {
	return value
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape removal
		.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control chars
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

const SPINNER_CHARS = ["|", "/", "-", "\\"];

function getSpinner(index: number): string {
	return SPINNER_CHARS[index % SPINNER_CHARS.length];
}

function setLogHandler(_handler: ((message: string) => void) | null): void {
	// No-op: handler is not currently used but kept for API compatibility
}

function clearConsole(lines: number): void {
	if (!ansiSupported) {
		// In verbose mode, we don't clear, we just log new lines
		// But the current logic relies on clearing to animate.
		// We will handle this in the render methods instead.
		return;
	}
	for (let i = 0; i < lines; i++) {
		process.stdout.write("\x1B[1A\x1B[2K\r");
	}
	process.stdout.write("\r");
}

export class ProgressDisplay {
	private lastUpdate = 0;
	private planningCompleteCalled = false;
	private taskSpinners: Map<number, number> = new Map();
	private agentSpinners: Map<number, number> = new Map();
	private lastLineCount = 0;
	private planningSpinnerIdx = 0;
	private planningTasks: PlanningTaskStatus[] | null = null;
	private planningInterval: NodeJS.Timeout | null = null;

	constructor() {
		// Bind safeLog to this instance
		this.safeLog = this.safeLog.bind(this);
	}

	private safeLog(msg: string): void {
		this.clear();
		process.stdout.write(`${msg}\n`);
		// Force redraw if active
		if (this.planningTasks) {
			this.redrawPlanning();
		} else if (this.agentSpinners.size > 0 || this.lastLineCount > 0) {
			// Re-render execution agents if we have data,
			// but we need the agent data which we don't store persistantly here (passed to renderAgentCards).
			// We can't easily redraw execution state without the data.
			// However, the next tick will redraw it.
			// Crucially, we cleared the console so the cursor is at the right spot.
		}
	}

	showPhaseHeader(phase: string, description: string): void {
		this.stopAll();

		// Register log handler
		setLogHandler(this.safeLog);

		process.stdout.write(`${pc.cyan(`+${"=".repeat(70)}+`)}\n`);
		process.stdout.write(`${pc.cyan(`|  ${phase.padEnd(68)} |`)}\n`);
		process.stdout.write(`${pc.cyan(`+${"=".repeat(70)}+`)}\n`);
		process.stdout.write(`${pc.white(`   ${description}\n`)}\n`);

		this.lastUpdate = Date.now();
		this.planningCompleteCalled = false;
		this.taskSpinners.clear();
		this.agentSpinners.clear();
		this.lastLineCount = 0;
	}

	showPlanningProgress(tasks: PlanningTaskStatus[]): void {
		if (!ansiSupported) {
			const active = tasks.filter((task) => task.status === "active");
			if (active.length > 0) {
				const first = active[0];
				const step = first.currentStep ? ` [${first.currentStep}]` : "";
				process.stdout.write(`Planning: ${first.title}${step}\n`);
			}
			return;
		}

		// Start animation interval if not already
		if (this.planningTasks !== tasks) {
			if (this.planningInterval) {
				clearInterval(this.planningInterval);
			}
			this.planningTasks = tasks;
			this.planningInterval = setInterval(() => {
				this.planningSpinnerIdx++;
				this.redrawPlanning();
			}, 200);
		}

		this.redrawPlanning();
	}

	private redrawPlanning(): void {
		if (!this.planningTasks) return;

		const tasks = this.planningTasks;
		const doneCount = tasks.filter((t) => t.status === "done").length;
		const failedCount = tasks.filter((t) => t.status === "failed").length;
		const activeCount = tasks.filter((t) => t.status === "active").length;

		const lines: string[] = [];
		// Only show header in non-verbose mode or if state changed (simplified)
		// In verbose mode we probably just want to log specific events,
		// but for now let's just avoid clearing.
		if (!verboseMode) {
			lines.push(
				pc.cyan(
					`[PLANNING] ${doneCount}/${tasks.length} done${failedCount > 0 ? `, ${failedCount} failed` : ""} (${activeCount} active)`,
				),
			);
		}

		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i];
			const taskTrunc = task.title.length > 55 ? `${task.title.substring(0, 52)}...` : task.title;

			if (task.status === "active") {
				const spinner = getSpinner(this.planningSpinnerIdx);
				const elapsed = task.startTime ? ` (${formatDuration(Date.now() - task.startTime)})` : "";
				const stepInfo = task.currentStep ? ` ${pc.dim(`[${task.currentStep}]`)}` : "";
				const rewardInfo = task.reward ? ` ${pc.yellow(`Reward: ${task.reward}`)}` : "";
				lines.push(`${spinner} Planning: ${taskTrunc}${elapsed}${stepInfo}${rewardInfo}`);

				// Render recent steps history for active tasks
				if (task.recentSteps && task.recentSteps.length > 0) {
					// Show progress flow with arrows
					// Current step (with completion status) → Previous steps
					const completionIcon = pc.cyan("→");
					lines.push(`    ${completionIcon} ${pc.bold(task.currentStep || "Working")}`);

					// Show up to 5 previous steps with arrows
					for (let i = 1; i < task.recentSteps.length && i < 6; i++) {
						const step = task.recentSteps[i];
						const formattedStep = this.formatPlanningStep(step);
						// Skip empty formatted steps
						if (formattedStep) {
							lines.push(`    ${pc.dim(`↓ ${formattedStep}`)}`);
						}
					}
				}
			} else if (task.status === "done") {
				const spinner = pc.green("✓");
				const completionIcon = pc.green("✓");
				const files = task.files || 0;
				const time = task.time || "?";
				const rewardInfo = task.reward ? ` ${pc.yellow(`Reward: ${task.reward}`)}` : "";
				lines.push(
					`${spinner} ${pc.dim(completionIcon)} Planning: ${taskTrunc} (${files} files, ${time}s)${rewardInfo}`,
				);
			} else if (task.status === "failed") {
				const rewardInfo = task.reward ? ` ${pc.yellow(`Reward: ${task.reward}`)}` : "";
				lines.push(`${pc.red("[FAIL]")} Planning: ${taskTrunc}${rewardInfo}`);
			} else if (task.status === "pending") {
				const rewardInfo = task.reward ? ` ${pc.yellow(`Reward: ${task.reward}`)}` : "";
				lines.push(` Pending: ${taskTrunc}${rewardInfo}`);
			}
		}

		clearConsole(this.lastLineCount);
		for (const line of lines) {
			process.stdout.write(`${line}\n`);
		}
		this.lastLineCount = lines.length;
	}

	showPlanningComplete(_completed: number, _duration: number): void {
		if (this.planningCompleteCalled) return;
		this.planningCompleteCalled = true;

		if (this.planningInterval) {
			clearInterval(this.planningInterval);
			this.planningInterval = null;
		}
		this.planningTasks = null;

		clearConsole(this.lastLineCount);
		this.taskSpinners.clear();
		this.lastLineCount = 0;
	}

	showBatchInfo(_batchNum: number, _totalBatches: number, _taskCount: number): void {}

	showExecutionStart(_agentCount: number): void {}

	renderAgentCards(agents: AgentProgress[]): void {
		const now = Date.now();
		const activeAgents = agents.filter((a) => a.status === "working");

		// Show each agent in a static row format with their recent action
		const lines: string[] = [];
		for (const agent of activeAgents) {
			const elapsed = formatDuration(now - agent.startTime);
			const taskTrunc =
				agent.taskTitle.length > 50 ? `${agent.taskTitle.substring(0, 47)}...` : agent.taskTitle;

			// Get the most recent step from recentSteps
			const recentStep =
				agent.recentSteps && agent.recentSteps.length > 0
					? agent.recentSteps[agent.recentSteps.length - 1]
					: null;

			let stepDisplay = "";
			if (recentStep) {
				stepDisplay = this.formatAgentStep(recentStep);
			} else {
				stepDisplay = "Initializing...";
			}

			const statusColor =
				agent.status === "completed" ? pc.green : agent.status === "failed" ? pc.red : pc.white;
			const statusIcon = agent.status === "completed" ? "✓" : agent.status === "failed" ? "✗" : "→";

			lines.push(statusColor(`[${statusIcon}] Agent ${agent.agentNum}: ${taskTrunc} (${elapsed})`));
			lines.push(`     ${stepDisplay}`);

			// Show up to 5 previous steps
			if (agent.recentSteps && agent.recentSteps.length > 1) {
				const previousSteps = agent.recentSteps.slice(0, -1).slice(-5).reverse();
				for (const step of previousSteps) {
					const formatted = this.formatAgentStep(step);
					if (formatted) {
						lines.push(`     ${pc.dim(formatted)}`);
					}
				}
			}

			lines.push(""); // Add spacing between agents
		}

		clearConsole(this.lastLineCount);
		for (const line of lines) {
			process.stdout.write(`${line}\n`);
		}
		this.lastLineCount = lines.length;
	}

	showAgentComplete(agentNum: number, _taskTitle: string, _success: boolean): void {
		this.agentSpinners.delete(agentNum);
	}

	showHeartbeat(message: string, activeCount?: number): void {
		const now = Date.now();
		const elapsed = formatDuration(now - this.lastUpdate);

		const parts = [message];
		if (activeCount != null) {
			parts.push(`${activeCount} active`);
		}
		parts.push(`${elapsed} elapsed`);

		clearConsole(this.lastLineCount);
		process.stdout.write(`${pc.dim(parts.join(" | "))}\n`);
		this.lastLineCount = 1;
		this.lastUpdate = now;
	}

	showBatchComplete(
		_batchNum: number,
		_totalBatches: number,
		_completed: number,
		_failed: number,
	): void {
		this.stopAll();
	}

	showSummary(completed: number, failed: number, duration: number): void {
		this.stopAll();
		process.stdout.write("\n");
		process.stdout.write(
			`${pc.cyan("+======================================================================+")}\n`,
		);
		process.stdout.write(
			`${pc.cyan("|  SUMMARY                                                             |")}\n`,
		);
		process.stdout.write(
			`${pc.cyan("+======================================================================+")}\n`,
		);
		process.stdout.write(
			`|  Completed:   ${completed.toString().padEnd(10)}                                   |\n`,
		);
		process.stdout.write(
			`|  Failed:      ${failed.toString().padEnd(10)}                                   |\n`,
		);
		process.stdout.write(
			`|  Duration:    ${formatDuration(duration).padEnd(10)}                                   |\n`,
		);
		process.stdout.write(
			`${pc.cyan("+======================================================================+")}\n`,
		);
	}

	private formatAgentStep(step: string): string {
		if (!step) return "";
		const safeStep = sanitizeTerminalText(step);

		// Pattern: "Read file: X" or "Writing: X"
		const fileActionMatch = safeStep.match(
			/^(Read|Write|Edit|Create|Delete|Analyze)\s*(?:file)?:\s*(.+)/i,
		);
		if (fileActionMatch) {
			const action = fileActionMatch[1].trim();
			let file = fileActionMatch[2].trim();
			// Remove task title from file path if present
			file = file.replace(/^Task\s+ST-\d+:\s*[^"]+"\s*/, "").trim();
			const shortFile = file.length > 40 ? `${file.substring(0, 37)}...` : file;
			return `${action}: ${shortFile}`;
		}

		// Pattern: "reward: X.YZ"
		const rewardMatch = safeStep.match(/^reward:\s*([0-9.]+)/i);
		if (rewardMatch) {
			return `Reward: ${rewardMatch[1]}`;
		}

		// Pattern: "Thinking about X" or similar - preserve full context
		const thinkingMatch = safeStep.match(/^(Thinking|Analyzing|Planning)(?:\s+(?:about\s+)?)?(.+)/i);
		if (thinkingMatch) {
			const action = thinkingMatch[1].trim();
			const rest = thinkingMatch[2].trim();
			// If original had "about" between action and rest, preserve it
			const hadAbout = safeStep.match(/^(Thinking|Analyzing|Planning)\s+about\s+/i);
			return hadAbout ? `${action} about ${rest}` : `${action} ${rest}`;
		}

		// Remove task title if it appears in common progress messages
		const taskTitleMatch = safeStep.match(/Task\s+ST-\d+:\s*(.+)/i);
		if (taskTitleMatch) {
			const content = taskTitleMatch[1].trim();
			return this.formatPlanningStep(content);
		}

		// Pattern: "for \"X\"" or similar - extract quoted content
		const quotedMatch = safeStep.match(/for\s+"([^"]+)"/i);
		if (quotedMatch) {
			return quotedMatch[1].trim();
		}

		// Default: truncate if too long
		return safeStep.length > 80 ? `${safeStep.substring(0, 77)}...` : safeStep;
	}

	stopAll(): void {
		if (this.planningInterval) {
			clearInterval(this.planningInterval);
			this.planningInterval = null;
		}
		this.planningTasks = null;
		this.taskSpinners.clear();
		this.agentSpinners.clear();
		this.lastLineCount = 0;
		setLogHandler(null);
	}

	/**
	 * Update a single planning task based on progress events
	 */
	updatePlanningProgress(event: PlanningProgressEvent): void {
		if (!this.planningTasks) return;

		// Find task by title
		const taskIndex = this.planningTasks.findIndex((t) => t.title === event.taskId);
		if (taskIndex === -1) {
			// Add new task if not found
			this.planningTasks.push({
				title: event.taskId,
				status: this.mapProgressStatus(event.status),
				startTime: event.status === "started" ? event.timestamp : Date.now(),
				currentStep: event.message,
				reward: event.reward,
				progressEvent: event,
				recentSteps: event.message ? [event.message] : [],
			});
		} else {
			// Update existing task
			const task = this.planningTasks[taskIndex];
			task.status = this.mapProgressStatus(event.status);
			if (event.message && event.message !== task.currentStep) {
				// Maintain history of last 5 steps
				if (!task.recentSteps) {
					task.recentSteps = [];
				}
				// Only add if not already in recent history (deduplication)
				if (!task.recentSteps.includes(event.message)) {
					task.recentSteps.unshift(event.message);
				}
				if (task.recentSteps.length > 5) {
					task.recentSteps.pop();
				}
				task.currentStep = event.message;
			}
			if (event.reward !== undefined) {
				task.reward = event.reward;
			}
			if (event.status === "completed" && event.metadata?.fileCount) {
				task.files = event.metadata.fileCount as number;
			}
			task.progressEvent = event;
		}
	}

	private mapProgressStatus(status: PlanningProgressEvent["status"]): PlanningTaskStatus["status"] {
		switch (status) {
			case "started":
			case "thinking":
			case "analyzing":
			case "planning":
				return "active";
			case "completed":
				return "done";
			case "failed":
				return "failed";
			default:
				return "pending";
		}
	}

	private formatPlanningStep(step: string): string {
		// Try to extract tool and target patterns like "Using tool X on file Y"
		// or "Read file: src/index.ts"

		// Trim first
		const formatted = sanitizeTerminalText(step).trim();

		// Safety check: if it looks like JSON or a JSON fragment, don't show it here
		if (formatted.startsWith("{") || formatted.startsWith("[")) {
			return "";
		}

		// If message is just the task title, return empty
		if (/^Task\s+ST-\d+:\s*/.test(formatted)) {
			return "";
		}

		// Pattern: "Tool: X on Y" or "Using X on Y" or "Tool for Y"
		const toolMatch = formatted.match(/(?:Tool:\s*|Using\s+)(.+?)\s+(?:on\s+|for\s+)(.+)/i);
		if (toolMatch) {
			const target = toolMatch[2].trim();
			// Remove task title from target if present
			const cleanTarget = target.replace(/^"Task\s+ST-\d+:\s*[^"]+"\s*/, "").trim();
			return `Tool → ${cleanTarget}`;
		}

		// Pattern: "Tool for Y" (no tool name)
		const toolForMatch = formatted.match(/^Tool\s+(?:for\s+|on\s+)(.+)/i);
		if (toolForMatch) {
			let target = toolForMatch[1].trim();
			// Remove task title from target if present
			target = target.replace(/^"Task\s+ST-\d+:\s*[^"]+"\s*/, "").trim();
			if (target) return `Tool → ${target}`;
		}

		// Pattern: "Read file: X" or "Writing: X"
		const fileActionMatch = formatted.match(
			/^(Read|Write|Edit|Create|Delete|Analyze)\s*(?:file)?:\s*(.+)/i,
		);
		if (fileActionMatch) {
			const action = fileActionMatch[1];
			let file = fileActionMatch[2].trim();
			// Remove task title from file path if present
			file = file.replace(/^"Task\s+ST-\d+:\s*[^"]+"\s*/, "").trim();
			const shortFile = file.length > 40 ? `${file.substring(0, 37)}...` : file;
			return `${action}: ${shortFile}`;
		}

		// Pattern: "reward: X.YZ"
		const rewardMatch = formatted.match(/^reward:\s*([0-9.]+)/i);
		if (rewardMatch) {
			return `Reward: ${rewardMatch[1]}`;
		}

		// Pattern: "Thinking about X" or "Analyzing X" or "Planning X" - preserve full context
		const thinkingMatch = formatted.match(
			/^(Thinking|Analyzing|Planning)(?:\s+(?:about\s+)?)?(.+)/i,
		);
		if (thinkingMatch) {
			const action = thinkingMatch[1].trim();
			const rest = thinkingMatch[2].trim();
			// If the original had "about" between action and rest, preserve it
			const hadAbout = formatted.match(/^(Thinking|Analyzing|Planning)\s+about\s+/i);
			return hadAbout ? `${action} about ${rest}` : `${action} ${rest}`;
		}

		// Remove task title if it appears (common in progress messages)
		const taskTitleMatch = formatted.match(/Task ST-\d+:\s*(.+)/i);
		if (taskTitleMatch) {
			const content = taskTitleMatch[1].trim();
			if (!content || content === formatted) {
				return "";
			}
			const shortContent = content.length > 60 ? `${content.substring(0, 57)}...` : content;
			return shortContent;
		}

		// Pattern: "for \"X\"" or similar - extract quoted content
		const quotedMatch = formatted.match(/for\s+"([^"]+)"/i);
		if (quotedMatch) {
			return quotedMatch[1].trim();
		}

		// Display standalone thinking words without emoji
		if (/^(Thinking|Analyzing|Planning)$/i.test(formatted)) {
			return formatted;
		}

		// Remove standalone "Tool" or action words without context
		if (/^(Tool|Executing|Processing)$/i.test(formatted)) {
			return "";
		}

		// Truncate long messages
		if (formatted.length > 60) {
			return `${formatted.substring(0, 57)}...`;
		}

		return formatted;
	}

	clear(): void {
		clearConsole(this.lastLineCount);
		this.stopAll();
	}
}
