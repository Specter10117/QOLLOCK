// Static Midtown references adapted from MapHunter. Native minimap ownership,
// configuration, scheduling and cleanup remain with QOLLOCK.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const P = Q.core.panel;
    const id = "ql_minimap_loot";
    const toggles = ["ENABLE_MINIMAP_TOUGH_CRATES", "ENABLE_MINIMAP_HEALING_SNACKS", "ENABLE_MINIMAP_STATUES", "ENABLE_MINIMAP_CRATE_ROUTES"];
    const numbers = ["MINIMAP_CAMP_NAMES", "MINIMAP_LOOT_MARKER_SCALE", "MINIMAP_LOOT_OPACITY", "MINIMAP_ROUTE_SCALE",
        "MINIMAP_ROUTE_FROM_MINUTE", "MINIMAP_ROUTE_UNTIL_MINUTE", "MINIMAP_CRATE_FROM_MINUTE", "MINIMAP_CRATE_UNTIL_MINUTE"];
    const groups = [
        ["tough_crates", toggles[0], 5.4, "#3b82f6"],
        ["snacks", toggles[1], 3.5, "#4ade80"],
        ["statues", toggles[2], 3, "#facc15"],
        ["names", "MINIMAP_CAMP_NAMES"], ["runs", toggles[3]]
    ];
    const laneColors = { yellow: "#F1CC30", blue: "#29b1cc", green: "#59b247" };
    const minimalNames = new Set(["#map_district_theater", "#map_district_chinatown", "#map_district_fairfax", "#map_district_haunted_slums"]);
    const pct = value => (value * 100).toFixed(3) + "%";
    const px = value => value.toFixed(2) + "px";
    const windowOpen = (from, until, second) => (from <= 0 || second >= from * 60) && (until >= 90 || second < until * 60);

    Q.core.FeatureRegistry.register({
        id, enabledByDefault: false, enableKeys: toggles,
        isEnabled: cfg => toggles.some(key => Number(cfg[key]) === 1) || Number(cfg.MINIMAP_CAMP_NAMES) > 0,
        settings: [...toggles.map(key => ({ key, type: "toggle" })), ...numbers.map(key => ({ key, type: "slider" }))],
        create(ctx) {
            function nativeMap(root) {
                // XML plus the native capture place these owners directly below
                // one another. A missing live owner must not adopt a retained map.
                const byClass = (parent, name) => P.isAlive(parent)
                    ? parent.Children().find(panel => P.isAlive(panel) && panel.BHasClass(name)) || null : null;
                const core = byClass(root, "HudCore");
                const gameplay = P.findChild(core, "gameplay_hud");
                const clamp = byClass(gameplay, "clamp_width");
                const host = P.findChild(clamp, "minimap_persp");
                const viewport = P.findChild(host, "minimap_container");
                return P.findChild(P.findChild(viewport, "HudMinimapContainer"), "hud_minimap");
            }
            const tree = P.createOwnedTree();
            const built = new Map();
            const signatures = new Map();
            let model = null, modelSignature = "", owner = null, rootOwner = null, layer = null, loop = null, active = false;

            function clear() { tree.clear(); built.clear(); signatures.clear(); layer = owner = null; }
            function shown(panel, visible) { if (P.isAlive(panel) && panel.visible !== visible) panel.visible = visible; }
            function style(panel, values) {
                const result = P.syncStyles(panel, values, signatures.get(panel));
                signatures.set(panel, result.sig);
                return result.sig !== null;
            }
            function entry(list, styles, type = "Panel", text = null) { list.push({ styles, type, text }); }
            function at(u, v) { return { position: pct(u) + " " + pct(v) + " 0px", horizontalAlign: "left", verticalAlign: "top" }; }

            function plans(spec) {
                const [key, , size, color] = spec;
                const list = [], data = Q.minimapLootData;
                const scale = model.MINIMAP_LOOT_MARKER_SCALE / 100;
                if (size) for (const [u, v, underground] of data[key]) {
                    const side = size * scale + 2;
                    entry(list, { ...at(u, v), width: px(side), height: px(side), marginLeft: px(-side / 2), marginTop: px(-side / 2),
                        border: "1px solid #000000", borderRadius: key === "statues" ? "0px" : "50%", backgroundColor: color,
                        transform: key === "statues" ? "rotateZ(45deg)" : "none", opacity: underground ? "0.5" : "1" });
                }
                if (key === "names") for (const [u, v, token] of data.names) {
                    if (model.MINIMAP_CAMP_NAMES === 2 && !minimalNames.has(token)) continue;
                    entry(list, { ...at(u, v), width: px(140 * scale), fontSize: px(9 * scale), marginLeft: px(-70 * scale),
                        marginTop: px(-6.3 * scale), textAlign: "center", color: "#c8cad2", fontWeight: "bold",
                        textShadow: "1px 1px 2px #000000" }, "Label", $.Localize(token).replace(/\s*:\s*$/, ""));
                }
                if (key === "runs") {
                    const routeScale = model.MINIMAP_ROUTE_SCALE / 100;
                    let longest = 0;
                    for (const run of data.runs) {
                        longest = Math.max(longest, run.stops.length);
                        for (let index = 1; index < run.stops.length; index++) {
                            const a = run.stops[index - 1], b = run.stops[index];
                            const du = b[0] - a[0], dv = b[1] - a[1], length = Math.sqrt(du * du + dv * dv);
                            for (let start = 0; start < length; start += 0.014) {
                                const end = Math.min(length, start + 0.008), mid = (start + end) / 2 / length, width = end - start;
                                entry(list, { ...at(a[0] + du * mid - width / 2, a[1] + dv * mid), width: pct(width),
                                    height: px(2 * routeScale), marginTop: px(-routeScale), backgroundColor: laneColors[run.lane],
                                    transform: "rotateZ(" + Math.atan2(dv, du) * 180 / Math.PI + "deg)", opacity: "0.9" });
                            }
                        }
                    }
                    for (let index = longest - 1; index >= 0; index--) for (const run of data.runs) {
                        const point = run.stops[index];
                        if (!point) continue;
                        const side = 11 * routeScale;
                        entry(list, { ...at(point[0], point[1]), width: px(side), height: px(side), marginLeft: px(-side / 2), marginTop: px(-side / 2),
                            border: "1px solid " + (point[2] ? "#f59e0b" : laneColors[run.lane]), borderRadius: "50%", backgroundColor: "#1b1c22",
                            color: "#f3e9dc", fontSize: px(7 * routeScale), textAlign: "center", fontWeight: "bold" }, "Label", String(index + 1));
                    }
                }
                return list;
            }

            function build(spec, group) {
                const list = plans(spec);
                // Reconcile siblings in batches; no full-HUD searches or per-dot sibling scans.
                const byType = new Map();
                list.forEach((plan, index) => {
                    if (!byType.has(plan.type)) byType.set(plan.type, []);
                    byType.get(plan.type).push({ id: "QOLMapLoot_" + spec[0] + "_" + index, properties: { hittest: "false" }, plan });
                });
                let ready = true;
                for (const [type, entries] of byType) {
                    const children = tree.children(group, type, entries);
                    children.forEach((panel, index) => {
                        if (!P.isAlive(panel)) { ready = false; return; }
                        const plan = entries[index].plan;
                        ready = style(panel, plan.styles) && ready;
                        if (plan.text !== null && panel.text !== plan.text) panel.text = plan.text;
                        if (type === "Label") P.setClass(panel, "QOLMinimapLootText", true);
                    });
                }
                return ready;
            }

            function update() {
                if (!active) return;
                const root = P.findHud($.GetContextPanel());
                if (root !== rootOwner) { clear(); rootOwner = root; }
                const native = P.isAlive(root) && (root.id === "Hud" || root.paneltype === "CitadelHud") ? nativeMap(root) : null;
                if (native !== owner) { clear(); owner = native; }
                if (!P.isAlive(owner) || !owner.BHasClass("dl_midtown") || Q.core.hud.isInHideout(root) || Q.isStreetBrawlModeActive?.(root)) { shown(layer, false); return; }
                if (!tree.sweep()) { built.clear(); }
                const previousLayer = layer;
                layer = tree.child(owner, "Panel", "QOLMinimapLootRoot", { hittest: "false", hittestchildren: "false" });
                if (!P.isAlive(layer)) return;
                if (layer !== previousLayer) shown(layer, false);
                if (!style(layer, { width: "100%", height: "100%", ignoreParentFlow: "true", overflow: "noclip", opacity: String(model.MINIMAP_LOOT_OPACITY), zIndex: "10" })) { shown(layer, false); return; }
                const second = Q.core.time.readObservedGameTime(root);
                for (const spec of groups) {
                    const [key, setting] = spec;
                    const group = tree.child(layer, "Panel", "QOLMapLoot_" + key, { hittest: "false", hittestchildren: "false" });
                    if (!P.isAlive(group)) continue;
                    let wanted = key === "names" ? model[setting] > 0 : model[setting] === 1;
                    if (key === "tough_crates") wanted = wanted && windowOpen(model.MINIMAP_CRATE_FROM_MINUTE, model.MINIMAP_CRATE_UNTIL_MINUTE, second);
                    if (key === "runs") wanted = wanted && windowOpen(model.MINIMAP_ROUTE_FROM_MINUTE, model.MINIMAP_ROUTE_UNTIL_MINUTE, second);
                    if (!wanted) { shown(group, false); continue; }
                    if (built.get(key) === group) { shown(group, true); continue; }
                    shown(group, false);
                    if (!style(group, { width: "100%", height: "100%", ignoreParentFlow: "true", overflow: "noclip", zIndex: key === "runs" ? "10" : "1" })) continue;
                    if (built.get(key) !== group && build(spec, group)) built.set(key, group);
                    shown(group, built.get(key) === group);
                }
                shown(layer, true);
            }
            function refresh() {
                if (!active) return;
                const config = ctx.config.view();
                const next = Object.fromEntries([...toggles, ...numbers].map(key => [key, Q.settings.readNumber(key, config[key])]));
                const signature = JSON.stringify(next);
                if (signature !== modelSignature) { clear(); model = next; modelSignature = signature; }
                update();
            }
            return {
                onEnable() { active = true; refresh(); loop = Q.core.Scheduler.createPollLoop(update, 0.5, id); },
                onSettingsChanged: refresh,
                onDisable() { active = false; loop?.stop(); loop = null; clear(); tree.dispose(); rootOwner = model = null; modelSignature = ""; }
            };
        }
    });
})();
