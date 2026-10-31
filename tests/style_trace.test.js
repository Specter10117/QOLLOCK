"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { counters, silently } = require("../scripts/simulator/perf/instrument");
const { createProfiledHud } = require("../scripts/simulator/perf/profile");
const { collectStyleTrace, parseArgs, reportText } = require("../scripts/trace_styles_hud");

const fixture = () => ({ domTree: { id: "CitadelHudRoot", children: [
    { id: "Hud", classes: ["connectedToGame", "joined_team"], children: [
        { id: "gameplay_hud", children: [] }, { id: "hudActivePlayerStats", children: [] },
    ] },
] } });
const setup = () => createProfiledHud({ capturedTree: fixture(), warmupMs: 0, enableAll: false });
const schedule = (hud, seconds, owner, callback) => hud.clock.schedule(seconds, () => counters.around(owner, callback));

test("style trace follows production owner apply/clear, excludes warm-up and distinguishes identical assignments", () => {
    const hud = setup(), panel = hud.doc.root;
    const owner = hud.sandbox.global.QOL.core.panel.createNativeStyleOwner();
    owner.apply(panel, { color: "red" });
    schedule(hud, 0.001, "probe", () => owner.apply(panel, { color: "red" }));
    schedule(hud, 0.002, "probe", () => owner.apply(panel, { color: "blue" }));
    schedule(hud, 0.003, "probe", () => { panel.style.color = "blue"; });
    schedule(hud, 0.004, "probe", () => owner.clear());
    const previous = () => { throw Error("previous observer must only be restored"); };
    counters.onStyleWrite = previous;
    let result;
    try { result = collectStyleTrace(hud, { seconds: 0.01, feature: "probe", includeEvents: true }); }
    finally { assert.equal(counters.onStyleWrite, previous); delete counters.onStyleWrite; }
    assert.deepEqual(result.events.map(e => [e.t, e.operation, e.previousValue, e.requestedValue, e.outcome]), [
        [0.002, "set", "red", "blue", "completed"],
        [0.003, "set", "blue", "blue", "completed"],
        [0.004, "delete", "blue", null, "completed"],
    ]);
    assert.deepEqual(result.styleTotals, { attempts: 3, completed: 3, changed: 2, identical: 1, failed: 0, deletes: 1 });
    assert.equal(result.styles[0].panelUid, panel._uid);
    assert.equal(result.snapshot.rows.find(r => r.label === "probe").styleWritesChanged, 2);
    assert.equal(panel.style.color, undefined);
    panel.style.color = "outside sample";
    assert.equal(result.events.length, 3);
    assert.equal(result.coverage.observerErrors.count, 0);
});

test("ordered events expose two writers and A/B/A requests without conflating duplicate IDs or replacement objects", () => {
    const hud = setup();
    const make = () => hud.doc.root.addChild(hud.doc.create("Panel", { id: "duplicate" }));
    const first = make(), second = make();
    schedule(hud, 0.001, "one", () => { first.style.color = "A"; second.style.color = "A"; });
    schedule(hud, 0.002, "two", () => { first.style.color = "B"; });
    schedule(hud, 0.003, "one", () => { first.style.color = "A"; });
    let replacement;
    schedule(hud, 0.004, "one", () => {
        first._destroy(); replacement = make(); replacement.style.color = "A";
    });
    const result = collectStyleTrace(hud, { seconds: 0.01, includeEvents: true });
    const firstEvents = result.events.filter(e => e.panelUid === first._uid);
    assert.deepEqual(firstEvents.map(e => [e.owner, e.requestedValue]), [["one", "A"], ["two", "B"], ["one", "A"]]);
    assert.equal(new Set(result.styles.filter(r => r.panelId === "duplicate").map(r => r.panelUid)).size, 3);
    assert.equal(result.events.find(e => e.panelUid === replacement._uid).previousUndefined, true);
    assert.match(result.scope, /do not prove unnecessary work or a conflict/);
    assert.doesNotMatch(reportText(result), /conflict detected|redundant writes|native cost savings/i);
});

test("retention caps expose omissions while selected-owner totals stay exact and whole-HUD counters remain separate", () => {
    const hud = setup(), panel = hud.doc.root;
    schedule(hud, 0.001, "one", () => { panel.style.color = "A"; panel.style.opacity = "0.5"; });
    schedule(hud, 0.002, "two", () => { panel.style.color = "B"; });
    schedule(hud, 0.003, "one", () => { panel.style.color = "C"; });
    const result = collectStyleTrace(hud, { seconds: 0.01, feature: "one", includeEvents: true, detailLimit: 1, eventLimit: 1 });
    assert.equal(result.styleTotals.attempts, 3);
    assert.equal(result.styles.length, 1);
    assert.equal(result.styles[0].attempts, 2, "retained keys keep counting after the key cap");
    assert.equal(result.coverage.detail.omittedEvents, 1);
    assert.equal(result.coverage.events.omittedEvents, 2);
    assert.equal(result.events.length, 1);
    assert.ok(result.snapshot.rows.some(r => r.label === "two"));
    assert.deepEqual(result.validity.issues, []);
});

test("fault injection: rejected native-owner setter stays visible even when production catches it", () => {
    const hud = setup(), panel = hud.doc.root;
    panel.style = new Proxy(panel.style, { set() { throw Error("injected rejected style"); } });
    const owner = hud.sandbox.global.QOL.core.panel.createNativeStyleOwner();
    let accepted;
    schedule(hud, 0.001, "probe", () => { accepted = owner.apply(panel, { color: "red" }); });
    const result = collectStyleTrace(hud, { seconds: 0.01, feature: "probe", includeEvents: true });
    assert.equal(accepted, false);
    assert.equal(result.styleTotals.failed, 1);
    assert.equal(result.styleTotals.completed, 0);
    assert.equal(result.events[0].outcome, "threw");
    assert.match(result.events[0].error, /injected rejected style/);
    assert.ok(result.validity.issues.some(issue => issue.includes("style mutations threw")));
    assert.deepEqual(result.callbackErrors, [], "the owner catches the failure, so clock errors alone would miss it");
    assert.equal(result.coverage.observerErrors.count, 0);
});

test("observer failures cannot silently produce clean validity or break production writes", () => {
    const hud = setup(), panel = hud.doc.root;
    panel.getBreadcrumbs = () => { throw Error("injected observer failure"); };
    schedule(hud, 0.001, "probe", () => { panel.style.color = "red"; });
    const result = collectStyleTrace(hud, { seconds: 0.01, feature: "probe" });
    assert.equal(panel.style.color, "red");
    assert.equal(result.styleTotals.completed, 1);
    assert.equal(result.coverage.observerErrors.count, 1);
    assert.match(result.coverage.observerErrors.messages[0], /injected observer failure/);
    assert.ok(result.validity.issues.some(issue => issue.includes("observer failures")));
    assert.equal(counters.onStyleWrite, undefined);
});

test("filtering style details cannot hide a caught mutation failure from another owner", () => {
    const hud = setup(), panel = hud.doc.root;
    panel.style = new Proxy(panel.style, { set() { throw Error("other-owner failure"); } });
    const owner = hud.sandbox.global.QOL.core.panel.createNativeStyleOwner();
    schedule(hud, 0.001, "other", () => owner.apply(panel, { color: "red" }));
    const result = collectStyleTrace(hud, { seconds: 0.01, feature: "selected", includeEvents: true, eventLimit: 0 });
    assert.equal(result.styleTotals.attempts, 0);
    assert.equal(result.coverage.mutationFailures.count, 1);
    assert.equal(result.coverage.mutationFailures.events[0].owner, "other");
    assert.match(result.coverage.mutationFailures.events[0].error, /other-owner failure/);
    assert.ok(result.validity.issues.some(issue => issue.includes("style mutations threw")));
});

test("explicit enumeration is attributed and native-search internals do not contribute enumeration requests", () => {
    const hud = setup(), root = hud.doc.root;
    const first = root.addChild(hud.doc.create("Panel", { id: "first" }));
    first.addChild(hud.doc.create("Panel", { id: "nested", classes: ["target"] }));
    const expectedChildren = root._children.length;
    counters.reset(); counters.enabled = true;
    let snap;
    try {
        counters.around("enumerator", () => {
            assert.equal(root.Children().length, expectedChildren);
            assert.equal(root.Children().length, expectedChildren);
            assert.equal(root.GetChild(99999), null);
            assert.equal(root.GetChild(expectedChildren - 1), first);
            assert.equal(root.GetChildCount(), expectedChildren);
        });
        counters.around("searcher", () => {
            root.FindChild("first"); root.FindChildTraverse("nested"); root.FindChildrenWithClassTraverse("target");
        });
        silently(() => { root.Children(); root.GetChild(0); root.GetChildCount(); });
        snap = counters.snapshot(1);
    } finally { counters.enabled = false; }
    const enumeration = snap.rows.find(r => r.label === "enumerator"), search = snap.rows.find(r => r.label === "searcher");
    assert.equal(enumeration.childrenRequests, 2);
    assert.equal(enumeration.childrenReturnedReferences, 2 * expectedChildren);
    assert.equal(enumeration.getChildRequests, 2);
    assert.equal(enumeration.getChildCountRequests, 1);
    assert.equal(enumeration.costUnits, 0, "no invented native-cost weights");
    for (const key of ["childrenRequests", "childrenReturnedReferences", "getChildRequests", "getChildCountRequests"]) assert.equal(search[key], 0);
    assert.equal(search.traverseCalls + search.classTraverseCalls, 3);
    assert.match(hud.meta.enumerationCoverage.exclusions, /private children/);
});

test("style trace CLI selects the tracked capture, emits parseable JSON and rejects invalid options/input", () => {
    const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, "../scripts/trace_styles_hud.js"), ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    const result = cli("--seconds", "0.1", "--json", "--events");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.meta.captureFidelity.timestampUtc, "2026-10-03T11:46:57.838Z");
    assert.equal(report.meta.warmupMs, 8000);
    assert.equal(report.coverage.events.requested, true);
    assert.equal(cli("--capture", path.join(__dirname, "missing-style-trace-capture.json")).status, 2);
    for (const args of [["--seconds", "0"], ["--warmup", "-1"], ["--capture"], ["--unknown"], ["--enable", "A=1=2"]]) assert.throws(() => parseArgs(args));
    assert.equal(parseArgs(["probe", "--defaults", "--enable", "HEALTHBAR_TYPE=5"]).configOverrides.HEALTHBAR_TYPE, 5);
});
