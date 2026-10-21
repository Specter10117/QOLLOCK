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

test("Fountain dropdown publishes and JSON import retains its selected size", () => {
    const env = load(), g = env.global;
    g.QOL.ui.window.setOpen(true); env.clock.advance(500);
    g.QOL.ui.gameplayTabs.renderCrosshairTab(env.list);
    const dropdown = env.em.FindChildTraverse("DAMAGE_FOUNTAIN_SIZE_dropdown");
    assert.ok(dropdown);
    for (const size of [0, 2, 1]) {
        dropdown.SetSelected("DAMAGE_FOUNTAIN_SIZE_opt_" + size);
        dropdown._fire("oninputsubmit"); env.clock.advance(1200);
        assert.equal(g.MOD_CONFIG.DAMAGE_FOUNTAIN_SIZE, size);
        assert.equal(env.hud.sandbox.global.QOL.core.ConfigAdapter.exportToFlat().DAMAGE_FOUNTAIN_SIZE, size);
        const raw = g.QOL.persistence.serializeSettings(g.MOD_CONFIG);
        const parsed = env.hud.sandbox.global.QOL.core.codec.deserializeSettings(raw);
        assert.equal(parsed.DAMAGE_FOUNTAIN_SIZE, size);
    }
    assert.equal(g.QOL.settings.normalize("DAMAGE_FOUNTAIN_SIZE", "broken"), null);
    assert.equal(g.QOL.settings.readNumber("DAMAGE_FOUNTAIN_SIZE", 99), 2);
});
