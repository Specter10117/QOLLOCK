"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../scripts/simulator");

const OWNER_ACCOUNT_ID = "841196165";

function addLocalPartyAccount(hud, accountId) {
    const $ = hud.sandbox.global.$;
    const partyContainer = $.CreatePanel("Panel", hud.root, "CitadelPartyContainer");
    const party = $.CreatePanel("Panel", partyContainer, "CitadelParty");
    const localPlayer = $.CreatePanel("Panel", party, "LocalPlayer");
    const avatar = $.CreatePanel("Panel", localPlayer, "AvatarImage");
    avatar.accountid = accountId;
    return avatar;
}

function addRussianBottomChatMessage(hud) {
    const $ = hud.sandbox.global.$;
    const core = $.CreatePanel("Panel", hud.root, "");
    core.AddClass("HudCore");
    const chat = $.CreatePanel("CitadelChat", core, "Chat");
    const lines = $.CreatePanel("Panel", chat, "ChatLinesArea");
    const wrapper = $.CreatePanel("Panel", lines, "");
    wrapper.AddClass("ChatLinesWrapper");
    const container = $.CreatePanel("Panel", wrapper, "ChatMessages");
    const message = $.CreatePanel("Panel", container, "RussianMessage");
    message.AddClass("ChatMessage");
    const contents = $.CreatePanel("Panel", message, "MessageContents");
    const label = $.CreatePanel("Label", contents, "MessageText");
    label.text = "Привет";
    return { label, message };
}

test("chat translation keeps resolving until the owner binding becomes available", () => {
    const hud = sim.createHud({ boot: false });
    hud.root.SetAttributeString("QOL_LocalTranslationOwner_v1", "0");
    const chat = addRussianBottomChatMessage(hud);
    for (const script of hud.scripts.scripts) hud.sandbox.load(script.absPath);
    hud.assertLoaded();
    const QOL = hud.sandbox.global.QOL;
    const State = QOL.state;

    assert.equal(QOL.core.FeatureRegistry.isEnabled("ql_chat_images"), false);
    assert.equal(State.localTranslationOwnerMatch, undefined);

    // The native party/account binding can appear well after manifest startup.
    // Passing the old 15-second deadline must not latch a missing ID as denial.
    hud.clock.advance(16000);
    assert.equal(State.localTranslationOwnerMatch, undefined);
    assert.equal(hud.root.GetAttributeString("QOL_LocalTranslationOwner_v2", ""), "");

    addLocalPartyAccount(hud, OWNER_ACCOUNT_ID);
    hud.clock.advance(2100);

    assert.equal(State.localTranslationOwnerMatch, undefined);
    assert.equal(hud.root.GetAttributeString("QOL_LocalTranslationOwner_v2", ""), "1");
    assert.equal(chat.label.style.visibility, undefined);
    assert.equal(chat.message.FindChildrenWithClassTraverse("QOLLocalChatTranslation").length, 1);
});

test("chat translation fail-closes after a positively identified non-owner", () => {
    const hud = sim.createHud();
    hud.assertLoaded();
    const State = hud.sandbox.global.QOL.state;
    const avatar = addLocalPartyAccount(hud, "12345678");

    hud.clock.advance(500);
    assert.equal(State.localTranslationOwnerMatch, undefined);
    assert.equal(hud.root.GetAttributeString("QOL_LocalTranslationOwner_v2", ""), "0");

    avatar.accountid = OWNER_ACCOUNT_ID;
    hud.clock.advance(2500);
    assert.equal(State.localTranslationOwnerMatch, undefined);
});
