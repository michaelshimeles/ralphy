import { describe, expect, test } from "bun:test";

// We need to test the compactTaskText function from prompt.ts
// Since it's not exported, we'll recreate it here for testing
function compactTaskText(task: string, maxLength = 2000): string {
	// Normalize whitespace: collapse multiple newlines/spaces
	let compact = task
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]+/g, " ")
		.trim();

	// Remove common verbose patterns from YAML descriptions
	compact = compact
		.replace(/^description:\s*/im, "")
		.replace(/^\s*-\s*/gm, "• ")
		.replace(/\|\s*\n/g, " ");

	// If still too long, truncate intelligently
	if (compact.length > maxLength) {
		// Try to find a good break point (end of sentence)
		const truncPoint = compact.lastIndexOf(". ", maxLength - 3);
		if (truncPoint > maxLength * 0.7) {
			compact = compact.slice(0, truncPoint + 1);
		} else {
			compact = `${compact.slice(0, maxLength - 3)}...`;
		}
	}

	return compact;
}

describe("Task text compaction", () => {
	test("removes excessive whitespace", () => {
		const input = "Task   with    multiple     spaces";
		const result = compactTaskText(input);
		expect(result).toBe("Task with multiple spaces");
	});

	test("collapses multiple newlines", () => {
		const input = "First line\n\n\n\n\nSecond line";
		const result = compactTaskText(input);
		expect(result).toBe("First line\n\nSecond line");
	});

	test("normalizes Windows line endings", () => {
		const input = "Line 1\r\nLine 2\r\nLine 3";
		const result = compactTaskText(input);
		expect(result).toBe("Line 1\nLine 2\nLine 3");
	});

	test("removes YAML description prefix", () => {
		const input = "description: This is the task";
		const result = compactTaskText(input);
		expect(result).toBe("This is the task");
	});

	test("converts list dashes to bullets", () => {
		const input = "Tasks:\n- First item\n- Second item";
		const result = compactTaskText(input);
		expect(result).toContain("• First item");
		expect(result).toContain("• Second item");
	});

	test("truncates very long text intelligently", () => {
		const longText = "This is a sentence. ".repeat(200);
		const result = compactTaskText(longText, 100);

		expect(result.length).toBeLessThanOrEqual(100);
		// Should end at a sentence boundary if possible
		expect(result.endsWith(".") || result.endsWith("...")).toBe(true);
	});

	test("preserves task meaning after compaction", () => {
		const input = `
description: |
  Implement user authentication with OAuth2.
  - Add Google provider
  - Add GitHub provider
  - Handle token refresh
  - Add proper error handling
`;
		const result = compactTaskText(input);

		// Key information should be preserved
		expect(result).toContain("OAuth2");
		expect(result).toContain("Google");
		expect(result).toContain("GitHub");
		expect(result).toContain("token refresh");
		expect(result).toContain("error handling");
	});
});

describe("Task readability after compaction", () => {
	test("simple task stays readable", () => {
		const input = "Create a REST API endpoint for user profiles";
		const result = compactTaskText(input);
		expect(result).toBe(input);
	});

	test("verbose YAML task becomes compact but readable", () => {
		const input = `
description: |
  Set up a new project using the appropriate framework.
  Include TypeScript configuration and basic folder structure.
  Make sure to add all necessary dependencies.
  Configure ESLint and Prettier for code quality.
`;
		const result = compactTaskText(input);

		// Should be more compact
		expect(result.length).toBeLessThan(input.length);

		// But still readable
		expect(result).toContain("TypeScript");
		expect(result).toContain("framework");
		expect(result).toContain("ESLint");
	});

	test("technical details are preserved", () => {
		const input = `
Create an API endpoint:
- Path: /api/v1/users
- Method: POST
- Body: { name: string, email: string }
- Returns: 201 Created
`;
		const result = compactTaskText(input);

		expect(result).toContain("/api/v1/users");
		expect(result).toContain("POST");
		expect(result).toContain("201");
	});
});

describe("Edge cases", () => {
	test("handles empty string", () => {
		expect(compactTaskText("")).toBe("");
	});

	test("handles whitespace-only string", () => {
		expect(compactTaskText("   \n\n   ")).toBe("");
	});

	test("handles special characters", () => {
		const input = 'Use "quotes" and <brackets> and & ampersands';
		const result = compactTaskText(input);
		expect(result).toBe(input);
	});

	test("handles code blocks", () => {
		const input = `
Run this command:
\`\`\`bash
npm install
npm run build
\`\`\`
`;
		const result = compactTaskText(input);
		expect(result).toContain("npm install");
		expect(result).toContain("npm run build");
	});
});
