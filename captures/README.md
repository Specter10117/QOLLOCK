# Tracked HUD capture

`deadlock_hud_dump.json` is the native Debugger hero-testing capture collected on
**2026-10-03 at 11:46:57.838 UTC**, session `musbu75a-debug`. It replaces the
October 1 HUD-Dumper v2 fixture at the same path.

Source: standalone [HUD-Dumper](https://github.com/Predi-i/Deadlock-UI-Mods/tree/main/HUD-Dumper),
receiver artifact `deadlock_hud_dump_debugger-hero-testing-rebuilt_musbu75a-debug.json`.
This is the repaired receiver reconstruction, not the earlier export whose
description parser failed. The tracked file is a byte-for-byte copy of that
completed artifact; raw Debugger rows, native window forest, reconstruction and
transport metadata are retained.

Artifact SHA-256:
`5f5d4497978ffe70b2ab2232003d8c656d26e17efb5c4f4481c0615ccaf432b8`.

The selected `CitadelHudRoot` hierarchy contains 15,435 panels and 1,331 distinct
displayed classes. Reconstruction reports valid tree/forest, no description parse
errors, no remaining collapsed branches and no unrepresented branches.

This is a static hero-testing snapshot collected over about nine minutes.
`fullHudCapture` remains false; independent live HUD coverage and description
freshness are unverified. There are 97 Label/TextEntry descriptions without text,
and target visible/enabled flags are unavailable. Inspector visibility is not
target visibility. These limitations remain in replay reports.

The static capture audit, lookup tracer, operation profiler and Git-ref comparator
default to this file. The profiler/comparator accept `--tree` to select another
capture; there is no synthetic XML fallback. See [the tool map](../docs/TOOLS.md).
Old reports against the October 1 fixture cannot serve as before/after baselines
for this hierarchy. Additional local captures and reports remain untracked.
