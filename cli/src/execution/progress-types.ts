export interface AgentProgress {
	agentNum: number;
	taskTitle: string;
	worktreeDir: string;
	status: "planning" | "working" | "completed" | "failed";
	progress?: string;
	currentStep?: string;
	recentSteps?: string[];
	startTime: number;
}
