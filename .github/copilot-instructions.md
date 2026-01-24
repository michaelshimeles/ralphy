# Ralphy AI Coding Assistant - Copilot Instructions

## Project Overview

Ralphy is an autonomous AI coding loop that orchestrates multiple AI agents (Claude Code, OpenCode, Cursor, Codex, Qwen, Droid, Copilot) to execute tasks from PRDs. Built with Bun/TypeScript, it's a monorepo with a CLI package (`cli/`) and Next.js landing page (`landing/`).

## Architecture

### Core Components

- **CLI Entry** ([cli/src/index.ts](cli/src/index.ts)): Parses args → dispatches to config/init/single-task/PRD-loop modes
- **Engines** ([cli/src/engines/](cli/src/engines/)): Pluggable AI backends extending `BaseAIEngine`. Each engine wraps an external CLI (claude, opencode, cursor, etc.) and parses its output format
- **Task Sources** ([cli/src/tasks/](cli/src/tasks/)): Markdown (single file), Markdown folders (multi-file), YAML, GitHub issues. All implement `TaskSource` interface with `getAllTasks()`, `getNextTask()`, `markComplete()`
- **Execution Modes**:
  - **Sequential** ([cli/src/execution/sequential.ts](cli/src/execution/sequential.ts)): One task at a time in main directory
  - **Parallel** ([cli/src/execution/parallel.ts](cli/src/execution/parallel.ts)): Multiple agents via git worktrees OR sandboxes
- **Sandboxes** ([cli/src/execution/sandbox.ts](cli/src/execution/sandbox.ts)): Lightweight isolation using symlinks (node_modules, .git) + selective copying (src, configs) - faster than worktrees for large repos
- **Git Integration** ([cli/src/git/](cli/src/git/)): Worktree management, branch creation, PR creation, conflict resolution via AI

### Data Flow (PRD Loop)

1. Load `.ralphy/config.yaml` (rules, boundaries, commands) via [cli/src/config/loader.ts](cli/src/config/loader.ts)
2. Create `CachedTaskSource` wrapping markdown/yaml/github source
3. Execute tasks sequentially OR in parallel:
   - **Sequential**: Run task → mark complete in PRD file → repeat
   - **Parallel**: Create worktrees/sandboxes → run agents concurrently → merge branches back → resolve conflicts with AI
4. Track progress in `.ralphy/progress.txt`, write task completions atomically via [cli/src/config/writer.ts](cli/src/config/writer.ts)

## Development Patterns

### Engine Implementation

All engines extend `BaseAIEngine` and implement:
```typescript
async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult>
async executeStreaming(prompt: string, workDir: string, onProgress?: ProgressCallback, options?: EngineOptions): Promise<AIResult>
```

Windows compatibility: Use `stdinContent` parameter in `execCommand()` for multi-line prompts to avoid cmd.exe parsing issues. See [claude.ts#L31-36](cli/src/engines/claude.ts#L31-L36).

### Task Source Pattern

Implement `TaskSource` interface. Key methods:
- `getAllTasks()`: Load all tasks once (for parallel mode)
- `getNextTask()`: Get first incomplete task (for sequential mode)
- `markComplete(id: string)`: Atomically update source file

Use `CachedTaskSource` wrapper to batch file writes and reduce I/O. See [cli/src/tasks/cached-task-source.ts](cli/src/tasks/cached-task-source.ts).

### Parallel Execution

Two isolation modes:
1. **Git worktrees** ([cli/src/git/worktree.ts](cli/src/git/worktree.ts)): Full git isolation, branch per agent. Use atomic `-B` flag to avoid race conditions.
2. **Sandboxes** ([cli/src/execution/sandbox.ts](cli/src/execution/sandbox.ts)): Symlink immutable dirs (node_modules, .git), copy source dirs (src, lib, configs). 10-50x faster for large repos.

Post-execution: Merge branches back to base with intelligent conflict resolution via AI ([cli/src/execution/conflict-resolution.ts](cli/src/execution/conflict-resolution.ts)).

### Prompt Engineering

Build prompts in [cli/src/execution/prompt.ts](cli/src/execution/prompt.ts):
- Include `.ralphy/config.yaml` rules/boundaries
- Reference `.ralphy/progress.txt` for iteration tracking
- For parallel mode: minimize context to avoid overlap between agents
- Pass extra commands (test, lint, build) from config

### Configuration System

Uses Zod schemas ([cli/src/config/types.ts](cli/src/config/types.ts)) for validation. Config auto-detected via [cli/src/config/detector.ts](cli/src/config/detector.ts) which inspects package.json, lock files, and project structure.

## Developer Workflows

### Local Development
```bash
cd cli
bun run dev                    # Run CLI directly
bun run check                  # Biome format + lint
```

### Building CLI
```bash
bun run build:all              # Cross-compile for all platforms
# Creates binaries: dist/ralphy-{darwin,linux,windows}-{x64,arm64}
```

### Testing Changes
No formal test suite - test manually:
```bash
bun run dev "add feature"                  # Single task
bun run dev --prd example-prd.md          # Sequential PRD
bun run dev --prd example-prd.yaml --parallel  # Parallel mode
```

### Landing Page
```bash
cd landing
npm run dev                    # Next.js 16 + React 19 + Tailwind CSS 4
```

## Critical Conventions

- **Use Bun APIs** when available (faster than Node.js equivalents). Fallback to Node.js for compatibility. See `isBun` checks in [cli/src/engines/base.ts](cli/src/engines/base.ts).
- **Windows Compatibility**: Always test shell operations. Use `cmd.exe /c` wrapper for npm global commands. Encode multi-line content via stdin not args.
- **Atomic Operations**: Use `flushAllProgressWrites()` on exit ([cli/src/config/writer.ts](cli/src/config/writer.ts)). Git operations use `-B` flags to avoid race conditions.
- **Error Messages**: Use colored UI helpers from [cli/src/ui/logger.ts](cli/src/ui/logger.ts). Extract actionable errors from AI engine output via `checkForErrors()`.
- **Idempotency**: Sandbox/worktree cleanup must handle partial states from crashed agents.

## Integration Points

- **AI CLIs**: Spawn external processes (claude, opencode, cursor, etc.). Parse stdout/stderr for tokens/responses.
- **Git**: Use `simple-git` library for all operations. Never shell out to `git` directly.
- **GitHub**: Octokit REST API for PR creation, issue management. See [cli/src/git/pr.ts](cli/src/git/pr.ts) and [cli/src/tasks/github.ts](cli/src/tasks/github.ts).
- **Notifications**: Discord/Slack webhooks after task completion ([cli/src/notifications/webhook.ts](cli/src/notifications/webhook.ts)).
- **Browser**: Optional `agent-browser` integration for AI web automation ([cli/src/execution/browser.ts](cli/src/execution/browser.ts)).

## Package Management

- **CLI**: Bun for dev, cross-compile to standalone binaries for npm distribution
- **Landing**: npm/pnpm (Next.js ecosystem standard)
- **Linting/Formatting**: Biome (not Prettier/ESLint) configured in [cli/biome.json](cli/biome.json)

## Important Files

- [cli/src/cli/args.ts](cli/src/cli/args.ts): Commander.js arg parsing with `--` separator for engine-specific args
- [example-prd.yaml](example-prd.yaml): Shows `parallel_group` field for concurrent task execution
- [cli/src/execution/conflict-resolution.ts](cli/src/execution/conflict-resolution.ts): AI-powered merge conflict resolution
- [cli/src/execution/retry.ts](cli/src/execution/retry.ts): Exponential backoff with retryable error detection

## Avoiding Common Pitfalls

- **Don't** use git worktrees if `.git` is a file/symlink (nested worktree). Check via `canUseWorktrees()`.
- **Don't** assume Unix shell. Windows uses cmd.exe with different escaping rules.
- **Don't** write to PRD files directly. Use `TaskSource.markComplete()` for atomic updates.
- **Don't** forget to copy PRD files into worktrees/sandboxes - agents run in isolated directories.
