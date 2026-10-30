// OWNS: Native-first comparisons of Expanded Config deltas, including CSS keys.
// DOES NOT OWN: Engine frame timing, feature render proofs or persistent config.
(() => {
    "use strict";
    const Q = QOL, P = Q.core.panel;
    const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ?
        Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const digest = value => Q.core.MinimapInvestigation.digest(stable(value));
    let active = null, status = null;

    function plan({ baseline, canonical, manifests, selectedIds = [] }) {
        if (!baseline || !canonical) throw Error("canonical configuration unavailable");
        const unavailableKeys = Object.keys(baseline).filter(key => canonical[key] === undefined);
        const changedKeys = Object.keys(baseline).filter(key => canonical[key] !== undefined && stable(baseline[key]) !== stable(canonical[key])).sort();
        const groups = new Map();
        for (const key of changedKeys) {
            const owners = manifests.filter(owner => owner.keys.includes(key)).map(owner => owner.id).sort();
            const id = owners.join(",") || "unregistered:" + key;
            if (!groups.has(id)) groups.set(id, { owners, keys: [] });
            groups.get(id).keys.push(key);
        }
        const row = (id, keys, owners, question, extra = {}) => ({ id, keys, owners, question,
            patch: Object.fromEntries(keys.map(key => [key, canonical[key]])),
            sources: owners.map(owner => "panorama/scripts/manifests/" + owner + "/manifest.js"), ...extra });
        const all = [row("sham", [], [], "A/A control, with benchmark instrumentation enabled on both sides"),
            row("whole-config", changedKeys, [], "Expanded versus canonical settings, with the same benchmark instrumentation"),
            row("benchmark-instrumentation", [], [], "Expanded benchmark accounting enabled versus disabled; diagnostic work observation stays enabled")];
        for (const [index, group] of [...groups.values()].entries()) all.push(row("group-" + String(index + 1).padStart(3, "0"), group.keys, group.owners,
            "Revert these settings to canonical values inside Expanded Config; all listed consumers can be affected"));
        for (const key of changedKeys) all.push(row("key-" + key.toLowerCase().replace(/_/g, "-"), [key],
            manifests.filter(owner => owner.keys.includes(key)).map(owner => owner.id).sort(),
            "Single setting refinement; an effect can depend on the other expanded settings", { optional: true }));
        if (selectedIds.some(id => !all.some(item => item.id === id))) throw Error("unknown configuration condition ID");
        const conditions = all.filter(item => item.id === "sham" || (selectedIds.length ? selectedIds.includes(item.id) : !item.optional));
        const blocks = [];
        for (let repeat = 0; repeat < 3; repeat++) {
            const probes = conditions.filter(item => item.id !== "sham");
            const offset = probes.length ? repeat * Math.max(1, Math.floor(probes.length / 3)) % probes.length : 0;
            for (const condition of [conditions[0], ...probes.slice(offset), ...probes.slice(0, offset)]) blocks.push({ trial: blocks.length + 1,
                conditionId: condition.id, repeat, order: repeat % 2 ? ["B", "A", "A", "B"] : ["A", "B", "B", "A"] });
        }
        const settleMs = 1000, sampleMs = 2000;
        return { kind: "config-suite", changedKeys, unavailableKeys, conditions, blocks, settleMs, sampleMs,
            estimatedMs: 5000 + blocks.length * 4 * (settleMs + sampleMs), deadlineMs: 3300000,
            available: all.filter(item => !conditions.includes(item)) };
    }

    function start({ root, configuration, selectedIds = [], onPacket = () => {}, onWindow = () => {}, onProgress = () => {}, onComplete }) {
        active?.stop("superseded");
        if (active) throw Error("a newer configuration investigation started during cleanup");
        if (!P.isAlive(root) || !configuration?.canonical) throw Error("HUD/canonical configuration unavailable");
        const registry = Q.core.FeatureRegistry, scheduler = Q.core.Scheduler;
        const manifests = registry.getRegisteredIds().map(id => {
            const manifest = registry.getManifest(id);
            return { id, keys: [...new Set([manifest.enableKey, ...(manifest.enableKeys || []),
                ...(manifest.settings || []).flatMap(setting => [setting.key, ...(setting.options || []).map(option => option.key)])].filter(Boolean))] };
        });
        const declared = plan({ ...configuration, manifests, selectedIds });
        const registeredKeys = [...new Set(manifests.flatMap(owner => owner.keys))].filter(key => Object.prototype.hasOwnProperty.call(configuration.baseline, key)).sort();
        const registeredConfig = config => Object.fromEntries(registeredKeys.map(key => [key, config[key]]));
        if (declared.estimatedMs > declared.deadlineMs - 30000) throw Error("configuration plan exceeds deadline; select condition IDs");
        const observation = scheduler.startWorkObservation(), panels = P.createOwnedTree();
        const contextPanel = $.GetContextPanel(), started = Date.now(), initialErrors = configuration.initialFailures || registry.getErrorTotals();
        let stopped = false, timer = null, benchmark = null, progress = null, expectedIds = registry.getEnabledIds().slice().sort();
        let blockIndex = -1, phase = 0, condition = null, block = null, expectedConfig = null, ownerConfig = null, instrumented = false, scene = null;
        const result = { kind: "config-suite", reason: "", completedBlocks: 0, expectedBlocks: declared.blocks.length, restoreErrors: [] };
        const sameHud = () => P.isAlive(root) && $.GetContextPanel() === contextPanel && P.findHud(contextPanel) === root;
        const current = () => {
            if (!sameHud()) return "HUD replaced";
            if (!observation.isActive()) return "work observation replaced";
            if (root.BHasClass("ShowEscapeMenu")) return "escape menu opened";
            const flags = readScene();
            if (flags.some(Boolean)) return "shop/scoreboard/detail/hideout is not a stationary gameplay scene";
            const nextScene = flags.join(",");
            if (scene !== null && scene !== nextScene) return "scene flags changed";
            scene = nextScene;
            if (Date.now() - started > declared.deadlineMs) return "deadline";
            if (registry.getEnabledIds().slice().sort().join(",") !== expectedIds.join(",")) return "feature coverage changed";
            const failedOwners = Object.entries(registry.getErrorTotals()).filter(([id, count]) => count > (initialErrors[id] || 0)).map(([id]) => id);
            if (failedOwners.length) return "feature lifecycle/settings/callback failure: " + failedOwners.join(", ");
            if (!!Q.state.benchmarkActive !== instrumented) return "benchmark accounting state changed";
            return "";
        };
        const readScene = () => {
            const core = P.findChildByClass(root, "HudCore"), gameplay = P.findChild(core, "gameplay_hud");
            const host = P.findChild(P.findChildByClass(gameplay, "clamp_width"), "minimap_persp");
            return [Q.core.hud.isClassActive("gShopOpen"), Q.core.hud.isScoreboardOpen(root, host),
                !!host?.BHasClass("gDetailView") || Q.core.hud.isClassActive("gDetailView"), Q.core.hud.isInHideout(root)];
        };
        const finish = reason => {
            if (stopped) return;
            stopped = true;
            const failuresBeforeCleanup = registry.getErrorTotals();
            const failedOwners = Object.entries(failuresBeforeCleanup).filter(([id, count]) => count > (initialErrors[id] || 0)).map(([id]) => id);
            if (timer !== null) { try { $.CancelScheduled(timer); } catch (_) {} timer = null; }
            benchmark?.stop(); benchmark = null;
            observation.stop(); panels.dispose();
            if (sameHud()) {
                try { configuration.apply({}); }
                catch (error) { result.restoreErrors.push(String(error)); }
            }
            result.reason = reason;
            result.report = "QOLLOCK native Expanded Config investigation: " + reason + "\nCompleted blocks: " + result.completedBlocks + "/" + result.expectedBlocks +
                "\nWait for the external native report. No FPS is inferred from UI scheduling.";
            try { onPacket("runner-restoration", { reason, errors: result.restoreErrors, retiredHud: !sameHud(), benchmarkActive: !!Q.state.benchmarkActive,
                failuresBeforeCleanup, failedOwners, failuresAfterCleanup: registry.getErrorTotals() }); }
            catch (error) { result.restoreErrors.push("restoration transport: " + String(error)); }
            if (active === session) { active = null; status = { running: false, reason, completed: result.completedBlocks }; }
            onComplete(result);
        };
        const schedule = (seconds, callback) => {
            if (stopped) return;
            timer = $.Schedule(seconds, () => {
                timer = null;
                if (stopped) return;
                try { callback(); } catch (error) { finish("error: " + String(error)); }
            });
        };
        const proof = () => {
            const work = observation.sample();
            const actual = configuration.read();
            const failures = [current(), digest(actual.flat) !== digest(expectedConfig) ? "configuration lease readback mismatch" : "",
                digest(registeredConfig(actual.registered)) !== digest(ownerConfig) ? "registered configuration changed after application" : "",
                work.errors ? "managed callback failure" : ""].filter(Boolean);
            return { verified: !failures.length, failures, configHash: digest(actual.flat), ownerConfigHash: digest(registeredConfig(actual.registered)),
                scene: readScene(), errorTotals: registry.getErrorTotals(),
                // ConfigAdapter deliberately normalizes some legacy controls.
                // Retain the observed differences instead of calling them active.
                registeredOverrides: Object.fromEntries(registeredKeys.filter(key => stable(expectedConfig[key]) !== stable(ownerConfig[key])).map(key => [key, ownerConfig[key]])),
                enabledIds: registry.getEnabledIds().slice().sort(), benchmarkActive: !!Q.state.benchmarkActive, work, at: Date.now() };
        };
        const nextBlock = () => {
            block = declared.blocks[++blockIndex];
            if (!block) { finish("complete"); return; }
            condition = declared.conditions.find(item => item.id === block.conditionId); phase = 0; beginWindow();
        };
        const beginWindow = () => {
            const side = block.order[phase];
            expectedConfig = { ...configuration.baseline, ...(side === "B" ? condition.patch : {}) };
            expectedIds = configuration.apply(side === "B" ? condition.patch : {}).slice().sort();
            ownerConfig = registeredConfig(configuration.read().registered);
            const nextInstrumentation = !(condition.id === "benchmark-instrumentation" && side === "B");
            if (instrumented !== nextInstrumentation) {
                benchmark?.stop(); benchmark = null;
                if (nextInstrumentation) benchmark = scheduler.startBenchmark(declared.deadlineMs / 1000 + 60, () => {}, { quiet: true });
                instrumented = nextInstrumentation;
            }
            const invalid = current();
            if (invalid) { finish(invalid); return; }
            status = { running: true, name: condition.id, window: phase + 1, completed: result.completedBlocks,
                expected: declared.blocks.length, endAt: Date.now() + declared.settleMs + declared.sampleMs };
            if (P.isAlive(progress)) progress.text = "QOLLOCK " + (blockIndex + 1) + "/" + declared.blocks.length + " " + side + " " + condition.id;
            onProgress(status);
            schedule(declared.settleMs / 1000, () => {
                const before = proof();
                if (!before.verified) { finish(before.failures.join("; ")); return; }
                const startAt = Date.now(), endAt = startAt + declared.sampleMs;
                const guard = () => {
                    const failure = current();
                    if (failure) { finish(failure); return; }
                    if (Date.now() < endAt) { schedule(Math.min(0.5, (endAt - Date.now()) / 1000), guard); return; }
                    const stoppedAt = Date.now(), after = proof();
                    const beforeProof = "proof-" + block.trial + "-" + phase + "-before", afterProof = "proof-" + block.trial + "-" + phase + "-after";
                    // Transport and JSON conversion happen after the measured interval.
                    onPacket(beforeProof, before); onPacket(afterProof, after);
                    onWindow({ trial: block.trial, conditionId: condition.id, repeat: block.repeat, phase, side, startAt, endAt: stoppedAt, beforeProof, afterProof });
                    if (!after.verified) { finish(after.failures.join("; ")); return; }
                    if (++phase < 4) beginWindow();
                    else { result.completedBlocks++; nextBlock(); }
                };
                schedule(0.5, guard);
            });
        };
        const session = { stop: (reason = "cancelled") => finish(reason) };
        active = session; status = { running: true, completed: 0, expected: declared.blocks.length, endAt: Date.now() + 5000 };
        try {
            onPacket("context", { kind: "config-suite", plan: declared, selectedIds, baseline: configuration.baseline, canonical: configuration.canonical, manifests, registeredKeys, initialErrors,
                loadedFunctionFingerprints: { configPlan: Q.core.MinimapInvestigation.digest(plan.toString().replace(/\r\n/g, "\n")),
                    configRunner: Q.core.MinimapInvestigation.digest(start.toString().replace(/\r\n/g, "\n")),
                    configBenchmark: Q.core.MinimapInvestigation.digest(scheduler.startBenchmark.toString().replace(/\r\n/g, "\n")),
                    ...Object.fromEntries(manifests.map(owner => ["owner:" + owner.id,
                        Q.core.MinimapInvestigation.digest(registry.getManifest(owner.id).create.toString().replace(/\r\n/g, "\n"))])) },
                proofScope: "Configuration delivery, registry coverage, scene flags and benchmark accounting readback only; feature-specific render completeness and native teardown are unverified.",
                caveats: ["Conditional effects overlap and must not be summed.", "Inactive gameplay paths can hide costs; a negative finding does not clear a feature.",
                    "Canonical settings retain the mod and its static stylesheets; this is not vanilla.",
                    "Quiet benchmark accounting reproduces Scheduler statistics; the legacy benchmark's console heartbeat and final report are excluded."] });
            schedule(0.001, () => {
                progress = panels.create("Label", root, "QOLConfigInvestigationProgress");
                if (!P.isAlive(progress) || P.syncStyles(progress, { width: "750px", height: "28px", x: "20px", y: "24px",
                    fontSize: "16px", color: "#ffffff", backgroundColor: "#000000dd", zIndex: "1000" }).sig === null) throw Error("progress label unavailable");
                progress.text = "QOLLOCK 5s"; onProgress(status); schedule(5, nextBlock);
            });
        } catch (error) { finish("setup-error: " + String(error)); }
        return session;
    }
    Q.core.ConfigInvestigation = { plan, start, getStatus: () => status };
})();
