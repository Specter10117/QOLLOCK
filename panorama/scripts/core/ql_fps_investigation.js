// OWNS: Temporary feature exclusion trials and bounded UI-cadence observations.
// DOES NOT OWN: Engine FPS/GPU timing, persistent config, or native HUD content.
(() => {
    "use strict";
    const Q = QOL, P = Q.core.panel;
    let active = null, status = null;
    // These are existing appearance gates, applied through the App's temporary
    // configuration lease after their owner is a repeatable candidate.
    const layerSettings = {
        ql_minimap_loot: [
            ["ENABLE_MINIMAP_TOUGH_CRATES"], ["ENABLE_MINIMAP_HEALING_SNACKS"], ["ENABLE_MINIMAP_STATUES"],
            ["ENABLE_MINIMAP_CRATE_ROUTES"], ["MINIMAP_CAMP_NAMES"]
        ],
        ql_minimap_runtime: [
            ["ENABLE_MINIMAP_CRATE_OVERLAY"],
            ["ENABLE_MINIMAP_REM_TUNNELS", "ENABLE_ALT_ZOOM_REM_TUNNELS", "ENABLE_TAB_ZOOM_REM_TUNNELS"],
            ["MINIMAL_MINIMAP"], ["MINIMAP_FIXED_ICON_SIZE"]
        ]
    };
    const groupName = id => {
        if (/keyboard/.test(id)) return "Keyboard";
        if (/minimap|compass/.test(id)) return "Map and compass";
        if (/crosshair|ammo|reload|hit_marker|sigflash/.test(id)) return "Crosshair and weapon";
        if (/health|souls|topbar|bottom_bar|stats|stamina/.test(id)) return "Bars and stats";
        if (/chat|damage|combat|purchases/.test(id)) return "Combat and messages";
        return "Other owners";
    };
    const summarize = (values, work, overflow) => {
        const sorted = values.slice().sort((a, b) => a - b);
        const percentile = fraction => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
        return { samples: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
            median: percentile(0.5), p95: percentile(0.95), max: percentile(1),
            over33ms: sorted.filter(value => value > 33.33).length, overflow, work };
    };
    const assess = trial => {
        const [a, b, c, d] = trial.windows;
        const enough = trial.windows.every(window => window.samples >= 60 && !window.overflow);
        const reference = enough ? (a.mean + d.mean) / 2 : null;
        const improvementMs = enough ? reference - (b.mean + c.mean) / 2 : null;
        const drift = enough ? Math.abs(a.mean - d.mean) / reference : null;
        const consistent = enough && a.mean > b.mean && d.mean > c.mean;
        return { ...trial, referenceMs: reference, improvementMs, drift,
            confirmed: enough && drift <= 0.1 && consistent && improvementMs > Math.max(0.5, reference * 0.05),
            quality: !enough ? "insufficient samples" : drift > 0.1 ? "reference drift" : !consistent ? "inconsistent repeats" : "comparable" };
    };
    const formatReport = result => {
        const f = value => value === null ? "n/a" : value.toFixed(2);
        const visibilityOnly = result.mode === "minimap_visibility";
        const lines = [visibilityOnly ? "=== QOLLOCK static minimap visibility isolation ===" : result.mode === "minimap" ? "=== QOLLOCK minimap polling isolation ===" : "=== QOLLOCK feature exclusion investigation ===", `Result: ${result.reason} | Config: ${result.mode}`,
            "Metric: UI dispatch cadence in ms (lower is better). Engine FPS, CPU/GPU and rendering time are not measured.",
            visibilityOnly ? "Each trial: visible / hidden / hidden / visible; both minimap polls paused in every condition. Panels retained. 1s settling and 3s sampling per window." :
                result.mode === "minimap" ? "Each trial: polling / paused / paused / polling; panels retained. 1s settling and 3s sampling per window." :
                "Each trial: reference / excluded / excluded / reference, with 1s settling and 3s sampling per window.",
            "Cadence can be capped independently of game FPS. Confirm candidates using native telemetry in the same stationary scene.",
            "No effect does not clear a feature: inactive gameplay paths, UI caps and feature interactions can hide a cost.",
            `Baseline owners (${result.enabledIds.length}): ${result.enabledIds.join(", ")}`,
            "", "Candidates sorted by repeatable cadence improvement; these are leads, not proven FPS costs:"];
        for (const row of [...result.rows].sort((a, b) => (b.improvementMs || 0) - (a.improvementMs || 0))) {
            lines.push(`${row.confirmed ? "REPEATABLE" : "UNCONFIRMED"} ${row.name}: improvement=${f(row.improvementMs)}ms; reference=${f(row.referenceMs)}ms; ${row.quality}`,
                row.hideLayers ? `  Hidden static roots: ${row.hideLayers.join(", ")}; both minimap polls paused in A and B, panels retained.` :
                    row.pollPause ? `  Paused polls only: ${row.ids.join(", ")}; panels retained, events/settings/one-shots and other owners remain active.` :
                    row.patch ? `  Temporary settings: ${Object.entries(row.patch).map(([key, value]) => key + "=" + value).join(", ")}; baseline: ${Object.entries(row.baselineValues).map(([key, value]) => key + "=" + value).join(", ")}` : `  Excluded: ${row.ids.join(", ")}`);
            row.windows.forEach((window, i) => lines.push(`  ${["A", "B", "B", "A"][i]} wallStart=${window.startAt} wallEnd=${window.endAt} n=${window.samples} mean=${f(window.mean)} median=${f(window.median)} p95=${f(window.p95)} max=${f(window.max)} >33ms=${window.over33ms}; managed callbacks=${window.work.callbacks} callbackMs=${f(window.work.callbackMs)} errors=${window.work.errors}`));
        }
        if (!result.rows.some(row => row.confirmed)) lines.push("No repeatable candidate. Compare native telemetry; investigate rendering/static CSS and paths outside registered owners.");
        if (result.mode === "minimap" || visibilityOnly) {
            lines.push(visibilityOnly ? "Fixed plan: both static roots, ordinary crates only, loot only. Follow-up is independent of UI cadence." :
                "Fixed plan: both minimap owners, runtime only, loot only. Follow-up is independent of UI cadence.",
                "Events, one-shots, App/root classes, other owners and native map rendering remain active.",
                visibilityOnly ? "A native difference measures the visible static branches, including possible layout/composition work; it does not identify individual rendering calls." :
                    "No native improvement from paused polls is not proof of a rendering bottleneck; compare visible/hidden retained roots separately.");
            if (result.restoreErrors.length) lines.push("RESTORATION ERRORS: " + result.restoreErrors.join("; "));
            return lines.join("\n");
        }
        lines.push("Individual follow-up selected: " + (result.followUpIds.join(", ") || "none"));
        const checked = new Set(result.rows.filter(row => row.ids.length === 1).map(row => row.ids[0]));
        lines.push("Not checked individually: " + (result.enabledIds.filter(id => !checked.has(id)).join(", ") || "none"));
        const checkedSettings = new Set(result.rows.filter(row => row.patch).map(row => row.name));
        lines.push("Layer follow-up selected: " + (result.layerFollowUps.join("; ") || "none"));
        lines.push("Selected layers not completed: " + (result.layerFollowUps.filter(name => !checkedSettings.has(name)).join("; ") || "none"));
        if (result.restoreErrors.length) lines.push("RESTORATION ERRORS: " + result.restoreErrors.join("; "));
        lines.push("Excluding all registered owners does not unload QOLLOCK core scripts or static stylesheets.");
        return lines.join("\n");
    };
    function start({ root, mode = "current", configuration = null, onComplete, onProgress = () => {}, onWindow = () => {} }) {
        if (active) active.stop("superseded");
        if (!P.isAlive(root) || typeof $.FrameTime !== "function") throw Error("UI frame clock or HUD unavailable");
        const registry = Q.core.FeatureRegistry;
        const enabledIds = registry.getEnabledIds().slice().sort();
        const visibilityOnly = mode === "minimap_visibility";
        const minimapScan = mode === "minimap" || visibilityOnly;
        const minimapIds = ["ql_minimap_runtime", "ql_minimap_loot"];
        const minimapLayerIds = ["minimap_overlay_root", "QOLMinimapLootRoot"];
        const initialErrors = registry.getErrorCounts();
        const groups = new Map();
        for (const id of enabledIds) {
            const name = groupName(id);
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(id);
        }
        const queue = visibilityOnly ? [minimapIds, [minimapIds[0]], [minimapIds[1]]].map(ids => ({
            name: "Static minimap visibility: " + (ids.length === 2 ? "both roots" : minimapLayerIds[minimapIds.indexOf(ids[0])]) + " (both polls paused)",
            ids, hideLayers: ids.map(id => minimapLayerIds[minimapIds.indexOf(id)])
        })) : minimapScan ? [
            { name: "Minimap polling: both owners (panels retained)", ids: minimapIds, pollPause: true },
            ...minimapIds.map(id => ({ name: "Minimap polling: " + id + " (panels retained)", ids: [id], pollPause: true }))
        ] : [{ name: "All registered owners", ids: enabledIds }];
        for (const [name, ids] of minimapScan ? [] : groups) {
            for (let offset = 0; offset < ids.length; offset += 12) {
                queue.push({ name: ids.length > 12 ? name + " #" + (offset / 12 + 1) : name, ids: ids.slice(offset, offset + 12) });
            }
        }
        const baseline = configuration ? { ...configuration.baseline } : null;
        const result = { reason: "", mode, enabledIds, rows: [], restoreErrors: [], followUpIds: [], layerFollowUps: [] };
        const observation = Q.core.Scheduler.startWorkObservation();
        const layerVisibility = visibilityOnly ? P.createNativeStyleOwner({ preserveStyles: ["visibility"] }) : null;
        const panels = P.createOwnedTree();
        let progressLabel = null;
        const context = $.GetContextPanel(), started = Date.now();
        let stopped = false, timer = null, excluded = [], trial = null, windowIndex = 0, drilled = minimapScan;
        let layersDrilled = minimapScan, temporaryConfig = false, expectedIds = enabledIds;
        let nextCheck = 0, scene = null;
        let minimapPanels = null, minimapView = null;
        let hiddenLayers = [];
        // Verified hud_minimap.xml / native capture owner chain. Observe only
        // these roots; do not retain a paused tree after native replacement.
        const readMinimap = () => {
            const core = P.findChildByClass(root, "HudCore");
            const gameplay = P.findChild(core, "gameplay_hud");
            const clamp = P.findChildByClass(gameplay, "clamp_width");
            const host = P.findChild(clamp, "minimap_persp");
            const viewport = P.findChild(host, "minimap_container");
            const container = P.findChild(viewport, "HudMinimapContainer");
            const renderer = P.findChild(container, "hud_minimap");
            return [core, gameplay, clamp, host, viewport, container, renderer,
                P.findChild(renderer, "minimap_overlay_root"), P.findChild(renderer, "QOLMinimapLootRoot")];
        };
        const restore = () => {
            let restored = true;
            hiddenLayers = [];
            if (layerVisibility && !layerVisibility.clear()) {
                result.restoreErrors.push("static minimap visibility restoration pending"); restored = false;
            }
            if (minimapScan) observation.pausePolling([]);
            if (temporaryConfig) {
                try { configuration.apply({}); temporaryConfig = false; }
                catch (error) { result.restoreErrors.push("configuration: " + String(error)); restored = false; }
            }
            const retiring = excluded; excluded = [];
            for (const id of retiring) {
                try { registry.enable(id); } catch (error) { result.restoreErrors.push(id + ": " + String(error)); restored = false; }
            }
            expectedIds = enabledIds;
            return restored;
        };
        const finish = reason => {
            if (stopped) return;
            stopped = true;
            if (timer !== null) { try { $.CancelScheduled(timer); } catch (_) {} timer = null; }
            try { restore(); } finally { observation.stop(); }
            panels.dispose();
            const restored = new Set(registry.getEnabledIds());
            for (const id of enabledIds) if (!restored.has(id)) result.restoreErrors.push(id + " was not restored");
            result.reason = reason;
            result.report = formatReport(result);
            active = null; status = { running: false, reason };
            onComplete(result);
        };
        const schedule = (delay, callback) => {
            if (stopped) return;
            timer = $.Schedule(delay, () => {
                timer = null;
                if (stopped) return;
                try { callback(); } catch (error) { finish("error: " + String(error)); }
            });
        };
        const readWork = () => {
            const work = observation.sample();
            if (work.errors > 0) throw Error("managed callback failures: " + work.errors);
            return work;
        };
        const current = () => {
            if (!P.isAlive(root) || $.GetContextPanel() !== context || P.findHud(context) !== root) return "HUD replaced";
            // Current native hud.css hides HudCore while this class is active.
            if (root.BHasClass("ShowEscapeMenu")) return "escape menu opened";
            if (minimapScan) {
                if (!observation.isActive()) return "poll observation replaced";
                if (minimapIds.some(id => !enabledIds.includes(id))) return "minimap owners unavailable";
                const next = readMinimap();
                if (next.some(panel => !P.isAlive(panel))) return "minimap reference layers unavailable";
                if (minimapPanels && next.some((panel, index) => panel !== minimapPanels[index])) return "minimap replaced";
                minimapPanels = next;
                if (hiddenLayers.some(panel => panel.style.visibility !== "collapse")) return "diagnostic visibility overwritten";
                const view = [next[3].BHasClass("gDetailView"), Q.core.hud.isClassActive("gDetailView"),
                    Q.core.hud.isScoreboardOpen(root, next[3]), next[6].BHasClass("dl_midtown")].join(",");
                if (minimapView !== null && view !== minimapView) return "minimap view changed";
                minimapView = view;
            }
            const flags = ["gShopOpen", "gScoreboardOpen", "InHideout", "connectedToHideout"].map(name => root.BHasClass(name)).join(",");
            if (scene === null) scene = flags;
            else if (scene !== flags) return "HUD scene flags changed";
            if (Date.now() - started > (minimapScan ? 60000 : 420000)) return "deadline";
            const expected = expectedIds.join(",");
            if (registry.getEnabledIds().slice().sort().join(",") !== expected) return "feature coverage changed";
            const errors = registry.getErrorCounts();
            if (Object.keys(errors).some(id => errors[id] > (initialErrors[id] || 0))) return "feature callback failure";
            return "";
        };
        const beginWindow = () => {
            const failure = current();
            if (failure) { finish(failure); return; }
            if (!restore()) { finish("restoration failed"); return; }
            // Both poll callbacks stay frozen for visible AND hidden windows.
            // Only the QOL-created reference roots change visibility; native
            // map content, child identity and feature enable state are retained.
            if (visibilityOnly) observation.pausePolling(minimapIds);
            if (windowIndex === 1 || windowIndex === 2) {
                if (trial.hideLayers) {
                    for (const id of trial.hideLayers) {
                        const panel = minimapPanels[7 + minimapLayerIds.indexOf(id)];
                        if (!layerVisibility.apply(panel, { visibility: "collapse" })) throw Error("static minimap visibility rejected: " + id);
                        hiddenLayers.push(panel);
                    }
                } else if (trial.pollPause) {
                    observation.pausePolling(trial.ids);
                } else if (trial.patch) {
                    temporaryConfig = true;
                    const expected = configuration.apply(trial.patch);
                    if (!Array.isArray(expected) || expected.some(id => !enabledIds.includes(id))) throw Error("invalid temporary feature coverage");
                    expectedIds = expected.slice().sort();
                    excluded = enabledIds.filter(id => !expectedIds.includes(id));
                } else {
                    excluded = trial.ids.slice();
                    expectedIds = enabledIds.filter(id => !excluded.includes(id));
                    for (const id of excluded) registry.disable(id);
                }
            }
            status = { running: true, name: trial.name, window: windowIndex + 1, excluded: excluded.slice(),
                pausedPolls: visibilityOnly ? minimapIds.slice() : trial.pollPause && (windowIndex === 1 || windowIndex === 2) ? trial.ids.slice() : [],
                patch: trial.patch && (windowIndex === 1 || windowIndex === 2) ? { ...trial.patch } : null,
                completed: result.rows.length, endAt: Date.now() + 4000 };
            if (P.isAlive(progressLabel)) progressLabel.text = `QOLLOCK ${result.rows.length + 1} · ${["A", "B", "B", "A"][windowIndex]} · ${trial.patch ? Object.keys(trial.patch)[0] : trial.ids[0]}${trial.ids.length > 1 ? " +" + (trial.ids.length - 1) : ""}`;
            onProgress(status);
            schedule(1, sampleWindow);
        };
        const sampleWindow = () => {
            const failure = current();
            if (failure) { finish(failure); return; }
            readWork();
            const values = [], startAt = Date.now(), endAt = startAt + 3000;
            let previous = $.FrameTime(), overflow = false;
            nextCheck = Date.now() + 1000;
            const frame = () => {
                const stamp = $.FrameTime();
                const delta = (stamp - previous) * 1000;
                if (!Number.isFinite(stamp) || !Number.isFinite(delta) || delta < 0) throw Error("invalid UI frame clock");
                if (Number.isFinite(delta) && delta > 0) {
                    if (values.length < 4096) values.push(delta); else overflow = true;
                }
                previous = stamp;
                if (Date.now() >= nextCheck) {
                    const invalid = current();
                    if (invalid) { finish(invalid); return; }
                    nextCheck = Date.now() + 1000;
                }
                if (Date.now() < endAt) { schedule(0, frame); return; }
                const window = { ...summarize(values, readWork(), overflow), startAt, endAt: Date.now() };
                trial.windows.push(window);
                // Compact markers are emitted outside sampling. The native frame
                // collector joins these UTC bounds to Windows QPC Present events.
                onWindow({ trial: result.rows.length + 1, name: trial.name, ids: trial.ids, patch: trial.patch || null,
                    phase: windowIndex, startAt, endAt: window.endAt });
                windowIndex++;
                if (windowIndex < 4) { beginWindow(); return; }
                result.rows.push(assess(trial));
                if (!restore()) { finish("restoration failed"); return; }
                nextTrial();
            };
            schedule(0, frame);
        };
        const nextTrial = () => {
            if (!queue.length && !drilled) {
                drilled = true;
                const best = result.rows.filter(row => row.confirmed && row.ids.length > 1 && row.name !== "All registered owners")
                    .sort((a, b) => b.improvementMs - a.improvementMs)[0];
                if (best) for (const id of best.ids) {
                    result.followUpIds.push(id);
                    queue.push({ name: id, ids: [id] });
                }
            }
            if (!queue.length && drilled && !layersDrilled) {
                layersDrilled = true;
                if (baseline) {
                    const candidates = result.rows.filter(row => row.confirmed && row.ids.length === 1)
                        .sort((a, b) => b.improvementMs - a.improvementMs);
                    const planned = new Set();
                    for (const row of candidates) for (const keys of layerSettings[row.ids[0]] || []) {
                        const patch = Object.fromEntries(keys.filter(key => Number(baseline[key]) > 0).map(key => [key, 0]));
                        if (!Object.keys(patch).length) continue;
                        const name = row.ids[0] + ": " + Object.keys(patch).join(" + ");
                        if (planned.has(name)) continue;
                        planned.add(name); result.layerFollowUps.push(name);
                        queue.push({ name, ids: row.ids, patch,
                            baselineValues: Object.fromEntries(Object.keys(patch).map(key => [key, baseline[key]])) });
                    }
                }
            }
            const next = queue.shift();
            if (!next) { finish("complete"); return; }
            trial = { ...next, windows: [] }; windowIndex = 0; beginWindow();
        };
        const session = { stop: (reason = "cancelled") => finish(reason) };
        active = session;
        status = { running: true, name: "Close menu and keep the scene stationary", completed: 0, window: 0, endAt: Date.now() + 5000 };
        schedule(0.001, () => {
            progressLabel = panels.create("Label", root, "QOLFpsInvestigationProgress");
            if (!P.isAlive(progressLabel)) throw Error("progress panel unavailable");
            progressLabel.hittest = false; progressLabel.hittestchildren = false;
            const style = P.syncStyles(progressLabel, { width: "620px", height: "28px", x: "20px", y: "24px",
                fontSize: "16px", color: "#ffffff", backgroundColor: "#000000dd", zIndex: "1000" });
            if (style.sig === null) throw Error("progress panel styles rejected");
            progressLabel.text = "QOLLOCK · 5s · A/B/B/A";
            onProgress(status);
            schedule(5, nextTrial);
        });
        return session;
    }
    Q.core.FpsInvestigation = { start, getStatus: () => status };
})();
