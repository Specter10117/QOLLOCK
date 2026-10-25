// scripts/simulator/index.js
// =============================================================================
// Public entry point: boot production HUD scripts in a controlled isolate.
// =============================================================================

"use strict";

const { Clock, makeVirtualDate } = require("./clock.js");
const { Panel, Document } = require("./panel.js");
const { Sandbox, makeNoopProxy, injectIntoIife } = require("./sandbox.js");
const layout = require("./layout.js");

/**
 * Create a HUD isolate with the real mod loaded. Scenarios own their native
 * panels and API responses; no hero/shop/build state machine is installed.
 *
 * @param {object}  opts
 * @param {number}  [opts.startMs]    initial virtual time
 * @param {boolean} [opts.inHideout]
 * @param {boolean} [opts.boot]       run the mod's boot sequence (default true)
 */
function createHud({
    startMs = 1000,
    inHideout = true,
    boot = true,
} = {}) {
    const clock = new Clock(startMs);
    const doc = new Document(clock);
    const sandbox = new Sandbox({ clock, doc, name: "hud" });

    setHideout(doc, inHideout);

    const scripts = layout.hudScripts();
    if (scripts.missing.length > 0) {
        const list = scripts.missing.map((m) => `${m.src} (hud.xml:${m.line})`).join(", ");
        throw new Error(`[simulator] hud.xml references missing scripts: ${list}`);
    }

    if (boot) {
        for (const s of scripts.scripts) sandbox.load(s.absPath);
    }

    return {
        clock,
        doc,
        sandbox,
        scripts,
        root: doc.root,
        /** Throw if the mod failed to load, with the real error attached. */
        assertLoaded() {
            if (sandbox.loadErrors.length === 0) return;
            const first = sandbox.loadErrors[0];
            const err = new Error(
                `[simulator] ${sandbox.loadErrors.length} script(s) failed to load. ` +
                `First: ${first.file} (${first.phase}): ${first.error.message}`
            );
            err.cause = first.error;
            throw err;
        },
        /** Combined diagnostics dump — call this in a failing assertion message. */
        diagnose() {
            const lines = [];
            lines.push(`--- virtual time: ${clock.now()}ms (${clock.pendingCount()} pending) ---`);
            lines.push(`--- mod messages (last 30) ---`);
            lines.push(sandbox.messages.slice(-30).join("\n"));
            if (clock.errors.length > 0) {
                lines.push(`--- scheduled-callback errors (${clock.errors.length}) ---`);
                lines.push(clock.errors.slice(0, 5).map((e) => `@${e.at}ms ${e.error.stack || e.error.message}`).join("\n"));
            }
            const problems = doc.assertClean();
            if (problems.length > 0) {
                lines.push(`--- tree anomalies ---`);
                lines.push(problems.join("\n"));
            }
            return lines.join("\n");
        },
    };
}

/**
 * Set the hideout signal consumed by production HUD state discovery.
 */
function setHideout(doc, connected) {
    doc.root.SetHasClass("connectedToHideout", !!connected);
}

module.exports = {
    createHud,
    setHideout,
    Clock,
    makeVirtualDate,
    Panel,
    Document,
    Sandbox,
    makeNoopProxy,
    injectIntoIife,
    layout,
};
