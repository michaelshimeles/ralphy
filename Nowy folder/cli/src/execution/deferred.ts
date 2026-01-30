import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RALPHY_DIR } from "../config/loader.ts";
import type { Task, TaskSourceType } from "../tasks/types.ts";

interface DeferredEntry {
	count: number;
	last: string;
	title: string;
}

interface DeferredState {
	tasks: Record<string, DeferredEntry>;
}

function getDeferredPath(workDir: string): string {
	return join(workDir, RALPHY_DIR, "deferred.json");
}

function readState(workDir: string): DeferredState {
	const path = getDeferredPath(workDir);
	if (!existsSync(path)) {
		return { tasks: {} };
	}

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as DeferredState;
		return parsed?.tasks ? parsed : { tasks: {} };
	} catch {
		return { tasks: {} };
	}
}

function writeState(workDir: string, state: DeferredState): void {
	const dir = join(workDir, RALPHY_DIR);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(getDeferredPath(workDir), JSON.stringify(state, null, 2), "utf-8");
}

function buildKey(type: TaskSourceType, task: Task, prdFile?: string): string {
	return prdFile ? `${type}:${prdFile}:${task.id}` : `${type}:${task.id}`;
}

export function recordDeferredTask(
	type: TaskSourceType,
	task: Task,
	workDir: string,
	prdFile?: string,
): number {
	const state = readState(workDir);
	const key = buildKey(type, task, prdFile);
	const existing = state.tasks[key];
	const nextCount = (existing?.count ?? 0) + 1;
	state.tasks[key] = {
		count: nextCount,
		last: new Date().toISOString(),
		title: task.title,
	};
	writeState(workDir, state);
	return nextCount;
}

export function clearDeferredTask(
	type: TaskSourceType,
	task: Task,
	workDir: string,
	prdFile?: string,
): void {
	const state = readState(workDir);
	const key = buildKey(type, task, prdFile);
	if (state.tasks[key]) {
		delete state.tasks[key];
		writeState(workDir, state);
	}
}
