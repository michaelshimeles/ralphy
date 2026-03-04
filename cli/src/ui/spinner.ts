import { createSpinner } from "nanospinner";
import pc from "picocolors";
import { logDebug, logError, logInfo, logWarn } from "./logger.ts";

export type SpinnerInstance = ReturnType<typeof createSpinner>;

/**
 * Progress spinner with step tracking
 */
export class ProgressSpinner {
	private spinner: SpinnerInstance;
	private startTime: number;
	private currentStep = "Thinking";
	private task: string;
	private settings: string;
	private tickInterval: ReturnType<typeof setInterval> | null = null;
	private lastUpdate = 0;
	private readonly UPDATE_THROTTLE = 50; // Minimum 50ms between updates (very responsive)
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private heartbeatCount = 0;

	constructor(task: string, settings?: string[]) {
		this.task = task.length > 40 ? `${task.slice(0, 37)}...` : task;
		this.settings = settings?.length ? `[${settings.join(", ")}]` : "";
		this.startTime = Date.now();

		try {
			this.spinner = createSpinner(this.formatText()).start();
		} catch (_error) {
			// Fallback: If nanospinner fails, create a simple object that won't crash
			logWarn("Spinner initialization failed, using fallback mode");
			interface SpinnerOptions {
				text?: string;
			}
			this.spinner = {
				success: (opts: SpinnerOptions) => logInfo(opts?.text || "Done"),
				error: (opts: SpinnerOptions) => logError(opts?.text || "Error"),
				update: () => {},
				stop: () => {},
			} as unknown as SpinnerInstance;
			logInfo(`Started: ${this.formatText()}`);
		}

		// Update timer every second
		try {
			this.tickInterval = setInterval(() => {
				try {
					this.tick();
				} catch (tickErr) {
					logDebug(
						`Spinner tick error: ${tickErr instanceof Error ? tickErr.message : String(tickErr)}`,
					);
				}
			}, 1000);
		} catch (_error) {
			logWarn("Timer initialization failed, spinner will not auto-update");
			this.tickInterval = null;
		}

		// Add heartbeat to keep spinner alive even when no output
		try {
			this.heartbeatInterval = setInterval(() => {
				try {
					this.heartbeatCount++;
					// Force a tick every 5 seconds to show we're still alive
					if (this.heartbeatCount % 5 === 0) {
						this.tick();
					}
				} catch (heartbeatErr) {
					logDebug(
						`Spinner heartbeat error: ${heartbeatErr instanceof Error ? heartbeatErr.message : String(heartbeatErr)}`,
					);
				}
			}, 1000);
		} catch (_error) {
			logWarn("Heartbeat initialization failed");
			this.heartbeatInterval = null;
		}

		// Force immediate tick to ensure spinner is visible
		this.tick();
	}

	private formatText(): string {
		// Guard against uninitialized spinner
		if (!this.spinner) {
			return this.task || "Loading...";
		}
		const elapsed = Date.now() - this.startTime;
		const secs = Math.floor(elapsed / 1000);
		const mins = Math.floor(secs / 60);
		const remainingSecs = secs % 60;
		const time = mins > 0 ? `${mins}m ${remainingSecs}s` : `${secs}s`;

		const settingsStr = this.settings ? ` ${pc.yellow(this.settings)}` : "";
		return `${pc.cyan(this.currentStep)}${settingsStr} ${pc.dim(`[${time}]`)} ${this.task}`;
	}

	/**
	 * Update the current step
	 */
	updateStep(step: string): void {
		this.currentStep = step;
		const now = Date.now();

		// Throttle updates to prevent overwhelming the spinner
		if (now - this.lastUpdate < this.UPDATE_THROTTLE) {
			return;
		}

		this.lastUpdate = now;
		try {
			this.spinner.update({ text: this.formatText() });
		} catch (_error) {
			// Fallback: Just log the progress if spinner update fails
			logInfo(`[${this.formatText()}]`);
		}
	}

	/**
	 * Update spinner text (called periodically to update time)
	 */
	tick(): void {
		if (!this.tickInterval) {
			// Don't update if spinner is stopped
			return;
		}

		try {
			// Always update the timer, bypassing throttle
			this.spinner.update({ text: this.formatText() });

			// Force output flush on Windows to prevent blocking
			if (process.platform === "win32") {
				// This helps prevent "stuck" appearance on Windows terminals
				process.stdout.write?.("");
			}
		} catch (_error) {
			// Fallback: Just log the progress if spinner update fails
			logInfo(`[${this.formatText()}]`);
		}
	}

	private clearTickInterval(): void {
		if (this.tickInterval) {
			clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	/**
	 * Mark as success
	 */
	success(message?: string): void {
		this.clearTickInterval();
		if (this.spinner) {
			this.spinner.success({ text: message || this.formatText() });
		}
	}

	/**
	 * Mark as error
	 */
	error(message?: string): void {
		this.clearTickInterval();
		if (this.spinner) {
			this.spinner.error({ text: message || this.formatText() });
		}
	}

	/**
	 * Stop the spinner
	 */
	stop(): void {
		this.clearTickInterval();
		if (this.spinner) {
			this.spinner.stop();
		}
	}
}

/**
 * Create a simple spinner
 */
export function createSimpleSpinner(text: string): SpinnerInstance {
	return createSpinner(text).start();
}
