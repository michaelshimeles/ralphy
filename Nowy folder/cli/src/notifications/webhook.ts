import type { RalphyConfig } from "../config/types.ts";
import { logDebug, logError } from "../ui/logger.ts";

type SessionStatus = "completed" | "failed";

interface NotificationResult {
	tasksCompleted: number;
	tasksFailed: number;
}

function buildMessage(status: SessionStatus, result?: NotificationResult): string {
	if (!result) {
		return status === "completed" ? "Ralphy session completed" : "Ralphy session failed";
	}

	const total = result.tasksCompleted + result.tasksFailed;
	if (status === "completed") {
		return `Ralphy session completed: ${result.tasksCompleted}/${total} tasks succeeded`;
	}
	return `Ralphy session failed: ${result.tasksCompleted}/${total} tasks succeeded, ${result.tasksFailed} failed`;
}

/**
 * Send a Discord webhook notification with embed
 */
async function sendDiscordNotification(
	webhookUrl: string,
	status: SessionStatus,
	result?: NotificationResult,
): Promise<void> {
	const isSuccess = status === "completed";
	const total = result ? result.tasksCompleted + result.tasksFailed : 0;

	const embed = {
		title: isSuccess ? "Session Completed" : "Session Failed",
		description: result
			? `${result.tasksCompleted}/${total} tasks succeeded${result.tasksFailed > 0 ? `, ${result.tasksFailed} failed` : ""}`
			: `Session ${status}`,
		color: isSuccess ? 0x22c55e : 0xef4444,
		footer: {
			text: "Ralphy",
		},
		timestamp: new Date().toISOString(),
	};

	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds: [embed] }),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Discord webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
	}
}

/**
 * Send a Slack webhook notification
 */
async function sendSlackNotification(
	webhookUrl: string,
	status: SessionStatus,
	result?: NotificationResult,
): Promise<void> {
	const message = buildMessage(status, result);

	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text: message }),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Slack webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
	}
}

/**
 * Send a custom webhook notification
 */
async function sendCustomNotification(
	webhookUrl: string,
	status: SessionStatus,
	result?: NotificationResult,
): Promise<void> {
	const message = buildMessage(status, result);

	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			event: "session_complete",
			status,
			message,
			tasks_completed: result?.tasksCompleted ?? 0,
			tasks_failed: result?.tasksFailed ?? 0,
		}),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Custom webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
	}
}

/**
 * Send notifications to all configured webhooks
 */
export async function sendNotifications(
	config: RalphyConfig | null,
	status: SessionStatus,
	result?: NotificationResult,
): Promise<void> {
	if (!config?.notifications) {
		return;
	}

	const { discord_webhook, slack_webhook, custom_webhook } = config.notifications;

	const tasks: Promise<void>[] = [];

	if (discord_webhook && discord_webhook.trim() !== "") {
		tasks.push(
			sendDiscordNotification(discord_webhook, status, result).catch((err) => {
				logError(`Discord notification failed: ${err.message}`);
			}),
		);
	}

	if (slack_webhook && slack_webhook.trim() !== "") {
		tasks.push(
			sendSlackNotification(slack_webhook, status, result).catch((err) => {
				logError(`Slack notification failed: ${err.message}`);
			}),
		);
	}

	if (custom_webhook && custom_webhook.trim() !== "") {
		tasks.push(
			sendCustomNotification(custom_webhook, status, result).catch((err) => {
				logError(`Custom webhook notification failed: ${err.message}`);
			}),
		);
	}

	if (tasks.length > 0) {
		await Promise.all(tasks);
		logDebug("Webhook notifications sent");
	}
}
