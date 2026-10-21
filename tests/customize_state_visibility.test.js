"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

function fixture() {
    const env = load(), Q = env.hud.sandbox.global.QOL;
    Q.core.App.shutdown();
    const add = (parent, id = "", classes = []) => parent.addChild(env.doc.create("Panel", { id, classes }));
    const owner = element => {
        let panel = env.hud.root;
        for (const segment of element.path) {
            let child = typeof segment === "string" ? panel.FindChild(segment) : panel.Children().find(item => item.BHasClass(segment.className));
            if (!child) child = add(panel, typeof segment === "string" ? segment : "", typeof segment === "string" ? [] : [segment.className]);
            panel = child;
        }
        return panel;
    };
    return { ...env, Q, add, owner };
}

test("state visibility has one paired contract across UI, native state, routing and JSON in both realms", () => {
    const env = fixture(), { Q, global: g } = env;
    const fields = Q.settingsFields.filter(field => field.role === "stateVisibility");
    const config = Q.buildDefaultConfig();
    for (const field of fields) {
        assert.equal(config[field.key], 0, field.key);
        assert.ok(field.owners.length);
        for (const id of field.owners) assert.ok(Q.core.FeatureRegistry.getManifest(id).settings.some(setting => setting.key === field.key), field.key + " owner " + id);
        for (const id of field.surfaces) {
            const element = Q.presentation.elements.find(item => item.id === id);
            assert.ok(element, id);
            const control = element.fields.find(item => item.key === field.key);
            assert.equal(control.type, "toggle");
            assert.equal(control.label, field.state === "normal" ? "Hide in normal view" : "Hide on scoreboard (TAB)");
            const pair = element.fields.filter(item => Q.settings.get(item.key).role === "stateVisibility");
            assert.equal(pair.length, 2, id);
        }
        config[field.key] = 1;
    }
    const code = g.QOL.ui.configTab.getCurrentExportSettingsString(config);
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(code);
    assert.equal(imported.ok, true);
    for (const field of fields) assert.equal(imported.candidateConfig[field.key], 1, field.key);
    for (const engine of [Q, g.QOL]) for (const field of fields) {
        const isolated = { [field.key]: 1 };
        const surface = field.surfaces[0];
        env.hud.root.RemoveClass("gScoreboardOpen");
        assert.equal(engine.presentation.shouldHide(surface, isolated, env.hud.root), field.state === "normal", field.key);
        env.hud.root.AddClass("gScoreboardOpen");
        assert.equal(engine.presentation.shouldHide(surface, isolated, env.hud.root), field.state === "scoreboard", field.key);
        assert.equal(engine.presentation.shouldHide(surface, {}, env.hud.root), false);
    }
    assert.equal(Q.presentation.elements.find(item => item.id === "ammoCurrent").fields.some(item => Q.settings.get(item.key).role === "stateVisibility"), false, "ammo digits inherit the complete ammo owner");
});

for (const id of ["souls", "items", "topBar", "bottomBar", "activeItems", "abilityPoints", "stamina", "ammo", "healthbar", "minimap", "shop", "damageImpact", "damageReport", "chat"]) {
    test(`${id}: native state hiding is immediate, reversible and independent of geometry and opacity`, () => {
        const env = fixture(), { Q } = env;
        const element = Q.presentation.elements.find(item => item.id === id), panel = env.owner(element);
        const controls = element.fields.filter(field => Q.settings.get(field.key).role === "stateVisibility");
        const normal = controls.find(field => Q.settings.get(field.key).state === "normal").key;
        const tab = controls.find(field => Q.settings.get(field.key).state === "scoreboard").key;
        const ownerId = Q.settings.get(normal).owners[0];
        const cfg = Q.buildDefaultConfig(); cfg[normal] = 1;
        const x = element.fields.find(field => field.axis === "x");
        if (x) cfg[x.key] = 37;
        if (id === "ammo") {
            env.add(panel.GetParent(), "clip_status"); env.add(panel.GetParent(), "clip_status_mirrored");
            assert.equal(Q.core.FeatureRegistry.getManifest(ownerId).isEnabled(cfg), true, "hide-only activates native suppression");
        }
        if (id === "minimap") env.add(env.add(panel, "minimap_container"), "hud_minimap");
        Q.core.ConfigAdapter.loadFromFlat(cfg); Q.core.FeatureRegistry.enable(ownerId);
        assert.equal(panel.style.visibility, "collapse", id);
        const position = panel.style.x || panel.style.marginLeft || panel.style.margin;
        env.hud.root.AddClass("gScoreboardOpen"); Q.core.EventBus.emit("engine:scoreboard_toggle"); env.hud.clock.advance(1);
        assert.equal(panel.style.visibility, undefined, "native visibility resumes; no forced visible override");
        assert.equal(panel.style.x || panel.style.marginLeft || panel.style.margin, position);
        Q.core.ConfigStore.set(ownerId, tab, true);
        Q.core.FeatureRegistry.getInstance(ownerId).onSettingsChanged({ key: tab, value: true });
        assert.equal(panel.style.visibility, "collapse");
        Q.core.FeatureRegistry.disable(ownerId);
        assert.equal(panel.style.visibility, undefined);
        Q.core.EventBus.emit("engine:scoreboard_toggle");
        assert.equal(panel.style.visibility, undefined, "retired event cannot reapply hiding");
        assert.deepEqual(env.hud.clock.errors, []);
    });
}

test("Player Stats hide-only keeps dormant offsets and the mirrored data source alive", () => {
    const env = fixture(), { Q } = env;
    const element = Q.presentation.elements.find(item => item.id === "playerStats");
    const panel = env.owner(element), block = env.add(panel, "HudStatBlock");
    Object.assign(block, { actuallayoutwidth: 180, actuallayoutheight: 60 });
    Q.core.ConfigAdapter.loadFromFlat({ ...Q.buildDefaultConfig(), ENABLE_STATS_POSITION: 0,
        STATS_POSITION_X_OFFSET: 901, STATS_POSITION_Y_OFFSET: 502, STATS_POSITION_HIDE_NORMAL: 1, STATS_POSITION_OPACITY: .55 });
    assert.equal(Q.core.FeatureRegistry.getManifest("ql_stats_position").isEnabled(Q.core.ConfigStore.view("ql_stats_position")), true);
    Q.core.FeatureRegistry.enable("ql_stats_position"); Q.core.FeatureRegistry.enable("ql_presentation_scale");
    assert.equal(panel.style.opacity, "0");
    assert.equal(panel.style.visibility, undefined); assert.equal(panel.visible, true);
    assert.equal(block.style.opacity, "0.55");
    assert.equal(panel.style.x, undefined); assert.equal(panel.style.y, undefined);
    env.hud.root.AddClass("gScoreboardOpen"); Q.core.EventBus.emit("engine:scoreboard_toggle");
    assert.equal(panel.style.opacity, undefined); assert.equal(block.style.opacity, "0.55");
    assert.equal(panel.style.x, undefined);
    Q.core.FeatureRegistry.disable("ql_stats_position"); Q.core.FeatureRegistry.disable("ql_presentation_scale");
});

for (const [id, ownerId, enabled, targetId] of [
    ["zipBoost", "ql_zipboost", { ENABLE_ZIP_BOOST: 1 }, "QOLZipBoostOverlay"],
    ["statBonuses", "ql_stat_bonuses", { ENABLE_STAT_BONUSES: 1 }, "QOLStatBonusesOverlay"],
    ["combatStatus", "ql_combat_status", { ENABLE_COMBAT_STATUS: 1 }, "QOLCombatStatusOverlay"],
    ["unsecuredTimer", "ql_unsecured_souls_timer", { ENABLE_UNSECURED_SOUL_TIMER: 1 }, "QOLUnsecuredSoulsOverlay"],
    ["unsecuredSouls", "ql_better_unsecured_hud", { ENABLE_BETTER_UNSECURED: 1 }, "QOLBetterUnsecuredOverlay"],
    ["keyboard", "ql_keyboard", { ENABLE_KEYBOARD_OVERLAY: 1 }, "QOLKeyboardOverlayRoot"],
    ["reload", "ql_reload_cooldown", { ENABLE_RELOAD_COOLDOWN: 1 }, "QOLReloadCooldownText"],
    ["activeStats", "ql_crosshair_stats", { ENABLE_CROSSHAIR_STATS: 1 }, "QOLCrosshairStatsOverlay"],
    ["compass", "ql_compass", { ENABLE_COMPASS: 1 }, "QOLCompassRoot"],
    ["speed", "ql_compass", { ENABLE_COMPASS_SPEED: 1 }, "QOLSpeedRoot"],
    ["cooldowns", "ql_item_mirror", { ENABLE_PASSIVE_COOLDOWN: 1, ENABLE_OLD_ITEM_COOLDOWNS: 0 }, "QOLItemMirrorRoot"],
    ["cooldowns", "ql_passive_cooldown", { ENABLE_PASSIVE_COOLDOWN: 1, ENABLE_OLD_ITEM_COOLDOWNS: 1 }, "hud_passive_items"],
    ["purchaseNotifications", "ql_recent_purchases", { ENABLE_SHOP_ITEM_NOTIFICATIONS: 1 }, "QuickPurchasesPanel"]
]) {
    test(`${id}/${ownerId}: owned overlay hiding respects TAB without stopping the owner or reviving disabled UI`, () => {
        const env = fixture(), { Q } = env, element = Q.presentation.elements.find(item => item.id === id);
        const native = env.owner({ path: Q.presentation.paths.gameplay });
        env.owner({ path: [...Q.presentation.paths.core, "TopBar"] });
        if (id === "reload") env.owner({ path: element.path.slice(0, -1) });
        if (ownerId === "ql_passive_cooldown") env.owner({ path: [...Q.presentation.paths.abilities, "hud_passive_items"] });
        Q.presentation.preview.selected = (_root, selected) => selected === id;
        const flags = element.fields.filter(field => Q.settings.get(field.key).role === "stateVisibility");
        const normal = flags.find(field => Q.settings.get(field.key).state === "normal").key;
        const tab = flags.find(field => Q.settings.get(field.key).state === "scoreboard").key;
        Q.core.ConfigAdapter.loadFromFlat({ ...Q.buildDefaultConfig(), ...enabled, [normal]: 0 });
        Q.core.FeatureRegistry.enable(ownerId); env.hud.clock.advance(501);
        Q.core.ConfigStore.set(ownerId, normal, true);
        Q.core.FeatureRegistry.getInstance(ownerId).onSettingsChanged({ key: normal, value: true });
        const panel = env.hud.root.FindChildTraverse(targetId); assert.ok(panel, targetId);
        assert.equal(panel.style.visibility, "collapse", id);
        env.hud.root.AddClass("gScoreboardOpen"); Q.core.EventBus.emit("engine:scoreboard_toggle"); env.hud.clock.advance(1);
        assert.notEqual(panel.style.visibility, "collapse", "existing content/preview rules resume");
        Q.core.ConfigStore.set(ownerId, tab, true);
        Q.core.FeatureRegistry.getInstance(ownerId).onSettingsChanged({ key: tab, value: true });
        assert.equal(panel.style.visibility, "collapse");
        assert.equal(Q.core.FeatureRegistry.isEnabled(ownerId), true, "state suppression never disables the data owner");
        Q.core.FeatureRegistry.disable(ownerId); env.hud.clock.advance(1);
        Q.core.EventBus.emit("engine:scoreboard_toggle"); env.hud.clock.advance(1);
        if (ownerId === "ql_passive_cooldown") {
            assert.equal(panel.IsValid(), true); assert.equal(panel.style.visibility, undefined);
        } else assert.equal(panel.IsValid(), false);
        assert.equal(native.IsValid(), true);
        assert.deepEqual(env.hud.clock.errors, []);
    });
}

test("hide-only Customize supports preview, Undo/Redo, Cancel, Save and JSON without activating stats placement", () => {
    const env = load(), g = env.global, Q = env.hud.sandbox.global.QOL;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const core = env.hud.root.addChild(env.doc.create("Panel", { classes: ["HudCore"] }));
    const panel = core.addChild(env.doc.create("Panel", { id: "hudActivePlayerStats" }));
    const block = panel.addChild(env.doc.create("Panel", { id: "HudStatBlock" }));
    Object.assign(panel, { actuallayoutwidth: 180, actuallayoutheight: 60 });
    Object.assign(block, { actuallayoutwidth: 180, actuallayoutheight: 60 });
    Object.assign(g.MOD_CONFIG, { ENABLE_STATS_POSITION: 0, STATS_POSITION_X_OFFSET: 901, STATS_POSITION_Y_OFFSET: 502 });
    g.SaveAndSync(); env.clock.advance(1200);
    const click = id => { const control = env.em.FindChildTraverse(id); assert.ok(control, id); control._fire("onactivate"); env.clock.advance(700); };
    const start = () => { g.QOL.ui.customize.start(null, { elementId: "playerStats" }); env.clock.advance(700); };
    start(); click("QOLCustomize_STATS_POSITION_HIDE_NORMAL");
    assert.equal(panel.style.opacity, "0"); assert.equal(panel.style.x, undefined);
    assert.equal(Q.core.ConfigStore.get("ql_stats_position", "ENABLE_STATS_POSITION"), false);
    click("QOLCustomizeUndo"); assert.equal(panel.style.opacity, undefined);
    click("QOLCustomizeRedo"); assert.equal(panel.style.opacity, "0");
    click("QOLCustomizeCancel"); assert.equal(panel.style.opacity, undefined);
    assert.equal(g.MOD_CONFIG.STATS_POSITION_HIDE_NORMAL, 0);
    start(); click("QOLCustomize_STATS_POSITION_HIDE_NORMAL");
    g.QOL.core.storageBridge.saveSettings = (_config, callback) => callback(null);
    click("QOLCustomizeApply");
    assert.equal(g.MOD_CONFIG.STATS_POSITION_HIDE_NORMAL, 1); assert.equal(g.MOD_CONFIG.ENABLE_STATS_POSITION, 0);
    assert.equal(panel.style.opacity, "0"); assert.equal(panel.style.x, undefined);
    const code = g.QOL.ui.configTab.getCurrentExportSettingsString();
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(code);
    assert.equal(imported.ok, true); assert.equal(imported.candidateConfig.STATS_POSITION_HIDE_NORMAL, 1);
    assert.equal(imported.candidateConfig.ENABLE_STATS_POSITION, 0); assert.equal(imported.candidateConfig.STATS_POSITION_X_OFFSET, 901);
    assert.deepEqual(env.clock.errors, []);
});
