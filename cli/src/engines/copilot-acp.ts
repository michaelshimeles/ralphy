import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, commandExists } from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * GitHub Copilot CLI AI Engine using Agent Client Protocol (ACP)
 *
 * This implementation uses the ACP protocol for structured communication
 * with Copilot CLI instead of parsing text output. Benefits:
 * - Structured NDJSON protocol communication
 * - Real streaming via agent_message_chunk events
 * - Better error handling with structured responses
 * - No fragile text parsing or temporary files
 *
 * Note: Token counts are not available via Copilot's ACP implementation (public preview).
 * All token counts are set to 0.
 *
 * ACP Documentation: https://docs.github.com/en/copilot/reference/acp-server
 * Protocol Spec: https://agentclientprotocol.com/protocol/overview
 *
 * Note: This is now the default implementation for --copilot flag.
 * The legacy CopilotEngine (using text parsing) is kept for reference.
 */
export class CopilotAcpEngine extends BaseAIEngine {
	name = "GitHub Copilot";
	cliCommand = "copilot";

	/**
	 * Cleanup ACP connection and process
	 */
	private async cleanupAcpConnection(
		process: ReturnType<typeof spawn>,
		sessionId?: string,
		connection?: acp.ClientSideConnection,
	): Promise<void> {
		try {
			// End session if exists
			if (sessionId && connection) {
				logDebug(`[Copilot ACP] Ending session: ${sessionId}`);
				await connection.endSession({ sessionId }).catch((err) => {
					logDebug(`[Copilot ACP] Failed to end session: ${err.message}`);
				});
			}

			// Close stdin to signal end of input
			if (process.stdin) {
				process.stdin.end();
			}

			// Use cross-platform process termination
			// On Windows, SIGTERM doesn't work reliably, so we use default kill behavior
			const isWindows = process.platform === "win32";
			if (isWindows) {
				process.kill(); // Uses SIGTERM equivalent on Windows
			} else {
				process.kill("SIGTERM");
			}

			// Wait for process to exit with timeout and force kill if needed
			const exitTimeout = 2000;
			await new Promise<void>((resolve) => {
				let processExited = false;
				const timeoutId = setTimeout(() => {
					if (!processExited) {
						logDebug("[Copilot ACP] Process cleanup timeout, forcing kill");
						try {
							process.kill("SIGKILL"); // Force kill on timeout
						} catch (err) {
							logDebug(`[Copilot ACP] Force kill failed: ${err instanceof Error ? err.message : String(err)}`);
						}
						// Give SIGKILL a moment to work before resolving
						setTimeout(() => {
							if (!processExited) {
								logDebug("[Copilot ACP] Warning: Process may still be running after SIGKILL");
							}
							resolve();
						}, 500);
					}
				}, exitTimeout);

				process.once("exit", () => {
					processExited = true;
					clearTimeout(timeoutId);
					logDebug("[Copilot ACP] Process exited");
					resolve();
				});
			});
		} catch (err) {
			logDebug(`[Copilot ACP] Cleanup error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * Build prompt content array for ACP
	 */
	private buildPromptContent(prompt: string, options?: EngineOptions): acp.PromptContent[] {
		const content: acp.PromptContent[] = [{ type: "text", text: prompt }];

		// Note: Model override is passed as text instruction because Copilot's ACP
		// implementation doesn't currently support native model parameter.
		// This is a limitation of Copilot CLI's ACP preview implementation.
		if (options?.modelOverride) {
			content.unshift({
				type: "text",
				text: `[Use model: ${options.modelOverride}]`,
			});
		}

		return content;
	}

	/**
	 * Create a client with custom sessionUpdate handler for capturing response chunks
	 * 
	 * Note: This uses a workaround to intercept sessionUpdate calls since the ACP SDK
	 * doesn't provide a built-in way to access the full response. This approach wraps
	 * the client to intercept and accumulate chunks before passing them to the original handler.
	 */
	private createChunkCapturingClient(
		originalClient: acp.Client,
		onChunk: (text: string) => void,
	): acp.Client {
		return {
			...originalClient,
			async sessionUpdate(params: acp.SessionUpdateParams) {
				const update = params.update;

				// Capture text chunks
				if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
					onChunk(update.content.text);
				}

				// Call original handler if it exists
				if (originalClient.sessionUpdate) {
					await originalClient.sessionUpdate(params);
				}
			},
		};
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		let connection: acp.ClientSideConnection | undefined;
		let copilotProcess: ReturnType<typeof spawn> | undefined;
		let sessionId: string | undefined;
		const stderrChunks: Buffer[] = [];

		try {
			const startTime = Date.now();

			// Spawn Copilot process
			const executable = process.env.COPILOT_CLI_PATH || this.cliCommand;
			logDebug(`[Copilot ACP] Starting ACP server: ${executable} --acp --stdio`);

			const isWindows = process.platform === "win32";
			copilotProcess = spawn(executable, ["--acp", "--stdio"], {
				cwd: workDir,
				stdio: ["pipe", "pipe", "pipe"],
				shell: isWindows,
			});

			if (!copilotProcess.stdin || !copilotProcess.stdout) {
				throw new Error("Failed to start Copilot ACP process with piped stdio.");
			}

			// Capture stderr for diagnostics
			if (copilotProcess.stderr) {
				copilotProcess.stderr.on("data", (data) => {
					const chunk = Buffer.from(data);
					stderrChunks.push(chunk);
					logDebug(`[Copilot ACP stderr] ${chunk.toString()}`);
				});
			}

			// Create ACP streams
			const output = Writable.toWeb(copilotProcess.stdin) as WritableStream<Uint8Array>;
			const input = Readable.toWeb(copilotProcess.stdout) as ReadableStream<Uint8Array>;
			const stream = acp.ndJsonStream(output, input);

			// Accumulate response chunks
			let response = "";

			// Create client with chunk capturing
			const client = this.createChunkCapturingClient(
				{
					async requestPermission(_params) {
						logDebug("[Copilot ACP] Auto-approving permission request (yolo mode)");
						return { outcome: { outcome: "approved" } };
					},
					async sessionUpdate(_params) {
						// Handled by wrapper
					},
				},
				(text) => {
					response += text;
				},
			);

			// Create connection
			connection = new acp.ClientSideConnection((_agent) => client, stream);

			// Initialize
			logDebug("[Copilot ACP] Initializing connection");
			await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			});

			// Create session
			logDebug(`[Copilot ACP] Creating new session in: ${workDir}`);
			const sessionResult = await connection.newSession({
				cwd: workDir,
				mcpServers: [],
			});
			sessionId = sessionResult.sessionId;
			logDebug(`[Copilot ACP] Session created: ${sessionId}`);

			// Build and send prompt
			const promptContent = this.buildPromptContent(prompt, options);
			logDebug(`[Copilot ACP] Sending prompt (${prompt.length} chars)`);

			const promptResult = await connection.prompt({
				sessionId,
				prompt: promptContent,
			});

			const durationMs = Date.now() - startTime;

			logDebug(`[Copilot ACP] Prompt completed with stopReason: ${promptResult.stopReason}`);
			logDebug(`[Copilot ACP] Response length: ${response.length} chars`);

			// Note: Copilot's ACP implementation does not return token counts in promptResult
			// The promptResult only contains { stopReason: "end_turn" }
			// Token/usage metadata is not available through ACP protocol with Copilot CLI
			// This differs from the legacy implementation which could parse token counts from CLI output
			logDebug("[Copilot ACP] Note: Token counts not available via ACP protocol");

			// Check for error stop reasons
			if (promptResult.stopReason === "error") {
				return {
					success: false,
					response: response || "An error occurred",
					inputTokens: 0,
					outputTokens: 0,
					error: "Copilot CLI returned an error",
				};
			}

			if (promptResult.stopReason === "cancelled") {
				return {
					success: false,
					response: response || "Request was cancelled",
					inputTokens: 0,
					outputTokens: 0,
					error: "Request was cancelled",
				};
			}

			return {
				success: true,
				response: response || "Task completed",
				inputTokens: 0, // Not available via ACP
				outputTokens: 0, // Not available via ACP
				cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
			};
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const stderrOutput = stderrChunks.length > 0 
				? `\nStderr: ${Buffer.concat(stderrChunks).toString().trim()}`
				: "";
			logDebug(`[Copilot ACP] Error: ${errorMessage}${stderrOutput}`);

			// Check for authentication errors
			if (
				errorMessage.toLowerCase().includes("authentication") ||
				errorMessage.toLowerCase().includes("not authenticated")
			) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error:
						"GitHub Copilot CLI is not authenticated. Run 'copilot' and use '/login' to authenticate, or set COPILOT_GITHUB_TOKEN environment variable.",
				};
			}

			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: `Failed to execute prompt: ${errorMessage}${stderrOutput}`,
			};
		} finally {
			// Always cleanup
			if (copilotProcess) {
				await this.cleanupAcpConnection(copilotProcess, sessionId, connection);
			}
		}
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		let connection: acp.ClientSideConnection | undefined;
		let copilotProcess: ReturnType<typeof spawn> | undefined;
		let sessionId: string | undefined;
		const stderrChunks: Buffer[] = [];

		try {
			const startTime = Date.now();

			// Spawn Copilot process
			const executable = process.env.COPILOT_CLI_PATH || this.cliCommand;
			logDebug(`[Copilot ACP] Starting ACP server: ${executable} --acp --stdio`);

			const isWindows = process.platform === "win32";
			copilotProcess = spawn(executable, ["--acp", "--stdio"], {
				cwd: workDir,
				stdio: ["pipe", "pipe", "pipe"],
				shell: isWindows,
			});

			if (!copilotProcess.stdin || !copilotProcess.stdout) {
				throw new Error("Failed to start Copilot ACP process with piped stdio.");
			}

			// Capture stderr for diagnostics
			if (copilotProcess.stderr) {
				copilotProcess.stderr.on("data", (data) => {
					const chunk = Buffer.from(data);
					stderrChunks.push(chunk);
					logDebug(`[Copilot ACP stderr] ${chunk.toString()}`);
				});
			}

			// Create ACP streams
			const output = Writable.toWeb(copilotProcess.stdin) as WritableStream<Uint8Array>;
			const input = Readable.toWeb(copilotProcess.stdout) as ReadableStream<Uint8Array>;
			const stream = acp.ndJsonStream(output, input);

			// Accumulate response chunks and call progress
			let response = "";
			let lastProgressUpdate = "";

			// Create client with chunk capturing and progress reporting
			const client = this.createChunkCapturingClient(
				{
					async requestPermission(_params) {
						logDebug("[Copilot ACP] Auto-approving permission request (yolo mode)");
						return { outcome: { outcome: "approved" } };
					},
					async sessionUpdate(_params) {
						// Handled by wrapper
					},
				},
				(text) => {
					response += text;

					// Update progress with a preview of the response
					// Show last 50 chars to give user feedback
					const preview = response.slice(-50).replace(/\n/g, " ").trim();
					if (preview && preview !== lastProgressUpdate) {
						lastProgressUpdate = preview;
						onProgress(`Streaming: ${preview}...`);
					}
				},
			);

			// Create connection
			connection = new acp.ClientSideConnection((_agent) => client, stream);

			// Initialize
			logDebug("[Copilot ACP] Initializing connection");
			await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			});

			// Create session
			logDebug(`[Copilot ACP] Creating new session in: ${workDir}`);
			const sessionResult = await connection.newSession({
				cwd: workDir,
				mcpServers: [],
			});
			sessionId = sessionResult.sessionId;
			logDebug(`[Copilot ACP] Session created: ${sessionId}`);

			// Build and send prompt
			const promptContent = this.buildPromptContent(prompt, options);
			logDebug(`[Copilot ACP] Sending prompt (${prompt.length} chars) with streaming`);

			const promptResult = await connection.prompt({
				sessionId,
				prompt: promptContent,
			});

			const durationMs = Date.now() - startTime;

			logDebug(`[Copilot ACP] Streaming completed with stopReason: ${promptResult.stopReason}`);
			logDebug(`[Copilot ACP] Response length: ${response.length} chars`);

			// Note: Copilot's ACP implementation does not return token counts
			// Token/usage metadata is not available through ACP protocol with Copilot CLI
			logDebug("[Copilot ACP] Note: Token counts not available via ACP protocol");

			// Check for error stop reasons
			if (promptResult.stopReason === "error") {
				return {
					success: false,
					response: response || "An error occurred",
					inputTokens: 0,
					outputTokens: 0,
					error: "Copilot CLI returned an error",
				};
			}

			if (promptResult.stopReason === "cancelled") {
				return {
					success: false,
					response: response || "Request was cancelled",
					inputTokens: 0,
					outputTokens: 0,
					error: "Request was cancelled",
				};
			}

			return {
				success: true,
				response: response || "Task completed",
				inputTokens: 0, // Not available via ACP
				outputTokens: 0, // Not available via ACP
				cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
			};
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const stderrOutput = stderrChunks.length > 0 
				? `\nStderr: ${Buffer.concat(stderrChunks).toString().trim()}`
				: "";
			logDebug(`[Copilot ACP] Streaming error: ${errorMessage}${stderrOutput}`);

			// Check for authentication errors
			if (
				errorMessage.toLowerCase().includes("authentication") ||
				errorMessage.toLowerCase().includes("not authenticated")
			) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error:
						"GitHub Copilot CLI is not authenticated. Run 'copilot' and use '/login' to authenticate, or set COPILOT_GITHUB_TOKEN environment variable.",
				};
			}

			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: `Failed to execute streaming prompt: ${errorMessage}${stderrOutput}`,
			};
		} finally {
			// Always cleanup
			if (copilotProcess) {
				await this.cleanupAcpConnection(copilotProcess, sessionId, connection);
			}
		}
	}

	async isAvailable(): Promise<boolean> {
		return commandExists(this.cliCommand);
	}
}
