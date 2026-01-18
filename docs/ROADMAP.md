# RalfPretzel Roadmap

Feature enhancements planned for future releases.

## Planned Enhancements

### 1. Auto-use `branchName` from PRD

**Current:** `branchName` in JSON PRD is only shown to the AI agent.

**Proposed:** If `--base-branch` is not provided on CLI, use PRD's `branchName` as the base branch.

```bash
# prd.json
{
  "branchName": "feature/auth-system",
  "userStories": [...]
}

# CLI without --base-branch would auto-use "feature/auth-system"
./ralphy.sh --json prd.json
```

**Implementation:**
```bash
# In parse_json_prd() or after PRD is loaded
if [[ -z "$BASE_BRANCH" ]] && [[ -n "$PRD_FILE" ]]; then
  PRD_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null)
  if [[ -n "$PRD_BRANCH" ]]; then
    BASE_BRANCH="$PRD_BRANCH"
    log_info "Using branchName from PRD: $BASE_BRANCH"
  fi
fi
```

**Priority:** Medium
**Complexity:** Low

---

### 2. Auto-run `completionCriteria` Commands

**Current:** `completionCriteria` is defined but never executed.

**Proposed:** After each task (or group), run the completion criteria commands to verify success.

```json
{
  "completionCriteria": {
    "api": "cd api && npm run build && npm test",
    "web": "cd web && npm run build && npm test",
    "all": "npm run lint"
  },
  "userStories": [...]
}
```

**Implementation:**
```bash
# After task completion
run_completion_criteria() {
  local criteria
  criteria=$(jq -r '.completionCriteria // {} | to_entries[] | "\(.key):\(.value)"' "$PRD_FILE" 2>/dev/null)

  while IFS=: read -r name cmd; do
    log_info "Running completion criteria: $name"
    if ! eval "$cmd"; then
      log_error "Completion criteria '$name' failed"
      return 1
    fi
  done <<< "$criteria"
}
```

**Priority:** High
**Complexity:** Medium
**Considerations:**
- Should this run after each task or each parallel group?
- Should failures block progress or just warn?
- Add `--skip-completion-criteria` flag?

---

### 3. Task Dependencies Enforcement

**Current:** `dependencies` field exists in schema but is ignored.

**Proposed:** Enforce that dependent tasks wait for their dependencies to complete.

```json
{
  "userStories": [
    { "id": "DB-1", "title": "Create schema" },
    { "id": "API-1", "title": "Build endpoints", "dependencies": ["DB-1"] },
    { "id": "WEB-1", "title": "Create UI", "dependencies": ["API-1"] }
  ]
}
```

**Implementation:**
```bash
# Build dependency graph and compute execution order
get_ready_tasks() {
  # Return tasks where all dependencies are marked as passes=true
  jq -r '
    .userStories as $all |
    .userStories[] |
    select(.passes != true) |
    select(
      (.dependencies // []) |
      all(. as $dep | $all | any(.id == $dep and .passes == true))
    ) |
    .title
  ' "$PRD_FILE"
}
```

**Priority:** Medium
**Complexity:** High
**Considerations:**
- Circular dependency detection
- Interaction with `parallel_group`
- Dependencies should override parallel_group ordering

---

### 4. Priority-Based Task Selection

**Current:** `priority` field exists but is ignored.

**Proposed:** When selecting next task, prefer higher priority tasks within the same parallel group.

```json
{
  "userStories": [
    { "id": "1", "title": "Bug fix", "priority": "critical", "parallel_group": 1 },
    { "id": "2", "title": "New feature", "priority": "low", "parallel_group": 1 }
  ]
}
```

**Implementation:**
```bash
# Sort by priority within groups
get_next_task_json() {
  jq -r '
    [.userStories[] | select(.passes != true)] |
    sort_by(
      (.parallel_group // 0),
      (if .priority == "critical" then 0
       elif .priority == "high" or .priority == 1 then 1
       elif .priority == "medium" or .priority == 2 then 2
       elif .priority == 3 then 3
       else 4 end)
    ) |
    .[0].title // ""
  ' "$PRD_FILE"
}
```

**Priority:** Low
**Complexity:** Low

---

### 5. Pass `tests` Field to AI Agent

**Current:** `tests` field is defined but not passed to AI.

**Proposed:** Include test requirements in the prompt to the AI agent.

```json
{
  "userStories": [{
    "id": "AUTH-1",
    "title": "Login endpoint",
    "tests": [
      "Unit: Validate email format",
      "Integration: Full login flow",
      "E2E: Login from web UI"
    ]
  }]
}
```

**Implementation:**
```bash
# In get_task_details_json()
jq -r --arg title "$task" '
  .userStories[] | select(.title == $title) |
  "ID: \(.id)
Description: \(.description // "")
Tests Required:
\(.tests // [] | map("  - " + .) | join("\n"))
Acceptance Criteria:
\(.acceptanceCriteria // [] | map("  - " + .) | join("\n"))"
' "$PRD_FILE"
```

**Priority:** Medium
**Complexity:** Low

---

### 6. Reference Documents Loading

**Current:** `referenceDocuments` field exists but is not used.

**Proposed:** Include referenced documents in the AI prompt context.

```json
{
  "referenceDocuments": {
    "API_SPEC": "docs/api-spec.md",
    "SCHEMA": "prisma/schema.prisma",
    "STYLE_GUIDE": "docs/style-guide.md"
  },
  "userStories": [...]
}
```

**Implementation:**
```bash
# Load reference docs into context
get_reference_context() {
  jq -r '.referenceDocuments // {} | to_entries[] | "\(.key): \(.value)"' "$PRD_FILE" | \
  while IFS=: read -r name path; do
    if [[ -f "$path" ]]; then
      echo "=== $name ($path) ==="
      head -100 "$path"  # First 100 lines
      echo ""
    fi
  done
}
```

**Priority:** High
**Complexity:** Medium
**Considerations:**
- Token limits - don't include entire large files
- Allow specifying line ranges: `"SCHEMA:10-50": "file.ts"`

---

### 7. Rules File Loading

**Current:** `rules` field exists but is not used.

**Proposed:** Load rules files and prepend to AI prompts.

```json
{
  "rules": {
    "CODING_STANDARDS": ".cursor/rules/coding.md",
    "TESTING": ".cursor/rules/testing.md"
  },
  "userStories": [...]
}
```

**Priority:** High
**Complexity:** Low

---

### 8. Context Fields (problemStatement, businessImpact, technicalContext)

**Current:** `context` object exists but is not used.

**Proposed:** Include context in the AI prompt header.

```json
{
  "context": {
    "problemStatement": "Users cannot reset passwords",
    "businessImpact": "Blocking 15% of support tickets",
    "technicalContext": "Using SendGrid for email, JWT for tokens"
  },
  "userStories": [...]
}
```

**Implementation:**
```bash
# In get_prd_context_json()
jq -r '
  "=== PROJECT CONTEXT ===\n" +
  "Problem: \(.context.problemStatement // "N/A")\n" +
  "Impact: \(.context.businessImpact // "N/A")\n" +
  "Technical: \(.context.technicalContext // "N/A")\n"
' "$PRD_FILE"
```

**Priority:** Medium
**Complexity:** Low

---

## Implementation Phases

### Phase 1: Quick Wins (Low Complexity)
1. Auto-use `branchName` from PRD
2. Priority-based task selection
3. Pass `tests` field to AI
4. Context fields to prompt

### Phase 2: Enhanced Context
5. Reference documents loading
6. Rules file loading

### Phase 3: Advanced Orchestration
7. Completion criteria execution
8. Task dependencies enforcement

---

## Contributing

To implement an enhancement:

1. Create a branch: `feature/enhancement-name`
2. Update `ralphy.sh` with the implementation
3. Add tests to `tests/test_ralphy.sh`
4. Update documentation in `docs/`
5. Create PR with clear description
