"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = require("./load_settings_environment");

function setup() {
    const env = load();
    env.global.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const element = env.global.QOL.presentation.elements.find(item => item.id === "souls");
    let panel = env.hud.root;
    for (const segment of element.path) {
        const next = env.doc.create("Panel", typeof segment === "string" ? { id: segment } : { classes: [segment.className] });
        panel.addChild(next); panel = next;
    }
    Object.assign(panel, { actuallayoutwidth: 400, actuallayoutheight: 80 });
    env.global.SaveAndSync(); env.clock.advance(1000);
    return { ...env, souls: panel, find: id => env.em.FindChildTraverse(id) };
}

test("catalog starts with available surfaces and All elements restores hidden selections", () => {
    const env = setup();
    const { global: g, clock, find, souls } = env;
    assert.equal(g.QOL.ui.customize.start(), true);
    assert.equal(find("QOLCustomizeSelect_souls").visible, true);
    assert.equal(find("QOLCustomizeSelect_compass").visible, false);
    for (const id of ["profileScreens", "mainMenu", "healthWarnings", "targetShapes", "nicknames"]) {
        assert.equal(find("QOLCustomizeSelect_" + id), null, id);
    }
    find("QOLCustomizeAllElements")._fire("onactivate");
    assert.equal(find("QOLCustomizeSelect_compass").visible, true);
    const toggle = find("QOLCustomize_HUD_SOULS_ENABLED");
    toggle._fire("onactivate"); clock.advance(1200);
    assert.equal(toggle.BHasClass("ToggleOff"), true);
    assert.equal(toggle.BHasClass("ToggleOn"), false);
    assert.equal(souls.BHasClass("qol-hidden"), true);
    assert.equal(find("QOLCustomizeSelect_souls").visible, true, "selected hidden panel remains reachable");
    assert.equal(g.MOD_CONFIG.HUD_SOULS_ENABLED, 1, "live preview does not save");
    toggle._fire("onactivate"); clock.advance(1200);
    assert.equal(toggle.BHasClass("ToggleOn"), true);
    assert.equal(toggle.BHasClass("ToggleOff"), false);
    assert.equal(souls.BHasClass("qol-hidden"), false);
    find("QOLCustomizeCancel")._fire("onactivate"); clock.advance(500);
    assert.equal(env.hud.root.BHasClass("QOLCustomizeActive"), false);
    assert.deepEqual(env.doc.eventErrors, []);
    assert.deepEqual(clock.errors, []);
});

test("Ammo controls distinguish current and total numbers from the magazine indicator", () => {
    const env = setup();
    const { global: g, find } = env;
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammo" }), true);
    const visibility = find("QOLCustomize_ENABLE_HIDE_AMMO_ALL");
    assert.notEqual(visibility.GetParent().id, "QOLCustomizeSelectionHeader");
    assert.equal(visibility.BHasClass("ToggleOff"), true);
    const indicator = find("QOLCustomize_ENABLE_AMMO_STATUS");
    assert.notEqual(indicator.GetParent().id, "QOLCustomizeSelectionHeader");
    visibility._fire("onactivate"); env.clock.advance(1200);
    assert.equal(visibility.BHasClass("ToggleOn"), true);
    assert.equal(env.hud.root.BHasClass("hide_current_ammo_active"), true);
    assert.equal(env.hud.root.BHasClass("hide_magazine_active"), false);
    find("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.equal(env.hud.root.BHasClass("hide_current_ammo_active"), false);
    assert.deepEqual(env.doc.eventErrors, []);
    assert.deepEqual(env.clock.errors, []);
});

test("Customize hides the captured friends container with a leased HUD-scoped CSS rule", () => {
    const css = fs.readFileSync(path.join(__dirname, "../panorama/styles/qollock_global.css"), "utf8");
    assert.match(css, /#Hud\.QOLCustomizeLiveHud #CitadelPartyContainer\s*\{\s*visibility:\s*collapse;/);
});

test("Cancel discards both accepted live typing and pending callbacks without saving placement", () => {
    for (const accepted of [false, true]) {
        const env = setup();
        const { global: g, clock, find, souls } = env;
        const baseline = JSON.stringify(g.MOD_CONFIG);
        assert.equal(g.QOL.ui.customize.start(), true);
        const input = find("QOLCustomize_SOULS_X_OFFSET");
        input.text = "300"; input._fire("ontextentrychange");
        if (accepted) {
            clock.advance(1200);
            assert.equal(souls.style.x, "300px");
        }
        find("QOLCustomizeCancel")._fire("onactivate");
        clock.advance(1500);
        assert.equal(JSON.stringify(g.MOD_CONFIG), baseline);
        assert.equal(parseFloat(souls.style.x) || 0, 0);
        assert.equal(g.QOL.ui.customize.isRunning(), false);
        assert.deepEqual(env.doc.eventErrors, []);
        assert.deepEqual(clock.errors, []);
    }
});

for (const opacity of [0, 1]) test(`Souls remain recoverable from the full catalog at opacity ${opacity}`, () => {
    const env = setup(), { global: g, find, clock, souls } = env;
    Object.assign(g.MOD_CONFIG, { SOULS_OPACITY: opacity, SOULS_X_OFFSET: 5000 });
    g.SaveAndSync(); clock.advance(1200);
    if (!opacity) souls.visible = false; // Native layout supplies no measurable visible content.
    g.QOL.ui.customize.start();
    find("QOLCustomizeAllElements")._fire("onactivate");
    const row = find("QOLCustomizeSelect_souls");
    assert.equal(row.visible, true);
    row._fire("onactivate");
    find("QOLCustomizeReset")._fire("onactivate"); clock.advance(1200);
    assert.equal(find("QOLCustomize_SOULS_OPACITY").text, "100");
    assert.equal(find("QOLCustomize_SOULS_X_OFFSET").text, "0");
    find("QOLCustomizeCancel")._fire("onactivate"); clock.advance(1200);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(clock.errors, []);
});

test("Customize inspectors do not render panel descriptions", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "ammoMax" });
    assert.equal(env.find("QOLCustomizeDetails"), null);
    env.find("QOLCustomizeCancel")._fire("onactivate");
});
