import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import pc from "picocolors";
import { jsonToCsv, mdToCsv, yamlToCsv } from "../../tasks/converter.ts";
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
		logError(`Error: Source file not found: ${from}`);
		process.exit(1);
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
				logError(`Error: Unsupported source format: ${fromExt}`);
				logInfo(pc.dim("Supported formats: .yaml, .yml, .md, .markdown, .json"));
				process.exit(1);
		}
	} catch (err) {
		logError(`Error parsing ${from}: ${err}`);
		process.exit(1);
	}

	// Count tasks
	const taskCount = csvContent.split("\n").length - 1; // Subtract header

	writeFileSync(to, csvContent, "utf-8");

	logSuccess(`Converted ${from} -> ${to}`);
	logInfo(pc.dim(`  ${taskCount} tasks`));

	// Show token savings estimate
	const originalTokens = Math.ceil(content.length / 4); // Rough token estimate
	const csvTokens = Math.ceil(csvContent.length / 4);
	const savings = Math.round((1 - csvTokens / originalTokens) * 100);

	if (savings > 0) {
		logInfo(pc.green(`  ~${savings}% token savings (${originalTokens} -> ${csvTokens} tokens)`));
	}
}
