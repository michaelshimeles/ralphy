import { describe, expect, it } from "bun:test";
import { matchesPattern, isIgnored } from "./sandbox.ts";

describe("matchesPattern", () => {
	describe("directory match (pattern/)", () => {
		it("should match directory when isDirectory is true or undefined", () => {
			expect(matchesPattern("node_modules", "node_modules/")).toBe(true);
			expect(matchesPattern("node_modules", "node_modules/", true)).toBe(true);
			expect(matchesPattern(".ralphy", ".ralphy/", true)).toBe(true);
		});

		it("should NOT match file when isDirectory is false", () => {
			expect(matchesPattern("node_modules", "node_modules/", false)).toBe(false);
			expect(matchesPattern(".ralphy", ".ralphy/", false)).toBe(false);
		});
	});

	describe("exact match", () => {
		it("should match exact filenames", () => {
			expect(matchesPattern("node_modules", "node_modules")).toBe(true);
			expect(matchesPattern(".ralphy", ".ralphy")).toBe(true);
		});

		it("should not match different filenames", () => {
			expect(matchesPattern("node_modules", "vendor")).toBe(false);
		});
	});

	describe("suffix match (*.ext)", () => {
		it("should match files ending with extension", () => {
			expect(matchesPattern("debug.log", "*.log")).toBe(true);
			expect(matchesPattern("error.log", "*.log")).toBe(true);
			expect(matchesPattern("test.sqlite", "*.sqlite")).toBe(true);
		});

		it("should NOT match when dot is treated as regex wildcard", () => {
			// This is the key test - "*.log" should NOT match "testXlog"
			// because we use string comparison, not regex
			expect(matchesPattern("testXlog", "*.log")).toBe(false);
			expect(matchesPattern("test-log", "*.log")).toBe(false);
		});

		it("should not match files without the extension", () => {
			expect(matchesPattern("logfile", "*.log")).toBe(false);
			expect(matchesPattern("log", "*.log")).toBe(false);
		});
	});

	describe("prefix match (prefix*)", () => {
		it("should match files starting with prefix", () => {
			expect(matchesPattern("test123", "test*")).toBe(true);
			expect(matchesPattern("test.js", "test*")).toBe(true);
		});

		it("should NOT match when dot is treated as regex wildcard", () => {
			// "test.*" as prefix should use string comparison
			expect(matchesPattern("testXjs", "test.")).toBe(false);
		});

		it("should not match files without the prefix", () => {
			expect(matchesPattern("mytest", "test*")).toBe(false);
		});
	});

	describe("tree match (dir/**)", () => {
		it("should match all files under directory", () => {
			expect(matchesPattern("src/foo.js", "src/**")).toBe(true);
			expect(matchesPattern("src/nested/bar.ts", "src/**")).toBe(true);
		});

		it("should not match files outside directory", () => {
			expect(matchesPattern("lib/foo.js", "src/**")).toBe(false);
		});
	});

	describe("middle wildcard (test.*.js)", () => {
		it("should match with proper regex escaping", () => {
			expect(matchesPattern("test.foo.js", "test.*.js")).toBe(true);
			expect(matchesPattern("test.bar.js", "test.*.js")).toBe(true);
		});

		it("should escape dots properly - not match when dot is wildcard", () => {
			// "test.*.js" should NOT match "testXfooXjs" because dots are escaped
			expect(matchesPattern("testXfooXjs", "test.*.js")).toBe(false);
		});

		it("should escape other metacharacters", () => {
			// Pattern with special chars should work correctly
			expect(matchesPattern("file[1].txt", "file[*].txt")).toBe(true);
			expect(matchesPattern("file(test).log", "file(*).log")).toBe(true);
		});
	});
});

describe("isIgnored", () => {
	it("should return true if any pattern matches", () => {
		expect(isIgnored(".ralphy", [".ralphy-sandboxes", ".ralphy"])).toBe(true);
		expect(isIgnored("debug.log", ["*.log", "*.sqlite"])).toBe(true);
	});

	it("should return false if no pattern matches", () => {
		expect(isIgnored("src", [".ralphy", "node_modules"])).toBe(false);
	});

	it("should handle DEFAULT_IGNORED patterns correctly", () => {
		const DEFAULT_IGNORED = [
			".ralphy-sandboxes/",
			".ralphy-worktrees/",
			".ralphy/",
			"nul",
		];

		// Matches because strict=undefined allows directory patterns to match
		// This simulates typical lenient behavior if type isn't known, or just directory check
		expect(isIgnored(".ralphy", DEFAULT_IGNORED)).toBe(true);
		
		// Should explicitly match if isDirectory=true
		expect(isIgnored(".ralphy", DEFAULT_IGNORED, true)).toBe(true);
		
		// Should NOT match if isDirectory=false
		expect(isIgnored(".ralphy", DEFAULT_IGNORED, false)).toBe(false);

		// Removed *.log from ignore list, so these should return false
		expect(isIgnored("debug.log", DEFAULT_IGNORED)).toBe(false);
		
		expect(isIgnored("nul", DEFAULT_IGNORED)).toBe(true);
		expect(isIgnored("src", DEFAULT_IGNORED)).toBe(false);
		expect(isIgnored("package.json", DEFAULT_IGNORED)).toBe(false);
	});
});
