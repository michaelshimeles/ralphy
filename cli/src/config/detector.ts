import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

interface DetectedProject {
	name: string;
	language: string;
	framework: string;
	testCmd: string;
	lintCmd: string;
	buildCmd: string;
}

/**
 * Detect project settings from the codebase
 */
export function detectProject(workDir = process.cwd()): DetectedProject {
	const result: DetectedProject = {
		name: basename(workDir),
		language: "",
		framework: "",
		testCmd: "",
		lintCmd: "",
		buildCmd: "",
	};

	// Check for package.json (Node.js/JavaScript/TypeScript)
	const packageJsonPath = join(workDir, "package.json");
	if (existsSync(packageJsonPath)) {
		detectNodeProject(packageJsonPath, result);
		return result;
	}

	// Check for Python projects
	const pyprojectPath = join(workDir, "pyproject.toml");
	const requirementsPath = join(workDir, "requirements.txt");
	const setupPyPath = join(workDir, "setup.py");
	if (existsSync(pyprojectPath) || existsSync(requirementsPath) || existsSync(setupPyPath)) {
		detectPythonProject(workDir, result);
		return result;
	}

	// Check for Go projects
	const goModPath = join(workDir, "go.mod");
	if (existsSync(goModPath)) {
		detectGoProject(result);
		return result;
	}

	// Check for Rust projects
	const cargoPath = join(workDir, "Cargo.toml");
	if (existsSync(cargoPath)) {
		detectRustProject(result);
		return result;
	}

	return result;
}

function detectNodeProject(packageJsonPath: string, result: DetectedProject): void {
	try {
		const content = readFileSync(packageJsonPath, "utf-8");
		const pkg = JSON.parse(content);

		// Get name from package.json
		if (pkg.name) {
			result.name = pkg.name;
		}

		// Detect TypeScript
		const tsconfigPath = join(packageJsonPath, "..", "tsconfig.json");
		result.language = existsSync(tsconfigPath) ? "TypeScript" : "JavaScript";

		// Get all dependencies
		const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
		const depNames = Object.keys(deps);

		// Detect frameworks (order matters - meta-frameworks first)
		const frameworks: string[] = [];
		if (depNames.includes("next")) frameworks.push("Next.js");
		if (depNames.includes("nuxt")) frameworks.push("Nuxt");
		if (depNames.includes("@remix-run/react")) frameworks.push("Remix");
		if (depNames.includes("svelte")) frameworks.push("Svelte");
		if (depNames.some((d) => d.startsWith("@nestjs/"))) frameworks.push("NestJS");
		if (depNames.includes("hono")) frameworks.push("Hono");
		if (depNames.includes("fastify")) frameworks.push("Fastify");
		if (depNames.includes("express")) frameworks.push("Express");

		// Only add React/Vue if no meta-framework detected
		if (frameworks.length === 0) {
			if (depNames.includes("react")) frameworks.push("React");
			if (depNames.includes("vue")) frameworks.push("Vue");
		}

		result.framework = frameworks.join(", ");

		// Detect commands from scripts
		const scripts = pkg.scripts || {};
		const hasBunLock = existsSync(join(packageJsonPath, "..", "bun.lockb"));

		if (scripts.test) {
			result.testCmd = hasBunLock ? "bun test" : "npm test";
		}
		if (scripts.lint) {
			result.lintCmd = "npm run lint";
		}
		if (scripts.build) {
			result.buildCmd = "npm run build";
		}
	} catch {
		// Ignore parsing errors
	}
}

function detectPythonProject(workDir: string, result: DetectedProject): void {
	result.language = "Python";

	// Read dependencies to detect frameworks
	let deps = "";
	const pyprojectPath = join(workDir, "pyproject.toml");
	const requirementsPath = join(workDir, "requirements.txt");

	if (existsSync(pyprojectPath)) {
		deps += readFileSync(pyprojectPath, "utf-8");
	}
	if (existsSync(requirementsPath)) {
		deps += readFileSync(requirementsPath, "utf-8");
	}

	const depsLower = deps.toLowerCase();
	const frameworks: string[] = [];
	if (depsLower.includes("fastapi")) frameworks.push("FastAPI");
	if (depsLower.includes("django")) frameworks.push("Django");
	if (depsLower.includes("flask")) frameworks.push("Flask");

	result.framework = frameworks.join(", ");
	result.testCmd = "pytest";
	result.lintCmd = "ruff check .";
}

function detectGoProject(result: DetectedProject): void {
	result.language = "Go";
	result.testCmd = "go test ./...";
	result.lintCmd = "golangci-lint run";
}

function detectRustProject(result: DetectedProject): void {
	result.language = "Rust";
	result.testCmd = "cargo test";
	result.lintCmd = "cargo clippy";
	result.buildCmd = "cargo build";
}
