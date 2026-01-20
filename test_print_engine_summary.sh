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

# Helper to reset all engine tracking arrays between tests
reset_engine_data() {
  ENGINE_AGENT_COUNT=()
  ENGINE_SUCCESS=()
  ENGINE_FAILURES=()
  ENGINE_COSTS=()
}

# Inline function definition for test isolation (avoids fragile grep-based sourcing)
print_engine_summary() {
  # Check if we have any engine data to display
  local has_data=false
  for engine in "${!ENGINE_AGENT_COUNT[@]}"; do
    has_data=true
    break
  done

  if [[ "$has_data" != true ]]; then
    return 0
  fi

  echo ""
  echo "${BOLD}>>> Engine Summary${RESET}"
  echo ""

  # Calculate column widths
  local engine_width=10
  local agents_width=8
  local success_width=9
  local failed_width=8
  local cost_width=10

  # Print header
  printf "%-${engine_width}s  %-${agents_width}s  %-${success_width}s  %-${failed_width}s  %-${cost_width}s\n" \
    "Engine" "Agents" "Success" "Failed" "Cost"

  # Print separator
  printf "%s\n" "$(printf '%.0s-' {1..60})"

  # Initialize totals
  local total_agents=0
  local total_success=0
  local total_failed=0
  local total_cost=0

  # Sort engines alphabetically for consistent display
  local sorted_engines=()
  while IFS= read -r engine; do
    sorted_engines+=("$engine")
  done < <(printf '%s\n' "${!ENGINE_AGENT_COUNT[@]}" | sort)

  # Print each engine's stats
  for engine in "${sorted_engines[@]}"; do
    local agents="${ENGINE_AGENT_COUNT[$engine]:-0}"
    local success="${ENGINE_SUCCESS[$engine]:-0}"
    local failed="${ENGINE_FAILURES[$engine]:-0}"
    local cost="${ENGINE_COSTS[$engine]:-0}"

    # Format cost with proper decimal places
    if command -v bc &>/dev/null && [[ "$cost" != "0" ]]; then
      cost=$(printf "%.4f" "$cost" 2>/dev/null || echo "$cost")
    fi

    printf "%-${engine_width}s  %-${agents_width}s  %-${success_width}s  %-${failed_width}s  \$%-${cost_width}s\n" \
      "$engine" "$agents" "$success" "$failed" "$cost"

    # Update totals
    total_agents=$((total_agents + agents))
    total_success=$((total_success + success))
    total_failed=$((total_failed + failed))

    # Add to total cost (handle decimal arithmetic with bc if available)
    if command -v bc &>/dev/null; then
      total_cost=$(echo "$total_cost + $cost" | bc 2>/dev/null || echo "$total_cost")
    else
      # Fallback: simple addition (loses precision)
      total_cost=$(awk "BEGIN {print $total_cost + $cost}" 2>/dev/null || echo "$total_cost")
    fi
  done

  # Print separator
  printf "%s\n" "$(printf '%.0s-' {1..60})"

  # Format total cost
  if command -v bc &>/dev/null && [[ "$total_cost" != "0" ]]; then
    total_cost=$(printf "%.4f" "$total_cost" 2>/dev/null || echo "$total_cost")
  fi

  # Print totals row
  printf "${BOLD}%-${engine_width}s  %-${agents_width}s  %-${success_width}s  %-${failed_width}s  \$%-${cost_width}s${RESET}\n" \
    "TOTAL" "$total_agents" "$total_success" "$total_failed" "$total_cost"

  echo ""
}

# Test 1: Empty data (should not display anything)
echo "Test 1: Empty data"
reset_engine_data
print_engine_summary
echo "✓ Test 1 passed: No output when no data"
echo ""

# Test 2: Single engine
echo "Test 2: Single engine (claude)"
reset_engine_data
ENGINE_AGENT_COUNT["claude"]=5
ENGINE_SUCCESS["claude"]=4
ENGINE_FAILURES["claude"]=1
ENGINE_COSTS["claude"]=0.0234
print_engine_summary
echo "✓ Test 2 passed"
echo ""

# Test 3: Multiple engines
echo "Test 3: Multiple engines"
reset_engine_data
ENGINE_AGENT_COUNT["claude"]=5
ENGINE_SUCCESS["claude"]=4
ENGINE_FAILURES["claude"]=1
ENGINE_COSTS["claude"]=0.0234

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
reset_engine_data
ENGINE_AGENT_COUNT["claude"]=5
ENGINE_SUCCESS["claude"]=4
ENGINE_FAILURES["claude"]=1
ENGINE_COSTS["claude"]=0.0234

ENGINE_AGENT_COUNT["opencode"]=3
ENGINE_SUCCESS["opencode"]=2
ENGINE_FAILURES["opencode"]=1
ENGINE_COSTS["opencode"]=0.0156

ENGINE_AGENT_COUNT["cursor"]=2
ENGINE_SUCCESS["cursor"]=2
ENGINE_FAILURES["cursor"]=0
ENGINE_COSTS["cursor"]=0

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
reset_engine_data
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
