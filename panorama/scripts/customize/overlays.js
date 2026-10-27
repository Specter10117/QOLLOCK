// Feature-owned overlays and native crosshair surfaces. Paths mirror their
// production owners; conditional gameplay content is never synthesized here.
(() => {
    "use strict";
    const C = QOL.presentation;
    const { gameplay, crosshair } = C.paths;
    const { geometry, opacity, toggle, field: f } = C.fields;
    const t = (key, label) => f(key, label, "toggle");
    const overlay = (id, name, panel, fields) => ({ id, name, group: "Overlay", path: [...gameplay, panel], fields });
    C.register([
        { id: "hitMarker", name: "Custom Hit Marker", group: "Crosshair", path: [...crosshair, "gun", "gun_data", "hit_markers"], fields: [
            toggle("ENABLE_CUSTOM_HITMARKER"), f("CUSTOM_HITMARKER_SIZE", "Line Length"), f("CUSTOM_HITMARKER_CRIT_SIZE", "Crit Line Length"),
            f("CUSTOM_HITMARKER_THICKNESS", "Thickness"), f("CUSTOM_HITMARKER_OFFSET", "Spacing"),
            f("CUSTOM_HITMARKER_COLOR", "Color", "palette"), f("CUSTOM_HITMARKER_CRIT_COLOR", "Crit Color", "palette"),
            t("ENABLE_CUSTOM_HITMARKER_SHADOW", "Outline Shadow"), t("ENABLE_CUSTOM_HITMARKER_HIDE_GLOW", "Hide Crit Glow")
        ] },
        overlay("activeStats", "Active Stats", "QOLCrosshairStatsOverlay", [
            toggle("ENABLE_CROSSHAIR_STATS"), ...geometry("CROSSHAIR_STATS_", true), opacity("CROSSHAIR_STATS_"),
            ...[
                ["DEBUFFS", "Debuffs"], ["BUFFS", "Buffs"], ["FIRERATE", "Fire Rate"], ["MOVESPEED", "Move Speed"],
                ["HEALAMP", "Healing Amplification"], ["BULLETRESIST", "Bullet Resist"], ["TECHRESIST", "Spirit Resist"],
                ["BULLETLIFESTEAL", "Bullet Lifesteal"], ["TECHLIFESTEAL", "Spirit Lifesteal"], ["WEAPONPOWER", "Weapon Damage"],
                ["SPIRIT", "Spirit Power"], ["RANGE", "Range"], ["DURATION", "Duration"],
                ["CLIPSIZE", "Ammo Capacity"], ["REGEN", "Health Regen"]
            ].map(([suffix, label]) => f("CROSSHAIR_STATS_SHOW_" + suffix, label, "toggle", { hidden: true }))
        ]),
        overlay("compass", "Compass", "QOLCompassRoot", [toggle("ENABLE_COMPASS"), f("ENABLE_SIMPLIFY_COMPASS", "Minimalist", "toggle", { hidden: true }),
            ...geometry("COMPASS_", true), opacity("COMPASS_"), f("COMPASS_STRETCH_X", "Width"), f("COMPASS_STRETCH_Y", "Height")]),
        Object.assign(overlay("speed", "Speed", "QOLSpeedRoot", [toggle("ENABLE_COMPASS_SPEED"), ...geometry("COMPASS_SPEED_", true), opacity("COMPASS_SPEED_")]), { scaleKey: "COMPASS_SPEED_SCALE" }),
        overlay("zipBoost", "Zipline Boost", "QOLZipBoostOverlay", [toggle("ENABLE_ZIP_BOOST"), ...geometry("ZIP_BOOST_", true), opacity("ZIP_BOOST_")]),
        overlay("combatStatus", "Combat Status", "QOLCombatStatusOverlay", [toggle("ENABLE_COMBAT_STATUS"), f("ENABLE_COMBAT_INDICATOR", "Combat Indicator", "toggle", { hidden: true }), ...geometry("COMBAT_STATUS_", true), opacity("COMBAT_STATUS_")]),
        overlay("unsecuredTimer", "Unsecured Souls Timer", "QOLUnsecuredSoulsOverlay", [toggle("ENABLE_UNSECURED_SOUL_TIMER"),
            ...geometry("UNSECURED_SOUL_TIMER_", true).map(item => item.axis === "x" ? { ...item, movementRatio: 0.5 } : item), opacity("UNSECURED_SOUL_TIMER_")]),
        { id: "unsecuredSouls", name: "Better Unsecured Souls", group: "Overlay", path: [...C.paths.core, "StatsAndModsContainer", "QOLBetterUnsecuredOverlay"],
            fallbackPath: [...gameplay, "QOLBetterUnsecuredOverlay"], fields: [
            toggle("ENABLE_BETTER_UNSECURED"), ...geometry("UNSECURED_SOULS_HUD_", true).map(item => item.axis === "y" ? Object.assign({}, item, { direction: 1 }) : item),
            opacity("UNSECURED_SOULS_HUD_"),
            f("ENABLE_BETTER_UNSECURED_SHOW_ICON", "Icon", "toggle", { hidden: true }),
            f("ENABLE_BETTER_UNSECURED_SHOW_TEXT", "Text", "toggle", { hidden: true }),
            f("ENABLE_BETTER_UNSECURED_SHOW_ICON_TEXT", "Icon Text", "toggle", { hidden: true })
        ] },
        { id: "keyboard", name: "Keyboard Overlay", group: "Overlay", path: [...gameplay, "QOLKeyboardOverlayRoot", "AllBindingsBox"], fields: [
            toggle("ENABLE_KEYBOARD_OVERLAY"), f("ENABLE_FULL_KEYBOARD_LAYOUT", "Full Keyboard", "toggle", { hidden: true }), ...geometry("KEYBOARD_OVERLAY_", true), opacity("KEYBOARD_OVERLAY_"),
            f("KEYBOARD_OVERLAY_THEME", "Keyboard Theme", "enum", { options: ["Deadlock", "Citadel", "Keystrokes", "NohBoard", "KeyViewer", "Light", "Outline", "Minimal"].map((name, index) => [index, name]) }),
            f("KEYBOARD_OVERLAY_LAYOUT", "Keyboard Layout", "enum", { options: [[0, "Full"], [1, "Compact"], [2, "Grid"]] }),
            f("KEYBOARD_OVERLAY_WASH_COLOR", "Color", "palette")
        ] },
        { id: "reload", name: "Reload Cooldown", group: "Crosshair", path: [...crosshair, "gun", "gun_data", "reticle_status", "QOLReloadCooldownText"], fields: [
            toggle("ENABLE_RELOAD_COOLDOWN"), f("ENABLE_HIDE_RELOAD_ICON", "Hide Reload Icon", "toggle", { hidden: true }),
            f("ENABLE_HIDE_RELOAD_CIRCLE", "Hide Reload Circle", "toggle", { hidden: true }),
            ...geometry("RELOAD_COOLDOWN_"), f("RELOAD_COOLDOWN_SIZE", "Size", null, { resize: true }), opacity("RELOAD_COOLDOWN_")
        ] },
        { id: "cooldowns", name: "Item Cooldowns", group: "Crosshair", path: [...gameplay, "QOLItemMirrorRoot"],
            resolve(hud, config) {
                const basic = Number(config?.ENABLE_OLD_ITEM_COOLDOWNS) === 1;
                return C.findPath(hud, basic ? [...C.paths.abilities, "hud_passive_items"] : [...gameplay, "QOLItemMirrorRoot"]);
            },
            measurePanels(target) {
                // The native Basic owner reserves a wide placement canvas;
                // only its actual icons and the leased sample are content.
                if (target.id === "hud_passive_items") {
                    const panels = QOL_UTILS.FindPanelsByClass(target, "ability_container");
                    const sample = QOL.core.panel.findChild(target, "QOLCustomizeBasicCooldownSample");
                    if (QOL.core.panel.isAlive(sample)) panels.push(sample);
                    return panels;
                }
                const row = QOL.core.panel.findChild(target, "QOLItemMirrorRow");
                return QOL.core.panel.isAlive(row) ? row.Children().filter(child => child.BHasClass("QOLItemMirrorIcon")) : [];
            },
            fields: [
                toggle("ENABLE_PASSIVE_COOLDOWN"), f("ENABLE_OLD_ITEM_COOLDOWNS", "Basic Mode", "toggle", { hidden: true }),
                f("PASSIVE_COOLDOWN_X", "Horizontal Offset (%)", null, { axis: "x", unit: "%" }),
                f("PASSIVE_COOLDOWN_Y", "Vertical Offset (%)", null, { axis: "y", direction: -1, unit: "%" }),
                f("PASSIVE_COOLDOWN_SIZE", "Size", null, { resize: true }), opacity("PASSIVE_COOLDOWN_"),
                f("ITEM_FILTER_DEF_PASSIVE", "Defensive Passive", "toggle", { hidden: true }),
                f("ITEM_FILTER_OFF_PASSIVE", "Offensive Passive", "toggle", { hidden: true }),
                f("ITEM_FILTER_DEF_ACTIVE", "Defensive Active", "toggle", { hidden: true }),
                f("ITEM_FILTER_OFF_ACTIVE", "Offensive Active", "toggle", { hidden: true })
        ] }
    ]);
})();
