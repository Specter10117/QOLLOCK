"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function fixture(id, overrides) {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    const { $, QOL: Q } = hud.sandbox.global;
    Q.core.App.shutdown();
    Q.core.ConfigAdapter.loadFromFlat({ ...Q.buildDefaultConfig(), ...overrides });
    const config = Q.core.ConfigStore.view(id);
    const feature = Q.core.FeatureRegistry.getManifest(id).create({ events: Q.core.EventBus, id, config: { view: () => config } });
    const add = (parent, panelId, classes = [], type = "Panel") => {
        const panel = $.CreatePanel(type, parent, panelId);
        for (const cls of classes) panel.AddClass(cls);
        return panel;
    };
    const core = add(hud.root, "", ["HudCore"]);
    add(core, "gameplay_hud");
    return { hud, Q, $, feature, add, core };
}

test("unsecured timer reads only its native owner and follows late and living replacement sources without broad probes", () => {
    const env = fixture("ql_unsecured_souls_timer", { ENABLE_UNSECURED_SOUL_TIMER: 1 });
    const stats = env.add(env.core, "StatsAndModsContainer");
    const lower = env.add(stats, "LowerLeft");
    const native = value => {
        const gold = env.add(lower, "gold_and_ap_container");
        const body = env.add(gold, "hudGoldContainer");
        const container = env.add(body, "", ["hudDeathGoldContainer"]);
        const amount = env.add(container, "hudDeathGoldLabel", ["death_penalty_gold"], "Label");
        amount.text = value;
        return { gold, amount };
    };
    // Deliberate decoys: these are not evidence of alternative native layouts.
    env.add(env.hud.root, "HudUnsecuredLabel", [], "Label").text = "500";
    env.add(env.hud.root, "hudDeathGoldLabel", ["death_penalty_gold"], "Label").text = "800";
    const traverse = env.hud.root.FindChildTraverse;
    const broadProbes = [];
    env.hud.root.FindChildTraverse = function (id) {
        if (["HudUnsecuredLabel", "hudDeathGoldLabel", "gold_and_ap_container"].includes(id)) broadProbes.push(id);
        return traverse.call(this, id);
    };
    env.feature.onEnable(); env.hud.clock.advance(1200);
    const state = () => env.hud.root.FindChildTraverse("QOLUnsecuredSoulsState");
    assert.equal(state().text, "--", "unrelated labels cannot provide a fallback amount");
    const first = native("1000"); env.hud.clock.advance(200);
    assert.equal(state().text, "256s", "late native owner is discovered on the next tick");
    first.amount.text = "980"; env.hud.clock.advance(400);
    assert.equal(state().text, "253s");
    first.gold.SetParent(env.add(env.hud.root, "RetiredGold"));
    const replacement = native("500"); env.hud.clock.advance(200);
    assert.equal(state().text, "174s", "live old owners cannot leak their conversion deadline");
    replacement.amount.SetParent(env.add(replacement.gold, "RetiredLabels"));
    env.hud.clock.advance(200);
    assert.equal(state().text, "--", "a moved label within the same gold owner is no longer the amount");
    replacement.gold.DeleteAsync(0); env.hud.clock.advance(1200);
    assert.equal(state().text, "--");
    assert.deepEqual(broadProbes, []);
    env.feature.onDisable(); env.hud.clock.advance(20);
    assert.equal(state(), null); assert.deepEqual(env.hud.clock.errors, []);
});

test("target scope follows native host replacement without probing or styling external shapes", () => {
    const env = fixture("ql_target_shapes", { UNIT_TARGET_SIZE: 200, UNIT_TARGET_HINT_SIZE: 140 });
    const { hud, $, add, core, feature } = env;
    const gameplay = core.FindChild("gameplay_hud");
    const alive = add(gameplay, "gameplay_hud_alive");
    const crosshair = add(alive, "crosshair");
    const host = add(crosshair, "unit_target_container");
    const native = parent => {
        const instance = add(parent, "", ["unit_target_instance"]);
        const unscaled = add(instance, "unscaled_panel");
        const hint = add(unscaled, "hint_container");
        const scaled = add(unscaled, "scaled_panel");
        const shape = add(scaled, "", ["target_shape"]);
        const scaledHint = add(scaled, "hint_container");
        return { instance, hint, shape, scaledHint };
    };
    const old = native(host);
    const enumerate = hud.root.FindChildrenWithClassTraverse;
    const probes = [];
    hud.root.FindChildrenWithClassTraverse = function (name) {
        if (["target_shape", "unit_target_instance"].includes(name)) probes.push(name);
        return enumerate.call(this, name);
    };
    feature.onEnable();
    assert.equal(old.shape.style.uiScale, "200%");
    assert.equal(old.hint.style.uiScale, "140%");
    assert.equal(old.scaledHint.style.uiScale, "140%");

    const retired = add(hud.root, "RetiredTargetHost");
    host.SetParent(retired);
    hud.clock.advance(600);
    assert.equal(old.shape.style.uiScale, undefined, "a living host moved elsewhere in the same HUD is retired");
    assert.equal(old.hint.style.uiScale, undefined);
    const replacement = native(add(crosshair, "unit_target_container"));
    hud.clock.advance(1200);
    assert.equal(old.shape.style.uiScale, undefined);
    assert.equal(old.hint.style.uiScale, undefined);
    assert.equal(replacement.shape.style.uiScale, "200%");
    assert.equal(replacement.hint.style.uiScale, "140%");

    replacement.shape.RemoveClass("target_shape");
    hud.clock.advance(250);
    assert.equal(replacement.shape.style.uiScale, undefined);
    const external = add(hud.root, "LateExternalTarget", ["target_shape"]);
    hud.clock.advance(1200);
    assert.equal(external.style.uiScale, undefined, "external additions use the bounded broad sweep");
    hud.clock.advance(2000);
    assert.equal(external.style.uiScale, undefined, "unrelated shapes cannot become native source fallbacks");
    assert.deepEqual(probes, [], "source discovery stays inside the verified native host");
    feature.onDisable();
    assert.equal(external.style.uiScale, undefined);
    assert.equal(replacement.hint.style.uiScale, undefined);
    assert.deepEqual(hud.clock.errors, []);
});
