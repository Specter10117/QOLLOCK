"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../panorama/styles/base/unit_status_v2.css"), "utf8")
    .replace(/\r\n/g, "\n");

test("native name-above-health-bars classes retain their current visibility contract", () => {
    assert.match(css, /\.GameStatePreGame\.player #name,\.player #name\s*\{[^}]*visibility:\s*visible;/s);
    assert.match(css, /\.HideName #name\s*\{[^}]*visibility:\s*collapse;/s);
    assert.match(css, /\.player\.HideName #name\s*\{[^}]*visibility:\s*collapse;/s);
});

test("hiding a unit name retains distinct native stamina placement", () => {
    const normal = Number(css.match(/(?:^|\n)#StaminaContainer\s*\{[^}]*margin-top:\s*(-?[\d.]+)px;/s)?.[1]);
    const hidden = Number(css.match(/\.HideName #StaminaContainer\s*\{[^}]*margin-top:\s*(-?[\d.]+)px;/s)?.[1]);
    assert.ok(Number.isFinite(normal) && Number.isFinite(hidden), "both native name states declare stamina placement");
    assert.notEqual(normal, hidden, "hidden names retain their own placement without pinning Valve's pixel values");
});
