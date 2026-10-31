"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function fixture(id) {
    const e = createHud({ inHideout: false }); e.assertLoaded();
    const { $, QOL: Q } = e.sandbox.global; Q.core.App.shutdown();
    const cfg = { ...Q.buildDefaultConfig(), ENABLE_COMBAT_INDICATOR: 1, ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1 };
    let reads = 0;
    const create = () => Q.core.FeatureRegistry.getManifest(id).create({ id, events: Q.core.EventBus,
        config: { view() { reads++; return cfg; } } });
    const add = (parent, name, cls = "", type = "Panel") => {
        const panel = $.CreatePanel(type, parent, name); if (cls) panel.AddClass(cls); return panel;
    };
    const retired = add(null, "RetiredNative");
    function native() {
        if (id === "ql_combat_indicator") {
            const core = add(e.root, "", "HudCore"), gp = add(core, "gameplay_hud");
            const target = add(gp, "health_and_abilities_container"); e.root.AddClass("InCombat");
            return { scope: core, target };
        }
        const scope = add(e.root, "", "enemy"), owner = add(scope, "HealthBar");
        const bar = add(owner, "HeroHealth", "", "ProgressBar"); bar.value = 500; bar.max = 1000;
        return { scope, target: add(bar, "HeroHealth_Left", "ProgressBarLeft") };
    }
    const value = panel => id === "ql_combat_indicator" ? panel.BHasClass("combat_indicator_active") : panel.style.backgroundColor;
    const activeValue = id === "ql_combat_indicator" ? true : "rgb(255, 123, 0)";
    const releasedValue = id === "ql_combat_indicator" ? false : undefined;
    function rejectRetirement(panel, mode) {
        let rejected = true, attempts = 0, writes = 0;
        if (id === "ql_combat_indicator") {
            const set = panel.SetHasClass.bind(panel);
            panel.SetHasClass = (name, enabled) => {
                if (name.startsWith("combat_indicator_")) {
                    writes++;
                    if (!enabled) { attempts++; if (rejected) { if (mode === "throw") throw Error("native class removal rejected"); return false; } }
                }
                return set(name, enabled);
            };
        } else {
            const clear = panel.ClearPropertyFromCode.bind(panel);
            panel.ClearPropertyFromCode = key => {
                if (key === "background-color") { attempts++; if (rejected) { if (mode === "throw") throw Error("native color clear rejected"); return false; } }
                return clear(key);
            };
            panel.style = new Proxy(panel.style, {
                deleteProperty(target, key) { if (rejected && key === "backgroundColor") throw Error("native fallback unavailable"); return Reflect.deleteProperty(target, key); },
                set(target, key, v) { if (key === "backgroundColor") { writes++; if (rejected && (v === null || v === "")) throw Error("native fallback unavailable"); } target[key] = v; return true; }
            });
        }
        return { recover() { rejected = false; }, attempts: () => attempts, writes: () => writes };
    }
    return { ...e, Q, cfg, create, native, retired, value, activeValue, releasedValue, rejectRetirement, reads: () => reads };
}

for (const id of ["ql_combat_indicator", "ql_color_warnings"]) {
    for (const mode of ["false", "throw"]) test(`${id}: rejected ${mode} retirement completes after disable without restarting observation`, () => {
        const e = fixture(id), { target } = e.native(), feature = e.create();
        target.style.opacity = "0.42"; target.AddClass("UnrelatedNative");
        feature.onEnable(); assert.equal(e.value(target), e.activeValue);
        const failure = e.rejectRetirement(target, mode); feature.onDisable();
        assert.equal(e.value(target), e.activeValue);
        const reads = e.reads(); failure.recover(); e.clock.advance(1000);
        assert.equal(e.value(target), e.releasedValue);
        assert.equal(e.reads(), reads, "cleanup must not read settings");
        assert.equal(target.style.opacity, "0.42"); assert(target.BHasClass("UnrelatedNative"));
        if (id === "ql_combat_indicator") assert.equal(target.BHasClass("combat_indicator_enabled"), false);
        const attempts = failure.attempts(), writes = failure.writes(); e.clock.advance(1000);
        assert.equal(failure.attempts(), attempts); assert.equal(failure.writes(), writes, "no writes once cleanup settles");
        assert.equal(e.Q.core.Scheduler.getWorkSnapshot().some(owner => owner.id === id), false);
        assert.deepEqual(e.clock.errors, []);
    });

    test(`${id}: unchanged live presentation does not rewrite accepted native fields`, () => {
        const e = fixture(id), { target } = e.native(), feature = e.create(); feature.onEnable();
        const counter = e.rejectRetirement(target, "false"); counter.recover();
        const reads = e.reads(); e.clock.advance(1000);
        assert.equal(counter.writes(), 0); assert.equal(counter.attempts(), 0);
        assert.equal(e.reads(), reads); assert.equal(e.value(target), e.activeValue);
        feature.onDisable(); e.clock.advance(1000); assert.deepEqual(e.clock.errors, []);
    });

    test(`${id}: rejected living replacement retires independently and rapid re-enable preserves the new owner`, () => {
        const e = fixture(id), old = e.native(), first = e.create(); first.onEnable();
        const oldFailure = e.rejectRetirement(old.target, "false"); old.scope.SetParent(e.retired);
        const current = e.native(); first.onSettingsChanged(); e.clock.advance(1400);
        assert.equal(e.value(current.target), e.activeValue); assert.equal(e.value(old.target), e.activeValue);
        oldFailure.recover(); e.clock.advance(1000); assert.equal(e.value(old.target), e.releasedValue);
        const currentFailure = e.rejectRetirement(current.target, "false"); first.onDisable();
        const next = e.create(); next.onEnable(); assert.equal(e.value(current.target), e.activeValue);
        currentFailure.recover(); e.clock.advance(1000);
        assert.equal(e.value(current.target), e.activeValue, "retired instance must not clear a new instance's fields");
        next.onDisable(); e.clock.advance(1000); assert.equal(e.value(current.target), e.releasedValue);
        assert.equal(old.scope.IsValid(), true); assert.deepEqual(e.clock.errors, []);
    });
}
