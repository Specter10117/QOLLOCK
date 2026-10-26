"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const loadSettings = require("./load_settings_environment");
const { setImmediate: flush } = require("node:timers/promises");

// Native storage and rendering are modeled; exercise the production settings owner.
function setup(disk = new Map()) {
    const e = loadSettings(), g = e.global, Q = g.QOL;
    e.hud.sandbox.global.QOL.core.App.shutdown();
    Q.core.storageBridge = {
        load: async key => disk.get(key) ?? null,
        save: async (key, value) => { disk.set(key, value); }
    };
    return Object.assign(e, { Q, p: Q.ui.presets, disk });
}

test("personal presets persist independent named snapshots and require explicit replacement", async () => {
    const e = setup(), g = e.global;
    g.MOD_CONFIG.SOULS_X_OFFSET = 123;
    await e.p.savePersonalPreset("  Мой HUD  ", g.MOD_CONFIG);
    g.MOD_CONFIG.SOULS_X_OFFSET = 456;
    await assert.rejects(e.p.savePersonalPreset("мой hud", g.MOD_CONFIG));
    let entries = await e.p.readPersonalPresets();
    assert.equal(entries[0].name, "Мой HUD");
    assert.equal(e.Q.parseStoredConfig(entries[0].raw).SOULS_X_OFFSET, 123);
    await e.p.savePersonalPreset("мой hud", g.MOD_CONFIG, true);
    entries = await setup(e.disk).p.readPersonalPresets();
    assert.equal(entries.length, 1);
    assert.equal(e.Q.parseStoredConfig(entries[0].raw).SOULS_X_OFFSET, 456);
    await e.p.deletePersonalPreset(entries[0].name);
    assert.equal((await e.p.readPersonalPresets()).length, 0);
    assert.equal(e.disk.has("qollock_settings"), false, "personal collection never replaces the main settings save");
});

test("personal presets reject invalid names, corrupt storage and failed writes without changing live config", async () => {
    const e = setup(), before = JSON.stringify(e.global.MOD_CONFIG);
    await assert.rejects(e.p.savePersonalPreset(" ", e.global.MOD_CONFIG));
    await assert.rejects(e.p.savePersonalPreset("x\ny", e.global.MOD_CONFIG));
    await e.p.savePersonalPreset("Good", e.global.MOD_CONFIG);
    const saved = Array.from(e.disk.values())[0];
    e.Q.core.storageBridge.save = async () => { throw Error("quota"); };
    await assert.rejects(e.p.savePersonalPreset("Other", e.global.MOD_CONFIG), /quota/);
    assert.equal(Array.from(e.disk.values())[0], saved);
    e.Q.core.storageBridge.load = async () => '[{"name":"Bad","raw":"broken"}]';
    await assert.rejects(e.p.readPersonalPresets());
    assert.equal(JSON.stringify(e.global.MOD_CONFIG), before);
});

test("personal preset UI loads only on confirmation and preserves live UI preferences", async () => {
    const e = setup(), g = e.global;
    g.MOD_CONFIG.SOULS_X_OFFSET = 123;
    await e.p.savePersonalPreset("My HUD", g.MOD_CONFIG);
    g.MOD_CONFIG.SOULS_X_OFFSET = 456;
    g.MOD_CONFIG.DRAG_ENABLED = 0;
    g.MOD_CONFIG.PREVIEWS_ENABLED = 0;
    let preview;
    g.OpenConfigDiffPreviewModal = options => { preview = options; };
    e.p.renderPresetsTab(e.list);
    await flush();
    const section = e.list.FindChildTraverse("PersonalPresetsSection");
    section.FindChildrenWithClassTraverse("PersonalPresetLoad")[0].activate();
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 456);
    assert.ok(preview.rows.some(row => row.key === "SOULS_X_OFFSET"));
    assert.equal(preview.onApply(), true);
    assert.equal(g.MOD_CONFIG.SOULS_X_OFFSET, 123);
    assert.equal(g.MOD_CONFIG.DRAG_ENABLED, 0);
    assert.equal(g.MOD_CONFIG.PREVIEWS_ENABLED, 0);
    assert.deepEqual(e.clock.errors, []);
});

test("personal UI waits for acknowledgment, confirms replacement/deletion and ignores retired views", async () => {
    const e = setup(), g = e.global;
    e.p.renderPresetsTab(e.list);
    await flush();
    const section = e.list.FindChildTraverse("PersonalPresetsSection");
    const input = section.FindChildTraverse("PersonalPresetName");
    input.text = "Mine";
    let acknowledge;
    e.Q.core.storageBridge.save = (key, value) => new Promise(resolve => {
        acknowledge = () => { e.disk.set(key, value); resolve(); };
    });
    section.FindChildTraverse("PersonalPresetSave").activate();
    await flush();
    assert.equal(section.FindChildrenWithClassTraverse("PersonalPresetLoad").length, 0);
    assert.equal(section.FindChildTraverse("PersonalPresetSave").enabled, false);
    acknowledge();
    await flush();
    assert.equal(section.FindChildrenWithClassTraverse("PersonalPresetLoad").length, 1);
    assert.equal(section.FindChildTraverse("PersonalPresetsStatus").text, "Personal preset saved.");
    const original = Array.from(e.disk.values())[0];
    g.MOD_CONFIG.SOULS_X_OFFSET = 300;
    section.FindChildrenWithClassTraverse("PersonalPresetReplace")[0].activate();
    const confirmation = section.FindChildTraverse("PersonalPresetConfirmation");
    assert.equal(confirmation.visible, true);
    confirmation.FindChildrenWithClassTraverse("PersonalPresetCancel")[0].activate();
    assert.equal(Array.from(e.disk.values())[0], original);
    section.FindChildrenWithClassTraverse("PersonalPresetReplace")[0].activate();
    g.MOD_CONFIG.SOULS_X_OFFSET = 600;
    confirmation.FindChildrenWithClassTraverse("PersonalPresetConfirm")[0].activate();
    await flush();
    await assert.rejects(e.p.deletePersonalPreset("Mine"), /already in progress/);
    acknowledge();
    await flush();
    const replaced = Array.from(e.disk.values())[0];
    assert.equal(e.Q.parseStoredConfig(JSON.parse(replaced)[0].raw).SOULS_X_OFFSET, 300, "replacement captures the click before confirmation");
    section.FindChildrenWithClassTraverse("PersonalPresetDelete")[0].activate();
    assert.equal(confirmation.visible, true);
    confirmation.FindChildrenWithClassTraverse("PersonalPresetConfirm")[0].activate();
    await flush();
    assert.equal(Array.from(e.disk.values())[0], replaced, "deletion also waits for acknowledgment");
    acknowledge();
    await flush();
    assert.equal((await e.p.readPersonalPresets()).length, 0);
    assert.equal(section.FindChildrenWithClassTraverse("PersonalPresetLoad").length, 0);

    let finishRead;
    e.Q.core.storageBridge.load = () => new Promise(resolve => { finishRead = resolve; });
    e.p.renderPresetsTab(e.list);
    const retired = e.list.Children().at(-1);
    e.list.RemoveAndDeleteChildren();
    finishRead(original);
    await flush();
    assert.equal(retired.IsValid(), false);
    assert.deepEqual(e.clock.errors, []);
    assert.deepEqual(e.doc.eventErrors, []);
});

test("personal UI localizes English/Russian, falls back for missing locales, and keeps names as data", async () => {
    const e = setup(), g = e.global;
    await e.p.savePersonalPreset("Cancel", g.MOD_CONFIG);
    for (const [language, title, load] of [
        [0, "Personal Presets", "Load"], [1, "Личные пресеты", "Загрузить"], [13, "Personal Presets", "Load"]
    ]) {
        g.MOD_CONFIG.LANGUAGE = language;
        e.list.RemoveAndDeleteChildren();
        e.p.renderPresetsTab(e.list);
        await flush();
        const section = e.list.FindChildTraverse("PersonalPresetsSection");
        assert.equal(section.FindChildrenWithClassTraverse("SectionTitle")[0].text, title);
        assert.equal(section.FindChildrenWithClassTraverse("PersonalPresetLoad")[0].Children()[0].text, load);
        assert.equal(section.FindChildrenWithClassTraverse("PersonalPresetTitle").at(-1).text, "Cancel");
    }
});

test("failed initial read disables saving and stale load confirmations cannot apply", async () => {
    const e = setup(), g = e.global;
    await e.p.savePersonalPreset("Mine", g.MOD_CONFIG);
    let preview;
    g.OpenConfigDiffPreviewModal = options => { preview = options; };
    e.p.renderPresetsTab(e.list);
    await flush();
    e.list.FindChildrenWithClassTraverse("PersonalPresetLoad")[0].activate();
    e.list.RemoveAndDeleteChildren();
    const before = JSON.stringify(g.MOD_CONFIG);
    assert.equal(preview.onApply(), false);
    assert.equal(JSON.stringify(g.MOD_CONFIG), before);
    e.Q.core.storageBridge.load = async () => { throw Error("offline"); };
    e.p.renderPresetsTab(e.list);
    await flush();
    assert.equal(e.list.FindChildTraverse("PersonalPresetSave").enabled, false);
    assert.equal(e.list.FindChildTraverse("PersonalPresetsStatus").BHasClass("FailureState"), true);
});
