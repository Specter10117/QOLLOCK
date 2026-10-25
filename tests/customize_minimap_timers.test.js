"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

for (const [id, prefix, role] of [["midBossTimer", "MINIMAP_MID_BOSS_", "Rejuv"], ["buffTimer", "MINIMAP_BUFF_", "Buff"],
    ["bridgeBuffLeft", "MINIMAP_BRIDGE_LEFT_", "BuffBridgeLeft"], ["bridgeBuffRight", "MINIMAP_BRIDGE_RIGHT_", "BuffBridgeRight"]]) {
    test(`${id} exact properties preview, cancel, save and import through its production owner`, () => {
        const e = load(), Q = e.global.QOL;
        Q.ui.window.setOpen(true); e.clock.advance(500);
        const add = (parent, id, classes = []) => parent.addChild(e.doc.create("Panel", { id, classes }));
        const core = add(e.hud.root, "", ["HudCore"]);
        const clamp = add(add(core, "gameplay_hud"), "", ["clamp_width"]);
        const viewport = add(add(clamp, "minimap_persp"), "minimap_container");
        add(add(viewport, "HudMinimapContainer"), "hud_minimap");
        Object.assign(e.global.MOD_CONFIG, { ENABLE_MINIMAP_BUFF_TIMER: 1, ENABLE_MINIMAP_REJUV_TIMER: 1,
            ENABLE_MINIMAP_BUFF_TIMER_ON_BRIDGE: 1, ENABLE_MINIMAP_ALWAYS_ON_MID_BOSS: 1 });
        e.global.SaveAndSync(); e.clock.advance(1200);
        const find = name => e.em.FindChildTraverse(name);
        const timer = viewport.FindChildTraverse("QOLMinimap" + role + "Timer"); assert.ok(timer);
        const baselineLeft = parseFloat(timer.style.marginLeft);
        const edit = (suffix, value) => { const input = find("QOLCustomize_" + prefix + suffix); assert.ok(input); input.text = String(value); input._fire("oninputsubmit"); };
        Q.ui.customize.start(null, { elementId: id });
        edit("X_OFFSET", 37); edit("Y_OFFSET", -19); edit("SCALE", 145); edit("OPACITY", 42); e.clock.advance(1200);
        assert.equal(timer.style.marginLeft, baselineLeft + 37 + "px");
        assert.equal(timer.style.marginRight, "-37px");
        assert.equal(timer.style.marginTop, "19px");
        assert.equal(timer.style.uiScale, "145%"); assert.equal(timer.style.opacity, "0.42");
        find("QOLCustomizeCancel")._fire("onactivate"); e.clock.advance(1200);
        assert.equal(timer.style.uiScale, "100%"); assert.equal(timer.style.opacity, "1");
        Q.ui.customize.start(null, { elementId: id }); edit("SCALE", 167); edit("OPACITY", 33);
        find("QOLCustomizeApply")._fire("onactivate"); e.clock.advance(1200);
        const imported = Q.ui.modal.tryApplyImportStringWithDiagnostics(Q.ui.configTab.getCurrentExportSettingsString());
        assert.equal(imported.ok, true); assert.equal(imported.candidateConfig[prefix + "SCALE"], 167);
        assert.equal(imported.candidateConfig[prefix + "OPACITY"], 0.33);
        assert.deepEqual(e.doc.eventErrors, []); assert.deepEqual(e.clock.errors, []);
    });
}
