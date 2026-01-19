#!/bin/bash
# Extended tests for load_parallel_config function

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

mkdir -p /tmp/ralphy-test

echo "Test 5: Multiple engines with different weights"
cat > /tmp/ralphy-test/config.yaml << 'EOF'
parallel:
  engines:
    - name: "claude"
      weight: 5
    - name: "opencode"
      weight: 3
    - name: "cursor"
      weight: 2
  distribution: "weighted"
  max_concurrent: 10
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
if [[ -n "$result" ]]; then
  echo "✓ Success: $result"
  IFS='|' read -r engines distribution max_concurrent <<< "$result"
  echo "  - Engines: $engines"
  echo "  - Distribution: $distribution"
  echo "  - Max Concurrent: $max_concurrent"
else
  echo "✗ Failed"
fi

echo ""
echo "Test 6: Distribution strategies"
for dist in "round-robin" "weighted" "random" "fill-first"; do
  cat > /tmp/ralphy-test/config.yaml << EOF
parallel:
  engines:
    - name: "claude"
      weight: 1
  distribution: "$dist"
  max_concurrent: 5
EOF

  CONFIG_FILE="/tmp/ralphy-test/config.yaml"
  result=$(load_parallel_config)
  IFS='|' read -r engines distribution max_concurrent <<< "$result"
  if [[ "$distribution" == "$dist" ]]; then
    echo "✓ Distribution '$dist': $result"
  else
    echo "✗ Distribution '$dist' failed: expected $dist, got $distribution"
  fi
done

echo ""
echo "Test 7: Empty engines array"
cat > /tmp/ralphy-test/config.yaml << 'EOF'
parallel:
  engines: []
  distribution: "round-robin"
  max_concurrent: 3
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
if [[ -z "$result" ]]; then
  echo "✓ Success: Returns empty for empty engines array"
else
  echo "✗ Failed: Should return empty but got: $result"
fi

echo ""
echo "Test 8: Engine with missing weight field (should default to 1)"
cat > /tmp/ralphy-test/config.yaml << 'EOF'
parallel:
  engines:
    - name: "claude"
    - name: "opencode"
      weight: 3
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
IFS='|' read -r engines distribution max_concurrent <<< "$result"
if [[ "$engines" == "claude:1 opencode:3" ]]; then
  echo "✓ Success: Default weight applied: $engines"
else
  echo "✗ Failed: Expected 'claude:1 opencode:3', got: $engines"
fi

echo ""
echo "Test 9: Only max_concurrent specified (no engines)"
cat > /tmp/ralphy-test/config.yaml << 'EOF'
parallel:
  max_concurrent: 8
EOF

CONFIG_FILE="/tmp/ralphy-test/config.yaml"
result=$(load_parallel_config)
if [[ -z "$result" ]]; then
  echo "✓ Success: Returns empty when no engines specified"
else
  echo "✗ Failed: Should return empty but got: $result"
fi

echo ""
echo "Extended tests completed!"
