"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Nurse healing-mode label retains its native presentation", () => {
    const css = fs.readFileSync(
        path.join(__dirname, "../panorama/styles/base/ability_hud_elements/element_gun.css"),
        "utf8"
    );

    assert.match(css, /#healing_mode_indicator\s*\{[^}]*y:\s*120px;/s);
    assert.match(css, /#healing_mode_indicator\s*\{[^}]*color:\s*armorColor;/s);
    assert.match(css, /#healing_mode_indicator\s*\{[^}]*visibility:\s*collapse;/s);
    assert.match(css, /@keyframes\s+'healing_mode_pulse'/);
    assert.match(css, /\.nurse_needles\s+#healing_mode_indicator\s*\{[^}]*visibility:\s*visible;/s);
});
