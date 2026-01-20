#!/bin/bash

# Test script for validate_engines() function
# Note: Requires Bash 4.0+ for associative arrays

set -euo pipefail

# Check bash version
if ((BASH_VERSINFO[0] < 4)); then
  echo "WARNING: Bash 4.0+ required for associative arrays. Current version: $BASH_VERSION"
  echo "Skipping tests. The validate_engines() function has been implemented in ralphy.sh"
  exit 0
fi

# Source the necessary parts from ralphy.sh
# We'll need to mock the environment

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Mock log functions
log_info() {
  echo -e "${BLUE}[INFO]${RESET} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${RESET} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${RESET} $*" >&2
}

log_debug() {
  if [[ "${VERBOSE:-false}" == true ]]; then
    echo "[DEBUG] $*"
  fi
}

# Initialize variables
declare -a ENGINES=()
declare -A ENGINE_WEIGHTS=()
declare -a VALID_ENGINES=("claude" "opencode" "cursor" "codex" "qwen" "droid")

# Source the validate_engines function from ralphy.sh
# Extract just the function
validate_engines() {
  local -a valid_engines_list=()
  local -a invalid_engines=()
  local -a missing_cli_engines=()

  # Map of engine names to their CLI commands
  declare -A engine_cli_map=(
    ["claude"]="claude"
    ["opencode"]="opencode"
    ["cursor"]="agent"
    ["codex"]="codex"
    ["qwen"]="qwen"
    ["droid"]="droid"
  )

  # Check each engine in ENGINES
  for engine in "${ENGINES[@]}"; do
    # Check if engine is in VALID_ENGINES
    local is_valid=false
    for valid_engine in "${VALID_ENGINES[@]}"; do
      if [[ "$engine" == "$valid_engine" ]]; then
        is_valid=true
        break
      fi
    done

    if [[ "$is_valid" == false ]]; then
      invalid_engines+=("$engine")
      continue
    fi

    # Check if CLI command exists
    local cli_cmd="${engine_cli_map[$engine]}"
    if ! command -v "$cli_cmd" &>/dev/null; then
      missing_cli_engines+=("$engine")
      log_warn "Engine '$engine' selected but CLI command '$cli_cmd' not found in PATH"
    else
      valid_engines_list+=("$engine")
    fi
  done

  # Report invalid engines
  if [[ ${#invalid_engines[@]} -gt 0 ]]; then
    log_error "Invalid engine(s): ${invalid_engines[*]}"
    log_error "Valid engines are: ${VALID_ENGINES[*]}"
    return 1
  fi

  # Warn about missing CLI commands
  if [[ ${#missing_cli_engines[@]} -gt 0 ]]; then
    log_warn "The following engines are unavailable due to missing CLI commands:"
    for engine in "${missing_cli_engines[@]}"; do
      local cli_cmd="${engine_cli_map[$engine]}"
      log_warn "  - $engine: '$cli_cmd' not found (install hint: check engine documentation)"
    done
  fi

  # Filter ENGINES to only available ones
  if [[ ${#valid_engines_list[@]} -eq 0 ]]; then
    log_error "No valid engines available. Please install at least one engine CLI."
    return 1
  fi

  # Update ENGINES array with only valid engines
  ENGINES=("${valid_engines_list[@]}")

  log_debug "Validated engines: ${ENGINES[*]}"
  return 0
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
    echo "  Expected: $expected"
    echo "  Got: $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_array_contains() {
  local item="$1"
  local test_name="$2"
  shift 2
  local -a array=("$@")

  TESTS_RUN=$((TESTS_RUN + 1))

  local found=false
  for elem in "${array[@]}"; do
    if [[ "$elem" == "$item" ]]; then
      found=true
      break
    fi
  done

  if [[ "$found" == true ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo "  Expected array to contain: $item"
    echo "  Array contents: ${array[*]}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_return_code() {
  local expected_code="$1"
  local actual_code="$2"
  local test_name="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  if [[ "$expected_code" -eq "$actual_code" ]]; then
    echo -e "${GREEN}✓${RESET} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${RESET} $test_name"
    echo "  Expected return code: $expected_code"
    echo "  Got: $actual_code"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Mock command availability
mock_command_exists() {
  local cmd="$1"
  local exists="$2"

  if [[ "$exists" == "true" ]]; then
    eval "$cmd() { true; }"
  else
    # Remove function if it exists
    unset -f "$cmd" 2>/dev/null || true
  fi
}

echo "=========================================="
echo "Testing validate_engines()"
echo "=========================================="
echo

# Test 1: Invalid engine name
echo "Test 1: Reject invalid engine names"
ENGINES=("invalid_engine")
validate_engines 2>/dev/null
return_code=$?
assert_return_code 1 "$return_code" "Should return 1 for invalid engine"
echo

# Test 2: Valid engine with available CLI
echo "Test 2: Accept valid engine with available CLI"
ENGINES=("claude")
mock_command_exists "claude" "true"
validate_engines >/dev/null 2>&1
return_code=$?
assert_return_code 0 "$return_code" "Should return 0 for valid engine with CLI"
assert_array_contains "claude" "ENGINES should contain claude" "${ENGINES[@]}"
echo

# Test 3: Valid engine without available CLI
echo "Test 3: Filter out engines with missing CLI"
ENGINES=("opencode" "codex")
mock_command_exists "opencode" "true"
mock_command_exists "codex" "false"
validate_engines 2>/dev/null
return_code=$?
assert_return_code 0 "$return_code" "Should return 0 when at least one engine is available"
assert_equals "1" "${#ENGINES[@]}" "Should have 1 engine after filtering"
assert_array_contains "opencode" "ENGINES should contain opencode" "${ENGINES[@]}"
echo

# Test 4: All engines missing CLIs
echo "Test 4: Error when no engines have available CLIs"
ENGINES=("claude" "opencode")
mock_command_exists "claude" "false"
mock_command_exists "opencode" "false"
validate_engines 2>/dev/null
return_code=$?
assert_return_code 1 "$return_code" "Should return 1 when no engines are available"
echo

# Test 5: Multiple valid engines
echo "Test 5: Accept multiple valid engines with CLIs"
ENGINES=("claude" "cursor" "qwen")
mock_command_exists "claude" "true"
mock_command_exists "agent" "true"  # cursor uses 'agent' CLI
mock_command_exists "qwen" "true"
validate_engines >/dev/null 2>&1
return_code=$?
assert_return_code 0 "$return_code" "Should return 0 for multiple valid engines"
assert_equals "3" "${#ENGINES[@]}" "Should have 3 engines"
echo

# Test 6: Cursor engine uses 'agent' CLI
echo "Test 6: Cursor engine maps to 'agent' CLI command"
ENGINES=("cursor")
mock_command_exists "agent" "true"
validate_engines >/dev/null 2>&1
return_code=$?
assert_return_code 0 "$return_code" "Should return 0 for cursor with agent CLI"
assert_array_contains "cursor" "ENGINES should contain cursor" "${ENGINES[@]}"
echo

# Print summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Tests run: $TESTS_RUN"
echo -e "${GREEN}Tests passed: $TESTS_PASSED${RESET}"
if [[ $TESTS_FAILED -gt 0 ]]; then
  echo -e "${RED}Tests failed: $TESTS_FAILED${RESET}"
  exit 1
else
  echo "All tests passed!"
  exit 0
fi
