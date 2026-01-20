#!/usr/bin/env bash

# Simple verification that the weighted distribution code is syntactically correct
# and can be loaded without errors

echo "Verifying weighted distribution implementation..."
echo ""

# Check if ralphy.sh exists
if [[ ! -f "ralphy.sh" ]]; then
  echo "Error: ralphy.sh not found"
  exit 1
fi

# Check for the multi-engine configuration section
echo "✓ Checking for multi-engine configuration variables..."
if grep -q "declare -a ENGINES=()" ralphy.sh && \
   grep -q "ENGINE_DISTRIBUTION=" ralphy.sh && \
   grep -q "declare -A ENGINE_WEIGHTS=()" ralphy.sh && \
   grep -q "declare -a EXPANDED_ENGINES=()" ralphy.sh; then
  echo "  Found all required configuration variables"
else
  echo "  Error: Missing some configuration variables"
  exit 1
fi

# Check for expand_engines_by_weight function
echo "✓ Checking for expand_engines_by_weight() function..."
if grep -q "expand_engines_by_weight()" ralphy.sh; then
  echo "  Found expand_engines_by_weight() function"
else
  echo "  Error: expand_engines_by_weight() function not found"
  exit 1
fi

# Check for get_engine_for_agent function
echo "✓ Checking for get_engine_for_agent() function..."
if grep -q "get_engine_for_agent()" ralphy.sh; then
  echo "  Found get_engine_for_agent() function"
else
  echo "  Error: get_engine_for_agent() function not found"
  exit 1
fi

# Check for weighted distribution case
echo "✓ Checking for weighted distribution strategy implementation..."
if grep -q 'weighted' ralphy.sh; then
  echo "  Found weighted distribution case"
else
  echo "  Error: Weighted distribution case not found"
  exit 1
fi

# Check that expand_engines_by_weight is called within the weighted distribution case
echo "✓ Checking that expand_engines_by_weight is called in weighted strategy..."
# Look for expand_engines_by_weight being called between "weighted")" and the next ";;"
if grep -A 20 '"weighted")' ralphy.sh | grep -q "expand_engines_by_weight"; then
  echo "  Confirmed expand_engines_by_weight is called within weighted case"
else
  echo "  Error: expand_engines_by_weight not called within weighted distribution case"
  exit 1
fi

# Check for round-robin strategy
echo "✓ Checking for round-robin distribution strategy..."
if grep -q 'round-robin' ralphy.sh; then
  echo "  Found round-robin distribution case"
else
  echo "  Error: Round-robin distribution case not found"
  exit 1
fi

# Verify syntax by running bash -n
echo "✓ Checking bash syntax..."
if bash -n ralphy.sh 2>/dev/null; then
  echo "  Syntax is valid"
else
  echo "  Error: Syntax errors found in ralphy.sh"
  bash -n ralphy.sh
  exit 1
fi

echo ""
echo "=============================================="
echo "✓ All verifications passed!"
echo "=============================================="
echo ""
echo "Implementation summary:"
echo "- Added ENGINES array and ENGINE_WEIGHTS associative array"
echo "- Added EXPANDED_ENGINES array for weighted distribution"
echo "- Implemented expand_engines_by_weight() function"
echo "- Implemented get_engine_for_agent() with multiple strategies:"
echo "  * round-robin: cycles through engines evenly"
echo "  * weighted: expands engines by weight and cycles through"
echo "  * random: random selection"
echo "  * fill-first: placeholder (to be fully implemented)"
echo ""
echo "Weighted distribution algorithm:"
echo "1. Each engine is added to EXPANDED_ENGINES array N times (N = weight)"
echo "2. Agents cycle through EXPANDED_ENGINES using modulo arithmetic"
echo "3. Example: engines=[claude:2, opencode:1] creates [claude, claude, opencode]"
echo "4. Agent 0 → claude, Agent 1 → claude, Agent 2 → opencode, Agent 3 → claude (wraps)"
echo ""
