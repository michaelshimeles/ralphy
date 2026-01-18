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
chmod +x ralphy.sh

# Simple: Markdown PRD
./ralphy.sh --prd PRD.md

# Better: JSON PRD with rich context
./ralphy.sh --json prd.json
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
./ralphy.sh --json prd.json
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
./ralphy.sh --yaml tasks.yaml
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
./ralphy.sh --prd PRD.md
```

```markdown
## Tasks
- [ ] First task
- [ ] Second task
- [x] Completed task (skipped)
```

### GitHub Issues

```bash
./ralphy.sh --github owner/repo
./ralphy.sh --github owner/repo --github-label "ready"
```

## Parallel Execution

Run multiple AI agents simultaneously, each in its own isolated git worktree:

```bash
./ralphy.sh --parallel                    # 3 agents (default)
./ralphy.sh --parallel --max-parallel 5   # 5 agents
```

### How It Works

Each agent gets:
- Its own git worktree (separate directory)
- Its own branch (`ralphy/agent-1-task-name`, etc.)
- Complete isolation from other agents

```
Agent 1 ─► worktree: /tmp/xxx/agent-1 ─► branch: ralphy/agent-1-create-user-model
Agent 2 ─► worktree: /tmp/xxx/agent-2 ─► branch: ralphy/agent-2-add-api-endpoints
Agent 3 ─► worktree: /tmp/xxx/agent-3 ─► branch: ralphy/agent-3-setup-database
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
./ralphy.sh --log-level debug

# Write to file
./ralphy.sh --log-file ralphy.log

# Combined
./ralphy.sh --log-level trace --log-file debug.log
```

Log levels: `trace`, `debug`, `info` (default), `warn`, `error`

## AI Engines

```bash
./ralphy.sh              # Claude Code (default)
./ralphy.sh --codex      # Codex CLI
./ralphy.sh --opencode   # OpenCode
./ralphy.sh --cursor     # Cursor agent
./ralphy.sh --qwen       # Qwen-Code
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
./ralphy.sh --json prd.json --parallel --max-parallel 4

# YAML tasks with auto-PRs
./ralphy.sh --yaml tasks.yaml --create-pr

# GitHub issues with Cursor
./ralphy.sh --github myorg/myrepo --cursor --parallel

# Feature branch workflow with logging
./ralphy.sh --branch-per-task --create-pr --base-branch main --log-file session.log

# Debug mode
./ralphy.sh --json prd.json --log-level debug --dry-run
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
./tests/test_ralphy.sh
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
3. Run tests: `./tests/test_ralphy.sh`
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
