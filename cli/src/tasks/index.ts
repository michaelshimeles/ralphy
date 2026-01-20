export * from "./types.ts";
export * from "./markdown.ts";
export * from "./yaml.ts";
export * from "./github.ts";

import type { TaskSource, TaskSourceType } from "./types.ts";
import { MarkdownTaskSource } from "./markdown.ts";
import { YamlTaskSource } from "./yaml.ts";
import { GitHubTaskSource } from "./github.ts";

interface TaskSourceOptions {
	type: TaskSourceType;
	/** File path for markdown/yaml sources */
	filePath?: string;
	/** Repo path (owner/repo) for GitHub source */
	repo?: string;
	/** Label filter for GitHub source */
	label?: string;
}

/**
 * Create a task source by type
 */
export function createTaskSource(options: TaskSourceOptions): TaskSource {
	switch (options.type) {
		case "markdown":
			if (!options.filePath) {
				throw new Error("filePath is required for markdown task source");
			}
			return new MarkdownTaskSource(options.filePath);

		case "yaml":
			if (!options.filePath) {
				throw new Error("filePath is required for yaml task source");
			}
			return new YamlTaskSource(options.filePath);

		case "github":
			if (!options.repo) {
				throw new Error("repo is required for github task source");
			}
			return new GitHubTaskSource(options.repo, options.label);

		default:
			throw new Error(`Unknown task source type: ${options.type}`);
	}
}
