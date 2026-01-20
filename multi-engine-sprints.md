# Multi-Engine Parallel Execution: Task List

This file defines tasks for implementing multi-engine support in ralphy.

## Technical Context

**Goal:** Enable ralphy to use multiple AI engines when running parallel tasks, distributing agents across specified engines.

**Key Constraints:**
- Bash associative arrays don't propagate to subshells - serialize to env vars
- `run_parallel_agent()` executes in subshells (lines 2255-2257)
- Task 3.1 must be atomic to avoid breaking parallel execution

**Key File Locations:**
- Configuration defaults: lines 14-50
- Global state variables: lines 68-85
- Argument parsing: lines 666-810
- AI command execution: lines 2012-2065
- Parallel agent execution: lines 2150-2260
- Status display: lines 2263-2316

---

## Tasks

- [x] Add multi-engine configuration variables after line 85 in ralphy.sh: ENGINES array, ENGINE_DISTRIBUTION string, ENGINE_WEIGHTS associative array, ENGINE_AGENT_COUNT associative array, ENGINE_COSTS associative array, ENGINE_SUCCESS associative array, ENGINE_FAILURES associative array, and VALID_ENGINES array containing claude, opencode, cursor, codex, qwen, droid
- [x] Add --engine-distribution CLI argument in parse_args() that accepts round-robin, weighted, random, or fill-first values and sets ENGINE_DISTRIBUTION variable
- [x] Implement --engines CLI argument parsing in parse_args() around line 705 that splits comma-separated list into ENGINES array and parses weight syntax (engine:weight) into ENGINE_WEIGHTS with validation that weights are positive integers
- [x] Modify engine flags (--claude, --cursor, --opencode, --codex, --qwen, --droid) to append to ENGINES array instead of setting AI_ENGINE directly, with deduplication for --cursor/--agent alias
- [x] Add backward compatibility after argument parsing: if exactly one engine set AI_ENGINE, if zero engines populate ENGINES with default AI_ENGINE
- [x] Implement validate_engines() function that checks engines are in VALID_ENGINES, verifies CLI commands exist (claude, opencode, agent, codex, qwen, droid), warns about missing CLIs, and filters ENGINES to only available ones
- [x] Display parsed engines in dry-run output showing distribution strategy and engine list with weights
- [x] Create serialize_engine_config() and deserialize_engine_config() functions to pass ENGINE_WEIGHTS through environment variables to subshells
- [x] Implement get_engine_for_agent() function with round-robin distribution: return ENGINES[agent_num % engine_count]
- [ ] Add weighted distribution strategy to get_engine_for_agent(): expand engines by weight and cycle through expanded array
- [ ] Add random distribution strategy to get_engine_for_agent(): return ENGINES[RANDOM % engine_count]
- [ ] Add fill-first distribution strategy to get_engine_for_agent(): calculate agents_per_engine and return engine based on agent_num / agents_per_engine
- [ ] Add engine assignment preview table to dry-run output showing agent number, task name, and assigned engine for first 10 tasks
- [ ] Initialize engine tracking arrays (ENGINE_AGENT_COUNT, ENGINE_SUCCESS, ENGINE_FAILURES, ENGINE_COSTS) at start of run_parallel_tasks() and call serialize_engine_config()
- [ ] Integrate engine into run_parallel_agent() as third parameter, update all call sites to pass get_engine_for_agent() result, set AI_ENGINE in subshell, call deserialize_engine_config(), write engine to status file, and log engine in header
- [ ] Extract inline status monitoring (lines 2263-2316) into display_agent_status() function that accepts arrays of agent numbers, status file paths, and engines
- [ ] Parse engine from status file in monitoring loop using grep for engine= line
- [ ] Update status display format to show engine name: [Agent N (engine): status]
- [ ] Add get_engine_color() function returning ANSI color codes for each engine (claude=blue, cursor=green, opencode=yellow, codex=magenta, qwen=cyan, droid=red) and apply in display
- [ ] Add bc availability check in pre-flight, set USE_BC_FOR_COSTS flag, warn if bc not installed
- [ ] Implement record_agent_result() function that aggregates cost, tokens_in, tokens_out by engine and tracks success/failure counts per engine
- [ ] Call record_agent_result() after each agent completes with engine, cost, tokens, duration, and success status
- [ ] Implement print_engine_summary() function that displays formatted table with columns: Engine, Agents, Success, Failed, Cost, and totals row
- [ ] Call print_engine_summary() in final report section after existing summary output
- [ ] Include engine name in per-agent result output: Agent N (engine): SUCCESS/FAILED - message
- [ ] Implement load_parallel_config() function to load engines from .ralphy/config.yaml using yq, reading parallel.engines array with name and weight fields, parallel.distribution, and parallel.max_concurrent
- [ ] Call load_parallel_config() early in main() after argument parsing, only if ENGINES not already set via CLI
- [ ] Implement deduplicate_engines() function that removes duplicate engine names and sums their weights with warning
- [ ] Improve error messages: unknown engine lists valid options, invalid weight shows expected format, no valid engines suggests solutions, missing CLI shows installation hint
- [ ] Update --help output with --engines and --engine-distribution flags, including examples
- [ ] Verify backward compatibility: single engine flag works, no engine uses default, single task mode works, existing config without parallel.engines works
- [ ] Add multi-engine section to README.md with usage examples for --engines, weight syntax, --engine-distribution, and config.yaml format
- [ ] Create examples/multi-engine-basic.yaml with simple two-engine round-robin config
- [ ] Create examples/multi-engine-weighted.yaml with weighted distribution config example
- [ ] Update docs/multi-engine-spec.md marking implementation complete and noting any deviations
