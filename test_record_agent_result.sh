#!/usr/bin/env bash

# Test script for record_agent_result() function
# This script validates the function implementation and syntax
# NOTE: Requires bash 4.0+ for associative array support

set -euo pipefail

# Check bash version
BASH_MAJOR_VERSION="${BASH_VERSINFO[0]}"
if [[ "$BASH_MAJOR_VERSION" -lt 4 ]]; then
  echo "ERROR: This script requires bash 4.0 or higher for associative array support"
  echo "Current bash version: $BASH_VERSION"
  echo "Please install bash 4.0+ or run on a system with a newer bash version"
  echo ""
  echo "On macOS, you can install bash via Homebrew:"
  echo "  brew install bash"
  echo ""
  exit 1
fi

# Source the main script to get access to the function
# We need to extract just the function and its dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color codes for test output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Initialize engine tracking arrays
declare -A ENGINE_AGENT_COUNT=()
declare -A ENGINE_SUCCESS=()
declare -A ENGINE_FAILURES=()
declare -A ENGINE_COSTS=()
declare -A ENGINE_TOKENS_IN=()
declare -A ENGINE_TOKENS_OUT=()
declare -A ENGINE_DURATION_MS=()

# Mock log_debug function
log_debug() {
  if [[ "${VERBOSE:-false}" == true ]]; then
    echo "${DIM}[DEBUG] $*${RESET}"
  fi
}

# Mock log_error function
log_error() {
  echo "${RED}[ERROR]${RESET} $*" >&2
}

# Copy the record_agent_result function here
record_agent_result() {
  local engine="$1"
  local cost="$2"
  local tokens_in="$3"
  local tokens_out="$4"
  local duration_ms="$5"
  local success="$6"

  # Validate parameters
  if [[ -z "$engine" ]]; then
    log_error "record_agent_result: engine parameter is required"
    return 1
  fi

  # Initialize engine metrics if not already set
  if [[ -z "${ENGINE_AGENT_COUNT[$engine]:-}" ]]; then
    ENGINE_AGENT_COUNT[$engine]=0
    ENGINE_SUCCESS[$engine]=0
    ENGINE_FAILURES[$engine]=0
    ENGINE_COSTS[$engine]="0"
    ENGINE_TOKENS_IN[$engine]=0
    ENGINE_TOKENS_OUT[$engine]=0
    ENGINE_DURATION_MS[$engine]=0
  fi

  # Increment agent count
  ENGINE_AGENT_COUNT[$engine]=$((ENGINE_AGENT_COUNT[$engine] + 1))

  # Track success/failure
  if [[ "$success" == "1" ]]; then
    ENGINE_SUCCESS[$engine]=$((ENGINE_SUCCESS[$engine] + 1))
  else
    ENGINE_FAILURES[$engine]=$((ENGINE_FAILURES[$engine] + 1))
  fi

  # Aggregate tokens
  ENGINE_TOKENS_IN[$engine]=$((ENGINE_TOKENS_IN[$engine] + tokens_in))
  ENGINE_TOKENS_OUT[$engine]=$((ENGINE_TOKENS_OUT[$engine] + tokens_out))

  # Aggregate duration (if provided)
  if [[ -n "$duration_ms" && "$duration_ms" != "0" ]]; then
    ENGINE_DURATION_MS[$engine]=$((ENGINE_DURATION_MS[$engine] + duration_ms))
  fi

  # Aggregate cost using bc if available
  if [[ -n "$cost" && "$cost" != "N/A" && "$cost" != "0" ]]; then
    if command -v bc &>/dev/null; then
      local current_cost="${ENGINE_COSTS[$engine]}"
      ENGINE_COSTS[$engine]=$(echo "scale=4; $current_cost + $cost" | bc)
    else
      # Fallback: attempt integer arithmetic (will lose precision)
      log_debug "bc not available, cost aggregation may lose precision"
      ENGINE_COSTS[$engine]="N/A"
    fi
  fi

  log_debug "Recorded result for $engine: tokens_in=$tokens_in, tokens_out=$tokens_out, cost=$cost, success=$success"
}

# Test helper functions
assert_equals() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  if [[ "$expected" == "$actual" ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo -e "  Expected: $expected"
    echo -e "  Actual:   $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

reset_metrics() {
  ENGINE_AGENT_COUNT=()
  ENGINE_SUCCESS=()
  ENGINE_FAILURES=()
  ENGINE_COSTS=()
  ENGINE_TOKENS_IN=()
  ENGINE_TOKENS_OUT=()
  ENGINE_DURATION_MS=()
}

# ============================================
# TEST CASES
# ============================================

echo "Testing record_agent_result() function"
echo "========================================"
echo ""

# Test 1: Basic single agent success
echo "Test Suite: Basic Functionality"
reset_metrics
record_agent_result "claude" "0.0015" 1000 500 0 1
assert_equals "1" "${ENGINE_AGENT_COUNT[claude]}" "Single agent increments count"
assert_equals "1" "${ENGINE_SUCCESS[claude]}" "Success is recorded"
assert_equals "0" "${ENGINE_FAILURES[claude]}" "No failures recorded"
assert_equals "1000" "${ENGINE_TOKENS_IN[claude]}" "Input tokens recorded"
assert_equals "500" "${ENGINE_TOKENS_OUT[claude]}" "Output tokens recorded"
echo ""

# Test 2: Multiple agents for same engine
echo "Test Suite: Multiple Agents"
reset_metrics
record_agent_result "claude" "0.0015" 1000 500 0 1
record_agent_result "claude" "0.0020" 1500 750 0 1
assert_equals "2" "${ENGINE_AGENT_COUNT[claude]}" "Agent count accumulates"
assert_equals "2" "${ENGINE_SUCCESS[claude]}" "Success count accumulates"
assert_equals "2500" "${ENGINE_TOKENS_IN[claude]}" "Input tokens accumulate"
assert_equals "1250" "${ENGINE_TOKENS_OUT[claude]}" "Output tokens accumulate"

if command -v bc &>/dev/null; then
  expected_cost="0.0035"
  actual_cost="${ENGINE_COSTS[claude]}"
  assert_equals "$expected_cost" "$actual_cost" "Costs accumulate correctly (with bc)"
else
  echo -e "${YELLOW}⚠${RESET} Cost accumulation test skipped (bc not available)"
fi
echo ""

# Test 3: Multiple engines
echo "Test Suite: Multiple Engines"
reset_metrics
record_agent_result "claude" "0.0015" 1000 500 0 1
record_agent_result "cursor" "0.0020" 2000 1000 5000 1
record_agent_result "opencode" "0.0025" 3000 1500 0 1
assert_equals "1" "${ENGINE_AGENT_COUNT[claude]}" "Claude agent count"
assert_equals "1" "${ENGINE_AGENT_COUNT[cursor]}" "Cursor agent count"
assert_equals "1" "${ENGINE_AGENT_COUNT[opencode]}" "OpenCode agent count"
assert_equals "1000" "${ENGINE_TOKENS_IN[claude]}" "Claude input tokens"
assert_equals "2000" "${ENGINE_TOKENS_IN[cursor]}" "Cursor input tokens"
assert_equals "3000" "${ENGINE_TOKENS_IN[opencode]}" "OpenCode input tokens"
echo ""

# Test 4: Success and failure tracking
echo "Test Suite: Success/Failure Tracking"
reset_metrics
record_agent_result "claude" "0.0015" 1000 500 0 1
record_agent_result "claude" "0.0020" 1500 750 0 0
record_agent_result "claude" "0.0025" 2000 1000 0 1
assert_equals "3" "${ENGINE_AGENT_COUNT[claude]}" "Total agents"
assert_equals "2" "${ENGINE_SUCCESS[claude]}" "Success count"
assert_equals "1" "${ENGINE_FAILURES[claude]}" "Failure count"
echo ""

# Test 5: Duration tracking
echo "Test Suite: Duration Tracking"
reset_metrics
record_agent_result "cursor" "0.0020" 1000 500 5000 1
record_agent_result "cursor" "0.0025" 1500 750 3000 1
assert_equals "8000" "${ENGINE_DURATION_MS[cursor]}" "Duration accumulates"
echo ""

# Test 6: Zero values handling
echo "Test Suite: Edge Cases - Zero Values"
reset_metrics
record_agent_result "claude" "0" 0 0 0 1
assert_equals "1" "${ENGINE_AGENT_COUNT[claude]}" "Agent count with zero tokens"
assert_equals "0" "${ENGINE_TOKENS_IN[claude]}" "Zero input tokens"
assert_equals "0" "${ENGINE_TOKENS_OUT[claude]}" "Zero output tokens"
assert_equals "0" "${ENGINE_COSTS[claude]}" "Zero cost"
echo ""

# Test 7: Error handling - missing engine
echo "Test Suite: Error Handling"
if record_agent_result "" "0.0015" 1000 500 0 1 2>/dev/null; then
  echo -e "${RED}✗${RESET} Should fail with missing engine parameter"
  TESTS_FAILED=$((TESTS_FAILED + 1))
else
  echo -e "${GREEN}✓${RESET} Correctly fails with missing engine parameter"
  TESTS_PASSED=$((TESTS_PASSED + 1))
fi
TESTS_RUN=$((TESTS_RUN + 1))
echo ""

# Test 8: Large numbers
echo "Test Suite: Large Numbers"
reset_metrics
record_agent_result "claude" "1.5000" 1000000 500000 0 1
record_agent_result "claude" "2.7500" 2000000 1000000 0 1
assert_equals "3000000" "${ENGINE_TOKENS_IN[claude]}" "Large input tokens"
assert_equals "1500000" "${ENGINE_TOKENS_OUT[claude]}" "Large output tokens"
if command -v bc &>/dev/null; then
  expected_cost="4.2500"
  actual_cost="${ENGINE_COSTS[claude]}"
  assert_equals "$expected_cost" "$actual_cost" "Large cost values"
fi
echo ""

# ============================================
# TEST SUMMARY
# ============================================

echo "========================================"
echo "Test Results:"
echo "  Total:  $TESTS_RUN"
echo -e "  ${GREEN}Passed: $TESTS_PASSED${RESET}"
echo -e "  ${RED}Failed: $TESTS_FAILED${RESET}"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}Some tests failed!${RESET}"
  exit 1
fi
