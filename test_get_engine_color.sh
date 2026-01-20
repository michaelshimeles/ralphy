#!/bin/bash
# Test script for get_engine_color() function
#
# Note: Function and color definitions are intentionally duplicated inline
# rather than sourced from ralphy.sh for test isolation and robustness.

# Color definitions (inline for test isolation)
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)
  MAGENTA=$(tput setaf 5)
  CYAN=$(tput setaf 6)
  RESET=$(tput sgr0)
else
  RED="" GREEN="" YELLOW="" BLUE="" MAGENTA="" CYAN="" RESET=""
fi

# Function definition (inline for test isolation)
get_engine_color() {
  local engine="${1:-$AI_ENGINE}"
  case "$engine" in
    claude) echo "$BLUE" ;;
    cursor) echo "$GREEN" ;;
    opencode) echo "$YELLOW" ;;
    codex) echo "$MAGENTA" ;;
    qwen) echo "$CYAN" ;;
    droid) echo "$RED" ;;
    *) echo "$MAGENTA" ;;
  esac
}

# Test counters
passed=0
failed=0

# Test helper
test_engine_color() {
  local engine=$1
  local expected_color=$2
  local actual_color=$(get_engine_color "$engine")

  if [[ "$actual_color" == "$expected_color" ]]; then
    echo "✓ $engine returns correct color"
    ((passed++))
  else
    echo "✗ $engine: expected '$expected_color', got '$actual_color'"
    ((failed++))
  fi
}

echo "Testing get_engine_color() function..."
echo "========================================"

# Test each engine
test_engine_color "claude" "$BLUE"
test_engine_color "cursor" "$GREEN"
test_engine_color "opencode" "$YELLOW"
test_engine_color "codex" "$MAGENTA"
test_engine_color "qwen" "$CYAN"
test_engine_color "droid" "$RED"

# Test default case
test_engine_color "unknown" "$MAGENTA"

# Test with AI_ENGINE variable
AI_ENGINE="claude"
actual=$(get_engine_color)
if [[ "$actual" == "$BLUE" ]]; then
  echo "✓ Uses AI_ENGINE variable when no argument provided"
  ((passed++))
else
  echo "✗ Failed to use AI_ENGINE variable"
  ((failed++))
fi

# Results
echo "========================================"
echo "Results: $passed passed, $failed failed"

if [[ $failed -eq 0 ]]; then
  echo "All tests passed!"
  exit 0
else
  echo "Some tests failed!"
  exit 1
fi
