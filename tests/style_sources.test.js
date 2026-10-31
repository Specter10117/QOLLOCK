"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inspect, parseStyle } = require("../scripts/trace_style_sources");
const tool = path.resolve(__dirname, "../scripts/trace_style_sources.js");
const resource = name => `s2r://panorama/styles/${name}.vcss_c`;
const imported = name => `@import url("${resource(name)}");`;

function fixture(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qollock-style-sources-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const directory of ["panorama/layout", "panorama/styles"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (const [file, source] of Object.entries(files)) {
        const target = path.join(root, "panorama", file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, source);
    }
    return options => inspect({ root, token: ".target", ...options });
}

test("traces separate XML contexts and native resource roots without pretending HUD inheritance", t => {
    const run = fixture(t, {
        "layout/hud.xml": `<root><styles><include src="${resource("hud")}"/></styles></root>`,
        "layout/card.xml": `<root><styles><include src="${resource("card")}"/></styles></root>`,
        "styles/hud.css": imported("features/hud"),
        "styles/card.css": imported("base/card") + "\n" + imported("features/card"),
        "styles/base/card.css": ".target { color: native; }",
        "styles/features/hud.css": ".target { color: red; }",
        "styles/features/card.css": "\n.target { color: green; }"
    });
    const report = run({ layout: "panorama/layout/hud.xml", property: "color" });
    const card = report.matches.find(match => match.file.endsWith("features/card.css"));
    assert.equal(card.line, 2);
    assert.equal(card.selectedLayoutRoute, false);
    assert.equal(card.declarations[0].value, "green");
    assert.deepEqual(card.routes.map(route => route.entry), ["panorama/layout/card.xml", "panorama/styles/card.css"]);
    assert.deepEqual(card.routes[0].chain.map(edge => [edge.source, edge.line]), [
        ["panorama/layout/card.xml", 1], ["panorama/styles/card.css", 2]
    ]);
    assert.equal(report.candidates.length, 1);
    assert.deepEqual(report.diagnostics, []);
    assert.ok(report.matches.find(match => match.file.endsWith("features/hud.css")).selectedLayoutRoute);
    assert.equal(report.coverage.sourceFingerprint.length, 64);
    assert.equal(run({ includeBase: true }).matches.length, 3);
});

test("ignores commented/script includes, fake import strings, prefix tokens and keyframe bodies", t => {
    const run = fixture(t, {
        "layout/hud.xml": `<root>
<!-- <styles><include src="${resource("commented")}"/></styles> -->
<scripts><include src="${resource("script_fake")}"/></scripts>
<styles>
<!-- <include src="${resource("commented")}"/> -->
<include src="${resource("hud")}"/>
</styles></root>`,
        "styles/hud.css": `/* ${imported("commented")} */
${imported("features/real")}
.other { font-family: '@import "${resource("string_fake")}";'; }
@keyframes 'Pulse' { 0% { color: red; } }`,
        "styles/features/real.css": `.target_suffix { color: wrong; }
.other[data-text=".target"] { color: wrong; }
.other[data-unquoted=.target] { color: wrong; }
.root:not(.target), .target:hover {
    color: gradient(linear, 0% 0%, 100% 100%, from(red), to(blue));
    background-image: url("s2r://images/a;{b}.vtex");
}`
    });
    const report = run();
    assert.equal(report.matches.length, 1);
    assert.equal(report.matches[0].line, 4);
    assert.equal(report.matches[0].declarations.length, 2);
    assert.equal(report.matches[0].declarations[1].value, 'url("s2r://images/a;{b}.vtex")');
    const xml = report.matches[0].routes.find(route => route.kind === "layout");
    assert.equal(xml.chain[0].line, 6);
    assert.equal(xml.chain[1].line, 2);
    assert.deepEqual(report.unknown, []);
    assert.throws(() => run({ token: "0" }), /selector token/);
    assert.equal(run({ token: "hover" }).matches.length, 0, "pseudo-class names are not panel types");
});

test("retains diamond routes and repeated includes without labelling equal writes or conflicts", t => {
    const run = fixture(t, {
        "layout/hud.xml": `<styles><include src="${resource("hud")}"/></styles>`,
        "styles/hud.css": imported("left") + "\n" + imported("right"),
        "styles/left.css": imported("features/shared"),
        "styles/right.css": imported("features/shared") + "\n" + imported("features/shared"),
        "styles/features/shared.css": ".target { opacity: 1; opacity: 1; }"
    });
    const report = run();
    const [match] = report.matches;
    assert.equal(match.routes.filter(route => route.kind === "layout").length, 3);
    assert.equal(match.declarations.length, 2);
    assert.deepEqual(report.diagnostics, []);
    assert.deepEqual(report.candidates, []);
});

test("missing native sources and unreachable extensions remain unknown, with stable source identity", t => {
    const run = fixture(t, {
        "layout/hud.xml": `<styles><include src="${resource("hud")}"/><include src="https://external/native.css"/></styles>`,
        "styles/hud.css": imported("native_unshipped"),
        "styles/features/orphan.css": ".target { opacity: 0; }"
    });
    const report = run();
    assert.deepEqual(report.matches[0].routes, []);
    assert.equal(report.unknown.length, 2);
    assert.ok(report.unknown.every(item => item.line === 1 && /unverified/.test(item.reason)));
    assert.deepEqual(report.diagnostics, []);
    assert.deepEqual(report.candidates, []);
    assert.equal(report.coverage.sourceFingerprint, run().coverage.sourceFingerprint);
    assert.equal(run({ property: "missing" }).matches.length, 0);
    assert.throws(() => run({ layout: "panorama/layout/missing.xml" }), /Unknown local layout/);
});

test("reports real source cycles even outside XML roots, and terminates route traversal", t => {
    const run = fixture(t, {
        "styles/features/a.css": imported("features/b") + "\n.target { color: red; }",
        "styles/features/b.css": imported("features/a")
    });
    const report = run();
    assert.equal(report.diagnostics.length, 1);
    assert.deepEqual(report.diagnostics[0].files, ["panorama/styles/features/a.css", "panorama/styles/features/b.css", "panorama/styles/features/a.css"]);
    assert.deepEqual(report.diagnostics[0].edges.map(edge => edge.line), [1, 1]);
    assert.equal(report.matches.length, 1);
});

test("excludes unsupported nested rules and rejected syntax instead of inventing complete coverage", () => {
    const parsed = parseStyle('@media unknown { .target { color: red; } }\n.target { color: blue; }', "feature.css");
    assert.equal(parsed.rules.length, 1);
    assert.equal(parsed.rules[0].declarations[0].value, "blue");
    assert.match(parsed.unsupported[0].reason, /At-rule body excluded/);
    const broken = parseStyle('.target { color: "unfinished; }', "broken.css");
    assert.deepEqual(broken.rules, []);
    assert.match(broken.unsupported[0].reason, /not parsed/);
    const escaped = parseStyle(String.raw`.target\:special { color: red; }`, "escaped.css");
    assert.deepEqual(escaped.rules, []);
    assert.match(escaped.unsupported[0].reason, /Escaped selector/);
});

test("route bounds report incomplete selection as unknown instead of a missing-route candidate", t => {
    const files = { "styles/target.css": ".target { color: red; }" };
    for (let index = 0; index < 16; index++) files[`styles/features/diamond${index}.css`] =
        imported(index === 15 ? "target" : `features/diamond${index + 1}`) + "\n" +
        imported(index === 15 ? "target" : `features/diamond${index + 1}`);
    files["layout/a.xml"] = `<styles><include src="${resource("features/diamond0")}"/></styles>`;
    files["layout/z.xml"] = `<styles><include src="${resource("target")}"/></styles>`;
    const report = fixture(t, files)({ layout: "panorama/layout/z.xml" });
    assert.ok(report.coverage.omittedBranches > 0);
    assert.equal(report.matches[0].selectedLayoutRoute, null);
    assert.deepEqual(report.candidates, []);
});

test("CLI searches production routes, includes base rules on request and rejects bad options", () => {
    const result = spawnSync(process.execPath, [tool, ".hud_hero_testing_root", "--property", "y", "--layout", "panorama/layout/hud.xml", "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.matches.some(match => match.file === "panorama/styles/features/ql_feat_native_hero_testing_menu.css" &&
        match.selectedLayoutRoute === false && match.routes.some(route => route.entry === "panorama/styles/hero_testing_menu.css")));
    assert.equal(report.coverage.omittedBranches, 0);
    const native = inspect({ token: ".weapon_ammo", property: "color", includeBase: true });
    assert.ok(native.matches.some(match => match.selector.includes(".nurse_needles") && match.declarations.some(item => item.value === "#80ffd7")));
    for (const args of [[], [".target", "--property"], [".target", "--layout", "missing.xml"], [".target", "--typo"], [".target .other"]]) {
        assert.equal(spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" }).status, 1, args.join(" "));
    }
});
