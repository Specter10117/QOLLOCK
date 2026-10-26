// Shared presentation capabilities. These bind existing settings to verified
// HUD owners; gameplay content and feature rendering remain in the manifests.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const core = [{ className: "HudCore" }];
    const lower = [...core, "StatsAndModsContainer", "LowerLeft"];
    const abilities = [...core, "AbilitiesContainer"];
    const crosshair = [...core, "gameplay_hud", "gameplay_hud_alive", "crosshair"];
    const geometry = (prefix, scale = false) => [
        { key: prefix + "X_OFFSET", label: "Horizontal Offset", axis: "x" },
        { key: prefix + "Y_OFFSET", label: "Vertical Offset", axis: "y", direction: -1 },
        ...(scale ? [{ key: prefix + "SCALE", label: "Scale", resize: true }] : [])
    ];
    const opacity = prefix => ({ key: prefix + "OPACITY", label: "Opacity" });
    const toggle = key => ({ key, label: "Enable", type: "toggle", visibility: true });
    const color = key => ({ key, label: "Color", type: "color" });
    const elements = [];
    const nativeElements = [
        { id: "souls", name: "Souls", path: [...lower, "gold_and_ap_container"],
            measurePanels(target) {
                // Overall scale belongs to the level-and-currency owner. Its
                // conditional CurrentGoldAmount row omits other visible content.
                const panels = ["PlayerLevelContainer", "hudGoldContainer"]
                    .map(id => Q.core.panel.findChild(target, id)).filter(Q.core.panel.isAlive);
                return panels.length ? panels : [target];
            },
            fields: [toggle("HUD_SOULS_ENABLED"), ...geometry("SOULS_"), opacity("SOULS_")] },
        { id: "items", name: "Items", path: [...lower, "ModsContainer"], fields: [toggle("HUD_ITEMS_ENABLED"), ...geometry("ITEMS_"), opacity("ITEMS_"), color("ITEMS_WASH_COLOR")] },
        { id: "topBar", name: "Top Bar", path: [...core, "TopBar"], fields: [toggle("HUD_TOP_BAR_ENABLED"), ...geometry("TOP_BAR_", true), opacity("TOP_BAR_")] },
        { id: "bottomBar", name: "Abilities", path: [...abilities, "hud_signature"], fields: [toggle("HUD_BOTTOM_BAR_ENABLED"), ...geometry("BOTTOM_BAR_", true), opacity("BOTTOM_BAR_"), { key: "BOTTOM_BAR_WASH_COLOR", label: "Color", type: "palette" }] },
        { id: "activeItems", name: "Active Items", path: [...abilities, "ActiveAbilitiesMenu"], fields: [...geometry("ACTIVE_ITEMS_", true), opacity("ACTIVE_ITEMS_")] },
        { id: "abilityPoints", name: "Ability Points", path: [...abilities, "APContainer"], frame: true,
            fields: [...geometry("AP_"), opacity("AP_")] },
        { id: "ammo", name: "Ammo", path: [...crosshair, "gun", "gun_data", "ammo_panel"],
            resolve: resolveAmmo,
            measurePanels(target) {
                const gun = Q.core.panel.isAlive(target) ? target.GetParent() : null;
                return ["ammo_panel", "clip_status", "clip_status_mirrored"]
                    .map(id => Q.core.panel.findChild(gun, id)).filter(Q.core.panel.isAlive);
            },
            fields: [
            { key: "ENABLE_AMMO_STATUS", label: "Magazine indicator", type: "toggle" }, { key: "ENABLE_HIDE_MAGAZINE", label: "Hide max ammo", type: "toggle" },
            { key: "ENABLE_HIDE_AMMO_ALL", label: "Hide current ammo", type: "toggle" },
            ...geometry("AMMO_PANEL_"), { key: "AMMO_PANEL_SCALE", label: "Current Ammo", hidden: true }, { key: "AMMO_CURRENT_SCALE", label: "Current Ammo", hidden: true },
            { key: "AMMO_TOTAL_SCALE", label: "Max Ammo", hidden: true },
            { key: "AMMO_CURRENT_X_OFFSET", label: "Current Horizontal Offset", unit: "px", hidden: true },
            { key: "AMMO_CURRENT_Y_OFFSET", label: "Current Vertical Offset", unit: "px", hidden: true },
            { key: "AMMO_MAX_X_OFFSET", label: "Max Horizontal Offset", unit: "px", hidden: true },
            { key: "AMMO_MAX_Y_OFFSET", label: "Max Vertical Offset", unit: "px", hidden: true },
            { key: "AMMO_CLIP_ANGLE", label: "Rotation" }, opacity("AMMO_HUD_"), color("AMMO_TEXT_COLOR")
        ] },
        { id: "stamina", name: "Stamina", path: [...crosshair, "dash", "charges_container"], frame: true, fields: [
            ...geometry("STAMINA_"), { key: "STAMINA_SCALE", label: "Scale", resize: true }, opacity("STAMINA_"), { key: "STAMINA_CHARGE_ANGLE", label: "Rotation" }, color("STAMINA_CHARGE_COLOR")
        ] },
        { id: "playerStats", name: "Player Stats", path: [...lower, "hudPlayerStats"], fallbackPath: [...core, "hudActivePlayerStats"],
            resolve(hud) { return chooseStatsPanel(findPath(hud, [...lower, "hudPlayerStats"]), findPath(hud, [...core, "hudActivePlayerStats"])); }, fields: [
            { key: "ENABLE_STATS_POSITION", label: "Custom position", type: "toggle", hidden: true }, ...geometry("STATS_POSITION_"), opacity("STATS_POSITION_"),
            { key: "STATS_POSITION_HIDE_NORMAL", label: "Hide (Normal)", type: "toggle" },
            { key: "STATS_POSITION_HIDE_SCOREBOARD", label: "Hide (Scoreboard)", type: "toggle" }
        ] }
    ];
    const fieldMap = new Map();
    const settingFields = new Map(Q.settingsFields.map(field => [field.key, field]));
    // The published stamina field uses legacy 45 as its no-op sentinel.
    // Presentation uses an actual delta from native layout, with zero as no-op.
    // Keep this conversion at the shared boundary instead of inventing a native angle.
    const { toDisplayValue, fromDisplayValue, displayBounds } = Q.settings;
    const stateFields = Q.settingsFields.filter(field => field.role === "stateVisibility");
    const stateSettings = owner => stateFields.filter(field => field.owners.includes(owner)).map(field => ({ key: field.key, type: "toggle" }));
    const stateBySurface = new Map();
    for (const field of stateFields) for (const surface of field.surfaces) {
        if (!stateBySurface.has(surface)) stateBySurface.set(surface, []);
        stateBySurface.get(surface).push(field);
    }
    const visibilityFields = surface => stateBySurface.get(surface) || [];
    const hasStateHiding = (surface, config) => visibilityFields(surface).some(field => Number(config?.[field.key]) === 1);
    function shouldHide(surface, config, root) {
        const fields = visibilityFields(surface);
        if (!fields.some(field => Number(config?.[field.key]) === 1)) return false;
        const state = Q.hudState.isScoreboardOpen(root) ? "scoreboard" : "normal";
        return fields.some(field => field.state === state && Number(config?.[field.key]) === 1);
    }
    const visibilityStyles = (surface, config, root, styles) => shouldHide(surface, config, root)
        ? { ...styles, visibility: "collapse" } : styles;
    // Reuse each owner's normal update and lifecycle; no visibility poller or
    // parallel renderer. Native state is observed after the verified event.
    const visibilityConfigs = new WeakMap();
    const captureVisibility = (ctx, config) => { visibilityConfigs.set(ctx, config); return config; };
    const visibilityConfig = ctx => visibilityConfigs.get(ctx) || QOL_DEFAULT_CONFIG;
    function bindVisibility(ctx, hooks, update) {
        const owned = stateFields.filter(field => field.owners.includes(ctx.id));
        const refresh = () => { if (owned.some(field => Number(visibilityConfig(ctx)[field.key]) === 1)) update(); };
        return { ...hooks,
            onEnable() {
                ctx.events.on("engine:scoreboard_toggle", refresh);
                try { hooks.onEnable?.(); } catch (error) { ctx.events.off("engine:scoreboard_toggle", refresh); visibilityConfigs.delete(ctx); throw error; }
            },
            onDisable() {
                ctx.events.off("engine:scoreboard_toggle", refresh);
                visibilityConfigs.delete(ctx);
                hooks.onDisable?.();
            }
        };
    }
    function register(additions) {
        for (const element of additions) {
            if (elements.some(existing => existing.id === element.id)) throw new Error("Duplicate customization owner: " + element.id);
            for (const metadata of visibilityFields(element.id)) {
                const label = metadata.state === "normal" ? "Hide in normal view" : "Hide on scoreboard (TAB)";
                const existing = element.fields.find(field => field.key === metadata.key);
                if (existing) existing.label = label;
                else element.fields.push({ key: metadata.key, label, type: "toggle" });
            }
            for (const field of element.fields) {
                if (!settingFields.has(field.key) || !(field.key in QOL_DEFAULT_CONFIG)) throw new Error("Unknown customization setting: " + field.key);
                fieldMap.set(field.key, field);
            }
            // Native/template panels may survive feature disable. Their
            // existence and nonzero layout do not make the feature editable on
            // the canvas. Keep disabled entries reachable through All elements.
            const visibility = element.fields.find(field => field.visibility);
            if (visibility) {
                const available = element.available;
                element.available = (hud, config) => {
                    const on = Number(config?.[visibility.key]) === 1;
                    return (visibility.inverted ? !on : on) && (!available || available(hud, config));
                };
            }
            const available = element.available;
            element.available = (hud, config) => !shouldHide(element.id, config, hud) &&
                (!element.parentId || !shouldHide(element.parentId, config, hud)) && (!available || available(hud, config));
            elements.push(element);
        }
    }
    for (const [id, prefix] of [["souls", "SOULS_"], ["items", "ITEMS_"], ["playerStats", "STATS_POSITION_"], ["ammo", "AMMO_HUD_"], ["abilityPoints", "AP_"]]) {
        const element = nativeElements.find(item => item.id === id);
        element.fields.push({ key: prefix + "SCALE", label: "Scale", resize: true });
        element.scaleKey = prefix + "SCALE";
    }
    nativeElements.find(item => item.id === "stamina").scaleKey = "STAMINA_SCALE";
    for (const [id, name, prefix, className, sizeKey] of [
        ["ammoCurrent", "Current Ammo", "AMMO_CURRENT_", "weapon_ammo", "AMMO_CURRENT_SCALE"],
        ["ammoMax", "Max Ammo", "AMMO_MAX_", "weapon_ammo_max", "AMMO_TOTAL_SCALE"]
    ]) nativeElements.push({ id, name, parentId: "ammo", group: "Crosshair", framePriority: 4, path: [...crosshair, "gun", "gun_data", "ammo_panel"],
        resolve(hud) {
            const panel = resolveAmmo(hud);
            return panel?.id === "ammo_panel" ? QOL_UTILS.FindPanelsByClass(panel, className)[0] || null : null;
        },
        available: (_hud, config) => Number(config?.[id === "ammoCurrent" ? "ENABLE_HIDE_AMMO_ALL" : "ENABLE_HIDE_MAGAZINE"]) !== 1,
        fields: [...geometry(prefix), { key: sizeKey, label: "Size", unit: "%", resize: true }, color("AMMO_TEXT_COLOR")]
    });
    register(nativeElements);

    const normalize = (key, value) => fieldMap.has(key) ? Q.settings.normalize(key, value) : null;
    function findPath(hud, path) {
        let panel = hud;
        for (const segment of path) {
            panel = typeof segment === "string" ? Q.core.panel.findChild(panel, segment)
                : QOL_UTILS.FindFirstPanelByClass(panel, segment.className);
            if (!Q.core.panel.isAlive(panel)) return null;
        }
        return panel;
    }
    function resolve(element, hud, config) {
        if (!element.path || element.context) return null;
        if (element.resolve) return element.resolve(hud, config);
        const direct = findPath(hud, element.path);
        if (direct) return direct;
        // Scope compatibility discovery to the nearest named owner. Generic
        // leaves such as MainPanel must never match another screen's subtree.
        const path = element.path;
        const leaf = path[path.length - 1];
        for (let index = path.length - 2; index >= 0; index--) {
            if (typeof path[index] !== "string") continue;
            const owner = Q.core.panel.findTraverse(hud, path[index]);
            if (owner) {
                const candidate = Q.core.panel.findTraverse(owner, leaf);
                if (candidate) return candidate;
                break;
            }
        }
        return (path.length === 1 ? Q.core.panel.findTraverse(hud, leaf) : null) ||
            (element.fallbackPath ? findPath(hud, element.fallbackPath) : null);
    }
    function resolveAmmo(hud) {
        const gun = findPath(hud, [...crosshair, "gun", "gun_data"]);
        return Q.core.panel.findChild(gun, "ammo_panel") || Q.core.panel.findChild(gun, "clip_status") ||
            Q.core.panel.findChild(gun, "clip_status_mirrored");
    }
    const canDrag = element => element.fields.some(field => field.axis);
    function chooseStatsPanel(legacy, active) {
        const hasContent = panel => ["HudStatBlock", "StatList"].some(id => {
            const content = Q.core.panel.findChild(panel, id);
            return content && content.visible !== false && content.style.visibility !== "collapse" &&
                content.actuallayoutwidth > 0 && content.actuallayoutheight > 0;
        });
        // Native compact stats now live in the active owner. The coexisting
        // legacy owner may have no layout while its HudStatBlock is collapsed.
        return hasContent(legacy) ? legacy : hasContent(active) ? active : legacy || active;
    }
    const resizeField = element => element.fields.find(field => field.resize) || null;
    const scaleTarget = (element, target) => element.id === "playerStats"
        ? Q.core.panel.findChild(target, "HudStatBlock") || target : target;
    const hasFrame = element => element.frame !== false && (element.frame === true || canDrag(element) || !!resizeField(element));
    const field = (key, label, type, extra = {}) => Object.assign({ key, label, ...(type ? { type } : {}) }, extra);
    Q.presentation = { stateSettings, captureVisibility, visibilityConfig, hasStateHiding, shouldHide, visibilityStyles, bindVisibility, elements, fieldMap, settingFields, normalize, resolve, findPath, register, canDrag, resizeField, hasFrame, chooseStatsPanel, scaleTarget, toDisplayValue, fromDisplayValue, displayBounds,
        paths: { core, lower, abilities, crosshair, gameplay: [...core, "gameplay_hud"] },
        fields: { geometry, opacity, toggle, color, field } };
})();
