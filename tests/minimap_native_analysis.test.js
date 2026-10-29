"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");
const { analyzeCapture, formatReport } = require("../scripts/analyze_game_frames");

function capture({ shamEffect = 0, noPolling = false } = {}) {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const { QOL: Q, $ } = hud.sandbox.global, create = $.CreatePanel;
    $.CreatePanel = (...args) => { const panel = create(...args); panel.actuallayoutwidth = panel.actuallayoutheight = 600; return panel; };
    let parent = hud.root;
    for (const props of [{ classes: ["HudCore"] }, { id: "gameplay_hud" }, { classes: ["clamp_width"] },
        { id: "minimap_persp" }, { id: "minimap_container" }, { id: "HudMinimapContainer" },
        { id: "hud_minimap", classes: ["HudMinimap", "dl_midtown"] }]) parent = parent.addChild(hud.doc.create("Panel", props));
    const baseline = { ...Q.core.ConfigAdapter.exportToFlat(), ENABLE_MINIMAP_CRATE_OVERLAY: 1, ENABLE_MINIMAP_TOUGH_CRATES: 1,
        ENABLE_MINIMAP_HEALING_SNACKS: 1, ENABLE_MINIMAP_STATUES: 1, ENABLE_MINIMAP_CRATE_ROUTES: 1, MINIMAP_CAMP_NAMES: 1, ENABLE_MINIMAP_REM_TUNNELS: 1 };
    Q.core.ConfigAdapter.loadFromFlat(baseline); hud.clock.advance(1200);
    if (noPolling) for (const id of ["ql_minimap_runtime", "ql_minimap_loot"]) Q.core.Scheduler.cancelAllForFeature(id);
    const session = "minimap_test", packets = [], windows = [];
    Q.core.MinimapInvestigation.start({ root: hud.root, baseline, canonical: baseline, selectedIds: ["static-crates"],
        onPacket: (packet, value) => {
            const raw = JSON.stringify(value), chars = Array.from(raw), total = Math.ceil(chars.length / 350);
            for (let index = 0; index < total; index++) packets.push({ session, packet, index, total, hash: Q.core.MinimapInvestigation.digest(raw), data: chars.slice(index * 350, (index + 1) * 350).join("") });
        }, onWindow: window => windows.push({ ...window, session }), onComplete: () => {} });
    hud.clock.advanceBy(100000, 10000);
    const first = windows[0].startAt - 1000, last = windows.at(-1).endAt + 1000;
    const meta = { kind: "minimap-suite", completed: true, processId: 100, session, reason: "complete", packets, windows,
        anchors: [{ qpc: 0, utcMs: first, frequency: 1000000, uncertaintyMs: 1 }, { qpc: (last - first) * 1000, utcMs: last, frequency: 1000000, uncertaintyMs: 1 }],
        focus: Array.from({ length: Math.ceil((last - first) / 250) + 1 }, (_, i) => ({ qpc: i * 250000, pid: 100 })) };
    const lines = ["Application,ProcessID,SwapChainAddress,TimeInQPC,MsBetweenPresents"];
    for (const window of windows) {
        const effect = window.conditionId === "sham" ? shamEffect : 0.4;
        const interval = window.side === "B" ? 5 - effect : 5;
        for (let at = window.startAt + interval; at <= window.endAt; at += interval) lines.push(["deadlock.exe", 100, "0x1", Math.round((at - first) * 1000), interval].join(","));
    }
    return { csv: lines.join("\n"), meta };
}

test("native minimap analysis follows declared BAAB/ABBA sides and resolves a small repeatable effect with source evidence", () => {
    const { csv, meta } = capture();
    meta.sourceIdentity = require("../scripts/native_capture_identity").collectSourceIdentity();
    const result = analyzeCapture(csv, meta);
    assert.equal(result.kind, "minimap-suite");
    assert.equal(result.sourceStatus, "selected_functions_match");
    const row = result.rows.find(item => item.id === "static-crates");
    assert.equal(row.status, "effect_detected");
    assert.ok(Math.abs(row.effectMs - 0.4) < 0.001);
    assert.equal(row.validBlocks, 3);
    assert.ok(row.lowerMs > 0);
    const report = formatReport(result);
    for (const text of ["ENABLE_MINIMAP_CRATE_OVERLAY", "renderCrates", "minimap_runtime/manifest.js", "static-crates", "State", "Restoration", "BASE", "sham"]) assert.ok(report.includes(text), text);
});

test("unexecuted production polling cannot produce a confident negative finding", () => {
    const { csv, meta } = capture({ noPolling: true }), result = analyzeCapture(csv, meta);
    const sham = result.rows.find(row => row.id === "sham");
    assert.equal(sham.status, "invalid");
    assert.ok(sham.blocks.some(block => block.errors.some(error => /not exercised/.test(error))));
    assert.equal(result.rows.find(row => row.id === "static-crates").status, "inconclusive");
});

test("entirely missing planned conditions are not silently omitted or declared free", () => {
    const { csv, meta } = capture(); meta.windows = meta.windows.filter(window => window.conditionId === "sham");
    const result = analyzeCapture(csv, meta), row = result.rows.find(item => item.id === "static-crates");
    assert.equal(row.status, "not_run"); assert.equal(row.effectMs, null);
    assert.ok(formatReport(result).includes("static-crates"));
});

test("missing chunk invalidates its block and corrupted vectors cannot masquerade as verified native exclusions", () => {
    const { csv, meta } = capture();
    const target = meta.windows.find(window => window.conditionId === "static-crates");
    meta.packets = meta.packets.filter(packet => !(packet.packet === target.beforeProof && packet.index === 0));
    const result = analyzeCapture(csv, meta), row = result.rows.find(item => item.id === "static-crates");
    assert.equal(row.validBlocks, 2);
    assert.ok(row.blocks.some(block => block.errors.some(error => /proof|chunk/i.test(error))));
    const broken = JSON.parse(JSON.stringify(meta));
    for (const packet of broken.packets.filter(packet => packet.packet.startsWith("proof-"))) packet.hash = "00000000";
    assert.equal(analyzeCapture(csv, broken).rows.find(item => item.id === "static-crates").status, "invalid");
});

test("sham noise bounds prevent a stable-looking effect from being called causal", () => {
    const { csv, meta } = capture({ shamEffect: 0.8 });
    const row = analyzeCapture(csv, meta).rows.find(item => item.id === "static-crates");
    assert.equal(row.status, "inconclusive"); assert.ok(row.lowerMs < 0);
});

test("a minimap suite without its declared context refuses legacy fallback", () => {
    const { csv, meta } = capture(); meta.packets = meta.packets.filter(packet => packet.packet !== "context");
    assert.throws(() => analyzeCapture(csv, meta), /context|ledger/i);
});
