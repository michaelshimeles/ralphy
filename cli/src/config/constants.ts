export const PROGRESS_UPDATE_INTERVAL = 500;
export const HEARTBEAT_INTERVAL = 5000;
// Default retry count used by CLI/runtime options.
export const DEFAULT_MAX_RETRIES = 3;
// Legacy alias retained for older modules.
export const MAX_RETRIES = DEFAULT_MAX_RETRIES;
export const UI_LABELS = {
	PLANNING: "[PLANNING]",
	EXECUTION: "[EXECUTION]",
	DONE: "[DONE]",
	FAIL: "[FAIL]",
	OK: "[OK]",
};
export const SPINNER_CHARS = ["|", "/", "-", "\\"];
export const MAX_EXECUTION_TIME = 300000; // 5 minutes
export const PROGRESS_POLL_INTERVAL = 2000;
export const WATCHER_DEBOUNCE = 250;
export const PLANNING_COOLDOWN = 2000;

// CLI Defaults
export const DEFAULT_RETRY_DELAY = 5;
export const DEFAULT_MAX_PARALLEL = 3;
export const DEFAULT_MAX_REPLANS = 3;
export const DEFAULT_MAX_ITERATIONS = 0;

// AI Engine Defaults
export const DEFAULT_AI_ENGINE_TIMEOUT_MS = 80 * 60 * 1000; // 80 minutes
export const STREAM_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds without output = potential hang

// Parallel Execution
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const INITIAL_POOL_SIZE_MULTIPLIER = 1;
export const MAX_POOL_SIZE_MULTIPLIER = 5;
export const PLANNING_CONCURRENCY = 5;
export const POOL_INCREMENT = 2;

// Progress Monitoring
export const MAX_OPERATIONS_HISTORY = 10;
export const RECENT_ACTIONS_COUNT = 3;
export const FIND_WORKTREE_RETRIES = 20;
export const MAX_DISPLAYED_ACTIONS = 3;

// Sandbox Management
export const DEFAULT_MAX_SANDBOX_AGE_MS = 60 * 60 * 1000; // 1 hour
export const SANDBOX_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SANDBOX_BACKGROUND_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes
export const MS_PER_MINUTE = 60000;
export const CLEANUP_DELAY_MS = 5000;
export const COPY_BACK_CONCURRENCY = 10;
export const SANDBOX_DIR_PREFIX = "agent-";
export const SANDBOX_SUFFIX = "";
export const DEFAULT_IGNORE_PATTERNS = [
	".git",
	"node_modules",
	".ralphy-sandboxes",
	".ralphy-worktrees",
	".ralphy",
	"agent-*",
	"sandbox-*",
];

// File Utilities
export const MAX_FILE_SIZE_FOR_HASH = 2 * 1024 * 1024; // 2MB
export const DEFAULT_RECURSION_DEPTH = 5;

// Lock Management
export const LOCK_TIMEOUT_MS = 30000; // 30 seconds
export const LOCK_MAX_LOCKS = 5000; // Maximum number of locks
export const LOCK_DIR = ".ralphy/locks"; // Lock directory
export const LOCK_CLEANUP_INTERVAL_MS = 60000; // 1 minute between cleanups

// Path Constants
export const SANDBOX_DIR = ".ralphy-worktrees";
export const PLANNING_CACHE_FILE = "planning-cache.json";

// Hash Store Constants
export const HASH_STORE_DIR = ".ralphy-hashes";
export const HASH_STORE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const HASH_REFERENCE_SUFFIX = ".hash-ref";
export const ENABLE_HASH_STORE = true; // Feature flag
