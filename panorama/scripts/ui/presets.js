// panorama/scripts/ui/presets.js
// =============================================================================
// QOLLOCK — Presets Subsystem & Tab Renderer (ES6)
// =============================================================================
// Modeled after clean modular architecture. Manages base & community presets,
// applying preset configs, active preset matching & highlight, and Presets tab.
// =============================================================================

(() => {
    "use strict";

    const Q = (typeof globalThis !== "undefined" && globalThis.QOL)
        ? globalThis.QOL
        : (typeof QOL !== "undefined" ? QOL : null);

    if (!Q?.ui) {
        $.Msg("[QOLLock] ui/presets: QOL.ui missing — aborting");
        return;
    }

    const BREAD_PRESET_NAME = "BreadRollius";
    const LEGACY_BREAD_PRESET_NAME = "Bread";
    const PRESET_MATCH_EXCLUDED_KEYS = new Set(["DRAG_ENABLED", "PREVIEWS_ENABLED", "ACTIVE_PRESET_NAME", "ENABLE_UPDATE_CHECKER"]);

    let _presetButtonRegistry = new Map();
    let _lastAppliedPresetName = "";
    let _highlightPollToken = 0;
    let _highlightPollRunning = false;

    const isAlive = Q.core.panel.isAlive;

    const getPresetsMap = () => {
        if (typeof globalThis !== "undefined" && globalThis.QOL_PRESETS) return globalThis.QOL_PRESETS;
        if (typeof globalThis !== "undefined" && globalThis.PRESETS) return globalThis.PRESETS;
        if (typeof QOL !== "undefined" && QOL.presets) return QOL.presets;
        return {};
    };

    const localize = Q.ui.renderer.localize;

    const PERSONAL_PRESETS_KEY = "qollock_personal_presets";
    let personalWritePending = false;
    let personalRenderGeneration = 0;
    const compareLabels = (a, b) => {
        const left = a.toLowerCase(), right = b.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    };

    const validatePersonalName = name => {
        if (typeof name !== "string" || /[\x00-\x1f\x7f]/.test(name) || !name.trim() || name.trim().length > 48) {
            throw new Error("Enter a preset name (1–48 characters).");
        }
        return name.trim();
    };

    const personalStorage = () => {
        const bridge = Q.core.storageBridge;
        if (!bridge) throw new Error("Preset storage is unavailable.");
        return bridge;
    };

    const readPersonalPresets = async () => {
        const raw = await personalStorage().load(PERSONAL_PRESETS_KEY);
        if (raw === null || raw === undefined || raw === "") return [];
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries)) throw new Error("Invalid personal preset data.");
        const names = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry.raw !== "string" || validatePersonalName(entry.name) !== entry.name || names.has(entry.name.toLowerCase())) {
                throw new Error("Invalid personal preset data.");
            }
            Q.parseStoredConfig(entry.raw);
            names.add(entry.name.toLowerCase());
        }
        return entries.sort((a, b) => compareLabels(a.name, b.name));
    };

    const writePersonalPresets = async change => {
        if (personalWritePending) throw new Error("A preset operation is already in progress.");
        personalWritePending = true;
        try {
            const entries = change(await readPersonalPresets());
            await personalStorage().save(PERSONAL_PRESETS_KEY, JSON.stringify(entries));
            return entries.sort((a, b) => compareLabels(a.name, b.name));
        } finally {
            personalWritePending = false;
        }
    };

    const savePersonalPreset = async (name, config, replace = false) => {
        name = validatePersonalName(name);
        const raw = globalThis.WrapConfigForStorage(Q.parseStoredConfig(globalThis.WrapConfigForStorage(config)));
        return writePersonalPresets(entries => {
            const existing = entries.findIndex(entry => entry.name.toLowerCase() === name.toLowerCase());
            if (existing >= 0 && !replace) throw new Error("A preset with this name already exists.");
            const entry = { name, raw };
            if (existing >= 0) entries[existing] = entry;
            else entries.push(entry);
            return entries;
        });
    };

    const deletePersonalPreset = async name => {
        name = validatePersonalName(name);
        return writePersonalPresets(entries => entries.filter(entry => entry.name.toLowerCase() !== name.toLowerCase()));
    };

    const NORMALIZERS = [
        "NormalizeNeutralCampFlags",
        "NormalizeItemCooldownModeConfig",
        "NormalizeAmmoScaleConfig",
        "NormalizeVoiceTypeConfig",
        "NormalizeHealthbarTypeConfig",
        "NormalizeColorWarningConfig",
        "NormalizeEnemyColorWarningConfig",
        "NormalizeAllyColorWarningConfig",
        "NormalizeTopbarEnemyHpWarningConfig",
        "NormalizeTopbarAllyHpWarningConfig",
        "NormalizeShopItemNotificationsConfig",
        "NormalizeQuickbuyDependencyConfig",
        "NormalizeConfig",
    ];

    const runNormalizers = (target, refData) => {
        for (const fnName of NORMALIZERS) {
            if (typeof globalThis[fnName] === "function") {
                globalThis[fnName](target, refData);
            }
        }
    };

    const isBreadPresetName = (name) => {
        const str = String(name || "");
        return str === BREAD_PRESET_NAME || str === LEGACY_BREAD_PRESET_NAME;
    };

    const normalizeBreadPresetName = (name) => {
        return isBreadPresetName(name) ? BREAD_PRESET_NAME : String(name || "");
    };

    const buildCommunityPresetEntries = () => {
        const names = [
            "Saiah", "Basil", "Vegas", "Poshy", "Goober", "Piggy", "BSQTT",
            BREAD_PRESET_NAME, "Saintmxsm", "Tuna", "Sneed", "iKaritzu", "Scuffed",
            "Gyzeh", "bonclide", "Zer0", "Pops", "Wouwei", "Nairshark", "Satanael",
            "Kr1stux", "Wrvth", "Jared", "Profitable", "Bubsito", "Gambler", "Hikyo",
            "Chjcago", "Starjadian", "Predi", "Shark", "Neonvoid", "Fenmore",
            "Deethirty", "Jerboa", "RiChew", "Soramikali", "Jaundice", "Xavier",
            "Spookyy", "Specty", "Wirdly", "Radiant", "Chumba", "FakeThread", "7eventy7",
            "XD_HECTICC", "Enova", "Boredom", "PrivateProf", "Munfins", "Gmanc2", "Keta",
            "Torque", "iMicro", "TW1G", "Veradox", "Antetheosis", "k49", "ninjabladeJr",
            "FlintSnow", "Fiizypopdrinkk", "Steqdyy", "Synapses_", "Gerglee", "Dappa",
            "Seyer", "T1FF4NNY", "Joey", "Zyartic", "billyyy", "mituu", "qlt",
            "munchkinman", "Blank2762", "Valerie", "Rosalia", "notah", "Anguish",
            "_ZODUK_", "nkonin.me", "loony", "leah", "Thorkizzle"
        ];

        const entries = names.map((name) => {
            let label = name;
            let preset = name;
            if (name === "munchkinman") label = "munchkin";
            else if (name === "ninjabladeJr") label = "ninjabladejr";
            else if (name === BREAD_PRESET_NAME || name === LEGACY_BREAD_PRESET_NAME) {
                label = "Bread";
                preset = "Bread";
            }
            return {
                label,
                preset,
                available: name !== "Predi",
            };
        });

        return entries.sort((a, b) => compareLabels(a.label, b.label));
    };

    const resolvePresetConfigByName = (presetName) => {
        if (!presetName) return null;
        let normName = normalizeBreadPresetName(presetName);
        const presets = getPresetsMap();
        const defConfig = globalThis.DEFAULT_CONFIG || globalThis.QOL_DEFAULT_CONFIG || {};

        if (normName !== "Default" && !Object.prototype.hasOwnProperty.call(presets, normName)) {
            if (Object.prototype.hasOwnProperty.call(presets, presetName)) {
                normName = presetName;
            } else if (normName === "Bread" && Object.prototype.hasOwnProperty.call(presets, "BreadRollius")) {
                normName = "BreadRollius";
            } else if (normName === "BreadRollius" && Object.prototype.hasOwnProperty.call(presets, "Bread")) {
                normName = "Bread";
            } else {
                return null;
            }
        }

        const resolved = Object.assign({}, defConfig);
        if (normName !== "Default") {
            const presetData = presets[normName];
            if (presetData) {
                Object.assign(resolved, presetData);
            }
            runNormalizers(resolved, presetData || resolved);
        } else {
            runNormalizers(resolved, resolved);
        }
        return resolved;
    };

    const preservedUiPreferences = config => {
        const result = { DRAG_ENABLED: config.DRAG_ENABLED, PREVIEWS_ENABLED: config.PREVIEWS_ENABLED };
        if (config.ENABLE_UPDATE_CHECKER !== undefined) result.ENABLE_UPDATE_CHECKER = config.ENABLE_UPDATE_CHECKER;
        return result;
    };

    const buildPresetCandidateConfigByName = name => {
        const resolved = resolvePresetConfigByName(name);
        return resolved ? Object.assign(resolved, preservedUiPreferences(globalThis.MOD_CONFIG || {})) : null;
    };

    const isPresetValueMatch = (currentValue, presetValue) => {
        if (typeof currentValue === "number" && typeof presetValue === "number") {
            return Math.abs(currentValue - presetValue) <= 0.0001;
        }
        return currentValue === presetValue;
    };

    const doesCurrentConfigMatchPreset = (presetName) => {
        const resolved = resolvePresetConfigByName(presetName);
        if (!resolved) return false;
        const modConfig = globalThis.MOD_CONFIG;
        if (!modConfig) return false;

        for (const key of Object.keys(resolved)) {
            if (PRESET_MATCH_EXCLUDED_KEYS.has(key)) continue;
            if (!Object.prototype.hasOwnProperty.call(modConfig, key)) continue;
            if (!isPresetValueMatch(modConfig[key], resolved[key])) {
                return false;
            }
        }
        return true;
    };

    const applyPresetConfig = (presetData) => {
        if (!presetData) return false;
        const modConfig = globalThis.MOD_CONFIG;
        const defConfig = globalThis.DEFAULT_CONFIG || globalThis.QOL_DEFAULT_CONFIG || {};
        if (!modConfig) return false;

        const preserved = preservedUiPreferences(modConfig);

        for (const key of Object.keys(defConfig)) {
            modConfig[key] = defConfig[key];
        }
        for (const key of Object.keys(presetData)) {
            modConfig[key] = presetData[key];
        }

        runNormalizers(modConfig, presetData);

        Object.assign(modConfig, preserved);
        return true;
    };

    const applyPresetByName = (presetName) => {
        let normName = normalizeBreadPresetName(presetName);
        const presets = getPresetsMap();
        const defConfig = globalThis.DEFAULT_CONFIG || globalThis.QOL_DEFAULT_CONFIG || {};

        if (normName !== "Default" && !Object.prototype.hasOwnProperty.call(presets, normName)) {
            if (Object.prototype.hasOwnProperty.call(presets, presetName)) {
                normName = presetName;
            } else if (normName === "Bread" && Object.prototype.hasOwnProperty.call(presets, "BreadRollius")) {
                normName = "BreadRollius";
            } else if (normName === "BreadRollius" && Object.prototype.hasOwnProperty.call(presets, "Bread")) {
                normName = "Bread";
            }
        }

        const presetData = normName === "Default" ? defConfig : presets[normName];
        return applyPresetSnapshot(presetData, normName);
    };

    const applyPresetSnapshot = (presetData, normName = "") => {
        const prevLang = typeof globalThis.GetSettingsLanguage === "function" ? globalThis.GetSettingsLanguage() : "english";
        if (!applyPresetConfig(presetData)) return false;

        if (globalThis.MOD_CONFIG) {
            globalThis.MOD_CONFIG.ACTIVE_PRESET_NAME = isBreadPresetName(normName) ? BREAD_PRESET_NAME : "";
        }
        _lastAppliedPresetName = String(normName || "");

        if (typeof globalThis.SetRuntimePresetName === "function") {
            globalThis.SetRuntimePresetName(normName);
        }
        if (typeof globalThis.SaveAndSync === "function") {
            globalThis.SaveAndSync();
        }
        if (typeof globalThis.RefreshSettingsLanguageUiAfterConfigChange === "function") {
            globalThis.RefreshSettingsLanguageUiAfterConfigChange(prevLang);
        }
        return true;
    };

    const refreshActivePresetConfigMarkerBeforeSave = () => {
        const modConfig = globalThis.MOD_CONFIG;
        if (!modConfig || !Object.prototype.hasOwnProperty.call(modConfig, "ACTIVE_PRESET_NAME")) return;
        const activePresetName = String(modConfig.ACTIVE_PRESET_NAME || "");
        if (!activePresetName) {
            if (doesCurrentConfigMatchPreset(BREAD_PRESET_NAME)) {
                modConfig.ACTIVE_PRESET_NAME = BREAD_PRESET_NAME;
            }
            return;
        }
        if (isBreadPresetName(activePresetName) && doesCurrentConfigMatchPreset(BREAD_PRESET_NAME)) {
            modConfig.ACTIVE_PRESET_NAME = BREAD_PRESET_NAME;
            return;
        }
        modConfig.ACTIVE_PRESET_NAME = "";
        if (Object.prototype.hasOwnProperty.call(modConfig, "ENABLE_UNSPENT_SOULS")) {
            modConfig.ENABLE_UNSPENT_SOULS = 0;
        }
        if (Object.prototype.hasOwnProperty.call(modConfig, "DEFAULT_HERO")) {
            delete modConfig.DEFAULT_HERO;
        }
    };

    const resetPresetButtonRegistry = () => {
        _presetButtonRegistry.clear();
    };

    const registerPresetButton = (presetName, button, labelPanel, originalText) => {
        if (!presetName || !isAlive(button)) return;
        _presetButtonRegistry.set(presetName, {
            button,
            label: labelPanel,
            text: originalText || presetName,
        });
    };

    const setExplicitActivePresetButton = (activeButton) => {
        for (const entry of _presetButtonRegistry.values()) {
            if (isAlive(entry?.button)) {
                entry.button.SetHasClass("PresetActive", entry.button === activeButton);
            }
        }
    };

    const refreshActivePresetHighlight = () => {
        let matchedPreset = null;
        if (_lastAppliedPresetName) {
            const entry = _presetButtonRegistry.get(_lastAppliedPresetName);
            if (isAlive(entry?.button) && doesCurrentConfigMatchPreset(_lastAppliedPresetName)) {
                matchedPreset = _lastAppliedPresetName;
            } else {
                _lastAppliedPresetName = "";
            }
        }

        if (!matchedPreset) {
            for (const [name, entry] of _presetButtonRegistry.entries()) {
                if (!isAlive(entry?.button)) continue;
                if (doesCurrentConfigMatchPreset(name)) {
                    matchedPreset = name;
                    break;
                }
            }
        }

        for (const [name, entry] of _presetButtonRegistry.entries()) {
            if (isAlive(entry?.button)) {
                entry.button.SetHasClass("PresetActive", name === matchedPreset);
            }
        }
    };

    const isSettingsWindowVisible = () => {
        if (typeof Q.ui.window?.isOpen === "function") {
            return Q.ui.window.isOpen();
        }
        if (typeof globalThis.IsSettingsWindowVisible === "function") {
            return globalThis.IsSettingsWindowVisible();
        }
        const win = $.GetContextPanel()?.FindChildTraverse("SettingsWindow");
        return !!(win && isAlive(win) && win.BHasClass && win.BHasClass("Visible"));
    };

    const shouldRunPresetHighlightPolling = () => {
        const curTab = globalThis.currentTab;
        const curSearch = globalThis.currentSearchQuery;
        return isSettingsWindowVisible() && curTab === "Presets" && !curSearch && _presetButtonRegistry.size > 0;
    };

    const stopPresetHighlightPolling = () => {
        _highlightPollToken += 1;
        _highlightPollRunning = false;
    };

    const startPresetHighlightPolling = () => {
        if (_highlightPollRunning) return;
        _highlightPollRunning = true;
        const token = ++_highlightPollToken;
        const poll = () => {
            if (token !== _highlightPollToken) return;
            if (!shouldRunPresetHighlightPolling()) {
                _highlightPollRunning = false;
                return;
            }
            refreshActivePresetHighlight();
            if (typeof $.Schedule === "function") {
                $.Schedule(1.0, poll);
            }
        };
        if (typeof $.Schedule === "function") {
            $.Schedule(0.1, poll);
        }
    };

    const updatePresetHighlightPollingState = () => {
        if (shouldRunPresetHighlightPolling()) {
            startPresetHighlightPolling();
        } else {
            stopPresetHighlightPolling();
        }
    };

    const queueActivePresetHighlightRefresh = (delaySec = 0.02) => {
        if (typeof $.Schedule === "function") {
            $.Schedule(delaySec, refreshActivePresetHighlight);
        } else {
            refreshActivePresetHighlight();
        }
    };

    const showPresetApplySuccess = (button, labelPanel, originalText) => {
        if (!isAlive(button) || !isAlive(labelPanel)) return;
        const fallbackText = originalText || labelPanel.text || "";

        button.AddClass("PresetApplySuccess");
        setExplicitActivePresetButton(button);
        labelPanel.text = localize("SUCCESS", true);
        queueActivePresetHighlightRefresh(0.01);

        if (typeof $.Schedule === "function") {
            $.Schedule(0.6, () => {
                if (isAlive(labelPanel)) labelPanel.text = fallbackText;
                if (isAlive(button)) button.RemoveClass("PresetApplySuccess");
                queueActivePresetHighlightRefresh(0.01);
            });
        }
    };

    const createPresetGrid = (parent, title, entries, columns = 6, variant = "custom") => {
        if (!isAlive(parent)) return null;

        const titleLabel = $.CreatePanel("Label", parent, "");
        if (titleLabel) {
            titleLabel.AddClass("SectionTitle");
            titleLabel.AddClass("MainSectionTitle");
            if (variant === "custom") titleLabel.AddClass("MainSectionTitleCustom");
            titleLabel.text = title;
        }

        const grid = $.CreatePanel("Panel", parent, "");
        if (grid) {
            grid.AddClass("PresetCategoryGrid");
            if (variant === "custom") grid.AddClass("PresetCategoryGridCustom");
        }

        if (!grid) return { titleLabel, grid: null };

        const cols = columns || 6;
        let index = 0;

        while (index < entries.length) {
            const rowCount = Math.min(cols, entries.length - index);
            const row = $.CreatePanel("Panel", grid, "");
            if (row) row.AddClass("PresetGridRow");
            const rowInner = $.CreatePanel("Panel", row, "");
            if (rowInner) rowInner.AddClass("PresetGridRowInner");

            for (let c = 0; c < rowCount; c++) {
                const entry = entries[index + c];
                if (!entry) continue;

                const btn = $.CreatePanel("Button", rowInner, "");
                if (btn) {
                    btn.AddClass("PresetGridBtn");
                    if (entry.label) {
                        btn.AddClass(`PresetGridBtn_${String(entry.label).replace(/[^A-Za-z0-9_]/g, "")}`);
                    }
                    const entryVariant = entry.variant || variant || "";
                    if (entryVariant === "base") btn.AddClass("PresetGridBtnBase");
                    else if (entryVariant === "great") btn.AddClass("PresetGridBtnGreat");
                    else if (entryVariant === "custom") {
                        btn.AddClass("PresetGridBtnCustom");
                        if (entry.available !== false) btn.AddClass("PresetGridBtnCustomActive");
                    }

                    const lbl = $.CreatePanel("Label", btn, "");
                    if (lbl) lbl.text = entry.label;

                    if (entry.available === false) {
                        btn.AddClass("PresetGridBtnUnavailable");
                        btn.SetPanelEvent("onmouseover", () => {
                            $.DispatchEvent("UIShowTextTooltip", btn, localize("Preset configuration has not been added yet.", true));
                        });
                        btn.SetPanelEvent("onmouseout", () => $.DispatchEvent("UIHideTextTooltip"));
                    } else {
                        if (entry.preset) {
                            registerPresetButton(entry.preset, btn, lbl, entry.label);
                        }

                        btn.SetPanelEvent("onactivate", () => {
                            if (typeof globalThis.BuildPresetCandidateConfigByName === "function" &&
                                typeof globalThis.BuildConfigDiffRows === "function" &&
                                typeof globalThis.OpenConfigDiffPreviewModal === "function") {
                                const candidate = globalThis.BuildPresetCandidateConfigByName(entry.preset);
                                if (!candidate) return;
                                const diffRows = globalThis.BuildConfigDiffRows(globalThis.MOD_CONFIG, candidate);
                                globalThis.OpenConfigDiffPreviewModal({
                                    title: "Settings Changes",
                                    summary: `Changes: ${diffRows.length}`,
                                    rows: diffRows,
                                    applyText: "Confirm",
                                    cancelText: "Cancel",
                                    onApply: () => {
                                        const didApply = applyPresetByName(entry.preset);
                                        if (didApply) {
                                            showPresetApplySuccess(btn, lbl, entry.label);
                                        }
                                        return didApply;
                                    },
                                });
                            } else {
                                const didApply = applyPresetByName(entry.preset);
                                if (didApply) {
                                    showPresetApplySuccess(btn, lbl, entry.label);
                                }
                            }
                        });
                    }
                }
            }

            index += rowCount;
        }

        return { titleLabel, grid };
    };

    // =========================================================================
    // Dedicated Tab Renderer for "Presets"
    // =========================================================================

    const renderPersonalPresets = container => {
        const generation = ++personalRenderGeneration;
        const section = $.CreatePanel("Panel", container, "PersonalPresetsSection");
        section.AddClass("PersonalPresetsSection");
        const current = () => generation === personalRenderGeneration && isAlive(section) && section.GetParent() === container;
        const label = (parent, text, className, id = "") => {
            const panel = $.CreatePanel("Label", parent, id);
            panel.AddClass(className);
            panel.text = localize(text, true);
            return panel;
        };
        const button = (parent, text, className, action, id = "") => {
            const panel = $.CreatePanel("Button", parent, id);
            panel.AddClass("SettingActionBtn");
            panel.AddClass(className);
            label(panel, text, "SettingActionBtnLabel");
            panel.SetPanelEvent("onactivate", action);
            return panel;
        };
        label(section, "Personal Presets", "SectionTitle");
        label(section, "Save your current settings under a name, then load them whenever you need.", "PersonalPresetsHint");
        label(section, "Use at Startup saves this snapshot for the next launch. The main Save button can overwrite it.", "PersonalPresetsHint");
        label(section, "Preset name", "PersonalPresetsHint");
        const form = $.CreatePanel("Panel", section, "");
        form.AddClass("PersonalPresetRow");
        const nameInput = $.CreatePanel("TextEntry", form, "PersonalPresetName");
        nameInput.AddClass("PersonalPresetName");
        nameInput.maxchars = 48;
        nameInput.multiline = false;
        const saveButton = button(form, "Save Current", "PersonalPresetSave", () => saveCurrent(), "PersonalPresetSave");
        const status = label(section, "Loading personal presets...", "PersonalPresetsStatus", "PersonalPresetsStatus");
        const confirmation = $.CreatePanel("Panel", section, "PersonalPresetConfirmation");
        confirmation.AddClass("PersonalPresetRow");
        confirmation.visible = false;
        const confirmationText = label(confirmation, "", "PersonalPresetTitle");
        let pendingAction = null;
        button(confirmation, "Confirm", "PersonalPresetConfirm", () => {
            const action = pendingAction;
            pendingAction = null;
            confirmation.visible = false;
            if (action) action();
        });
        button(confirmation, "Cancel", "PersonalPresetCancel", () => {
            pendingAction = null;
            confirmation.visible = false;
        });
        const list = $.CreatePanel("Panel", section, "PersonalPresetsList");
        list.AddClass("PersonalPresetsList");
        let entries = [], busy = true;
        saveButton.enabled = false;
        const feedback = (text, failed = false) => {
            status.text = localize(text, true);
            status.SetHasClass("FailureState", failed);
        };
        const confirm = (text, action) => {
            confirmationText.text = text;
            pendingAction = action;
            confirmation.visible = true;
        };
        const run = async (operation, successText) => {
            if (busy || !current()) return;
            busy = true;
            saveButton.enabled = false;
            list.enabled = false;
            confirmation.visible = false;
            feedback("Working...");
            try {
                const result = await operation();
                if (!current()) return;
                entries = result;
                draw();
                feedback(successText);
            } catch (error) {
                if (current()) feedback("Preset operation failed. Your saved presets were not replaced in this view.", true);
                $.Msg(`[QOLLock][presets] ${error.message || error}`);
            } finally {
                if (current()) {
                    busy = false;
                    saveButton.enabled = true;
                    list.enabled = true;
                }
            }
        };
        const saveCurrent = () => {
            if (busy || !current()) return;
            try {
                const name = validatePersonalName(nameInput.text);
                // Capture at the click, so confirmation cannot save later edits by accident.
                const snapshot = Object.assign({}, globalThis.MOD_CONFIG);
                const save = () => { void run(() => savePersonalPreset(name, snapshot, true), "Personal preset saved."); };
                if (entries.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
                    confirm(Q.ui.theme.FormatSettingsText('Replace preset "{name}"?', { name }), save);
                } else {
                    void run(() => savePersonalPreset(name, snapshot), "Personal preset saved.");
                }
            } catch (error) {
                feedback(error.message, true);
            }
        };
        const draw = () => {
            list.RemoveAndDeleteChildren();
            for (const entry of entries) {
                const row = $.CreatePanel("Panel", list, "");
                row.AddClass("PersonalPresetRow");
                const title = label(row, "", "PersonalPresetTitle");
                title.text = entry.name;
                button(row, "Load", "PersonalPresetLoad", () => {
                    if (busy || !current()) return;
                    const config = Q.parseStoredConfig(entry.raw);
                    const candidate = Object.assign({}, config, preservedUiPreferences(globalThis.MOD_CONFIG));
                    globalThis.OpenConfigDiffPreviewModal({
                        title: localize("Settings Changes", true), details: entry.name,
                        rows: globalThis.BuildConfigDiffRows(globalThis.MOD_CONFIG, candidate),
                        applyText: localize("Confirm", true), cancelText: localize("Cancel", true),
                        onApply: () => current() && applyPresetSnapshot(config, config.ACTIVE_PRESET_NAME)
                    });
                });
                button(row, "Use at Startup", "PersonalPresetStartup", () => {
                    void run(async () => {
                        await personalStorage().saveStartupSettings(entry.raw);
                        return entries;
                    }, "Preset saved for startup.");
                });
                button(row, "Delete", "PersonalPresetDelete", () => {
                    if (busy || !current()) return;
                    confirm(Q.ui.theme.FormatSettingsText('Delete preset "{name}"?', { name: entry.name }), () => {
                        void run(() => deletePersonalPreset(entry.name), "Personal preset deleted.");
                    });
                });
            }
        };
        const load = async () => {
            try {
                const result = await readPersonalPresets();
                if (!current()) return;
                entries = result;
                draw();
                feedback(entries.length ? "Load a preset now or choose it for startup." : "No personal presets yet. Save your current settings above.");
                busy = false;
                saveButton.enabled = true;
            } catch (error) {
                if (current()) feedback("Could not load personal presets. Reopen this tab to retry.", true);
                $.Msg(`[QOLLock][presets] ${error.message || error}`);
            }
        };
        void load();
    };

    const renderPresetsTab = (container) => {
        const collecting = globalThis.gSearchCollectMode && globalThis.gSearchCollectState;
        if (!collecting && !isAlive(container)) return;

        const presetsTitle = localize("Presets", true);

        const basePresetEntries = [
            { label: "Default", preset: "Default", variant: "base" },
            { label: "16:10", preset: "16:10", variant: "base" },
            { label: "4:3", preset: "4:3", variant: "base" },
            { label: "Clean", preset: "Clean", variant: "base" },
            { label: "Enhanced", preset: "Enhanced", variant: "base" },
            { label: "Maximum", preset: "Maximum", variant: "base", dividerAfter: true },
        ];

        const customEntries = basePresetEntries.concat(buildCommunityPresetEntries());
        if (collecting) {
            Q.ui.controls.createSectionTitle(container, presetsTitle);
            for (const entry of customEntries) {
                if (!entry || entry.available === false) continue;
                Q.ui.controls.createRow(container, entry.label, entry.preset ? "SEARCH_PRESET:" + entry.preset : "SEARCH_TAB:Presets", "actionbutton", null, null, null, [{ label: entry.preset ? "Apply" : "Open" }], "Preset");
            }
            Q.ui.controls.createRow(container, "Personal Presets", "SEARCH_TAB:Presets", "actionbutton", null, null, null, [{ label: "Open" }], "Save and load your own presets.");
            return;
        }
        resetPresetButtonRegistry();

        createPresetGrid(container, presetsTitle, customEntries, 6, "custom");

        renderPersonalPresets(container);

        refreshActivePresetHighlight();
    };

    // Auto-register with settings window manager
    if (Q.ui.window?.registerTabRenderer) {
        Q.ui.window.registerTabRenderer("Presets", renderPresetsTab);
    }

    // Export API on Q.ui.presets
    Q.ui.presets = {
        readPersonalPresets,
        savePersonalPreset,
        deletePersonalPreset,
        applyPresetConfig,
        applyPresetByName,
        buildCommunityPresetEntries,
        resolvePresetConfigByName,
        buildPresetCandidateConfigByName,
        doesCurrentConfigMatchPreset,
        refreshActivePresetConfigMarkerBeforeSave,
        refreshActivePresetHighlight,
        queueActivePresetHighlightRefresh,
        startPresetHighlightPolling,
        stopPresetHighlightPolling,
        updatePresetHighlightPollingState,
        shouldRunPresetHighlightPolling,
        resetPresetButtonRegistry,
        registerPresetButton,
        showPresetApplySuccess,
        createPresetGrid,
        renderPresetsTab,
    };

    // Backward compatibility globals
    globalThis.ApplyPresetConfig = applyPresetConfig;
    globalThis.ApplyPresetByName = applyPresetByName;
    globalThis.BuildCommunityPresetEntries = buildCommunityPresetEntries;
    globalThis.ResolvePresetConfigByName = resolvePresetConfigByName;
    globalThis.BuildPresetCandidateConfigByName = buildPresetCandidateConfigByName;
    globalThis.DoesCurrentConfigMatchPreset = doesCurrentConfigMatchPreset;
    globalThis.RefreshActivePresetConfigMarkerBeforeSave = refreshActivePresetConfigMarkerBeforeSave;
    globalThis.RefreshActivePresetHighlight = refreshActivePresetHighlight;
    globalThis.QueueActivePresetHighlightRefresh = queueActivePresetHighlightRefresh;
    globalThis.StartPresetHighlightPolling = startPresetHighlightPolling;
    globalThis.StopPresetHighlightPolling = stopPresetHighlightPolling;
    globalThis.UpdatePresetHighlightPollingState = updatePresetHighlightPollingState;
    globalThis.ShouldRunPresetHighlightPolling = shouldRunPresetHighlightPolling;
    globalThis.ResetPresetButtonRegistry = resetPresetButtonRegistry;
    globalThis.RegisterPresetButton = registerPresetButton;
    globalThis.SetExplicitActivePresetButton = setExplicitActivePresetButton;
    globalThis.ShowPresetApplySuccess = showPresetApplySuccess;
    globalThis.CreatePresetGrid = createPresetGrid;
})();
