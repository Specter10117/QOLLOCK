// OWNS: Nondefault x/y offsets and conditional opacity of the visible native stats owner.
// DOES NOT OWN: Native stats layout, content or child transforms.
// Source: hud.xml, Hud > .HudCore > hudActivePlayerStats;
// legacy owner: .HudCore > StatsAndModsContainer > LowerLeft > hudPlayerStats.
(() => {
    "use strict";
    const Q = QOL;
    const P = Q.core.panel;
    Q.core.FeatureRegistry.register({
        id: "ql_stats_position", enabledByDefault: true,
        isEnabled: cfg => Number(cfg.ENABLE_STATS_POSITION) === 1 || Q.presentation.hasStateHiding("playerStats", cfg),
        settings: [
            // Compatibility gate for dormant old placement; explicit position
            // edits activate it through their owning settings controls.
            { key: "ENABLE_STATS_POSITION", type: "toggle" },
            // Compatibility-only field: retain old configs without changing native docking.
            { key: "STATS_POSITION_SIDE", type: "buttongroup" },
            { key: "STATS_POSITION_X_OFFSET", type: "slider" },
            { key: "STATS_POSITION_Y_OFFSET", type: "slider" },
            { key: "STATS_POSITION_HIDE_NORMAL", type: "toggle" },
            { key: "STATS_POSITION_HIDE_SCOREBOARD", type: "toggle" }
        ],
        create(ctx) {
            const path = [{ id: "Hud", optional: true }, { className: "HudCore" }];
            const active = Q.panelCache.createIdResolver("hudActivePlayerStats", { ownerPath: path });
            const legacy = Q.panelCache.createIdResolver("hudPlayerStats", { ownerPath: [...path, "StatsAndModsContainer", "LowerLeft"] });
            const styles = P.createNativeStyleOwner({ resetValues: { x: "0px", y: "0px" } });
            let model = null, loop = null, running = false;
            function readModel() {
                const cfg = ctx.config.view();
                return {
                    x: Number(cfg.ENABLE_STATS_POSITION) === 1 ? QOL.settings.readNumber("STATS_POSITION_X_OFFSET", cfg.STATS_POSITION_X_OFFSET) : 0,
                    y: Number(cfg.ENABLE_STATS_POSITION) === 1 ? QOL.settings.readNumber("STATS_POSITION_Y_OFFSET", cfg.STATS_POSITION_Y_OFFSET) : 0,
                    visibilityConfig: cfg
                };
            }
            function update() {
                if (!running) return;
                const root = P.findHud($.GetContextPanel());
                const panel = P.isAlive(root) && (root.id === "Hud" || root.paneltype === "CitadelHud")
                    ? Q.presentation.chooseStatsPanel(legacy.resolve(root), active.resolve(root)) : null;
                styles.retain([panel]);
                if (!P.isAlive(panel)) return;
                const hidden = Q.presentation.shouldHide("playerStats", model.visibilityConfig, root);
                const properties = {};
                if (model.x) properties.x = model.x + "px";
                if (model.y) properties.y = -model.y + "px";
                if (hidden) properties.opacity = "0";
                styles.apply(panel, properties);
            }
            function refreshSettings() {
                if (!running) return;
                model = readModel();
                active.reset(); legacy.reset(); update();
            }
            return {
                onEnable() {
                    running = true;
                    refreshSettings();
                    ctx.events.on("engine:scoreboard_toggle", update);
                    loop = Q.core.Scheduler.createPollLoop(update, 1.0, ctx.id);
                },
                onSettingsChanged: refreshSettings,
                onDisable() {
                    running = false;
                    ctx.events.off("engine:scoreboard_toggle", update);
                    if (loop) loop.stop();
                    loop = null; styles.clear(); model = null;
                    active.reset(); legacy.reset();
                }
            };
        },
        test() {
            const root = Q.core.hud.findHud();
            const panel = Q.presentation.chooseStatsPanel(P.findTraverse(root, "hudPlayerStats"), P.findTraverse(root, "hudActivePlayerStats"));
            return { passed: !!panel, name: "Player stats panel exists", message: panel ? "" : "Native player stats owner not found",
                assertions: [{ passed: !!panel, name: "Native player stats owner exists" }] };
        }
    });
})();
