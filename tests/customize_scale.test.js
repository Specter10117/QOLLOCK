"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

function owner(env, element) {
    const created = element.id === "speed" && env.global.QOL.presentation.resolve(element, env.hud.root, env.global.MOD_CONFIG);
    let panel = created || env.hud.root;
    for (const segment of created ? [] : element.path) {
        let next = typeof segment === "string" ? panel.FindChild(segment) : panel.Children().find(p => p.BHasClass(segment.className));
        if (!next) {
            next = env.doc.create("Panel", { id: typeof segment === "string" ? segment : "", classes: typeof segment === "string" ? [] : [segment.className] });
            panel.addChild(next);
        }
        panel = next;
    }
    if (element.id === "items") panel.AddClass("ModsContainer");
    if (element.id === "playerStats") panel = panel.addChild(env.doc.create("Panel", { id: "HudStatBlock" }));
    Object.assign(panel, { actuallayoutwidth: 160, actuallayoutheight: 60, actualxoffset: 200, actualyoffset: 100 });
    panel.style.transform = "rotateZ(9deg)";
    return panel;
}

test("default presentation geometry skips discovery but later scale changes still apply and retire", () => {
    const env = load(), q = env.hud.sandbox.global.QOL;
    q.core.App.shutdown();
    const cfg = q.buildDefaultConfig(), element = q.presentation.elements.find(item => item.id === "souls");
    const panel = owner(env, element);
    const resolve = q.presentation.resolve;
    const calls = [];
    q.presentation.resolve = (...args) => { calls.push(args[0].id); return resolve(...args); };
    const feature = q.core.FeatureRegistry.getManifest("ql_presentation_scale").create({ events: q.core.EventBus, id: "ql_presentation_scale", config: { view: () => cfg } });
    feature.onEnable(); env.clock.advance(3000);
    assert.deepEqual(calls, [], "no scale/offset overrides means no native panel search");
    cfg.SOULS_SCALE = 151; feature.onSettingsChanged();
    assert.equal(panel.style.uiScale, "151%");
    assert.deepEqual(calls, ["souls"]);
    cfg.SOULS_SCALE = 100; feature.onSettingsChanged();
    assert.equal(panel.style.uiScale, undefined, "reset still retires the applied native style");
    calls.length = 0; env.clock.advance(2000);
    assert.deepEqual(calls, []);
    feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

for (const id of ["souls", "items", "stamina", "playerStats", "speed", "ammo", "abilityPoints", "damageReport"]) {
    test(`${id}: scoped scale previews, measures, restores replacements and round-trips`, () => {
        const env = load();
        const { global: g, clock } = env;
        const element = g.QOL.presentation.elements.find(item => item.id === id);
        const key = element.scaleKey;
        g.QOL.ui.window.setOpen(true); clock.advance(500);
        if (id === "speed") {
            // Provide the native ancestor path before enabling the feature; its
            // owner creates the leaf rather than adopting a fixture's overlay.
            owner(env, element).DeleteAsync(0); clock.advance(1);
            g.MOD_CONFIG.ENABLE_COMPASS_SPEED = 1; g.SaveAndSync(); clock.advance(1200);
        }
        let panel = owner(env, element);
        const parent = panel.GetParent();
        assert.equal(g.QOL_DEFAULT_CONFIG[key], 100);
        assert.equal(g.QOL.ui.customize.start(null, { elementId: id }), true);
        for (const suffix of ["", "TopLeft", "TopRight", "BottomLeft"]) assert.ok(env.em.FindChildTraverse("QOLCustomizeResize_" + id + suffix));
        const input = env.em.FindChildTraverse("QOLCustomize_" + key);
        for (const percent of [50, 151, 200]) {
            input.text = String(percent); input._fire("oninputsubmit"); clock.advance(1200);
            assert.equal(panel.style.uiScale, Number(((id === "items" ? 120 : 100) * percent / 100).toFixed(2)) + "%");
            assert.equal(panel.style.preTransformScale2d, undefined);
            assert.equal(panel.style.transform, "rotateZ(9deg)");
            assert.equal(g.MOD_CONFIG[key], 100, "preview remains transient");
            // Model the dimensions returned by native ui-scale relayout; the
            // simulator itself does not lay out CSS. Frames must not scale twice.
            panel.actuallayoutwidth = 160 * percent / 100;
            panel.actuallayoutheight = 60 * percent / 100;
            clock.advance(300);
            assert.equal(env.em.FindChildTraverse("QOLCustomizeFrame_" + id).style.width, Math.round(panel.actuallayoutwidth) + "px");
        }
        panel.DeleteAsync(0); clock.advance(1);
        if (id === "playerStats") {
            panel = parent.addChild(env.doc.create("Panel", { id: "HudStatBlock" }));
            Object.assign(panel, { actuallayoutwidth: 160, actuallayoutheight: 60 });
        } else {
            // Speed owns its created root; wait for its real replacement before
            // supplying simulated native measurements, rather than adding a decoy.
            if (id === "speed") clock.advance(1200);
            panel = owner(env, element);
        }
        clock.advance(1200);
        assert.equal(panel.style.uiScale, (id === "items" ? "240%" : "200%"), "replacement invalidates the signature");
        env.em.FindChildTraverse("QOLCustomizeCancel")._fire("onactivate"); clock.advance(1200);
        assert.equal(panel.style.preTransformScale2d, undefined);
        assert.equal(panel.style.uiScale, undefined);
        g.QOL.ui.customize.start(null, { elementId: id });
        const pending = env.em.FindChildTraverse("QOLCustomize_" + key);
        pending.text = "151";
        g.QOL.core.storageBridge.saveSettings = (_cfg, callback) => callback(null);
        env.em.FindChildTraverse("QOLCustomizeApply")._fire("onactivate"); clock.advance(1200);
        const imported = g.QOL.ui.modal.tryApplyImportStringWithDiagnostics(g.QOL.ui.configTab.getCurrentExportSettingsString());
        assert.equal(imported.ok, true);
        assert.equal(imported.candidateConfig[key], 151);
        env.hud.sandbox.global.QOL.core.FeatureRegistry.disable(id === "ammo" ? "ql_ammo" : "ql_presentation_scale");
        assert.equal(panel.style.preTransformScale2d, undefined);
        assert.equal(panel.style.uiScale, undefined);
        assert.deepEqual(env.doc.eventErrors, []);
        assert.deepEqual(clock.errors, []);
    });
}

test("native HP scale leaves descendants' layout and animations under their existing owners", () => {
    const env = load();
    const q = env.hud.sandbox.global.QOL;
    const panel = env.doc.create("Panel", { id: "health_and_abilities_container" });
    const bar = panel.addChild(env.doc.create("Panel", { id: "health_bar" }));
    const numbers = panel.addChild(env.doc.create("Panel", { id: "current_health" }));
    bar.style.transform = "rotateZ(-9deg)";
    numbers.style.preTransformScale2d = "1.08";
    q.healthbar.applyPlayerStyleToPanel(panel, q.healthbar.buildPlayerHealthbarStyleState({ PLAYER_HEALTHBAR_SCALE: 200 }, false, false));
    assert.equal(panel.style.preTransformScale2d, undefined);
    assert.equal(panel.style.uiScale, "240%");
    assert.equal(bar.style.transform, "rotateZ(-9deg)");
    assert.equal(numbers.style.preTransformScale2d, "1.08");
    q.healthbar.resetPlayerStyle(panel);
    assert.equal(panel.style.preTransformScale2d, undefined);
    assert.equal(panel.style.uiScale, undefined);
});

test("every independently editable HUD frame declares an overall resize capability", () => {
    const env = load();
    const presentation = env.global.QOL.presentation;
    const missing = Array.from(presentation.elements).filter(element => presentation.hasFrame(element) && !presentation.resizeField(element));
    assert.deepEqual(missing.map(element => element.id), []);
});

test("overall ui-scale follows CSS baseline changes without a scale setting change", () => {
    const env = load();
    const q = env.hud.sandbox.global.QOL;
    const panels = {};
    // The captured native tree has a WindowRoot above CitadelHud. Feature
    // classes live on Hud, so querying the UI root selects the wrong baseline.
    const uiRoot = env.doc.create("CitadelHudRoot", { id: "NativeWindow", classes: ["WindowRoot"] });
    uiRoot.addChild(env.hud.root);
    q.setCachedPanel("uiRoot", uiRoot);
    for (const id of ["items", "abilityPoints", "damageReport"]) {
        const element = q.presentation.elements.find(item => item.id === id);
        panels[id] = owner(env, element);
    }
    const cfg = { ITEMS_SCALE: 151, AP_SCALE: 151, DAMAGE_REPORT_SCALE: 151 };
    const feature = q.core.FeatureRegistry.getManifest("ql_presentation_scale").create({ events: q.core.EventBus,
        id: "ql_presentation_scale", config: { view: () => cfg }
    });
    assert.equal(q.getUIRoot(), uiRoot);
    const root = env.hud.root;
    feature.onEnable();
    assert.equal(panels.items.style.uiScale, "181.2%");
    assert.equal(panels.abilityPoints.style.uiScale, "151%");
    root.AddClass("support_16_10_active");
    root.AddClass("fg_healthbar_active");
    root.AddClass("disable_damage_report_active");
    feature.onSettingsChanged();
    assert.equal(panels.items.style.uiScale, "135.9%");
    assert.equal(panels.abilityPoints.style.uiScale, "105.7%");
    assert.equal(panels.damageReport.style.uiScale, "0%");
    root.AddClass("minimalist_healthbar_active");
    root.RemoveClass("disable_damage_report_active");
    feature.onSettingsChanged();
    assert.equal(panels.abilityPoints.style.uiScale, "151%");
    assert.equal(panels.damageReport.style.uiScale, "151%");
    feature.onDisable();
    for (const panel of Object.values(panels)) assert.equal(panel.style.uiScale, undefined);
});

function scaleFixture(id = "souls") {
    const env = load(), q = env.hud.sandbox.global.QOL;
    q.core.App.shutdown();
    const cfg = q.buildDefaultConfig();
    const element = q.presentation.elements.find(item => item.id === id);
    const panel = owner(env, element);
    const feature = q.core.FeatureRegistry.getManifest("ql_presentation_scale").create({ events: q.core.EventBus,
        id: "ql_presentation_scale", config: { view: () => cfg }
    });
    return { ...env, q, cfg, panel, feature };
}

for (const nativeOwner of ["hudPlayerStats", "hudActivePlayerStats"]) {
    test(`${nativeOwner}: compact stats and sibling effects share scale through native replacement and reset`, () => {
        const { q, cfg, panel, feature, doc, clock } = scaleFixture("playerStats");
        const wrapper = panel.GetParent();
        if (nativeOwner === "hudActivePlayerStats") {
            wrapper.SetParent(wrapper.GetParent().GetParent().GetParent());
            wrapper.id = nativeOwner;
        }
        // Current native XML puts CoreStatFXLayer beside HudStatBlock and StatList.
        // The simulator checks style ownership, not particle rendering/layout.
        const list = wrapper.addChild(doc.create("Panel", { id: "StatList" }));
        list.style.uiScale = "135%";
        feature.onEnable();
        cfg.STATS_POSITION_SCALE = 50; feature.onSettingsChanged();
        assert.equal(panel.style.uiScale, "50%");
        let effects = wrapper.addChild(doc.create("Panel", { id: "CoreStatFXLayer" }));
        const particle = effects.addChild(doc.create("ParticleScenePanel", { id: "SpiritMaxStatFX" }));
        particle.style.opacity = "0.7";
        clock.advance(700);
        assert.equal(effects.style.uiScale, "50%", "late effects follow compact scaling");
        for (const percent of [125, 135]) {
            cfg.STATS_POSITION_SCALE = percent; feature.onSettingsChanged();
            assert.equal(panel.style.uiScale, percent + "%");
            assert.equal(effects.style.uiScale, percent + "%");
        }
        const retired = effects;
        retired.SetParent(doc.create("Panel", { id: "RetiredEffects" }));
        effects = wrapper.addChild(doc.create("Panel", { id: "CoreStatFXLayer" }));
        clock.advance(700);
        assert.equal(retired.style.uiScale, undefined);
        assert.equal(effects.style.uiScale, "135%");
        cfg.STATS_POSITION_SCALE = 100; feature.onSettingsChanged();
        assert.equal(panel.style.uiScale, undefined);
        assert.equal(effects.style.uiScale, undefined);
        cfg.STATS_POSITION_SCALE = 50; feature.onSettingsChanged();
        feature.onDisable();
        assert.equal(panel.style.uiScale, undefined);
        assert.equal(effects.style.uiScale, undefined);
        feature.onEnable();
        assert.equal(panel.style.uiScale, "50%");
        assert.equal(effects.style.uiScale, "50%");
        feature.onDisable();
        assert.equal(list.style.uiScale, "135%", "expanded stats retain independent scale");
        assert.equal(wrapper.style.uiScale, undefined);
        assert.equal(particle.style.opacity, "0.7", "native particle state is untouched");
        assert.deepEqual(clock.errors, []);
    });
}

for (const nativeOwner of ["hudPlayerStats", "hudActivePlayerStats"]) {
    test(`${nativeOwner}: effects have zero opacity only above 135% and restore across replacement and disable`, () => {
        const { cfg, panel, feature, doc, clock } = scaleFixture("playerStats");
        const wrapper = panel.GetParent();
        if (nativeOwner === "hudActivePlayerStats") {
            wrapper.SetParent(wrapper.GetParent().GetParent().GetParent());
            wrapper.id = nativeOwner;
        }
        cfg.STATS_POSITION_SCALE = 136;
        feature.onEnable();
        let effects = wrapper.addChild(doc.create("Panel", { id: "CoreStatFXLayer" }));
        clock.advance(700);
        assert.equal(effects.style.opacity, "0", "late effects are fully transparent above the limit");
        assert.equal(effects.style.visibility, undefined, "effects stay in native layout");
        assert.equal(panel.style.uiScale, "136%", "compact stats keep the requested scale");
        assert.equal(panel.style.visibility, undefined);
        cfg.STATS_POSITION_SCALE = 135; feature.onSettingsChanged();
        assert.equal(effects.style.opacity, undefined, "the boundary releases the opacity override");
        assert.equal(effects.style.uiScale, "135%");
        cfg.STATS_POSITION_SCALE = 238; feature.onSettingsChanged();
        assert.equal(effects.style.opacity, "0");
        const retired = effects;
        retired.SetParent(doc.create("Panel", { id: "RetiredEffects" }));
        effects = wrapper.addChild(doc.create("Panel", { id: "CoreStatFXLayer" }));
        clock.advance(700);
        assert.equal(retired.style.opacity, undefined, "living retired effects are released");
        assert.equal(effects.style.opacity, "0", "replacement effects inherit the limit");
        feature.onDisable();
        assert.equal(effects.style.opacity, undefined);
        feature.onEnable();
        assert.equal(effects.style.opacity, "0");
        cfg.STATS_POSITION_SCALE = 100; feature.onSettingsChanged();
        assert.equal(effects.style.opacity, undefined, "default scale restores native effects");
        assert.equal(effects.style.uiScale, undefined);
        feature.onDisable();
        assert.deepEqual(clock.errors, []);
    });
}

test("active stat effects preserve their captured viewport and relative bottom anchor at 135%", () => {
    const { cfg, panel, feature, doc, hud, clock } = scaleFixture("playerStats");
    const wrapper = panel.GetParent();
    wrapper.SetParent(wrapper.GetParent().GetParent().GetParent());
    wrapper.id = "hudActivePlayerStats";
    const effects = wrapper.addChild(doc.create("Panel", { id: "CoreStatFXLayer" }));
    cfg.STATS_POSITION_SCALE = 135;
    feature.onEnable();
    assert.equal(effects.style.minWidth, "300px");
    assert.equal(effects.style.minHeight, "500px");
    assert.equal(effects.style.marginLeft, "-7px");
    assert.equal(effects.style.marginBottom, "301px");
    // Debugger at 100%: owner height 1080, block top 770/height 90,
    // FX top 300/height 500, particle top 270 within FX.
    // This checks the requested constraint/anchor math, not native relayout.
    const scale = 1.35;
    const margin = parseFloat(effects.style.marginBottom);
    const height = Math.max(parseFloat(effects.style.minHeight) * scale, Math.min(500 * scale, 1080 - margin));
    assert.equal(height, 675);
    const particleTop = 1080 - margin - height + 270 * scale;
    const blockTop = 1080 - 220 - 90 * scale;
    assert.equal(Math.round((particleTop - blockTop) * 10) / 10, -270,
        "captured -200px particle-to-block offset scales proportionally");
    assert.equal(panel.style.minHeight, undefined);
    hud.root.AddClass("gShopOpen"); clock.advance(700);
    assert.equal(effects.style.marginBottom, "290.5px", "native shop docking changes without a settings edit");
    hud.root.RemoveClass("gShopOpen"); clock.advance(700);
    assert.equal(effects.style.marginBottom, "301px");
    cfg.STATS_POSITION_SCALE = 100; feature.onSettingsChanged();
    for (const key of ["uiScale", "minWidth", "minHeight", "marginLeft", "marginBottom"]) assert.equal(effects.style[key], undefined);
    cfg.STATS_POSITION_SCALE = 135; feature.onSettingsChanged();
    feature.onDisable();
    for (const key of ["uiScale", "minWidth", "minHeight", "marginLeft", "marginBottom"]) assert.equal(effects.style[key], undefined);
    assert.deepEqual(clock.errors, []);
});

test("overall scale reasserts native feedback and retires rejected clears after disable", () => {
    const { cfg, panel, feature, clock } = scaleFixture();
    cfg.SOULS_SCALE = 150;
    feature.onEnable();
    panel.style.uiScale = "100%";
    clock.advance(700);
    assert.equal(panel.style.uiScale, "150%", "unchanged settings must not cache native overwrites");
    const clear = panel.ClearPropertyFromCode.bind(panel);
    let reject = true;
    panel.ClearPropertyFromCode = key => key === "ui-scale" && reject ? false : clear(key);
    feature.onDisable();
    assert.equal(panel.style.uiScale, "150%", "a rejected clear remains owned");
    reject = false; clock.advance(700);
    assert.equal(panel.style.uiScale, undefined);
    feature.onSettingsChanged(); clock.advance(700);
    assert.equal(panel.style.uiScale, undefined, "stopped callbacks cannot revive scale");
    assert.equal(panel.style.transform, "rotateZ(9deg)");
    assert.deepEqual(clock.errors, []);
});

test("partial scale and offset writes retry without aborting or discarding successful fields", () => {
    const { cfg, panel, feature, clock } = scaleFixture("abilityPoints");
    cfg.AP_SCALE = 150; cfg.AP_X_OFFSET = 40; cfg.AP_Y_OFFSET = 25;
    let reject = true, writes = 0;
    panel.style = new Proxy(panel.style, { set(target, key, value) {
        if (key === "uiScale") { writes++; if (reject) throw Error("temporary native scale rejection"); }
        target[key] = value; return true;
    } });
    assert.doesNotThrow(() => feature.onEnable());
    assert.equal(panel.style.x, "40px"); assert.equal(panel.style.y, "-25px");
    reject = false; clock.advance(700);
    assert.equal(panel.style.uiScale, "150%");
    const stable = writes; clock.advance(1500);
    assert.equal(writes, stable, "stable readback avoids redundant native writes");
    feature.onDisable();
    assert.equal(panel.style.x, undefined); assert.equal(panel.style.y, undefined);
    assert.equal(panel.style.uiScale, undefined);
    assert.deepEqual(clock.errors, []);
});

test("presentation waits for a real HUD and follows living HUD replacements", () => {
    const { q, cfg, panel, feature, hud, doc, clock } = scaleFixture();
    cfg.SOULS_SCALE = 150;
    const loading = doc.create("Panel", { id: "LoadingRoot" });
    const element = q.presentation.elements.find(item => item.id === "souls");
    const fake = owner({ hud: { root: loading }, doc }, element);
    const nativeContext = hud.sandbox.global.$;
    nativeContext.GetContextPanel = () => loading;
    feature.onEnable();
    assert.equal(fake.style.uiScale, undefined);
    nativeContext.GetContextPanel = () => hud.root;
    clock.advance(700); assert.equal(panel.style.uiScale, "150%");
    const replacement = doc.create("CitadelHud", { id: "Hud" });
    const current = owner({ hud: { root: replacement }, doc }, element);
    nativeContext.GetContextPanel = () => replacement;
    clock.advance(700);
    assert.equal(panel.style.uiScale, undefined);
    assert.equal(current.style.uiScale, "150%");
    feature.onDisable();
    assert.equal(current.style.uiScale, undefined);
    assert.deepEqual(clock.errors, []);
});
