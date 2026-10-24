// Minimap states share a native owner, but keep distinct persisted settings.
// Shop and purchase surfaces are measured only when their native context exists.
(() => {
    "use strict";
    const C = QOL.presentation;
    const { core, lower } = C.paths;
    const { geometry, opacity, toggle, field: f } = C.fields;
    const t = (key, label, hidden = false) => f(key, label, "toggle", { hidden });
    const mapHost = [...C.paths.gameplay, { className: "clamp_width" }, "minimap_persp"];
    const mapPath = [...mapHost, "minimap_container"];
    function activeMapMode(hud, config) {
        const host = C.findPath(hud, mapHost) || QOL.core.panel.findTraverse(hud, "minimap_persp");
        const active = cls => QOL_UTILS.HasClassInHierarchy(host, cls) || hud.BHasClass(cls);
        if (Number(config.ENABLE_ALT_ZOOM) === 1 && active("gDetailView")) return "alt";
        if (Number(config.ENABLE_TAB_ZOOM) === 1 && active("gScoreboardOpen")) return "tab";
        return "base";
    }
    const minimap = (id, name, fields, state = "base") => ({ id, name, group: "Minimap", path: mapHost, measureId: "minimap_container", fields,
        available: (hud, config) => activeMapMode(hud, config) === state });
    const zoomFields = mode => [
        toggle("ENABLE_" + mode + "_ZOOM"), f("MINIMAP_LARGE_SIZE_" + mode, "Size", null, { resize: true }),
        // Center alignment halves one-sided margins; preserve persisted units.
        f("ZOOM_X_OFFSET_" + mode, "Horizontal Offset", null, { axis: "x", movementRatio: 0.5 }),
        f("ZOOM_Y_OFFSET_" + mode, "Vertical Offset", null, { axis: "y", direction: -1, movementRatio: 0.5 }),
        f(mode + "_ZOOM_OPACITY", "Opacity"), t(mode + "_ZOOM_DRAW_OVER_UI", "Draw Over UI")
    ];
    C.register([
        minimap("minimap", "Base Minimap", [
            ...geometry("MINIMAP_"), f("MINIMAP_SMALL_SIZE", "Size", null, { resize: true }),
            f("MINIMAP_BASE_OPACITY", "Opacity"),
            f("MINIMAL_MINIMAP", "Minimalist", "toggle", { hidden: true }),
            f("MINIMAL_MINIMAP_OPACITY", "Minimalist Opacity", null, { when: session => Number(session.value("MINIMAL_MINIMAP")) === 1 }),
            t("MINIMAP_FIXED_ICON_SIZE", "Fixed Icon Size"), f("MINIMAP_ICON_COLOR", "Icons", "palette")
        ]),
        minimap("minimapAlt", "Minimap: Alt", zoomFields("ALT"), "alt"),
        minimap("minimapTab", "Minimap: Tab", zoomFields("TAB"), "tab"),
        { id: "mapTimers", name: "Minimap Timers", group: "Minimap", path: [...mapPath, "QOLMinimapTimersRoot"], fields: [
            t("ENABLE_MINIMAP_REJUV_TIMER", "Rejuvenator Timer"), t("ENABLE_MINIMAP_BUFF_TIMER", "Buff Timer"),
            t("ENABLE_MINIMAP_BUFF_TIMER_ON_BRIDGE", "Bridge Buff Timer"), t("ENABLE_MINIMAP_ALWAYS_ON_MID_BOSS", "Always Show Mid Boss")
        ] },
        { id: "shop", name: "Shop", group: "Shop", path: [...core, "CitadelHudHeroShop", "Shop", "MainPanel"], fields: [
            toggle("HUD_SHOP_ENABLED"), f("SHOP_OFFSET_X", "Horizontal Offset", null, { axis: "x" }),
            f("SHOP_OFFSET_Y", "Vertical Offset", null, { axis: "y", direction: -1 }), f("SHOP_SCALE", "Scale", null, { resize: true }), opacity("SHOP_"),
            t("ENABLE_HERO_SCENE_PANEL", "Hero", true), t("ENABLE_SIMPLIFY_SHOP", "Simplify Shop", true), t("ENABLE_SIMPLIFY_ITEMS", "Simplify Items", true),
            t("DISABLE_SHOP_BLUE", "Disable Shop Blue"), t("ENABLE_SHOP_STATS", "Shop Stats", true), t("ENABLE_SIMPLIFY_SHOP_STATS", "Simplify Shop Stats", true)
        ] },
        { id: "quickbuy", name: "Quick Buy", group: "Shop", path: [...lower, "CitadelHudQuickbuy"], fields: [
            t("DISABLE_QUICK_BUY", "Disable Quick Buy", true), t("ENABLE_ENHANCED_QUICKBUY", "Enhanced", true),
            f("ENHANCED_QUICKBUY_COUNT", "Enhanced Count", null, { hidden: true }), t("ENABLE_QUICKBUY_CLICK_TO_NOTIFY", "Click to Notify", true)
        ] },
        { id: "recentPurchases", name: "Recent Purchases", group: "Shop", path: [...core, "CitadelHudHeroShop", "Shop", "NavPanel", "RecentPurchasesPanel"], fields: [
            toggle("ENABLE_SHOP_RECENT_PURCHASES"), ...geometry("RECENT_PURCHASES_PANEL_", true), opacity("RECENT_PURCHASES_PANEL_")
        ] },
        { id: "purchaseNotifications", name: "Item Notifications", group: "Shop", path: [...core, "TopBar", "QuickPurchasesPanel"], fields: [
            toggle("ENABLE_SHOP_ITEM_NOTIFICATIONS"), t("ENABLE_HERO_PURCHASE_POPUPS", "Hero Purchase Popups", true),
            ...geometry("RECENT_PURCHASES_QUICK_", true), opacity("RECENT_PURCHASES_QUICK_"),
            f("RECENT_PURCHASES_QUICK_MAX", "Maximum Items", null, { hidden: true }), f("RECENT_PURCHASES_QUICK_DISPLAY_SEC", "Display Duration", null, { hidden: true }),
            t("RECENT_PURCHASES_QUICK_REJUV", "Rejuvenator", true), t("RECENT_PURCHASES_QUICK_SCOREBOARD", "Scoreboard", true)
        ], resolve(hud, config) {
            const top = C.findPath(hud, [...core, "TopBar"]);
            if (!QOL.core.panel.isAlive(top)) return null;
            const sample = top.FindChildrenWithClassTraverse("QOLCustomizePurchaseSample").find(QOL.core.panel.isAlive);
            if (sample) return sample.GetParent();
            if (Number(config.ENABLE_HERO_PURCHASE_POPUPS) !== 1) return QOL.core.panel.findChild(top, "QuickPurchasesPanel");
            return top.FindChildrenWithClassTraverse("QuickPurchasesPanel").find(panel =>
                QOL.core.panel.isAlive(panel) && panel.Children().some(QOL.core.panel.isAlive)) || null;
        } }
    ]);
})();
