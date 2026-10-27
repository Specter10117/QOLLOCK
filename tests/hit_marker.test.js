"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHud } = require("../scripts/simulator");

function setup() {
    const e = createHud({ inHideout: false }); e.assertLoaded();
    const { QOL: Q, $ } = e.sandbox.global; Q.core.App.shutdown();
    const manifest = Q.core.FeatureRegistry.getManifest("ql_hit_marker"); assert.ok(manifest);
    Q.core.ConfigAdapter.loadFromFlat({ ...Q.buildDefaultConfig(), ENABLE_CUSTOM_HITMARKER: 1 });
    const feature = manifest.create({ id: manifest.id, events: Q.core.EventBus,
        config: { view: () => Q.core.ConfigStore.view(manifest.id) } });
    const add = (parent, id) => $.CreatePanel("Panel", parent, id);
    const core = add(e.root, ""); core.AddClass("HudCore");
    let gun = core;
    for (const id of ["gameplay_hud", "gameplay_hud_alive", "crosshair", "gun", "gun_data"]) gun = add(gun, id);
    const host = add(gun, "hit_markers");
    const native = ["TopLeftHitMarker", "TopRightHitMarker", "BottomLeftHitMarker", "BottomRightHitMarker"]
        .map(id => { const panel = add(host, id); panel.AddClass("hit_marker"); return panel; });
    const group = crit => host.FindChild(crit ? "QOLHitMarkerCrit" : "QOLHitMarkerNormal");
    const line = crit => group(crit)?.GetChild(0);
    const set = (key, value) => { Q.core.ConfigStore.set(manifest.id, key, value); feature.onSettingsChanged(); };
    return { ...e, Q, $, feature, add, core, gun, host, native, group, line, set };
}

test("custom hit markers keep normal and critical appearance independent and leave native hit timing alone", () => {
    const e = setup(); e.feature.onEnable();
    assert.equal(e.host.BHasClass("qol-custom-hitmarker"), true);
    assert.equal(e.host.style.opacity, undefined);
    assert.equal(e.line(false).style.width, "20px"); assert.equal(e.line(true).style.width, "20px");
    e.set("CUSTOM_HITMARKER_SIZE", 32); e.set("CUSTOM_HITMARKER_COLOR", 0x1112233);
    assert.equal(e.line(false).style.width, "32px");
    assert.equal(e.line(false).style.backgroundColor, "#112233");
    assert.equal(e.line(true).style.width, "20px"); assert.equal(e.line(true).style.backgroundColor, "yellow");
    assert.equal(e.line(true).style.boxShadow, "0px 0px 10px red");
    e.set("CUSTOM_HITMARKER_CRIT_SIZE", 12); e.set("CUSTOM_HITMARKER_CRIT_COLOR", 3);
    assert.equal(e.line(true).style.width, "12px");
    e.set("ENABLE_CUSTOM_HITMARKER_HIDE_GLOW", true); e.set("ENABLE_CUSTOM_HITMARKER_SHADOW", true);
    assert.match(e.line(true).style.boxShadow, /rgba\(0, 0, 0, 0.6\)/);
    assert.equal(e.host.BHasClass("show_hit_marker"), false); assert.equal(e.host.BHasClass("show_crit_hit_marker"), false);
    let selected = true; e.Q.presentation.preview.selected = () => selected; e.clock.advance(600);
    assert.equal(e.host.style.opacity, "1");
    selected = false; e.clock.advance(600); assert.equal(e.host.style.opacity, undefined);
    e.feature.onDisable(); e.clock.advance(600);
    assert.equal(e.host.BHasClass("qol-custom-hitmarker"), false);
    assert.ok(e.native.every(panel => panel.IsValid())); assert.equal(e.host.GetChildCount(), 4);
    assert.deepEqual(e.clock.errors, []);
});

test("hit marker construction, moved children and living host replacement recover without changing unrelated native panels", () => {
    const e = setup(), create = e.$.CreatePanel; let reject = true, rejectStyle = true;
    e.$.CreatePanel = (type, parent, id, properties) => {
        if (reject && id === "QOLHitMarkerCritLine2") throw Error("modeled creation failure");
        const panel = create(type, parent, id, properties);
        if (id === "QOLHitMarkerNormalLine0") panel.style = new Proxy(panel.style, { set(target, property, value) {
            if (rejectStyle && property === "width") throw Error("modeled style rejection");
            target[property] = value; return true;
        } });
        return panel;
    };
    e.host.SetParent(e.add(null, "LateNativeMarkers")); e.feature.onEnable(); e.clock.advance(600);
    assert.equal(e.group(false), null, "missing native owners cannot create content elsewhere");
    e.host.SetParent(e.gun); e.clock.advance(600);
    assert.equal(e.host.BHasClass("qol-custom-hitmarker"), false);
    reject = false; e.clock.advance(600); assert.equal(e.host.BHasClass("qol-custom-hitmarker"), false, "partial styles cannot hide native markers");
    rejectStyle = false; e.clock.advance(600); assert.equal(e.host.BHasClass("qol-custom-hitmarker"), true);
    const detached = e.add(null, "RetiredHitMarkers"), oldLine = e.line(false);
    oldLine.SetParent(detached); e.clock.advance(600); assert.equal(oldLine.IsValid(), false);
    assert.equal(e.group(false).GetChildCount(), 4);
    const owned = [e.group(false), e.group(true)]; e.host.SetParent(detached);
    const next = e.add(e.gun, "hit_markers"); e.clock.advance(600);
    assert.ok(owned.every(panel => !panel.IsValid()));
    assert.equal(e.host.BHasClass("qol-custom-hitmarker"), false);
    assert.equal(next.BHasClass("qol-custom-hitmarker"), true);
    e.feature.onDisable(); e.feature.onEnable(); e.clock.advance(600);
    assert.equal(next.BHasClass("qol-custom-hitmarker"), true);
    e.feature.onDisable(); e.clock.advance(600); assert.equal(next.GetChildCount(), 0);
    assert.ok(e.native.every(panel => panel.IsValid())); assert.deepEqual(e.clock.errors, []);
});

test("hit marker CSS preserves native hit-state control and critical priority in the gun style chain", () => {
    const read = file => fs.readFileSync(path.join(__dirname, "../panorama/styles", file), "utf8");
    assert.match(read("ability_hud_elements/element_gun.css"), /features\/ql_feat_hit_marker\.vcss_c/);
    const css = read("features/ql_feat_hit_marker.css");
    assert.match(css, /#hit_markers\.qol-custom-hitmarker > \.hit_marker/);
    assert.match(css, /\.show_hit_marker #hit_markers\.qol-custom-hitmarker #QOLHitMarkerNormal/);
    assert.match(css, /\.show_crit_hit_marker #hit_markers\.qol-custom-hitmarker #QOLHitMarkerNormal\s*\{\s*visibility: collapse/);
    assert.match(css, /\.show_crit_hit_marker #hit_markers\.qol-custom-hitmarker #QOLHitMarkerCrit/);
    assert.doesNotMatch(css, /!important/);
});
