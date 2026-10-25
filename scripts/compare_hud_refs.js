// Compare complete HUD script sets without checking out, stashing or building.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const layout = require("./simulator/layout.js");
const { createProfiledHud } = require("./simulator/perf/profile.js");
const { inspectCapture, comparisonIssues } = require("./capture_tree.js");

function runtimeAt(ref) {
    const git = args => execFileSync("git", args, { cwd: layout.REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const working = ref === "working-tree";
    const commit = git(["rev-parse", "--verify", "--end-of-options", `${working ? "HEAD" : ref}^{commit}`]).trim();
    const read = relative => working ? fs.readFileSync(path.join(layout.REPO_ROOT, relative), "utf8") : git(["show", `${commit}:${relative}`]);
    const xml = read("panorama/layout/hud.xml");
    const sources = layout.parseLayoutScriptSource(xml, `${commit}:panorama/layout/hud.xml`, () => true);
    const hash = crypto.createHash("sha256").update(xml);
    for (const script of sources.scripts) {
        const relative = path.relative(layout.REPO_ROOT, script.absPath).split(path.sep).join("/");
        script.source = read(relative); // Missing objects fail; never mix revisions.
        hash.update(relative).update(script.source);
    }
    return { sources, identity: { ref, commit, workingTree: working, sourceFingerprint: hash.digest("hex"), scripts: sources.scripts.length } };
}

function readObservation(hud, expression) {
    try {
        const raw = hud.sandbox.eval(`JSON.stringify((${expression}), (key, value) => {
            if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
                || typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value))
                throw Error('Observation must contain finite JSON values');
            return value;
        })`);
        if (typeof raw !== "string" || raw.length > 65536) throw Error("Observation exceeds JSON bounds");
        return { value: JSON.parse(raw) };
    } catch (error) {
        return { error: String(error.message || error).slice(0, 500) };
    }
}

function measure(hud, seconds, identity, observation) {
    if (observation !== undefined && (typeof observation !== "string" || !observation.trim() || observation.length > 16384)) {
        throw Error("Observation must be a nonempty expression of at most 16384 characters");
    }
    const state = () => hud.sandbox.evalJson("({enabled:QOL.core.FeatureRegistry.getEnabledIds(),errors:QOL.core.FeatureRegistry.getErrorCounts()})");
    const start = state();
    const observedStart = observation === undefined ? undefined : readObservation(hud, observation);
    const snapshot = hud.measure(seconds * 1000);
    const observedEnd = observation === undefined ? undefined : readObservation(hud, observation);
    const end = state();
    return {
        source: identity, meta: hud.meta, tree: { panels: hud.tree.panels, notes: hud.tree.notes }, snapshot,
        enabledStart: start.enabled, enabledEnd: end.enabled,
        registryErrorsStart: start.errors, registryErrorsEnd: end.errors,
        eventErrors: hud.doc.eventErrors.map(e => ({ panel: e.panel, name: e.name, message: e.error.message })),
        callbackErrors: hud.clock.errors.map(e => ({ atMs: e.at, message: e.error.message })),
        ...(observation === undefined ? {} : { observation: { expression: observation, start: observedStart, end: observedEnd } })
    };
}

function assess(before, after) {
    const issues = comparisonIssues(after, before).filter(issue => issue !== "different enabled feature coverage");
    if (before.snapshot.seconds !== after.snapshot.seconds) issues.push("different sample duration");
    for (const run of [before, after]) {
        if (!run.meta.wrappedScheduler) issues.push("missing Scheduler attribution");
        if (Object.values(run.registryErrorsStart || {}).some(n => n > 0)) issues.push("warm-up registry errors");
        if (!Number.isFinite(run.snapshot.seconds) || run.snapshot.seconds <= 0) issues.push("invalid sample duration");
    }
    const coverage = {
        removed: before.enabledEnd.filter(id => !after.enabledEnd.includes(id)),
        added: after.enabledEnd.filter(id => !before.enabledEnd.includes(id))
    };
    const metrics = {
        nodes: t => t.traverseNodes + t.classTraverseNodes,
        lookups: t => t.traverseCalls + t.classTraverseCalls,
        changedStyles: t => t.styleWritesChanged,
        redundantStyles: t => t.styleWritesRedundant,
        attributeReadBytes: t => t.attrReadBytes
    };
    for (const run of [before, after]) for (const metric of Object.values(metrics)) {
        if (!Number.isFinite(metric(run.snapshot.total)) || metric(run.snapshot.total) < 0) issues.push("invalid operation counters");
    }
    const sameOwners = (a, b) => Array.isArray(a) && Array.isArray(b)
        && isDeepStrictEqual([...a].sort(), [...b].sort());
    const sameCoverage = sameOwners(before.enabledStart, after.enabledStart) && sameOwners(before.enabledEnd, after.enabledEnd);
    let observationStatus = "not-checked";
    if (before.observation || after.observation) {
        const a = before.observation, b = after.observation;
        if (!a || !b || a.expression !== b.expression) observationStatus = "incomparable";
        else if ([a.start, a.end, b.start, b.end].some(value => !value || value.error || !("value" in value))) observationStatus = "failed";
        else observationStatus = isDeepStrictEqual(a.start.value, b.start.value) && isDeepStrictEqual(a.end.value, b.end.value) ? "match" : "different";
    }
    const validInputs = !issues.length;
    // Matching selected observations is intentionally weaker than proving all
    // behavior equivalent. Counts alone cannot establish a correct improvement.
    const comparable = validInputs && sameCoverage && observationStatus === "match";
    const rate = (run, metric) => metric(run.snapshot.total) / run.snapshot.seconds;
    const rates = Object.fromEntries(Object.entries(metrics).map(([key, metric]) => {
        const a = rate(before, metric), b = rate(after, metric);
        return [key, { before: a, after: b, changePercent: comparable && a ? 100 * (b / a - 1) : null }];
    }));
    return { validInputs, issues: [...new Set(issues)], coverage, sameCoverage, observationStatus, comparable, rates };
}

function compare({ beforeRef = "main", afterRef = "working-tree", seconds = 20, warmupMs = 8000, capturedTree = null, enableAll = false, configOverrides = {}, observation } = {}) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--seconds must be positive");
    if (!Number.isFinite(warmupMs) || warmupMs < 0) throw new Error("--warmup-ms must be nonnegative");
    if (capturedTree) inspectCapture(capturedTree, { requireHud: true });
    const beforeRuntime = runtimeAt(beforeRef), afterRuntime = runtimeAt(afterRef);
    const opts = { capturedTree, warmupMs, enableAll, configOverrides: { HEALTHBAR_TYPE: 0, ...configOverrides } };
    const first = createProfiledHud({ ...opts, runtimeSources: beforeRuntime.sources });
    const before = measure(first, seconds, beforeRuntime.identity, observation);
    // The baseline's complete input is published unchanged in both runtimes.
    const second = createProfiledHud({ ...opts, runtimeSources: afterRuntime.sources, configInput: first.inputConfig });
    const after = measure(second, seconds, afterRuntime.identity, observation);
    return { comparison: assess(before, after), before, after };
}

function main() {
    const args = process.argv.slice(2);
    const arg = (key, fallback) => {
        const index = args.indexOf("--" + key);
        if (index < 0) return fallback;
        if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`--${key} needs a value`);
        return args[index + 1];
    };
    const treePath = arg("tree", null);
    const configOverrides = { HEALTHBAR_TYPE: Number(arg("healthbar", 0)) };
    for (const item of arg("enable", "").split(",").filter(Boolean)) {
        const [key, value = "1"] = item.split("=");
        const n = Number(value);
        configOverrides[key.trim()] = Number.isNaN(n) ? value : n;
    }
    const result = compare({
        beforeRef: arg("before", "main"), afterRef: arg("after", "working-tree"),
        seconds: Number(arg("seconds", 20)), warmupMs: Number(arg("warmup-ms", 8000)), enableAll: args.includes("--expanded"), configOverrides,
        capturedTree: treePath ? JSON.parse(fs.readFileSync(treePath, "utf8")) : null,
        observation: arg("observe", undefined)
    });
    const output = arg("output", null);
    if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    if (args.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else {
        console.log("OFFLINE HUD REF COMPARISON (operations; no native timings or FPS)");
        for (const key of ["before", "after"]) console.log(`${key}: ${result[key].source.ref} ${result[key].source.commit}; ${result[key].source.scripts} scripts`);
        console.log(`same input checks: ${result.comparison.validInputs ? "PASS" : result.comparison.issues.join("; ")}`);
        console.log(`enabled coverage: ${JSON.stringify(result.comparison.coverage)} (changed owners do not establish equivalent behavior)`);
        console.log(`selected observations: ${result.comparison.observationStatus}; same enabled coverage: ${result.comparison.sameCoverage}`);
        if (!result.comparison.comparable) console.log("DIAGNOSTIC COUNTS ONLY: percentages withheld. Use --observe with a read-only JSON expression selecting the feature's output. Matching observations do not prove full behavior or native performance.");
        for (const [key, rate] of Object.entries(result.comparison.rates)) console.log(`${key}/s: ${rate.before.toFixed(2)} -> ${rate.after.toFixed(2)} (${rate.changePercent === null ? "percentage unavailable" : rate.changePercent.toFixed(2) + "%"})`);
    }
    if (!result.comparison.validInputs || !result.comparison.sameCoverage || !["not-checked", "match"].includes(result.comparison.observationStatus)) process.exitCode = 2;
}

if (require.main === module) {
    try { main(); } catch (err) { process.stderr.write(`[compare] ${err.message}\n`); process.exitCode = 2; }
}
module.exports = { runtimeAt, measure, assess, compare };
