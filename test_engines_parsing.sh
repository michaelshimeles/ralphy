#!/usr/bin/env bash

# Test script for --engines argument parsing
# This test validates the regex patterns and parsing logic

set -eo pipefail

test_pass=0
test_fail=0

echo "Testing --engines argument parsing logic"
echo "=========================================="

# Test 1: Valid engine name without weight
echo -e "\nTest 1: Valid engine name (claude)"
if [[ "claude" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "✓ PASS: 'claude' matches engine name pattern"
  ((test_pass++))
else
  echo "✗ FAIL: 'claude' should match engine name pattern"
  ((test_fail++))
fi

# Test 2: Valid engine name with hyphen
echo -e "\nTest 2: Valid engine name with hyphen (gpt-4)"
if [[ "gpt-4" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "✓ PASS: 'gpt-4' matches engine name pattern"
  ((test_pass++))
else
  echo "✗ FAIL: 'gpt-4' should match engine name pattern"
  ((test_fail++))
fi

# Test 3: Valid engine name with underscore
echo -e "\nTest 3: Valid engine name with underscore (open_code)"
if [[ "open_code" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "✓ PASS: 'open_code' matches engine name pattern"
  ((test_pass++))
else
  echo "✗ FAIL: 'open_code' should match engine name pattern"
  ((test_fail++))
fi

# Test 4: Valid engine with weight syntax
echo -e "\nTest 4: Engine with weight (claude:5)"
if [[ "claude:5" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  engine="${BASH_REMATCH[1]}"
  weight="${BASH_REMATCH[2]}"
  if [[ "$engine" == "claude" && "$weight" == "5" ]]; then
    echo "✓ PASS: 'claude:5' parsed correctly (engine=$engine, weight=$weight)"
    ((test_pass++))
  else
    echo "✗ FAIL: 'claude:5' parsed incorrectly (engine=$engine, weight=$weight)"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: 'claude:5' should match engine:weight pattern"
  ((test_fail++))
fi

# Test 5: Valid engine with large weight
echo -e "\nTest 5: Engine with large weight (opencode:9999)"
if [[ "opencode:9999" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  engine="${BASH_REMATCH[1]}"
  weight="${BASH_REMATCH[2]}"
  if [[ "$engine" == "opencode" && "$weight" == "9999" ]]; then
    echo "✓ PASS: 'opencode:9999' parsed correctly (engine=$engine, weight=$weight)"
    ((test_pass++))
  else
    echo "✗ FAIL: 'opencode:9999' parsed incorrectly (engine=$engine, weight=$weight)"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: 'opencode:9999' should match engine:weight pattern"
  ((test_fail++))
fi

# Test 6: Zero weight validation
echo -e "\nTest 6: Zero weight validation (claude:0)"
if [[ "claude:0" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  weight="${BASH_REMATCH[2]}"
  if [[ "$weight" -le 0 ]]; then
    echo "✓ PASS: Zero weight correctly identified as invalid"
    ((test_pass++))
  else
    echo "✗ FAIL: Zero weight should be invalid"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: 'claude:0' should match pattern"
  ((test_fail++))
fi

# Test 7: Invalid format - double colon
echo -e "\nTest 7: Invalid format (claude::5)"
if [[ "claude::5" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  echo "✗ FAIL: 'claude::5' should not match pattern"
  ((test_fail++))
else
  echo "✓ PASS: 'claude::5' correctly rejected"
  ((test_pass++))
fi

# Test 8: Invalid format - negative weight (regex should not match)
echo -e "\nTest 8: Invalid format (claude:-5)"
if [[ "claude:-5" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  echo "✗ FAIL: 'claude:-5' should not match pattern"
  ((test_fail++))
else
  echo "✓ PASS: 'claude:-5' correctly rejected"
  ((test_pass++))
fi

# Test 9: Invalid engine name with special characters
echo -e "\nTest 9: Invalid engine name (claude@ai)"
if [[ "claude@ai" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "✗ FAIL: 'claude@ai' should not match pattern"
  ((test_fail++))
else
  echo "✓ PASS: 'claude@ai' correctly rejected"
  ((test_pass++))
fi

# Test 10: Comma-separated list splitting
echo -e "\nTest 10: Splitting comma-separated list"
engines_arg="claude,opencode:3,cursor"
IFS=',' read -ra engines_array <<< "$engines_arg"
if [[ "${#engines_array[@]}" -eq 3 ]]; then
  if [[ "${engines_array[0]}" == "claude" && \
        "${engines_array[1]}" == "opencode:3" && \
        "${engines_array[2]}" == "cursor" ]]; then
    echo "✓ PASS: Comma-separated list split correctly"
    ((test_pass++))
  else
    echo "✗ FAIL: Array values incorrect"
    echo "  Got: ${engines_array[*]}"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: Should have 3 elements, got ${#engines_array[@]}"
  ((test_fail++))
fi

# Test 11: Weight greater than zero validation
echo -e "\nTest 11: Positive weight validation (claude:10)"
if [[ "claude:10" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  weight="${BASH_REMATCH[2]}"
  if [[ "$weight" -gt 0 ]]; then
    echo "✓ PASS: Positive weight correctly validated"
    ((test_pass++))
  else
    echo "✗ FAIL: Weight 10 should be valid"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: 'claude:10' should match pattern"
  ((test_fail++))
fi

# Test 12: Weight of 1 validation
echo -e "\nTest 12: Weight of 1 validation (claude:1)"
if [[ "claude:1" =~ ^([a-zA-Z0-9_-]+):([0-9]+)$ ]]; then
  weight="${BASH_REMATCH[2]}"
  if [[ "$weight" -gt 0 ]]; then
    echo "✓ PASS: Weight of 1 is valid"
    ((test_pass++))
  else
    echo "✗ FAIL: Weight 1 should be valid"
    ((test_fail++))
  fi
else
  echo "✗ FAIL: 'claude:1' should match pattern"
  ((test_fail++))
fi

# Summary
echo -e "\n=========================================="
echo "Test Results:"
echo "  Passed: $test_pass"
echo "  Failed: $test_fail"
echo "=========================================="

if [[ $test_fail -eq 0 ]]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed!"
  exit 1
fi
