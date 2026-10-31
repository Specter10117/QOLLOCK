"use strict";

// Optional Node test preload. Observe actual source reads, including reads made
// through test helpers; never replace their contents or their error behavior.
const fs = require("node:fs");
const path = require("node:path");
const { URL, fileURLToPath } = require("node:url");
const { createHash } = require("node:crypto");
const destination = process.env.QOL_NATIVE_TEST_READS;
if (destination) {
    const root = path.resolve(__dirname, "..");
    const reads = new Set();
    const originalRead = fs.readFileSync;
    const originalExists = fs.existsSync;
    const record = value => {
        if (value instanceof URL) value = fileURLToPath(value);
        if (typeof value !== "string" && !Buffer.isBuffer(value)) return;
        const relative = path.relative(root, path.resolve(String(value))).replace(/\\/g, "/");
        if (/^panorama\/(?:layout\/|styles\/base\/)/.test(relative)) reads.add(relative);
    };
    fs.readFileSync = function(file, ...args) {
        record(file);
        return originalRead.call(this, file, ...args);
    };
    fs.existsSync = function(file) {
        record(file);
        return originalExists.call(this, file);
    };
    process.on("exit", () => {
        const test = process.argv.find(arg => /\.test\.[cm]?js$/.test(arg));
        if (!test) return;
        const relativeTest = path.relative(root, test).replace(/\\/g, "/");
        // Windows can reuse a PID during a large suite. Keying by PID silently
        // overwrites another test's dependencies and can hide real failures.
        const identity = createHash("sha256").update(relativeTest).digest("hex");
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, `${identity}.json`), JSON.stringify({
            test: relativeTest, reads: [...reads].sort()
        }));
    });
}
