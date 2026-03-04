/**
 * High-level execution phase - stable throughout the workflow
 */
export type ExecutionPhase = "planning" | "execution" | "testing";

/**
 * Detailed current activity - for display purposes only, shown below
 */
export type CurrentActivity = "analyzing" | "reading" | "writing" | "thinking" | "running-tests" | "debugging" | "idle";

export interface AgentProgress {
	agentNum: number;
	taskTitle: string;
	worktreeDir: string;
	status: "planning" | "working" | "completed" | "failed";
	/** High-level phase: PLANNING → EXECUTION → TESTING */
	phase?: ExecutionPhase;
	/** Which model is currently running (e.g., "main", "planning", "test") */
	modelName?: string;
	/** Detailed current action shown below */
	currentActivity?: string;
	progress?: string;
	currentStep?: string;
	recentSteps?: string[];
	/** Steps the agent plans to do (extracted from agent's output) */
	plannedSteps?: string[];
	/** The model's thought pipeline - what it's thinking, goals, what it needs to do */
	thoughtPipeline?: string[];
	startTime: number;
}


export interface PlanningProgressEvent {
	taskId: string;
	status: "started" | "thinking" | "completed" | "error" | string;
	timestamp: number;
	message?: string;
	metadata?: Record<string, unknown>;
	reward?: number;
}

export type PlanningProgressCallback = (event: PlanningProgressEvent) => void;
