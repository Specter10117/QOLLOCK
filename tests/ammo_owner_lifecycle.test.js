"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup() {
    const env = createHud({ inHideout: false }); env.assertLoaded();
    const { QOL: Q, $ } = env.sandbox.global;
    Q.core.App.shutdown();
    const cfg = Q.buildDefaultConfig();
    cfg.AMMO_CURRENT_SCALE = 150; cfg.AMMO_CURRENT_X_OFFSET = 20;
    let reads = 0;
    const feature = Q.core.FeatureRegistry.getManifest("ql_ammo").create({ events: Q.core.EventBus,
        id: "ql_ammo", config: { view() { reads++; return cfg; } }
    });
    const add = (parent, id, type = "Panel") => $.CreatePanel(type, parent, id);
    const native = root => {
        const gun = add(root, "gun_data"), panel = add(gun, "ammo_panel");
        const current = add(panel, "CurrentAmmo", "Label"); current.AddClass("weapon_ammo"); current.text = "6";
        const maximum = add(panel, "MaxAmmo", "Label"); maximum.AddClass("weapon_ammo_max"); maximum.text = " / 8";
        current.style.transform = "rotateZ(9deg)";
        return { gun, panel, current, maximum };
    };
    return { ...env, Q, $, cfg, feature, add, native, reads: () => reads };
}

test("ammo uses per-round masks through 40 rounds and native continuous fill for larger clips", () => {
    const env = setup(), source = env.native(env.root), clip = env.add(source.gun, "clip_status");
    const progress = env.add(clip, "clip_progress_bar", "CircularProgressBar");
    const background = env.add(clip, "clip_bg_progress_bar", "CircularProgressBar");
    const bonus = env.add(clip, "clip_bonus_progress_bar", "CircularProgressBar");
    Object.defineProperty(source.current, "text", { get() { throw Error("ammo fill must stay native, without current-ammo polling"); } });
    env.cfg.ENABLE_AMMO_STATUS = 1; source.maximum.text = " / 40";
    progress.style.clip = "radial( 50% 50%, 0deg, 45deg )";
    env.feature.onEnable();
    const mask = 'url("s2r://panorama/images/custom/ammo_ticks/40.vsvg")';
    for (const target of [progress, background, bonus]) assert.equal(target.style.opacityMask, mask);
    assert.equal(progress.style.clip, "radial( 50% 50%, 0deg, 45deg )");
    assert.equal(clip.GetChildCount(), 3, "the visualizer uses existing native rings without generated panels");
    for (const maximum of [41, 66, 200, 500]) {
        source.maximum.text = " / " + maximum; env.clock.advance(700);
        for (const target of [progress, background, bonus]) assert.equal(target.style.opacityMask, undefined, "large magazines retain continuous fill");
        assert.equal(clip.BHasClass("qol-ammo-native-arc"), true);
        assert.equal(clip.GetChildCount(), 3);
    }
    source.maximum.text = " / 8"; env.clock.advance(700);
    assert.equal(progress.style.opacityMask, 'url("s2r://panorama/images/custom/ammo_ticks/8.vsvg")');
    progress.style.clip = "radial( 50% 50%, 0deg, 22.5deg )"; env.clock.advance(700);
    assert.equal(progress.style.clip, "radial( 50% 50%, 0deg, 22.5deg )", "native shot/reload feedback remains untouched");
    env.feature.onDisable();
    for (const target of [progress, background, bonus]) assert.equal(target.style.opacityMask, undefined);
    assert.equal(clip.BHasClass("qol-ammo-native-arc"), false);
    assert.deepEqual(env.clock.errors, []);
});

test("ammo restores customized digit fonts after native feedback without changing native text", () => {
    const env = setup(), source = env.native(env.root);
    env.feature.onEnable();
    assert.equal(source.current.style.fontSize, "24px");
    source.current.style.fontSize = "16px";
    env.clock.advance(700);
    assert.equal(source.current.style.fontSize, "24px");
    assert.equal(source.current.text, "6");
    assert.equal(source.maximum.text, " / 8");
    env.feature.onDisable();
    assert.equal(source.current.style.fontSize, undefined);
    assert.equal(source.current.style.transform, "rotateZ(9deg)");
    assert.deepEqual(env.clock.errors, []);
});

test("stopped ammo hooks cannot read settings or revive digit presentation", () => {
    const env = setup(), source = env.native(env.root);
    env.feature.onEnable(); env.feature.onDisable();
    const reads = env.reads();
    env.feature.onSettingsChanged(); env.clock.advance(1000);
    assert.equal(source.current.style.fontSize, undefined);
    assert.equal(source.current.style.x, undefined);
    assert.equal(env.reads(), reads);
    assert.deepEqual(env.clock.errors, []);
});

test("ammo waits for real HUD evidence and releases a still-living retired HUD", () => {
    const env = setup(), loading = env.add(null, "LoadingRoot");
    const decoy = env.native(loading), first = env.native(env.root);
    env.$.GetContextPanel = () => loading;
    env.feature.onEnable();
    assert.equal(decoy.current.style.fontSize, undefined);
    env.$.GetContextPanel = () => env.root;
    env.clock.advance(700); assert.equal(first.current.style.fontSize, "24px");
    const replacement = env.add(null, "Hud", "CitadelHud"), current = env.native(replacement);
    env.$.GetContextPanel = () => replacement;
    env.clock.advance(700);
    assert.equal(first.current.style.fontSize, undefined);
    assert.equal(first.current.style.x, undefined);
    assert.equal(current.current.style.fontSize, "24px");
    assert.equal(current.current.style.position, "20px 0px 0px");
    env.feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("digit reset retains rejected font retirement after the observation loop stops", () => {
    const env = setup(), source = env.native(env.root), panel = source.current;
    env.feature.onEnable();
    const clear = panel.ClearPropertyFromCode.bind(panel);
    let reject = true;
    panel.ClearPropertyFromCode = key => key === "font-size" && reject ? false : clear(key);
    panel.style = new Proxy(panel.style, {
        deleteProperty(target, key) { if (key === "fontSize" && reject) throw Error("native retirement rejected"); return Reflect.deleteProperty(target, key); },
        set(target, key, value) { if (key === "fontSize" && reject && !value) throw Error("native retirement rejected"); target[key] = value; return true; }
    });
    env.cfg.AMMO_CURRENT_SCALE = 100;
    env.feature.onSettingsChanged(); env.feature.onDisable();
    assert.equal(panel.style.fontSize, "16px", "the neutral native font is restored while code-property release retries");
    reject = false; env.clock.advance(700);
    assert.equal(panel.style.fontSize, undefined);
    assert.equal(panel.style.x, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("digit position retirement retries a rejected neutral write after Ammo stops", () => {
    const env = setup(), source = env.native(env.root), panel = source.current;
    const physical = { x: 0, y: 0 };
    let reject = false;
    panel.style = new Proxy(panel.style, { set(target, key, value) {
        if (key === "position") {
            if (reject && value === "0px 0px 0px") throw Error("native position unavailable");
            const components = String(value).split(/\s+/).map(parseFloat);
            physical.x = components[0]; physical.y = components[1];
        }
        target[key] = value; return true;
    } });
    env.feature.onEnable();
    assert.deepEqual(physical, { x: 20, y: 0 });
    reject = true; env.feature.onDisable();
    assert.equal(panel.style.position, "20px 0px 0px");
    const reads = env.reads();
    reject = false; env.clock.advance(700);
    assert.deepEqual(physical, { x: 0, y: 0 });
    assert.equal(panel.style.position, undefined);
    assert.equal(env.reads(), reads, "cleanup cannot revive settings observation");
    assert.deepEqual(env.clock.errors, []);
});

test("Ammo clip rotation observes native feedback and retries retirement after disable without clearing a new instance", () => {
    const env = setup(), source = env.native(env.root), clip = env.add(source.gun, "clip_status");
    env.cfg.AMMO_CLIP_ANGLE = 30;
    env.feature.onEnable(); assert.equal(clip.style.transform, "rotateZ(-30deg)");
    clip.style.transform = "rotateZ(12deg)";
    env.clock.advance(700); assert.equal(clip.style.transform, "rotateZ(-30deg)");
    const clear = clip.ClearPropertyFromCode.bind(clip); let reject = true;
    clip.ClearPropertyFromCode = key => reject && key === "transform" ? false : clear(key);
    env.feature.onDisable(); assert.equal(clip.style.transform, "rotateZ(0deg)");
    const next = env.Q.core.FeatureRegistry.getManifest("ql_ammo").create({ events: env.Q.core.EventBus, id: "ql_ammo", config: { view: () => ({ ...env.cfg, AMMO_CLIP_ANGLE: 45 }) } });
    next.onEnable(); assert.equal(clip.style.transform, "rotateZ(-45deg)");
    reject = false; env.clock.advance(700);
    assert.equal(clip.style.transform, "rotateZ(-45deg)");
    assert.equal(clip.BHasClass("qol-ammo-visual-disabled"), true);
    next.onDisable(); assert.equal(clip.style.transform, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("Ammo mirrored rotation returns each CSS baseline and retains a rejected reset until it succeeds", () => {
    const env = setup(), source = env.native(env.root), left = env.add(source.gun, "clip_status"), right = env.add(source.gun, "clip_status_mirrored");
    env.cfg.AMMO_CLIP_ANGLE = 20; env.feature.onEnable();
    assert.equal(left.style.transform, "rotateZ(70deg)"); assert.equal(right.style.transform, "rotateZ(160deg)");
    const clear = right.ClearPropertyFromCode.bind(right); let reject = true;
    right.ClearPropertyFromCode = key => reject && key === "transform" ? false : clear(key);
    env.cfg.AMMO_CLIP_ANGLE = 0; env.feature.onSettingsChanged();
    assert.equal(left.style.transform, undefined); assert.equal(right.style.transform, "rotateZ(180deg)");
    env.feature.onDisable(); reject = false; env.clock.advance(700);
    assert.equal(right.style.transform, undefined); assert.deepEqual(env.clock.errors, []);
});

test("ammo mask and tint follow native feedback and release a living replaced progress source", () => {
    const env = setup(), source = env.native(env.root), clip = env.add(source.gun, "clip_status");
    const progress = env.add(clip, "clip_progress_bar", "CircularProgressBar");
    env.cfg.ENABLE_AMMO_STATUS = 1; env.cfg.AMMO_TEXT_COLOR = 1; env.feature.onEnable();
    const mask = progress.style.opacityMask, color = progress.style.borderColor;
    assert.ok(mask && color);
    progress.style.opacityMask = "none"; progress.style.borderColor = "#000000";
    env.clock.advance(700);
    assert.equal(progress.style.opacityMask, mask); assert.equal(progress.style.borderColor, color);
    progress.SetParent(env.add(env.root, "RetiredNativeProgress"));
    const replacement = env.add(clip, "clip_progress_bar", "CircularProgressBar");
    env.clock.advance(700);
    assert.equal(progress.style.opacityMask, undefined); assert.equal(progress.style.borderColor, undefined);
    assert.equal(replacement.style.opacityMask, mask); assert.equal(replacement.style.borderColor, color);
    env.cfg.AMMO_TEXT_COLOR = 0; env.feature.onSettingsChanged();
    assert.equal(replacement.style.borderColor, undefined, "default tint releases native low-ammo and bonus color policy");
    env.feature.onDisable(); assert.equal(replacement.style.opacityMask, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("ammo mask retirement retries after disable without reading settings or overwriting native fill", () => {
    const env = setup(), source = env.native(env.root), clip = env.add(source.gun, "clip_status");
    const progress = env.add(clip, "clip_progress_bar", "CircularProgressBar");
    progress.style.clip = "radial( 50% 50%, 0deg, 67.5deg )";
    env.cfg.ENABLE_AMMO_STATUS = 1; env.feature.onEnable();
    const clear = progress.ClearPropertyFromCode.bind(progress); let reject = true;
    progress.ClearPropertyFromCode = property => property === "opacity-mask" && reject ? false : clear(property);
    env.feature.onDisable();
    assert.ok(progress.style.opacityMask); const reads = env.reads();
    reject = false; env.clock.advance(700);
    assert.equal(progress.style.opacityMask, undefined); assert.equal(env.reads(), reads);
    assert.equal(progress.style.clip, "radial( 50% 50%, 0deg, 67.5deg )");
    assert.equal(clip.BHasClass("qol-ammo-native-arc"), false);
    assert.deepEqual(env.clock.errors, []);
});
