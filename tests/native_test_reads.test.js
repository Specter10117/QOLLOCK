"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

test("native test tracing preserves reads and distinct records even when processes report the same PID", t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qollock-native-reads-"));
    t.after(() => {
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(directory).startsWith("qollock-native-reads-"));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const script = `
        // Deterministically reproduce Windows PID reuse across these children.
        Object.defineProperty(process, 'pid', { value: 4242 });
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const { pathToFileURL } = require('node:url');
        const path = require('node:path');
        const file = path.resolve('panorama/layout/hud_quickbuy.xml');
        const missing = path.resolve('panorama/layout/QOLReplayAbsent.xml');
        assert.ok(fs.readFileSync(pathToFileURL(file), 'utf8').includes('HudMini'));
        assert.equal(fs.existsSync(missing), false);
        assert.throws(() => fs.readFileSync(missing), { code: 'ENOENT' });
        const descriptor = fs.openSync(file, 'r');
        assert.ok(fs.readFileSync(descriptor, 'utf8').includes('HudMini'));
        fs.closeSync(descriptor);
    `;
    const run = probe => spawnSync(process.execPath, ["--require", path.join(root, "scripts/native_test_reads.cjs"),
        "--eval", script, probe], {
        cwd: root, env: { ...process.env, QOL_NATIVE_TEST_READS: directory }, encoding: "utf8"
    });
    for (const probe of ["native-read-probe.test.js", "other-read-probe.test.js", "native-read-probe.test.js"]) {
        const child = run(probe);
        assert.equal(child.status, 0, child.stderr);
    }
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 2, "distinct tests retain distinct records; a repeated test reuses only its own record");
    const observed = files.map(file => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
    assert.equal(new Set(observed.map(record => record.test)).size, 2);
    for (const record of observed) {
        assert.deepEqual(record.reads, ["panorama/layout/QOLReplayAbsent.xml", "panorama/layout/hud_quickbuy.xml"]);
    }
});
