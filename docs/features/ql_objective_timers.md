# Objective timer producer and consumers

[Rejuv HUD](../../panorama/scripts/manifests/ql_rejuv_hud/manifest.js) is the sole
rejuvenator phase/capture tracker. Its phase model, source handles, charge
history and render state belong to its feature instance.

The published `QOL.state.rejuvState` is a read-only scalar snapshot containing
`running`, `spawnWaiting` and `counter`. The
[minimap timer owner](../../panorama/scripts/manifests/ql_minimap_timers/manifest.js)
reads the phase display from this snapshot and owns its own panels and geometry.
It must not mutate the snapshot or retain the producer's native handles.
The minimap rejuvenator toggle also enables the producer when its HUD toggles
are off; root presentation classes govern those HUD panels independently.
Hideout, Street Brawl, disable and a new match reset the published phase.
Rejuvenator and buff readouts follow the shipped direct-child paths under the
current TopBar. Missing parents or labels wait for that local subtree; similarly
named panels in other components cannot become readout fallbacks. Living
replacement labels receive the current phase text and presentation.
Midboss evidence stays within the native `hud_minimap` renderer reached through
`gameplay_hud > .clamp_width > minimap_persp > minimap_container >
HudMinimapContainer`. Missing or replaced renderers are unknown source states;
other HUD components cannot supply a substitute midboss or reset the phase.

The minimap timer instance derives geometry settings in its settings hooks and
reconciles native objective/clock evidence at its existing cadence. It waits for
the current real HUD and owns every created child through the shared tree
helper. Partial construction stays hidden; moved children and prior instances
awaiting asynchronous deletion are retired. Stopped settings hooks cannot
recreate timer UI. The native map and the producer's scalar snapshot remain
outside that tree's ownership.
Bridge-buff observations enumerate immediate native `hud_minimap` children, as
declared by the map marker snippets and confirmed by the captured renderer.
Nested overlay content cannot act as a spawner. The current direct children,
their live classes and positions are sampled again each update, so moved or
late markers do not leave a cached spawn state.

Capture countdowns distinguish missing native sources from explicit cleared
signals. Source replacement must not terminate a running capture merely because
the new charge subtree has not appeared. Native charge tokens and the native
buff signal retain their established precedence; the feature still ends at its
capture duration even while a charge token remains.

[Rift/urn timer](../../panorama/scripts/manifests/ql_urn_timer/manifest.js) has an
independent instance-local warning/spawn-window model derived from the observed
match clock and native minimap capture-point classes. It does not publish shared
timer state. Capture-point evidence follows the current renderer's direct native
breadcrumbs and immediate marker roots; nested content and minimaps in other
components cannot supply warning/active signals. Missing native renderers supply
neither signal, preserving the timer's estimated-window fallback.
A native source or topbar replacement rebinds the readout while
retaining an active warning deadline. A new match or hideout resets that model.
Its dynamic QOL-created readout and all tracked children are removed on disable
or parent replacement, including children moved outside their former container.
Partial construction stays hidden until reconciliation succeeds.
Hideout temporarily hides the current readout; re-enable creates a fresh owner
instead of adopting a generation queued for asynchronous deletion.
Living HUD replacement resets private clock/source bindings and the warning
model even when the next HUD reports the same match time.

The production lifecycle regressions in
[information_manifest_lifecycle.test.js](../../tests/information_manifest_lifecycle.test.js)
cover source gaps, retained old generations, partial creation/writes, scalar
publication and shutdown. Native phase feedback and layout still require the
maintainer's compile/repack and client scenario.
