#!/bin/bash
# Test script for load_parallel_config function

# Set up variables needed by the function
RALPHY_DIR=".ralphy"
CONFIG_FILE="$RALPHY_DIR/config.yaml"

# Load parallel execution configuration from config.yaml
# Reads parallel.engines (with name and weight), parallel.distribution, and parallel.max_concurrent
# Outputs: space-separated values in format "engine1:weight1 engine2:weight2|distribution|max_concurrent"
# Returns empty string if config not found or yq not available
load_parallel_config() {
  [[ ! -f "$CONFIG_FILE" ]] && return

  if ! command -v yq &>/dev/null; then
    return
  fi

  # Check if parallel section exists
  local has_parallel
  has_parallel=$(yq -r '.parallel // ""' "$CONFIG_FILE" 2>/dev/null)
  [[ -z "$has_parallel" ]] && return

  # Load engines with weights
  local engines_list=""
  local engine_count
  engine_count=$(yq -r '.parallel.engines // [] | length' "$CONFIG_FILE" 2>/dev/null)

  if [[ "$engine_count" -gt 0 ]]; then
    for ((i=0; i<engine_count; i++)); do
      local name weight
      name=$(yq -r ".parallel.engines[$i].name // \"\"" "$CONFIG_FILE" 2>/dev/null)
      weight=$(yq -r ".parallel.engines[$i].weight // 1" "$CONFIG_FILE" 2>/dev/null)

      if [[ -n "$name" ]]; then
        [[ -n "$engines_list" ]] && engines_list+=" "
        engines_list+="${name}:${weight}"
      fi
    done
  fi

  # Load distribution strategy
  local distribution
  distribution=$(yq -r '.parallel.distribution // "round-robin"' "$CONFIG_FILE" 2>/dev/null)

  # Load max concurrent
  local max_concurrent
  max_concurrent=$(yq -r '.parallel.max_concurrent // 3' "$CONFIG_FILE" 2>/dev/null)

  # Output in parseable format
  if [[ -n "$engines_list" ]]; then
    echo "${engines_list}|${distribution}|${max_concurrent}"
  fi
}

echo "Test 1: Load config from .ralphy/config.yaml"
result=$(load_parallel_config)
if [[ -n "$result" ]]; then
  echo "✓ Success: $result"

  # Parse the result
  IFS='|' read -r engines distribution max_concurrent <<< "$result"
  echo "  - Engines: $engines"
  echo "  - Distribution: $distribution"
  echo "  - Max Concurrent: $max_concurrent"
else
  echo "✗ Failed: No output"
  exit 1
fi

echo ""
echo "Test 2: Config without parallel section"
# Create a temp config without parallel section
mkdir -p /tmp/ralphy-test
cat > /tmp/ralphy-test/config.yaml << 'EOF'
project:
  name: "test"
rules: []
boundaries:
  never_touch: []
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
if [[ -z "$result" ]]; then
  echo "✓ Success: Returns empty for config without parallel section"
else
  echo "✗ Failed: Should return empty but got: $result"
fi

echo ""
echo "Test 3: Non-existent config file"
CONFIG_FILE="/tmp/nonexistent.yaml"
result=$(load_parallel_config)
if [[ -z "$result" ]]; then
  echo "✓ Success: Returns empty for non-existent file"
else
  echo "✗ Failed: Should return empty but got: $result"
fi

echo ""
echo "Test 4: Config with minimal parallel section (defaults)"
cat > /tmp/ralphy-test/config.yaml << 'EOF'
project:
  name: "test"
parallel:
  engines:
    - name: "claude"
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
if [[ -n "$result" ]]; then
  echo "✓ Success: $result"
  IFS='|' read -r engines distribution max_concurrent <<< "$result"
  echo "  - Engines: $engines (should have default weight of 1)"
  echo "  - Distribution: $distribution (should default to round-robin)"
  echo "  - Max Concurrent: $max_concurrent (should default to 3)"
else
  echo "✗ Failed: Should return config with defaults"
fi

echo ""
echo "All tests completed!"
