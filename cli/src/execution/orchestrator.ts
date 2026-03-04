/**
 * Simplified Orchestrator for Test Model Integration
 *
 * Automatically runs tests after main model completes, no special markers needed.
 * Test model analyzes results and suggests fixes if tests fail.
 */

import type { AIEngine, AIResult } from "../engines/types.ts";
import { logDebug, logError, logWarn } from "../ui/logger.ts";
import { StaticAgentDisplay } from "../ui/static-agent-display.ts";
import {
	canMakeConnectionAttempt,
	circuitBreaker,
	sleep,
	waitForConnectionRestore,
} from "./retry.ts";

const MAX_CONTEXT_CHARS = 12000;

function truncateContext(mainOutput: string): string {
	if (mainOutput.length <= MAX_CONTEXT_CHARS) {
		return mainOutput;
	}

	const omitted = mainOutput.length - MAX_CONTEXT_CHARS;
	return `${mainOutput.slice(0, MAX_CONTEXT_CHARS)}\n\n[...output truncated, ${omitted} chars omitted...]`;
}

export interface OrchestratorOptions {
	mainEngine: AIEngine;
	testEngine?: AIEngine;
	mainModel?: string;
	testModel?: string;
	workDir: string;
	maxIterations?: number;
	debug?: boolean;
	/** Agent number for display updates */
	agentNum?: number;
}

export interface OrchestratorResult {
	success: boolean;
	response: string;
	iterations: number;
	mainModelCalls: number;
	testModelCalls: number;
	error?: string;
}

async function executeWithRetry(
	engine: AIEngine,
	prompt: string,
	workDir: string,
	options: { modelOverride?: string },
	maxRetries = 3,
): Promise<AIResult> {
	let lastError: string | undefined;

	const circuitCheck = canMakeConnectionAttempt();
	if (!circuitCheck.allowed) {
		logError(`Circuit breaker preventing execution: ${circuitCheck.reason}`);
		const restored = await waitForConnectionRestore(60000);
		if (!restored) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: circuitCheck.reason || "Connection circuit open - too many failures",
			};
		}
	}

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const attemptCheck = canMakeConnectionAttempt();
		if (!attemptCheck.allowed) {
			logError(`Circuit breaker preventing retry: ${attemptCheck.reason}`);
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: attemptCheck.reason || "Connection circuit open - stopping retries",
			};
		}

		let result: AIResult;
		try {
			result = await engine.execute(prompt, workDir, options);
		} catch (error) {
			result = {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}

		if (result.success) {
			circuitBreaker.recordSuccess();
			return result;
		}

		lastError = result.error;

		const isConnectionError =
			/connection|network|timeout|unable to connect|internet connection|econnrefused|econnreset|socket hang up|dns|ENOTFOUND/i.test(
				result.error || "",
			);

		if (isConnectionError) {
			circuitBreaker.recordFailure(new Error(result.error || "Connection error"));

			if (attempt < maxRetries) {
				const delayMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
				logWarn(
					`Connection error on attempt ${attempt}/${maxRetries}. Retrying in ${delayMs}ms...`,
				);
				await sleep(delayMs);

				const postFailureCheck = canMakeConnectionAttempt();
				if (!postFailureCheck.allowed) {
					logError(`Circuit opened after ${attempt} attempts: ${postFailureCheck.reason}`);
					return {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error: postFailureCheck.reason || `Connection failed after ${attempt} attempts`,
					};
				}
			} else {
				break;
			}
		} else if (attempt >= maxRetries) {
			break;
		} else {
			const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10000);
			logWarn(
				`Attempt ${attempt}/${maxRetries} failed: ${result.error || "Unknown error"}. Retrying in ${delayMs}ms...`,
			);
			await sleep(delayMs);
		}
	}

	return {
		success: false,
		response: "",
		inputTokens: 0,
		outputTokens: 0,
		error: lastError || "All retry attempts failed",
	};
}

function buildTestPrompt(mainOutput: string, _workDir: string): string {
	return `You are a test runner. Your job is to verify that the implementation is correct by RUNNING the actual tests.

## Previous Implementation Work

${truncateContext(mainOutput)}

## Your Task

1. First, identify what test framework is being used (jest, pytest, npm test, cargo test, etc.)
2. Run the tests using the appropriate command
3. Report the results clearly:
   - How many tests passed/failed
   - Any error messages
   - Specific files that failed

## Commands to try (in order):
- npm test
- npm run test
- yarn test
- pnpm test
- pytest
- python -m pytest
- cargo test
- go test
- make test

## Output Format

Report your findings in this format:

TEST RESULTS:
- Framework: <name>
- Command: <command you ran>
- Passed: <N>
- Failed: <N>
- Status: PASS / FAIL / PARTIAL

DETAILS:
<specific failures or "All tests passed">`;
}

function buildFixPrompt(originalPrompt: string, mainOutput: string, testResults: string): string {
	return `${originalPrompt}

## Your Previous Implementation

${truncateContext(mainOutput)}

## Test Results

${testResults}

## Instructions

The tests have revealed issues. Please:
1. Fix the problems identified in the test results
2. Run tests again to verify fixes
3. Provide the corrected implementation`;
}

/**
 * Execute with orchestrator pattern - automatically runs tests after main model
 */
export async function executeWithOrchestrator(
	prompt: string,
	options: OrchestratorOptions,
	onProgress?: (step: string) => void,
): Promise<OrchestratorResult> {
	const { mainEngine, testEngine, mainModel, testModel, workDir, debug = false } = options;

	const reportProgress = (message: string) => {
		if (debug) logDebug(`[Orchestrator] ${message}`);
		onProgress?.(message);
	};

	reportProgress("Starting execution with test feedback");

	// Step 1: Run main model to implement the task
	reportProgress("Running main model...");
	const mainResult = await executeWithRetry(mainEngine, prompt, workDir, {
		modelOverride: mainModel,
	});

	if (!mainResult.success) {
		return {
			success: false,
			response: mainResult.response,
			iterations: 1,
			mainModelCalls: 1,
			testModelCalls: 0,
			error: `Main model failed: ${mainResult.error}`,
		};
	}

	const mainOutput = mainResult.response || "";
	reportProgress("Main model complete, running tests...");

	// Update display to show test model is running
	const display = StaticAgentDisplay.getInstance();
	if (display && options.agentNum !== undefined) {
		const currentTitle = display.getAgentTaskTitle(options.agentNum) || "Orchestrator task";
		display.setAgentStatus(
			options.agentNum,
			currentTitle,
			"working",
			"testing",
			testModel || "test",
		);
	}

	// Step 2: Run test model to verify the work
	reportProgress(`Sending to test model (${testModel || "default"})...`);
	const testPrompt = buildTestPrompt(mainOutput, workDir);
	const testEngineToUse = testEngine || mainEngine;
	reportProgress("Test prompt ready, executing test model...");
	const testResult = await executeWithRetry(testEngineToUse, testPrompt, workDir, {
		modelOverride: testModel,
	});

	const testOutput = testResult.success
		? testResult.response || "Tests completed"
		: `Test execution failed: ${testResult.error}`;

	reportProgress(`Test model complete. Response length: ${testOutput.length} chars`);
	reportProgress(`Test output preview: ${testOutput.slice(0, 100)}...`);

	// Check if tests indicate failures that need fixing
	const hasFailures =
		/\b\d+\s*(tests?|specs?|assertions?)\s*(failed|failing)\b/i.test(testOutput) ||
		/\b[1-9]\d*\s+failed\b/i.test(testOutput) ||
		/\bfailed:\s*[1-9]\d*\b/i.test(testOutput) ||
		/[✗❌]\s*\d+/i.test(testOutput);

	if (!hasFailures) {
		// Tests passed or no issues found
		return {
			success: true,
			response: `${mainOutput}\n\n---\n\nTest Results:\n${testOutput}`,
			iterations: 1,
			mainModelCalls: 1,
			testModelCalls: 1,
		};
	}

	// Step 3: Tests failed - run main model again with fix instructions
	reportProgress("Issues found, requesting fixes...");
	const fixPrompt = buildFixPrompt(prompt, mainOutput, testOutput);
	const fixResult = await executeWithRetry(mainEngine, fixPrompt, workDir, {
		modelOverride: mainModel,
	});

	if (!fixResult.success) {
		return {
			success: false,
			response: `${mainOutput}\n\n---\n\nTest Results:\n${testOutput}`,
			iterations: 2,
			mainModelCalls: 2,
			testModelCalls: 1,
			error: `Failed to fix issues: ${fixResult.error}`,
		};
	}

	return {
		success: true,
		response: `${fixResult.response}\n\n---\n\nOriginal Test Results:\n${testOutput}`,
		iterations: 2,
		mainModelCalls: 2,
		testModelCalls: 1,
	};
}

/**
 * Check if orchestrator pattern should be used for this task
 */
export function shouldUseOrchestrator(
	taskTitle: string,
	taskDescription: string,
	testModel?: string,
): boolean {
	if (!testModel) return false;

	const combined = `${taskTitle} ${taskDescription}`.toLowerCase();

	// Use orchestrator for tasks that likely need testing
	const testKeywords = ["test", "spec", "jest", "vitest", "mocha", "cypress", "playwright"];
	const implKeywords = ["implement", "create feature", "fix bug", "debug", "failing"];

	return (
		testKeywords.some((kw) => combined.includes(kw)) ||
		implKeywords.some((kw) => combined.includes(kw))
	);
}
