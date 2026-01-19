#!/bin/bash

# Test script for --engine-distribution CLI argument
# This tests that the argument is properly parsed and validated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPHY="$SCRIPT_DIR/ralphy.sh"

# Colors
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

test_count=0
pass_count=0
fail_count=0

# Test helper functions
test_passed() {
  echo -e "${GREEN}✓${RESET} $1"
  ((pass_count++))
  ((test_count++))
}

test_failed() {
  echo -e "${RED}✗${RESET} $1"
  echo "  Expected: $2"
  echo "  Got: $3"
  ((fail_count++))
  ((test_count++))
}

# Test 1: Default value is round-robin
echo "Testing default ENGINE_DISTRIBUTION value..."
output=$("$RALPHY" --help 2>&1 | grep -i "engine" || true)
if grep -q "ENGINE_DISTRIBUTION=\"round-robin\"" "$RALPHY"; then
  test_passed "Default ENGINE_DISTRIBUTION is round-robin"
else
  test_failed "Default ENGINE_DISTRIBUTION is round-robin" "round-robin" "not found"
fi

# Test 2: Valid value - round-robin
echo "Testing --engine-distribution round-robin..."
# We'll do a dry run to check if it parses correctly without errors
if "$RALPHY" --engine-distribution round-robin --dry-run "test" 2>&1 | grep -q "ERROR\|Invalid"; then
  test_failed "--engine-distribution round-robin" "success" "error"
else
  test_passed "--engine-distribution round-robin accepts valid value"
fi

# Test 3: Valid value - weighted
echo "Testing --engine-distribution weighted..."
if "$RALPHY" --engine-distribution weighted --dry-run "test" 2>&1 | grep -q "ERROR\|Invalid"; then
  test_failed "--engine-distribution weighted" "success" "error"
else
  test_passed "--engine-distribution weighted accepts valid value"
fi

# Test 4: Valid value - random
echo "Testing --engine-distribution random..."
if "$RALPHY" --engine-distribution random --dry-run "test" 2>&1 | grep -q "ERROR\|Invalid"; then
  test_failed "--engine-distribution random" "success" "error"
else
  test_passed "--engine-distribution random accepts valid value"
fi

# Test 5: Valid value - fill-first
echo "Testing --engine-distribution fill-first..."
if "$RALPHY" --engine-distribution fill-first --dry-run "test" 2>&1 | grep -q "ERROR\|Invalid"; then
  test_failed "--engine-distribution fill-first" "success" "error"
else
  test_passed "--engine-distribution fill-first accepts valid value"
fi

# Test 6: Invalid value should error
echo "Testing --engine-distribution with invalid value..."
if "$RALPHY" --engine-distribution invalid-value "test" 2>&1 | grep -q "Invalid engine distribution"; then
  test_passed "--engine-distribution rejects invalid value"
else
  test_failed "--engine-distribution rejects invalid value" "error message" "no error"
fi

# Test 7: Missing value should error
echo "Testing --engine-distribution without value..."
if "$RALPHY" --engine-distribution 2>&1 | grep -q "requires an argument"; then
  test_passed "--engine-distribution requires an argument"
else
  test_failed "--engine-distribution requires an argument" "error message" "no error"
fi

# Summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Total tests: $test_count"
echo -e "${GREEN}Passed: $pass_count${RESET}"
echo -e "${RED}Failed: $fail_count${RESET}"
echo "========================================"

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}Some tests failed.${RESET}"
  exit 1
fi
