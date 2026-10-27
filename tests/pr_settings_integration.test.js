"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

test("new native-default features round-trip changed settings through both realms and production buckets", () => {
    const e = load(), g = e.global, Q = e.hud.sandbox.global.QOL;
    const changes = { AMMO_CURRENT_FONT_STYLE: 2, AMMO_TOTAL_FONT_STYLE: 3, ENABLE_BETTER_DISABLED_ABILITIES: 1,
        ENABLE_CUSTOM_HITMARKER: 1, CUSTOM_HITMARKER_SIZE: 31, CUSTOM_HITMARKER_CRIT_SIZE: 12,
        CUSTOM_HITMARKER_THICKNESS: 5, CUSTOM_HITMARKER_OFFSET: 17, CUSTOM_HITMARKER_COLOR: 0x1112233,
        CUSTOM_HITMARKER_CRIT_COLOR: 0x1000000, ENABLE_CUSTOM_HITMARKER_SHADOW: 1, ENABLE_CUSTOM_HITMARKER_HIDE_GLOW: 1 };
    const code = g.QOL.ui.configTab.getCurrentExportSettingsString({ ...g.MOD_CONFIG, ...changes });
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(code);
    assert.equal(imported.ok, true);
    Q.core.ConfigAdapter.loadFromFlat(imported.candidateConfig);
    const raw = g.QOL.persistence.fromBase64Url(code.split(":")[1]);
    const decoded = Q.core.codec.deserializeSettings(raw);
    for (const [key, value] of Object.entries(changes)) {
        assert.equal(imported.candidateConfig[key], value, key);
        assert.equal(decoded[key], value, key);
        const owner = key.startsWith("AMMO_") ? "ql_ammo" : key === "ENABLE_BETTER_DISABLED_ABILITIES" ? "ql_disabled_abilities" : "ql_hit_marker";
        assert.equal(Q.core.ConfigStore.get(owner, key), key.startsWith("ENABLE_") ? !!value : value, owner + "/" + key);
    }
    assert.equal(Q.core.ConfigStore.set("ql_ammo", "AMMO_CURRENT_FONT_STYLE", 3), false);
    assert.equal(Q.core.ConfigStore.get("ql_ammo", "AMMO_CURRENT_FONT_STYLE"), 2);
    assert.deepEqual(e.clock.errors, []);
});

test("new controls render English, Russian and missing-locale fallback in the actual tabs", () => {
    const e = load(), g = e.global;
    g.QOL.ui.window.setOpen(true); e.clock.advance(500);
    const texts = panel => [typeof panel.text === "string" ? panel.text : "", ...panel.Children().flatMap(texts)];
    for (const [language, current, marker, disabled] of [
        [0, "Current Font", "Custom Hit Marker", "Better Silenced/Cursed Abilities"],
        [1, "Шрифт текущих патронов", "Настраиваемый маркер попадания", "Улучшенные иконки при безмолвии/проклятии"],
        [5, "Current Font", "Custom Hit Marker", "Better Silenced/Cursed Abilities"]
    ]) {
        g.MOD_CONFIG.LANGUAGE = language;
        g.QOL.ui.window.setActiveTabAndRefresh("Crosshair"); e.clock.advance(300);
        assert.ok(texts(e.list).includes(current), current); assert.ok(texts(e.list).includes(marker), marker);
        g.QOL.ui.window.setActiveTabAndRefresh("HUD"); e.clock.advance(300);
        assert.ok(texts(e.list).includes(disabled), disabled);
    }
    assert.deepEqual(e.doc.eventErrors, []); assert.deepEqual(e.clock.errors, []);
});

test("hit marker inspector applies and cancels shape edits without changing native defaults", () => {
    const e = load(), g = e.global;
    g.QOL.ui.window.setOpen(true); e.clock.advance(500);
    const start = () => { assert.equal(g.QOL.ui.customize.start(null, { elementId: "hitMarker" }), true); };
    const input = value => {
        const entry = e.em.FindChildTraverse("QOLCustomize_CUSTOM_HITMARKER_SIZE");
        assert.ok(entry); entry.text = String(value); entry._fire("oninputsubmit"); e.clock.advance(600);
    };
    start(); input(31); e.em.FindChildTraverse("QOLCustomizeCancel")._fire("onactivate"); e.clock.advance(600);
    assert.equal(g.MOD_CONFIG.CUSTOM_HITMARKER_SIZE, 20);
    start(); input(33); g.QOL.core.storageBridge.saveSettings = (_cfg, callback) => callback(null);
    e.em.FindChildTraverse("QOLCustomizeApply")._fire("onactivate"); e.clock.advance(1000);
    assert.equal(g.MOD_CONFIG.CUSTOM_HITMARKER_SIZE, 33);
    assert.equal(g.MOD_CONFIG.CUSTOM_HITMARKER_CRIT_SIZE, 20);
    assert.equal(g.MOD_CONFIG.ENABLE_CUSTOM_HITMARKER, 0);
    assert.deepEqual(e.doc.eventErrors, []); assert.deepEqual(e.clock.errors, []);
});

test("Player Stats and Stats List controls remain in Customize without duplicate HUD or UI sections", () => {
    const e = load(), g = e.global;
    g.MOD_CONFIG.LANGUAGE = 0;
    g.QOL.ui.window.setOpen(true); e.clock.advance(500);
    for (const tab of ["HUD", "UI"]) {
        g.QOL.ui.window.setActiveTabAndRefresh(tab); e.clock.advance(300);
        const titles = e.list.FindChildrenWithClassTraverse("SectionTitle").map(panel => panel.text);
        assert.equal(titles.includes("Player Stats"), false, tab);
        assert.equal(titles.includes("Stats List"), false, tab);
        for (const key of ["STATS_POSITION_HIDE_NORMAL", "STATS_POSITION_HIDE_SCOREBOARD"]) {
            assert.equal(e.list.FindChildrenWithClassTraverse("SettingRow_" + key).length, 0, tab + "/" + key);
        }
    }
    assert.equal(g.QOL.ui.customize.start(), true);
    e.em.FindChildTraverse("QOLCustomizeAllElements")._fire("onactivate");
    for (const [id, keys] of [["playerStats", ["STATS_POSITION_HIDE_NORMAL", "STATS_POSITION_HIDE_SCOREBOARD"]],
        ["statsList", ["STATS_LIST_SCALE", "STATS_LIST_OPACITY"]]]) {
        const selection = e.em.FindChildTraverse("QOLCustomizeSelect_" + id);
        assert.ok(selection, id); selection._fire("onactivate");
        for (const key of keys) assert.ok(e.em.FindChildTraverse("QOLCustomize_" + key), id + "/" + key);
    }
    e.em.FindChildTraverse("QOLCustomizeCancel")._fire("onactivate"); e.clock.advance(500);
    assert.deepEqual(e.doc.eventErrors, []); assert.deepEqual(e.clock.errors, []);
});
