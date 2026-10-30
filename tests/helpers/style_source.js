"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");

// Read the QOLLOCK extension chain without mixing native baseline rules into
// assertions about overrides. Preserve import directives for load-order checks.
function readStyleSource(relativePath, ancestors = []) {
    const file = path.resolve(root, relativePath);
    if (ancestors.includes(file)) throw new Error(`Cyclic stylesheet extension: ${relativePath}`);
    const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    return source.replace(/@import url\("s2r:\/\/panorama\/styles\/(features\/ql_feat_native_[^"\n]+)\.vcss_c"\);/g,
        (directive, feature) => `${directive}\n${readStyleSource(`panorama/styles/${feature}.css`, [...ancestors, file])}`);
}

module.exports = { readStyleSource };
