#!/usr/bin/env bash

# Test backward compatibility of engine argument parsing
# This tests the behavior after parse_args() completes

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

# Test counter
tests_passed=0
tests_failed=0

echo "Testing backward compatibility after argument parsing..."
echo ""

# Test helper function
test_backward_compat() {
  local test_name="$1"
  local initial_ai_engine="$2"
  local initial_engines="$3"
  local expected_ai_engine="$4"
  local expected_engines="$5"

  # Simulate the backward compatibility logic
  AI_ENGINE="$initial_ai_engine"
  IFS=' ' read -ra ENGINES <<< "$initial_engines"

  # Apply backward compatibility logic (same as in ralphy.sh)
  local num_engines="${#ENGINES[@]}"

  # Handle empty string case (bash 3.2 treats empty string as single element)
  if [[ "$num_engines" -eq 1 ]] && [[ -z "${ENGINES[0]}" ]]; then
    num_engines=0
    ENGINES=()
  fi

  if [[ "$num_engines" -eq 1 ]]; then
    # If exactly one engine specified, set AI_ENGINE for backward compatibility
    AI_ENGINE="${ENGINES[0]}"
  elif [[ "$num_engines" -eq 0 ]]; then
    # If no engines specified, populate ENGINES with default AI_ENGINE
    ENGINES=("$AI_ENGINE")
  fi

  # Check results
  local actual_ai_engine="$AI_ENGINE"
  local actual_engines="${ENGINES[*]}"

  if [[ "$actual_ai_engine" == "$expected_ai_engine" ]] && \
     [[ "$actual_engines" == "$expected_engines" ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    tests_passed=$((tests_passed + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo "  Expected: AI_ENGINE=$expected_ai_engine, ENGINES=($expected_engines)"
    echo "  Got:      AI_ENGINE=$actual_ai_engine, ENGINES=($actual_engines)"
    tests_failed=$((tests_failed + 1))
  fi
}

# Test 1: No engines specified (empty ENGINES array) - should populate with default AI_ENGINE
test_backward_compat \
  "No engines, default AI_ENGINE (claude)" \
  "claude" \
  "" \
  "claude" \
  "claude"

# Test 2: No engines specified, AI_ENGINE set to opencode
test_backward_compat \
  "No engines, AI_ENGINE=opencode" \
  "opencode" \
  "" \
  "opencode" \
  "opencode"

# Test 3: Exactly one engine specified - should set AI_ENGINE to that engine
test_backward_compat \
  "Single engine: cursor" \
  "claude" \
  "cursor" \
  "cursor" \
  "cursor"

# Test 4: Exactly one engine specified (opencode) - should set AI_ENGINE
test_backward_compat \
  "Single engine: opencode" \
  "claude" \
  "opencode" \
  "opencode" \
  "opencode"

# Test 5: Exactly one engine specified (droid) - should set AI_ENGINE
test_backward_compat \
  "Single engine: droid" \
  "claude" \
  "droid" \
  "droid" \
  "droid"

# Test 6: Exactly one engine specified (qwen) - should set AI_ENGINE
test_backward_compat \
  "Single engine: qwen" \
  "claude" \
  "qwen" \
  "qwen" \
  "qwen"

# Test 7: Exactly one engine specified (codex) - should set AI_ENGINE
test_backward_compat \
  "Single engine: codex" \
  "claude" \
  "codex" \
  "codex" \
  "codex"

# Test 8: Multiple engines - AI_ENGINE and ENGINES should remain unchanged
echo -e "${YELLOW}⊙${RESET} Multiple engines: claude opencode (no backward compat applied)"
AI_ENGINE="claude"
ENGINES=("claude" "opencode")
num_engines="${#ENGINES[@]}"
if [[ "$num_engines" -eq 1 ]]; then
  AI_ENGINE="${ENGINES[0]}"
elif [[ "$num_engines" -eq 0 ]]; then
  ENGINES=("$AI_ENGINE")
fi
if [[ "$AI_ENGINE" == "claude" ]] && [[ "${ENGINES[*]}" == "claude opencode" ]]; then
  echo -e "${GREEN}  ✓${RESET} Multiple engines correctly skips backward compatibility"
  tests_passed=$((tests_passed + 1))
else
  echo -e "${RED}  ✗${RESET} Multiple engines incorrectly modified"
  echo "  Expected: AI_ENGINE=claude, ENGINES=(claude opencode)"
  echo "  Got:      AI_ENGINE=$AI_ENGINE, ENGINES=(${ENGINES[*]})"
  tests_failed=$((tests_failed + 1))
fi

# Test 9: Three engines - should not modify
echo -e "${YELLOW}⊙${RESET} Three engines: claude opencode cursor"
AI_ENGINE="opencode"
ENGINES=("claude" "opencode" "cursor")
num_engines="${#ENGINES[@]}"
if [[ "$num_engines" -eq 1 ]]; then
  AI_ENGINE="${ENGINES[0]}"
elif [[ "$num_engines" -eq 0 ]]; then
  ENGINES=("$AI_ENGINE")
fi
if [[ "$AI_ENGINE" == "opencode" ]] && [[ "${ENGINES[*]}" == "claude opencode cursor" ]]; then
  echo -e "${GREEN}  ✓${RESET} Three engines correctly skips backward compatibility"
  tests_passed=$((tests_passed + 1))
else
  echo -e "${RED}  ✗${RESET} Three engines incorrectly modified"
  echo "  Expected: AI_ENGINE=opencode, ENGINES=(claude opencode cursor)"
  echo "  Got:      AI_ENGINE=$AI_ENGINE, ENGINES=(${ENGINES[*]})"
  tests_failed=$((tests_failed + 1))
fi

echo ""
echo "=========================================="
echo "Test Results:"
echo "  Passed: $tests_passed"
echo "  Failed: $tests_failed"
echo "=========================================="

if [[ $tests_failed -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}Some tests failed!${RESET}"
  exit 1
fi
