import { execSync } from "node:child_process";
import { logWarn } from "../ui/logger.ts";

/**
 * Check if agent-browser CLI is available
 */
export function isAgentBrowserInstalled(): boolean {
	try {
		const isWindows = process.platform === "win32";
		const checkCommand = isWindows ? "where agent-browser" : "which agent-browser";
		execSync(checkCommand, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if browser automation should be enabled
 * @param browserEnabled - CLI flag value: 'auto' | 'true' | 'false'
 * @returns true if browser should be enabled
 */
export function isBrowserAvailable(browserEnabled: "auto" | "true" | "false"): boolean {
	if (browserEnabled === "false") {
		return false;
	}

	if (browserEnabled === "true") {
		if (!isAgentBrowserInstalled()) {
			logWarn("--browser flag used but agent-browser CLI not found");
			logWarn("Install from: https://agent-browser.dev");
			return false;
		}
		return true;
	}

	// auto mode: check if available
	return isAgentBrowserInstalled();
}

/**
 * Get browser instructions for prompt injection
 */
export function getBrowserInstructions(): string {
	return `## Browser Automation (agent-browser)
You have access to browser automation via the \`agent-browser\` CLI.

**Key Commands:**
- \`agent-browser open <url>\` - Open a URL in the browser
- \`agent-browser snapshot\` - Get accessibility tree with element refs (@e1, @e2, etc.)
- \`agent-browser click @e1\` - Click an element by reference
- \`agent-browser type @e1 "text"\` - Type text into an input field
- \`agent-browser screenshot <file.png>\` - Capture screenshot
- \`agent-browser content\` - Get page text content
- \`agent-browser close\` - Close browser session

**Workflow:**
1. Use \`open\` to navigate to a URL
2. Use \`snapshot\` to see available elements (returns refs like @e1, @e2)
3. Use \`click\`/\`type\` with element refs to interact
4. Use \`screenshot\` for visual verification

**Use browser automation for:**
- Testing web UI after implementing features
- Verifying deployments
- Filling forms or checking workflows
- Visual regression testing`;
}
