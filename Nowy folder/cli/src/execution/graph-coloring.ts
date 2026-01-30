import type { Task } from "../tasks/types.ts";

export interface PlannedTask {
	task: Task;
	files: string[];
	color?: number;
}

export interface ConflictGraph {
	nodes: Map<string, string[]>;
}

export function buildConflictGraph(tasks: PlannedTask[]): ConflictGraph {
	const graph: ConflictGraph = { nodes: new Map() };
	const fileToTasks = new Map<string, string[]>();

	// Build file-to-task mapping: O(n × m)
	for (const task of tasks) {
		for (const file of task.files) {
			const tasksForFile = fileToTasks.get(file) || [];
			tasksForFile.push(task.task.id);
			fileToTasks.set(file, tasksForFile);
		}
	}

	// Build conflicts from file mapping: O(n × m)
	for (const task of tasks) {
		const conflicts = new Set<string>();
		for (const file of task.files) {
			const tasksForFile = fileToTasks.get(file) || [];
			for (const taskId of tasksForFile) {
				if (taskId !== task.task.id) {
					conflicts.add(taskId);
				}
			}
		}
		graph.nodes.set(task.task.id, Array.from(conflicts));
	}

	return graph;
}

/**
 * DSatur graph coloring algorithm
 * Prioritizes nodes by saturation (number of different colors used by neighbors)
 */
export function colorGraph(tasks: PlannedTask[], graph: ConflictGraph): Map<string, number> {
	const colors = new Map<string, number>();
	if (tasks.length === 0) return colors;

	const saturation = new Map<string, Set<number>>();
	const uncolored = new Set<string>();

	for (const task of tasks) {
		saturation.set(task.task.id, new Set());
		uncolored.add(task.task.id);
	}

	while (uncolored.size > 0) {
		let maxSatNode: string | null = null;
		let maxSat = -1;
		let maxDegree = -1;

		for (const nodeId of uncolored) {
			const sat = saturation.get(nodeId)?.size || 0;
			const degree = graph.nodes.get(nodeId)?.length || 0;

			if (sat > maxSat || (sat === maxSat && degree > maxDegree)) {
				maxSat = sat;
				maxDegree = degree;
				maxSatNode = nodeId;
			}
		}

		if (!maxSatNode) break;

		const usedColors = saturation.get(maxSatNode) || new Set();
		let color = 0;
		while (usedColors.has(color)) {
			color++;
		}

		colors.set(maxSatNode, color);
		uncolored.delete(maxSatNode);

		const neighbors = graph.nodes.get(maxSatNode) || [];
		for (const neighborId of neighbors) {
			if (uncolored.has(neighborId)) {
				saturation.get(neighborId)?.add(color);
			}
		}
	}

	return colors;
}

export function batchByColor(
	tasks: PlannedTask[],
	colors: Map<string, number>,
	maxParallel: number,
): Map<number, PlannedTask[]> {
	const batches = new Map<number, PlannedTask[]>();

	for (const task of tasks) {
		const color = colors.get(task.task.id) || 0;
		task.color = color;

		let batch = batches.get(color);
		if (!batch) {
			batch = [];
			batches.set(color, batch);
		}
		batch.push(task);
	}

	// If any batch exceeds maxParallel, split it into sub-batches
	const finalBatches = new Map<number, PlannedTask[]>();
	let nextBatchId = 0;

	// Sort colors to maintain deterministic order
	const sortedColors = Array.from(batches.keys()).sort((a, b) => a - b);

	for (const color of sortedColors) {
		const batch = batches.get(color) || [];
		if (batch.length <= maxParallel) {
			finalBatches.set(nextBatchId++, batch);
		} else {
			for (let i = 0; i < batch.length; i += maxParallel) {
				finalBatches.set(nextBatchId++, batch.slice(i, i + maxParallel));
			}
		}
	}

	return finalBatches;
}
