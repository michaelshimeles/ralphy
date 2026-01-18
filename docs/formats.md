# Ralphy Input Formats

Ralphy supports three input formats for defining tasks. Choose based on your needs.

## Format Comparison

| Feature | Markdown | YAML | JSON |
|---------|----------|------|------|
| **Complexity** | Minimal | Simple | Full |
| **Learning curve** | None | Low | Medium |
| **Parallel execution** | ❌ | ✅ | ✅ |
| **Task dependencies** | ❌ | ❌ | ✅ |
| **Acceptance criteria** | ❌ | ❌ | ✅ |
| **Policies/rules** | ❌ | ❌ | ✅ |
| **Platform targeting** | ❌ | ❌ | ✅ |
| **File hints** | ❌ | ❌ | ✅ |
| **Schema validation** | N/A | ✅ | ✅ |
| **Best for** | Quick fixes | Sprint tasks | Complex PRDs |

## Quick Examples

### Markdown (`PRD.md`)

```markdown
- [ ] Fix login timeout bug
- [ ] Add password strength indicator
- [x] Update API documentation
```

```bash
ralphy.sh  # Auto-detects PRD.md
```

### YAML (`tasks.yaml`)

```yaml
tasks:
  - title: Fix login timeout bug
  - title: Add password strength indicator
    parallel_group: 1
  - title: Update API documentation
    parallel_group: 1
```

```bash
ralphy.sh --yaml tasks.yaml
```

### JSON (`prd.json`)

```json
{
  "branchName": "feature/auth-improvements",
  "mandatoryPolicies": {
    "TESTING": "All changes must have tests"
  },
  "userStories": [
    {
      "id": "AUTH-1",
      "title": "Fix login timeout bug",
      "priority": "critical",
      "acceptanceCriteria": [
        "Sessions extend on activity",
        "Graceful timeout with warning"
      ]
    }
  ]
}
```

```bash
ralphy.sh --json prd.json
```

## Decision Guide

```
Do you need acceptance criteria or policies?
├── Yes → Use JSON
└── No
    └── Do you need parallel execution?
        ├── Yes → Use YAML
        └── No
            └── Is this a quick fix or prototype?
                ├── Yes → Use Markdown
                └── No → Use YAML (more structured)
```

## Feature Details

### Parallel Execution (YAML & JSON)

Both YAML and JSON support `parallel_group` for concurrent task execution:

```yaml
# YAML
tasks:
  - title: API service
    parallel_group: 1
  - title: Web frontend
    parallel_group: 1
  - title: Integration tests
    parallel_group: 2
```

```json
// JSON
{
  "userStories": [
    { "id": "1", "title": "API service", "parallel_group": 1 },
    { "id": "2", "title": "Web frontend", "parallel_group": 1 },
    { "id": "3", "title": "Integration tests", "parallel_group": 2 }
  ]
}
```

### Task Dependencies (JSON only)

JSON supports explicit dependencies between tasks:

```json
{
  "userStories": [
    { "id": "DB-1", "title": "Create schema" },
    { "id": "API-1", "title": "Build endpoints", "dependencies": ["DB-1"] },
    { "id": "WEB-1", "title": "Create UI", "dependencies": ["API-1"] }
  ]
}
```

### Acceptance Criteria (JSON only)

JSON tasks can include detailed acceptance criteria passed to the AI:

```json
{
  "userStories": [
    {
      "id": "AUTH-1",
      "title": "Implement OAuth login",
      "acceptanceCriteria": [
        "Support Google and GitHub providers",
        "Store tokens securely",
        "Handle token refresh automatically",
        "Show loading state during auth flow"
      ]
    }
  ]
}
```

### Policies and Rules (JSON only)

JSON PRDs can enforce team policies:

```json
{
  "mandatoryPolicies": {
    "NO_STUBBING": "All code must be production-ready, no TODOs",
    "TEST_COVERAGE": "New code requires unit tests",
    "TYPE_SAFETY": "No 'any' types in TypeScript"
  },
  "userStories": [...]
}
```

### Platform Targeting (JSON only)

Specify which platforms each task targets:

```json
{
  "userStories": [
    {
      "id": "1",
      "title": "Add biometric login",
      "platforms": ["ios", "android"]
    },
    {
      "id": "2",
      "title": "Update login API",
      "platforms": ["api"]
    }
  ]
}
```

## What Gets Passed to the AI Agent

| Field | Used by ralphy.sh | Passed to AI |
|-------|-------------------|--------------|
| `title` | ✅ Task identification | ✅ |
| `completed`/`passes` | ✅ Progress tracking | ❌ |
| `parallel_group` | ✅ Execution order | ❌ |
| `id` | ❌ | ✅ |
| `description` | ❌ | ✅ |
| `acceptanceCriteria` | ❌ | ✅ |
| `platforms` | ❌ | ✅ |
| `files` | ❌ | ✅ |
| `branchName` | ❌ | ✅ |
| `mandatoryPolicies` | ❌ | ✅ |
| `dependencies` | ❌ | ❌ (future) |
| `priority` | ❌ | ❌ (future) |
| `tests` | ❌ | ❌ (future) |
| `notes` | ❌ | ❌ (future) |

## Migration Between Formats

### Markdown → YAML

```bash
# Before (PRD.md)
- [ ] Task one
- [ ] Task two
- [x] Task three

# After (tasks.yaml)
tasks:
  - title: Task one
  - title: Task two
  - title: Task three
    completed: true
```

### YAML → JSON

```bash
# Before (tasks.yaml)
tasks:
  - title: Task one
    parallel_group: 1
  - title: Task two
    parallel_group: 1

# After (prd.json)
{
  "userStories": [
    { "id": "1", "title": "Task one", "parallel_group": 1 },
    { "id": "2", "title": "Task two", "parallel_group": 1 }
  ]
}
```

## Further Reading

- [YAML Format Details](yaml-format.md)
- [JSON PRD Format Details](prd-format.md)
- [JSON Schema](../schemas/prd.schema.json)
- [YAML Schema](../schemas/tasks.schema.yaml)
