#!/usr/bin/env bun

import { spawn } from "node:child_process";
import pc from "picocolors";

/**
 * Test OpenCode directly to see raw output
 */
async function testOpencode() {
	const model = process.argv[2] || "opencode/big-pickle";
	const prompt = process.argv[3] || "Write a simple hello world function in TypeScript";

	console.log(pc.bold("🧪 Testing OpenCode Directly"));
	console.log(`Model: ${pc.cyan(model)}`);
	console.log(`Prompt: ${pc.yellow(prompt)}`);
	console.log(`${pc.dim("─".repeat(50))}`);

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

	let output = "";
	let lineCount = 0;

	proc.stdout?.on("data", (data) => {
		const text = data.toString();
		output += text;

		// Process line by line for better visibility
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.trim()) {
				lineCount++;
				const prefix = lineCount.toString().padStart(3, " ");

				// Color code different types of output
				if (line.startsWith("{")) {
					console.log(`${pc.green(prefix)} ${pc.cyan("JSON")}: ${line}`);
				} else if (line.toLowerCase().includes("error")) {
					console.log(`${pc.red(prefix)} ${pc.bgRed("ERR")}: ${line}`);
				} else if (line.toLowerCase().includes("rate") || line.toLowerCase().includes("limit")) {
					console.log(`${pc.yellow(prefix)} ${pc.bgYellow("RATE")}: ${line}`);
				} else if (line.toLowerCase().includes("step")) {
					console.log(`${pc.blue(prefix)} ${pc.bgBlue("STEP")}: ${line}`);
				} else {
					console.log(`${pc.gray(prefix)} ${pc.white("TEXT")}: ${line}`);
				}
			}
		}
	});

	proc.stderr?.on("data", (data) => {
		const text = data.toString();
		console.log(`${pc.red("STDERR")}: ${text}`);
	});

	proc.on("close", (code) => {
		console.log(`${pc.dim("─".repeat(50))}`);
		console.log(pc.bold(`Exit code: ${code}`));
		console.log(pc.bold(`Total lines: ${lineCount}`));
		console.log(pc.bold(`Output length: ${output.length} chars`));

		// Try to extract final response from JSON
		const lines = output.split("\n").filter(Boolean);
		const textParts: string[] = [];
		let totalTokens = 0;

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				if (parsed.type === "text" && parsed.part?.text) {
					textParts.push(parsed.part.text);
				}
				if (parsed.type === "step_finish" && parsed.part?.tokens) {
					totalTokens += parsed.part.tokens.input + (parsed.part.tokens.output || 0);
				}
			} catch {
				// Ignore non-JSON
			}
		}

		if (textParts.length > 0) {
			console.log(`\n${pc.green("📝 Final Response:")}`);
			console.log(pc.dim(textParts.join("")));
		}

		if (totalTokens > 0) {
			console.log(`\n${pc.blue("🔢 Total Tokens Used:")}: ${totalTokens}`);
		}
	});

	proc.on("error", (error) => {
		console.error(pc.red(`Process error: ${error.message}`));
	});
}

// Run the test
testOpencode().catch(console.error);
