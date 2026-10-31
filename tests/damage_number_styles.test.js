"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCssImports } = require("../scripts/check_native_css_imports");
const read = file => fs.readFileSync(path.join(__dirname, "../panorama/styles", file), "utf8");

test("Fountain slider scales only individual fountain streams across its range", () => {
    const css = read("qol_damage_fountain_full.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    // Match this source contract's positive type/class/ID selectors and direct
    // child combinator only; this does not model native layout or rendering.
    const sliderRules = rules.flatMap(([, selectors, body]) => selectors.split(",")
        .filter(selector => selector.includes("damage_fountain_scale_"))
        .map(selector => {
            const parts = selector.trim().split(/\s+/);
            assert.equal(parts.length, 4, selector);
            assert.equal(parts[2], ">");
            assert.equal(parts[3], "#QOLFountainScaleCanvas", "native root writes stay separate");
            const scale = /transform:\s*scale3d\(([^)]+)\);/.exec(body);
            assert.ok(scale, selector);
            return { parts: parts.slice(0, 2), scale: scale[1].split(",").map(Number) };
        }));
    assert.ok(sliderRules.length, "slider must have applicable rules");
    const matches = (selector, type, classes) => {
        assert.match(selector, /^(?:[A-Za-z][\w]*)?(?:\.[\w-]+)+$/);
        const requiredType = /^[A-Za-z][\w]*/.exec(selector)?.[0];
        return (!requiredType || requiredType === type) &&
            [...selector.matchAll(/\.([\w-]+)/g)].every(([, name]) => classes.includes(name));
    };
    // Native Debugger: individual fountain2/crit/buffed events are separate
    // from cumulative bullet_damage_new events, even within the same pool.
    const ordinary = [
        ["WindowRoot", "cumulative", "distance_normal", "bullet_damage_new"],
        ["WindowRoot", "cumulative_final", "bullet_damage_new"],
        ["WindowRoot", "batched", "damage_type_gun"],
        ["WindowRoot", "cumulative", "bullet_damage_new", "fountain2"],
        ["WindowRoot", "cumulative_final", "bullet_damage_new", "fountain_emphasised5"],
        ["WindowRoot", "individual", "bullet_damage_new"],
        ["WindowRoot", "healing"], ["WindowRoot", "gold"], ["WindowRoot", "deny"]
    ];
    for (let percent = 50; percent <= 300; percent++) {
        for (const active of [false, true]) for (const clean of [false, true]) {
            const hudClasses = [active && "damage_fountain_active", clean && "clean_damage_indicators_active",
                percent !== 100 && "damage_fountain_scale_" + percent].filter(Boolean);
            const applicable = sliderRules.filter(rule => matches(rule.parts[0], "CitadelHud", hudClasses));
            const scaleFor = (classes, type = "CitadelHudDamageEventIndicator") =>
                applicable.filter(rule => matches(rule.parts[1], type, classes)).at(-1)?.scale || [1, 1, 1];
            for (const classes of ordinary) assert.deepEqual(scaleFor(classes), [1, 1, 1], `${percent}%: ${classes}`);
            for (let variant = 1; variant <= 5; variant++) for (const prefix of ["fountain", "fountain_emphasised"]) {
                const classes = ["WindowRoot", "individual", "distance_normal", "crit", "buffed", prefix + variant];
                assert.deepEqual(scaleFor(classes), active ? [percent / 100, percent / 100, 1] : [1, 1, 1]);
                assert.deepEqual(scaleFor(classes, "CitadelHudSubtitles"), [1, 1, 1]);
            }
        }
    }
    assert.doesNotMatch(css, /\.damage_fountain_scale_\d+\s+CitadelHudDamageEventIndicator\.WindowRoot\s*\{/,
        "slider rules must not write transforms or coordinate scale on the native root");
    const baseline = rules.find(([, selectors]) => selectors.split(",").some(selector =>
        selector.trim() === ".damage_fountain_active .distance_near.fountain1 .HudIndicatorContainer"));
    assert.ok(baseline);
    assert.match(baseline[2], /ui-scale:\s*68%;/);
    assert.doesNotMatch(css, /damage_fountain_(?:small|medium|large)_active/);
});

test("Fountain canvas retains native bindings and uses the native viewport without layout scaling", () => {
    const layoutPath = path.join(__dirname, "../panorama/layout/hud_event_indicator.xml");
    assert.ok(fs.existsSync(layoutPath), "native indicator layout must host the owned scale canvas");
    const xml = fs.readFileSync(layoutPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    assert.match(xml, /<Panel class="WindowRoot"[^>]*>\s*<Panel id="QOLFountainScaleCanvas"[^>]*>\s*<Panel class="HudIndicatorContainer">/);
    for (const binding of ['text="{s:value}"', 'text="{s:distance}m {s:effectiveness}%"', 'text="{s:desc}"']) {
        assert.ok(xml.includes(binding), binding + " remains native");
    }
    const css = read("qol_damage_fountain_full.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const canvas = css.match(/(?:^|\})\s*#QOLFountainScaleCanvas\s*\{([^}]+)\}/);
    assert.ok(canvas);
    for (const property of ["width", "height"]) assert.match(canvas[1], new RegExp(property + ":\\s*100%;"));
    assert.doesNotMatch(canvas[1], /\b(?:ui-scale|x|y)\s*:/);
    assert.match(canvas[1], /overflow:\s*noclip;/);
    assert.match(css, /\.damage_fountain_active\s+#QOLFountainScaleCanvas\s*\{\s*flow-children:\s*right;\s*\}/);
});

test("Fountain window geometry excludes native subtitles", () => {
    const css = read("qol_damage_fountain_full.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    // The native Debugger capture identifies damage windows as this panel type;
    // subtitles use WindowRoot too, so every window rule needs the type scope.
    const windows = rules.flatMap(([, selectors, body]) => selectors.split(",")
        .filter(selector => /\.Window(?:Root)?\s*$/.test(selector))
        .map(selector => ({ selector: selector.trim(), body })));
    for (const { selector } of windows) {
        assert.match(selector, / CitadelHudDamageEventIndicator\.Window(?:Root)?$/);
    }
    for (const windowClass of ["WindowRoot", "Window"]) {
        const rule = windows.find(({ selector }) =>
            selector === ".damage_fountain_active CitadelHudDamageEventIndicator." + windowClass);
        assert.ok(rule, windowClass + " retains damage window geometry");
        assert.match(rule.body, /height:\s*300px;/);
        assert.match(rule.body, /width:\s*300px;/);
        assert.match(rule.body, /flow-children:\s*right;/);
    }
});

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
