"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scope = { QOL: { core: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../panorama/scripts/core/ql_minimap_plan.js"), "utf8"), scope);
const contract = scope.QOL.core.MinimapPlan;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
};

function decodePackets(records, session) {
    const groups = new Map(), packets = new Map(), errors = new Map();
    for (const record of records || []) {
        if (record.session !== session) continue;
        const id = record.packet;
        if (typeof id !== "string" || id.length > 128) throw Error("Invalid minimap packet identifier");
        if (!groups.has(id)) groups.set(id, { total: record.total, hash: record.hash, chunks: new Map() });
        const group = groups.get(id);
        if (!Number.isInteger(record.total) || record.total < 1 || record.total > 50000 ||
            !Number.isInteger(record.index) || record.index < 0 || record.index >= record.total ||
            typeof record.data !== "string" || record.data.length > 4000 || !/^[a-f0-9]{8}$/.test(record.hash) ||
            record.total !== group.total || record.hash !== group.hash ||
            (group.chunks.has(record.index) && group.chunks.get(record.index) !== record.data)) errors.set(id, "conflicting/invalid packet chunks");
        else group.chunks.set(record.index, record.data);
    }
    for (const [id, group] of groups) {
        if (errors.has(id)) continue;
        if (group.chunks.size !== group.total) { errors.set(id, "missing packet chunk"); continue; }
        const raw = Array.from({ length: group.total }, (_, index) => group.chunks.get(index)).join("");
        if (digest(raw) !== group.hash) { errors.set(id, "packet checksum mismatch"); continue; }
        try { packets.set(id, JSON.parse(raw)); }
        catch (_) { errors.set(id, "invalid packet JSON"); }
    }
    return { packets, errors };
}

function structure(proof) {
    const panel = item => item?.present ? [item.identity, item.parentIdentity, item.width, item.height, item.visible, item.children] : null;
    return stable({ scene: proof.scene, owners: Object.fromEntries(contract.owners.map(id => {
        const item = proof.owners[id];
        return [id, item.enabled ? { root: panel(item.root), native: panel(item.native), markers: panel(item.markers), tunnel: panel(item.tunnel),
            groups: Object.entries(item.groups || {}).map(([key, value]) => [key, panel(value)]),
            geometry: Object.entries(item.geometry?.targets || {}).map(([key, value]) => [key, panel(value)]),
            decoration: [panel(item.decoration?.canvas), panel(item.decoration?.mapRender), ...(item.decoration?.backgrounds || []).map(panel)] } : null];
    })) });
}

function validatePlan(plan) {
    if (!Array.isArray(plan?.conditions) || !plan.conditions.length || plan.conditions.length > 100 || !Array.isArray(plan.blocks) || plan.blocks.length > 1000 || !Number.isFinite(plan.sampleMs)) throw Error("Invalid minimap context/coverage ledger");
    const ids = plan.conditions.map(condition => condition.id);
    if (new Set(ids).size !== ids.length || !ids.includes("sham")) throw Error("Conflicting minimap condition ledger");
    for (const condition of plan.conditions) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(condition.id)) throw Error("Invalid minimap condition ID");
        for (const vector of [condition.a, condition.b]) if (!Array.isArray(vector?.ownersOff) || !Array.isArray(vector.pausedPolls) || !vector.runtime || !Array.isArray(vector.loot?.hideGroups)) throw Error("Invalid minimap state vector");
        const repeats = plan.blocks.filter(block => block.conditionId === condition.id).map(block => block.repeat);
        if (stable(repeats.slice().sort()) !== "[0,1,2]") throw Error("Minimap ledger must declare three independent repetitions per condition");
    }
    const trials = new Set();
    for (const block of plan.blocks) {
        if (!Number.isInteger(block.trial) || trials.has(block.trial) || !ids.includes(block.conditionId) || !["ABBA", "BAAB"].includes(block.order?.join(""))) throw Error("Invalid minimap block ledger");
        trials.add(block.trial);
    }
}

function analyzeMinimap(meta, frames, focus, summarizeWindow) {
    const { packets, errors: packetErrors } = decodePackets(meta.packets, meta.session);
    const context = packets.get("context");
    if (!context || context.kind !== "minimap-suite") throw Error("Minimap context/declared coverage ledger unavailable: " + (packetErrors.get("context") || "missing context packet"));
    const { plan } = context; validatePlan(plan);
    const knownTrials = new Set(plan.blocks.map(block => block.trial));
    const windows = (meta.windows || []).filter(window => window.session === meta.session);
    if (windows.some(window => !knownTrials.has(window.trial))) throw Error("Native windows outside the declared minimap plan");
    const blocks = plan.blocks.map(block => {
        const condition = plan.conditions.find(item => item.id === block.conditionId), errors = [];
        const observed = windows.filter(window => window.trial === block.trial);
        const skipped = packets.get("block-" + block.trial + "-skip");
        if (skipped && !observed.length) return { ...block, status: "not_exercised", skip: skipped.status, errors: [skipped.reason], evidence: skipped.evidence, windows: [], effectMs: null };
        if (observed.length !== 4) errors.push(observed.length ? "incomplete block windows" : "not run: all four planned windows missing");
        const phases = new Set();
        const summaries = observed.map(window => {
            if (!Number.isInteger(window.phase) || window.phase < 0 || window.phase > 3 || phases.has(window.phase) ||
                window.conditionId !== block.conditionId || window.repeat !== block.repeat || window.side !== block.order[window.phase] ||
                !Number.isFinite(window.startAt) || !Number.isFinite(window.endAt) || window.endAt - window.startAt < plan.sampleMs - 1 || window.endAt - window.startAt > plan.sampleMs + 1500) {
                errors.push("window identity/order/duration mismatch"); return null;
            }
            phases.add(window.phase);
            const expected = condition[window.side.toLowerCase()];
            const proofs = [window.beforeProof, window.afterProof].map(id => packets.get(id));
            let comparableProofs = true;
            for (const [index, proof] of proofs.entries()) {
                const id = index ? window.afterProof : window.beforeProof;
                if (!proof) { errors.push("proof " + id + ": " + (packetErrors.get(id) || "missing")); comparableProofs = false; continue; }
                try {
                    const failures = contract.verify(expected, proof);
                    if (!proof.verified || failures.length || proof.work?.errors) { errors.push("proof " + id + ": " + (failures.join(", ") || "not verified / callback error")); comparableProofs = false; }
                } catch (error) { errors.push("malformed state proof: " + error.message); comparableProofs = false; }
            }
            if (comparableProofs) {
                if (structure(proofs[0]) !== structure(proofs[1])) errors.push("native scene/tree/bounds changed inside sampling window");
                for (const owner of expected.pausedPolls) if (proofs[0].owners[owner]?.stages?.updates !== proofs[1].owners[owner]?.stages?.updates) errors.push("paused callback body ran: " + owner);
                for (const owner of contract.owners.filter(id => !expected.ownersOff.includes(id) && !expected.pausedPolls.includes(id))) {
                    const before = proofs[0].owners[owner]?.stages, after = proofs[1].owners[owner]?.stages;
                    if (!(after?.updates > before?.updates)) errors.push("expected polling body not exercised: " + owner);
                    const skip = owner === contract.owners[0] ? expected.runtime.skipSweep : expected.loot.skipSweep;
                    const key = skip ? "skippedSweeps" : "sweeps";
                    if (!(after?.[key] > before?.[key])) errors.push("expected " + key + " path not exercised: " + owner);
                }
            }
            const summary = { ...summarizeWindow(frames, focus, window, meta.processId), side: window.side,
                beforeProof: window.beforeProof, afterProof: window.afterProof };
            if (summary.quality !== "comparable") errors.push(summary.quality);
            return summary;
        }).filter(Boolean).sort((a, b) => a.phase - b.phase);
        if (summaries.some((window, i) => i && window.startAt < summaries[i - 1].endAt)) errors.push("overlapping/out-of-order block windows");
        const a = summaries.filter(window => window.side === "A"), b = summaries.filter(window => window.side === "B");
        const referenceMs = mean(a.map(window => window.meanMs)), excludedMs = mean(b.map(window => window.meanMs));
        if (a.length === 2 && b.length === 2 && [referenceMs, excludedMs].every(value => value > 0)) {
            if (Math.abs(a[0].meanMs - a[1].meanMs) / referenceMs > 0.1 || Math.abs(b[0].meanMs - b[1].meanMs) / excludedMs > 0.1) errors.push("within-block drift exceeds 10%");
        }
        const failure = packets.get("block-" + block.trial + "-failure");
        if (failure) errors.push(failure.reason + ": " + (failure.errors || []).join(", "));
        return { ...block, status: errors.length ? observed.length || failure ? "invalid" : "not_run" : "valid", errors: [...new Set(errors)],
            windows: summaries, referenceMs, excludedMs, effectMs: errors.length ? null : referenceMs - excludedMs };
    });
    const sham = blocks.filter(block => block.conditionId === "sham" && block.status === "valid");
    const noiseMs = sham.length >= 2 ? Math.max(...sham.map(block => Math.abs(block.effectMs))) : null;
    const rows = plan.conditions.map(condition => {
        const ownBlocks = blocks.filter(block => block.conditionId === condition.id), valid = ownBlocks.filter(block => block.status === "valid");
        const effects = valid.map(block => block.effectMs), effectMs = mean(effects), referenceMs = mean(valid.map(block => block.referenceMs)), excludedMs = mean(valid.map(block => block.excludedMs));
        const variance = effects.length > 1 ? effects.reduce((sum, value) => sum + (value - effectMs) ** 2, 0) / (effects.length - 1) : null;
        const margin = variance === null || noiseMs === null ? null : (effects.length === 2 ? 12.706 : 4.303) * Math.sqrt(variance / effects.length) + noiseMs;
        const lowerMs = margin === null ? null : effectMs - margin, upperMs = margin === null ? null : effectMs + margin;
        const betweenDrift = valid.length > 1 && (Math.max(...valid.map(block => block.referenceMs)) - Math.min(...valid.map(block => block.referenceMs))) / referenceMs > 0.15;
        let status = !valid.length ? ownBlocks.every(block => block.status === "not_run") ? "not_run" : ownBlocks.every(block => block.status === "not_exercised") ? "not_exercised" : "invalid" : "inconclusive";
        if (valid.length >= 2 && margin !== null && !betweenDrift) {
            if (lowerMs > 0 && effects.every(value => value > 0)) status = "effect_detected";
            else if (upperMs < 0 && effects.every(value => value < 0)) status = "regression_detected";
            else if (Math.max(Math.abs(lowerMs), Math.abs(upperMs)) <= referenceMs * 0.02) status = "bounded_under_2pct";
        }
        return { ...condition, blocks: ownBlocks, validBlocks: valid.length, status, effectMs, lowerMs, upperMs, noiseMs, betweenDrift,
            referenceMs, excludedMs, referenceFps: referenceMs ? 1000 / referenceMs : null, excludedFps: excludedMs ? 1000 / excludedMs : null };
    });
    const interactions = [];
    for (const [label, ids, signs] of [["owner nonadditivity", ["owners-both", "owners-runtime", "owners-loot"], [1, -1, -1]],
        ["static-root nonadditivity", ["static-both", "static-crates", "static-loot"], [1, -1, -1]],
        ["poll effect with visible versus hidden roots", ["polls-both", "polls-hidden"], [1, -1]],
        ["loot root minus individual groups (conditional residual, not additive attribution)", ["static-loot", "layer-tough", "layer-snacks", "layer-statues", "layer-names", "layer-routes"], [1, -1, -1, -1, -1, -1]]]) {
        const selected = ids.map(id => rows.find(row => row.id === id));
        const covered = selected.every(row => row && row.validBlocks >= 2 && row.lowerMs !== null && !row.betweenDrift);
        interactions.push({ label, ids, effectMs: covered ? selected.reduce((sum, row, i) => sum + row.effectMs * signs[i], 0) : null,
            uncertaintyMs: covered ? selected.reduce((sum, row) => sum + (row.upperMs - row.lowerMs) / 2, 0) : null });
    }
    const runner = packets.get("runner-restoration"), app = packets.get("app-restoration");
    const restoration = { runner, app,
        hooksReleased: !runner ? null : !runner.errors?.length && contract.owners.every(id => !Object.keys(runner.owners?.[id]?.controls || {}).length),
        configRestored: !app?.expectedConfig || !app.actualConfig || app.status === "successor-owned" ? null : !app.successorActive && !app.stressLeaseActive && stable(app.expectedConfig) === stable(app.actualConfig) };
    const localHashes = meta.sourceIdentity?.loadedFunctionFingerprints || {}, loaded = context.loadedFunctionFingerprints || {};
    const functionMatches = Object.fromEntries(Object.entries(loaded).map(([key, value]) => [key, localHashes[key] ? value === localHashes[key] : null]));
    const sourceStatus = Object.values(functionMatches).some(value => value === false) ? "mismatch" :
        Object.values(functionMatches).length && Object.values(functionMatches).every(value => value === true) ? "selected_functions_match" : "unverified";
    const stateSummary = proof => !proof ? null : Object.fromEntries(contract.owners.map(id => {
        const owner = proof.owners[id];
        return [id, { enabled: owner.enabled, retirement: owner.retirement, root: owner.root, counts: owner.counts, composition: owner.composition,
            groups: owner.groups, tunnel: owner.tunnel, geometry: owner.geometry, decoration: owner.decoration, reconciled: owner.reconciled }];
    }));
    for (const row of rows) {
        const block = row.blocks.find(item => item.status === "valid");
        row.states = block ? Object.fromEntries(["A", "B"].map(side => {
            const window = block.windows.find(item => item.side === side);
            return [side, stateSummary(packets.get(window.beforeProof))];
        })) : null;
    }
    return { kind: "minimap-suite", context, scene: packets.get("scene"), rows, blocks, interactions, restoration, noiseMs, sourceStatus,
        sourceIdentity: meta.sourceIdentity, gameIdentity: meta.gameIdentity, captureStop: meta.reason, sourceMatches: functionMatches,
        transportWarnings: meta.packetParseErrors || [],
        packetErrors: Object.fromEntries(packetErrors), sampleState: packets.get(windows.find(window => packets.has(window.beforeProof))?.beforeProof),
        retryIds: rows.filter(row => row.id !== "sham" && ["invalid", "not_run", "inconclusive"].includes(row.status)).map(row => row.id) };
}

function formatMinimap(result) {
    const f = value => Number.isFinite(value) ? value.toFixed(3) : "n/a";
    const context = result.context, base = context.plan.conditions.find(row => row.id === "sham").a;
    const delta = (value, reference) => Object.fromEntries([...new Set([...Object.keys(value), ...Object.keys(reference)])]
        .filter(key => stable(value[key]) !== stable(reference[key])).map(key => {
            const item = value[key];
            return [key, item === undefined ? { $absent: true } : item && typeof item === "object" && !Array.isArray(item) ? delta(item, reference[key] || {}) : item];
        }));
    const panel = value => !value?.present ? { present: false } : { present: true, visible: value.visible, width: value.width, height: value.height,
        opacity: value.opacity, children: value.children, code: value.code };
    const semantic = owners => Object.fromEntries(Object.entries(owners || {}).map(([id, item]) => [id, {
        enabled: item.enabled, retirement: item.retirement, root: panel(item.root), counts: item.counts, composition: item.composition,
        groups: item.groups && Object.fromEntries(Object.entries(item.groups).map(([key, group]) => [key, { children: group.children, expected: group.expected, visible: group.visible }])),
        tunnel: item.tunnel && panel(item.tunnel),
        geometry: item.geometry && { fixedIcons: item.geometry.fixedIcons,
            targets: Object.fromEntries(Object.entries(item.geometry.targets || {}).map(([key, value]) => [key, panel(value)])),
            plans: Object.fromEntries((item.geometry.plans || []).map(plan => [plan.role, { desired: plan.desired, classes: plan.classes, applied: plan.applied }])) },
        decoration: item.decoration && { canvas: panel(item.decoration.canvas), mapRender: panel(item.decoration.mapRender),
            backgrounds: (item.decoration.backgrounds || []).map(panel), activeTargets: item.decoration.activeTargets, releaseResults: item.decoration.releaseResults },
        reconciled: item.reconciled
    }]));
    const baselineState = semantic(result.sampleState?.owners);
    const lines = ["=== QOLLOCK self-contained native minimap diagnosis ===",
        `Capture=${result.session}; process=${result.processId}; swap chain=${result.swapChain}; frames=${result.nativeFrames}; QPC drift=${f(result.clockDriftMs)}ms; stop=${result.captureStop}`,
        "Source: PresentMon application Present intervals. Display cadence and CPU/GPU busy are context, not code attribution. Positive delta = B saves frame time; negative = B is slower.",
        "Uncertainty = block-level t95 repetition spread + worst absolute sham effect (>=2 valid shams required). Exploratory, not familywise confidence or proof of camera/world-state equivalence. No fixed 0.5ms detection gate.",
        `Noise envelope=${f(result.noiseMs)}ms; expected blocks=${context.plan.blocks.length}; valid=${result.blocks.filter(block => block.status === "valid").length}; source version=${context.modVersion}`,
        "Source identity=" + JSON.stringify(result.sourceIdentity ? { head: result.sourceIdentity.git?.head, dirty: result.sourceIdentity.git?.dirtyFiles, sourceSha256: result.sourceIdentity.sha256, files: result.sourceIdentity.files?.length, scope: result.sourceIdentity.scope } : "unavailable"),
        "Loaded function hashes=" + JSON.stringify(context.loadedFunctionFingerprints) + "; local matches=" + JSON.stringify(result.sourceMatches),
        "Source correspondence=" + result.sourceStatus + ". If mismatched/unverified, native contrasts remain observations but reconcile the loaded/local code before choosing an edit from the source mapping.",
        context.provenanceScope,
        "Game identity=" + JSON.stringify(result.gameIdentity || "unavailable"),
        "Scene=" + JSON.stringify(result.scene),
        "Tested full configuration=" + JSON.stringify(context.baseline),
        "Canonical configuration delta from tested=" + JSON.stringify(context.canonical ? delta(context.canonical, context.baseline) : "unavailable"),
        "Enabled owners=" + JSON.stringify(context.enabledIds),
        "BASE vector=" + JSON.stringify(base),
        "State evidence baseline=" + JSON.stringify(result.sampleState ? { owners: baselineState, scope: result.sampleState.visibilityScope } : "unavailable"),
        "Representative A/B state deltas inherit this baseline; {$absent:true} removes a field. Every accepted window separately passes before/after proofs; raw identities/proofs are retained in capture.json.",
        "Coverage and effects (each block has two A and two B windows; three repetitions are separated and order-balanced):"];
    for (const row of result.rows.slice().sort((a, b) => (b.effectMs ?? -Infinity) - (a.effectMs ?? -Infinity))) {
        lines.push(`${row.status.toUpperCase()} ${row.id}: delta=${f(row.effectMs)}ms uncertainty=[${f(row.lowerMs)},${f(row.upperMs)}]ms; Present FPS ${f(row.referenceFps)} -> ${f(row.excludedFps)}; valid=${row.validBlocks}/3${row.betweenDrift ? "; between-block drift >15%" : ""}`);
        lines.push("  A=BASE+" + JSON.stringify(delta(row.a, base)) + "; B=BASE+" + JSON.stringify(delta(row.b, base)));
        lines.push(`  Source=${row.source?.file} :: ${row.source?.symbol}; ${row.question}`);
        if (row.states) {
            lines.push("  Verified A state delta=" + JSON.stringify(delta(semantic(row.states.A), baselineState)),
                "  Verified B state delta=" + JSON.stringify(delta(semantic(row.states.B), baselineState)));
        }
        for (const block of row.blocks) lines.push(`  repetition ${block.repeat + 1} ${block.order.join("")}: ${block.status}${block.skip ? "/" + block.skip : ""}; delta=${f(block.effectMs)}ms; ${block.errors.join("; ")}` +
            (block.windows.length ? "; windows=" + block.windows.map(window => `${window.side}:n${window.samples},${f(window.meanMs)}ms,p95=${f(window.p95Ms)},displayFPS=${f(window.displayFps)},CPU=${f(window.cpuBusyMs)},GPU=${f(window.gpuBusyMs)}`).join(" | ") : ""));
    }
    lines.push("Interactions/residuals (conditional contrasts; individual effects need not sum):");
    for (const item of result.interactions) lines.push(`  ${item.label}: ${f(item.effectMs)} +/- ${f(item.uncertaintyMs)}ms; inputs=${item.ids.join(",")}`);
    lines.push("Decision rules: rank repeatable positive effects and follow their exact source/intervention above. Whole-owner effects alone do not identify a renderer or poll cost. Poll/sweep signals concern callback/native-call work; retained layer signals concern layout/render/composition. Native decoration and geometry probes change presentation/visible workload; preserve intended visuals before accepting a fix. Cache probes verify creation requests, not the engine's internal cache state. BOUNDED_UNDER_2PCT bounds this contrast to 2% of its reference frame time; it never means zero cost. NOT_EXERCISED/INVALID/NOT_RUN are not negative findings.");
    lines.push(`Restoration: feature hooks released=${result.restoration.hooksReleased}; expected/current config match=${result.restoration.configRestored}. Immediate native reconstruction/paint is not proven.`,
        "Restoration evidence=" + JSON.stringify({ runner: result.restoration.runner && { reason: result.restoration.runner.reason, errors: result.restoration.runner.errors,
            enabledIds: result.restoration.runner.enabledIds, owners: Object.fromEntries(Object.entries(result.restoration.runner.owners || {}).map(([id, owner]) => [id, { active: owner.active, controls: owner.controls, reconciled: owner.reconciled }])) },
            app: result.restoration.app && { status: result.restoration.app.status, successorActive: result.restoration.app.successorActive,
                stressLeaseActive: result.restoration.app.stressLeaseActive, observationScope: result.restoration.app.observationScope,
                expectedDeltaFromCanonical: delta(result.restoration.app.expectedConfig || {}, context.canonical || context.baseline),
                actualDeltaFromExpected: delta(result.restoration.app.actualConfig || {}, result.restoration.app.expectedConfig || {}) } }),
        "Transport errors=" + JSON.stringify(result.packetErrors) + "; decoding warnings=" + JSON.stringify(result.transportWarnings),
        "Available unrun refinements=" + JSON.stringify((context.plan.available || []).map(row => ({ id: row.id, question: row.question, source: row.source }))),
        "Retry without compilation/restart: start capture_game_frames.ps1 again, paste comma-separated IDs into Dev -> Complete minimap investigation -> condition IDs, then Investigate. A new sham control is included automatically. Suggested IDs=" + result.retryIds.join(","),
        "Scope=" + context.plan.scope, ...(context.caveats || []));
    return lines.join("\n");
}
module.exports = { analyzeMinimap, formatMinimap, decodePackets, digest };
