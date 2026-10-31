"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("native watches match owned source files, including retired and newly added overrides", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "upstream.json"), "utf8"));
    const expected = [];
    for (const [directory, extension, prefix] of [
        ["panorama/layout", ".xml", "layout/"], ["panorama/styles/base", ".css", "styles/"]
    ]) {
        for (const relative of fs.readdirSync(path.join(root, directory), { recursive: true })) {
            if (!relative.endsWith(extension)) continue;
            const normalized = relative.replace(/\\/g, "/");
            const native = prefix + normalized;
            expected.push(native);
            assert.equal(manifest.files[native]?.destination, `${directory}/${normalized}`,
                `${native}: owned source must have a matching watch destination`);
        }
    }
    assert.deepEqual(Object.keys(manifest.files).sort(), expected.sort(),
        "retire watches with their overrides; watch every new native baseline or XML override");
});
