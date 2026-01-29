import pc from "picocolors";
import {
	exportTelemetry,
	exportAllFormats,
	getTelemetrySummary,
	hasTelemetryData,
	type ExportFormat,
} from "../../telemetry/index.ts";
import { logError, logInfo, logSuccess, logWarn } from "../../ui/logger.ts";

/**
 * Handle export-telemetry command
 */
export async function exportTelemetryCommand(
	format?: string,
	options?: {
		outputDir?: string;
		outputPath?: string;
		all?: boolean;
	}
): Promise<void> {
	const outputDir = options?.outputDir || ".ralphy/telemetry";

	// Check if telemetry data exists
	const hasData = await hasTelemetryData({ outputDir });
	if (!hasData) {
		logWarn("No telemetry data found.");
		logInfo("Run a session with --telemetry flag to collect data.");
		return;
	}

	try {
		// Export all formats
		if (options?.all) {
			logInfo("Exporting telemetry to all formats...");
			const paths = await exportAllFormats({ outputDir });
			logSuccess("Exported telemetry data:");
			console.log(`  DeepEval: ${paths.deepeval}`);
			console.log(`  OpenAI:   ${paths.openai}`);
			console.log(`  Raw:      ${paths.raw}`);
			return;
		}

		// Single format export
		const exportFormat = validateFormat(format || "raw");
		if (!exportFormat) {
			logError(`Invalid format: ${format}`);
			logInfo("Valid formats: deepeval, openai, raw");
			return;
		}

		logInfo(`Exporting telemetry to ${exportFormat} format...`);
		const outputPath = await exportTelemetry(exportFormat, {
			outputDir,
			outputPath: options?.outputPath,
		});
		logSuccess(`Exported: ${outputPath}`);
	} catch (error) {
		logError(`Export failed: ${error}`);
	}
}

/**
 * Show telemetry summary/stats
 */
export async function showTelemetryStats(
	outputDir?: string
): Promise<void> {
	const dir = outputDir || ".ralphy/telemetry";

	const hasData = await hasTelemetryData({ outputDir: dir });
	if (!hasData) {
		logWarn("No telemetry data found.");
		logInfo("Run a session with --telemetry flag to collect data.");
		return;
	}

	try {
		const summary = await getTelemetrySummary({ outputDir: dir });

		console.log("");
		console.log(pc.bold("Telemetry Summary"));
		console.log("");
		console.log(`  Sessions:     ${summary.sessionCount}`);
		console.log(`  Tool Calls:   ${summary.toolCallCount}`);
		console.log(`  Success Rate: ${summary.successRate}%`);
		console.log("");
		console.log(`  Tokens In:    ${summary.totalTokensIn.toLocaleString()}`);
		console.log(`  Tokens Out:   ${summary.totalTokensOut.toLocaleString()}`);
		console.log("");
		console.log(`  Engines:      ${summary.engines.join(", ") || "(none)"}`);
		console.log(`  Modes:        ${summary.modes.join(", ") || "(none)"}`);
		console.log(`  Tools Used:   ${summary.toolsUsed.join(", ") || "(none)"}`);
		console.log("");
	} catch (error) {
		logError(`Failed to get summary: ${error}`);
	}
}

/**
 * Validate export format
 */
function validateFormat(format: string): ExportFormat | null {
	if (format === "deepeval" || format === "openai" || format === "raw") {
		return format;
	}
	return null;
}
