import type { AgentProgress, ExecutionPhase } from "../execution/progress-types.ts";
import { formatDuration } from "./logger.ts";

const c = {
	rst: "\x1b[0m",
	bld: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	grn: "\x1b[32m",
	yel: "\x1b[33m",
	blu: "\x1b[34m",
	mag: "\x1b[35m",
	cyn: "\x1b[36m",
	wht: "\x1b[37m",
	gry: "\x1b[90m",
};

function sanitizeTerminalText(value: string): string {
	return (
		value
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape removal
			.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control chars
			.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
	);
}

export class StaticAgentDisplay {
	private static instance: StaticAgentDisplay | null = null;
	private agentProgressMap = new Map<number, AgentProgress>();
	private displayInterval: NodeJS.Timeout | null = null;

	constructor() {
		StaticAgentDisplay.instance?.stopDisplay();
		StaticAgentDisplay.instance = this;
	}
	static getInstance(): StaticAgentDisplay | null {
		return StaticAgentDisplay.instance;
	}

	log(_message: string): void {
		// Logs interrupt display - will be redrawn
	}

	updateAgent(agentNum: number, step: string): void {
		const current = this.agentProgressMap.get(agentNum);
		if (!current) return;
		if (!current.recentSteps) current.recentSteps = [];

		const cleanStep = sanitizeTerminalText(step)
			.trim()
			.replace(/^\[RAW OPENCODE OUTPUT\]\s*/i, "")
			.replace(/^Thinking:\s*/i, "");

		// Skip garbled/encoded content
		if (cleanStep.match(/^[A-Za-z0-9+/]{30,}$/)) return;
		if (!cleanStep || cleanStep.length < 3) return;

		if (current.recentSteps[current.recentSteps.length - 1] === cleanStep) return;

		current.recentSteps.push(cleanStep);
		if (current.recentSteps.length > 5) current.recentSteps.shift();
	}

	updateAgentFromOpenCode(agentNum: number, jsonLine: string): void {
		try {
			// Defensive: ensure jsonLine is a string
			if (typeof jsonLine !== "string") {
				return;
			}
			// Defensive: check for empty or whitespace-only strings
			if (!jsonLine || jsonLine.trim().length === 0) {
				return;
			}
			const normalized = jsonLine.replace(/^\[RAW OPENCODE OUTPUT\]\s*/i, "").trim();
			if (!normalized.startsWith("{")) {
				return;
			}
			const parsed = JSON.parse(normalized);
			// Defensive: validate parsed is an object
			if (!parsed || typeof parsed !== "object") {
				return;
			}
			if (parsed.type === "text" && parsed.part?.text) {
				const text = parsed.part.text.trim();
				if (text && text.length > 3 && !text.startsWith("{")) {
					this.updateAgent(agentNum, text);
				}
			} else if (parsed.type === "tool_use" && parsed.part?.tool) {
				const tool = parsed.part.tool;
				const input = parsed.part.state?.input || {};
				const file = input.filePath || input.path || "";
				this.updateAgent(agentNum, file ? `${tool}: ${file}` : tool);
			} else if (parsed.type === "step_finish" && parsed.part?.tokens) {
				const t = parsed.part.tokens;
				// Defensive: validate token values are numbers
				const inputTokens = typeof t.input === "number" ? t.input : 0;
				const outputTokens = typeof t.output === "number" ? t.output : 0;
				this.updateAgent(agentNum, `${inputTokens}→${outputTokens} tokens`);
			}
		} catch {
			// Not JSON - ignore silently
		}
	}

	startDisplay(): void {
		if (this.displayInterval) return;
		this.render();
		this.displayInterval = setInterval(() => this.render(), 1000);
	}

	stopDisplay(): void {
		if (this.displayInterval) {
			clearInterval(this.displayInterval);
			this.displayInterval = null;
		}
		this.render();
		this.agentProgressMap.clear();
	}

	private render(): void {
		const agents = Array.from(this.agentProgressMap.values());
		if (agents.length === 0) return;

		// Get current phase from first agent
		const currentPhase = agents[0]?.phase || "execution";

		const width = process.stdout.columns || 80;

		// Clear screen and move to top
		process.stdout.write("\x1b[2J\x1b[0;0H");

		// Workflow bar
		console.log();
		console.log(this.renderWorkflowLine(currentPhase, width));
		console.log();

		// Header
		const title = " AGENTS ";
		const side = Math.floor((width - title.length) / 2);
		console.log(
			`${c.cyn}${"─".repeat(side)}${c.bld}${title}${c.rst}${c.cyn}${"─".repeat(width - side - title.length)}${c.rst}`,
		);
		console.log();

		// Each agent with 5 numbered steps
		for (const agent of agents) {
			console.log(this.renderAgentLine(agent));

			const steps = agent.recentSteps || [];
			// Pad to always show 5 lines
			for (let i = 0; i < 5; i++) {
				const num = i + 1;
				if (i < steps.length) {
					const formatted = this.formatStepWithColors(steps[steps.length - 1 - i]);
					console.log(`   ${c.gry}${num}.${c.rst} ${formatted}`);
				} else {
					console.log(`   ${c.gry}${num}.${c.rst}`);
				}
			}
			console.log();
		}

		// Instructions at bottom
		console.log(`${c.gry}Press Ctrl+C to stop${c.rst}`);
	}

	private renderWorkflowLine(phase: ExecutionPhase, width: number): string {
		const phases: ExecutionPhase[] = ["planning", "execution", "testing"];
		const phaseIndex = phases.indexOf(phase);

		const parts: string[] = [];
		for (let i = 0; i < phases.length; i++) {
			const p = phases[i];
			const isActive = i === phaseIndex;
			const isPast = i < phaseIndex;

			if (isActive) {
				const color = p === "planning" ? c.cyn : p === "execution" ? c.mag : c.yel;
				parts.push(`${c.bld}${color}▓▓▓ ${p.toUpperCase()} ▓▓▓${c.rst}`);
			} else if (isPast) {
				parts.push(`${c.gry}░ ${p.toUpperCase()} ░${c.rst}`);
			} else {
				parts.push(`${c.gry}${c.dim}  ${p.toUpperCase()}  ${c.rst}`);
			}

			if (i < phases.length - 1) {
				parts.push(isPast ? `${c.cyn} → ${c.rst}` : `${c.gry} → ${c.rst}`);
			}
		}

		const content = parts.join("");
		const pad = Math.max(0, Math.floor((width - this.stripAnsi(content).length) / 2));
		return " ".repeat(pad) + content;
	}

	private stripAnsi(str: string): string {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are intentional
		return str.replace(/\x1b\[[0-9;]*m/g, "");
	}

	private formatStepWithColors(step: string): string {
		// Match patterns like "Tool: bash: command" or "Glob: pattern" or "Read: filepath"
		const toolMatch = step.match(
			/^(Tool|Read|Write|Edit|Create|Delete|Glob|Grep|Search|Analyze|Run|Test|Execute|Build|Fix|Debug)\s*:\s*(.+)/i,
		);
		if (toolMatch) {
			const action = toolMatch[1];
			const rest = toolMatch[2];
			// Split rest by first colon if present (e.g., "bash: ls -la")
			const subMatch = rest.match(/^([^:]+):\s*(.+)/);
			if (subMatch) {
				const tool = subMatch[1];
				const args = subMatch[2];
				// Color the action type
				const actionColor = this.getActionColor(action);
				return `${actionColor}${action}${c.rst}: ${c.cyn}${tool}${c.rst}: ${c.gry}${args.slice(0, 50)}${c.rst}`;
			}
			// No sub-colon, just action: rest
			const actionColor = this.getActionColor(action);
			return `${actionColor}${action}${c.rst}: ${c.gry}${rest.slice(0, 55)}${c.rst}`;
		}
		// For plain text steps, return as-is (will be white)
		return `${c.wht}${step.slice(0, 60)}${c.rst}`;
	}

	private getActionColor(action: string): string {
		const lower = action.toLowerCase();
		if (lower === "tool" || lower === "run" || lower === "execute") return c.yel;
		if (
			lower === "read" ||
			lower === "glob" ||
			lower === "grep" ||
			lower === "search" ||
			lower === "analyze"
		)
			return c.blu;
		if (lower === "write" || lower === "edit" || lower === "create" || lower === "delete")
			return c.mag;
		if (lower === "test" || lower === "build") return c.grn;
		if (lower === "fix" || lower === "debug") return c.red;
		return c.wht;
	}

	private renderAgentLine(agent: AgentProgress): string {
		const phase = agent.phase || "execution";
		const model = agent.modelName || "main";
		const elapsed = formatDuration(Date.now() - agent.startTime);
		const status =
			agent.status === "completed"
				? `${c.grn}✓${c.rst}`
				: agent.status === "failed"
					? `${c.red}✗${c.rst}`
					: `${c.cyn}●${c.rst}`;

		const phaseColor = phase === "planning" ? c.cyn : phase === "execution" ? c.mag : c.yel;
		const phaseTag = `${phaseColor}[${phase.toUpperCase()}]${c.rst}`;
		const modelTag = `${c.gry}[${c.blu}${model}${c.gry}]${c.rst}`;
		const title =
			agent.taskTitle.length > 30 ? `${agent.taskTitle.slice(0, 27)}...` : agent.taskTitle;

		return `${status} ${c.bld}Agent ${agent.agentNum}${c.rst} ${phaseTag} ${c.wht}${title}${c.rst} ${modelTag} ${c.gry}${elapsed}${c.rst}`;
	}

	setAgentStatus(
		agentNum: number,
		taskTitle: string,
		status: "planning" | "working" | "completed" | "failed",
		phase?: ExecutionPhase,
		modelName?: string,
	): void {
		const current = this.agentProgressMap.get(agentNum);
		if (!current) {
			this.agentProgressMap.set(agentNum, {
				agentNum,
				taskTitle,
				status,
				phase: phase || "execution",
				modelName: modelName || "main",
				worktreeDir: "",
				startTime: Date.now(),
				recentSteps: [],
			});
		} else {
			current.taskTitle = taskTitle;
			current.status = status;
			if (phase) current.phase = phase;
			if (modelName) current.modelName = modelName;
		}
	}

	getAgentTaskTitle(agentNum: number): string | undefined {
		return this.agentProgressMap.get(agentNum)?.taskTitle;
	}

	clearAgentSteps(agentNum: number): void {
		const current = this.agentProgressMap.get(agentNum);
		if (current) current.recentSteps = [];
	}

	agentComplete(agentNum: number): void {
		this.agentProgressMap.delete(agentNum);
	}
}
