"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const startDrag = require("./customize_drag_fixture");

function setup() {
    const env = load();
    const add = (parent, id, classes = [], type = "Panel") => parent.addChild(env.doc.create(type, { id, classes }));
    const core = add(env.hud.root, "", ["HudCore"]);
    const crosshair = add(add(add(core, "gameplay_hud"), "gameplay_hud_alive"), "crosshair");
    const gun = add(add(crosshair, "gun"), "gun_data");
    const ammo = add(gun, "ammo_panel");
    const current = add(ammo, "", ["weapon_ammo"], "Label");
    const max = add(ammo, "", ["weapon_ammo_max"], "Label");
    current.text = "12"; max.text = " / 30";
    for (const panel of [ammo, current, max]) Object.assign(panel, { actuallayoutwidth: 80, actuallayoutheight: 22 });
    env.global.QOL.ui.window.setOpen(true); env.clock.advance(500);
    return { ...env, add, ammo, current, max };
}
const activate = (env, id) => { const panel = env.em.FindChildTraverse(id); assert.ok(panel, id); panel._fire("onactivate"); };
const submit = (env, key, value) => {
    const input = env.em.FindChildTraverse("QOLCustomize_" + key); assert.ok(input, key);
    input.text = String(value); input._fire("oninputsubmit"); env.clock.advance(1200);
};

// Capture no longer waits for a native font/offset acknowledgement. Alignment
// still uses those measurements; a held/motionless drag leaves the draft alone.
function captureWithoutMotion(env, frame) {
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "pending native layout cannot reject capture");
    startDrag.end(env, frame, proxy); env.clock.advance(1);
    assert.equal(env.em.FindChildTraverse("QOLCustomizeFields").enabled, true);
}

for (const [id, key, label] of [["ammoCurrent", "AMMO_CURRENT_SCALE", "current"], ["ammoMax", "AMMO_TOTAL_SCALE", "max"]])
test(`${id}: Tokamak native font/width policy remains usable through scale, move and corner resize`, () => {
    const env = setup(), target = env[label];
    env.add(env.ammo.GetParent(), "clip_status_mirrored");
    target.style.fontSize = "18px";
    Object.assign(target, { actuallayoutwidth: 54, actuallayoutheight: 22 });
    env.clock.advance(500);
    env.global.QOL.ui.customize.start(null, { elementId: id });
    submit(env, key, 150);
    assert.equal(target.style.fontSize, "27px", "custom text scales from the verified Tokamak 18px baseline");
    assert.equal(target.style.width, undefined, "mirrored digits keep native content width");
    assert.equal(target.style.marginLeft, undefined, "mirrored Max has no native gap");
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_" + id);
    captureWithoutMotion(env, frame);
    // Explicit native measurements: this fixture does not render native fonts.
    Object.assign(target, { actuallayoutwidth: 81, actuallayoutheight: 33 }); env.clock.advance(500);
    const moved = startDrag(env, frame); moved.actualxoffset += 40;
    startDrag.end(env, frame, moved); env.clock.advance(500);
    assert.equal(target.style.position, "40px 0px 0px");
    target.actualxoffset = 40; env.clock.advance(500);
    const handle = env.em.FindChildTraverse("QOLCustomizeResize_" + id);
    const resized = startDrag(env, handle);
    const corners = handle.GetParent();
    resized.actualxoffset += parseFloat(corners.style.width) * 0.25;
    resized.actualyoffset += parseFloat(corners.style.height) * 0.25;
    startDrag.end(env, handle, resized); env.clock.advance(500);
    assert.equal(target.style.fontSize, "34px");
    Object.assign(target, { actuallayoutwidth: 54 * 34 / 18, actuallayoutheight: 22 * 34 / 18 }); env.clock.advance(600);
    assert.equal(resized.IsValid(), false, "rounded font geometry settles and releases its drag visual");
    const next = startDrag(env, frame);
    assert.ok(next, "the next move remains available after corner resize");
    activate(env, "QOLCustomizeCancel"); env.clock.advance(500);
    assert.equal(next.IsValid(), false);
    assert.equal(target.style.width, undefined);
    assert.equal(target.style.marginLeft, undefined);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const [id, key, label] of [["ammoCurrent", "AMMO_CURRENT_SCALE", "current"], ["ammoMax", "AMMO_TOTAL_SCALE", "max"]])
test(`${id}: native digit count changes cannot block scale layout or the next canvas gesture`, () => {
    const env = setup(), target = env[label];
    env.add(env.ammo.GetParent(), "clip_status_mirrored");
    target.style.fontSize = "18px";
    Object.assign(target, { actuallayoutwidth: 54, actuallayoutheight: 22 }); env.clock.advance(500);
    env.global.QOL.ui.customize.start(null, { elementId: id });
    submit(env, key, 150);
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_" + id);
    // Native ammo changes while the new font is awaiting layout. Tokamak has
    // content width, so a 10->9 transition shrinks width independently of size.
    target.text = label === "current" ? "9" : " / 9";
    target.actuallayoutwidth = 40.5;
    captureWithoutMotion(env, frame);
    target.actuallayoutheight = 33; env.clock.advance(600);
    const moved = startDrag(env, frame); moved.actualxoffset += 40;
    startDrag.end(env, frame, moved); env.clock.advance(500);
    captureWithoutMotion(env, frame);
    target.actualxoffset = 40; env.clock.advance(500);
    const handle = env.em.FindChildTraverse("QOLCustomizeResize_" + id);
    const resized = startDrag(env, handle), corners = handle.GetParent();
    resized.actualxoffset += parseFloat(corners.style.width) * 0.2;
    resized.actualyoffset += parseFloat(corners.style.height) * 0.2;
    startDrag.end(env, handle, resized); env.clock.advance(500);
    assert.equal(target.style.fontSize, "32px");
    // Reloading adds a digit again during corner settling. Width is not an ACK
    // dimension for these font controls; scaled height and stability still are.
    target.text = label === "current" ? "10" : " / 10";
    Object.assign(target, { actuallayoutwidth: 54 * 32 / 18, actuallayoutheight: 22 * 32 / 18 }); env.clock.advance(600);
    assert.equal(resized.IsValid(), false, "changing digit count cannot keep resize settling locked");
    const next = startDrag(env, frame); assert.ok(next);
    activate(env, "QOLCustomizeCancel"); env.clock.advance(500);
    assert.equal(next.IsValid(), false);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const [id, key, prefix, label] of [["ammoCurrent", "AMMO_CURRENT_SCALE", "AMMO_CURRENT_", "current"], ["ammoMax", "AMMO_TOTAL_SCALE", "AMMO_MAX_", "max"]])
for (const action of ["Reset", "Undo"])
test(`${id}: ${action} retains immediate capture while returned font, offset and digit count change`, () => {
    const env = setup(), target = env[label];
    env.add(env.ammo.GetParent(), "clip_status_mirrored");
    target.style.fontSize = "18px";
    Object.assign(target, { actuallayoutwidth: 54, actuallayoutheight: 22 }); env.clock.advance(500);
    env.global.QOL.ui.customize.start(null, { elementId: id });
    // Submit both fields in a single accepted edit, so Undo restores them both.
    env.em.FindChildTraverse("QOLCustomize_" + key).text = "150";
    const offset = env.em.FindChildTraverse("QOLCustomize_" + prefix + "X_OFFSET");
    offset.text = "40"; offset._fire("oninputsubmit"); env.clock.advance(600);
    // Native scale/placement arrives between observations, immediately before
    // returning to the original key. That older key still owns the old box.
    Object.assign(target, { actuallayoutwidth: 81, actuallayoutheight: 33, actualxoffset: 40 });
    activate(env, "QOLCustomize" + action);
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_" + id);
    captureWithoutMotion(env, frame);
    env.clock.advance(600);
    captureWithoutMotion(env, frame);
    target.text = label === "current" ? "9" : " / 9";
    Object.assign(target, { actuallayoutwidth: 27, actuallayoutheight: 22 }); env.clock.advance(500);
    captureWithoutMotion(env, frame);
    target.actualxoffset = 0; env.clock.advance(600);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "returned height and stable placement allow different native digit width");
    activate(env, "QOLCustomizeCancel"); env.clock.advance(500);
    assert.equal(proxy.IsValid(), false);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const density of [1, 2])
for (const action of ["Reset", "Undo"])
for (const moved of [false, true])
test(`Max Ammo: ${action} ${moved ? "offset and size" : "size only"} tolerates Current digit-flow shift at density ${density}`, () => {
    const env = setup();
    env.add(env.ammo.GetParent(), "clip_status_mirrored");
    env.ammo.actualuiscale_x = env.ammo.actualuiscale_y = density;
    Object.assign(env.current, { actuallayoutwidth: 54 * density, actuallayoutheight: 22 * density });
    Object.assign(env.max, { actuallayoutwidth: 54 * density, actuallayoutheight: 22 * density, actualxoffset: 54 * density });
    env.clock.advance(500);
    env.global.QOL.ui.customize.start(null, { elementId: "ammoMax" });
    const overlay = env.em.FindChildTraverse("QOLCustomizeEditor");
    overlay.actualuiscale_x = overlay.actualuiscale_y = density; env.clock.advance(500);
    const size = env.em.FindChildTraverse("QOLCustomize_AMMO_TOTAL_SCALE");
    size.text = "150";
    const offset = env.em.FindChildTraverse("QOLCustomize_AMMO_MAX_X_OFFSET");
    if (moved) offset.text = "40";
    size._fire("oninputsubmit"); env.clock.advance(600);
    // Both extracted ammo_panel layouts flow right. Tokamak Current's width
    // is content-sized, so consuming 10->9 shifts Max's native flow origin.
    env.current.text = "9"; env.current.actuallayoutwidth = 27 * density;
    Object.assign(env.max, { actuallayoutwidth: 81 * density, actuallayoutheight: 33 * density,
        actualxoffset: (27 + (moved ? 40 : 0)) * density });
    activate(env, "QOLCustomize" + action); env.clock.advance(600);
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_ammoMax");
    captureWithoutMotion(env, frame);
    Object.assign(env.max, { actuallayoutwidth: 54 * density, actuallayoutheight: 22 * density }); env.clock.advance(500);
    if (moved) {
        captureWithoutMotion(env, frame);
        env.max.actualxoffset = 27 * density; env.clock.advance(600);
    }
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "native flow origin may change while return geometry settles");
    activate(env, "QOLCustomizeCancel"); env.clock.advance(500);
    assert.equal(proxy.IsValid(), false);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("Max Ammo capture remains available while offset and Current digit-flow shift settle", () => {
    const env = setup();
    env.add(env.ammo.GetParent(), "clip_status_mirrored");
    env.current.actuallayoutwidth = 54;
    env.max.actualxoffset = 54; env.clock.advance(500);
    env.global.QOL.ui.customize.start(null, { elementId: "ammoMax" });
    const offset = env.em.FindChildTraverse("QOLCustomize_AMMO_MAX_X_OFFSET");
    offset.text = "40"; offset._fire("oninputsubmit"); env.clock.advance(600);
    env.current.text = "9"; env.current.actuallayoutwidth = 27;
    env.max.actualxoffset = 27; env.clock.advance(500);
    const frame = env.em.FindChildTraverse("QOLCustomizeFrame_ammoMax");
    captureWithoutMotion(env, frame);
    env.max.actualxoffset = 67; env.clock.advance(600);
    const proxy = startDrag(env, frame);
    assert.ok(proxy, "flow shift plus requested offset establishes the current placement");
    activate(env, "QOLCustomizeCancel"); env.clock.advance(500);
    assert.equal(proxy.IsValid(), false);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("independent ammo digit frames stay above the overlapping Ammo group and below editor controls", () => {
    const env = setup();
    env.global.QOL.ui.customize.start();
    const find = id => env.em.FindChildTraverse(id);
    const group = find("QOLCustomizeFrame_ammo");
    for (const id of ["ammoCurrent", "ammoMax"]) {
        const frame = find("QOLCustomizeFrame_" + id);
        assert.equal(frame.visible, true);
        assert.ok(Number(frame.style.zIndex) > Number(group.style.zIndex), "the family frame cannot cover digit selections");
        assert.ok(Number(frame.style.zIndex) < 10, "editor windows retain their declared layer");
    }
    activate(env, "QOLCustomizeCancel");
    assert.deepEqual(env.clock.errors, []);
});

test("Ammo parent moves only the group; Current and Max expose independent measured frames", () => {
    const env = setup(), p = env.global.QOL.presentation;
    const parent = p.elements.find(element => element.id === "ammo");
    const current = p.elements.find(element => element.id === "ammoCurrent");
    const max = p.elements.find(element => element.id === "ammoMax");
    assert.equal(p.resolve(current, env.hud.root), env.current);
    assert.equal(p.resolve(max, env.hud.root), env.max);
    const values = env.global.QOL.ui.customizeGeometry.dragValues(parent, env.ammo, env.global.MOD_CONFIG, { x: 25, y: 10 });
    assert.deepEqual(Object.keys(values), ["AMMO_PANEL_X_OFFSET", "AMMO_PANEL_Y_OFFSET"]);
    assert.equal(values.AMMO_PANEL_X_OFFSET, 25); assert.equal(values.AMMO_PANEL_Y_OFFSET, -10);
    const child = env.global.QOL.ui.customizeGeometry.dragValues(max, env.max, env.global.MOD_CONFIG, { x: -11, y: 19 });
    assert.equal(child.AMMO_MAX_X_OFFSET, -11); assert.equal(child.AMMO_MAX_Y_OFFSET, -19);
    env.global.QOL.ui.customize.start();
    for (const id of ["ammo", "ammoCurrent", "ammoMax"]) assert.ok(env.em.FindChildTraverse("QOLCustomizeFrame_" + id));
    activate(env, "QOLCustomizeCancel");
    env.current.DeleteAsync(0); env.max.DeleteAsync(0); env.clock.advance(1);
    assert.equal(p.resolve(current, env.hud.root), null, "ring-only/missing digits do not select the group instead");
    assert.equal(p.resolve(max, env.hud.root), null);
    assert.deepEqual(env.clock.errors, []);
});

test("scoped label preview preserves native text and shared geometry, reapplies replacements and retires offsets", () => {
    const env = setup(), g = env.global, store = env.hud.sandbox.global.QOL.core.ConfigStore;
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammoCurrent" }), true);
    submit(env, "AMMO_CURRENT_X_OFFSET", 17); submit(env, "AMMO_CURRENT_Y_OFFSET", -13);
    assert.equal(env.current.style.position, "17px 13px 0px");
    assert.equal(env.current.text, "12"); assert.equal(env.max.text, " / 30");
    assert.equal(env.max.style.x, undefined); assert.equal(env.ammo.style.marginLeft, undefined);
    assert.equal(store.get("ql_ammo", "AMMO_CURRENT_X_OFFSET"), 17);
    assert.equal(g.MOD_CONFIG.AMMO_CURRENT_X_OFFSET, 0);
    const old = env.current;
    old.SetParent(env.add(env.hud.root, "RetiredDigits"));
    const replacement = env.add(env.ammo, "", ["weapon_ammo"], "Label"); replacement.text = "11";
    env.clock.advance(1200);
    assert.equal(old.style.position, undefined); assert.equal(replacement.style.position, "17px 13px 0px");
    activate(env, "QOLCustomizeCancel"); env.clock.advance(1200);
    assert.equal(replacement.style.position, undefined);
    assert.equal(store.get("ql_ammo", "AMMO_CURRENT_X_OFFSET"), 0);
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammoMax" }), true);
    submit(env, "AMMO_MAX_X_OFFSET", -21); submit(env, "AMMO_MAX_Y_OFFSET", 23);
    assert.equal(env.max.style.position, "-21px -23px 0px");
    assert.equal(env.max.text, " / 30", "separator remains engine-owned Max text");
    activate(env, "QOLCustomizeReset"); env.clock.advance(1200);
    assert.equal(env.max.style.position, undefined);
    activate(env, "QOLCustomizeCancel");
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("label offsets apply and round-trip through the current envelope without changing frozen schemas", () => {
    const env = setup(), g = env.global;
    const values = { AMMO_CURRENT_X_OFFSET: 1999, AMMO_CURRENT_Y_OFFSET: -1999, AMMO_MAX_X_OFFSET: -2000, AMMO_MAX_Y_OFFSET: 2000 };
    g.QOL.core.storageBridge.saveSettings = (_config, callback) => callback(null);
    for (const [id, prefix] of [["ammoCurrent", "AMMO_CURRENT_"], ["ammoMax", "AMMO_MAX_"]]) {
        g.QOL.ui.customize.start(null, { elementId: id });
        for (const [key, value] of Object.entries(values)) if (key.startsWith(prefix)) submit(env, key, value);
        activate(env, "QOLCustomizeApply"); env.clock.advance(1200);
    }
    const serialized = g.QOL.ui.configTab.getCurrentExportSettingsString();
    assert.ok(g.QOL.persistence.serializeSettings(g.MOD_CONFIG).startsWith("{"));
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(serialized);
    assert.equal(imported.ok, true);
    for (const [key, value] of Object.entries(values)) {
        assert.equal(g.MOD_CONFIG[key], value); assert.equal(imported.candidateConfig[key], value);
        assert.equal(g.QOL_COMPACT_SCHEMA_REGISTRY["4.0.5"].schema.some(field => field.key === key), false);
    }
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const [id, prefix, label] of [["ammoCurrent", "AMMO_CURRENT_", "current"], ["ammoMax", "AMMO_MAX_", "max"]])
test(`${id}: Reset/Undo/presets exercise the coordinate retirement protocol in a simulated flow position`, () => {
    const env = setup();
    const physical = { x: 0, y: 0 };
    const target = env[label];
    target.style = new Proxy(target.style, {
        set(target, key, value) {
            target[key] = value;
            if ((key === "x" || key === "y") && value !== "0px") physical[key] = parseFloat(value);
            if (key === "position") {
                const components = String(value).split(/\s+/).map(parseFloat);
                physical.x = components[0]; physical.y = components[1];
            }
            return true;
        }
    });
    const clear = target.ClearPropertyFromCode.bind(target);
    target.ClearPropertyFromCode = key => {
        // Deliberately retain this model's position after clearing the record.
        // This checks explicit neutral writes; it does not model native relayout.
        return clear(key);
    };
    const g = env.global;
    g.QOL.ui.customize.start(null, { elementId: id });
    submit(env, prefix + "X_OFFSET", 80); submit(env, prefix + "Y_OFFSET", 50);
    assert.deepEqual(physical, { x: 80, y: -50 });
    submit(env, prefix + "X_OFFSET", 0);
    assert.deepEqual(physical, { x: 0, y: -50 }, "resetting one component preserves the other");
    activate(env, "QOLCustomizeReset"); env.clock.advance(1200);
    assert.deepEqual(physical, { x: 0, y: 0 });
    assert.equal(target.style.position, undefined);
    assert.equal(env.max.text, " / 30");
    activate(env, "QOLCustomizeUndo"); env.clock.advance(1200);
    assert.equal(physical.y, -50);
    activate(env, "QOLCustomizeCancel"); env.clock.advance(1200);
    assert.deepEqual(physical, { x: 0, y: 0 });

    // Saved placement goes through the ordinary preset/publication/registry
    // path, including disable at default and reset while Ammo stays enabled.
    for (const enabled of [0, 1]) {
        Object.assign(g.MOD_CONFIG, { [prefix + "X_OFFSET"]: 90, [prefix + "Y_OFFSET"]: -40 });
        g.SaveAndSync(); env.clock.advance(1200);
        assert.deepEqual(physical, { x: 90, y: 40 });
        assert.equal(enabled ? g.QOL.ui.presets.applyPresetConfig({ ENABLE_AMMO_STATUS: enabled }) :
            g.QOL.ui.presets.applyPresetByName("Default"), true);
        g.SaveAndSync(); env.clock.advance(1200);
        assert.equal(g.MOD_CONFIG[prefix + "X_OFFSET"], 0);
        assert.equal(g.MOD_CONFIG[prefix + "Y_OFFSET"], 0);
        assert.deepEqual(physical, { x: 0, y: 0 });
        assert.equal(target.style.position, undefined);
    }
    assert.deepEqual(env.clock.errors, []);
});

test("Current and Max can shrink independently and Cancel releases font overrides", () => {
    const env = setup(), g = env.global;
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammoCurrent" }), true);
    submit(env, "AMMO_CURRENT_SCALE", 50);
    assert.equal(env.current.style.fontSize, "8px");
    assert.equal(env.max.style.fontSize, undefined);
    assert.equal(env.hud.root.BHasClass("qol_free_reticle_placement"), true);
    activate(env, "QOLCustomizeCancel"); env.clock.advance(1200);
    assert.equal(env.current.style.fontSize, undefined);
    assert.equal(env.hud.root.BHasClass("qol_free_reticle_placement"), false);
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammoMax" }), true);
    submit(env, "AMMO_TOTAL_SCALE", 75);
    assert.equal(env.max.style.fontSize, "12px");
    assert.equal(env.current.style.fontSize, undefined);
    activate(env, "QOLCustomizeReset"); env.clock.advance(1200);
    assert.equal(env.max.style.fontSize, undefined);
    activate(env, "QOLCustomizeCancel");
    const values = { AMMO_CURRENT_SCALE: 50, AMMO_TOTAL_SCALE: 75, AMMO_PANEL_SCALE: 50 };
    Object.assign(g.MOD_CONFIG, values);
    const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString());
    assert.equal(imported.ok, true);
    for (const [key, value] of Object.entries(values)) {
        assert.equal(imported.candidateConfig[key], value);
        assert.equal(g.QOL_COMPACT_SCHEMA_REGISTRY["4.0.5"].schema.find(field => field.key === key).min, 100);
    }
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const mirrored of [false, true])
test(`Max Ammo Reset restores the resolved font from a saved size (${mirrored ? "Tokamak" : "standard"})`, () => {
    const env = setup(), g = env.global;
    const nativeFont = mirrored ? 18 : 16;
    if (mirrored) env.add(env.ammo.GetParent(), "clip_status_mirrored");
    let resolvedFont = nativeFont;
    env.max.style = new Proxy(env.max.style, {
        set(target, key, value) {
            target[key] = value;
            if (key === "fontSize") resolvedFont = parseFloat(value);
            return true;
        }
    });
    // Retain the resolved font when the simulator deletes its code record,
    // as in the coordinate-retirement model above. Native relayout is outside
    // this test; it checks an explicit neutral write before release.
    Object.assign(g.MOD_CONFIG, { AMMO_TOTAL_SCALE: 200, AMMO_CURRENT_SCALE: 150, AMMO_PANEL_SCALE: 150 });
    g.SaveAndSync(); env.clock.advance(1200);
    assert.equal(resolvedFont, nativeFont * 2);
    assert.equal(env.current.style.fontSize, Math.round(nativeFont * 1.5) + "px");
    assert.equal(g.QOL.ui.customize.start(null, { elementId: "ammoMax" }), true);
    activate(env, "QOLCustomizeReset"); env.clock.advance(1200);
    assert.equal(resolvedFont, nativeFont);
    assert.equal(env.max.style.fontSize, undefined);
    assert.equal(env.em.FindChildTraverse("QOLCustomize_AMMO_TOTAL_SCALE").text, "100");
    assert.equal(env.current.style.fontSize, Math.round(nativeFont * 1.5) + "px", "Max reset preserves Current");
    activate(env, "QOLCustomizeUndo"); env.clock.advance(1200);
    assert.equal(resolvedFont, nativeFont * 2);
    activate(env, "QOLCustomizeRedo"); env.clock.advance(1200);
    assert.equal(resolvedFont, nativeFont);
    g.QOL.core.storageBridge.saveSettings = (_config, callback) => callback(null);
    activate(env, "QOLCustomizeApply"); env.clock.advance(1200);
    assert.equal(g.MOD_CONFIG.AMMO_TOTAL_SCALE, 100);
    assert.equal(g.MOD_CONFIG.AMMO_CURRENT_SCALE, 150);
    assert.equal(resolvedFont, nativeFont);
    assert.deepEqual(env.doc.eventErrors, []);
    assert.deepEqual(env.clock.errors, []);
});

for (const scoped of [false, true])
test(`Ammo ${scoped ? "section" : "full editor"}: three selections, drag reset and isolated child reset`, () => {
    const env = setup(), Q = env.global.QOL;
    Q.ui.customize.start(null, scoped ? { elementId: "ammo" } : {});
    const find = id => env.em.FindChildTraverse(id);
    if (scoped) assert.equal(find("QOLCustomizeFrame_items"), null);
    for (const [id, target, key] of [["ammoCurrent", env.current, "AMMO_CURRENT_X_OFFSET"], ["ammoMax", env.max, "AMMO_MAX_X_OFFSET"]]) {
        const frame = find("QOLCustomizeFrame_" + id);
        assert.ok(frame, id);
        frame._fire("onactivate");
        const proxy = startDrag(env, frame);
        assert.ok(proxy);
        proxy.actualxoffset += 40;
        startDrag.end(env, frame, proxy); env.clock.advance(500);
        assert.equal(find("QOLCustomize_" + key).text, "40");
        assert.equal(target.style.position, "40px 0px 0px");
    }
    activate(env, "QOLCustomizeReset"); env.clock.advance(600);
    assert.equal(env.max.style.position, undefined);
    assert.equal(env.current.style.position, "40px 0px 0px", "child Reset preserves its sibling");
    activate(env, "QOLCustomizeSelect_ammo");
    activate(env, "QOLCustomizeReset"); env.clock.advance(600);
    assert.equal(env.current.style.position, undefined, "family Reset includes hidden child offsets");
    activate(env, "QOLCustomizeUndo"); env.clock.advance(600);
    assert.equal(env.current.style.position, "40px 0px 0px");
    activate(env, "QOLCustomizeRedo"); env.clock.advance(600);
    assert.equal(env.current.style.position, undefined);
    activate(env, "QOLCustomizeCancel");
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});
