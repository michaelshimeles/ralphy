import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { logDebug, logWarn } from "../ui/logger.ts";

type CleanupFn = () => Promise<void> | void;

const cleanupRegistry: Set<CleanupFn> = new Set();
const trackedProcesses: Set<ChildProcess> = new Set();
let isCleaningUp = false;

function isProcessRunning(proc: ChildProcess): boolean {
	return proc.exitCode === null && proc.signalCode === null;
}

/**
 * Register a function to be called on process exit or manual cleanup
 */
export function registerCleanup(fn: CleanupFn): () => void {
	cleanupRegistry.add(fn);
	return () => cleanupRegistry.delete(fn);
}

/**
 * Register a child process to be tracked and killed on exit
 */
export function registerProcess(proc: ChildProcess): () => void {
	trackedProcesses.add(proc);

	const remove = () => trackedProcesses.delete(proc);

	proc.on("exit", remove);
	proc.on("error", remove);

	return remove;
}

/**
 * Run all registered cleanup functions and kill tracked processes
 */
export async function runCleanup(): Promise<void> {
	if (isCleaningUp) return;
	isCleaningUp = true;

	// 1. Kill all tracked child processes with verification
	for (const proc of trackedProcesses) {
		try {
			if (proc.pid && isProcessRunning(proc)) {
				const pid = proc.pid;

				if (process.platform === "win32") {
					// Windows needs taskkill for robust child tree termination
					const result = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
						stdio: "pipe",
					});

					// Verify the process was actually killed
					// Status 128 = process already exited, which is fine
					if (result.status !== 0 && result.status !== 128) {
						logWarn(`taskkill may have failed for PID ${pid} (exit code: ${result.status})`);
						if (result.stderr) {
							logDebug(`taskkill stderr: ${result.stderr.toString()}`);
						}
					}

					await new Promise((resolve) => setTimeout(resolve, 500));
					if (isProcessRunning(proc)) {
						logWarn(`Process ${pid} may still be running after taskkill`);
					}
				} else {
					// Try graceful termination first
					proc.kill("SIGTERM");

					// Wait a bit and verify it's dead
					await new Promise((resolve) => setTimeout(resolve, 1000));

					// Check if process is still running
					if (isProcessRunning(proc)) {
						proc.kill("SIGKILL");

						// Final verification
						await new Promise((resolve) => setTimeout(resolve, 500));
						if (isProcessRunning(proc)) {
							logWarn(`Failed to terminate process ${pid} after SIGKILL`);
						}
					}
				}
			}
		} catch (err) {
			// Process termination failed, continue cleanup
			logDebug(`Failed to terminate process ${proc.pid}: ${err}`);
		}
	}
	trackedProcesses.clear();

	// 2. Run registered cleanup functions
	const promises: Promise<void>[] = [];
	for (const fn of cleanupRegistry) {
		try {
			const result = fn();
			if (result instanceof Promise) {
				promises.push(result);
			}
		} catch (err) {
			// Log sync errors but continue with other cleanup functions
			promises.push(Promise.reject(err));
		}
	}

	const results = await Promise.allSettled(promises);
	for (const result of results) {
		if (result.status === "rejected") {
			logWarn(`Cleanup task failed: ${result.reason}`);
		}
	}
	cleanupRegistry.clear();
	isCleaningUp = false;
}

let isShuttingDown = false;
let handlersRegistered = false;

/**
 * Setup process signal handlers for cleanup
 */
export function setupSignalHandlers(): void {
	if (handlersRegistered) {
		return;
	}
	handlersRegistered = true;

	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

	for (const signal of signals) {
		process.on(signal, async () => {
			// Prevent duplicate cleanup runs
			if (isShuttingDown) {
				process.stdout.write(`\nReceived ${signal}, cleanup already in progress...\n`);
				return;
			}
			isShuttingDown = true;

			// Use writeSync to avoid event loop issues during exit
			process.stdout.write(`\nReceived ${signal}, cleaning up processes and files...\n`);

			try {
				await runCleanup();
				process.exit(0);
			} catch (error) {
				process.stderr.write(`\nCleanup failed: ${error}\n`);
				process.exit(1);
			}
		});
	}

	// Note: uncaughtException is handled in cli/src/index.ts for the main process
	// This avoids duplicate handlers and ensures consistent error handling
}
