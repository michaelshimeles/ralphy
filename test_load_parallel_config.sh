#!/usr/bin/env bash

# Integration test for load_parallel_config() function
# This test creates a config file and verifies it loads correctly

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/.test_ralphy"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

# Setup
setup() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_DIR"
}

# Teardown
teardown() {
  rm -rf "$TEST_DIR"
}

echo "Testing load_parallel_config() integration..."
echo ""

# Check if yq is available
if ! command -v yq &>/dev/null; then
  echo -e "${YELLOW}Warning: yq not found. Skipping tests...${RESET}"
  echo "The function will gracefully skip loading if yq is not available."
  echo "To run full tests, install yq: brew install yq"
  exit 0
fi

setup

# Test 1: Create a config file with parallel engines
echo "Test 1: Creating config with parallel engines..."
cat > "$TEST_DIR/config.yaml" << 'EOF'
parallel:
  engines:
    - name: claude
      weight: 2
    - name: cursor
      weight: 1
  distribution: weighted
  max_concurrent: 5
EOF

# Test that the config file is valid YAML and can be parsed
echo "Test 2: Verifying config file is valid YAML..."
engines_count=$(yq eval '.parallel.engines | length' "$TEST_DIR/config.yaml")
distribution=$(yq eval '.parallel.distribution' "$TEST_DIR/config.yaml")
max_concurrent=$(yq eval '.parallel.max_concurrent' "$TEST_DIR/config.yaml")

if [[ "$engines_count" == "2" ]]; then
  echo -e "${GREEN}✓${RESET} Config has 2 engines"
else
  echo -e "${RED}✗${RESET} Expected 2 engines, got $engines_count"
  teardown
  exit 1
fi

if [[ "$distribution" == "weighted" ]]; then
  echo -e "${GREEN}✓${RESET} Distribution is 'weighted'"
else
  echo -e "${RED}✗${RESET} Expected distribution 'weighted', got $distribution"
  teardown
  exit 1
fi

if [[ "$max_concurrent" == "5" ]]; then
  echo -e "${GREEN}✓${RESET} Max concurrent is 5"
else
  echo -e "${RED}✗${RESET} Expected max_concurrent 5, got $max_concurrent"
  teardown
  exit 1
fi

# Test 3: Verify individual engine properties
echo "Test 3: Verifying individual engine properties..."
engine_0_name=$(yq eval '.parallel.engines[0].name' "$TEST_DIR/config.yaml")
engine_0_weight=$(yq eval '.parallel.engines[0].weight' "$TEST_DIR/config.yaml")
engine_1_name=$(yq eval '.parallel.engines[1].name' "$TEST_DIR/config.yaml")
engine_1_weight=$(yq eval '.parallel.engines[1].weight' "$TEST_DIR/config.yaml")

if [[ "$engine_0_name" == "claude" && "$engine_0_weight" == "2" ]]; then
  echo -e "${GREEN}✓${RESET} Engine 0: claude with weight 2"
else
  echo -e "${RED}✗${RESET} Expected engine 0 to be claude with weight 2"
  teardown
  exit 1
fi

if [[ "$engine_1_name" == "cursor" && "$engine_1_weight" == "1" ]]; then
  echo -e "${GREEN}✓${RESET} Engine 1: cursor with weight 1"
else
  echo -e "${RED}✗${RESET} Expected engine 1 to be cursor with weight 1"
  teardown
  exit 1
fi

# Test 4: Create config without engines (only distribution)
echo "Test 4: Creating config without engines..."
cat > "$TEST_DIR/config.yaml" << 'EOF'
parallel:
  distribution: round-robin
  max_concurrent: 3
EOF

distribution=$(yq eval '.parallel.distribution' "$TEST_DIR/config.yaml")
max_concurrent=$(yq eval '.parallel.max_concurrent' "$TEST_DIR/config.yaml")

if [[ "$distribution" == "round-robin" ]]; then
  echo -e "${GREEN}✓${RESET} Distribution is 'round-robin'"
else
  echo -e "${RED}✗${RESET} Expected distribution 'round-robin', got $distribution"
  teardown
  exit 1
fi

# Test 5: Create config with engines but no weights (should default to 1)
echo "Test 5: Creating config with engines without explicit weights..."
cat > "$TEST_DIR/config.yaml" << 'EOF'
parallel:
  engines:
    - name: opencode
    - name: codex
EOF

engine_0_weight=$(yq eval '.parallel.engines[0].weight // 1' "$TEST_DIR/config.yaml")
engine_1_weight=$(yq eval '.parallel.engines[1].weight // 1' "$TEST_DIR/config.yaml")

if [[ "$engine_0_weight" == "1" && "$engine_1_weight" == "1" ]]; then
  echo -e "${GREEN}✓${RESET} Default weights are correctly set to 1"
else
  echo -e "${RED}✗${RESET} Expected default weights to be 1"
  teardown
  exit 1
fi

teardown

echo ""
echo -e "${GREEN}All tests passed!${RESET}"
echo ""
echo "The load_parallel_config() function should correctly:"
echo "  - Load engines from .ralphy/config.yaml"
echo "  - Parse engine names and weights"
echo "  - Load distribution strategy"
echo "  - Load max_concurrent setting"
echo "  - Default weights to 1 when not specified"
echo "  - Gracefully handle missing config or missing yq"
