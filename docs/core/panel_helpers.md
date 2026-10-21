# Panel helpers

Source: `panorama/scripts/core/ql_panel_helpers.js`.
Start with the [helper decision map](../HELPERS.md) when choosing an API.
Load `ql_utils.js` and the QOL namespace before this module. The same panel API
object is exposed as `QOL.core.panel`, `QOL.core.PanelHelpers`, and
`QOL.ui.PanelHelpers`.

## Public interface

| Export on `QOL.core.panel` | Contract |
| --- | --- |
| `isAlive(panel)`, `isPanelAlive(panel)` | Aliases of `QOL_UTILS.IsPanelValid`: false for absent, invalid, or throwing handles. |
| `create(type, parent, id, properties)`, `createPanel(...)` | Guard parent validity and catch creation errors; return panel or null. |
| `delete(panel)`, `deletePanel(panel)` | Schedule `DeleteAsync(0)` on a valid panel; catch deletion errors. |
| `createOwnedTree()` | Own exclusively QOL-created IDs or fresh anonymous handles through instance-local reconciliation and complete tree retirement. See below. |
| `createNativeStyleOwner({resetValues, releasePosition, preserveClasses, preserveStyles}?)` | Own attempted native code properties/classes with readback invalidation and retried retirement. Does not create/delete panels or discover sources. See below. |
| `findHud(preferredRoot)` | Search context/ancestors for Hud; no-argument calls cache real HUD matches per context, never loading-root fallbacks. Can return the context/top root as a fallback, so this alone does not prove active gameplay. |
| `findRoot(panel?)` | Walk ancestors of the supplied panel, defaulting to the current context; return null on native traversal failure. |
| `findChild(parent, id)` | Safe native `FindChild` wrapper for direct children. |
| `findTraverse(root, id)` | Safe native `FindChildTraverse` wrapper. |
| `setClass(panel, className, active)` | Compare current class membership before changing it; return whether changed. |
| `setVisible(panel, visible)` | Set the panel's `visible` property; this does not compare before assignment. |
| `syncStyles(panel, styleMap, lastSig)` | Compare serialized style map with caller-owned signature; if changed, write the whole map. Return `{changed, sig}`. |
| `clearStyleProperty(panel, property)` | Try native `ClearPropertyFromCode`; return success. |
| `activate(panel)` | Dispatch native Activated event, returning success/failure. |
| `isVisible(panel)` | Check validity, local visible flag, and a few local hidden classes; does not compute CSS or ancestor visibility. |
| `readText(panel)` | Read string text, then text attribute fallback; return empty string on failure. |
| `readTextDeep(panel, maxDepth = 4)` | First nonempty text from a bounded descendant search; not necessarily the desired numeric/gameplay label. |
| `readId(panel)` | Safely read an ID string. |
| `hasClassToken(panel, token)` | Safe local class membership test. |
| `setWashColor(panel, color)`, `setWashColorFromPalette(panel, value)` | Apply wash color directly or through the palette. |
| `normalizePaletteIndex(value)`, `resolvePaletteColor(value)` | Normalize an index or resolve its palette color. |
| `washColorPalette` | Exported palette array (not a function). |

## Styles and ownership

`createNativeStyleOwner()` returns `apply(panel, styles, classes?)`,
`retain(panels)` and `clear()`. These return whether the requested writes or
retirement completed. Supply desired maps to `apply`; properties/classes removed
from those maps are released. `retain` releases tracked handles absent from the
supplied iterable; `clear` releases all. Only attempted fields are owned, including
partially rejected writes. Unrelated native properties/classes remain untouched.
By default classes must be reserved for the caller's presentation; retiring a
class removes it. `preserveClasses: true` instead captures original native
membership: desired membership is the baseline or the caller's flag, and
retirement restores the baseline. That baseline transfers across instance
handoffs, so a previous instance's injected class cannot become a native default.

`preserveStyles: [property, ...]` is for native-relative code presentation, such
as stamina rotation. `baseline(panel, property)` reads the original code value
for those properties; `apply` captures it before the first attempted write.
Reading alone creates no retained baseline metadata. A nonempty baseline is
restored as code on retirement rather than cleared; an empty baseline uses strict
native clearing. Transform `none` is treated as empty. The original baseline
transfers through shared property leases, so a new instance cannot compose with
the previous instance's rotation. This option differs from `resetValues`, which
writes a neutral value and then releases the code override to native CSS.

Successful style maps cache actual native readback as well as their desired
signature, avoiding redundant writes after string normalization and reapplying
after native feedback overwrites. Optional caller-supplied `resetValues` writes
neutral values before strict native property clearing. Rejected retirement remains
recorded, with one cleanup-only scheduled retry until successful or destroyed.
Native offset owners release Panorama's composite `position` when both axes
retire by default (`releasePosition: false` explicitly opts out). A desired
coordinate or a foreign component lease prevents aggregate clearing. Compound
position writes also lease their component axes; retirement neutralizes and
clears their owned components without clearing a newer owner's axis. Leases use
canonical CSS property names, so camelCase and hyphenated spellings share the
same ownership boundary. Rejected writes/clears remain retryable. Native
positioned owners must establish their own reset values.
This retry may finish after feature disable; it never derives settings or reapplies
presentation. Private property/class leases prevent an old retiring instance from
clearing fields claimed by a new instance. Reapplication in the same instance also
cancels a field's retirement intent. Discovery, current-HUD selection, settings,
active guards and presentation polling remain the caller's responsibilities.
Inventory, souls, stats placement, healthbar, chat, top/bottom bar geometry,
target shapes, damage text, passive cooldowns and recent-purchase native surfaces
use this contract. Ammo ring rotation uses extracted CSS reset baselines;
generated pip styles use ordinary readback ownership and their panels use
created-tree retirement. Stamina opts into native code transform restoration. Source
discovery, dynamic indicator roles and created content remain with each feature.
Damage-number typography and opacity release their code overrides independently
at their respective defaults; another active setting does not claim those
default fields. Small-number filtering still temporarily owns its opacity, then
releases it when a recycled native label changes role.

`createOwnedTree()` returns `child(parent, type, id, properties?)`, `sweep()`,
`children(parent, type, entries)`, `create(type, parent, id?, properties?)`,
`remove(idOrHandle)`, `clear()` and `dispose()`. Each nonempty ID used for child
reconciliation must be unique within that instance
and reserved for QOL-created content; never use this helper to adopt native
panels. Child reconciliation retains expected ancestry, so moved children are
still retired with their former owner. `remove(id)` retires one recorded branch,
including its moved descendants, while retaining unrelated branches; unknown
IDs/handles are ignored. `create()` always creates a fresh panel and owns its
returned handle directly, including anonymous panels; it never searches for or
adopts native content. Unlike child reconciliation, fresh creation preserves the
caller's creation properties and native hit-test defaults, allowing interactive
controls. `remove(handle)` retires that fresh branch, including descendants moved
elsewhere. Expected parents, rather than IDs, govern fresh-handle `sweep()` checks.
`sweep()` releases moved/replaced nodes
and retries pending asynchronous deletion. It returns whether no recorded node
was retired during that pass, allowing a caller to invalidate a complete layout
without running another ancestry scan. Retried deletion of previously retired
nodes does not invalidate surviving nodes. `clear()` retires all nodes while
retaining deletion retries. `dispose()` retains failed or pending deletion records
and schedules cleanup-only retries until the retired handles are destroyed.
Those callbacks never inspect active nodes, derive settings or recreate content;
reuse of the same owner remains supported. A new instance cannot adopt an ID
still occupied by a retired tree.
Partial construction can be retried through the same child calls. A new
instance retires an existing foreign tree instead of adopting UI that the
previous instance may already have queued for deletion. Default creation
properties disable hit testing on each reconciled child.
Owned false hit-test flags are also reconciled through native properties; a
partial flag write keeps the node recorded for retry and cleanup.

`children()` reconciles a sibling batch of `{id, properties?}` entries and returns
their panels in entry order, retaining the same ownership/partial-failure rules
as `child()`. It snapshots immediate children once per call; `sweep()` also
groups recorded nodes by parent. Both preserve the first duplicate-ID match
and detect moved/replaced nodes without a separate sibling search per marker.
Snapshots are local to that synchronous pass and are never retained across polls.

Native parent discovery, active-instance guards, content/history, style
signatures and schedules remain the manifest's responsibilities. This helper
does not establish gameplay availability or run a controller loop.

`syncStyles` compares signatures, not each property against its current value.
Retain its returned signature only for the same panel instance; reset it when the
panel changes or when another owner may have changed those styles. Passing no
previous signature rewrites the full map each call.

For a single property with stable read-back, use
`QOL_UTILS.SetStyleIfChanged(panel, property, value)`. For normalized opacity use
`QOL_UTILS.SetPanelOpacitySafe(panel, value, fallback)`. The unconditional
`QOL_UTILS.SetStyleSafe(panel, property, value)` serves cases requiring reassertion.
Native normalization can make read-back comparison unsuitable; preserve a
feature's intentional reassertion behavior.
`SetPanelOpacitySafe` returns the applied opacity text, or empty text on rejected
access/write. A failed write never attempts a second value that could reveal a
hidden panel. Its numeric fallback is for invalid input, not native failures.

`safeCreatePanel` and `safeDeletePanel` are private implementation names, not
exports. `setStyleIfChanged` and `setPanelOpacitySafe` are not methods of
`QOL.core.panel`; use the leaf helpers named above.

The leaf `QOL_UTILS.ClearStyleSafe` used by HUD manifests also tries native
`ClearPropertyFromCode` first, then legacy assignments only if native clearing
is unavailable, returns `false`, or throws. The leaf returns no completion status;
native ownership uses the strict core boolean helper above to retain rejected
retirement rather than assuming a fallback removed the override.

A partial native style-write failure returns `sig: null` from `syncStyles`, so a later call retries the map. `readTextDeep` returns empty text when native child enumeration fails. Panel validity (`isAlive`) is unrelated to player life state.

Both clear helpers translate JavaScript-style property names (for example
`uiScale`, `preTransformScale2d`, `washColor`) to native CSS names (`ui-scale`,
`pre-transform-scale2d`, `wash-color`) before `ClearPropertyFromCode`. Already
hyphenated names are accepted unchanged. This is shared by HUD features, so a
scale reset must release the override for every caller, not only healthbars.
