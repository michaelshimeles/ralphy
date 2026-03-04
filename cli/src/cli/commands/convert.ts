import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import pc from "picocolors";
import { jsonToCsv, mdToCsv, yamlToCsv } from "../../tasks/converter.ts";
import { parseCSV } from "../../tasks/csv.ts";
import { logError, logInfo, logSuccess } from "../../ui/logger.ts";

/**
 * Convert PRD files between formats (YAML/MD/JSON -> CSV)
 */
export async function runConvert(options: {
	from: string;
	to: string;
	verbose?: boolean;
}): Promise<void> {
	const { from, to, verbose } = options;

	if (!existsSync(from)) {
		throw new Error(`Source file not found: ${from}`);
	}

	const fromExt = extname(from).toLowerCase();
	const content = readFileSync(from, "utf-8");
	let csvContent = "";

	try {
		switch (fromExt) {
			case ".yaml":
			case ".yml":
				if (verbose) logInfo(pc.dim("Converting YAML -> CSV..."));
				csvContent = yamlToCsv(content);
				break;

			case ".md":
			case ".markdown":
				if (verbose) logInfo(pc.dim("Converting Markdown -> CSV..."));
				csvContent = mdToCsv(content);
				break;

			case ".json":
				if (verbose) logInfo(pc.dim("Converting JSON -> CSV..."));
				csvContent = jsonToCsv(content);
				break;

			default:
				throw new Error(
					`Unsupported source format: ${fromExt}. Supported formats: .yaml, .yml, .md, .markdown, .json`,
				);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Error parsing ${from}: ${message}`);
	}

	// Count tasks
	const taskCount = Math.max(0, parseCSV(csvContent).length - 1);

	writeFileSync(to, csvContent, "utf-8");

	logSuccess(`Converted ${from} -> ${to}`);
	logInfo(pc.dim(`  ${taskCount} tasks`));

	// Show token savings estimate
	const originalTokens = Math.ceil(content.length / 4); // Rough token estimate
	const csvTokens = Math.ceil(csvContent.length / 4);
	// BUG FIX: Prevent division by zero when original file is empty
	const savings = originalTokens === 0 ? 0 : Math.round((1 - csvTokens / originalTokens) * 100);

	if (savings > 0) {
		logInfo(pc.green(`  ~${savings}% token savings (${originalTokens} -> ${csvTokens} tokens)`));
	}
}
