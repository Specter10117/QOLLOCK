"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load_settings_environment");

function setup() {
    const env = load(), g = env.global, Q = g.QOL;
    const label = g.$.CreatePanel("Label", env.em, "DevStatus");
    const button = g.$.CreatePanel("Button", env.em, "DevAction");
    g.SaveAndSync();
    return { ...env, Q, label, button, baseline: JSON.stringify(Q.getSettingsConfig()) };
}

for (const finish of ["stop", "complete", "deleted-controls"]) {
    test(`Preset Cycle restores the original settings after ${finish}`, () => {
        const e = setup();
        const presets = e.global.QOL_PRESETS;
        // Two actual presets keep the production cycle and bridge bounded.
        for (const key of Object.keys(presets)) if (!["Maximum", "iKaritzu"].includes(key)) delete presets[key];
        e.Q.ui.devTab.runPresetCycle(e.label, e.button);
        e.clock.advance(150);
        assert.notEqual(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
        if (finish === "stop") e.Q.ui.devTab.runPresetCycle(e.label, e.button);
        if (finish === "deleted-controls") e.label.DeleteAsync(0);
        e.clock.advance(10000);
        assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
        const published = e.Q.parseStoredConfig(e.hud.root.GetAttributeString("Deadlock_Mod_Settings_v1", ""));
        assert.deepEqual(JSON.parse(JSON.stringify(published)), JSON.parse(e.baseline));
        assert.deepEqual(e.clock.errors, []);
    });
}

test("Feature Test uses the current toggle catalog and never tests numeric or retired preset keys", () => {
    const e = setup(), observed = new Set();
    e.global.QOL_PRESETS.Maximum.ENABLE_RETIRED_TEST_KEY = 1;
    const setAttribute = e.hud.root.SetAttributeString;
    e.hud.root.SetAttributeString = function (key, value) {
        if (key === "QOL_DiagRequest" && value.startsWith("fit_")) observed.add(e.label.text.replace(/^\[\d+\/\d+\] /, ""));
        return setAttribute.call(this, key, value);
    };
    e.Q.ui.devTab.runFeatureIsolationTest(e.label, e.button);
    e.clock.advance(240000);
    assert.ok(observed.has("TOP_BAR_HIDE_NORMAL"), "new visibility toggles are part of the current catalog");
    assert.ok(!observed.has("HUD_INDICATOR_SIZE"), "numeric HUD settings must not be forced to one");
    assert.ok(!observed.has("ENABLE_RETIRED_TEST_KEY"), "presets do not define the current setting inventory");
    assert.match(e.label.text, /^Done:/);
    assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
    assert.deepEqual(e.clock.errors, []);
});

test("deleting Feature Test controls restores settings and retires its callbacks", () => {
    const e = setup();
    e.Q.ui.devTab.runFeatureIsolationTest(e.label, e.button);
    e.clock.advance(150);
    e.label.DeleteAsync(0);
    e.clock.advance(1000);
    assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
    assert.equal(e.button.BHasClass("CycleActive"), false);
    e.clock.advance(10000);
    assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
    assert.deepEqual(e.clock.errors, []);
});

test("configuration tests cannot overlap a running benchmark", () => {
    const e = setup();
    e.Q.ui.devTab.runInGameBenchmark(e.em, e.label, e.button, true);
    const token = e.hud.root.GetAttributeString("QOL_DiagRequest", "");
    const other = e.global.$.CreatePanel("Label", e.em, "OtherStatus");
    const otherButton = e.global.$.CreatePanel("Button", e.em, "OtherAction");
    e.Q.ui.devTab.runFeatureIsolationTest(other, otherButton);
    e.Q.ui.devTab.runPresetCycle(other, otherButton);
    e.clock.advance(600);
    assert.equal(e.hud.root.GetAttributeString("QOL_DiagRequest", ""), token);
    assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
    assert.equal(otherButton.BHasClass("CycleActive"), false);
    assert.deepEqual(e.clock.errors, []);
});

for (const method of ["runFeatureIsolationTest", "runPresetCycle"]) {
    test(`${method} preserves a newer user edit while restoring its temporary settings`, () => {
        const e = setup();
        e.Q.ui.devTab[method](e.label, e.button);
        e.clock.advance(150);
        const expected = JSON.parse(e.baseline);
        expected.TOP_BAR_X_OFFSET = 177;
        e.Q.getSettingsConfig().TOP_BAR_X_OFFSET = 177;
        e.global.SaveAndSync();
        e.clock.advance(1000);
        assert.deepEqual(JSON.parse(JSON.stringify(e.Q.getSettingsConfig())), expected);
        assert.equal(e.button.BHasClass("CycleActive"), false);
        e.clock.advance(10000);
        assert.deepEqual(JSON.parse(JSON.stringify(e.Q.getSettingsConfig())), expected);
        assert.deepEqual(e.clock.errors, []);
    });

    test(`${method} reports an actual registry retirement as failure`, () => {
        const e = setup(), Q = e.hud.sandbox.global.QOL;
        // Keep one preset so completion cannot overwrite the observed failure.
        for (const key of Object.keys(e.global.QOL_PRESETS)) if (key !== "Maximum") delete e.global.QOL_PRESETS[key];
        Q.core.FeatureRegistry.register({ id: "dev_test_failure", settings: [], enabledByDefault: true,
            create: () => ({ onEnable() {}, onDisable() {} }) });
        Q.core.FeatureRegistry.enable("dev_test_failure");
        for (let i = 0; i < 10; i++) Q.core.EventBus.emit("scheduler:error", { featureId: "dev_test_failure", message: "injected error" });
        e.Q.ui.devTab[method](e.label, e.button);
        e.clock.advance(400);
        const messages = e.settings.messages.filter(message => message.includes(method === "runPresetCycle" ? "[presetCycle]" : "[FeatureTest]"));
        assert.ok(messages.some(message => message.includes("dev_test_failure")), messages.join("\n"));
        assert.ok(messages.some(message => message.includes("FAIL")), messages.join("\n"));
        if (e.button.BHasClass("CycleActive")) e.Q.ui.devTab[method](e.label, e.button);
        assert.equal(JSON.stringify(e.Q.getSettingsConfig()), e.baseline);
        assert.deepEqual(e.clock.errors, []);
    });
}
