import pc from "picocolors";
import { formatDuration } from "./logger.ts";
import type { ProgressSpinner } from "./spinner.ts";

const STREAM_BORDER = pc.dim("─".repeat(60));

/**
 * Renders streamed AI text output to the terminal.
 *
 * Coordinates with ProgressSpinner: stops the spinner on first text chunk,
 * displays a bordered text region, then provides success/error for final status.
 */
export class StreamRenderer {
	private started = false;
	private ended = false;
	private startTime: number;
	private lastCharWasNewline = true;

	constructor(private spinner: ProgressSpinner) {
		this.startTime = Date.now();
	}

	/**
	 * Write a text chunk to stdout. Stops the spinner on the first call.
	 */
	write(text: string): void {
		if (this.ended) return;

		if (!this.started) {
			this.started = true;
			this.spinner.stop();
			console.log(STREAM_BORDER);
		}

		process.stdout.write(text);
		if (text.length > 0) {
			this.lastCharWasNewline = text[text.length - 1] === "\n";
		}
	}

	/**
	 * Close the stream border. Called automatically by success/error.
	 */
	finish(): void {
		if (!this.started || this.ended) return;
		this.ended = true;

		if (!this.lastCharWasNewline) {
			process.stdout.write("\n");
		}
		console.log(STREAM_BORDER);
	}

	/**
	 * Print success status with elapsed time
	 */
	success(message?: string): void {
		this.finish();
		const elapsed = formatDuration(Date.now() - this.startTime);
		const text = message || "Done";
		console.log(`${pc.green("✔")} ${text} ${pc.green(`[${elapsed}]`)}`);
	}

	/**
	 * Print error status with elapsed time
	 */
	error(message?: string): void {
		this.finish();
		const elapsed = formatDuration(Date.now() - this.startTime);
		const text = message || "Failed";
		console.log(`${pc.red("✖")} ${text} ${pc.red(`[${elapsed}]`)}`);
	}

	get isActive(): boolean {
		return this.started && !this.ended;
	}
}
