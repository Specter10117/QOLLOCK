"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup() {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    const g = hud.sandbox.global, Q = g.QOL;
    const request = token => {
        hud.root.SetAttributeString("QOL_DiagRequest", token);
        Q.core.App.syncDiagnosticState(hud.root, hud.clock.now());
    };
    return { hud, Q, request, g };
}

test("normal benchmark dispatch deduplicates tokens and publishes the captured completion", () => {
    const { hud, Q, request } = setup(), calls = [];
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    Q.core.Scheduler.startBenchmark = (duration, complete, options) => calls.push({ duration, complete, options });
    request("bm_2_normal_first");
    request("bm_2_normal_first");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].duration, 2);
    assert.equal(calls[0].options.capturePanelLookups, true);
    assert.equal(calls[0].options.panelRoot, hud.root);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    request("fit_later_token");
    calls[0].complete("captured report", { totalTicks: 12 });
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.diagToken, "bm_2_normal_first");
    assert.equal(diag.benchmark.token, "bm_2_normal_first");
    assert.equal(diag.benchmark.report, "captured report");
    assert.equal(diag.benchmark.stats.totalTicks, 12);
    assert.deepEqual(hud.clock.errors, []);
});

test("stress setup precedes Scheduler dispatch and completion restores buffered user settings once", () => {
    const { hud, Q, g, request } = setup();
    let complete, calls = 0;
    Q.core.Scheduler.startBenchmark = (duration, callback, options) => {
        calls++;
        complete = callback;
        assert.equal(duration, 2);
        assert.equal(options, null);
        assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_CENTER_ESC, 1);
        assert.equal(Q.core.FeatureRegistry.isEnabled("ql_compass"), true);
        assert.equal(hud.root.BHasClass("center_esc_active"), true);
    };
    const edited = { ...Q.core.ConfigAdapter.exportToFlat(), ENABLE_CENTER_ESC: 0,
        ENABLE_COMPASS: 0, PLAYER_HEALTHBAR_ACCENT_COLOR: 7 };
    request("bm_2_stress_buffered");
    request("bm_2_stress_buffered");
    assert.equal(calls, 1);
    hud.root.SetAttributeString("Deadlock_Mod_Settings_v1", g.WrapConfigForStorage(edited));
    hud.root.SetAttributeString("QOL_USER_EDIT_REV", "99");
    hud.clock.advance(300);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_CENTER_ESC, 1);
    assert.equal(hud.root.BHasClass("center_esc_active"), true);
    complete("stress report", { totalTicks: 20 });
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_CENTER_ESC, 0);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().PLAYER_HEALTHBAR_ACCENT_COLOR, 7);
    assert.equal(Q.core.FeatureRegistry.isEnabled("ql_compass"), false);
    assert.equal(hud.root.BHasClass("center_esc_active"), false);
    hud.clock.advance(6000);
    assert.equal(hud.sandbox.messages.filter(message => message.includes("Stress benchmark finished")).length, 1);
    assert.deepEqual(hud.clock.errors, []);
});

for (const outcome of ["error", "unavailable", "safety-timeout", "shutdown"]) {
    test(`stress benchmark restores accepted configuration after ${outcome}`, () => {
        const { hud, Q, request } = setup();
        const baseline = Q.core.ConfigAdapter.exportToFlat();
        Q.core.Scheduler.startBenchmark = outcome === "unavailable" ? null : () => {
            if (outcome === "error") throw Error("modeled benchmark start failure");
        };
        request(`bm_1_stress_${outcome}`);
        if (outcome === "safety-timeout" || outcome === "shutdown") {
            assert.equal(hud.root.BHasClass("center_esc_active"), true);
            if (outcome === "shutdown") Q.core.App.shutdown();
            else hud.clock.advance(4100);
        }
        assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
        assert.equal(hud.root.BHasClass("center_esc_active"), false);
        assert.ok(hud.sandbox.messages.some(message => message.includes(`Stress benchmark finished (${outcome})`)));
        assert.deepEqual(hud.clock.errors, []);
    });
}

for (const cancellation of ["ignored", "throw"]) for (const zeroHandle of [false, true]) {
    test(`superseded stress safety cannot restore the new request with cancellation=${cancellation}, zero=${zeroHandle}`, () => {
        const { hud, Q, g, request } = setup();
        const schedule = g.$.Schedule;
        let zeroNativeHandle = null;
        const cancellations = [];
        g.$.Schedule = (delay, callback) => {
            const handle = schedule(delay, callback);
            if (zeroHandle && delay === 7 && zeroNativeHandle === null) { zeroNativeHandle = handle; return 0; }
            return handle;
        };
        g.$.CancelScheduled = handle => {
            cancellations.push(handle);
            if (cancellation === "throw") throw Error("modeled native cancellation failure");
        };
        request("bm_4_stress_retired");
        hud.clock.advance(1000);
        request("bm_10_stress_current");
        hud.clock.advance(6100);
        assert.equal(hud.root.BHasClass("center_esc_active"), true, "an older fallback cannot restore the current lease");
        assert.equal(Q.core.Scheduler.isBenchmarkActive(), true);
        assert.equal(hud.sandbox.messages.filter(message => message.includes("Stress benchmark finished")).length, 0);
        hud.clock.advance(4100);
        assert.equal(hud.root.BHasClass("center_esc_active"), false);
        const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
        assert.equal(diag.benchmark.token, "bm_10_stress_current");
        if (zeroHandle) assert.ok(cancellations.includes(0));
        assert.deepEqual(hud.clock.errors, []);
    });
}

test("App shutdown stops its benchmark hook and a retired completion cannot publish after reboot", () => {
    const { hud, Q, request } = setup();
    const nativeLookup = hud.root.FindChildTraverse;
    request("bm_1_normal_retired");
    assert.notEqual(hud.root.FindChildTraverse, nativeLookup);
    Q.core.App.shutdown();
    assert.equal(Q.core.Scheduler.isBenchmarkActive(), false);
    assert.equal(hud.root.FindChildTraverse, nativeLookup);
    Q.core.App.boot();
    hud.clock.advance(1500);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark, undefined);
    assert.deepEqual(hud.clock.errors, []);
});

test("a normal request during stress retains the existing config lease until its safety fallback", () => {
    const { hud, Q, g, request } = setup();
    const edited = { ...Q.core.ConfigAdapter.exportToFlat(), ENABLE_CENTER_ESC: 0,
        ENABLE_COMPASS: 0, ENABLE_COMPASS_SPEED: 0, PLAYER_HEALTHBAR_ACCENT_COLOR: 9 };
    request("bm_4_stress_lease");
    hud.clock.advance(1000);
    hud.root.SetAttributeString("Deadlock_Mod_Settings_v1", g.WrapConfigForStorage(edited));
    hud.root.SetAttributeString("QOL_USER_EDIT_REV", "99");
    hud.clock.advance(300);
    request("bm_1_normal_preserves_lease");
    hud.clock.advance(1500);
    assert.equal(Q.core.Scheduler.isBenchmarkActive(), false);
    assert.equal(hud.root.BHasClass("center_esc_active"), true);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark.token, "bm_1_normal_preserves_lease");
    hud.clock.advance(4500);
    assert.equal(hud.root.BHasClass("center_esc_active"), false);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().PLAYER_HEALTHBAR_ACCENT_COLOR, 9);
    assert.equal(Q.core.FeatureRegistry.isEnabled("ql_compass"), false);
    assert.equal(hud.sandbox.messages.filter(message => message.includes("Stress benchmark finished (safety-timeout)")).length, 1);
    assert.deepEqual(hud.clock.errors, []);
});

for (const mode of ["normal", "stress"]) {
    test(`a newer ${mode} request from stress setup cannot be superseded by the old outer setup`, () => {
        const { hud, Q, g, request } = setup();
        const schedule = g.$.Schedule, cancel = g.$.CancelScheduled;
        const cancellations = [];
        let firstSafety = null;
        g.$.Schedule = (delay, callback) => {
            const handle = schedule(delay, callback);
            if (delay === 7 && firstSafety === null) firstSafety = handle;
            return handle;
        };
        g.$.CancelScheduled = handle => { cancellations.push(handle); cancel(handle); };
        request("bm_4_stress_previous_lease");
        const load = Q.core.ConfigAdapter.loadFromFlat;
        let entered = false;
        Q.core.ConfigAdapter.loadFromFlat = (...args) => {
            const result = load(...args);
            if (!entered) {
                entered = true;
                request(`bm_1_${mode}_reentrant`);
            }
            return result;
        };
        request("bm_4_stress_outer");
        assert.ok(cancellations.includes(firstSafety), "the previous lease's safety is cancelled before reentrant setup can replace its owner");
        hud.clock.advance(1500);
        const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
        assert.equal(diag.benchmark?.token, `bm_1_${mode}_reentrant`);
        assert.equal(Q.core.Scheduler.isBenchmarkActive(), false);
        assert.equal(hud.root.BHasClass("center_esc_active"), mode === "normal");
        assert.deepEqual(hud.clock.errors, []);
    });
}

test("a replacement stress started during restoration keeps its projection and report ownership", () => {
    const { hud, Q, g, request } = setup();
    const edited = { ...Q.core.ConfigAdapter.exportToFlat(), PLAYER_HEALTHBAR_ACCENT_COLOR: 11 };
    request("bm_0.9_stress_completing");
    const raw = g.WrapConfigForStorage(edited);
    hud.root.SetAttributeString("Deadlock_Mod_Settings_v1", raw);
    hud.root.SetAttributeString("QOL_USER_EDIT_REV", "99");
    hud.clock.advance(300);
    const load = Q.core.ConfigAdapter.loadFromFlat;
    let entered = false, canonicalLoads = 0;
    Q.core.ConfigAdapter.loadFromFlat = (...args) => {
        const result = load(...args);
        if (args[0].ENABLE_CENTER_ESC === 0) canonicalLoads++;
        if (!entered && args[0].ENABLE_CENTER_ESC === 0) {
            entered = true;
            request("bm_0.01_stress_from_restore");
        }
        return result;
    };
    hud.clock.advance(605);
    assert.equal(entered, true);
    assert.equal(Q.core.Scheduler.isBenchmarkActive(), true);
    assert.equal(hud.root.BHasClass("center_esc_active"), true, "the retired restore cannot project canonical classes over its replacement");
    assert.equal(JSON.parse(hud.root.GetAttributeString("QOL_Diag", "")).benchmark, undefined);
    hud.clock.advance(200);
    assert.equal(hud.root.BHasClass("center_esc_active"), false);
    assert.equal(JSON.parse(hud.root.GetAttributeString("QOL_Diag", "")).benchmark.token, "bm_0.01_stress_from_restore");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().PLAYER_HEALTHBAR_ACCENT_COLOR, 11);
    assert.equal(hud.root.GetAttributeString("Deadlock_Mod_Settings_v1", ""), raw);
    assert.equal(hud.root.GetAttributeString("QOL_USER_EDIT_REV", ""), "99");
    assert.equal(canonicalLoads, 2, "the replacement inherits the consumed revision/raw and cannot replay the same publication");
    assert.deepEqual(hud.clock.errors, []);
});

test("an abandoned benchmark start error stays observable without retiring its successor", () => {
    const { hud, Q, request } = setup();
    const start = Q.core.Scheduler.startBenchmark;
    let entered = false;
    Q.core.Scheduler.startBenchmark = (...args) => {
        if (!entered) {
            entered = true;
            request("bm_1_normal_successor");
            throw Error("retired benchmark start failure");
        }
        return start(...args);
    };
    request("bm_2_normal_abandoned");
    assert.ok(hud.sandbox.messages.some(message => message.includes("retired benchmark start failure")));
    assert.equal(Q.core.Scheduler.isBenchmarkActive(), true);
    hud.clock.advance(1500);
    assert.equal(JSON.parse(hud.root.GetAttributeString("QOL_Diag", "")).benchmark.token, "bm_1_normal_successor");
    assert.deepEqual(hud.clock.errors, []);
});
