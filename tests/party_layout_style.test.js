"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { readStyleSource: read } = require("./helpers/style_source");

test("hideout friends-playing count occupies the current party-settings button slot", () => {
    const css = read("panorama/styles/citadel_party.css");
    const base = read("panorama/styles/base/citadel_party.css");
    const globalCss = read("panorama/styles/qollock_global.css");

    assert.equal(fs.existsSync(path.join(__dirname, "../panorama/layout/citadel_party.xml")), false);
    assert.match(css, /@import url\("s2r:\/\/panorama\/styles\/base\/citadel_party\.vcss_c"\);/);
    const button = base.match(/#JoinCreateParty\s*\{([^}]*)\}/s)?.[1];
    const friends = css.match(/\.FriendsCountContainer\s*\{([^}]*)\}/s)?.[1];
    assert.ok(button && friends, "native party button and QOLLOCK count placement rules exist");
    for (const property of ["width", "height", "margin-top", "margin-right", "horizontal-align", "vertical-align"]) {
        const value = block => block.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+);`))?.[1].trim();
        assert.ok(value(button), `native button declares ${property}`);
        assert.equal(value(friends), value(button), `friends count must match native party button ${property}`);
    }
    assert.match(base, /\.ShowEscapeMenu #JoinCreateParty:hover:enabled/);
    assert.match(base, /\.connectedToHideout \.HasFriendsInGame \.FriendsCount/);
    assert.match(base, /@keyframes 'InviteGlow'/);
    assert.match(friends, /ignore-parent-flow:\s*true;/);
    assert.match(friends, /(?:^|;)\s*x:\s*-2px;/);
    assert.match(friends, /(?:^|;)\s*y:\s*-2px;/);
    assert.doesNotMatch(globalCss, /#CitadelPartyContainer \.FriendsCountContainer/);
});
