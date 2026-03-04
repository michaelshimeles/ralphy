# Ralphy

[![npm version](https://img.shields.io/npm/v/ralphy-cli.svg)](https://www.npmjs.com/package/ralphy-cli)

**[Join our Discord](https://discord.gg/SZZV74mCuV)** - Questions? Want to contribute? Join the community!

![Ralphy](https://raw.githubusercontent.com/michaelshimeles/ralphy/main/assets/ralphy.jpeg)

Autonomous AI coding loop. Runs AI agents on tasks until done.

## Install

```bash
npm install -g ralphy-cli

# Then use anywhere
ralphy "add login button"
ralphy --prd PRD.md
```

## Two Modes

**Single task** - just tell it what to do:
```bash
ralphy "add dark mode"
ralphy "fix the auth bug"
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
  telemetry_webhook: "https://your-api.com/telemetry"  # optional
```

Notifications include task completion counts and status (completed/failed).

Webhook safety:
- Only `https://` webhook URLs are accepted.
- Localhost/private IP targets are blocked, including DNS-resolved internal addresses.
- URL credentials are rejected.

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

## Links

- [GitHub](https://github.com/michaelshimeles/ralphy)
- [Discord](https://discord.gg/SZZV74mCuV)
- [Full documentation](https://github.com/michaelshimeles/ralphy#readme)

## License

MIT
