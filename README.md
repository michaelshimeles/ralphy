# RalfPretzel

> *Like a pretzel's infinite loop, RalfPretzel keeps working until every task is done.*

An enhanced autonomous AI coding loop that orchestrates AI assistants (Claude Code, OpenCode, Codex, Cursor, or Qwen) to work through tasks until everything is complete.

**Forked from [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy)** - Enhanced with JSON PRD support, comprehensive logging, schemas, and more.

## What's New in RalfPretzel

| Feature | Original Ralphy | RalfPretzel |
|---------|----------------|-------------|
| **JSON PRD Support** | - | Full JSON schema with acceptance criteria, platforms, dependencies |
| **Logging System** | Basic output | 5-level logging with file output and timestamps |
| **Task Schemas** | None | JSON Schema + YAML Schema for validation |
| **Documentation** | README only | Format guides, PRD docs, YAML docs, comparison guides |
| **Test Suite** | None | 24+ automated tests |
| **Bug Fixes** | - | parallel_group fixes, BASE_BRANCH handling, edge cases |

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/czaku/ralfpretzel/main/install.sh | bash
```

This installs `ralfpretzel` to `~/.local/bin`. The installer will guide you through adding it to your PATH if needed.

### Homebrew (macOS/Linux)

```bash
# Add the tap
brew tap czaku/ralfpretzel

# Install
brew install ralfpretzel
```

Or in one command:
```bash
brew install czaku/ralfpretzel/ralfpretzel
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/czaku/ralfpretzel.git
cd ralfpretzel

# Option 1: Run directly
chmod +x ralfpretzel.sh
./ralfpretzel.sh --help

# Option 2: Install to PATH
cp ralfpretzel.sh ~/.local/bin/ralfpretzel
chmod +x ~/.local/bin/ralfpretzel
```

### Uninstall

```bash
# If installed via install.sh
curl -fsSL https://raw.githubusercontent.com/czaku/ralfpretzel/main/install.sh | bash -s -- --uninstall

# If installed via Homebrew
brew uninstall ralfpretzel
```

## What It Does

1. Reads tasks from a **JSON PRD**, YAML file, Markdown PRD, or GitHub Issues
2. Sends each task to an AI assistant with rich context (acceptance criteria, platforms, policies)
3. The AI implements the feature, writes tests, and commits changes
4. Validates completion and repeats until all tasks are done

## Quick Start

```bash
# Simple: Markdown PRD
ralfpretzel --prd PRD.md

# Better: JSON PRD with rich context
ralfpretzel --json prd.json

# YAML task file
ralfpretzel --yaml tasks.yaml
```

## Requirements

**Required:**
- One of: [Claude Code CLI](https://github.com/anthropics/claude-code), [OpenCode CLI](https://opencode.ai/docs/), Codex CLI, [Cursor](https://cursor.com) (with `agent` in PATH), or Qwen-Code
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
      "parallel_group": 1
    }
  ]
}
```

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
```

| Engine | CLI Command | Permissions Flag | Output |
|--------|-------------|------------------|--------|
| Claude Code | `claude` | `--dangerously-skip-permissions` | Token usage + cost estimate |
| OpenCode | `opencode` | `OPENCODE_PERMISSION='{"*":"allow"}'` | Token usage + actual cost |
| Codex | `codex` | N/A | Token usage (if provided) |
| Cursor | `agent` | `--force` | API duration (no token counts) |
| Qwen-Code | `qwen` | `--approval-mode yolo` | Token usage (if provided) |

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

### RalfPretzel v1.0.0 (Fork)
- Added installer script (`install.sh`) for easy installation
- Added Homebrew tap support (`brew install czaku/ralfpretzel/ralfpretzel`)
- Added JSON PRD support with rich schema (`--json`)
- Added comprehensive logging system (`--log-file`, `--log-level`)
- Added JSON Schema for PRD validation
- Added YAML Schema for task file validation
- Added format comparison documentation
- Added test suite (24+ tests)
- Fixed parallel_group handling with BASE_BRANCH
- Fixed various edge cases from Greptile review

### Upstream Changes (v3.2.0 and earlier)
See the [original changelog](https://github.com/michaelshimeles/ralphy#changelog) for upstream history.

## License

MIT
