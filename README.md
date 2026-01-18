# RalfPretzel

> *Like a pretzel's infinite loop, RalfPretzel keeps working until every task is done.*

An enhanced autonomous AI coding loop that orchestrates AI assistants (Claude Code, OpenCode, Codex, Cursor, Qwen, or Factory Droid) to work through tasks until everything is complete.

**Forked from [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy)** - Enhanced with JSON PRD support, comprehensive logging, schemas, and more.

## What's New in RalfPretzel

| Feature | Original Ralphy | RalfPretzel |
|---------|----------------|-------------|
| **JSON PRD Support** | - | Full JSON schema with acceptance criteria, platforms, dependencies |
| **Logging System** | Basic output | 5-level logging with file output and timestamps |
| **Task Schemas** | None | JSON Schema + YAML Schema for validation |
| **Documentation** | README only | Format guides, PRD docs, YAML docs, comparison guides |
| **Test Suite** | None | 38+ automated tests |
| **Bug Fixes** | - | parallel_group fixes, BASE_BRANCH handling, edge cases |

## What It Does

1. Reads tasks from a **JSON PRD**, YAML file, Markdown PRD, or GitHub Issues
2. Sends each task to an AI assistant with rich context (acceptance criteria, platforms, policies)
3. The AI implements the feature, writes tests, and commits changes
4. Validates completion and repeats until all tasks are done

## Quick Start

```bash
# Clone RalfPretzel
git clone https://github.com/czaku/ralfpretzel.git
cd ralfpretzel
chmod +x ralfpretzel.sh

# Simple: Markdown PRD
ralfpretzel --prd PRD.md

# Better: JSON PRD with rich context
ralfpretzel --json prd.json
```

## Requirements

**Required:**
- One of: [Claude Code CLI](https://github.com/anthropics/claude-code), [OpenCode CLI](https://opencode.ai/docs/), Codex CLI, [Cursor](https://cursor.com) (with `agent` in PATH), Qwen-Code, or [Factory Droid](https://docs.factory.ai/cli/getting-started/quickstart)
- `jq` (for JSON parsing)

**Optional:**
- `yq` - only if using YAML task files
- `gh` - only if using GitHub Issues or `--create-pr`
- `bc` - for cost calculation

## Task Formats

RalfPretzel supports multiple task formats. Choose based on your needs:

| Format | Best For | Features |
|--------|----------|----------|
| **JSON PRD** | Complex projects | Acceptance criteria, platforms, dependencies, parallel groups, policies |
| **YAML** | Simple task lists | Parallel groups, completion tracking |
| **Markdown** | Quick prototypes | Checkbox-based task tracking |
| **GitHub Issues** | Issue-driven development | Labels, auto-close on completion |

See [docs/formats.md](docs/formats.md) for a detailed comparison.

### JSON PRD (Recommended for Complex Projects)

```bash
ralfpretzel --json prd.json
```

```json
{
  "title": "Authentication System",
  "branchName": "feature/auth",
  "phase": "Phase 1 - Core Auth",
  "mandatoryPolicies": [
    "All code must have tests",
    "Follow existing patterns"
  ],
  "userStories": [
    {
      "id": "AUTH-1",
      "title": "Implement login endpoint",
      "description": "Create POST /api/auth/login",
      "platforms": ["api"],
      "files": ["src/api/auth.ts"],
      "acceptanceCriteria": [
        "Returns JWT on success",
        "Returns 401 on invalid credentials"
      ],
      "completionCriteria": [
        "npm test",
        "npm run lint"
      ],
      "parallel_group": 1
    }
  ]
}
```

**Completion Criteria**: Automatically validate tasks by running commands (tests, lints, health checks):

```json
{
  "userStories": [{
    "id": "AUTH-1",
    "title": "Implement login endpoint",
    "completionCriteria": [
      "npm test",
      "npm run lint",
      "curl http://localhost:3000/health"
    ]
  }]
}
```

If any completion criterion fails, the task is marked as failed and retried with error context.

See [docs/prd-format.md](docs/prd-format.md) for full schema documentation.

### YAML (Simple Task Lists)

```bash
ralfpretzel --yaml tasks.yaml
```

```yaml
tasks:
  - title: Create User model
    parallel_group: 1
  - title: Create Post model
    parallel_group: 1
  - title: Add relationships
    parallel_group: 2
```

See [docs/yaml-format.md](docs/yaml-format.md) for YAML documentation.

### Markdown

```bash
ralfpretzel --prd PRD.md
```

```markdown
## Tasks
- [ ] First task
- [ ] Second task
- [x] Completed task (skipped)
```

### GitHub Issues

```bash
ralfpretzel --github owner/repo
ralfpretzel --github owner/repo --github-label "ready"
```

## Parallel Execution

Run multiple AI agents simultaneously, each in its own isolated git worktree:

```bash
ralfpretzel --parallel                    # 3 agents (default)
ralfpretzel --parallel --max-parallel 5   # 5 agents
```

### How It Works

Each agent gets:
- Its own git worktree (separate directory)
- Its own branch (`ralfpretzel/agent-1-task-name`, etc.)
- Complete isolation from other agents

```
Agent 1 ─► worktree: /tmp/xxx/agent-1 ─► branch: ralfpretzel/agent-1-create-user-model
Agent 2 ─► worktree: /tmp/xxx/agent-2 ─► branch: ralfpretzel/agent-2-add-api-endpoints
Agent 3 ─► worktree: /tmp/xxx/agent-3 ─► branch: ralfpretzel/agent-3-setup-database
```

### Parallel Groups (YAML/JSON)

Control task execution order:

```yaml
tasks:
  - title: Create User model
    parallel_group: 1
  - title: Create Post model
    parallel_group: 1  # Runs with User model (same group)
  - title: Add relationships
    parallel_group: 2  # Runs after group 1 completes
```

## Logging

RalfPretzel includes comprehensive logging:

```bash
# Set log level
ralfpretzel --log-level debug

# Write to file
ralfpretzel --log-file ralfpretzel.log

# Combined
ralfpretzel --log-level trace --log-file debug.log
```

Log levels: `trace`, `debug`, `info` (default), `warn`, `error`

## AI Engines

```bash
ralfpretzel              # Claude Code (default)
ralfpretzel --codex      # Codex CLI
ralfpretzel --opencode   # OpenCode
ralfpretzel --cursor     # Cursor agent
ralfpretzel --qwen       # Qwen-Code
ralfpretzel --droid      # Factory Droid
```

| Engine | CLI Command | Permissions Flag | Output |
|--------|-------------|------------------|--------|
| Claude Code | `claude` | `--dangerously-skip-permissions` | Token usage + cost estimate |
| OpenCode | `opencode` | `OPENCODE_PERMISSION='{"*":"allow"}'` | Token usage + actual cost |
| Codex | `codex` | N/A | Token usage (if provided) |
| Cursor | `agent` | `--force` | API duration (no token counts) |
| Qwen-Code | `qwen` | `--approval-mode yolo` | Token usage (if provided) |
| Factory Droid | `droid` | `--auto medium` | Duration (no token counts) |

## Configuration

### Interactive Wizard (First-Time Setup)

**First Launch:** RalfPretzel runs an interactive setup wizard to configure your preferences:

```bash
# Simply run ralfpretzel - wizard starts on first launch
ralfpretzel

# 🧙 Welcome to RalfPretzel Interactive Setup
#
# Select AI Engine:
#   1) Claude Code (recommended)
#   2) OpenCode
#   3) Codex
#   4) Cursor
#   5) Qwen-Code
#
# Choice [1]: 2
#
# Select Model for opencode:
#   1) gpt-4o (recommended)
#   2) gpt-4-turbo
#   3) gpt-3.5-turbo (fastest, cheapest)
#   4) o1-preview (advanced reasoning)
#   5) o1 (production reasoning)
#   6) deepseek-chat (DeepSeek V3)
#   7) minimax-m2.1 (MiniMax M2.1)
#   
#   Custom models detected:
#   8) my-custom-model (custom)
#   
#   99) Enter custom model ID
#
# Choice [1]: 1
#
# Select task source:
#   1) Markdown PRD (PRD.md)
#   2) JSON PRD
#   3) YAML tasks
#   4) GitHub Issues
#
# Choice [1]: 2
# Enter JSON PRD path [prd.json]: project.json
#
# Save these settings as default? [Y/n]: y
#
# Would you like to run this setup wizard on every launch?
#   1) No - use saved defaults (recommended)
#   2) Yes - always ask me these questions
#
# Choice [1]: 1
# ✓ Interactive mode disabled. Run 'ralfpretzel -i' to run wizard again.
# ✓ Preferences saved to ~/.ralfpretzel/config
```

**Subsequent Launches:** Uses your saved defaults, no wizard:

```bash
ralfpretzel --json prd.json  # Uses saved engine and model
```

**Re-run Wizard:** Use `-i` flag anytime:

```bash
ralfpretzel -i  # Launch wizard again to change settings
```

### Explicit Mode (Power Users)

Skip the wizard with explicit flags:

```bash
# Claude with specific model
ralfpretzel --claude --model claude-opus-4-20250514 --json prd.json

# OpenCode with GPT-4o
ralfpretzel --opencode --model gpt-4o --yaml tasks.yaml

# Codex with DeepSeek V3
ralfpretzel --codex --model deepseek-v3 --parallel

# Disable wizard entirely
ralfpretzel --no-interactive --claude --json prd.json
```

### Config File

Preferences are saved to `~/.ralfpretzel/config`:

```bash
# Default config location
~/.ralfpretzel/config

# Config format (bash variables)
INTERACTIVE_MODE=false
AI_ENGINE="opencode"
MODEL_ID="gpt-4o"
```

**Editing config:**

```bash
# Edit manually
nano ~/.ralfpretzel/config

# Or let the wizard update it
ralfpretzel  # Will prompt to save changes
```

**Disabling interactive mode:**

```bash
# Option 1: Set in config file
echo "INTERACTIVE_MODE=false" >> ~/.ralfpretzel/config

# Option 2: Use --no-interactive flag
ralfpretzel --no-interactive --claude --json prd.json
```

### Model Selection

RalfPretzel supports model selection for all AI engines:

**Claude Code:**
- `claude-sonnet-4-20250514` (recommended - balanced)
- `claude-opus-4-20250514` (most capable, expensive)
- `claude-sonnet-3.7` (fast, capable)
- `claude-haiku-3.5` (fastest, cheapest)

**OpenCode:**
- `gpt-4o` (recommended)
- `gpt-4-turbo`, `gpt-3.5-turbo`
- `o1-preview` (advanced reasoning), `o1` (production)
- `deepseek-chat` (DeepSeek V3)
- `minimax-m2.1` (MiniMax M2.1)
- Custom models from `~/.config/opencode/opencode.json`

**Codex:**
- `deepseek-v3` (recommended)
- `claude-sonnet-4`
- Custom model IDs

**Qwen:**
- `qwen-2.5-coder-32b` (recommended)
- `qwen-2.5-coder-72b` (most capable)

**Examples:**

```bash
# Use specific Claude model
ralfpretzel --claude --model claude-opus-4-20250514 --json prd.json

# Use DeepSeek via OpenCode
ralfpretzel --opencode --model deepseek-chat --yaml tasks.yaml

# MiniMax via OpenCode
ralfpretzel --opencode --model minimax-m2.1 --prd PRD.md
```

### Progress Tracking

RalfPretzel tracks progress to avoid merge conflicts during parallel execution:

```
.ralfpretzel/
  progress/
    group-1.md     # Progress for parallel_group 1
    group-2.md     # Progress for parallel_group 2
  progress-summary.md  # Consolidated summary (after completion)
```

**What gets logged:**
- **Learnings**: "Discovered that X requires Y"
- **Gotchas**: "Watch out for Z edge case"  
- **Patterns**: "Use this approach for similar tasks"
- **Context**: "This codebase prefers ABC over XYZ"

**Example progress log:**

```markdown
# Progress Log - Group 1

## Task: AUTH-1 - Implement JWT login
**Timestamp**: 2026-01-18 14:05:23
**Status**: Completed

### Learnings
- JWT tokens stored in httpOnly cookies for security
- Refresh token rotation implemented for 7-day sessions

### Gotchas
- bcrypt rounds must be 10 (not 12) for performance
- CORS settings needed updating for cookie handling

### Patterns
- All auth routes follow `/api/auth/*` convention
- Error responses use AuthErrorSchema from @/lib/schemas
```

**Note:** The `progress-summary.md` file can be safely deleted if it conflicts during merges, as individual group files contain all information.

## All Options

### Task Source
| Flag | Description |
|------|-------------|
| `--prd FILE` | Markdown PRD file (default: PRD.md) |
| `--yaml FILE` | YAML task file |
| `--json FILE` | JSON PRD file with rich schema |
| `--github REPO` | Fetch from GitHub issues (owner/repo) |
| `--github-label TAG` | Filter GitHub issues by label |

### AI Engine
| Flag | Description |
|------|-------------|
| `--claude` | Use Claude Code (default) |
| `--codex` | Use Codex CLI |
| `--opencode` | Use OpenCode |
| `--cursor`, `--agent` | Use Cursor agent |
| `--qwen` | Use Qwen-Code |

### Parallel Execution
| Flag | Description |
|------|-------------|
| `--parallel` | Run tasks in parallel |
| `--max-parallel N` | Max concurrent agents (default: 3) |

### Git Branches
| Flag | Description |
|------|-------------|
| `--branch-per-task` | Create a branch for each task |
| `--base-branch NAME` | Base branch (default: current branch) |
| `--create-pr` | Create pull requests |
| `--draft-pr` | Create PRs as drafts |

### Logging
| Flag | Description |
|------|-------------|
| `--log-file FILE` | Write logs to file |
| `--log-level LEVEL` | Log verbosity (trace/debug/info/warn/error) |

### Workflow
| Flag | Description |
|------|-------------|
| `--no-tests` | Skip tests |
| `--no-lint` | Skip linting |
| `--fast` | Skip both tests and linting |

### Execution Control
| Flag | Description |
|------|-------------|
| `--max-iterations N` | Stop after N tasks (0 = unlimited) |
| `--max-retries N` | Retries per task on failure (default: 3) |
| `--retry-delay N` | Seconds between retries (default: 5) |
| `--dry-run` | Preview without executing |

### Other
| Flag | Description |
|------|-------------|
| `-v, --verbose` | Debug output |
| `-h, --help` | Show help |
| `--version` | Show version |

## Examples

```bash
# JSON PRD with parallel execution
ralfpretzel --json prd.json --parallel --max-parallel 4

# YAML tasks with auto-PRs
ralfpretzel --yaml tasks.yaml --create-pr

# GitHub issues with Cursor
ralfpretzel --github myorg/myrepo --cursor --parallel

# Feature branch workflow with logging
ralfpretzel --branch-per-task --create-pr --base-branch main --log-file session.log

# Debug mode
ralfpretzel --json prd.json --log-level debug --dry-run
```

## Documentation

- [docs/prd-format.md](docs/prd-format.md) - JSON PRD schema and examples
- [docs/yaml-format.md](docs/yaml-format.md) - YAML format documentation
- [docs/formats.md](docs/formats.md) - Format comparison guide
- [docs/ROADMAP.md](docs/ROADMAP.md) - Planned enhancements

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for planned enhancements including:
- Auto-use `branchName` from PRD
- Completion criteria execution
- Task dependency enforcement
- Priority-based task selection
- Reference document loading
- And more...

## Testing

```bash
# Run test suite
./tests/test_ralfpretzel.sh
```

The test suite validates:
- CLI options and help output
- JSON/YAML schema validity
- Log level handling
- Documentation completeness
- No hardcoded references
- Interactive wizard and model selection
- Config file handling
- Model flag validation across all engines

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `./tests/test_ralfpretzel.sh`
4. Submit a pull request

## Credits

RalfPretzel is a fork of [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy), enhanced with:
- JSON PRD support with comprehensive schema
- 5-level logging system with file output
- YAML and JSON schema definitions
- Comprehensive documentation
- Automated test suite
- Bug fixes for parallel execution and branch handling

## Changelog

### RalfPretzel v0.9.1 (Current - 2026-01-18)
- **Added `completionCriteria` execution**: Automatically validates tasks by running commands (tests, lints, health checks)
- **Added `referenceDocuments` loading**: Injects reference documents from JSON PRD into AI prompts
- **Added `rules` loading**: Loads mandatory rules from JSON PRD for AI to follow
- **Added `ralfpretzel config` subcommand**: Manage configuration (list, get, set, reset, path)
- **Added config validation on load**: Checks if AI engine is installed, provides helpful error messages
- **Added ASCII pretzel banner**: Shows on first launch and `--version`, configurable with `--no-banner`
- **Added custom model detection for Codex and Qwen**: Detects custom models from config files
- **Enhanced test suite**: 49 tests total (38 original + 11 new)
- **Updated JSON schema**: Added `completionCriteria` to userStory definition
- **Documentation improvements**: Comprehensive examples and guides for new features

### RalfPretzel v0.9.0-beta (2026-01-17)
- Added interactive wizard as default mode for easy setup
- Added `--model` flag for explicit model selection across all engines
- Added config file support (`~/.ralfpretzel/config`) for saving preferences
- Added `ralfpretzel config` subcommand for managing configuration
- Added config validation on load with helpful error messages
- Added ASCII pretzel banner (shows on first launch and `--version`)
- Added per-group progress tracking to avoid merge conflicts
- Added installer script (`install.sh`) for easy installation
- Added Homebrew tap support (`brew install czaku/ralfpretzel/ralfpretzel`)
- Added JSON PRD support with rich schema (`--json`)
- Added `referenceDocuments` loading from JSON PRD into AI prompts
- Added `rules` loading from JSON PRD as mandatory rules for AI
- Added `completionCriteria` execution after task completion (validates with tests, lints, etc.)
- Added comprehensive logging system (`--log-file`, `--log-level`)
- Added JSON Schema for PRD validation
- Added YAML Schema for task file validation
- Added format comparison documentation
- Added test suite (38+ tests)
- Added support for more OpenCode models (MiniMax, DeepSeek, o1)
- Added custom OpenCode model detection from `~/.config/opencode/opencode.json`
- Added custom Codex and Qwen model detection from their config files
- Fixed parallel_group handling with BASE_BRANCH
- Fixed various edge cases from Greptile review

### Upstream Changes (v3.2.0 and earlier)
See the [original changelog](https://github.com/michaelshimeles/ralphy#changelog) for upstream history.

## License

MIT
