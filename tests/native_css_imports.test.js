"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    canonicalStyleResource,
    parseCssImports,
    parseHudStyleIncludes,
    findDuplicateImports,
    originPanoramaPaths
} = require("../scripts/check_native_css_imports.js");

test("normalizes Panorama stylesheet resources regardless of compiled suffix", () => {
    assert.equal(canonicalStyleResource("s2r://panorama/styles/hud.vcss"), "hud");
    assert.equal(canonicalStyleResource("s2r://panorama/styles/hud.vcss_c"), "hud");
});

test("reads stylesheet imports while ignoring commented examples", () => {
    const css = `
        /* @import url("s2r://panorama/styles/commented.vcss"); */
        @import url("s2r://panorama/styles/shared.vcss_c");
        @import "s2r://panorama/styles/feature.vcss";
    `;
    assert.deepEqual(parseCssImports(css), [
        "s2r://panorama/styles/shared.vcss_c",
        "s2r://panorama/styles/feature.vcss"
    ]);
});

test("reads style includes only from the HUD styles block", () => {
    const xml = `<root>
        <styles><include src="s2r://panorama/styles/hud.vcss" /></styles>
        <scripts><include src="s2r://panorama/scripts/hud.js" /></scripts>
    </root>`;
    assert.deepEqual(parseHudStyleIncludes(xml), ["s2r://panorama/styles/hud.vcss"]);
});

test("reports QOLLOCK imports already present in the GameTracking HUD style graph", () => {
    const duplicates = findDuplicateImports(
        ["s2r://panorama/styles/hud.vcss", "s2r://panorama/styles/shared.vcss"],
        [
            { resource: "s2r://panorama/styles/features/ql_feature.vcss_c", source: "hud.css" },
            { resource: "s2r://panorama/styles/shared.vcss_c", source: "features/ql_feature.css" }
        ]
    );
    assert.deepEqual(duplicates, [
        { resource: "s2r://panorama/styles/shared.vcss_c", source: "features/ql_feature.css" }
    ]);
});

test("resolves shared Panorama styles from citadel and core game content", () => {
    assert.deepEqual(originPanoramaPaths("styles/split_label.css"), [
        "game/citadel/pak01_dir/panorama/styles/split_label.css",
        "game/core/pak01_dir/panorama/styles/split_label.css"
    ]);
});
