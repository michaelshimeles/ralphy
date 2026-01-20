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
```

## Task Sources

**Markdown** (default):
```bash
ralphy --prd PRD.md
```

**YAML**:
```bash
ralphy --yaml tasks.yaml
```

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

Each agent gets isolated worktree + branch. Without `--create-pr`: auto-merges back. With `--create-pr`: keeps branches, creates PRs.

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
| `--prd FILE` | task file (default: PRD.md) |
| `--yaml FILE` | YAML task file |
| `--github REPO` | use GitHub issues |
| `--github-label TAG` | filter issues by label |
| `--parallel` | run parallel |
| `--max-parallel N` | max agents (default: 3) |
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

## Requirements

- Node.js 18+ or Bun
- AI CLI: [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://opencode.ai/docs/), [Cursor](https://cursor.com), Codex, Qwen-Code, or [Factory Droid](https://docs.factory.ai/cli/getting-started/quickstart)
- `gh` (optional, for GitHub issues / `--create-pr`)

## Links

- [GitHub](https://github.com/michaelshimeles/ralphy)
- [Discord](https://rasmic.link/discord)
- [Bash script version](https://github.com/michaelshimeles/ralphy#option-b-clone)

## License

MIT
