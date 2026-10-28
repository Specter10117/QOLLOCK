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

Base, community and personal preset confirmations expose Preview preset. In a
gameplay HUD this hides settings and shows the temporary configuration with a
compact Apply/Back panel. Back and Escape return to the diff; closing settings,
HUD replacement or a conflicting canonical edit withdraw the preview. Without a
gameplay HUD the diff remains usable and explains the match/sandbox requirement.
Other visual editors cannot run concurrently. Drag the panel's heading to move it
within the screen; its position lasts only for the current preview session.

`ui/preset_preview.js` owns the session and uses `core/ql_customize_preview.js`'s
leased transport with an explicit preset kind, validated against the current
settings catalog. Ordinary Customize drafts retain their presentation whitelist.
Preview does not publish canonical settings or write preset/startup storage.
Apply waits for HUD configuration delivery and uses the existing preset callback;
this acknowledgment establishes configuration delivery, not native rendering.
Conditional HUD content still requires its native context, and separate native
UI script contexts do not acquire this temporary configuration.

## Personal presets

The Presets tab has a separate personal section below the community grid.
It saves named snapshots in the existing CEF bridge under
`qollock_personal_presets`, independently of `qollock_settings`. The stored
collection is an array of `{ name, raw }` entries; `raw` uses the existing
versioned settings envelope. Names are trimmed, case-insensitively unique,
and limited to 48 characters without control characters.

New Preset creates an ordinary named entry from the canonical factory settings,
then opens it for editing after its storage write is acknowledged. It never
copies the current HUD configuration or overwrites a duplicate name. A late
creation cannot replace settings edited since the click. The row exposes Load
and an upward-opening overflow menu for startup selection, renaming and deletion.
The open menu is portalled into a SettingsWindow layer outside the scrolling
list, positioned with native visual coordinates and host UI density. It returns
to its row on dismissal and retires when its section or settings window closes.
There is no separate Update from current settings action: the footer Save saves
the edited profile, including after changing values away from its saved snapshot.

Load presents the existing settings diff before applying the validated snapshot,
including preserved UI preferences and live HUD publication. It does not replace
the main durable settings save. The base grid's Default button resets factory
settings. There is no synthetic startup row in the personal list.

On a fresh install, the first footer Save creates My config even if Presets has
never been opened. Later Saves update the loaded personal profile, falling back
to the main/original profile when no personal profile was explicitly loaded.
The bridge captures the target identity before its asynchronous disk write.
Missing entries referenced by old metadata are repaired instead of preventing
creation. Existing names are preserved; collisions receive a numeric suffix.
Opening Presets after upgrading also recovers an existing main save without
applying it or changing the main slot. An interrupted capture can reuse its
already-written entry instead of creating another copy.

The separate `qollock_personal_presets_state` metadata record contains
`startupName` and `originalName`; collection and settings envelope formats stay
unchanged. Tracked rename intent temporarily adds `renameFrom`/`renameTo` so
subsequent reads can recover the identity from the committed collection before
another mutation. Writes are serialized within the settings realm; there is no
cross-client concurrent editing protocol. Invalid initial reads disable writes
in the view. Reopen the tab after repairing the storage error.

Use at Startup writes the selected snapshot to `qollock_settings` without
changing live settings and records its name after acknowledgment. At startup
appears only on that named entry while its contents match the saved slot.
Identical snapshots do not receive duplicate badges. Rename follows the saved
identity. Deleting the selected main preset clears the startup slot and removes
tracking metadata so the next footer Save creates My config again. Current live
settings, UI preferences and other personal presets are preserved. Every entry
uses Delete without another confirmation; ordinary deletion removes only that
snapshot. Failed cleanup can be retried without changing live settings.

Active highlights compare current values against saved snapshots, ignoring local
UI preferences and retired default-hero metadata. Loading an identical named
snapshot gives that selection priority. Choosing it for startup does not change
the live active selection. Late view callbacks cannot render into a replaced
section or apply a closed confirmation. Storage transport and full-client restart
limitations are the same as for the main settings save.

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
