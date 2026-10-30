"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

test("world damage typography and Fountain size stay independent in Crosshair and sharing", () => {
    const env = load();
    const { global: g, clock, hud } = env;
    g.QOL.ui.window.setOpen(true); clock.advance(500);
    g.QOL.ui.window.setActiveTabAndRefresh("Crosshair"); clock.advance(300);
    assert.ok(!env.em.FindChildTraverse("QOLCustomizeEntry_damageNumbers"), "world indicators must not open the HUD canvas");
    for (const [key, typed, expected] of [["HUD_INDICATOR_SIZE", "32", 32], ["DAMAGE_NUMBER_OPACITY", "43", 0.43],
        ["DAMAGE_FOUNTAIN_SIZE", "250", 2.5]]) {
        const row = env.list.FindChildrenWithClassTraverse("SettingRow_" + key)[0];
        assert.ok(row, key + " must remain accessible beside damage modes");
        const input = row.FindChildrenWithClassTraverse("ValueInput")[0];
        input.text = typed; input._fire("oninputsubmit"); clock.advance(1200);
        assert.equal(g.MOD_CONFIG[key], expected);
        assert.equal(hud.sandbox.global.QOL.core.ConfigStore.get("ql_damage_numbers", key), expected);
        const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString());
        assert.equal(imported.ok, true);
        assert.equal(imported.candidateConfig[key], expected);
        assert.equal(g.MOD_CONFIG.HUD_INDICATOR_SIZE, 32);
        assert.equal(imported.candidateConfig.HUD_INDICATOR_SIZE, 32);
    }
    assert.equal(g.QOL.ui.customize.isRunning(), false);
    assert.deepEqual(env.doc.eventErrors, []);
    assert.deepEqual(clock.errors, []);
});
