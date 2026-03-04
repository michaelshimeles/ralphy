/**
 * ResourceManager - Manages system resources including files, memory, and cleanup operations
 * Provides centralized resource tracking, cleanup, and error handling
 */

import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerCleanup, registerProcess } from "./cleanup.ts";
import { RalphyError, standardizeError } from "./errors.ts";

/**
 * Generate a cryptographically secure random string for resource IDs
 */
function generateSecureId(): string {
	return randomBytes(8).toString("hex");
}

export class ResourceError extends RalphyError {
	constructor(message: string, context?: Record<string, unknown>) {
		super(message, "RESOURCE_ERROR", context);
		this.name = "ResourceError";
	}
}

interface ResourceInfo {
	id: string;
	type: "file" | "directory" | "process" | "memory" | "temp";
	path?: string;
	process?: ChildProcess;
	data?: unknown;
	created: Date;
	lastAccessed: Date;
	size?: number;
	cleanup?: () => void | Promise<void>;
}

interface ResourceStats {
	totalResources: number;
	filesTracked: number;
	processesTracked: number;
	tempDirectories: number;
	totalDiskUsage: number;
	oldestResource: Date | null;
}

/**
 * ResourceManager - Centralized resource management with automatic cleanup
 */
export class ResourceManager {
	private resources: Map<string, ResourceInfo> = new Map();
	private maxMemoryUsage: number;
	private maxTempFileSize: number;
	private cleanupInterval: number;
	private intervalId?: NodeJS.Timeout;

	constructor(
		options: {
			maxMemoryUsage?: number;
			maxTempFileSize?: number;
			cleanupInterval?: number;
		} = {},
	) {
		this.maxMemoryUsage = options.maxMemoryUsage ?? 100 * 1024 * 1024; // 100MB
		this.maxTempFileSize = options.maxTempFileSize ?? 10 * 1024 * 1024; // 10MB
		this.cleanupInterval = options.cleanupInterval ?? 60000; // 1 minute

		// Register cleanup handler
		registerCleanup(() => this.cleanup());

		// Start periodic cleanup
		this.startPeriodicCleanup();
	}

	/**
	 * Create a temporary directory and track it for cleanup
	 * Uses system temp directory for security (not process.cwd())
	 */
	createTempDir(prefix = "ralphy-temp"): string {
		// Use system temp directory for security, with cryptographically secure random suffix
		const tempDir = join(tmpdir(), `${prefix}-${Date.now()}-${generateSecureId()}`);

		try {
			mkdirSync(tempDir, { recursive: true });

			const resourceId = `temp-dir-${generateSecureId()}`;
			this.resources.set(resourceId, {
				id: resourceId,
				type: "directory",
				path: tempDir,
				created: new Date(),
				lastAccessed: new Date(),
				cleanup: () => {
					if (existsSync(tempDir)) {
						this.removeDirectory(tempDir);
					}
				},
			});

			return tempDir;
		} catch (error) {
			throw new ResourceError(`Failed to create temp directory: ${tempDir}`, {
				tempDir,
				error: standardizeError(error),
			});
		}
	}

	/**
	 * Create a temporary file and track it for cleanup
	 * Uses system temp directory for security (not process.cwd())
	 */
	createTempFile(content: string | Buffer, prefix = "ralphy-temp", extension = ".tmp"): string {
		// Use system temp directory for security, with cryptographically secure random suffix
		const tempFile = join(tmpdir(), `${prefix}-${Date.now()}-${generateSecureId()}${extension}`);

		try {
			// Check file size limits
			const contentSize =
				typeof content === "string" ? Buffer.byteLength(content, "utf-8") : content.length;
			if (contentSize > this.maxTempFileSize) {
				throw new ResourceError(
					`Temp file size exceeds limit: ${contentSize} > ${this.maxTempFileSize}`,
				);
			}

			writeFileSync(tempFile, content);

			const resourceId = `temp-file-${generateSecureId()}`;
			this.resources.set(resourceId, {
				id: resourceId,
				type: "file",
				path: tempFile,
				created: new Date(),
				lastAccessed: new Date(),
				size: contentSize,
				cleanup: () => {
					if (existsSync(tempFile)) {
						unlinkSync(tempFile);
					}
				},
			});

			return tempFile;
		} catch (error) {
			throw new ResourceError(`Failed to create temp file: ${tempFile}`, {
				tempFile,
				error: standardizeError(error),
			});
		}
	}

	/**
	 * Track a file resource for management
	 */
	trackFile(filePath: string, autoCleanup = false): string {
		const resolvedPath = resolve(filePath);

		try {
			if (!existsSync(resolvedPath)) {
				throw new ResourceError(`File does not exist: ${resolvedPath}`);
			}

			const stats = statSync(resolvedPath);
			const resourceId = `file-${Date.now()}-${generateSecureId()}`;

			this.resources.set(resourceId, {
				id: resourceId,
				type: "file",
				path: resolvedPath,
				created: new Date(),
				lastAccessed: new Date(),
				size: stats.size,
				cleanup: autoCleanup
					? () => {
							if (existsSync(resolvedPath)) {
								unlinkSync(resolvedPath);
							}
						}
					: undefined,
			});

			return resourceId;
		} catch (error) {
			throw new ResourceError(`Failed to track file: ${resolvedPath}`, {
				resolvedPath,
				error: standardizeError(error),
			});
		}
	}

	/**
	 * Track a process resource for management
	 */
	trackProcess(process: ChildProcess): string {
		const resourceId = `process-${Date.now()}-${generateSecureId()}`;

		// Register with global cleanup system
		const removeCleanup = registerProcess(process);

		this.resources.set(resourceId, {
			id: resourceId,
			type: "process",
			process,
			created: new Date(),
			lastAccessed: new Date(),
			cleanup: removeCleanup,
		});

		return resourceId;
	}

	/**
	 * Track in-memory data resource
	 */
	trackMemory(data: unknown, _description = ""): string {
		const resourceId = `memory-${Date.now()}-${generateSecureId()}`;

		// Estimate memory usage (rough approximation)
		let size = 0;
		try {
			size = JSON.stringify(data).length * 2; // UTF-16 bytes
		} catch {
			// Non-serializable values (e.g. circular refs, BigInt) are allowed; skip size estimate.
		}

		this.resources.set(resourceId, {
			id: resourceId,
			type: "memory",
			data,
			created: new Date(),
			lastAccessed: new Date(),
			size,
		});

		return resourceId;
	}

	/**
	 * Get tracked resource information
	 */
	getResource(resourceId: string): ResourceInfo | undefined {
		const resource = this.resources.get(resourceId);
		if (resource) {
			resource.lastAccessed = new Date();
		}
		return resource;
	}

	/**
	 * Remove a specific resource and trigger its cleanup
	 */
	async removeResource(resourceId: string): Promise<void> {
		const resource = this.resources.get(resourceId);
		if (!resource) {
			return;
		}

		try {
			if (resource.cleanup) {
				await resource.cleanup();
			}
			this.resources.delete(resourceId);
		} catch (error) {
			throw new ResourceError(`Failed to cleanup resource: ${resourceId}`, {
				resourceId,
				error: standardizeError(error),
			});
		}
	}

	/**
	 * Get resource statistics
	 */
	getStats(): ResourceStats {
		const resources = Array.from(this.resources.values());
		const filesTracked = resources.filter((r) => r.type === "file").length;
		const processesTracked = resources.filter((r) => r.type === "process").length;
		const tempDirectories = resources.filter((r) => r.type === "directory").length;
		const totalDiskUsage = resources
			.filter((r) => r.size)
			.reduce((sum, r) => sum + (r.size ?? 0), 0);
		const oldestResource =
			resources.length > 0
				? new Date(Math.min(...resources.map((r) => r.created.getTime())))
				: null;

		return {
			totalResources: resources.length,
			filesTracked,
			processesTracked,
			tempDirectories,
			totalDiskUsage,
			oldestResource,
		};
	}

	/**
	 * Clean up old or expired resources
	 */
	async cleanup(options: { maxAge?: number; force?: boolean } = {}): Promise<void> {
		const { maxAge = 30 * 60 * 1000, force = false } = options; // 30 minutes default
		const now = Date.now();
		const resourcesToRemove: string[] = [];

		for (const [id, resource] of this.resources) {
			const age = now - resource.created.getTime();

			if (force || age > maxAge) {
				resourcesToRemove.push(id);
			}
		}

		// Remove resources in parallel
		await Promise.allSettled(resourcesToRemove.map((id) => this.removeResource(id)));
	}

	/**
	 * Force cleanup of all resources
	 */
	async cleanupAll(): Promise<void> {
		const resourceIds = Array.from(this.resources.keys());
		await Promise.allSettled(resourceIds.map((id) => this.removeResource(id)));
	}

	/**
	 * Check memory usage and cleanup if necessary
	 */
	private checkMemoryUsage(): void {
		const stats = this.getStats();
		if (stats.totalDiskUsage > this.maxMemoryUsage) {
			// Clean up oldest resources first
			void this.cleanup({ maxAge: 10 * 60 * 1000 }).catch((err) => {
				console.error("Memory-triggered cleanup failed:", err);
			}); // 10 minutes
		}
	}

	/**
	 * Start periodic cleanup
	 */
	private startPeriodicCleanup(): void {
		this.intervalId = setInterval(() => {
			this.checkMemoryUsage();
			this.cleanup().catch((err) => {
				console.error("Cleanup failed:", err);
			});
		}, this.cleanupInterval);
	}

	/**
	 * Stop periodic cleanup
	 */
	stopPeriodicCleanup(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
	}

	/**
	 * Recursively remove a directory
	 */
	private removeDirectory(dirPath: string): void {
		try {
			rmSync(dirPath, { recursive: true, force: true });
		} catch (_error) {
			// Fallback for older Node.js versions
			try {
				const files = readdirSync(dirPath);
				for (const file of files) {
					const filePath = join(dirPath, file);
					const stats = statSync(filePath);
					if (stats.isDirectory()) {
						this.removeDirectory(filePath);
					} else {
						unlinkSync(filePath);
					}
				}
				rmdirSync(dirPath);
			} catch (_fallbackError) {
				// Fallback cleanup failed, ignore to prevent blocking
			}
		}
	}

	/**
	 * Get list of all tracked resources
	 */
	listResources(): ResourceInfo[] {
		return Array.from(this.resources.values());
	}

	/**
	 * Check if a resource exists and is accessible
	 */
	validateResource(resourceId: string): boolean {
		const resource = this.resources.get(resourceId);
		if (!resource) {
			return false;
		}

		switch (resource.type) {
			case "file":
				return resource.path ? existsSync(resource.path) : false;
			case "process":
				return resource.process ? Boolean(resource.process.pid) : false;
			case "directory":
				return resource.path ? existsSync(resource.path) : false;
			case "memory":
			case "temp":
				return true; // Always valid unless explicitly removed
			default:
				return false;
		}
	}
}

// Global instance for singleton usage
let globalResourceManager: ResourceManager | undefined;

/**
 * Get or create the global ResourceManager instance
 */
export function getResourceManager(): ResourceManager {
	if (!globalResourceManager) {
		globalResourceManager = new ResourceManager();
	}
	return globalResourceManager;
}

/**
 * Reset the global ResourceManager (useful for testing)
 */
export function resetResourceManager(): void {
	if (globalResourceManager) {
		globalResourceManager.stopPeriodicCleanup();
		globalResourceManager.cleanupAll().catch((err) => {
			console.error("Global cleanup failed:", err);
		});
		globalResourceManager = undefined;
	}
}
