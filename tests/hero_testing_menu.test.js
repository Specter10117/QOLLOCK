"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { readStyleSource: read } = require("./helpers/style_source");

test("hero-testing menu is restored only in the UI-visible practice area", () => {
    const css = read("panorama/styles/hero_testing_menu.css");

    assert.match(css, /@import url\("s2r:\/\/panorama\/styles\/base\/hero_testing_menu\.vcss_c"\);/);
    assert.match(css, /\.hud_hero_testing_root\s*\{[^}]*y:\s*75px;/s);
    assert.match(css, /\.connectedToHeroTesting\.connectedToHideout:not\(\.InHideout\) \.hud_hero_testing_root\s*\{[^}]*visibility:\s*visible;/s);
    assert.doesNotMatch(css, /\.connectedToHeroTesting\.connectedToHideout \.hud_hero_testing_root/);
    assert.doesNotMatch(css, /\.connectedToHeroTesting\.InHideout #hud_hero_testing/);
});

test("hero-testing localization visibility remains owned by the native stylesheet", () => {
    const css = read("panorama/styles/hero_testing_menu.css");
    assert.match(css, /@import url\("s2r:\/\/panorama\/styles\/base\/hero_testing_menu\.vcss_c"\);/);
    assert.doesNotMatch(css, /#hero_testing_stub|\.hotkey_hint|\.Language_english/,
        "QOLLOCK restores the menu root without copying Valve's locale-specific child rules");
});
