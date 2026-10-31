"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { readStyleSource: read } = require("./helpers/style_source");

function cssRules(css) {
    const normalized = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@(import|define)[^;]+;/g, "");
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    return Array.from(normalized.matchAll(rulePattern), (match) => ({
        selectors: match[1].split(",").map((candidate) => candidate.trim()),
        body: match[2]
    }));
}

function ruleBody(css, selector) {
    let body = null;
    for (const rule of cssRules(css)) {
        if (rule.selectors.includes(selector)) body = rule.body;
    }
    assert.notEqual(body, null, `missing selector: ${selector}`);
    return body;
}

test("quick-buy override preserves the current native listener and summary binding tree", () => {
    const layout = read("panorama/layout/hud_quickbuy.xml");

    const listener = layout.match(/<GlobalClassListener\b[^>]*\bclasses="([^"]*)"/);
    assert.ok(listener, "quick-buy receives native global state");
    const classes = new Set(listener[1].split(/\s+/));
    for (const required of ["gStreetBrawl", "gQuickbuyShopShowQueue", "gHighUnspentSouls"]) {
        assert.ok(classes.has(required), `missing quick-buy state: ${required}`);
    }
    assert.match(layout, /<Panel id="HudMiniFill" hittest="false" \/>/);
    assert.match(layout, /<Panel class="ItemsBlockedReason" hittest="false">[\s\S]*?<Label class="SlotsFullLabel"[^>]*\/>[\s\S]*?<Label class="SlotsLockedLabel"[^>]*\/>/);
    assert.match(layout, /<Panel id="HudMini"[^>]*>[\s\S]*?<Panel id="HudMiniContents">[\s\S]*?<CitadelHudQuickbuyEntry id="QuickbuyNext" \/>/);
    assert.match(layout, /<Panel class="QuickbuyShopSummaryContainer">[\s\S]*?<Panel id="QuickbuyShopSummary" class="QuickbuyShopSummary" onmouseactivate="CitadelQuickbuyToggleShopQueue\(\)">/);
    assert.match(layout, /<CitadelModIcon id="QuickbuyShopSummaryModIcon" class="QuickbuyShopSummaryModIcon" hittest="false" \/>/);

    for (const nativeBinding of [
        'class="quickbuy_icon"',
        'class="quickbuy_details"',
        'class="ItemsReadyLabel"',
        'class="ItemsForSell"',
        'class="sell_icon"',
        'class="ItemsSellLabel" text="{d:sell_queue_size}"'
    ]) {
        assert.ok(layout.includes(nativeBinding), `missing current quick-buy binding: ${nativeBinding}`);
    }
});

test("quick-buy styles extend refreshed native resources without stale toggle selectors", () => {
    const css = read("panorama/styles/hud_quickbuy.css");
    const base = read("panorama/styles/base/hud_quickbuy.css");
    const entry = read("panorama/styles/hud_quickbuy_entry.css");

    assert.match(css, /@import url\("s2r:\/\/panorama\/styles\/base\/hud_quickbuy\.vcss_c"\);/);
    assert.match(entry, /@import url\("s2r:\/\/panorama\/styles\/base\/hud_quickbuy_entry\.vcss_c"\);/);
    assert.doesNotMatch(css, /!important/);
    assert.doesNotMatch(entry, /!important/);
    assert.doesNotMatch(css, /#CitadelHudQuickbuy\.QuickbuyShopShowQueue\b/);

    const openQueue = ruleBody(css, ".gShopOpen #CitadelHudQuickbuy.gQuickbuyShopShowQueue .QuickbuyQueueOuter");
    assert.match(openQueue, /opacity:\s*1;/);
    const baseOpenQueue = ruleBody(base, ".gShopOpen #CitadelHudQuickbuy.gQuickbuyShopShowQueue .QuickbuyQueueOuter");
    assert.match(baseOpenQueue, /opacity:\s*1;/);

    // Valve owns mini-card dimensions. Keep checking the selectors we extend,
    // without rejecting a native resource refresh merely for resizing the card.
    ruleBody(base, "#HudMini");
    ruleBody(base, "#HudMini #HudMiniContents");
    for (const rule of cssRules(css)) {
        if (rule.selectors.some((selector) => /#HudMini(?:\s|$)/.test(selector))) {
            assert.doesNotMatch(rule.body, /(?:^|;)\s*(?:width|height)\s*:/,
                "mini-card geometry must continue to come from the native baseline");
        }
    }

    const enhancedMini = ruleBody(css, "#CitadelHudQuickbuy.enhanced_quickbuy_active #HudMini");
    const previews = ruleBody(css, "#QuickbuyUpcomingPreviewContainer");
    assert.match(enhancedMini, /horizontal-align:\s*left;/,
        "enhanced first card shares left-aligned HUD coordinates with its companion previews");
    assert.match(previews, /horizontal-align:\s*left;/);

    const narrowBuyQueue = ruleBody(css, ".support_4_3_active .gShopOpen #QuickbuyQueue");
    const narrowSellQueue = ruleBody(css, ".support_4_3_active .gShopOpen #QuickbuySellQueue");
    const narrowSummary = ruleBody(css, ".support_4_3_active .QuickbuyShopSummaryContainer");
    const narrowQueueOuter = ruleBody(css, ".support_4_3_active .gShopOpen #CitadelHudQuickbuy .QuickbuyQueueOuter");
    assert.match(narrowBuyQueue, /width:\s*210px;/);
    assert.match(narrowSellQueue, /width:\s*210px;/);
    assert.match(narrowSummary, /margin-left:\s*0px;/);
    assert.match(narrowQueueOuter, /margin-left:\s*10px;/);
    assert.doesNotMatch(css, /\.support_4_3_active \.gShopOpen #QuickBuyQueueContainer/);

    assert.doesNotMatch(css, /\.QuickbuyItem\.IsBeingDragged\.isWeapon/);
    assert.match(entry, /#QuickbuyPreview2Entry/);
    assert.match(entry, /#NotifyButton/);
});
