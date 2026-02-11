import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { syncPrdToGiteaIssue } from "./issue-sync.ts";
import * as tea from "./tea.ts";

describe("syncPrdToGiteaIssue", () => {
	it("returns false when tea is unavailable", async () => {
		const availSpy = spyOn(tea, "isTeaAvailable").mockResolvedValue(false);

		const ok = await syncPrdToGiteaIssue("PRD.md", 1, process.cwd(), {
			repo: "org/repo",
		});
		expect(ok).toBe(false);

		availSpy.mockRestore();
	});

	it("reads file and calls tea issues edit", async () => {
		const availSpy = spyOn(tea, "isTeaAvailable").mockResolvedValue(true);
		const readSpy = spyOn(fs, "readFileSync").mockReturnValue("Hello" as unknown as Buffer);
		const execSpy = spyOn(tea, "execTea").mockResolvedValue({
			stdout: "",
			stderr: "",
			exitCode: 0,
		});

		const ok = await syncPrdToGiteaIssue("PRD.md", 12, "/repo");
		expect(ok).toBe(true);

		expect(execSpy).toHaveBeenCalledWith(["issues", "edit", "12", "--description", "Hello"], {
			workDir: "/repo",
			repo: undefined,
		});

		availSpy.mockRestore();
		readSpy.mockRestore();
		execSpy.mockRestore();
	});
});
