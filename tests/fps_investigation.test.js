"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup(ids = ["ql_keyboard", "ql_compass"], culprit = "ql_keyboard") {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const { QOL: Q, $ } = hud.sandbox.global;
    Q.core.App.shutdown();
    const enabled = new Set(ids);
    Q.core.FeatureRegistry = {
        getEnabledIds: () => [...enabled], getErrorCounts: () => ({}),
        disable: id => enabled.delete(id), enable: id => enabled.add(id)
    };
    const schedule = $.Schedule;
    $.Schedule = (delay, cb) => schedule(delay || (enabled.has(culprit) ? 0.032 : 0.016), cb);
    return { hud, Q, $, enabled };
}

test("FPS investigation compares repeated UI cadence windows and restores every excluded owner", () => {
    const { hud, Q, enabled } = setup();
    let result;
    const windows = [];
    Q.core.FpsInvestigation.start({ root: hud.root, onWindow: window => windows.push(window), onComplete: value => { result = value; } });
    hud.clock.advance(400000);
    assert.ok(result);
    assert.equal(result.reason, "complete");
    const keyboard = result.rows.find(row => row.ids.length === 1 && row.ids[0] === "ql_keyboard");
    assert.ok(keyboard.confirmed);
    assert.ok(keyboard.improvementMs > 10);
    assert.equal(windows.length, result.rows.length * 4);
    assert.equal(new Set(windows.map(window => window.trial + ":" + window.phase)).size, windows.length);
    assert.ok(windows.every(window => window.endAt - window.startAt >= 3000));
    assert.match(result.report, /UI dispatch cadence/);
    assert.match(result.report, /not measured/);
    assert.deepEqual([...enabled].sort(), ["ql_compass", "ql_keyboard"]);
    assert.deepEqual(hud.clock.errors, []);
});

test("FPS investigation stop invalidates callbacks even when native cancellation fails", () => {
    const { hud, Q, $, enabled } = setup();
    let completions = 0;
    const session = Q.core.FpsInvestigation.start({ root: hud.root, onComplete: () => { completions++; } });
    hud.clock.advance(12000);
    $.CancelScheduled = () => { throw Error("cancel rejected"); };
    session.stop("cancelled"); session.stop("cancelled");
    hud.clock.advance(400000);
    assert.equal(completions, 1);
    assert.deepEqual([...enabled].sort(), ["ql_compass", "ql_keyboard"]);
    assert.equal(Q.core.FpsInvestigation.getStatus().running, false);
    assert.deepEqual(hud.clock.errors, []);
});

test("FPS investigation rejects a nonadvancing frame clock without inventing FPS", () => {
    const { hud, Q, $ } = setup();
    $.FrameTime = () => 1;
    let result;
    Q.core.FpsInvestigation.start({ root: hud.root, onComplete: value => { result = value; } });
    hud.clock.advance(400000);
    assert.ok(result.rows.every(row => !row.confirmed));
    assert.match(result.report, /insufficient/);
    assert.deepEqual(hud.clock.errors, []);
});

test("intermittent managed callback errors invalidate the scan even after registry streaks reset", () => {
    const { hud, Q } = setup();
    Q.core.Scheduler.startWorkObservation = () => ({
        sample: () => ({ callbacks: 100, callbackMs: 1, errors: 2 }), stop() {}
    });
    let result;
    Q.core.FpsInvestigation.start({ root: hud.root, onComplete: value => { result = value; } });
    hud.clock.advance(20000);
    assert.ok(result, "callback failures must end the scan immediately");
    assert.match(result.reason, /callback failures/);
    assert.equal(result.rows.some(row => row.confirmed), false);
    assert.deepEqual(hud.clock.errors, []);
});

test("large owner groups include their last owner in individual follow-up", () => {
    const ids = Array.from({ length: 24 }, (_, i) => "ql_other_" + String(i).padStart(2, "0"));
    const { hud, Q } = setup(ids, "ql_other_23");
    let result;
    Q.core.FpsInvestigation.start({ root: hud.root, onComplete: value => { result = value; } });
    hud.clock.advance(400000);
    assert.equal(result.reason, "complete");
    assert.ok(result.rows.some(row => row.ids.length === 1 && row.ids[0] === "ql_other_23" && row.confirmed));
    assert.deepEqual(hud.clock.errors, []);
});

test("confirmed minimap owners drill into active layers and restore their original settings", () => {
    const { hud, Q, $, enabled } = setup(["ql_minimap_loot", "ql_minimap_runtime"], "ql_minimap_loot");
    const baseline = { ENABLE_MINIMAP_STATUES: 1, ENABLE_MINIMAP_CRATE_ROUTES: 1, ENABLE_MINIMAP_CRATE_OVERLAY: 1 };
    let config = { ...baseline }, result;
    const schedule = $.Schedule;
    $.Schedule = (delay, callback) => schedule(delay || (enabled.has("ql_minimap_loot") && config.ENABLE_MINIMAP_STATUES ? 0.032 : 0.016), callback);
    Q.core.FpsInvestigation.start({ root: hud.root,
        configuration: { baseline, apply: patch => { config = { ...baseline, ...patch }; return [...enabled]; } },
        onComplete: value => { result = value; }
    });
    hud.clock.advance(400000);
    assert.equal(result.reason, "complete");
    const statues = result.rows.find(row => row.patch?.ENABLE_MINIMAP_STATUES === 0);
    assert.ok(statues?.confirmed, "the expensive layer must be identified within the confirmed owner");
    assert.equal(result.rows.find(row => row.patch?.ENABLE_MINIMAP_CRATE_ROUTES === 0)?.confirmed, false);
    assert.equal(result.rows.some(row => row.patch?.ENABLE_MINIMAP_CRATE_OVERLAY === 0), false, "unconfirmed owners do not extend the scan");
    assert.match(result.report, /Temporary settings: ENABLE_MINIMAP_STATUES=0/);
    assert.deepEqual(config, baseline);
    assert.deepEqual([...enabled].sort(), ["ql_minimap_loot", "ql_minimap_runtime"]);
    assert.deepEqual(hud.clock.errors, []);
});

test("cancelling during a layer trial restores settings before stale sample callbacks can run", () => {
    const { hud, Q, $, enabled } = setup(["ql_minimap_loot"], "ql_minimap_loot");
    const baseline = { ENABLE_MINIMAP_STATUES: 1 };
    let config = { ...baseline }, result;
    const session = Q.core.FpsInvestigation.start({ root: hud.root,
        configuration: { baseline, apply: patch => {
            config = { ...baseline, ...patch };
            if (config.ENABLE_MINIMAP_STATUES) enabled.add("ql_minimap_loot"); else enabled.delete("ql_minimap_loot");
            return [...enabled];
        } },
        onProgress: progress => {
            if (progress.patch?.ENABLE_MINIMAP_STATUES === 0) $.Schedule(0.2, () => session.stop("cancelled"));
        },
        onComplete: value => { result = value; }
    });
    hud.clock.advance(400000);
    assert.equal(result.reason, "cancelled");
    assert.deepEqual(config, baseline);
    assert.deepEqual([...enabled], ["ql_minimap_loot"]);
    assert.deepEqual(hud.clock.errors, []);
});

for (const changedClass of ["ShowEscapeMenu", "gShopOpen", "gScoreboardOpen"]) {
    test(`scene transition ${changedClass} stops sampling and removes its progress overlay`, () => {
        const { hud, Q, enabled } = setup();
        let result;
        Q.core.FpsInvestigation.start({ root: hud.root, onComplete: value => { result = value; } });
        hud.clock.advance(6500);
        assert.ok(hud.root.FindChild("QOLFpsInvestigationProgress"));
        hud.root.AddClass(changedClass); hud.clock.advance(2000);
        assert.ok(result);
        assert.equal(hud.root.FindChild("QOLFpsInvestigationProgress"), null);
        assert.deepEqual([...enabled].sort(), ["ql_compass", "ql_keyboard"]);
        assert.deepEqual(hud.clock.errors, []);
    });
}

function minimapSetup() {
    const env = setup(["ql_minimap_runtime", "ql_minimap_loot", "ql_keyboard"]);
    const { hud, Q } = env;
    let parent = hud.root;
    const chain = [
        { classes: ["HudCore"] }, { id: "gameplay_hud" }, { classes: ["clamp_width"] },
        { id: "minimap_persp" }, { id: "minimap_container" }, { id: "HudMinimapContainer" },
        { id: "hud_minimap", classes: ["dl_midtown"] }
    ];
    for (const properties of chain) parent = parent.addChild(hud.doc.create("Panel", properties));
    const renderer = parent;
    const roots = ["minimap_overlay_root", "QOLMinimapLootRoot"].map(id => renderer.addChild(hud.doc.create("Panel", { id })));
    const counts = { ql_minimap_runtime: 0, ql_minimap_loot: 0, ql_keyboard: 0 };
    for (const id of Object.keys(counts)) Q.core.Scheduler.createPollLoop(() => counts[id]++, 0.05, id);
    return { ...env, renderer, roots, counts };
}

test("minimap polling trials retain visible panels and owner coverage through fixed native windows", () => {
    const { hud, Q, enabled, roots, counts } = minimapSetup();
    let result;
    const windows = [], phaseCounts = [];
    Q.core.FpsInvestigation.start({ root: hud.root, mode: "minimap",
        onWindow: value => { windows.push(value); phaseCounts.push({ ...counts }); },
        onProgress: () => {
            assert.deepEqual([...enabled].sort(), ["ql_keyboard", "ql_minimap_loot", "ql_minimap_runtime"]);
            for (const panel of roots) { assert.equal(panel.IsValid(), true); assert.equal(panel.visible, true); }
        }, onComplete: value => { result = value; }
    });
    hud.clock.advance(55000);
    assert.equal(result.reason, "complete");
    assert.equal(result.rows.length, 3, "both minimap polls, runtime only, loot only; no proxy-selected follow-up");
    assert.equal(windows.length, 12);
    assert.deepEqual(phaseCounts.slice(0, 4).map((value, i, all) => i ? value.ql_minimap_runtime - all[i - 1].ql_minimap_runtime > 0 : true), [true, false, false, true]);
    assert.ok(phaseCounts[2].ql_keyboard > phaseCounts[1].ql_keyboard, "unselected production polling continues");
    assert.match(result.report, /panels retained/);
    const before = counts.ql_minimap_loot;
    hud.clock.advance(200);
    assert.ok(counts.ql_minimap_loot > before, "normal polling resumes without re-enabling owners");
    assert.deepEqual(hud.clock.errors, []);
});

for (const stop of ["cancel", "HUD", "renderer", "Alt", "error", "observer"]) {
    test(`minimap poll pause restores callbacks after ${stop}`, () => {
        const { hud, Q, renderer, counts } = minimapSetup();
        let result;
        const scan = Q.core.FpsInvestigation.start({ root: hud.root, mode: "minimap", onComplete: value => { result = value; } });
        hud.clock.advance(11000);
        const paused = counts.ql_minimap_runtime;
        hud.clock.advance(100);
        assert.equal(counts.ql_minimap_runtime, paused, "B must pause production before this stop trigger");
        if (stop === "cancel") scan.stop();
        if (stop === "HUD") hud.root.DeleteAsync(0);
        if (stop === "renderer") renderer.DeleteAsync(0);
        if (stop === "Alt") renderer.GetParent().GetParent().GetParent().AddClass("gDetailView");
        if (stop === "error") Q.core.Scheduler.scheduleOnce(() => { throw Error("diagnostic failure"); }, 0, "other");
        if (stop === "observer") Q.core.Scheduler.startWorkObservation();
        hud.clock.advance(3500);
        assert.ok(result, "context changes and callback failures must terminate the diagnostic");
        assert.notEqual(result.reason, "complete");
        if (stop !== "HUD") {
            const restored = counts.ql_minimap_runtime;
            hud.clock.advance(200);
            assert.ok(counts.ql_minimap_runtime > restored, "polling must resume after the diagnostic retires");
        }
        assert.deepEqual(hud.clock.errors, []);
    });
}
