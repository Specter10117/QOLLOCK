"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("every supported small-magazine mask ships one sector per round in each native quarter-circle", () => {
    for (let rounds = 1; rounds <= 40; rounds++) {
        const svg = fs.readFileSync(path.join(__dirname, "../panorama/images/custom/ammo_ticks", rounds + ".svg"), "utf8");
        assert.match(svg, /<svg[^>]*viewBox="0 0 128 128"/);
        assert.match(svg, /<g fill="#ffffff">/);
        assert.equal([...svg.matchAll(/<path\s+d="[^"]+"\s*\/>/g)].length, rounds * 4,
            rounds + " rounds must have that many divisions in a 90-degree arc");
    }
});
