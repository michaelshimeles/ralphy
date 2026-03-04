import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildParallelPrompt, buildPrompt } from "./prompt.ts";

describe("buildPrompt", () => {
	const testWorkDir = join(tmpdir(), "prompt-test");
	const ralphyDir = join(testWorkDir, ".ralphy");

	beforeEach(() => {
		mkdirSync(ralphyDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testWorkDir, { recursive: true, force: true });
	});

	describe("Boundaries Section", () => {
		it("should include system boundaries at the top of boundaries list", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Boundaries");
			expect(result).toContain("Do NOT modify these files/directories:");
			expect(result).toContain("- the PRD file");
			expect(result).toContain("- .ralphy/progress.txt");
			expect(result).toContain("- .ralphy-worktrees");
			expect(result).toContain("- .ralphy-sandboxes");
		});

		it("should use specific PRD file name when provided", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				prdFile: "project.prd.md",
			});

			expect(result).toContain("- project.prd.md");
			expect(result).not.toContain("- the PRD file");
		});

		it("should include user-defined boundaries after system boundaries", () => {
			// Create config with user boundaries
			writeFileSync(
				join(ralphyDir, "config.yaml"),
				`
project:
  name: test
boundaries:
  never_touch:
    - src/legacy/**
    - vendor/
`,
			);

			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("- src/legacy/**");
			expect(result).toContain("- vendor/");

			// System boundaries should appear before user boundaries
			const boundariesIndex = result.indexOf("## Boundaries");
			const prdIndex = result.indexOf("- the PRD file");
			const legacyIndex = result.indexOf("- src/legacy/**");

			expect(prdIndex).toBeGreaterThan(boundariesIndex);
			expect(legacyIndex).toBeGreaterThan(prdIndex);
		});

		it("should always include boundaries section even without user-defined boundaries", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Boundaries");
		});
	});

	describe("Prompt Structure", () => {
		it("should include task section", () => {
			const result = buildPrompt({
				task: "Implement feature X",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Task");
			expect(result).toContain("Implement feature X");
		});

		it("should include instructions section", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Instructions");
			expect(result).toContain("1. Implement the task described above");
		});

		it("should include test instructions when skipTests is false", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				skipTests: false,
			});

			expect(result).toContain("Write tests for the feature");
			expect(result).toContain("Run tests and ensure they pass");
		});

		it("should exclude test instructions when skipTests is true", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				skipTests: true,
			});

			expect(result).not.toContain("Write tests for the feature");
			expect(result).not.toContain("Run tests and ensure they pass");
		});

		it("should include lint instructions when skipLint is false", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				skipLint: false,
			});

			expect(result).toContain("Run linting and ensure it passes");
		});

		it("should exclude lint instructions when skipLint is true", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				skipLint: true,
			});

			expect(result).not.toContain("Run linting and ensure it passes");
		});

		it("should include commit instruction when autoCommit is true", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				autoCommit: true,
			});

			expect(result).toContain("Commit your changes with a descriptive message");
		});

		it("should exclude commit instruction when autoCommit is false", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
				autoCommit: false,
			});

			expect(result).not.toContain("Commit your changes with a descriptive message");
		});
	});

	describe("Project Context", () => {
		it("should include project context when config exists", () => {
			writeFileSync(
				join(ralphyDir, "config.yaml"),
				`
project:
  name: My Project
  language: TypeScript
  framework: React
  description: A test project
`,
			);

			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Project Context");
			expect(result).toContain("Project: My Project");
			expect(result).toContain("Language: TypeScript");
			expect(result).toContain("Framework: React");
			expect(result).toContain("Description: A test project");
		});
	});

	describe("Rules", () => {
		it("should always include code change rules", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Rules (you MUST follow these)");
			expect(result).toContain("Keep changes focused and minimal. Do not refactor unrelated code.");
		});

		it("should include rules when defined in config", () => {
			writeFileSync(
				join(ralphyDir, "config.yaml"),
				`
project:
  name: test
rules:
  - Always use TypeScript strict mode
  - Write comprehensive tests
`,
			);

			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			expect(result).toContain("## Rules (you MUST follow these)");
			expect(result).toContain("Keep changes focused and minimal. Do not refactor unrelated code.");
			expect(result).toContain("Always use TypeScript strict mode");
			expect(result).toContain("Write comprehensive tests");
		});
	});

	describe("No Final Note at End", () => {
		it("should not have scattered Do NOT modify notes at the end", () => {
			const result = buildPrompt({
				task: "Test task",
				workDir: testWorkDir,
			});

			// The prompt should end with Instructions section
			const instructionsIndex = result.indexOf("## Instructions");
			const boundariesIndex = result.indexOf("## Boundaries");

			// Instructions should come after boundaries (proper structure)
			expect(instructionsIndex).toBeGreaterThan(boundariesIndex);

			// There should be no "Do NOT modify" text after Instructions section
			const afterInstructions = result.slice(instructionsIndex);
			const doNotModifyCount = (afterInstructions.match(/Do NOT modify/g) || []).length;

			// Should be 0 - all Do NOT modify rules are in Boundaries section
			expect(doNotModifyCount).toBe(0);
		});
	});
});

describe("buildParallelPrompt", () => {
	describe("Rules Section", () => {
		it("should include rules section with code change rules", () => {
			const result = buildParallelPrompt({
				task: "Implement feature",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Rules (you MUST follow these):");
			expect(result).toContain("Keep changes focused and minimal. Do not refactor unrelated code.");
		});
	});

	describe("Boundaries Section", () => {
		const testWorkDir = join(tmpdir(), "parallel-prompt-test");
		const ralphyDir = join(testWorkDir, ".ralphy");

		beforeEach(() => {
			mkdirSync(ralphyDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testWorkDir, { recursive: true, force: true });
		});

		it("should include boundaries section with system files", () => {
			const result = buildParallelPrompt({
				task: "Implement feature",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Boundaries - Do NOT modify:");
			expect(result).toContain("- the PRD file");
			expect(result).toContain("- .ralphy/progress.txt");
			expect(result).toContain("- .ralphy-worktrees");
			expect(result).toContain("- .ralphy-sandboxes");
		});

		it("should use specific PRD file when provided", () => {
			const result = buildParallelPrompt({
				task: "Implement feature",
				progressFile: ".ralphy/progress.txt",
				prdFile: "docs/project.prd.md",
			});

			expect(result).toContain("- docs/project.prd.md");
			expect(result).not.toContain("- the PRD file");
		});

		it("should include 'do not mark tasks complete' in boundaries section", () => {
			const result = buildParallelPrompt({
				task: "Implement feature",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Do NOT mark tasks complete");
		});

		it("should include user-defined boundaries after system boundaries", () => {
			// Create config with user boundaries (using spaces, not tabs - YAML requirement)
			const yamlContent = [
				"project:",
				"  name: test",
				"boundaries:",
				"  never_touch:",
				"    - src/legacy/**",
				"    - vendor/",
			].join("\n");
			writeFileSync(join(ralphyDir, "config.yaml"), yamlContent);

			const result = buildParallelPrompt({
				task: "Implement feature",
				progressFile: ".ralphy/progress.txt",
				workDir: testWorkDir,
			});

			expect(result).toContain("- src/legacy/**");
			expect(result).toContain("- vendor/");

			// System boundaries should appear before user boundaries
			const boundariesIndex = result.indexOf("Boundaries - Do NOT modify:");
			const prdIndex = result.indexOf("- the PRD file");
			const legacyIndex = result.indexOf("- src/legacy/**");

			expect(prdIndex).toBeGreaterThan(boundariesIndex);
			expect(legacyIndex).toBeGreaterThan(prdIndex);
		});
	});

	describe("Prompt Structure", () => {
		it("should include the task at the top", () => {
			const result = buildParallelPrompt({
				task: "Build the login page",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("TASK: Build the login page");
		});

		it("should include instructions section", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Instructions:");
			expect(result).toContain("1. Implement this specific task completely");
		});

		it("should include progress file update instruction", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/task-progress.txt",
			});

			expect(result).toContain("Update .ralphy/task-progress.txt with what you did");
		});

		it("should include commit instruction when allowCommit is true", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
				allowCommit: true,
			});

			expect(result).toContain("Commit your changes with a descriptive message");
		});

		it("should include no-commit instruction when allowCommit is false", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
				allowCommit: false,
			});

			expect(result).toContain("Do NOT run git commit");
			expect(result).toContain("changes will be collected automatically");
		});

		it("should end with focus reminder", () => {
			const result = buildParallelPrompt({
				task: "Implement the API",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Focus only on implementing: Implement the API");
		});
	});

	describe("Test and Lint Options", () => {
		it("should include test instructions by default", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Write tests for the feature");
			expect(result).toContain("Run tests and ensure they pass");
		});

		it("should exclude test instructions when skipTests is true", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
				skipTests: true,
			});

			expect(result).not.toContain("Write tests for the feature");
		});

		it("should include lint instructions by default", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			expect(result).toContain("Run linting and ensure it passes");
		});

		it("should exclude lint instructions when skipLint is true", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
				skipLint: true,
			});

			expect(result).not.toContain("Run linting and ensure it passes");
		});
	});

	describe("Boundaries Placement", () => {
		it("should have rules section before boundaries", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			const rulesIndex = result.indexOf("Rules (you MUST follow these):");
			const boundariesIndex = result.indexOf("Boundaries - Do NOT modify:");

			expect(rulesIndex).toBeLessThan(boundariesIndex);
		});

		it("should have boundaries section before instructions", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			const boundariesIndex = result.indexOf("Boundaries - Do NOT modify:");
			const instructionsIndex = result.indexOf("Instructions:");

			expect(boundariesIndex).toBeLessThan(instructionsIndex);
		});

		it("should have boundaries section after task", () => {
			const result = buildParallelPrompt({
				task: "Test task",
				progressFile: ".ralphy/progress.txt",
			});

			const taskIndex = result.indexOf("TASK:");
			const boundariesIndex = result.indexOf("Boundaries - Do NOT modify:");

			expect(boundariesIndex).toBeGreaterThan(taskIndex);
		});
	});
});
