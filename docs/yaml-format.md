# Ralphy YAML Format

YAML is the **simple format** for quick task lists. For complex orchestration with rich metadata, acceptance criteria, and policies, use [JSON format](prd-format.md) instead.

## Quick Start

```bash
# Create a simple task file
cat > tasks.yaml << 'EOF'
tasks:
  - title: Add user authentication
  - title: Create login form
  - title: Write tests for auth
EOF

# Run ralphy with YAML
ralphy.sh --yaml tasks.yaml
```

## Schema

The full schema is at [`schemas/tasks.schema.yaml`](../schemas/tasks.schema.yaml).

## Structure

### Root Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `tasks` | array | ✅ | List of tasks to complete |
| `title` | string | | Optional title for the task list |
| `description` | string | | Optional description |

### Task Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `title` | string | ✅ | | Task description for the AI agent |
| `completed` | boolean | | `false` | Set automatically by ralphy |
| `parallel_group` | integer | | `0` | Execution group for parallelization |

## Parallel Execution

Use `parallel_group` to run tasks concurrently:

```yaml
tasks:
  # Group 1: Run in parallel
  - title: Create API endpoints
    parallel_group: 1
  - title: Create React components
    parallel_group: 1
  - title: Set up database schema
    parallel_group: 1

  # Group 2: Runs after group 1 completes
  - title: Integrate frontend with API
    parallel_group: 2
  - title: Add authentication middleware
    parallel_group: 2

  # Group 3: Final integration
  - title: End-to-end testing
    parallel_group: 3
```

**Execution order:**
1. API, Components, and Database run in parallel
2. After all complete → Frontend integration and Auth middleware run in parallel
3. After all complete → E2E testing runs

## Examples

### Minimal (Sequential)

```yaml
tasks:
  - title: Fix login bug
  - title: Add password reset
  - title: Update documentation
```

All tasks run sequentially (all in group 0 by default).

### With Metadata

```yaml
title: Sprint 42 Tasks
description: Authentication improvements for Q1 release

tasks:
  - title: Implement OAuth2 login
    parallel_group: 1
  - title: Add MFA support
    parallel_group: 1
  - title: Create auth settings page
    parallel_group: 2
```

### Mixed Groups

```yaml
tasks:
  # Setup (group 0 - runs first)
  - title: Initialize project structure

  # Feature work (group 1 - parallel)
  - title: User service
    parallel_group: 1
  - title: Product service
    parallel_group: 1
  - title: Order service
    parallel_group: 1

  # Integration (group 2)
  - title: API gateway integration
    parallel_group: 2
```

## Requirements

YAML parsing requires `yq`:

```bash
# macOS
brew install yq

# Linux
sudo wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -O /usr/bin/yq
sudo chmod +x /usr/bin/yq
```

## When to Use YAML vs JSON

| Use YAML when... | Use JSON when... |
|------------------|------------------|
| Quick task lists | Complex PRDs with acceptance criteria |
| Simple parallel groups | Dependencies between specific tasks |
| Ad-hoc automation | Team policies and rules |
| Personal projects | Multi-platform targeting |
| Prototyping | Production orchestration |

See [Format Comparison](formats.md) for detailed differences.
