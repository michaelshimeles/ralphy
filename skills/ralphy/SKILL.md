---
name: ralphy
description: "Convert PRDs to YAML format for Ralphy autonomous agent execution. Use when you have an existing PRD and need to convert it to Ralphy's YAML format. Triggers on: convert prd to yaml, create yaml from prd, ralphy yaml."
---

# Ralphy PRD Converter

Take a PRD markdown file and convert it to the YAML format that Ralphy.sh requires for autonomous execution.

Supports multiple PRD formats:
- Detailed user stories with acceptance criteria (from prd skill output)
- Simple task lists with checkboxes
- Automatically detects format and extracts appropriate task titles

---

## The Job

1. Receive a PRD file path from the user
2. Parse user stories or task items from the PRD
3. Perform conservative parallel task analysis to assign parallel_group values
4. Generate YAML output in Ralphy's expected format
5. Save to `[input-directory]/[input-filename-without-extension].yaml`

---

## Step 1: Input Validation

- Verify the PRD file exists and is readable
- Confirm it contains tasks in supported formats

---

## Step 2: Task Parsing

Support two formats:

**Format A: Detailed User Stories**
```
### US-001: Create deer entity with basic AI
**Description:** As a player, I want to see deer spawning...
**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
```
- Extract titles from `### US-XXX: Title` lines
- Use only the title part (remove US-XXX prefix)

**Format B: Simple Task Lists**
```
## Tasks
- [ ] Create user authentication
- [ ] Add dashboard page
- [ ] Build API endpoints
```
- Extract titles from `- [ ] Task description` lines
- Use the full task description

---

## Step 3: Parallel Task Analysis

Assign parallel groups conservatively:

- **Group 0**: Foundation tasks (database, core models, authentication) - execute sequentially first
- **Group 1**: Independent features (UI components, API endpoints, utilities) - can execute in parallel
- **Group 2**: Integration tasks (connecting features, workflows, cross-cutting concerns) - execute sequentially last

Apply conservative logic to prioritize merge safety over maximum parallelism.

---

## YAML Output Format

Ralphy.sh expects YAML with this exact structure:

```yaml
tasks:
  - title: "Task description"
    completed: false
    parallel_group: 0
```

**Field Specifications:**
- `title`: string (clean task title, no prefixes)
- `completed`: boolean (always `false` for new tasks)
- `parallel_group`: integer (0, 1, or 2)

---

## Step 4: Output Generation

- Parse tasks from input PRD
- Assign appropriate parallel groups
- Generate YAML with tasks array
- Save to `[input-directory]/[input-filename-without-extension].yaml`

---

## Examples

**Input: prd-deer-entity.md (Format A)**
```markdown
### US-001: Create deer entity with basic AI
**Description:** As a player, I want to see deer spawning naturally...

### US-002: Add forest spawning logic
**Description:** Deer should spawn in forest biomes...
```

**Output: prd-deer-entity.yaml**
```yaml
tasks:
  - title: "Create deer entity with basic AI"
    completed: false
    parallel_group: 0
  - title: "Add forest spawning logic"
    completed: false
    parallel_group: 1
```

**Input: simple-tasks.md (Format B)**
```markdown
## Tasks
- [ ] Create user authentication
- [ ] Add dashboard page
- [ ] Build API endpoints
```

**Output: simple-tasks.yaml**
```yaml
tasks:
  - title: "Create user authentication"
    completed: false
    parallel_group: 0
  - title: "Add dashboard page"
    completed: false
    parallel_group: 1
  - title: "Build API endpoints"
    completed: false
    parallel_group: 1
```

---

## Checklist

Before saving the YAML:

- [ ] PRD file exists and is readable
- [ ] Tasks successfully parsed (at least one found)
- [ ] Parallel groups assigned conservatively
- [ ] YAML structure matches ralphy.sh expectations
- [ ] Saved to correct location alongside the PRD