"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ESLint } = require("eslint");

const root = path.resolve(__dirname, "..");
const eslint = new ESLint({ cwd: root });
const contexts = [
    "panorama/scripts/core/ql_scheduler.js",
    "panorama/scripts/ui/controls.js",
    "panorama/scripts/tools/qol_dump_tree.js",
    "panorama/scripts/tools/qollock_smoke_test.js",
    "scripts/validate_compact_schema.js",
    "scripts/native_test_reads.cjs",
    "tests/eslint_config.test.js",
    "tests/updater_worker.test.mjs",
    "tools/updater/worker.mjs",
];

async function errors(source, filePath) {
    const [result] = await eslint.lintText(source, { filePath: path.join(root, filePath) });
    return result.messages.filter(message => message.severity === 2);
}

const cases = [
    ["no-async-promise-executor", "new Promise(async resolve => { resolve(1); });",
        "new Promise(resolve => { resolve(1); });"],
    ["no-promise-executor-return", "new Promise(resolve => { return resolve(1); });",
        "new Promise(resolve => { resolve(1); return; });"],
    ["array-callback-return", "[1].map(value => { value + 1; });", "[1].map(value => value + 1);"],
    ["no-dupe-else-if", "function check(a) { if (a) return 1; else if (a) return 2; }",
        "function check(a, b) { if (a) return 1; else if (b) return 2; }"],
    ["no-unsafe-optional-chaining", "function read(value) { return (value?.item).name; }",
        "function read(value) { return value?.item?.name; }"],
    ["no-loss-of-precision", "const value = 9007199254740993;", "const value = 9007199254740991;"],
    ["constructor-super", "class Item extends Object { constructor() {} }",
        "class Item extends Object { constructor() { super(); } }"],
    ["no-class-assign", "class Item {} Item = 1;", "class Item {} const item = new Item();"],
    ["no-constructor-return", "class Item { constructor() { return {}; } }",
        "class Item { constructor() { this.value = 1; } }"],
    ["no-new-native-nonconstructor", "new Symbol('item');", "Symbol('item');"],
    ["no-setter-return", "const item = { set value(next) { return next; } };",
        "const item = { set value(next) { this.current = next; } };"],
];

for (const [rule, invalid, valid] of cases) {
    test(`ESLint: ${rule} rejects bugs and accepts valid code in every context`, async () => {
        for (const filePath of contexts) {
            const messages = await errors(invalid, filePath);
            assert.ok(messages.some(message => message.ruleId === rule), `${filePath}: ${rule} must report`);
            assert.deepEqual(await errors(valid, filePath), [], `${filePath}: valid ${rule} example`);
        }
    });
}

test("ESLint: declaration checks apply to Node and Worker without rewriting Panorama globals", async () => {
    for (const filePath of contexts) {
        const legacy = await errors("var sharedExport = 1;", filePath);
        const mutable = await errors("let value = 1; value.toString();", filePath);
        if (filePath.startsWith("panorama/") && !filePath.endsWith("qollock_smoke_test.js")) {
            assert.deepEqual(legacy, [], filePath);
            assert.deepEqual(mutable, [], filePath);
        } else {
            assert.ok(legacy.some(message => message.ruleId === "no-var"), filePath);
            assert.ok(mutable.some(message => message.ruleId === "prefer-const"), filePath);
        }
    }
});

test("ESLint: globals and module syntax stay in their owning contexts", async () => {
    assert.deepEqual(await errors("$.Msg(QOL);", contexts[0]), []);
    assert.deepEqual(await errors("GetSettingsLanguage();", contexts[1]), []);
    assert.deepEqual(await errors("const fs = require('node:fs'); module.exports = fs;", contexts[4]), []);
    assert.deepEqual(await errors("import test from 'node:test'; test('example', () => {});", contexts[7]), []);
    assert.deepEqual(await errors("export default { async fetch() { return Response.json(await fetch('/')); } };", contexts[8]), []);
    for (const [source, filePath] of [
        ["require('node:fs');", contexts[0]],
        ["GetSettingsLanguage();", contexts[0]],
        ["require('node:fs');", contexts[7]],
        ["process.exit(1);", contexts[8]],
        ["$.Msg('example');", contexts[8]],
    ]) {
        assert.ok((await errors(source, filePath)).some(message => message.ruleId === "no-undef"), filePath);
    }
});

test("ESLint: callback adapters can return the original Promise and use synchronous executors", async () => {
    const source = `
        function withCallback(promise, callback) {
            promise.then(value => callback(null, value), error => callback(error));
            return promise;
        }
        function request() {
            return withCallback(new Promise(resolve => { resolve(1); }), () => {});
        }
        async function consume() { return await request(); }
    `;
    for (const filePath of contexts) assert.deepEqual(await errors(source, filePath), [], filePath);
});

test("ESLint: local duplicate checkouts are excluded from repository lint", async () => {
    assert.equal(await eslint.isPathIgnored(path.join(root, ".claude/worktrees/old/scripts/tool.js")), true);
    assert.equal(await eslint.isPathIgnored(path.join(root, "scripts/validate_compact_schema.js")), false);
});
