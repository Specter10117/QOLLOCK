// scripts/simulator/perf/profile.js
// =============================================================================
// Runs the real mod against an instrumented native capture and reports
// which feature asks the engine to do how much work per second.
// =============================================================================
// The harness answers one question: if a player's frame time gets worse when
// QOLLOCK is installed, WHICH part of QOLLOCK is asking for the work? It does
// that by counting engine-facing operations (see counters.js) and attributing
// each to the feature on the call stack at the time.
//
// ATTRIBUTION MECHANISM
//
// Poll wrapping is installed immediately after ql_scheduler loads, before app
// boot can allocate default-enabled loops.
//
//   * QOL.core.Scheduler.createPollLoop is replaced by a version
//     that wraps the callback with "mf:<featureId>". Every manifest's poll loop
//     goes through it (raw $.Schedule is banned in feature code), so manifests
//     are covered too.
//
// Everything else — the core loop body, ql_app's config bridge, boot code, engine
// callbacks — lands in "<unattributed>". That bucket is not noise to be ignored:
// the core loop's own per-tick work (config read, gate resolution, root classes)
// is some of the most expensive code in the mod, and it shows up there.
//
// CONFIG
//
// Features only run when enabled, and the mod reads its config from a panel
// attribute. `enableAll` writes a config with every ENABLE_*/HUD_*_ENABLED key
// set to 1. This expands coverage but does not exercise every toggle, numeric
// variant, event or gameplay state. With enableAll=false, overrides merge into
// defaults without expanding unrelated toggles.
// =============================================================================

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { install, counters, silently, READ_COVERAGE, ENUMERATION_COVERAGE } = require("./instrument.js");
const { buildCapturedHud } = require("./hud_tree.js");

// Install before requiring the simulator so index.js sees patched classes.
install();

const { Clock } = require("../clock.js");
const { Document } = require("../panel.js");
const { Sandbox } = require("../sandbox.js");
const layout = require("../layout.js");

// Matches QOL_STORAGE_KEY / QOL_USER_EDIT_REV_ATTR in ql_shared_presets.js.
// Fingerprint the actual simulator sources, without an arbitrary version bump.
// Saved runs with older or different model semantics are not comparable.
const modelFingerprint = (() => {
    const hash = crypto.createHash("sha256");
    const root = path.resolve(__dirname, "..");
    function include(folder) {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
            const file = path.join(folder, entry.name);
            if (entry.isDirectory()) include(file);
            else if (entry.name.endsWith(".js")) hash.update(JSON.stringify([path.relative(root,file).split(path.sep).join("/"),fs.readFileSync(file,"utf8")]));
        }
    }
    include(root);
    hash.update(fs.readFileSync(path.join(root,"../capture_tree.js"),"utf8"));
    return hash.digest("hex");
})();

const STORAGE_KEY = "Deadlock_Mod_Settings_v1";
const USER_EDIT_REV_ATTR = "QOL_USER_EDIT_REV";

/**
 * Build a config string the mod will accept, with everything switched on.
 *
 * Rather than hand-writing a config (which would drift from the schema on every
 * settings change), ask the mod itself for its defaults via buildDefaultConfig,
 * then flip every boolean-looking key to 1. Keys are identified by name prefix
 * because that is the same convention ConfigStore uses to decide what to coerce
 * to a boolean.
 */
function makeMaximalConfig(sandbox, overrides = {}, enableAll = true) {
    const defaults = sandbox.evalJson("(function(){ try { return QOL.buildDefaultConfig(); } catch(e) { return null; } })()");
    if (!defaults) return null;

    const cfg = { ...defaults };
    for (const key of Object.keys(cfg)) {
        if (enableAll && /^(ENABLE_|DISABLE_|HUD_.*_ENABLED$|SUPPORT_)/.test(key)) {
            // DISABLE_* keys turn features OFF when set — leave them at their
            // default so "everything on" means what it says.
            if (key.indexOf("DISABLE_") === 0) continue;
            cfg[key] = 1;
        }
    }
    Object.assign(cfg, overrides);
    return cfg;
}

/** Wrap Scheduler.createPollLoop so each manifest poll tick is attributed. */
function wrapPollLoops(sandbox) {
    return sandbox.eval(`
        (function () {
            if (!QOL || !QOL.core || !QOL.core.Scheduler) return false;
            var S = QOL.core.Scheduler;
            if (S.__profWrapped) return true;
            var orig = S.createPollLoop;
            S.createPollLoop = function (callback, rateSec, featureId) {
                var label = "mf:" + (featureId || "anonymous");
                var wrapped = function () {
                    __profEnter(label);
                    try { return callback.apply(this, arguments); }
                    catch (error) { __profError(label, error); throw error; }
                    finally { __profExit(); }
                };
                __profNoteLoop(label, rateSec);
                return orig.call(S, wrapped, rateSec, featureId);
            };
            S.__profWrapped = true;
            return true;
        })()
    `);
}

/** Attribute named scheduled callbacks outside managed polls; anonymous work stays unattributed. */
function wrapScheduledLoops(sandbox) {
    return sandbox.eval(`
        (function () {
            if (!$ || typeof $.Schedule !== "function" || $.__profSchedWrapped) return false;
            var orig = $.Schedule;
            $.Schedule = function (delaySec, cb) {
                if (typeof cb !== "function") return orig.apply($, arguments);
                var name = cb.name || "";
                if (!name || name === "wrapped" || name === "tick") return orig.call($, delaySec, cb);
                var label = "loop:" + name;
                var wrapped = function () {
                    __profEnter(label);
                    try { return cb.apply(this, arguments); }
                    catch (error) { __profError(label, error); throw error; }
                    finally { __profExit(); }
                };
                return orig.call($, delaySec, wrapped);
            };
            $.__profSchedWrapped = true;
            return true;
        })()
    `);
}

/**
 * Boot a profiled HUD.
 *
 * @param {object}  opts
 * @param {boolean} [opts.enableAll=true]
 * @param {object}  [opts.configOverrides]
 * @param {number}  [opts.warmupMs=8000]  virtual ms to run before counting
 * @param {object}  [opts.capturedTree]   validated per-panel hierarchy;
 *                                        defaults to the tracked native capture
 */
function createProfiledHud({
    enableAll = true,
    configOverrides = {},
    warmupMs = 8000,
    capturedTree = null,
    beforeLoad = null,
    runtimeSources = null,
    configInput = null,
} = {}) {
    if (capturedTree === null) capturedTree = JSON.parse(fs.readFileSync(path.join(layout.REPO_ROOT, "tests/fixtures/hud/2026-10-03-hero-testing.json"), "utf8"));
    const clock = new Clock(1000);
    const doc = new Document(clock);
    const sandbox = new Sandbox({ clock, doc, name: "hud" });
    if (beforeLoad) beforeLoad(sandbox);

    // Attribution hooks the wrappers call from inside the VM.
    sandbox.global.__profEnter = (label) => {
        counters.enter(label);
        counters.add("calls");
    };
    sandbox.global.__profExit = () => counters.exit();
    // Record before Scheduler catches/reset streaks can hide a recovered error.
    // Retain bounded details while preserving the complete failure count.
    const wrapperErrors = { count: 0, events: [] };
    sandbox.global.__profError = (label, error) => {
        wrapperErrors.count++;
        if (wrapperErrors.events.length < 100) wrapperErrors.events.push({ label, atMs: clock.now(), message: String(error?.message || error) });
    };
    const pollRates = new Map();
    sandbox.global.__profNoteLoop = (label, rate) => {
        pollRates.set(label, Number(rate) || 0.2);
    };

    // Build the tree BEFORE the mod loads: in-engine the HUD exists before the
    // mod's scripts run, and several features cache panel refs at boot.
    let tree;
    silently(() => {
        tree = buildCapturedHud(doc, capturedTree);
    });
    const capturedHudClasses = [...doc.root._classes];
    const treeHash = crypto.createHash("sha256");
    const pendingPanels = [doc.absRoot];
    while (pendingPanels.length) {
        const panel = pendingPanels.pop();
        treeHash.update(JSON.stringify([panel.id, panel.type, [...panel._classes].sort(),
            [...panel._attrs].sort((a, b) => a[0].localeCompare(b[0])), panel.text,
            panel.visible, panel.enabled, panel._children.length]));
        for (let i = panel._children.length - 1; i >= 0; i--) pendingPanels.push(panel._children[i]);
    }
    const treeFingerprint = treeHash.digest("hex");

    wrapScheduledLoops(sandbox);

    const scripts = runtimeSources || layout.hudScripts();
    if (scripts.missing.length > 0) {
        const list = scripts.missing.map((m) => `${m.src} (hud.xml:${m.line})`).join(", ");
        throw new Error(`[profiler] hud.xml references missing scripts: ${list}`);
    }
    const sourceHash = crypto.createHash("sha256");
    const loadedSources = scripts.scripts.map(s => ({ ...s, source: s.source === undefined ? fs.readFileSync(s.absPath, "utf8") : s.source }));
    const loadedScripts = loadedSources.map(s => {
        const relative = path.relative(layout.REPO_ROOT, s.absPath).split(path.sep).join("/");
        sourceHash.update(JSON.stringify([relative, s.source]));
        return relative;
    });
    silently(() => {
        for (const s of loadedSources) {
            sandbox.loadSource(s.source, s.absPath);
            if (s.absPath.includes("ql_scheduler")) {
                wrapPollLoops(sandbox);
            }
        }
    });

    if (sandbox.loadErrors.length > 0) {
        const first = sandbox.loadErrors[0];
        const err = new Error(
            `[profiler] ${sandbox.loadErrors.length} script(s) failed to load. ` +
            `First: ${path.basename(first.file)} (${first.phase}): ${first.error.message}`
        );
        err.cause = first.error;
        throw err;
    }

    // Seed config. Written to BOTH root and Hud because ReadStorageConfigRawFromUi
    // reads both and picks by revision; writing one only would exercise a
    // fallback path rather than the normal one.
    //
    // The wire format is the storage envelope UnwrapConfigFromStorage expects
    // (ql_shared_presets.js:60): {"schema":"<semver>","data":{...}}. Plain JSON is
    // also accepted as the legacy shape, but writing the envelope keeps the
    // profile on the same code path a real install takes.
    let configApplied = false;
    let configBytes = 0;
    const inputConfig = configInput ? { ...configInput } : makeMaximalConfig(sandbox, configOverrides, enableAll);
    silently(() => {
        if (!configInput && !enableAll && Object.keys(configOverrides).length === 0) return;
        const cfg = inputConfig;
        if (!cfg) return;
        const schema = sandbox.eval(
            `(function(){ try { return String(QOL_SCHEMA_VERSION || QOL_CONFIG_SCHEMA_VERSION || ""); } catch(e) { return ""; } })()`
        );
        const raw = JSON.stringify({ schema: schema || "3.1.9", data: cfg });
        configBytes = raw.length;
        doc.root.SetAttributeString(STORAGE_KEY, raw);
        doc.root.SetAttributeString(USER_EDIT_REV_ATTR, "1");
        const hud = doc.absRoot.FindChildTraverse("Hud");
        if (hud) {
            hud.SetAttributeString(STORAGE_KEY, raw);
            hud.SetAttributeString(USER_EDIT_REV_ATTR, "1");
        }
        configApplied = true;
    });

    const wrappedScheduler = wrapPollLoops(sandbox);
    const wrappedLoops = wrapScheduledLoops(sandbox);

    // Warm up with counting OFF: boot, first-run panel discovery and one-shot
    // work are not what we are profiling, and they would swamp the steady state.
    silently(() => clock.advance(warmupMs));

    return {
        clock,
        doc,
        sandbox,
        tree,
        counters,
        pollRates,
        wrapperErrors,
        inputConfig,
        meta: {
            modelFingerprint, unsupportedCalls: sandbox.unsupportedCalls,
            wrapperErrors,
            sourceCoverage: { scripts: loadedScripts, fingerprint: sourceHash.digest("hex") },
            readCoverage: READ_COVERAGE,
            enumerationCoverage: ENUMERATION_COVERAGE,
            callbackCoverage: "calls counts managed poll and named scheduled wrapper entries; anonymous/raw callbacks are not owner-attributed",
            configApplied, configBytes,
            configMode: enableAll ? "expanded" : "defaults",
            configOverrides: { ...configOverrides },
            configFingerprint: crypto.createHash("sha256").update(JSON.stringify(inputConfig)).digest("hex"),
            healthbarType: Number(inputConfig && inputConfig.HEALTHBAR_TYPE) || 0,
            wrappedScheduler, wrappedLoops, warmupMs,
            treeSource: "captured",
            treeFingerprint,
            capturedFrom: capturedTree.capturedFrom || capturedTree.timestampUtc || "supplied fixture",
            capturedHudClasses,
            captureFidelity: tree.fidelity || null,
        },

        /** Count for `ms` of virtual time and return a snapshot. */
        measure(ms) {
            if (!Number.isFinite(ms) || ms <= 0) throw new Error("measurement duration must be positive and finite");
            const firedBefore = clock.stats.fired;
            counters.reset();
            counters.enabled = true;
            try { clock.advance(ms); }
            finally { counters.enabled = false; }
            return { ...counters.snapshot(ms / 1000), scheduledCallbacks: clock.stats.fired - firedBefore };
        },

        diagnose() {
            const lines = [];
            lines.push(`tree: ${tree.panels} panels`);
            if (tree.notes.length > 0) lines.push(`tree notes:\n  ${tree.notes.join("\n  ")}`);
            lines.push(`scheduler wrapped: ${wrappedScheduler}`);
            lines.push(`clock: ${clock.now()}ms, ${clock.pendingCount()} pending`);
            if (clock.errors.length > 0) {
                lines.push(`scheduled-callback errors (${clock.errors.length}):`);
                lines.push(clock.errors.slice(0, 5).map((e) => `  @${e.at}ms ${e.error.message}`).join("\n"));
            }
            lines.push(`mod messages (last 20):\n  ${sandbox.messages.slice(-20).join("\n  ")}`);
            return lines.join("\n");
        },
    };
}

module.exports = { createProfiledHud, makeMaximalConfig, STORAGE_KEY };
