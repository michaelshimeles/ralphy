#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function main() {
	const binaryPath = getPlatformBinary();

	if (!existsSync(binaryPath)) {
		// Fallback: try running with bun directly (development mode)
		const srcPath = join(__dirname, "src", "index.ts");
		if (existsSync(srcPath)) {
			const result = spawnSync("bun", ["run", srcPath, ...process.argv.slice(2)], {
				stdio: "inherit",
				cwd: process.cwd(),
			});
			process.exit(result.status ?? 1);
		}

		console.error(`Binary not found: ${binaryPath}`);
		console.error("Run 'bun run build' to compile the binary for your platform.");
		process.exit(1);
	}

	const result = spawnSync(binaryPath, process.argv.slice(2), {
		stdio: "inherit",
		cwd: process.cwd(),
	});

	process.exit(result.status ?? 1);
}

main();
