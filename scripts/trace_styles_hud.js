// Offline inline-style mutation trace; no CSS cascade, rendering or native cost.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createProfiledHud } = require("./simulator/perf/profile.js");
const { collectProfile } = require("./profile_hud.js");
const { matchesLabel } = require("./trace_feature_hud.js");

const DETAIL_LIMIT = 2048;
const EVENT_LIMIT = 10000;

function parseArgs(args = process.argv.slice(2)) {
    const opts = { seconds: 10, warmupMs: 8000, feature: null, enableAll: true,
        configOverrides: {}, includeEvents: false, json: false,
        capturePath: path.join(__dirname, "..", "captures", "deadlock_hud_dump.json") };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const value = () => {
            const next = args[++i];
            if (!next || next.startsWith("--")) throw new Error(`missing value for ${arg}`);
            return next;
        };
        if (arg === "--json") opts.json = true;
        else if (arg === "--events") opts.includeEvents = true;
        else if (arg === "--defaults") opts.enableAll = false;
        else if (arg === "--capture") opts.capturePath = value();
        else if (arg === "--seconds") opts.seconds = Number(value());
        else if (arg === "--warmup") opts.warmupMs = Number(value()) * 1000;
        else if (arg === "--enable") {
            for (const spec of value().split(",")) {
                const [key, raw = "1", extra] = spec.split("=");
                const n = Number(raw);
                if (!key || !raw || extra !== undefined || !Number.isFinite(n)) throw new Error(`invalid override: ${spec}`);
                opts.configOverrides[key] = n;
            }
        } else if (!arg.startsWith("-") && !opts.feature) opts.feature = arg;
        else throw new Error(`unknown argument: ${arg}`);
    }
    if (!Number.isFinite(opts.seconds) || opts.seconds <= 0 || opts.seconds > 120) throw new Error("--seconds must be greater than 0 and at most 120");
    if (!Number.isFinite(opts.warmupMs) || opts.warmupMs < 0 || opts.warmupMs > 120000) throw new Error("--warmup must be between 0 and 120 seconds");
    return opts;
}

function collectStyleTrace(hud, { seconds, feature = null, includeEvents = false,
    detailLimit = DETAIL_LIMIT, eventLimit = EVENT_LIMIT }) {
    for (const limit of [detailLimit, eventLimit]) {
        if (!Number.isInteger(limit) || limit < 0) throw new Error("trace retention limits must be non-negative integers");
    }
    const startMs = hud.clock.now();
    const details = new Map(), events = [];
    const totals = { attempts: 0, completed: 0, changed: 0, identical: 0, failed: 0, deletes: 0 };
    let omittedDetailEvents = 0, omittedEvents = 0, observerErrors = 0;
    const observerErrorMessages = [];
    const mutationFailures = { count: 0, events: [] };
    const previous = hud.counters.onStyleWrite;
    hud.counters.onStyleWrite = event => {
        if (event.outcome === "threw") {
            mutationFailures.count++;
            if (mutationFailures.events.length < 20) mutationFailures.events.push({
                t: (hud.clock.now() - startMs) / 1000, owner: event.label,
                panelUid: event.panel._uid, property: event.property, error: event.error,
            });
        }
        if (!matchesLabel(event.label, feature)) return;
        totals.attempts++;
        const failed = event.outcome === "threw";
        if (failed) totals.failed++;
        else {
            totals.completed++;
            totals[event.changed ? "changed" : "identical"]++;
        }
        if (event.operation === "delete") totals.deletes++;
        try {
            const key = JSON.stringify([event.label, event.panel._uid, event.property]);
            let row = details.get(key);
            if (!row && details.size < detailLimit) {
                row = { owner: event.label, panelUid: event.panel._uid, panelId: event.panel.id,
                    panelType: event.panel.type, property: event.property,
                    breadcrumbs: event.panel.getBreadcrumbs(), attempts: 0,
                    completed: 0, changed: 0, identical: 0, failed: 0, deletes: 0 };
                details.set(key, row);
            }
            const t = (hud.clock.now() - startMs) / 1000;
            if (row) {
                if (!row.attempts) row.firstSec = t;
                row.lastSec = t;
                row.attempts++;
                if (failed) row.failed++;
                else { row.completed++; row[event.changed ? "changed" : "identical"]++; }
                if (event.operation === "delete") row.deletes++;
            } else omittedDetailEvents++;
            if (includeEvents && events.length < eventLimit) events.push({
                t, owner: event.label, panelUid: event.panel._uid, panelId: event.panel.id,
                property: event.property, operation: event.operation,
                previousValue: event.previousValue === undefined ? null : String(event.previousValue),
                previousUndefined: event.previousValue === undefined,
                requestedValue: event.requestedValue,
                modelValueChanged: event.changed, outcome: event.outcome, error: event.error,
            });
            else omittedEvents++;
        } catch (error) {
            // Keep diagnostic failures separate from production callback failures,
            // which may be caught inside the mod. Never let an observer disable it.
            observerErrors++;
            if (observerErrorMessages.length < 10) observerErrorMessages.push(String(error.message || error));
        }
    };
    let profile;
    try { profile = collectProfile(hud, seconds); }
    finally { hud.counters.onStyleWrite = previous; }
    if (mutationFailures.count) profile.validity.issues.push("modeled style mutations threw (including errors caught inside production)");
    if (observerErrors) profile.validity.issues.push("style trace observer failures; details are incomplete");
    return {
        ...profile,
        scope: "Offline inline-style mutation requests; no CSS cascade, layout, native timings or FPS. Identical values and multiple writers do not prove unnecessary work or a conflict.",
        selection: "Exact owner label filter for style totals/details; other enabled features run. Profile snapshot, validity and mutation failure history cover all owners.",
        coverage: {
            window: "Style observation excludes script loading and warm-up; general callback failure history still includes warm-up. A static hierarchy supplies no native style/animation updates.",
            operations: "Instrumented panel.style property assignments/deletes reaching modeled mutation after value serialization/comparison; ClearPropertyFromCode only via its modeled deletes. Completed means the modeled mutation returned without throwing, not native acceptance or readback equality.",
            identity: "panelUid is replay-local object identity, retained across moves; replacements receive a new UID. Breadcrumbs describe the first retained write, not a native ownership contract.",
            unavailable: ["CSS/class-driven changes, computed styles, animations, normalization and native feedback", "replacing the whole style object and calls bypassing the style proxy", "failures before the mutation hook and exceptions caught elsewhere inside production", "other JavaScript contexts and unexercised states"],
            detail: { limit: detailLimit, retainedKeys: details.size, omittedEvents: omittedDetailEvents },
            events: { requested: includeEvents, limit: includeEvents ? eventLimit : 0, retained: events.length, omittedEvents },
            observerErrors: { count: observerErrors, messages: observerErrorMessages },
            mutationFailures: { ...mutationFailures, detailLimit: 20, scope: "All observed owners, regardless of style detail filter/event cap" },
        },
        styleTotals: totals,
        styles: [...details.values()].sort((a, b) => b.attempts - a.attempts),
        ...(includeEvents ? { events } : {}),
    };
}

function reportText(result) {
    const out = ["QOLLOCK OFFLINE INLINE STYLE TRACE", result.scope, result.selection,
        `Sample: ${result.snapshot.seconds}s; warm-up: ${result.meta.warmupMs / 1000}s; config: ${result.meta.configMode}`,
        `Attempts: ${result.styleTotals.attempts}; completed: ${result.styleTotals.completed}; failed: ${result.styleTotals.failed}`,
        "Completed changed/identical counts compare model values; delete compares property presence.",
        "Panel UIDs distinguish duplicate IDs/replacements within this replay only."];
    for (const note of result.tree.notes) out.push(`NOTE: ${note}`);
    for (const row of result.styles.slice(0, 30)) out.push(
        `${row.owner} panel=${row.panelUid} #${row.panelId} ${row.property}: attempts=${row.attempts} changed=${row.changed} identical=${row.identical} failed=${row.failed} deletes=${row.deletes}`,
        `  ${row.breadcrumbs}`);
    out.push(`Detail: ${result.styles.length} retained keys (text shows at most 30); ${result.coverage.detail.omittedEvents} events omitted from key detail.`,
        `Events: requested=${result.coverage.events.requested}; retained=${result.coverage.events.retained}; omitted=${result.coverage.events.omittedEvents}.`,
        "Use --events --json for ordered requested-value/outcome events. Inspect coverage and validity before interpreting counts.");
    for (const issue of result.validity.issues) out.push(`INVALID FOR OPTIMIZATION INFERENCE: ${issue}`);
    return out.join("\n");
}

function main() {
    try {
        const opts = parseArgs();
        const capturedTree = JSON.parse(fs.readFileSync(opts.capturePath, "utf8"));
        const hud = createProfiledHud({ capturedTree, warmupMs: opts.warmupMs,
            enableAll: opts.enableAll, configOverrides: opts.configOverrides });
        const result = collectStyleTrace(hud, opts);
        process.stdout.write(opts.json ? JSON.stringify(result, null, 2) + "\n" : reportText(result) + "\n");
        if (result.validity.issues.length) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`[style-tracer] FATAL: ${error.message}\n`);
        process.exitCode = 2;
    }
}

if (require.main === module) main();
module.exports = { parseArgs, collectStyleTrace, reportText };
