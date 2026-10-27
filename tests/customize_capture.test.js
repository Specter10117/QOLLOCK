"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const startDrag = require("./customize_drag_fixture");

const rect = (panel, width, height, x, y) => Object.assign(panel, {
    actuallayoutwidth: width, actuallayoutheight: height, actualxoffset: x, actualyoffset: y
});
function setup() {
    const env = load();
    env.global.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const Q = env.global.QOL;
    const targets = {};
    for (const [id, width, height, x, y] of [
        ["souls", 160, 60, 200, 100], ["items", 180, 100, 600, 300], ["healthbar", 300, 150, 400, 600]
    ]) {
        const element = Q.presentation.elements.find(item => item.id === id);
        let panel = env.hud.root;
        for (const segment of element.path) {
            let child = typeof segment === "string" ? panel.FindChild(segment) :
                panel.Children().find(item => item.BHasClass(segment.className));
            if (!child) child = panel.addChild(env.doc.create("Panel", {
                id: typeof segment === "string" ? segment : "", classes: typeof segment === "string" ? [] : [segment.className]
            }));
            panel = child;
        }
        targets[id] = rect(panel, width, height, x, y);
    }
    Q.ui.customize.start();
    rect(env.em.FindChildTraverse("QOLCustomizeEditor"), 1920, 1080, 0, 0);
    env.clock.advance(600);
    const find = id => env.em.FindChildTraverse(id);
    const click = id => { const panel = find(id); assert.ok(panel, id); panel._fire("onactivate"); };
    const grab = (id, corner = false) => {
        const source = find("QOLCustomize" + (corner ? "Resize" : "Frame") + "_" + id);
        const event = {}; startDrag.begin(env, source, event);
        return { source, proxy: event.displayPanel };
    };
    const drop = ({ source, proxy }, nativeLayout = null) => {
        startDrag.end(env, source, proxy);
        if (nativeLayout) nativeLayout();
        env.clock.advance(3000);
    };
    const clean = () => {
        click("QOLCustomizeCancel"); env.clock.advance(1200);
        assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
    };
    return { ...env, Q, targets, find, click, grab, drop, clean };
}
function type(env, key, text) {
    const input = env.find("QOLCustomize_" + key); assert.ok(input, key);
    input.text = text; input._fire("oninputsubmit");
}

test("catalog switches color inspectors on the first activation without an unsupported unregister API", () => {
    const env = setup();
    for (const [id, key] of [["items", "ITEMS_X_OFFSET"], ["healthbar", "PLAYER_HEALTHBAR_X_OFFSET"],
        ["souls", "SOULS_X_OFFSET"]]) {
        env.click("QOLCustomizeSelect_" + id);
        assert.deepEqual(env.doc.eventErrors, [], "retiring the previous color inspector must not interrupt selection");
        assert.ok(env.find("QOLCustomize_" + key), "one activation must build the new inspector");
        env.clock.advance(1);
    }
    env.clean();
});

// Exercise native Button callbacks with optional cursor coordinates, separately
// from compositor motion. Native hit testing still requires client verification.
function pointer(env, x, y) {
    env.global.GameUI.GetCursorPosition = () => ({ x, y });
}
function capture(env, x, y, id = "souls", corner = null) {
    pointer(env, x, y);
    const event = {}, source = env.find("QOLCustomize" + (corner === null ? "Frame" : "Resize") + "_" + id + (corner || ""));
    env.global.$.DispatchEvent("DragStart", source, event);
    return { source, proxy: event.displayPanel };
}
function move(env, x, y, delay = 350) { pointer(env, x, y); env.clock.advance(delay); }

for (const id of ["souls", "items", "healthbar"]) test(`${id}: repeated native Button grabs work while native layout is pending`, () => {
    const env = setup();
    const panel = env.targets[id];
    for (let i = 0; i < 12; i++) {
        const x = panel.actualxoffset + panel.actuallayoutwidth / 2;
        const y = panel.actualyoffset + panel.actuallayoutheight / 2;
        const gesture = capture(env, x, y, id);
        assert.ok(gesture.proxy, `grab ${i}`);
        move(env, x + 10, y + 5, 20);
        env.drop(gesture);
        assert.equal(env.find("QOLCustomizeFields").enabled, true);
    }
    assert.equal(env.find("QOLCustomizeFrame_" + id).hittest, true);
    assert.equal(env.find("QOLCustomizeCorners_" + id).hittestchildren, true);
    env.clean();
});

test("live pointer movement reaches HUD before release, while canonical settings stay unchanged", () => {
    const env = setup(), before = JSON.stringify(env.global.MOD_CONFIG);
    const gesture = capture(env, 280, 130);
    assert.ok(gesture.proxy);
    gesture.proxy.actualxoffset = 3.4028e38;
    gesture.proxy.GetPositionWithinWindow = () => null;
    move(env, 305, 140);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 25);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), -10);
    assert.equal(env.find("QOLCustomize_SOULS_X_OFFSET").text, "25");
    assert.equal(env.find("QOLCustomizeFrame_souls").style.x, "200px", "native capture rectangle is fixed");
    assert.equal(env.find("QOLCustomizeFrame_souls").GetChild(0).style.x, "25px", "visual outline follows intent");
    assert.equal(env.find("QOLCustomizeCorners_souls").style.x, "200px");
    assert.equal(JSON.stringify(env.global.MOD_CONFIG), before);
    for (const delta of [30, 45, 60]) move(env, 280 + delta, 150, 80);
    env.drop(gesture);
    env.click("QOLCustomizeUndo"); env.clock.advance(500);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false, "one drag is one history action");
    env.click("QOLCustomizeRedo"); env.clock.advance(500);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 60);
    env.clean();
    assert.equal(JSON.stringify(env.global.MOD_CONFIG), before);
});

for (const [name, x, y, sx, sy] of [["BottomRight", 348, 148, 1, 1], ["TopLeft", 212, 112, -1, -1],
    ["TopRight", 348, 112, 1, -1], ["BottomLeft", 212, 148, -1, 1]])
test(`${name}: visible corners follow live resize while native input rectangles stay fixed`, () => {
    const env = setup(); env.click("QOLCustomizeSelect_souls");
    const gesture = capture(env, x, y, "souls", name === "BottomRight" ? "" : name); assert.ok(gesture.proxy);
    move(env, x + sx * 32, y + sy * 12);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_presentation_scale", "SOULS_SCALE"), 120);
    assert.equal(env.find("QOLCustomizeCorners_souls").style.width, "160px");
    const marker = gesture.source.GetChild(0);
    assert.equal(marker.style.x, sx > 0 ? "32px" : "-32px");
    assert.equal(marker.style.y, sy > 0 ? "12px" : "-12px");
    assert.equal(env.find("QOLCustomizeGestureOutline").style.width, "192px");
    env.drop(gesture);
    env.clean();
});

for (const invalid of [null, [null, null], { x: Infinity, y: 10 }, { x: 3.4028e38, y: 3.4028e38 }])
test(`invalid pointer during a gesture retains the last valid intent: ${JSON.stringify(invalid)}`, () => {
    const env = setup(), gesture = capture(env, 280, 130);
    move(env, 300, 142);
    env.global.GameUI.GetCursorPosition = () => invalid;
    env.clock.advance(100);
    env.drop(gesture);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 20);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), -12);
    env.clean();
});

for (const unavailable of ["missing", "null", "throwing"]) test(`native selection and dragging work with ${unavailable} cursor API`, () => {
    const env = setup();
    if (unavailable === "missing") delete env.global.GameUI.GetCursorPosition;
    if (unavailable === "null") env.global.GameUI.GetCursorPosition = () => null;
    if (unavailable === "throwing") env.global.GameUI.GetCursorPosition = () => { throw new Error("Not available in this context"); };
    env.click("QOLCustomizeFrame_items");
    assert.ok(env.find("QOLCustomize_ITEMS_X_OFFSET"), "mouse selection needs no cursor API");
    const source = env.find("QOLCustomizeFrame_souls");
    const proxy = startDrag(env, source); assert.ok(proxy);
    proxy.actualxoffset += 40; proxy.actualyoffset += 20; env.clock.advance(350);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 40, "compositor motion is delivered before release");
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), -20);
    env.drop({source, proxy}); env.click("QOLCustomizeUndo"); env.clock.advance(350);
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    env.clean();
});

for (const [name, sx, sy] of [["", 1, 1], ["TopLeft", -1, -1], ["TopRight", 1, -1], ["BottomLeft", -1, 1]])
test(`native ${name || "BottomRight"} resize works without a cursor API`, () => {
    const env = setup(); delete env.global.GameUI.GetCursorPosition;
    env.click("QOLCustomizeFrame_souls");
    const source = env.find("QOLCustomizeResize_souls" + name);
    assert.equal(source.hittest, true); assert.equal(source.draggable, true);
    const proxy = startDrag(env, source); assert.ok(proxy);
    proxy.actualxoffset += sx * 32; proxy.actualyoffset += sy * 12; env.clock.advance(350);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_presentation_scale", "SOULS_SCALE"), 120);
    env.drop({source, proxy}); env.clean();
});

test("pending compositor samples are ignored until a valid origin; release retains its last motion", () => {
    const env = setup(); delete env.global.GameUI.GetCursorPosition;
    const source = env.find("QOLCustomizeFrame_souls"), proxy = startDrag.begin(env, source);
    let sample = [3.4028e38, 3.4028e38]; proxy.GetPositionWithinWindow = () => sample;
    env.clock.advance(100); assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    sample = [850, 520]; env.clock.advance(50);
    sample = [890, 540]; env.clock.advance(350);
    sample = null; env.clock.advance(50);
    proxy.DeleteAsync(0); env.clock.advance(50);
    env.drop({source, proxy});
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 40);
    assert.equal(env.find("QOLCustomizeUndo").enabled, true);
    env.clean();
});


test("compositor release before DragEnd cannot cancel a live edit or erase history", () => {
    const env = setup(), gesture = capture(env, 280, 130);
    move(env, 320, 150);
    gesture.proxy.DeleteAsync(0); env.clock.advance(50);
    env.drop(gesture);
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 40);
    assert.equal(env.find("QOLCustomizeUndo").enabled, true);
    env.clean();
});

for (const change of ["replacement", "hidden", "exit", "conflict"]) test(`${change} cancels capture and restores canonical preview`, () => {
    const env = setup(), gesture = capture(env, 280, 130);
    move(env, 320, 150);
    if (change === "replacement") env.targets.souls.DeleteAsync(0);
    if (change === "hidden") env.targets.souls.visible = false;
    if (change === "exit") env.click("QOLCustomizeCancel");
    if (change === "conflict") { env.global.MOD_CONFIG.SOULS_X_OFFSET = 77; env.global.SaveAndSync(); }
    env.clock.advance(1200);
    assert.equal(gesture.proxy.IsValid(), false);
    if (change === "replacement" || change === "hidden") {
        assert.equal(env.find("QOLCustomizeFields").enabled, true);
        env.clean();
    }
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("pointer coordinates use independently calibrated window and layout density", () => {
    const env = setup(), overlay = env.find("QOLCustomizeEditor");
    overlay.actualuiscale_x = 2; overlay.actualuiscale_y = 3;
    overlay.GetPositionWithinWindow = () => [20, 40];
    env.find("QOLCustomizeUnitProbe").GetPositionWithinWindow = () => ({ x: 170, y: 240 });
    // Souls' physical center is 280,130 -> canvas center 140,43.333.
    const gesture = capture(env, 230, 126.6666667); assert.ok(gesture.proxy);
    move(env, 260, 166.6666667);
    const store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(store.get("ql_souls", "SOULS_X_OFFSET"), 40);
    assert.equal(store.get("ql_souls", "SOULS_Y_OFFSET"), -60);
    env.drop(gesture); env.clean();
});

function smallTargets(env) {
    const add = (parent, name, classes = [], type = "Panel") => parent.FindChild(name) ||
        parent.addChild(env.doc.create(type, { id: name, classes }));
    const core = env.hud.root.Children().find(p => p.BHasClass("HudCore"));
    const crosshair = add(add(add(core, "gameplay_hud"), "gameplay_hud_alive"), "crosshair");
    const ammo = add(add(add(crosshair, "gun"), "gun_data"), "ammo_panel");
    const current = add(ammo, "TestCurrent", ["weapon_ammo"], "Label");
    const maximum = add(ammo, "TestMax", ["weapon_ammo_max"], "Label");
    const stamina = add(add(crosshair, "dash"), "charges_container");
    rect(ammo, 80, 22, 900, 500);
    rect(current, 22, 22, 0, 0); rect(maximum, 28, 22, 30, 0);
    rect(stamina, 20, 14, 912, 534);
    return { stamina, ammoCurrent: current, ammoMax: maximum };
}

for (const id of ["stamina", "ammoCurrent", "ammoMax"]) for (const cursor of [true, false])
test(`${id}: repeated native grabs and partitioned inputs with ${cursor ? "cursor" : "compositor"} motion`, () => {
    const env = setup(), q = env.Q;
    smallTargets(env);
    env.clock.advance(400);
    env.click("QOLCustomizeToggleSnap");
    const points = { stamina: [922, 541], ammoCurrent: [911, 511], ammoMax: [944, 511] };
    const [x, y] = points[id];
    const bounds = key => Object.fromEntries(["x", "y", "width", "height"].map(axis =>
        [axis, parseFloat(env.find("QOLCustomizeFrame_" + key).style[axis])]));
    const a = bounds("ammoCurrent"), b = bounds("ammoMax"), c = bounds("stamina");
    assert.ok(a.x + a.width <= b.x, "Current and Max padding is partitioned");
    assert.ok(Math.max(a.y + a.height, b.y + b.height) <= c.y, "Ammo padding cannot intercept Stamina");
    for (const key of Object.keys(points)) {
        env.click("QOLCustomizeSelect_" + key);
        const area = bounds(key), handle = env.find("QOLCustomizeResize_" + key);
        assert.ok(area.width - parseFloat(handle.style.width) * 2 >= 16, "corners leave a central move target");
        assert.ok(area.height - parseFloat(handle.style.height) * 2 >= 16, "corners leave a central move target");
    }
    for (let i = 0; i < 10; i++) {
        // Start from another selection to exercise the native source callback.
        env.click("QOLCustomizeSelect_healthbar");
        if (id !== "stamina") env.click("QOLCustomizeSelect_" + id);
        const source = env.find("QOLCustomizeFrame_" + id);
        const gesture = cursor ? capture(env, x, y, id) : {source, proxy: startDrag(env, source)};
        assert.ok(gesture.proxy);
        const expectedKey = { stamina: "STAMINA_X_OFFSET", ammoCurrent: "AMMO_CURRENT_X_OFFSET", ammoMax: "AMMO_MAX_X_OFFSET" }[id];
        const old = Number(env.find("QOLCustomize_" + expectedKey).text);
        if (cursor) move(env, x + 10, y + 3);
        else { gesture.proxy.actualxoffset += 10; gesture.proxy.actualyoffset += 3; env.clock.advance(350); }
        assert.equal(Number(env.find("QOLCustomize_" + expectedKey).text), old + 10);
        env.drop(gesture);
    }
    assert.equal(q.ui.customize.isRunning(), true);
    env.clean();
});


test("a motionless capture near viewport magnets does not change settings or create history", () => {
    const env = setup(); rect(env.targets.souls, 160, 60, 2, 2); env.clock.advance(300);
    env.click("QOLCustomizeSelect_healthbar");
    const gesture = capture(env, 82, 32); assert.ok(gesture.proxy);
    env.clock.advance(500); env.drop(gesture);
    assert.equal(env.find("QOLCustomize_SOULS_X_OFFSET").text, "0");
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    env.clean();
});

test("native same-release activation cannot select another surface after a drop", () => {
    const env = setup(), gesture = capture(env, 280, 130);
    move(env, 300, 140);
    env.global.$.DispatchEvent("DragEnd", gesture.source, gesture.proxy);
    env.find("QOLCustomizeFrame_items")._fire("onactivate");
    assert.ok(env.find("QOLCustomize_SOULS_X_OFFSET"));
    env.clock.advance(1); env.find("QOLCustomizeFrame_items")._fire("onactivate");
    assert.ok(env.find("QOLCustomize_ITEMS_X_OFFSET"), "the next independent click is available");
    env.clean();
});

for (const value of [Infinity, 3.4028e38]) test(`pending native coordinates do not create phantom frames: ${value}`, () => {
    const env = setup();
    env.targets.souls.actualxoffset = value; env.clock.advance(300);
    assert.equal(env.find("QOLCustomizeFrame_souls").visible, false);
    env.targets.souls.actualxoffset = 200; env.clock.advance(300);
    const gesture = capture(env, 280, 130); assert.ok(gesture.proxy);
    env.drop(gesture); env.clean();
});


test("editor window dragging prefers cursor intent over pending or destroyed compositor coordinates", () => {
    const env = setup(), panel = env.find("QOLCustomizeTools"), header = env.find("QOLCustomizeDragTools");
    rect(panel, 300, 400, 100, 80);
    pointer(env, 120, 94);
    const event = {}; env.global.$.DispatchEvent("DragStart", header, event);
    assert.ok(event.displayPanel);
    event.displayPanel.actualxoffset = 3.4028e38;
    event.displayPanel.GetPositionWithinWindow = () => null;
    move(env, 170, 124, 50);
    assert.equal(panel.style.x, "150px"); assert.equal(panel.style.y, "110px");
    event.displayPanel.DeleteAsync(0); env.clock.advance(30);
    env.global.$.DispatchEvent("DragEnd", header, event.displayPanel);
    assert.equal(panel.style.x, "150px"); assert.equal(panel.style.y, "110px");
    env.clean();
});


test("a no-cursor drop before any valid compositor sample leaves the draft unchanged", () => {
    const env = setup(); delete env.global.GameUI.GetCursorPosition;
    const source = env.find("QOLCustomizeFrame_souls"), proxy = startDrag.begin(env, source);
    assert.ok(proxy); proxy.GetPositionWithinWindow = () => null;
    env.drop({source, proxy});
    assert.equal(env.find("QOLCustomize_SOULS_X_OFFSET").text, "0");
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    const next = startDrag(env, source); assert.ok(next);
    next.actualxoffset += 20; env.clock.advance(350); env.drop({source, proxy: next});
    assert.equal(env.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET"), 20);
    env.clean();
});

test("distant orthogonal targets cannot shrink a small native input area", () => {
    const env = setup(), G = env.Q.ui.customizeGeometry;
    const measured = {x: 200, y: 200, width: 20, height: 14};
    const view = {width: 1920, height: 1080};
    assert.deepEqual({...G.inputBox(measured, view, [
        {x: 222, y: 900, width: 20, height: 14},
        {x: 1000, y: 216, width: 20, height: 14}
    ])}, {...G.hitBox(measured, view)});
    env.clean();
});

// Fault injection checks the editor lifetime contract; it does not simulate
// when native layout becomes pending or how Panorama hit testing delivers input.
for (const id of ["stamina", "ammoCurrent", "ammoMax"]) for (const cursor of [true, false])
for (const resize of [false, true]) test(`${id}: ${resize ? "resize" : "move"} retains native capture across pending layout with ${cursor ? "cursor" : "compositor"} motion`, () => {
    const env = setup(), target = smallTargets(env)[id];
    env.clock.advance(400); env.click("QOLCustomizeToggleSnap");
    env.click("QOLCustomizeSelect_" + id);
    const key = resize ? {stamina: "STAMINA_SCALE", ammoCurrent: "AMMO_CURRENT_SCALE", ammoMax: "AMMO_TOTAL_SCALE"}[id]
        : {stamina: "STAMINA_X_OFFSET", ammoCurrent: "AMMO_CURRENT_X_OFFSET", ammoMax: "AMMO_MAX_X_OFFSET"}[id];
    const value = () => Number(env.find("QOLCustomize_" + key).text), initial = value();
    const frame = env.find("QOLCustomizeFrame_" + id), source = resize ? env.find("QOLCustomizeResize_" + id) : frame;
    if (!cursor) delete env.global.GameUI.GetCursorPosition;
    const gesture = cursor ? capture(env, 920, 520, id, resize ? "" : null) : {source, proxy: startDrag(env, source)};
    assert.ok(gesture.proxy);
    const moveBy = delta => {
        if (cursor) pointer(env, 920 + delta, 520 + delta);
        else { gesture.proxy.actualxoffset = 350 + delta; gesture.proxy.actualyoffset = 220 + delta; }
        env.clock.advance(350);
    };
    moveBy(10);
    const accepted = value();
    assert.notEqual(accepted, initial, "the first movement has reached the draft");
    const sourceBounds = [frame.style.x, frame.style.y, frame.style.width, frame.style.height];
    const layout = {width: target.actuallayoutwidth, height: target.actuallayoutheight, x: target.actualxoffset};
    // Span both the gesture poll and the editor's periodic frame refresh.
    target.actuallayoutwidth = 0; target.actuallayoutheight = 0; target.actualxoffset = 3.4028e38;
    moveBy(20);
    assert.equal(env.find("QOLCustomizeFields").enabled, false, "measurement loss cannot end an owned capture");
    assert.equal(gesture.proxy.IsValid(), true);
    assert.equal(frame.visible, true);
    assert.equal(env.find("QOLCustomizeCorners_" + id).visible, true);
    assert.deepEqual([frame.style.x, frame.style.y, frame.style.width, frame.style.height], sourceBounds, "source input stays fixed");
    assert.notEqual(value(), accepted, "movement continues using captured geometry");
    const final = value();
    // Even release before layout recovery commits the existing draft/history.
    env.drop(gesture);
    assert.equal(Number(env.find("QOLCustomize_" + key).text), final);
    Object.assign(target, {actuallayoutwidth: layout.width, actuallayoutheight: layout.height, actualxoffset: layout.x});
    env.clock.advance(350);
    env.click("QOLCustomizeUndo"); env.clock.advance(350);
    assert.equal(Number(env.find("QOLCustomize_" + key).text), initial);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false, "pending measurements do not split history");
    env.clean();
});

test("same-selection capture keeps inspector identity after accepted typing", () => {
    const env = setup(); env.click("QOLCustomizeSelect_souls");
    type(env, "SOULS_Y_OFFSET", "300"); env.clock.advance(600);
    const input = env.find("QOLCustomize_SOULS_Y_OFFSET");
    assert.equal(input.text, "300", "typing retains the accepted offset while native layout is pending");
    const gesture = capture(env, 280, 130);
    assert.ok(gesture.proxy);
    assert.equal(env.find("QOLCustomize_SOULS_Y_OFFSET"), input, "a repeated selection must not rebuild the live inspector");
    startDrag.end(env, gesture.source, gesture.proxy);
    env.targets.souls.actualyoffset = -200; env.clock.advance(500);
    assert.equal(input.text, "300", "a motionless capture preserves the accepted offset");
    env.clean();
});

for (const id of ["stamina", "ammoCurrent", "ammoMax"]) for (const change of ["hidden", "destroyed", "reparented"])
test(`${id}: pending geometry does not retain capture after its owner is ${change}`, () => {
    const env = setup(), target = smallTargets(env)[id];
    env.clock.advance(400); env.click("QOLCustomizeToggleSnap");
    env.click("QOLCustomizeSelect_" + id);
    const gesture = capture(env, 920, 520, id);
    move(env, 940, 530);
    target.actuallayoutwidth = 0; target.actualxoffset = 3.4028e38;
    if (change === "hidden") target.visible = false;
    if (change === "destroyed") target.DeleteAsync(0);
    if (change === "reparented") target.SetParent(env.hud.root);
    env.clock.advance(400);
    assert.equal(gesture.proxy.IsValid(), false);
    assert.equal(env.find("QOLCustomizeFields").enabled, true);
    const key = {stamina: "STAMINA_X_OFFSET", ammoCurrent: "AMMO_CURRENT_X_OFFSET", ammoMax: "AMMO_MAX_X_OFFSET"}[id];
    assert.equal(env.find("QOLCustomize_" + key).text, "0", "real owner loss rolls back the live movement");
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    env.clean();
});
