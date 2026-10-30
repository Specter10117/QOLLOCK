"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const GAME_TRACKING_REPOSITORY = "https://github.com/SteamTracking/GameTracking-Deadlock.git";
const GAME_TRACKING_REF = "refs/heads/master";
const GAME_TRACKING_PANORAMA_ROOTS = [
    "game/citadel/pak01_dir/panorama",
    "game/core/pak01_dir/panorama"
];

function canonicalStyleResource(resource) {
    const match = /^s2r:\/\/panorama\/styles\/(.+)\.vcss(?:_c)?$/.exec(resource || "");
    return match ? match[1].replace(/\\/g, "/") : null;
}

function parseCssImports(source) {
    const uncommented = String(source || "").replace(/\/\*[\s\S]*?\*\//g, "");
    const imports = [];
    const pattern = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;)]+))\s*\)?\s*;?/g;
    let match;
    while ((match = pattern.exec(uncommented))) {
        imports.push(match[1] || match[2] || match[3]);
    }
    return imports;
}

function parseHudStyleIncludes(xml) {
    const uncommented = String(xml || "").replace(/<!--[\s\S]*?-->/g, "");
    const stylesBlock = /<styles\b[^>]*>([\s\S]*?)<\/styles\s*>/i.exec(uncommented);
    if (!stylesBlock) return [];
    const includes = [];
    const pattern = /<include\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = pattern.exec(stylesBlock[1]))) includes.push(match[1]);
    return includes;
}

function findDuplicateImports(nativeResources, qollockImports) {
    const native = new Set(nativeResources.map(canonicalStyleResource).filter(Boolean));
    return qollockImports.filter(item => {
        const canonical = canonicalStyleResource(item.resource);
        return canonical !== null && native.has(canonical);
    });
}

function originPanoramaPaths(relativePath) {
    return GAME_TRACKING_PANORAMA_ROOTS.map(root => `${root}/${relativePath.split("\\").join("/")}`);
}

function requestText(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { "User-Agent": "QOLLOCK origin CSS check" } }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => resolve({ statusCode: response.statusCode || 0, body }));
        });
        request.setTimeout(20000, () => request.destroy(new Error(`Timed out requesting ${url}`)));
        request.on("error", reject);
    });
}

function getOriginCommit() {
    const output = execFileSync("git", ["ls-remote", GAME_TRACKING_REPOSITORY, GAME_TRACKING_REF], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024
    });
    const commit = output.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/i.test(commit || "")) {
        throw new Error(`Could not resolve ${GAME_TRACKING_REF} in GameTracking origin`);
    }
    return commit;
}

function createOriginReader(commit) {
    return async relativePath => {
        for (const originPath of originPanoramaPaths(relativePath)) {
            const url = `https://raw.githubusercontent.com/SteamTracking/GameTracking-Deadlock/${commit}/${originPath}`;
            const response = await requestText(url);
            if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
            if (response.statusCode !== 404) throw new Error(`GameTracking returned HTTP ${response.statusCode} for ${originPath}`);
        }
        throw new Error(`GameTracking has no source for ${relativePath} in citadel or core Panorama resources`);
    };
}

async function collectOriginHudStyles(readOrigin) {
    const hudXml = await readOrigin("layout/hud.xml");
    const queue = parseHudStyleIncludes(hudXml).map(resource => ({ resource, parent: "layout/hud.xml" }));
    const resources = new Map();

    while (queue.length) {
        const { resource, parent } = queue.shift();
        const canonical = canonicalStyleResource(resource);
        if (!canonical || resources.has(canonical)) continue;
        resources.set(canonical, { resource, parent });
        const css = await readOrigin(`styles/${canonical}.css`);
        for (const imported of parseCssImports(css)) {
            if (canonicalStyleResource(imported)) queue.push({ resource: imported, parent: `styles/${canonical}.css` });
        }
    }
    return resources;
}

function collectQollockHudImports() {
    const layoutPath = path.join(REPOSITORY_ROOT, "panorama", "layout", "hud.xml");
    const localRoots = parseHudStyleIncludes(fs.readFileSync(layoutPath, "utf8"));
    const queue = localRoots.map(resource => ({ resource, source: "panorama/layout/hud.xml" }));
    const visited = new Set();
    const imports = [];

    while (queue.length) {
        const { resource, source } = queue.shift();
        const canonical = canonicalStyleResource(resource);
        if (!canonical || visited.has(canonical) || canonical.startsWith("base/")) continue;
        visited.add(canonical);

        const sourcePath = path.join(REPOSITORY_ROOT, "panorama", "styles", `${canonical}.css`);
        if (!fs.existsSync(sourcePath)) continue;
        const relativeSource = path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join("/");
        for (const imported of parseCssImports(fs.readFileSync(sourcePath, "utf8"))) {
            const importedCanonical = canonicalStyleResource(imported);
            if (!importedCanonical) continue;
            imports.push({ resource: imported, source: relativeSource });
            if (!importedCanonical.startsWith("base/")) queue.push({ resource: imported, source: relativeSource });
        }
    }
    return imports;
}

async function checkOrigin() {
    const commit = getOriginCommit();
    const originResources = await collectOriginHudStyles(createOriginReader(commit));
    const imports = collectQollockHudImports();
    const duplicates = findDuplicateImports(
        [...originResources.values()].map(item => item.resource),
        imports
    );
    return { commit, nativeStyles: originResources, imports, duplicates };
}

async function main() {
    const result = await checkOrigin();
    console.log(`GameTracking master: ${result.commit}`);
    console.log(`Native HUD stylesheet graph: ${result.nativeStyles.size} resources`);
    if (!result.duplicates.length) {
        console.log(`QOLLOCK HUD stylesheet imports checked: ${result.imports.length}; duplicates: none`);
        return;
    }
    console.error(`Duplicate native HUD stylesheet imports (${result.duplicates.length}):`);
    for (const item of result.duplicates) console.error(`  ${item.source} imports ${item.resource}`);
    process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`[native-css-imports] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    canonicalStyleResource,
    parseCssImports,
    parseHudStyleIncludes,
    findDuplicateImports,
    originPanoramaPaths,
    collectOriginHudStyles,
    collectQollockHudImports,
    checkOrigin
};
