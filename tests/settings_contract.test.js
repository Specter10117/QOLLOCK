"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
test("every known setting and presentation property has explicit semantics", () => {
    const { global: g, hud } = load();
    for (const key of Object.keys(g.QOL_DEFAULT_CONFIG)) {
        const field = g.QOL.settings.get(key);
        assert.ok(field, key);
        assert.ok(["number", "toggle", "color", "text"].includes(field.kind), key);
        assert.equal(typeof field.unit, "string");
        assert.ok(field.displayFactor > 0);
        assert.notEqual(g.QOL.settings.normalize(key, g.QOL_DEFAULT_CONFIG[key]), null, key);
        assert.equal(JSON.stringify(field), JSON.stringify(hud.sandbox.global.QOL.settings.get(key)));
    }
    assert.equal(g.QOL.settings.get("DEFAULT_HERO_INDEX"), null);
});
test("caption changes cannot change property units, percentages or runtime ownership", () => {
    const env = load(); const g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    const element = g.QOL.presentation.elements.find(e => e.id === "topBar");
    const alpha = element.fields.find(f => f.key === "TOP_BAR_OPACITY");
    alpha.label = "Color";
    g.QOL.ui.customize.start(null, {elementId: "topBar"});
    const input = env.em.FindChildTraverse("QOLCustomize_TOP_BAR_OPACITY");
    assert.equal(input.text, "100");
    input.text = "55"; input._fire("oninputsubmit");
    env.em.FindChildTraverse("QOLCustomizeApply")._fire("onactivate");
    assert.equal(g.MOD_CONFIG.TOP_BAR_OPACITY, .55);
});

test("catalog runtime owners match actual manifest declarations including multi-toggle children", () => {
    const { hud } = load(), Q = hud.sandbox.global.QOL;
    for (const field of Q.settingsFields) for (const id of field.owners) {
        const manifest = Q.core.FeatureRegistry.getManifest(id);
        assert.ok(manifest, field.key + ":" + id);
        assert.ok(manifest.settings.some(setting => setting.key === field.key ||
            setting.options?.some(option => option.key === field.key)), field.key + ":" + id);
    }
});

test("independent damage font and Fountain sliders publish and share intermediate sizes", () => {
    const env = load(), g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    g.QOL.ui.gameplayTabs.renderCrosshairTab(env.list);
    const row = env.em.FindChildrenWithClassTraverse("SettingRow_DAMAGE_FOUNTAIN_SIZE")[0];
    const input = row.FindChildrenWithClassTraverse("ValueInput")[0];
    const slider = row.FindChildrenWithClassTraverse("HorizontalSlider")[0];
    assert.ok(slider);
    const font = env.em.FindChildrenWithClassTraverse("SettingRow_HUD_INDICATOR_SIZE")[0]
        .FindChildrenWithClassTraverse("ValueInput")[0];
    font.text = "32"; font._fire("oninputsubmit");
    for (const size of [0.5, 1.27, 3, 1]) {
        slider.value = size * 100;
        slider._fire("onvaluechanged"); env.clock.advance(1200);
        assert.equal(input.text, size * 100 + "%");
        assert.equal(g.MOD_CONFIG.DAMAGE_FOUNTAIN_SIZE, size);
        assert.equal(g.MOD_CONFIG.HUD_INDICATOR_SIZE, 32);
        assert.equal(env.hud.sandbox.global.QOL.core.ConfigAdapter.exportToFlat().DAMAGE_FOUNTAIN_SIZE, size);
        const raw = g.QOL.persistence.serializeSettings(g.MOD_CONFIG);
        const parsed = env.hud.sandbox.global.QOL.core.codec.deserializeSettings(raw);
        assert.equal(parsed.DAMAGE_FOUNTAIN_SIZE, size);
    }
    input.text = "135%"; input._fire("oninputsubmit");
    assert.equal(g.MOD_CONFIG.DAMAGE_FOUNTAIN_SIZE, 1.35);
    input.text = "broken"; input._fire("oninputsubmit");
    assert.equal(g.MOD_CONFIG.DAMAGE_FOUNTAIN_SIZE, 1.35);
    assert.equal(g.QOL.settings.normalize("DAMAGE_FOUNTAIN_SIZE", "broken"), null);
    assert.equal(g.QOL.settings.readNumber("DAMAGE_FOUNTAIN_SIZE", 99), 3);
});

test("keyboard dropdowns preserve legacy Full Keys and publish/share all themes and layouts", () => {
    const env = load(), g = env.global;
    const legacy = g.MergeConfig({ ENABLE_FULL_KEYBOARD_LAYOUT: 1 });
    assert.equal(legacy.KEYBOARD_OVERLAY_THEME, 0);
    assert.equal(legacy.KEYBOARD_OVERLAY_LAYOUT, 0);
    assert.equal(legacy.ENABLE_FULL_KEYBOARD_LAYOUT, 1);
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    g.QOL.ui.gameplayTabs.renderOverlayTab(env.list);
    for (const [key, count] of [["KEYBOARD_OVERLAY_THEME", 8], ["KEYBOARD_OVERLAY_LAYOUT", 3]]) {
        const dropdown = env.em.FindChildTraverse(key + "_dropdown"); assert.ok(dropdown);
        for (let value = count - 1; value >= 0; value--) {
            dropdown.SetSelected(key + "_opt_" + value); dropdown._fire("oninputsubmit"); env.clock.advance(1200);
            assert.equal(g.MOD_CONFIG[key], value);
            assert.equal(env.hud.sandbox.global.QOL.core.ConfigAdapter.exportToFlat()[key], value);
            const raw = g.QOL.persistence.serializeSettings(g.MOD_CONFIG);
            assert.equal(env.hud.sandbox.global.QOL.core.codec.deserializeSettings(raw)[key], value);
        }
        assert.equal(g.QOL.settings.normalize(key, "broken"), null);
    }
});
