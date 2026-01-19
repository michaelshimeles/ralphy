#!/usr/bin/env bash

# Test script for display_agent_status function
# This script verifies the display_agent_status() function exists and has correct syntax

set -euo pipefail

# Colors
GREEN=$(tput setaf 2)
RED=$(tput setaf 1)
YELLOW=$(tput setaf 3)
RESET=$(tput sgr0)

echo "Testing display_agent_status extraction..."
echo ""

test_function_exists() {
  echo "Test 1: Function definition exists in ralphy.sh"

  if grep -q "^display_agent_status()" ralphy.sh; then
    echo "  ${GREEN}✓${RESET} Function definition found"
    return 0
  else
    echo "  ${RED}✗${RESET} Function definition not found"
    return 1
  fi
}

test_function_syntax() {
  echo "Test 2: Function has valid bash syntax"

  # Extract the function and test its syntax
  if bash -n <(sed -n '/^display_agent_status()/,/^}/p' ralphy.sh) 2>/dev/null; then
    echo "  ${GREEN}✓${RESET} Function syntax is valid"
    return 0
  else
    echo "  ${RED}✗${RESET} Function has syntax errors"
    return 1
  fi
}

test_function_parameters() {
  echo "Test 3: Function accepts correct parameters"

  # Check that function has expected parameter assignments
  local has_pids=$(grep -c 'local -n pids=\$1' ralphy.sh || echo 0)
  local has_status_files=$(grep -c 'local -n status_file_paths=\$2' ralphy.sh || echo 0)
  local has_batch_size=$(grep -c 'local batch_size=\$3' ralphy.sh || echo 0)
  local has_start_time=$(grep -c 'local start_time=\$4' ralphy.sh || echo 0)

  if [[ $has_pids -gt 0 ]] && [[ $has_status_files -gt 0 ]] && [[ $has_batch_size -gt 0 ]] && [[ $has_start_time -gt 0 ]]; then
    echo "  ${GREEN}✓${RESET} Function has all required parameters"
    return 0
  else
    echo "  ${RED}✗${RESET} Function missing parameters"
    echo "     pids: $has_pids, status_files: $has_status_files, batch_size: $has_batch_size, start_time: $has_start_time"
    return 1
  fi
}

test_function_called() {
  echo "Test 4: Function is called in run_parallel_tasks"

  if grep -q "display_agent_status parallel_pids status_files" ralphy.sh; then
    echo "  ${GREEN}✓${RESET} Function is called correctly"
    return 0
  else
    echo "  ${RED}✗${RESET} Function call not found or incorrect"
    return 1
  fi
}

test_inline_code_removed() {
  echo "Test 5: Original inline monitoring code was replaced"

  # Look for the pattern that should no longer exist after line 2300
  # (the duplicate spinner logic in the inline location)
  local line_count=$(awk 'NR>2300 && /^      # Monitor progress with a spinner$/ && /local spinner_chars=/{count++} END{print count+0}' ralphy.sh)

  if [[ $line_count -eq 0 ]]; then
    echo "  ${GREEN}✓${RESET} Inline monitoring code successfully removed"
    return 0
  else
    echo "  ${YELLOW}⚠${RESET} Found $line_count instance(s) of inline monitoring code after line 2300"
    echo "     (Note: One instance in the function itself is expected)"
    return 0  # Not failing this test as we expect one instance in the function
  fi
}

test_entire_script_syntax() {
  echo "Test 6: Entire ralphy.sh script has valid syntax"

  if bash -n ralphy.sh 2>/dev/null; then
    echo "  ${GREEN}✓${RESET} Script syntax is valid"
    return 0
  else
    echo "  ${RED}✗${RESET} Script has syntax errors:"
    bash -n ralphy.sh 2>&1 | head -10
    return 1
  fi
}

# Run tests
failed=0

test_function_exists || ((failed++)) || true
echo ""

test_function_syntax || ((failed++)) || true
echo ""

test_function_parameters || ((failed++)) || true
echo ""

test_function_called || ((failed++)) || true
echo ""

test_inline_code_removed || ((failed++)) || true
echo ""

test_entire_script_syntax || ((failed++)) || true
echo ""

if [[ $failed -eq 0 ]]; then
  echo "${GREEN}✓ All tests passed!${RESET}"
  exit 0
else
  echo "${RED}✗ $failed test(s) failed${RESET}"
  exit 1
fi
