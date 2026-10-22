"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCssImports } = require("../scripts/check_native_css_imports");
const read = file => fs.readFileSync(path.join(__dirname, "../panorama/styles", file), "utf8");

test("native event indicators load their baseline before QOLLOCK fountain keyframes and visibility rules", () => {
    assert.ok(fs.existsSync(path.join(__dirname, "../panorama/styles/hud_event_indicator.css")),
        "the native indicator layout must receive its own stylesheet extension");
    assert.deepEqual(parseCssImports(read("hud_event_indicator.css")), [
        "s2r://panorama/styles/base/hud_event_indicator.vcss_c",
        "s2r://panorama/styles/features/ql_feat_damage_numbers.vcss_c"
    ]);
    assert.ok(parseCssImports(read("features/ql_feat_damage_numbers.css"))
        .includes("s2r://panorama/styles/qol_damage_fountain_full.vcss_c"));
    assert.ok(!parseCssImports(read("hud.css")).includes("s2r://panorama/styles/features/ql_feat_damage_numbers.vcss_c"),
        "indicator rules have one owning style context");
});

test("big and small visibility collapses complete native events, including the final cumulative number", () => {
    const css = read("features/ql_feat_damage_numbers.css");
    for (const selector of [".cumulative_dmg_disabled .cumulative_final", ".hide_small_numbers_active .bullet_damage_new",
        ".hide_small_numbers_active .ability_damage_new", ".hide_small_numbers_active .melee_damage_new", ".hide_small_numbers_active .pure_damage_new"]) {
        const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        assert.ok(rules.some(([, selectors, body]) => selectors.split(",").some(value => value.trim() === selector) &&
            /visibility:\s*collapse\s*;/.test(body)), selector + " must hide without waiting for label discovery");
    }
});

test("disabling Big Numbers leaves incremental damage presentation alone", () => {
    const css = read("features/ql_feat_damage_numbers.css");
    const selectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .flatMap(([, list]) => list.split(",").map(value => value.trim()))
        .filter(selector => selector.startsWith(".cumulative_dmg_disabled "));
    assert.ok(selectors.length);
    assert.ok(selectors.every(selector => /\s\.(?:cumulative|batched|cumulative_final)(?=[.\s:]|$)/.test(selector)),
        "Big Numbers must only target cumulative events, without dimming or scaling Small Numbers");
});

test("Clean and Fountain animations resolve within the native indicator stylesheet chain", () => {
    const source = ["base/hud_event_indicator.css", "qol_damage_fountain_full.css", "features/ql_feat_damage_numbers.css"].map(read).join("\n");
    const defined = new Set([...source.matchAll(/@keyframes\s+['"]?([^'"\s{]+)/g)].map(match => match[1]));
    const references = [...source.matchAll(/animation-name:\s*([^;]+);/g)]
        .flatMap(match => match[1].replace(/\s*!important\s*$/, "").split(",").map(name => name.trim()))
        .filter(name => name !== "none");
    assert.deepEqual([...new Set(references)].filter(name => !defined.has(name)), [], "all movement and fade keyframes must be loaded");
});
