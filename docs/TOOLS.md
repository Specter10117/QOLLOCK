# Diagnostic tool map

Start with the question, then choose the input. A static dependency inventory,
a simulated lookup trace and a native client benchmark answer different questions.

## Panel lookup investigations

Use the tracked [October 3 native Debugger capture](../tests/fixtures/hud/README.md) for
lookup investigations in its hero-testing scenario. The filename is stable;
check its metadata before comparing any saved reports. Missing panels in one
scenario do not establish native absence.

| Question | Command | Input and limits |
| --- | --- | --- |
| Which active HUD ID/class dependencies occur in the capture? | `node scripts/audit_lookups_vs_capture.js --json` | Defaults to `tests/fixtures/hud/2026-10-03-hero-testing.json`. Static inventory, not execution or caller reachability. |
| Which owners repeatedly search broad subtrees or miss? | `node scripts/trace_feature_hud.js --all --seconds 20 --json` | Defaults to the same capture. Counts simulated calls and visited nodes by actual search root. |
| Where does one owner's lookup work come from? | `node scripts/trace_feature_hud.js ql_compass --seconds 20 --json` | The feature argument filters the report; other enabled features still run. Use `--events` for individual lookup events. |
| Which owners issue lookups, covered reads, identical writes and callbacks? | `node scripts/profile_hud.js --seconds 20 --json` | Defaults to the same capture. Reports owner/property investigation candidates and explicit partial API coverage, not native costs or proof of redundant work. `--tree <file>` selects another hierarchy. |
| Which panels receive inline style writes, in what order and from which owners? | `node scripts/trace_styles_hud.js --seconds 20 --events --json` | Same default capture; `--capture <file>` selects another. Bounded owner/panel/property details and ordered modeled mutation outcomes. Values are requested inline values, not computed styles, visual changes or proof of a writer conflict. |
| Where is a CSS selector token declared, and which source chains reach it? | `node scripts/trace_style_sources.js .hud_hero_testing_root --property y --layout panorama/layout/hud.xml` | Static local XML/CSS graph, independent of capture replay. Shows declaration locations and include/import routes; does not establish native component loading, selector applicability or cascade. |
| Did an edit reduce work with the same inputs? | `node scripts/compare_hud_refs.js --before HEAD --after working-tree --expanded --seconds 20 --json` | Defaults to the same capture. Reads local Git source sets without checkout changes. Defaults to normal config; `--expanded` selects expanded coverage. Add `--observe` with a read-only JSON expression for the feature's output; without matching observations percentages are withheld. |

The tracer and profiler use expanded config unless `--defaults` is supplied.
Use `--enable KEY=VALUE` for specific settings. Expanded coverage does not exercise
every numeric variant; choose `--healthbar` explicitly for a profiler healthbar run.
Compare the same tree, config, warm-up, sample duration and enabled coverage.
Read callback/registry errors and capture fidelity before interpreting counts.
None of these tools measures native traversal time, frame times or FPS.

The profiler separately counts explicit `Children`, `GetChild` and `GetChildCount`
requests, with returned-reference counts for `Children`. Inspect owner rows and
`meta.enumerationCoverage`; these do not contribute native-search visits or acquire
native-cost weights. Moving a search into a JavaScript walk does not make that work
free or fully measured.

For a different state, pass `--capture <file>` to the tracer or an explicit
positional capture path to the static audit. The profiler/comparator use `--tree`.
See [capture testing](CAPTURE_TESTING.md) for collection, import and interpretation,
and [profiling](PROFILING.md) for operation accounting and comparison limits.

## Stylesheet source investigations

```text
node scripts/trace_style_sources.js .hud_hero_testing_root --property y --layout panorama/layout/hud.xml
node scripts/trace_style_sources.js .weapon_ammo --property color --include-base --json
node scripts/trace_style_sources.js '#AbilitiesContainer' --json
```

Supply one exact lexical selector token: `.class`, `#id` or a panel type.
Prefix names, pseudo-class names and attribute values are excluded; tokens inside `:not()`
are dependencies, not evidence that a panel matches. `--property` selects the
CSS property spelling, not its JavaScript inline-style alias. Base declarations
are excluded by default; imports through base snapshots are still followed.

Each match retains declaration values/lines and every retained local source
route. XML roots stay separate: the tool does not compose component layouts into
the HUD. Outer stylesheets also appear as resource roots because a native layout
or C++ component may request them independently; their native loaders remain
unverified. `--layout` annotates all matches rather than hiding other contexts.
A missing route is an investigation candidate, never proof of unused/broken CSS.

JSON separates proven source import cycles (`diagnostics`, unsuccessful exit),
missing selected-layout routes (`candidates`) and unavailable resources/excluded
syntax (`unknown`). Unknown native imports do not fail the command. Malformed
sources rejected by the existing stylesheet gate are excluded explicitly.
Rules in keyframe bodies are excluded; escaped selectors and other at-rule bodies
are reported as uncovered. Path enumeration is bounded with omitted-branch counts; an unobserved
selected route becomes unknown if that bound is reached. Reports include the
scanned file list and source fingerprint so saved findings can be identified.

This is a source inspector, not a CSS engine or another replay profiler. It
does not choose a winning declaration, resolve defines, match the live tree,
inspect inline writes, prove layout/rendering or measure native time/FPS.
Equal declarations and multiple routes are retained without declaring redundant
work or conflicts. Use the inline-style tracer for modeled JavaScript writes
and maintainer client checks for actual style application.

## Other checks

| Question | Tool | Scope |
| --- | --- | --- |
| Did the change break offline checks? | `npm test` | Smoke, styles, Node regressions, compact schema, API checks and lint. Run before every commit. |
| Do reminder dispatches resolve to the intended sound sources? | `node --test tests/audio_event_contract.test.js` | Production HUD and Audio-button paths against source event definitions and shipped WAV existence; custom slots check routing only. Does not verify compilation, native playback or loudness. |
| Do schedules accumulate across transitions? | `node scripts/audit_runtime_lifecycle.js --cycles 3` | Production HUD/quickbuy scripts in controlled fixtures; modeled lifetime, not native teardown. |
| Is a shared helper name actually exported? | `node scripts/audit_helper_calls.js` | Statically resolvable calls against loaded HUD exports; not native API signatures. |
| Does an unobserved dependency have native XML evidence? | `node scripts/audit_lookups_vs_capture.js --vanilla <panorama-dir> --json` | Adds current extracted XML evidence to the active-HUD ID/class audit. Missing evidence is a candidate, not a failed existence check. |
| What changed after a game update? | `node scripts/audit_game_update.js snapshot --vanilla <panorama-dir>` | Take `snapshot` before updating the extract, then rerun with `check` in place of `snapshot`; see [game update audit](GAME_UPDATE_AUDIT.md). |
| Are runtime hooks reporting source problems in the client? | Dev test collector | Read-only feature hooks; see [testing](TESTING.md). Skips and observations are not rendering verification. |
| What does managed polling cost in the client? | Dev -> Benchmark (Current Config) | Callback timing and temporary lookup instrumentation; scope and overhead are documented in [testing](TESTING.md). |
| Which feature exclusions improve observed UI cadence? | Dev -> FPS investigation (Current/Expanded Config) | Repeated A/B/B/A trials, individual owner follow-up and active layer settings for confirmed minimap candidates. UI cadence is a proxy, not engine FPS; confirm with native telemetry. Opening Esc stops and restores the scan. See [testing](TESTING.md#in-game-feature-exclusion-investigation). |

Use controlled simulator fixtures for logic/lifecycle regressions. Whole-HUD
profiling uses a validated supplied hierarchy; missing/invalid capture inputs fail
instead of falling back to an XML composition. Use maintainer compile/repack and
targeted client scenarios for layout, source lifetime and gameplay; compare
repeatable client frame-time captures separately for performance claims.
