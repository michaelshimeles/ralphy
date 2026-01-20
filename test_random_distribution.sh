#!/usr/bin/env bash

# Test script for get_engine_for_agent() with random distribution

set -euo pipefail

# Define the function inline for testing
declare -a ENGINES=()
AI_ENGINE="claude"
ENGINE_DISTRIBUTION="random"

get_engine_for_agent() {
  local agent_num=$1
  local engine_count=${#ENGINES[@]}

  # If no engines configured, return default
  if [[ $engine_count -eq 0 ]]; then
    echo "$AI_ENGINE"
    return
  fi

  # Select distribution strategy
  local engine_index
  case "$ENGINE_DISTRIBUTION" in
    random)
      # Random distribution: use $RANDOM to pick an engine
      engine_index=$((RANDOM % engine_count))
      ;;
    round-robin|*)
      # Round-robin distribution (default): agent_num % engine_count
      engine_index=$((agent_num % engine_count))
      ;;
  esac

  echo "${ENGINES[$engine_index]}"
}

echo "Testing random distribution strategy"
echo "======================================"

# Test 1: Random distribution returns valid engines
echo -e "\nTest 1: Random distribution returns valid engines"
ENGINES=("claude" "opencode" "cursor")
ENGINE_DISTRIBUTION="random"

# Test 20 calls to ensure we're getting valid engines
valid_count=0
for i in {0..19}; do
  result=$(get_engine_for_agent $i)
  # Check if result is in ENGINES array
  valid=false
  for engine in "${ENGINES[@]}"; do
    if [[ "$result" == "$engine" ]]; then
      valid=true
      valid_count=$((valid_count + 1))
      break
    fi
  done
  if [[ "$valid" != true ]]; then
    echo "✗ FAIL: Agent $i got invalid engine '$result'"
    exit 1
  fi
done
echo "✓ PASS: All 20 calls returned valid engines ($valid_count/20)"

# Test 2: Random distribution with single engine
echo -e "\nTest 2: Random distribution with single engine"
ENGINES=("claude")
for i in {0..5}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "claude" ]]; then
    echo "✗ FAIL: Agent $i expected 'claude', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Single engine returns consistently"

# Test 3: Random distribution should eventually use all engines
echo -e "\nTest 3: Random distribution uses all engines (100 samples)"
ENGINES=("claude" "opencode" "cursor" "codex")
# Use simple variables instead of associative array
seen_claude=0
seen_opencode=0
seen_cursor=0
seen_codex=0

for i in {0..99}; do
  result=$(get_engine_for_agent $i)
  case "$result" in
    claude) seen_claude=1 ;;
    opencode) seen_opencode=1 ;;
    cursor) seen_cursor=1 ;;
    codex) seen_codex=1 ;;
  esac
done

if [[ $seen_claude -eq 1 && $seen_opencode -eq 1 && $seen_cursor -eq 1 && $seen_codex -eq 1 ]]; then
  echo "✓ PASS: All engines were selected at least once in 100 samples"
else
  echo "✗ FAIL: Not all engines were selected (claude:$seen_claude, opencode:$seen_opencode, cursor:$seen_cursor, codex:$seen_codex)"
  exit 1
fi

# Test 4: Switch between round-robin and random
echo -e "\nTest 4: Switch between distribution strategies"
ENGINES=("claude" "opencode")

# Test round-robin
ENGINE_DISTRIBUTION="round-robin"
result0=$(get_engine_for_agent 0)
result1=$(get_engine_for_agent 1)
result2=$(get_engine_for_agent 2)

if [[ "$result0" == "claude" && "$result1" == "opencode" && "$result2" == "claude" ]]; then
  echo "✓ PASS: Round-robin distribution works"
else
  echo "✗ FAIL: Round-robin expected claude,opencode,claude got $result0,$result1,$result2"
  exit 1
fi

# Test random (just verify it returns valid engines)
ENGINE_DISTRIBUTION="random"
for i in {0..4}; do
  result=$(get_engine_for_agent $i)
  if [[ "$result" != "claude" && "$result" != "opencode" ]]; then
    echo "✗ FAIL: Random distribution returned invalid engine '$result'"
    exit 1
  fi
done
echo "✓ PASS: Random distribution works"

# Test 5: Empty engines with random distribution
echo -e "\nTest 5: Empty ENGINES array with random distribution"
ENGINES=()
ENGINE_DISTRIBUTION="random"
result=$(get_engine_for_agent 0)
if [[ "$result" == "$AI_ENGINE" ]]; then
  echo "✓ PASS: Returns default AI_ENGINE when ENGINES is empty"
else
  echo "✗ FAIL: Expected '$AI_ENGINE', got '$result'"
  exit 1
fi

echo -e "\n=========================================="
echo "All random distribution tests passed! ✓"
echo "=========================================="
