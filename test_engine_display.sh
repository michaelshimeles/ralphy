#!/usr/bin/env bash

# Test script for engine name display in status messages
# This script tests the get_engine_short_name function

set -eo pipefail

# Source the function from ralphy.sh
source_function() {
  # Extract just the get_engine_short_name function from ralphy.sh
  sed -n '/^get_engine_short_name()/,/^}/p' ralphy.sh > /tmp/test_function.sh
  source /tmp/test_function.sh
}

source_function

echo "Testing get_engine_short_name function..."
echo ""

# Test function
test_engine() {
  local engine=$1
  local expected=$2
  AI_ENGINE="$engine"
  local result=$(get_engine_short_name)

  if [[ "$result" == "$expected" ]]; then
    echo "✓ $engine -> $result"
    return 0
  else
    echo "✗ $engine -> $result (expected: $expected)"
    return 1
  fi
}

passed=0
failed=0

# Test all supported engines
if test_engine "claude" "claude"; then ((passed++)); else ((failed++)); fi
if test_engine "opencode" "opencode"; then ((passed++)); else ((failed++)); fi
if test_engine "cursor" "cursor"; then ((passed++)); else ((failed++)); fi
if test_engine "codex" "codex"; then ((passed++)); else ((failed++)); fi
if test_engine "qwen" "qwen"; then ((passed++)); else ((failed++)); fi
if test_engine "droid" "droid"; then ((passed++)); else ((failed++)); fi
if test_engine "unknown" "claude"; then ((passed++)); else ((failed++)); fi  # Default case

echo ""
echo "Tests passed: $passed"
echo "Tests failed: $failed"

# Cleanup
rm -f /tmp/test_function.sh

exit $failed
