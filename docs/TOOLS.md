# Diagnostic tool map

Start with the question, then choose the input. A static dependency inventory,
a simulated lookup trace and a native client benchmark answer different questions.

## Panel lookup investigations

Use the tracked [October 3 native Debugger capture](../captures/README.md) for
lookup investigations in its hero-testing scenario. The filename is stable;
check its metadata before comparing any saved reports. Missing panels in one
scenario do not establish native absence.

| Question | Command | Input and limits |
| --- | --- | --- |
| Which active HUD ID/class dependencies occur in the capture? | `node scripts/audit_lookups_vs_capture.js --json` | Defaults to `captures/deadlock_hud_dump.json`. Static inventory, not execution or caller reachability. |
| Which owners repeatedly search broad subtrees or miss? | `node scripts/trace_feature_hud.js --all --seconds 20 --json` | Defaults to the same capture. Counts simulated calls and visited nodes by actual search root. |
| Where does one owner's lookup work come from? | `node scripts/trace_feature_hud.js ql_compass --seconds 20 --json` | The feature argument filters the report; other enabled features still run. Use `--events` for individual lookup events. |
| What are total operations and redundant writes? | `node scripts/profile_hud.js --seconds 20 --json` | Defaults to the same capture. `--tree <file>` selects another hierarchy. No XML composition or synthetic native panels. |
| Did an edit reduce work with the same inputs? | `node scripts/compare_hud_refs.js --before HEAD --after working-tree --expanded --seconds 20 --json` | Defaults to the same capture. Reads local Git source sets without checkout changes. Defaults to normal config; `--expanded` selects expanded coverage. Add `--observe` with a read-only JSON expression for the feature's output; without matching observations percentages are withheld. |

The tracer and profiler use expanded config unless `--defaults` is supplied.
Use `--enable KEY=VALUE` for specific settings. Expanded coverage does not exercise
every numeric variant; choose `--healthbar` explicitly for a profiler healthbar run.
Compare the same tree, config, warm-up, sample duration and enabled coverage.
Read callback/registry errors and capture fidelity before interpreting counts.
None of these tools measures native traversal time, frame times or FPS.

For a different state, pass `--capture <file>` to the tracer or an explicit
positional capture path to the static audit. The profiler/comparator use `--tree`.
See [capture testing](CAPTURE_TESTING.md) for collection, import and interpretation,
and [profiling](PROFILING.md) for operation accounting and comparison limits.

## Other checks

| Question | Tool | Scope |
| --- | --- | --- |
| Did the change break offline checks? | `npm test` | Smoke, styles, Node regressions, compact schema, API checks and lint. Run before every commit. |
| Do schedules accumulate across transitions? | `node scripts/audit_runtime_lifecycle.js --cycles 3` | Production HUD/quickbuy scripts in controlled fixtures; modeled lifetime, not native teardown. |
| Is a shared helper name actually exported? | `node scripts/audit_helper_calls.js` | Statically resolvable calls against loaded HUD exports; not native API signatures. |
| Does an unobserved dependency have native XML evidence? | `node scripts/audit_lookups_vs_capture.js --vanilla <panorama-dir> --json` | Adds current extracted XML evidence to the active-HUD ID/class audit. Missing evidence is a candidate, not a failed existence check. |
| What changed after a game update? | `node scripts/audit_game_update.js snapshot --vanilla <panorama-dir>` | Take `snapshot` before updating the extract, then rerun with `check` in place of `snapshot`; see [game update audit](GAME_UPDATE_AUDIT.md). |
| Are runtime hooks reporting source problems in the client? | Dev test collector | Read-only feature hooks; see [testing](TESTING.md). Skips and observations are not rendering verification. |
| What does managed polling cost in the client? | Dev -> Benchmark (Current Config) | Callback timing and temporary lookup instrumentation; scope and overhead are documented in [testing](TESTING.md). |

Use controlled simulator fixtures for logic/lifecycle regressions. Whole-HUD
profiling uses a validated supplied hierarchy; missing/invalid capture inputs fail
instead of falling back to an XML composition. Use maintainer compile/repack and
targeted client scenarios for layout, source lifetime and gameplay; compare
repeatable client frame-time captures separately for performance claims.
