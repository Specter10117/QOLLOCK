// OWNS: Disabled-ability crosses and local presentation classes on live HUD icons.
// DOES NOT OWN: Native disabled state, cooldown masks, ability input or bottom-bar geometry.
// Owners: current hud.xml + hud_ability_icon*.xml and October 3 Debugger capture.
(() => {
    "use strict";
    const P = QOL.core.panel;
    QOL.core.FeatureRegistry.register({
        id: "ql_disabled_abilities",
        enableKey: "ENABLE_BETTER_DISABLED_ABILITIES",
        enabledByDefault: false,
        settings: [{ key: "ENABLE_BETTER_DISABLED_ABILITIES", type: "toggle" }],
        create(ctx) {
            const icons = new Map(), classes = P.createNativeStyleOwner();
            let running = false, enabled = false, loop = null;

            function release() {
                for (const entry of icons.values()) entry.tree.dispose();
                icons.clear(); classes.clear();
            }

            function sources() {
                const root = P.findHud($.GetContextPanel()), result = new Map();
                if (!P.isAlive(root) || (root.id !== "Hud" && root.paneltype !== "CitadelHud")) return result;
                const abilities = P.findChild(P.findChildByClass(root, "HudCore"), "AbilitiesContainer");
                const signature = P.findChild(P.findChildByClass(P.findChild(abilities, "hud_signature"), "hud_abilities"), "abilities");
                const items = P.findChild(P.findChild(abilities, "ActiveAbilitiesMenu"), "abilitiesContainer");
                for (const [owner, type] of [[signature, "CitadelAbilityIcon"], [items, "DraggableAbilityIcon"]]) {
                    if (!P.isAlive(owner)) continue;
                    for (const icon of owner.Children().filter(panel => P.isAlive(panel) && panel.paneltype === type).slice(0, 4)) {
                        let host = P.findChildByClass(P.findChild(icon, "button_container"), "image_container");
                        if (type === "DraggableAbilityIcon") host = P.findChildByClass(host, "iconContainer");
                        if (P.findChild(host, "ability_image")) result.set(icon, host);
                    }
                }
                return result;
            }

            function update() {
                if (!running) return;
                if (!enabled) { release(); return; }
                const current = sources();
                for (const [icon, entry] of icons) {
                    if (current.get(icon) !== entry.host) { entry.tree.dispose(); icons.delete(icon); }
                }
                classes.retain(current.keys());
                for (const [icon, host] of current) {
                    if (!icons.has(icon)) icons.set(icon, { host, tree: P.createOwnedTree() });
                    const tree = icons.get(icon).tree;
                    tree.sweep();
                    const overlay = tree.child(host, "Panel", "QOLDisabledXOverlay");
                    const bars = [0, 1].map(index => tree.child(overlay, "Panel", "QOLDisabledXBar" + index));
                    classes.apply(icon, {}, { "qol-better-disabled": P.isAlive(overlay) && bars.every(P.isAlive) });
                }
            }

            function refresh() {
                if (!running) return;
                enabled = QOL.utils.IsCfgEnabled(ctx.config.view(), "ENABLE_BETTER_DISABLED_ABILITIES");
                update();
            }

            return {
                onEnable() { running = true; refresh(); loop = QOL.core.Scheduler.createPollLoop(update, 0.5, ctx.id); },
                onSettingsChanged: refresh,
                onDisable() { running = false; if (loop) loop.stop(); loop = null; release(); }
            };
        }
    });
})();
