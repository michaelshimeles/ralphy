import { describe, expect, it } from "bun:test";
import { parseTeaIssueList } from "../gitea/tea.ts";
import { GiteaTaskSource } from "./gitea.ts";

describe("parseTeaIssueList", () => {
	it("parses JSON issue list", () => {
		const stdout = JSON.stringify([
			{ index: 12, title: "Fix bug", body: "details" },
			{ index: 13, title: "Add feature" },
		]);

		expect(parseTeaIssueList(stdout)).toEqual([
			{ number: 12, title: "Fix bug", body: "details" },
			{ number: 13, title: "Add feature", body: undefined },
		]);
	});

	it("best-effort parses table output", () => {
		const stdout = "index title\n12 Fix bug\n13 Add feature\n";
		expect(parseTeaIssueList(stdout)).toEqual([
			{ number: 12, title: "Fix bug" },
			{ number: 13, title: "Add feature" },
		]);
	});
});

describe("GiteaTaskSource", () => {
	it("maps tea issues to Task objects", async () => {
		const runner = async () => ({
			stdout: JSON.stringify([
				{ index: 1, title: "Task one", body: "Body" },
				{ index: 2, title: "Task two" },
			]),
			stderr: "",
			exitCode: 0,
		});

		const src = new GiteaTaskSource("org/repo", undefined, runner);
		const tasks = await src.getAllTasks();
		expect(tasks).toEqual([
			{ id: "1:Task one", title: "Task one", body: "Body", completed: false },
			{ id: "2:Task two", title: "Task two", body: undefined, completed: false },
		]);
	});

	it("markComplete closes the issue", async () => {
		const calls: string[][] = [];
		const runner = async (args: string[]) => {
			calls.push(args);
			return { stdout: "", stderr: "", exitCode: 0 };
		};

		const src = new GiteaTaskSource("org/repo", undefined, runner);
		await src.markComplete("12:Done");

		expect(calls).toEqual([["issues", "close", "12"]]);
	});

	it("countCompleted lists closed issues with titles (for JSON parsing)", async () => {
		const calls: string[][] = [];
		const runner = async (args: string[]) => {
			calls.push(args);
			// Minimal shape that parseTeaIssueList accepts
			return {
				stdout: JSON.stringify([
					{ index: 99, title: "Closed task" },
					{ index: 100, title: "Another closed task" },
				]),
				stderr: "",
				exitCode: 0,
			};
		};

		const src = new GiteaTaskSource("org/repo", undefined, runner);
		const completed = await src.countCompleted();
		expect(completed).toBe(2);

		expect(calls).toEqual([
			[
				"issues",
				"list",
				"--state",
				"closed",
				"--output",
				"json",
				"--fields",
				"index,title",
			],
		]);
	});
});
