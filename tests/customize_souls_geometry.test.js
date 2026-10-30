"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

for (const currentVisible of [false, true]) test(`Souls frame includes level and all currency content when CurrentGoldAmount is ${currentVisible ? "shown" : "hidden"}`, () => {
    const env = load(), Q = env.global.QOL;
    Q.ui.window.setOpen(true); env.clock.advance(500);
    const add = (parent, id, width, height, x = 0, y = 0, classes = []) => {
        const panel = parent.addChild(env.doc.create("Panel", { id, classes }));
        Object.assign(panel, { actuallayoutwidth: width, actuallayoutheight: height, actualxoffset: x, actualyoffset: y });
        return panel;
    };
    // Current native capture: the 400px owner includes level and gold content;
    // CurrentGoldAmount is one conditional row, not the complete scaled group.
    const core = add(env.hud.root, "", 1920, 1080, 0, 0, ["HudCore"]);
    const left = add(add(core, "StatsAndModsContainer", 1920, 1080), "LowerLeft", 420, 1080);
    const owner = add(left, "gold_and_ap_container", 400, 85, 20, 855);
    const level = add(owner, "PlayerLevelContainer", 83, 85);
    const gold = add(owner, "hudGoldContainer", 140, 59, 68, 18);
    const current = add(gold, "CurrentGoldAmount", currentVisible ? 90 : 0, currentVisible ? 36 : 0);
    current.visible = currentVisible;
    Q.ui.customize.start(null, { elementId: "souls" });
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_souls");
    assert.equal(frame.visible, true);
    assert.equal(frame.style.width, "208px", "frame includes both content groups without the owner's empty reserve");
    assert.equal(frame.style.height, "85px");
    const input = env.em.FindChildTraverse("QOLCustomize_SOULS_SCALE");
    input.text = "150"; input._fire("oninputsubmit"); env.clock.advance(1200);
    assert.equal(owner.style.uiScale, "150%", "overall scale remains on the production owner");
    assert.equal(level.style.uiScale, undefined); assert.equal(gold.style.uiScale, undefined);
    // The native renderer reports the scaled content geometry independently of
    // the fixed-width placement owner; the simulator itself does no CSS layout.
    Object.assign(level, { actuallayoutwidth: 124.5, actuallayoutheight: 127.5 });
    Object.assign(gold, { actuallayoutwidth: 210, actuallayoutheight: 88.5, actualxoffset: 102, actualyoffset: 27 });
    env.clock.advance(300);
    assert.equal(frame.style.width, "312px"); assert.equal(frame.style.height, "128px");
    env.em.FindChildTraverse("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.equal(owner.style.uiScale, undefined);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});
