// OWNS: Directional damage indicator offsets, overall scale, opacity and visibility.
// DOES NOT OWN: Damage events, native animation transforms or damage-number children.
// Source: Hud > .HudCore > damage_impact; hud_damage_impact.css uses ui-scale: 80%.
(() => {
    "use strict";
    QOL.core.FeatureRegistry.register({
        id: "ql_damage_impact",
        // Hidden indicators still need replacement discovery.
        enabledByDefault: true,
        settings: [
            ...QOL.presentation.stateSettings("ql_damage_impact"),
            { key: "ENABLE_DAMAGE_IMPACT", type: "toggle" },
            { key: "DAMAGE_IMPACT_SCALE", type: "slider" },
            { key: "DAMAGE_IMPACT_OPACITY", type: "slider" },
            { key: "DAMAGE_IMPACT_X_OFFSET", type: "slider" },
            { key: "DAMAGE_IMPACT_Y_OFFSET", type: "slider" }
        ],
        create(ctx) {
            const P = QOL.core.panel;
            const resolver = QOL.panelCache.createIdResolver("damage_impact", {
                retryMs: 500, ownerPath: [{ id: "Hud", optional: true }, { className: "HudCore" }]
            });
            const styles = P.createNativeStyleOwner({ resetValues: { x: "0px", y: "0px" } });
            let model = null, loop = null, active = false;

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const styles = {};
                const x = Math.round(Number(cfg.DAMAGE_IMPACT_X_OFFSET)) || 0;
                const y = Math.round(Number(cfg.DAMAGE_IMPACT_Y_OFFSET)) || 0;
                const scale = Number(cfg.DAMAGE_IMPACT_SCALE);
                const opacity = QOL.utils.NormalizeOpacityNumber(cfg.DAMAGE_IMPACT_OPACITY ?? 1, 1);
                if (x !== 0) styles.x = x + "px";
                if (y !== 0) styles.y = -y + "px";
                if (Number.isFinite(scale) && scale !== 1) styles.uiScale = Number((scale * 80).toFixed(2)) + "%";
                if (opacity !== 1) styles.opacity = opacity.toFixed(2);
                const hidden = Number(cfg.ENABLE_DAMAGE_IMPACT) !== 1;
                if (hidden) styles.visibility = "collapse";
                return { hidden, styles };
            }

            function update() {
                if (!active) return;
                const root = P.findHud($.GetContextPanel());
                const panel = P.isAlive(root) && (root.id === "Hud" || root.paneltype === "CitadelHud") ? resolver.resolve(root) : null;
                styles.retain(panel ? [panel] : []);
                if (panel) styles.apply(panel, QOL.presentation.visibilityStyles("damageImpact", QOL.presentation.visibilityConfig(ctx), root, model.styles), { "qol-hidden": model.hidden });
            }

            function refreshSettings() {
                if (!active) return;
                model = readModel();
                resolver.reset();
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
                const panel = QOL.core.panel.findTraverse($.GetContextPanel(), "damage_impact");
                if (!panel) return null;
                return { passed: true, name: "Damage impact panel exists", message: "",
                    assertions: [{ passed: true, name: "damage_impact panel exists" }] };
            } catch (e) {
                return { passed: false, name: "Damage impact panel check", message: e.message || String(e) };
            }
        }
    });
})();
