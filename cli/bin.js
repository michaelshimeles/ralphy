#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

function getPlatformBinary() {
	const platform = process.platform;
	const arch = process.arch;

	const platformMap = {
		darwin: "darwin",
		linux: "linux",
		win32: "windows",
	};

	const archMap = {
		arm64: "arm64",
		aarch64: "arm64",
		x64: "x64",
		amd64: "x64",
	};

	const platformKey = platformMap[platform];
	const archKey = archMap[arch];

	if (!platformKey || !archKey) {
		console.error(`Unsupported platform: ${platform}-${arch}`);
		process.exit(1);
	}

	const ext = platform === "win32" ? ".exe" : "";
	const binaryName = `ralphy-${platformKey}-${archKey}${ext}`;

	return join(__dirname, "dist", binaryName);
}

/**
 * Check if a command exists in PATH
 */
function commandExists(name) {
	try {
		const cmd = isWindows ? "where" : "which";
		let result;
		if (isWindows) {
			// Use cmd.exe wrapper for Windows 'where' command
			result = spawnSync("cmd.exe", ["/c", cmd, name], { stdio: "pipe" });
		} else {
			result = spawnSync(cmd, [name], { stdio: "pipe" });
		}
		return result.status === 0;
	} catch {
		return false;
	}
}

function main() {
	const binaryPath = getPlatformBinary();

	if (!existsSync(binaryPath)) {
		// Fallback: try running with tsx or bun directly (development mode)
		const srcPath = join(__dirname, "src", "index.ts");
		if (existsSync(srcPath)) {
			// Prefer tsx on Windows (better compatibility with simple-git)
			const runners = isWindows ? ["tsx", "bun"] : ["bun", "tsx"];

			for (const runner of runners) {
				if (!commandExists(runner)) continue;

				const runnerArgs = runner === "bun" ? ["run", srcPath] : [srcPath];
				const userArgs = process.argv.slice(2);

				let result;
				if (isWindows) {
					// On Windows, use cmd.exe /c to run .cmd files
					// Node.js handles argument escaping when passed as array
					result = spawnSync("cmd.exe", ["/c", runner, ...runnerArgs, ...userArgs], {
						stdio: "inherit",
						cwd: process.cwd(),
					});
				} else {
					result = spawnSync(runner, [...runnerArgs, ...userArgs], {
						stdio: "inherit",
						cwd: process.cwd(),
					});
				}

				if (result.error === undefined) {
					process.exit(result.status ?? 1);
				}
			}
		}

		console.error(`Binary not found: ${binaryPath}`);
		console.error("Run 'bun run build' to compile the binary for your platform.");
		console.error("Or install tsx: npm install -g tsx");
		process.exit(1);
	}

	const result = spawnSync(binaryPath, process.argv.slice(2), {
		stdio: "inherit",
		cwd: process.cwd(),
	});

	process.exit(result.status ?? 1);
}

main();
