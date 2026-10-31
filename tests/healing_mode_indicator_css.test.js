"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Nurse healing mode retains the current native reticle and ammo presentation", () => {
    const css = fs.readFileSync(
        path.join(__dirname, "../panorama/styles/base/ability_hud_elements/element_gun.css"),
        "utf8"
    );

    assert.match(css, /#healing_mode_indicator\s*\{[^}]*y:\s*120px;/s);
    assert.match(css, /#healing_mode_indicator\s*\{[^}]*color:\s*armorColor;/s);
    assert.match(css, /#healing_mode_indicator\s*\{[^}]*visibility:\s*collapse;/s);
    assert.match(css, /@keyframes\s+'healing_mode_pulse'/);
    assert.doesNotMatch(css, /\.nurse_needles\s+#healing_mode_indicator\s*\{[^}]*visibility:\s*visible;/s,
        "the current native mode uses its reticle and heal icon instead of the old label");
    assert.match(css, /\.nurse_needles\s+\.crosshair__dot\s*\{[^}]*reticlepip_nurse_psd\.vtex/s);
    assert.match(css, /\.nurse_needles\s+\.weapon_ammo\s*\{[^}]*color:\s*#80ffd7;/s);
    assert.match(css, /\.nurse_heal_icon\s*\{[^}]*nurse_heal_icon\.vsvg/s);
    assert.match(css, /\.nurse_needles\s+\.nurse_heal_icon\s*\{[^}]*visibility:\s*visible;/s);
});
