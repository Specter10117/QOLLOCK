"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");
const { analyzeCapture, formatReport } = require("../scripts/analyze_game_frames");

function capture(noise = 0) {
    const hud = createHud({ inHideout: false }); hud.assertLoaded();
    const Q = hud.sandbox.global.QOL;
    hud.root.SetAttributeString("QOL_DiagRequest", "fps_config_103_key-enable-compass");
    Q.core.App.syncDiagnosticState(hud.root, hud.clock.now()); hud.clock.advanceBy(100000, 1000);
    const markers = hud.sandbox.messages.filter(line => line.startsWith("[QOLLOCK:NativeFPS] ")).map(line => JSON.parse(line.slice(20)));
    const windows = markers.filter(row => row.type === "window");
    assert.equal(windows.length, 24);
    const first = windows[0].startAt - 1000, last = windows.at(-1).endAt + 1000;
    const meta = { kind: markers[0].kind, session: markers[0].session, reason: markers.at(-1).reason, processId: 100, completed: true,
        windows, packets: markers.filter(row => row.type === "packet"),
        anchors: [{ qpc: 0, utcMs: first, frequency: 1000000, uncertaintyMs: 1 },
            { qpc: (last - first) * 1000, utcMs: last, frequency: 1000000, uncertaintyMs: 1 }],
        focus: Array.from({ length: Math.ceil((last - first) / 250) + 1 }, (_, i) => ({ qpc: i * 250000, pid: 100 })) };
    const lines = ["Application,ProcessID,SwapChainAddress,TimeInQPC,MsBetweenPresents"];
    for (const window of windows) {
        const interval = window.side === "B" ? 8 - (window.conditionId === "sham" ? noise : 2) : 8;
        for (let at = window.startAt + interval; at <= window.endAt; at += interval) lines.push(["deadlock.exe", 100, "0x1", Math.round((at - first) * 1000), interval].join(","));
    }
    return { csv: lines.join("\n"), meta };
}

test("native config analysis attributes repeated effects to exact settings and includes canonical/source/restoration context", () => {
    const { csv, meta } = capture();
    meta.sourceIdentity = require("../scripts/native_capture_identity").collectSourceIdentity();
    const result = analyzeCapture(csv, meta);
    assert.equal(result.kind, "config-suite");
    const row = result.rows.find(item => item.id === "key-enable-compass");
    assert.equal(row.status, "effect_detected");
    assert.ok(Math.abs(row.effectMs - 2) < 0.001);
    assert.equal(row.validBlocks, 3);
    assert.equal(result.restoration.configRestored, true);
    assert.ok(Object.values(result.sourceMatches).every(value => value === true));
    const report = formatReport(result);
    for (const text of ["ENABLE_COMPASS", "ql_compass/manifest.js", "canonical", "not vanilla", "inactive", "not be summed"]) assert.ok(report.includes(text), text);
});

test("missing configuration context refuses legacy analysis and missing proofs cannot be counted as three confirmed repeats", () => {
    const { csv, meta } = capture();
    const target = meta.windows.find(row => row.conditionId !== "sham");
    meta.packets = meta.packets.filter(row => row.packet !== target.beforeProof);
    const row = analyzeCapture(csv, meta).rows.find(item => item.id === "key-enable-compass");
    assert.equal(row.validBlocks, 2);
    assert.notEqual(row.status, "effect_detected");
    meta.packets = meta.packets.filter(row => row.packet !== "context");
    assert.throws(() => analyzeCapture(csv, meta), /context|ledger/i);
});

test("sham noise and entirely missing conditions remain explicit rather than producing a clean bill of health", () => {
    const { csv, meta } = capture(3);
    assert.equal(analyzeCapture(csv, meta).rows.find(row => row.id === "key-enable-compass").status, "inconclusive");
    meta.windows = meta.windows.filter(row => row.conditionId === "sham");
    const result = analyzeCapture(csv, meta);
    assert.equal(result.rows.find(row => row.id === "key-enable-compass").status, "not_run");
    assert.match(formatReport(result), /key-enable-compass/);
});
