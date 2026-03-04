import { lookup } from "node:dns/promises";
import type { RalphyConfig } from "../config/types.ts";
import { logDebug, logError, logWarn } from "../ui/logger.ts";

const MAX_WEBHOOK_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const WEBHOOK_TIMEOUT_MS = 30000; // 30 seconds

// Discord embed colors (hex values)
const DISCORD_COLOR_SUCCESS = 0x22c55e; // green
const DISCORD_COLOR_FAILURE = 0xef4444; // red

// Private IP ranges that should be blocked for SSRF protection
const BLOCKED_IP_RANGES = [
	/^127\./, // 127.0.0.0/8 (localhost)
	/^10\./, // 10.0.0.0/8
	/^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
	/^192\.168\./, // 192.168.0.0/16
	/^169\.254\./, // 169.254.0.0/16 (link-local)
	/^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
	/^0\./, // 0.0.0.0/8
];

const BLOCKED_IPV6_RANGES = [
	/^::1$/i, // IPv6 localhost
	/^0+:0+:0+:0+:0+:0+:0+:0+$/i, // :: (all zeros)
	/^fe80:/i, // IPv6 link-local
	/^fc00:/i, // IPv6 unique local
	/^fd[0-9a-f]{2}:/i, // IPv6 unique local (fd00::/8)
	/^::ffff:127\.\d+\.\d+\.\d+$/i, // IPv4-mapped IPv6 localhost
	/^::ffff:10\.\d+\.\d+\.\d+$/i, // IPv4-mapped 10.0.0.0/8
	/^::ffff:192\.168\.\d+\.\d+$/i, // IPv4-mapped 192.168.0.0/16
	/^::ffff:172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+$/i, // IPv4-mapped 172.16.0.0/12
	/^::ffff:169\.254\.\d+\.\d+$/i, // IPv4-mapped 169.254.0.0/16
	/^::ffff:100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d+\.\d+$/i, // IPv4-mapped CGNAT
];

const BLOCKED_HOSTS = [/^localhost$/i, /^127\.\d+\.\d+\.\d+$/, /^0\.0\.0\.0$/, /^::1$/i, /^::$/i];

type SessionStatus = "completed" | "failed";
type WebhookType = "discord" | "slack" | "custom";

const DISCORD_ALLOWED_HOSTS = [
	"discord.com",
	"discordapp.com",
	"discordapp.net",
	"canary.discord.com",
	"ptb.discord.com",
];

const SLACK_ALLOWED_HOSTS = ["hooks.slack.com", "hooks.slack-gov.com"];

function isHostAllowedForWebhookType(type: WebhookType, hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (type === "discord") {
		return DISCORD_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
	}
	if (type === "slack") {
		return SLACK_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
	}
	return true;
}

/**
 * Validate webhook URL for SSRF protection
 * - Must use HTTPS protocol
 * - Must not point to private IP ranges
 * - Must not point to localhost
 * - Must be a valid URL
 */
function isBlockedIp(host: string): boolean {
	for (const pattern of BLOCKED_IP_RANGES) {
		if (pattern.test(host)) return true;
	}
	for (const pattern of BLOCKED_IPV6_RANGES) {
		if (pattern.test(host)) return true;
	}
	return false;
}

async function validateWebhookUrl(
	url: string,
	type: WebhookType,
): Promise<{ valid: boolean; error?: string; resolvedAddresses?: string[] }> {
	try {
		const parsed = new URL(url);

		// Enforce HTTPS only
		if (parsed.protocol !== "https:") {
			return { valid: false, error: "Webhook URL must use HTTPS protocol" };
		}

		if (parsed.username || parsed.password) {
			return { valid: false, error: "Webhook URL must not include credentials" };
		}

		// Check for blocked hostnames
		const hostname = parsed.hostname.toLowerCase();
		if (!isHostAllowedForWebhookType(type, hostname)) {
			return {
				valid: false,
				error: `Webhook hostname '${hostname}' is not allowed for ${type} webhooks`,
			};
		}

		for (const pattern of BLOCKED_HOSTS) {
			if (pattern.test(hostname)) {
				return { valid: false, error: `Webhook URL hostname '${hostname}' is not allowed` };
			}
		}

		// Check for blocked IP ranges (IPv4)
		if (isBlockedIp(hostname)) {
			return { valid: false, error: `Webhook URL IP '${hostname}' is in a blocked range` };
		}

		// Validate port (if specified, must be standard HTTPS port or common alt ports)
		if (parsed.port) {
			const port = Number.parseInt(parsed.port, 10);
			const allowedPorts = [443, 8443, 9443];
			if (!allowedPorts.includes(port)) {
				return {
					valid: false,
					error: `Webhook URL port ${port} is not allowed. Allowed ports: ${allowedPorts.join(", ")}`,
				};
			}
		}

		// Resolve DNS and block internal/private addresses (SSRF hardening)
		const resolved = await lookup(hostname, { all: true, verbatim: true });
		if (resolved.length === 0) {
			return { valid: false, error: `Webhook URL hostname '${hostname}' did not resolve` };
		}

		for (const entry of resolved) {
			if (isBlockedIp(entry.address)) {
				return {
					valid: false,
					error: `Webhook URL resolves to blocked IP '${entry.address}'`,
				};
			}
		}

		return { valid: true, resolvedAddresses: resolved.map((entry) => entry.address) };
	} catch (error) {
		return {
			valid: false,
			error: `Invalid webhook URL: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function assertDnsStillSafe(webhookUrl: string, expectedAddresses?: string[]): Promise<void> {
	const hostname = new URL(webhookUrl).hostname.toLowerCase();
	const resolved = await lookup(hostname, { all: true, verbatim: true });
	if (resolved.length === 0) {
		throw new Error(`Webhook hostname '${hostname}' no longer resolves`);
	}
	for (const entry of resolved) {
		if (isBlockedIp(entry.address)) {
			throw new Error(`Webhook hostname '${hostname}' resolved to blocked IP '${entry.address}'`);
		}
	}

	if (expectedAddresses && expectedAddresses.length > 0) {
		const expected = new Set(expectedAddresses);
		const overlap = resolved.some((entry) => expected.has(entry.address));
		if (!overlap) {
			throw new Error(`Webhook hostname '${hostname}' resolved to unexpected addresses`);
		}
	}
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	context: string,
	retries: number = MAX_WEBHOOK_RETRIES,
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Don't retry on the last attempt
			if (attempt === retries) {
				throw lastError;
			}

			const delay = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
			logDebug(`${context} attempt ${attempt} failed, retrying in ${delay}ms...`);
			await sleep(delay);
		}
	}

	throw lastError;
}

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
	validatedAddresses?: string[],
): Promise<void> {
	const isSuccess = status === "completed";
	const total = result ? result.tasksCompleted + result.tasksFailed : 0;

	const embed = {
		title: isSuccess ? "Session Completed" : "Session Failed",
		description: result
			? `${result.tasksCompleted}/${total} tasks succeeded${result.tasksFailed > 0 ? `, ${result.tasksFailed} failed` : ""}`
			: `Session ${status}`,
		color: isSuccess ? DISCORD_COLOR_SUCCESS : DISCORD_COLOR_FAILURE,
		footer: {
			text: "Ralphy",
		},
		timestamp: new Date().toISOString(),
	};

	await retryWithBackoff(async () => {
		await assertDnsStillSafe(webhookUrl, validatedAddresses);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		try {
			const response = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ embeds: [embed] }),
				redirect: "error",
				signal: controller.signal,
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`Discord webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
			}
		} finally {
			clearTimeout(timeoutId);
		}
	}, "Discord webhook");
}

/**
 * Send a Slack webhook notification
 */
async function sendSlackNotification(
	webhookUrl: string,
	status: SessionStatus,
	result?: NotificationResult,
	validatedAddresses?: string[],
): Promise<void> {
	const message = buildMessage(status, result);

	await retryWithBackoff(async () => {
		await assertDnsStillSafe(webhookUrl, validatedAddresses);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		try {
			const response = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: message }),
				redirect: "error",
				signal: controller.signal,
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`Slack webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
			}
		} finally {
			clearTimeout(timeoutId);
		}
	}, "Slack webhook");
}

/**
 * Send a custom webhook notification
 */
async function sendCustomNotification(
	webhookUrl: string,
	status: SessionStatus,
	result?: NotificationResult,
	validatedAddresses?: string[],
): Promise<void> {
	const message = buildMessage(status, result);

	await retryWithBackoff(async () => {
		await assertDnsStillSafe(webhookUrl, validatedAddresses);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		try {
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
				redirect: "error",
				signal: controller.signal,
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`Custom webhook failed: ${response.status}${text ? ` - ${text}` : ""}`);
			}
		} finally {
			clearTimeout(timeoutId);
		}
	}, "Custom webhook");
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
		const validation = await validateWebhookUrl(discord_webhook, "discord");
		if (!validation.valid) {
			logWarn(`Discord webhook validation failed: ${validation.error}`);
		} else {
			tasks.push(
				sendDiscordNotification(
					discord_webhook,
					status,
					result,
					validation.resolvedAddresses,
				).catch((err) => {
					logError(`Discord notification failed: ${err.message}`);
				}),
			);
		}
	}

	if (slack_webhook && slack_webhook.trim() !== "") {
		const validation = await validateWebhookUrl(slack_webhook, "slack");
		if (!validation.valid) {
			logWarn(`Slack webhook validation failed: ${validation.error}`);
		} else {
			tasks.push(
				sendSlackNotification(slack_webhook, status, result, validation.resolvedAddresses).catch(
					(err) => {
					logError(`Slack notification failed: ${err.message}`);
					},
				),
			);
		}
	}

	if (custom_webhook && custom_webhook.trim() !== "") {
		const validation = await validateWebhookUrl(custom_webhook, "custom");
		if (!validation.valid) {
			logWarn(`Custom webhook validation failed: ${validation.error}`);
		} else {
			tasks.push(
				sendCustomNotification(custom_webhook, status, result, validation.resolvedAddresses).catch(
					(err) => {
					logError(`Custom webhook notification failed: ${err.message}`);
					},
				),
			);
		}
	}

	if (tasks.length > 0) {
		await Promise.all(tasks);
		logDebug("Webhook notifications sent");
	}
}
