# Player healthbar contracts

[Dispatcher](../../panorama/scripts/manifests/ql_healthbar/manifest.js),
[shared styles](../../panorama/scripts/manifests/ql_healthbar/shared.js),
[variants](../../panorama/scripts/manifests/ql_healthbar/variants/) and
[hero probe](../core/hero_probe.md) are separate owners. Read the active HUD
includes before changing their load order.

The game supplies the native `hud_health.xml` bar layout. QOLLOCK's
`hud_health.css` imports its design tokens before the extracted base stylesheet;
the former XML extension only supplied that token include and an inactive,
collapsed Fortitude zero label. Its markup/styles are removed. The container
override still supplies variant canvases and native health/number bindings.

`HEALTHBAR_TYPE` selects numeric modes 0–5. The dispatcher must tear down the
previous variant's owned panels, classes, schedules and inline styles when the
mode changes or turns off. Shared accent and position cleanup can still matter
when a replacement variant is inactive. Returning to mode 0 must restore native
layout.

The dispatcher owns the derived configuration and one instance of each variant
controller. Controllers expose `update`, `release` and `isActive`; all mutable
source references, signatures, pulse state and animation state belong to those
instances. Public `QOL.healthbar` variant/style entry points delegate to the same
current controllers, without a second engine or poll loop. Root variant classes
remain the complete-config HUD projector's responsibility. The dispatcher reads
the retained Minimalist preset offsets and shared warning policy through its own
declared ConfigStore slice; settings hooks reproject classes before rendering.

Source discovery follows the current native health container and the explicit
canvas children in the shipped XML. Still-living former owners are released on
replacement, including an independently replaced heart grid, number group or
food container. Budhud deletes its owned percentage label when its source or
mode changes. Native current-health color and warning pulse belong exclusively
to `ql_color_warnings`; Budhud observes that color for its percentage readout
instead of running another pulse or clearing the native label. Presentation and accent
signatures are cached only after successful writes; partial writes remain
retryable. Default presentation never clears unrelated native transforms.

Self warnings follow the current health container's shipped canvas or captured
native `HealthBarContent` owners directly. Number labels come from the immediate
`HealthRegenAndTotal > .healthContainer` group; retired labels elsewhere cannot
supply health. Bar/fill colors use `hud_health_bars > .health_bar_line >
.health_bar_border > health_bar > health_bar_Left`, including the native fill's
case-sensitive ID. Unreadable number bindings retain the existing native progress
value/max fallback; unavailable health evidence releases the warning styles.
Shared offsets, appearance and canvas geometry use separate instances of the
common native-style owner. They observe native readback instead of trusting a
desired-style signature; rejected retirement remains pending after disable.
Releasing offsets does not release an independently active scale or accent.
Stopped dispatcher hooks cannot resume presentation.

Fighting Game (FG) creates its own portrait under the current health bar.
Native gold and level portraits are unreliable identity sources. FG uses the
verified pregame hero signal when applicable, then live crosshair evidence and
the current top-bar badge as a fallback. The native dash no longer supplies hero
classes in current captures. The badge is scoped to the spectator target, or
the local player when no spectator target exists; missing, empty, conflicting
or unknown badge evidence hides the portrait. A replaced source panel
must reset image and style signatures. Hideout can still display FG in hero
testing. Shared native healthbar position, scale, opacity and accent settings
also apply there, while animated variant work that needs match health data stops.
Replaced native frame panels must receive the current accent even when its value
is unchanged. Accent discovery follows the native `HealthBarContent > hud_health_bars >
.health_bar_line > .health_bar_border > health_bar_frame` and
`HealthRegenAndTotal > .healthContainer > .healthBacker` owners directly, including
the shipped geometry canvas and the captured native number-container placement.
Generated heart content is outside those owners. FG and Klutz hide native health
division lines. FG also hides the health-container modifier icons; the native
crosshair statuses keep their own presentation.

Minecraft Hearts has a different layout and animation path from the native
bar. Do not generalize geometry or performance results from mode 0 to it.
Every generated row, slot and heart image is tracked by the controller's owned trees. Reconciliation retires moved or destroyed descendants and rebuilds the affected grid; rebuilding or disabling preserves foreign children in the static containers. Blink, low-health jiggle
and healing waves use feature-owned managed one-shots with generation guards.
Hideout, source loss, replacement and disable cancel them and reset their state. Unavailable native health bindings release derived HP/barrier content and animations, then retry at a bounded cadence; the last valid HP is never presented as current data.
A leased Customize selection can render static Minecraft content in hideout;
missing native health uses renderer-owned sample data without modifying native
number bindings. Withdrawal or expiry returns to the ordinary hideout release.
`mc.inspect()` reports the current source, live heart count and animation status
for runtime diagnostics, without exposing mutable controller bookkeeping.

Deferred-damage and incoming-heal fractions use the verified native
`ProgressBarWithMiddle` parents and their `.ProgressBarMiddle` children. The
parents are direct children of `hud_health_bars > .health_bar_line >
.health_bar_border`, shared by pending damage, pending healing and Rat King armor.
Replacing this native owner invalidates the previous feedback generation.
The fraction is the child's measured height divided by its parent height (or a
percentage height before layout). Historical guessed `*_Middle` IDs are no longer
queried. Verify both overlays and their healing/blink timing after compilation;
offline tests prove source routing and lifecycle, not native progress rendering.
Native current/max number bindings remain native; only derived percentage and
experience labels are written by Minecraft.
Minecraft experience reads the current `StatsAndModsContainer > LowerLeft >
gold_and_ap_container` and its native `PlayerLevelContainer > PlayerLevel >
.PlayerLevelContainer` children. Missing owners wait locally; retired gold panels
elsewhere in the HUD cannot supply level or XP values.
Named modifier checks stay within the live center `status_bars > hud_modifiers`
and minimap-side `hud_aura_modifiers` owners. Modifier history and unrelated
components cannot drive poisoned heart textures. Replacing either live owner
invalidates the cached modifier result; ordinary label changes retain the
existing sampling cadence.
Armor icons read the same measured middle-fraction contract from native
`ratking_armor_bar` while `ratKingArmorActive` is present. Their separate owned
tree retires moved/replaced icons without deleting foreign children. Food reads
the native Dash element before other ability charges, accepts either radial
sweep direction and uses foreground completion instead of inferred ready states.
For native layout, hero switching and fill alignment, follow
[client verification](../TESTING.md) after maintainer compile/repack.

Shared overall scale uses `ui-scale` on the static `QOLHealthbarGeometry` canvas
in `hud_health_container.xml`. Bars, regen/health numbers and Minecraft content
are siblings inside that canvas. The layout root merges into the engine-owned
health container; it must not be treated as an extra static panel. The outer
container retains native CSS scale, variant dimensions and aspect-ratio rules.
At nondefault scale, the shared owner fixes the canvas's logical dimensions from
the outer container's actual layout size divided by its native cumulative UI
scale. This keeps percentage-sized bar content and fixed-size number groups in
the same coordinate space. Missing measurements defer scaling; changed native
dimensions or a replaced canvas invalidate the style signature. Old loaded
layouts without the canvas retain the outer-scale compatibility path.
The default, Reset and teardown release canvas dimensions and scale. The shared
owner does not replace rotations or variant-owned child animations. Customize
measures the scaled canvas but moves the outer container. Owned offsets are
returned to zero before releasing the composite native `position` property;
clearing only the JS x/y records must not be treated as proof of relayout.
Cancel, Reset, history and teardown use the same shared restoration path.
Client checks must cover the default bar and each variant at both scale limits,
including health changes, barriers, regen and the aspect-ratio option. Verify
alignment between tilted bar content and health numbers in the client; simulator
style assertions cannot establish native composition.
