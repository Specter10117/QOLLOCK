"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");
const startDrag = require("./customize_drag_fixture");

function setup(kind) {
    const env = load(), Q = env.global.QOL, id = kind === "souls" ? "souls" : "cooldowns";
    Q.ui.window.setOpen(true); env.clock.advance(500);
    const rect = (panel, width, height, x = 0, y = 0) => Object.assign(panel, {
        actuallayoutwidth: width, actuallayoutheight: height, actualxoffset: x, actualyoffset: y
    });
    const add = (parent, id, classes = []) => parent.addChild(env.doc.create("Panel", { id, classes }));
    const core = add(env.hud.root, "", ["HudCore"]);
    rect(add(core, "gameplay_hud"), 1920, 1080);
    const abilities = rect(add(core, "AbilitiesContainer"), 1920, 1080);
    const passive = rect(add(abilities, "hud_passive_items"), 600, 60);
    const left = rect(add(add(core, "StatsAndModsContainer"), "LowerLeft"), 420, 1080);
    const souls = rect(add(left, "gold_and_ap_container"), 400, 85, 200, 100);
    rect(add(souls, "PlayerLevelContainer"), 83, 85);
    rect(add(souls, "hudGoldContainer"), 140, 59, 68, 18);
    Object.assign(env.global.MOD_CONFIG, { ENABLE_PASSIVE_COOLDOWN: 1, ENABLE_OLD_ITEM_COOLDOWNS: kind === "basic" ? 1 : 0,
        PASSIVE_COOLDOWN_X: 0, PASSIVE_COOLDOWN_Y: -2, PASSIVE_COOLDOWN_SIZE: 40 });
    env.global.SaveAndSync(); env.clock.advance(700);
    Q.ui.customize.start(null, { elementId: id });
    rect(env.em.FindChildTraverse("QOLCustomizeEditor"), 1920, 1080);
    env.clock.advance(600);
    const target = kind === "souls" ? souls : kind === "basic" ? passive : env.hud.root.FindChildTraverse("QOLItemMirrorRoot");
    assert.ok(target);
    rect(target, kind === "souls" ? 400 : 600, kind === "souls" ? 85 : 60, 200, 100);
    const sample = () => target.FindChildrenWithClassTraverse("QOLCustomizeSample")[0];
    if (kind !== "souls") rect(sample(), 45, 45);
    env.clock.advance(300);
    return { ...env, Q, id, target, rect, add, sample, retired: add(env.hud.root, "RetiredUnion"),
        store: env.hud.sandbox.global.QOL.core.ConfigStore,
        find: name => env.em.FindChildTraverse(name) };
}

for (const kind of ["souls", "basic", "advanced"]) test(`${kind}: a delayed resize cannot anchor a replacement union to retired content`, () => {
    const env = setup(kind), isSouls = kind === "souls";
    const handle = env.find("QOLCustomizeResize_" + env.id);
    const proxy = startDrag(env, handle); assert.ok(proxy);
    proxy.actualxoffset += isSouls ? 104 : 32;
    proxy.actualyoffset += isSouls ? 42.5 : 28;
    startDrag.end(env, handle, proxy); env.clock.advance(600);
    const sizeOwner = isSouls ? "ql_presentation_scale" : "ql_passive_cooldown";
    const sizeKey = isSouls ? "SOULS_SCALE" : "PASSIVE_COOLDOWN_SIZE";
    const positionOwner = isSouls ? "ql_souls" : "ql_passive_cooldown";
    const xKey = isSouls ? "SOULS_X_OFFSET" : "PASSIVE_COOLDOWN_X";
    const yKey = isSouls ? "SOULS_Y_OFFSET" : "PASSIVE_COOLDOWN_Y";
    assert.equal(env.store.get(sizeOwner, sizeKey), isSouls ? 150 : 60);
    if (isSouls) {
        for (const id of ["PlayerLevelContainer", "hudGoldContainer"]) env.target.FindChild(id).SetParent(env.retired);
        env.rect(env.add(env.target, "PlayerLevelContainer"), 124.5, 127.5, 60, 40);
        env.rect(env.add(env.target, "hudGoldContainer"), 210, 88.5, 162, 67);
    } else {
        env.sample().SetParent(env.retired);
        env.clock.advance(600); // Production owner constructs its replacement sample.
        assert.ok(env.sample());
        env.rect(env.sample(), 67.5, 67.5, 60, 40);
    }
    env.clock.advance(700);
    assert.equal(env.store.get(positionOwner, xKey), 0, "new content must not receive the retired resize's anchor correction");
    assert.equal(env.store.get(positionOwner, yKey), isSouls ? 0 : -2);
    env.find("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const kind of ["souls", "basic", "advanced"]) test(`${kind}: replacing measured content cancels an active resize without retaining its draft`, () => {
    const env = setup(kind), isSouls = kind === "souls";
    const handle = env.find("QOLCustomizeResize_" + env.id), proxy = startDrag(env, handle);
    assert.ok(proxy);
    proxy.actualxoffset += isSouls ? 104 : 32; proxy.actualyoffset += isSouls ? 42.5 : 28;
    env.clock.advance(500);
    assert.equal(env.find("QOLCustomizeFields").enabled, false);
    if (isSouls) {
        env.target.FindChild("PlayerLevelContainer").SetParent(env.retired);
        env.rect(env.add(env.target, "PlayerLevelContainer"), 83, 85);
    } else env.sample().SetParent(env.retired);
    env.clock.advance(100);
    assert.equal(proxy.IsValid(), false, "capture cannot continue against different measured content");
    assert.equal(env.find("QOLCustomizeFields").enabled, true);
    assert.equal(env.store.get(isSouls ? "ql_presentation_scale" : "ql_passive_cooldown", isSouls ? "SOULS_SCALE" : "PASSIVE_COOLDOWN_SIZE"), isSouls ? 100 : 40);
    env.find("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const kind of ["souls", "basic", "advanced"]) test(`${kind}: intact measured content still settles its resize anchor`, () => {
    const env = setup(kind), isSouls = kind === "souls";
    const handle = env.find("QOLCustomizeResize_" + env.id), proxy = startDrag(env, handle);
    proxy.actualxoffset += isSouls ? 104 : 32; proxy.actualyoffset += isSouls ? 42.5 : 28;
    startDrag.end(env, handle, proxy); env.clock.advance(600);
    if (isSouls) {
        env.rect(env.target.FindChild("PlayerLevelContainer"), 124.5, 127.5, 60, 40);
        env.rect(env.target.FindChild("hudGoldContainer"), 210, 88.5, 162, 67);
    } else env.rect(env.sample(), 67.5, 67.5, 60, 40);
    env.clock.advance(700);
    assert.equal(env.store.get(isSouls ? "ql_souls" : "ql_passive_cooldown", isSouls ? "SOULS_X_OFFSET" : "PASSIVE_COOLDOWN_X"), isSouls ? -60 : -3);
    assert.equal(env.store.get(isSouls ? "ql_souls" : "ql_passive_cooldown", isSouls ? "SOULS_Y_OFFSET" : "PASSIVE_COOLDOWN_Y"), isSouls ? 40 : 2);
    env.find("QOLCustomizeUndo")._fire("onactivate"); env.clock.advance(500);
    assert.equal(env.store.get(isSouls ? "ql_souls" : "ql_passive_cooldown", isSouls ? "SOULS_X_OFFSET" : "PASSIVE_COOLDOWN_X"), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false, "the anchor correction belongs to the same drop");
    env.find("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});

for (const kind of ["souls", "basic", "advanced"]) test(`${kind}: repeated moves at doubled UI density keep one history entry per drop and Cancel restores canonical geometry`, () => {
    const env = setup(kind), isSouls = kind === "souls";
    const scaleTree = panel => {
        for (const key of ["actuallayoutwidth", "actuallayoutheight", "actualxoffset", "actualyoffset"]) panel[key] *= 2;
        panel.actualuiscale_x = panel.actualuiscale_y = 2;
        for (const child of panel.Children()) scaleTree(child);
    };
    // The HUD content and settings canvas report physical pixels separately.
    // Only the gameplay tree has real dimensions in this fixture.
    for (const panel of env.hud.root.FindChildrenWithClassTraverse("HudCore")) scaleTree(panel);
    const canvas = env.find("QOLCustomizeEditor");
    env.rect(canvas, 3840, 2160); canvas.actualuiscale_x = canvas.actualuiscale_y = 2;
    env.clock.advance(300);
    const frame = env.find("QOLCustomizeFrame_" + env.id);
    const positionOwner = isSouls ? "ql_souls" : "ql_passive_cooldown";
    const xKey = isSouls ? "SOULS_X_OFFSET" : "PASSIVE_COOLDOWN_X";
    const yKey = isSouls ? "SOULS_Y_OFFSET" : "PASSIVE_COOLDOWN_Y";
    for (const [dx, dy, x, y] of [[192, -108, isSouls ? 96 : 5, isSouls ? 54 : 3],
        [-384, 216, isSouls ? -96 : -5, isSouls ? -54 : -7]]) {
        const proxy = startDrag(env, frame); assert.ok(proxy);
        proxy.actualxoffset += dx; proxy.actualyoffset += dy;
        startDrag.end(env, frame, proxy); env.clock.advance(500);
        assert.equal(env.store.get(positionOwner, xKey), x);
        assert.equal(env.store.get(positionOwner, yKey), y);
        env.target.actualxoffset += dx; env.target.actualyoffset += dy; env.clock.advance(300);
    }
    env.find("QOLCustomizeUndo")._fire("onactivate"); env.clock.advance(500);
    assert.equal(env.store.get(positionOwner, xKey), isSouls ? 96 : 5);
    env.find("QOLCustomizeUndo")._fire("onactivate"); env.clock.advance(500);
    assert.equal(env.store.get(positionOwner, xKey), 0);
    assert.equal(env.find("QOLCustomizeUndo").enabled, false);
    env.find("QOLCustomizeRedo")._fire("onactivate"); env.clock.advance(500);
    env.find("QOLCustomizeReset")._fire("onactivate"); env.clock.advance(500);
    assert.equal(env.store.get(positionOwner, xKey), 0);
    assert.equal(env.store.get(positionOwner, yKey), 0, "Reset uses current defaults rather than the saved test offset");
    env.find("QOLCustomizeCancel")._fire("onactivate"); env.clock.advance(1200);
    assert.equal(env.global.MOD_CONFIG[xKey], 0); assert.equal(env.global.MOD_CONFIG[yKey], isSouls ? 0 : -2);
    assert.deepEqual(env.doc.eventErrors, []); assert.deepEqual(env.clock.errors, []);
});
