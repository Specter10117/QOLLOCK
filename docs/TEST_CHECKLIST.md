# QOLLOCK release-candidate checklist

Record the exact source commit and repacked build, scenario, expected result,
observed result, and remaining issue. A green offline suite is not a client pass.

## Offline and build preparation

- Run `npm test` and retain the result. Use the commands in [TESTING.md](TESTING.md)
  for targeted failures; no separate pipeline script is required.
- Export a known-good configuration and keep an untouched recovery copy.
- The maintainer alone compiles and repacks the release candidate. Agents must
  not run build scripts or resourcecompiler, modify game addons, or write VPKs.
- Test that exact repacked build; source edits alone do not reach the game.

## Highest priority: save and restore

- Change several distinctive nondefault values, including Buff Delay = 15 and
  Minimap Reminder interval = 60. Save, fully exit the game, restart, and verify
  both the displayed values and their runtime effects.
- Repeat after opening settings promptly during startup and editing before
  storage finishes loading. A late automatic reply must preserve newer edits.
- Exercise delayed/unavailable storage and retry. Confirm failure is visible,
  no false success is reported, and current values are not silently reset.
- Explicitly Load a known-good saved configuration after making another edit;
  the requested saved configuration should apply. Missing storage must preserve
  the current settings.
- Use one genuine legacy exported configuration through the supported import
  path. Confirm representative values, then save/restart again. If the old
  release stored settings in builds, record the actual recovery steps; do not
  assume automatic migration from that mechanism.
- Check malformed/truncated and wrong-shape imports while retaining the recovery
  copy. Rejection must preserve current settings. For malformed stored replies,
  use the focused offline regression unless a separate disposable client profile
  is available; do not corrupt the only saved configuration for testing.

## Audio boundaries

- With repeating bridge reminders enabled, Buff Delay = 15 should dispatch near
  04:45 and 09:45; zero should dispatch near 05:00 and 10:00. Allow the polling
  interval, and distinguish dispatch timing from spoken content in the recording.
- Verify Minimap Reminder interval = 60 does not play every 15 seconds.
- Disable DL4D reminders for this timing check: they have an independent fixed
  timetable. Re-enable afterward if part of the intended configuration.
- If the UI shows 15 but timing remains 30 seconds early, preserve the exported
  config and exact observed times. The zero-value fix does not explain that
  discrepancy by itself.

## HUD lifecycle and feature interactions

- Open Customize from a gameplay section header. Move that element, enter exact
  placement/opacity/scale or color where supported, and confirm other surfaces
  cannot be selected or moved. Cancel must restore the imported placement; Apply
  must preserve unrelated settings. Repeat with a disabled/absent surface and
  through the full Customize tab. Native children still follow their parent.
- Repeat fast and slow grabs of Stamina, Current Ammo and Max Ammo in both
  standard and Tokamak layouts. Include overlapping padded targets, all four
  selected corners, Reset/Undo with pending native layout, and multiple UI densities.
  Native HUD content and the visible corner markers must follow the held pointer;
  one gesture must create one Undo entry. A motionless grab near magnets must
  create no edit. Check both enabled and disabled magnets and editor window overlap.
- Select every healthbar variant in sandbox and hideout. Confirm actual content,
  live size/position, opacity and native numbers. Missing Minecraft health values
  may show temporary sample hearts only while selected; exit/lease expiry must
  restore hideout gates and remove sample content without changing native HP.
- Drag a resize corner, drop, reopen, then close via Escape during a gesture.
  Confirm no drag proxy, stale frame, input blocker or preview survives exit.
- In the full Customize tab, leave an incomplete Healthbar HEX or number and
  select another element, move/resize the accepted Healthbar draft and use Undo.
  Navigation must remain usable; Save must still reject unfinished input.
  Reset must clear unaccepted text, including when the draft already is default.
- Expand the native color palette and adjust saturation/hue, RGB/HEX and presets.
  Drag the saturation/value marker and hue selector across the full canvas and
  its edges; the field list must retain its scroll position. Open another color
  field, close the palette and change selection; no old palette may remain.
  Confirm value edits do not also scroll the inspector, and closing/opening the
  picker does not change a color. Numeric wheel edits must not also scroll;
  scrolling over HEX must not edit the encoded color. Check the Properties
  alignment/history/footer in English and Russian at a short viewport height.
- Change placement, immediately Reset or Undo, and immediately attempt another
  move/resize. Wait for native restoration and confirm the next gesture starts
  from the restored position without jumping. Repeat Current/Max Ammo font
  resizing while firing/reloading changes the number of displayed digits.
- Check ammo outside its original box and compact stats when both native stats
  owners coexist. Verify right docking, reset, and replacement after respawn.
- Import a genuine older settings code, edit only one element, save, fully
  restart and compare placement and unrelated settings with the recovery copy.

- Enter a normal match, die/respawn, return to menu, and enter another match.
  Confirm critical HUD panels remain usable and no repeated Panorama errors occur.
- Open/close shop and settings; disable/re-enable affected features.
- Check Basic and Advanced item cooldown modes: changing text, completion flash,
  filters, and no stale countdown after death/respawn or rapid retrigger.
- Check top bar/rejuv/buff/urn displays, crosshair and reload controls, and minimap
  base/Alt/Tab states under a representative nondefault preset.
- Check representative supported screen sizes and languages. Native panel
  replacement/visibility must be observed in the client, not inferred from XML.

## Settings unification acceptance

Run these cases on the exact repacked candidate after keeping the recovery
export. The earlier interaction/lifecycle checks still apply. Record each case
as passed, failed or not run, with the source commit, build identifier, screen
resolution and UI density. Current accepted ranges and defaults come from the
source catalog; the numbers below are temporary test inputs.

- **U1 — Full sharing and compatibility.** Export a configuration containing
  distinctive position, opacity and scale values. Use the full snapshot rather
  than a shortened sample. Copy the
  complete token, clear the import field, paste it and compare the proposed
  values before confirmation. Import, save and fully restart the client; the
  displayed values and actual HUD must agree. Repeat with a genuine old binary
  code and with the recovery export. Truncated input must preserve the current
  configuration and produce visible failure rather than partial application.
- **U2 — Travel versus stored position.** In Healthbar and another independent
  HUD surface, type offsets beyond the former per-feature caps, for example
  horizontal 3500 and vertical 2500. Save and reopen even if the surface leaves
  the screen. Change resolution/UI density and verify that merely reopening or
  selecting it does not rewrite either stored value. Return to screen must
  recover the actual owner. Undo/Redo must cover that recovery; Cancel must
  restore the original off-screen coordinates. Repeat at a large supported
  resolution and an ultrawide aspect ratio; record any native clipping.
- **U3 — Parent units.** Move, align, recover and resize Basic and Advanced item
  cooldowns at multiple UI densities. Include a percentage offset outside the
  former travel range. The actual HUD, frame and exact entries must agree with
  each other; a density change must not introduce a saved edit or multiply the
  movement again. Repeat independently for current/max ammo in standard and
  Tokamak layouts so sibling rings/digits do not inherit the wrong coordinates.
- **U4 — State suppression.** With normal/TAB hiding both off, record native
  appearance conditions. Then try normal only, TAB only and both on. Repeat
  on a native surface, a custom overlay, both cooldown modes, the map in its
  Base/Alt/TAB states and both purchase-notification layouts. Clearing the flags
  must restore native conditions, not force conditional content to appear.
  Feature enablement and custom opacity must remain independent. Repeat after
  respawn, panel replacement and disable/re-enable while TAB is held.
- **U5 — Dormant Player Stats placement.** Import a recovery-copy configuration
  with the legacy custom-position gate disabled and nonzero saved stats
  coordinates. Change only a hide flag through both an ordinary HUD/UI row and
  Customize. Stats must not move. The native source must remain usable by Active
  Stats when that mirror's own appearance conditions allow it. Check custom
  child opacity, Undo/Redo, Cancel, Save/export/import and full restart. An
  explicit position edit may activate placement; a hide-only edit must not.
- **U6 — Precision and native baselines.** Set opacity to 73% and a relative
  scale to 123%, then reopen and export/import. Both exact values must survive.
  Compare 100% with the original native size in each healthbar variant, shop,
  top/bottom bar and ammo layout. Check the common scale boundaries shown by the
  current contract, including keyboard glyph shrinkage. In the map, distinguish
  size/fixed-icon mode from whole-map scaling; in cooldowns, check odd reference
  sizes so fractional resulting scale does not become a whole-percent jump.
- **U7 — Exact input and unavailable measurements.** Try an incomplete sign,
  malformed number and an out-of-domain value using Enter, blur and Save. The
  last accepted draft must remain intact and invalid input must stay visible.
  Correct the text, then test wheel edits and row refresh. Open Customize with
  an absent/temporarily unmeasured surface: exact editing must remain available,
  while measurement-dependent sliders/recovery must not invent a viewport or
  change the draft. Reappearance must use fresh owner measurements.
- **U8 — Persistence and retained capabilities.** Save a combination of these
  edits, fully exit and restart, then die/respawn and enter another match. Verify
  state flags and coordinates as well as actual rendering. Retain separate
  map geometry, healthbar content/animations, independent ammo labels and
  world-target size/opacity controls. World-target visuals must have no fabricated
  screen-offset controls. Restore the recovery export at the end.

A source/model pass does not satisfy these cases. For a failure, retain the
exported configuration and expected/observed values; attach native panel-tree
or video evidence when the issue depends on layout, state or replacement.

## Performance and evidence

- Let a representative match run for several minutes; check for debug spam and
  persistent UI hitches. Use repeatable frame-time comparisons if claiming an
  improvement. Callback timings alone do not measure frame rendering.
- Record failed, skipped, and not-run cases separately. Publish only the claims
  supported by the offline assertions and these observed client scenarios.
