import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "../config/types.ts";
import { buildActiveSettings } from "./settings.ts";

describe("buildActiveSettings", () => {
	it("includes repeat setting when repeatCount > 1", () => {
		const settings = buildActiveSettings({
			...DEFAULT_OPTIONS,
			repeatCount: 3,
		});
		expect(settings).toContain("repeat 3");
	});

	it("does not include repeat setting when repeatCount is 1", () => {
		const settings = buildActiveSettings({
			...DEFAULT_OPTIONS,
			repeatCount: 1,
		});
		expect(settings).not.toContain("repeat 1");
	});
});
