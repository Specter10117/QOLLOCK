"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");
function fixture() {
    const e = createHud({ inHideout: false }); e.assertLoaded();
    const { $, QOL: Q } = e.sandbox.global; Q.core.App.shutdown();
    const add = (parent, id, className = "", type = "Panel") => {
        const panel = $.CreatePanel(type, parent, id); if (className) panel.AddClass(className); return panel;
    };
    const core = add(e.root, "", "HudCore"), gameplay = add(core, "gameplay_hud");
    const health = add(gameplay, "health_and_abilities_container"), canvas = add(health, "QOLHealthbarGeometry");
    const content = add(canvas, "HealthBarContent"); add(content, "hud_health_bars");
    const shields = add(content, "HudShieldsContainer"); shields.AddClass("HasBulletShield");
    const numbers = add(canvas, "HealthRegenAndTotal"), group = add(numbers, "", "healthContainer");
    const current = add(group, "", "currentHealthLabel", "Label"), maximum = add(group, "", "totalHealthLabel", "Label");
    current.text = "500"; maximum.text = "/ 1000";
    const bullet = add(numbers, "BulletShieldNumbers");
    add(bullet, "", "progress_bar_current", "Label").text = "250";
    add(bullet, "", "progress_bar_max", "Label").text = "/ 500";
    const heartsRoot = add(canvas, "MinecraftHeartsRoot"), box = add(heartsRoot, "MinecraftHeartsContainer");
    const hearts = add(box, "MinecraftHearts"), percent = add(box, "MinecraftHealthPercent", "", "Label"); percent.text = "";
    const shieldBox = add(heartsRoot, "MinecraftShieldHeartsContainer"), barrier = add(shieldBox, "MinecraftShieldHearts");
    const mc = Q.healthbar.mc.create({ id: "ql_healthbar" });
    mc.update(e.root, {}, e.clock.now(), true);
    return { ...e, Q, add, mc, hearts, barrier, heartsRoot, current, maximum, percent };
}

for (const role of ["slot", "fill", "row", "barrier-slot", "barrier-fill"]) {
    test(`Minecraft owns a moved ${role} through active reconciliation and teardown`, () => {
        const e = fixture(), foreign = e.add(e.root, "ForeignNativeOwner");
        const container = role.startsWith("barrier") ? e.barrier : e.hearts;
        const cls = role === "row" ? "HeartsRow" : role.endsWith("fill") ? "HeartFill" : "HeartSlot";
        const moved = container.FindChildrenWithClassTraverse(cls)[0]; assert.ok(moved);
        const descendants = moved.Children(); moved.SetParent(foreign);
        const native = e.add(container, "UnrelatedNativeChild");
        e.clock.advance(100); e.mc.update(e.root, {}, e.clock.now(), true); e.clock.advance(0);
        assert.equal(moved.IsValid(), false, "a moved owned node must not keep rendering under its foreign parent");
        for (const panel of descendants) assert.equal(panel.IsValid(), false);
        assert.equal(native.IsValid(), true);
        assert.ok(e.hearts.FindChildrenWithClassTraverse("HeartSlot").length > 0, "the current grid is rebuilt");
        const next = e.hearts.FindChildrenWithClassTraverse("HeartFill")[0]; next.SetParent(foreign);
        e.mc.release(); e.clock.advance(1000);
        assert.equal(next.IsValid(), false, "teardown also owns independently moved images");
        assert.equal(native.IsValid(), true);
        assert.equal(foreign.IsValid(), true);
        assert.deepEqual(e.clock.errors, []);
    });
}

test("Minecraft releases stale HP and all animations while native health bindings are unavailable", () => {
    const e = fixture();
    e.current.text = "100"; e.clock.advance(100); e.mc.update(e.root, {}, e.clock.now(), true);
    assert.equal(e.mc.inspect().lowHealth, true);
    assert.equal(e.percent.text.trim(), "[10%]");
    let reads = 0;
    Object.defineProperty(e.current, "text", { configurable: true, get() { reads++; return ""; } });
    e.maximum.text = "";
    for (let i = 0; i < 100; i++) { e.clock.advance(50); e.mc.update(e.root, {}, e.clock.now(), true); }
    assert.equal(e.mc.inspect().active, false);
    assert.equal(e.mc.inspect().pendingAnimations, 0);
    assert.equal(e.hearts.FindChildrenWithClassTraverse("HeartFill").length, 0);
    assert.equal(e.barrier.FindChildrenWithClassTraverse("HeartFill").length, 0);
    assert.equal(e.percent.text, "");
    assert.ok(reads <= 30, `unavailable bindings must use bounded retry, observed ${reads} reads`);
    Object.defineProperty(e.current, "text", { configurable: true, writable: true, value: "900" });
    e.maximum.text = "/ 1000";
    e.clock.advance(250); e.mc.update(e.root, {}, e.clock.now(), true);
    assert.equal(e.percent.text.trim(), "[90%]");
    assert.equal(e.mc.inspect().active, true);
    assert.equal(e.current.text, "900", "the renderer does not replace native number bindings");
    e.mc.release(); e.clock.advance(1000); assert.deepEqual(e.clock.errors, []);
});

test("Minecraft source loss retires old hearts even while their former panels remain alive", () => {
    const e = fixture(), retired = e.add(e.root, "RetiredHealthCanvas");
    const old = e.hearts.FindChildrenWithClassTraverse("HeartSlot")[0];
    e.heartsRoot.SetParent(retired);
    e.clock.advance(100); e.mc.update(e.root, {}, e.clock.now(), true); e.clock.advance(0);
    assert.equal(old.IsValid(), false);
    assert.equal(e.heartsRoot.IsValid(), true, "the static/native canvas remains engine owned");
    assert.equal(e.mc.inspect().active, false);
    assert.equal(e.mc.inspect().pendingAnimations, 0);
    assert.deepEqual(e.clock.errors, []);
});

test("Minecraft can release active animations repeatedly and rebuild the same-size grid", () => {
    const e = fixture();
    e.current.text = "100"; e.clock.advance(100); e.mc.update(e.root, {}, e.clock.now(), true);
    assert.equal(e.mc.inspect().lowHealth, true);
    assert.ok(e.mc.inspect().pendingAnimations > 0);
    const previous = e.hearts.FindChildrenWithClassTraverse("HeartSlot");
    e.mc.release(); e.mc.release(); e.clock.advance(1000);
    assert.equal(e.mc.inspect().active, false);
    assert.equal(e.mc.inspect().pendingAnimations, 0);
    assert.ok(previous.every(panel => !panel.IsValid()));
    e.current.text = "900";
    e.mc.update(e.root, {}, e.clock.now(), true);
    assert.equal(e.mc.inspect().hearts, previous.length, "unchanged capacity still rebuilds all retired slots");
    assert.equal(e.percent.text.trim(), "[90%]");
    assert.equal(e.mc.inspect().active, true);
    assert.equal(e.mc.inspect().blinking, false);
    assert.equal(e.mc.inspect().lowHealth, false);
    assert.equal(e.mc.inspect().pendingAnimations, 0);
    e.clock.advance(1000);
    assert.equal(e.mc.inspect().pendingAnimations, 0, "retired animation callbacks cannot revive the old state");
    e.mc.release(); e.clock.advance(1000);
    assert.deepEqual(e.clock.errors, []);
});
