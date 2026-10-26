"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

// Verified paths from hud.xml / hud_health_container.xml. These tests exercise
// source and lifecycle ownership, not Panorama composition or match timing.
function fixture() {
    const env = createHud({ inHideout: false });
    env.assertLoaded();
    const q = env.sandbox.global.QOL;
    q.core.App.shutdown();
    const add = (parent, id, classes = [], type = "Panel") => {
        const panel = env.doc.create(type, { id, classes });
        parent.addChild(panel);
        return panel;
    };
    const core = add(env.root, "", ["HudCore"]);
    const gameplay = add(core, "gameplay_hud");
    const other = add(env.root, "RetainedOldHud");
    function healthTree(parent = gameplay, hp = "500", maximum = "1000") {
        const health = add(parent, "health_and_abilities_container");
        Object.assign(health, { actuallayoutwidth: 300, actuallayoutheight: 456, actualuiscale_x: 1.2, actualuiscale_y: 1.2 });
        const canvas = add(health, "QOLHealthbarGeometry");
        const content = add(canvas, "HealthBarContent");
        const bars = add(content, "hud_health_bars");
        const line = add(bars, "", ["health_bar_line"]);
        const border = add(line, "", ["health_bar_border"]);
        const frame = add(border, "health_bar_frame");
        const shields = add(content, "HudShieldsContainer");
        const numbers = add(canvas, "HealthRegenAndTotal");
        const group = add(numbers, "", ["healthContainer"]);
        const backer = add(group, "", ["healthBacker"]);
        const current = add(group, "", ["currentHealthLabel"], "Label"); current.text = hp;
        const total = add(group, "", ["totalHealthLabel"], "Label"); total.text = "/ " + maximum;
        const bullet = add(numbers, "BulletShieldNumbers");
        const bulletCurrent = add(bullet, "", ["progress_bar_current"], "Label"); bulletCurrent.text = "250";
        const bulletMax = add(bullet, "", ["progress_bar_max"], "Label"); bulletMax.text = "/ 500";
        const heartsRoot = add(canvas, "MinecraftHeartsRoot");
        const shieldBox = add(heartsRoot, "MinecraftShieldHeartsContainer");
        const shieldHearts = add(shieldBox, "MinecraftShieldHearts");
        const heartBox = add(heartsRoot, "MinecraftHeartsContainer");
        const hearts = add(heartBox, "MinecraftHearts");
        const mcPercent = add(heartBox, "MinecraftHealthPercent", [], "Label");
        const food = add(heartBox, "MinecraftFoodContainer");
        for (let i = 0; i < 10; i++) add(food, "", ["FoodIcon"], "Image");
        const xp = add(heartsRoot, "MinecraftXPBarFill");
        const level = add(heartsRoot, "MinecraftXPLevelLabel", [], "Label");
        const totem = add(heartsRoot, "MinecraftTotemContainer");
        const progress = id => {
            const panel = add(border, id);
            panel.actuallayoutheight = 400;
            const middle = add(panel, "", ["ProgressBarMiddle"]);
            middle.actuallayoutheight = 0;
            return middle;
        };
        const heal = progress("pending_incoming_heal"), damage = progress("pending_incoming_damage");
        return { health, canvas, numbers, group, current, total, frame, backer, bars, border, heartsRoot,
            hearts, food, shields, bulletCurrent, bulletMax, shieldBox, shieldHearts, xp, level, totem, mcPercent, heal, damage };
    }
    const tree = healthTree();
    const modifierTree = () => {
        const statusBars = add(add(gameplay, "gameplay_hud_alive"), "status_bars");
        const center = add(statusBars, "hud_modifiers", ["hud_modifiers", "center_modifiers"]);
        add(center, "BuffModifiers");
        const centerDebuffs = add(center, "DebuffModifiers");
        const aura = add(add(gameplay, "", ["clamp_width"]), "hud_aura_modifiers", ["hud_modifiers"]);
        add(aura, "BuffModifiers");
        const auraDebuffs = add(aura, "DebuffModifiers");
        return { statusBars, center, centerDebuffs, aura, auraDebuffs };
    };
    return { ...env, q, add, tree, healthTree, modifierTree, gameplay, other };
}
function start(env, cfg) {
    const f = env.q.core.FeatureRegistry.getManifest("ql_healthbar").create({ events: env.q.core.EventBus,
        id: "ql_healthbar", config: { view: () => cfg }
    });
    f.onEnable();
    return f;
}
function fills(tree, className) { return tree.hearts.FindChildrenWithClassTraverse(className); }

for (const layout of ["geometry", "captured"]) test(`accent follows native ${layout} owners without walking heart content`, () => {
    const env = fixture(), { tree } = env;
    if (layout === "captured") {
        const content = tree.canvas.FindChild("HealthBarContent");
        content.SetParent(tree.health); tree.numbers.SetParent(content); tree.canvas.SetParent(env.other);
    }
    const foreign = env.add(tree.heartsRoot, "", ["healthBacker"]);
    let broadLookups = 0;
    for (const method of ["FindChildTraverse", "FindChildrenWithClassTraverse"]) {
        const find = tree.health[method];
        tree.health[method] = function (...args) { broadLookups++; return find.apply(this, args); };
    }
    const accent = env.q.healthbar.accent.create({ id: "ql_healthbar" });
    const cfg = { PLAYER_HEALTHBAR_ACCENT_COLOR: 3 }, color = env.q.core.panel.resolvePaletteColor(3);
    accent.update(env.root, cfg, tree.health); env.clock.advance(20);
    assert.equal(tree.frame.style.washColor, color); assert.equal(tree.backer.style.washColor, color);
    assert.equal(foreign.style.washColor, undefined, "generated content is outside the native accent owners");
    const border = tree.frame.GetParent();
    tree.frame.SetParent(env.other); tree.backer.SetParent(env.other);
    accent.update(env.root, cfg, tree.health); env.clock.advance(20);
    assert.equal(tree.frame.style.washColor, undefined); assert.equal(tree.backer.style.washColor, undefined);
    const frame = env.add(border, "health_bar_frame"), backer = env.add(tree.group, "", ["healthBacker"]);
    accent.update(env.root, cfg, tree.health); env.clock.advance(20);
    assert.equal(frame.style.washColor, color); assert.equal(backer.style.washColor, color);
    assert.equal(broadLookups, 0, "native target replacement stays on the verified direct paths");
    accent.release();
    assert.equal(frame.style.washColor, undefined); assert.equal(backer.style.washColor, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("Minecraft food reads signed native stamina arcs and prefers dash over ability charges", () => {
    const env = fixture();
    for (const food of env.tree.food.Children()) food.SetImage = image => { food._image = image; };
    const crosshair = env.add(env.add(env.gameplay, "gameplay_hud_alive"), "crosshair");
    let chargeLookups = 0;
    const charges = (type, angle) => {
        const element = env.add(crosshair, type === "Citadel_AbilityHUDElement_Dash" ? "dash" : "", ["ability_element_charges"], type);
        const container = env.add(element, "charges_container");
        const enumerate = container.FindChildrenWithClassTraverse;
        container.FindChildrenWithClassTraverse = function (name) {
            if (name === "charge") chargeLookups++;
            return enumerate.call(this, name);
        };
        return Array.from({ length: 3 }, () => {
            const charge = env.add(container, "", ["charge", "has_charge"]);
            const foreground = env.add(charge, "", ["charge_fg"]);
            foreground.style.clip = `radial(50% 50%, 135deg, ${angle}deg)`;
            return foreground;
        });
    };
    charges("Citadel_AbilityHUDElement_Progress", 0);
    const dash = charges("Citadel_AbilityHUDElement_Dash", -14);
    let broadLookups = 0;
    const traverse = env.root.FindChildTraverse, enumerate = crosshair.FindChildrenWithClassTraverse;
    env.root.FindChildTraverse = function (id) {
        if (id === "crosshair") broadLookups++;
        return traverse.call(this, id);
    };
    crosshair.FindChildrenWithClassTraverse = function (name) {
        if (name === "ability_element_charges") broadLookups++;
        return enumerate.call(this, name);
    };
    const mc = env.q.healthbar.mc.create({ id: "ql_healthbar" });
    const update = time => mc.update(env.root, { HEALTHBAR_TYPE: 5 }, time, true);
    const fullFood = () => env.tree.food.Children().filter(p => p._image === "s2r://panorama/images/minecraft/food_8x_png.vtex").length;
    update(0);
    assert.equal(fullFood(), 5, "three half-full negative arcs mean 50% stamina");
    dash.forEach(p => { p.style.clip = "radial(50% 50%, 135deg, 14deg)"; });
    update(50);
    assert.equal(fullFood(), 5, "sweep direction does not change fill");
    dash.forEach(p => { p.AddClass("finished"); p.style.clip = ""; });
    update(100);
    assert.equal(fullFood(), 10, "finished foregrounds mean full stamina");
    dash.forEach(p => { p.RemoveClass("finished"); p.style.clip = ""; });
    update(150);
    assert.equal(fullFood(), 0, "unreadable arcs never invent a ready charge");
    dash[0].GetParent().GetParent().GetParent().SetParent(env.other);
    charges("Citadel_AbilityHUDElement_Dash", 28);
    update(200);
    assert.equal(fullFood(), 10, "living old dash generations cannot mask current stamina");
    assert.equal(broadLookups, 0, "verified Dash breadcrumbs need no crosshair or ability-tree search");
    assert.equal(chargeLookups, 5, "each hunger observation reuses its discovered charge list");
    mc.release();
});

test("Minecraft armor follows the native middle fraction and retires its own icons", () => {
    const env = fixture(), { tree } = env;
    const box = env.add(tree.heartsRoot, "MinecraftArmorHeartsContainer");
    const armor = env.add(box, "MinecraftArmorHearts");
    const foreign = env.add(armor, "ForeignArmorChild");
    const bar = env.add(tree.border, "ratking_armor_bar");
    bar.actuallayoutheight = 400;
    const middle = env.add(bar, "", ["ProgressBarMiddle"]);
    middle.actuallayoutheight = 100;
    tree.bars.AddClass("ratKingArmorActive");
    const f = start(env, { HEALTHBAR_TYPE: 5 });
    const icons = () => armor.FindChildrenWithClassTraverse("ArmorHeart");
    assert.equal(icons().length, 3, "250 armor HP occupies two full icons and a half");
    assert.equal(icons().filter(p => p.BHasClass("half")).length, 1);
    middle.actuallayoutheight = 20;
    env.clock.advance(100);
    assert.equal(icons().filter(p => p.visible).length, 1);
    tree.bars.RemoveClass("ratKingArmorActive");
    env.clock.advance(100);
    assert.equal(box.style.visibility, "collapse");
    f.onDisable(); env.clock.advance(1);
    assert.equal(icons().length, 0);
    assert.equal(foreign.IsValid(), true);
});

test("Minecraft XP follows native gold and level owners without HUD or gold-subtree probes", () => {
    const env = fixture(), { tree } = env;
    const stats = env.add(env.gameplay.GetParent(), "StatsAndModsContainer");
    const lower = env.add(stats, "LowerLeft");
    let broadLookups = 0;
    const goldTree = (height, level) => {
        const gold = env.add(lower, "gold_and_ap_container");
        const playerLevel = env.add(env.add(gold, "PlayerLevelContainer"), "PlayerLevel");
        const group = env.add(playerLevel, "", ["PlayerLevelContainer"]);
        const fill = env.add(env.add(group, "Souls"), "SoulsFill");
        fill.actuallayoutheight = height; fill.actualuiscale_y = 1;
        const label = env.add(group, "PlayerLevelNumber", [], "Label"); label.text = level;
        const find = gold.FindChildTraverse;
        gold.FindChildTraverse = function (id) { broadLookups++; return find.call(this, id); };
        return { gold, group, fill, label };
    };
    const find = env.root.FindChildTraverse;
    env.root.FindChildTraverse = function (id) {
        if (id === "gold_and_ap_container") broadLookups++;
        return find.call(this, id);
    };
    const mc = env.q.healthbar.mc.create({ id: "ql_healthbar" });
    const update = time => mc.update(env.root, {}, time, true);
    update(0);
    assert.equal(tree.xp.style.clip, undefined); assert.equal(tree.level.text, "");
    const first = goldTree(26, "7"); update(50); update(2000);
    assert.equal(tree.xp.style.clip, "rect( 0px, 50%, 100%, 0px )");
    assert.equal(tree.level.text, "7");
    first.gold.SetParent(env.other);
    const next = goldTree(39, "8"); update(2050);
    assert.equal(first.gold.IsValid(), true);
    assert.equal(tree.xp.style.clip, "rect( 0px, 75%, 100%, 0px )"); assert.equal(tree.level.text, "8");
    next.label.SetParent(env.other);
    env.add(next.group, "PlayerLevelNumber", [], "Label").text = "9"; update(2100);
    assert.equal(tree.level.text, "9", "live old labels cannot mask a current native binding");
    next.gold.SetParent(env.other); update(2150);
    assert.equal(tree.level.text, "9", "missing current gold never samples a retired owner elsewhere in the HUD");
    goldTree(52, "10"); update(2200);
    assert.equal(tree.level.text, "10"); assert.equal(tree.xp.style.clip, "rect( 0px, 100%, 100%, 0px )");
    assert.equal(broadLookups, 0, "gold and level replacements stay on their verified owners");
    mc.release();
    assert.equal(tree.xp.style.clip, undefined); assert.equal(tree.level.text, "");
    assert.deepEqual(env.clock.errors, []);
});

test("healthbar factories have no panel, style, callback or shared-state side effects", () => {
    const env = fixture();
    const before = env.clock.pendingCount();
    const keys = Object.keys(env.q.state);
    const original = env.tree.current.style.color = "native-color";
    const instance = env.q.core.FeatureRegistry.getManifest("ql_healthbar").create({ events: env.q.core.EventBus,
        id: "ql_healthbar", config: { view: () => ({ HEALTHBAR_TYPE: 5 }) }
    });
    assert.equal(env.clock.pendingCount(), before);
    assert.equal(env.tree.hearts.GetChildCount(), 0);
    assert.equal(env.tree.current.style.color, original);
    assert.deepEqual(Object.keys(env.q.state), keys);
    instance.onDisable();
});

test("shared healthbar presentation retries partial writes and releases only its native properties", () => {
    const env = fixture(), { health, canvas } = env.tree;
    const cfg = { HEALTHBAR_TYPE: 0, PLAYER_HEALTHBAR_SCALE: 150, PLAYER_HEALTHBAR_OPACITY: 0.62,
        PLAYER_HEALTHBAR_X_OFFSET: 80, PLAYER_HEALTHBAR_Y_OFFSET: 30 };
    health.style.transform = "native-tilt";
    health.style.preTransformScale2d = "native-animation";
    let fail = true;
    canvas.style = new Proxy(canvas.style, { set(target, key, value) {
        if (key === "height" && fail) { fail = false; throw new Error("temporary native style rejection"); }
        target[key] = value; return true;
    } });
    const f = start(env, cfg);
    assert.equal(canvas.style.height, undefined);
    env.clock.advance(700);
    assert.equal(canvas.style.height, "380px");
    assert.equal(canvas.style.uiScale, "150%");
    cfg.PLAYER_HEALTHBAR_SCALE = 100; cfg.PLAYER_HEALTHBAR_OPACITY = 1;
    cfg.PLAYER_HEALTHBAR_X_OFFSET = 0; cfg.PLAYER_HEALTHBAR_Y_OFFSET = 0;
    f.onSettingsChanged();
    for (const key of ["x", "y", "opacity", "uiScale"]) assert.equal(health.style[key], undefined);
    for (const key of ["width", "height", "uiScale"]) assert.equal(canvas.style[key], undefined);
    assert.equal(health.style.transform, "native-tilt");
    assert.equal(health.style.preTransformScale2d, "native-animation");
    f.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("healthbar restores native feedback and retries rejected opacity retirement after disable", () => {
    const env = fixture(), panel = env.tree.health;
    const cfg = { HEALTHBAR_TYPE: 0, PLAYER_HEALTHBAR_OPACITY: 0.4, PLAYER_HEALTHBAR_X_OFFSET: 35 };
    const feature = start(env, cfg);
    panel.style.opacity = "0.9"; panel.style.x = "90px";
    env.clock.advance(700);
    assert.equal(panel.style.opacity, "0.40"); assert.equal(panel.style.x, "35px");
    const clear = panel.ClearPropertyFromCode.bind(panel); let reject = true;
    panel.ClearPropertyFromCode = property => property === "opacity" && reject ? false : clear(property);
    feature.onDisable();
    assert.equal(panel.style.opacity, "0.40");
    reject = false; env.clock.advance(700);
    assert.equal(panel.style.opacity, undefined); assert.equal(panel.style.x, undefined);
    cfg.PLAYER_HEALTHBAR_OPACITY = 0.2;
    feature.onSettingsChanged(); env.clock.advance(700);
    assert.equal(panel.style.opacity, undefined, "stopped settings hooks cannot revive presentation");
    assert.deepEqual(env.clock.errors, []);
});

test("healthbar rebinding restores a still-living former native owner and reapplies unchanged accent", () => {
    const env = fixture(), old = env.tree;
    const cfg = { HEALTHBAR_TYPE: 1, PLAYER_HEALTHBAR_SCALE: 150, PLAYER_HEALTHBAR_X_OFFSET: 80,
        PLAYER_HEALTHBAR_ACCENT_COLOR: 2 };
    const f = start(env, cfg); env.clock.advance(20);
    assert.ok(old.frame.style.washColor);
    old.health.SetParent(env.other);
    const replacement = env.healthTree();
    env.clock.advance(700);
    assert.equal(old.health.style.x, undefined);
    assert.equal(old.canvas.style.uiScale, undefined);
    assert.equal(old.frame.style.washColor, undefined);
    assert.equal(replacement.health.style.x, "80px");
    assert.equal(replacement.canvas.style.uiScale, "150%");
    assert.ok(replacement.frame.style.washColor);
    f.onDisable(); env.clock.advance(30);
    assert.equal(replacement.frame.style.washColor, undefined);
});

test("accent retries rejected writes and disable cancels its delayed generation", () => {
    const env = fixture(), { frame } = env.tree;
    let failed = false;
    frame.style = new Proxy(frame.style, { set(target, key, value) {
        if (key === "washColor" && !failed) { failed = true; throw new Error("transient wash rejection"); }
        target[key] = value; return true;
    } });
    const f = start(env, { PLAYER_HEALTHBAR_ACCENT_COLOR: 3 });
    env.clock.advance(20);
    assert.equal(frame.style.washColor, undefined);
    env.clock.advance(700);
    assert.ok(frame.style.washColor);
    f.onDisable();
    env.q.healthbar.accent.update(env.root, { PLAYER_HEALTHBAR_ACCENT_COLOR: 4 }, env.tree.health);
    env.q.healthbar.accent.release();
    env.clock.advance(20);
    assert.equal(frame.style.washColor, undefined);
});

test("default healthbar accent skips descendant discovery and still releases a previous wash", () => {
    const env = fixture(), { health, frame } = env.tree;
    let searches = 0;
    for (const method of ["FindChildTraverse", "FindChildrenWithClassTraverse"]) {
        const native = health[method].bind(health);
        health[method] = (...args) => { searches++; return native(...args); };
    }
    const accent = env.q.healthbar.accent.create({ id: "ql_healthbar" });
    accent.update(env.root, { PLAYER_HEALTHBAR_ACCENT_COLOR: 0 }, health);
    assert.equal(searches, 0, "default appearance has no targets to discover");
    accent.update(env.root, { PLAYER_HEALTHBAR_ACCENT_COLOR: 2 }, health); env.clock.advance(20);
    assert.ok(frame.style.washColor);
    searches = 0;
    accent.update(env.root, { PLAYER_HEALTHBAR_ACCENT_COLOR: 0 }, health);
    assert.equal(frame.style.washColor, undefined);
    accent.update(env.root, { PLAYER_HEALTHBAR_ACCENT_COLOR: 0 }, health);
    assert.equal(searches, 0, "restoration uses owned handles without another subtree walk");
    accent.release();
});

test("retained Minimalist preset offsets and shared warning keys reach the actual dispatcher slice", () => {
    const env = fixture(), { q, tree } = env;
    q.core.ConfigAdapter.loadFromFlat({
        HEALTHBAR_TYPE: 1, PLAYER_HEALTHBAR_X_OFFSET: 10, PLAYER_HEALTHBAR_Y_OFFSET: 20,
        MINIMALIST_HEALTHBAR_X_OFFSET: 30, MINIMALIST_HEALTHBAR_Y_OFFSET: 40
    });
    q.core.FeatureRegistry.boot();
    assert.equal(tree.health.style.x, "40px");
    assert.equal(tree.health.style.y, "-60px");
    q.core.ConfigAdapter.loadFromFlat({ HEALTHBAR_TYPE: 4, ENABLE_COLOR_WARNING_65: 1 });
    env.clock.advance(200);
    assert.equal(tree.group.FindChild("HealthPercentLabel").text, "50%");
    assert.equal(tree.current.style.color, "rgb(255, 177, 0)");
    q.core.ConfigAdapter.loadFromFlat({ ENABLE_COLOR_WARNING_65: 0, ENABLE_COLORED_HEALTHBAR: 0 });
    env.clock.advance(200);
    assert.equal(tree.current.style.color, undefined);
    q.core.FeatureRegistry.disable("ql_healthbar");
    env.clock.advance(1);
    assert.equal(tree.group.FindChild("HealthPercentLabel"), null);
    assert.deepEqual(env.clock.errors, []);
});

test("Budhud binds replaced native labels, retries styles and releases its percentage on a mode change", () => {
    const env = fixture(), { tree } = env;
    const cfg = { HEALTHBAR_TYPE: 4, ENABLE_COLOR_WARNING_25: 1 };
    tree.current.text = "100";
    const f = start(env, cfg);
    assert.equal(tree.group.FindChild("HealthPercentLabel").text, "10%");
    const oldCurrent = tree.current;
    oldCurrent.SetParent(env.other);
    const replacement = env.add(tree.group, "", ["currentHealthLabel"], "Label"); replacement.text = "800";
    env.clock.advance(150);
    assert.equal(oldCurrent.style.color, undefined);
    assert.equal(tree.group.FindChild("HealthPercentLabel").text, "80%");
    cfg.HEALTHBAR_TYPE = 0; f.onSettingsChanged(); env.clock.advance(1);
    assert.equal(tree.group.FindChild("HealthPercentLabel"), null);
    assert.equal(replacement.style.color, undefined);
    f.onDisable();
    assert.deepEqual(env.clock.errors, []);
});

test("Budhud observes one warning color and never clears the warning owner's native label", () => {
    const env = fixture(), { q, tree } = env;
    tree.current.text = "100";
    q.core.ConfigAdapter.loadFromFlat({ HEALTHBAR_TYPE: 4, ENABLE_COLORED_HEALTHBAR: 0,
        ENABLE_COLOR_WARNING_25: 1, ENABLE_COLOR_WARNING_65: 0, ENABLE_COLOR_WARNING_75: 0 });
    q.core.FeatureRegistry.boot();
    const firstColor = tree.current.style.color;
    assert.equal(tree.group.FindChild("HealthPercentLabel").style.color, firstColor);
    q.core.FeatureRegistry.disable("ql_healthbar");
    env.clock.advance(1);
    assert.equal(tree.current.style.color, firstColor, "Budhud teardown cannot clear another owner's color");
    assert.equal(tree.group.FindChild("HealthPercentLabel"), null);
    assert.equal(q.core.FeatureRegistry.isEnabled("ql_color_warnings"), true);
    q.core.FeatureRegistry.enable("ql_healthbar");
    assert.equal(tree.group.FindChild("HealthPercentLabel").style.color, tree.current.style.color);
    q.core.ConfigAdapter.loadFromFlat({ ENABLE_COLOR_WARNING_25: 0 });
    env.clock.advance(200);
    assert.equal(tree.current.style.color, undefined);
    assert.equal(tree.group.FindChild("HealthPercentLabel").style.color, undefined);
    assert.deepEqual(env.clock.errors, []);
});

test("Minecraft reads verified native pending bars and keeps damage, healing and barrier feedback", () => {
    const env = fixture(), { tree } = env;
    tree.damage.actuallayoutheight = 40; // 10% pending damage -> true HP 400.
    tree.heal.actuallayoutheight = 80;   // 20% incoming heal -> target HP 700.
    tree.shields.AddClass("HasBulletShield");
    const f = start(env, { HEALTHBAR_TYPE: 5 });
    assert.equal(tree.mcPercent.text.trim(), "[50%]");
    assert.equal(fills(tree, "HeartFill").filter(panel => panel.BHasClass("full")).length, 4);
    assert.ok(fills(tree, "HeartDeferred").some(panel => panel.style.visibility === "visible"));
    assert.ok(fills(tree, "HeartHealing").some(panel => panel.style.visibility === "visible"));
    assert.equal(tree.shieldHearts.FindChildrenWithClassTraverse("HeartSlot").length, 5);
    assert.equal(env.q.healthbar.mc.inspect().healing, true);
    tree.bulletMax.text = "/ 300"; env.clock.advance(80);
    assert.equal(tree.shieldHearts.FindChildrenWithClassTraverse("HeartSlot").filter(panel => panel.style.visibility === "visible").length, 3);
    const line = tree.border.GetParent();
    tree.border.SetParent(env.other);
    const border = env.add(line, "", ["health_bar_border"]);
    env.clock.advance(80);
    assert.equal(tree.border.IsValid(), true, "the old native feedback generation remains alive");
    assert.equal(fills(tree, "HeartFill").filter(panel => panel.BHasClass("full")).length, 5);
    assert.equal(env.q.healthbar.mc.inspect().healing, false, "missing current bars cannot retain the old healing wave");
    const damage = env.add(border, "pending_incoming_damage"); damage.actuallayoutheight = 400;
    env.add(damage, "", ["ProgressBarMiddle"]).actuallayoutheight = 40;
    env.clock.advance(80);
    assert.equal(fills(tree, "HeartFill").filter(panel => panel.BHasClass("full")).length, 4, "late feedback binds inside the current native border");
    f.onDisable(); env.clock.advance(1);
    assert.equal(tree.hearts.GetChildCount(), 0);
    assert.equal(tree.shieldHearts.GetChildCount(), 0);
    assert.equal(tree.shieldBox.style.visibility, undefined);
});

test("Minecraft projects full, half and empty fills with each layer's texture", () => {
    const env = fixture(), { tree, q } = env;
    const images = new Map(), create = env.sandbox.global.$.CreatePanel;
    env.sandbox.global.$.CreatePanel = (...args) => {
        const panel = create(...args), setImage = panel.SetImage;
        panel.SetImage = image => { images.set(panel, image); return setImage.call(panel, image); };
        return panel;
    };
    tree.current.text = "450";
    tree.damage.actuallayoutheight = 40;
    tree.heal.actuallayoutheight = 80;
    tree.shields.AddClass("HasBulletShield");
    const mc = q.healthbar.mc.create({ id: "ql_healthbar" });
    mc.update(env.root, {}, env.clock.now(), true);
    const check = (panels, start, prefix) => {
        for (const [offset, kind] of ["full", "half", "empty"].entries()) {
            const panel = panels[start + offset];
            assert.deepEqual(["full", "half", "empty"].filter(cls => panel.BHasClass(cls)), [kind]);
            assert.equal(panel.style.visibility, kind === "empty" ? "collapse" : "visible");
            if (kind !== "empty") assert.equal(images.get(panel), `s2r://panorama/images/minecraft/${prefix}${kind}_8x_png.vtex`);
        }
    };
    check(fills(tree, "HeartFill"), 2, "");
    check(fills(tree, "HeartDeferred"), 3, "orange_");
    check(fills(tree, "HeartHealing"), 5, "green_");
    check(tree.shieldHearts.FindChildrenWithClassTraverse("HeartFill"), 1, "absorption_");
    env.add(env.modifierTree().centerDebuffs, "", ["modifier_name"], "Label").text = "AFFLICTED";
    env.clock.advance(501); mc.update(env.root, {}, env.clock.now(), true);
    check(fills(tree, "HeartFill"), 2, "poisoned_");
    const changing = fills(tree, "HeartFill")[3];
    tree.current.text = "500"; mc.update(env.root, {}, env.clock.now() + 50, true);
    assert.equal(changing.BHasClass("full"), true); assert.equal(changing.BHasClass("half"), false);
    tree.current.text = "400"; mc.update(env.root, {}, env.clock.now() + 100, true);
    assert.equal(changing.BHasClass("full"), false); assert.equal(changing.BHasClass("empty"), true);
    assert.equal(changing.style.visibility, "collapse");
    mc.release(); env.clock.advance(1000);
    assert.deepEqual(env.clock.errors, []);
});

test("Minecraft poisoned hearts read live modifier owners and ignore retained history", () => {
    const env = fixture(), modifiers = env.modifierTree();
    const images = new Map(), create = env.sandbox.global.$.CreatePanel;
    env.sandbox.global.$.CreatePanel = (...args) => {
        const panel = create(...args), setImage = panel.SetImage;
        panel.SetImage = image => { images.set(panel, image); return setImage.call(panel, image); };
        return panel;
    };
    const history = env.add(env.gameplay.GetParent(), "hud_modifier_history", ["hud_modifier_history"]);
    const tracks = env.add(history, "modifier_tracks");
    const track = env.add(tracks, "", ["modifier_history_track"]);
    const item = env.add(track, "", ["modifier_history_item"]);
    const tag = env.add(item, "", ["modifier_tag"]);
    env.add(tag, "", ["modifier_name"], "Label").text = "AFFLICTED";
    let broadLookups = 0;
    const enumerate = env.root.FindChildrenWithClassTraverse;
    env.root.FindChildrenWithClassTraverse = function (name) {
        if (name === "modifier_name") broadLookups++;
        return enumerate.call(this, name);
    };
    const poisoned = () => fills(env.tree, "HeartFill").some(panel => images.get(panel)?.includes("/poisoned_"));
    const f = start(env, { HEALTHBAR_TYPE: 5 });
    assert.equal(poisoned(), false, "modifier history does not describe a current debuff");
    for (const owner of [modifiers.centerDebuffs, modifiers.auraDebuffs]) {
        const label = env.add(owner, "", ["modifier_name"], "Label"); label.text = "Afflicted";
        env.clock.advance(550); assert.equal(poisoned(), true);
        label.SetParent(env.other);
        env.clock.advance(550); assert.equal(poisoned(), false, "retained out-of-owner labels are retired");
    }
    env.add(modifiers.centerDebuffs, "", ["modifier_name"], "Label").text = "AFFLICTED";
    env.clock.advance(550); assert.equal(poisoned(), true);
    modifiers.center.SetParent(env.other);
    const replacement = env.add(modifiers.statusBars, "hud_modifiers");
    env.add(replacement, "BuffModifiers"); env.add(replacement, "DebuffModifiers");
    env.clock.advance(50);
    assert.equal(poisoned(), false, "owner replacement invalidates the cached modifier result immediately");
    assert.equal(broadLookups, 0, "missing and replaced named modifier owners never trigger a HUD-wide scan");
    f.onDisable(); env.clock.advance(1);
    assert.equal(env.tree.hearts.GetChildCount(), 0); assert.deepEqual(env.clock.errors, []);
});

test("Minecraft tracks grid/food/health source replacements while previous panels stay alive", () => {
    const env = fixture(), { tree } = env;
    tree.current.text = "100";
    const f = start(env, { HEALTHBAR_TYPE: 5 });
    assert.equal(env.q.healthbar.mc.inspect().lowHealth, true);
    tree.hearts.SetParent(env.other);
    const nextHearts = env.add(tree.heartsRoot, "MinecraftHearts");
    const nativeChild = env.add(nextHearts, "ForeignChild");
    env.clock.advance(100);
    assert.equal(tree.hearts.GetChildCount(), 0);
    assert.ok(nextHearts.FindChildrenWithClassTraverse("HeartSlot").length > 0);
    assert.equal(nativeChild.IsValid(), true, "only controller-owned rows are replaced");
    tree.health.SetParent(env.other);
    const next = env.healthTree();
    env.clock.advance(100);
    assert.equal(env.q.healthbar.mc.inspect().source, next.canvas);
    assert.equal(next.mcPercent.text.trim(), "[50%]");
    assert.equal(env.q.healthbar.mc.inspect().lowHealth, false);
    f.onDisable(); env.clock.advance(1);
    assert.equal(nativeChild.IsValid(), true);
    assert.equal(env.q.healthbar.mc.inspect().pendingAnimations, 0);
    assert.deepEqual(env.clock.errors, []);
});

test("Minecraft does not cache a partially rendered image and preserves native number bindings", () => {
    const env = fixture(), { tree, q } = env;
    const originalCreate = env.sandbox.global.$.CreatePanel;
    let failed = false;
    env.sandbox.global.$.CreatePanel = (...args) => {
        const panel = originalCreate(...args);
        if (args[0] === "Image") {
            const setImage = panel.SetImage;
            panel.SetImage = image => {
                if (panel.BHasClass("HeartFill") && !failed) { failed = true; throw new Error("transient image rejection"); }
                return setImage.call(panel, image);
            };
        }
        return panel;
    };
    const mc = q.healthbar.mc.create({ id: "ql_healthbar" });
    assert.throws(() => mc.update(env.root, { HEALTHBAR_TYPE: 5 }, env.clock.now(), true), /transient image rejection/);
    mc.update(env.root, { HEALTHBAR_TYPE: 5 }, env.clock.now() + 50, true);
    assert.equal(fills(tree, "HeartFill").filter(panel => panel.BHasClass("full")).length, 5);
    assert.equal(tree.current.text, "500");
    assert.equal(tree.total.text, "/ 1000");
    mc.release();
});


test("selected Minecraft healthbar in hideout uses an owned sample, preserves native bindings and retires on lease expiry", () => {
    const env = fixture(), { q, tree } = env;
    env.root.AddClass("InHideout");
    env.root.AddClass("QOLCustomizeActive");
    tree.current.text = ""; tree.total.text = "";
    const preview = q.presentation.preview;
    const stamp = q.core.persistence.getConfigChangeStamp(q.getUIRoot());
    preview.write(env.root, {}, "health-sample", stamp, "healthbar");
    preview.commit(preview.consume(env.root, q.buildDefaultConfig()));
    const f = start(env, { HEALTHBAR_TYPE: 5 });
    assert.equal(tree.mcPercent.text.trim(), "[75%]");
    assert.ok(fills(tree, "HeartFill").length > 0);
    assert.equal(tree.current.text, ""); assert.equal(tree.total.text, "");
    env.clock.advance(2600);
    assert.equal(tree.hearts.GetChildCount(), 0);
    f.onDisable(); env.clock.advance(1);
    assert.deepEqual(env.clock.errors, []);
});
