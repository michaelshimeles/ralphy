#!/bin/bash

# Test script for engine flag modifications
# Tests that engine flags append to ENGINES array with deduplication

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPHY_SH="$SCRIPT_DIR/ralphy.sh"

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

test_count=0
pass_count=0
fail_count=0

# Extract and source the append_engine function
eval "$(sed -n '/^append_engine()/,/^}/p' "$RALPHY_SH")"

# Helper function to run a test
run_test() {
  local test_name="$1"
  local expected="$2"
  shift 2
  local args=("$@")

  test_count=$((test_count + 1))

  # Reset ENGINES array for each test
  declare -a ENGINES=()

  # Process the arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --opencode)
        append_engine "opencode"
        shift
        ;;
      --claude)
        append_engine "claude"
        shift
        ;;
      --cursor|--agent)
        append_engine "cursor"
        shift
        ;;
      --codex)
        append_engine "codex"
        shift
        ;;
      --qwen)
        append_engine "qwen"
        shift
        ;;
      --droid)
        append_engine "droid"
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  # Convert ENGINES array to comma-separated string
  local result
  result=$(IFS=,; echo "${ENGINES[*]}")

  if [[ "$result" == "$expected" ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo "  Expected: $expected"
    echo "  Got: $result"
    fail_count=$((fail_count + 1))
  fi
}

echo "Testing engine flag modifications..."
echo

# Test 1: Single engine flag
run_test "Single --claude flag" "claude" --claude

# Test 2: Multiple different engine flags
run_test "Multiple different engines" "claude,opencode,cursor" --claude --opencode --cursor

# Test 3: Duplicate engine flags (should deduplicate)
run_test "Duplicate --claude flags" "claude" --claude --claude

# Test 4: --cursor and --agent alias (should deduplicate to single 'cursor')
run_test "Both --cursor and --agent" "cursor" --cursor --agent

# Test 5: --agent and --cursor alias (reversed order)
run_test "Both --agent and --cursor" "cursor" --agent --cursor

# Test 6: Multiple --cursor/--agent with other engines
run_test "Mixed with cursor aliases" "claude,cursor,opencode" --claude --cursor --agent --opencode

# Test 7: All engines
run_test "All engines" "claude,opencode,cursor,codex,qwen,droid" --claude --opencode --cursor --codex --qwen --droid

# Test 8: All engines with duplicates
run_test "All engines with duplicates" "claude,opencode,cursor,codex,qwen,droid" --claude --opencode --cursor --codex --qwen --droid --claude --cursor

echo
echo "================================"
echo "Test Results:"
echo "  Total: $test_count"
echo -e "  ${GREEN}Passed: $pass_count${RESET}"
if [[ $fail_count -gt 0 ]]; then
  echo -e "  ${RED}Failed: $fail_count${RESET}"
  exit 1
else
  echo "  Failed: 0"
  echo
  echo -e "${GREEN}All tests passed!${RESET}"
  exit 0
fi
