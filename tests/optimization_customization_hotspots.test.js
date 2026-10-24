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

test("target scope follows native host replacement while the broad sweep retains late external shapes", () => {
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
    feature.onEnable();
    assert.equal(old.shape.style.uiScale, "200%");
    assert.equal(old.hint.style.uiScale, "140%");
    assert.equal(old.scaledHint.style.uiScale, "140%");

    const retired = add(hud.doc.absRoot, "RetiredTargetHost");
    host.SetParent(retired);
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
    assert.equal(external.style.uiScale, "200%", "broad compatibility discovery remains active");
    feature.onDisable();
    assert.equal(external.style.uiScale, undefined);
    assert.equal(replacement.hint.style.uiScale, undefined);
    assert.deepEqual(hud.clock.errors, []);
});

test("stat bonus misses retry and a live same-ID source replacement supersedes the old generation", () => {
    const env = fixture("ql_stat_bonuses", { ENABLE_STAT_BONUSES: 1 });
    const { hud, $, add, core, feature } = env;
    const owner = add(core, "CitadelHudHeroShop");
    const label = (parent, id, value) => {
        const panel = add(parent, id, [], "Label");
        panel.text = value;
        return panel;
    };
    const health = value => {
        const row = add(owner, "StatContainer_MaxHealth");
        label(row, "ModifiedLabel", String(value));
        label(row, "BaseLabel", "100");
        return row;
    };
    const read = () => hud.root.FindChildTraverse("QOLStatBonusesMaxHealth").text;
    feature.onEnable();
    assert.equal(read(), "Max Health: --");
    const old = health(220);
    hud.clock.advance(3500);
    assert.equal(read(), "Max Health: 120");

    old.SetParent(add($.GetContextPanel().GetParent(), "RetiredStatSource"));
    health(400);
    hud.clock.advance(250);
    assert.equal(read(), "Max Health: 300");
    feature.onDisable();
    hud.clock.advance(1);
    assert.equal(hud.root.FindChildTraverse("QOLStatBonusesOverlay"), null);
    assert.equal(old.IsValid(), true);
    assert.deepEqual(hud.clock.errors, []);
});

test("stat bonus alternatives share a discovery pass instead of traversing once per missing ID", () => {
    const env = fixture("ql_stat_bonuses", { ENABLE_STAT_BONUSES: 1 });
    const owner = env.add(env.core, "CitadelHudHeroShop");
    const traverse = owner.FindChildTraverse;
    let individualMisses = 0;
    owner.FindChildTraverse = id => {
        if (id.startsWith("StatContainer_")) individualMisses++;
        return traverse.call(owner, id);
    };
    env.feature.onEnable(); env.hud.clock.advance(1000);
    assert.equal(individualMisses, 0, "one absent variant cannot trigger another whole-owner walk");
    const row = env.add(owner, "StatContainer_BaseHealth");
    env.add(row, "ModifiedLabel", [], "Label").text = "350";
    env.add(row, "BaseLabel", [], "Label").text = "100";
    env.hud.clock.advance(3500);
    assert.equal(env.hud.root.FindChildTraverse("QOLStatBonusesMaxHealth").text, "Max Health: 250");
    env.feature.onDisable(); assert.deepEqual(env.hud.clock.errors, []);
});

test("stat batch discovery keeps native duplicate priority and recovers from interrupted child enumeration", () => {
    const env = fixture("ql_stat_bonuses", { ENABLE_STAT_BONUSES: 1 });
    const owner = env.add(env.core, "CitadelHudHeroShop"), branch = env.add(owner, "EarlierBranch");
    const health = (parent, value) => {
        const row = env.add(parent, "StatContainer_MaxHealth");
        env.add(row, "ModifiedLabel", [], "Label").text = String(value);
        env.add(row, "BaseLabel", [], "Label").text = "100";
        return row;
    };
    health(branch, 200);
    const direct = health(owner, 400);
    env.feature.onEnable();
    const read = () => env.hud.root.FindChildTraverse("QOLStatBonusesMaxHealth").text;
    assert.equal(read(), "Max Health: 300", "a direct sibling wins over an earlier nested duplicate");
    direct.SetParent(env.add(null, "RetiredStat")); health(owner, 500);
    owner.Children = () => { throw Error("modeled native child enumeration race"); };
    env.hud.clock.advance(250);
    assert.equal(read(), "Max Health: 400", "partial enumeration cannot freeze or publish a false miss");
    env.feature.onDisable(); assert.deepEqual(env.hud.clock.errors, []);
});
