"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function fixture() {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    hud.sandbox.eval("Math.random = () => 0;");
    const { $, QOL: Q } = hud.sandbox.global;
    hud.root.AddClass("joined_team");
    const add = (parent, id, classes = []) => {
        const panel = $.CreatePanel("Panel", parent, id);
        for (const name of classes) panel.AddClass(name);
        return panel;
    };
    const text = (parent, id, value, classes = []) => {
        const panel = $.CreatePanel("Label", parent, id);
        panel.text = value;
        for (const name of classes) panel.AddClass(name);
        return panel;
    };
    const core = add(hud.root, "", ["HudCore"]);
    const gameplay = add(core, "gameplay_hud");
    const retired = add(hud.doc.absRoot, "RetiredTestGeneration");
    const config = patch => Q.core.ConfigAdapter.loadFromFlat(patch);
    const find = id => hud.root.FindChildTraverse(id);
    return { hud, Q, $, add, text, core, gameplay, retired, config, find };
}

function addFire(env, parent, value) {
    const source = env.add(parent, "hudActivePlayerStats");
    const list = env.add(source, "StatList");
    const weapon = env.add(list, "WeaponColumn");
    const row = env.add(weapon, "fireRateContainer", ["shouldShow", "isPositive"]);
    const core = env.add(row, "", ["miniModifierCore"]);
    env.text(core, "", value, ["statNumber"]);
    env.text(core, "", "%", ["statPostfix"]);
    return { source, row, core };
}

function enableCrosshair(env) {
    env.config({ ENABLE_CROSSHAIR_STATS: 1, CROSSHAIR_STATS_SHOW_FIRERATE: 1, CROSSHAIR_STATS_SHOW_BUFFS: 1,
        CROSSHAIR_STATS_X_OFFSET: 25, CROSSHAIR_STATS_Y_OFFSET: 20, CROSSHAIR_STATS_SCALE: 140, CROSSHAIR_STATS_OPACITY: 0.6 });
}

function addTopbar(env, clock = "20:00") {
    const top = env.add(env.core, "TopBar");
    const gameTime = env.text(top, "GameTime", clock);
    return { top, gameTime };
}

function addCapture(env, top, nativeBuff = true) {
    const charges = env.add(top, "RejuvenatorCharges");
    const friendly = env.add(charges, "RejuvenatorFriendly", ["RejuvCount_3"]);
    env.add(charges, "RejuvenatorEnemy", ["RejuvCount_0"]);
    const timer = env.add(charges, "RejuvenatorTimer", nativeBuff ? ["has_rejuv"] : []);
    const panel = env.add(top, "RejuvBuff");
    const label = env.text(panel, "RejuvTimeBuff", "");
    return { charges, friendly, timer, panel, label };
}

function addNativeMinimap(env, gameplay = env.gameplay) {
    let owner = env.add(gameplay, "", ["clamp_width"]);
    for (const id of ["minimap_persp", "minimap_container", "HudMinimapContainer"]) owner = env.add(owner, id);
    return env.add(owner, "hud_minimap");
}

test("bridge timers observe immediate native spawners and ignore nested marker lookalikes", () => {
    const env = fixture(), renderer = addNativeMinimap(env);
    addTopbar(env, "12:10");
    const marker = (parent, position, classes = []) => {
        const panel = env.add(parent, "", ["map_button", "powerup_spawn", ...classes]);
        panel.style.position = position;
        return panel;
    };
    const left = marker(renderer, "25% 50% 0px"), right = marker(renderer, "75% 50% 0px");
    const unrelated = env.add(renderer, "OtherMarkerContent");
    marker(unrelated, "25% 50% 0px", ["active"]);
    env.config({ ENABLE_MINIMAP_BUFF_TIMER: 1, ENABLE_MINIMAP_BUFF_TIMER_ON_BRIDGE: 1 });
    env.hud.clock.advance(400);
    const leftTimer = env.find("QOLMinimapBuffBridgeLeftTimer"), rightTimer = env.find("QOLMinimapBuffBridgeRightTimer");
    assert.equal(leftTimer.BHasClass("qol-hidden"), false, "nested generated content is not a native spawner root");
    assert.equal(rightTimer.BHasClass("qol-hidden"), false);
    right.AddClass("powerup_gun"); left.AddClass("active"); env.hud.clock.advance(400);
    assert.equal(leftTimer.BHasClass("qol-hidden"), true); assert.equal(rightTimer.BHasClass("qol-hidden"), true);
    left.SetParent(unrelated); right.RemoveClass("powerup_gun"); env.hud.clock.advance(400);
    assert.equal(leftTimer.BHasClass("qol-hidden"), false, "living moved spawners leave the native source set immediately");
    assert.equal(rightTimer.BHasClass("qol-hidden"), false);
    marker(renderer, "25% 50% 0px", ["powerup_movement"]); env.hud.clock.advance(400);
    assert.equal(leftTimer.BHasClass("buff_spawned"), true, "late current spawners are sampled without retaining native lists");
    assert.equal(rightTimer.BHasClass("buff_spawned"), false);
    env.Q.core.FeatureRegistry.disable("ql_minimap_timers"); env.hud.clock.advance(20);
    assert.ok(!env.find("QOLMinimapTimersRoot")); assert.deepEqual(env.hud.clock.errors, []);
});

test("compass samples immediate native marker roots while preserving cone priority and local fallback", () => {
    const env = fixture(), renderer = addNativeMinimap(env);
    const marker = (parent, degrees, classes) => {
        const panel = env.add(parent, "", ["player", ...classes]);
        env.$.CreatePanel("Image", panel, "MainImage").style.preTransformRotate2d = degrees + "deg";
        return panel;
    };
    const generated = env.add(renderer, "NestedMarkerContent");
    marker(generated, 120, ["active", "client_cone_fov"]);
    const local = marker(renderer, 40, ["localplayer"]);
    env.config({ ENABLE_COMPASS: 1, ENABLE_COMPASS_SPEED: 0, MINIMAP_ROTATE_WITH_PLAYER: 0 });
    env.hud.clock.advance(300);
    const read = () => env.find("QOLCompassDegree").text;
    assert.equal(read(), "40°", "a nested lookalike cannot outrank the native local marker");
    const cone = marker(renderer, 75, ["active", "client_cone_fov"]); env.hud.clock.advance(300);
    assert.equal(read(), "75°", "the preferred active cone still outranks an earlier local marker");
    cone.SetParent(generated); env.hud.clock.advance(100);
    assert.equal(read(), "40°", "a living source moved under another component leaves the source set immediately");
    local.SetParent(generated); marker(renderer, 95, ["localplayer"]); env.hud.clock.advance(100);
    assert.equal(read(), "95°", "a late current marker replaces the living old source");
    env.Q.core.FeatureRegistry.disable("ql_compass"); env.hud.clock.advance(20);
    assert.ok(!env.find("QOLCompassRoot")); assert.deepEqual(env.hud.clock.errors, []);
});

test("Rift evidence stays in the current native renderer and its immediate capture-point roots", () => {
    const env = fixture(); addTopbar(env, "12:00");
    const foreign = env.add(env.hud.root, "hud_minimap");
    env.add(foreign, "", ["map_button", "capture_point", "koth_warning"]);
    env.config({ ENABLE_URN_TIMER: 1 }); env.hud.clock.advance(600);
    const read = () => env.find("RiftTimer");
    assert.equal(read().BHasClass("rift_idle"), true, "a different component cannot supply native capture-point evidence");
    const renderer = addNativeMinimap(env);
    const current = env.add(renderer, "", ["map_button", "capture_point", "active"]);
    const nested = env.add(renderer, "OtherMarkerContent");
    env.add(nested, "", ["map_button", "capture_point", "koth_warning"]);
    env.hud.clock.advance(600);
    assert.equal(read().BHasClass("rift_active"), true, "nested marker content cannot outrank a current native root");
    current.AddClass("koth_warning"); env.hud.clock.advance(600);
    assert.equal(read().BHasClass("rift_warning"), true, "native warning still wins over the active class");
    current.RemoveClass("koth_warning"); env.hud.clock.advance(600);
    assert.equal(read().BHasClass("rift_active"), true);
    current.SetParent(nested); env.hud.clock.advance(600);
    assert.equal(read().BHasClass("rift_idle"), true, "a living moved marker leaves the current source set");
    env.Q.core.FeatureRegistry.disable("ql_urn_timer"); env.hud.clock.advance(20);
    assert.ok(!env.find("RiftTimer")); assert.deepEqual(env.hud.clock.errors, []);
});

function addRoster(env, top) {
    const teams = env.add(top, "TeamsContainer");
    const team = env.add(teams, "TeamFriendly");
    const contents = env.add(team, "PlayerContents");
    const players = env.add(contents, "PlayersContainer");
    return { teams, team, contents, players };
}

function addUlt(env, players, cooldown) {
    const player = env.add(players, "Player");
    const details = env.add(player, "PlayerDetailsContainer");
    const status = env.add(details, "StatusRow");
    const ultimate = env.add(status, "UltimateStatus");
    const background = env.add(ultimate, "UltimateStatusBG");
    const hidden = env.text(background, "UltimateCooldownTextHidden", cooldown);
    const shown = env.text(status, "UltimateCooldownTextShown", "");
    return { player, status, background, hidden, shown };
}

function createdTree(panel) {
    const result = [], queue = [panel];
    while (queue.length) { const current = queue.shift(); if (!current) continue; result.push(current); queue.push(...current.Children()); }
    return result;
}

const createdOwners = [
    { id: "ql_crosshair_stats", key: "ENABLE_CROSSHAIR_STATS", overlay: "QOLCrosshairStatsOverlay", label: "QOLCrosshairStatRow_fireRate_value" },
    { id: "ql_urn_timer", key: "ENABLE_URN_TIMER", overlay: "RiftTimer", label: "RiftTimerLabel" }
];
function directCreatedOwner(env, def) {
    env.Q.core.App.shutdown();
    env.config({ [def.key]: 1, CROSSHAIR_STATS_SHOW_FIRERATE: 1, CROSSHAIR_STATS_SHOW_BUFFS: 1 });
    const create = () => env.Q.core.FeatureRegistry.getManifest(def.id).create({ events: env.Q.core.EventBus, id: def.id, config: { view: () => env.Q.core.ConfigStore.view(def.id) } });
    const source = addFire(env, env.core, "+12");
    const { top, gameTime } = addTopbar(env, "12:00"), map = addNativeMinimap(env);
    env.add(map, "TestCapturePoint", ["map_button", "capture_point", "koth_warning"]);
    return { feature: create(), create, source, top, gameTime };
}

for (const def of createdOwners) {
    test(def.id + ": retires all living moved children and contains stopped hooks", () => {
        const env = fixture(), { feature, source } = directCreatedOwner(env, def);
        feature.onEnable(); env.hud.clock.advance(600); const overlay = env.find(def.overlay);
        const children = createdTree(overlay).slice(1); assert.ok(children.length > 0);
        for (const panel of children) panel.SetParent(env.retired);
        env.hud.clock.advance(600); for (const panel of children) assert.equal(panel.IsValid(), false, panel.id);
        assert.equal(env.find(def.label).text, def.id === "ql_urn_timer" ? "0:20" : "+12%");
        const moved = env.find(def.label); moved.SetParent(env.retired);
        feature.onDisable(); env.hud.clock.advance(20); assert.equal(moved.IsValid(), false);
        feature.onSettingsChanged(); env.hud.clock.advance(1000); assert.equal(env.find(def.overlay), null);
        assert.equal(source.row.BHasClass("shouldShow"), true); assert.equal(source.source.IsValid(), true);
        assert.deepEqual(env.hud.clock.errors, []);
    });

    test(def.id + ": rapid re-enable waits for every retired tree instead of adopting it", () => {
        const env = fixture(), { feature, create } = directCreatedOwner(env, def);
        feature.onEnable(); env.hud.clock.advance(600); const previous = env.find(def.overlay);
        feature.onDisable(); let writes = 0;
        previous.style = new Proxy(previous.style, { set(target, key, value) { writes++; target[key] = value; return true; } });
        const next = create(); next.onEnable(); next.onSettingsChanged(); assert.equal(writes, 0);
        env.hud.clock.advance(600); assert.equal(previous.IsValid(), false);
        assert.ok(env.find(def.overlay)); assert.notEqual(env.find(def.overlay), previous);
        next.onDisable(); env.hud.clock.advance(20); assert.equal(env.find(def.overlay), null); assert.deepEqual(env.hud.clock.errors, []);
    });

    test(def.id + ": current Hud generations reset private source/model bindings while old sources stay live", () => {
        const env = fixture(), { feature, source, gameTime } = directCreatedOwner(env, def);
        feature.onEnable(); env.hud.clock.advance(600); gameTime.text = "12:05"; env.hud.clock.advance(600);
        if (def.id === "ql_urn_timer") assert.equal(env.find(def.label).text, "0:15");
        const previous = createdTree(env.find(def.overlay));
        env.hud.doc.root = env.$.CreatePanel("CitadelHud", null, "Hud"); env.hud.doc.root.AddClass("joined_team");
        const core = env.add(env.hud.doc.root, "", ["HudCore"]), gameplay = env.add(core, "gameplay_hud");
        addFire(env, core, "+36");
        const top = env.add(core, "TopBar"); env.text(top, "GameTime", "12:05");
        const map = addNativeMinimap(env, gameplay); env.add(map, "NextCapturePoint", ["map_button", "capture_point", "koth_warning"]);
        feature.onSettingsChanged(); env.hud.clock.advance(600);
        const label = env.hud.doc.root.FindChildTraverse(def.label);
        assert.equal(label.text, def.id === "ql_urn_timer" ? "0:20" : "+36%");
        for (const panel of previous) assert.equal(panel.IsValid(), false, panel.id);
        assert.equal(source.source.IsValid(), true); assert.equal(env.hud.root.IsValid(), true);
        feature.onDisable(); env.hud.clock.advance(20);
        assert.equal(env.hud.doc.root.FindChildTraverse(def.overlay), null); assert.deepEqual(env.hud.clock.errors, []);
    });
}

test("crosshair replaces an alive overlay generation with its current layout and content", () => {
    const env = fixture();
    addFire(env, env.core, "+12");
    enableCrosshair(env);
    env.hud.clock.advance(200);
    const first = env.find("QOLCrosshairStatsOverlay");
    assert.equal(first.style.marginLeft, "135px");
    assert.equal(first.style.marginTop, "0px");
    assert.equal(first.style.x, "25px"); assert.equal(first.style.y, "-20px");
    first.SetParent(env.retired);
    env.hud.clock.advance(100);
    const second = env.find("QOLCrosshairStatsOverlay");
    assert.notEqual(second, first);
    assert.equal(second.style.uiScale, "140%");
    assert.equal(second.style.opacity, "0.60");
    assert.equal(env.find("QOLCrosshairStatRow_fireRate_value").text, "+12%");
    env.config({ ENABLE_CROSSHAIR_STATS: 0 });
    env.hud.clock.advance(1000);
    assert.equal(env.find("QOLCrosshairStatsOverlay"), null);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("crosshair retries partial row creation and incomplete style writes", () => {
    const env = fixture();
    addFire(env, env.core, "+12");
    const create = env.$.CreatePanel;
    let rejectCreation = true;
    env.$.CreatePanel = (type, parent, id, properties) => {
        if (id === "QOLCrosshairStatRow_fireRate_value" && rejectCreation) { rejectCreation = false; throw Error("temporary creation failure"); }
        return create(type, parent, id, properties);
    };
    enableCrosshair(env);
    env.hud.clock.advance(300);
    const overlay = env.find("QOLCrosshairStatsOverlay");
    assert.equal(env.find("QOLCrosshairStatRow_fireRate_value").text, "+12%");
    let rejectScale = true;
    overlay.style = new Proxy(overlay.style, { set(target, key, value) {
        if (key === "uiScale" && rejectScale) { rejectScale = false; throw Error("temporary native style rejection"); }
        target[key] = value; return true;
    } });
    env.config({ CROSSHAIR_STATS_SCALE: 160 });
    assert.equal(overlay.style.uiScale, "140%");
    env.hud.clock.advance(100);
    assert.equal(overlay.style.uiScale, "160%");
    assert.deepEqual(env.hud.clock.errors, []);
});

test("crosshair releases detached source value handles and picks a new native modifier core", () => {
    const env = fixture();
    const { row, core } = addFire(env, env.core, "+12");
    enableCrosshair(env);
    env.hud.clock.advance(200);
    core.SetParent(env.retired);
    const replacement = env.add(row, "", ["miniModifierCore"]);
    env.text(replacement, "", "+30", ["statNumber"]);
    env.text(replacement, "", "%", ["statPostfix"]);
    env.hud.clock.advance(100);
    assert.equal(env.find("QOLCrosshairStatRow_fireRate_value").text, "+30%");
    assert.deepEqual(env.hud.clock.errors, []);
});

test("ultimate mirror observes roster replacement with unchanged player counts and retires old classes", () => {
    const env = fixture();
    const { top } = addTopbar(env);
    const roster = addRoster(env, top);
    const first = addUlt(env, roster.players, "45");
    env.config({ ENABLE_ULT_COOLDOWNS: 1 });
    env.hud.clock.advance(250);
    assert.equal(first.shown.text, "45");
    roster.players.SetParent(env.retired);
    const players = env.add(roster.contents, "PlayersContainer");
    const second = addUlt(env, players, "18");
    env.hud.clock.advance(250);
    assert.equal(second.shown.text, "18");
    assert.equal(first.shown.text, "");
    assert.equal(first.player.BHasClass("ult_cooldowns_active"), false);
    assert.equal(first.hidden.text, "45");
    env.config({ ENABLE_ULT_COOLDOWNS: 0 });
    assert.equal(second.player.BHasClass("ult_cooldowns_active"), false);
    assert.equal(second.shown.text, "");
    assert.deepEqual(env.hud.clock.errors, []);
});

test("ultimate mirror binds replacement labels and clears obsolete text after source loss", () => {
    const env = fixture();
    const { top } = addTopbar(env);
    const { players } = addRoster(env, top);
    const slot = addUlt(env, players, "45");
    env.config({ ENABLE_ULT_COOLDOWNS: 1 });
    env.hud.clock.advance(250);
    slot.hidden.SetParent(env.retired);
    slot.shown.SetParent(env.retired);
    const hidden = env.text(slot.background, "UltimateCooldownTextHidden", "9");
    const shown = env.text(slot.status, "UltimateCooldownTextShown", "");
    env.hud.clock.advance(250);
    assert.equal(shown.text, "9");
    assert.equal(slot.shown.text, "");
    hidden.SetParent(env.retired);
    env.hud.clock.advance(250);
    assert.equal(shown.text, "");
    env.config({ ENABLE_ULT_COOLDOWNS: 0 });
    assert.equal(slot.player.BHasClass("ult_cooldowns_active"), false);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("ultimate partial enable failure unwinds owned presentation and permits a clean retry", () => {
    const env = fixture();
    const { top } = addTopbar(env);
    const { players } = addRoster(env, top);
    const slot = addUlt(env, players, "45");
    let rejectWrite = true, content = "";
    Object.defineProperty(slot.shown, "text", {
        configurable: true, get: () => content,
        set(value) { if (rejectWrite) throw Error("temporary native label rejection"); content = value; }
    });
    env.config({ ENABLE_ULT_COOLDOWNS: 1 });
    assert.equal(env.Q.core.FeatureRegistry.isEnabled("ql_ult_cooldowns"), false);
    assert.equal(slot.player.BHasClass("ult_cooldowns_active"), false);
    assert.equal(top.BHasClass("ult_cooldowns_active"), false);
    rejectWrite = false;
    env.Q.core.FeatureRegistry.enable("ql_ult_cooldowns");
    assert.equal(content, "45");
    env.config({ ENABLE_ULT_COOLDOWNS: 0 });
    env.hud.clock.advance(1000);
    assert.equal(content, "");
    assert.equal(slot.player.BHasClass("ult_cooldowns_active"), false);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("rejuv retains a capture through an unknown charge-source gap and updates a replacement topbar", () => {
    const env = fixture();
    const { top, gameTime } = addTopbar(env);
    const first = addCapture(env, top);
    env.config({ ENABLE_BUFF_HUD: 1 });
    env.hud.clock.advance(300);
    assert.equal(first.label.text, "3:00");
    first.charges.SetParent(env.retired);
    gameTime.text = "20:01";
    env.hud.clock.advance(600);
    assert.equal(first.panel.style.opacity, "1.00");
    assert.equal(first.label.text, "2:59");
    top.SetParent(env.retired);
    const next = addTopbar(env, "20:02");
    const second = addCapture(env, next.top);
    env.hud.clock.advance(600);
    assert.equal(first.panel.style.opacity, "0.00");
    assert.equal(first.panel.BHasClass("pop-out"), false);
    assert.equal(second.panel.style.opacity, "1.00");
    assert.equal(second.label.text, "2:58");
    env.config({ ENABLE_BUFF_HUD: 0 });
    env.hud.clock.advance(1000);
    assert.equal(second.panel.style.opacity, "0.00");
    assert.equal(second.panel.BHasClass("pop-out"), false);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("rejuv readouts follow shipped owners and ignore same-ID panels in another component", () => {
    const env = fixture(), { top, gameTime } = addTopbar(env);
    const source = addCapture(env, top);
    source.panel.SetParent(env.add(top, "UnrelatedTimerComponent")); source.label.text = "foreign";
    let broadLookups = 0;
    const find = top.FindChildTraverse;
    top.FindChildTraverse = function (id) {
        if (id === "RejuvBuff" || id === "RejuvTimeBuff") broadLookups++;
        return find.call(this, id);
    };
    env.config({ ENABLE_BUFF_HUD: 1 }); env.hud.clock.advance(300);
    assert.equal(source.label.text, "foreign", "another component's same-ID readout is never adopted");
    assert.equal(source.panel.style.opacity, undefined);
    const panel = env.add(top, "RejuvBuff"), label = env.text(panel, "RejuvTimeBuff", "pending");
    env.hud.clock.advance(300);
    assert.equal(label.text, "3:00"); assert.equal(panel.style.opacity, "1.00");
    label.SetParent(env.retired);
    const replacement = env.text(panel, "RejuvTimeBuff", "pending"); gameTime.text = "20:01";
    env.hud.clock.advance(600);
    assert.equal(replacement.text, "2:59"); assert.equal(label.text, "3:00");
    assert.equal(source.label.text, "foreign");
    assert.equal(broadLookups, 0, "late and replaced readouts stay inside their shipped direct owners");
    env.config({ ENABLE_BUFF_HUD: 0 });
    assert.equal(panel.style.opacity, "0.00"); assert.equal(source.panel.style.opacity, undefined);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("rejuv publishes scalar phase state for the minimap-only consumer and resets at match transitions", () => {
    const env = fixture();
    const { top, gameTime } = addTopbar(env);
    env.config({ ENABLE_REJUV_HUD: 0, ENABLE_BUFF_HUD: 0, ENABLE_MINIMAP_REJUV_TIMER: 1 });
    env.hud.clock.advance(400);
    assert.equal(env.Q.core.FeatureRegistry.isEnabled("ql_rejuv_hud"), true);
    assert.deepEqual(JSON.parse(JSON.stringify(env.Q.state.rejuvState)), { running: true, spawnWaiting: true, counter: 0 });
    const map = addNativeMinimap(env);
    const midboss = env.add(map, "TestMidBoss", ["mid_boss", "map_button", "midboss_spawned"]);
    env.hud.clock.advance(10500);
    midboss.RemoveClass("midboss_spawned");
    gameTime.text = "20:01";
    env.hud.clock.advance(600);
    assert.equal(env.Q.state.rejuvState.spawnWaiting, false);
    assert.equal(env.Q.state.rejuvState.counter, 420);
    assert.deepEqual(Object.keys(env.Q.state.rejuvState).sort(), ["counter", "running", "spawnWaiting"]);
    env.hud.root.AddClass("InHideout");
    env.hud.clock.advance(300);
    assert.equal(env.Q.state.rejuvState.running, false);
    assert.equal(env.Q.state.rejuvState.counter, 0);
    env.hud.root.RemoveClass("InHideout");
    gameTime.text = "0:01";
    env.hud.clock.advance(400);
    assert.equal(env.Q.state.rejuvState.spawnWaiting, true);
    env.config({ ENABLE_MINIMAP_REJUV_TIMER: 0 });
    assert.equal(env.Q.state.rejuvState.running, false);
    assert.deepEqual(env.hud.clock.errors, []);
    assert.equal(top.IsValid(), true);
});

test("rejuv midboss evidence stays in the current native renderer through gaps and replacement", () => {
    const env = fixture(), { gameTime } = addTopbar(env, "12:00");
    env.Q.core.App.shutdown();
    const unrelated = env.add(env.gameplay, "hud_minimap");
    const decoy = env.add(unrelated, "", ["mid_boss", "map_button", "midboss_spawned"]);
    let broadLookups = 0;
    const find = env.hud.root.FindChildTraverse, enumerate = env.hud.root.FindChildrenWithClassTraverse;
    env.hud.root.FindChildTraverse = function (id) {
        if (id === "hud_minimap" || id === "minimap_persp") broadLookups++;
        return find.call(this, id);
    };
    env.hud.root.FindChildrenWithClassTraverse = function (name) {
        if (name === "mid_boss") broadLookups++;
        return enumerate.call(this, name);
    };
    const feature = env.Q.core.FeatureRegistry.getManifest("ql_rejuv_hud").create({
        id: "ql_rejuv_hud", events: env.Q.core.EventBus,
        config: { view: () => ({ ENABLE_REJUV_HUD: 1 }) }
    });
    feature.onEnable(); env.hud.clock.advance(400);
    decoy.RemoveClass("midboss_spawned"); gameTime.text = "12:01"; env.hud.clock.advance(600);
    assert.equal(env.Q.state.rejuvState.spawnWaiting, true, "an unrelated renderer cannot claim a midboss kill");
    const map = addNativeMinimap(env);
    const boss = env.add(map, "", ["mid_boss", "map_button", "midboss_spawned"]);
    env.hud.clock.advance(400);
    gameTime.text = "12:02"; env.hud.clock.advance(200);
    boss.RemoveClass("midboss_spawned"); env.hud.clock.advance(400);
    assert.equal(env.Q.state.rejuvState.counter, 420, "a late native renderer is observed without the old miss deadline");
    const native = map.GetParent(), viewport = native.GetParent(); native.SetParent(env.retired);
    env.add(env.add(viewport, "HudMinimapContainer"), "hud_minimap");
    gameTime.text = "12:03"; env.hud.clock.advance(600);
    assert.equal(env.Q.state.rejuvState.counter, 419, "a living old renderer cannot reset the current phase");
    assert.equal(map.IsValid(), true); assert.equal(broadLookups, 0);
    feature.onDisable();
    assert.equal(env.Q.state.rejuvState.running, false); assert.deepEqual(env.hud.clock.errors, []);
});

test("rejuv retries a rejected native text write without freezing the phase render", () => {
    const env = fixture();
    const { top, gameTime } = addTopbar(env);
    const capture = addCapture(env, top);
    env.config({ ENABLE_BUFF_HUD: 1 });
    env.hud.clock.advance(300);
    let content = capture.label.text, rejectWrite = true;
    Object.defineProperty(capture.label, "text", {
        configurable: true, get: () => content,
        set(value) { if (rejectWrite) { rejectWrite = false; throw Error("temporary native text failure"); } content = value; }
    });
    gameTime.text = "20:01";
    env.hud.clock.advance(700);
    assert.equal(content, "2:59");
    assert.equal(capture.panel.style.opacity, "1.00");
    env.config({ ENABLE_BUFF_HUD: 0 });
    const calls = env.hud.clock.errors.length;
    env.hud.clock.advance(2000);
    assert.equal(env.hud.clock.errors.length, calls);
    assert.equal(capture.panel.style.opacity, "0.00");
});

test("urn rebinds live minimap and topbar owners without changing its warning deadline", () => {
    const env = fixture();
    const { top, gameTime } = addTopbar(env, "12:00");
    const map = addNativeMinimap(env), native = map.GetParent();
    const button = env.add(map, "TestCapturePoint", ["map_button", "capture_point", "koth_warning"]);
    env.config({ ENABLE_URN_TIMER: 1 });
    env.hud.clock.advance(500);
    const first = env.find("RiftTimer");
    assert.equal(env.find("RiftTimerLabel").text, "0:20");
    map.SetParent(env.retired);
    const replacementMap = env.add(native, "hud_minimap");
    env.add(replacementMap, "NextCapturePoint", ["map_button", "capture_point", "koth_warning"]);
    gameTime.text = "12:05";
    env.hud.clock.advance(500);
    assert.equal(env.find("RiftTimerLabel").text, "0:15");
    top.SetParent(env.retired);
    addTopbar(env, "12:05");
    env.hud.clock.advance(500);
    const second = env.find("RiftTimer");
    assert.notEqual(second, first);
    assert.equal(first.IsValid(), false);
    assert.equal(env.find("RiftTimerLabel").text, "0:15");
    env.config({ ENABLE_URN_TIMER: 0 });
    env.hud.clock.advance(1000);
    assert.equal(second.IsValid(), false);
    assert.equal(env.find("RiftTimer"), null);
    assert.deepEqual(env.hud.clock.errors, []);
    assert.equal(button.IsValid(), true);
});

test("urn retries a partial overlay creation and resets the spawn window for a new match", () => {
    const env = fixture();
    const { gameTime } = addTopbar(env, "12:00");
    const create = env.$.CreatePanel;
    let reject = true;
    env.$.CreatePanel = (type, parent, id, properties) => {
        if (id === "RiftTimerLabel" && reject) throw Error("temporary native creation failure");
        return create(type, parent, id, properties);
    };
    env.config({ ENABLE_URN_TIMER: 1 });
    env.hud.clock.advance(500);
    assert.equal(env.find("RiftTimer").visible, false);
    assert.equal(env.find("RiftTimerLabel"), null);
    reject = false;
    env.hud.clock.advance(1000);
    assert.equal(env.find("RiftTimerLabel").text, "0:00 - 1:20");
    gameTime.text = "0:01";
    env.hud.clock.advance(500);
    assert.equal(env.find("RiftTimerLabel").text, "11:19 - 13:19");
    env.config({ ENABLE_URN_TIMER: 0 });
    env.hud.clock.advance(1000);
    assert.equal(env.find("RiftTimer"), null);
    assert.deepEqual(env.hud.clock.errors, []);
});

test("retired economy config keys stay recognized and inactive without native discovery or polling", () => {
    const env = fixture();
    const polls = [];
    const createPoll = env.Q.core.Scheduler.createPollLoop;
    env.Q.core.Scheduler.createPollLoop = (callback, rate, id) => { polls.push(id); return createPoll(callback, rate, id); };
    env.config({ ENABLE_MIN_SOULS: 1, ENABLE_UNSPENT_SOULS: 1 });
    const exported = env.Q.core.ConfigAdapter.exportToFlat();
    assert.equal(exported.ENABLE_MIN_SOULS, 0, "retired saved values retain their established disabled normalization");
    assert.equal(exported.ENABLE_UNSPENT_SOULS, 0);
    env.Q.core.FeatureRegistry.enable("ql_spm");
    env.Q.core.FeatureRegistry.enable("ql_unspent");
    assert.equal(polls.includes("ql_spm"), false);
    assert.equal(polls.includes("ql_unspent"), false);
    assert.equal(env.find("PlayerSPMDisplay"), null);
    assert.equal(env.find("SpentSoulDisplay"), null);
    assert.equal(env.Q.core.FeatureRegistry.getManifest("ql_spm").test, undefined);
    assert.equal(env.Q.core.FeatureRegistry.getManifest("ql_unspent").test, undefined);
    env.config({ ENABLE_MIN_SOULS: 0, ENABLE_UNSPENT_SOULS: 0 });
    assert.deepEqual(env.hud.clock.errors, []);
});


test("ultimate slots wait for native owners and replace a living status generation without player-wide probes", () => {
    const env = fixture(), { top } = addTopbar(env), { players } = addRoster(env, top);
    const player = env.add(players, "Player");
    const decoyHidden = env.text(player, "UltimateCooldownTextHidden", "99");
    const decoyShown = env.text(player, "UltimateCooldownTextShown", "Native decoy");
    const traverse = player.FindChildTraverse, probes = [];
    player.FindChildTraverse = function (id) {
        if (["UltimateCooldownTextHidden", "UltimateCooldownTextShown"].includes(id)) probes.push(id);
        return traverse.call(this, id);
    };
    env.config({ ENABLE_ULT_COOLDOWNS: 1 }); env.hud.clock.advance(1250);
    assert.equal(decoyShown.text, "Native decoy");
    const details = env.add(player, "PlayerDetailsContainer");
    const mount = value => {
        const status = env.add(details, "StatusRow"), ultimate = env.add(status, "UltimateStatus");
        const background = env.add(ultimate, "UltimateStatusBG");
        const hidden = env.text(background, "UltimateCooldownTextHidden", value);
        const shown = env.text(status, "UltimateCooldownTextShown", "");
        return { status, hidden, shown };
    };
    const old = mount("32"); env.hud.clock.advance(250); assert.equal(old.shown.text, "32");
    old.status.SetParent(env.add(player, "RetiredStatus"));
    const current = mount("8"); env.hud.clock.advance(250);
    assert.equal(old.status.IsValid(), true); assert.equal(old.shown.text, "");
    assert.equal(current.shown.text, "8");
    env.config({ ENABLE_ULT_COOLDOWNS: 0 }); assert.equal(current.shown.text, "");
    env.config({ ENABLE_ULT_COOLDOWNS: 1 }); env.hud.clock.advance(250);
    assert.equal(current.shown.text, "8");
    assert.equal(decoyHidden.text, "99"); assert.equal(decoyShown.text, "Native decoy");
    assert.deepEqual(probes, []);
    env.config({ ENABLE_ULT_COOLDOWNS: 0 });
    assert.deepEqual(env.hud.clock.errors, []);
});


test("ultimate topbar follows late direct owners and retires living out-of-path generations", () => {
    const env = fixture();
    env.Q.core.App.shutdown(); env.config({ ENABLE_ULT_COOLDOWNS: 1 });
    const decoyTop = env.add(env.hud.root, "TopBar");
    const decoy = addUlt(env, addRoster(env, decoyTop).players, "99");
    const feature = env.Q.core.FeatureRegistry.getManifest("ql_ult_cooldowns").create({
        id: "ql_ult_cooldowns", events: env.Q.core.EventBus,
        config: { view: () => env.Q.core.ConfigStore.view("ql_ult_cooldowns") }
    });
    feature.onEnable(); env.hud.clock.advance(2500);
    assert.equal(decoyTop.BHasClass("ult_cooldowns_active"), false);
    assert.equal(decoy.shown.text, "");
    const { top } = addTopbar(env), old = addUlt(env, addRoster(env, top).players, "32");
    env.hud.clock.advance(250); assert.equal(old.shown.text, "32");
    env.core.SetParent(env.add(env.hud.root, "RetiredCore"));
    env.core = env.add(env.hud.root, "", ["HudCore"]);
    const currentTop = addTopbar(env).top, current = addUlt(env, addRoster(env, currentTop).players, "8");
    env.hud.clock.advance(250);
    assert.equal(old.player.IsValid(), true); assert.equal(old.shown.text, "");
    assert.equal(top.BHasClass("ult_cooldowns_active"), false);
    assert.equal(current.shown.text, "8");
    feature.onDisable(); assert.equal(current.shown.text, "");
    feature.onEnable(); env.hud.clock.advance(250); assert.equal(current.shown.text, "8");
    assert.equal(decoy.shown.text, ""); feature.onDisable();
    assert.deepEqual(env.hud.clock.errors, []);
});
