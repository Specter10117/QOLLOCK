// Smaller HUD details use their existing independent controls or inherit the
// geometry of a parent surface. World-bound visuals do not gain screen offsets.
(() => {
    "use strict";
    const C = QOL.presentation;
    const { core, lower, abilities, gameplay } = C.paths;
    const { geometry, opacity, toggle, field: f, content: t } = C.fields;
    const inspectorOwners = {
        healthWarnings: "healthbar", objectives: "topBar", nicknames: "topBar", ranks: "topBar",
        ultimates: "topBar", topBarWarnings: "topBar", urn: "topBar", buffTimers: "topBar", abilities: "bottomBar"
    };
    const detail = (id, name, path, fields, group = "HUD") => ({ id, name, path, fields, group, inspectorOwner: inspectorOwners[id] });
    const thresholds = (prefix, category = "Color Warning") => [25, 65, 75].map(value =>
        t(prefix + value, value + "%", "toggle", { category }));
    // Shared healthbar scale preserves the native CSS baseline.
    const healthbar = Object.assign(detail("healthbar", "Healthbar", [...gameplay, "health_and_abilities_container"], [
        t("HEALTHBAR_TYPE", "Type", "enum", { options: QOL.settings.get("HEALTHBAR_TYPE").options }),
        ...geometry("PLAYER_HEALTHBAR_", true), opacity("PLAYER_HEALTHBAR_"), f("PLAYER_HEALTHBAR_ACCENT_COLOR", "Accent Color", "palette"),
        t("ENABLE_MINECRAFT_HEALTH_NUMBERS", "Health Numbers", "toggle", { when: session => Number(session.value("HEALTHBAR_TYPE")) === 5 }),
        t("ENABLE_COMBAT_INDICATOR", "Combat Indicator")
    ], "Healthbar"), { scaleKey: "PLAYER_HEALTHBAR_SCALE" });
    C.register([
        healthbar,
        { id: "statsList", name: "Stats List", group: "HUD", parentId: "playerStats", scaleKey: "STATS_LIST_SCALE",
            path: [...core, "hudActivePlayerStats", "StatList"],
            resolve(hud) {
                return QOL.core.panel.findChild(QOL.core.panel.findChild(
                    QOL.core.panel.findChildByClass(hud, "HudCore"), "hudActivePlayerStats"), "StatList");
            },
            fields: [...geometry("STATS_LIST_", true), opacity("STATS_LIST_")] },
        detail("healthWarnings", "Health Warnings", [...gameplay, "health_and_abilities_container"], [
            ...thresholds("ENABLE_COLOR_WARNING_")
        ], "Healthbar"),
        detail("damageImpact", "Damage Impact", [...core, "damage_impact"], [toggle("ENABLE_DAMAGE_IMPACT"), ...geometry("DAMAGE_IMPACT_", true), opacity("DAMAGE_IMPACT_")], "Crosshair"),
        Object.assign(detail("damageReport", "Damage Report", [...core, "CitadelHudDamageReport"], [
            f("DISABLE_DAMAGE_REPORT", "Hide", "toggle", { visibility: true, inverted: true }), ...geometry("DAMAGE_REPORT_", true), opacity("DAMAGE_REPORT_")
        ]), { scaleKey: "DAMAGE_REPORT_SCALE" }),
        detail("chat", "Chat", [...core, "Chat"], [toggle("ENABLE_CHAT"), t("ENABLE_IMAGES_IN_CHAT", "Images in Chat"), ...geometry("CHAT_", true), opacity("CHAT_")]),
        detail("objectives", "Objectives", [...core, "TopBar"], [t("ENABLE_OBJ_MAP", "Objective Map"), t("ENABLE_OBJ_DMG", "Objective Damage"), t("ENABLE_MISSING_HERO", "Missing Hero Opaque")]),
        detail("nicknames", "Nicknames", [...core, "TopBar"], [{ ...toggle("ENABLE_NICKNAMES"), label: "Nicknames" }, t("DISABLE_PLAYER_NAME_BLUR", "Top Bar Background", "toggle", { inverted: true })]),
        detail("ranks", "Ranks", [...core, "TopBar"], [t("SHOW_RANK", "Show Player Ranks"), t("SHOW_RANK_TOPBAR", "Show Rank in Top Bar", "toggle", { when: session => Number(session.value("SHOW_RANK")) === 1 })]),
        detail("ultimates", "Ultimate Cooldowns", [...core, "TopBar"], [{ ...toggle("ENABLE_ULT_COOLDOWNS"), label: "Ult Cooldowns" }]),
        detail("topBarWarnings", "Top Bar HP Warnings", [...core, "TopBar"], [...thresholds("ENABLE_TOPBAR_ENEMY_HP_WARNING_", "Enemy HP Warning"), ...thresholds("ENABLE_TOPBAR_ALLY_HP_WARNING_", "Ally HP Warning")]),
        detail("urn", "Urn", [...core, "TopBar"], [t("ENABLE_URN_DIFF", "Urn Difference"), t("ENABLE_URN_TIMER", "Rift Timer")]),
        detail("buffTimers", "Buffs and Rejuvenator", [...core, "TopBar"], [t("ENABLE_BUFF_HUD", "Bridge Buff Timer"), t("ENABLE_REJUV_HUD", "Mid Boss Timer")]),
        detail("abilities", "Ability Icons", [...abilities, "hud_signature"], [
            t("ENABLE_SIMPLIFY_ABILITY_ICONS", "Minimalist Abilities"), t("ENABLE_BETTER_DISABLED_ABILITIES", "Better Silenced/Cursed Abilities"), t("ENABLE_HIDE_COSMETIC_ABILITY", "Cosmetic Ability", "toggle", { inverted: true }),
            t("ENABLE_HIDE_ABILITY_SUGGESTION", "Ability Suggestion", "toggle", { inverted: true }), t("ENABLE_CLEAN_STACKS", "Clean Stacks"),
            t("ENABLE_LEGACY_COOLDOWNS", "Legacy Durations"), t("ENABLE_HIDE_FAILED_HINT", "Failed Hint", "toggle", { inverted: true })
        ]),
        detail("buildInfo", "Build ID", [...lower, "selected_build_info"], [toggle("ENABLE_SHOW_BUILD_ID"), t("ENABLE_SHOW_BUILD_ID_TITLE", "Build Title")], "Overlay"),
        { id: "targetShapes", name: "Target Shapes", group: "Crosshair", fields: [
            t("ENABLE_RED_DIAMOND", "Red Diamond"), t("ENABLE_IMPROVED_HINT", "Improved Hint"), f("UNIT_TARGET_SIZE", "Size"),
            f("UNIT_TARGET_OPACITY", "Opacity"), f("UNIT_TARGET_HINT_SIZE", "Hint Size")
        ] },
        { id: "statlocker", name: "Statlocker", group: "HUD", fields: [toggle("ENABLE_STATLOCKER")] }
    ]);
})();
