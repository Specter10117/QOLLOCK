(() => {
    "use strict";
    const Q = globalThis.QOL;
    const P = Q.core.panel;
    const localize = text => Q.ui.theme.LocalizeSettingsText(text, true);
    const entryKeys = id => Q.presentation.elements.find(element => element.id === id)?.fields.map(field => field.key) || [];
    function collectEntry(elementId) {
        const element = Q.presentation.elements.find(item => item.id === elementId);
        const state = globalThis.gSearchCollectState;
        if (!element || !state?.currentSection) return;
        const aliases = [element.name, ...element.fields.flatMap(field => [field.key, field.label, localize(field.label)])];
        state.currentSection.rows.push(Q.ui.search.buildSearchCollectedRow("Customize", "", "customize", null, null, null,
            [{ elementId }], localize(element.name), aliases));
    }
    function createEntryAction(parent, elementId) {
        if (!P.isAlive(parent) || !Q.presentation.elements.some(element => element.id === elementId)) return null;
        const action = P.create("Button", parent, "QOLCustomizeEntry_" + elementId);
        action.AddClass("SectionTitleActionBtn");
        action.AddClass("QOLCustomizeEntry");
        action.SetAttributeString("QOL_CUSTOMIZE_ELEMENT", elementId);
        const caption = P.create("Label", action, "");
        caption.AddClass("SectionTitleActionLabel");
        caption.text = localize("Customize");
        action.SetPanelEvent("onactivate", () => {
            if (!P.isAlive(action)) return;
            $.DispatchEvent("UIHideTextTooltip", action);
            if (!Q.ui.customize.start(null, { elementId })) {
                $.DispatchEvent("UIShowTextTooltip", action, Q.ui.customize.failureText() ||
                    localize("The editor could not open. Close other visual tools and try again."));
            }
        });
        action.SetPanelEvent("onmouseout", () => $.DispatchEvent("UIHideTextTooltip", action));
        return action;
    }
    Q.ui.customize.createEntryAction = createEntryAction;
    Q.ui.customize.collectEntry = collectEntry;
    Q.ui.customize.entryKeys = entryKeys;
    function render(list) {
        // Gameplay sections already index scoped actions. The standalone
        // launcher must not create panels during the search metadata pass.
        if (globalThis.gSearchCollectMode) return;
        const I = Q.ui.customizeInspector;
        const host = Q.core.panel.create("Panel", list, "QOLCustomizeLaunch");
        host.AddClass("QOLCustomizeLaunch");
        host.AddClass("QOLUnifiedModalSurface");
        I.label(host, "Customize", "ModalTitle").AddClass("QOLCustomizeTitle");
        I.label(host, "Choose an element to edit its content, layout and appearance. Save keeps changes; Cancel discards the draft.");
        const status = I.label(host, "");
        status.text = Q.ui.customize.failureText();
        const open = elementId => {
            status.text = "";
            const started = Q.ui.customize.start(message => {
                if (message && Q.core.panel.isAlive(status)) status.text = Q.ui.theme.LocalizeSettingsText(message, true);
            }, elementId ? { elementId } : undefined);
            if (!started) status.text = Q.ui.customize.failureText() || Q.ui.theme.LocalizeSettingsText("The editor could not open. Close other visual tools and try again.", true);
        };
        I.button(host, "QOLCustomizeOpen", "Open editor", () => open(), true).AddClass("QOLCustomizeLaunchOpen");
        const groups = new Map();
        for (const element of Q.presentation.elements) {
            if (element.inspectorOwner || element.parentId || !element.fields.some(field => !field.hidden)) continue;
            const group = element.group || "HUD";
            if (!groups.has(group)) {
                const section = P.create("Panel", host, "");
                section.AddClass("QOLCustomizeSection");
                I.label(section, group, "ModalTitle").AddClass("QOLCustomizeSectionHeading");
                const grid = P.create("Panel", section, "");
                grid.AddClass("QOLCustomizeLaunchGrid");
                groups.set(group, grid);
            }
            const grid = groups.get(group);
            let row = grid.GetChildCount() ? grid.GetChild(grid.GetChildCount() - 1) : null;
            if (!row || row.GetChildCount() === 2) {
                row = P.create("Panel", grid, "");
                row.AddClass("QOLCustomizeLaunchRow");
            }
            I.button(row, "QOLCustomizeLaunch_" + element.id, element.name, () => open(element.id))
                .AddClass("QOLCustomizeLaunchElement");
        }
        for (const grid of groups.values()) {
            const row = grid.GetChild(grid.GetChildCount() - 1);
            if (row.GetChildCount() === 1) {
                // Keep the final shortcut half-width without a focusable empty button.
                const spacer = P.create("Panel", row, "");
                spacer.AddClass("QOLCustomizeLaunchSpacer");
                spacer.hittest = false;
            }
        }
    }
    Q.ui.window.registerTabRenderer("Customize", render);
})();
