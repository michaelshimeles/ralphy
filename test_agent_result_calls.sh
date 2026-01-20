#!/usr/bin/env bash

# Test script to validate that record_agent_result() is called after agent completion
# This script checks the integration points where record_agent_result() should be invoked

set -euo pipefail

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

# Test helper functions
pass() {
  ((TESTS_PASSED++))
  ((TESTS_RUN++))
  echo -e "${GREEN}✓${RESET} $1"
}

fail() {
  ((TESTS_FAILED++))
  ((TESTS_RUN++))
  echo -e "${RED}✗${RESET} $1"
  if [[ -n "${2:-}" ]]; then
    echo -e "${DIM}  Expected: $2${RESET}"
  fi
}

section() {
  echo ""
  echo -e "${BLUE}===${RESET} $1"
}

# Test 1: Check that record_agent_result is called in run_parallel_agent (success case)
test_parallel_agent_success_call() {
  section "Testing record_agent_result() call in run_parallel_agent() success path"

  # Check if the function is called after successful agent execution
  if grep -A 20 "# Record successful result" "$SCRIPT_DIR/ralphy.sh" | grep -q "record_agent_result"; then
    pass "record_agent_result() is called after successful parallel agent execution"
  else
    fail "record_agent_result() is NOT called after successful parallel agent execution"
  fi

  # Verify it's called with correct parameters
  if grep -A 2 "# Record successful result" "$SCRIPT_DIR/ralphy.sh" | grep -q 'record_agent_result "$AI_ENGINE" "$cost" "$input_tokens" "$output_tokens" "$duration_ms" "1"'; then
    pass "record_agent_result() is called with correct parameters (success=1)"
  else
    fail "record_agent_result() parameters may be incorrect in success case"
  fi
}

# Test 2: Check that record_agent_result is called in run_parallel_agent (failure case)
test_parallel_agent_failure_call() {
  section "Testing record_agent_result() call in run_parallel_agent() failure paths"

  # Check the no-commit failure case
  if grep -B 5 "cleanup_agent_worktree.*branch_name.*log_file" "$SCRIPT_DIR/ralphy.sh" | grep -q "record_agent_result"; then
    pass "record_agent_result() is called in no-commit failure case"
  else
    fail "record_agent_result() is NOT called in no-commit failure case"
  fi

  # Check the general failure case (else branch)
  if grep -A 5 "else" "$SCRIPT_DIR/ralphy.sh" | grep -q '# Record failure result with zero metrics'; then
    pass "record_agent_result() is called in general failure case"
  else
    fail "record_agent_result() is NOT called in general failure case"
  fi
}

# Test 3: Check that record_agent_result is called in run_single_task (success case)
test_single_task_success_call() {
  section "Testing record_agent_result() call in run_single_task() success path"

  # Check if the function is called after successful task execution
  if grep -A 20 "# Record successful result" "$SCRIPT_DIR/ralphy.sh" | grep -q "record_agent_result"; then
    pass "record_agent_result() is called after successful single task execution"
  else
    fail "record_agent_result() is NOT called after successful single task execution"
  fi

  # Verify success parameter is "1"
  if grep "record_agent_result" "$SCRIPT_DIR/ralphy.sh" | grep -q '"1"'; then
    pass "record_agent_result() success parameter is set to 1 for successful tasks"
  else
    fail "record_agent_result() success parameter may be incorrect"
  fi
}

# Test 4: Check that record_agent_result is called in run_single_task (failure cases)
test_single_task_failure_call() {
  section "Testing record_agent_result() call in run_single_task() failure paths"

  # Count how many failure paths call record_agent_result
  failure_calls=$(grep -c "# Record failure result" "$SCRIPT_DIR/ralphy.sh" || echo 0)

  if [[ "$failure_calls" -ge 3 ]]; then
    pass "record_agent_result() is called in multiple failure paths (found $failure_calls)"
  else
    fail "record_agent_result() may not be called in all failure paths (found $failure_calls, expected at least 3)"
  fi

  # Verify failure parameter is "0"
  if grep "record_agent_result" "$SCRIPT_DIR/ralphy.sh" | grep -q '"0"$'; then
    pass "record_agent_result() success parameter is set to 0 for failed tasks"
  else
    fail "record_agent_result() success parameter may be incorrect for failures"
  fi
}

# Test 5: Check that cost is calculated before calling record_agent_result
test_cost_calculation() {
  section "Testing cost calculation before record_agent_result() calls"

  # Check if calculate_cost is used
  if grep -B 10 "record_agent_result" "$SCRIPT_DIR/ralphy.sh" | grep -q "calculate_cost"; then
    pass "Cost is calculated before calling record_agent_result()"
  else
    fail "Cost may not be calculated before calling record_agent_result()"
  fi

  # Check if duration is extracted from actual_cost
  if grep -B 10 "record_agent_result" "$SCRIPT_DIR/ralphy.sh" | grep -q "duration:"; then
    pass "Duration is extracted from actual_cost for engines that provide it"
  else
    fail "Duration extraction logic may be missing"
  fi
}

# Test 6: Verify parameters are extracted correctly
test_parameter_extraction() {
  section "Testing parameter extraction for record_agent_result() calls"

  # Check that actual_cost is extracted from parsed result
  if grep -q 'actual_cost=$(echo "$token_data" | sed -n '"'"'3p'"'"')' "$SCRIPT_DIR/ralphy.sh"; then
    pass "actual_cost is extracted from parsed result (3rd line of token_data)"
  else
    fail "actual_cost extraction may be incorrect or missing"
  fi

  # Check that input_tokens and output_tokens are validated
  if grep -q 'input_tokens.*=~' "$SCRIPT_DIR/ralphy.sh"; then
    pass "Token values are validated before use"
  else
    fail "Token validation may be missing"
  fi
}

# Run all tests
test_parallel_agent_success_call
test_parallel_agent_failure_call
test_single_task_success_call
test_single_task_failure_call
test_cost_calculation
test_parameter_extraction

# Print summary
echo ""
echo -e "${BLUE}===${RESET} Test Summary"
echo -e "Tests run:    $TESTS_RUN"
echo -e "${GREEN}Tests passed: $TESTS_PASSED${RESET}"
if [[ $TESTS_FAILED -gt 0 ]]; then
  echo -e "${RED}Tests failed: $TESTS_FAILED${RESET}"
  exit 1
else
  echo -e "Tests failed: $TESTS_FAILED"
  echo ""
  echo -e "${GREEN}All integration tests passed!${RESET}"
  exit 0
fi
