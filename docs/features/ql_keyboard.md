# Keyboard overlay ownership

The HUD `ql_keyboard` manifest owns its created overlay, layouts, rows and
`CitadelBinding` panels. Native input, binding state and shared HUD CSS remain
with their existing owners. The basic/full action choice is retained for saved
configurations. The appearance and Full/Compact/Grid controls use current JSON
settings and the same owned overlay, alongside existing scale, offsets and color
wash. Themes change only presentation; native bindings and press classes remain
the input source.
Theme and scale edits reuse existing bindings; changing an alternate layout or
its action set retires that created generation through the existing owned tree.
Preset colors, borders, fonts and pressed presentation are scoped to this overlay;
native binding/glyph styles elsewhere are unchanged. The upstream standalone
settings window, external storage, counters and trails are not loaded.

The instance resolves the current native `Hud > .HudCore > gameplay_hud` and
waits when gameplay is absent. A replaced living HUD, parent or created child
retires the previous generation. Every created panel is tracked, including
reparented rows/keys and partially constructed layouts, through the shared
created-tree helper. Its topology sweep invalidates the complete layout without
a second private ancestry scan. Internal QOL child IDs do not replace native
glyph IDs or binding actions. Shared panel caches and factory helper aliases
are no longer part of this owner.

Foreign previous roots are retired instead of becoming a permanent mount wait;
rapid re-enable waits for queued deletion before recreating one layout. Retired
created children remain hidden and deletion retries continue while active.
Loading-root lookalikes cannot host the overlay. Partial geometry/glyph/wash
writes keep the complete overlay hidden until the next successful render.
The selected Keyboard Customize sample exposes the real binding box despite
the ordinary shop visibility rule. Its owned sample class is derived from the
validated preview selection, and is removed when selection changes, the lease
expires or the preview is withdrawn. This exception does not change shop state,
bindings, layouts or persistent settings.

Geometry and palette/custom RGB wash are derived in settings hooks. Native
`CitadelBinding` glyphs can appear or change later, so polling reconciles current
descendants independently of the settings signature. The extracted
`citadel_ui_keyboard_glyph.xml` declares `KeyboardLetter` and
`ModifierCombinerLabel` as Label **types**, without a generic Label class.
Mouse images retain their native `MouseButtonGlyph` class. Successful styling
is guarded; rejected writes retry, and moved native glyphs lose only the code
properties this instance attempted to own. The shared native-style owner retains rejected retirement after disable, retries cleanup without restarting observation, and protects a new generation's leases from an old cleanup callback.

`keyboard_owner_lifecycle.test.js` checks both action layouts, geometry/color
changes, late/replaced native glyphs, living generations, partial writes and
construction, foreign previous roots, queued re-enable, rejected created-child
deletion, loading-root lookalikes, registry failure cleanup and disabled callbacks. The simulator
does not prove native binding creation, glyph composition, key press visuals or
editor placement; verify those after maintainer compilation/repacking.
