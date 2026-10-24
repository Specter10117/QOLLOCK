# HUD lookup and operation profiling

Use [the tool map](TOOLS.md) to choose a command. These tools count supported
operations requested by production JavaScript in an offline replay. They do not
measure native traversal time, layout, rendering, GPU work or FPS.

## Inputs and capture identity

The profiler, lookup tracer, static dependency audit and Git-ref comparator all
default to `captures/deadlock_hud_dump.json`, the repaired October 3 native
Debugger hero-testing export. [Capture provenance](../captures/README.md) records
its identity and limitations. The XML-composed HUD and synthetic native panel
seeding have been removed; an invalid/missing input fails without a fallback.

Choose another scenario explicitly:

```text
node scripts/profile_hud.js --tree captures/<scenario>.json --seconds 20
node scripts/trace_feature_hud.js --capture captures/<scenario>.json --all --seconds 20
node scripts/audit_lookups_vs_capture.js captures/<scenario>.json --json
```

Use completed receiver JSON from the standalone HUD-Dumper, not packet journals
or raw descriptions. See [capture testing](CAPTURE_TESTING.md) for collection,
import, forest selection and fidelity checks. The replay retains only the selected
HUD hierarchy, not unrelated native windows. It does not inject a synthetic shop
or bind native commands to a separate game model. QOLLOCK may create its own
panels during boot and sampling.

The capture is static and may span many frames. Displayed classes, missing text,
unavailable target flags and description freshness remain explicit limitations.
A token absent from one capture can still exist in another game state or be
created by C++. Presence does not prove reachability from a caller's search root.

## Find broad or repeated lookups

```text
node scripts/audit_lookups_vs_capture.js --json
node scripts/trace_feature_hud.js --all --seconds 20 --json
node scripts/trace_feature_hud.js ql_crosshair_stats --seconds 10
node scripts/trace_feature_hud.js ql_crosshair_stats --seconds 0.2 --json --events
node scripts/trace_feature_hud.js --defaults --enable ENABLE_CROSSHAIR_STATS=1
```

The static audit scans actual active HUD includes for ID/class dependencies,
including supported aliases and constant strings. `--vanilla <panorama-dir>` adds
extracted native XML evidence; otherwise only QOLLOCK layouts are consulted.
Dynamic arguments are reported separately. This is an inventory, not executed
lookup frequency, exhaustive context coverage or proof of native absence.

The tracer runs production callbacks and groups search method, target and actual
root by attribution owner. Child-index paths distinguish duplicate IDs. Its feature
argument filters the report; other enabled features keep running. `--all` means
all observed owners, not all possible features. `--events` retains individual
ID/class/direct-child events and ordered class result paths. Rates use the measured
window only; `--warmup` selects warm-up duration in seconds. JSON remains parseable
with `--verbose`.

## Profile operations

```text
node scripts/profile_hud.js --seconds 20
node scripts/profile_hud.js --seconds 20 --healthbar 5
node scripts/profile_hud.js --defaults --enable ENABLE_CROSSHAIR_STATS=1
node scripts/profile_hud.js --seconds 20 --save before
# make the change
node scripts/profile_hud.js --seconds 20 --compare before
```

The tracer and profiler default to expanded config. Only prefix-selected toggles
are expanded; this does not exercise every setting, numeric variant, gameplay
event or feature. `--defaults` keeps normal defaults and `--enable KEY[=VALUE],...`
applies explicit overrides. Healthbar selection is a numeric enum, so use
`--healthbar` to exercise a variant; capture contents still limit its coverage.

Scheduler poll callbacks are attributed to `mf:<featureId>`. Named scheduled
callbacks receive `loop:<name>` attribution; other work remains unattributed.
Custom JavaScript walks through `Children()`/`GetChild()` and uninstrumented APIs
do not contribute native-search visit counts. These are not total JavaScript work
or native traversal steps.

Read raw counters alongside the weighted ranking:

- `nodes/s`: visits counted in supported searches on this replay hierarchy.
- `miss/s`: ID lookups with no match in the supplied scenario.
- `style±` / `style=`: changed and identical style assignments in the simulator.
- `styleR`, `classR`, `propR`: string-key style gets, `BHasClass` requests and the
  panel properties listed in `meta.readCoverage`. Getting `panel.style` alone,
  setter equality checks and internal class checks in setters are excluded.
  Other properties/APIs and pure JavaScript work, including color computation,
  are not covered. These count requests, not native getter cost.
- `cb/s`: managed poll/named scheduled wrapper entries. `scheduledCallbacks` is
  the separate count of all virtual-clock callbacks fired in the measured window.
  Neither is a count of useful/idle callbacks. Absence of counted writes does not
  establish absence of visual changes or useful work.
- Class/text/attribute writes, string-attribute reads/bytes and created/deleted
  panels are modeled operations, with native cost unmeasured.
- `cost/s`: historical arbitrary weights from `scripts/simulator/perf/counters.js`,
  not measured milliseconds. New read/callback counters have no assigned weight;
  a read-heavy owner can therefore rank low. Inspect raw counts and read details.

`REPEATED READ CANDIDATES` and JSON `investigations` expose source/client
investigation leads. Read details pool all panels by owner/kind/property (class
name for `BHasClass`); repeated keys do not establish repeated reads of the same
panel, equal values, unnecessary work or a cache opportunity. Required native
feedback/ownership validation can read repeatedly without writing. Identical
assignments likewise do not prove an unnecessary native setter. The read-detail
cap and omitted-event count are reported in `snapshot.readDetailCoverage`;
aggregate counts remain complete for the covered operations. Setup, warm-up and
outside-window observation are excluded from operation counts.

`meta.sourceCoverage` records the actual loaded HUD script paths and their source
fingerprint. Capture/config/model fingerprints, read coverage and unavailable
measurements remain separate; a static capture supplies neither computed CSS nor
changing native gameplay state. These are partial observations, not an exhaustive
account of native/property reads.

`MODEL LOOKUP MISSES` lists investigation candidates. Narrow each search using
verified ownership evidence and preserve late/replaced-source discovery. A lower
count after a callback crashed or an owner was disabled is not an optimization.
Read enabled coverage, unsupported calls, callback errors and registry streaks.
`meta.wrapperErrors` retains bounded details and the full count of exceptions
escaping attributed callbacks, including warm-up and subsequently recovered
Scheduler errors; registry streaks alone reset after successful ticks. Failures
caught inside feature code remain outside this history. The profiler reports
`validity.issues` and exits unsuccessfully for observed failures or changed enabled
coverage at sample boundaries. It does not observe every intervening lifecycle
transition. Zero covered operations do not prove the mod did nothing.

Saved-run `--compare` prints raw differences with output equivalence explicitly
unverified, and refuses different sampling windows, model/config/tree identities
or missing/failed validity checks. Old baselines require fresh runs. It makes no
percentage optimization claim; use the source-revision comparator with selected
output observations below for the stronger comparison checks.

## Compare source revisions

```text
node scripts/compare_hud_refs.js --before HEAD --after working-tree --expanded --seconds 20 --json
```

`--tree` selects another capture for both runs. Local Git refs are read without
checkout changes, stashing, fetching or builds. Each revision supplies its own
active HUD script set; both receive the baseline's complete config input.
Working-tree identity includes HEAD and a source fingerprint.

Compare the same hierarchy/state, config, warm-up, sample duration and enabled
coverage. `--warmup-ms` sets comparator warm-up; consider a longer interval when
native bindings or identity cannot be replayed. Do not silently mix windows.
Reports retain both raw snapshots, identities, fidelity and failure information.
Different/unknown simulator, tree or config fingerprints and runtime failures
invalidate comparison inputs. Old reports require fresh baselines.

Add `--observe` with a read-only JSON expression selecting the changed feature's
output. Without matching selected observations and unchanged enabled coverage,
percentages are withheld. Matching observations support only the selected output;
they do not prove all behavior equivalent or establish a native performance win.

## Lifecycle accounting and regressions

```text
node scripts/audit_runtime_lifecycle.js --cycles 3
node scripts/audit_runtime_lifecycle.js --cycles 10 --json
node --test tests/profiler_trace.test.js tests/capture_tree.test.js tests/runtime_lifecycle_audit.test.js
```

The lifecycle audit instruments raw `$.Schedule` before loading production code.
Quickbuy uses a reduced fixture with queue entries and a preview, active/disabled
modes, repeated queue events, a retained context in hideout and a destroyed context.
HUD defaults run over the tracked capture with injected hideout/scoreboard changes.
Neither path establishes native panel retention or teardown.

Pending task counts, stack-derived schedule origins, callback errors and modeled
operations are reported. Quickbuy's single-poll invariant fails on growth; HUD
growth is reported for investigation because delayed work can be legitimate.
`tests/runtime_lifecycle_audit.test.js` includes fault injection that recreates the
quickbuy scheduling leak and must fail the audit. `--quickbuy-ref <ref>` reads only
that revision's quickbuy script as a negative control; it is not a whole-build
comparison. Image requests and changed paths are counted separately, without a
native asset pipeline.

Accounting regressions verify warm-up exclusion, precise virtual timestamps,
observer/counter agreement, native duplicate-ID selection, capture integrity,
forest scope, text/attribute separation, non-overwriting import and comparison
rejection. Explicit small fixtures test logical states; default CLI regressions
verify the tracked capture is selected. No operation ceiling establishes an FPS
target. Run `npm test` for the complete offline gate.

The October 17 native search probe is retained in `tests/fixtures/native-search`.
It verified per-parent direct-child priority, recursion order and ordered class
results for the tested topology. Simulator and profiler share those search rules.
Unsupported APIs and other native behaviors remain outside that evidence.

## Client evidence

After maintainer compile/repack, check feature output, source replacement,
disable/re-enable, menu return/re-entry and relevant gameplay states in the client.
Use Dev -> Benchmark (Current Config) for managed callback diagnostics; its timing
and temporary lookup-hook coverage/overhead are documented in [testing](TESTING.md).
Use [HUD state recording](ui/hud_state_recording.md) for transition evidence.

For a performance claim, repeat comparable client scenes with/without the change
and compare frame times separately from diagnostic collection/reporting overhead.
Offline counters, a static capture and green tests cannot establish FPS.

`QOL_UTILS.SetProfilerEnabled`, `ProfileHit` and `DumpProfile` provide a separate
opt-in manual hit counter. Dumps use actual elapsed time since enable/previous
dump (at least 10 seconds) and reset counts. This is call frequency, not an
automatic sampler or native timing measurement.
