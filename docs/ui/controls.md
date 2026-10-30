# Settings controls and numeric properties

`panorama/scripts/ui/controls.js` builds procedural settings rows. Known settings
use the shared `QOL.settings` type, role, units, conversions and precision.
Slider travel and accepted exact values are separate: moving a thumb stays
inside its travel, while valid exact positions can remain outside it. Native
thumb readback and row refresh must not overwrite the accepted exact value.

Enter and blur validate the same complete numeric input; malformed or out-of-
range values stay marked and preserve the previous accepted value. Numeric
wheel changes use the declared setting step. Displayed overall scale is a
percentage of its native baseline. Existing dirty/save paths are reused.

`createSliderRow` accepts an optional seventh argument, `inlineCheckbox`, with
`key`, `label` and `description`. It reuses the title-checkbox control after the
slider value input. Both keys participate in row reset/changed-state tracking;
checkbox visuals resync on reset and external config updates. Search collection
also registers the checkbox setting. Fixed Icon Size is now a regular minimap
toggle, alongside the scoped Customize action.

`createSectionTitle` accepts an optional fourth argument, a Customize element ID.
Animated toggle sections accept `sectionOptions.customizeElement` alongside their
existing title-checkbox options. Both add an action to the section header, which
remains usable when its section body is collapsed. Search collection creates no
editor panels; it registers a scoped action with aliases for the element's field
labels and keys. Results launch the same scoped editor. Section reset includes
those fields even though their former sliders are absent. Gameplay tab renderers declare the bindings; the controls factory
does not infer native panel owners or settings scope. See [Customize](customize.md).

Animated toggle sections can also declare `sectionOptions.resetKeys`. These
keys participate in the existing section reset/changed-state tracking alongside
rendered rows and Customize actions. Abilities uses this metadata for AP and
Active Items, keeping its reset scope without empty child subsections.

## Automated checks and their limits

`tests/ui_slider_roundtrip.test.js` loads the production HUD and settings XML
script lists into separate simulator isolates sharing panel attributes. It
drives real slider and text-entry handlers, waits for save/config propagation,
and checks the UI value, ConfigStore, runtime snapshot, export preview, and
confirmed import. Dragged/typed floating-point and integer values, bounds, and
invalid text are covered.

`tests/matrix_invariant.test.js` renders twelve actual settings tabs, checks
their reset-key bindings against defaults, and requires three specific local
configuration interactions to run. It checks captured callback/event failures
as well as thrown exceptions. It does not randomly activate commands, clear
buttons, links, presets, or games, and is not an exhaustive interaction test.

The simulator implements only dropdown option registration and selection by
ID, including invalid/deleted selection handling. It does not model dropdown
popup layout, native input routing, or automatic submit events. That narrow
contract is tested in `tests/simulator_dropdown.test.js`. These tests cannot
verify in-game geometry, focus, C++-created panel hierarchies, or compiled VPK
behavior; the maintainer still needs to check the repacked mod in Deadlock.
