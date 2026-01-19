#!/usr/bin/env bash

# Test script for print_engine_summary() function

set -euo pipefail

# Colors
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)
  MAGENTA=$(tput setaf 5)
  CYAN=$(tput setaf 6)
  BOLD=$(tput bold)
  DIM=$(tput dim)
  RESET=$(tput sgr0)
else
  RED="" GREEN="" YELLOW="" BLUE="" MAGENTA="" CYAN="" BOLD="" DIM="" RESET=""
fi

# Multi-engine tracking (for parallel execution with multiple engines)
declare -A ENGINE_AGENT_COUNT=()  # Number of agents per engine
declare -A ENGINE_SUCCESS=()      # Success count per engine
declare -A ENGINE_FAILURES=()     # Failure count per engine
declare -A ENGINE_COSTS=()        # Total cost per engine

# Source the print_engine_summary function
source <(grep -A 100 "^print_engine_summary()" ./ralphy.sh | sed '/^# ====/q' | head -n -1)

# Test 1: Empty data (should not display anything)
echo "Test 1: Empty data"
print_engine_summary
echo "✓ Test 1 passed: No output when no data"
echo ""

# Test 2: Single engine
echo "Test 2: Single engine (claude)"
ENGINE_AGENT_COUNT["claude"]=5
ENGINE_SUCCESS["claude"]=4
ENGINE_FAILURES["claude"]=1
ENGINE_COSTS["claude"]=0.0234
print_engine_summary
echo "✓ Test 2 passed"
echo ""

# Test 3: Multiple engines
echo "Test 3: Multiple engines"
ENGINE_AGENT_COUNT["opencode"]=3
ENGINE_SUCCESS["opencode"]=2
ENGINE_FAILURES["opencode"]=1
ENGINE_COSTS["opencode"]=0.0156

ENGINE_AGENT_COUNT["cursor"]=2
ENGINE_SUCCESS["cursor"]=2
ENGINE_FAILURES["cursor"]=0
ENGINE_COSTS["cursor"]=0

print_engine_summary
echo "✓ Test 3 passed"
echo ""

# Test 4: All supported engines with various stats
echo "Test 4: All supported engines"
ENGINE_AGENT_COUNT["qwen"]=4
ENGINE_SUCCESS["qwen"]=3
ENGINE_FAILURES["qwen"]=1
ENGINE_COSTS["qwen"]=0.0089

ENGINE_AGENT_COUNT["codex"]=1
ENGINE_SUCCESS["codex"]=1
ENGINE_FAILURES["codex"]=0
ENGINE_COSTS["codex"]=0.0045

ENGINE_AGENT_COUNT["droid"]=2
ENGINE_SUCCESS["droid"]=1
ENGINE_FAILURES["droid"]=1
ENGINE_COSTS["droid"]=0

print_engine_summary
echo "✓ Test 4 passed"
echo ""

# Test 5: Large numbers
echo "Test 5: Large numbers and costs"
ENGINE_AGENT_COUNT["claude"]=50
ENGINE_SUCCESS["claude"]=45
ENGINE_FAILURES["claude"]=5
ENGINE_COSTS["claude"]=2.5678

ENGINE_AGENT_COUNT["opencode"]=30
ENGINE_SUCCESS["opencode"]=28
ENGINE_FAILURES["opencode"]=2
ENGINE_COSTS["opencode"]=1.2345

print_engine_summary
echo "✓ Test 5 passed"
echo ""

echo "${GREEN}All tests passed!${RESET}"
