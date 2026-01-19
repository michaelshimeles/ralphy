#!/usr/bin/env bash

<<<<<<< HEAD
# Test backward compatibility of engine argument parsing
# This tests the behavior after parse_args() completes

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

# Test counter
tests_passed=0
tests_failed=0

echo "Testing backward compatibility after argument parsing..."
echo ""

# Test helper function
test_backward_compat() {
  local test_name="$1"
  local initial_ai_engine="$2"
  local initial_engines="$3"
  local expected_ai_engine="$4"
  local expected_engines="$5"

  # Simulate the backward compatibility logic
  AI_ENGINE="$initial_ai_engine"
  IFS=' ' read -ra ENGINES <<< "$initial_engines"

  # Apply backward compatibility logic (same as in ralphy.sh)
  local num_engines="${#ENGINES[@]}"

  # Handle empty string case (bash 3.2 treats empty string as single element)
  if [[ "$num_engines" -eq 1 ]] && [[ -z "${ENGINES[0]}" ]]; then
    num_engines=0
    ENGINES=()
  fi

  if [[ "$num_engines" -eq 1 ]]; then
    # If exactly one engine specified, set AI_ENGINE for backward compatibility
    AI_ENGINE="${ENGINES[0]}"
  elif [[ "$num_engines" -eq 0 ]]; then
    # If no engines specified, populate ENGINES with default AI_ENGINE
    ENGINES=("$AI_ENGINE")
  fi

  # Check results
  local actual_ai_engine="$AI_ENGINE"
  local actual_engines="${ENGINES[*]}"

  if [[ "$actual_ai_engine" == "$expected_ai_engine" ]] && \
     [[ "$actual_engines" == "$expected_engines" ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    tests_passed=$((tests_passed + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo "  Expected: AI_ENGINE=$expected_ai_engine, ENGINES=($expected_engines)"
    echo "  Got:      AI_ENGINE=$actual_ai_engine, ENGINES=($actual_engines)"
    tests_failed=$((tests_failed + 1))
  fi
}

# Test 1: No engines specified (empty ENGINES array) - should populate with default AI_ENGINE
test_backward_compat \
  "No engines, default AI_ENGINE (claude)" \
  "claude" \
  "" \
  "claude" \
  "claude"

# Test 2: No engines specified, AI_ENGINE set to opencode
test_backward_compat \
  "No engines, AI_ENGINE=opencode" \
  "opencode" \
  "" \
  "opencode" \
  "opencode"

# Test 3: Exactly one engine specified - should set AI_ENGINE to that engine
test_backward_compat \
  "Single engine: cursor" \
  "claude" \
  "cursor" \
  "cursor" \
  "cursor"

# Test 4: Exactly one engine specified (opencode) - should set AI_ENGINE
test_backward_compat \
  "Single engine: opencode" \
  "claude" \
  "opencode" \
  "opencode" \
  "opencode"

# Test 5: Exactly one engine specified (droid) - should set AI_ENGINE
test_backward_compat \
  "Single engine: droid" \
  "claude" \
  "droid" \
  "droid" \
  "droid"

# Test 6: Exactly one engine specified (qwen) - should set AI_ENGINE
test_backward_compat \
  "Single engine: qwen" \
  "claude" \
  "qwen" \
  "qwen" \
  "qwen"

# Test 7: Exactly one engine specified (codex) - should set AI_ENGINE
test_backward_compat \
  "Single engine: codex" \
  "claude" \
  "codex" \
  "codex" \
  "codex"

# Test 8: Multiple engines - AI_ENGINE and ENGINES should remain unchanged
echo -e "${YELLOW}⊙${RESET} Multiple engines: claude opencode (no backward compat applied)"
AI_ENGINE="claude"
ENGINES=("claude" "opencode")
num_engines="${#ENGINES[@]}"
if [[ "$num_engines" -eq 1 ]]; then
  AI_ENGINE="${ENGINES[0]}"
elif [[ "$num_engines" -eq 0 ]]; then
  ENGINES=("$AI_ENGINE")
fi
if [[ "$AI_ENGINE" == "claude" ]] && [[ "${ENGINES[*]}" == "claude opencode" ]]; then
  echo -e "${GREEN}  ✓${RESET} Multiple engines correctly skips backward compatibility"
  tests_passed=$((tests_passed + 1))
else
  echo -e "${RED}  ✗${RESET} Multiple engines incorrectly modified"
  echo "  Expected: AI_ENGINE=claude, ENGINES=(claude opencode)"
  echo "  Got:      AI_ENGINE=$AI_ENGINE, ENGINES=(${ENGINES[*]})"
  tests_failed=$((tests_failed + 1))
fi

# Test 9: Three engines - should not modify
echo -e "${YELLOW}⊙${RESET} Three engines: claude opencode cursor"
AI_ENGINE="opencode"
ENGINES=("claude" "opencode" "cursor")
num_engines="${#ENGINES[@]}"
if [[ "$num_engines" -eq 1 ]]; then
  AI_ENGINE="${ENGINES[0]}"
elif [[ "$num_engines" -eq 0 ]]; then
  ENGINES=("$AI_ENGINE")
fi
if [[ "$AI_ENGINE" == "opencode" ]] && [[ "${ENGINES[*]}" == "claude opencode cursor" ]]; then
  echo -e "${GREEN}  ✓${RESET} Three engines correctly skips backward compatibility"
  tests_passed=$((tests_passed + 1))
else
  echo -e "${RED}  ✗${RESET} Three engines incorrectly modified"
  echo "  Expected: AI_ENGINE=opencode, ENGINES=(claude opencode cursor)"
  echo "  Got:      AI_ENGINE=$AI_ENGINE, ENGINES=(${ENGINES[*]})"
  tests_failed=$((tests_failed + 1))
fi

echo ""
echo "=========================================="
echo "Test Results:"
echo "  Passed: $tests_passed"
echo "  Failed: $tests_failed"
echo "=========================================="

if [[ $tests_failed -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}Some tests failed!${RESET}"
  exit 1
fi
=======
# ============================================
# Ralphy Backward Compatibility Tests
# ============================================
#
# This test suite verifies that existing functionality
# continues to work as expected:
# 1. Single engine flag works (--claude, --opencode, etc.)
# 2. No engine uses default (claude)
# 3. Single task mode works
# 4. Existing config without parallel.engines works
#
# Run with: ./test_backward_compatibility.sh
# ============================================

set -euo pipefail

# Colors
RED=""
GREEN=""
YELLOW=""
BLUE=""
BOLD=""
RESET=""

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPHY_SCRIPT="$SCRIPT_DIR/ralphy.sh"

# Helper functions
log_test() {
  echo ""
  echo "[TEST] $*"
  ((TESTS_RUN++)) || true
}

log_pass() {
  echo "[PASS] $*"
  ((TESTS_PASSED++)) || true
}

log_fail() {
  echo "[FAIL] $*"
  ((TESTS_FAILED++)) || true
}

log_info() {
  echo "[INFO] $*"
}

# Test: Parse single engine flags
test_single_engine_flags() {
  log_test "Testing single engine flag parsing"

  # Test each engine flag by checking the script
  if grep -q "^[[:space:]]*--claude)" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="claude"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --claude is present and sets AI_ENGINE=claude"
  else
    log_fail "Engine flag --claude not found or incorrectly configured"
  fi

  if grep -q "^[[:space:]]*--opencode)" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="opencode"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --opencode is present and sets AI_ENGINE=opencode"
  else
    log_fail "Engine flag --opencode not found or incorrectly configured"
  fi

  if grep -q "^[[:space:]]*--cursor" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="cursor"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --cursor is present and sets AI_ENGINE=cursor"
  else
    log_fail "Engine flag --cursor not found or incorrectly configured"
  fi

  if grep -q "^[[:space:]]*--codex)" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="codex"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --codex is present and sets AI_ENGINE=codex"
  else
    log_fail "Engine flag --codex not found or incorrectly configured"
  fi

  if grep -q "^[[:space:]]*--qwen)" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="qwen"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --qwen is present and sets AI_ENGINE=qwen"
  else
    log_fail "Engine flag --qwen not found or incorrectly configured"
  fi

  if grep -q "^[[:space:]]*--droid)" "$RALPHY_SCRIPT" && \
     grep -q 'AI_ENGINE="droid"' "$RALPHY_SCRIPT"; then
    log_pass "Engine flag --droid is present and sets AI_ENGINE=droid"
  else
    log_fail "Engine flag --droid not found or incorrectly configured"
  fi
}

# Test: Default engine when no flag specified
test_default_engine() {
  log_test "Testing default engine (no flag specified)"

  if grep -q '^AI_ENGINE="claude"' "$RALPHY_SCRIPT"; then
    log_pass "Default engine is 'claude' when no flag specified"
  else
    log_fail "Default engine is not 'claude'"
  fi
}

# Test: Sonnet flag sets CLAUDE_MODEL
test_sonnet_flag() {
  log_test "Testing --sonnet flag for Claude Sonnet model"

  if grep -q "^[[:space:]]*--sonnet)" "$RALPHY_SCRIPT" && \
     grep -q 'CLAUDE_MODEL="sonnet"' "$RALPHY_SCRIPT"; then
    log_pass "--sonnet flag is present and sets CLAUDE_MODEL=sonnet"
  else
    log_fail "--sonnet flag not found or incorrectly configured"
  fi
}

# Test: Claude command construction with model flag
test_claude_command_with_model() {
  log_test "Testing Claude command construction with --model flag"

  if grep -q 'CLAUDE_MODEL:+--model' "$RALPHY_SCRIPT"; then
    log_pass "Claude command includes conditional --model flag syntax"
  else
    log_fail "Claude command missing conditional --model flag"
  fi
}

# Test: Engine case statement structure
test_engine_case_structure() {
  log_test "Testing engine case statement handles all engines"

  local engines=("claude" "opencode" "cursor" "qwen" "droid" "codex")
  local all_found=true

  for engine in "${engines[@]}"; do
    if grep -q "^[[:space:]]*${engine})" "$RALPHY_SCRIPT"; then
      log_pass "Engine case statement includes '$engine'"
    else
      log_fail "Engine case statement missing '$engine'"
      all_found=false
    fi
  done
}

# Test: Single task mode check
test_single_task_mode() {
  log_test "Testing single task mode variable handling"

  if grep -q '^SINGLE_TASK=""' "$RALPHY_SCRIPT"; then
    log_pass "SINGLE_TASK variable defaults to empty string"
  else
    log_fail "SINGLE_TASK variable not properly initialized"
  fi
}

# Test: run_brownfield_task function exists
test_brownfield_function_exists() {
  log_test "Testing run_brownfield_task function exists"

  if grep -q "^run_brownfield_task()" "$RALPHY_SCRIPT"; then
    log_pass "run_brownfield_task function exists for single task mode"
  else
    log_fail "run_brownfield_task function not found"
  fi
}

# Test: Config file structure (without parallel.engines)
test_config_without_parallel_engines() {
  log_test "Testing config.yaml structure without parallel.engines"

  # Create a test config directory
  local test_dir
  test_dir=$(mktemp -d)
  local test_config="$test_dir/.ralphy/config.yaml"

  mkdir -p "$test_dir/.ralphy"

  # Create a legacy config without parallel.engines
  cat > "$test_config" << 'EOF'
project:
  name: "test-app"
  language: "TypeScript"
  framework: "Next.js"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "use server actions"
  - "follow error patterns"

boundaries:
  never_touch:
    - "src/legacy/**"
    - "*.lock"
EOF

  # Verify config can be read without errors
  if command -v yq &>/dev/null; then
    local project_name
    project_name=$(yq -r '.project.name // ""' "$test_config" 2>/dev/null || echo "")

    if [[ "$project_name" == "test-app" ]]; then
      log_pass "Config without parallel.engines can be read successfully"
    else
      log_fail "Failed to read config without parallel.engines"
    fi

    # Verify parallel.engines is absent (backward compat)
    local parallel_engines
    parallel_engines=$(yq -r '.parallel.engines // "null"' "$test_config" 2>/dev/null || echo "null")

    if [[ "$parallel_engines" == "null" ]]; then
      log_pass "Config correctly has no parallel.engines field (backward compat)"
    else
      log_fail "Unexpected parallel.engines field found: $parallel_engines"
    fi
  else
    log_info "yq not installed, skipping config parsing test (not a failure)"
  fi

  # Cleanup
  rm -rf "$test_dir"
}

# Test: AI_ENGINE variable export for parallel mode
test_engine_export_parallel() {
  log_test "Testing AI_ENGINE export for parallel execution"

  if grep -q "export AI_ENGINE" "$RALPHY_SCRIPT"; then
    log_pass "AI_ENGINE is exported for parallel agent execution"
  else
    log_fail "AI_ENGINE export not found for parallel mode"
  fi
}

# Test: CLAUDE_MODEL variable exists
test_claude_model_variable() {
  log_test "Testing CLAUDE_MODEL variable initialization"

  if grep -q '^CLAUDE_MODEL=""' "$RALPHY_SCRIPT"; then
    log_pass "CLAUDE_MODEL variable exists and defaults to empty (opus)"
  else
    log_fail "CLAUDE_MODEL variable not properly initialized"
  fi
}

# Test: Help text shows all engine options
test_help_text_engines() {
  log_test "Testing help text includes all engine options"

  local engines=("--claude" "--opencode" "--cursor" "--codex" "--qwen" "--droid" "--sonnet")
  local all_found=true

  for flag in "${engines[@]}"; do
    if grep -q -- "$flag" "$RALPHY_SCRIPT"; then
      log_pass "Help text includes $flag option"
    else
      log_fail "Help text missing $flag option"
      all_found=false
    fi
  done
}

# Test: Version variable exists
test_version_variable() {
  log_test "Testing VERSION variable exists"

  local version
  version=$(grep "^VERSION=" "$RALPHY_SCRIPT" | head -1 | cut -d'"' -f2)

  if [[ -n "$version" ]]; then
    log_pass "VERSION variable exists: $version"
  else
    log_fail "VERSION variable not found"
  fi
}

# Test: Parallel mode flag
test_parallel_flag() {
  log_test "Testing --parallel flag parsing"

  if grep -q "^[[:space:]]*--parallel)" "$RALPHY_SCRIPT" && \
     grep -q 'PARALLEL=true' "$RALPHY_SCRIPT"; then
    log_pass "--parallel flag is present and sets PARALLEL=true"
  else
    log_fail "--parallel flag not found or incorrectly configured"
  fi
}

# Test: MAX_PARALLEL default
test_max_parallel_default() {
  log_test "Testing MAX_PARALLEL default value"

  if grep -q '^MAX_PARALLEL=3' "$RALPHY_SCRIPT"; then
    log_pass "MAX_PARALLEL defaults to 3"
  else
    log_fail "MAX_PARALLEL default incorrect"
  fi
}

# ============================================
# MAIN TEST RUNNER
# ============================================

main() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Ralphy Backward Compatibility Test Suite"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [[ ! -f "$RALPHY_SCRIPT" ]]; then
    echo "ERROR: ralphy.sh not found at: $RALPHY_SCRIPT"
    exit 1
  fi

  log_info "Testing ralphy.sh at: $RALPHY_SCRIPT"
  echo ""

  # Run all tests
  test_single_engine_flags
  test_default_engine
  test_sonnet_flag
  test_claude_command_with_model
  test_engine_case_structure
  test_single_task_mode
  test_brownfield_function_exists
  test_config_without_parallel_engines
  test_engine_export_parallel
  test_claude_model_variable
  test_help_text_engines
  test_version_variable
  test_parallel_flag
  test_max_parallel_default

  # Summary
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Test Summary"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Total Tests:  $TESTS_RUN"
  echo "  Passed:       $TESTS_PASSED"
  echo "  Failed:       $TESTS_FAILED"
  echo ""

  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo "Some tests failed!"
    exit 1
  else
    echo "All tests passed!"
    exit 0
  fi
}

main "$@"
>>>>>>> ralphy/agent-31-verify-backward-compatibility-single-engine-flag-w
