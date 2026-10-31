"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const loadSettings = require("./load_settings_environment");

test("preset preview preserves the same UI preferences as Confirm without changing pure preset resolution", () => {
    const e = loadSettings(), g = e.global, Q = g.QOL;
    e.hud.sandbox.global.QOL.core.App.shutdown();
    const keys = ["DRAG_ENABLED", "AUTO_SAVE_CHANGES", "ENABLE_UPDATE_CHECKER"];
    for (const name of ["Default", "Clean", "Maximum", "Bread"]) {
        for (const key of keys) g.MOD_CONFIG[key] = 0;
        g.SaveAndSync();
        const before = JSON.stringify(g.MOD_CONFIG);
        const candidate = g.BuildPresetCandidateConfigByName(name);
        assert.equal(JSON.stringify(g.MOD_CONFIG), before, "building a preview has no live side effects");
        const uiChanges = g.BuildConfigDiffRows(g.MOD_CONFIG, candidate).filter(row => keys.includes(row.key));
        assert.equal(uiChanges.length, 0, `${name} preview must not promise UI changes that Apply preserves`);
        assert.equal(g.ApplyPresetByName(name), true);
        for (const key of keys) assert.equal(g.MOD_CONFIG[key], candidate[key], `${name}.${key}`);
    }
    const pure = Q.ui.presets.resolvePresetConfigByName("Default");
    for (const key of keys) assert.equal(pure[key], g.DEFAULT_CONFIG[key], "pure matching data is independent of live UI preferences");
    assert.deepEqual(e.clock.errors, []);
});

test("the actual preset confirmation shows and applies matching preserved preferences", () => {
    const e = loadSettings(), g = e.global, Q = g.QOL;
    e.hud.sandbox.global.QOL.core.App.shutdown();
    const keys = ["DRAG_ENABLED", "AUTO_SAVE_CHANGES", "ENABLE_UPDATE_CHECKER"];
    for (const key of keys) g.MOD_CONFIG[key] = 0;
    let preview;
    g.OpenConfigDiffPreviewModal = options => { preview = options; };
    Q.ui.presets.createPresetGrid(e.list, "Presets", [{ label: "Default", preset: "Default" }], 1, "base");
    e.list.FindChildrenWithClassTraverse("PresetGridBtn")[0].activate();
    assert.ok(preview);
    assert.equal(preview.rows.filter(row => keys.includes(row.key)).length, 0);
    assert.equal(preview.onApply(), true);
    for (const key of keys) assert.equal(g.MOD_CONFIG[key], 0);
    assert.deepEqual(e.clock.errors, []);
});