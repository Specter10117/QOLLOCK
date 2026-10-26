"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

test("every scoped surface resets presentation, preserves switches and hidden options, and supports Undo/Redo", () => {
    const env = load(), g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const window = env.em.FindChildTraverse("SettingsWindow");
    const catalog = g.QOL.presentation;
    for (const element of catalog.elements) {
        const session = g.QOL.ui.customizeSession.create(env.doc.root, env.hud.root, window, element);
        const patch = {};
        for (const field of element.fields) {
            const wire = catalog.settingFields.get(field.key);
            patch[field.key] = field.type === "color" || field.type === "palette" ? g.QOL_UTILS.EncodeHexColor("#123456")
                : Number(session.value(field.key)) === wire.max ? wire.min : wire.max;
        }
        assert.equal(session.edit(patch), true, element.id);
        const before = JSON.stringify(session.snapshot());
        const hidden = element.fields.filter(field => field.type === "toggle" || (field.hidden && field.key !== "AMMO_PANEL_SCALE" && element.id !== "ammo"))
            .map(field => [field.key, session.value(field.key)]);
        assert.equal(session.reset(element), true, element.id);
        for (const field of element.fields.filter(field => field.type !== "toggle" && (!field.hidden || (element.id === "ammo" && field.key !== "AMMO_PANEL_SCALE"))))
            assert.equal(session.value(field.key), g.QOL_DEFAULT_CONFIG[field.key], `${element.id}/${field.key}`);
        for (const [key, value] of hidden) assert.equal(session.value(key), value, `preserve ${element.id}/${key}`);
        const reset = JSON.stringify(session.snapshot());
        if (reset !== before) {
            assert.equal(session.undo(), true, element.id);
            assert.equal(JSON.stringify(session.snapshot()), before, element.id);
            assert.equal(session.redo(), true, element.id);
            assert.equal(JSON.stringify(session.snapshot()), reset, element.id);
        }
        session.close();
    }
    assert.deepEqual(env.clock.errors, []);
    assert.deepEqual(env.doc.eventErrors, []);
});

test("Healthbar Reset preserves its selected type and health-number setting through Save and export", () => {
    const env = load(), g = env.global;
    Object.assign(g.MOD_CONFIG, { HEALTHBAR_TYPE: 5, ENABLE_MINECRAFT_HEALTH_NUMBERS: 1, PLAYER_HEALTHBAR_SCALE: 1.5 });
    g.SaveAndSync(); env.clock.advance(1200);
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "healthbar" }), true);
    assert.equal(env.em.FindChildTraverse("QOLCustomize_HEALTHBAR_TYPE_0"), null);
    assert.equal(env.em.FindChildTraverse("QOLCustomize_ENABLE_MINECRAFT_HEALTH_NUMBERS"), null);
    env.em.FindChildTraverse("QOLCustomizeReset")._fire("onactivate");
    g.QOL.core.storageBridge.saveSettings = (_config, callback) => callback(null);
    env.em.FindChildTraverse("QOLCustomizeApply")._fire("onactivate"); env.clock.advance(1200);
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString());
    assert.equal(imported.ok, true);
    for (const config of [g.MOD_CONFIG, imported.candidateConfig]) {
        assert.equal(config.HEALTHBAR_TYPE, 5);
        assert.equal(config.ENABLE_MINECRAFT_HEALTH_NUMBERS, 1);
        assert.equal(config.PLAYER_HEALTHBAR_SCALE, g.QOL_DEFAULT_CONFIG.PLAYER_HEALTHBAR_SCALE);
    }
    assert.deepEqual(env.clock.errors, []);
    assert.deepEqual(env.doc.eventErrors, []);
});
