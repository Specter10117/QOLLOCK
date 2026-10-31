"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHud } = require("../scripts/simulator");

function setup() {
    const env = createHud({ inHideout: false }); env.assertLoaded();
    const { QOL: Q, $ } = env.sandbox.global;
    Q.core.App.shutdown();
    const manifest = Q.core.FeatureRegistry.getManifest("ql_disabled_abilities");
    assert.ok(manifest, "disabled presentation has an independent registered owner");
    Q.core.ConfigAdapter.loadFromFlat({ ...Q.buildDefaultConfig(), ENABLE_BETTER_DISABLED_ABILITIES: 1 });
    const feature = manifest.create({ id: manifest.id, events: Q.core.EventBus,
        config: { view: () => Q.core.ConfigStore.view(manifest.id) } });
    const add = (parent, id, type = "Panel", cls = "") => {
        const panel = $.CreatePanel(type, parent, id); if (cls) panel.AddClass(cls); return panel;
    };
    const core = add(env.root, "", "Panel", "HudCore"), abilities = add(core, "AbilitiesContainer");
    const signature = add(add(add(abilities, "hud_signature"), "", "Panel", "hud_abilities"), "abilities");
    const items = add(add(abilities, "ActiveAbilitiesMenu"), "abilitiesContainer");
    const icon = (owner, type = "CitadelAbilityIcon") => {
        const panel = add(owner, "", type), button = add(panel, "button_container");
        const images = add(button, "", "Panel", "image_container");
        const host = type === "DraggableAbilityIcon" ? add(images, "", "Panel", "iconContainer") : images;
        const image = add(host, "ability_image", "Image", "ability_image");
        const mask = add(images, "cooldown_mask"); mask.style.clip = "radial(50% 50%, 120deg, 0deg)";
        return { panel, host, image, mask };
    };
    return { ...env, Q, $, feature, add, core, signature, items, icon };
}

test("disabled abilities decorate only verified owners, recover live replacements and clean up every owned child", () => {
    const e = setup();
    const decoy = e.icon(e.root), signature = e.icon(e.signature), item = e.icon(e.items, "DraggableAbilityIcon");
    const find = source => source.host.FindChild("QOLDisabledXOverlay");
    e.core.SetParent(e.add(null, "LateNativeAbilities")); e.feature.onEnable(); e.clock.advance(600);
    assert.equal(find(signature), null); assert.equal(find(item), null);
    e.core.SetParent(e.root); e.clock.advance(600);
    assert.equal(find(decoy), null);
    for (const source of [signature, item]) {
        assert.ok(find(source)); assert.equal(find(source).GetChildCount(), 2);
        assert.equal(find(source).hittest, false);
        assert.equal(source.panel.BHasClass("qol-better-disabled"), true);
        assert.equal(source.mask.style.clip, "radial(50% 50%, 120deg, 0deg)");
    }
    const old = find(signature), moved = old.GetChild(0), detached = e.add(null, "RetiredAbility");
    moved.SetParent(detached); e.clock.advance(600);
    assert.equal(moved.IsValid(), false); assert.equal(find(signature).GetChildCount(), 2);
    signature.panel.SetParent(detached); const next = e.icon(e.signature); e.clock.advance(600);
    assert.equal(old.IsValid(), false); assert.ok(find(next));
    assert.equal(signature.panel.BHasClass("qol-better-disabled"), false);
    e.core.SetParent(detached); e.clock.advance(600);
    assert.equal(find(next), null); assert.equal(find(item), null);
    assert.equal(item.panel.BHasClass("qol-better-disabled"), false);
    e.feature.onDisable(); e.feature.onSettingsChanged(); e.clock.advance(600);
    assert.deepEqual(e.clock.errors, []);
});

test("disabled abilities retry partial construction without claiming native presentation early", () => {
    const e = setup(), source = e.icon(e.signature), create = e.$.CreatePanel;
    let reject = true;
    e.$.CreatePanel = (type, parent, id, properties) => {
        if (reject && id === "QOLDisabledXBar1") throw Error("modeled construction failure");
        return create(type, parent, id, properties);
    };
    e.feature.onEnable(); assert.equal(source.panel.BHasClass("qol-better-disabled"), false);
    reject = false; e.clock.advance(600); assert.equal(source.panel.BHasClass("qol-better-disabled"), true);
    e.feature.onDisable(); e.feature.onEnable(); e.clock.advance(600);
    assert.equal(source.panel.BHasClass("qol-better-disabled"), true);
    e.feature.onDisable(); e.clock.advance(600);
    assert.equal(source.host.FindChild("QOLDisabledXOverlay"), null);
    assert.equal(source.panel.BHasClass("qol-better-disabled"), false);
    assert.deepEqual(e.clock.errors, []);
});

test("disabled visuals live in both native component style chains and leave cooldown masks native", () => {
    const read = file => fs.readFileSync(path.join(__dirname, "../panorama/styles", file), "utf8");
    for (const file of ["hud_ability_icon.css", "hud_ability_icon_active.css"]) {
        assert.match(read(file), /@import url\("s2r:\/\/panorama\/styles\/features\/ql_feat_disabled_abilities\.vcss_c"\)/);
    }
    const css = read("features/ql_feat_disabled_abilities.css");
    assert.match(css, /CitadelAbilityIcon\.qol-better-disabled\.disabled/);
    assert.match(css, /DraggableAbilityIcon\.qol-better-disabled\.disabled/);
    assert.doesNotMatch(css, /cooldown_mask|!important/);
});
