#!/usr/bin/env bash

# Test script for get_engine_for_agent() function

set -euo pipefail

# Define the function inline for testing
declare -a ENGINES=()
AI_ENGINE="claude"

get_engine_for_agent() {
  local agent_num=$1
  local engine_count=${#ENGINES[@]}

  # If no engines configured, return default
  if [[ $engine_count -eq 0 ]]; then
    echo "$AI_ENGINE"
    return
  fi

  # Round-robin distribution: agent_num % engine_count
  local engine_index=$((agent_num % engine_count))
  echo "${ENGINES[$engine_index]}"
}

# Test 1: Empty ENGINES array should return AI_ENGINE default
echo "Test 1: Empty ENGINES array"
AI_ENGINE="claude"
ENGINES=()
result=$(get_engine_for_agent 0)
if [[ "$result" == "claude" ]]; then
  echo "✓ PASS: Returns default AI_ENGINE when ENGINES is empty"
else
  echo "✗ FAIL: Expected 'claude', got '$result'"
  exit 1
fi

# Test 2: Single engine - all agents should get the same engine
echo -e "\nTest 2: Single engine"
ENGINES=("opencode")
for i in {0..5}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "opencode" ]]; then
    echo "✗ FAIL: Agent $i expected 'opencode', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: All agents get same engine with single engine"

# Test 3: Two engines - round-robin distribution
echo -e "\nTest 3: Two engines round-robin"
ENGINES=("claude" "opencode")
expected=("claude" "opencode" "claude" "opencode" "claude" "opencode")
for i in {0..5}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Round-robin distribution with 2 engines"

# Test 4: Three engines - round-robin distribution
echo -e "\nTest 4: Three engines round-robin"
ENGINES=("claude" "opencode" "cursor")
expected=("claude" "opencode" "cursor" "claude" "opencode" "cursor" "claude" "opencode" "cursor")
for i in {0..8}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Round-robin distribution with 3 engines"

# Test 5: Four engines - verify modulo operation
echo -e "\nTest 5: Four engines round-robin"
ENGINES=("claude" "opencode" "cursor" "codex")
expected=("claude" "opencode" "cursor" "codex" "claude" "opencode" "cursor" "codex")
for i in {0..7}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Round-robin distribution with 4 engines"

# Test 6: Verify with large agent numbers
echo -e "\nTest 6: Large agent numbers"
ENGINES=("claude" "opencode" "cursor")
# Agent 100 should be index 100 % 3 = 1 (opencode)
result=$(get_engine_for_agent 100)
if [[ "$result" != "opencode" ]]; then
  echo "✗ FAIL: Agent 100 expected 'opencode', got '$result'"
  exit 1
fi
# Agent 999 should be index 999 % 3 = 0 (claude)
result=$(get_engine_for_agent 999)
if [[ "$result" != "claude" ]]; then
  echo "✗ FAIL: Agent 999 expected 'claude', got '$result'"
  exit 1
fi
echo "✓ PASS: Large agent numbers handled correctly"

echo -e "\n=========================================="
echo "All tests passed! ✓"
echo "=========================================="
