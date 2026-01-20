import { createSpinner } from "nanospinner";
import pc from "picocolors";

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

	constructor(task: string, settings?: string[]) {
		this.task = task.length > 40 ? `${task.slice(0, 37)}...` : task;
		this.settings = settings?.length ? `[${settings.join(", ")}]` : "";
		this.startTime = Date.now();
		this.spinner = createSpinner(this.formatText()).start();
	}

	private formatText(): string {
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
		this.spinner.update({ text: this.formatText() });
	}

	/**
	 * Update spinner text (called periodically to update time)
	 */
	tick(): void {
		this.spinner.update({ text: this.formatText() });
	}

	/**
	 * Mark as success
	 */
	success(message?: string): void {
		this.spinner.success({ text: message || this.formatText() });
	}

	/**
	 * Mark as error
	 */
	error(message?: string): void {
		this.spinner.error({ text: message || this.formatText() });
	}

	/**
	 * Stop the spinner
	 */
	stop(): void {
		this.spinner.stop();
	}
}

/**
 * Create a simple spinner
 */
export function createSimpleSpinner(text: string): SpinnerInstance {
	return createSpinner(text).start();
}
