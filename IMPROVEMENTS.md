# RalfPretzel Improvements Plan

## Phase 1: Config Management (Quick Wins)

### Add `config` Subcommand

```bash
ralfpretzel config list      # Show current config
ralfpretzel config get <key> # Get specific value
ralfpretzel config set <key> <value>  # Set value
ralfpretzel config reset     # Delete config, start fresh
ralfpretzel config path      # Show config file location
```

### Config Validation on Load

```bash
# Before executing, validate:
1. AI_ENGINE is installed (check if command exists)
2. MODEL_ID is reasonable (soft validation)
3. Config file is valid bash syntax

# If invalid:
⚠️  Config issue detected: AI engine 'nonexistent' not found
   Available engines: claude, opencode, qwen

   Run 'ralfpretzel -i' to reconfigure
   or  'ralfpretzel config reset'
```

### Better Error Messages

```bash
# Current:
❌ ./ralfpretzel.sh: line 450: claude: command not found

# Better:
❌ Claude Code CLI not found!

   Install: https://github.com/anthropics/claude-code
   Or use different engine: ralfpretzel --opencode --json prd.json
   Or reconfigure: ralfpretzel -i
```

## Phase 2: Original Ralph Features (High Value)

### ✅ Load referenceDocuments into AI Prompts

```json
{
  "referenceDocuments": {
    "API Spec": "./docs/api.md",
    "Style Guide": "./STYLE.md"
  }
}
```

**Status:** ✅ **Implemented**
- Reads referenced files
- Injects into AI prompt: "Here is the API Spec:\n\n[content]"
- Huge value for context

### ✅ Load rules into AI Prompts

```json
{
  "rules": {
    "Code Style": "./docs/style.md",
    "Testing Requirements": "./docs/testing.md"
  }
}
```

**Status:** ✅ **Implemented**
- Similar to referenceDocuments
- Injected as mandatory rules
- AI must follow these

### ✅ Execute completionCriteria

```json
{
  "userStories": [{
    "completionCriteria": [
      "npm test",
      "npm run lint",
      "curl http://localhost:3000/health"
    ]
  }]
}
```

**Status:** ✅ **Implemented**
- Runs commands after task completion
- Marks task failed if any command fails
- Retries with error context
- Works in both parallel and sequential modes

## Phase 3: Enhanced UX (Polish)

### ASCII Art Welcome

```
  ____       _  __ ____            _          _
 |  _ \ __ _| |/ _|  _ \ _ __ ___| |_ _____| |
 | |_) / _` | | |_| |_) | '__/ _ \ __|_  / _ \ |
 |  _ < (_| | |  _|  __/| | |  __/ |_ / /  __/ |
 |_| \_\__,_|_|_| |_|   |_|  \___|\__/___\___|_|

 Like a pretzel's loop 🥨 - works until done!

 Version: 0.9.0-beta
```

Show on:
- First launch
- `--version` flag
- Can disable with `--no-banner` or in config

### Shell Completion

```bash
# Add completion scripts
./completions/ralfpretzel.bash
./completions/ralfpretzel.zsh
./completions/ralfpretzel.fish

# Install via:
ralfpretzel completion bash > /etc/bash_completion.d/ralfpretzel
```

### Update Notifications

```bash
# Check for new version (once per day)
💡 Update available: 0.9.0-beta → 1.0.0
   Run: brew upgrade ralfpretzel

   Disable: ralfpretzel config set check_updates false
```

## Phase 4: Quality of Life

### Better --help

```bash
# Add examples section that's copy-pasteable
ralfpretzel --examples

# Or interactive examples
ralfpretzel --examples interactive
  1) Simple JSON PRD
  2) Parallel execution
  3) Feature branch workflow
  4) GitHub Issues

  Choice: 2

  # This will run:
  ralfpretzel --parallel --max-parallel 4 --json prd.json

  Continue? [Y/n]:
```

### Dry Run Improvements

```bash
ralfpretzel --dry-run --json prd.json

# Show:
- ✓ Config loaded: claude + claude-sonnet-4
- ✓ PRD loaded: 5 tasks found
- ✓ Validation: All tasks valid
- ✓ Would execute in this order:
    1. Task AUTH-1 (parallel_group: 1)
    2. Task AUTH-2 (parallel_group: 1)
    3. Task USER-1 (parallel_group: 2)
- ✓ Estimated time: ~15-30 minutes
```

### Task Dependencies (from ROADMAP)

```json
{
  "userStories": [
    {
      "id": "USER-1",
      "dependencies": ["AUTH-1", "AUTH-2"]
    }
  ]
}
```

**Implementation:**
- Build dependency graph
- Execute in correct order
- Error if circular dependencies

## Priorities

**Must Have (v0.9.1):**
1. Config validation on load
2. `ralfpretzel config` subcommand
3. Better error messages for missing tools

**Should Have (v1.0.0):**
1. Load referenceDocuments
2. Load rules
3. Execute completionCriteria
4. ASCII art welcome

**Nice to Have (v1.1.0):**
1. Shell completion
2. Update notifications
3. Task dependencies
4. Interactive examples

## Implementation Notes

### Config Validation Function

```bash
validate_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 0  # No config is fine
  fi

  # Source config
  source "$CONFIG_FILE"

  # Check AI engine exists
  if [[ -n "$AI_ENGINE" ]]; then
    case "$AI_ENGINE" in
      claude)
        if ! command -v claude &>/dev/null; then
          log_error "Claude Code CLI not found. Install: https://github.com/anthropics/claude-code"
          log_info "Or reconfigure: ralfpretzel -i"
          return 1
        fi
        ;;
      opencode)
        if ! command -v opencode &>/dev/null; then
          log_error "OpenCode CLI not found. Install: https://opencode.ai/docs/"
          return 1
        fi
        ;;
      # ... etc
    esac
  fi

  return 0
}
```

### Config Subcommand

```bash
handle_config_command() {
  local subcmd="${1:-list}"

  case "$subcmd" in
    list)
      cat "$CONFIG_FILE" 2>/dev/null || echo "No config file"
      ;;
    get)
      local key="$2"
      grep "^${key}=" "$CONFIG_FILE" 2>/dev/null | cut -d= -f2-
      ;;
    set)
      local key="$2"
      local value="$3"
      # Update or append
      ;;
    reset)
      rm -f "$CONFIG_FILE"
      log_success "Config reset. Run 'ralfpretzel' to set up again."
      ;;
    path)
      echo "$CONFIG_FILE"
      ;;
  esac
}
```

