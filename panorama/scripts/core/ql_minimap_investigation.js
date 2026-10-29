// Native-first causal minimap suite. App owns the config lease; feature-owned
// probes own interventions. This module never estimates FPS from UI dispatch.
(() => {
    "use strict";
    const Q = QOL, P = Q.core.panel, Plan = Q.core.MinimapPlan;
    let active = null, status = null;
    const digest = value => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
        return (hash >>> 0).toString(16).padStart(8, "0");
    };
    function start({ root, baseline, canonical = null, selectedIds = [], onPacket = () => {}, onWindow = () => {}, onProgress = () => {}, onComplete }) {
        active?.stop("superseded");
        if (active) throw Error("a newer minimap investigation started during cleanup");
        if (!P.isAlive(root) || !baseline) throw Error("minimap HUD/config unavailable");
        const plan = Plan.create(selectedIds), registry = Q.core.FeatureRegistry, scheduler = Q.core.Scheduler;
        const originalIds = registry.getEnabledIds().slice().sort();
        if (Plan.owners.some(id => !originalIds.includes(id))) throw Error("both minimap owners must be enabled for the full suite");
        const observation = scheduler.startWorkObservation(), panels = P.createOwnedTree();
        const started = Date.now(), contextPanel = $.GetContextPanel();
        const initialErrors = registry.getErrorCounts();
        const leases = new Map(), disabledOwners = new Map();
        let disabled = [], stopped = false, timer = null, progress = null;
        let blockIndex = -1, phase = 0, block = null, condition = null, expected = null;
        let nativeIdentity = null, sceneFlags = null;
        const result = { kind: "minimap-suite", reason: "", completedBlocks: 0, invalidBlocks: [], restoreErrors: [], selectedIds: selectedIds.slice() };
        const readScene = () => {
            const core = P.findChildByClass(root, "HudCore");
            const gameplay = P.findChild(core, "gameplay_hud");
            const clamp = P.findChildByClass(gameplay, "clamp_width");
            const host = P.findChild(clamp, "minimap_persp");
            const viewport = P.findChild(host, "minimap_container");
            const renderer = P.findChild(P.findChild(viewport, "HudMinimapContainer"), "hud_minimap");
            const detail = !!host?.BHasClass("gDetailView") || Q.core.hud.isClassActive("gDetailView");
            const scoreboard = Q.core.hud.isScoreboardOpen(root, host);
            return { renderer: Q.core.minimapProbe.panelState(renderer), host: Q.core.minimapProbe.panelState(host),
                viewport: Q.core.minimapProbe.panelState(viewport), midtown: !!renderer?.BHasClass("dl_midtown"),
                view: detail ? "alt" : scoreboard ? "tab" : "normal",
                flags: ["gShopOpen", "InHideout", "connectedToHideout", "gamemode_streetbrawl"].map(key => root.BHasClass(key)) };
        };
        const current = () => {
            if (!P.isAlive(root) || $.GetContextPanel() !== contextPanel || P.findHud(contextPanel) !== root) return "HUD replaced";
            if (!observation.isActive()) return "work observation replaced";
            if (root.BHasClass("ShowEscapeMenu")) return "escape menu opened";
            const scene = readScene();
            if (!scene.renderer.present || !scene.midtown) return "Midtown minimap unavailable";
            if (scene.flags.some(Boolean)) return "shop/hideout/game-mode context is not stationary Midtown";
            const flags = JSON.stringify([scene.view, scene.flags]);
            if (nativeIdentity !== null && scene.renderer.identity !== nativeIdentity) return "native minimap replaced";
            if (sceneFlags !== null && flags !== sceneFlags) return "minimap view/scene changed";
            nativeIdentity = scene.renderer.identity; sceneFlags = flags;
            if (Date.now() - started > plan.deadlineMs) return "deadline";
            const ids = originalIds.filter(id => !disabled.includes(id));
            if (registry.getEnabledIds().slice().sort().join(",") !== ids.join(",")) return "feature coverage changed";
            const errors = registry.getErrorCounts();
            if (Object.keys(errors).some(id => errors[id] > (initialErrors[id] || 0))) return "feature callback failure";
            return "";
        };
        const restore = () => {
            let complete = true;
            const retiring = [...leases]; leases.clear();
            for (const [id, lease] of retiring) {
                try { lease.restore(); }
                catch (error) { result.restoreErrors.push(id + ": " + String(error)); complete = false; }
            }
            observation.pausePolling([]);
            const retiringIds = disabled; disabled = [];
            disabledOwners.clear();
            const sameHud = P.isAlive(root) && $.GetContextPanel() === contextPanel && P.findHud(contextPanel) === root;
            if (!sameHud) {
                result.restoreScope = "retired HUD; feature enablement belongs to App lifecycle";
                return complete;
            }
            for (const id of retiringIds) {
                try { registry.enable(id); }
                catch (error) { result.restoreErrors.push(id + ": " + String(error)); complete = false; }
            }
            return complete;
        };
        const finish = reason => {
            if (stopped) return;
            stopped = true;
            if (timer !== null) { try { $.CancelScheduled(timer); } catch (_) {} timer = null; }
            try { restore(); } finally { observation.stop(); panels.dispose(); }
            if (!result.restoreScope) for (const id of originalIds) if (!registry.isEnabled(id)) result.restoreErrors.push(id + " not restored");
            result.reason = reason;
            result.expectedBlocks = plan.blocks.length;
            result.report = "QOLLOCK native-first minimap suite: " + reason + "\nCompleted blocks: " + result.completedBlocks + "/" + plan.blocks.length +
                "\nNo UI-cadence FPS estimate. Read the external native report, context, state proofs and coverage ledger." +
                (result.restoreErrors.length ? "\nRESTORATION ERRORS: " + result.restoreErrors.join("; ") : "");
            try {
                onPacket("runner-restoration", { reason, errors: result.restoreErrors.slice(), enabledIds: registry.getEnabledIds().slice().sort(),
                    owners: Object.fromEntries(Plan.owners.map(id => [id, registry.getInstance(id)?.diagnostics?.inspect() || { active: false }])),
                    stage: "feature hooks/poll pause released; native reconstruction may still be pending, App configuration restoration follows" });
            } catch (error) { result.restoreErrors.push("restoration evidence: " + String(error)); }
            if (active === session) { active = null; status = { running: false, reason, completed: result.completedBlocks, expected: plan.blocks.length }; }
            onComplete(result);
        };
        const schedule = (seconds, callback) => {
            if (stopped) return;
            timer = $.Schedule(seconds, () => {
                timer = null;
                if (stopped) return;
                try { callback(); }
                catch (error) {
                    if (stopped) $.Msg("[QOLLOCK][Minimap investigation] completion failed: " + String(error));
                    else finish("error: " + String(error));
                }
            });
        };
        const proof = () => {
            const owners = {};
            for (const id of Plan.owners) owners[id] = { enabled: registry.isEnabled(id),
                ...(disabledOwners.has(id) ? { retirement: disabledOwners.get(id).diagnostics?.retirement?.() } : leases.get(id)?.snapshot() || {}) };
            const evidence = { applied: expected, owners, pausedPolls: Plan.owners.filter(id => observation.isPollPaused(id)), scene: readScene() };
            evidence.errors = Plan.verify(expected, evidence);
            evidence.verified = evidence.errors.length === 0;
            evidence.visibilityScope = "local visibility, native-reported bounds and tree counts; clipping/computed ancestor opacity/world camera are not proven";
            return evidence;
        };
        const nextBlock = () => {
            if (!restore()) { finish("restoration failed"); return; }
            block = plan.blocks[++blockIndex];
            if (!block) { finish("complete"); return; }
            condition = plan.conditions.find(row => row.id === block.conditionId); phase = 0;
            const inspection = registry.getInstance(Plan.owners[0])?.diagnostics?.inspect();
            const inactive = condition.requiresTarget && !inspection?.decoration?.activeTargets?.[condition.requiresTarget];
            const absent = condition.requiresRole && !inspection?.geometry?.targets?.[condition.requiresRole]?.present;
            if (inactive || absent) {
                onPacket("block-" + block.trial + "-skip", { status: absent ? "absent" : "inactive", conditionId: condition.id,
                    evidence: inspection, reason: "Target absent or corresponding native overrides inactive in the observed configuration/view; not zero cost" });
                schedule(0.01, nextBlock); return;
            }
            beginPhase();
        };
        const beginPhase = () => {
            const failure = current();
            if (failure) { finish(failure); return; }
            if (!restore()) { finish("restoration failed"); return; }
            expected = condition[block.order[phase].toLowerCase()];
            disabled = expected.ownersOff.slice();
            for (const id of disabled) { disabledOwners.set(id, registry.getInstance(id)); registry.disable(id, { automatic: true }); }
            for (const id of Plan.owners.filter(id => !disabled.includes(id))) {
                const instance = registry.getInstance(id);
                if (!instance?.diagnostics?.begin) throw Error("compiled minimap diagnostic API missing: " + id);
                const lease = instance.diagnostics.begin(); leases.set(id, lease);
                lease.apply(id === Plan.owners[0] ? expected.runtime : expected.loot);
            }
            observation.pausePolling(expected.pausedPolls);
            status = { running: true, name: condition.id, block: block.trial, repeat: block.repeat + 1,
                side: block.order[phase], window: phase + 1, completed: result.completedBlocks, expected: plan.blocks.length,
                endAt: started + plan.deadlineMs };
            if (P.isAlive(progress)) progress.text = `QOLLOCK ${block.trial}/${plan.blocks.length} ${condition.id} ${block.order[phase]}`;
            onProgress(status);
            const prepareStarted = Date.now();
            const failBlock = before => {
                result.invalidBlocks.push({ trial: block.trial, conditionId: condition.id, errors: before.errors });
                onPacket("block-" + block.trial + "-failure", { ...before, reason: "intervention not verified" });
                if (condition.id === "sham") { finish("baseline not exercisable: " + before.errors.join("; ")); return; }
                schedule(0.01, nextBlock);
            };
            const identity = evidence => JSON.stringify(Plan.owners.map(id => {
                const owner = evidence.owners[id];
                return [owner.enabled, owner.root?.identity, owner.markers?.identity, owner.tunnel?.identity, owner.counts,
                    Object.entries(owner.groups || {}).map(([key, item]) => [key, item.identity, item.children])];
            }));
            const ready = () => {
                const invalid = current();
                if (invalid) { finish(invalid); return; }
                // Successful reconciliation starts its own full warming interval.
                for (const [id, lease] of leases) lease.apply(id === Plan.owners[0] ? expected.runtime : expected.loot);
                const before = proof();
                if (!before.verified) {
                    if (Date.now() - prepareStarted < 8000) { schedule(0.25, ready); return; }
                    failBlock(before); return;
                }
                schedule(plan.settleMs / 1000, () => {
                    const failure = current();
                    if (failure) { finish(failure); return; }
                    const settled = proof(); // Read-only: no rebuild at sample start.
                    if (!settled.verified || identity(before) !== identity(settled)) {
                        if (Date.now() - prepareStarted < 8000) { ready(); return; }
                        settled.errors.push("state changed during warming"); failBlock(settled); return;
                    }
                    sample(settled);
                });
            };
            ready();
        };
        const sample = before => {
            const beforeProof = "proof-" + block.trial + "-" + phase + "-before";
            const afterProof = "proof-" + block.trial + "-" + phase + "-after";
            observation.sample();
            const startAt = Date.now();
            const guard = () => {
                const failure = current();
                if (failure) { finish(failure); return; }
                if (Date.now() - startAt < plan.sampleMs) { schedule(0.5, guard); return; }
                const endAt = Date.now(), work = observation.sample(), after = proof();
                if (work.errors) { finish("managed callback failure"); return; }
                // Transport both captured states after their measured window.
                // Before-state is immutable data, not a later native re-read.
                onPacket(beforeProof, before);
                onPacket(afterProof, { ...after, work });
                onWindow({ trial: block.trial, conditionId: condition.id, repeat: block.repeat, phase, side: block.order[phase],
                    name: condition.id, ids: Plan.owners.slice(), beforeProof, afterProof, startAt, endAt });
                phase++;
                if (phase < 4) beginPhase();
                else { result.completedBlocks++; nextBlock(); }
            };
            schedule(0.5, guard);
        };
        const session = { stop: (reason = "cancelled") => finish(reason) };
        active = session;
        status = { running: true, completed: 0, expected: plan.blocks.length, window: 0, endAt: Date.now() + 5000 };
        const functions = Object.fromEntries([...Plan.owners.map(id => [id, registry.getManifest(id).create]),
            ["geometry", Q.features.minimapGeometry.create], ["plan", Plan.create], ["verify", Plan.verify],
            ["probe", Q.core.minimapProbe.createOwner], ["runner", start], ["styleOwner", P.createNativeStyleOwner]]
            .map(([id, fn]) => [id, digest(fn.toString().replace(/\r\n/g, "\n"))]));
        const context = { kind: "minimap-suite", selectedIds: selectedIds.slice(), modVersion: Q.VERSION, baseline: { ...baseline }, canonical,
            enabledIds: originalIds, plan, loadedFunctionFingerprints: functions,
            provenanceScope: "Runtime hashes cover selected owner/geometry/plan/verifier/probe/runner/style-owner functions only; they do not prove all compiled resources, CSS or assets match local source.",
            caveats: ["Expanded configuration is an experimental context, not the user's ordinary configuration.",
                "Other owners, events, one-shots, root classes and native game rendering remain active.",
                "The external collector is one-way; planned repetitions and selected-ID reruns do not constitute automatic native-quality feedback."] };
        try { onPacket("context", context); }
        catch (error) { finish("context transport error: " + String(error)); return session; }
        schedule(0.001, () => {
            progress = panels.create("Label", root, "QOLMinimapInvestigationProgress");
            if (!P.isAlive(progress)) throw Error("progress label unavailable");
            if (P.syncStyles(progress, { width: "750px", height: "28px", x: "20px", y: "24px", fontSize: "16px",
                color: "#ffffff", backgroundColor: "#000000dd", zIndex: "1000" }).sig === null) throw Error("progress label styles rejected");
            progress.text = "QOLLOCK 5s";
            onProgress(status);
            schedule(5, () => { onPacket("scene", readScene()); nextBlock(); });
        });
        return session;
    }
    Q.core.MinimapInvestigation = { start, createPlan: Plan.create, getStatus: () => status, digest };
})();
