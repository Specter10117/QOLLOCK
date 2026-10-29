# Minimap runtime contracts

The [manifest](../../panorama/scripts/manifests/ql_minimap_runtime/manifest.js)
owns Base, Alt and Tab minimap geometry, opacity, crates and tunnels.
[ql_compass](ql_compass.md) owns rotation and flip; objective overlays and
Rejuvenator phase state have separate owners. Crate positions come from
`ql_minimap_crate_data.js`, refreshed from the supplied MapHunter static table.
Crates belong to the native `hud_minimap` render surface so native zoom,
rotation and flip apply to their reference coordinates. Tunnels retain their
viewport anchor. Crates and tough crates share the configured match-time window;
its end is exclusive, and the maximum endpoint means no end limit.
Crate container and marker rules load through the native minimap stylesheet.
Both reference owners suppress their overlays in hideout and Street Brawl in
their runtime paths, so inline visibility cannot defeat the mode gate.

The separate `ql_minimap_loot` owner adds static tough-crate, healing-snack,
statue, localized district-name and numbered route layers. Their source is
`ql_minimap_loot_data.js`; this is a reference map, with no live loot availability
tracking. Discovery follows direct native owner breadcrumbs and waits when they
are absent. A positive native Midtown class is required for these new layers.
Native district tokens supply HUD translations, independently of the settings
language. Routes have a separate match-time window; appearance settings never
move the map-relative coordinates. Opacity and visibility changes reuse the
created groups and markers. Marker and route scale changes refresh only their
affected geometry, including hidden groups before reveal; district-name selection
retires only the name group. Disable/replacement retires all owned children.

The ordinary-crate and loot reference roots request native composition caching
with the same creation attribute used by the game's top-bar ability container.
Only these two static roots request it; native canvas, moving map icons and
individual markers do not. Settings still update the existing child geometry,
text and visibility. Offline checks do not model composition caching: after
repacking, compare the Expanded Config exclusion report in the same stationary
scene and check Base/Alt/Tab zoom, rotation/flip, marker scales, opacity and
district-name changes for stale or clipped content and image quality.


Draw-over-UI behavior uses a stacking override without reparenting
`minimap_persp`. The native location labels inherit their district/building
dialog variables through the HUD hierarchy and resolve as `INVALID` if that
listener is moved. Tab state comes from the stationary HUD scoreboard listener.
Scoreboard toggle is a refresh trigger, not a boolean state payload. Deferred
refreshes belong to the feature Scheduler task group so disable cancels them;
event subscriptions still require explicit removal.

The feature's `geometry.js` owns scoped native-panel discovery and its style
records. Base, Alt and Tab use the same viewport geometry path; replacement
panels invalidate the applied presentation. Disabling releases only the geometry
overrides and renderer class owned by that path. Whole-HUD classes remain owned
by the app's complete configuration synchronization.
Geometry and native renderer/content appearance use the common native-style
owner, with distinct property plans. Native readback invalidates cached writes;
rejected retirement remains retryable after disable. Created tunnel and crate
trees retain their separate created-child lifecycle. The renderer's minimalist
class has one native owner rather than parallel discovery and render writers.

Content discovery also observes replacements of `canvas`, legacy `map_render`
and the background images inside `MinimapBackgroundTest` in an unchanged
viewport. Minimalist opacity fades those images individually, preserving the
native surface/underground/tunnel opacity gates and the sibling canvas/effects.
Previous living native targets release their
owned tint/opacity/range overrides; tunnel and crate panels belong to the
current anchor generation. Missing native sources are retried without treating
a live cached handle as evidence that the current map still contains it.

Settings are derived in lifecycle hooks; the active poll samples native view
state without rebuilding the configuration model. Stopped settings/event hooks
cannot recreate presentation or polling. Current HUD replacement releases the
previous presentation, and temporary loading roots cannot own map overlays.
Alt/Tab offsets retain their existing one-sided margin units: center alignment
moves the viewport by half the margin change. Customize accounts for that ratio
in dragging, frame previews, alignment, resize anchoring and slider travel;
saved offsets and the Base minimap's edge-aligned units remain unchanged.
Crate and tunnel trees use complete created-child ownership, including markers
moved outside their container. Crate data replacement reuses unchanged indices
and retires removed branches. Partial construction or style writes stay hidden
until a later active poll succeeds; rapid re-enable waits for previous queued
trees to retire rather than adopting them.
Sibling crate markers reconcile as one owned-tree batch. Their complete
ownership checks still run at the active cadence, using one immediate-child
snapshot per parent instead of one sibling search per marker.

Objective overlays consume the separate [phase producer](ql_objective_timers.md).
Their fixed-icon bridge surface and placement use the same Base/Alt/Tab size
and view precedence as this owner. Ordinary map scaling retains the logical
surface that scales with its parent; fixed-icon mode keeps timer text/icon size
while moving the bridge positions with the resized viewport.

Fixed Icon Size resizes the viewport without magnifying its HUD parent. The
renderer must resize with it: leaving `hud_minimap` at its fixed native pixel
dimensions enlarges only the surrounding frame. The scoped renderer class in
`hud_minimap.css` expresses native dimensions as viewport-relative percentages,
preserving the original render/viewport proportions. Native zoom-level and
scoreboard selectors still choose the corresponding internal render surface;
the large zoom surface must not be replaced by a viewport-sized square. Turning
Fixed Icon Size off releases the viewport width/height overrides and class so
the native pixel dimensions apply again.

`minimap_persp` is a non-square native host for location text and edge UI. Both
icon modes keep its native dimensions and unit scale, with `noclip` allowing the
square viewport to grow beyond it. Magnifying that taller host can let screen
height constrain one axis before the other. Ordinary mode instead applies
`ui-scale` to the square viewport; fixed-icon mode changes its dimensions.
Both paths neutralize the viewport's native scale and insets, align its bottom
right corner in Base, and center it in Alt/Tab. Switching icon modes therefore
keeps the same map size and anchor. The viewport retains native clipping, and
disable releases the owned geometry without changing saved sizes or offsets.
Check markers, click targets, range circles, Alt/Tab switching and reset in the
repacked client.
