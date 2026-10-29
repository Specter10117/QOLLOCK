"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup() {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const { QOL: Q, $ } = hud.sandbox.global;
    const create = $.CreatePanel;
    // Native layout is an input to this model, not a renderer assertion.
    $.CreatePanel = (...args) => {
        const panel = create(...args); panel.actuallayoutwidth = panel.actuallayoutheight = 600; return panel;
    };
    let parent = hud.root;
    for (const props of [{ classes: ["HudCore"] }, { id: "gameplay_hud" }, { classes: ["clamp_width"] },
        { id: "minimap_persp" }, { id: "minimap_container" }, { id: "HudMinimapContainer" },
        { id: "hud_minimap", classes: ["HudMinimap", "dl_midtown"] }]) parent = parent.addChild(hud.doc.create("Panel", props));
    $.CreatePanel("Panel", $.CreatePanel("Panel", parent, "MinimapBackgroundTest"), "canvas");
    const baseline = { ...Q.core.ConfigAdapter.exportToFlat(), ENABLE_MINIMAP_CRATE_OVERLAY: 1, ENABLE_MINIMAP_TOUGH_CRATES: 1,
        ENABLE_MINIMAP_HEALING_SNACKS: 1, ENABLE_MINIMAP_STATUES: 1, ENABLE_MINIMAP_CRATE_ROUTES: 1,
        MINIMAP_CAMP_NAMES: 1, ENABLE_MINIMAP_REM_TUNNELS: 1 };
    Q.core.ConfigAdapter.loadFromFlat(baseline); hud.clock.advance(1200);
    return { hud, Q, $, renderer: parent, baseline };
}

test("full minimap plan declares all causal branches with independently ordered repeats", () => {
    const { Q } = setup();
    assert.equal(typeof Q.core.MinimapInvestigation?.createPlan, "function");
    const plan = Q.core.MinimapInvestigation.createPlan();
    for (const id of ["sham", "owners-runtime", "owners-loot", "owners-both", "polls-runtime", "polls-loot", "polls-both",
        "sweep-runtime", "sweep-loot", "sweep-both", "static-crates", "static-loot", "static-both", "polls-hidden",
        "layer-tough", "layer-snacks", "layer-statues", "layer-names", "layer-routes", "layer-tunnel",
        "geometry", "decoration", "presentation", "retention", "cache-layer", "cache-none",
        "native-renderer", "native-maprender", "native-backgrounds", "native-canvas", "native-ranges", "geometry-placement", "geometry-viewport"]) {
        assert.ok(plan.conditions.some(condition => condition.id === id), id + " must ship in the same plan");
        const blocks = plan.blocks.filter(block => block.conditionId === id);
        assert.equal(blocks.length, 3);
        assert.ok(blocks.every(block => block.order.filter(side => side === "A").length === 2 && block.order.filter(side => side === "B").length === 2));
        assert.ok(new Set(blocks.map(block => block.order.join(""))).size > 1, "order must be balanced across independent blocks");
    }
    assert.throws(() => Q.core.MinimapInvestigation.createPlan(["invented-condition"]), /unknown/);
    assert.deepEqual(Array.from(Q.core.MinimapInvestigation.createPlan(["layer-routes"]).conditions, row => row.id), ["sham", "layer-routes"]);
    assert.deepEqual(Array.from(Q.core.MinimapInvestigation.createPlan(["layer-routes"]).blocks, row => row.conditionId),
        ["sham", "layer-routes", "sham", "layer-routes", "sham", "layer-routes"]);
});

test("absent/inactive native targets are explicitly unexercised rather than measured as zero cost", () => {
    const { hud, Q, baseline } = setup(), packets = new Map(), windows = [];
    let result;
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["native-ranges", "geometry-role-frame"],
        onPacket: (id, value) => packets.set(id, value), onWindow: value => windows.push(value), onComplete: value => { result = value; } });
    hud.clock.advanceBy(150000, 10000);
    assert.equal(result.reason, "complete");
    assert.equal(windows.length, 12, "only sham should produce sampled windows");
    const skips = [...packets].filter(([id]) => /-skip$/.test(id)).map(([, value]) => value);
    assert.equal(skips.length, 6);
    assert.ok(skips.some(value => value.status === "absent"));
    assert.ok(skips.some(value => value.status === "inactive"));
});

test("composition windows start only after a full settling interval following the last actual tree creation", () => {
    const { hud, Q, $, baseline } = setup(), create = $.CreatePanel, created = new Map(), windows = [];
    $.CreatePanel = (...args) => { const panel = create(...args); if (["minimap_overlay_root", "QOLMinimapLootRoot"].includes(args[2])) created.set(args[2], hud.clock.now()); return panel; };
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["cache-none"],
        onWindow: window => { if (window.conditionId === "cache-none") windows.push({ ...window, created: [...created.values()] }); }, onComplete: () => {} });
    hud.clock.advanceBy(150000, 10000);
    assert.equal(windows.length, 12);
    for (const window of windows) for (const at of window.created) assert.ok(window.startAt - at >= 1000, "newly built tree must settle before native sampling");
});

test("baseline native write failure cannot produce a verified sample", () => {
    const { hud, Q, renderer, baseline } = setup(), windows = [];
    Object.defineProperty(renderer.GetParent().GetParent().style, "uiScale", { configurable: true, get: () => "broken", set: () => { throw Error("native refusal"); } });
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["sham"], onWindow: window => windows.push(window), onComplete: () => {} });
    hud.clock.advanceBy(100000, 10000);
    assert.equal(windows.length, 0);
});

test("disabled owner proof waits for actual tree retirement instead of trusting registry enable state", () => {
    const { hud, Q, renderer, baseline } = setup(), packets = new Map(), windows = [];
    renderer.FindChild("minimap_overlay_root").DeleteAsync = () => {};
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["owners-runtime"],
        onPacket: (id, value) => packets.set(id, value), onWindow: window => windows.push(window), onComplete: () => {} });
    hud.clock.advanceBy(150000, 10000);
    assert.equal(windows.filter(window => window.conditionId === "owners-runtime" && window.side === "B").length, 0);
    assert.ok([...packets].some(([id, value]) => /failure$/.test(id) && value.errors.some(error => /retir|cleanup/i.test(error))));
});

test("the complete default plan finishes every declared block or explicit inactive-target skip and restores all hooks", () => {
    const { hud, Q, baseline } = setup(), packets = new Map(), windows = [];
    let result;
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, onPacket: (id, value) => packets.set(id, value),
        onWindow: window => windows.push(window), onComplete: value => { result = value; } });
    hud.clock.advanceBy(1801000, 10000);
    assert.equal(result.reason, "complete");
    const plan = packets.get("context").plan;
    assert.equal(plan.conditions.length, 37);
    for (const block of plan.blocks) {
        const sampled = windows.filter(window => window.trial === block.trial);
        assert.ok(sampled.length === 4 || packets.has("block-" + block.trial + "-skip"), block.conditionId + " missing/invalid");
    }
    assert.equal(result.invalidBlocks.length, 0);
    assert.equal(result.restoreErrors.length, 0);
    assert.deepEqual(hud.clock.errors, []);
});

test("native-first selected suite emits declared coverage and state proofs without sampling UI cadence", () => {
    const { hud, Q, $, baseline } = setup();
    assert.equal(typeof Q.core.MinimapInvestigation?.start, "function");
    $.FrameTime = () => { throw Error("UI cadence must not choose or measure this suite"); };
    const packets = new Map(), sentAt = new Map(), windows = [];
    let result;
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["polls-both", "static-crates", "layer-routes"],
        onPacket: (id, value) => { packets.set(id, value); sentAt.set(id, hud.clock.now()); }, onWindow: value => windows.push(value), onComplete: value => { result = value; }
    });
    hud.clock.advanceBy(180000, 10000);
    assert.equal(result.reason, "complete");
    const context = packets.get("context");
    assert.deepEqual(Object.keys(context.baseline).sort(), Object.keys(baseline).sort());
    assert.equal(context.plan.blocks.length, 12);
    assert.equal(windows.length, 48);
    assert.equal(new Set(windows.map(window => window.trial + ":" + window.phase)).size, 48);
    for (const window of windows) {
        assert.ok(["A", "B"].includes(window.side));
        assert.ok(window.endAt - window.startAt >= 2000);
        assert.ok(packets.get(window.beforeProof).verified);
        assert.ok(packets.get(window.afterProof).verified);
        assert.ok(sentAt.get(window.beforeProof) >= window.endAt, "proof serialization/console transport must follow the measured window");
        if (window.conditionId === "static-crates") {
            const proof = packets.get(window.beforeProof);
            assert.deepEqual(Array.from(proof.applied.pausedPolls), ["ql_minimap_runtime", "ql_minimap_loot"]);
            assert.equal(proof.owners.ql_minimap_runtime.root.visible, window.side === "A");
        }
    }
    const first = packets.get(windows[0].beforeProof);
    const wrong = JSON.parse(JSON.stringify(first));
    wrong.applied.runtime.hideRoot = !wrong.applied.runtime.hideRoot;
    assert.ok(Q.core.MinimapPlan.verify(first.applied, wrong).includes("state vector mismatch"), "nested interventions must not disappear during comparison");
    assert.equal(result.restoreErrors.length, 0);
    assert.deepEqual(hud.clock.errors, []);
});

test("native suite restores hooks and polling after failure or supersession", () => {
    const { hud, Q, baseline } = setup();
    assert.equal(typeof Q.core.MinimapInvestigation?.start, "function");
    let result;
    const scan = Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["static-both"], onComplete: value => { result = value; } });
    hud.clock.advance(23000);
    scan.stop("cancelled");
    assert.equal(result.reason, "cancelled");
    assert.equal(Q.core.FeatureRegistry.getInstance("ql_minimap_loot").diagnostics.begin().snapshot().root.visible, true);
    assert.equal(Q.core.FeatureRegistry.getInstance("ql_minimap_runtime").diagnostics.begin().snapshot().controls.skipSweep, undefined);
    assert.deepEqual(hud.clock.errors, []);
});

for (const change of ["HUD", "renderer", "Alt", "error", "observer"]) {
    test(`full native suite restores owned interventions after ${change}`, () => {
        const { hud, Q, renderer, baseline } = setup();
        let result;
        Q.core.MinimapInvestigation.start({ root: hud.root, baseline, selectedIds: ["static-both"], onComplete: value => { result = value; } });
        hud.clock.advance(22000);
        if (change === "HUD") hud.root.DeleteAsync(0);
        if (change === "renderer") renderer.DeleteAsync(0);
        if (change === "Alt") renderer.GetParent().GetParent().GetParent().AddClass("gDetailView");
        if (change === "error") Q.core.Scheduler.scheduleOnce(() => { throw Error("observed"); }, 0, "unrelated");
        if (change === "observer") Q.core.Scheduler.startWorkObservation();
        hud.clock.advance(3500);
        assert.ok(result);
        assert.notEqual(result.reason, "complete");
        if (change === "HUD") assert.equal(Q.core.FeatureRegistry.getEnabledIds().length, 0, "retired HUD must not recreate feature instances");
        else for (const id of ["ql_minimap_runtime", "ql_minimap_loot"]) {
            const lease = Q.core.FeatureRegistry.getInstance(id).diagnostics.begin();
            assert.equal(lease.snapshot().controls.hideRoot, undefined); lease.restore();
        }
        assert.deepEqual(hud.clock.errors, []);
    });
}
