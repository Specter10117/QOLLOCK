// OWNS: Temporary feature exclusion trials and bounded UI-cadence observations.
// DOES NOT OWN: Engine FPS/GPU timing, persistent config, or native HUD content.
(() => {
    "use strict";
    const Q = QOL, P = Q.core.panel;
    let active = null, status = null;
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
        const lines = ["=== QOLLOCK feature exclusion investigation ===", `Result: ${result.reason} | Config: ${result.mode}`,
            "Metric: UI dispatch cadence in ms (lower is better). Engine FPS, CPU/GPU and rendering time are not measured.",
            "Each trial: reference / excluded / excluded / reference, with 1s settling and 3s sampling per window.",
            "Cadence can be capped independently of game FPS. Confirm candidates using native telemetry in the same stationary scene.",
            "No effect does not clear a feature: inactive gameplay paths, UI caps and feature interactions can hide a cost.",
            `Baseline owners (${result.enabledIds.length}): ${result.enabledIds.join(", ")}`,
            "", "Candidates sorted by repeatable cadence improvement; these are leads, not proven FPS costs:"];
        for (const row of [...result.rows].sort((a, b) => (b.improvementMs || 0) - (a.improvementMs || 0))) {
            lines.push(`${row.confirmed ? "REPEATABLE" : "UNCONFIRMED"} ${row.name}: improvement=${f(row.improvementMs)}ms; reference=${f(row.referenceMs)}ms; ${row.quality}`,
                `  Excluded: ${row.ids.join(", ")}`);
            row.windows.forEach((window, i) => lines.push(`  ${["A", "B", "B", "A"][i]} wallStart=${window.startAt} wallEnd=${window.endAt} n=${window.samples} mean=${f(window.mean)} median=${f(window.median)} p95=${f(window.p95)} max=${f(window.max)} >33ms=${window.over33ms}; managed callbacks=${window.work.callbacks} callbackMs=${f(window.work.callbackMs)} errors=${window.work.errors}`));
        }
        if (!result.rows.some(row => row.confirmed)) lines.push("No repeatable candidate. Compare native telemetry; investigate rendering/static CSS and paths outside registered owners.");
        lines.push("Individual follow-up selected: " + (result.followUpIds.join(", ") || "none"));
        const checked = new Set(result.rows.filter(row => row.ids.length === 1).map(row => row.ids[0]));
        lines.push("Not checked individually: " + (result.enabledIds.filter(id => !checked.has(id)).join(", ") || "none"));
        if (result.restoreErrors.length) lines.push("RESTORATION ERRORS: " + result.restoreErrors.join("; "));
        lines.push("Excluding all registered owners does not unload QOLLOCK core scripts or static stylesheets.");
        return lines.join("\n");
    };
    function start({ root, mode = "current", onComplete, onProgress = () => {} }) {
        if (active) active.stop("superseded");
        if (!P.isAlive(root) || typeof $.FrameTime !== "function") throw Error("UI frame clock or HUD unavailable");
        const registry = Q.core.FeatureRegistry;
        const enabledIds = registry.getEnabledIds().slice().sort();
        const initialErrors = registry.getErrorCounts();
        const groups = new Map();
        for (const id of enabledIds) {
            const name = groupName(id);
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(id);
        }
        const queue = [{ name: "All registered owners", ids: enabledIds }];
        for (const [name, ids] of groups) {
            for (let offset = 0; offset < ids.length; offset += 12) {
                queue.push({ name: ids.length > 12 ? name + " #" + (offset / 12 + 1) : name, ids: ids.slice(offset, offset + 12) });
            }
        }
        const result = { reason: "", mode, enabledIds, rows: [], restoreErrors: [], followUpIds: [] };
        const observation = Q.core.Scheduler.startWorkObservation();
        const panels = P.createOwnedTree();
        let progressLabel = null;
        const context = $.GetContextPanel(), started = Date.now();
        let stopped = false, timer = null, excluded = [], trial = null, windowIndex = 0, drilled = false;
        let nextCheck = 0, scene = null;
        const restore = () => {
            const retiring = excluded; excluded = [];
            for (const id of retiring) {
                try { registry.enable(id); } catch (error) { result.restoreErrors.push(id + ": " + String(error)); }
            }
        };
        const finish = reason => {
            if (stopped) return;
            stopped = true;
            if (timer !== null) { try { $.CancelScheduled(timer); } catch (_) {} timer = null; }
            observation.stop(); panels.dispose(); restore();
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
            const flags = ["gShopOpen", "gScoreboardOpen", "InHideout", "connectedToHideout"].map(name => root.BHasClass(name)).join(",");
            if (scene === null) scene = flags;
            else if (scene !== flags) return "HUD scene flags changed";
            if (Date.now() - started > 420000) return "deadline";
            const expected = enabledIds.filter(id => !excluded.includes(id)).join(",");
            if (registry.getEnabledIds().slice().sort().join(",") !== expected) return "feature coverage changed";
            const errors = registry.getErrorCounts();
            if (Object.keys(errors).some(id => errors[id] > (initialErrors[id] || 0))) return "feature callback failure";
            return "";
        };
        const beginWindow = () => {
            const failure = current();
            if (failure) { finish(failure); return; }
            restore();
            if (windowIndex === 1 || windowIndex === 2) {
                excluded = trial.ids.slice();
                for (const id of excluded) registry.disable(id);
            }
            status = { running: true, name: trial.name, window: windowIndex + 1, excluded: excluded.slice(),
                completed: result.rows.length, endAt: Date.now() + 4000 };
            if (P.isAlive(progressLabel)) progressLabel.text = `QOLLOCK ${result.rows.length + 1} · ${["A", "B", "B", "A"][windowIndex]} · ${trial.ids[0]}${trial.ids.length > 1 ? " +" + (trial.ids.length - 1) : ""}`;
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
                trial.windows.push({ ...summarize(values, readWork(), overflow), startAt, endAt: Date.now() });
                windowIndex++;
                if (windowIndex < 4) { beginWindow(); return; }
                result.rows.push(assess(trial));
                restore(); nextTrial();
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
