"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { parseLayoutScriptSource } = require("../scripts/simulator/layout");
const { Sandbox } = require("../scripts/simulator/sandbox");
const { createProfiledHud } = require("../scripts/simulator/perf/profile");
const { assess, measure } = require("../scripts/compare_hud_refs");

test("historical layout selects its own ordered includes and reports missing sources", () => {
    const xml = '<root>\n<styles><include src="s2r://panorama/scripts/style.vjs_c"/></styles>\n<scripts>\n<!-- <include src="s2r://panorama/scripts/retired.vjs_c"/> -->\n<include src="s2r://panorama/scripts/old.vjs_c"/>\n<include src="s2r://panorama/scripts/new.vjs_c"/>\n</scripts></root>';
    const result = parseLayoutScriptSource(xml, "historical.xml", file => path.basename(file) === "old.js");
    assert.deepEqual(result.scripts.map(s => [path.basename(s.absPath), s.line]), [["old.js", 5], ["new.js", 6]]);
    assert.equal(result.missing[0].absPath, result.scripts[1].absPath);
});

test("historical source executes in the sandbox without reading a checkout file", () => {
    const sandbox = new Sandbox();
    assert.equal(sandbox.loadSource("globalThis.historical = 7", "missing/historical.js"), true);
    assert.equal(sandbox.eval("historical"), 7);
    assert.equal(sandbox.loadSource("throw Error('historical failure')", "old.js"), false);
    assert.equal(sandbox.loadErrors[0].phase, "run");
    assert.equal(sandbox.loadErrors[0].file, "old.js");
});

test("both runtime sources receive the same complete config on a fixed captured tree", () => {
    const capturedTree = { domTree: { id: "CitadelHudRoot", children: [{ id: "Hud", type: "CitadelHud" }] } };
    const runtimeSources = { missing: [], scripts: [{ absPath: "fixture.js", source: "globalThis.QOL={buildDefaultConfig:()=>({HEALTHBAR_TYPE:2,BASE:1})};" }] };
    const first = createProfiledHud({ capturedTree, runtimeSources, warmupMs: 0, enableAll: false, configOverrides: { BASE: 8 } });
    const otherSources = { missing: [], scripts: [{ absPath: "fixture.js", source: "globalThis.QOL={buildDefaultConfig:()=>({HEALTHBAR_TYPE:5,BASE:99})};" }] };
    const second = createProfiledHud({ capturedTree, runtimeSources: otherSources, warmupMs: 0, enableAll: false, configInput: first.inputConfig });
    assert.equal(second.meta.configApplied, true);
    assert.equal(second.meta.healthbarType, 2);
    assert.equal(first.meta.configFingerprint, second.meta.configFingerprint);
    assert.equal(first.meta.treeFingerprint, second.meta.treeFingerprint);
    assert.equal(first.doc.root.GetAttributeString("Deadlock_Mod_Settings_v1", ""), second.doc.root.GetAttributeString("Deadlock_Mod_Settings_v1", ""));
});

function run() {
    return {
        meta: { modelFingerprint: "model", treeSource: "captured", treeFingerprint: "tree", configMode: "defaults", configFingerprint: "cfg", warmupMs: 8000, wrappedScheduler: true, captureFidelity: { fingerprint: "capture" } },
        enabledStart: ["oldOwner"], enabledEnd: ["oldOwner"], callbackErrors: [], registryErrorsStart: {}, registryErrorsEnd: {},
        snapshot: { seconds: 20, total: { costUnits: 20, traverseNodes: 100, classTraverseNodes: 20, traverseCalls: 5, classTraverseCalls: 1, styleWritesChanged: 2, styleWritesRedundant: 3, attrReadBytes: 80 } }
    };
}
test("ref comparisons expose owner coverage changes and reject unequal inputs or hidden failures", () => {
    const before = run(), after = run();
    after.enabledStart = after.enabledEnd = ["newOwner"];
    const result = assess(before, after);
    assert.equal(result.validInputs, true);
    assert.deepEqual(result.coverage, { removed: ["oldOwner"], added: ["newOwner"] });
    assert.equal(result.rates.nodes.after, 6);
    after.meta.treeFingerprint = "other";
    after.meta.configFingerprint = "other";
    after.snapshot.seconds = 10;
    after.registryErrorsStart = { newOwner: 1 };
    after.callbackErrors = [{ message: "failure" }];
    const broken = assess(before, after);
    assert.equal(broken.validInputs, false);
    for (const fragment of ["treeFingerprint", "configFingerprint", "sample", "warm-up", "callback"]) assert.ok(broken.issues.some(s => s.includes(fragment)), fragment);
});

test("matching end states cannot validate two runs that both lost enabled owners", () => {
    const before = run(), after = run();
    for (const result of [before, after]) {
        result.enabledStart = ["oldOwner"];
        result.enabledEnd = [];
    }
    const result = assess(before, after);
    assert.equal(result.validInputs, false, "each run must keep its own enabled coverage stable");
    assert.ok(result.issues.some(issue => issue.includes("coverage changed")));
});

test("ref measurement rejects swallowed panel-event failures", () => {
    const capturedTree = { domTree: { id: "CitadelHudRoot", children: [{ id: "Hud", type: "CitadelHud" }] } };
    const hud = createProfiledHud({ capturedTree, warmupMs: 8000, enableAll: false });
    hud.doc.root.SetPanelEvent("onactivate", () => { throw Error("rejected ref event"); });
    hud.clock.schedule(0.001, () => hud.doc.root.activate());
    const result = measure(hud, 0.01, { ref: "fixture" });
    assert.deepEqual(result.callbackErrors, [], "panel event errors are caught before the clock sees them");
    assert.ok(result.eventErrors?.some(error => error.message === "rejected ref event"));
    const comparison = assess(result, result);
    assert.equal(comparison.validInputs, false);
    assert.ok(comparison.issues.some(issue => issue.includes("callback/registry errors")));
});

function observedRun(value = { text: "ready", visible: true }) {
    return { ...run(), observation: { expression: "output", start: { value }, end: { value } } };
}

test("percentages require matching selected output and stable owner coverage", () => {
    const before = observedRun(), after = observedRun();
    after.snapshot.total.traverseNodes = 40;
    assert.equal(assess(before, after).comparable, true);
    assert.equal(assess(before, after).rates.nodes.changePercent, -50);
    delete after.observation;
    assert.equal(assess(before, after).observationStatus, "incomparable");
    delete before.observation;
    assert.equal(assess(before, after).observationStatus, "not-checked");
    assert.equal(assess(before, after).rates.nodes.changePercent, null);
    before.observation = observedRun().observation;
    after.observation = observedRun().observation;
    after.enabledStart = after.enabledEnd = ["otherOwner"];
    assert.equal(assess(before, after).sameCoverage, false);
    assert.equal(assess(before, after).rates.nodes.changePercent, null);
});

test("changed, failed or differently selected output cannot yield improvement percentages", () => {
    for (const [observation, status] of [
        [{ ...observedRun().observation, start: { value: { text: "wrong", visible: true } } }, "different"],
        [{ ...observedRun().observation, end: { value: null } }, "different"],
        [{ ...observedRun().observation, end: { error: "missing source" } }, "failed"],
        [{ ...observedRun().observation, end: {} }, "failed"],
        [{ ...observedRun().observation, expression: "otherOutput" }, "incomparable"]
    ]) {
        const after = observedRun(); after.observation = observation;
        const result = assess(observedRun(), after);
        assert.equal(result.observationStatus, status);
        assert.equal(result.comparable, false);
        assert.equal(result.rates.nodes.changePercent, null);
    }
});

test("zero operations are valid but malformed counters and durations are not comparable", () => {
    const before = observedRun(), after = observedRun();
    for (const key of Object.keys(after.snapshot.total)) after.snapshot.total[key] = 0;
    assert.equal(assess(before, after).validInputs, true);
    assert.equal(assess(before, after).rates.nodes.changePercent, -100);
    for (const invalid of [NaN, Infinity, -1, undefined]) {
        after.snapshot.total.attrReadBytes = invalid;
        assert.equal(assess(before, after).validInputs, false);
        assert.equal(assess(before, after).rates.nodes.changePercent, null);
    }
    after.snapshot.total.attrReadBytes = 0;
    for (const invalid of [0, -1, NaN, Infinity]) {
        before.snapshot.seconds = after.snapshot.seconds = invalid;
        assert.equal(assess(before, after).validInputs, false);
    }
});

test("observations sample production output at both boundaries and reject invalid JSON values", () => {
    const capturedTree = { domTree: { id: "CitadelHudRoot", children: [{ id: "Hud", type: "CitadelHud" }] } };
    const hud = createProfiledHud({ capturedTree, warmupMs: 8000, enableAll: false });
    hud.doc.root.text = "before";
    hud.clock.schedule(0.001, () => { hud.doc.root.text = "after"; });
    const result = measure(hud, 0.01, { ref: "fixture" }, "({text: $.GetContextPanel().text})");
    assert.deepEqual(result.observation.start, { value: { text: "before" } });
    assert.deepEqual(result.observation.end, { value: { text: "after" } });
    assert.equal(assess(result, result).observationStatus, "match");
    for (const expression of ["undefined", "({bad: NaN})", "({bad: () => 1})", "missingOutput", "'x'.repeat(65537)"]) {
        const rejected = measure(hud, 0.01, {}, expression);
        assert.ok(rejected.observation.start.error, expression);
        assert.equal(assess(rejected, rejected).observationStatus, "failed");
    }
    for (const expression of ["", " ", 42, "x".repeat(16385)]) {
        assert.throws(() => measure(hud, 0.01, {}, expression), /Observation/);
    }
});
