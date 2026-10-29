// =============================================================================
// QOLLOCK — ui/dev_tab.js
// =============================================================================
// OWNS:        Developer, Performance & Diagnostics settings tab:
//              Performance debugging toggles & overlay opacity sliders,
//              Feature Isolation Test (FIT) execution & diagnostic polling,
//              Manifest In-Game Test Suite runner (Phase T2),
//              Live HUD panel tree dump to console for headless profiler,
//              Full test suite runner & compact clipboard report generation,
//              Preset cycle stress test & auto-disable verification,
//              Diagnostic log dump & clipboard copy,
//              Dev tab rendering and window manager registration.
// DOES NOT OWN: HUD-side diagnostic gathering (core/ql_manifest_tests.js, ql_bridge.js),
//               Config persistence (core/ql_config_store.js).
// DEPENDS ON:  core/ql_namespace.js, ui/config_tab.js, ui/presets.js
// USED BY:     hud_escape_menu.xml, ui/window.js, ql_settings.js
// =============================================================================

(() => {
    "use strict";

    const Q = (typeof globalThis !== "undefined" && globalThis.QOL)
        ? globalThis.QOL
        : (typeof QOL !== "undefined" ? QOL : (globalThis.QOL = {}));
    Q.ui = Q.ui || {};

    const warnLog = (category, msg) => {
        if (typeof globalThis.WarnLog === "function") {
            globalThis.WarnLog(category, msg);
        } else {
            $.Msg(`[QOLLock][WARN][${category}] ${msg}`);
        }
    };

    const isAlive = Q.core.panel.isAlive;
    const localize = text => globalThis.LocalizeSettingsText(text, true);
    const format = (text, values) => Q.ui.theme.FormatSettingsText(text, values);

    // =========================================================================
    // HUD Bridge Panel Resolver
    // =========================================================================

    function findHudPanel() {
        try {
            let ctx = $.GetContextPanel();
            while (ctx && ctx.GetParent && ctx.GetParent()) {
                ctx = ctx.GetParent();
            }
            return (ctx && ctx.FindChildTraverse) ? ctx.FindChildTraverse("Hud") : null;
        } catch {
            return null;
        }
    }

    function diagnosticBusy(statusLabel) {
        if (!(fitRunning || pcRunning || bmRunning || mtRunning || auditRunning || fsRunning || Q.ui.visualCheck?.isRunning())) return false;
        if (isAlive(statusLabel)) statusLabel.text = localize("Another developer test is running.");
        return true;
    }

    function diagnosticFailures(diag) {
        return [...new Set([...(diag.disabled || []),
            ...Object.keys(diag.newErrors || {}).filter(id => diag.newErrors[id] > 0)])];
    }

    // Both config tests publish temporary values through the existing save path.
    // Keep newer user edits while rolling back the values owned by the test.
    function captureConfigTest(statusLabel, actionBtn) {
        const config = Q.getSettingsConfig();
        const original = { ...config };
        const context = $.GetContextPanel();
        const hud = findHudPanel();
        let expected = { ...config };
        const remember = () => { expected = { ...config }; };
        const ownsConfig = () => Q.getSettingsConfig() === config && $.GetContextPanel() === context;
        const restore = () => {
            if (!ownsConfig()) return;
            const restored = { ...original };
            for (const key of new Set([...Object.keys(config), ...Object.keys(expected)])) {
                if (Object.is(config[key], expected[key])) continue;
                if (Object.prototype.hasOwnProperty.call(config, key)) restored[key] = config[key];
                else delete restored[key];
            }
            for (const key of Object.keys(config)) delete config[key];
            Object.assign(config, restored);
            globalThis.SaveAndSync();
            remember();
        };
        return { config, restore, remember,
            current: () => ownsConfig() && isAlive(context) && isAlive(statusLabel) && isAlive(actionBtn) &&
                isAlive(hud) && findHudPanel() === hud && JSON.stringify(config) === JSON.stringify(expected) };
    }

    // =========================================================================
    // Report Formatter
    // =========================================================================

    function formatTestSuiteReport(diag) {
        if (!diag) return "";
        const lines = ["=== QOLLOCK Observation Report ==="];

        if (diag.testResults && diag.testResults.summary) {
            lines.push("", diag.testResults.report || "Observation report unavailable; coverage unknown.");
        }

        lines.push("");
        lines.push("-- Old Features --");
        lines.push(`Loaded: ${diag.features ? diag.features.length : "?"} | Auto-disabled: ${diag.disabled ? diag.disabled.length : 0}`);
        if (diag.disabled && diag.disabled.length > 0) {
            for (let di = 0; di < diag.disabled.length; di++) {
                lines.push(`  OFF: ${diag.disabled[di]}`);
            }
        }

        if (diag.newFeatures) {
            lines.push("");
            lines.push("-- Manifests --");
            lines.push(`Registered: ${diag.newFeatures.length} | Enabled: ${diag.newEnabled ? diag.newEnabled.length : 0}`);
            if (diag.newErrors) {
                const neKeys = Object.keys(diag.newErrors);
                let neCount = 0;
                for (let nek = 0; nek < neKeys.length; nek++) {
                    if (diag.newErrors[neKeys[nek]] > 0) neCount++;
                }
                lines.push(`Manifests with errors: ${neCount}`);
                if (neCount > 0) {
                    for (let nek2 = 0; nek2 < neKeys.length; nek2++) {
                        const ek = neKeys[nek2];
                        const ec = diag.newErrors[ek];
                        if (ec > 0) lines.push(`  ${ek}: ${ec} errors`);
                    }
                }
            }
        }

        const logs = diag.logs || [];
        const filtered = [];
        const seen = {};
        for (let li = 0; li < logs.length; li++) {
            const msg = String(logs[li] || "");
            if (msg.indexOf("[QOLLock]") === -1) continue;
            if (msg.indexOf("[QOLLock][TRACE]") !== -1) continue;
            if (msg.indexOf("[QOL DEBUG]") !== -1) continue;
            if (msg.indexOf("[QOLLock][INFO]") !== -1) continue;
            const delimIdx = msg.indexOf("] ");
            const dedup = delimIdx !== -1 ? msg.substring(delimIdx + 2) : msg;
            if (seen[dedup]) {
                seen[dedup]++;
                continue;
            }
            seen[dedup] = 1;
            filtered.push(msg);
        }
        if (filtered.length > 0) {
            lines.push("");
            lines.push(`-- QOLLOCK Messages (${filtered.length} unique) --`);
            for (let fi = 0; fi < filtered.length; fi++) {
                const dm = filtered[fi];
                const delimIdx = dm.indexOf("] ");
                const key = delimIdx !== -1 ? dm.substring(delimIdx + 2) : dm;
                const ddup = seen[key] || 1;
                lines.push(dm + (ddup > 1 ? ` (x${ddup})` : ""));
            }
        }

        return lines.join("\n");
    }

    function observationStatus(diag) {
        const result = diag.testResults;
        const s = result.summary;
        const audit = result.engineAudit;
        let runtimeErrors = 0;
        for (const id of Object.keys(diag.newErrors || {})) runtimeErrors += diag.newErrors[id] || 0;
        runtimeErrors = Math.max(runtimeErrors, audit?.runtimeErrors || 0, diagnosticFailures(diag).length);
        const errors = s.errors + runtimeErrors + (audit?.readErrors || 0) + (audit?.bridgeErrors || 0);
        const unchecked = s.skipped + s.notRun;
        const incomplete = result.aborted || s.total === 0 || (audit && !audit.hudFound) || !result.report;
        return {
            text: format("Hooks: {passed}/{total} OK, {failed} failed, {errors} errors, {unchecked} unchecked{incomplete}", {
                passed: s.passed, total: s.total, failed: s.failed, errors, unchecked,
                incomplete: incomplete ? localize(" (incomplete)") : ""
            }),
            color: (s.failed > 0 || errors > 0) ? "#cc4444" : (unchecked > 0 || incomplete) ? "#cc8844" : "#aaaaaa"
        };
    }

    // =========================================================================
    // Feature Isolation Test (FIT)
    // =========================================================================

    let fitRunning = false;
    let fitToken = 0;
    let fitRestore = null;

    function runFeatureIsolationTest(statusLabel, actionBtn) {
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize(text);
                statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        if (fitRunning) {
            fitRunning = false;
            fitToken++;
            const restore = fitRestore;
            fitRestore = null;
            if (restore) restore();
            setStatus("Stopped", "#aa8844");
            setBtnActive(false);
            return;
        }

        if (diagnosticBusy(statusLabel)) return;
        const testQueue = Q.settingsFields.filter(field => field.kind === "toggle")
            .map(field => field.key).sort();

        if (testQueue.length === 0) {
            setStatus("No toggle keys found", "#cc4444");
            return;
        }

        const session = captureConfigTest(statusLabel, actionBtn);
        const modCfg = session.config;
        const saveAndSync = (typeof SaveAndSync === "function") ? SaveAndSync : () => {};
        const restore = session.restore;
        fitRestore = restore;

        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let index = 0;
        const token = ++fitToken;
        fitRunning = true;
        setBtnActive(true);
        setStatus("Starting...", "#66cc99");

        function runNext() {
            if (!fitRunning || token !== fitToken) return;
            if (!session.current()) { stop(); return; }
            if (index >= testQueue.length) {
                fitRunning = false;
                setBtnActive(false);
                fitRestore = null;
                restore();
                const color = (failed > 0) ? "#cc8844" : "#66cc99";
                setStatus(format("Done: {passed} passed, {failed} failed, {skipped} skipped", { passed, failed, skipped }), color);
                $.Msg(`[QOLLock][FeatureTest] Complete — ${passed} passed, ${failed} failed, ${skipped} skipped`);
                return;
            }

            const entry = testQueue[index];
            const label = `[${index + 1}/${testQueue.length}] ${entry}`;
            setStatus(label, "#66cc99");

            try {
                modCfg[entry] = Number(modCfg[entry]) === 1 ? 0 : 1;
                try { saveAndSync(); } finally { session.remember(); }

                const forceToken = `fit_${token}_${index}`;
                const hudPanel = findHudPanel();
                if (hudPanel && hudPanel.SetAttributeString) {
                    try { hudPanel.SetAttributeString("QOL_DiagRequest", forceToken); } catch (e) {
                        warnLog("settings", `FIT write failed: ${e?.message || e}`);
                    }
                    $.Msg(`[QOLLock][FeatureTest] force-sync token written: ${forceToken} → polling for diag echo`);
                } else {
                    warnLog("settings", "FeatureTest cannot write force-sync token — Hud panel not found");
                }

                const pollStartMs = Date.now();
                let pollAttempts = 0;

                function pollFitDiag() {
                    pollAttempts++;
                    if (!fitRunning || token !== fitToken) return;
                    if (!session.current()) { stop(); return; }

                    const nowMs = Date.now();
                    if ((nowMs - pollStartMs) > 5500) {
                        skipped++;
                        $.Msg(`[QOLLock][FeatureTest] SKIP: ${entry} — diagnostic sync timeout`);
                        restore();
                        index++;
                        $.Schedule(0.08, runNext);
                        return;
                    }

                    const hud = findHudPanel();
                    let rawDiag = "";
                    if (hud && hud.GetAttributeString) {
                        try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
                    }
                    if (rawDiag) {
                        try {
                            const diag = JSON.parse(rawDiag);
                            if (diag.diagToken === forceToken) {
                                const disabledFeatures = diagnosticFailures(diag);
                                if (disabledFeatures.length > 0) {
                                    failed++;
                                    $.Msg(`[QOLLock][FeatureTest] FAIL: ${entry} → diagnostic errors: ${disabledFeatures.join(", ")}`);
                                } else {
                                    passed++;
                                }

                                restore();

                                index++;
                                $.Schedule(0.08, runNext);
                                return;
                            }
                        } catch {}
                    }
                    const interval = pollAttempts < 5 ? 0.1 : (pollAttempts < 15 ? 0.2 : 0.4);
                    $.Schedule(interval, pollFitDiag);
                }
                $.Schedule(0.15, pollFitDiag);
            } catch (e) {
                failed++;
                $.Msg(`[QOLLock][FeatureTest] FAIL: ${entry} threw: ${e?.message || e}`);
                restore();
                index++;
                $.Schedule(0.08, runNext);
            }
        }
        function stop() {
            fitRunning = false;
            fitToken++;
            fitRestore = null;
            restore();
            setBtnActive(false);
            setStatus("Stopped", "#aa8844");
        }
        $.Schedule(0.1, runNext);
    }

    // =========================================================================
    // Manifest Test Runner (Phase T2)
    // =========================================================================

    let mtRunning = false;
    let mtToken = 0;

    function runManifestTests(statusLabel, actionBtn) {
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize(text);
                statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        if (mtRunning) {
            mtRunning = false;
            mtToken++;
            setStatus("Cancelled", "#aa8844");
            setBtnActive(false);
            return;
        }
        if (diagnosticBusy(statusLabel)) return;

        const token = ++mtToken;
        mtRunning = true;
        setBtnActive(true);
        setStatus("Starting...", "#66cc99");

        const forceToken = `mt_${token}_${Date.now()}`;
        const hudPanel = findHudPanel();
        if (hudPanel && hudPanel.SetAttributeString) {
            try { hudPanel.SetAttributeString("QOL_DiagRequest", forceToken); } catch {}
            $.Msg(`[QOLLock][ManifestTests] force-sync token: ${forceToken}`);
        } else {
            setStatus("Hud panel not found", "#cc4444");
            mtRunning = false;
            setBtnActive(false);
            return;
        }

        const pollStartMs = Date.now();
        let pollAttempts = 0;

        function pollResults() {
            pollAttempts++;
            if (!mtRunning || token !== mtToken) return;

            const elapsedMs = Date.now() - pollStartMs;
            if (elapsedMs > 6000) {
                setStatus("Timeout — no result within 6s", "#cc4444");
                mtRunning = false;
                setBtnActive(false);
                return;
            }

            const hud = findHudPanel();
            let rawDiag = "";
            if (hud && hud.GetAttributeString) {
                try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
            }
            if (rawDiag) {
                try {
                    const diag = JSON.parse(rawDiag);
                    if (diag.testResults && diag.testResults.token === forceToken) {
                        const status = observationStatus(diag);
                        const statusText = status.text;
                        const ts = diag.testResults.summary;
                        setStatus(statusText, status.color);
                        mtRunning = false;
                        setBtnActive(false);

                        $.Msg("[QOLLock][ManifestTests] === RESULTS ===");
                        $.Msg(`[QOLLock][ManifestTests] ${statusText}`);
                        if (ts.failed > 0 || ts.errors > 0) {
                            const trs = diag.testResults.results || [];
                            for (let ri = 0; ri < trs.length; ri++) {
                                const r = trs[ri];
                                if (r.passed === false || r.error) {
                                    $.Msg(`[QOLLock][ManifestTests] FAIL: ${r.id} [${r.name}]${r.message ? `: ${r.message}` : ""}`);
                                }
                            }
                        }
                        const setFeedback = Q.ui?.configTab?.setLocalizedConfigFeedbackMessage || globalThis.SetLocalizedConfigFeedbackMessage;
                        if (typeof setFeedback === "function") {
                            setFeedback(statusText, "info", 5000);
                        }
                        return;
                    }
                } catch {}
            }

            const interval = pollAttempts < 10 ? 0.1 : (pollAttempts < 30 ? 0.2 : 0.4);
            $.Schedule(interval, pollResults);
        }
        $.Schedule(0.2, pollResults);
    }

    // =========================================================================
    // Panel Tree Dump & HUD State Recording
    // =========================================================================

    function requestPanelTreeDump(statusLabel) {
        if (diagnosticBusy(statusLabel)) return false;
        const hudPanel = findHudPanel();
        if (!hudPanel || !hudPanel.SetAttributeString) {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize("Hud panel not found");
                statusLabel.style.color = "#cc4444";
            }
            return false;
        }
        const forceToken = `dt_${Date.now()}`;
        try {
            hudPanel.SetAttributeString("QOL_DiagRequest", forceToken);
        } catch (e) {
            warnLog("settings", `TreeDump request failed: ${e?.message || e}`);
            if (isAlive(statusLabel)) {
                statusLabel.text = localize("Request failed");
                statusLabel.style.color = "#cc4444";
            }
            return false;
        }
        $.Msg(`[QOLLock][TreeDump] requested, token: ${forceToken}`);
        if (isAlive(statusLabel)) {
            statusLabel.text = localize("Dumped to console log");
            statusLabel.style.color = "#66cc99";
        }
        const setFeedback = Q.ui?.configTab?.setLocalizedConfigFeedbackMessage || globalThis.SetLocalizedConfigFeedbackMessage;
        if (typeof setFeedback === "function") {
            setFeedback("Panel tree written to console log", "success", 5000);
        }
        return true;
    }

    function requestHudStateObservation(statusLabel) {
        if (diagnosticBusy(statusLabel)) return;
        const localize = text => globalThis.LocalizeSettingsText(text, true);
        const hud = findHudPanel();
        if (!isAlive(hud)) {
            if (isAlive(statusLabel)) statusLabel.text = localize("Open settings with a live HUD");
            return;
        }
        hud.SetAttributeString("QOL_DiagRequest", `state_${Date.now()}`);
        if (isAlive(statusLabel)) statusLabel.text = localize("Running");
        Q.ui.window.setOpen(false);
        $.DispatchEvent("CitadelResumePlaying", $.GetContextPanel());
    }

    function copyHudStateObservation(container, statusLabel) {
        const localize = text => globalThis.LocalizeSettingsText(text, true);
        let observation = null;
        try { observation = JSON.parse(findHudPanel()?.GetAttributeString("QOL_Diag", "") || "{}").hudStateObservation; } catch (_) {}
        if (!observation?.report) {
            if (isAlive(statusLabel)) statusLabel.text = localize("No completed HUD state recording yet.");
            return;
        }
        const entry = Q.core.panel.create("TextEntry", container, "HudStateCopyEntry");
        if (!entry) return;
        entry.maxchars = observation.report.length + 100;
        entry.multiline = true;
        entry.text = observation.report;
        const copied = Q.ui.configTab.tryCopyTextToClipboard(observation.report, entry);
        Q.core.panel.delete(entry);
        if (isAlive(statusLabel)) statusLabel.text = localize(copied ? "HUD state report copied." : "Copy failed; see the console log.");
    }

    // =========================================================================
    // In-Game Engine Audit Runner (Spews directly to console ~)
    // =========================================================================

    let auditRunning = false;
    let auditToken = 0;

    function runInGameEngineAudit(container, statusLabel, actionBtn) {
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize(text);
                statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        if (diagnosticBusy(statusLabel)) return;
        const token = ++auditToken;
        auditRunning = true;
        setBtnActive(true);
        setStatus("Auditing...", "#66cc99");

        // Collect only in the HUD realm. A local settings audit cannot verify it.
        const forceToken = `audit_${token}_${Date.now()}`;
        const hudPanel = findHudPanel();
        try {
            if (!hudPanel || !hudPanel.SetAttributeString) throw new Error("HUD panel not found");
            hudPanel.SetAttributeString("QOL_DiagRequest", forceToken);
        } catch (e) {
            setStatus(format("Audit not started: {error}", { error: e.message || e }), "#cc4444");
            auditRunning = false;
            setBtnActive(false);
            return;
        }

        // 3. Poll for result and copy report
        const pollStartMs = Date.now();
        let pollAttempts = 0;

        function pollAuditResults() {
            pollAttempts++;
            if (!auditRunning || token !== auditToken) return;

            const elapsedMs = Date.now() - pollStartMs;
            if (elapsedMs > 6000) {
                setStatus("Timeout — no HUD report within 6s", "#cc4444");
                auditRunning = false;
                setBtnActive(false);
                return;
            }

            const hud = findHudPanel();
            let rawDiag = "";
            if (hud && hud.GetAttributeString) {
                try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
            }
            if (rawDiag) {
                try {
                    const diag = JSON.parse(rawDiag);
                    if (diag.testResults && diag.testResults.token === forceToken) {
                        const report = formatTestSuiteReport(diag);
                        const hiddenEntry = $.CreatePanel("TextEntry", container, "AuditCopyTextEntry");
                        hiddenEntry.text = report;
                        hiddenEntry.multiline = true;
                        hiddenEntry.maxchars = Math.max(report.length + 100, 1000);

                        const tryCopy = Q.ui?.configTab?.tryCopyTextToClipboard || globalThis.TryCopyTextToClipboard;
                        const copied = typeof tryCopy === "function" && tryCopy(report, hiddenEntry);
                        if (isAlive(hiddenEntry)) {
                            try { hiddenEntry.DeleteAsync(0); } catch {}
                        }

                        const status = observationStatus(diag);
                        setStatus(format("{status} ({copy})", { status: status.text, copy: localize(copied ? "copied" : "copy failed; check ~") }), (copied || status.color === "#cc4444") ? status.color : "#cc8844");
                        auditRunning = false;
                        setBtnActive(false);
                        return;
                    }
                } catch {}
            }

            const interval = pollAttempts < 10 ? 0.1 : 0.3;
            $.Schedule(interval, pollAuditResults);
        }

        $.Schedule(0.2, pollAuditResults);
    }

    // =========================================================================
    // Full Test Suite Runner & Clipboard Copy
    // =========================================================================

    let fsRunning = false;
    let fsToken = 0;

    function runFullTestSuite(container, statusLabel, actionBtn) {
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize(text);
                statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        if (diagnosticBusy(statusLabel)) return;
        const token = ++fsToken;
        fsRunning = true;
        setBtnActive(true);
        setStatus("Running...", "#66cc99");

        const forceToken = `fs_${token}_${Date.now()}`;
        const hudPanel = findHudPanel();
        if (!hudPanel || !hudPanel.SetAttributeString) {
            setStatus("Hud panel not found", "#cc4444");
            fsRunning = false;
            setBtnActive(false);
            return;
        }

        try { hudPanel.SetAttributeString("QOL_DiagRequest", forceToken); } catch {}

        const pollStartMs = Date.now();
        let pollAttempts = 0;

        function pollSuiteResults() {
            pollAttempts++;
            if (!fsRunning || token !== fsToken) return;

            const elapsedMs = Date.now() - pollStartMs;
            if (elapsedMs > 8000) {
                setStatus("Timeout (8s)", "#cc4444");
                fsRunning = false;
                setBtnActive(false);
                return;
            }

            const hud = findHudPanel();
            let rawDiag = "";
            if (hud && hud.GetAttributeString) {
                try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
            }
            if (rawDiag) {
                try {
                    const diag = JSON.parse(rawDiag);
                    if (diag.testResults && diag.testResults.token === forceToken) {
                        const report = formatTestSuiteReport(diag);
                        const hiddenEntry = $.CreatePanel("TextEntry", container, "FullSuiteCopyTextEntry");
                        hiddenEntry.text = report;
                        hiddenEntry.multiline = true;
                        hiddenEntry.maxchars = Math.max(report.length + 100, 1000);

                        const tryCopy = Q.ui?.configTab?.tryCopyTextToClipboard || globalThis.TryCopyTextToClipboard;
                        const copied = (typeof tryCopy === "function")
                            ? tryCopy(report, hiddenEntry)
                            : false;

                        if (isAlive(hiddenEntry)) {
                            try { hiddenEntry.DeleteAsync(0); } catch {}
                        }

                        const status = observationStatus(diag);
                        setStatus(format("{status} ({copy})", { status: status.text, copy: localize(copied ? "copied" : "copy failed") }), (copied || status.color === "#cc4444") ? status.color : "#cc8844");
                        fsRunning = false;
                        setBtnActive(false);
                        return;
                    }
                } catch {}
            }

            const interval = pollAttempts < 10 ? 0.1 : (pollAttempts < 30 ? 0.2 : 0.4);
            $.Schedule(interval, pollSuiteResults);
        }
        $.Schedule(0.3, pollSuiteResults);
    }

    // =========================================================================
    // In-Game 10s Performance Benchmark & Clipboard Copy
    // =========================================================================

    let bmRunning = false;
    let bmToken = 0;

    function runInGameBenchmark(container, statusLabel, actionBtn, isStressTest) {
        const isScan = isStressTest === "fps_current" || isStressTest === "fps_expanded";
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                const translated = localize(text);
                if (statusLabel.text !== translated) statusLabel.text = translated;
                if (statusLabel.style.color !== color) statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        if (diagnosticBusy(statusLabel)) return;
        const token = ++bmToken;
        bmRunning = true;
        setBtnActive(true);

        const durSec = isScan ? 420 : 10;
        const modeStr = isStressTest ? "stress" : "normal";
        const forceToken = isScan ? `${isStressTest}_${Date.now()}` : `bm_${durSec}_${modeStr}_${Date.now()}`;

        const hudPanel = findHudPanel();
        if (!hudPanel || !hudPanel.SetAttributeString) {
            setStatus("Hud panel not found", "#cc4444");
            bmRunning = false;
            setBtnActive(false);
            return;
        }

        try {
            hudPanel.SetAttributeString("QOL_DiagRequest", forceToken);
            $.Msg(`[QOLLock][DevTab] Requesting ${durSec}s ${modeStr} benchmark (token: ${forceToken})...`);
        } catch {}

        const startTime = Date.now();
        setStatus(isScan ? "Close the menu within 5 seconds and keep the scene stationary." :
            format("Benchmarking: {seconds}s left...", { seconds: durSec }), "#66cc99");

        function pollBenchmark() {
            if (!bmRunning || token !== bmToken) return;

            const elapsedMs = Date.now() - startTime;
            const elapsedSec = Math.floor(elapsedMs / 1000);
            const remaining = Math.max(0, durSec - elapsedSec);

            if (isScan) {
                setStatus("Investigation running. Opening Esc stops the scan.", "#66cc99");
            } else if (remaining > 0) {
                setStatus(format("Benchmarking: {seconds}s left...", { seconds: remaining }), "#66cc99");
            } else {
                setStatus("Finalizing report...", "#66cc99");
            }

            if (elapsedMs > (durSec + 6) * 1000) {
                $.Msg(`[QOLLock][DevTab][WARN] Benchmark timeout reached for ${forceToken} after ${Math.floor(elapsedMs / 1000)}s.`);
                setStatus("Benchmark timeout", "#cc4444");
                bmRunning = false;
                setBtnActive(false);
                return;
            }

            const hud = findHudPanel();
            let rawDiag = "";
            if (hud && hud.GetAttributeString) {
                try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
            }
            if (rawDiag) {
                try {
                    const diag = JSON.parse(rawDiag);
                    if (diag.benchmark && diag.benchmark.token === forceToken) {
                        const report = diag.benchmark.report || "";
                        const hiddenEntry = $.CreatePanel("TextEntry", container, "BenchmarkCopyTextEntry");
                        hiddenEntry.text = report;
                        hiddenEntry.multiline = true;
                        hiddenEntry.maxchars = Math.max(report.length + 100, 2000);

                        const tryCopy = Q.ui?.configTab?.tryCopyTextToClipboard || globalThis.TryCopyTextToClipboard;
                        const copied = (typeof tryCopy === "function") ? tryCopy(report, hiddenEntry) : false;

                        if (isAlive(hiddenEntry)) {
                            try { hiddenEntry.DeleteAsync(0); } catch {}
                        }

                        const stats = diag.benchmark.stats || {};
                        const totalJs = (typeof stats.totalJsMs === "number") ? stats.totalJsMs.toFixed(1) : "?";
                        const setFeedback = Q.ui?.configTab?.setLocalizedConfigFeedbackMessage || globalThis.SetLocalizedConfigFeedbackMessage;

                        $.Msg(`[QOLLock][DevTab] Benchmark finished: ${totalJs}ms in timed poll callbacks over ${durSec}s. Report ${copied ? "copied to clipboard" : "printed to console"}.`);

                        if (isScan) {
                            setStatus("Investigation finished. Check console or clipboard.", "#e6b800");
                        } else if (copied) {
                            setStatus(format("Copied! {milliseconds}ms callbacks (Check ~)", { milliseconds: totalJs }), "#66cc99");
                            if (typeof setFeedback === "function") {
                                setFeedback("Benchmark report copied to clipboard!", "success", 4000);
                            }
                        } else {
                            setStatus(format("Done: {milliseconds}ms callbacks (Check ~)", { milliseconds: totalJs }), "#e6b800");
                            if (typeof setFeedback === "function") {
                                setFeedback("Benchmark finished! Check console (~).", "info", 4000);
                            }
                        }

                        bmRunning = false;
                        setBtnActive(false);
                        $.Schedule(6.0, () => {
                            if (!bmRunning) setStatus("Idle", "#666");
                        });
                        return;
                    }
                } catch (_) {}
            }

            $.Schedule(0.5, pollBenchmark);
        }

        $.Schedule(0.5, pollBenchmark);
    }

    // =========================================================================
    // Preset Cycle (Robust)
    // =========================================================================

    let pcRunning = false;
    let pcToken = 0;
    let pcResults = [];
    let pcRestore = null;

    function runPresetCycle(statusLabel, actionBtn) {
        const setStatus = (text, color) => {
            if (isAlive(statusLabel)) {
                statusLabel.text = localize(text);
                statusLabel.style.color = color;
            }
        };

        const setBtnActive = (active) => {
            if (isAlive(actionBtn)) {
                actionBtn.SetHasClass("CycleActive", Boolean(active));
            }
        };

        const setFeedback = Q.ui?.configTab?.setLocalizedConfigFeedbackMessage || globalThis.SetLocalizedConfigFeedbackMessage;

        if (pcRunning) {
            pcRunning = false;
            pcToken++;
            const restore = pcRestore;
            pcRestore = null;
            if (restore) restore();
            setBtnActive(false);
            const done = pcResults.length;
            const presetsForTotal = (typeof PRESETS !== "undefined" && PRESETS) ? PRESETS : ((typeof globalThis !== "undefined" && (globalThis.QOL_PRESETS || globalThis.PRESETS)) ? (globalThis.QOL_PRESETS || globalThis.PRESETS) : {});
            const total = Object.keys(presetsForTotal).length;
            setStatus(format("Stopped ({done} of {total})", { done, total }), "#aa8844");
            if (typeof setFeedback === "function") {
                setFeedback(format("Stopped ({done} of {total})", { done, total }), "info", 2400);
            }
            return;
        }
        if (diagnosticBusy(statusLabel)) return;

        const presetsObj = (typeof PRESETS !== "undefined" && PRESETS) ? PRESETS : ((typeof globalThis !== "undefined" && (globalThis.QOL_PRESETS || globalThis.PRESETS)) ? (globalThis.QOL_PRESETS || globalThis.PRESETS) : {});
        const presetNames = Object.keys(presetsObj).sort();
        if (presetNames.length === 0) {
            setStatus("No presets found.", "#cc4444");
            return;
        }
        const session = captureConfigTest(statusLabel, actionBtn);
        pcRestore = session.restore;

        pcRunning = true;
        pcResults = [];
        let index = 0;
        const token = ++pcToken;
        setBtnActive(true);
        setStatus("Starting...", "#66cc99");
        $.Msg(`[QOLLock][presetCycle] Starting robust cycle: ${presetNames.length} presets`);

        function runNext() {
            if (!pcRunning || token !== pcToken) return;
            if (!session.current()) { stop(); return; }

            if (index >= presetNames.length) {
                pcRunning = false;
                pcRestore = null;
                session.restore();
                setBtnActive(false);
                let passed = 0;
                let failed = 0;
                const failNames = [];
                for (let ri = 0; ri < pcResults.length; ri++) {
                    if (pcResults[ri].passed) {
                        passed++;
                    } else {
                        failed++;
                        const why = (pcResults[ri].autoDisabled && pcResults[ri].autoDisabled.length > 0)
                            ? pcResults[ri].autoDisabled.join(",")
                            : (pcResults[ri].timeout ? "timeout" : (pcResults[ri].exception ? "exception" : "unknown"));
                        failNames.push(`${pcResults[ri].name} (${why})`);
                    }
                }
                const summaryColor = (failed > 0) ? "#cc8844" : "#66cc99";
                const summary = format("Done: {passed} passed, {failed} failed", { passed, failed });
                setStatus(summary, summaryColor);
                $.Msg(`[QOLLock][presetCycle] === SUMMARY: ${summary} ===`);
                if (failNames.length > 0) {
                    $.Msg(`[QOLLock][presetCycle] FAILURES: ${failNames.join("; ")}`);
                }

                let totalMs = 0;
                let minMs = Infinity;
                let maxMs = 0;
                for (let ti = 0; ti < pcResults.length; ti++) {
                    if (pcResults[ti].timeMs > 0) {
                        totalMs += pcResults[ti].timeMs;
                        if (pcResults[ti].timeMs < minMs) minMs = pcResults[ti].timeMs;
                        if (pcResults[ti].timeMs > maxMs) maxMs = pcResults[ti].timeMs;
                    }
                }
                if (pcResults.length > 0 && minMs < Infinity) {
                    const avgMs = Math.round(totalMs / pcResults.length);
                    $.Msg(`[QOLLock][presetCycle] Timing: avg=${avgMs}ms, min=${minMs}ms, max=${maxMs}ms, total=${(totalMs / 1000).toFixed(1)}s`);
                }
                if (typeof setFeedback === "function") {
                    setFeedback(`${summary} (${totalMs > 0 ? (totalMs / 1000).toFixed(1) + "s" : "N/A"})`, (failed > 0 ? "warn" : "success"), 5000);
                }
                return;
            }

            const presetName = presetNames[index];
            const startMs = Date.now();
            const forceToken = `pc_${token}_${index}`;
            const label = `[${index + 1}/${presetNames.length}] ${presetName}`;
            setStatus(`${label} …`, "#66cc99");

            let applyOk = true;
            let applyErr = "";
            try {
                // Resolve the current preset without changing runtime preset-name
                // bookkeeping or rebuilding the card that owns this test.
                const candidate = Q.ui.presets.buildPresetCandidateConfigByName(presetName);
                if (!candidate || !Q.ui.presets.applyPresetConfig(candidate)) throw new Error("Preset not available");
                globalThis.SaveAndSync();
            } catch (e) {
                applyOk = false;
                applyErr = e?.message || String(e || "");
                $.Msg(`[QOLLock][presetCycle] ApplyPresetByName failed for '${presetName}': ${applyErr}`);
            } finally { session.remember(); }

            if (!applyOk) {
                pcResults.push({ name: presetName, passed: false, autoDisabled: [], featuresLoaded: 0, timeMs: Date.now() - startMs, exception: applyErr });
                setStatus(format("{label} — EXCEPTION", { label }), "#cc4444");
                index++;
                $.Schedule(0.05, runNext);
                return;
            }

            const hudPanel = findHudPanel();
            if (hudPanel && hudPanel.SetAttributeString) {
                try { hudPanel.SetAttributeString("QOL_DiagRequest", forceToken); } catch (e) {
                    warnLog("settings", `presetCycle write failed: ${e?.message || e}`);
                }
                $.Msg(`[QOLLock][presetCycle] force-sync token written: ${forceToken} → polling for diag echo`);
            } else {
                warnLog("settings", "presetCycle cannot write force-sync token — Hud panel not found");
            }

            const pollStartMs = Date.now();
            let pollAttempts = 0;
            const maxPollMs = 5500;

            function pollDiag() {
                pollAttempts++;
                if (!pcRunning || token !== pcToken) return;
                if (!session.current()) { stop(); return; }

                const nowMs = Date.now();
                const elapsedPollMs = nowMs - pollStartMs;

                if (elapsedPollMs > maxPollMs) {
                    pcResults.push({ name: presetName, passed: false, autoDisabled: [], featuresLoaded: 0, timeMs: nowMs - startMs, timeout: true });
                    $.Msg(`[QOLLock][presetCycle] ${label} — TIMEOUT (no diagnostic sync after ${Math.round(elapsedPollMs)}ms)`);
                    setStatus(format("{label} — TIMEOUT", { label }), "#cc8844");
                    index++;
                    $.Schedule(0.05, runNext);
                    return;
                }

                const hud = findHudPanel();
                let rawDiag = "";
                if (hud && hud.GetAttributeString) {
                    try { rawDiag = hud.GetAttributeString("QOL_Diag", ""); } catch {}
                }

                if (rawDiag) {
                    try {
                        const diag = JSON.parse(rawDiag);
                        if (diag.diagToken === forceToken) {
                            const elapsedMs = nowMs - startMs;
                            const autoDisabled = diagnosticFailures(diag);
                            const features = (diag.features) ? diag.features : [];
                            const isSuccess = autoDisabled.length === 0;

                            pcResults.push({
                                name: presetName,
                                passed: isSuccess,
                                autoDisabled,
                                featuresLoaded: features.length,
                                timeMs: elapsedMs
                            });

                            const statusStr = isSuccess ? "OK" : format("FAIL: {features}", { features: autoDisabled.join(", ") });
                            const color = isSuccess ? "#66cc99" : "#cc4444";
                            $.Msg(`[QOLLock][presetCycle] ${label} — ${statusStr} (${features.length} features, ${elapsedMs}ms, ${pollAttempts} polls)`);
                            setStatus(`${label} — ${statusStr}`, color);

                            index++;
                            $.Schedule(0.05, runNext);
                            return;
                        }
                    } catch {}
                }

                const interval = pollAttempts < 5 ? 0.1 : (pollAttempts < 15 ? 0.2 : 0.4);
                $.Schedule(interval, pollDiag);
            }

            $.Schedule(0.15, pollDiag);
        }

        function stop() {
            pcRunning = false;
            pcToken++;
            pcRestore = null;
            session.restore();
            setBtnActive(false);
            setStatus("Stopped", "#aa8844");
        }
        $.Schedule(0.1, runNext);
    }

    // =========================================================================
    // Diagnostics Log Copy
    // =========================================================================

    function copyDiagnosticsToClipboard(container, button) {
        let diagText = "";
        try {
            const dumpFn = Q.dumpDiagnostics || globalThis.QOL_DumpDiagnostics;
            if (typeof dumpFn === "function") {
                diagText = dumpFn();
            } else {
                diagText = "=== QOLLOCK Diagnostics ===\n(No diagnostic dump function available)\n";
            }
        } catch (e) {
            diagText = `=== QOLLOCK Diagnostics ===\nError: ${String(e?.message || e)}\n`;
        }

        const hiddenEntry = $.CreatePanel("TextEntry", container, "DiagCopyTextEntry");
        hiddenEntry.text = diagText;
        hiddenEntry.multiline = true;
        hiddenEntry.maxchars = Math.max(diagText.length + 100, 1000);
        hiddenEntry.SetPanelEvent("onfocus", () => {
            try { hiddenEntry.SelectAll(); } catch {}
        });

        const tryCopy = Q.ui?.configTab?.tryCopyTextToClipboard || globalThis.TryCopyTextToClipboard;
        const copied = (typeof tryCopy === "function")
            ? tryCopy(diagText, hiddenEntry)
            : false;

        if (isAlive(hiddenEntry)) {
            try { hiddenEntry.DeleteAsync(0); } catch {}
        }

        const setFeedback = Q.ui?.configTab?.setLocalizedConfigFeedbackMessage || globalThis.SetLocalizedConfigFeedbackMessage;

        if (copied) {
            if (isAlive(button)) {
                button.RemoveClass("FailureState");
                button.AddClass("SuccessState");
            }
            if (typeof setFeedback === "function") {
                setFeedback("Diagnostic logs copied.", "success", 2200);
            }
            $.Schedule(0.6, () => {
                if (isAlive(button)) button.RemoveClass("SuccessState");
            });
        } else {
            if (isAlive(button)) {
                button.RemoveClass("SuccessState");
                button.AddClass("FailureState");
            }
            if (typeof setFeedback === "function") {
                setFeedback("Clipboard copy failed.", "error", 2200);
            }
            $.Schedule(0.5, () => {
                if (isAlive(button)) button.RemoveClass("FailureState");
            });
        }
    }

    // =========================================================================
    // Dev Tab Renderer
    // =========================================================================

    function renderDevTab(list) {
        if (!list) return;

        const createTitle = (typeof globalThis.CreateSectionTitle === "function")
            ? globalThis.CreateSectionTitle
            : ((p, t) => Q.ui?.renderer?.createSectionHeader?.(p, t));
        const createRow = (typeof globalThis.CreateRow === "function")
            ? globalThis.CreateRow
            : null;
        const createSliderRow = (typeof globalThis.CreateSliderRow === "function")
            ? globalThis.CreateSliderRow
            : null;
        const createSep = (typeof globalThis.CreateSeparator === "function")
            ? globalThis.CreateSeparator
            : ((p) => Q.ui?.renderer?.createSeparator?.(p));
        const createIconButton = Q.ui?.configTab?.createSectionInlineIconButton || globalThis.CreateSectionInlineIconButton;

        // 1. Performance Section
        createTitle(list, "Performance", "ENABLE_PERF_DEBUG");
        if (createRow) {
            createRow(list, "Perf Debug", "ENABLE_PERF_DEBUG", "toggle", null, null, null, null, "Enable performance tracking (required for overlay).");
            createRow(list, "Detailed Console", "ENABLE_PERF_DEBUG_DETAIL", "toggle", null, null, null, null, "Show full feature breakdown in console every 5s.");
            createRow(list, "Show Overlay", "ENABLE_PERF_OVERLAY", "toggle", null, null, null, null, "Show the performance overlay HUD in-game.");
        }
        if (createSliderRow) {
            createSliderRow(list, "Alert Threshold", "PERF_ALERT_THRESHOLD_MS", "alert_ms_1_50", "Console alert when any feature exceeds this ms threshold.");
            createSliderRow(list, "Overlay Opacity", "PERF_OVERLAY_OPACITY", "opacity_perf", "Opacity of the performance overlay panel.");
        }

        // Helper to create a prominent, dedicated developer action row
        const createDevActionRow = (parent, rowId, btnId, statusId, iconSrc, titleText, descText, btnText, onActivate) => {
            const row = $.CreatePanel("Panel", parent, rowId || "");
            row.AddClass("SettingRow");
            row.AddClass("SettingRowAction");
            row.style.height = "fit-children";
            row.style.minHeight = "40px";
            row.style.padding = "6px 12px";
            row.style.flowChildren = "right";
            row.style.width = "100%";

            const labelWrap = $.CreatePanel("Panel", row, "");
            labelWrap.AddClass("SettingLabelContainer");
            labelWrap.style.flowChildren = "down";
            labelWrap.style.width = "fill-parent-flow(1.0)";
            labelWrap.style.verticalAlign = "center";

            const label = $.CreatePanel("Label", labelWrap, "");
            label.AddClass("SettingLabel");
            label.style.fontWeight = "bold";
            label.style.fontSize = "13px";
            label.style.color = "#e8ecea";
            label.text = localize(titleText);

            if (descText) {
                const desc = $.CreatePanel("Label", labelWrap, "");
                desc.AddClass("SettingDescription");
                desc.style.fontSize = "12px";
                desc.style.color = "#7c8480";
                desc.text = localize(descText);
            }

            const actionGroup = $.CreatePanel("Panel", row, "");
            actionGroup.AddClass("SettingActionGroup");
            actionGroup.style.flowChildren = "right";
            actionGroup.style.verticalAlign = "center";
            actionGroup.style.horizontalAlign = "right";

            let statusLbl = null;
            if (statusId) {
                statusLbl = $.CreatePanel("Label", actionGroup, statusId);
                statusLbl.text = localize("Idle");
                statusLbl.style.fontSize = "12px";
                statusLbl.style.color = "#7c8480";
                statusLbl.style.marginRight = "10px";
                statusLbl.style.verticalAlign = "center";
            }

            const btn = $.CreatePanel("Button", actionGroup, btnId);
            btn.AddClass("SettingActionBtn");
            btn.style.minWidth = "150px";
            btn.style.padding = "4px 12px";
            btn.style.verticalAlign = "center";

            const btnInner = $.CreatePanel("Panel", btn, "");
            btnInner.AddClass("SettingActionBtnInner");
            btnInner.style.flowChildren = "right";
            btnInner.style.horizontalAlign = "center";
            btnInner.style.verticalAlign = "center";

            if (iconSrc) {
                const icon = $.CreatePanel("Image", btnInner, "", {
                    src: iconSrc,
                    defaultsrc: "",
                    scaling: "contain"
                });
                icon.AddClass("SettingActionBtnIcon");
                icon.style.width = "15px";
                icon.style.height = "15px";
                icon.style.marginRight = "6px";
                icon.style.verticalAlign = "center";
            }

            const btnLabel = $.CreatePanel("Label", btnInner, "");
            btnLabel.AddClass("SettingActionBtnLabel");
            btnLabel.style.fontSize = "12px";
            btnLabel.style.fontWeight = "bold";
            btnLabel.style.verticalAlign = "center";
            btnLabel.text = localize(btnText);

            if (typeof onActivate === "function") {
                btn.SetPanelEvent("onactivate", () => onActivate(statusLbl, btn));
            }

            return { row, btn, status: statusLbl };
        };

        createSep(list);

        // 2. In-Game Benchmarks
        createTitle(list, "In-Game Benchmarks");

        for (const [mode, title] of [["current", "FPS investigation (Current Config)"], ["expanded", "FPS investigation (Expanded Config)"]]) {
            createDevActionRow(list, "FpsScanRow" + mode, "FpsScanBtn" + mode, "FpsScanStatus" + mode,
                "s2r://panorama/images/icons/icon_play.vsvg", title,
                "Start external PresentMon capture first for game FPS. Without it, this scan measures UI cadence only. Close Esc within 5s; stay still for up to 7 minutes. Settings are restored without saving.",
                "Investigate", (status, button) => runInGameBenchmark(list, status, button, "fps_" + mode));
        }
        createDevActionRow(list, "FpsStopRow", "FpsStopBtn", "FpsStopStatus", "", "Stop FPS investigation",
            "Restores excluded features and temporary settings. A partial report is copied when the scan finishes.", "Stop",
            status => {
                const hud = findHudPanel();
                if (hud) hud.SetAttributeString("QOL_DiagRequest", "fps_stop_" + Date.now());
                if (isAlive(status)) status.text = localize("Stop requested");
            });

        createDevActionRow(
            list,
            "DevBenchmarkStressRow",
            "BenchmarkStressBtn",
            "BenchmarkStressStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "Benchmark (Expanded Config)",
            "Temporarily enables additional toggles for 10s, measures Scheduler poll callbacks, then restores config. Does not exercise every feature or measure FPS.",
            "Run Stress Test (10s)",
            (statusLbl, btn) => runInGameBenchmark(list, statusLbl, btn, true)
        );

        createDevActionRow(
            list,
            "DevBenchmarkNormalRow",
            "BenchmarkRunBtn",
            "BenchmarkNormalStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "Benchmark (Current Config)",
            "Measure Scheduler polls and FindChildTraverse calls for 10 seconds with current settings. Native panel visits and FPS are unavailable.",
            "Run Current (10s)",
            (statusLbl, btn) => runInGameBenchmark(list, statusLbl, btn, false)
        );

        createSep(list);

        // 3. Testing & Diagnostics
        createTitle(list, "Testing & Diagnostics");

        createDevActionRow(
            list, "DevVisualCheckRow", "VisualCheckBtn", "VisualCheckStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "HUD settings walkthrough",
            "Open in a match or sandbox. Compare HUD changes and test gameplay. Stop restores settings without saving the test values.",
            "Start",
            (statusLbl) => {
                if (diagnosticBusy(statusLbl)) return;
                const started = Q.ui.visualCheck?.start(() => {
                    if (isAlive(statusLbl)) statusLbl.text = globalThis.LocalizeSettingsText("Settings restored", true);
                });
                if (isAlive(statusLbl)) statusLbl.text = globalThis.LocalizeSettingsText(started ? "Running" : "Open settings with a live HUD", true);
            }
        );

        createDevActionRow(list, "DevHudStateRow", "HudStateStartBtn", "HudStateStartStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "HUD state recording",
            "Record HUD states and managed callback activity for 60 seconds. Reproduce the stutter or return to hideout. Settings are unchanged.",
            "Record HUD states",
            status => requestHudStateObservation(status));
        createDevActionRow(list, "DevHudStateCopyRow", "HudStateCopyBtn", "HudStateCopyStatus",
            "s2r://panorama/images/icons/icon_copy.vsvg",
            "HUD state report",
            "After recording, copy HUD transitions, callback timings, delivery delays and active task counts. This is not an FPS measurement.",
            "Copy HUD state report",
            status => copyHudStateObservation(list, status));

        createDevActionRow(
            list,
            "DevFeatureTestRow",
            "FeatureTestBtn",
            "FeatureTestStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "Feature Test",
            "Flip each current toggle and observe HUD diagnostics. Restores settings afterward; does not verify rendering or gameplay.",
            "Run Feature Test",
            (statusLbl, btn) => runFeatureIsolationTest(statusLbl, btn)
        );

        createDevActionRow(
            list,
            "DevManifestTestRow",
            "ManifestTestBtn",
            "ManifestTestStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "Manifest Tests",
            "Read registered manifest checks in the current HUD. Reports skips and failures; does not verify rendering or gameplay.",
            "Run Manifest Tests",
            (statusLbl, btn) => runManifestTests(statusLbl, btn)
        );

        createDevActionRow(
            list,
            "DevTreeDumpRow",
            "TreeDumpBtn",
            "TreeDumpStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "Panel Tree Dump",
            "Dump the live panel tree to the console log for the offline profiler. Requires HUD context; save your console log afterwards.",
            "Dump Tree",
            (statusLbl) => requestPanelTreeDump(statusLbl)
        );

        createDevActionRow(
            list,
            "DevEngineAuditRow",
            "EngineAuditBtn",
            "EngineAuditStatus",
            "s2r://panorama/images/icons/icon_play.vsvg",
            "In-Game Engine Audit",
            "Collect HUD observations, named manifest checks and recorded errors once. Copies the report; does not prove all features work.",
            "Run Engine Audit",
            (statusLbl, btn) => runInGameEngineAudit(list, statusLbl, btn)
        );

        createDevActionRow(
            list,
            "DevFullSuiteRow",
            "FullSuiteBtn",
            "FullSuiteStatus",
            "s2r://panorama/images/icons/icon_copy.vsvg",
            "Manifest Report",
            "Run manifest checks and copy their observations, skips and errors. Rendering and gameplay remain unverified.",
            "Copy Manifest Report",
            (statusLbl, btn) => runFullTestSuite(list, statusLbl, btn)
        );

        createDevActionRow(
            list,
            "DevPresetCycleRow",
            "PresetCycleBtn",
            "PresetCycleStatus",
            "s2r://panorama/images/icons/icon_reorder.vsvg",
            "Preset Cycle",
            "Temporarily cycle presets and observe HUD errors. Stop or completion restores settings; does not verify rendering or gameplay.",
            "Cycle Presets",
            (statusLbl, btn) => runPresetCycle(statusLbl, btn)
        );

        createDevActionRow(
            list,
            "DevDiagCopyLogsRow",
            "DiagCopyLogsBtn",
            null,
            "s2r://panorama/images/icons/icon_copy.vsvg",
            "Diagnostics",
            "Copy QOLLock diagnostic logs to clipboard.",
            "Copy Logs",
            (_, btn) => copyDiagnosticsToClipboard(list, btn)
        );
    }

    // Register tab with window manager if available
    if (Q.ui?.window?.registerTabRenderer) {
        Q.ui.window.registerTabRenderer("Dev", renderDevTab);
    }

    // =========================================================================
    // Public API Export & Backwards Compatibility
    // =========================================================================

    const devTabApi = {
        findHudPanel,
        formatTestSuiteReport,
        runFeatureIsolationTest,
        runManifestTests,
        runInGameEngineAudit,
        requestPanelTreeDump,
        requestHudStateObservation,
        copyHudStateObservation,
        runFullTestSuite,
        runPresetCycle,
        runInGameBenchmark,
        copyDiagnosticsToClipboard,
        render: renderDevTab
    };

    Q.ui.devTab = devTabApi;

    if (typeof globalThis === "object" && globalThis) {
        globalThis.RenderDevTabContent = renderDevTab;
        globalThis.FormatTestSuiteReport = formatTestSuiteReport;
        globalThis.RunInGameBenchmark = runInGameBenchmark;
    }
})();
