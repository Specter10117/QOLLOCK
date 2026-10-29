"use strict";
const fs = require("node:fs");
const { parseCsv } = require("./import_translations");

const number = value => value === "" || value === undefined || value === "NA" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, fraction) => values.length ? values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;

function clockMapping(anchors) {
    if (!Array.isArray(anchors) || anchors.length < 2) throw Error("At least two Windows QPC/UTC clock anchors are required");
    if (anchors.some((a, i) => ![a.qpc, a.utcMs, a.frequency, a.uncertaintyMs].every(Number.isFinite) ||
        a.frequency <= 0 || a.frequency !== anchors[0].frequency || a.uncertaintyMs < 0 ||
        (i && (a.qpc <= anchors[i - 1].qpc || a.utcMs <= anchors[i - 1].utcMs)))) throw Error("Invalid clock anchors");
    const driftMs = Math.max(...anchors.slice(1).map((b, i) => Math.abs(b.utcMs - anchors[i].utcMs - (b.qpc - anchors[i].qpc) * 1000 / b.frequency)));
    if (driftMs > 5 || anchors.some(anchor => anchor.uncertaintyMs > 3)) {
        throw Error("Windows clock discontinuity or uncertain QPC alignment; refusing to align trial windows");
    }
    return { driftMs, at: qpc => {
        let index = 0;
        while (index < anchors.length - 2 && qpc > anchors[index + 1].qpc) index++;
        const a = anchors[index], b = anchors[index + 1];
        return a.utcMs + (qpc - a.qpc) * (b.utcMs - a.utcMs) / (b.qpc - a.qpc);
    } };
}

function readFrames(csv, processId, clock, selectedSwapChain) {
    const records = parseCsv(csv), header = records.shift();
    const required = ["Application", "ProcessID", "SwapChainAddress", "TimeInQPC", "MsBetweenPresents"];
    if (!header || new Set(header).size !== header.length) throw Error("Missing or duplicate PresentMon CSV headers");
    for (const key of required) if (!header.includes(key)) throw Error("Missing PresentMon column " + key + "; use the supplied QPC capture launcher");
    const index = Object.fromEntries(header.map((key, i) => [key, i]));
    const chains = new Map();
    for (const record of records) {
        if (record.length === 1 && !record[0]) continue;
        if (record.length !== header.length) throw Error("Malformed PresentMon CSV row");
        if (Number(record[index.ProcessID]) !== processId) continue;
        const get = key => number(record[index[key]]);
        const qpc = get("TimeInQPC"), interval = get("MsBetweenPresents");
        if (qpc === null || !Number.isSafeInteger(qpc) || interval === null || interval < 0) throw Error("Invalid native frame timestamp or Present interval");
        const chain = record[index.SwapChainAddress];
        if (!chains.has(chain)) chains.set(chain, []);
        chains.get(chain).push({ at: clock.at(qpc), interval,
            displayInterval: get("MsBetweenDisplayChange"), untilDisplayed: get("MsUntilDisplayed"),
            cpuBusy: get("MsCPUBusy"), gpuBusy: get("MsGPUBusy") });
    }
    const chainCounts = [...chains].map(([address, frames]) => ({ address, frames: frames.length })).sort((a, b) => b.frames - a.frames);
    if (!chainCounts.length) throw Error("No native frames for the requested game process");
    if (!selectedSwapChain && chainCounts[1]?.frames > chainCounts[0].frames * 0.2) throw Error("Multiple substantial game swap chains; select one explicitly instead of mixing their FPS");
    const swapChain = selectedSwapChain || chainCounts[0].address;
    if (!chains.has(swapChain)) throw Error("Selected swap chain was not captured");
    const frames = chains.get(swapChain).sort((a, b) => a.at - b.at);
    return { frames, swapChain, chainCounts };
}

function summarizeWindow(frames, focus, window, processId) {
    const selected = frames.filter(frame => frame.interval > 0 && frame.at - frame.interval >= window.startAt && frame.at <= window.endAt);
    const intervals = selected.map(frame => frame.interval);
    const displayed = frames.filter(frame => frame.displayInterval > 0 && frame.untilDisplayed !== null &&
        frame.at + frame.untilDisplayed - frame.displayInterval >= window.startAt && frame.at + frame.untilDisplayed <= window.endAt)
        .map(frame => frame.displayInterval);
    const meanMs = mean(intervals), displayMs = mean(displayed);
    let quality = "comparable";
    const before = focus.filter(point => point.at <= window.startAt).at(-1);
    const after = focus.find(point => point.at >= window.endAt);
    const focusPoints = before && after ? focus.filter(point => point.at >= before.at && point.at <= after.at) : [];
    if (!before || !after || focusPoints.some((point, i) => i && point.at - focusPoints[i - 1].at > 1500)) quality = "missing focus coverage";
    else if (focusPoints.some(point => point.pid !== processId)) quality = "game focus changed";
    if (selected.length < 60 || !selected.length || selected[0].at - window.startAt > 250 || window.endAt - selected.at(-1).at > 250) quality = "insufficient native frame coverage";
    return { phase: window.phase, startAt: window.startAt, endAt: window.endAt, samples: selected.length,
        meanMs, fps: meanMs === null ? null : 1000 / meanMs, p95Ms: percentile(intervals, 0.95),
        displayFps: displayMs === null ? null : 1000 / displayMs,
        displaySamples: displayed.length, cpuBusyMs: mean(selected.map(frame => frame.cpuBusy).filter(value => value !== null)),
        gpuBusyMs: mean(selected.map(frame => frame.gpuBusy).filter(value => value !== null)), quality };
}

function analyzeCapture(csv, meta) {
    if (!meta.completed || !Number.isInteger(meta.processId) || meta.processId <= 0) throw Error("Native capture did not complete successfully");
    const diagnosticLines = ((meta.stdout || "") + "\n" + (meta.stderr || "")).split(/\r?\n/);
    const losses = diagnosticLines.filter(line => /\berror\b|\b[1-9]\d*\s+ETW (?:buffers|events) were lost|\b[1-9]\d*\s+overflowed present events detected/i.test(line));
    const traceErrors = [...(meta.traceErrors || []), ...losses];
    if (traceErrors.length) throw Error("Native trace errors: " + traceErrors.join("; "));
    const clock = clockMapping(meta.anchors);
    const { frames, swapChain, chainCounts } = readFrames(csv, meta.processId, clock, meta.swapChain);
    const focus = (meta.focus || []).map(point => ({ ...point, at: clock.at(point.qpc) })).sort((a, b) => a.at - b.at);
    if (meta.kind === "minimap-suite" || (meta.windows || []).some(window => window.conditionId)) {
        return { ...require("./analyze_minimap_frames").analyzeMinimap(meta, frames, focus, summarizeWindow),
            processId: meta.processId, session: meta.session, swapChain, chainCounts, clockDriftMs: clock.driftMs, nativeFrames: frames.length };
    }
    const trials = new Map();
    for (const window of meta.windows || []) {
        if (window.session !== meta.session) continue;
        if (!Number.isFinite(window.startAt) || !Number.isFinite(window.endAt) || window.endAt <= window.startAt ||
            !Number.isInteger(window.phase) || window.phase < 0 || window.phase > 3) throw Error("Invalid native trial window marker");
        if (!trials.has(window.trial)) trials.set(window.trial, { name: window.name, ids: window.ids, patch: window.patch, windows: [] });
        const trial = trials.get(window.trial);
        if (trial.name !== window.name || trial.windows.some(previous => previous.phase === window.phase)) throw Error("Conflicting native trial markers");
        trial.windows.push(summarizeWindow(frames, focus, window, meta.processId));
    }
    const rows = [], incompleteTrials = [];
    for (const trial of trials.values()) {
        if (trial.windows.length !== 4) {
            if (meta.reason === "complete") throw Error("Each completed native trial requires four windows; capture/report is incomplete");
            incompleteTrials.push(trial.name); continue;
        }
        trial.windows.sort((a, b) => a.phase - b.phase);
        const [a, b, c, d] = trial.windows;
        const covered = trial.windows.every(window => window.quality === "comparable");
        const referenceMs = covered ? (a.meanMs + d.meanMs) / 2 : null;
        const excludedMs = covered ? (b.meanMs + c.meanMs) / 2 : null;
        const improvementMs = covered ? referenceMs - excludedMs : null;
        const drift = covered ? Math.abs(a.meanMs - d.meanMs) / referenceMs : null;
        const consistent = covered && a.meanMs > b.meanMs && d.meanMs > c.meanMs;
        rows.push({ ...trial, referenceMs, excludedMs, improvementMs,
            referenceFps: covered ? 1000 / referenceMs : null, excludedFps: covered ? 1000 / excludedMs : null,
            confirmed: covered && drift <= 0.1 && consistent && improvementMs > Math.max(0.5, referenceMs * 0.05),
            quality: !covered ? trial.windows.find(window => window.quality !== "comparable").quality :
                drift > 0.1 ? "reference drift" : !consistent ? "no consistent native improvement" : "comparable" });
    }
    return { processId: meta.processId, session: meta.session, reason: meta.reason, swapChain, chainCounts,
        clockDriftMs: clock.driftMs, nativeFrames: frames.length, incompleteTrials,
        rows: rows.sort((a, b) => (b.improvementMs ?? -Infinity) - (a.improvementMs ?? -Infinity)) };
}

function formatReport(result) {
    if (result.kind === "minimap-suite") return require("./analyze_minimap_frames").formatMinimap(result);
    const f = value => value === null || value === undefined ? "n/a" : value.toFixed(2);
    const lines = ["=== QOLLOCK native game frame comparison ===",
        `Process=${result.processId}; swap chain=${result.swapChain}; native frames=${result.nativeFrames}; clock drift=${f(result.clockDriftMs)}ms`,
        "Source: PresentMon DXGI/graphics Present events, NOT Panorama scheduling.",
        "Present FPS measures application submissions; displayed FPS is reported separately. CPU/GPU busy are context, not code attribution.",
        "Only the completed conditions below were measured. Coverage follows the in-game scan plan; native coverage is not exhaustive."];
    for (const row of result.rows) {
        lines.push(`${row.confirmed ? "REPEATABLE_NATIVE" : "UNCONFIRMED_NATIVE"} ${row.name}: Present FPS ${f(row.referenceFps)} -> ${f(row.excludedFps)}; improvement=${f(row.improvementMs)}ms; ${row.quality}`);
        for (const window of row.windows) lines.push(`  ${["A", "B", "B", "A"][window.phase]} n=${window.samples} Present FPS=${f(window.fps)} mean=${f(window.meanMs)}ms p95=${f(window.p95Ms)}ms displayed FPS=${f(window.displayFps)} CPU busy=${f(window.cpuBusyMs)}ms GPU busy=${f(window.gpuBusyMs)}ms; ${window.quality}`);
    }
    if (!result.rows.length) lines.push("Native capture works, but no complete A/B/B/A trial markers were captured. This is not evidence about a feature's FPS cost.");
    if (result.incompleteTrials.length) lines.push("Incomplete trials excluded from comparison: " + result.incompleteTrials.join(", "));
    return lines.join("\n");
}

if (require.main === module) {
    try {
        const [csvPath, metaPath, option, jsonPath] = process.argv.slice(2);
        if (!csvPath || !metaPath || (option && (option !== "--json-output" || !jsonPath))) throw Error("Usage: node scripts/analyze_game_frames.js <frames.csv> <capture.json> [--json-output <new-file>]");
        const result = analyzeCapture(fs.readFileSync(csvPath, "utf8"), JSON.parse(fs.readFileSync(metaPath, "utf8")));
        if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
        process.stdout.write(formatReport(result) + "\n");
    } catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
}
module.exports = { analyzeCapture, formatReport };
