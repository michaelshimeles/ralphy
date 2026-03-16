# Ralphy

[![npm version](https://img.shields.io/npm/v/ralphy-cli.svg)](https://www.npmjs.com/package/ralphy-cli)

**[Join our Discord](https://discord.gg/SZZV74mCuV)** - Questions? Want to contribute? Join the community!

![Ralphy](assets/ralphy.jpeg)

Autonomous AI coding loop. Runs AI agents on tasks until done.

## Install

**Option A: [npm](https://www.npmjs.com/package/ralphy-cli)** (recommended)
```bash
npm install -g ralphy-cli

# Then use anywhere
ralphy "add login button"
ralphy --prd PRD.md
```

**Option B: Clone**
```bash
git clone https://github.com/michaelshimeles/ralphy.git
cd ralphy && chmod +x ralphy.sh

./ralphy.sh "add login button"
./ralphy.sh --prd PRD.md
```

Examples below use `ralphy` (npm). Most commands also work with `./ralphy.sh`, but newer npm CLI features may land there first.

## Two Modes

**Single task** - just tell it what to do:
```bash
ralphy "add dark mode"
ralphy "fix the auth bug"
ralphy --repeat 3 "find and fix bugs"
ralphy --repeat 5 --continue-on-failure "harden edge cases"
```

**Task list** - work through a PRD:
```bash
ralphy              # uses PRD.md
ralphy --prd tasks.md
```

## Project Config

Optional. Stores rules the AI must follow.

```bash
ralphy --init              # auto-detects project settings
ralphy --config            # view config
ralphy --add-rule "use TypeScript strict mode"
```

Creates `.ralphy/config.yaml`:
```yaml
project:
  name: "my-app"
  language: "TypeScript"
  framework: "Next.js"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "use server actions not API routes"
  - "follow error pattern in src/utils/errors.ts"

boundaries:
  never_touch:
    - "src/legacy/**"
    - "*.lock"
```

Rules apply to all tasks (single or PRD).

## AI Engines

```bash
ralphy              # Claude Code (default)
ralphy --opencode   # OpenCode
ralphy --cursor     # Cursor
ralphy --codex      # Codex
ralphy --qwen       # Qwen-Code
ralphy --droid      # Factory Droid
ralphy --copilot    # GitHub Copilot
ralphy --gemini     # Gemini CLI
```

### Model Override

Override the default model for any engine:

```bash
ralphy --model sonnet "add feature"                    # use sonnet with Claude
ralphy --sonnet "add feature"                          # shortcut for above
ralphy --opencode --model opencode/glm-4.7-free "task" # custom OpenCode model
ralphy --qwen --model qwen-max "build api"             # custom Qwen model
```

### Engine-Specific Arguments

Pass additional arguments to the underlying engine CLI using `--` separator:

```bash
# Pass copilot-specific arguments
ralphy --copilot --model "claude-opus-4.5" --prd PRD.md -- --allow-all-tools --allow-all-urls --stream on

# Pass claude-specific arguments  
ralphy --claude "add feature" -- --no-permissions-prompt

# Works with any engine
ralphy --cursor "fix bug" -- --custom-arg value
```

Everything after `--` is passed directly to the engine CLI without interpretation.

## Task Sources

**Markdown file** (default):
```bash
ralphy --prd PRD.md
```
```markdown
## Tasks
- [ ] create auth
- [ ] add dashboard
- [x] done task (skipped)
```

**Markdown folder** (for large projects):
```bash
ralphy --prd ./prd/
```
When pointing to a folder, Ralphy reads all `.md` files and aggregates tasks:
```
prd/
  backend.md      # - [ ] create user API
  frontend.md     # - [ ] add login page
  infra.md        # - [ ] setup CI/CD
```
Tasks are tracked per-file so completion updates the correct file.

**YAML**:
```bash
ralphy --yaml tasks.yaml
```
```yaml
tasks:
  - title: create auth
    completed: false
  - title: add dashboard
    completed: false
```

**JSON**:
```bash
ralphy --json PRD.json
```
```json
{
  "tasks": [
    {
      "title": "create auth",
      "completed": false,
      "parallel_group": 1,
      "description": "Optional details"
    }
  ]
}
```
Titles must be unique.

**GitHub Issues**:
```bash
ralphy --github owner/repo
ralphy --github owner/repo --github-label "ready"
```

## Parallel Execution

```bash
ralphy --parallel                  # 3 agents default
ralphy --parallel --max-parallel 5 # 5 agents
```

Each agent gets isolated worktree + branch:
```
Agent 1 → /tmp/xxx/agent-1 → ralphy/agent-1-create-auth
Agent 2 → /tmp/xxx/agent-2 → ralphy/agent-2-add-dashboard
Agent 3 → /tmp/xxx/agent-3 → ralphy/agent-3-build-api
```

Without `--create-pr`: auto-merges back to base branch, AI resolves conflicts.
With `--create-pr`: keeps branches, creates PRs.
With `--no-merge`: keeps branches without merging or creating PRs.

**YAML parallel groups** - control execution order:
```yaml
tasks:
  - title: Create User model
    parallel_group: 1
  - title: Create Post model
    parallel_group: 1  # same group = runs together
  - title: Add relationships
    parallel_group: 2  # runs after group 1
```

## Branch Workflow

```bash
ralphy --branch-per-task                # branch per task
ralphy --branch-per-task --create-pr    # + create PRs
ralphy --branch-per-task --draft-pr     # + draft PRs
ralphy --base-branch main               # branch from main
```

Branch naming: `ralphy/<task-slug>`

## Browser Automation

Ralphy can use [agent-browser](https://agent-browser.dev) to automate browser interactions during tasks.

```bash
ralphy "test the login flow" --browser    # force enable
ralphy "add checkout" --no-browser        # force disable
ralphy "build feature"                    # auto-detect (default)
```

When enabled, the AI gets browser commands:
- `agent-browser open <url>` - navigate to URL
- `agent-browser snapshot` - get element refs (@e1, @e2)
- `agent-browser click @e1` - click element
- `agent-browser type @e1 "text"` - type into input
- `agent-browser screenshot <file>` - capture screenshot

**Use cases:**
- Testing UI after implementing features
- Verifying deployments
- Form filling and workflow testing

**Config** (`.ralphy/config.yaml`):
```yaml
capabilities:
  browser: "auto"  # "auto", "true", or "false"
```

## Webhook Notifications

Get notified when sessions complete via Discord, Slack, or custom webhooks.

**Config** (`.ralphy/config.yaml`):
```yaml
notifications:
  discord_webhook: "https://discord.com/api/webhooks/..."
  slack_webhook: "https://hooks.slack.com/services/..."
  custom_webhook: "https://your-api.com/webhook"
```

Notifications include task completion counts and status (completed/failed).

## Sandbox Mode

For large repos with big dependency directories, sandbox mode is faster than git worktrees:

```bash
ralphy --parallel --sandbox
```

**How it works:**
- **Symlinks** read-only dependencies (`node_modules`, `.git`, `vendor`, `.venv`, `.pnpm-store`, `.yarn`, `.cache`)
- **Copies** source files that agents might modify (`src/`, `app/`, `lib/`, config files, etc.)

**Why use it:**
- Avoids duplicating gigabytes of `node_modules` across worktrees
- Much faster sandbox creation for large monorepos
- Changes sync back to original directory after each task

**When to use worktrees instead (default):**
- Need full git history access in each sandbox
- Running `git` commands that require a real repo
- Smaller repos where worktree overhead is minimal

**Parallel execution reliability:**
- If worktree operations fail (e.g., nested worktree repos), ralphy falls back to sandbox mode automatically
- Retryable rate-limit or quota errors are detected and deferred for later retry
- Local changes are stashed before the merge phase and restored after
- Agents should not modify PRD files, `.ralphy/progress.txt`, `.ralphy-worktrees`, or `.ralphy-sandboxes`

## Options

| Flag | What it does |
|------|--------------|
| `--prd PATH` | task file or folder (auto-detected, default: PRD.md) |
| `--yaml FILE` | YAML task file |
| `--json FILE` | JSON task file |
| `--github REPO` | use GitHub issues |
| `--github-label TAG` | filter issues by label |
| `--sync-issue N` | sync PRD progress to GitHub issue #N |
| `--model NAME` | override model for any engine |
| `--sonnet` | shortcut for `--claude --model sonnet` |
| `--parallel` | run parallel |
| `--max-parallel N` | max agents (default: 3) |
| `--sandbox` | use lightweight sandboxes instead of git worktrees |
| `--no-merge` | skip auto-merge in parallel mode |
| `--branch-per-task` | branch per task |
| `--base-branch NAME` | base branch |
| `--create-pr` | create PRs |
| `--draft-pr` | draft PRs |
| `--no-tests` | skip tests |
| `--no-lint` | skip lint |
| `--fast` | skip tests + lint |
| `--no-commit` | don't auto-commit |
| `--max-iterations N` | stop after N tasks |
| `--max-retries N` | retries per task (default: 3) |
| `--retry-delay N` | seconds between retries |
| `--dry-run` | preview only |
| `--repeat N` | repeat a single task N times (requires task argument) |
| `--continue-on-failure` | in repeat mode, continue after non-fatal task failures |
| `--browser` | enable browser automation |
| `--no-browser` | disable browser automation |
| `-v, --verbose` | debug output |
| `--init` | setup .ralphy/ config |
| `--config` | show config |
| `--add-rule "rule"` | add rule to config |

## Requirements

**Required:**
- AI CLI: [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://opencode.ai/docs/), [Cursor](https://cursor.com), Codex, Qwen-Code, [Factory Droid](https://docs.factory.ai/cli/getting-started/quickstart), [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

**npm version (`ralphy-cli`):**
- Node.js 18+ or Bun

**Bash version (`ralphy.sh`):**
- `jq`
- `yq` (optional, for YAML tasks)
- `bc` (optional, for cost calc)

**Both versions:**
- `gh` (optional, for GitHub issues / `--create-pr`)
- [agent-browser](https://agent-browser.dev) (optional, for `--browser`)

## Engine Details

| Engine | CLI | Permissions | Output |
|--------|-----|-------------|--------|
| Claude | `claude` | `--dangerously-skip-permissions` | tokens + cost |
| OpenCode | `opencode` | `full-auto` | tokens + cost |
| Codex | `codex` | N/A | tokens |
| Cursor | `agent` | `--force` | duration |
| Qwen | `qwen` | `--approval-mode yolo` | tokens |
| Droid | `droid exec` | `--auto medium` | duration |
| Copilot | `copilot` | `--yolo` | tokens |
| Gemini | `gemini` | `--yolo` | tokens + cost |

When an engine exits non-zero, ralphy includes the last lines of CLI output in the error message to make debugging easier.

---

## Changelog

### v4.7.2
- **Single-task repeat mode**: added `--repeat <n>` with `--continue-on-failure` and fail-fast defaults; fatal errors still abort immediately
- **Improved auth error detection**: simplified `extractAuthenticationError` function with better edge case handling (e.g., JSON dumps during login)
- **Added project standards**: `CLAUDE.md`, `.cursorrules`, `CONTRIBUTING.md` for consistent AI-assisted development
- **Enhanced default prompts**: enforce concise, focused code changes

### v4.7.1
- **Copilot engine improvements**: non-interactive mode (`--yolo`), proper error detection for auth/rate-limit/network errors, token usage parsing, temp file-based prompts for markdown preservation
- **Fixed infinite retry loop**: tasks now properly abort on fatal configuration/authentication errors
- **Project standards**: added `.editorconfig` and `.gitattributes` for consistent coding styles

### v4.7.0
- **JSON PRD support**: new `--json` flag to use JSON files as task sources with support for parallel groups and task descriptions

### v4.6.0
- **Gemini CLI support**: new `--gemini` engine option for Google Gemini CLI
- **GitHub issue sync**: `--sync-issue <number>` syncs PRD progress to a GitHub issue after each task
- **performance improvements**: reduced redundant file reads, exponential backoff for retries, non-blocking logging, operation timing visibility
- **version fix**: CLI version now reads dynamically from package.json

### v4.5.3
- parallel reliability: fallback to sandbox mode on worktree errors
- error output: include CLI output snippet for failed engine commands
- retry handling: detect rate-limit/quota errors and stop early
- merge safety: stash local changes before merge phase and restore after
- prompts: explicitly avoid PRD and `.ralphy` progress/sandbox/worktree edits

### v4.5.0
- **sandbox mode**: lightweight isolation using symlinks for dependencies (faster than worktrees)
- **performance improvements**: task caching, parallel merge analysis, smart branch ordering
- **webhook notifications**: Discord, Slack, and custom webhooks for session completion (configure in `.ralphy/config.yaml`)
- **engine-specific arguments**: pass arguments to underlying CLI via `--` separator
- **Windows improvements**: better error handling for .cmd wrappers

### v4.4.1
- Windows line ending handling fixes
- Windows Bun command resolution fixes

### v4.4.0
- GitHub Copilot CLI support (`--copilot`)

### v4.3.0
- model override: `--model <name>` flag to override model for any engine
- `--sonnet` shortcut for `--claude --model sonnet`
- `--no-merge` flag to skip auto-merge in parallel mode
- AI-assisted merge conflict resolution during parallel auto-merge
- root user detection: error for Claude/Cursor, warning for other engines
- improved OpenCode error handling and model override support

### v4.2.0
- browser automation: `--browser` / `--no-browser` with [agent-browser](https://agent-browser.dev)
- auto-detects agent-browser when available
- config option: `capabilities.browser` in `.ralphy/config.yaml`

### v4.1.0
- TypeScript CLI: `npm install -g ralphy-cli`
- cross-platform binaries (macOS, Linux, Windows)
- no dependencies on jq/yq/bc for npm version

### v4.0.0
- single-task mode: `ralphy "task"` without PRD
- project config: `--init` creates `.ralphy/` with rules + auto-detection
- new: `--config`, `--add-rule`, `--no-commit`

### v3.3.0
- Factory Droid support (`--droid`)

### v3.2.0
- Qwen-Code support (`--qwen`)

### v3.1.0
- Cursor support (`--cursor`)
- better task verification

### v3.0.0
- parallel execution with worktrees
- branch-per-task + auto-PR
- YAML + GitHub Issues sources
- parallel groups

### v2.0.0
- OpenCode support
- retry logic
- `--max-iterations`, `--dry-run`

### v1.0.0
- initial release

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

**Key principles:**
- Keep changes small and focused - one logical change per commit
- Break large tasks into micro-tasks
- Quality over speed
- Don't leave dead code
- Fight entropy - leave the codebase better than you found it

AI coding assistants can reference:
- [CLAUDE.md](CLAUDE.md) - Claude Code instructions
- [.cursorrules](.cursorrules) - Cursor IDE rules

## Community

- [Discord](https://rasmic.link/discord)

## License

MIT
