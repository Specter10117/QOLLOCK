// Minimap presentation owns the viewport geometry, not the native map model.
// The fixed-icon renderer class preserves native zoom-surface proportions in CSS.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const P = Q.core.panel;
    const fixedClass = "QOLFixedMinimapIcons";
    function create() {
        const resolver = Q.panelCache.createIdResolver("minimap_persp", {
            ownerPath: [{ id: "Hud", optional: true }, { className: "HudCore" }, "gameplay_hud", { className: "clamp_width" }]
        });
        let host = null;
        let panels = [];
        let drawOverUi = false;
        const owned = P.createNativeStyleOwner();
        let hostStyles = {};

        function resolve(root) {
            const nextHost = resolver.resolve(root);
            if (host !== nextHost) hostStyles = {};
            host = nextHost;
            const container = P.findChild(host, "minimap_container");
            const nativeContainer = P.findChild(container, "HudMinimapContainer");
            // Retain the previous discovery path for a renderer in the viewport.
            const renderer = P.findChild(nativeContainer, "hud_minimap") || P.findChild(container, "hud_minimap");
            const next = [host, container, P.findChild(container, "minimap_frame"), nativeContainer, renderer].filter(P.isAlive);
            const changed = next.length !== panels.length || next.some((panel, index) => panel !== panels[index]);
            if (changed) {
                owned.retain(next);
                panels = next;
            }
            return { host, panels, renderer, changed };
        }

        function apply({ size, fixedIcons, zoomed, x, y, opacity, hidden }) {
            const sizeText = Math.round(size) + "px";
            for (const panel of panels) {
                let styles = {};
                if (panel === host) {
                    const marginRight = zoomed ? 0 : 30 - x;
                    const marginBottom = zoomed ? 0 : 30 + y;
                    const marginTop = zoomed ? -y : 0;
                    const marginLeft = zoomed ? x : 0;
                    styles = {
                        uiScale: "100%", overflow: "noclip",
                        preTransformScale2d: "1.00, 1.00", transformOrigin: zoomed ? "50% 50%" : "100% 100%",
                        horizontalAlign: zoomed ? "center" : "right", verticalAlign: zoomed ? "center" : "bottom",
                        align: zoomed ? "center center" : "right bottom",
                        margin: `${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px`,
                        marginTop: marginTop + "px", marginRight: marginRight + "px",
                        marginBottom: marginBottom + "px", marginLeft: marginLeft + "px", opacity: String(opacity)
                    };
                    // Scale only the square viewport. Magnifying this native
                    // 440x520 host lets screen-height squishing distort the map.
                    if (hidden) styles.visibility = "collapse";
                    if (drawOverUi) styles.zIndex = "2147483647";
                } else if (panel.id !== "hud_minimap" && fixedIcons) {
                    styles = { width: sizeText, height: sizeText };
                }
                if (panel.id === "minimap_container") {
                    Object.assign(styles, {
                        uiScale: fixedIcons ? "100%" : Number((size / 400 * 100).toFixed(2)) + "%",
                        horizontalAlign: zoomed ? "center" : "right", verticalAlign: zoomed ? "center" : "bottom",
                        align: zoomed ? "center center" : "right bottom",
                        margin: "0px", marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px"
                    });
                }
                if (panel === host) hostStyles = styles;
                owned.apply(panel, styles, panel.id === "hud_minimap" ? { [fixedClass]: fixedIcons } : {});
            }
        }

        function setDrawOverUi(active) {
            drawOverUi = active;
            if (!P.isAlive(host)) return;
            const styles = { ...hostStyles };
            if (active) styles.zIndex = "2147483647";
            else delete styles.zIndex;
            hostStyles = styles;
            owned.apply(host, styles);
        }

        function release() {
            owned.clear();
            hostStyles = {};
            panels = [];
            host = null;
            drawOverUi = false;
            resolver.reset();
        }
        return { resolve, apply, setDrawOverUi, release, resetDiscovery: () => resolver.reset() };
    }
    Q.features.minimapGeometry = { create };
})();
