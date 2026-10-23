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
