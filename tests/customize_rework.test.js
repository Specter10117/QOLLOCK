"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const startDrag = require("./customize_drag_fixture");
const click = (env, id) => { const panel = env.em.FindChildTraverse(id); assert.ok(panel, id); panel._fire("onactivate"); };
const rect = (panel, width, height, x = 0, y = 0) => Object.assign(panel, {
    actuallayoutwidth: width, actuallayoutheight: height, actualxoffset: x, actualyoffset: y
});
function setup(id = "souls", width = 160, height = 60, x = 200, y = 100) {
    const env = load();
    env.global.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const element = env.global.QOL.presentation.elements.find(item => item.id === id);
    let panel = env.hud.root;
    for (const segment of element.path) {
        let child = typeof segment === "string" ? panel.FindChild(segment) : panel.Children().find(item => item.BHasClass(segment.className));
        if (!child) child = panel.addChild(env.doc.create("Panel", {
            id: typeof segment === "string" ? segment : "", classes: typeof segment === "string" ? [] : [segment.className]
        }));
        panel = child;
    }
    rect(panel, width, height, x, y);
    return { ...env, element, panel, find: name => env.em.FindChildTraverse(name) };
}
function clean(env) {
    click(env, "QOLCustomizeCancel"); env.clock.advance(1200);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
}
function captureWithoutMotion(env, frame) {
    const fields = env.element.fields.filter(field => field.axis || field.resize);
    const before = fields.map(field => env.find("QOLCustomize_" + field.key)?.text);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "capture is immediate while native preview layout is pending");
    assert.deepEqual(fields.map(field => env.find("QOLCustomize_" + field.key)?.text), before, "capture alone does not edit the accepted draft");
    startDrag.end(env, frame, proxy); env.clock.advance(1);
    assert.deepEqual(fields.map(field => env.find("QOLCustomize_" + field.key)?.text), before, "a motionless drop does not edit pending geometry");
    assert.equal(env.find("QOLCustomizeFields").enabled, true, "drop releases input immediately");
}

test("Reset retires incomplete or queued input even when the accepted draft is already default", () => {
    const env = setup("healthbar", 300, 456);
    env.global.QOL.ui.customize.start(); click(env, "QOLCustomizeSelect_healthbar");
    const color = env.find("QOLCustomize_PLAYER_HEALTHBAR_ACCENT_COLOR");
    color.text = "#X"; color._fire("ontextentrychange"); env.clock.advance(301);
    assert.equal(color.BHasClass("Invalid"), true);
    const opacity = env.find("QOLCustomize_PLAYER_HEALTHBAR_OPACITY");
    opacity.text = "55"; opacity._fire("ontextentrychange");
    click(env, "QOLCustomizeReset"); env.clock.advance(500);
    assert.equal(color.text, "");
    assert.equal(color.BHasClass("Invalid"), false);
    assert.equal(opacity.text, "100");
    assert.equal(env.find("QOLCustomizeUndo").enabled, false, "clearing unaccepted input invents no history entry");
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_healthbar", "PLAYER_HEALTHBAR_OPACITY"), 1);
    clean(env);
});

test("malformed Healthbar color cannot trap selection and keeps valid pending peers", () => {
    const env = setup("healthbar", 300, 456);
    env.global.QOL.ui.customize.start(); click(env, "QOLCustomizeSelect_healthbar");
    const color = env.find("QOLCustomize_PLAYER_HEALTHBAR_ACCENT_COLOR");
    color.text = "#123456"; color._fire("oninputsubmit"); env.clock.advance(500);
    color.text = "#X";
    env.find("QOLCustomize_PLAYER_HEALTHBAR_OPACITY").text = "55";
    click(env, "QOLCustomizeSelect_souls"); env.clock.advance(500);
    assert.ok(env.find("QOLCustomize_SOULS_X_OFFSET"), "incomplete HEX input cannot lock the catalog");
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(env.global.QOL_UTILS.DecodeHexColor(store.get("ql_healthbar", "PLAYER_HEALTHBAR_ACCENT_COLOR")), "#123456");
    assert.equal(store.get("ql_healthbar", "PLAYER_HEALTHBAR_OPACITY"), 0.55, "valid peer edits survive navigation");
    click(env, "QOLCustomizeSelect_healthbar");
    assert.equal(env.find("QOLCustomize_PLAYER_HEALTHBAR_ACCENT_COLOR").text, "#123456");
    assert.equal(env.find("QOLCustomize_PLAYER_HEALTHBAR_OPACITY").text, "55");
    clean(env);
});

for (const resize of [false, true]) test(`invalid Healthbar input permits canvas ${resize ? "resize" : "move"} from the accepted draft`, () => {
    const env = setup("healthbar", 300, 456);
    env.global.QOL.ui.customize.start(null, { elementId: "healthbar" });
    const color = env.find("QOLCustomize_PLAYER_HEALTHBAR_ACCENT_COLOR");
    color.text = "#123456"; color._fire("oninputsubmit"); env.clock.advance(500);
    color.text = ""; color._fire("oninputsubmit");
    assert.equal(color.BHasClass("Invalid"), true);
    click(env, "QOLCustomizeApply");
    assert.equal(color.BHasClass("Invalid"), true, "Save still rejects malformed input");
    const source = env.find("QOLCustomize" + (resize ? "Resize" : "Frame") + "_healthbar");
    const proxy = startDrag(env, source);
    assert.ok(proxy, "invalid pending input cannot block DragStart");
    assert.equal(env.find("QOLCustomize_PLAYER_HEALTHBAR_ACCENT_COLOR").text, "#123456");
    proxy.actualxoffset += 30; proxy.actualyoffset += 46;
    startDrag.end(env, source, proxy); env.clock.advance(3000);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(env.global.QOL_UTILS.DecodeHexColor(store.get("ql_healthbar", "PLAYER_HEALTHBAR_ACCENT_COLOR")), "#123456");
    assert.equal(store.get("ql_healthbar", resize ? "PLAYER_HEALTHBAR_SCALE" : "PLAYER_HEALTHBAR_X_OFFSET"), resize ? 110 : 30);
    assert.equal(proxy.IsValid(), false);
    clean(env);
});

test("malformed pending input cannot trap Undo, and late blur cannot resurrect it", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const input = env.find("QOLCustomize_SOULS_X_OFFSET");
    input.text = "75"; input._fire("oninputsubmit"); env.clock.advance(500);
    input.text = "Infinity";
    click(env, "QOLCustomizeUndo"); input._fire("onblur"); env.clock.advance(500);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(input.text, "0"); assert.equal(input.BHasClass("Invalid"), false);
    clean(env);
});

for (const action of ["Reset", "Undo"]) test(`${action} permits immediate capture without changing its accepted return geometry`, () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const input = env.find("QOLCustomize_SOULS_X_OFFSET");
    input.text = "300"; input._fire("oninputsubmit"); env.clock.advance(600);
    // Native placement arrived between the editor's observations. Its recorded
    // baseline still has value 0/x200 when the return action is pressed.
    env.panel.actualxoffset = 500;
    click(env, "QOLCustomize" + action);
    const frame = env.find("QOLCustomizeFrame_souls");
    assert.equal(input.text, "0");
    captureWithoutMotion(env, frame);
    env.clock.advance(600);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 0);
    captureWithoutMotion(env, frame);
    env.panel.actualxoffset = 200; env.clock.advance(500);
    const proxy = startDrag(env, frame); assert.ok(proxy);
    startDrag.end(env, frame, proxy); env.clock.advance(300);
    clean(env);
});

test("an untouched initial draft can still start a gesture before its first preview ACK", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const frame = env.find("QOLCustomizeFrame_souls"), event = {};
    startDrag.begin(env, frame, event);
    assert.ok(event.displayPanel);
    clean(env);
});

test("offset-only Reset allows native content dimensions to change after placement returns", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const input = env.find("QOLCustomize_SOULS_X_OFFSET");
    input.text = "300"; input._fire("oninputsubmit"); env.clock.advance(600);
    env.panel.actualxoffset = 500;
    click(env, "QOLCustomizeReset"); env.clock.advance(600);
    // Changing native contents did not request a resize. Return placement ACK
    // therefore cannot require the earlier content width or height.
    rect(env.panel, 190, 72, 200, 100); env.clock.advance(500);
    const frame = env.find("QOLCustomizeFrame_souls"), proxy = startDrag(env, frame);
    assert.ok(proxy);
    startDrag.end(env, frame, proxy); env.clock.advance(300);
    clean(env);
});

for (const replacement of [false, true]) test(`Reset permits motionless capture after native ${replacement ? "replacement" : "conditional reappearance"} without reviving prior offsets`, () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const input = env.find("QOLCustomize_SOULS_X_OFFSET");
    input.text = "300"; input._fire("oninputsubmit"); env.clock.advance(600);
    let panel = env.panel;
    if (replacement) {
        const parent = panel.GetParent(), id = panel.id;
        panel.DeleteAsync(0); env.clock.advance(300);
        panel = parent.addChild(env.doc.create("Panel", { id }));
        rect(panel, 160, 60, 200, 100);
    } else {
        panel.visible = false; env.clock.advance(300);
        panel.visible = true;
    }
    click(env, "QOLCustomizeReset");
    const frame = env.find("QOLCustomizeFrame_souls");
    // Let availability refresh independently of payload/layout acknowledgment.
    env.clock.advance(1);
    captureWithoutMotion(env, frame);
    env.clock.advance(700);
    const proxy = startDrag(env, frame); assert.ok(proxy);
    startDrag.end(env, frame, proxy); env.clock.advance(300);
    clean(env);
});

test("alignment cannot bypass Reset return ACK merely because its draft became empty", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080);
    const input = env.find("QOLCustomize_SOULS_Y_OFFSET");
    input.text = "-300"; input._fire("oninputsubmit"); env.clock.advance(600);
    env.panel.actualyoffset = 400;
    click(env, "QOLCustomizeReset");
    click(env, "QOLCustomizeAlign_top");
    assert.equal(input.text, "0", "Align top is queued while the return payload is pending");
    env.clock.advance(600);
    assert.equal(input.text, "0", "current ACK still requires returned native position");
    env.panel.actualyoffset = 100; env.clock.advance(500);
    assert.equal(input.text, "100", "alignment uses the returned y100 baseline rather than stale y400");
    clean(env);
});

test("magnets use canvas units at different UI densities and match viewport/neighbor edges and centers", () => {
    const env = setup();
    const geometry = env.global.QOL.ui.customizeGeometry;
    const host = rect(env.doc.create("Panel"), 3840, 2160);
    host.actualuiscale_x = 2; host.actualuiscale_y = 2;
    const view = geometry.viewport(host);
    assert.equal(view.width, 1920); assert.equal(view.height, 1080);
    const bounds = { x: 800, y: 300, width: 200, height: 100 };
    let result = geometry.snap(bounds, { x: 57, y: 186 }, view, []);
    assert.equal(result.delta.x, 60); assert.equal(result.delta.y, 190);
    assert.equal(result.guides.x.value, 960); assert.equal(result.guides.y.value, 540);
    result = geometry.snap(bounds, { x: -797, y: -296 }, view, []);
    assert.equal(result.delta.x, -800); assert.equal(result.delta.y, -300);
    const neighbor = { x: 1120, y: 630, width: 200, height: 100 };
    result = geometry.snap(bounds, { x: 116, y: 229 }, view, [neighbor]);
    assert.equal(result.delta.x, 120, "moving right edge meets neighboring left edge");
    assert.equal(result.delta.y, 230, "moving bottom edge meets neighboring top edge");
    result = geometry.snap(bounds, { x: 320, y: 326 }, null, [neighbor]);
    assert.equal(result.guides.x.index, 0, "deterministic edge tie");
    assert.equal(result.delta.y, 330);
    const restricted = geometry.snap(bounds, { x: 57, y: 186 }, view, [], ["x"]);
    assert.equal(restricted.delta.y, 186); assert.equal(restricted.guides.y, undefined);
});

test("percentage offsets use measured physical dimensions without applying UI density twice", () => {
    const env = setup();
    const G = env.global.QOL.ui.customizeGeometry;
    const element = env.global.QOL.presentation.elements.find(item => item.id === "cooldowns");
    const parent = rect(env.doc.create("Panel"), 3840, 2160);
    parent.actualuiscale_x = 2; parent.actualuiscale_y = 2;
    const target = parent.addChild(env.doc.create("Panel"));
    const values = { PASSIVE_COOLDOWN_X: 0, PASSIVE_COOLDOWN_Y: 0 };
    const patch = G.dragValues(element, target, values, { x: 384, y: -216 });
    assert.equal(patch.PASSIVE_COOLDOWN_X, 10); assert.equal(patch.PASSIVE_COOLDOWN_Y, 10);
    const host = rect(env.doc.create("Panel"), 1920, 1080);
    const anchor = G.anchorValues(element, target, { x: 100, y: 100, width: 100, height: 100 },
        { x: 484, y: -116, width: 100, height: 100 }, patch, host, { x: 1, y: 1 });
    assert.equal(anchor.PASSIVE_COOLDOWN_X, 0); assert.equal(anchor.PASSIVE_COOLDOWN_Y, 0);
    rect(parent, 0, 0);
    assert.equal(Object.keys(G.dragValues(element, target, values, { x: 384, y: -216 })).length, 0);
});

test("guides follow the held outline, magnets toggle final movement, and Undo records one drop", () => {
    const env = setup();
    const { global: g, panel, clock } = env;
    g.QOL.ui.customize.start(null, { elementId: "souls" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080);
    const frame = env.find("QOLCustomizeFrame_souls");
    const proxy = startDrag(env, frame);
    proxy.actualxoffset += 677; // Measured center 280 approaches screen center 960.
    clock.advance(350);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 680, "held motion previews the snapped HUD position");
    assert.equal(panel.actualxoffset, 200, "native HUD stays in place during hold");
    assert.equal(env.find("QOLCustomizeGuideX").visible, true);
    assert.equal(env.find("QOLCustomizeGuideX").style.x, "960px");
    click(env, "QOLCustomizeToggleSnap"); clock.advance(350);
    assert.equal(env.find("QOLCustomizeGuideX").visible, false);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 677);
    startDrag.end(env, frame, proxy); clock.advance(300);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 677, "drop applies the latest unsnapped intent once");
    click(env, "QOLCustomizeUndo"); clock.advance(350);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    clean(env);
});

test("alignment actions edit real offsets and preserve the other axis without obsolete horizontal buttons", () => {
    for (const [action, axis, expected] of [["top", "Y", 100], ["middle", "Y", -410], ["bottom", "Y", -920]]) {
        const env = setup();
        env.global.QOL.ui.customize.start(null, { elementId: "souls" });
        rect(env.find("QOLCustomizeEditor"), 1920, 1080);
        assert.equal(env.find("QOLCustomizeAlign_left"), null);
        assert.equal(env.find("QOLCustomizeAlign_center"), null);
        assert.equal(env.find("QOLCustomizeAlign_right"), null);
        click(env, "QOLCustomizeAlign_" + action); env.clock.advance(700);
        const store = env.hud.sandbox.global.QOL.core.ConfigStore;
        assert.equal(store.get("ql_souls", "SOULS_" + axis + "_OFFSET"), expected, action);
        assert.equal(store.get("ql_souls", "SOULS_" + (axis === "X" ? "Y" : "X") + "_OFFSET"), 0);
        click(env, "QOLCustomizeUndo"); env.clock.advance(700);
        assert.equal(store.get("ql_souls", "SOULS_" + axis + "_OFFSET"), 0);
        clean(env);
    }
});

test("alignment waits for prior typed layout rather than adding a stale delta", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080);
    const input = env.find("QOLCustomize_SOULS_Y_OFFSET");
    input.text = "300"; // Commit through the alignment action itself.
    click(env, "QOLCustomizeAlign_top");
    env.clock.advance(600);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_Y_OFFSET"), 300, "ACK must not align from the old native position");
    env.panel.actualyoffset = -200; env.clock.advance(400);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_Y_OFFSET"), 100);
    clean(env);
});

test("accepted typing permits immediate capture while alignment still waits for native coordinates", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080);
    const input = env.find("QOLCustomize_SOULS_Y_OFFSET");
    input.text = "300"; input._fire("oninputsubmit"); env.clock.advance(600);
    captureWithoutMotion(env, env.find("QOLCustomizeFrame_souls"));
    click(env, "QOLCustomizeAlign_top"); env.clock.advance(400);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), 300);
    env.panel.actualyoffset = -200; env.clock.advance(400);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), 100);
    clean(env);
});

test("Bottom Bar accepts rounded native scale dimensions and remains movable after resizing", () => {
    const env = setup("bottomBar", 1000, 500);
    env.global.QOL.ui.customize.start(null, { elementId: "bottomBar" });
    const input = env.find("QOLCustomize_BOTTOM_BAR_SCALE");
    input.text = "125"; input._fire("oninputsubmit"); env.clock.advance(600);
    const frame = env.find("QOLCustomizeFrame_bottomBar");
    captureWithoutMotion(env, frame);
    // The real manifest emits Math.round(90 * 1.25) = 113%, against
    // native 90%. Its width differs from the ideal ratio by more than 2px.
    rect(env.panel, 1000 * 113 / 90, 500 * 113 / 90);
    env.clock.advance(500);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "normal renderer rounding must not permanently block the next gesture");
    proxy.actualxoffset += 40;
    startDrag.end(env, frame, proxy); env.clock.advance(500);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_bottom_bar", "BOTTOM_BAR_X_OFFSET"), 40);
    clean(env);
});

test("Bottom Bar combined scale and position edits settle at its native anchor before another gesture", () => {
    const env = setup("bottomBar", 300, 100, 800, 900);
    env.global.QOL.ui.customize.start(null, { elementId: "bottomBar" });
    env.find("QOLCustomize_BOTTOM_BAR_SCALE").text = "130";
    const input = env.find("QOLCustomize_BOTTOM_BAR_X_OFFSET");
    input.text = "100"; input._fire("oninputsubmit"); env.clock.advance(600);
    const frame = env.find("QOLCustomizeFrame_bottomBar");
    captureWithoutMotion(env, frame);
    // Center/bottom native placement changes the box origin by (-45,-30)
    // as well as the accepted x offset. This is an explicit layout sample,
    // not a CSS implementation in the simulator.
    rect(env.panel, 390, 130, 855, 870); env.clock.advance(600);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "combined geometry must not wait for an impossible unscaled origin");
    proxy.actualxoffset += 40;
    startDrag.end(env, frame, proxy); env.clock.advance(500);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_bottom_bar", "BOTTOM_BAR_X_OFFSET"), 140);
    clean(env);
});

test("oversized HUD surfaces keep the move target and all four corners inside the canvas", () => {
    const env = setup("bottomBar", 3000, 1500, -500, -200);
    env.global.QOL.ui.customize.start(null, { elementId: "bottomBar" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080); env.clock.advance(300);
    const frame = env.find("QOLCustomizeFrame_bottomBar");
    const corners = env.find("QOLCustomizeCorners_bottomBar");
    assert.equal(frame.style.x, "0px"); assert.equal(frame.style.y, "0px");
    assert.equal(frame.style.width, "1920px"); assert.equal(frame.style.height, "1080px");
    assert.equal(corners.style.width, "1920px"); assert.equal(corners.style.height, "1080px");
    const outline = frame.Children().find(child => child.BHasClass("QOLCustomizeOutline"));
    assert.equal(outline.style.width, "3000px", "the outline retains the actual native surface size");
    for (const suffix of ["", "TopLeft", "TopRight", "BottomLeft"]) {
        const source = env.find("QOLCustomizeResize_bottomBar" + suffix);
        const proxy = startDrag(env, source);
        assert.ok(proxy, suffix || "BottomRight");
        startDrag.end(env, source, proxy); env.clock.advance(600);
        assert.equal(proxy.IsValid(), false);
    }
    clean(env);
});

test("the inspector reserves measured history/actions when the canvas becomes shorter", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" });
    const overlay = rect(env.find("QOLCustomizeEditor"), 1920, 800);
    const tools = env.find("QOLCustomizeTools"), fields = env.find("QOLCustomizeFields");
    rect(tools, 380, 580); rect(fields, 340, 350); env.clock.advance(300);
    assert.equal(fields.style.maxHeight, "474px");
    overlay.actuallayoutheight = 400; env.clock.advance(300);
    assert.equal(fields.style.maxHeight, "122px", "scrolling fields leave the fixed actions within the bounded tools window");
    overlay.actualuiscale_y = 2; overlay.actuallayoutheight = 800;
    tools.actuallayoutheight = 1160; fields.actuallayoutheight = 700; env.clock.advance(300);
    assert.equal(fields.style.maxHeight, "122px", "viewport and chrome measurements use the same canvas units");
    clean(env);
});

test("expanded palettes reserve non-scrolling chrome and retire when the selected element changes", () => {
    const env = setup("healthbar", 300, 456);
    env.global.QOL.ui.customize.start(); click(env, "QOLCustomizeSelect_healthbar");
    const overlay = rect(env.find("QOLCustomizeEditor"), 1920, 800);
    const tools = env.find("QOLCustomizeTools"), fields = env.find("QOLCustomizeFields");
    const dock = env.find("QOLCustomizePaletteDock");
    const palette = env.find("QOLCustomizePalette_PLAYER_HEALTHBAR_ACCENT_COLOR");
    const toggle = env.find("QOLCustomizePaletteToggle_PLAYER_HEALTHBAR_ACCENT_COLOR");
    toggle._fire("onactivate");
    assert.equal(palette.GetParent(), dock);
    assert.equal(dock.GetParent(), tools);
    assert.equal(dock.visible, true);
    // Supply native measurements including the expanded palette. The fixture
    // has no CSS layout engine or native drag-autoscroll behavior.
    rect(tools, 380, 680); rect(fields, 340, 170); env.clock.advance(300);
    assert.equal(fields.style.maxHeight, "194px", "the palette budget comes from the same measured fixed chrome");
    overlay.actualuiscale_y = 2; overlay.actuallayoutheight = 1600;
    tools.actuallayoutheight = 1360; fields.actuallayoutheight = 340; env.clock.advance(300);
    assert.equal(fields.style.maxHeight, "194px", "dock reservation respects canvas density");
    click(env, "QOLCustomizeSelect_items"); env.clock.advance(300);
    assert.equal(dock.visible, false);
    assert.equal(palette.IsValid(), false);
    toggle._fire("onactivate");
    assert.equal(dock.visible, false, "a retired palette toggle cannot reopen the new inspector's dock");
    clean(env);
});

test("changed canvas density retires measurements without concealing a pending accepted offset", () => {
    const env = setup();
    env.global.QOL.ui.customize.start(null, { elementId: "souls" }); env.clock.advance(500);
    const overlay = rect(env.find("QOLCustomizeEditor"), 3840, 2160);
    const input = env.find("QOLCustomize_SOULS_X_OFFSET");
    input.text = "300"; input._fire("oninputsubmit"); env.clock.advance(500);
    overlay.actualuiscale_x = 2; overlay.actualuiscale_y = 2;
    env.clock.advance(500);
    const frame = env.find("QOLCustomizeFrame_souls");
    captureWithoutMotion(env, frame);
    env.panel.actualxoffset = 500; env.clock.advance(500);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "the pending offset can acknowledge in the new canvas units");
    proxy.actualxoffset += 40;
    startDrag.end(env, frame, proxy); env.clock.advance(500);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 340);
    clean(env);
});

test("selected corners have an independent sibling input layer while overlapping small frames keep their priority", () => {
    const env = setup("items", 360, 180, 20, 800);
    env.panel.AddClass("ModsContainer");
    const health = env.global.QOL.presentation.elements.find(element => element.id === "healthbar");
    let target = env.hud.root;
    for (const segment of health.path) {
        let next = typeof segment === "string" ? target.FindChild(segment) : target.Children().find(panel => panel.BHasClass(segment.className));
        if (!next) next = target.addChild(env.doc.create("Panel", {
            id: typeof segment === "string" ? segment : "", classes: typeof segment === "string" ? [] : [segment.className]
        }));
        target = next;
    }
    rect(target, 160, 60, 300, 790);
    env.global.QOL.ui.customize.start(); click(env, "QOLCustomizeSelect_items");
    const frame = env.find("QOLCustomizeFrame_items"), corners = env.find("QOLCustomizeCorners_items");
    const overlay = env.find("QOLCustomizeEditor");
    assert.equal(frame.GetParent(), overlay); assert.equal(corners.GetParent(), overlay);
    assert.equal(corners.hittest, false); assert.equal(corners.hittestchildren, true);
    assert.equal(corners.visible, true);
    assert.equal(env.find("QOLCustomizeResize_itemsTopRight").GetParent(), corners);
    for (const key of ["x", "y", "width", "height"]) assert.equal(corners.style[key], frame.style[key]);
    assert.equal(frame.style.zIndex, "1", "selection does not elevate a large frame above smaller content");
    assert.equal(env.find("QOLCustomizeFrame_healthbar").style.zIndex, "3");
    click(env, "QOLCustomizeSelect_healthbar"); assert.equal(corners.visible, false);
    // The native compositor is absent here. The assertion proves separate
    // sibling ownership, with the layer order declared by production CSS.
    clean(env);
});

test("small AP exposes a padded move target, separate measured outline and four usable corners", () => {
    const env = setup("abilityPoints", 20, 14, 1900, 1066);
    env.global.QOL.ui.customize.start(null, { elementId: "abilityPoints" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080); env.clock.advance(300);
    const frame = env.find("QOLCustomizeFrame_abilityPoints");
    assert.equal(frame.style.width, "64px"); assert.equal(frame.style.height, "56px");
    assert.equal(frame.style.x, "1856px"); assert.equal(frame.style.y, "1024px");
    const outline = frame.Children().find(child => child.BHasClass("QOLCustomizeOutline"));
    assert.equal(outline.style.width, "20px"); assert.equal(outline.style.height, "14px");
    for (const name of ["", "TopLeft", "TopRight", "BottomLeft"]) assert.equal(env.find("QOLCustomizeResize_abilityPoints" + name).visible, true);
    const proxy = startDrag(env, frame); proxy.actualxoffset -= 100;
    startDrag.end(env, frame, proxy); env.clock.advance(350);
    assert.equal(env.panel.style.x, "-100px");
    clean(env);
});

test("Hide panels changes the actual editor windows; Show frames changes outlines immediately", () => {
    const env = setup();
    env.global.QOL.ui.customize.start();
    const frame = env.find("QOLCustomizeFrame_souls");
    const outline = frame.Children().find(child => child.BHasClass("QOLCustomizeOutline"));
    click(env, "QOLCustomizeSelect_stamina");
    assert.equal(outline.style.border, "1px solid transparent");
    click(env, "QOLCustomizeToggleFrames"); assert.match(outline.style.border, /0\.35/);
    click(env, "QOLCustomizeToggleFrames"); assert.equal(outline.style.border, "1px solid transparent");
    click(env, "QOLCustomizeTogglePanels");
    assert.equal(env.find("QOLCustomizeTools").visible, false);
    assert.equal(env.find("QOLCustomizeCatalog").visible, false);
    assert.equal(env.find("QOLCustomizeView").visible, true);
    click(env, "QOLCustomizeTogglePanels");
    assert.equal(env.find("QOLCustomizeTools").visible, true);
    assert.equal(env.find("QOLCustomizeCatalog").visible, true);
    clean(env);
});

test("the view toolbar follows measured top-bar content until the user drags it", () => {
    const env = setup("topBar", 1400, 1080, 260, 0);
    const clock = env.panel.addChild(env.doc.create("Panel", { classes: ["GameClock"] }));
    rect(clock, 100, 50, 650, 0);
    env.global.QOL.ui.customize.start(null, { elementId: "topBar" });
    rect(env.find("QOLCustomizeEditor"), 1920, 1080);
    const toolbar = rect(env.find("QOLCustomizeView"), 300, 90, 810, 15);
    env.clock.advance(300);
    assert.equal(toolbar.style.x, "810px");
    assert.equal(toolbar.style.y, "65px", "avoid the content, not the full-height TopBar owner");
    clock.actuallayoutheight = 100;
    env.clock.advance(300);
    assert.equal(toolbar.style.y, "115px");
    const overlay = env.find("QOLCustomizeEditor");
    rect(overlay, 3840, 2160);
    overlay.actualuiscale_x = 2; overlay.actualuiscale_y = 2;
    rect(env.panel, 2800, 2160, 520, 0);
    rect(clock, 200, 200, 1300, 0);
    rect(toolbar, 600, 180, 1620, 230);
    env.clock.advance(300);
    assert.equal(toolbar.style.y, "115px", "placement shares the canvas density conversion used by selection frames");
    const proxy = startDrag(env, env.find("QOLCustomizeDragView"));
    proxy.actualyoffset += 200;
    startDrag.end(env, env.find("QOLCustomizeDragView"), proxy);
    const movedY = toolbar.style.y;
    clock.actuallayoutheight = 300;
    env.clock.advance(300);
    assert.equal(toolbar.style.y, movedY, "native layout changes preserve the user's session position");
    clean(env);
});

for (const [id, handle] of [["QOLCustomizeCatalog", "QOLCustomizeDragCatalog"], ["QOLCustomizeTools", "QOLCustomizeDragTools"],
    ["QOLCustomizeView", "QOLCustomizeDragView"]]) {
    test(`${id}: draggable header keeps controls and native windows in place, clamps to viewport and cleans its proxy`, () => {
        const env = setup();
        const baseline = JSON.stringify(env.global.MOD_CONFIG);
        env.global.QOL.ui.customize.start();
        const overlay = rect(env.find("QOLCustomizeEditor"), 1920, 1080);
        overlay.actualuiscale_x = 2; overlay.actualuiscale_y = 2;
        const panel = rect(env.find(id), 500, 400, 100, 60);
        const proxy = startDrag(env, env.find(handle));
        proxy.actualxoffset += 200; proxy.actualyoffset += 100;
        env.clock.advance(50);
        assert.equal(panel.style.x, "150px"); assert.equal(panel.style.y, "80px");
        proxy.actualxoffset += 10000; proxy.actualyoffset += 10000;
        startDrag.end(env, env.find(handle), proxy); env.clock.advance(1);
        assert.equal(panel.style.x, "710px"); assert.equal(panel.style.y, "340px");
        assert.equal(panel.GetParent(), overlay);
        assert.equal(proxy.IsValid(), false);
        assert.equal(JSON.stringify(env.global.MOD_CONFIG), baseline);
        // Inspector selection can change the native window dimensions after
        // moving it. Clamp against the new measurement, not stored old sizes.
        panel.actuallayoutwidth = 1000; panel.actuallayoutheight = 600;
        env.clock.advance(300);
        assert.equal(panel.style.x, "460px"); assert.equal(panel.style.y, "240px");
        const second = startDrag(env, env.find(handle));
        clean(env);
        assert.equal(second.IsValid(), false);
        assert.equal(JSON.stringify(env.global.MOD_CONFIG), baseline);
    });
}

test("late native resize layout pins the opposite corner in one Undo entry after capture releases", () => {
    const env = setup("souls");
    const { global: g, clock, panel } = env;
    g.QOL.ui.customize.start(null, { elementId: "souls" });
    const handle = env.find("QOLCustomizeResize_soulsTopLeft");
    const proxy = startDrag(env, handle); proxy.actualxoffset -= 32; proxy.actualyoffset -= 12;
    startDrag.end(env, handle, proxy);
    clock.advance(600);
    assert.equal(env.find("QOLCustomizeUndo").enabled, true, "native settling does not hold the editor's history hostage");
    assert.equal(env.find("QOLCustomizeFields").enabled, true);
    assert.equal(proxy.IsValid(), false, "drop releases the native capture visual before layout settles");
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    const layout = () => {
        const ratio = store.get("ql_presentation_scale", "SOULS_SCALE") / 100;
        panel.actuallayoutwidth = 160 * ratio; panel.actuallayoutheight = 60 * ratio;
        panel.actualxoffset = 200 + store.get("ql_souls", "SOULS_X_OFFSET");
        panel.actualyoffset = 100 - store.get("ql_souls", "SOULS_Y_OFFSET");
    };
    for (let i = 0; i < 25; i++) { layout(); clock.advance(50); }
    assert.equal(panel.actualxoffset + panel.actuallayoutwidth, 360);
    assert.equal(panel.actualyoffset + panel.actuallayoutheight, 160);
    assert.equal(env.find("QOLCustomizeUndo").enabled, true);
    assert.equal(proxy.IsValid(), false);
    click(env, "QOLCustomizeUndo"); clock.advance(500);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 100);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    clean(env);
});

test("continuous held resize previews its size and applies one final anchor correction", () => {
    const env = setup("souls");
    const { global: g, clock, panel } = env;
    g.QOL.ui.customize.start(null, { elementId: "souls" });
    const handle = env.find("QOLCustomizeResize_soulsTopLeft"), proxy = startDrag(env, handle);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    proxy.actualxoffset += 32; proxy.actualyoffset += 12; clock.advance(500);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 80);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeGestureOutline").style.width, "128px");
    proxy.actualxoffset += 32; proxy.actualyoffset += 12; clock.advance(600);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 60, "successive held samples update the live scale");
    assert.equal(env.find("QOLCustomizeGestureOutline").style.width, "96px");
    startDrag.end(env, handle, proxy); clock.advance(400);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 60);
    assert.equal(env.find("QOLCustomizeFields").enabled, true);
    assert.equal(proxy.IsValid(), false);
    // Supply the native center-anchored size independently from its code offset.
    rect(panel, 96, 36, 232, 112); clock.advance(300);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 32);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), -12);
    panel.actualxoffset = 264; panel.actualyoffset = 124; clock.advance(400);
    assert.equal(panel.actualxoffset + panel.actuallayoutwidth, 360);
    assert.equal(panel.actualyoffset + panel.actuallayoutheight, 160);
    assert.equal(proxy.IsValid(), false);
    captureWithoutMotion(env, handle);
    click(env, "QOLCustomizeUndo"); clock.advance(500);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 100);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    captureWithoutMotion(env, handle);
    rect(panel, 160, 60, 200, 100); clock.advance(300);
    const restored = startDrag(env, handle);
    assert.ok(restored, "the measured historical native origin acknowledges scale and offsets together");
    restored.DeleteAsync(0); clock.advance(100);
    clean(env);
});

for (const action of ["edit", "Undo", "Reset", "new capture"]) test(`late resize anchor correction cannot overwrite a subsequent ${action}`, () => {
    const env = setup("souls"), { global: g, clock, panel } = env;
    g.QOL.ui.customize.start(null, { elementId: "souls" });
    const handle = env.find("QOLCustomizeResize_soulsTopLeft"), proxy = startDrag(env, handle);
    proxy.actualxoffset -= 32; proxy.actualyoffset -= 12;
    startDrag.end(env, handle, proxy); clock.advance(500);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), 120);
    assert.equal(env.find("QOLCustomizeFields").enabled, true);
    if (action === "edit") {
        const input = env.find("QOLCustomize_SOULS_X_OFFSET"); input.text = "50"; input._fire("oninputsubmit");
    } else if (action === "new capture") captureWithoutMotion(env, handle);
    else click(env, "QOLCustomize" + action);
    rect(panel, 192, 72, 200, 100); clock.advance(700);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), action === "edit" ? 50 : 0,
        "late physical size must not apply the old -32px anchor correction");
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), 0);
    assert.equal(store.get("ql_presentation_scale", "SOULS_SCALE"), ["Undo", "Reset"].includes(action) ? 100 : 120);
    clean(env);
});

for (const id of ["souls", "stamina"]) test(`${id}: shrinking cannot repeatedly accumulate anchor offsets while native position is delayed`, () => {
    const env = setup(id, 160, 60, 200, 100);
    const { global: g, clock, panel } = env;
    const prefix = id === "souls" ? "SOULS_" : "STAMINA_";
    const scaleOwner = "ql_presentation_scale";
    const offsetOwner = id === "souls" ? "ql_souls" : scaleOwner;
    g.QOL.ui.customize.start(null, { elementId: id });
    const handle = env.find("QOLCustomizeResize_" + id + "TopLeft");
    const proxy = startDrag(env, handle);
    proxy.actualxoffset += 40; proxy.actualyoffset += 15;
    startDrag.end(env, handle, proxy);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    clock.advance(500);
    assert.equal(store.get(scaleOwner, prefix + "SCALE"), 75);
    // Size arrives first. Position remains at its previous measured value for
    // many acknowledged frames; those are not fresh anchor corrections.
    panel.actuallayoutwidth = 120; panel.actuallayoutheight = 45;
    clock.advance(500);
    assert.equal(store.get(offsetOwner, prefix + "X_OFFSET"), 40);
    assert.equal(store.get(offsetOwner, prefix + "Y_OFFSET"), -15);
    clock.advance(500);
    assert.equal(store.get(offsetOwner, prefix + "X_OFFSET"), 40);
    assert.equal(store.get(offsetOwner, prefix + "Y_OFFSET"), -15);
    panel.actualxoffset = 240; panel.actualyoffset = 115;
    clock.advance(400);
    assert.equal(env.find("QOLCustomizeUndo").enabled, true);
    assert.equal(proxy.IsValid(), false);
    click(env, "QOLCustomizeUndo"); clock.advance(500);
    assert.equal(store.get(scaleOwner, prefix + "SCALE"), 100);
    assert.equal(store.get(offsetOwner, prefix + "X_OFFSET"), 0);
    assert.equal(store.get(offsetOwner, prefix + "Y_OFFSET"), 0);
    clean(env);
});

test("overall presentation scale preserves native transforms and animation scale on apply and release", () => {
    const env = setup("abilityPoints");
    env.panel.style.preTransformScale2d = "1.03";
    env.panel.style.transform = "translateX(2px)";
    env.global.QOL.ui.customize.start(null, { elementId: "abilityPoints" });
    const input = env.find("QOLCustomize_AP_SCALE");
    input.text = "150"; input._fire("oninputsubmit"); env.clock.advance(700);
    assert.equal(env.panel.style.uiScale, "150%");
    assert.equal(env.panel.style.preTransformScale2d, "1.03");
    assert.equal(env.panel.style.transform, "translateX(2px)");
    clean(env);
    assert.equal(env.panel.style.uiScale, undefined);
    assert.equal(env.panel.style.preTransformScale2d, "1.03");
    assert.equal(env.panel.style.transform, "translateX(2px)");
});

for (const [id, prefix] of [["abilityPoints", "AP_"], ["stamina", "STAMINA_"]]) {
    test(`${id}: independent placement previews, restores and survives envelope export without a version bump`, () => {
        const env = setup(id);
        const { global: g, clock, panel } = env;
        const parent = panel.GetParent();
        const versions = [g.QOL_SCHEMA_SEMVER, g.QOL_SCHEMA_WIRE_VERSION];
        assert.equal(g.QOL.ui.customize.start(null, { elementId: id }), true);
        const proxy = startDrag(env, env.find("QOLCustomizeFrame_" + id));
        proxy.actualxoffset += 123; proxy.actualyoffset += 321;
        startDrag.end(env, env.find("QOLCustomizeFrame_" + id), proxy); clock.advance(700);
        assert.equal(panel.style.x, "123px"); assert.equal(panel.style.y, "321px");
        assert.equal(panel.GetParent(), parent);
        assert.equal(g.MOD_CONFIG[prefix + "X_OFFSET"], 0);
        click(env, "QOLCustomizeUndo"); clock.advance(700);
        assert.equal(panel.style.x, undefined); assert.equal(panel.style.y, undefined);
        click(env, "QOLCustomizeRedo"); clock.advance(700);
        g.QOL.core.storageBridge.saveSettings = (_cfg, callback) => callback(null);
        click(env, "QOLCustomizeApply"); clock.advance(700);
        const parsed = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString());
        assert.equal(parsed.ok, true); assert.equal(parsed.candidateConfig[prefix + "X_OFFSET"], 123);
        assert.equal(parsed.candidateConfig[prefix + "Y_OFFSET"], -321);
        assert.deepEqual([g.QOL_SCHEMA_SEMVER, g.QOL_SCHEMA_WIRE_VERSION], versions);
        g.QOL.ui.customize.start(null, { elementId: id });
        click(env, "QOLCustomizeReset"); clock.advance(700);
        assert.equal(panel.style.x, undefined); assert.equal(panel.style.y, undefined);
        clean(env);
        assert.equal(panel.style.x, "123px");
    });
}
