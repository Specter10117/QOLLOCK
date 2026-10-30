"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readStyleSource } = require("./helpers/style_source");
const directory = path.resolve(__dirname, "../panorama/styles");

test("native stylesheet extensions keep declarations in reachable context features", () => {
    const wrappers = fs.readdirSync(directory, { recursive: true }).filter(file =>
        file.endsWith(".css") && !file.startsWith("base") && !file.startsWith("features"));
    for (const relative of wrappers) {
        const source = fs.readFileSync(path.join(directory, relative), "utf8");
        if (!source.includes("s2r://panorama/styles/base/")) continue;
        const imports = [...source.matchAll(/@import url\("s2r:\/\/panorama\/styles\/([^"\n]+)\.vcss_c"\);/g)];
        assert.ok(imports.length, relative);
        const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/@import url\("[^"\n]+"\);/g, "").trim();
        assert.equal(declarations, "", `${relative}: rules belong to the context feature`);
        const baseline = imports.findIndex(match => match[1].startsWith("base/"));
        for (const [index, match] of imports.entries()) {
            assert.ok(fs.existsSync(path.join(directory, `${match[1]}.css`)), `${relative}: ${match[1]} source exists`);
            if (match[1].startsWith("features/ql_feat_native_")) {
                assert.ok(index > baseline, `${relative}: native baseline precedes its extension`);
                const feature = fs.readFileSync(path.join(directory, `${match[1]}.css`), "utf8");
                assert.doesNotMatch(feature, /styles\/base\//, `${relative}: extension does not reload its baseline`);
            }
        }
        // Missing or cyclic context imports must fail the same reader used by
        // the existing appearance regressions, rather than silently skip rules.
        assert.doesNotThrow(() => readStyleSource(`panorama/styles/${relative}`));
    }
});
