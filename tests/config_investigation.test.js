"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

test("expanded investigation declares every changed key including shared and CSS-only settings without cadence gating", () => {
    const hud = createHud(); hud.assertLoaded();
    const tool = hud.sandbox.global.QOL.core.ConfigInvestigation;
    assert.ok(tool, "native configuration investigation must be loaded by HUD");
    const plan = tool.plan({ baseline: { A: 1, B: 1, C: 4, SAME: 0 }, canonical: { A: 0, B: 0, C: 2, SAME: 0 },
        manifests: [{ id: "ql_one", keys: ["A"] }, { id: "ql_two", keys: ["A", "B"] }] });
    assert.deepEqual(Array.from(plan.changedKeys), ["A", "B", "C"]);
    assert.ok(plan.conditions.some(row => row.keys.includes("C") && !row.owners.length), "CSS-only/unregistered settings cannot disappear");
    assert.ok(plan.conditions.some(row => row.keys.includes("A") && row.owners.join(",") === "ql_one,ql_two"));
    assert.ok(plan.conditions.some(row => row.id === "benchmark-instrumentation"));
    for (const row of plan.conditions) assert.equal(plan.blocks.filter(block => block.conditionId === row.id).length, 3);
    assert.ok(plan.available.some(row => row.id === "key-b"));
    assert.throws(() => tool.plan({ baseline: { A: 1 }, canonical: { A: 0 }, manifests: [], selectedIds: ["missing"] }), /condition/i);
});

for (const selected of ["benchmark-instrumentation", "whole-config"]) test(`configuration investigation ${selected} uses real App leases and restores config with a frozen UI clock`, () => {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const { QOL: Q, $ } = hud.sandbox.global;
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    $.FrameTime = () => 1;
    hud.root.SetAttributeString("QOL_DiagRequest", "fps_config_100_" + selected);
    Q.core.App.syncDiagnosticState(hud.root, hud.clock.now());
    assert.equal(Q.core.ConfigInvestigation?.getStatus()?.running, true);
    hud.clock.advanceBy(100000, 1000);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark.stats.reason, "complete");
    const messages = hud.sandbox.messages.filter(line => line.startsWith("[QOLLOCK:NativeFPS] ")).map(line => JSON.parse(line.slice(20)));
    assert.equal(messages[0].kind, "config-suite");
    assert.equal(messages.filter(item => item.type === "window").length, 24);
    assert.equal(messages.at(-1).type, "end");
    assert.ok(messages.some(item => item.packet === "app-restoration"));
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.equal(Q.state.benchmarkActive, false);
    assert.deepEqual(hud.clock.errors, []);
});

test("stopping an expanded configuration trial restores settings and invalidates uncancellable work", () => {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const { QOL: Q, $ } = hud.sandbox.global;
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    const request = token => { hud.root.SetAttributeString("QOL_DiagRequest", token); Q.core.App.syncDiagnosticState(hud.root, hud.clock.now()); };
    request("fps_config_101_whole-config"); hud.clock.advance(11000);
    assert.equal(Q.core.ConfigInvestigation?.getStatus()?.running, true);
    $.CancelScheduled = () => { throw Error("cancel rejected"); };
    request("fps_stop_102"); hud.clock.advanceBy(100000, 1000);
    assert.equal(Q.core.ConfigInvestigation.getStatus().running, false);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.equal(Q.state.benchmarkActive, false);
    assert.deepEqual(hud.clock.errors, []);
});

test("Expanded setup hook failure refuses the baseline before any measured window", () => {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const Q = hud.sandbox.global.QOL, registry = Q.core.FeatureRegistry;
    const canonical = Q.core.ConfigAdapter.exportToFlat();
    const manifest = registry.getManifest("ql_compass"), create = manifest.create;
    manifest.create = ctx => ({ ...create(ctx), onSettingsChanged() { throw Error("injected Expanded setup failure"); } });
    hud.root.SetAttributeString("QOL_DiagRequest", "fps_config_103_benchmark-instrumentation");
    Q.core.App.syncDiagnosticState(hud.root, hud.clock.now()); hud.clock.advanceBy(100000, 1000);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark?.stats.reason, "setup-error");
    assert.match(diag.benchmark.report, /ql_compass/);
    assert.equal(hud.sandbox.messages.some(line => line.includes('"type":"window"')), false);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), canonical);
});

for (const scene of ["scoreboard", "detail"]) test(`native ${scene} evidence stops the configuration scan`, () => {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const Q = hud.sandbox.global.QOL;
    hud.root.SetAttributeString("QOL_DiagRequest", "fps_config_104_benchmark-instrumentation");
    Q.core.App.syncDiagnosticState(hud.root, hud.clock.now()); hud.clock.advance(10000);
    if (scene === "scoreboard") hud.root.addChild(hud.doc.create("Panel", { id: "DamageReportGlobalClassListener", classes: ["gScoreboardOpen"] }));
    else hud.root.AddClass("gDetailView");
    hud.clock.advanceBy(100000, 1000);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.notEqual(diag.benchmark.stats.reason, "complete");
    assert.ok(diag.benchmark.stats.completedBlocks < diag.benchmark.stats.expectedBlocks);
});

test("a settings error followed by a successful hook between guards still invalidates the scan", () => {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const Q = hud.sandbox.global.QOL;
    hud.root.SetAttributeString("QOL_DiagRequest", "fps_config_105_benchmark-instrumentation");
    Q.core.App.syncDiagnosticState(hud.root, hud.clock.now()); hud.clock.advance(6100);
    const owner = Q.core.FeatureRegistry.getInstance("ql_compass"), hook = owner.onSettingsChanged;
    owner.onSettingsChanged = () => { throw Error("transient settings failure"); };
    const notify = () => Q.core.EventBus.emit("config:changed", { featureId: "ql_compass", key: "ENABLE_SIMPLIFY_COMPASS", value: 1 });
    notify(); owner.onSettingsChanged = hook; notify();
    assert.equal(Q.core.FeatureRegistry.getErrorCounts().ql_compass, 0);
    hud.clock.advance(2000);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.match(diag.benchmark.stats.reason, /failure/);
    assert.match(diag.benchmark.stats.reason, /ql_compass/);
    assert.equal(diag.benchmark.stats.completedBlocks, 0);
    const markers = hud.sandbox.messages.filter(line => line.startsWith("[QOLLOCK:NativeFPS] ")).map(line => JSON.parse(line.slice(20)));
    const { packets } = require("../scripts/analyze_minimap_frames").decodePackets(markers.filter(item => item.type === "packet"), markers[0].session);
    assert.deepEqual(packets.get("runner-restoration").failedOwners, ["ql_compass"]);
});
