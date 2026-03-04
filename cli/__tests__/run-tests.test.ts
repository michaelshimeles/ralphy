#!/usr/bin/env bun

/**
 * Comprehensive test runner for all sandbox and security fixes
 */

import { spawn } from "bun";

const testFiles = ["__tests__/sandbox-security.test.ts", "__tests__/locking-security.test.ts"];

console.log("🧪 Running Security and Reliability Tests...\n");

async function runTestFile(testFile: string) {
	console.log(`\n📋 Running ${testFile}...`);

	try {
		const childProcess = spawn(["bun", "test", testFile], {
			stdout: "inherit",
			stderr: "inherit",
			cwd: process.cwd(),
		});

		const exitCode = await childProcess.exited;

		if (exitCode === 0) {
			console.log(`✅ ${testFile} - PASSED`);
		} else {
			console.log(`❌ ${testFile} - FAILED (exit code: ${exitCode})`);
			return false;
		}
	} catch (error) {
		console.log(`💥 ${testFile} - ERROR: ${error}`);
		return false;
	}

	return true;
}

async function main() {
	const startTime = Date.now();
	let allPassed = true;

	for (const testFile of testFiles) {
		const passed = await runTestFile(testFile);
		if (!passed) {
			allPassed = false;
		}
	}

	const endTime = Date.now();
	const duration = endTime - startTime;

	console.log(`\n${"=".repeat(50)}`);
	console.log("📊 Test Summary:");
	console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
	console.log(`📁  Status: ${allPassed ? "ALL TESTS PASSED ✅" : "SOME TESTS FAILED ❌"}`);

	if (allPassed) {
		console.log("\n🎉 All security and reliability tests passed!");
		process.exit(0);
	} else {
		console.log("\n🚨 Some tests failed. Please review the output above.");
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("💥 Test runner failed:", error);
	process.exit(1);
});
