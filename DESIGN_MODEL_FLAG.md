# Design: --model Flag & Progress Tracking

## 1. Model Selection Design

### Option A: Explicit (Recommended)
```bash
# User MUST specify both engine and model
ralfpretzel --claude --model claude-opus-4-20250514
ralfpretzel --opencode --model gpt-4o
ralfpretzel --codex --model deepseek-v3

# Error if model without engine
ralfpretzel --model claude-opus-4
# Error: --model requires an engine flag (--claude, --opencode, etc.)
```

### Option B: Interactive Selection
```bash
# New flag: --interactive or -i
ralfpretzel --interactive

# Prompts:
# 1. Select AI Engine:
#    1) Claude Code (default)
#    2) OpenCode
#    3) Codex
#    4) Cursor
#    5) Qwen
#
# 2. Select Model (shows based on engine):
#    For Claude:
#    1) claude-opus-4-20250514 (most capable)
#    2) claude-sonnet-4-20250514 (recommended)
#    3) claude-sonnet-3.7
#    4) claude-haiku-3.5
#    [or enter custom model ID]
#
# 3. Would you like to save this as default? [y/n]
```

### Option C: Both!
```bash
# Power users: explicit
ralfpretzel --claude --model claude-opus-4

# New users: interactive
ralfpretzel --interactive

# Default: uses engine's default model
ralfpretzel --claude  # Uses claude-sonnet-4-20250514
```

---

## 2. Help Text Enhancement

Add a new section to `--help`:

```
MODEL SELECTION:
  --model MODEL_ID        Specify model for the selected AI engine
                          Must be used with --claude, --opencode, etc.

  --interactive, -i       Interactive model selection menu

COMMON MODELS BY ENGINE:
  Claude Code:
    claude-opus-4-20250514      Most capable, expensive
    claude-sonnet-4-20250514    Recommended balance
    claude-sonnet-3.7           Fast and capable
    claude-haiku-3.5            Fastest, cheapest

  OpenCode:
    gpt-4o                      Recommended
    gpt-4-turbo                 Fast GPT-4
    gpt-3.5-turbo               Fastest, cheapest
    o1-preview                  Advanced reasoning

  Codex:
    deepseek-v3                 Recommended
    claude-sonnet-4             Via Codex CLI
    (custom model IDs)

  Cursor:
    (uses Cursor's model settings)

  Qwen:
    qwen-2.5-coder-32b          Recommended
    qwen-2.5-coder-72b          Most capable

EXAMPLES:
  ralfpretzel --claude --model claude-opus-4-20250514 --json prd.json
  ralfpretzel --opencode --model gpt-4o --parallel
  ralfpretzel --interactive  # Guided model selection
```

---

## 3. Implementation Plan

### Phase 1: Basic --model flag
- Add `--model MODEL_ID` flag
- Validate engine flag is present
- Pass to underlying CLI:
  - Claude: `claude --model $MODEL_ID`
  - OpenCode: Store in temp config or use `--model`
  - Codex: `codex --model $MODEL_ID`
  - Cursor: Add to agent command
  - Qwen: `qwen --model $MODEL_ID`

### Phase 2: Interactive selection
- Add `--interactive` flag
- Use `select` bash built-in for menus
- Store user preference in `~/.ralfpretzel/config`
- Support `--set-default-model` to save without running

### Phase 3: Model validation
- Soft validation (warnings, not errors)
- Known model patterns per engine
- Helpful suggestions if typo detected

---

## 4. Progress.txt Merge Conflict Solution

### Problem
In parallel execution, multiple agents append to progress.txt simultaneously → merge conflicts

### Solution: Per-Task Progress Files
```bash
# Instead of single progress.txt:
.ralfpretzel/
  progress/
    task-AUTH-1-20260118-140523.md    # Timestamped per task
    task-AUTH-2-20260118-140635.md
    task-USER-1-20260118-140712.md

# Or use task IDs:
.ralfpretzel/
  progress/
    AUTH-1.md     # One file per story ID
    AUTH-2.md
    USER-1.md
```

### Alternative: JSON Lines Format
```bash
# Single file but structured for parallel writes
.ralfpretzel/progress.jsonl

{"timestamp":"2026-01-18T14:05:23Z","task":"AUTH-1","type":"learning","content":"JWT tokens need 24h expiry"}
{"timestamp":"2026-01-18T14:06:35Z","task":"AUTH-2","type":"gotcha","content":"bcrypt rounds should be 10"}
{"timestamp":"2026-01-18T14:07:12Z","task":"USER-1","type":"pattern","content":"Use Zod for validation"}
```

### Recommended: Hybrid Approach
```bash
# One progress file per parallel_group
.ralfpretzel/
  progress/
    group-1.md    # All group 1 tasks append here (sequential)
    group-2.md    # All group 2 tasks append here (sequential)
    group-3.md

# Master summary
.ralfpretzel/progress-summary.md  # Aggregated after all groups complete
```

### What gets logged?
Based on original Ralph pattern:
- **Learnings**: "Discovered that X requires Y"
- **Gotchas**: "Watch out for Z edge case"
- **Patterns**: "Use this approach for similar tasks"
- **Context**: "This codebase prefers ABC over XYZ"

### Format
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

---

## Task: AUTH-2 - Add password reset flow
...
```

---

## 5. Recommendation

**For Model Selection:**
✅ Implement **Option C (Both)** - gives power users explicit control, new users interactive guidance

**For Progress Tracking:**
✅ Use **Hybrid Approach** - per-group files during execution, aggregated summary at end

**Priority:**
1. Add --model flag (explicit) - Quick win
2. Add --interactive selection - Better UX
3. Add referenceDocuments/rules loading - High value
4. Add progress tracking per-group - Avoid conflicts

---

## Questions for You

1. **Model selection**: Do you want Option C (both explicit + interactive)?
2. **Progress files**: Per-group or per-task? (I recommend per-group)
3. **Default models**: Should we have sensible defaults if --model not specified?
4. **Config file**: Store user preferences in `~/.ralfpretzel/config`?

Let me know your preferences and I'll implement!
