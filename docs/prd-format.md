# Ralphy PRD Format

Ralphy supports JSON-formatted Product Requirement Documents (PRDs) that define user stories for AI agents to implement.

## Quick Start

```bash
# Run with a JSON PRD
ralphy.sh --json prd.json

# Validate your PRD against the schema
npx ajv validate -s schemas/prd.schema.json -d your-prd.json
```

## Schema

The full JSON Schema is available at [`schemas/prd.schema.json`](../schemas/prd.schema.json).

## Structure

### Root Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `userStories` | array | ✅ | List of tasks to complete |
| `branchName` | string | | Git branch for this work |
| `phase` | string/int | | Phase identifier |
| `phaseName` | string | | Human-readable phase name |
| `description` | string | | PRD description |
| `project` | string | | Project identifier |
| `referenceDocuments` | object | | Map of doc names to paths |
| `rules` | object | | Map of rule names to paths |
| `mandatoryPolicies` | object | | Policies agents must follow |
| `context` | object | | Problem/business/technical context |
| `completionCriteria` | object | | Build/test commands |

### User Story Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier (e.g., "TASK-1") |
| `title` | string | ✅ | Short task title |
| `description` | string | | Detailed description |
| `passes` | boolean | | Whether task is complete (default: false) |
| `priority` | int/string | | 1-5 or "critical"/"high"/"medium"/"low" |
| `parallel_group` | int | | Execution group for parallel processing |
| `dependencies` | string[] | | Story IDs that must complete first |
| `platforms` | string[] | | Target platforms |
| `files` | string[] | | Primary files to modify |
| `tests` | string[] | | Test requirements |
| `acceptanceCriteria` | string[] | | Completion criteria |
| `notes` | string | | Additional context |
| `slice` | string | | Feature slice/category |

## Parallel Groups

The `parallel_group` property enables intelligent task ordering:

- Tasks with the same `parallel_group` value can run in parallel
- Groups execute in ascending order (group 1 before group 2)
- Tasks with no `parallel_group` default to group 0
- Use `dependencies` for fine-grained ordering within groups

```json
{
  "userStories": [
    { "id": "A", "title": "Setup", "parallel_group": 1 },
    { "id": "B", "title": "API hooks", "parallel_group": 2 },
    { "id": "C", "title": "Components", "parallel_group": 2 },
    { "id": "D", "title": "Integration", "parallel_group": 3, "dependencies": ["B", "C"] }
  ]
}
```

Execution order: A → (B, C in parallel) → D

## Example PRD

```json
{
  "branchName": "feature/user-auth",
  "phase": "1",
  "phaseName": "User Authentication",
  "description": "Implement user authentication flow",
  "mandatoryPolicies": {
    "NO_STUBBING": "Every line of code must be production-ready",
    "TEST_COVERAGE": "All new code must have tests"
  },
  "context": {
    "problemStatement": "Users cannot log in to the application",
    "businessImpact": "Authentication is required for all features",
    "technicalContext": "Using JWT tokens with refresh flow"
  },
  "completionCriteria": {
    "api": "cd api && npm run build && npm test",
    "web": "cd web && npm run build && npm test"
  },
  "userStories": [
    {
      "id": "AUTH-1",
      "title": "Create login API endpoint",
      "description": "POST /auth/login accepts email/password, returns JWT",
      "passes": false,
      "priority": "critical",
      "parallel_group": 1,
      "platforms": ["api"],
      "files": ["api/src/auth/auth.controller.ts"],
      "acceptanceCriteria": [
        "Validates email format",
        "Returns 401 for invalid credentials",
        "Returns JWT token on success",
        "Includes refresh token in response"
      ],
      "tests": ["Unit: Login validation", "Integration: Full login flow"]
    },
    {
      "id": "AUTH-2",
      "title": "Create login form component",
      "description": "React form with email/password inputs",
      "passes": false,
      "priority": "high",
      "parallel_group": 1,
      "platforms": ["web"],
      "files": ["web/src/components/LoginForm.tsx"],
      "dependencies": [],
      "acceptanceCriteria": [
        "Email and password inputs",
        "Form validation",
        "Loading state during submission",
        "Error message display"
      ]
    },
    {
      "id": "AUTH-3",
      "title": "Integrate login form with API",
      "passes": false,
      "priority": "high",
      "parallel_group": 2,
      "dependencies": ["AUTH-1", "AUTH-2"],
      "platforms": ["web"],
      "acceptanceCriteria": [
        "Calls login API on form submit",
        "Stores JWT in secure storage",
        "Redirects to dashboard on success"
      ]
    }
  ]
}
```

## Compatibility

This format is compatible with:
- [snarktank/ralph](https://github.com/snarktank/ralph) - Original ralph implementation
- Extended properties for advanced orchestration (parallel_group, dependencies, etc.)
