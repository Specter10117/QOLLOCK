"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCapture } = require("../scripts/analyze_game_frames");

function fixture(intervals = [10, 5, 5, 10]) {
    const epoch = 1700000000000;
    const windows = [1000, 5000, 9000, 13000].map((start, index) => ({
        session: "test", trial: 1, name: "Crates", phase: index,
        startAt: epoch + start, endAt: epoch + start + 3000, uiMean: index === 1 || index === 2 ? 5 : 10
    }));
    const meta = { processId: 42, completed: true, session: "test", reason: "complete", windows,
        anchors: [{ qpc: 0, utcMs: epoch, frequency: 1000, uncertaintyMs: 1 },
            { qpc: 20000, utcMs: epoch + 20000, frequency: 1000, uncertaintyMs: 1 }],
        focus: Array.from({ length: 41 }, (_, index) => ({ qpc: index * 500, pid: 42 })) };
    const rows = ["Application,ProcessID,SwapChainAddress,TimeInQPC,MsBetweenPresents,MsBetweenDisplayChange,MsUntilDisplayed,MsCPUBusy,MsGPUBusy"];
    windows.forEach((window, i) => {
        for (let at = window.startAt - epoch; at <= window.endAt - epoch; at += intervals[i]) {
            rows.push(`deadlock.exe,42,0xA,${at},${intervals[i]},${intervals[i]},0,2,3`);
        }
    });
    return { csv: rows.join("\n"), meta };
}

test("native Present intervals determine FPS even when UI cadence claims an improvement", () => {
    const { csv, meta } = fixture([10, 10, 10, 10]);
    const result = analyzeCapture(csv, meta);
    assert.equal(result.rows[0].confirmed, false);
    assert.equal(result.rows[0].referenceFps, 100);
    assert.equal(result.rows[0].excludedFps, 100);
    assert.equal(result.rows[0].improvementMs, 0);
});

test("native A/B/B/A reports render and display cadence with CPU/GPU context", () => {
    const { csv, meta } = fixture();
    const row = analyzeCapture(csv, meta).rows[0];
    assert.equal(row.confirmed, true);
    assert.equal(row.referenceFps, 100);
    assert.equal(row.excludedFps, 200);
    assert.equal(row.improvementMs, 5);
    assert.equal(row.windows[0].samples, 300, "the interval crossing the start boundary must be excluded");
    assert.equal(row.windows[1].displayFps, 200);
    assert.equal(row.windows[0].cpuBusyMs, 2);
    assert.equal(row.windows[0].gpuBusyMs, 3);
});

test("background focus invalidates a native comparison despite a large FPS improvement", () => {
    const { csv, meta } = fixture();
    meta.focus.find(point => point.qpc === 6000).pid = 99;
    const row = analyzeCapture(csv, meta).rows[0];
    assert.equal(row.confirmed, false);
    assert.match(row.quality, /focus/);
});

test("ambiguous game swap chains require an explicit selection instead of mixing their frames", () => {
    const { csv, meta } = fixture();
    const mixed = csv + "\n" + csv.split("\n").slice(1).map(line => line.replace("0xA", "0xB")).join("\n");
    assert.throws(() => analyzeCapture(mixed, meta), /swap chains/);
    meta.swapChain = "0xA";
    assert.equal(analyzeCapture(mixed, meta).rows[0].referenceFps, 100);
});

test("clock discontinuities and unrelated captures cannot become native FPS evidence", () => {
    const { csv, meta } = fixture();
    meta.anchors[1].utcMs += 1000;
    assert.throws(() => analyzeCapture(csv, meta), /clock/);
    meta.anchors[1].utcMs -= 1000;
    meta.windows.forEach(window => { window.startAt += 100000; window.endAt += 100000; });
    const row = analyzeCapture(csv, meta).rows[0];
    assert.equal(row.confirmed, false);
    assert.equal(row.referenceFps, null);
    assert.match(row.quality, /coverage/);
});

test("malformed CSV and incomplete native windows fail visibly", () => {
    const { csv, meta } = fixture();
    assert.throws(() => analyzeCapture(csv.replace("TimeInQPC", "TimeInDateTime"), meta), /TimeInQPC/);
    meta.windows.pop();
    assert.throws(() => analyzeCapture(csv, meta), /four windows/);
    meta.reason = "cancelled";
    const cancelled = analyzeCapture(csv, meta);
    assert.deepEqual(cancelled.incompleteTrials, ["Crates"]);
    assert.equal(cancelled.rows.length, 0);
});

for (const warning of ["warning: 7 ETW buffers were lost.", "warning: 8 ETW events were lost.",
    "warning: 9 overflowed present events detected."]) {
    test(`lossy native traces are rejected even with exit zero: ${warning}`, () => {
        const { csv, meta } = fixture();
        meta.stderr = warning;
        assert.throws(() => analyzeCapture(csv, meta), /trace errors/i);
    });
}
