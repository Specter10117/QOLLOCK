"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Sandbox } = require("../scripts/simulator/sandbox");

function setup({ cancellation = "normal", zeroHandle = false } = {}) {
    const sandbox = new Sandbox(), g = sandbox.global;
    g.QOL = { core: {}, state: {} };
    g.QOL_UTILS = { PerfNowMs: () => sandbox.clock.now(), IsPanelValid: panel => panel.IsValid() };
    const schedule = g.$.Schedule, cancel = g.$.CancelScheduled;
    let zeroNativeHandle = null;
    const cancellations = [];
    g.$.Schedule = (delay, callback) => {
        const handle = schedule(delay, callback);
        if (zeroHandle && zeroNativeHandle === null) { zeroNativeHandle = handle; return 0; }
        return handle;
    };
    g.$.CancelScheduled = handle => {
        cancellations.push(handle);
        if (cancellation === "throw") throw Error("modeled native cancellation failure");
        if (cancellation === "ignored") return;
        cancel(handle === 0 ? zeroNativeHandle : handle);
    };
    sandbox.load(path.resolve(__dirname, "../panorama/scripts/core/ql_scheduler.js"));
    assert.deepEqual(sandbox.loadErrors, []);
    return { sandbox, S: g.QOL.core.Scheduler, cancellations };
}

test("stopping a replaced benchmark handle cannot cancel its successor", () => {
    const { sandbox, S } = setup();
    let first = 0, second = 0;
    const old = S.startBenchmark(1, () => { first++; });
    S.startBenchmark(1, () => { second++; });
    old.stop(); old.stop();
    assert.equal(S.isBenchmarkActive(), true);
    sandbox.clock.advance(1500);
    assert.equal(first, 0);
    assert.equal(second, 1);
    assert.equal(S.isBenchmarkActive(), false);
    assert.deepEqual(sandbox.clock.errors, []);
});

test("quiet diagnostic accounting still records callbacks without benchmark console output", () => {
    const { sandbox, S } = setup();
    const before = sandbox.messages.length;
    let stats;
    S.startBenchmark(4, (_report, value) => { stats = value; }, { quiet: true });
    const loop = S.createPollLoop(() => {}, 0.2, "ql_test");
    sandbox.clock.advance(4500); loop.stop();
    assert.ok(stats.totalTicks >= 10);
    assert.equal(sandbox.messages.slice(before).some(message => /Starting|Heartbeat|BENCHMARK/.test(message)), false);
    assert.equal(S.isBenchmarkActive(), false);
});

for (const cancellation of ["ignored", "throw"]) for (const zeroHandle of [false, true]) {
    test(`retired benchmark callbacks stay inert with cancellation=${cancellation}, zero=${zeroHandle}`, () => {
        const { sandbox, S, cancellations } = setup({ cancellation, zeroHandle });
        let first = 0, second = 0;
        const old = S.startBenchmark(4, () => { first++; });
        assert.doesNotThrow(() => S.startBenchmark(6, () => { second++; }));
        sandbox.clock.advance(4500);
        assert.equal(first, 0, "the cancelled completion cannot publish or deactivate the successor");
        assert.equal(second, 0);
        assert.equal(S.isBenchmarkActive(), true);
        const heartbeats = sandbox.messages.filter(message => message.includes("[Benchmark] Heartbeat:"));
        assert.equal(heartbeats.length, 1, "the retired progress callback cannot print a successor's stats");
        assert.match(heartbeats[0], /\/6s elapsed/);
        old.stop();
        sandbox.clock.advance(2000);
        assert.equal(second, 1);
        assert.equal(S.isBenchmarkActive(), false);
        if (zeroHandle) assert.ok(cancellations.includes(0));
        assert.deepEqual(sandbox.clock.errors, []);
    });
}

test("benchmark completion can start a successor before the completed handle is stopped", () => {
    const { sandbox, S } = setup();
    let first = 0, second = 0;
    const old = S.startBenchmark(1, () => {
        first++;
        S.startBenchmark(1, () => { second++; });
    });
    sandbox.clock.advance(1100);
    old.stop();
    assert.equal(first, 1);
    assert.equal(S.isBenchmarkActive(), true);
    sandbox.clock.advance(1100);
    assert.equal(second, 1);
    assert.deepEqual(sandbox.clock.errors, []);
});

test("a replaced handle preserves the successor's lookup hook and completion restores native binding", () => {
    const { sandbox, S } = setup(), root = sandbox.doc.root;
    const original = root.FindChildTraverse;
    let stats;
    const old = S.startBenchmark(1, null, { capturePanelLookups: true, panelRoot: root });
    S.startBenchmark(1, (_report, result) => { stats = result; }, { capturePanelLookups: true, panelRoot: root });
    const current = root.FindChildTraverse;
    old.stop();
    assert.equal(root.FindChildTraverse, current);
    root.FindChildTraverse("missing");
    sandbox.clock.advance(1100);
    assert.ok(stats);
    assert.equal(stats.lookupStats.totalCalls, 1);
    assert.equal(root.FindChildTraverse, original);
    assert.deepEqual(sandbox.clock.errors, []);
});

test("stop retires zero-handle work and reports cancellation failures only once", () => {
    const { sandbox, S, cancellations } = setup({ cancellation: "throw", zeroHandle: true });
    let completed = 0;
    const benchmark = S.startBenchmark(4, () => { completed++; });
    assert.doesNotThrow(() => benchmark.stop());
    const messages = sandbox.messages.length;
    benchmark.stop();
    assert.equal(sandbox.messages.length, messages);
    assert.equal(cancellations.length, 2, "both owned native timers receive a cancellation attempt");
    assert.ok(cancellations.includes(0));
    assert.equal(sandbox.messages.filter(message => message.includes("modeled native cancellation failure")).length, 2);
    sandbox.clock.advance(5000);
    assert.equal(completed, 0);
    assert.equal(S.isBenchmarkActive(), false);
    assert.equal(sandbox.messages.filter(message => message.includes("[Benchmark] Heartbeat:")).length, 0);
    assert.deepEqual(sandbox.clock.errors, []);
});
