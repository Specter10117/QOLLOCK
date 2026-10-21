"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const { createHud } = require("../scripts/simulator");

test("production HUD exposes a JSON writer and only a legacy compact reader", () => {
    const hud = createHud(); hud.assertLoaded();
    const g = hud.sandbox.global;
    assert.equal(typeof g.QOL_CODEC.SerializeCompactBinary, "undefined");
    assert.equal(typeof g.QOL_CODEC.RequiresSettingsEnvelope, "undefined");
    assert.equal(typeof g.QOL.core.codec.serializeBuildPayloadCompact, "undefined");
    assert.equal(typeof g.QOL_CODEC.DeserializeLegacySettings, "function");
    const raw = g.QOL.core.codec.serializeSettings(g.QOL_DEFAULT_CONFIG);
    assert.equal(JSON.parse(raw).schema, "4.0.5");
    assert.equal(Object.keys(JSON.parse(raw).data).length, Object.keys(g.QOL_DEFAULT_CONFIG).length);
});

test("JSON exports preserve Unicode, full snapshots and complete long-code UI/clipboard content", () => {
    const env = load(); const g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    Object.assign(g.MOD_CONFIG, { ACTIVE_PRESET_NAME: "Тест 🐈 日本語", SOULS_X_OFFSET: 123 });
    const code = g.QOL.ui.configTab.getCurrentExportSettingsString();
    assert.ok(code.length > 10000);
    const payload = g.QOL.persistence.fromBase64Url(code.split(":")[1]);
    const parsed = g.QOL.persistence.deserializeSettings(payload, "4.0.5");
    assert.equal(parsed.ACTIVE_PRESET_NAME, "Тест 🐈 日本語");
    assert.equal(parsed.SOULS_X_OFFSET, 123);
    assert.deepEqual(JSON.parse(env.hud.sandbox.global.QOL.core.codec.serializeSettings(g.MOD_CONFIG)).data,
        JSON.parse(payload).data);
    g.QOL.ui.configTab.render(env.list);
    const output = env.em.FindChildTraverse("ConfigExportTextEntry");
    assert.equal(output.text.replace(/\s/g, ""), code);
    assert.ok(output.maxchars >= output.text.length);
    const input = env.em.FindChildTraverse("ConfigImportTextEntry");
    assert.ok(input.maxchars >= code.length);
    let copied = ""; const original = g.$.DispatchEvent;
    g.$.DispatchEvent = (name, ...args) => {
        if (name === "CopyStringToClipboard") copied = args[0];
        return original(name, ...args);
    };
    assert.equal(g.QOL.ui.configTab.tryCopyTextToClipboard(code, output), true);
    assert.equal(copied, code);
    assert.equal(g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(code).ok, true);
});

test("current settings fields have no mutable dependency on legacy tables", () => {
    const { global: g } = load();
    const current = g.QOL.settingsFields.find(field => field.key === "PLAYER_HEALTHBAR_X_OFFSET");
    const old = g.QOL.legacyCompact.registry["4.0.5"].schema.find(field => field.key === current.key);
    const before = current.max; old.max = 7;
    assert.equal(current.max, before);
    assert.equal(g.QOL.persistence.serializeSettings(g.MOD_CONFIG).charAt(0), "{");
});

test("current sharing, migrations and import diagnostics do not read historical binary metadata", () => {
    const { global: g, hud } = load();
    for (const realm of [g, hud.sandbox.global]) {
        realm.QOL_COMPACT_SCHEMA_UTILS.GetSchema = () => { throw new Error("legacy schema accessed by current JSON"); };
        realm.QOL_CODEC.DeserializeLegacySettings = () => { throw new Error("legacy decoder accessed by current JSON"); };
    }
    const cfg = { ...g.MOD_CONFIG, TOP_BAR_SCALE: 2.73, PLAYER_HEALTHBAR_X_OFFSET: 8000, SOULS_OPACITY: .73 };
    const raw = g.QOL.persistence.serializeSettings(cfg);
    assert.equal(hud.sandbox.global.QOL.core.codec.deserializeSettings(raw).TOP_BAR_SCALE, 2.73);
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString(cfg));
    assert.equal(imported.ok, true); assert.equal(imported.source, "json");
    g.QOL.persistence.applyParsedConfigWithDiagnostics(imported.parsedConfig, imported.schemaVersion);
    assert.equal(g.MOD_CONFIG.TOP_BAR_SCALE, 2.73); assert.equal(g.MOD_CONFIG.PLAYER_HEALTHBAR_X_OFFSET, 8000);
    assert.equal(g.MOD_CONFIG.SOULS_OPACITY, .73);
});
