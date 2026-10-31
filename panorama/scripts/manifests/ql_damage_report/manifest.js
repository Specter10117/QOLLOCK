// OWNS: Native damage-report offsets and their replacement/disable cleanup.
// DOES NOT OWN: Report gameplay data, visibility CSS or independent overall scale.
// Visibility is projected by core.hud from the complete flat configuration;
// ql_presentation_scale owns uiScale. Native source: Hud > .HudCore > CitadelHudDamageReport.
(() => {
    "use strict";
    QOL.core.FeatureRegistry.register({
        id: "ql_damage_report",
        // Offsets also apply while DISABLE_DAMAGE_REPORT is false.
        enabledByDefault: true,
        settings: [
            ...QOL.presentation.stateSettings("ql_damage_report"),
            { key: "DISABLE_DAMAGE_REPORT", type: "toggle" },
            { key: "DAMAGE_REPORT_X_OFFSET", type: "slider", label: "Horizontal Offset" },
            { key: "DAMAGE_REPORT_Y_OFFSET", type: "slider", label: "Vertical Offset" }
        ],
        create(ctx) {
            const P = QOL.core.panel;
            const resolver = QOL.panelCache.createIdResolver("CitadelHudDamageReport", {
                retryMs: 500, ownerPath: [{ id: "Hud", optional: true }, { className: "HudCore" }]
            });
            const styles = P.createNativeStyleOwner({ resetValues: { x: "0px", y: "0px" } });
            let model = null, loop = null, active = false;

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const styles = {};
                const x = Math.round(Number(cfg.DAMAGE_REPORT_X_OFFSET)) || 0;
                const y = Math.round(Number(cfg.DAMAGE_REPORT_Y_OFFSET)) || 0;
                if (x !== 0) styles.x = x + "px";
                if (y !== 0) styles.y = -y + "px";
                return styles;
            }

            function update() {
                if (!active) return;
                const root = P.findHud($.GetContextPanel());
                const panel = P.isAlive(root) && (root.id === "Hud" || root.paneltype === "CitadelHud") ? resolver.resolve(root) : null;
                styles.retain(panel ? [panel] : []);
                if (panel) styles.apply(panel, QOL.presentation.visibilityStyles("damageReport", QOL.presentation.visibilityConfig(ctx), root, model));
            }

            function refreshSettings() {
                if (!active) return;
                model = readModel();
                resolver.reset();
                QOL.core.hud.refreshRootClasses($.GetContextPanel());
                update();
            }

            return QOL.presentation.bindVisibility(ctx, {
                onEnable() {
                    active = true;
                    refreshSettings();
                    loop = QOL.core.Scheduler.createPollLoop(update, 0.5, ctx.id);
                },
                onSettingsChanged: refreshSettings,
                onDisable() {
                    active = false;
                    if (loop) { loop.stop(); loop = null; }
                    styles.clear();
                    model = null;
                    resolver.reset();
                }
            }, update);
        },
        test() {
            try {
                const hud = QOL.core.panel.findHud();
                if (!hud) return null;
                return { passed: true, name: "Damage report Hud panel exists", message: "",
                    assertions: [{ passed: true, name: "Hud panel exists" }] };
            } catch (e) {
                return { passed: false, name: "Damage report panel check", message: e.message || String(e) };
            }
        }
    });
})();
