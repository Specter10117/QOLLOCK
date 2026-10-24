"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");
const fs = require("node:fs");
const path = require("node:path");

test("keyboard themes release their key, label and mouse colors even when DownActivated remains", () => {
    // Model only the theme class cascade, not native input or Panorama rendering.
    const css = fs.readFileSync(path.join(__dirname, "../panorama/styles/features/ql_feat_keyboard.css"), "utf8");
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .flatMap(([, list, body]) => list.split(",").map(selector => ({ selector: selector.trim(), body })))
        .filter(rule => rule.selector.includes(".QOLKeyboardTheme"));
    const colors = (theme, state, target) => {
        const result = {}, weights = {};
        for (const { selector, body } of rules) {
            const parts = selector.split(/\s+/);
            if (!selector.includes(".QOLKeyboardTheme" + theme + " ")) continue;
            const binding = parts.findIndex(part => part.startsWith("CitadelBinding.Key"));
            if (parts.slice(binding + 1).join(" ") !== target) continue;
            const required = [...parts[binding].matchAll(/\.([\w-]+)/g)].map(match => match[1]);
            if (!required.every(name => ["Key", ...state].includes(name))) continue;
            const weight = (selector.match(/\./g) || []).length;
            for (const [, property, value] of body.matchAll(/(background-color|border-color|color|wash-color):\s*([^;]+);/g)) {
                if (weight >= (weights[property] ?? -1)) { result[property] = value; weights[property] = weight; }
            }
        }
        assert.ok(Object.keys(result).length, "theme declarations were exercised");
        return result;
    };
    for (let theme = 0; theme < 8; theme++) {
        let highlights = false;
        for (const target of ["", "Label", ".MouseButtonGlyph", ".KeyboardButtonGlyph"]) {
            const idle = colors(theme, [], target);
            const held = colors(theme, ["IsPressed"], target);
            if (JSON.stringify(held) !== JSON.stringify(idle)) highlights = true;
            assert.deepEqual(colors(theme, ["IsPressed", "DownActivated"], target), held);
            assert.deepEqual(colors(theme, ["DownActivated"], target), idle,
                `theme ${theme} ${target} releases after activation`);
        }
        assert.ok(highlights, `theme ${theme} highlights while held`);
    }
    assert.doesNotMatch(css, /\.Key\.DownActivated\s+\.KeyboardKeyGlyphContainer/,
        "the inner glyph must also release its persistent wash");
});

test("keyboard themes use positive binding selectors and exclude spacer panels in every layout", () => {
    const css = fs.readFileSync(path.join(__dirname, "../panorama/styles/features/ql_feat_keyboard.css"), "utf8");
    const themeSelectors = css.split("\n").filter(line => line.startsWith(".keyboard_overlay_active") && line.includes(".QOLKeyboardTheme"));
    assert.ok(themeSelectors.length > 0);
    for (const selector of themeSelectors) {
        assert.doesNotMatch(selector, /:not\(/, "theme selectors must stay within the verified native positive-selector syntax");
        assert.match(selector, / CitadelBinding\.Key(?:[.\s,]|$)/);
    }
    const env = setup(); env.feature.onEnable();
    for (let layout = 0; layout < 3; layout++) {
        env.cfg.KEYBOARD_OVERLAY_LAYOUT = layout; env.feature.onSettingsChanged();
        const keys = env.box().FindChildrenWithClassTraverse("Key");
        assert.ok(keys.length > 0);
        for (const key of keys) {
            const spacer = key.BHasClass("EmptyKey") || key.BHasClass("EmptyKeyWide");
            assert.equal(key.paneltype === "CitadelBinding", !spacer);
        }
    }
    env.feature.onDisable();
});

function setup(overrides = {}) {
    const env = createHud({ inHideout: false }); env.assertLoaded();
    const { QOL: Q, $ } = env.sandbox.global;
    Q.core.App.shutdown();
    Q.core.ConfigAdapter.loadFromFlat({ ...env.sandbox.evalJson("QOL.buildDefaultConfig()"), ENABLE_KEYBOARD_OVERLAY: 1, ...overrides });
    const cfg = Q.core.ConfigStore.view("ql_keyboard");
    let reads = 0;
    const feature = Q.core.FeatureRegistry.getManifest("ql_keyboard").create({ events: Q.core.EventBus, id: "ql_keyboard", config: { view() { reads++; return cfg; } } });
    const add = (parent, id, classes = [], type = "Panel") => {
        const panel = $.CreatePanel(type, parent, id);
        for (const name of classes) panel.AddClass(name);
        return panel;
    };
    const core = add(env.root, "CoreFixture", ["HudCore"]);
    const gameplay = add(core, "gameplay_hud");
    const bindingActions = new Map(), create = $.CreatePanel;
    $.CreatePanel = (type, parent, id, props) => {
        const panel = create(type, parent, id, props);
        if (type === "CitadelBinding") bindingActions.set(panel, props.action);
        return panel;
    };
    return { ...env, Q, $, cfg, feature, add, core, gameplay, reads: () => reads,
        bindingActions,
        overlay: () => gameplay.FindChild("QOLKeyboardOverlayRoot"),
        box: () => gameplay.FindChildTraverse("AllBindingsBox") };
}

test("keyboard keeps both native binding layouts and reacts to geometry/palette/RGB settings without idle config reads", () => {
    const env = setup({ KEYBOARD_OVERLAY_SCALE: 150, KEYBOARD_OVERLAY_X_OFFSET: -1999, KEYBOARD_OVERLAY_Y_OFFSET: -1999, KEYBOARD_OVERLAY_WASH_COLOR: 4 });
    env.feature.onEnable();
    const box = env.box(), base = box.FindChildrenWithClassTraverse("KeyboardLayoutBase")[0], full = box.FindChildrenWithClassTraverse("KeyboardLayoutFull")[0];
    const actions = layout => layout.FindChildrenWithClassTraverse("Key").filter(panel => panel.paneltype === "CitadelBinding").map(panel => env.bindingActions.get(panel));
    assert.deepEqual(actions(base), ["AbilityMelee", "MoveForward", "Attack", "ADS", "Roll", "MoveLeft", "MoveBackwards", "MoveRight", "HeldItem", "Crouch", "Mantle"]);
    assert.deepEqual(actions(full), ["Ability1", "Ability2", "Ability3", "Ability4", "Attack", "ADS", "Scoreboard", "AbilityMelee", "MoveForward", "Cosmetic1", "Reload", "MoveLeft", "MoveBackwards", "MoveRight", "HeldItem", "Roll", "Item1", "Item2", "Item3", "Item4", "Crouch", "ExtraInfo", "Mantle"]);
    assert.equal(base.Children().length, 3); assert.equal(full.Children().length, 5);
    assert.equal(box.style.marginLeft, "150px"); assert.equal(box.style.x, "-1999px"); assert.equal(box.style.y, "1999px");
    assert.equal(base.FindChildrenWithClassTraverse("SpaceKey")[0].style.width, "288px");
    assert.equal(env.overlay().style.washColor, "#ff3b47");
    Object.assign(env.cfg, { ENABLE_FULL_KEYBOARD_LAYOUT: true, KEYBOARD_OVERLAY_SCALE: 70, KEYBOARD_OVERLAY_WASH_COLOR: env.Q.utils.EncodeHexColor("#010203") });
    env.feature.onSettingsChanged();
    assert.equal(box.style.marginLeft, "70px"); assert.equal(full.FindChildrenWithClassTraverse("SpaceKey")[0].style.width, "93px");
    assert.equal(env.overlay().style.washColor, "#010203");
    env.cfg.KEYBOARD_OVERLAY_WASH_COLOR = 0; env.feature.onSettingsChanged();
    assert.equal(env.overlay().style.washColor, undefined);
    env.clock.advance(2000); assert.equal(env.reads(), 3);
    env.feature.onDisable(); env.clock.advance(20); assert.equal(env.overlay(), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard derives owned key sizing roles once per generation while native style validation keeps running", () => {
    const env = setup(); env.feature.onEnable();
    const key = env.box().FindChildrenWithClassTraverse("SpaceKey")[0];
    const hasClass = key.BHasClass.bind(key);
    let sizingReads = 0;
    key.BHasClass = name => {
        if (["TabKey", "SpaceKey", "ShiftKey", "AltKey", "CtrlKey", "EmptyKeyWide"].includes(name)) sizingReads++;
        return hasClass(name);
    };
    key.style.width = "native overwrite";
    env.clock.advance(600);
    assert.equal(key.style.width, "192px", "native readback still repairs overwritten geometry");
    env.cfg.KEYBOARD_OVERLAY_SCALE = 150; env.feature.onSettingsChanged();
    assert.equal(key.style.width, "288px", "the cached role uses current settings");
    assert.equal(sizingReads, 0);
    env.feature.onDisable(); env.clock.advance(20);
    assert.deepEqual(env.clock.errors, []);
});

test("keyboard themes update in place and alternate layouts retain native actions and generation cleanup", () => {
    const env = setup(); env.feature.onEnable();
    const original = env.overlay();
    for (let theme = 0; theme < 8; theme++) {
        env.cfg.KEYBOARD_OVERLAY_THEME = theme; env.feature.onSettingsChanged();
        assert.equal(env.overlay(), original, "theme selection does not recreate native bindings");
        for (let other = 0; other < 8; other++) assert.equal(env.box().BHasClass("QOLKeyboardTheme" + other), other === theme);
    }
    env.cfg.KEYBOARD_OVERLAY_LAYOUT = 1; env.feature.onSettingsChanged(); env.clock.advance(250);
    const compact = env.box().FindChildrenWithClassTraverse("KeyboardLayoutAlternate")[0];
    assert.ok(compact);
    assert.equal(compact.style.width, "120px");
    const actions = () => env.box().FindChildrenWithClassTraverse("Key").map(p => env.bindingActions.get(p));
    assert.ok(actions().includes("MoveForward")); assert.ok(actions().includes("Mantle"));
    assert.equal(actions().includes("Ability1"), false);
    env.cfg.ENABLE_FULL_KEYBOARD_LAYOUT = true; env.feature.onSettingsChanged(); env.clock.advance(250);
    assert.ok(actions().includes("Ability1")); assert.ok(actions().includes("Item4"));
    env.cfg.KEYBOARD_OVERLAY_LAYOUT = 2; env.feature.onSettingsChanged(); env.clock.advance(250);
    const grid = env.box().FindChildrenWithClassTraverse("KeyboardLayoutAlternate")[0];
    assert.equal(grid.style.width, "240px");
    assert.equal(grid.style.height, "160px");
    env.cfg.KEYBOARD_OVERLAY_SCALE = 150; env.feature.onSettingsChanged();
    assert.equal(grid.style.width, "360px"); assert.equal(grid.style.height, "240px");
    assert.equal(compact.IsValid(), false);
    env.cfg.KEYBOARD_OVERLAY_LAYOUT = 0; env.feature.onSettingsChanged(); env.clock.advance(250);
    assert.ok(env.box().FindChildrenWithClassTraverse("KeyboardLayoutFull")[0]);
    env.feature.onDisable(); env.clock.advance(20);
    assert.equal(env.overlay(), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard scopes its shop visibility exception to the selected Customize sample and clears it on expiry", () => {
    const env = setup(); env.feature.onEnable();
    const { Q, root, clock } = env, preview = Q.presentation.preview;
    const canonical = Q.core.ConfigAdapter.exportToFlat();
    const stamp = Q.core.persistence.getConfigChangeStamp(Q.core.persistence.getUIRoot());
    root.AddClass("QOLCustomizeActive"); root.AddClass("gShopOpen");
    const select = id => {
        preview.write(root, {}, "keyboard-sample", stamp, id);
        preview.commit(preview.consume(root, canonical)); clock.advance(250);
    };
    select("ammo"); assert.equal(env.box().BHasClass("QOLCustomizeKeyboardSample"), false);
    select("keyboard"); assert.equal(env.box().BHasClass("QOLCustomizeKeyboardSample"), true);
    select("ammo"); assert.equal(env.box().BHasClass("QOLCustomizeKeyboardSample"), false, "selection change restores native shop visibility CSS");
    select("keyboard"); clock.advance(2600);
    assert.equal(env.box().BHasClass("QOLCustomizeKeyboardSample"), false, "expired lease cannot keep the scoped exception");
    select("keyboard"); preview.clear(root, "keyboard-sample"); clock.advance(250);
    assert.equal(env.box().BHasClass("QOLCustomizeKeyboardSample"), false);
    env.feature.onDisable(); clock.advance(20); assert.equal(env.overlay(), null);
    assert.deepEqual(clock.errors, []);
});

test("keyboard discovers late and replaced native glyphs at unchanged settings and releases glyphs moved out of the overlay", () => {
    const env = setup({ KEYBOARD_OVERLAY_SCALE: 150 }); env.feature.onEnable();
    const binding = env.box().FindChildrenWithClassTraverse("Key").find(panel => panel.paneltype === "CitadelBinding");
    const label = env.add(binding, "KeyboardLetter", [], "Label"), mouse = env.add(binding, "MouseButtonImage", ["MouseButtonGlyph"]);
    label.style.color = "#ABCDEF"; mouse.style.opacity = "0.6";
    env.clock.advance(250);
    assert.equal(label.style.fontSize, "24px"); assert.equal(label.style.lineHeight, "0px");
    assert.equal(mouse.style.width, "30px"); assert.equal(mouse.style.backgroundTextureSize, "30px 30px");
    const retired = env.add(null, "RetiredNativeGlyphs"); label.SetParent(retired); mouse.SetParent(retired);
    const next = env.add(binding, "ModifierCombinerLabel", ["ModifierCombinerLabel"], "Label"); env.clock.advance(250);
    assert.equal(label.style.fontSize, undefined); assert.equal(mouse.style.width, undefined);
    assert.equal(label.style.color, "#ABCDEF"); assert.equal(mouse.style.opacity, "0.6");
    assert.equal(label.IsValid(), true); assert.equal(mouse.IsValid(), true); assert.equal(next.style.fontSize, "24px");
    const role = env.add(binding, "ReusedMouseImage", ["MouseButtonGlyph"]); env.clock.advance(250);
    assert.equal(role.style.width, "30px"); role.RemoveClass("MouseButtonGlyph"); env.clock.advance(250); assert.equal(role.style.width, undefined);
    env.feature.onDisable(); env.clock.advance(20); assert.deepEqual(env.clock.errors, []);
});

test("keyboard retries partial glyph/wash writes and suppresses successful idle writes", () => {
    const env = setup({ KEYBOARD_OVERLAY_WASH_COLOR: 4 }); env.feature.onEnable();
    let reject = true, writes = 0;
    const overlay = env.overlay();
    overlay.style = new Proxy({}, { set(target, key, value) { writes++; if (key === "washColor" && reject) throw Error("native wash pending"); target[key] = value; return true; } });
    env.cfg.KEYBOARD_OVERLAY_WASH_COLOR = 5; env.feature.onSettingsChanged(); assert.equal(overlay.style.washColor, undefined);
    assert.equal(overlay.visible, false);
    const label = env.add(env.box(), "KeyboardLetter", [], "Label");
    label.style = new Proxy({}, { set(target, key, value) { writes++; if (key === "fontSize" && reject) throw Error("native glyph pending"); target[key] = value; return true; } });
    env.clock.advance(250); assert.equal(label.style.fontSize, undefined);
    reject = false; env.clock.advance(250); assert.equal(overlay.style.washColor, "#ff6f61"); assert.equal(label.style.fontSize, "16px");
    assert.equal(overlay.visible, true);
    const stableWrites = writes; env.clock.advance(2000); assert.equal(writes, stableWrites);
    env.feature.onDisable(); env.clock.advance(20); assert.deepEqual(env.clock.errors, []);
});

test("keyboard keeps a failed wash reset hidden until native clearing succeeds", () => {
    const env = setup({ KEYBOARD_OVERLAY_WASH_COLOR: 4 }); env.feature.onEnable();
    const overlay = env.overlay(), clear = overlay.ClearPropertyFromCode.bind(overlay); let reject = true;
    overlay.ClearPropertyFromCode = property => property === "wash-color" && reject ? false : clear(property);
    env.cfg.KEYBOARD_OVERLAY_WASH_COLOR = 0; env.feature.onSettingsChanged();
    assert.equal(overlay.style.washColor, "#ff3b47"); assert.equal(overlay.visible, false);
    reject = false; env.clock.advance(350); assert.equal(overlay.style.washColor, undefined); assert.equal(overlay.visible, true);
    env.feature.onDisable(); env.clock.advance(20); assert.deepEqual(env.clock.errors, []);
});

test("keyboard follows a still-living replacement gameplay owner and then a new HUD", () => {
    const env = setup(); env.feature.onEnable(); const old = env.overlay();
    env.gameplay.SetParent(env.add(null, "RetiredGameplay"));
    const current = env.add(env.core, "gameplay_hud"); env.clock.advance(250);
    assert.equal(old.IsValid(), false); assert.ok(current.FindChild("QOLKeyboardOverlayRoot"));
    const newHud = env.add(null, "Hud", [], "CitadelHud"), newCore = env.add(newHud, "CoreFixture", ["HudCore"]), next = env.add(newCore, "gameplay_hud");
    const previous = current.FindChild("QOLKeyboardOverlayRoot"); env.doc.root = newHud; env.clock.advance(250);
    assert.equal(previous.IsValid(), false); assert.ok(next.FindChild("QOLKeyboardOverlayRoot"));
    env.feature.onDisable(); env.clock.advance(20); assert.equal(next.FindChild("QOLKeyboardOverlayRoot"), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard repairs a missing/reparented owned layout and cleans every moved owned panel on disable", () => {
    const env = setup(); env.feature.onEnable();
    const old = env.overlay(), row = env.box().FindChildrenWithClassTraverse("KeyboardRow")[0];
    const retired = env.add(null, "RetiredOwnPanels"); row.SetParent(retired); env.clock.advance(500);
    assert.equal(old.IsValid(), false); assert.equal(row.IsValid(), false);
    const current = env.overlay(); assert.ok(current); assert.notEqual(current, old);
    const key = env.box().FindChildrenWithClassTraverse("Key")[0]; key.SetParent(retired);
    env.feature.onDisable(); env.clock.advance(20); assert.equal(key.IsValid(), false); assert.equal(current.IsValid(), false);
    env.feature.onSettingsChanged(); env.clock.advance(2000); assert.equal(env.overlay(), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard cleans partial construction before retry and failed registry enable leaves no overlay or callbacks", () => {
    const env = setup(); let reject = true; const create = env.$.CreatePanel;
    env.$.CreatePanel = (type, ...args) => { if (type === "CitadelBinding" && reject) throw Error("binding creation pending"); return create(type, ...args); };
    assert.throws(() => env.feature.onEnable(), /Keyboard overlay panel creation failed/); env.clock.advance(20); assert.equal(env.overlay(), null);
    reject = false; env.feature.onEnable(); assert.ok(env.overlay()); env.feature.onDisable(); env.clock.advance(20);
    reject = true;
    env.Q.core.FeatureRegistry.enable("ql_keyboard");
    env.clock.advance(1000); assert.equal(env.overlay(), null); assert.equal(env.Q.core.FeatureRegistry.isEnabled("ql_keyboard"), false);
    assert.equal(env.Q.core.Scheduler.getWorkSnapshot().some(owner => owner.id === "ql_keyboard"), false);
    reject = false; env.Q.core.FeatureRegistry.enable("ql_keyboard"); assert.equal(env.Q.core.FeatureRegistry.isEnabled("ql_keyboard"), true);
    env.Q.core.FeatureRegistry.disable("ql_keyboard"); env.clock.advance(20); assert.equal(env.overlay(), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard waits for gameplay and ignores obsolete shared caches and helper aliases", () => {
    const env = setup(); env.gameplay.SetParent(env.add(null, "RetiredGameplay"));
    const foreign = env.add(env.root, "ForeignOverlay"); foreign.style.x = "20px";
    env.Q.panelCache.setPanel("keyboardOverlayRoot", foreign); env.Q.panelCache.setPanel("keyboardOverlayBox", foreign);
    env.feature.onEnable(); assert.equal(env.root.FindChild("QOLKeyboardOverlayRoot"), null);
    env.gameplay.SetParent(env.core); env.clock.advance(600); assert.ok(env.overlay());
    for (const key of ["allBindingsBoxes", "keyboardBoxCaches", "keyboardOverlayWashSig"]) assert.equal(Object.hasOwn(env.Q.state, key), false);
    for (const key of ["buildKeyboardOverlayLayouts", "getKeyboardCachedPanels", "resetKeyboardOverlayCaches"]) assert.equal(Object.hasOwn(env.Q, key), false);
    env.feature.onDisable(); env.clock.advance(20); assert.equal(foreign.IsValid(), true); assert.equal(foreign.style.x, "20px"); assert.deepEqual(env.clock.errors, []);
});

test("keyboard retires a foreign previous root and waits for queued deletion during immediate re-enable", () => {
    const env = setup(), old = env.add(env.gameplay, "QOLKeyboardOverlayRoot");
    const child = env.add(old, "PreviousKeyboardChild"); env.feature.onEnable();
    assert.equal(env.overlay(), old); assert.equal(old.visible, false);
    env.clock.advance(350); assert.equal(old.IsValid(), false); assert.equal(child.IsValid(), false);
    const current = env.overlay(); assert.ok(current); assert.equal(current.visible, true);
    env.feature.onDisable(); env.feature.onEnable(); assert.equal(env.overlay(), current); assert.equal(current.visible, false);
    env.clock.advance(350); assert.equal(current.IsValid(), false);
    assert.equal(env.gameplay.Children().filter(panel => panel.id === "QOLKeyboardOverlayRoot").length, 1);
    assert.equal(env.box().FindChildrenWithClassTraverse("KeyboardLayoutBase").length, 1);
    assert.equal(env.box().FindChildrenWithClassTraverse("KeyboardLayoutFull").length, 1);
    env.feature.onDisable(); env.clock.advance(20); env.feature.onSettingsChanged(); env.clock.advance(600);
    assert.equal(env.overlay(), null); assert.deepEqual(env.clock.errors, []);
});

test("keyboard retries moved created-child deletion while preserving moved native glyph content", () => {
    const env = setup({ KEYBOARD_OVERLAY_SCALE: 150 }); env.feature.onEnable();
    const key = env.box().FindChildrenWithClassTraverse("Key").find(panel => panel.paneltype === "CitadelBinding");
    const glyph = env.add(key, "KeyboardLetter", [], "Label"); glyph.style.color = "#ABCDEF";
    env.clock.advance(350); assert.equal(glyph.style.fontSize, "24px");
    const detached = env.add(null, "MovedKeyboardContent"); glyph.SetParent(detached); key.SetParent(detached);
    const remove = key.DeleteAsync.bind(key); let reject = true;
    key.DeleteAsync = delay => { if (reject) throw Error("modeled created-key deletion failure"); remove(delay); };
    env.clock.advance(700);
    assert.equal(key.IsValid(), true); assert.equal(key.visible, false); assert.ok(env.overlay());
    assert.equal(glyph.IsValid(), true); assert.equal(glyph.style.fontSize, undefined); assert.equal(glyph.style.color, "#ABCDEF");
    reject = false; env.clock.advance(350); assert.equal(key.IsValid(), false); assert.equal(glyph.IsValid(), true);
    env.feature.onDisable(); env.clock.advance(20); assert.deepEqual(env.clock.errors, []);
});

test("keyboard rejects a loading-root gameplay lookalike and mounts only the current real HUD", () => {
    const env = setup(); env.feature.onEnable(); const old = env.overlay();
    env.doc.root = env.add(null, "LoadingRoot");
    const loadingCore = env.add(env.doc.root, "", ["HudCore"]), loadingGameplay = env.add(loadingCore, "gameplay_hud");
    env.clock.advance(350); assert.equal(old.IsValid(), false); assert.equal(loadingGameplay.FindChild("QOLKeyboardOverlayRoot"), null);
    const root = env.add(null, "Hud", [], "CitadelHud"), core = env.add(root, "", ["HudCore"]), gameplay = env.add(core, "gameplay_hud");
    env.doc.root = root; env.clock.advance(350);
    assert.ok(gameplay.FindChild("QOLKeyboardOverlayRoot")); assert.equal(env.root.IsValid(), true); assert.equal(env.overlay(), null);
    env.feature.onDisable(); env.clock.advance(20); assert.equal(gameplay.FindChild("QOLKeyboardOverlayRoot"), null);
    assert.deepEqual(env.clock.errors, []);
});

test("keyboard scales native glyphs below the original size and accepts the common upper scale", () => {
    const env = setup({ KEYBOARD_OVERLAY_SCALE: 50 }); env.feature.onEnable();
    const binding = env.box().FindChildrenWithClassTraverse("Key")[0];
    const label = env.add(binding, "KeyboardLetter", [], "Label");
    const mouse = env.add(binding, "MouseButtonImage", ["MouseButtonGlyph"]);
    env.clock.advance(250);
    assert.equal(label.style.fontSize, "8px"); assert.equal(mouse.style.width, "10px");
    env.cfg.KEYBOARD_OVERLAY_SCALE = 300; env.feature.onSettingsChanged();
    assert.equal(label.style.fontSize, "48px"); assert.equal(mouse.style.width, "60px");
    env.feature.onDisable(); assert.deepEqual(env.clock.errors, []);
});
