"use strict";

// Source routes, not a Panorama cascade or selector matcher.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { canonicalStyleResource, parseCssImports, parseHudStyleIncludes } = require("./check_native_css_imports");
const { stripXmlComments } = require("./simulator/layout");
const { scanSource } = require("./validate_panorama_styles");
const ROOT = path.resolve(__dirname, "..");
const slash = file => file.split(path.sep).join("/");
const lineAt = (source, offset) => source.slice(0, offset).split("\n").length;

// Keep offsets intact, including comments that resemble imports or selectors.
function withoutComments(source) {
    return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g,
        token => token.startsWith("/*") ? token.replace(/[^\n]/g, " ") : token);
}

// Split only at the outer level. Quoted resources/functions may contain ; or {}.
function sections(source) {
    const result = [];
    let start = 0, opening = -1, depth = 0, parentheses = 0, brackets = 0, quote = null;
    for (let index = 0; index < source.length; index++) {
        const token = source[index];
        if (token === "\\") { index++; continue; }
        if (quote) { if (token === quote) quote = null; continue; }
        if (token === "\"" || token === "'") { quote = token; continue; }
        if (token === "(") parentheses++;
        if (token === ")") parentheses--;
        if (token === "[") brackets++;
        if (token === "]") brackets--;
        if (parentheses || brackets) continue;
        if (token === "{") { if (!depth++) opening = index; }
        else if (token === "}") {
            if (!--depth) {
                result.push({ start, header: source.slice(start, opening), body: source.slice(opening + 1, index), bodyStart: opening + 1 });
                start = index + 1;
            }
        } else if (token === ";" && !depth) {
            result.push({ start, header: source.slice(start, index + 1), body: null });
            start = index + 1;
        }
    }
    if (source.slice(start).trim()) result.push({ start, header: source.slice(start), body: null });
    return result;
}

function parseStyle(source, file) {
    const imports = [], rules = [], unsupported = [];
    const errors = scanSource(source, file);
    if (errors.length) return { imports, rules, unsupported: errors.map(error => ({ ...error, reason: "Source rejected by stylesheet gate; routing/rules not parsed" })) };
    const clean = withoutComments(source);
    const starts = [0];
    for (let index = 0; index < clean.length; index++) if (clean[index] === "\n") starts.push(index + 1);
    const locate = offset => {
        let low = 0, high = starts.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (starts[middle] <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    };
    for (const part of sections(clean)) {
        const header = part.header.trim();
        const line = locate(part.start + part.header.search(/\S/));
        if (/^@import\b/.test(header) && part.body === null) {
            const resources = parseCssImports(header);
            if (resources.length === 1) imports.push({ source: file, line, resource: resources[0] });
            else unsupported.push({ file, line, reason: "Unrecognized import syntax" });
        } else if (part.body !== null && !header.startsWith("@")) {
            if (header.includes("\\")) {
                unsupported.push({ file, line, reason: "Escaped selector excluded; token decoding is unsupported" });
                continue;
            }
            const declarations = [];
            for (const declaration of sections(part.body)) {
                const match = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*;?\s*$/.exec(declaration.header);
                if (match && declaration.body === null) declarations.push({ property: match[1], value: match[2],
                    line: locate(part.bodyStart + declaration.start + declaration.header.search(/\S/)) });
                else if (declaration.header.trim()) unsupported.push({ file,
                    line: locate(part.bodyStart + declaration.start), reason: "Unrecognized declaration or nested rule" });
            }
            rules.push({ file, line, selector: header, declarations });
        } else if (part.body !== null && !/^@(?:keyframes|[-\w]+-keyframes)\b/.test(header)) {
            unsupported.push({ file, line, reason: "At-rule body excluded from rule search: " + header });
        } else if (part.body === null && !/^@define\b/.test(header)) {
            unsupported.push({ file, line, reason: "Unrecognized top-level statement" });
        }
    }
    return { imports, rules, unsupported };
}

function sourceFiles(directory, suffix) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(file, suffix) : entry.isFile() && file.endsWith(suffix) ? [file] : [];
    }).sort();
}

function inspect({ root = ROOT, token, property, layout, includeBase = false } = {}) {
    if (!/^[.#]?[a-zA-Z_][\w-]*$/.test(token || "")) throw new Error("Supply one exact selector token, e.g. .weapon_ammo, #AbilitiesContainer or CitadelHud");
    if (property !== undefined && !/^[a-zA-Z][\w-]*$/.test(property)) throw new Error("--property requires a CSS property name");
    const sources = new Map(), sheets = new Map(), entries = [], diagnostics = [], unknown = [];
    const relative = file => slash(path.relative(root, file));
    const read = file => {
        const source = fs.readFileSync(file, "utf8");
        sources.set(relative(file), source);
        return source;
    };
    for (const file of sourceFiles(path.join(root, "panorama/styles"), ".css")) {
        const name = relative(file);
        const sheet = parseStyle(read(file), name);
        sheets.set(name, sheet);
        unknown.push(...sheet.unsupported);
    }
    for (const file of sourceFiles(path.join(root, "panorama/layout"), ".xml")) {
        const source = stripXmlComments(read(file));
        const resources = parseHudStyleIncludes(source);
        const block = /<styles\b[^>]*>([\s\S]*?)<\/styles\s*>/i.exec(source);
        let offset = block ? source.indexOf(block[1], block.index) : 0;
        const imports = resources.map(resource => {
            const at = source.indexOf(resource, offset);
            offset = at + resource.length;
            return { source: relative(file), line: lineAt(source, at), resource };
        });
        entries.push({ kind: "layout", file: relative(file), imports });
    }
    // Any supplied outer stylesheet can be requested by native layouts/C++.
    // This is an explicit hypothetical resource root, never proof of loading.
    for (const [file, sheet] of sheets) {
        const name = file.slice("panorama/styles/".length);
        if (!name.startsWith("base/") && !name.startsWith("features/")) {
            entries.push({ kind: "stylesheet", file, imports: sheet.imports });
        }
    }
    let selectedLayout = null;
    if (layout) {
        selectedLayout = relative(path.resolve(root, layout));
        if (!entries.some(entry => entry.kind === "layout" && entry.file === selectedLayout)) throw new Error("Unknown local layout: " + layout);
    }
    for (const sheet of sheets.values()) for (const edge of sheet.imports) {
        const resource = canonicalStyleResource(edge.resource);
        edge.target = resource === null ? null : `panorama/styles/${resource}.css`;
        if (!edge.target || !sheets.has(edge.target)) unknown.push({ ...edge,
            reason: "Resource source unavailable locally; native/external resolution unverified" });
    }
    for (const entry of entries.filter(entry => entry.kind === "layout")) for (const edge of entry.imports) {
        const resource = canonicalStyleResource(edge.resource);
        edge.target = resource === null ? null : `panorama/styles/${resource}.css`;
        if (!edge.target || !sheets.has(edge.target)) unknown.push({ ...edge,
            reason: "Layout stylesheet source unavailable locally; native/external resolution unverified" });
    }
    // Record source cycles even if no shipped layout reaches them.
    const complete = new Set();
    function checkCycles(file, ancestors = [], edges = []) {
        const cycle = ancestors.indexOf(file);
        if (cycle !== -1) { diagnostics.push({ kind: "source-import-cycle", files: [...ancestors.slice(cycle), file], edges: edges.slice(cycle) }); return; }
        if (complete.has(file)) return;
        for (const edge of sheets.get(file).imports) if (sheets.has(edge.target)) checkCycles(edge.target, [...ancestors, file], [...edges, edge]);
        complete.add(file);
    }
    for (const file of sheets.keys()) checkCycles(file);

    const matches = [];
    for (const [file, sheet] of sheets) {
        if (!includeBase && file.startsWith("panorama/styles/base/")) continue;
        for (const rule of sheet.rules) {
            const selector = rule.selector.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "")
                .replace(/\[[^\]]*\]/g, "");
            if (!(selector.match(/[.#][\w-]+|(?<![:\w.#-])[\w-]+/g) || []).includes(token)) continue;
            const declarations = rule.declarations.filter(item => !property || item.property === property);
            if (declarations.length) matches.push({ ...rule, declarations });
        }
    }
    const targets = new Set(matches.map(rule => rule.file));
    const routes = new Map([...targets].map(file => [file, []]));
    let traversed = 0, omittedBranches = 0;
    // ponytail: bounded path enumeration; report truncation instead of claiming
    // complete routing for pathological diamond import graphs.
    function visit(file, entry, chain, ancestors) {
        if (++traversed > 50000) { omittedBranches++; return; }
        if (ancestors.includes(file)) return;
        if (targets.has(file)) routes.get(file).push({ kind: entry.kind, entry: entry.file, chain });
        for (const edge of sheets.get(file).imports) if (sheets.has(edge.target)) {
            visit(edge.target, entry, [...chain, edge], [...ancestors, file]);
        }
    }
    for (const entry of entries) {
        if (entry.kind === "stylesheet") visit(entry.file, entry, [], []);
        else for (const edge of entry.imports) if (sheets.has(edge.target)) visit(edge.target, entry, [edge], []);
    }
    for (const match of matches) {
        match.routes = routes.get(match.file);
        const found = match.routes.some(route => route.kind === "layout" && route.entry === selectedLayout);
        match.selectedLayoutRoute = selectedLayout === null || (!found && omittedBranches) ? null : found;
    }
    const candidates = matches.filter(match => match.selectedLayoutRoute === false).map(match => ({
        kind: "no-selected-layout-route", file: match.file, line: match.line,
        reason: "No route in the local import graph; independent native component loading and selector applicability remain unknown"
    }));
    const fingerprint = crypto.createHash("sha256");
    for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) fingerprint.update(file + "\0" + source + "\0");
    return { query: { token, property: property || null, layout: selectedLayout, includeBase },
        coverage: { stylesheets: sheets.size, layouts: entries.filter(entry => entry.kind === "layout").length,
            sourceFingerprint: fingerprint.digest("hex"), sourceFiles: [...sources.keys()].sort(), omittedBranches,
            scope: "Local source graph only. XML roots are separate; stylesheet roots have unverified native loaders. Routes do not establish selector matches, CSS cascade, computed styles, inline writes, rendering, native timing or FPS. Base declarations excluded unless --include-base; keyframe bodies excluded. No HUD capture is used." },
        diagnostics, candidates, unknown, matches };
}

function main(args) {
    if (args.length === 1 && args[0] === "--help") {
        console.log("Usage: node scripts/trace_style_sources.js <.class|#id|PanelType> [--property CSS-NAME] [--layout panorama/layout/FILE.xml] [--include-base] [--json]");
        console.log("Search local selector tokens and trace source includes/imports; does not compute CSS application or cascade.");
        return;
    }
    const options = {};
    let json = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--json") json = true;
        else if (arg === "--include-base") options.includeBase = true;
        else if (["--property", "--layout"].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
            options[arg.slice(2)] = value;
        } else if (arg.startsWith("--") || options.token) throw new Error("Unknown argument: " + arg);
        else options.token = arg;
    }
    const report = inspect(options);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
        console.log(report.coverage.scope);
        console.log(`${report.coverage.stylesheets} CSS / ${report.coverage.layouts} XML; source ${report.coverage.sourceFingerprint}`);
        console.log(`${report.matches.length} matching rules; ${report.diagnostics.length} source cycles; ${report.unknown.length} unknown/excluded source records; ${report.coverage.omittedBranches} omitted route branches`);
        for (const match of report.matches) {
            console.log(`\n${match.file}:${match.line} ${match.selector.replace(/\s+/g, " ")}`);
            for (const declaration of match.declarations) console.log(`  :${declaration.line} ${declaration.property}: ${declaration.value}`);
            if (match.selectedLayoutRoute === false) console.log("  CANDIDATE: no local route from selected layout; native component loading unknown");
            if (!match.routes.length) console.log("  UNKNOWN: no outer stylesheet/local layout route; not proof of unused CSS");
            for (const route of match.routes) {
                console.log(`  ${route.kind === "layout" ? "XML SOURCE" : "RESOURCE (native loader unverified)"}: ${route.entry}`);
                for (const edge of route.chain) console.log(`    ${edge.source}:${edge.line} -> ${edge.target}`);
            }
        }
        for (const diagnostic of report.diagnostics) console.log(`SOURCE ERROR: ${diagnostic.files.join(" -> ")}`);
        if (report.unknown.length) console.log("Use --json for unavailable resources and excluded syntax with source locations.");
    }
    if (report.diagnostics.length) process.exitCode = 1;
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(`[style-sources] ${error.message}`); process.exitCode = 1; }
}
module.exports = { inspect, parseStyle };
