/**
 * Progress event for planning phase visualization
 * Single source of truth - used by both ui/progress.ts and execution/planning.ts
 */
export interface PlanningProgressEvent {
	/** Task identifier */
	taskId: string;
	/** Current planning status */
	status: "started" | "thinking" | "analyzing" | "planning" | "completed" | "failed";
	/** Optional reward/value from AI engine */
	reward?: number;
	/** Optional message for UI display */
	message?: string;
	/** Timestamp of event */
	timestamp: number;
	/** Optional additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Planning progress callback type
 */
export type PlanningProgressCallback = (event: PlanningProgressEvent) => void;

/**
 * Task status for planning phase
 */
export interface PlanningTaskStatus {
	title: string;
	status: "pending" | "active" | "done" | "failed";
	files?: number;
	time?: string;
	startTime?: number;
	currentStep?: string;
	reward?: number;
	progressEvent?: PlanningProgressEvent;
	recentSteps?: string[];
}
