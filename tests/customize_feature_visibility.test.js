"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const startDrag = require("./customize_drag_fixture");

function setup() {
    const env = load();
    // Retained native/template panels deliberately keep positive layout when
    // their feature is off. Test the editor's gate, independent of renderer cleanup.
    env.hud.sandbox.global.QOL.core.App.shutdown();
    env.global.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const add = (parent, id, classes = []) => {
        const panel = parent.addChild(env.doc.create("Panel", { id, classes }));
        Object.assign(panel, { actuallayoutwidth: 180, actuallayoutheight: 60 });
        return panel;
    };
    const core = add(env.hud.root, "", ["HudCore"]);
    const gameplay = add(core, "gameplay_hud");
    const abilities = add(core, "AbilitiesContainer");
    return { ...env, add, core, gameplay, abilities, find: id => env.em.FindChildTraverse(id) };
}

for (const basic of [0, 1]) test(`disabled Item Cooldowns have no frame, catalog availability or drag in mode ${basic}`, () => {
    const env = setup(), g = env.global;
    Object.assign(g.MOD_CONFIG, { ENABLE_PASSIVE_COOLDOWN: 0, ENABLE_OLD_ITEM_COOLDOWNS: basic });
    const target = env.add(basic ? env.abilities : env.gameplay, basic ? "hud_passive_items" : "QOLItemMirrorRoot");
    const row = basic ? target : env.add(target, "QOLItemMirrorRow");
    env.add(row, "RetainedCooldownIcon", [basic ? "ability_container" : "QOLItemMirrorIcon"]);
    assert.equal(g.QOL.ui.customize.start(), true);
    const frame = env.find("QOLCustomizeFrame_cooldowns");
    assert.equal(frame.visible, false, "a surviving panel is not an enabled feature");
    assert.equal(env.find("QOLCustomizeSelect_cooldowns").visible, false);
    env.find("QOLCustomizeAllElements")._fire("onactivate");
    const entry = env.find("QOLCustomizeSelect_cooldowns");
    assert.equal(entry.visible, true);
    assert.equal(entry.BHasClass("Unavailable"), true);
    entry._fire("onactivate");
    assert.equal(!!env.find("QOLCustomizeRecover"), false);
    assert.equal(env.find("QOLCustomizeResize_cooldownsTopLeft").visible, false);
    const event = {}; startDrag.begin(env, frame, event);
    assert.equal(event.displayPanel, undefined);
    const toggle = env.find("QOLCustomize_ENABLE_PASSIVE_COOLDOWN");
    toggle._fire("onactivate");
    assert.equal(frame.visible, true, "draft enable makes existing content available");
    assert.equal(entry.BHasClass("Unavailable"), false);
    toggle._fire("onactivate");
    assert.equal(frame.visible, false);
    assert.equal(entry.visible, true, "a selected disabled feature stays reachable");
    assert.equal(target.IsValid(), true);
    env.find("QOLCustomizeCancel")._fire("onactivate");
    assert.equal(g.MOD_CONFIG.ENABLE_PASSIVE_COOLDOWN, 0);
    assert.deepEqual(env.clock.errors, []); assert.deepEqual(env.doc.eventErrors, []);
});

test("explicit visibility metadata gates retained panels independently of its caption, including inverted Hide", () => {
    const env = setup(), C = env.global.QOL.presentation;
    const config = env.global.QOL.buildDefaultConfig();
    for (const element of C.elements) {
        const field = element.fields.find(field => field.visibility);
        if (!field) continue;
        assert.equal(typeof element.available, "function", element.id);
        assert.equal(element.available(env.hud.root, { ...config, [field.key]: field.inverted ? 1 : 0 }), false, element.id);
    }
    const cooldowns = C.elements.find(element => element.id === "cooldowns");
    const visibility = cooldowns.fields.find(field => field.visibility);
    visibility.label = "Basic Mode";
    assert.equal(cooldowns.available(env.hud.root, { ...config, ENABLE_PASSIVE_COOLDOWN: 0 }), false);
    const report = C.elements.find(element => element.id === "damageReport");
    assert.equal(report.available(env.hud.root, { ...config, DISABLE_DAMAGE_REPORT: 0 }), true);
    for (const [id, key] of [["ammoCurrent", "ENABLE_HIDE_AMMO_ALL"], ["ammoMax", "ENABLE_HIDE_MAGAZINE"]]) {
        const element = C.elements.find(element => element.id === id);
        assert.equal(element.available(env.hud.root, { ...config, [key]: 1 }), false, id);
        assert.equal(element.available(env.hud.root, { ...config, [key]: 0 }), true, id);
    }
    assert.deepEqual(env.clock.errors, []);
});

test("HUD keeps feature Customize actions while AP and Active Items remain only in the full catalog", () => {
    const env = setup(), Q = env.global.QOL;
    Q.ui.window.setActiveTabAndRefresh("HUD"); env.clock.advance(300);
    for (const id of ["abilityPoints", "activeItems"]) assert.equal(!!env.find("QOLCustomizeEntry_" + id), false, id);
    for (const id of ["topBar", "bottomBar", "items", "souls", "chat", "damageReport"])
        assert.ok(env.find("QOLCustomizeEntry_" + id), id);
    Q.ui.customize.start();
    for (const id of ["abilityPoints", "activeItems"]) assert.ok(env.find("QOLCustomizeSelect_" + id), id);
    env.find("QOLCustomizeCancel")._fire("onactivate");
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("preset to Default hides disabled retained surfaces on each Customize opening", () => {
    const env = setup(), Q = env.global.QOL;
    for (const id of ["compass", "unsecuredTimer"]) {
        let parent = env.hud.root;
        for (const segment of Q.presentation.elements.find(element => element.id === id).path) {
            const child = typeof segment === "string" ? parent.FindChild(segment) : parent.Children().find(panel => panel.BHasClass(segment.className));
            parent = child || env.add(parent, typeof segment === "string" ? segment : "", typeof segment === "string" ? [] : [segment.className]);
        }
    }
    Q.ui.presets.applyPresetConfig({ ENABLE_COMPASS: 1, ENABLE_UNSECURED_SOUL_TIMER: 1 });
    assert.equal(Q.ui.customize.start(), true);
    assert.equal(env.find("QOLCustomizeSelect_unsecuredTimer").visible, true);
    env.find("QOLCustomizeCancel")._fire("onactivate");
    env.clock.advance(300);
    Q.ui.presets.applyPresetByName("Default");
    assert.equal(Q.ui.customize.start(), true);
    for (const id of ["compass", "unsecuredTimer"]) assert.equal(env.find("QOLCustomizeSelect_" + id).visible, false, id);
    env.find("QOLCustomizeAllElements")._fire("onactivate");
    assert.equal(env.find("QOLCustomizeSelect_unsecuredTimer").visible, true, "explicit recovery remains available");
    env.find("QOLCustomizeCancel")._fire("onactivate");
    assert.deepEqual(env.clock.errors, []); assert.deepEqual(env.doc.eventErrors, []);
});
