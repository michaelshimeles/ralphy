import notifier from "node-notifier";

/**
 * Send a desktop notification
 */
export function notify(title: string, message: string): void {
	notifier.notify({
		title,
		message,
		sound: true,
	});
}

/**
 * Notify task completion
 */
export function notifyTaskComplete(task: string): void {
	notify("Ralphy", `Task completed: ${task}`);
}

/**
 * Notify all tasks complete
 */
export function notifyAllComplete(count: number): void {
	notify("Ralphy", `All ${count} tasks completed!`);
}

/**
 * Notify task failure
 */
export function notifyTaskFailed(task: string, error: string): void {
	notify("Ralphy - Error", `Task failed: ${task}\n${error}`);
}
