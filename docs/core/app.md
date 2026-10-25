# `panorama/scripts/core/ql_app.js`

## Purpose
Top-level application boot coordinator and native engine event bridge. Orchestrates the initial discovery of the Deadlock HUD, deserializes saved configuration from panel attributes, triggers `FeatureRegistry.boot()`, synchronizes settings between the HUD and Escape Menu isolates via the panel-attribute polling bridge, and hooks native C++ engine events.

## Dependencies
- All core subsystems (`ql_namespace.js`, `ql_logger.js`, `ql_event_bus.js`, `ql_scheduler.js`, `ql_panel_helpers.js`, `ql_config_store.js`, `ql_config_adapter.js`, `ql_feature_registry.js`)
- Loaded last in `hud.xml` `<scripts>` block.

## Interface (`QOL.core.App` / `QOL.core.app`)
- `boot()`: Main entry point. Resolves HUD panel, restores configuration from `Deadlock_Mod_Settings_v1` attribute, boots all enabled features, starts cross-isolate config synchronization, and registers native engine event listeners.
- `shutdown()`: Retires the current polling generation, saves modified settings only to its captured living HUD when no newer publication is pending, and shuts down all active features.
- `isBooted()`: Returns `true` if application initialization succeeded.
- `getHud()`: Returns the cached reference to the Deadlock HUD panel.
- `syncRootClasses(hud)`: Keeps layout state classes synchronized on the HUD root (e.g. `InHideout`, `Streetbrawl`).
- `syncDiagnosticState(hud)`: Synchronizes performance and error telemetry to panel attributes for debugging.
- `writeDiagSnapshot()`: Generates and persists a structured diagnostic state object.
- `buildDiagSnapshot()`: Returns the in-memory diagnostic snapshot dictionary.

## Native Engine Event Bridging
Deadlock C++ engine events are captured using `$.RegisterForUnhandledEvent` and forwarded to `EventBus`:
- `CitadelScoreboardToggle` → `engine:scoreboard_toggle` (refresh notification; no visibility payload)
- `CitadelOpenUpgradeShop` → `engine:shop_opened` (reactive shop opening)
- `CitadelExitUpgradeShop` / `CitadelUserMsg_ForceShopClosed` → `engine:shop_closed` (reactive shop closing)
- `CitadelToggleEscapeMenu` → `engine:escape_menu_toggled` (reactive escape menu state)
- `CitadelGameStateChanged` → `engine:game_state_changed` (reactive match phase transitions)

## Cross-Isolate Config Polling Bridge & Match Lifecycle
Panorama executes settings UI (`EscapeMenu`) and game HUD in separate JavaScript execution contexts. `ql_app.js` normally polls the serialized HUD attribute every 250ms, allowing settings changed in the pause menu to propagate on a subsequent heartbeat. While a Customize preview interaction is active, the next poll uses 50ms; stress benchmarking retains the normal interval. These are scheduling delays, not a native delivery-time guarantee.

When a player leaves a match, the HUD panel is destroyed by the engine while the V8 runtime may persist. If the HUD panel becomes invalid during polling or `CitadelGameStateChanged`, `ql_app.js` triggers `shutdown()` to halt timers, cancel scheduler loops, and release feature listeners. Furthermore, `boot()` detects stale instances with invalid HUD handles and performs a clean reboot, preventing compounding polling overhead across successive matches. Poll callbacks carry a session generation, so rejected cancellation or a zero native timer handle cannot revive a retired loop. Teardown never discovers a replacement HUD for saving and preserves publications not yet consumed by its last poll.

Runtime enable-state reconciliation uses the registry's automatic mode. It preserves explicit, failed-enable and error-triggered retirement across unrelated settings changes; an explicit retry, deliberate setting off/on transition, or new session may restore the owner. This transient policy does not change stored defaults or configuration.

## In-Game Benchmark & Stress Test Harness
`ql_app.js` coordinates live in-game performance benchmarks requested via `QOL_DiagRequest` tokens (prefixed `bm_`):
- **Normal Benchmark (`bm_<dur>_normal_<token>`)**: Measures the CPU overhead and polling execution metrics of the user's active configuration over `<dur>` seconds without altering any settings.
- **Stress Benchmark (`bm_<dur>_stress_<token>`)**:
  - Captures the player's active configuration and revision in a transient stress lease before applying the expanded configuration.
  - Builds an expanded configuration via `_buildMaximalConfig()`, setting declared enable keys and eligible non-`DISABLE_` toggles/multitoggle options. Numeric modes, compatibility restrictions, runtime suppression and native source availability still limit which features actually run or appear; this is not an all-features-visible guarantee.
  - While the lease is active, config polling preserves the expanded root classes (e.g. Centered ESC Menu, Minimap transforms) and feature configuration.
  - Buffers any incoming user configuration edits during the benchmark so they are cleanly applied after completion without interfering with the test.
  - Arms a safety timeout fallback timer (`durSec + 3s`) to attempt configuration restoration if normal completion is missed. The callback still depends on the native runtime delivering it.
  - Upon benchmark completion, error, timeout, or application shutdown, triggers `_restoreStressBenchmark()` to cleanly restore original user settings, reload `ConfigAdapter`, re-sync manifests, and re-apply normal HUD CSS classes.

Diagnostic requests own their Scheduler benchmark handles and report callbacks;
shutdown retires that request before restoring settings. The stress lease owns
its safety fallback separately, so an older fallback cannot restore a replacement
stress run. Replacing stress with another stress request retains the latest
buffered user configuration. A normal request made while stress is active keeps
the existing lease until its fallback restores that configuration; the settings
UI normally serializes benchmark requests.

## HUD state observation bridge

`QOL_DiagRequest` tokens beginning `state_` start the opt-in 60-second recorder
in `ManifestTests.observeHudStates`. Snapshots include `hudStateObservation`;
completion publishes the report through `QOL_Diag`. No configuration is changed.
See [HUD state recording](../ui/hud_state_recording.md). Native bridge registration
alone does not validate every event: the optional force-shop-close compatibility
listener remains subject to the API checker's known warnings.
