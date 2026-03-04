import { randomBytes } from "node:crypto";
import type { AIResult } from "../engines/types.ts";
import type { Task } from "../tasks/types.ts";
import { logDebugContext, logErrorContext } from "../ui/logger.ts";

/**
 * Hook system for Ralphy CLI lifecycle events
 *
 * Provides a plugin-like mechanism for extending functionality
 * without modifying core code. Supports:
 * - Task lifecycle hooks (start, complete, fail)
 * - Execution hooks (before, after)
 * - Engine hooks (pre-execute, post-execute)
 * - Custom hooks for user-defined extensions
 */

/**
 * Hook context passed to all hook handlers
 */
export interface HookContext {
	timestamp: number;
	[key: string]: unknown;
}

/**
 * Task start hook context
 */
export interface TaskStartContext extends HookContext {
	task: Task;
	workDir: string;
	engine: string;
}

/**
 * Task complete hook context
 */
export interface TaskCompleteContext extends HookContext {
	task: Task;
	result: AIResult;
	workDir: string;
	durationMs: number;
}

/**
 * Task fail hook context
 */
export interface TaskFailContext extends HookContext {
	task: Task;
	error: Error | string;
	workDir: string;
	attempt: number;
	maxAttempts: number;
}

/**
 * Engine execute hook context
 */
export interface EngineExecuteContext extends HookContext {
	engine: string;
	prompt: string;
	workDir: string;
	options?: Record<string, unknown>;
}

/**
 * Engine result hook context
 */
export interface EngineResultContext extends HookContext {
	engine: string;
	result: AIResult;
	durationMs: number;
}

/**
 * Hook handler type
 */
export type HookHandler<T extends HookContext> = (context: T) => Promise<void> | void;

/**
 * Available hook names
 */
export type HookName =
	| "task:start"
	| "task:complete"
	| "task:fail"
	| "task:skip"
	| "engine:pre-execute"
	| "engine:post-execute"
	| "queue:enqueue"
	| "queue:dequeue"
	| "config:load"
	| "config:save"
	| "git:pre-commit"
	| "git:post-commit"
	| "notification:send";

/**
 * Hook registry entry
 */
interface HookEntry<T extends HookContext> {
	name: string;
	handler: HookHandler<T>;
	priority: number;
}

/**
 * Hook manager
 */
export class HookManager {
	private hooks: Map<HookName, HookEntry<HookContext>[]> = new Map();
	private enabled: boolean = true;

	/**
	 * Register a hook handler
	 */
	register<T extends HookContext>(
		hookName: HookName,
		handler: HookHandler<T>,
		options?: { priority?: number; name?: string },
	): () => void {
		const entry: HookEntry<HookContext> = {
			name: options?.name || `hook-${Date.now()}-${randomBytes(9).toString("base64url").slice(0, 12)}`,
			handler: handler as HookHandler<HookContext>,
			priority: options?.priority ?? 0,
		};

		const existing = this.hooks.get(hookName) || [];
		existing.push(entry);

		// Sort by priority (higher first)
		existing.sort((a, b) => b.priority - a.priority);

		this.hooks.set(hookName, existing);

		logDebugContext("Hooks", `Registered hook: ${hookName} (${entry.name})`);

		// Return unregister function
		return () => {
			const hooks = this.hooks.get(hookName) || [];
			const index = hooks.findIndex((h) => h.name === entry.name);
			if (index !== -1) {
				hooks.splice(index, 1);
				logDebugContext("Hooks", `Unregistered hook: ${hookName} (${entry.name})`);
			}
		};
	}

	/**
	 * Execute all handlers for a hook
	 */
	async execute<T extends HookContext>(name: HookName, context: T): Promise<void> {
		if (!this.enabled) {
			return;
		}

		const hooks = this.hooks.get(name) || [];
		if (hooks.length === 0) {
			return;
		}

		logDebugContext("Hooks", `Executing ${hooks.length} hooks for: ${name}`);

		for (const hook of hooks) {
			try {
				const result = hook.handler(context);
				// Ensure we await async handlers
				if (result instanceof Promise) {
					await result;
				}
			} catch (error) {
				logErrorContext("Hooks", `Hook ${hook.name} failed for ${name}: ${error}`);
				// Continue with other hooks even if one fails
			}
		}
	}

	/**
	 * Check if any hooks are registered for a name
	 */
	hasHooks(name: HookName): boolean {
		const hooks = this.hooks.get(name);
		return hooks !== undefined && hooks.length > 0;
	}

	/**
	 * Get number of registered hooks for a name
	 */
	getHookCount(name: HookName): number {
		return this.hooks.get(name)?.length || 0;
	}

	/**
	 * Enable/disable all hooks
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		logDebugContext("Hooks", `Hooks ${enabled ? "enabled" : "disabled"}`);
	}

	/**
	 * Clear all hooks
	 */
	clear(): void {
		this.hooks.clear();
		logDebugContext("Hooks", "All hooks cleared");
	}

	/**
	 * Get all registered hook names
	 */
	getRegisteredHooks(): HookName[] {
		return Array.from(this.hooks.keys());
	}
}

/**
 * Global hook manager instance
 */
let globalHookManager: HookManager = new HookManager();

/**
 * Set global hook manager
 */
export function setHookManager(manager: HookManager): void {
	globalHookManager = manager;
}

/**
 * Get global hook manager
 */
export function getHookManager(): HookManager {
	return globalHookManager;
}

/**
 * Register a hook (convenience function)
 */
export function registerHook<T extends HookContext>(
	name: HookName,
	handler: HookHandler<T>,
	options?: { priority?: number; name?: string },
): () => void {
	return globalHookManager.register(name, handler, options);
}

/**
 * Execute hooks (convenience function)
 */
export async function executeHooks<T extends HookContext>(name: HookName, context: T): Promise<void> {
	return globalHookManager.execute(name, context);
}

/**
 * Create a plugin interface
 */
export interface RalphyPlugin {
	/**
	 * Plugin name
	 */
	name: string;

	/**
	 * Plugin version
	 */
	version: string;

	/**
	 * Initialize plugin - called when plugin is registered
	 */
	initialize?(): Promise<void> | void;

	/**
	 * Register hooks - called during plugin registration
	 */
	registerHooks(hookManager: HookManager): void;

	/**
	 * Shutdown plugin - called when plugin is unregistered
	 */
	shutdown?(): Promise<void> | void;
}

/**
 * Plugin manager
 */
export class PluginManager {
	private plugins: Map<string, RalphyPlugin> = new Map();
	private hookManager: HookManager;

	constructor(hookManager: HookManager) {
		this.hookManager = hookManager;
	}

	/**
	 * Register a plugin
	 */
	async register(plugin: RalphyPlugin): Promise<void> {
		if (this.plugins.has(plugin.name)) {
			throw new Error(`Plugin ${plugin.name} is already registered`);
		}

		// Initialize plugin with proper error handling
		if (plugin.initialize) {
			try {
				await plugin.initialize();
			} catch (error) {
				logErrorContext("Plugins", `Plugin ${plugin.name} initialization failed: ${error}`);
				throw error; // Re-throw to prevent registration of failed plugin
			}
		}

		// Register hooks with error handling
		try {
			plugin.registerHooks(this.hookManager);
		} catch (error) {
			logErrorContext("Plugins", `Plugin ${plugin.name} hook registration failed: ${error}`);
			throw error;
		}

		// Store plugin
		this.plugins.set(plugin.name, plugin);

		logDebugContext("Plugins", `Registered plugin: ${plugin.name} v${plugin.version}`);
	}

	/**
	 * Unregister a plugin
	 */
	async unregister(pluginName: string): Promise<void> {
		const plugin = this.plugins.get(pluginName);
		if (!plugin) {
			throw new Error(`Plugin ${pluginName} is not registered`);
		}

		// Shutdown plugin
		if (plugin.shutdown) {
			await plugin.shutdown();
		}

		this.plugins.delete(pluginName);

		logDebugContext("Plugins", `Unregistered plugin: ${pluginName}`);
	}

	/**
	 * Get registered plugin
	 */
	getPlugin(name: string): RalphyPlugin | undefined {
		return this.plugins.get(name);
	}

	/**
	 * Get all registered plugins
	 */
	getAllPlugins(): RalphyPlugin[] {
		return Array.from(this.plugins.values());
	}

	/**
	 * Check if plugin is registered
	 */
	hasPlugin(name: string): boolean {
		return this.plugins.has(name);
	}
}

// HookManager is already exported above
