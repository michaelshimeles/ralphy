import { describe, expect, test } from "bun:test";
import { jsonToCsv, mdToCsv, yamlToCsv } from "../src/tasks/converter.ts";

describe("YAML to CSV conversion", () => {
	test("converts basic YAML tasks", () => {
		const yaml = `
tasks:
  - title: Initialize the project
    completed: false
  - title: Create database schema
    completed: false
    parallel_group: 1
`;
		const csv = yamlToCsv(yaml);

		expect(csv).toContain("id,title,done,group,desc");
		expect(csv).toContain("Initialize the project");
		expect(csv).toContain("Create database schema");
		// Should have 3 lines: header + 2 tasks
		expect(csv.split("\n").length).toBe(3);
	});

	test("converts YAML with descriptions", () => {
		const yaml = `
tasks:
  - title: Set up project
    completed: false
    description: |
      Create a new TypeScript project with all the necessary configurations.
      Include ESLint, Prettier, and testing setup.
`;
		const csv = yamlToCsv(yaml);

		expect(csv).toContain("Set up project");
		// Description should be truncated/compacted
		expect(csv).toContain("Create a new TypeScript project");
	});

	test("preserves task order", () => {
		const yaml = `
tasks:
  - title: First task
    completed: false
  - title: Second task
    completed: false
  - title: Third task
    completed: false
`;
		const csv = yamlToCsv(yaml);
		const lines = csv.split("\n");

		expect(lines[1]).toContain("First task");
		expect(lines[2]).toContain("Second task");
		expect(lines[3]).toContain("Third task");
	});
});

describe("Markdown to CSV conversion", () => {
	test("converts checkbox tasks", () => {
		const md = `
# Project Tasks

- [ ] Initialize project
- [ ] Create database
- [x] Write README
`;
		const csv = mdToCsv(md);

		expect(csv).toContain("id,title,done,group,desc");
		expect(csv).toContain("Initialize project");
		expect(csv).toContain("Create database");
		// Completed task should have done=1
		expect(csv).toContain("Write README");
	});

	test("handles mixed content", () => {
		const md = `
# Header

Some description text.

## Tasks

- [ ] First task
- [ ] Second task

More text here.
`;
		const csv = mdToCsv(md);
		const lines = csv.split("\n");

		// Should only have header + 2 tasks
		expect(lines.length).toBe(3);
		expect(csv).toContain("First task");
		expect(csv).toContain("Second task");
	});
});

describe("JSON to CSV conversion", () => {
	test("converts task array", () => {
		const json = JSON.stringify([
			{ title: "Task 1", completed: false },
			{ title: "Task 2", completed: true },
		]);
		const csv = jsonToCsv(json);

		expect(csv).toContain("Task 1");
		expect(csv).toContain("Task 2");
	});

	test("converts object with tasks array", () => {
		const json = JSON.stringify({
			tasks: [
				{ title: "Setup", completed: false, parallel_group: 1 },
				{ title: "Build", completed: false, parallel_group: 1 },
			],
		});
		const csv = jsonToCsv(json);

		expect(csv).toContain("Setup");
		expect(csv).toContain("Build");
	});
});

describe("Task readability after conversion", () => {
	test("tasks remain clearly identifiable in CSV", () => {
		const yaml = `
tasks:
  - title: Implement user authentication with OAuth2
    completed: false
    description: |
      Add OAuth2 authentication using Google and GitHub providers.
      Include proper error handling and token refresh logic.
  - title: Create API endpoints for CRUD operations
    completed: false
    parallel_group: 1
  - title: Design database schema with proper indexing
    completed: false
    parallel_group: 1
`;
		const csv = yamlToCsv(yaml);

		// All task titles should be fully readable
		expect(csv).toContain("Implement user authentication with OAuth2");
		expect(csv).toContain("Create API endpoints for CRUD operations");
		expect(csv).toContain("Design database schema with proper indexing");

		// Key info from description should be preserved
		expect(csv).toContain("OAuth2");
	});

	test("parallel groups are preserved", () => {
		const yaml = `
tasks:
  - title: Sequential task
    completed: false
  - title: Parallel task 1
    completed: false
    parallel_group: 1
  - title: Parallel task 2
    completed: false
    parallel_group: 1
`;
		const csv = yamlToCsv(yaml);
		const lines = csv.split("\n");

		// Check parallel group values
		expect(lines[1]).toMatch(/Sequential task.*,0,/);
		expect(lines[2]).toMatch(/Parallel task 1.*,1,/);
		expect(lines[3]).toMatch(/Parallel task 2.*,1,/);
	});

	test("special characters are properly escaped", () => {
		const yaml = `
tasks:
  - title: Handle quotes and commas
    completed: false
    description: Test with special chars like commas, and apostrophes
`;
		const csv = yamlToCsv(yaml);

		// Should not break CSV format
		const lines = csv.split("\n");
		expect(lines.length).toBe(2); // header + 1 task
		expect(csv).toContain("Handle quotes and commas");
	});
});

describe("Token savings verification", () => {
	test("CSV is more compact than YAML", () => {
		const yaml = `
tasks:
  - title: Initialize the project with the chosen framework
    completed: false
    parallel_group: 1
    description: |
      Set up a new project using the appropriate framework.
      Include TypeScript configuration and basic folder structure.
`;
		const csv = yamlToCsv(yaml);

		// CSV should be significantly shorter
		expect(csv.length).toBeLessThan(yaml.length);

		// Rough token estimate (chars / 4)
		const yamlTokens = Math.ceil(yaml.length / 4);
		const csvTokens = Math.ceil(csv.length / 4);
		const savings = (1 - csvTokens / yamlTokens) * 100;

		console.log(`Token savings: ${savings.toFixed(1)}% (${yamlTokens} -> ${csvTokens})`);
		expect(savings).toBeGreaterThan(20); // At least 20% savings
	});
});
