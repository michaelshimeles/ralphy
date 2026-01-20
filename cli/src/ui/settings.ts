import type { RuntimeOptions } from "../config/types.ts";

/**
 * Build list of active settings for display in the spinner
 * Shows settings like [fast], [dry-run], [parallel], etc.
 */
export function buildActiveSettings(options: RuntimeOptions): string[] {
	const activeSettings: string[] = [];

	// Fast mode (both tests and lint skipped)
	if (options.skipTests && options.skipLint) {
		activeSettings.push("fast");
	} else {
		if (options.skipTests) activeSettings.push("no-tests");
		if (options.skipLint) activeSettings.push("no-lint");
	}

	if (options.dryRun) activeSettings.push("dry-run");
	if (options.branchPerTask) activeSettings.push("branch");
	if (options.createPr) activeSettings.push("pr");
	if (options.parallel) activeSettings.push("parallel");
	if (!options.autoCommit) activeSettings.push("no-commit");

	return activeSettings;
}
