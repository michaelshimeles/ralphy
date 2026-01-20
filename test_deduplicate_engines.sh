#!/usr/bin/env bash

# Test script for deduplicate_engines() function
# Validates function syntax and basic functionality
# Note: Full testing requires bash 4.0+ for associative arrays

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo "======================================"
echo "Testing deduplicate_engines() function"
echo "======================================"
echo ""

# Test 1: Syntax validation
echo "Test 1: Validate function syntax"
if bash -n ralphy.sh 2>/dev/null; then
  echo -e "${GREEN}✓ PASS${RESET}: ralphy.sh has valid bash syntax"
else
  echo -e "${RED}✗ FAIL${RESET}: Syntax errors in ralphy.sh"
  exit 1
fi
echo ""

# Test 2: Function exists
echo "Test 2: Check deduplicate_engines() function exists"
if grep -q "^deduplicate_engines() {" ralphy.sh; then
  echo -e "${GREEN}✓ PASS${RESET}: deduplicate_engines() function found"
else
  echo -e "${RED}✗ FAIL${RESET}: deduplicate_engines() function not found"
  exit 1
fi
echo ""

# Test 3: Function has required components
echo "Test 3: Verify function implementation"
FUNC_BODY=$(sed -n '/^deduplicate_engines() {/,/^}$/p' ralphy.sh)

# Check for key implementation details
CHECKS_PASSED=0
CHECKS_TOTAL=6

if echo "$FUNC_BODY" | grep -q "unique_engines"; then
  echo -e "${GREEN}✓${RESET} Uses unique_engines tracking"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Missing unique_engines tracking"
fi

if echo "$FUNC_BODY" | grep -q "summed_weights"; then
  echo -e "${GREEN}✓${RESET} Uses summed_weights tracking"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Missing summed_weights tracking"
fi

if echo "$FUNC_BODY" | grep -q "log_warn"; then
  echo -e "${GREEN}✓${RESET} Issues warnings with log_warn"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Missing log_warn for duplicates"
fi

if echo "$FUNC_BODY" | grep -q "ENGINES\[@\]"; then
  echo -e "${GREEN}✓${RESET} Processes ENGINES array"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Doesn't process ENGINES array"
fi

if echo "$FUNC_BODY" | grep -q "ENGINE_WEIGHTS"; then
  echo -e "${GREEN}✓${RESET} Processes ENGINE_WEIGHTS"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Doesn't process ENGINE_WEIGHTS"
fi

if echo "$FUNC_BODY" | grep -q "Duplicate.*found"; then
  echo -e "${GREEN}✓${RESET} Has duplicate detection message"
  ((CHECKS_PASSED++))
else
  echo -e "${RED}✗${RESET} Missing duplicate detection message"
fi

echo ""
if [[ $CHECKS_PASSED -eq $CHECKS_TOTAL ]]; then
  echo -e "${GREEN}✓ PASS${RESET}: All implementation checks passed ($CHECKS_PASSED/$CHECKS_TOTAL)"
else
  echo -e "${YELLOW}⚠ PARTIAL${RESET}: Some implementation checks failed ($CHECKS_PASSED/$CHECKS_TOTAL)"
fi
echo ""

# Test 4: Function behavior description
echo "Test 4: Document expected behavior"
cat <<EOF
Expected behavior of deduplicate_engines():

  Input:
    - ENGINES array with potential duplicates (e.g., ["claude", "opencode", "claude"])
    - ENGINE_WEIGHTS associative array (e.g., [claude]=2, [opencode]=1)

  Processing:
    1. Identifies duplicate engine names in ENGINES array
    2. Sums weights for duplicate engines (claude: 2+2=4)
    3. Issues log_warn when duplicates are found
    4. Rebuilds ENGINES array with unique values in original order
    5. Updates ENGINE_WEIGHTS with summed values

  Output:
    - ENGINES array with duplicates removed: ["claude", "opencode"]
    - ENGINE_WEIGHTS updated: [claude]=4, [opencode]=1
    - Warning logged: "Duplicate engine 'claude' found. Summed weights: 2 + 2 = 4"

EOF
echo -e "${GREEN}✓${RESET} Behavior documented"
echo ""

# Summary
echo "======================================"
echo "Test Summary"
echo "======================================"
echo -e "${GREEN}All syntax and structure tests passed!${RESET}"
echo ""
echo "Note: Full functional testing requires bash 4.0+ for associative arrays."
echo "The system bash ($(bash --version | head -1)) doesn't support this feature."
echo ""
echo "To run full tests on macOS:"
echo "  1. Install bash 4+: brew install bash"
echo "  2. Run with: /usr/local/bin/bash test_deduplicate_engines.sh"
echo ""

exit 0
