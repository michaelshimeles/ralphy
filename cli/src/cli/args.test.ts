import { describe, expect, it } from "bun:test";
import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
	describe("--stream-output", () => {
		it("should default streamOutput to false", () => {
			const { options } = parseArgs(["node", "ralphy", "some task"]);
			expect(options.streamOutput).toBe(false);
		});

		it("should set streamOutput to true when --stream-output is passed", () => {
			const { options } = parseArgs(["node", "ralphy", "--stream-output", "some task"]);
			expect(options.streamOutput).toBe(true);
		});

		it("should work with other flags", () => {
			const { options } = parseArgs([
				"node",
				"ralphy",
				"--stream-output",
				"--verbose",
				"--dry-run",
				"some task",
			]);
			expect(options.streamOutput).toBe(true);
			expect(options.verbose).toBe(true);
			expect(options.dryRun).toBe(true);
		});
	});
});
