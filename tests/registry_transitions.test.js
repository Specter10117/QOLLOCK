"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHud } = require("../scripts/simulator");

function setup() {
    const hud = createHud({ inHideout: false });
    hud.assertLoaded();
    const { FeatureRegistry: registry, ConfigStore: store, EventBus: bus } = hud.sandbox.global.QOL.core;
    return { hud, registry, store, bus };
}

test("diagnostic error totals survive successful hooks, poll streak resets and owner re-enable", () => {
    const { registry, store, bus } = setup();
    const id = "diagnostic_errors";
    let fail = true;
    registry.register({ id, settings: [{ key: "COLOR", type: "number", default: 0 }],
        create: () => ({ onEnable() {}, onSettingsChanged() { if (fail) throw Error("hook fails once"); } }) });
    registry.enable(id); store.set(id, "COLOR", 1);
    fail = false; store.set(id, "COLOR", 2);
    assert.equal(registry.getErrorCounts()[id], 0);
    assert.equal(registry.getErrorTotals?.()[id], 1, "a successful hook must not erase diagnostic evidence");
    bus.emit("scheduler:error", { featureId: id }); bus.emit("scheduler:tick_ok", { featureId: id });
    const context = registry.createContext(id);
    context.events.on("diagnostic:throws", () => { throw Error("feature event failure"); });
    bus.emit("diagnostic:throws");
    registry.disable(id); registry.enable(id);
    assert.equal(registry.getErrorCounts()[id], 0);
    assert.equal(registry.getErrorTotals()[id], 3);
    const snapshot = registry.getErrorTotals(); snapshot[id] = 0;
    assert.equal(registry.getErrorTotals()[id], 3);
});

test("registry inspection follows completed instance transitions through reentrant hooks", () => {
    const { registry, bus } = setup();
    const id = "transition_inspection", snapshots = [];
    let instance, fail = false;
    const inspect = phase => snapshots.push({ phase, enabled: registry.isEnabled(id),
        listed: registry.getEnabledIds().includes(id), instance: registry.getInstance(id),
        presentation: registry.isPresentationAvailable(id) });
    registry.register({ id, create() {
        instance = {
            onEnable() {
                inspect("enable");
                registry.enable(id);
                if (fail) throw Error("modeled partial enable");
            },
            onDisable() {
                inspect(fail ? "failed cleanup" : "disable");
                registry.disable(id);
                registry.enable(id);
            }
        };
        return instance;
    } });
    bus.on("feature:presentation_changed", payload => { if (payload.featureId === id) inspect("published"); });
    registry.enable(id);
    const completed = instance;
    registry.disable(id);
    fail = true;
    registry.enable(id);
    assert.deepEqual(snapshots, [
        { phase: "enable", enabled: false, listed: false, instance: null, presentation: true },
        { phase: "disable", enabled: true, listed: true, instance: completed, presentation: false },
        { phase: "published", enabled: false, listed: false, instance: null, presentation: false },
        { phase: "enable", enabled: false, listed: false, instance: null, presentation: true },
        { phase: "failed cleanup", enabled: false, listed: false, instance: null, presentation: false },
        { phase: "published", enabled: false, listed: false, instance: null, presentation: false }
    ]);
});

test("unrelated settings preserve explicitly enabled owners until their enable setting changes", () => {
    const { registry, store } = setup();
    const id = "transition_explicit", calls = [];
    registry.register({ id, enableKey: "ACTIVE", settings: [
        { key: "ACTIVE", type: "toggle", default: false },
        { key: "COLOR", type: "number", default: 0 }
    ], create: () => ({ onEnable() { calls.push("enable"); }, onDisable() { calls.push("disable"); },
        onSettingsChanged(payload) { calls.push(payload.key); } }) });
    registry.enable(id);
    store.set(id, "COLOR", 1);
    assert.equal(registry.isEnabled(id), true);
    store.set(id, "ACTIVE", true);
    store.set(id, "ACTIVE", false);
    assert.equal(registry.isEnabled(id), false);
    assert.deepEqual(calls, ["enable", "COLOR", "ACTIVE", "disable"]);
});

test("failed enable can retry after synchronous cleanup publishes a new off/on intent", () => {
    const { registry, store, bus } = setup();
    const id = "transition_retry";
    let attempts = 0, settings = 0;
    registry.register({ id, enableKey: "ACTIVE", settings: [{ key: "ACTIVE", type: "toggle", default: false }],
        create: ctx => ({ onEnable() { if (++attempts === 1) throw Error("first setup fails"); },
            onDisable() { bus.emit("transition:cleanup", ctx.id); },
            onSettingsChanged() { settings++; } }) });
    bus.on("transition:cleanup", owner => {
        store.set(owner, "ACTIVE", false);
        store.set(owner, "ACTIVE", true);
    });
    store.set(id, "ACTIVE", true);
    assert.equal(attempts, 2);
    assert.equal(registry.isEnabled(id), true);
    assert.equal(settings, 1);
});

test("settings changed during disable cannot revive the retiring generation", () => {
    const { registry, store } = setup();
    const id = "transition_disable", calls = [];
    registry.register({ id, enableKey: "ACTIVE", settings: [{ key: "ACTIVE", type: "toggle", default: false }],
        create: () => ({ onEnable() { calls.push("enable"); }, onDisable() {
            calls.push("disable");
            store.set(id, "ACTIVE", true);
        }, onSettingsChanged(payload) { calls.push(payload.key); } }) });
    store.set(id, "ACTIVE", true);
    store.set(id, "ACTIVE", false);
    assert.equal(store.get(id, "ACTIVE"), true);
    assert.equal(registry.isEnabled(id), false);
    assert.deepEqual(calls, ["enable", "ACTIVE", "disable", "ACTIVE"]);
});
