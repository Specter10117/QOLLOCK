"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

function setup(elementId = "items") {
    const env = load(), g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const handlers = new Map();
    const create = g.$.CreatePanel, register = g.$.RegisterEventHandler;
    g.$.CreatePanel = (type, ...args) => {
        const panel = create(type, ...args);
        // Only model the verified native HexValue child and RGB callback.
        // The simulator cannot render the stock saturation/hue canvases.
        if (type === "CitadelColorPicker") create("TextEntry", panel, "HexValue");
        return panel;
    };
    g.$.RegisterEventHandler = (name, panel, handler) => {
        if (name === "CitadelColorPickerColorChanged") handlers.set(panel.id, handler);
        return register(name, panel, handler);
    };
    const element = g.QOL.presentation.elements.find(item => item.id === elementId);
    const session = g.QOL.ui.customizeSession.create(env.doc.root, env.hud.root, env.em.FindChildTraverse("SettingsWindow"), element);
    const fixture = create("Panel", env.em, "PaletteFixture");
    const host = create("Panel", fixture, "QOLCustomizeFields");
    const dock = create("Panel", fixture, "QOLCustomizePaletteDock");
    let inspector;
    inspector = g.QOL.ui.customizeInspector.build(host, element, session, options => inspector.sync(options), dock);
    return { ...env, session, inspector, handlers, host, dock, element, find: id => fixture.FindChildTraverse(id) };
}

test("native picker dragging has no scrolling field ancestor; closing releases its dock without losing color", () => {
    const env = setup("healthbar"), key = "PLAYER_HEALTHBAR_ACCENT_COLOR";
    const picker = env.find("QOLCustomizePicker_" + key);
    const palette = env.find("QOLCustomizePalette_" + key);
    env.host.style.overflow = "squish scroll";
    const assertOutsideScroll = () => {
        for (let panel = picker; panel; panel = panel.GetParent()) assert.notEqual(panel, env.host);
        assert.equal(palette.GetParent(), env.dock);
    };
    assert.equal(env.dock.visible, false);
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    assert.equal(env.dock.visible, true);
    assertOutsideScroll();
    env.handlers.get(picker.id)(41, 144, 201);
    assertOutsideScroll();
    assert.equal(env.find("QOLCustomize_" + key).text, "#2990C9");
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    assert.equal(env.dock.visible, false);
    assert.equal(env.session.value(key), 0x12990c9);
    env.inspector.dispose(); env.session.close(); env.clock.advance(1);
    assert.equal(picker.IsValid(), false, "externally docked owned panels are retired with the inspector");
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("disposing an older inspector cannot hide or delete a newer docked palette", () => {
    const env = setup(), old = env.inspector, key = "ITEMS_WASH_COLOR";
    const retiredPicker = env.find("QOLCustomizePicker_" + key);
    const retiredEmit = env.handlers.get(retiredPicker.id);
    let current;
    current = env.global.QOL.ui.customizeInspector.build(env.host, env.element, env.session,
        options => current.sync(options), env.dock);
    env.clock.advance(1);
    const picker = env.find("QOLCustomizePicker_" + key);
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    old.dispose(); retiredEmit(255, 0, 0); env.clock.advance(1);
    assert.equal(env.dock.visible, true);
    assert.equal(picker.IsValid(), true);
    assert.equal(env.session.value(key), 0);
    current.dispose(); env.session.close(); env.clock.advance(1);
    assert.equal(env.dock.visible, false);
    assert.equal(picker.IsValid(), false);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("destroying the external palette dock retires late native events and toggles", () => {
    const env = setup(), key = "ITEMS_WASH_COLOR";
    const toggle = env.find("QOLCustomizePaletteToggle_" + key);
    toggle._fire("onactivate");
    const emit = env.handlers.get("QOLCustomizePicker_" + key);
    env.dock.DeleteAsync(0); env.clock.advance(1);
    emit(255, 0, 0); toggle._fire("onactivate"); env.inspector.sync();
    assert.equal(env.session.value(key), 0);
    env.inspector.dispose(); env.session.close();
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

test("all RGB owners expose the stock picker; opening/seeding never edits the draft", () => {
    for (const [id, key] of [["items", "ITEMS_WASH_COLOR"], ["stamina", "STAMINA_CHARGE_COLOR"], ["ammo", "AMMO_TEXT_COLOR"],
        ["bottomBar", "BOTTOM_BAR_WASH_COLOR"], ["keyboard", "KEYBOARD_OVERLAY_WASH_COLOR"],
        ["healthbar", "PLAYER_HEALTHBAR_ACCENT_COLOR"], ["minimap", "MINIMAP_ICON_COLOR"]]) {
        const env = setup(id);
        const picker = env.find("QOLCustomizePicker_" + key);
        assert.equal(picker.paneltype, "CitadelColorPicker");
        assert.equal(picker.FindChildTraverse("HexValue").text, "", "hidden pickers are not seeded on unrelated edits");
        assert.equal(env.find("QOLCustomize_" + key).text, "");
        assert.equal(env.inspector.hasPending(), false, "native/default is an accepted empty string");
        assert.equal(env.inspector.commit(), true, "pristine colors cannot block other controls or Save");
        env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
        assert.equal(picker.FindChildTraverse("HexValue").text, "FFFFFF");
        assert.equal(env.find("QOLCustomizePalette_" + key).visible, true);
        assert.equal(JSON.stringify(env.session.snapshot()), "{}");
        assert.equal(env.session.canUndo(), false);
        env.inspector.dispose(); env.session.close();
        assert.deepEqual(env.clock.errors, []);
    }
});

test("native RGB, HEX, presets, default and history share one value; rejected and retired events preserve it", () => {
    const env = setup(), key = "ITEMS_WASH_COLOR";
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    const emit = env.handlers.get("QOLCustomizePicker_" + key);
    emit(0, 0, 0);
    assert.equal(env.session.value(key), 0x1000000, "literal black differs from default");
    for (const values of [[-1, 0, 0], [0, 256, 0], [0, 0.5, 0], [NaN, 0, 0], ["255", 0, 0]]) emit(...values);
    assert.equal(env.session.value(key), 0x1000000);
    env.clock.advance(100); emit(255, 255, 255);
    assert.equal(env.session.value(key), 0x1ffffff);
    assert.equal(env.session.undo(), true);
    assert.equal(env.session.value(key), 0, "one native RGB burst is one Undo entry");
    env.inspector.sync();
    assert.equal(env.session.canUndo(), false);
    assert.equal(env.session.redo(), true); env.inspector.sync();
    const input = env.find("QOLCustomize_" + key);
    input.text = "#123456"; input._fire("oninputsubmit");
    assert.equal(env.find("QOLCustomizePicker_" + key).FindChildTraverse("HexValue").text, "123456");
    env.find("QOLCustomizeColor_" + key + "_13")._fire("onactivate");
    assert.equal(env.session.value(key), 13);
    env.find("QOLCustomizeDefault_" + key)._fire("onactivate");
    assert.equal(env.session.value(key), 0);
    assert.equal(env.inspector.hasPending(), false);
    assert.equal(env.inspector.commit(), true);
    env.inspector.dispose(); emit(255, 0, 0);
    assert.equal(env.session.value(key), 0);
    env.session.close();
    assert.deepEqual(env.clock.errors, []);
    assert.deepEqual(env.doc.eventErrors, []);
});

test("native palette updates leave unrelated TextEntries alone; idle sync causes no text churn", () => {
    const env = setup(), key = "ITEMS_WASH_COLOR";
    const writes = new Map();
    for (const field of env.global.QOL.presentation.elements.find(item => item.id === "items").fields) {
        const input = env.find("QOLCustomize_" + field.key);
        if (!input || input.paneltype !== "TextEntry") continue;
        let text = String(input.text);
        Object.defineProperty(input, "text", {
            get: () => text,
            set: next => { text = next == null ? "" : String(next); writes.set(field.key, (writes.get(field.key) || 0) + 1); }
        });
    }
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    env.handlers.get("QOLCustomizePicker_" + key)(175, 36, 36);
    assert.deepEqual([...writes], [[key, 1]], "only the changed HEX field needs a write");
    env.inspector.sync(); env.inspector.sync();
    assert.deepEqual([...writes], [[key, 1]], "unchanged text must not reset caret/trigger scroll layout");
    env.inspector.dispose(); env.session.close();
    assert.deepEqual(env.clock.errors, []);
});

test("seeding a disclosed native picker ignores its reentrant RGB notification", () => {
    const env = setup();
    const dispatch = env.global.$.DispatchEvent;
    let seeds = 0;
    env.global.$.DispatchEvent = (name, panel, ...args) => {
        if (name === "TextEntryChanged" && panel.id === "HexValue") {
            seeds++;
            const rgb = Number.parseInt(panel.text, 16);
            env.handlers.get(panel.GetParent().id)(rgb >> 16, (rgb >> 8) & 255, rgb & 255);
        }
        return dispatch(name, panel, ...args);
    };
    env.find("QOLCustomizePaletteToggle_ITEMS_WASH_COLOR")._fire("onactivate");
    assert.equal(seeds, 1);
    assert.equal(env.session.value("ITEMS_WASH_COLOR"), 0);
    assert.equal(env.session.canUndo(), false);
    env.inspector.sync();
    assert.equal(seeds, 1, "idle sync never sends another native seed event");
    env.inspector.dispose(); env.session.close();
    assert.deepEqual(env.doc.eventErrors, []);
});

test("initial and late RGB events from a hidden picker cannot change an accepted color", () => {
    const env = setup(), key = "ITEMS_WASH_COLOR";
    const emit = env.handlers.get("QOLCustomizePicker_" + key);
    emit(255, 255, 255);
    assert.equal(env.session.value(key), 0, "initial native load events are not user edits");
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    emit(175, 36, 36);
    const accepted = env.session.value(key);
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    emit(10, 20, 30);
    assert.equal(env.session.value(key), accepted, "closing retires a late drag/color notification");
    env.inspector.dispose(); env.session.close();
    assert.deepEqual(env.doc.eventErrors, []);
});

test("owned color-chip synchronization tolerates normalized native style readback", () => {
    const env = setup(), key = "ITEMS_WASH_COLOR";
    const swatch = env.find("QOLCustomizeSwatch_" + key);
    let writes = 0, color = "transparent";
    Object.defineProperty(swatch.style, "backgroundColor", {
        get: () => color,
        set: value => { writes++; color = String(value).toLowerCase(); }
    });
    env.find("QOLCustomizePaletteToggle_" + key)._fire("onactivate");
    env.handlers.get("QOLCustomizePicker_" + key)(175, 36, 36);
    assert.equal(color, "#af2424");
    env.inspector.sync(); env.inspector.sync();
    assert.equal(writes, 1, "native readback formatting must not force unchanged paint writes");
    env.inspector.dispose(); env.session.close();
    assert.deepEqual(env.doc.eventErrors, []);
});
