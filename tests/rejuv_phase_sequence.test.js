"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

test("rejuvenator encounter sequence advances once per claim and keeps HUD/minimap deadlines on match time", t => {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    t.after(() => hud.sandbox.global.QOL.core.App.shutdown());
    const { $, QOL: Q } = hud.sandbox.global;
    hud.root.AddClass("joined_team");
    const core = $.CreatePanel("Panel", hud.root, ""); core.AddClass("HudCore");
    const top = $.CreatePanel("Panel", core, "TopBar");
    const clock = $.CreatePanel("Panel", top, ""); clock.AddClass("GameClock");
    const gameTime = $.CreatePanel("Label", clock, "GameTime"); gameTime.text = "12:00";
    const readout = $.CreatePanel("Panel", top, "RejuvHUD");
    const label = $.CreatePanel("Label", readout, "RejuvTimeHUD");
    const number = $.CreatePanel("Label", readout, "RejuvNumHUD");
    const charges = $.CreatePanel("Panel", top, "RejuvenatorCharges");
    const friendly = $.CreatePanel("Panel", charges, "RejuvenatorFriendly"); friendly.AddClass("RejuvCount_0");
    const enemy = $.CreatePanel("Panel", charges, "RejuvenatorEnemy"); enemy.AddClass("RejuvCount_0");
    $.CreatePanel("Panel", charges, "RejuvenatorTimer");
    const gameplay = $.CreatePanel("Panel", core, "gameplay_hud");
    const clamp = $.CreatePanel("Panel", gameplay, ""); clamp.AddClass("clamp_width");
    const host = $.CreatePanel("Panel", clamp, "minimap_persp");
    const container = $.CreatePanel("Panel", host, "minimap_container");
    const native = $.CreatePanel("Panel", container, "HudMinimapContainer");
    const map = $.CreatePanel("Panel", native, "hud_minimap");
    const boss = $.CreatePanel("Panel", map, "");
    for (const cls of ["mid_boss", "map_button", "midboss_spawned"]) boss.AddClass(cls);

    // Real config routing, registry lifecycle, clock observation and Scheduler;
    // only native evidence is supplied by the simulator, never rejuvState.
    Q.core.ConfigAdapter.loadFromFlat({ ENABLE_REJUV_HUD: 1, ENABLE_MINIMAP_REJUV_TIMER: 1 });
    function observe(time, text, phase, wallMs = 3500) {
        gameTime.text = time;
        hud.clock.advance(wallMs);
        const context = `match ${time}, wall ${hud.clock.now()}ms`;
        assert.equal(Q.core.FeatureRegistry.isEnabled("ql_rejuv_hud"), true, context);
        assert.equal(Q.core.FeatureRegistry.isEnabled("ql_minimap_timers"), true, context);
        assert.equal(label.text, text, `HUD: ${context}`);
        assert.equal(number.text, phase, `phase: ${context}`);
        const minimap = hud.root.FindChildTraverse("QOLMinimapRejuvTime");
        assert.ok(minimap, `minimap readout: ${context}`);
        assert.equal(minimap.text, text, `minimap: ${context}`);
        assert.equal(minimap.GetParent().BHasClass("qol-hidden"), false, context);
        assert.equal(minimap.GetParent().GetParent().BHasClass("qol-hidden"), false, context);
        assert.deepEqual(hud.clock.errors, [], hud.diagnose());
        assert.equal(Q.core.FeatureRegistry.getErrorCounts().ql_rejuv_hud || 0, 0, hud.diagnose());
        assert.equal(Q.core.FeatureRegistry.getErrorCounts().ql_minimap_timers || 0, 0, hud.diagnose());
    }
    function setCharges(count) {
        friendly.SetHasClass("RejuvCount_0", count === 0);
        friendly.SetHasClass("RejuvCount_3", count === 3);
    }

    observe("12:00", "Spawn", "1");
    boss.RemoveClass("midboss_spawned");
    observe("12:01", "7:00", "2");
    observe("12:01", "7:00", "2", 20000); // Paused match, live poll loops.
    setCharges(3); // Delayed pickup belongs to the same encounter.
    observe("12:02", "6:59", "2");
    observe("19:00", "0:01", "2");
    observe("19:01", "Spawn", "2");
    observe("19:06", "Spawn", "2"); // A retained charge token cannot claim again.

    setCharges(0); boss.AddClass("midboss_spawned");
    observe("19:07", "Spawn", "2");
    setCharges(3); boss.RemoveClass("midboss_spawned");
    observe("19:08", "6:00", "3"); // Both native signals still count once.
    observe("25:07", "0:01", "3");
    observe("25:08", "Spawn", "3");

    // The charge transition alone remains sufficient when the map signal is absent.
    boss.DeleteAsync(0);
    setCharges(0);
    observe("25:09", "Spawn", "3");
    setCharges(3);
    observe("25:10", "5:00", "3");
    observe("30:09", "0:01", "3");
    observe("30:10", "Spawn", "3");
    setCharges(0);
    observe("30:11", "Spawn", "3");
    setCharges(3);
    observe("30:12", "5:00", "3"); // Later encounters retain the final phase.
});
