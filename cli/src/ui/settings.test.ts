import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "../config/types.ts";
import { buildActiveSettings } from "./settings.ts";

describe("buildActiveSettings", () => {
	it("should include stream when streamOutput is true", () => {
		const settings = buildActiveSettings({ ...DEFAULT_OPTIONS, streamOutput: true });
		expect(settings).toContain("stream");
	});

	it("should not include stream when streamOutput is false", () => {
		const settings = buildActiveSettings({ ...DEFAULT_OPTIONS, streamOutput: false });
		expect(settings).not.toContain("stream");
	});
});
