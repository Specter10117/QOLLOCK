// Rebuild a validated native hierarchy for offline HUD replay.
// Omitted native state and lifecycle remain unknown; no XML composition is added.
"use strict";

const { inspectCapture, MEASUREMENT_FIELDS } = require("../../capture_tree.js");

function buildCapturedHud(doc, captured) {
    const { root: rootNode, notes, fidelity } = inspectCapture(captured, { requireHud: true });

    let panels = 0;
    const hudNode = rootNode.id === "CitadelHudRoot"
        ? (rootNode.children || []).find(c => c.id === "Hud") : null;
    if (rootNode.id === "CitadelHudRoot" && !hudNode) {
        throw new Error("[hud_tree] CitadelHudRoot capture has no direct Hud context");
    }
    // Replace any earlier model/import, preserving the context object identity.
    doc.root.RemoveAndDeleteChildren();
    for (const child of doc.absRoot.Children()) if (child !== doc.root) child._destroy();
    function populate(node, panel) {
        doc._unindex(panel);
        panel.id = node.id || "";
        panel.type = panel.paneltype = node.type || "Panel";
        panel._classes = new Set(node.classes || []);
        doc._index(panel);
        panel.breadcrumbs = node.breadcrumbs || null;
        panel.text = typeof node.text === "string" ? node.text : "";
        for (const [capturedKey, panelKey] of Object.entries(MEASUREMENT_FIELDS)) {
            const value = node.computedMeasurements?.[capturedKey];
            panel[panelKey] = Number.isFinite(value) ? value : 0;
        }
        panel._attrs.clear();
        for (const key of ["visible", "enabled", "checked", "hittest", "hittestchildren"]) {
            panel[key] = typeof node[key] === "boolean" ? node[key] :
                ["visible", "enabled"].includes(key) ? true : undefined;
        }
        for (const [key, value] of Object.entries(node.attributes || {})) panel.SetAttributeString(key, value);
        panels++;
        for (const child of node.children || []) {
            // Reappend the pre-existing context in capture order, including siblings
            // before Hud. Otherwise duplicate-id searches can return a different hit.
            const cp = child === hudNode ? doc.root : doc.create(child.type || "Panel");
            panel.addChild(cp);
            populate(child, cp);
        }
    }
    populate(rootNode, hudNode ? doc.absRoot : doc.root);
    return { panels, notes, fidelity, byLayout: { captured: panels } };
}

module.exports = { buildCapturedHud };
