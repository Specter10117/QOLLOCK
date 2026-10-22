// Session-only window positions. Prefer the same cursor coordinates as canvas
// gestures; contexts without GameUI retain the verified compositor fallback.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const P = Q.core.panel;
    const G = Q.ui.customizeGeometry;
    function create(overlay, enabled, probe) {
        const windows = [];
        let gesture = null;
        let timer = null;
        let disposed = false;
        const clamp = (bounds, view) => ({
            x: Math.max(0, Math.min(Math.max(0, view.width - bounds.width), bounds.x)),
            y: Math.max(0, Math.min(Math.max(0, view.height - bounds.height), bounds.y))
        });
        function finish() {
            if (timer !== null) $.CancelScheduled(timer);
            timer = null;
            P.delete(gesture?.proxy);
            gesture = null;
        }
        function update(ending = false, droppedPanel = null) {
            if (!gesture || disposed) return;
            const { panel, proxy, bounds } = gesture;
            const view = G.viewport(overlay);
            if (!enabled() || !P.isAlive(panel) || !G.isShown(panel) || (!gesture.pointer && !ending && !P.isAlive(proxy)) || !view) { finish(); return; }
            const visual = droppedPanel === proxy && P.isAlive(droppedPanel) ? droppedPanel : proxy;
            const point = (gesture.pointer ? G.cursorPoint() : G.windowPoint(visual)) || (ending ? gesture.lastPoint || gesture.origin : null);
            if (!point) {
                if (ending) finish();
                else timer = $.Schedule(0.016, () => update());
                return;
            }
            gesture.lastPoint = point;
            if (!gesture.origin) gesture.origin = point;
            const delta = G.windowDelta({ x: point.x - gesture.origin.x, y: point.y - gesture.origin.y }, overlay, probe);
            const position = clamp({ ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y }, view);
            gesture.item.position = position;
            gesture.item.signature = P.syncStyles(panel, {
                align: "left top", margin: "0px", x: `${Math.round(position.x)}px`, y: `${Math.round(position.y)}px`
            }, gesture.item.signature).sig;
            if (ending) finish();
            else timer = $.Schedule(0.016, () => update());
        }
        function header(panel, id, title, preferredPosition = null) {
            const handle = P.create("Button", panel, id, { draggable: "true" });
            handle.AddClass("QOLCustomizeChromeHandle");
            handle.hittestchildren = false;
            Q.ui.customizeInspector.label(handle, title, "ModalTitle");
            const item = { panel, handle, position: null, preferredPosition, signature: null };
            windows.push(item);
            $.RegisterEventHandler("DragStart", handle, (_panel, event) => {
                if (disposed || gesture || !enabled() || !G.isShown(panel)) return;
                const bounds = G.box(panel, overlay);
                if (!bounds || !G.viewport(overlay)) return;
                const proxy = P.create("Panel", overlay, "QOLCustomizeChromeProxy");
                if (!P.isAlive(proxy)) return;
                proxy.style.width = "16px"; proxy.style.height = "16px";
                proxy.style.align = "left top";
                proxy.hittest = false; proxy.hittestchildren = false;
                const cursor = G.cursorPoint();
                gesture = { item, panel, proxy, bounds, pointer: !!cursor, origin: cursor };
                event.displayPanel = proxy;
                event.removePositionBeforeDrop = false;
                timer = $.Schedule(0, () => update());
                return true;
            });
            $.RegisterEventHandler("DragEnd", handle, (_panel, droppedPanel) => {
                if (gesture?.panel === panel) update(true, droppedPanel);
            });
            return handle;
        }
        function refresh() {
            if (disposed || gesture) return;
            const view = G.viewport(overlay);
            if (!view) return;
            for (const item of windows) {
                if (!P.isAlive(item.panel) || !G.isShown(item.panel)) continue;
                const bounds = G.box(item.panel, overlay);
                if (!bounds) continue;
                const preferred = item.position || item.preferredPosition?.(bounds, view);
                if (!preferred) continue;
                const position = clamp({ ...bounds, x: preferred.x, y: preferred.y }, view);
                // A measured default may follow native layout until the user
                // chooses a session position by dragging this window.
                if (item.position) item.position = position;
                item.signature = P.syncStyles(item.panel, {
                    align: "left top", margin: "0px", x: `${Math.round(position.x)}px`, y: `${Math.round(position.y)}px`
                }, item.signature).sig;
            }
        }
        return { header, refresh, isDragging: () => !!gesture,
            dispose() { disposed = true; finish(); } };
    }
    Q.ui.customizeChrome = { create };
})();
