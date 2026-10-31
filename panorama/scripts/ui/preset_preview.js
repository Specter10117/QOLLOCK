// Preset-owned live preview. Shares Customize's leased HUD transport and visibility gates.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const P = Q.core.panel;
    const localize = text => Q.ui.theme.LocalizeSettingsText(text, true);
    let current = null;
    let sequence = 0;

    function valid(owner) {
        return current === owner && P.isAlive(owner.overlay) && P.isAlive(owner.modal) && owner.modal.BHasClass("Show") &&
            P.isAlive(owner.window) && owner.window.BHasClass("Visible") &&
            Q.ui.customizeSession.resolveHud(owner.root) === owner.hud && P.isAlive(owner.hud) &&
            Q.core.persistence.getConfigChangeStamp(owner.root) === owner.stamp &&
            JSON.stringify(Q.getSettingsConfig()) === owner.baseline;
    }
    function stop(focus = true) {
        const owner = current;
        if (!owner) return;
        current = null;
        const cleanup = action => {
            try { action(); }
            catch (error) { $.Msg("[QOLLock][PresetPreview] cleanup: " + (error.message || error)); }
        };
        if (owner.timer !== null) cleanup(() => $.CancelScheduled(owner.timer));
        cleanup(() => owner.chrome?.dispose());
        cleanup(() => Q.presentation.preview.clear(owner.hud, owner.token));
        for (const panel of owner.hidden) cleanup(() => { if (P.isAlive(panel)) panel.RemoveClass("QOLCustomizeHidden"); });
        for (const panel of owner.active) cleanup(() => { if (P.isAlive(panel)) panel.RemoveClass("QOLCustomizeActive"); });
        cleanup(() => P.delete(owner.overlay));
        cleanup(() => { if (focus && P.isAlive(owner.window) && owner.window.BHasClass("Visible")) {
            const target = P.isAlive(owner.modal) && owner.modal.BHasClass("Show") ? owner.modal : owner.window;
            target.SetFocus();
        } });
    }
    function watch(owner) {
        if (current !== owner) return;
        try {
            if (!valid(owner) || !Q.presentation.preview.writePreset(owner.hud, owner.values, owner.token, owner.stamp)) {
                stop();
                return;
            }
            const delivered = Q.presentation.preview.ack(owner.hud) === owner.token && Q.presentation.preview.settled(owner.hud);
            const text = localize(delivered ? "HUD settings updated" : "Updating HUD...");
            if (owner.status.text !== text) owner.status.text = text;
            if (owner.apply.enabled !== delivered) owner.apply.enabled = delivered;
            owner.chrome.refresh();
            owner.timer = $.Schedule(0.2, () => watch(owner));
        } catch (error) {
            $.Msg("[QOLLock][PresetPreview] " + (error.message || error));
            stop();
        }
    }
    function start(options) {
        if (current || Q.ui.customize?.isRunning() || Q.ui.visualCheck?.isRunning()) return false;
        const context = $.GetContextPanel();
        const root = Q.core.persistence.getUIRoot();
        const hud = Q.ui.customizeSession.resolveHud(root);
        const window = P.findTraverse(context, "SettingsWindow");
        if (!P.isAlive(hud) || !P.isAlive(window) || !window.BHasClass("Visible") ||
            !P.isAlive(options.modal) || !options.modal.BHasClass("Show")) return false;
        globalThis.FlushPendingSave();
        const owner = { root, hud, window, modal: options.modal, hidden: [], active: [], timer: null,
            token: `preset:${Date.now()}:${++sequence}`, stamp: Q.core.persistence.getConfigChangeStamp(root),
            baseline: JSON.stringify(Q.getSettingsConfig()), values: Q.mergeConfig(options.config) };
        current = owner;
        try {
            owner.overlay = P.create("Panel", context, "QOLPresetPreview");
            owner.overlay.AddClass("QOLPresetPreviewOverlay");
            owner.overlay.acceptsfocus = true;
            owner.overlay.hittest = true;
            owner.overlay.hittestchildren = true;
            owner.overlay.SetPanelEvent("onactivate", () => {});
            owner.overlay.SetPanelEvent("oncancel", () => Q.ui.window.handleCustomizeCancel());
            const probe = P.create("Panel", owner.overlay, "QOLPresetPreviewUnitProbe");
            if (!P.isAlive(probe)) throw new Error("Unable to create preset preview coordinate probe");
            P.syncStyles(probe, { align: "left top", x: "100px", y: "100px", width: "1px", height: "1px" });
            probe.hittest = false;
            probe.hittestchildren = false;
            owner.chrome = Q.ui.customizeChrome.create(owner.overlay, () => valid(owner), probe);
            const bar = P.create("Panel", owner.overlay, "QOLPresetPreviewBar");
            bar.AddClass("QOLPresetPreviewBar");
            bar.AddClass("QOLUnifiedModalSurface");
            const header = owner.chrome.header(bar, "QOLPresetPreviewDrag", "Preset preview");
            const title = header.GetChild(0);
            title.RemoveClass("ModalTitle");
            title.AddClass("QOLPresetPreviewTitle");
            const name = P.create("Label", bar, "");
            name.AddClass("QOLPresetPreviewName");
            name.text = options.name;
            owner.status = P.create("Label", bar, "");
            owner.status.AddClass("QOLPresetPreviewStatus");
            const actions = P.create("Panel", bar, "");
            actions.AddClass("QOLPresetPreviewActions");
            const button = (id, text, primary, action) => {
                const panel = P.create("Button", actions, id);
                panel.hittest = true;
                panel.hittestchildren = false;
                panel.AddClass(primary ? "QOLUnifiedModalPrimary" : "QOLUnifiedModalSecondary");
                P.create("Label", panel, "").text = localize(text);
                panel.SetPanelEvent("onactivate", () => {
                    if (current !== owner) return;
                    if (!valid(owner)) { stop(); return; }
                    action();
                });
                return panel;
            };
            button("QOLPresetPreviewBack", "Back", false, () => stop());
            owner.apply = button("QOLPresetPreviewApply", "Apply", true, () => {
                if (!owner.apply.enabled) return;
                try {
                    if (options.onApply() !== false) { stop(); return; }
                } catch (error) { $.Msg("[QOLLock][PresetPreview] Apply: " + (error.message || error)); }
                stop();
            });
            for (const panel of [hud, context]) if (!panel.BHasClass("QOLCustomizeActive")) {
                panel.AddClass("QOLCustomizeActive"); owner.active.push(panel);
            }
            for (const child of context.Children()) {
                if (child === owner.overlay || ["QOLStorageBridge", "EscapeButton", "EscapeBackground"].includes(child.id)) continue;
                if (!child.BHasClass("QOLCustomizeHidden")) {
                    child.AddClass("QOLCustomizeHidden"); owner.hidden.push(child);
                }
            }
            Q.tooltip?.hideRowTooltip?.();
            watch(owner);
            if (current !== owner) return false;
            owner.overlay.SetFocus();
            return true;
        } catch (error) {
            $.Msg("[QOLLock][PresetPreview] " + (error.message || error));
            stop();
            return false;
        }
    }
    Q.ui.presetPreview = { start, stop, isRunning: () => !!current, owns: modal => current?.modal === modal };
})();
