"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const click = (env, id) => { const panel = env.em.FindChildTraverse(id); assert.ok(panel, id); panel._fire("onactivate"); };

test("all position settings preserve distant coordinates through JSON, import and current metadata", () => {
    const { global: g } = load(); const cfg = { ...g.MOD_CONFIG };
    const positions = g.QOL.settingsFields.filter(field => field.role === "position");
    for (const field of positions) {
        const origin = field.displayTransform === "nativeOriginUp" ? g.QOL_DEFAULT_CONFIG[field.key] : 0;
        assert.equal(field.min, origin - g.QOL.settingLimits.coordinate, field.key);
        assert.equal(field.max, origin + g.QOL.settingLimits.coordinate, field.key);
        cfg[field.key] = origin + 12345;
    }
    const code = g.QOL.ui.configTab.getCurrentExportSettingsString(cfg);
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(code);
    assert.equal(imported.ok, true);
    for (const field of positions) assert.equal(imported.candidateConfig[field.key], cfg[field.key], field.key);
    const hp = g.QOL.presentation.elements.find(e => e.id === "healthbar");
    assert.ok(hp.fields.some(f => f.axis === "x"));
});

test("position slider intervals use actual viewport and parent units for pixels and percentages", () => {
    const env = load(); const Q = env.global.QOL, G = Q.ui.customizeGeometry;
    const host = env.doc.create("Panel", { id: "MeasuredCanvas" });
    Object.assign(host, { actuallayoutwidth: 3840, actuallayoutheight: 2160, actualuiscale_x: 2, actualuiscale_y: 2 });
    const parent = env.doc.create("Panel", { id: "MeasuredOwnerParent" });
    Object.assign(parent, { actuallayoutwidth: 4000, actuallayoutheight: 1000, actualuiscale_x: 4, actualuiscale_y: 4 });
    const target = parent.addChild(env.doc.create("Panel", { id: "MeasuredOwner" }));
    const values = { SOULS_X_OFFSET: 0, SOULS_Y_OFFSET: 0, PASSIVE_COOLDOWN_X: 0, PASSIVE_COOLDOWN_Y: 0 };
    const observation = { host, target, values, bounds: { x: 100, y: 50, width: 200, height: 100 }, view: G.viewport(host) };
    const bounds = field => JSON.parse(JSON.stringify(G.positionSliderBounds(field, observation)));
    assert.deepEqual(bounds({ key: "SOULS_X_OFFSET", axis: "x" }), { min: -50, max: 810 });
    assert.deepEqual(bounds({ key: "SOULS_Y_OFFSET", axis: "y", direction: -1 }), { min: -465, max: 25 });
    assert.deepEqual(bounds({ key: "PASSIVE_COOLDOWN_X", axis: "x", unit: "%" }), { min: -5, max: 81 });
    assert.deepEqual(bounds({ key: "PASSIVE_COOLDOWN_Y", axis: "y", unit: "%", direction: -1 }), { min: -186, max: 10 });
    host.actuallayoutwidth = 7680; observation.view = G.viewport(host);
    assert.deepEqual(bounds({ key: "SOULS_X_OFFSET", axis: "x" }), { min: -50, max: 1770 });
    parent.actuallayoutwidth = 0;
    assert.equal(G.positionSliderBounds({ key: "PASSIVE_COOLDOWN_X", axis: "x", unit: "%" }, observation), null);
});

test("range refresh never overwrites off-screen exact input or creates edits; absent measurements disable only slider", () => {
    const env = load(), g = env.global, Q = g.QOL;
    Q.ui.window.setOpen(true); env.clock.advance(500);
    const element = Q.presentation.elements.find(e => e.id === "souls");
    const session = Q.ui.customizeSession.create(env.doc.root, env.hud.root, env.em.FindChildTraverse("SettingsWindow"), element);
    const host = env.doc.create("Panel", { id: "RangeInspector" }); env.em.addChild(host);
    const parent = env.doc.create("Panel", { id: "RangeParent" });
    Object.assign(parent, { actuallayoutwidth: 1920, actuallayoutheight: 1080, actualuiscale_x: 1, actualuiscale_y: 1 });
    const target = parent.addChild(env.doc.create("Panel", { id: "RangeTarget" }));
    let geometry = { target, host, bounds: { x: 100, y: 50, width: 200, height: 100 },
        values: { SOULS_X_OFFSET: 0, SOULS_Y_OFFSET: 0 }, view: { x: 0, y: 0, width: 1920, height: 1080 } };
    const inspector = Q.ui.customizeInspector.build(host, element, session, options => inspector.sync(options), host, () => geometry);
    const input = host.FindChildTraverse("QOLCustomize_SOULS_X_OFFSET");
    const slider = host.FindChildTraverse("QOLCustomizeSlider_SOULS_X_OFFSET");
    assert.equal(slider.min, -100); assert.equal(slider.max, 1620);
    input.text = "9000"; input._fire("oninputsubmit");
    assert.equal(session.value("SOULS_X_OFFSET"), 9000); assert.equal(input.text, "9000");
    assert.equal(slider.value, 1620);
    const before = JSON.stringify(session.snapshot());
    geometry.view.width = 3840; inspector.refreshRanges();
    assert.equal(slider.max, 3540); assert.equal(input.text, "9000");
    assert.equal(JSON.stringify(session.snapshot()), before);
    geometry = null; inspector.refreshRanges();
    assert.equal(slider.enabled, false);
    input.text = "12000"; input._fire("oninputsubmit");
    assert.equal(session.value("SOULS_X_OFFSET"), 12000);
    assert.equal(session.undo(), true); assert.equal(session.value("SOULS_X_OFFSET"), 9000);
    assert.equal(session.undo(), true); assert.equal(session.value("SOULS_X_OFFSET"), 0);
    assert.equal(session.canUndo(), false);
    inspector.dispose(); session.close();
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("Reset restores offscreen coordinates to defaults and Cancel restores the saved position", () => {
    const env = load(), g = env.global, Q = g.QOL;
    Q.ui.window.setOpen(true); env.clock.advance(500);
    const element = Q.presentation.elements.find(e => e.id === "souls");
    let panel = env.hud.root;
    for (const segment of element.path) {
        let child = typeof segment === "string" ? panel.FindChild(segment) : panel.Children().find(p => p.BHasClass(segment.className));
        if (!child) child = panel.addChild(env.doc.create("Panel", { id: typeof segment === "string" ? segment : "", classes: typeof segment === "string" ? [] : [segment.className] }));
        panel = child;
    }
    Object.assign(panel, { actuallayoutwidth: 100, actuallayoutheight: 60, actualxoffset: 5000, actualyoffset: 80 });
    const leaf = panel.FindChild("CurrentGoldAmount");
    if (leaf) Object.assign(leaf, { actuallayoutwidth: 100, actuallayoutheight: 60, actualxoffset: 0, actualyoffset: 0 });
    g.MOD_CONFIG.SOULS_X_OFFSET = 5000; g.SaveAndSync(); env.clock.advance(700);
    Q.ui.customize.start(null, { elementId: "souls" });
    const overlay = env.em.FindChildTraverse("QOLCustomizeEditor");
    Object.assign(overlay, { actuallayoutwidth: 1920, actuallayoutheight: 1080, actualuiscale_x: 1, actualuiscale_y: 1 });
    env.clock.advance(300);
    assert.equal(!!env.em.FindChildTraverse("QOLCustomizeRecover"), false);
    const reset = env.em.FindChildTraverse("QOLCustomizeReset");
    assert.equal(reset.GetParent().id, "QOLCustomizeResetRow");
    click(env, "QOLCustomizeReset"); env.clock.advance(700);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(panel.style.x, undefined);
    assert.equal(env.hud.sandbox.global.State.lastConfig.SOULS_X_OFFSET, 5000, "preview leaves canonical snapshot unchanged");
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 5000);
    click(env, "QOLCustomizeCancel"); env.clock.advance(700);
    assert.equal(env.hud.sandbox.global.State.lastConfig.SOULS_X_OFFSET, 5000);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});
