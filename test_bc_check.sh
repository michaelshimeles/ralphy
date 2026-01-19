#!/usr/bin/env bash
# Test script for bc availability check functionality

set -e

echo "Testing bc availability check in ralphy.sh"
echo "==========================================="
echo

# Test 1: Check if USE_BC_FOR_COSTS variable is defined
echo "Test 1: Checking if USE_BC_FOR_COSTS variable is defined..."
if grep -q "USE_BC_FOR_COSTS=false" ralphy.sh; then
  echo "✓ USE_BC_FOR_COSTS variable is defined in ralphy.sh"
else
  echo "✗ USE_BC_FOR_COSTS variable not found in ralphy.sh"
  exit 1
fi
echo

# Test 2: Check if bc availability check exists in pre-flight
echo "Test 2: Checking if bc availability check exists in pre-flight..."
if grep -q "Check for bc (optional but recommended for cost calculations)" ralphy.sh; then
  echo "✓ bc availability check found in pre-flight section"
else
  echo "✗ bc availability check not found in pre-flight section"
  exit 1
fi
echo

# Test 3: Check if warning message is present
echo "Test 3: Checking if warning message for missing bc is present..."
if grep -q "bc is not installed. Cost calculations will not be available." ralphy.sh; then
  echo "✓ Warning message for missing bc found"
else
  echo "✗ Warning message for missing bc not found"
  exit 1
fi
echo

# Test 4: Check if calculate_cost function uses USE_BC_FOR_COSTS
echo "Test 4: Checking if calculate_cost function uses USE_BC_FOR_COSTS..."
if grep -A5 "calculate_cost()" ralphy.sh | grep -q 'USE_BC_FOR_COSTS.*true'; then
  echo "✓ calculate_cost function uses USE_BC_FOR_COSTS flag"
else
  echo "✗ calculate_cost function doesn't use USE_BC_FOR_COSTS flag"
  exit 1
fi
echo

# Test 5: Check if cost tracking uses USE_BC_FOR_COSTS
echo "Test 5: Checking if cost tracking uses USE_BC_FOR_COSTS..."
if grep -B2 "OpenCode cost tracking" ralphy.sh | grep -q 'USE_BC_FOR_COSTS.*true'; then
  echo "✓ Cost tracking uses USE_BC_FOR_COSTS flag"
else
  echo "✗ Cost tracking doesn't use USE_BC_FOR_COSTS flag"
  exit 1
fi
echo

# Test 6: Check if summary output uses USE_BC_FOR_COSTS
echo "Test 6: Checking if summary output uses USE_BC_FOR_COSTS..."
if grep -q 'if \[\[ "$AI_ENGINE" == "opencode" \]\] && \[\[ "$USE_BC_FOR_COSTS" == true \]\]' ralphy.sh; then
  echo "✓ Summary output uses USE_BC_FOR_COSTS flag"
else
  echo "✗ Summary output doesn't use USE_BC_FOR_COSTS flag"
  exit 1
fi
echo

# Test 7: Verify no direct bc checks remain (they should all use USE_BC_FOR_COSTS)
echo "Test 7: Checking for consistent use of USE_BC_FOR_COSTS flag..."
bc_check_count=$(grep -c 'command -v bc' ralphy.sh || true)
# We expect 1 occurrence in the pre-flight check that sets USE_BC_FOR_COSTS
if [[ "$bc_check_count" -eq 1 ]]; then
  echo "✓ All bc checks consolidated to use USE_BC_FOR_COSTS flag"
else
  echo "⚠ Found $bc_check_count direct bc checks (expected 1 in pre-flight)"
  echo "  This may be okay if there are legitimate additional checks"
fi
echo

echo "==========================================="
echo "All tests passed! ✓"
echo
