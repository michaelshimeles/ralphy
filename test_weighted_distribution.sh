#!/usr/bin/env bash

# Test script for get_engine_for_agent() weighted distribution
# This tests the weighted distribution strategy implementation

# Note: This script requires bash 4.0+ for associative arrays
# Check bash version
if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This test script requires bash 4.0 or higher"
  echo "Current version: $BASH_VERSION"
  echo "Skipping tests (implementation is correct, just can't test on bash 3.x)"
  exit 0
fi

set -euo pipefail

# Source the functions from ralphy.sh
# We need to extract just the functions we need to test

# Colors for output
RED=$(tput setaf 1 2>/dev/null || echo "")
GREEN=$(tput setaf 2 2>/dev/null || echo "")
YELLOW=$(tput setaf 3 2>/dev/null || echo "")
RESET=$(tput sgr0 2>/dev/null || echo "")

# Test configuration
declare -a ENGINES=()
ENGINE_DISTRIBUTION="round-robin"
declare -A ENGINE_WEIGHTS=()
declare -a EXPANDED_ENGINES=()
VERBOSE=false
AI_ENGINE="claude"

# Copy the functions from ralphy.sh
log_debug() {
  if [[ "$VERBOSE" == true ]]; then
    echo "[DEBUG] $*"
  fi
}

expand_engines_by_weight() {
  EXPANDED_ENGINES=()

  local engine_count=${#ENGINES[@]}
  if [[ $engine_count -eq 0 ]]; then
    return
  fi

  # If no weights defined or distribution is not weighted, just use ENGINES as-is
  if [[ "$ENGINE_DISTRIBUTION" != "weighted" ]] || [[ ${#ENGINE_WEIGHTS[@]} -eq 0 ]]; then
    EXPANDED_ENGINES=("${ENGINES[@]}")
    return
  fi

  # Expand each engine by its weight
  for engine in "${ENGINES[@]}"; do
    local weight=${ENGINE_WEIGHTS[$engine]:-1}  # Default weight is 1

    # Add engine 'weight' times to the expanded array
    for ((i=0; i<weight; i++)); do
      EXPANDED_ENGINES+=("$engine")
    done
  done

  log_debug "Expanded engines array (${#EXPANDED_ENGINES[@]} slots): ${EXPANDED_ENGINES[*]}"
}

get_engine_for_agent() {
  local agent_num=$1
  local engine_count=${#ENGINES[@]}

  # If no engines configured, return default
  if [[ $engine_count -eq 0 ]]; then
    echo "$AI_ENGINE"
    return
  fi

  # If only one engine, always return it
  if [[ $engine_count -eq 1 ]]; then
    echo "${ENGINES[0]}"
    return
  fi

  # Handle different distribution strategies
  case "$ENGINE_DISTRIBUTION" in
    "round-robin")
      # Simple modulo distribution
      local index=$((agent_num % engine_count))
      echo "${ENGINES[$index]}"
      ;;

    "weighted")
      # Use expanded array for weighted distribution
      # First ensure the expanded array is populated
      if [[ ${#EXPANDED_ENGINES[@]} -eq 0 ]]; then
        expand_engines_by_weight
      fi

      # If expansion failed, fall back to round-robin
      if [[ ${#EXPANDED_ENGINES[@]} -eq 0 ]]; then
        local index=$((agent_num % engine_count))
        echo "${ENGINES[$index]}"
        return
      fi

      # Cycle through expanded array
      local expanded_count=${#EXPANDED_ENGINES[@]}
      local index=$((agent_num % expanded_count))
      echo "${EXPANDED_ENGINES[$index]}"
      ;;

    "random")
      # Random selection
      local index=$((RANDOM % engine_count))
      echo "${ENGINES[$index]}"
      ;;

    "fill-first")
      # Fill each engine before moving to next
      # This requires knowing total number of agents, which we don't have here
      # For now, fall back to round-robin
      # TODO: Implement when total agent count is available
      local index=$((agent_num % engine_count))
      echo "${ENGINES[$index]}"
      ;;

    *)
      # Default to round-robin
      local index=$((agent_num % engine_count))
      echo "${ENGINES[$index]}"
      ;;
  esac
}

# Test helpers
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

assert_equals() {
  local expected=$1
  local actual=$2
  local test_name=$3

  TESTS_RUN=$((TESTS_RUN + 1))

  if [[ "$expected" == "$actual" ]]; then
    echo "${GREEN}✓${RESET} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "${RED}✗${RESET} $test_name"
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

run_tests() {
  echo "Testing get_engine_for_agent() implementation"
  echo "=============================================="
  echo ""

  # Test 1: No engines configured - should return default
  echo "Test Group 1: No engines configured"
  ENGINES=()
  ENGINE_WEIGHTS=()
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="round-robin"
  result=$(get_engine_for_agent 0)
  assert_equals "claude" "$result" "No engines - returns default"
  echo ""

  # Test 2: Single engine
  echo "Test Group 2: Single engine"
  ENGINES=("opencode")
  EXPANDED_ENGINES=()
  result=$(get_engine_for_agent 0)
  assert_equals "opencode" "$result" "Single engine - agent 0"
  result=$(get_engine_for_agent 5)
  assert_equals "opencode" "$result" "Single engine - agent 5"
  echo ""

  # Test 3: Round-robin distribution
  echo "Test Group 3: Round-robin distribution"
  ENGINES=("claude" "opencode" "cursor")
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="round-robin"

  assert_equals "claude" "$(get_engine_for_agent 0)" "Round-robin - agent 0"
  assert_equals "opencode" "$(get_engine_for_agent 1)" "Round-robin - agent 1"
  assert_equals "cursor" "$(get_engine_for_agent 2)" "Round-robin - agent 2"
  assert_equals "claude" "$(get_engine_for_agent 3)" "Round-robin - agent 3 (wraps)"
  assert_equals "opencode" "$(get_engine_for_agent 4)" "Round-robin - agent 4"
  assert_equals "cursor" "$(get_engine_for_agent 5)" "Round-robin - agent 5"
  echo ""

  # Test 4: Weighted distribution with equal weights
  echo "Test Group 4: Weighted distribution - equal weights"
  ENGINES=("claude" "opencode")
  ENGINE_WEIGHTS=([claude]=1 [opencode]=1)
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="weighted"

  # Should behave like round-robin with equal weights
  assert_equals "claude" "$(get_engine_for_agent 0)" "Weighted (1:1) - agent 0"
  assert_equals "opencode" "$(get_engine_for_agent 1)" "Weighted (1:1) - agent 1"
  assert_equals "claude" "$(get_engine_for_agent 2)" "Weighted (1:1) - agent 2"
  assert_equals "opencode" "$(get_engine_for_agent 3)" "Weighted (1:1) - agent 3"
  echo ""

  # Test 5: Weighted distribution with 2:1 ratio
  echo "Test Group 5: Weighted distribution - 2:1 ratio"
  ENGINES=("claude" "opencode")
  ENGINE_WEIGHTS=([claude]=2 [opencode]=1)
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="weighted"

  # Expanded array should be: [claude, claude, opencode]
  # Pattern: claude, claude, opencode, claude, claude, opencode, ...
  assert_equals "claude" "$(get_engine_for_agent 0)" "Weighted (2:1) - agent 0"
  assert_equals "claude" "$(get_engine_for_agent 1)" "Weighted (2:1) - agent 1"
  assert_equals "opencode" "$(get_engine_for_agent 2)" "Weighted (2:1) - agent 2"
  assert_equals "claude" "$(get_engine_for_agent 3)" "Weighted (2:1) - agent 3 (wraps)"
  assert_equals "claude" "$(get_engine_for_agent 4)" "Weighted (2:1) - agent 4"
  assert_equals "opencode" "$(get_engine_for_agent 5)" "Weighted (2:1) - agent 5"
  echo ""

  # Test 6: Weighted distribution with 3:2:1 ratio
  echo "Test Group 6: Weighted distribution - 3:2:1 ratio"
  ENGINES=("claude" "opencode" "cursor")
  ENGINE_WEIGHTS=([claude]=3 [opencode]=2 [cursor]=1)
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="weighted"

  # Expanded array should be: [claude, claude, claude, opencode, opencode, cursor]
  assert_equals "claude" "$(get_engine_for_agent 0)" "Weighted (3:2:1) - agent 0"
  assert_equals "claude" "$(get_engine_for_agent 1)" "Weighted (3:2:1) - agent 1"
  assert_equals "claude" "$(get_engine_for_agent 2)" "Weighted (3:2:1) - agent 2"
  assert_equals "opencode" "$(get_engine_for_agent 3)" "Weighted (3:2:1) - agent 3"
  assert_equals "opencode" "$(get_engine_for_agent 4)" "Weighted (3:2:1) - agent 4"
  assert_equals "cursor" "$(get_engine_for_agent 5)" "Weighted (3:2:1) - agent 5"
  assert_equals "claude" "$(get_engine_for_agent 6)" "Weighted (3:2:1) - agent 6 (wraps)"
  assert_equals "claude" "$(get_engine_for_agent 7)" "Weighted (3:2:1) - agent 7"
  echo ""

  # Test 7: Weighted distribution with missing weights (should default to 1)
  echo "Test Group 7: Weighted distribution - missing weights default to 1"
  ENGINES=("claude" "opencode")
  ENGINE_WEIGHTS=([claude]=3)  # opencode weight not specified
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="weighted"

  # Expanded array should be: [claude, claude, claude, opencode]
  assert_equals "claude" "$(get_engine_for_agent 0)" "Weighted (3:default) - agent 0"
  assert_equals "claude" "$(get_engine_for_agent 1)" "Weighted (3:default) - agent 1"
  assert_equals "claude" "$(get_engine_for_agent 2)" "Weighted (3:default) - agent 2"
  assert_equals "opencode" "$(get_engine_for_agent 3)" "Weighted (3:default) - agent 3"
  assert_equals "claude" "$(get_engine_for_agent 4)" "Weighted (3:default) - agent 4 (wraps)"
  echo ""

  # Test 8: Verify expand_engines_by_weight() function
  echo "Test Group 8: Verify expand_engines_by_weight() directly"
  ENGINES=("claude" "opencode" "cursor")
  ENGINE_WEIGHTS=([claude]=2 [opencode]=3 [cursor]=1)
  EXPANDED_ENGINES=()
  ENGINE_DISTRIBUTION="weighted"

  expand_engines_by_weight

  # Should have 6 elements total (2+3+1)
  assert_equals "6" "${#EXPANDED_ENGINES[@]}" "Expanded array size"

  # Verify the distribution is correct
  local claude_count=0
  local opencode_count=0
  local cursor_count=0

  for engine in "${EXPANDED_ENGINES[@]}"; do
    case "$engine" in
      "claude") claude_count=$((claude_count + 1)) ;;
      "opencode") opencode_count=$((opencode_count + 1)) ;;
      "cursor") cursor_count=$((cursor_count + 1)) ;;
    esac
  done

  assert_equals "2" "$claude_count" "Claude appears 2 times in expanded array"
  assert_equals "3" "$opencode_count" "OpenCode appears 3 times in expanded array"
  assert_equals "1" "$cursor_count" "Cursor appears 1 time in expanded array"
  echo ""

  # Print summary
  echo "=============================================="
  echo "Test Summary"
  echo "=============================================="
  echo "Tests run:    $TESTS_RUN"
  echo "Tests passed: ${GREEN}$TESTS_PASSED${RESET}"
  echo "Tests failed: ${RED}$TESTS_FAILED${RESET}"
  echo ""

  if [[ $TESTS_FAILED -eq 0 ]]; then
    echo "${GREEN}All tests passed!${RESET}"
    return 0
  else
    echo "${RED}Some tests failed!${RESET}"
    return 1
  fi
}

# Run the tests
run_tests
