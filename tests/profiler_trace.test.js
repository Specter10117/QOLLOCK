"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Clock } = require("../scripts/simulator/clock");
const { Document } = require("../scripts/simulator/panel");
const { install, counters, silently } = require("../scripts/simulator/perf/instrument");
const { buildCapturedHud } = require("../scripts/simulator/perf/hud_tree");
const { createProfiledHud, makeMaximalConfig } = require("../scripts/simulator/perf/profile");
const { parseArgs, matchesLabel, collectTrace } = require("../scripts/trace_feature_hud");
const { Counters, READ_DETAIL_LIMIT } = require("../scripts/simulator/perf/counters");
const { collectProfile, report } = require("../scripts/profile_hud");
const { comparisonIssues } = require("../scripts/capture_tree");

install();

function counted(fn) {
    counters.reset();
    counters.enabled = true;
    try { fn(); } finally { counters.enabled = false; }
    return counters.snapshot(1);
}

test("read accounting excludes warm-up, observations and setter internals with exact owner attribution", () => {
    const doc = new Document(new Clock()), panel = doc.root;
    panel.style.color = "red";
    panel.BHasClass("probe"); panel.text; panel.visible;
    const snap = counted(() => {
        counters.around("first", () => {
            const style = panel.style;
            assert.equal(style.color, "red");
            style.color = "red";
            style.color = "blue";
            delete style.color;
            assert.equal(panel.BHasClass("probe"), false);
            panel.SetHasClass("probe", true);
            panel.SetHasClass("probe", true);
            panel.ToggleClass("probe");
            assert.equal(panel.text, "");
            assert.equal(panel.visible, true);
            assert.equal(panel.actuallayoutwidth, 0);
        });
        counters.around("second", () => {
            assert.equal(panel.style.color, undefined);
            assert.equal(panel.BHasClass("probe"), false);
        });
        silently(() => { panel.style.color; panel.BHasClass("probe"); panel.text; });
    });
    assert.equal(snap.total.styleReads, 2);
    assert.equal(snap.total.classReads, 2, "SetHasClass/ToggleClass internals are not BHasClass requests");
    assert.equal(snap.total.propertyReads, 3);
    const first = snap.rows.find(r => r.label === "first");
    assert.equal(first.styleWritesChanged, 2, "changed assignment and clear");
    assert.equal(first.styleWritesRedundant, 1);
    assert.equal(first.classWritesChanged, 2);
    assert.equal(first.classWritesRedundant, 1);
    assert.deepEqual(snap.reads.filter(r => r.label === "second"), [
        { label: "second", kind: "styleReads", property: "color", count: 1 },
        { label: "second", kind: "classReads", property: "probe", count: 1 },
    ]);
    JSON.stringify(doc.root.style); doc.root.BHasClass("probe"); doc.root.text;
    assert.deepEqual(counters.snapshot(1), snap, "outside-window inspection cannot charge production");
});

test("read detail limit retains exact aggregates and reports omitted events", () => {
    const c = new Counters(); c.enabled = true;
    for (let i = 0; i <= READ_DETAIL_LIMIT; i++) c.recordRead("styleReads", String(i));
    c.recordRead("styleReads", "0");
    const snap = c.snapshot(1);
    assert.equal(snap.total.styleReads, READ_DETAIL_LIMIT + 2);
    assert.equal(snap.reads.length, READ_DETAIL_LIMIT);
    assert.equal(snap.reads[0].count, 2);
    assert.equal(snap.readDetailCoverage.omittedEvents, 1);
    assert.equal(snap.total.costUnits, 0, "new reads must not acquire invented native-cost weights");
    c.reset(); assert.equal(c.snapshot(1).readDetailCoverage.omittedEvents, 0);
});

for (const [script, args] of [
    ["profile_hud.js", []],
    ["compare_hud_refs.js", ["--before", "HEAD", "--after", "HEAD"]]
]) {
    test(`${script} defaults to the tracked native capture without XML composition`, () => {
        const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts", script), ...args, "--seconds", "0.1", "--json"],
            { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        for (const run of report.before ? [report.before, report.after] : [report]) {
            assert.equal(run.meta.treeSource, "captured");
            assert.equal(run.meta.captureFidelity.timestampUtc, "2026-10-03T11:46:57.838Z");
            assert.equal(run.meta.captureFidelity.classCoverage, "Debugger-rendered");
            assert.deepEqual(run.callbackErrors, []);
        }
    });
}

test("profiler rejects obsolete tree-shaping options instead of silently ignoring them", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/profile_hud.js"), "--players", "12", "--seconds", "0.1"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown option: --players/i);
});

for (const args of [["--seconds"], ["--healthbar", "oops"], ["--healthbar", "Infinity"], ["--top", "oops"]]) {
    test(`profiler refuses malformed measurement options: ${args.join(" ")}`, () => {
        const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/profile_hud.js"),
            ...(args.includes("--seconds") ? [] : ["--seconds", "0.01"]), ...args, "--json"],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 2, "invalid input must not silently select a different measurement scenario");
        assert.match(result.stderr, /FATAL/);
    });
}

const fixture = () => ({ domTree: { id: "CitadelHudRoot", children: [
    { id: "Hud", classes: ["connectedToGame", "joined_team"], children: [
        { id: "gameplay_hud", children: [] },
        { id: "hudActivePlayerStats", children: [] },
    ] },
] } });

test("production native owner normalization/readback stays visible without counting setter comparisons", () => {
    const h = createProfiledHud({ capturedTree: fixture(), warmupMs: 0 });
    const panel = h.doc.root;
    panel.style = new Proxy(panel.style, { set(target, key, value) { target[key] = String(value).toUpperCase(); return true; } });
    const owner = h.sandbox.global.QOL.core.panel.createNativeStyleOwner();
    assert.equal(owner.apply(panel, { color: "#abcdef" }), true);
    const stable = counted(() => counters.around("owner", () => owner.apply(panel, { color: "#abcdef" })));
    assert.equal(stable.total.styleReads, 1, "required native validation is counted exactly once");
    assert.equal(stable.total.styleWritesChanged + stable.total.styleWritesRedundant, 0);
    panel.style.color = "#000000";
    const feedback = counted(() => counters.around("owner", () => owner.apply(panel, { color: "#abcdef" })));
    assert.equal(feedback.total.styleReads, 2, "validation plus normalized readback after repair");
    assert.equal(feedback.total.styleWritesChanged, 1);
    assert.equal(panel.style.color, "#ABCDEF");
    assert.deepEqual(h.clock.errors, []);
});

test("profile retains recovered managed callback failures and does not call read-only callbacks useless", () => {
    const h = createProfiledHud({ capturedTree: fixture(), warmupMs: 0 });
    h.sandbox.eval(`
        Math.random = () => 0;
        globalThis.probeTicks = 0;
        QOL.core.Scheduler.createPollLoop(() => {
            probeTicks++;
            $.GetContextPanel().BHasClass("probe");
            if (probeTicks === 1) throw Error("recovered probe failure");
        }, 0.01, "probe");
    `);
    h.clock.advance(25);
    const result = collectProfile(h, 0.02);
    const row = result.snapshot.rows.find(r => r.label === "mf:probe");
    assert.equal(row.calls, 2);
    assert.equal(row.classReads, 2);
    assert.equal(row.styleWritesChanged + row.styleWritesRedundant, 0);
    assert.equal(result.snapshot.scheduledCallbacks >= row.calls, true);
    assert.deepEqual(result.callbackErrors, [], "production Scheduler catches the throw");
    assert.equal(result.meta.wrapperErrors.count, 1, "warm-up failure survives subsequent successful ticks");
    assert.equal(result.meta.wrapperErrors.events[0].label, "mf:probe");
    assert.ok(result.validity.issues.some(issue => issue.includes("callback failures")));
    assert.ok(comparisonIssues(result, result).some(issue => issue.includes("wrapped callback failures")), "ref comparator shares the recovered-error refusal");
    assert.ok(result.investigations.repeatedReads.some(r => r.label === "mf:probe" && r.count === 2));
    const text = report(result.snapshot, result.meta, h.tree, { top: 20 });
    assert.match(text, /not redundant reads or native cost/);
    assert.doesNotMatch(text, /\(waste\)|no visual change|useless|no-op callback/);
    assert.match(result.meta.sourceCoverage.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(result.meta.sourceCoverage.scripts.some(file => file.endsWith("ql_app.js")));
    assert.throws(() => h.measure(0), /positive and finite/);
});

test("profile exposes owner disable during the sample instead of a silent lower-work result", () => {
    const h = createProfiledHud({ capturedTree: fixture(), warmupMs: 8000 });
    h.clock.schedule(0.01, () => h.sandbox.eval("QOL.core.FeatureRegistry.shutdown()"));
    const result = collectProfile(h, 0.02);
    assert.ok(result.enabledStart.length > 0);
    assert.equal(result.enabledEnd.length, 0);
    assert.ok(result.validity.issues.some(issue => issue.includes("coverage changed")));
});

test("lookup trace rejects changed enabled coverage even when no callback throws", () => {
    const h = createProfiledHud({ capturedTree: fixture(), warmupMs: 8000 });
    h.clock.schedule(0.01, () => h.sandbox.eval("QOL.core.FeatureRegistry.shutdown()"));
    const result = collectTrace(h, { seconds: 0.02 });
    assert.ok(result.enabledStart.length > 0);
    assert.equal(result.enabledEnd.length, 0);
    assert.deepEqual(result.callbackErrors, []);
    assert.ok(result.validity?.issues.some(issue => issue.includes("coverage changed")),
        "stopped owners must not look like an error-free reduction in lookup work");
});

test("lookup trace retains swallowed panel-event failures as invalid evidence", () => {
    const h = createProfiledHud({ capturedTree: fixture(), warmupMs: 8000 });
    h.doc.root.SetPanelEvent("onactivate", () => { throw Error("injected event failure"); });
    h.clock.schedule(0.01, () => h.doc.root.activate());
    const result = collectTrace(h, { seconds: 0.02 });
    assert.deepEqual(result.callbackErrors, [], "the model catches panel-event exceptions");
    assert.ok(result.eventErrors?.some(error => error.message === "injected event failure"));
    assert.ok(result.validity?.issues.some(issue => issue.includes("callback failures")));
});

test("lookup trace CLI exits unsuccessfully when startup changes enabled coverage", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/trace_feature_hud.js"),
        "--warmup", "0", "--seconds", "0.5", "--json"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 1, result.stderr);
    const trace = JSON.parse(result.stdout);
    assert.notDeepEqual(trace.enabledStart, trace.enabledEnd);
    assert.ok(trace.validity.issues.some(issue => issue.includes("coverage changed")));
});

test("lookup observers obey the measurement gate and direct searches stop on first hit", () => {
    const doc = new Document(new Clock());
    const first = doc.root.addChild(doc.create("Panel", { id: "first", classes: ["target"] }));
    doc.root.addChild(doc.create("Panel", { id: "second" }));
    const events = [];
    const hooks = ["onTraverse", "onClassTraverse", "onFindChild"];
    const previous = hooks.map(key => counters[key]);
    try {
        hooks.forEach(key => { counters[key] = e => events.push(e); });
        counters.reset();
        counters.enabled = false;
        doc.root.FindChild("first");
        doc.root.FindChildTraverse("first");
        doc.root.FindChildrenWithClassTraverse("target");
        assert.equal(events.length, 0, "warm-up must not emit measured events");
        counters.enabled = true;
        assert.equal(doc.root.FindChild("first"), first);
        doc.root.FindChild("absent");
        doc.root.FindChildTraverse("first");
        doc.root.FindChildrenWithClassTraverse("target");
        silently(() => doc.root.FindChildTraverse("absent"));
        assert.deepEqual(events.map(e => e.visited), [1, 2, 1, 2]);
        const total = counters.snapshot(1).total;
        assert.equal(total.traverseNodes + total.classTraverseNodes, 6);
        assert.equal(total.traverseMisses, 1, "direct misses must also be recorded");
    } finally {
        counters.enabled = false;
        hooks.forEach((key, i) => { counters[key] = previous[i]; });
    }
});

test("captured window counts both roots and preserves sibling order, duplicate IDs and supplied state", () => {
    const doc = new Document(new Clock());
    const capture = { summary: { totalPanels: 5 }, domTree: { id: "CitadelHudRoot", children: [
        { id: "duplicate", type: "Label", text: "before", visible: false, enabled: false },
        { id: "Hud", type: "CitadelHud", classes: ["connectedToHeroTesting"], children: [
            { id: "duplicate", type: "Label", text: "inside", attributes: { value: "42" } },
        ] },
        { id: "after", type: "Label" },
    ] } };
    const tree = buildCapturedHud(doc, capture);
    assert.equal(tree.panels, 5);
    assert.deepEqual(doc.absRoot.Children().map(p => p.id), ["duplicate", "Hud", "after"]);
    assert.equal(doc.absRoot.FindChildTraverse("duplicate").text, "before");
    assert.equal(doc.absRoot.Children()[0].visible, false);
    assert.equal(doc.absRoot.Children()[0].enabled, false);
    assert.equal(doc.root.type, "CitadelHud");
    assert.equal(doc.root.FindChild("duplicate").GetAttributeString("value"), "42");
    assert.ok(tree.notes.some(n => n.includes("1 captured Labels/TextEntries lack text")));
});

test("aggregate and window captures without a Hud context cannot silently become a HUD", () => {
    const doc = new Document(new Clock());
    assert.throws(() => buildCapturedHud(doc, { kind: "summary", panels: 10000 }), /full per-panel/);
    assert.throws(() => buildCapturedHud(doc, { domTree: { id: "CitadelHudRoot", children: [] } }), /no direct Hud/);
});

test("defaults plus overrides do not silently expand unrelated feature toggles", () => {
    const sandbox = { evalJson: () => ({ ENABLE_A: 0, ENABLE_B: 0, DISABLE_C: 1, MODE: 2 }) };
    assert.deepEqual(makeMaximalConfig(sandbox, { MODE: 3 }, false),
        { ENABLE_A: 0, ENABLE_B: 0, DISABLE_C: 1, MODE: 3 });
    assert.equal(makeMaximalConfig(sandbox).ENABLE_A, 1);
    assert.equal(makeMaximalConfig(sandbox).DISABLE_C, 1);
});

test("production crosshair trace excludes warm-up and agrees with independent operation counters", () => {
    const hud = createProfiledHud({ capturedTree: fixture(), warmupMs: 8000 });
    const short = collectTrace(hud, { seconds: 0.2, feature: "ql_crosshair_stats" });
    const long = collectTrace(hud, { seconds: 2, feature: "ql_crosshair_stats" });
    for (const result of [short, long]) {
        assert.deepEqual(result.callbackErrors, []);
        assert.equal(result.features.length, 1);
        for (const target of ["damageAmpContainer", "bulletEvasionContainer"]) {
            const searches = result.events.filter(e => e.target === target);
            if (result.seconds >= 0.8) assert.ok(searches.length > 0);
            assert.ok(searches.filter(e => e.type === "FindChild").length <= Math.ceil(result.seconds / 0.8),
                "missing rows must only be rediscovered at the requested cadence");
            assert.ok(searches.filter(e => e.type === "FindChildTraverse").length <= Math.ceil(result.seconds / 0.8),
                "compatibility searches share the discovery cadence");
        }
        assert.ok(result.events.every(e => e.t >= 0 && e.t <= result.seconds));
        const row = result.snapshot.rows.find(r => r.label === "mf:ql_crosshair_stats");
        assert.equal(result.features[0].calls, row.traverseCalls + row.classTraverseCalls);
        assert.equal(result.features[0].visits, row.traverseNodes + row.classTraverseNodes);
    }
    const all = collectTrace(hud, { seconds: 0.123 });
    assert.ok(Math.abs(all.seconds - 0.123) < 1e-9, "sample must not round up to a 50ms boundary");
    assert.equal(all.events.reduce((n, e) => n + e.visited, 0),
        all.snapshot.total.traverseNodes + all.snapshot.total.classTraverseNodes);
    assert.equal(all.events.length, all.snapshot.total.traverseCalls + all.snapshot.total.classTraverseCalls);
    assert.equal(counters.onTraverse, undefined, "observer hooks must be restored");
});

test("trace reports callback failures and timestamps at callback execution", () => {
    const hud = createProfiledHud({ capturedTree: fixture(), warmupMs: 8000 });
    hud.clock.schedule(0.037, () => {
        counters.around("probe", () => hud.doc.root.FindChild("absent"));
        throw new Error("injected failure");
    });
    const result = collectTrace(hud, { seconds: 0.08, feature: "probe" });
    assert.equal(result.events.length, 1);
    assert.ok(Math.abs(result.events[0].t - 0.037) < 1e-9);
    assert.equal(result.callbackErrors[0].message, "injected failure");
});

test("CLI emits parseable JSON even with a feature and verbose, without a local capture dependency", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qollock-trace-"));
    t.after(() => {
        fs.unlinkSync(path.join(dir, "tree.json"));
        fs.rmdirSync(dir);
    });
    const capturePath = path.join(dir, "tree.json");
    fs.writeFileSync(capturePath, JSON.stringify(fixture()));
    const cli = spawnSync(process.execPath, ["scripts/trace_feature_hud.js", "ql_crosshair_stats",
        "--capture", capturePath, "--seconds", "2", "--json", "--verbose", "--events"],
    // Opt-in event traces repeat full native breadcrumbs; scoped resolvers add
    // direct-child events alongside whole-tree searches. Preserve all events.
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    assert.equal(cli.error, undefined, cli.error && cli.error.message);
    assert.equal(cli.status, 0, cli.stderr);
    const result = JSON.parse(cli.stdout);
    assert.ok(result.features[0].missedTargets.damageAmpContainer >= 1);
    assert.ok(result.events.length > 0);
    assert.match(result.scope, /no native timings or FPS/);
});

test("label selection is exact and invalid sampling arguments fail explicitly", () => {
    assert.equal(matchesLabel("mf:ql_items", "ql_items"), true);
    assert.equal(matchesLabel("mf:ql_items_extra", "ql_items"), false);
    for (const args of [["--seconds", "0"], ["--seconds", "Infinity"], ["--seconds"],
        ["--capture"], ["--warmup", "-1"], ["--unknown"]]) {
        assert.throws(() => parseArgs(args));
    }
    assert.equal(parseArgs(["--defaults", "--enable", "HEALTHBAR_TYPE=5"]).enableAll, false);
});
