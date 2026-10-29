// Feature-owned diagnostic controls shared by the two minimap owners. No polls,
// persistent configuration, native discovery or frame-time claims live here.
(() => {
    "use strict";
    const P = QOL.core.panel;
    const identities = new WeakMap();
    let nextIdentity = 0;
    const identity = panel => {
        if (!P.isAlive(panel)) return null;
        if (!identities.has(panel)) identities.set(panel, ++nextIdentity);
        return identities.get(panel);
    };
    const panelState = panel => {
        if (!P.isAlive(panel)) return { present: false };
        const codeVisibility = panel.style.visibility || "";
        return { present: true, identity: identity(panel), parentIdentity: identity(panel.GetParent()), id: panel.id,
            visible: panel.visible !== false && codeVisibility !== "collapse" && !panel.BHasClass("qol-hidden"),
            codeVisibility, opacity: panel.style.opacity || "", children: panel.GetChildCount(),
            width: panel.actuallayoutwidth, height: panel.actuallayoutheight,
            scaleX: panel.actualuiscale_x, scaleY: panel.actualuiscale_y };
    };
    const compositionProperties = (policy = "cache") => {
        if (!["cache", "layer", "none"].includes(policy)) throw Error("unknown minimap composition policy");
        return policy === "none" ? {} : policy === "layer" ? { "require-composition-layer": "true" } :
            { "require-composition-layer": "true", "always-cache-composition-layer": "true" };
    };
    const createOwner = ({ isActive, allowed, apply, snapshot }) => {
        let current = null;
        const stages = { updates: 0, sweeps: 0, skippedSweeps: 0, discovery: 0, render: 0, builds: 0 };
        const check = lease => { if (!isActive() || current !== lease) throw Error("minimap diagnostic lease retired"); };
        const api = {
            get controls() { return current?.controls || null; }, stages,
            cancel: () => { current = null; },
            begin: () => {
                if (!isActive()) throw Error("minimap diagnostic owner inactive");
                current?.restore();
                for (const key of Object.keys(stages)) stages[key] = 0;
                const lease = { controls: {},
                    apply: controls => {
                        check(lease);
                        for (const [key, value] of Object.entries(controls)) {
                            if (!allowed[key]?.(value)) throw Error("invalid minimap diagnostic control: " + key);
                        }
                        const previous = lease.controls;
                        lease.controls = { ...controls, ...(controls.hideGroups ? { hideGroups: controls.hideGroups.slice() } : {}) };
                        apply(lease.controls, previous);
                        return lease.snapshot();
                    },
                    snapshot: () => { check(lease); return { ...snapshot(), controls: { ...lease.controls }, stages: { ...stages } }; },
                    restore: () => {
                        if (current !== lease) return;
                        const previous = lease.controls;
                        current = null;
                        if (isActive()) apply({}, previous);
                    }
                };
                current = lease;
                return lease;
            }
        };
        return api;
    };
    QOL.core.minimapProbe = { panelState, identity, compositionProperties, createOwner };
})();
