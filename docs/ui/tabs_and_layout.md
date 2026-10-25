# Settings tabs and content ownership

`panorama/scripts/ui/layout.js` owns sidebar order, group headings, display names
and icons. It also contains section/feature descriptions for a fallback renderer.
Most shipped tabs build their actual content through registered renderers.
Changing a fallback feature list alone does not move or add a visible control.

## Navigation

`QOL.ui.tabs` in `ui/ql_settings_tabs.js` derives these from `QOL.ui.layout`:

- `GetSettingsTabOrder()` returns tab IDs in layout order.
- `GetSettingsTabGroups()` groups them by heading entries.
- `GetSettingsTabDisplayName(tabId)` resolves the display name.
- `GetSettingsTabIconSource(tabId)` resolves the icon path.

The module also exposes these functions as compatibility globals. Its hardcoded
fallback is for an absent/empty layout and does not include every current tab
(for example, Customize). Use the loaded layout as the navigation authority.

## Adding, moving or reordering content

1. Reorder tabs or move them between sidebar groups in `ui/layout.js`.
2. Find the tab's `QOL.ui.window.registerTabRenderer(tabId, renderFn)` call in the
   settings XML's loaded modules. Move/add the actual rows there and preserve
   localization, search collection, reset scope, changed-state tracking and previews.
3. For a new tab, add its navigation entry and register a renderer loaded by
   `hud_escape_menu.xml`. Follow [ADDING_SETTINGS.md](../ADDING_SETTINGS.md) when
   it introduces a setting; a navigation entry does not create persistence or a
   gameplay consumer.

## Rendering

`ui/window.js` checks registered renderers first. Current content owners include:

| Module under `panorama/scripts/ui/` | Content |
| --- | --- |
| `gameplay_tabs.js` | Gameplay tab rows; also retains a UI renderer that is not a current sidebar entry |
| `config_tab.js` | Config / Settings |
| `customize/tab.js` | Customize; see [its contract](customize.md) |
| `presets.js`, `support.js`, `audio.js`, `console_tab.js`, `arcade_tab.js` | Their respective tabs |

If no registered renderer exists, `renderLayoutTab` can build declared sections.
Its feature rows require `FeatureRegistry.getManifest()`; the normal settings
context loads neither FeatureRegistry nor gameplay manifests. The fallback can
therefore render section shells without feature controls in that context.
It suppresses the section's enable setting from the body to avoid duplicate rows.
Do not load all HUD manifests into settings to make this fallback work.

## 5. Window Action Controls

- **Visual check cleanup:** Close/resume calls the walkthrough's onMenuClosed
  hook. Ordinary closing restores settings; the explicit Test in game action
  keeps the current step until settings reopen. Both window-open paths call
  onMenuOpened to restore the card before the user edits temporary settings.
  See the [manual visual check](visual_check.md) for ownership and cleanup.

- **Window Close Semantics (`forceCloseModSettings`)**:
  Closing the settings window (via the header close button 'X' or ESC handling) toggles the visibility of the `SettingsWindow` panel without dispatching `CitadelResumePlaying`. This ensures that closing the QOLLOCK settings window preserves Deadlock's native Escape Menu rather than dismissing the pause state.
  The escape-menu root and MenuBack binding dispatch the existing `CitadelResumePlaying` event after the customization cancellation guard. Compound XML handlers execute JavaScript, where the native layout action is not a global function. The focused QOLLOCK settings window handles its own cancel by hiding the window. If a hidden settings window receives `MenuBack`, its handler dispatches the existing resume event. Background activation checks the live window state before closing settings or resuming.


## 6. Dirty edits and asynchronous restore

`MarkConfigDirty()` in `panorama/scripts/ql_settings.js` records a persistence edit generation immediately, before its 0.3-second debounced `SaveAndSync()`. A pending CEF restore can therefore detect a slider change even while the updated configuration has not been published to panel attributes. Immediate `SaveAndSync()` writes continue to advance the normal configuration revision.

`hud_escape_menu.xml` loads `core/ql_persistence.js` before `core/ql_storage_bridge.js`. The settings realm shares the root/HUD revision protocol without loading the HUD feature registry. See `docs/core/persistence.md` and `docs/core/storage_bridge.md` for the restore guards and disk-save acknowledgment contract.

## 7. Native friends search

`ui/friends.js` owns the search controls added by `friends_list.xml`, in the
escape-menu JavaScript context. It resolves the input, clear button and categories
from one native `CitadelFriendsList` branch. Repeated initialization shares one
managed retry loop; late/replaced controls and newly bound names are reconciled
until that escape context is destroyed or detached. Reload/disposal retires the
previous controller and makes its callbacks inert.

Filtering owns only `QOLFriendSearchHidden` classes; it preserves native entry
visibility and keeps unknown names readable. The clear action uses the existing
`showSearchClearButton` stylesheet gate. Retired living entries release their
filter classes, with failed release retried during the active lifetime. The
native list/categories/name bindings and controls remain engine-owned. Search,
clear-button appearance and native list replacement require client verification.

## 8. Settings callback ownership

The window manager resolves the current SettingsWindow identity before reusing its shell. Living replacement retires the previous shell's tab transition and content/signature caches. Tab transitions are generation guarded: a newer request, including a return to the current tab, supersedes an older fade callback even when native cancellation fails. Drag handlers are bound once per handle and follow the current header/window owner; retired handlers cannot start a drag on a replacement.

Save feedback and its delayed reset belong to the latest accepted save action and its original settings context/root. An older acknowledgment cannot report success for a newer pending save or publish onto a replacement context. Indefinite feedback invalidates the preceding message's clear callback.

The developer Feature Test snapshots the complete settings configuration. Stop and normal per-feature restoration restore that snapshot through SaveAndSync, including derived flags changed by normalization. Retired test callbacks cannot reapply temporary toggles after Stop. These are live publication checks, not durable CEF-save guarantees.

Run node --test tests/ui_async_owners.test.js for these modeled transitions. Native tab animation, header drag routing and client context replacement still require maintainer verification.
