// Shared native HUD observations; available in HUD and settings contexts.
(() => {
    "use strict";
    const Q = QOL;
    const P = Q.core.panel;
    // Read persistent native class state; an engine toggle notification is only
    // a reason to refresh it. Prefer the stationary GlobalClassListener because
    // minimap_persp can be reparented by Tab zoom's Draw Over UI option.
    const isScoreboardOpen = (root, anchor) => {
        const hud = P.findHud(root);
        if (!P.isAlive(hud) || (hud.id !== "Hud" && hud.paneltype !== "CitadelHud")) return false;
        const has = panel => QOL_UTILS.HasClassInHierarchy(panel, "gScoreboardOpen");
        if (has(hud)) return true;
        const stableListener = Q.panelCache
            ? Q.panelCache.resolve(hud, "hud.stableScoreboardListener", "DamageReportGlobalClassListener")
            : P.findTraverse(hud, "DamageReportGlobalClassListener");
        if (P.isAlive(stableListener)) return has(stableListener);
        if (P.isAlive(anchor) && has(anchor)) return true;
        const listener = Q.panelCache
            ? Q.panelCache.resolve(hud, "hud.scoreboardListener", "minimap_persp")
            : P.findTraverse(hud, "minimap_persp");
        return has(listener);
    };

    Q.hudState = { isScoreboardOpen };
})();
