#!/usr/bin/env bun

import { spawn } from "node:child_process";
import pc from "picocolors";

/**
 * Comprehensive OpenCode debugging utility for Ralphy
 * Shows raw output, parsed responses, token usage, and step detection
 */
class OpenCodeDebugger {
	private rawOutput: string[] = [];
	private parsedResponses: unknown[] = [];
	private steps: string[] = [];
	private startTime: number;
	private totalTokens = { input: 0, output: 0 };

	constructor(private model: string) {
		this.startTime = Date.now();
	}

	logSection(title: string, color: string): void {
		process.stdout.write(`\n${color}=== ${title} ===${pc.reset()}\n`);
	}

	logRawOutput(data: string): void {
		const lines = data.split("\n");
		for (const line of lines) {
			if (line.trim()) {
				this.rawOutput.push(line);

				// Color code different types of output
				if (line.startsWith("{")) {
					process.stdout.write(`${pc.green("📦 RAW JSON")} ${pc.cyan(line)}\n`);
				} else if (line.toLowerCase().includes("error")) {
					process.stdout.write(`${pc.red("🚫 RAW ERROR")} ${pc.red(line)}\n`);
				} else if (line.toLowerCase().includes("rate") || line.toLowerCase().includes("limit")) {
					process.stdout.write(`${pc.yellow("⚠️  RAW RATE")} ${pc.yellow(line)}\n`);
				} else {
					process.stdout.write(`${pc.gray("📝 RAW TEXT")} ${line}\n`);
				}
			}
		}
	}

	processOutput(): void {
		process.stdout.write(`\n${pc.blue("📊 Processing Output...")}\n`);

		for (const line of this.rawOutput) {
			try {
				const parsed = JSON.parse(line);
				this.parsedResponses.push(parsed);

				if (parsed.type === "step_finish") {
					const inputTokens = parsed.part?.tokens?.input || 0;
					const outputTokens = parsed.part?.tokens?.output || 0;
					const cost = parsed.part?.cost;

					this.totalTokens.input += inputTokens;
					this.totalTokens.output += outputTokens;

					process.stdout.write(`${pc.green("✅ STEP COMPLETE")}\n`);
					process.stdout.write(`   Tokens: ${inputTokens} → ${outputTokens}\n`);
					if (cost) process.stdout.write(`   Cost: ${cost}\n`);
				} else if (parsed.type === "text" && parsed.part?.text) {
					process.stdout.write(
						`${pc.blue("📝 TEXT RESPONSE")} ${parsed.part.text.substring(0, 200)}${parsed.part.text.length > 200 ? "..." : ""}\n`,
					);
				} else if (parsed.type === "error") {
					process.stdout.write(`${pc.red("❌ ERROR RESPONSE")} ${JSON.stringify(parsed)}\n`);
				} else {
					process.stdout.write(`${pc.magenta("🔍 OTHER")} ${JSON.stringify(parsed)}\n`);
				}
			} catch {
				// Non-JSON line - check for step detection
				const step = this.detectStep(line);
				if (step) {
					this.steps.push(step);
					process.stdout.write(`${pc.yellow("👣 DETECTED STEP")} ${step}\n`);
				}
			}
		}
	}

	detectStep(line: string): string | null {
		const trimmed = line.trim();
		const lowerLine = trimmed.toLowerCase();

		if (lowerLine.includes("reading") || lowerLine.includes("loading")) {
			if (lowerLine.includes("file")) return "Reading code";
		}
		if (
			lowerLine.includes("writing") ||
			lowerLine.includes("editing") ||
			lowerLine.includes("implementing")
		) {
			if (lowerLine.includes("test")) return "Writing tests";
			return "Implementing";
		}
		if (
			lowerLine.includes("thinking") ||
			lowerLine.includes("analyzing") ||
			lowerLine.includes("considering")
		) {
			return "Thinking";
		}
		if (lowerLine.includes("planning")) {
			return "Planning";
		}
		if (lowerLine.includes("testing") || lowerLine.includes("running tests")) {
			return "Testing";
		}
		if (lowerLine.includes("lint") || lowerLine.includes("formatting")) {
			return "Linting";
		}
		if (lowerLine.includes("commit")) return "Committing";
		if (lowerLine.includes("staging")) return "Staging";

		if (lowerLine.length > 10 && !lowerLine.includes("error") && !lowerLine.includes("failed")) {
			return trimmed.length > 50 ? `${trimmed.substring(0, 47)}...` : trimmed;
		}

		return null;
	}

	showSummary(): void {
		const elapsed = Date.now() - this.startTime;
		const duration = `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;

		process.stdout.write(`\n${pc.bold("📋 EXECUTION SUMMARY")}\n`);
		process.stdout.write(`${pc.cyan("Model:")} ${this.model}\n`);
		process.stdout.write(`${pc.cyan("Duration:")} ${duration}\n`);
		process.stdout.write(`${pc.cyan("Raw Lines:")} ${this.rawOutput.length}\n`);
		process.stdout.write(`${pc.cyan("Parsed Responses:")} ${this.parsedResponses.length}\n`);
		process.stdout.write(`${pc.cyan("Detected Steps:")} ${this.steps.length}\n`);
		process.stdout.write(`${pc.green("Total Input Tokens:")} ${this.totalTokens.input}\n`);
		process.stdout.write(`${pc.green("Total Output Tokens:")} ${this.totalTokens.output}\n`);
		process.stdout.write(
			`${pc.yellow("Total Tokens:")} ${this.totalTokens.input + this.totalTokens.output}\n`,
		);

		if (this.steps.length > 0) {
			process.stdout.write(`\n${pc.bold("📝 RECENT STEPS:")}\n`);
			const recentSteps = this.steps.slice(-5);
			for (const [i, step] of recentSteps.entries()) {
				process.stdout.write(`  ${i + 1}. ${step}\n`);
			}
		}

		if (this.parsedResponses.length > 0) {
			console.log(`\n${pc.bold("🔍 RESPONSE ANALYSIS:")}`);
			const stepFinishes = this.parsedResponses.filter((r) => r.type === "step_finish");
			const texts = this.parsedResponses.filter((r) => r.type === "text");
			const errors = this.parsedResponses.filter((r) => r.type === "error");

			process.stdout.write(`  Step completions: ${stepFinishes.length}\n`);
			process.stdout.write(`  Text responses: ${texts.length}\n`);
			process.stdout.write(`  Errors: ${errors.length}\n`);

			if (texts.length > 0) {
				process.stdout.write(`\n${pc.blue("📄 FINAL TEXT:")}\n`);
				const fullText = texts.map((t) => t.part?.text || "").join("");
				process.stdout.write(`${fullText}\n`);
			}
		}
	}
}

async function debugOpenCode(model: string, prompt: string): Promise<void> {
	const debuggerInstance = new OpenCodeDebugger(model);

	debuggerInstance.logSection("OPENCODE DEBUG SESSION", pc.bold.cyan);
	process.stdout.write(`Model: ${pc.yellow(model)}\n`);
	process.stdout.write(
		`Prompt: ${pc.white(prompt.substring(0, 100))}${prompt.length > 100 ? "..." : ""}\n`,
	);

	const args = ["run", "--format", "json", "--model", model];

	if (process.platform !== "win32") {
		args.push(prompt);
	}

	const proc = spawn("opencode", args, {
		env: {
			...process.env,
			OPENCODE_PERMISSION: '{"*":"allow"}',
			DEBUG_OPENCODE: "true",
		},
		stdio: ["pipe", "pipe", "pipe"],
		shell: process.platform === "win32",
	});

	// Write prompt via stdin on Windows
	if (process.platform === "win32" && proc.stdin) {
		proc.stdin.write(prompt);
		proc.stdin.end();
	}

	// Collect all output
	let _buffer = "";
	proc.stdout?.on("data", (data) => {
		const text = data.toString();
		_buffer += text;
		debuggerInstance.logRawOutput(text);
	});

	proc.stderr?.on("data", (data) => {
		const text = data.toString();
		_buffer += text;
		debuggerInstance.logRawOutput(text);
	});

	proc.on("close", (code) => {
		debuggerInstance.processOutput();
		debuggerInstance.showSummary();

		process.stdout.write(`\n${pc.bold("🔍 EXIT CODE:")} ${code}\n`);

		if (code !== 0) {
			process.stdout.write(pc.red(`\n❌ Process failed with exit code ${code}\n`));
			process.stdout.write(pc.yellow("\n💡 Common solutions:\n"));
			process.stdout.write("  • Check if you're logged in: opencode auth status\n");
			process.stdout.write("  • Verify model exists: opencode models\n");
			process.stdout.write("  • Check quota/credits: opencode auth list\n");
			process.stdout.write("  • Try with --max-parallel 1\n");
			process.stdout.write("  • Use a different model\n");
		}
	});

	proc.on("error", (error) => {
		process.stderr.write(pc.red(`\n❌ Process error: ${error.message}\n`));
	});
}

// Command line interface
const model = process.argv[2] || "opencode/big-pickle";
const prompt = process.argv[3] || "Write a simple hello world function in TypeScript";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
	process.stdout.write(`${pc.bold("OpenCode Debug Utility")}\n`);
	process.stdout.write("\nUsage:\n");
	process.stdout.write("  bun run debug-opencode.ts [model] [prompt]\n");
	process.stdout.write("\nExamples:\n");
	process.stdout.write(
		'  bun run debug-opencode.ts opencode/big-pickle "Refactor this function"\n',
	);
	process.stdout.write(
		'  bun run debug-opencode.ts openai/gpt-4 "Fix the bug in user authentication"\n',
	);
	process.stdout.write("\nAvailable models: opencode models\n");
	process.exit(0);
}

debugOpenCode(model, prompt).catch((err) => {
	process.stderr.write(pc.red(`Error: ${err}\n`));
});
