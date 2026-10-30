# Native update reliability audit

## Scope and findings

The October 2026 failure was reproduced against GameTracking revision
`0ba033e3eea00d658d63e03719295cf5039e8057`. The source review stopped because a
quickbuy regression required an old native card size. That assertion originated
in a previous stale-resource repair; it was not a dimensional requirement of the
quickbuy companion. Required selectors, bindings and global states remain checked.

The deeper review found additional integration issues:

- Manual Actions previews generated a report without applying the candidates
  being validated. They now validate the same proposed tree as normal reviews;
  publication and notifications remain disabled for previews.
- Native identity alone could suppress regeneration after mod or test fixes.
  Duplicate suppression now compares the candidate source/test/tool tree too.
- The Worker could skip newly watched paths at an already checked upstream SHA.
  Its checkpoint now includes the watched path list.
- Retired XML overrides remained in the watched manifest. Their watches were
  removed, with a regression requiring the manifest to match owned source files.
- Refreshed quickbuy CSS centers the first card. Enhanced quickbuy retains the
  left-aligned coordinates used by its companion previews. The native blocked-
  purchase children and global state were incorporated through a manually
  reviewed XML resolution, checked for structural preservation of mod changes.

## What the tests protect

The source-read inventory is collected from actual test execution, including
reads made through helpers. Many runtime tests share the HUD/settings XML load
graph; those are not independent hardcoded assertions about every native panel.
The stylesheet scanner and import checks also read many files generically.

| Area | Preserved requirement | Historical detail allowed to change |
| --- | --- | --- |
| Quickbuy | Required global states, queue/sale bindings, native hooks and companion alignment | Card dimensions; additional listener classes |
| Party count | Count and native button share slot geometry | Native geometry if the extension follows it |
| Unit status | Native name visibility and separate stamina placement for name states | Exact stamina pixel offsets |
| Shop | Interactive abilities and build editor stack above the shop; shop stacks above the topbar | Native layer number if ordering remains valid |
| Minimap | Fixed-icon render surfaces preserve native zoom proportions | Values that retain those proportions; unsupported expressions require review |
| Hero testing | Native stylesheet owns locale-specific child visibility; mod controls only its root | Native locale selectors and label-rule organization |
| HUD XML | Mod bootstrap, required resource includes, binding canvases and preserved XML edits | Native-only panel type lists |

The HUD and hero-testing tests were changed with maintainer approval after
reviewing their original snapshot assertions. Controlled scenarios verify that
native additions/locale-selector changes pass, while lost mod bootstrap,
missing native stylesheet imports and mod-hidden localized hints fail.

No general rule says that native changes are safe. A changed required selector,
binding, coordinate relationship or insertion parent can legitimately stop an
update. Old snapshots expose requirements and stale assumptions; they are not
expected to all pass against today's mod and engine.

## Reproduce the audit

Use an existing fetched GameTracking checkout and installed QOLLOCK Node
dependencies. Keep the new evidence directory inside this checkout so copied
tests can resolve dependencies through the parent `node_modules` directory.
The tool never fetches, changes the native checkout, publishes, compiles or packs.

```sh
python scripts/replay_native_updates.py --native-repo /path/to/GameTracking-Deadlock --ref origin/master --revisions 60 --cases 200 --snapshots 6 --file-tests --mutations --output .upstream-review/native-history-run
```

For an immutable reproduction, replace `origin/master` with the full native SHA
recorded in the report. The output directory must not already exist. `--cases`
is a maximum of distinct file/blob states, balanced across watched files; it does
not fabricate cases when the selected history window contains fewer states.

The tool performs three different checks:

1. Merge each selected historical state into a copied current source tree and
   attempt a return to its applied native base. Conflicts keep sources and the
   applied base unchanged. Each blob is checked against its Git identity.
2. With `--file-tests`, substitute individual raw historical CSS files and run
   the tests observed reading them, even when merging would refuse that file.
   Raw native XML is excluded because it would erase the mod's scripts/children.
3. With `--snapshots`, generate whole-source proposals at sampled native
   revisions and run affected tests. Pending files retain current local sources,
   so a passing proposal does not imply those pending changes were validated.

`--mutations` checks benign changes and intentional violations against the
production test assertions. Every group first runs an unmodified control. Files
are restored after each case, including test-runner failures.

`report.json` contains source commit and copied-working-tree digest, exact native
revisions/blobs, per-file outcomes, refusal reasons and test log names.
`test-dependencies.json` records observed source reads; `report.md` summarizes
the findings. Reports, source copies and logs are local ignored evidence.
Partial case results are retained if a replay raises an error.

Exit 0 means the selected checks produced no compatibility/ownership findings;
exit 1 can mean a historical test failure, a changed restore result, or a failed
controlled expectation. Inspect the report rather than interpreting every
nonzero exit as an updater crash. Invalid inputs or unavailable tooling raise
an error. A current baseline failure stops historical interpretation.

## Interpretation and remaining checks

Source-read tracing covers synchronous file reads/existence checks on executed
test paths, not every possible branch or future asynchronous reader. It does not
replace review of the tests and their consumers.
Trace records are keyed by test identity, not process ID: Windows can reuse PIDs
during a suite. The runner rejects an inventory missing any baseline test file,
so incomplete tracing cannot silently narrow the selected regression coverage.

A merge/restore round trip need not reproduce the original bytes or structure.
For example, today's HUD contains native changes ahead of the manifest's applied
base. If both the mod and visited native version contain the same additions,
three-way merging coalesces them into the new base; restoring an older base can
remove them again. The report retains that diff for ownership review rather than
claiming a proven loss of mod changes. Native removals remain manual reviews,
including on the return leg of a history replay.

Historical failures include old shop hierarchies, incompatible minimap geometry,
missing quickbuy hooks, older name/stamina rules and raw native CSS whose existing
syntax repairs would be lost. These findings must not be mass-converted into
passing assertions. Separate test-contract changes from required source repairs.

Offline tests do not verify native CSS grammar, C++ panel lifecycle, rendering,
localization delivery or gameplay behavior. After a maintainer compile/repack,
check normal/enhanced quickbuy, full/locked slots, high unspent souls, preview
alignment, shop input/stacking, minimap zoom and localized practice controls.
Local checks also do not execute the modified hosted workflow or deploy a Worker.
