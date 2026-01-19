# Engine Configuration Serialization Tests

## Overview
The `serialize_engine_config()` and `deserialize_engine_config()` functions enable passing multi-engine configuration from parent processes to subshells by converting Bash associative arrays into serialized environment variables.

## Requirements
- Bash 4.0+ (for associative array support)
- The functions are defined in `ralphy.sh` lines 136-298

## Serialization Format

The serialization uses two formats depending on the data structure:

1. **Indexed Arrays** (e.g., ENGINES): Comma-separated values
   - Example: `ENGINES_SERIALIZED="claude,cursor,opencode"`

2. **Associative Arrays** (e.g., ENGINE_WEIGHTS): Pipe-delimited key:value pairs
   - Example: `ENGINE_WEIGHTS_SERIALIZED="claude:2|cursor:3|opencode:1"`

## Test Cases

### Test 1: Empty Configuration
**Input:**
- Empty ENGINES array
- Empty ENGINE_WEIGHTS associative array

**Expected Output:**
- `ENGINES_SERIALIZED=""` (empty string)
- `ENGINE_WEIGHTS_SERIALIZED=""` (empty string)

**Verification:** Both serialized values should be empty strings.

---

### Test 2: Single Engine Configuration
**Input:**
```bash
ENGINES=("claude")
ENGINE_WEIGHTS["claude"]=1
ENGINE_AGENT_COUNT["claude"]=5
ENGINE_SUCCESS["claude"]=3
ENGINE_FAILURES["claude"]=2
ENGINE_COSTS["claude"]="0.025"
```

**Expected Serialization:**
```bash
ENGINES_SERIALIZED="claude"
ENGINE_WEIGHTS_SERIALIZED="claude:1"
ENGINE_AGENT_COUNT_SERIALIZED="claude:5"
ENGINE_SUCCESS_SERIALIZED="claude:3"
ENGINE_FAILURES_SERIALIZED="claude:2"
ENGINE_COSTS_SERIALIZED="claude:0.025"
```

**Verification After Deserialization:**
- `${ENGINES[0]}` == "claude"
- `${ENGINE_WEIGHTS[claude]}` == "1"
- `${ENGINE_AGENT_COUNT[claude]}` == "5"
- `${ENGINE_SUCCESS[claude]}` == "3"
- `${ENGINE_FAILURES[claude]}` == "2"
- `${ENGINE_COSTS[claude]}` == "0.025"

---

### Test 3: Multiple Engines with Weights
**Input:**
```bash
ENGINES=("claude" "cursor" "opencode")
ENGINE_WEIGHTS["claude"]=2
ENGINE_WEIGHTS["cursor"]=3
ENGINE_WEIGHTS["opencode"]=1
ENGINE_AGENT_COUNT["claude"]=10
ENGINE_AGENT_COUNT["cursor"]=15
ENGINE_AGENT_COUNT["opencode"]=5
ENGINE_SUCCESS["claude"]=8
ENGINE_SUCCESS["cursor"]=12
ENGINE_SUCCESS["opencode"]=4
ENGINE_FAILURES["claude"]=2
ENGINE_FAILURES["cursor"]=3
ENGINE_FAILURES["opencode"]=1
ENGINE_COSTS["claude"]="0.150"
ENGINE_COSTS["cursor"]="0.200"
ENGINE_COSTS["opencode"]="0.100"
```

**Expected Serialization:**
```bash
ENGINES_SERIALIZED="claude,cursor,opencode"
ENGINE_WEIGHTS_SERIALIZED contains "claude:2", "cursor:3", "opencode:1" (order may vary)
ENGINE_AGENT_COUNT_SERIALIZED contains all three engine counts
ENGINE_SUCCESS_SERIALIZED contains all three success counts
ENGINE_FAILURES_SERIALIZED contains all three failure counts
ENGINE_COSTS_SERIALIZED contains all three costs
```

**Verification After Deserialization:**
- `${#ENGINES[@]}` == 3
- All ENGINE_WEIGHTS values match original
- All ENGINE_AGENT_COUNT values match original
- All ENGINE_SUCCESS values match original
- All ENGINE_FAILURES values match original
- All ENGINE_COSTS values match original

---

### Test 4: Distribution Strategy
**Input:**
```bash
ENGINE_DISTRIBUTION="weighted"
```

**Expected Serialization:**
```bash
ENGINE_DISTRIBUTION="weighted" (exported directly)
```

**Verification After Deserialization:**
- `$ENGINE_DISTRIBUTION` == "weighted"

---

### Test 5: Valid Engines Array
**Input:**
```bash
VALID_ENGINES=("claude" "opencode" "cursor" "codex" "qwen" "droid")
```

**Expected Serialization:**
```bash
VALID_ENGINES_SERIALIZED="claude,opencode,cursor,codex,qwen,droid"
```

**Verification After Deserialization:**
- `${#VALID_ENGINES[@]}` == 6
- All engine names present in correct order

---

### Test 6: Special Characters in Engine Names
**Input:**
```bash
ENGINES=("engine-1" "engine_2")
ENGINE_WEIGHTS["engine-1"]=1
ENGINE_WEIGHTS["engine_2"]=2
```

**Expected Serialization:**
```bash
ENGINES_SERIALIZED="engine-1,engine_2"
ENGINE_WEIGHTS_SERIALIZED contains "engine-1:1" and "engine_2:2"
```

**Verification After Deserialization:**
- `${#ENGINES[@]}` == 2
- `${ENGINE_WEIGHTS[engine-1]}` == "1"
- `${ENGINE_WEIGHTS[engine_2]}` == "2"

---

## Integration Test

The functions are designed to work in a parent-subshell pattern:

```bash
# Parent process
ENGINES=("claude" "cursor")
ENGINE_WEIGHTS["claude"]=2
ENGINE_WEIGHTS["cursor"]=1
serialize_engine_config

# Spawn subshell (the serialized variables are now in environment)
(
  # Subshell process
  deserialize_engine_config

  # Now ENGINES and ENGINE_WEIGHTS are reconstructed
  echo "Using engine: ${ENGINES[0]}"
  echo "Weight: ${ENGINE_WEIGHTS[${ENGINES[0]}]}"
)
```

## Usage in ralphy.sh

1. **Parent process** (`run_parallel_tasks` function):
   - Initialize ENGINE arrays
   - Call `serialize_engine_config()`
   - Spawn subshells for parallel agents

2. **Subshell process** (`run_parallel_agent` function):
   - Call `deserialize_engine_config()`
   - Access ENGINE arrays as if they were defined locally

## Known Limitations

- **Bash 3.2 (macOS default)**: Does not support associative arrays (`declare -A`)
- **Solution**: Users must install Bash 4+ (via Homebrew: `brew install bash`)
- The serialization format uses `:` and `|` as delimiters, which are safe for typical engine names
- Engine names containing `:` or `|` characters would break the serialization (not expected in practice)

## Manual Verification

Since automated tests require Bash 4+, manual verification on a Bash 4+ system:

```bash
# Source the functions
source ralphy.sh

# Set up test data
ENGINES=("claude" "cursor")
ENGINE_WEIGHTS["claude"]=2
ENGINE_WEIGHTS["cursor"]=1

# Serialize
serialize_engine_config

# Check environment variables
echo "ENGINES_SERIALIZED=$ENGINES_SERIALIZED"
echo "ENGINE_WEIGHTS_SERIALIZED=$ENGINE_WEIGHTS_SERIALIZED"

# Test in subshell
(
  deserialize_engine_config
  echo "Deserialized ENGINES: ${ENGINES[*]}"
  echo "Deserialized ENGINE_WEIGHTS[claude]: ${ENGINE_WEIGHTS[claude]}"
  echo "Deserialized ENGINE_WEIGHTS[cursor]: ${ENGINE_WEIGHTS[cursor]}"
)
```

Expected output:
```
ENGINES_SERIALIZED=claude,cursor
ENGINE_WEIGHTS_SERIALIZED=claude:2|cursor:1  (or cursor:1|claude:2)
Deserialized ENGINES: claude cursor
Deserialized ENGINE_WEIGHTS[claude]: 2
Deserialized ENGINE_WEIGHTS[cursor]: 1
```
