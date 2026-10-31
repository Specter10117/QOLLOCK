"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

for (const basic of [true, false]) test(`${basic ? "Basic" : "Advanced"} cooldown frame follows visible icons instead of the placement wrapper`, () => {
    const env = load(), Q = env.global.QOL;
    const add = (parent, id, classes = [], width = 0, height = 0, x = 0, y = 0) => {
        const panel = parent.addChild(env.doc.create("Panel", { id, classes }));
        Object.assign(panel, { actuallayoutwidth: width, actuallayoutheight: height, actualxoffset: x, actualyoffset: y });
        return panel;
    };
    const core = add(env.hud.root, "", ["HudCore"]);
    const parent = add(core, basic ? "AbilitiesContainer" : "gameplay_hud", [], 1920, 1080);
    const target = add(parent, basic ? "hud_passive_items" : "QOLItemMirrorRoot", [], 780, 78, 180, 20);
    const row = add(target, basic ? "abilities" : "QOLItemMirrorRow", [], 200, 60, 100, 5);
    const cls = basic ? "ability_container" : "QOLItemMirrorIcon";
    const first = add(row, "FirstIcon", [cls], 45, 45, 5, 2);
    add(row, "SecondIcon", [cls], 45, 45, 62, 2);
    const hidden = add(row, "RetainedHiddenIcon", [cls], 45, 45, 700, 2); hidden.style.visibility = "collapse";
    const host = add(env.em, "MeasuredCanvas", [], 1920, 1080);
    const element = Q.presentation.elements.find(item => item.id === "cooldowns");
    assert.equal(Q.presentation.resolve(element, env.hud.root, { ENABLE_OLD_ITEM_COOLDOWNS: basic ? 1 : 0 }), target);
    const bounds = () => JSON.parse(JSON.stringify(Q.ui.customizeGeometry.frameBox(element, target, host)));
    assert.deepEqual(bounds(), { x: 285, y: 27, width: 102, height: 45 });
    target.actualxoffset += 192; target.actualyoffset += 108;
    assert.deepEqual(bounds(), { x: 477, y: 135, width: 102, height: 45 });
    first.SetParent(parent);
    assert.deepEqual(bounds(), { x: 534, y: 135, width: 45, height: 45 }, "living retired icon does not enlarge the new frame");
    if (basic) {
        row.style.visibility = "collapse";
        const sample = add(target, "QOLCustomizeBasicCooldownSample", ["QOLCustomizeSample"], 45, 45, 300, 4);
        assert.deepEqual(bounds(), { x: 672, y: 132, width: 45, height: 45 });
        sample.DeleteAsync(0); env.clock.advance(0);
    }
    row.style.visibility = "collapse";
    assert.equal(Q.ui.customizeGeometry.frameBox(element, target, host), null, "an empty placement canvas is not a drag surface");
    assert.deepEqual(env.clock.errors, []);
});
