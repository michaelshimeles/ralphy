import { describe, expect, it } from "bun:test";
import { parseArgs } from "../cli/args.ts";

describe("--glab flag parsing", () => {
	it("should set createMr to true when --glab is passed", () => {
		const { options } = parseArgs(["node", "ralphy", "--glab"]);

		expect(options.createMr).toBe(true);
	});

	it("should imply createPr when --glab is passed", () => {
		const { options } = parseArgs(["node", "ralphy", "--glab"]);

		expect(options.createPr).toBe(true);
	});

	it("should not set createMr when --glab is not passed", () => {
		const { options } = parseArgs(["node", "ralphy"]);

		expect(options.createMr).toBe(false);
	});

	it("should keep createPr false when neither --create-pr nor --glab is passed", () => {
		const { options } = parseArgs(["node", "ralphy"]);

		expect(options.createPr).toBe(false);
	});

	it("should allow --glab with --draft-pr", () => {
		const { options } = parseArgs(["node", "ralphy", "--glab", "--draft-pr"]);

		expect(options.createMr).toBe(true);
		expect(options.createPr).toBe(true);
		expect(options.draftPr).toBe(true);
	});

	it("should allow --glab with --base-branch", () => {
		const { options } = parseArgs(["node", "ralphy", "--glab", "--base-branch", "develop"]);

		expect(options.createMr).toBe(true);
		expect(options.baseBranch).toBe("develop");
	});

	it("should allow --glab with --branch-per-task", () => {
		const { options } = parseArgs(["node", "ralphy", "--glab", "--branch-per-task"]);

		expect(options.createMr).toBe(true);
		expect(options.branchPerTask).toBe(true);
	});
});

describe("settings display with --glab", () => {
	it("should show mr setting when createMr is true", async () => {
		const { buildActiveSettings } = await import("../ui/settings.ts");
		const { DEFAULT_OPTIONS } = await import("../config/types.ts");

		const settings = buildActiveSettings({
			...DEFAULT_OPTIONS,
			createPr: true,
			createMr: true,
		});

		expect(settings).toContain("mr");
		expect(settings).not.toContain("pr");
	});

	it("should show pr setting when createPr is true but createMr is false", async () => {
		const { buildActiveSettings } = await import("../ui/settings.ts");
		const { DEFAULT_OPTIONS } = await import("../config/types.ts");

		const settings = buildActiveSettings({
			...DEFAULT_OPTIONS,
			createPr: true,
			createMr: false,
		});

		expect(settings).toContain("pr");
		expect(settings).not.toContain("mr");
	});
});
