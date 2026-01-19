#!/bin/bash
# Test script for dry-run engine display functionality

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo "======================================"
echo "Testing Dry-Run Engine Display"
echo "======================================"
echo ""

# Test 1: Single engine (backward compatibility)
echo -e "${YELLOW}Test 1: Single engine display (backward compatibility)${RESET}"
source ./ralphy.sh 2>/dev/null
AI_ENGINE="claude"
unset ENGINES
display_engines_config
echo ""

# Test 2: Multi-engine with round-robin
echo -e "${YELLOW}Test 2: Multi-engine with round-robin distribution${RESET}"
declare -a ENGINES=("claude" "opencode" "cursor")
declare -A ENGINE_WEIGHTS
ENGINE_WEIGHTS["claude"]=1
ENGINE_WEIGHTS["opencode"]=1
ENGINE_WEIGHTS["cursor"]=1
ENGINE_DISTRIBUTION="round-robin"
display_engines_config
echo ""

# Test 3: Multi-engine with weights
echo -e "${YELLOW}Test 3: Multi-engine with weighted distribution${RESET}"
declare -a ENGINES=("claude" "opencode")
declare -A ENGINE_WEIGHTS
ENGINE_WEIGHTS["claude"]=3
ENGINE_WEIGHTS["opencode"]=1
ENGINE_DISTRIBUTION="weighted"
display_engines_config
echo ""

# Test 4: Multi-engine with fill-first
echo -e "${YELLOW}Test 4: Multi-engine with fill-first distribution${RESET}"
declare -a ENGINES=("claude" "cursor" "codex")
declare -A ENGINE_WEIGHTS
ENGINE_WEIGHTS["claude"]=1
ENGINE_WEIGHTS["cursor"]=1
ENGINE_WEIGHTS["codex"]=1
ENGINE_DISTRIBUTION="fill-first"
display_engines_config
echo ""

# Test 5: Multi-engine with random
echo -e "${YELLOW}Test 5: Multi-engine with random distribution${RESET}"
declare -a ENGINES=("qwen" "droid")
declare -A ENGINE_WEIGHTS
ENGINE_WEIGHTS["qwen"]=1
ENGINE_WEIGHTS["droid"]=1
ENGINE_DISTRIBUTION="random"
display_engines_config
echo ""

echo -e "${GREEN}All tests completed!${RESET}"
echo ""
echo "Note: Visual inspection required to verify:"
echo "  - Proper formatting and alignment"
echo "  - Correct engine list display with weights"
echo "  - Distribution strategy explanations"
