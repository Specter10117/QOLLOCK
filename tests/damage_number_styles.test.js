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

test("small and cumulative CSS gates remain independent for every damage type", () => {
    // Model only these class selectors and visibility declarations. This checks
    // the source cascade, not native parsing, animation or client rendering.
    const rules = [...read("features/ql_feat_damage_numbers.css").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .flatMap(([, list, body]) => list.split(",").map(selector => ({ selector: selector.trim(), body })))
        .filter(rule => /^\.(?:hide_small_numbers_active|cumulative_dmg_disabled)\b/.test(rule.selector));
    const matches = (selector, classes) => {
        const excluded = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map(match => match[1]);
        const required = [...selector.replace(/:not\([^)]*\)/g, "").matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        return required.every(name => classes.includes(name)) && excluded.every(name => !classes.includes(name));
    };
    const visibility = (roots, events) => {
        let value = "visible", specificity = -1;
        for (const rule of rules) {
            const parts = rule.selector.split(/\s+/);
            const declaration = /visibility:\s*(\w+)\s*;/.exec(rule.body);
            const weight = (rule.selector.match(/\./g) || []).length;
            if (parts.length === 2 && declaration && weight >= specificity && matches(parts[0], roots) && matches(parts[1], events)) {
                value = declaration[1]; specificity = weight;
            }
        }
        return value;
    };
    for (const hideSmall of [false, true]) for (const hideBig of [false, true]) {
        const roots = [hideSmall && "hide_small_numbers_active", hideBig && "cumulative_dmg_disabled"].filter(Boolean);
        for (const type of ["gun", "melee", "ability", "pure", "poison"]) {
            const event = ["damage", "damage_type_" + type];
            assert.equal(visibility(roots, event), hideSmall ? "collapse" : "visible", `${roots}: ${type}`);
            for (const total of ["cumulative", "batched", "cumulative_final"]) {
                assert.equal(visibility(roots, [...event, total]), hideBig ? "collapse" : "visible", `${roots}: ${type} ${total}`);
            }
        }
        for (const small of ["bullet_damage_new", "ability_damage_new", "melee_damage_new", "pure_damage_new"]) {
            assert.equal(visibility(roots, [small]), hideSmall ? "collapse" : "visible");
        }
        for (const event of [["healing"], ["gold"], ["deny"]]) assert.equal(visibility(roots, event), "visible");
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
