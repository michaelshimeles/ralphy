/**
 * Telemetry Webhook
 *
 * Sends telemetry session data to a configured webhook endpoint.
 * Respects privacy levels (anonymous vs full).
 */

import type { RalphyConfig } from "../config/types.ts";
import { logDebug, logError } from "../ui/logger.ts";
import type { Session, SessionFull, TelemetryLevel, TelemetryWebhookPayload } from "./types.ts";

/**
 * Check if a session is a full session (has prompt/response)
 */
function isFullSession(session: Session | SessionFull): session is SessionFull {
	return "prompt" in session || "response" in session || "filePaths" in session;
}

/**
 * Build the webhook payload from session data
 */
function buildPayload(
	session: Session | SessionFull,
	level: TelemetryLevel,
): TelemetryWebhookPayload {
	const payload: TelemetryWebhookPayload = {
		event: "telemetry_session",
		version: "1.0",
		timestamp: new Date().toISOString(),
		session: {
			sessionId: session.sessionId,
			engine: session.engine,
			mode: session.mode,
			cliVersion: session.cliVersion,
			platform: session.platform,
			totalTokensIn: session.totalTokensIn,
			totalTokensOut: session.totalTokensOut,
			totalDurationMs: session.totalDurationMs,
			taskCount: session.taskCount,
			successCount: session.successCount,
			failedCount: session.failedCount,
			toolCalls: session.toolCalls,
			tags: session.tags,
		},
	};

	// Add full details only in full privacy mode
	if (level === "full" && isFullSession(session)) {
		payload.details = {
			prompt: session.prompt,
			response: session.response,
			filePaths: session.filePaths,
		};
	}

	return payload;
}

/**
 * Send telemetry data to the configured webhook endpoint
 *
 * @param session - The session data to send
 * @param config - Ralphy configuration (for webhook URL)
 * @param level - Privacy level (anonymous or full)
 */
export async function sendTelemetryWebhook(
	session: Session | SessionFull,
	config: RalphyConfig | null,
	level: TelemetryLevel = "anonymous",
): Promise<void> {
	const webhookUrl = config?.notifications?.telemetry_webhook;

	if (!webhookUrl || webhookUrl.trim() === "") {
		logDebug("No telemetry webhook configured, skipping");
		return;
	}

	const payload = buildPayload(session, level);

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
		}

		logDebug(`Telemetry webhook sent successfully to ${webhookUrl}`);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			logError("Telemetry webhook timed out after 10 seconds");
		} else {
			logError(
				`Telemetry webhook failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		// Don't throw - webhook failures shouldn't break the session
	}
}
