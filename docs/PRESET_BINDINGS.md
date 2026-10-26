# Presets and account bindings

## Source ownership

- `panorama/scripts/ql_shared_presets.js`: `QOL_PRESETS`, flat defaults,
  `QOL_ACCOUNT_PRESET_BINDINGS` and the current settings catalog.
- `panorama/scripts/ql_legacy_compact.js`: frozen binary import schemas.
- `panorama/scripts/ql_settings_code.js`: current lossless sharing codec and its
  append-only key/reference dictionary.
- `panorama/scripts/ui/presets.js`: visible preset entries, name resolution,
  application, comparison and active-button tracking.
- `panorama/scripts/ql_config.js` and the settings normalization chain:
  migrations/dependency normalization used when values change.

`QOL_ACCOUNT_PRESET_BINDINGS` is currently empty. Historical Ranger/Gyzeh
binding investigations do not establish a current account-to-preset mapping.
Do not invent automatic account selection from a preset's name or author.

## Current application behavior

`applyPresetConfig` resets flat default keys, overlays the preset's own keys,
then runs normalizers. It preserves `DRAG_ENABLED`, `PREVIEWS_ENABLED` and an
existing `ENABLE_UPDATE_CHECKER` preference. The confirmation candidate uses those same preservation rules, while pure preset resolution used for matching remains independent of live preferences. This is not a generic rule that
all UI preferences survive preset changes: `LANGUAGE` can change.

Preset values are overlaid as supplied; this function is not an unknown-key
validation boundary. User-provided serialized configurations must use the
canonical parsing/import path rather than being treated as trusted preset data.

`applyPresetByName` resolves the existing Bread/BreadRollius naming compatibility,
updates the runtime preset name, calls `SaveAndSync` and refreshes language UI.
`ACTIVE_PRESET_NAME` has special Bread matching behavior; it is not a general
persistent record of whichever preset button was last clicked.

Community entries are ordered by displayed name, case-insensitively. Base
presets retain their separate first row. An entry without a supplied configuration
is a non-applying tile with an explanatory tooltip, not a substitute configuration.

## Personal presets

The Presets tab has a separate personal section below the community grid.
It saves named snapshots in the existing CEF bridge under
`qollock_personal_presets`, independently of `qollock_settings`. The stored
collection is an array of `{ name, raw }` entries; `raw` uses the existing
versioned settings envelope. Names are trimmed, case-insensitively unique,
and limited to 48 characters without control characters.

Saving captures settings at the click. Replacing or deleting a snapshot requires
inline confirmation. The UI reports success only after the bridge acknowledges
the write. A failed initial read disables writes so it cannot silently overwrite
an unread collection; reopen the tab to retry. Invalid data is rejected through
the side-effect-free settings parser. Writes are serialized within the settings
realm; this collection has no cross-client concurrent editing protocol.

Loading presents the existing settings diff before applying the validated
snapshot through the preset application path, including preserved UI preferences
and live HUD publication. It does not overwrite the main durable settings save;
the footer Save action still owns that operation. Stale section callbacks cannot
render into a replaced section or apply a closed confirmation. Storage transport
and full-client restart limitations are the same as for the main settings save.

## Maintenance

1. Change values in `QOL_PRESETS`, not a second Markdown table of preset data.
2. If changing visible membership/name, update the entries in `ui/presets.js`.
   Display names and stored names are not always identical.
3. If a new key is needed, follow [ADDING_SETTINGS.md](ADDING_SETTINGS.md):
   maintainer-approved defaults, actual UI renderer, localization, consumers,
   normalization and compatible codec representation.
4. Check application over an already-customized config, preserved preferences,
   dependent settings, active-button matching and export/import round-trips.
5. Add an account binding only with explicit requirements and a real runtime
   consumer. Check that a late autoload cannot overwrite newer manual edits.

The preset roster changes in source; this document intentionally does not keep
a stale second roster or historical account IDs. For durable restore behavior,
see [storage bridge](core/storage_bridge.md); preset selection alone does not
prove disk-save success.
