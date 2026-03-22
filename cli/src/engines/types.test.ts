import { describe, expect, it } from "bun:test";
import type { ProgressCallback, TextStreamCallback } from "./types.ts";

describe("TextStreamCallback", () => {
	it("should accept a string argument and return void", () => {
		const callback: TextStreamCallback = (_text: string) => {};
		callback("hello world");
	});

	it("should work as a streaming text collector", () => {
		const chunks: string[] = [];
		const callback: TextStreamCallback = (text) => {
			chunks.push(text);
		};

		callback("Hello ");
		callback("world");
		callback("!");

		expect(chunks).toEqual(["Hello ", "world", "!"]);
	});

	it("should be assignable to the same signature as ProgressCallback", () => {
		const textCb: TextStreamCallback = (text) => text;
		const progressCb: ProgressCallback = (step) => step;

		// Both should accept string and return void
		const fn = (cb: (s: string) => void) => cb("test");
		fn(textCb);
		fn(progressCb);
	});
});
