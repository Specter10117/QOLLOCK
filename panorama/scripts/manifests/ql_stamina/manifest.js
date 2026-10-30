// Native-relative stamina rotation and ready/drained pip border color.
// Preserve main's native baseline and feedback contract (11e0434).
// Source: element_charges.xml; captured crosshair > dash > charges_container.
(() => {
    "use strict";
    const Q = QOL;
    const P = Q.core.panel;
    const element = Q.presentation.elements.find(item => item.id === "stamina");
    function findCharges(root) {
        const direct = Q.presentation.resolve(element, root);
        if (direct) return direct;
        // Compatibility with a native stamina wrapper outside the named path;
        // active-ability/roll charge containers have no drained stamina pips.
        for (const wrapper of QOL_UTILS.FindPanelsByClass(root, "ability_element_charges")) {
            const candidate = P.findTraverse(wrapper, "charges_container");
            if (QOL_UTILS.FindPanelsByClass(candidate, "charge_drained").length) return candidate;
        }
        return null;
    }
    Q.core.FeatureRegistry.register({
        id: "ql_stamina", enabledByDefault: true,
        settings: [
            { key: "STAMINA_CHARGE_ANGLE", type: "slider" },
            { key: "STAMINA_CHARGE_COLOR", type: "palette" }
        ],
        create(ctx) {
            const colored = P.createNativeStyleOwner();
            const rotations = P.createNativeStyleOwner({ preserveStyles: ["transform"] });
            let panel = null, root = null, model = null, loop = null, active = false;
            let nextSearchMs = 0;
            function release() {
                colored.clear(); rotations.clear();
                panel = null;
                nextSearchMs = 0;
            }
            function renderColor() {
                const targets = new Set();
                if (model.color) {
                    for (const target of QOL_UTILS.FindPanelsByClass(panel, "charge_fg")) {
                        const charge = target.GetParent();
                        if (P.hasClassToken(charge, "has_charge") &&
                            !P.hasClassToken(charge, "charging") && !P.hasClassToken(charge, "draining") &&
                            !P.hasClassToken(charge, "disabled") && !P.hasClassToken(charge, "drained")) targets.add(target);
                    }
                    for (const target of QOL_UTILS.FindPanelsByClass(panel, "charge_drained")) targets.add(target);
                }
                colored.retain(targets);
                for (const target of targets) {
                    colored.apply(target, model.colorStyles);
                }
            }
            function update() {
                if (!active) return;
                if (!model.active) { release(); return; }
                const currentRoot = P.findHud($.GetContextPanel());
                if (currentRoot !== root) { release(); root = currentRoot; }
                if (!P.isAlive(root) || (root.id !== "Hud" && root.paneltype !== "CitadelHud")) { release(); return; }
                const now = QOL_UTILS.PerfNowMs();
                if (!panel && now < nextSearchMs) return;
                const current = findCharges(root);
                if (current !== panel) {
                    release(); panel = current;
                }
                if (!current) nextSearchMs = now + 1500;
                rotations.retain(model.rotation && P.isAlive(panel) ? [panel] : []);
                if (!P.isAlive(panel)) return;
                if (model.rotation) {
                    const native = rotations.baseline(panel, "transform");
                    const transform = (native ? native + " " : "") + "rotateZ(" + model.rotation + "deg)";
                    rotations.apply(panel, { transform });
                }
                renderColor();
            }
            function refreshSettings() {
                if (!active) return;
                const cfg = ctx.config.view();
                const raw = Math.round(Number(cfg.STAMINA_CHARGE_ANGLE));
                const stored = Number.isFinite(raw) ? raw : QOL_DEFAULT_CONFIG.STAMINA_CHARGE_ANGLE;
                const rotation = QOL_UTILS.ShortestDegreesDelta(0, Q.presentation.toDisplayValue("STAMINA_CHARGE_ANGLE", stored));
                const color = P.resolvePaletteColor(cfg.STAMINA_CHARGE_COLOR);
                model = { active: !!rotation || !!color, color, rotation, colorStyles: color ? { borderColor: color } : {} };
                nextSearchMs = 0;
                update();
                if (model.active && !loop) loop = Q.core.Scheduler.createPollLoop(update, 0.5, ctx.id);
                else if (!model.active && loop) { loop.stop(); loop = null; }
            }
            return {
                onEnable() { active = true; refreshSettings(); },
                onSettingsChanged: refreshSettings,
                onDisable() { active = false; if (loop) loop.stop(); loop = null; release(); root = model = null; }
            };
        },
        test() {
            const panel = findCharges($.GetContextPanel());
            return panel ? { passed: true, name: "Stamina charges panel exists", message: "",
                assertions: [{ passed: true, name: "charges_container panel exists" }] } : null;
        }
    });
})();
