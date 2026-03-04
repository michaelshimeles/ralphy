import { describe, expect, it } from "bun:test";
import { validateArgs } from "./validation.ts";

describe("validateArgs", () => {
	it("rejects redirect-like tokens", () => {
		expect(validateArgs(["--out", ">", "file.txt"])).toBeNull();
		expect(validateArgs(["<script>alert(1)</script>"])).toBeNull();
	});

	it("accepts normal safe arguments", () => {
		expect(validateArgs(["--model", "gpt-5", "--verbose"])).toEqual([
			"--model",
			"gpt-5",
			"--verbose",
		]);
	});
});
