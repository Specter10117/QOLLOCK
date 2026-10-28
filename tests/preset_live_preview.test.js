"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

function setup() {
    const e = load();
    e.global.QOL.ui.window.setOpen(true);
    e.clock.advance(1000);
    return e;
}
function click(e, id) {
    const panel = e.em.FindChildTraverse(id);
    assert.ok(panel, id);
    panel.activate();
    assert.deepEqual(e.doc.eventErrors, []);
}
function open(e) {
    const g = e.global;
    g.QOL_PRESETS.LiveTest = { SOULS_X_OFFSET: 125, ENABLE_COMPASS: 1, MINIMAP_LARGE_SIZE: 600 };
    g.QOL.ui.presets.createPresetGrid(e.list, "Presets", [{ label: "Live Test", preset: "LiveTest" }], 1, "base");
    e.list.FindChildrenWithClassTraverse("PresetGridBtn").at(-1).activate();
    e.clock.advance(20);
    click(e, "ConfigDiffPreviewBtn");
}
function offset(e) {
    return e.hud.sandbox.global.QOL.core.ConfigStore.get("ql_souls", "SOULS_X_OFFSET");
}

test("preset Preview delivers full settings to the real HUD without canonical publication; Back restores it", () => {
    const e = setup(), g = e.global;
    const before = JSON.stringify(g.MOD_CONFIG);
    const stamp = g.QOL.core.persistence.getConfigChangeStamp(g.QOL.core.persistence.getUIRoot());
    open(e);
    e.clock.advance(650);
    assert.equal(offset(e), 125);
    assert.equal(e.hud.sandbox.global.QOL.core.ConfigStore.get("ql_compass", "ENABLE_COMPASS"), true);
    assert.equal(e.hud.sandbox.global.QOL.core.ConfigStore.get("ql_minimap_timers", "MINIMAP_LARGE_SIZE"), 600);
    assert.equal(JSON.stringify(g.MOD_CONFIG), before);
    assert.equal(e.hud.sandbox.global.State.lastConfig.SOULS_X_OFFSET, 0);
    assert.equal(g.QOL.core.persistence.getConfigChangeStamp(g.QOL.core.persistence.getUIRoot()), stamp);
    assert.equal(e.em.FindChildTraverse("SettingsWindow").BHasClass("QOLCustomizeHidden"), true);
    click(e, "QOLPresetPreviewBack");
    e.clock.advance(650);
    assert.equal(offset(e), 0);
    assert.equal(g.QOL.ui.presetPreview.isRunning(), false);
    assert.equal(e.em.FindChildTraverse("SettingsWindow").BHasClass("QOLCustomizeHidden"), false);
    assert.ok(e.em.FindChildTraverse("ConfigDiffPreviewModalOverlay").BHasClass("Show"));
    assert.equal(JSON.stringify(g.MOD_CONFIG), before);
    assert.deepEqual(e.clock.errors, []);
});

test("HUD replacement retires a living old owner's lease and preview chrome", () => {
    const e = setup(), q = e.global.QOL;
    open(e);
    e.clock.advance(650);
    const old = e.hud.root;
    old.id = "OldHud";
    old.paneltype = "Panel";
    const replacement = e.doc.create("CitadelHud", { id: "Hud" });
    e.doc.root.addChild(replacement);
    e.clock.advance(450);
    assert.equal(q.ui.presetPreview.isRunning(), false);
    assert.equal(old.GetAttributeString("QOL_CUSTOMIZE_DRAFT", ""), "");
    assert.equal(old.BHasClass("QOLCustomizeLiveHud"), false);
    assert.equal(old.BHasClass("QOLCustomizeActive"), false);
    assert.equal(replacement.GetAttributeString("QOL_CUSTOMIZE_DRAFT", ""), "");
    assert.equal(e.em.FindChildTraverse("QOLPresetPreview"), null);
    assert.deepEqual(e.clock.errors, []);
});

test("competing visual tools cannot replace a preset lease; they work again after Back", () => {
    const e = setup(), q = e.global.QOL;
    open(e);
    assert.equal(q.ui.customize.start(), false);
    assert.equal(q.ui.visualCheck.start(), false);
    click(e, "QOLPresetPreviewBack");
    e.clock.advance(100);
    assert.equal(q.ui.customize.start(), true);
    assert.equal(q.ui.presetPreview.start({}), false);
    q.ui.customize.stop();
    assert.deepEqual(e.clock.errors, []);
});

test("personal preset Load exposes the same live preview without writing its saved snapshot", async () => {
    const e = setup(), g = e.global, q = g.QOL;
    const disk = new Map();
    q.core.storageBridge = {
        load: async key => disk.get(key) ?? null,
        save: async (key, value) => { disk.set(key, value); }
    };
    await q.ui.presets.savePersonalPreset("My HUD", { ...g.MOD_CONFIG, SOULS_X_OFFSET: 180 });
    q.ui.presets.renderPresetsTab(e.list);
    await require("node:timers/promises").setImmediate();
    e.list.FindChildrenWithClassTraverse("PersonalPresetLoad").at(-1).activate();
    e.clock.advance(20);
    const before = JSON.stringify([...disk]);
    click(e, "ConfigDiffPreviewBtn");
    e.clock.advance(650);
    assert.equal(offset(e), 180);
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 0);
    click(e, "QOLPresetPreviewBack");
    e.clock.advance(650);
    assert.equal(offset(e), 0);
    assert.equal(JSON.stringify([...disk]), before);
    assert.deepEqual(e.clock.errors, []);
});

test("Apply in the live preview commits through the existing preset path once", () => {
    const e = setup(), g = e.global;
    open(e);
    e.clock.advance(650);
    click(e, "QOLPresetPreviewApply");
    e.clock.advance(650);
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 125);
    assert.equal(g.MOD_CONFIG.ENABLE_COMPASS, 1);
    assert.equal(offset(e), 125);
    assert.equal(g.QOL.ui.presetPreview.isRunning(), false);
    assert.equal(e.em.FindChildTraverse("ConfigDiffPreviewModalOverlay"), null);
    assert.equal(e.hud.root.BHasClass("QOLCustomizeLiveHud"), false);
    assert.deepEqual(e.clock.errors, []);
});

test("Escape returns from preview before closing settings and a second preview can start", () => {
    const e = setup(), q = e.global.QOL;
    open(e);
    const overlay = e.em.FindChildTraverse("QOLPresetPreview");
    assert.equal(overlay.acceptsfocus, true, "the live overlay must accept native keyboard focus");
    assert.equal(overlay._fire("oncancel"), true);
    assert.equal(q.ui.presetPreview.isRunning(), false);
    assert.equal(q.ui.window.isOpen(), true);
    e.clock.advance(300);
    click(e, "ConfigDiffPreviewBtn");
    e.clock.advance(650);
    assert.equal(offset(e), 125);
    q.ui.window.forceCloseModSettings(true);
    e.clock.advance(650);
    assert.equal(q.ui.presetPreview.isRunning(), false);
    assert.equal(offset(e), 0);
    assert.equal(e.hud.root.BHasClass("QOLCustomizeActive"), false);
    assert.deepEqual(e.clock.errors, []);
});

test("newer canonical edits invalidate the preview and cannot be overwritten by a stale Apply", () => {
    const e = setup(), g = e.global;
    open(e);
    const apply = e.em.FindChildTraverse("QOLPresetPreviewApply");
    g.MOD_CONFIG.SOULS_X_OFFSET = 77;
    g.SaveAndSync();
    apply.activate();
    e.clock.advance(700);
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 77);
    assert.equal(offset(e), 77);
    assert.equal(g.QOL.ui.presetPreview.isRunning(), false);
    assert.deepEqual(e.clock.errors, []);
});

test("preset preview refuses a menu without gameplay HUD and leaves the diff usable", () => {
    const e = setup(), g = e.global;
    e.hud.sandbox.global.QOL.core.App.shutdown();
    e.hud.root.id = "MenuOnly";
    e.hud.root.paneltype = "Panel";
    open(e);
    assert.equal(g.QOL.ui.presetPreview.isRunning(), false);
    assert.equal(e.em.FindChildTraverse("SettingsWindow").BHasClass("QOLCustomizeHidden"), false);
    assert.match(e.em.FindChildTraverse("ConfigDiffPreviewHint").text, /match or sandbox/);
    assert.deepEqual(e.clock.errors, []);
});

test("the full-preset lease does not relax Customize's field whitelist", () => {
    const e = setup(), q = e.hud.sandbox.global.QOL;
    q.core.App.shutdown();
    const preview = q.presentation.preview, root = e.hud.root;
    root.AddClass("QOLCustomizeActive");
    const stamp = q.core.persistence.getConfigChangeStamp(q.getUIRoot());
    preview.write(root, { MINIMAP_LARGE_SIZE: 600 }, "ordinary", stamp);
    const layer = preview.consume(root, q.buildDefaultConfig());
    preview.commit(layer);
    assert.equal(preview.ack(root), "");
    preview.writePreset(root, { MINIMAP_LARGE_SIZE: 600, UNKNOWN: 1 }, "bad", stamp);
    preview.commit(preview.consume(root, q.buildDefaultConfig()));
    assert.equal(preview.ack(root), "");
    preview.writePreset(root, { UNKNOWN: null }, "null-key", stamp);
    preview.commit(preview.consume(root, q.buildDefaultConfig()));
    assert.equal(preview.ack(root), "", "an unknown null value is not a valid normalized setting");
    preview.writePreset(root, { MINIMAP_LARGE_SIZE: 600 }, "good", stamp);
    preview.commit(preview.consume(root, q.buildDefaultConfig()));
    assert.equal(preview.ack(root), "good");
    assert.equal(preview.effective({}).MINIMAP_LARGE_SIZE, 600);
    e.clock.advance(2600);
    preview.commit(preview.consume(root, q.buildDefaultConfig()));
    assert.equal(preview.ack(root), "");
    assert.deepEqual(e.clock.errors, []);
});

test("preview copy localizes on Presets and an untranslated locale falls back without translating names", () => {
    for (const [language, caption, back] of [[0, "Preview preset", "Back"], [1, "Предпросмотр", "Назад"], [13, "Preview preset", "Back"]]) {
        const e = setup(), g = e.global;
        g.MOD_CONFIG.LANGUAGE = language;
        g.SaveAndSync();
        g.currentTab = "Presets";
        open(e);
        assert.equal(e.em.FindChildTraverse("ConfigDiffPreviewBtn").GetChild(0).text, caption);
        assert.equal(e.em.FindChildTraverse("QOLPresetPreviewBack").GetChild(0).text, back);
        assert.equal(e.em.FindChildrenWithClassTraverse("QOLPresetPreviewName")[0].text, "Live Test");
        click(e, "QOLPresetPreviewBack");
        assert.deepEqual(e.clock.errors, []);
    }
});

test("partial preview construction failure retires panels and allows retry without changing settings", () => {
    const e = setup(), g = e.global, p = g.QOL.core.panel;
    const create = p.create;
    const before = JSON.stringify(g.MOD_CONFIG);
    p.create = (type, parent, ...args) => parent?.id === "QOLPresetPreviewBar" && type === "Label" ? null : create(type, parent, ...args);
    open(e);
    assert.equal(g.QOL.ui.presetPreview.isRunning(), false);
    assert.equal(e.em.BHasClass("QOLCustomizeActive"), false);
    assert.equal(e.hud.root.BHasClass("QOLCustomizeActive"), false);
    assert.equal(JSON.stringify(g.MOD_CONFIG), before);
    p.create = create;
    e.clock.advance(100);
    assert.equal(e.em.FindChildTraverse("QOLPresetPreview"), null);
    click(e, "ConfigDiffPreviewBtn");
    e.clock.advance(650);
    assert.equal(offset(e), 125);
    click(e, "QOLPresetPreviewBack");
    assert.deepEqual(e.clock.errors, []);
});
