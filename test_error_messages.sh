#!/usr/bin/env bash

# Test script for improved error messages

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPHY_SH="$SCRIPT_DIR/ralphy.sh"

echo "Testing improved error messages for ralphy.sh"
echo "=============================================="
echo ""

# Helper function to test error messages
test_error() {
  local test_name="$1"
  shift
  echo "Test: $test_name"
  echo "Command: ./ralphy.sh $*"
  echo "Output:"
  if ! "$RALPHY_SH" "$@" 2>&1; then
    echo "✓ Error detected as expected"
  else
    echo "✗ Expected error but command succeeded"
  fi
  echo ""
  echo "---"
  echo ""
}

# Test 1: Unknown engine lists valid options
echo "=== Test 1: Unknown engine shows valid options ==="
test_error "Unknown single engine" --engines foobar --dry-run

# Test 2: Unknown engine in list
echo "=== Test 2: Unknown engine in list ==="
test_error "Unknown engine in list" --engines claude,foobar,cursor --dry-run

# Test 3: Invalid weight format (non-numeric)
echo "=== Test 3: Invalid weight format (non-numeric) ==="
test_error "Invalid weight (non-numeric)" --engines claude:abc --dry-run

# Test 4: Invalid weight format (negative)
echo "=== Test 4: Invalid weight format (zero) ==="
test_error "Invalid weight (zero)" --engines claude:0 --dry-run

# Test 5: Invalid weight format (special chars)
echo "=== Test 5: Invalid engine specification format ==="
test_error "Invalid specification format" --engines "claude:2:3" --dry-run

# Test 6: Empty engines argument
echo "=== Test 6: Empty engines argument ==="
test_error "Empty engines argument" --engines --dry-run

# Test 7: No valid engines available (all engines have missing CLIs)
# This is harder to test without mocking, but we can test with all fake engines
echo "=== Test 7: No valid engines available ==="
test_error "No valid engines" --engines fakeengine1,fakeengine2 --dry-run

echo ""
echo "=============================================="
echo "All tests completed!"
echo ""
echo "Note: Some tests may show warnings about missing CLIs."
echo "This is expected behavior for testing error handling."
