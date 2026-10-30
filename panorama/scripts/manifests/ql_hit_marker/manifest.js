// OWNS: Custom hit-marker lines, presentation settings and native-host class leases.
// DOES NOT OWN: Native hit/crit state, hit duration or the gun/crosshair layout.
// Native element_gun.xml/css and October 3 capture establish gun_data > hit_markers.
(() => {
    "use strict";
    const P = QOL.core.panel;
    const KEYS = ["CUSTOM_HITMARKER_SIZE", "CUSTOM_HITMARKER_CRIT_SIZE", "CUSTOM_HITMARKER_THICKNESS", "CUSTOM_HITMARKER_OFFSET"];
    QOL.core.FeatureRegistry.register({
        id: "ql_hit_marker",
        enableKey: "ENABLE_CUSTOM_HITMARKER",
        enabledByDefault: false,
        settings: [
            ...["ENABLE_CUSTOM_HITMARKER", "ENABLE_CUSTOM_HITMARKER_SHADOW", "ENABLE_CUSTOM_HITMARKER_HIDE_GLOW"].map(key => ({ key, type: "toggle" })),
            ...KEYS.map(key => ({ key, type: "slider" })),
            ...["CUSTOM_HITMARKER_COLOR", "CUSTOM_HITMARKER_CRIT_COLOR"].map(key => ({ key, type: "palette" }))
        ],
        create(ctx) {
            const tree = P.createOwnedTree(), native = P.createNativeStyleOwner(), signatures = new Map();
            const groups = ["Normal", "Crit"].map(name => ({ id: "QOLHitMarker" + name,
                entries: [0, 1, 2, 3].map(index => ({ id: "QOLHitMarker" + name + "Line" + index })) }));
            let running = false, host = null, model = null, loop = null;

            function release() {
                native.clear(); tree.clear(); signatures.clear(); host = null;
            }

            function readModel() {
                const cfg = ctx.config.view(), number = key => QOL.settings.readNumber(key, cfg[key]);
                const offset = number("CUSTOM_HITMARKER_OFFSET"), thickness = number("CUSTOM_HITMARKER_THICKNESS");
                const shadow = QOL.utils.IsCfgEnabled(cfg, "ENABLE_CUSTOM_HITMARKER_SHADOW") ? "0px 0px 3px rgba(0, 0, 0, 0.6)" : "none";
                const glow = !QOL.utils.IsCfgEnabled(cfg, "ENABLE_CUSTOM_HITMARKER_HIDE_GLOW");
                const plans = [false, true].map(crit => {
                    const width = number(crit ? "CUSTOM_HITMARKER_CRIT_SIZE" : "CUSTOM_HITMARKER_SIZE");
                    const color = P.resolvePaletteColor(cfg[crit ? "CUSTOM_HITMARKER_CRIT_COLOR" : "CUSTOM_HITMARKER_COLOR"]) || (crit ? "yellow" : "white");
                    // Match the native four corner transforms without letting a
                    // customized normal value cascade into the critical marker.
                    return [[45, -1, -1], [-45, 1, -1], [-45, -1, 1], [45, 1, 1]].map(([angle, x, y]) => ({
                        width: width + "px", height: thickness + "px", backgroundColor: color,
                        boxShadow: crit && glow ? "0px 0px 10px red" : shadow,
                        transform: "rotateZ(" + angle + "deg) translateX(" + x * offset + "px) translateY(" + y * offset + "px)"
                    }));
                });
                return { enabled: QOL.utils.IsCfgEnabled(cfg, "ENABLE_CUSTOM_HITMARKER"), plans };
            }

            function update() {
                if (!running) return;
                if (!model.enabled) { release(); return; }
                const root = P.findHud($.GetContextPanel());
                let current = P.isAlive(root) && (root.id === "Hud" || root.paneltype === "CitadelHud") ? P.findChildByClass(root, "HudCore") : null;
                for (const id of ["gameplay_hud", "gameplay_hud_alive", "crosshair", "gun", "gun_data", "hit_markers"]) current = P.findChild(current, id);
                if (current !== host) { release(); host = current; }
                if (!host) return;
                if (!tree.sweep()) signatures.clear();
                let complete = true;
                for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
                    const group = groups[groupIndex], parent = tree.child(host, "Panel", group.id);
                    const lines = tree.children(parent, "Panel", group.entries);
                    for (let index = 0; index < lines.length; index++) {
                        const line = lines[index];
                        if (!P.isAlive(line)) { complete = false; continue; }
                        const result = P.syncStyles(line, model.plans[groupIndex][index], signatures.get(line));
                        signatures.set(line, result.sig);
                        if (result.sig === null) complete = false;
                    }
                }
                const preview = complete && QOL.presentation.preview.selected(root, "hitMarker");
                native.apply(host, preview ? { opacity: "1" } : {}, {
                    "qol-custom-hitmarker": complete, "qol-hitmarker-preview": preview
                });
            }

            function refresh() { if (running) { model = readModel(); update(); } }
            return {
                onEnable() { running = true; refresh(); loop = QOL.core.Scheduler.createPollLoop(update, 0.5, ctx.id); },
                onSettingsChanged: refresh,
                onDisable() { running = false; if (loop) loop.stop(); loop = null; release(); model = null; tree.dispose(); }
            };
        }
    });
})();
