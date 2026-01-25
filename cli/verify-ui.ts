import type { AgentProgress } from "./src/execution/progress-types.ts";
import { ProgressDisplay } from "./src/ui/progress.ts";

async function main() {
	const display = new ProgressDisplay();
	display.showPhaseHeader("VERIFICATION", "Testing UI Visualization with history");

	const agents: AgentProgress[] = [
		{
			agentNum: 1,
			taskTitle: "Implement visualization",
			worktreeDir: "",
			status: "working",
			startTime: Date.now(),
			currentStep: "Starting...",
			recentSteps: ["Starting..."],
		},
	];

	display.renderAgentCards(agents);

	// Simulate steps
	const steps = [
		"Thinking",
		"Reading code",
		"Analyzing dependencies",
		"Modifying file",
		"Running lint",
		"Writing tests",
		"Verifying",
	];

	for (const step of steps) {
		await new Promise((resolve) => setTimeout(resolve, 800));
		const agent = agents[0];
		agent.currentStep = step;
		if (!agent.recentSteps) agent.recentSteps = [];
		agent.recentSteps.unshift(step);
		if (agent.recentSteps.length > 5) agent.recentSteps.pop();
		display.renderAgentCards(agents);
	}

	display.stopAll();
	console.log("\nVerification complete.");
}

main();
