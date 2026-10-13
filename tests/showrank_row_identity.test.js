"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function addPlayerRow($, playersList, name, hero) {
    const entry = $.CreatePanel("CitadelPlayersListEntry", playersList, "");
    const main = $.CreatePanel("Panel", entry, "MainContents");
    const details = $.CreatePanel("Panel", main, "");
    const nameLabel = $.CreatePanel("Label", details, "");
    nameLabel.AddClass("PlayerName");
    nameLabel.text = name;
    const heroLabel = $.CreatePanel("Label", details, "");
    heroLabel.AddClass("PlayerHeroHidden");
    heroLabel.text = hero;
    const accountLabel = $.CreatePanel("Label", details, "");
    accountLabel.AddClass("PlayerAccountHidden");
    $.CreatePanel("Image", main, "RankPredictionBadge");
    $.CreatePanel("Image", main, "RankPredictionBadgeOverlay");
    return { entry, nameLabel, heroLabel, accountLabel };
}

function createShowRankHarness(rows) {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    const Q = hud.sandbox.global.QOL;
    const $ = hud.sandbox.global.$;
    const escapeMenu = $.CreatePanel("CitadelHudEscapeMenu", hud.root, "EscapeMenu");
    const playersList = $.CreatePanel("Panel", escapeMenu, "PlayersList");
    const playerRows = rows.map((row) => addPlayerRow($, playersList, row.name, row.hero));
    const accountIds = Object.fromEntries(rows.map((row) => [row.name, row.accountId]));

    hud.root.AddClass("ShowEscapeMenu");
    hud.sandbox.onEvent("Activated", () => {
        const docRoot = hud.doc.absRoot;
        const name = docRoot.GetAttributeString("qol_sr_probe_name", "");
        $.Schedule(0.02, () => {
            const accountId = accountIds[name] || "";
            docRoot.SetAttributeString("qol_sr_probe_account", accountId);
        });
    });

    const feature = Q.core.FeatureRegistry.getManifest("ql_showrank").create({
        config: { view: () => ({ SHOW_RANK: 1, SHOW_RANK_TOPBAR: 0 }) }
    });
    feature.onEnable();

    return { hud, playerRows, feature };
}

test("show rank re-resolves rows after the escape-menu roster is reordered", () => {
    const env = createShowRankHarness([
        { name: "Alice", hero: "Haze", accountId: "101" },
        { name: "Bob", hero: "Ivy", accountId: "202" }
    ]);

    env.hud.clock.advance(3000);
    assert.deepEqual(env.playerRows.map((row) => row.accountLabel.text), ["101", "202"]);

    env.playerRows[0].nameLabel.text = "Bob";
    env.playerRows[0].heroLabel.text = "Ivy";
    env.playerRows[1].nameLabel.text = "Alice";
    env.playerRows[1].heroLabel.text = "Haze";
    env.hud.clock.advance(3000);

    assert.deepEqual(env.playerRows.map((row) => row.accountLabel.text), ["202", "101"]);
    assert.deepEqual(env.hud.clock.errors, []);
    env.feature.onDisable();
});
