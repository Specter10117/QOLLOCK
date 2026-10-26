"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup(config) {
    const env = createHud({ inHideout: false });
    env.assertLoaded();
    const { QOL: Q, $ } = env.sandbox.global;
    Q.core.App.shutdown();
    const defaults = env.sandbox.evalJson("QOL.buildDefaultConfig()");
    for (const key of Object.keys(defaults)) if (/^ENABLE_(?:COLORED_HEALTHBAR|COLOR_WARNING_|ENEMY_COLORED|ALLY_COLORED|TOPBAR_(?:ENEMY|ALLY)_HP_WARNING)/.test(key)) defaults[key] = 0;
    Q.core.ConfigAdapter.loadFromFlat({ ...defaults, ...config });
    const feature = Q.core.FeatureRegistry.getManifest("ql_color_warnings").create({ events: Q.core.EventBus,
        id: "ql_color_warnings", config: { view: () => Q.core.ConfigStore.view("ql_color_warnings") }
    });
    return { ...env, Q, $, feature };
}

function selfHealth(env, current = 700, total = 1000, geometry = true) {
    const core = env.root.Children().find(panel => panel.BHasClass("HudCore")) || env.$.CreatePanel("Panel", env.root, "");
    core.AddClass("HudCore");
    const gameplay = core.FindChild("gameplay_hud") || env.$.CreatePanel("Panel", core, "gameplay_hud");
    const container = env.$.CreatePanel("Panel", gameplay, "health_and_abilities_container");
    const canvas = geometry ? env.$.CreatePanel("Panel", container, "QOLHealthbarGeometry") : container;
    const content = env.$.CreatePanel("Panel", canvas, "HealthBarContent");
    const regen = env.$.CreatePanel("Panel", geometry ? canvas : content, "HealthRegenAndTotal");
    const group = env.$.CreatePanel("Panel", regen, ""); group.AddClass("healthContainer");
    const currentLabel = env.$.CreatePanel("Label", group, "CurrentHealth");
    currentLabel.AddClass("currentHealthLabel");
    currentLabel.text = String(current);
    const totalLabel = env.$.CreatePanel("Label", group, "TotalHealth");
    totalLabel.AddClass("totalHealthLabel");
    totalLabel.text = String(total);
    const bars = env.$.CreatePanel("CitadelHudHealth", content, "hud_health_bars");
    const line = env.$.CreatePanel("Panel", bars, ""); line.AddClass("health_bar_line");
    const border = env.$.CreatePanel("Panel", line, ""); border.AddClass("health_bar_border");
    const bar = env.$.CreatePanel("ProgressBarWithMiddle", border, "health_bar");
    const fill = env.$.CreatePanel("Panel", bar, "health_bar_Left"); fill.AddClass("ProgressBarLeft");
    return { container, canvas, content, regen, group, currentLabel, totalLabel, bars, bar, fill };
}

for (const geometry of [true, false]) test(`self warnings follow current ${geometry ? "geometry" : "captured"} health owners through gaps`, () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1 }), self = selfHealth(env, 700, 1000, geometry);
    env.feature.onEnable();
    assert.equal(self.currentLabel.style.color, "rgb(255, 240, 120)");
    const retired = env.$.CreatePanel("Panel", self.regen, "RetiredNumbers");
    self.group.SetParent(retired);
    env.clock.advance(300);
    assert.equal(self.currentLabel.style.color, undefined, "a living number group outside the native direct owner is released");
    assert.equal(self.fill.style.washColor, undefined, "missing current numbers cannot reuse retired labels");
    const group = env.$.CreatePanel("Panel", self.regen, ""); group.AddClass("healthContainer");
    const current = env.$.CreatePanel("Label", group, ""); current.AddClass("currentHealthLabel"); current.text = "900";
    const maximum = env.$.CreatePanel("Label", group, ""); maximum.AddClass("totalHealthLabel"); maximum.text = "/ 1000";
    env.clock.advance(300);
    assert.equal(current.style.color, "rgb(255, 255, 255)");
    assert.equal(self.fill.style.washColor, "rgb(255, 255, 255)");
    self.fill.SetParent(retired);
    const fill = env.$.CreatePanel("Panel", self.bar, "health_bar_Left"); fill.AddClass("ProgressBarLeft");
    env.clock.advance(300);
    assert.equal(self.fill.style.washColor, undefined);
    assert.equal(fill.style.washColor, "rgb(255, 255, 255)");
    env.feature.onDisable();
    assert.equal(current.style.color, undefined); assert.equal(fill.style.washColor, undefined);
    assert.deepEqual(env.clock.errors, []);
});

function topbarHealth(env, kind = "enemy", current = 500, total = 1000) {
    const slot = env.$.CreatePanel("Panel", env.root, "");
    slot.AddClass(kind);
    const owner = env.$.CreatePanel("Panel", slot, "HealthBar");
    const parent = env.$.CreatePanel("ProgressBar", owner, "HeroHealth");
    parent.value = current;
    parent.max = total;
    const fill = env.$.CreatePanel("Panel", parent, "HeroHealth_Left");
    fill.AddClass("ProgressBarLeft");
    return { slot, owner, parent, fill };
}

test("warning channels keep their existing palette and release only their owned properties", () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1, ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1, ENABLE_TOPBAR_ALLY_HP_WARNING_75: 1 });
    const self = selfHealth(env), enemy = topbarHealth(env), ally = topbarHealth(env, "friend", 700);
    enemy.fill.style.opacity = "0.42";
    self.currentLabel.style.fontSize = "37px";
    env.feature.onEnable();
    assert.equal(self.fill.style.washColor, "rgb(255, 240, 120)");
    assert.equal(self.currentLabel.style.color, "rgb(255, 240, 120)");
    assert.equal(enemy.fill.style.backgroundColor, "rgb(255, 123, 0)");
    assert.equal(ally.fill.style.backgroundColor, "rgb(255, 240, 120)");
    env.feature.onDisable();
    assert.equal(self.fill.style.washColor, undefined);
    assert.equal(self.currentLabel.style.color, undefined);
    assert.equal(enemy.fill.style.backgroundColor, undefined, "return to native CSS rather than hardcoding a color");
    assert.equal(ally.fill.style.backgroundColor, undefined);
    assert.equal(enemy.fill.style.opacity, "0.42");
    assert.equal(self.currentLabel.style.fontSize, "37px");
    assert.deepEqual(env.clock.errors, []);
});

test("steady warning colors avoid RGB formatting while threshold changes and pulses remain live", () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1, ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1 });
    const self = selfHealth(env), enemy = topbarHealth(env);
    env.feature.onEnable();
    const format = env.Q.utils.ToRgbString;
    let formats = 0;
    env.Q.utils.ToRgbString = rgb => { formats++; return format(rgb); };
    env.clock.advance(1000);
    assert.equal(formats, 0, "fixed colors are prepared once instead of formatted for every panel and tick");
    self.currentLabel.text = "900"; enemy.parent.value = 900;
    env.clock.advance(300);
    assert.equal(self.fill.style.washColor, "rgb(255, 255, 255)");
    assert.equal(enemy.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.Q.core.ConfigStore.set("ql_color_warnings", "ENABLE_TOPBAR_ENEMY_HP_WARNING_25", true);
    enemy.parent.value = 200;
    env.feature.onSettingsChanged();
    const initial = enemy.fill.style.backgroundColor;
    env.clock.advance(300);
    assert.notEqual(enemy.fill.style.backgroundColor, initial);
    assert.ok(formats > 0, "only live pulse interpolation needs RGB formatting");
    env.feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("switching off self warnings clears its styles while the enemy observer remains enabled", () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1, ENABLE_ENEMY_COLORED_HEALTHBAR: 1 });
    const self = selfHealth(env), enemy = topbarHealth(env);
    env.feature.onEnable();
    env.Q.core.ConfigStore.set("ql_color_warnings", "ENABLE_COLOR_WARNING_75", false);
    env.feature.onSettingsChanged();
    assert.equal(self.bars.style.washColor, undefined);
    assert.equal(self.currentLabel.style.color, undefined);
    assert.equal(enemy.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.feature.onDisable();
});

test("self warnings rebind a living health-container replacement and restore retired native panels", () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1 });
    const original = selfHealth(env);
    env.feature.onEnable();
    original.container.SetParent(env.$.CreatePanel("Panel", null, "RetiredHealthHUD"));
    const replacement = selfHealth(env, 900);
    env.clock.advance(300);
    assert.equal(original.container.IsValid(), true);
    assert.equal(original.fill.style.washColor, undefined);
    assert.equal(original.currentLabel.style.color, undefined);
    assert.equal(replacement.fill.style.washColor, "rgb(255, 255, 255)");
    env.feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("top-bar discovery finds added native slots and replaces a living fill without inheriting its style signature", () => {
    const env = setup({ ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1 });
    const original = topbarHealth(env);
    env.feature.onEnable();
    const added = topbarHealth(env);
    env.clock.advance(1500);
    assert.equal(added.fill.style.backgroundColor, "rgb(255, 123, 0)", "living old slots cannot suppress discovery of new slots");
    original.fill.SetParent(env.$.CreatePanel("Panel", null, "RetiredHealthFill"));
    const replacement = env.$.CreatePanel("Panel", original.parent, "HeroHealth_Left");
    replacement.AddClass("ProgressBarLeft");
    env.clock.advance(300);
    assert.equal(original.fill.style.backgroundColor, undefined);
    assert.equal(replacement.style.backgroundColor, "rgb(255, 123, 0)");
    env.feature.onDisable();
    assert.equal(replacement.style.backgroundColor, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("reusing a native health slot across team changes has one presentation owner", () => {
    const env = setup({ ENABLE_ENEMY_COLORED_HEALTHBAR: 1, ENABLE_ALLY_COLORED_HEALTHBAR: 1 });
    const slot = topbarHealth(env, "friend");
    env.feature.onEnable();
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 255, 255)");
    slot.slot.RemoveClass("friend");
    slot.slot.AddClass("enemy");
    env.clock.advance(300);
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.feature.onDisable();
});

test("a living native panel recycled out of its health-bar role releases its warning immediately", () => {
    const env = setup({ ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1 });
    const slot = topbarHealth(env);
    env.feature.onEnable();
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 123, 0)");
    slot.fill.RemoveClass("ProgressBarLeft");
    env.clock.advance(300);
    assert.equal(slot.fill.style.backgroundColor, undefined);
    env.feature.onDisable();
});

test("failed native color writes retry and missing health data releases stale self warnings", () => {
    const env = setup({ ENABLE_COLOR_WARNING_75: 1, ENABLE_ENEMY_COLORED_HEALTHBAR: 1 });
    const self = selfHealth(env), enemy = topbarHealth(env);
    let color, attempts = 0;
    Object.defineProperty(enemy.fill.style, "backgroundColor", {
        configurable: true, get: () => color,
        set(value) { attempts++; if (attempts === 1) throw new Error("native style temporarily unavailable"); color = value; }
    });
    env.feature.onEnable();
    assert.equal(color, undefined);
    self.currentLabel.text = "";
    self.totalLabel.text = "";
    env.clock.advance(300);
    assert.equal(color, "rgb(255, 86, 86)");
    assert.ok(attempts >= 2);
    assert.equal(self.currentLabel.style.color, undefined);
    assert.equal(self.fill.style.washColor, undefined);
    self.bar.value = 900; self.bar.max = 1000;
    env.clock.advance(300);
    assert.equal(self.fill.style.washColor, "rgb(255, 255, 255)", "native progress remains a fallback when number text is unavailable");
    delete self.bar.max;
    env.clock.advance(300);
    assert.equal(self.fill.style.washColor, undefined);
    env.feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("low-health pulses share a phase within each team and accept physical-height progress fallback", () => {
    const env = setup({ ENABLE_TOPBAR_ENEMY_HP_WARNING_25: 1 });
    const first = topbarHealth(env, "enemy", 200), second = topbarHealth(env, "enemy", 200);
    delete second.parent.value;
    delete second.parent.max;
    second.parent.actuallayoutheight = 100;
    second.fill.actuallayoutheight = 20;
    env.feature.onEnable();
    const initial = first.fill.style.backgroundColor;
    assert.equal(initial, second.fill.style.backgroundColor);
    env.clock.advance(300);
    assert.notEqual(first.fill.style.backgroundColor, initial);
    assert.equal(first.fill.style.backgroundColor, second.fill.style.backgroundColor);
    env.feature.onDisable();
});

test("native health-bar discovery backs off while sources are missing", () => {
    const env = setup({ ENABLE_ENEMY_COLORED_HEALTHBAR: 1 });
    const traverse = env.root.FindChildrenWithClassTraverse.bind(env.root);
    let searches = 0;
    env.root.FindChildrenWithClassTraverse = name => { if (name === "ProgressBarLeft") searches++; return traverse(name); };
    env.feature.onEnable();
    env.clock.advance(5000);
    assert.ok(searches <= 4, `missing bars triggered ${searches} scans`);
    const slot = topbarHealth(env);
    env.clock.advance(2200);
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.feature.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("top-bar warnings discover within the current TopBar and retire a living old roster", () => {
    const env = setup({ ENABLE_ENEMY_COLORED_HEALTHBAR: 1 });
    const core = env.$.CreatePanel("Panel", env.root, ""); core.AddClass("HudCore");
    const top = env.$.CreatePanel("Panel", core, "TopBar");
    const unrelated = topbarHealth(env), original = topbarHealth(env);
    original.slot.SetParent(top);
    const enumerate = env.root.FindChildrenWithClassTraverse;
    let wholeHudScans = 0;
    env.root.FindChildrenWithClassTraverse = name => { wholeHudScans++; return enumerate.call(env.root, name); };
    env.feature.onEnable(); env.clock.advance(1500);
    assert.equal(original.fill.style.backgroundColor, "rgb(255, 86, 86)");
    assert.equal(unrelated.fill.style.backgroundColor, undefined, "another component's health fill is not a roster slot");
    assert.equal(wholeHudScans, 0, "known TopBar ownership avoids HUD-wide class enumeration");
    top.SetParent(env.$.CreatePanel("Panel", null, "RetiredTopBar"));
    const next = env.$.CreatePanel("Panel", core, "TopBar"), replacement = topbarHealth(env);
    replacement.slot.SetParent(next);
    env.clock.advance(300);
    assert.equal(original.fill.style.backgroundColor, undefined);
    assert.equal(replacement.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.feature.onDisable();
    assert.equal(replacement.fill.style.backgroundColor, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("top-bar warning ticks validate each current native fill once before reading live health", () => {
    const env = setup({ ENABLE_TOPBAR_ENEMY_HP_WARNING_65: 1 });
    const slot = topbarHealth(env);
    env.feature.onEnable();
    let lookups = 0, samples = 0, health = 500;
    const find = slot.parent.FindChild;
    slot.parent.FindChild = function (id) {
        if (id === "HeroHealth_Left") lookups++;
        return find.call(this, id);
    };
    Object.defineProperty(slot.parent, "value", { configurable: true, get() { samples++; return health; } });
    env.clock.advance(1000);
    assert.ok(samples >= 5, "recurring live-health updates ran");
    assert.equal(lookups, samples, "a current cached fill needs one ownership check per health sample");
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 123, 0)");
    health = 900;
    env.clock.advance(300);
    assert.equal(slot.fill.style.backgroundColor, "rgb(255, 86, 86)");
    env.feature.onDisable();
    assert.equal(slot.fill.style.backgroundColor, undefined);
    assert.deepEqual(env.clock.errors, []);
});
