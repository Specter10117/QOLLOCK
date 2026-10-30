"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

test("Minimap addons keep their ordinary toggles without separate text Customize entries", () => {
    const e = load(), Q = e.global.QOL;
    Q.ui.window.setOpen(true); e.clock.advance(500);
    Q.ui.window.setActiveTabAndRefresh("Minimap"); e.clock.advance(300);
    for (const id of ["mapTimers", "midBossTimer", "buffTimer", "bridgeBuffLeft", "bridgeBuffRight"]) {
        assert.equal(!!e.em.FindChildTraverse("QOLCustomizeEntry_" + id), false, id);
        assert.equal(Q.presentation.elements.some(element => element.id === id), false, id);
    }
    for (const key of ["ENABLE_MINIMAP_BUFF_TIMER", "ENABLE_MINIMAP_REJUV_TIMER", "ENABLE_MINIMAP_ELEVATION_MARKERS"])
        assert.ok(e.list.FindChildrenWithClassTraverse("SettingRow").some(row => row.GetAttributeString("QOL_ROW_RESET_KEYS", "").split(",").includes(key)), key);
    for (const key of ["MINIMAP_CAMP_NAMES", "MINIMAP_ROUTE_FROM_MINUTE", "MINIMAP_ROUTE_UNTIL_MINUTE", "MINIMAP_CRATE_FROM_MINUTE", "MINIMAP_CRATE_UNTIL_MINUTE"])
        assert.equal(e.list.FindChildrenWithClassTraverse("SettingRow_" + key).length, 0, key);
    assert.ok(e.em.FindChildTraverse("QOLCustomizeEntry_minimap"));
    assert.deepEqual(e.doc.eventErrors, []); assert.deepEqual(e.clock.errors, []);
});
