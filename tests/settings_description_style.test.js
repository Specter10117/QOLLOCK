"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readStyleSource } = require("./helpers/style_source");

test("settings description tooltips use natural font line spacing throughout their style chain", () => {
    const css = readStyleSource("panorama/styles/ql_settings.css");
    const bodyRules = [...css.matchAll(/(?:^|\n)\.QOLCustomRowTooltipText\s*\{([^}]+)\}/g)];
    assert.ok(bodyRules.length > 0);
    const spacing = bodyRules.flatMap(rule => [...rule[1].matchAll(/line-height:\s*([^;]+);/g)].map(match => match[1].trim()));
    assert.ok(spacing.length > 0);
    assert.ok(spacing.every(value => value === "normal"), "description spacing follows the font metrics instead of adding a fixed gap");
});
