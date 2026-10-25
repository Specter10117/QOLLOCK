# Settings Realtime Previews Architecture

The QOLLOCK settings window provides realtime floating previews for HUD elements when their position or appearance is adjusted in the UI. Ordinary toggle changes update their live owners and retire existing floating samples; they do not open placeholder previews. Customize owns its separate live editing preview.

---

## 1. Overview & Architecture

Settings previews are implemented in `panorama/scripts/ql_settings_previews.js` and exposed via `QOL.preview` (and `Q.preview`).

All preview families share an instance-owned created tree and one constructor
path. Child handles reconcile on each request, including partial creation,
live replacement and reparenting. Crosshair sample rows and keyboard sample keys
belong to the complete tree. Unfinished trees remain hidden until a later request
succeeds. Gameplay geometry, config detection, feature gates and live-anchor
calculations remain family-specific.

Each family owns at most one hide deadline. A newer request cancels the prior
handle (including zero); callback identity guards contain failed cancellation.
Deadlines retain their original context and panel generation and cannot hide
another context's new preview. Expiry retires the family's complete tree.
`hideAll()` cancels all deadlines and retires every created child, including moved
children. A living context replacement also retires the old tree. `dispose()`
performs final cleanup. Rapid recreation waits for queued old trees to retire,
preserving the shared helper's ownership rule. Rendering/coordinates still need
maintainer client verification.

```
┌─────────────────────────────────────────────────────────┐
│                    Settings UI Action                   │
│              Position or appearance edit              │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
               `QOL.preview.showForConfigId(id)`
                             │
            ┌────────────────┴────────────────┐
            │ Checks:                         │
            │ - MOD_CONFIG.PREVIEWS_ENABLED   │
            │ - IsSettingsWindowVisible()     │
            │ - Feature enabled toggle status │
            └────────────────┬────────────────┘
                             │
                             ▼
              `ShowConfigPreviewForConfigId(id)`
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
ShowZipBoostPreview()  ShowCompassPreview()   ShowSpeedPreview()
     │                       │                       │
     ▼                       ▼                       ▼
  Displays floating pill/box on screen for 1.5 seconds
```

---

## 2. Public API (`QOL.preview`)

- **`showForConfigId(configId)`**: Dispatches preview creation or update for the given configuration key. Toggle keys retire existing floating previews without creating a sample, including when switching a feature off.
- **`hideAll()`**: Cancels pending hides and retires all owned preview trees.
- **`dispose()`**: Final cleanup of preview trees and deadline ownership.
- **`wirePreviewToggleButton(buttonPanel)`**: Attaches event listeners and active state styling to the preview master switch (`MOD_CONFIG.PREVIEWS_ENABLED`).
- **Config Identification Helpers**:
  - `isMinimapPreviewConfig(configId)`
  - `isZoomMinimapPreviewConfig(configId)`
  - `isCompassPreviewConfig(configId)`
  - `isSpeedPreviewConfig(configId)`
  - `isCrosshairStatsPreviewConfig(configId)`
  - `isKeyboardOverlayPreviewConfig(configId)`
  - `isItemCooldownPreviewConfig(configId)`
  - `isAmmoPreviewConfig(configId)`
  - `isReloadCooldownPreviewConfig(configId)`
  - `isUnitTargetPreviewConfig(configId)`
  - `isDamageReportPreviewConfig(configId)`
  - `isShopPreviewConfig(configId)`
  - `isUnsecuredPlusPreviewConfig(configId)`

---

## 3. Supported Previews

| Preview Type | Supported Config Keys | Description |
| :--- | :--- | :--- |
| **Zipline Boost** | `ZIP_BOOST_X_OFFSET`, `ZIP_BOOST_Y_OFFSET`, `ZIP_BOOST_SCALE` | Floating green glowing pill showing configured position and scale. |
| **Speedometer** | `COMPASS_SPEED_X_OFFSET`, `COMPASS_SPEED_Y_OFFSET` | Styled square 50x50 gold glow pill displaying `"SPD"` matching in-game speedometer coordinates. |
| **Compass** | `COMPASS_X_OFFSET`, `COMPASS_Y_OFFSET`, `COMPASS_SCALE`, `COMPASS_STRETCH_X`, `COMPASS_STRETCH_Y` | Bounding box showing compass placement and aspect ratio. |
| **Crosshair Stats** | `CROSSHAIR_STATS_X_OFFSET`, `CROSSHAIR_STATS_Y_OFFSET`, `CROSSHAIR_STATS_SCALE`, `CROSSHAIR_STATS_OPACITY` | Active stats indicator near crosshair. |
| **Unsecured Souls** | `UNSECURED_SOUL_TIMER_X_OFFSET`, `UNSECURED_SOUL_TIMER_Y_OFFSET`, `UNSECURED_SOUL_TIMER_SCALE` | Unsecured soul countdown preview. |
| **Keyboard Overlay**| `KEYBOARD_OVERLAY_X_OFFSET`, `KEYBOARD_OVERLAY_Y_OFFSET`, `KEYBOARD_OVERLAY_SCALE` | Overlay footprint showing scaled dimensions. |
| **Item Cooldown** | `PASSIVE_COOLDOWN_SIZE`, `PASSIVE_COOLDOWN_X`, `PASSIVE_COOLDOWN_Y` | Cooldown icon frame next to crosshair. |
| **Minimap Size & Offset** | `MINIMAP_SMALL_SIZE`, `MINIMAP_X_OFFSET`, `MINIMAP_Y_OFFSET`, `MINIMAP_BASE_OPACITY` | Bounding circular reticle indicating exact minimap placement, diameter, and opacity. |

---

## 4. UI Controls Integration

When a user interacts with a control in `panorama/scripts/ui/controls.js`:
1. **Procedural sliders (`QOL.ui.controls.createSliderRow`)**: Call `getPreview().showForConfigId(configId)` after an accepted value change. Schema-driven controls in `ui/renderer.js` have their own dispatch path; do not invent factories from old examples.
2. **Animated Section Toggles (`createAnimatedInlineToggleSection`)**: Calls `getPreview().showForConfigId(enableConfigId)` immediately upon switch activation or deactivation to retire floating samples.
3. **Title Checkboxes (`createSectionTitleCheckboxToggle`)**: Calls `getPreview().showForConfigId(configId)` upon check state toggle; the same retirement rule applies.

---

## 5. Hideout vs In-Match Behavior Gotcha

- **In-Game Feature Manifests**: Certain HUD manifests (e.g. `ql_zipboost` and `ql_compass`) intentionally include `_isInHideout(root)` guards in their active polling loops to disable unnecessary HUD clutter while in the sandbox/hideout.
- **Settings Previews**: Settings previews are separate UI panels created directly under the escape menu context root (`CitadelHudEscapeMenu`). They function regardless of match or hideout status whenever `MOD_CONFIG.PREVIEWS_ENABLED === 1` and the settings window is open.

---

## 6. Resolution & Coordinate Space Scaling (DPI / Aspect Ratio Fix)

- Inline CSS coordinates and measured layout coordinates can differ with UI scale.
  `GetPreviewHostScale(host)` uses `actualuiscale_x` / `actualuiscale_y`, then the
  actual/desired size ratio, falling back to 1 when neither is available. Do not
  assume every context has a fixed 1920x1080 canvas or infer scale from resolution
  alone.
- The minimap preview attempts to read the live `minimap_persp` bounds relative
  to the settings host and converts the right/bottom distances into host units.
  If measurements are missing, it uses configured offsets and the available
  parent inset. This is a placement approximation, not proof of pixel alignment
  at every aspect ratio or UI density. Verify those cases in the repacked client.
- Floating samples illustrate selected settings; they are separate from native
  rendering. The Ammo floating preview is currently disabled by
  `ENABLE_AMMO_PREVIEW` in the source. Customize's live HUD preview has a separate
  owner and delivery path; see [Customize](customize.md).
