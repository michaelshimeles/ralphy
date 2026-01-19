#!/usr/bin/env bash

# Test script for get_engine_for_agent() function

set -euo pipefail

# Define the function inline for testing
declare -a ENGINES=()
AI_ENGINE="claude"
<<<<<<< HEAD

get_engine_for_agent() {
  local agent_num=$1
=======
ENGINE_DISTRIBUTION="round-robin"

get_engine_for_agent() {
  local agent_num=$1
  local total_agents=${2:-0}
>>>>>>> ralphy/agent-12-add-fill-first-distribution-strategy-to-get-engine
  local engine_count=${#ENGINES[@]}

  # If no engines configured, return default
  if [[ $engine_count -eq 0 ]]; then
    echo "$AI_ENGINE"
    return
  fi

<<<<<<< HEAD
  # Round-robin distribution: agent_num % engine_count
  local engine_index=$((agent_num % engine_count))
  echo "${ENGINES[$engine_index]}"
=======
  case "$ENGINE_DISTRIBUTION" in
    round-robin)
      # Round-robin distribution: agent_num % engine_count
      local engine_index=$((agent_num % engine_count))
      echo "${ENGINES[$engine_index]}"
      ;;

    fill-first)
      # Fill-first distribution: fill engines sequentially
      # Calculate agents_per_engine based on total agents
      if [[ $total_agents -le 0 ]]; then
        # Fallback to round-robin if total_agents not provided
        local engine_index=$((agent_num % engine_count))
        echo "${ENGINES[$engine_index]}"
        return
      fi

      # Calculate how many agents per engine (using ceiling division)
      local agents_per_engine=$(( (total_agents + engine_count - 1) / engine_count ))

      # Determine which engine based on agent_num / agents_per_engine
      local engine_index=$((agent_num / agents_per_engine))

      # Ensure we don't go out of bounds (in case of rounding)
      if [[ $engine_index -ge $engine_count ]]; then
        engine_index=$((engine_count - 1))
      fi

      echo "${ENGINES[$engine_index]}"
      ;;

    *)
      # Default to round-robin for unknown strategies
      local engine_index=$((agent_num % engine_count))
      echo "${ENGINES[$engine_index]}"
      ;;
  esac
>>>>>>> ralphy/agent-12-add-fill-first-distribution-strategy-to-get-engine
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
<<<<<<< HEAD
=======
echo "Round-robin tests passed! ✓"
echo "=========================================="

# ============================================
# FILL-FIRST DISTRIBUTION TESTS
# ============================================

ENGINE_DISTRIBUTION="fill-first"

# Test 7: Fill-first with 2 engines and 10 agents
echo -e "\nTest 7: Fill-first with 2 engines and 10 agents"
ENGINES=("claude" "opencode")
# agents_per_engine = ceil(10/2) = 5
# Agents 0-4 → claude, Agents 5-9 → opencode
expected=("claude" "claude" "claude" "claude" "claude" "opencode" "opencode" "opencode" "opencode" "opencode")
for i in {0..9}; do
  result=$(get_engine_for_agent $i 10)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first distribution with 2 engines and 10 agents"

# Test 8: Fill-first with 3 engines and 10 agents
echo -e "\nTest 8: Fill-first with 3 engines and 10 agents"
ENGINES=("claude" "opencode" "cursor")
# agents_per_engine = ceil(10/3) = 4
# Agents 0-3 → claude, Agents 4-7 → opencode, Agents 8-9 → cursor
expected=("claude" "claude" "claude" "claude" "opencode" "opencode" "opencode" "opencode" "cursor" "cursor")
for i in {0..9}; do
  result=$(get_engine_for_agent $i 10)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first distribution with 3 engines and 10 agents"

# Test 9: Fill-first with 4 engines and 10 agents (uneven distribution)
echo -e "\nTest 9: Fill-first with 4 engines and 10 agents"
ENGINES=("claude" "opencode" "cursor" "codex")
# agents_per_engine = ceil(10/4) = 3
# Agents 0-2 → claude, 3-5 → opencode, 6-8 → cursor, 9 → codex
expected=("claude" "claude" "claude" "opencode" "opencode" "opencode" "cursor" "cursor" "cursor" "codex")
for i in {0..9}; do
  result=$(get_engine_for_agent $i 10)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first distribution with 4 engines and 10 agents"

# Test 10: Fill-first with 3 engines and 9 agents (perfectly divisible)
echo -e "\nTest 10: Fill-first with 3 engines and 9 agents"
ENGINES=("claude" "opencode" "cursor")
# agents_per_engine = ceil(9/3) = 3
# Agents 0-2 → claude, 3-5 → opencode, 6-8 → cursor
expected=("claude" "claude" "claude" "opencode" "opencode" "opencode" "cursor" "cursor" "cursor")
for i in {0..8}; do
  result=$(get_engine_for_agent $i 9)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first distribution with 3 engines and 9 agents"

# Test 11: Fill-first with single engine
echo -e "\nTest 11: Fill-first with single engine"
ENGINES=("claude")
for i in {0..5}; do
  result=$(get_engine_for_agent $i 6)
  if [[ "$result" != "claude" ]]; then
    echo "✗ FAIL: Agent $i expected 'claude', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first with single engine"

# Test 12: Fill-first with more engines than agents
echo -e "\nTest 12: Fill-first with more engines than agents (5 engines, 3 agents)"
ENGINES=("claude" "opencode" "cursor" "codex" "qwen")
# agents_per_engine = ceil(3/5) = 1
# Agent 0 → claude, 1 → opencode, 2 → cursor
expected=("claude" "opencode" "cursor")
for i in {0..2}; do
  result=$(get_engine_for_agent $i 3)
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first with more engines than agents"

# Test 13: Fill-first fallback to round-robin when total_agents not provided
echo -e "\nTest 13: Fill-first fallback without total_agents"
ENGINES=("claude" "opencode" "cursor")
# Should fall back to round-robin when total_agents is 0
expected=("claude" "opencode" "cursor" "claude" "opencode" "cursor")
for i in {0..5}; do
  result=$(get_engine_for_agent $i)  # No total_agents parameter
  if [[ "$result" != "${expected[$i]}" ]]; then
    echo "✗ FAIL: Agent $i expected '${expected[$i]}', got '$result'"
    exit 1
  fi
done
echo "✓ PASS: Fill-first falls back to round-robin without total_agents"

# Test 14: Fill-first with large numbers
echo -e "\nTest 14: Fill-first with large numbers (100 agents, 3 engines)"
ENGINES=("claude" "opencode" "cursor")
# agents_per_engine = ceil(100/3) = 34
# Agent 0 → claude (0/34=0), Agent 50 → opencode (50/34=1), Agent 70 → cursor (70/34=2)
result=$(get_engine_for_agent 0 100)
if [[ "$result" != "claude" ]]; then
  echo "✗ FAIL: Agent 0 expected 'claude', got '$result'"
  exit 1
fi
result=$(get_engine_for_agent 50 100)
if [[ "$result" != "opencode" ]]; then
  echo "✗ FAIL: Agent 50 expected 'opencode', got '$result'"
  exit 1
fi
result=$(get_engine_for_agent 70 100)
if [[ "$result" != "cursor" ]]; then
  echo "✗ FAIL: Agent 70 expected 'cursor', got '$result'"
  exit 1
fi
echo "✓ PASS: Fill-first with large numbers"

echo -e "\n=========================================="
>>>>>>> ralphy/agent-12-add-fill-first-distribution-strategy-to-get-engine
echo "All tests passed! ✓"
echo "=========================================="
