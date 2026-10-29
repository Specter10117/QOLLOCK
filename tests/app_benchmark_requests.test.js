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

function topbar(hud) {
    const core = hud.root.addChild(hud.doc.create("Panel", { classes: ["HudCore"] }));
    return core.addChild(hud.doc.create("CitadelHudTopBar", { id: "TopBar" }));
}

test("FPS scan leases expanded config, cancels through the bridge and restores settings", () => {
    const { hud, Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    const owners = Q.core.FeatureRegistry.getEnabledIds().slice().sort();
    request("fps_expanded_cancel");
    assert.equal(Q.core.FpsInvestigation.getStatus().running, true);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_COMPASS, 1);
    request("fps_stop_cancel");
    assert.equal(Q.core.FpsInvestigation.getStatus().running, false);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.deepEqual(Q.core.FeatureRegistry.getEnabledIds().slice().sort(), owners);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark.token, "fps_expanded_cancel");
    assert.match(diag.benchmark.report, /cancelled/);
    hud.clock.advance(5000);
    assert.deepEqual(hud.clock.errors, []);
});

test("FPS stop while idle does not start a diagnostic or alter settings", () => {
    const { Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    request("fps_stop_idle");
    assert.equal(Q.core.FpsInvestigation.getStatus(), null);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
});

test("minimap polling request uses expanded config and restores the canonical lease", () => {
    const { Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    let scan;
    Q.core.MinimapInvestigation.start = options => {
        scan = options;
        return { stop: () => options.onComplete({ reason: "cancelled", report: "minimap panels retained" }) };
    };
    request("fps_minimap_polling");
    assert.equal(scan.baseline.ENABLE_MINIMAP_CRATE_OVERLAY, 1);
    assert.equal(scan.baseline.ENABLE_MINIMAP_STATUES, 1);
    assert.equal(scan.baseline.MINIMAP_CAMP_NAMES, 1);
    request("fps_stop_minimap");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
});

test("FPS safety timeout stops its diagnostic before restoring the lease", () => {
    const { hud, Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    let stopped = "";
    Q.core.MinimapInvestigation.start = options => ({ stop(reason) {
        stopped = reason;
        options.onComplete({ reason, report: "safety stop" });
    } });
    request("fps_minimap_safety");
    hud.clock.advanceBy(1804000, 10000);
    assert.equal(stopped, "safety-timeout");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.equal(JSON.parse(hud.root.GetAttributeString("QOL_Diag", "")).benchmark.token, "fps_minimap_safety");
    assert.deepEqual(hud.clock.errors, []);
});

test("a new lease started by a FPS safety stop survives the retiring safety callback", () => {
    const { hud, Q, request } = setup();
    let first = true;
    Q.core.MinimapInvestigation.start = () => ({ stop() {
        if (!first) return;
        first = false;
        request("fps_expanded_after_safety");
    } });
    request("fps_minimap_safety_reentry");
    hud.clock.advanceBy(1804000, 10000);
    assert.equal(first, false);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_COMPASS, 1, "the old safety callback cannot restore over a new expanded lease");
    request("fps_stop_cleanup");
    assert.deepEqual(hud.clock.errors, []);
});

test("complete minimap suite traverses the real App/registry path and emits compact evidence packets", () => {
    const { hud, Q, g, request } = setup();
    // Model the next UI dispatch; the virtual clock otherwise fires zero-delay
    // schedules at the same instant. This is not a native cadence measurement.
    const schedule = g.$.Schedule;
    g.$.Schedule = (delay, callback) => schedule(delay || 0.016, callback);
    const create = g.$.CreatePanel;
    g.$.CreatePanel = (...args) => { const panel = create(...args); panel.actuallayoutwidth = panel.actuallayoutheight = 600; return panel; };
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    let parent = hud.root;
    for (const props of [{ classes: ["HudCore"] }, { id: "gameplay_hud" }, { classes: ["clamp_width"] },
        { id: "minimap_persp" }, { id: "minimap_container" }, { id: "HudMinimapContainer" },
        { id: "hud_minimap", classes: ["HudMinimap", "dl_midtown"] }]) {
        parent = parent.addChild(hud.doc.create("Panel", props));
    }
    const renderer = parent;
    const start = Q.core.MinimapInvestigation.start;
    let references;
    Q.core.MinimapInvestigation.start = options => start({ ...options, onWindow: window => {
        const current = [renderer.FindChild("minimap_overlay_root"), renderer.FindChild("QOLMinimapLootRoot")];
        if (!references) references = current;
        assert.deepEqual(current, references, "actual feature trees are retained in all A/B conditions");
        assert.ok(current.every(panel => panel.IsValid()));
        assert.equal(Q.core.FeatureRegistry.isEnabled("ql_minimap_runtime"), true);
        assert.equal(Q.core.FeatureRegistry.isEnabled("ql_minimap_loot"), true);
        options.onWindow(window);
    } });
    request("fps_minimap_100_static-crates");
    hud.clock.advanceBy(100000, 10000);
    const diag = JSON.parse(hud.root.GetAttributeString("QOL_Diag", ""));
    assert.equal(diag.benchmark.stats.reason, "complete");
    assert.equal(diag.benchmark.stats.kind, "minimap-suite");
    assert.equal(diag.benchmark.stats.completedBlocks, 6);
    const markers = hud.sandbox.messages.filter(line => line.startsWith("[QOLLOCK:NativeFPS] "));
    const values = markers.map(line => JSON.parse(line.slice("[QOLLOCK:NativeFPS] ".length)));
    assert.equal(values.filter(value => value.type === "window").length, 24);
    assert.ok(values.some(value => value.type === "packet" && value.packet === "context"));
    assert.ok(values.some(value => value.type === "packet" && value.packet === "app-restoration"));
    assert.equal(values[0].type, "start");
    assert.equal(values.at(-1).type, "end");
    assert.match(values[0].session, /^minimap_[0-9a-f]{8}_\d+$/);
    assert.ok(values.every(value => value.session === values[0].session));
    assert.ok(markers.every(line => line.length < 2000), "native console truncation cannot cut transport markers");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.deepEqual(hud.clock.errors, []);
});

test("minimap replacement emits restoration evidence only after the retiring App config lease is restored", () => {
    const { hud, Q, request } = setup();
    Q.core.ConfigAdapter.loadFromFlat({ ENABLE_COMPASS: 0 });
    Q.core.MinimapInvestigation.start = options => ({ stop: () => options.onComplete({ reason: "cancelled", report: "cancelled" }) });
    request("fps_minimap_123");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_COMPASS, 1);
    request("bm_1_normal_replace");
    const values = hud.sandbox.messages.filter(line => line.startsWith("[QOLLOCK:NativeFPS] ")).map(line => JSON.parse(line.slice("[QOLLOCK:NativeFPS] ".length)));
    const session = values.find(value => value.type === "start").session;
    const { packets } = require("../scripts/analyze_minimap_frames").decodePackets(values.filter(value => value.type === "packet"), session);
    const restored = packets.get("app-restoration");
    assert.equal(restored.expectedConfig.ENABLE_COMPASS, 0);
    assert.equal(restored.actualConfig.ENABLE_COMPASS, 0);
    assert.equal(restored.stressLeaseActive, false);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_COMPASS, 0);
});

test("FPS layer trials use the App lease, reconcile owners and reject retired config writers", () => {
    const { hud, Q, g, request } = setup();
    const canonical = Q.core.ConfigAdapter.exportToFlat();
    let scan;
    Q.core.FpsInvestigation.start = options => {
        scan = options;
        return { stop: () => options.onComplete({ report: "cancelled", reason: "cancelled" }) };
    };
    request("fps_expanded_layers");
    assert.equal(scan.configuration.baseline.ENABLE_MINIMAP_STATUES, 1);
    const expected = scan.configuration.apply({ ENABLE_MINIMAP_STATUES: 0, ENABLE_MINIMAP_TOUGH_CRATES: 0,
        ENABLE_MINIMAP_HEALING_SNACKS: 0, ENABLE_MINIMAP_CRATE_ROUTES: 0, MINIMAP_CAMP_NAMES: 0 });
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_MINIMAP_STATUES, 0);
    assert.equal(g.State.lastConfig.ENABLE_MINIMAP_CRATE_ROUTES, 0);
    assert.equal(expected.includes("ql_minimap_loot"), false);
    assert.equal(Q.core.FeatureRegistry.isEnabled("ql_minimap_loot"), false);
    scan.configuration.apply({});
    assert.equal(Q.core.FeatureRegistry.isEnabled("ql_minimap_loot"), true);
    request("fps_stop_layers");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), canonical);
    assert.throws(() => scan.configuration.apply({ ENABLE_MINIMAP_STATUES: 0 }), /retired/);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), canonical);
    assert.deepEqual(hud.clock.errors, []);
});

test("superseding a layer trial permits synchronous baseline cleanup but retires its writer", () => {
    const { Q, request } = setup();
    const scans = [];
    let cleaned = false;
    Q.core.FpsInvestigation.start = options => {
        scans.push(options);
        return { stop() { options.configuration.apply({}); cleaned = true; } };
    };
    request("fps_expanded_old_layer");
    scans[0].configuration.apply({ ENABLE_MINIMAP_STATUES: 0 });
    request("fps_current_new_layer");
    assert.equal(cleaned, true);
    assert.throws(() => scans[0].configuration.apply({}), /retired/);
    request("fps_stop_new_layer");
});

test("a newer FPS request started during layer cleanup keeps its lease and is not overwritten", () => {
    const { Q, request } = setup();
    const canonical = Q.core.ConfigAdapter.exportToFlat();
    let starts = 0, reentered = false;
    Q.core.FpsInvestigation.start = options => {
        starts++;
        return { stop() {
            if (!reentered) { reentered = true; request("fps_expanded_inner_cleanup"); }
            options.configuration.apply({});
            options.onComplete({ report: "cancelled", reason: "cancelled" });
        } };
    };
    request("fps_expanded_initial_cleanup");
    request("fps_current_outer_cleanup");
    assert.equal(starts, 2, "the newer request from cleanup must survive the older outer request");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().ENABLE_COMPASS, 1);
    request("fps_stop_final_cleanup");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), canonical);
});

test("current FPS scan freezes canonical config instead of sampling an expiring Customize draft", () => {
    const { hud, Q, g, request } = setup();
    const canonical = { ...Q.buildDefaultConfig(), TOP_BAR_X_OFFSET: 37 };
    g.State.lastConfig = canonical;
    Q.core.ConfigAdapter.loadFromFlat(canonical);
    hud.root.AddClass("QOLCustomizeActive");
    Q.presentation.preview.write(hud.root, { TOP_BAR_X_OFFSET: 90 }, "scan-draft",
        Q.core.persistence.getConfigChangeStamp(Q.getUIRoot()));
    hud.clock.advance(600);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().TOP_BAR_X_OFFSET, 90);
    request("fps_current_frozen");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().TOP_BAR_X_OFFSET, 37);
    hud.clock.advance(3000);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().TOP_BAR_X_OFFSET, 37);
    request("fps_stop_frozen");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().TOP_BAR_X_OFFSET, 37);
    assert.deepEqual(hud.clock.errors, []);
});

test("current FPS scan supersedes legacy stress with canonical settings and retires its old safety timer", () => {
    const { hud, Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    request("bm_1_stress_previous");
    request("fps_current_successor");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    hud.clock.advance(4500);
    assert.equal(Q.core.FpsInvestigation.getStatus().running, true);
    request("fps_stop_successor");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.deepEqual(hud.clock.errors, []);
});

test("new user config stops a FPS scan and restores the newest accepted values", () => {
    const { hud, Q, g, request } = setup();
    request("fps_expanded_edit");
    const changed = { ...Q.buildDefaultConfig(), KEYBOARD_OVERLAY_SCALE: 175 };
    hud.root.SetAttributeString("Deadlock_Mod_Settings_v1", g.WrapConfigForStorage(changed));
    hud.root.SetAttributeString("QOL_USER_EDIT_REV", "999");
    hud.clock.advance(500);
    assert.equal(Q.core.FpsInvestigation.getStatus().running, false);
    assert.equal(Q.core.ConfigAdapter.exportToFlat().KEYBOARD_OVERLAY_SCALE, 175);
    assert.deepEqual(hud.clock.errors, []);
});

test("expanded benchmark keeps HUD surfaces visible and preserves numeric presentation defaults", () => {
    const { hud, Q, request } = setup();
    const top = topbar(hud);
    request("bm_10_stress_visible");
    hud.clock.advance(600);
    assert.equal(top.style.visibility, undefined);
    const expanded = Q.core.ConfigAdapter.exportToFlat();
    for (const field of Q.settingsFields.filter(field => field.role === "stateVisibility")) {
        assert.equal(expanded[field.key], 0, field.key);
    }
    assert.equal(expanded.ENABLE_HIDE_AMMO_ALL, 0);
    assert.equal(expanded.ENABLE_HIDE_RELOAD_ICON, 0);
    assert.equal(expanded.MINIMAL_MINIMAP_OPACITY, 0.9);
    assert.equal(expanded.ENABLE_COMPASS, 1);
    hud.clock.advance(10000);
    assert.equal(top.style.visibility, undefined);
    assert.deepEqual(hud.clock.errors, []);
});

test("stress completion restores canonical settings rather than an expired Customize draft", () => {
    const { hud, Q, g, request } = setup();
    const top = topbar(hud);
    const canonical = { ...Q.buildDefaultConfig(), TOP_BAR_X_OFFSET: 37 };
    g.State.lastConfig = canonical;
    Q.core.ConfigAdapter.loadFromFlat(canonical);
    hud.root.AddClass("QOLCustomizeActive");
    Q.presentation.preview.write(hud.root, { TOP_BAR_HIDE_NORMAL: 1, TOP_BAR_X_OFFSET: 90 },
        "before-benchmark", Q.core.persistence.getConfigChangeStamp(Q.getUIRoot()));
    hud.clock.advance(600);
    assert.equal(top.style.visibility, "collapse");
    assert.equal(top.style.x, "90px");
    request("bm_10_stress_expired_preview");
    hud.clock.advance(10600);
    assert.equal(top.style.visibility, undefined);
    assert.equal(top.style.x, "37px");
    assert.equal(Q.core.ConfigAdapter.exportToFlat().TOP_BAR_HIDE_NORMAL, 0);
    assert.equal(g.State.lastConfig.TOP_BAR_X_OFFSET, 37);
    assert.deepEqual(hud.clock.errors, []);
});

test("partial stress setup failure rolls back settings before starting a sample", () => {
    const { hud, Q, request } = setup();
    const baseline = Q.core.ConfigAdapter.exportToFlat();
    const load = Q.core.ConfigAdapter.loadFromFlat;
    let starts = 0, fail = true;
    Q.core.Scheduler.startBenchmark = () => { starts++; };
    Q.core.ConfigAdapter.loadFromFlat = (...args) => {
        load(...args);
        if (fail) { fail = false; throw Error("injected partial stress setup failure"); }
    };
    request("bm_10_stress_failed_setup");
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.equal(starts, 0);
    hud.clock.advance(14000);
    assert.deepEqual(Q.core.ConfigAdapter.exportToFlat(), baseline);
    assert.ok(hud.sandbox.messages.some(message => message.includes("injected partial stress setup failure")));
    assert.deepEqual(hud.clock.errors, []);
});

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
