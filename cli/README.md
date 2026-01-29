# Ralphy

Autonomous AI coding loop. Runs AI agents on tasks until done.

## Install

```bash
npm install -g ralphy-cli
```

## Quick Start

```bash
# Single task
ralphy "add login button"

# Work through a task list
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

## AI Engines

```bash
ralphy              # Claude Code (default)
ralphy --opencode   # OpenCode
ralphy --cursor     # Cursor
ralphy --codex      # Codex
ralphy --qwen       # Qwen-Code
ralphy --droid      # Factory Droid
ralphy --copilot    # GitHub Copilot
```

### Model Override

```bash
ralphy --model sonnet "add feature"    # use sonnet with Claude
ralphy --sonnet "add feature"          # shortcut for above
ralphy --opencode --model opencode/glm-4.7-free "task"
```

### Engine-Specific Arguments

Pass additional arguments to the underlying engine CLI using `--` separator:

```bash
ralphy --copilot "add feature" -- --allow-all-tools --stream on
ralphy --claude "fix bug" -- --no-permissions-prompt
```

## Task Sources

**Markdown file** (default):
```bash
ralphy --prd PRD.md
```

**Markdown folder** (for large projects):
```bash
ralphy --prd ./prd/
```
Reads all `.md` files in the folder and aggregates tasks.

**YAML**:
```bash
ralphy --yaml tasks.yaml
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

Each agent gets isolated worktree + branch. Without `--create-pr`: auto-merges back with AI conflict resolution. With `--create-pr`: keeps branches, creates PRs. With `--no-merge`: keeps branches without merging.

### Sandbox Mode and Parallel Reliability

For large repos with big `node_modules` or dependency directories, use sandbox mode instead of git worktrees:

```bash
ralphy --parallel --sandbox
```

Sandboxes are faster because they:
- **Symlink** read-only dependencies (`node_modules`, `.git`, `vendor`, `.venv`, etc.)
- **Copy** only source files that agents might modify

This avoids duplicating gigabytes of dependencies across worktrees. Changes are synced back to the original directory after each task completes.

**Parallel execution reliability:**
- If worktree operations fail (e.g., nested worktree repos), ralphy falls back to sandbox mode automatically
- Retryable rate-limit or quota errors are detected and deferred for later retry
- Local changes are stashed before the merge phase and restored after
- Agents should not modify PRD files, `.ralphy/progress.txt`, `.ralphy-worktrees`, or `.ralphy-sandboxes`

## Branch Workflow

```bash
ralphy --branch-per-task                # branch per task
ralphy --branch-per-task --create-pr    # + create PRs
ralphy --branch-per-task --draft-pr     # + draft PRs
```

## Browser Automation

Ralphy supports browser automation via [agent-browser](https://agent-browser.dev) for testing web UIs.

```bash
ralphy "add login form" --browser    # enable browser automation
ralphy "fix checkout" --no-browser   # disable browser automation
```

When enabled (and agent-browser is installed), the AI can:
- Open URLs and navigate pages
- Click elements and fill forms
- Take screenshots for verification
- Test web UI changes after implementation

## Options

| Flag | What it does |
|------|--------------|
| `--prd PATH` | task file or folder (auto-detected, default: PRD.md) |
| `--yaml FILE` | YAML task file |
| `--json FILE` | JSON task file |
| `--github REPO` | use GitHub issues |
| `--github-label TAG` | filter issues by label |
| `--model NAME` | override model for any engine |
| `--sonnet` | shortcut for `--claude --model sonnet` |
| `--parallel` | run parallel |
| `--max-parallel N` | max agents (default: 3) |
| `--sandbox` | use lightweight sandboxes instead of git worktrees |
| `--no-merge` | skip auto-merge in parallel mode |
| `--branch-per-task` | branch per task |
| `--base-branch BRANCH` | base branch for PRs |
| `--create-pr` | create PRs |
| `--draft-pr` | draft PRs |
| `--no-tests` | skip tests |
| `--no-lint` | skip lint |
| `--fast` | skip tests + lint |
| `--no-commit` | don't auto-commit |
| `--browser` | enable browser automation |
| `--no-browser` | disable browser automation |
| `--max-iterations N` | stop after N tasks |
| `--max-retries N` | retries per task (default: 3) |
| `--retry-delay N` | delay between retries in seconds (default: 5) |
| `--dry-run` | preview only |
| `-v, --verbose` | debug output |
| `--init` | setup .ralphy/ config |
| `--config` | show config |
| `--add-rule "rule"` | add rule to config |

## Webhook Notifications

Get notified when sessions complete via Discord, Slack, or custom webhooks.

Configure in `.ralphy/config.yaml`:
```yaml
notifications:
  discord_webhook: "https://discord.com/api/webhooks/..."
  slack_webhook: "https://hooks.slack.com/services/..."
  custom_webhook: "https://your-api.com/webhook"
```

## Requirements

- Node.js 18+ or Bun
- AI CLI: [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://opencode.ai/docs/), [Cursor](https://cursor.com), Codex, Qwen-Code, [Factory Droid](https://docs.factory.ai/cli/getting-started/quickstart), or [GitHub Copilot](https://docs.github.com/en/copilot)
- `gh` (optional, for GitHub issues / `--create-pr`)

## Links

- [GitHub](https://github.com/michaelshimeles/ralphy)
- [Discord](https://rasmic.link/discord)
- [Bash script version](https://github.com/michaelshimeles/ralphy#option-b-clone)

## License

MIT
