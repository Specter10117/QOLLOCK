// panorama/scripts/ui/modal.js
// =============================================================================
// QOLLOCK — Modal Dialogs & Config Diff Subsystem (ES6)
// =============================================================================
// Encapsulates modal dialogs, configuration diffing, preview modal,
// import parsing diagnostics, and modal focus management.
// =============================================================================

(() => {
    "use strict";

    const Q = (typeof globalThis !== "undefined" && globalThis.QOL)
        ? globalThis.QOL
        : (typeof QOL !== "undefined" ? QOL : (globalThis.QOL = {}));
    Q.ui = Q.ui || {};

    const EXPORT_TOKEN_REGEX = /\[QOL-([0-9]+-[0-9]+-[0-9]+)(-C)?\]:?([A-Za-z0-9_-]+)/i;

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
        "NormalizeCompassSpeedSchemaMigration",
        "NormalizeLanguageSchemaMigration",
        "NormalizeDefaultHeroConfig",
        "NormalizeConfig",
    ];

    const runNormalizers = (target, refData, schemaVersion) => {
        for (const fnName of NORMALIZERS) {
            if (typeof globalThis[fnName] === "function") {
                globalThis[fnName](target, refData, schemaVersion);
            }
        }
    };

    const isAlive = Q.core.panel.isAlive;

    const localize = Q.ui.renderer.localize;

    const prepareSettingsModalOpen = () => {
        try {
            if (typeof globalThis.ApplySettingsThemeClasses === "function") {
                globalThis.ApplySettingsThemeClasses(null);
            }
        } catch (err) {
            $.Msg("[QOLLock] ui/modal: ApplySettingsThemeClasses failed: " + (err?.message || String(err)));
        }
    };

    const closeModal = (overlay) => {
        if (!isAlive(overlay)) return;
        if (Q.ui.presetPreview?.owns(overlay)) Q.ui.presetPreview.stop(false);
        const overlayId = String(overlay.id || "");
        const shouldReleaseSettingsFocus = (overlayId === "ConfigDiffPreviewModalOverlay");

        overlay.RemoveClass("Show");

        if (shouldReleaseSettingsFocus) {
            try {
                const root = $.GetContextPanel?.();
                const settingsWin = root?.FindChildTraverse?.("SettingsWindow");
                if (isAlive(settingsWin)) {
                    settingsWin.SetFocus();
                }
            } catch (err) {
                $.Msg("[QOLLock] ui/modal: Focus release failed: " + (err?.message || String(err)));
            }
            if (isAlive(overlay)) {
                overlay.DeleteAsync(0);
            }
            return;
        }

        if (typeof $.Schedule === "function") {
            $.Schedule(0.25, () => {
                if (isAlive(overlay)) overlay.DeleteAsync(0);
            });
        } else if (isAlive(overlay)) {
            overlay.DeleteAsync(0);
        }
    };

    const closeConfigDiffPreviewModalIfOpen = () => {
        const root = $.GetContextPanel?.();
        if (!isAlive(root)) return;
        const existing = root.FindChildTraverse("ConfigDiffPreviewModalOverlay");
        if (isAlive(existing)) {
            closeModal(existing);
        }
    };

    const closeSettingsSideModalsIfOpen = () => {
        const root = $.GetContextPanel?.();
        if (!isAlive(root)) return;
        const overlayIds = ["ConfigDiffPreviewModalOverlay"];
        for (const overlayId of overlayIds) {
            const existing = root.FindChildTraverse(overlayId);
            if (isAlive(existing)) {
                closeModal(existing);
            }
        }
    };

    const cloneConfigSnapshot = (source) => {
        const out = {};
        const src = (source && typeof source === "object") ? source : (globalThis.MOD_CONFIG || {});
        for (const key of Object.keys(src)) {
            out[key] = src[key];
        }
        return out;
    };

    const preserveUiOnlySettings = (targetConfig) => {
        if (!targetConfig || typeof targetConfig !== "object") return targetConfig;
        const modConfig = globalThis.MOD_CONFIG || {};
        if (Object.prototype.hasOwnProperty.call(modConfig, "DRAG_ENABLED")) {
            targetConfig.DRAG_ENABLED = modConfig.DRAG_ENABLED;
        }
        if (Object.prototype.hasOwnProperty.call(modConfig, "AUTO_SAVE_CHANGES")) {
            targetConfig.AUTO_SAVE_CHANGES = modConfig.AUTO_SAVE_CHANGES;
        }
        if (Object.prototype.hasOwnProperty.call(modConfig, "ENABLE_UPDATE_CHECKER")) {
            targetConfig.ENABLE_UPDATE_CHECKER = modConfig.ENABLE_UPDATE_CHECKER;
        }
        return targetConfig;
    };

    const buildCandidateConfigFromParsed = (parsed, schemaVersion, baseConfig) => {
        const diagnostics = {
            appliedKeys: 0,
            unknownKeys: 0,
            clampedKeys: 0,
        };
        const candidateConfig = cloneConfigSnapshot(baseConfig || globalThis.MOD_CONFIG);
        if (!parsed || typeof parsed !== "object") {
            return { candidateConfig, diagnostics };
        }

        const fieldMap = Q.persistence?.buildSchemaFieldMap
            ? Q.persistence.buildSchemaFieldMap(schemaVersion)
            : {};

        for (const key of Object.keys(parsed)) {
            if (!Object.prototype.hasOwnProperty.call(candidateConfig, key)) {
                diagnostics.unknownKeys++;
                continue;
            }
            let nextValue = parsed[key];
            const field = fieldMap[key] || null;
            if (field && typeof nextValue === "number" && Q.persistence?.clampToSchemaField) {
                const clampResult = Q.persistence.clampToSchemaField(nextValue, field);
                nextValue = clampResult.value;
                if (clampResult.changed) diagnostics.clampedKeys++;
            }
            candidateConfig[key] = nextValue;
            diagnostics.appliedKeys++;
        }

        const ver = schemaVersion || globalThis.QOL_SCHEMA_SEMVER;
        runNormalizers(candidateConfig, parsed, ver);

        return { candidateConfig, diagnostics };
    };

    const formatConfigKeyForDiff = (key) => {
        const raw = String(key || "");
        if (!raw) return "";
        const tokens = raw.split("_");
        for (let i = 0; i < tokens.length; i++) {
            const token = String(tokens[i] || "").toLowerCase();
            if (!token) continue;
            if (token === "fps") {
                tokens[i] = "FPS";
                continue;
            }
            tokens[i] = token.charAt(0).toUpperCase() + token.slice(1);
        }
        return tokens.join(" ");
    };

    const formatConfigValueForDiff = (value, key) => {
        const configKey = String(key || "");
        const isBinaryNumber = (typeof value === "number" && (value === 0 || value === 1));
        const isBinaryBool = (typeof value === "boolean");
        const isBinary = isBinaryNumber || isBinaryBool;
        const isEnableStyle = /(ENABLE|ENABLED|DISABLE|DISABLED|SHOW|HIDE|VISIBLE|TOGGLE|ACTIVE|ON_OFF|ONOFF)/i.test(configKey);
        const isFilterStyle = /(^ITEM_FILTER_|_FILTER_)/.test(configKey);

        if (isBinary && (isEnableStyle || isFilterStyle)) {
            const onState = isBinaryBool ? (value === true) : (Number(value) === 1);
            return onState ? "On" : "Off";
        }
        if (value === undefined) return "(unset)";
        if (value === null) return "(null)";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") {
            if (Math.abs(value - Math.round(value)) <= 0.0001) {
                return String(Math.round(value));
            }
            let fixed = String(value.toFixed(3));
            fixed = fixed.replace(/\.?0+$/, "");
            return fixed;
        }
        return String(value);
    };

    const normalizeComparableConfigValue = (val) => {
        if (typeof globalThis.NormalizeComparableConfigValue === "function") {
            return globalThis.NormalizeComparableConfigValue(val);
        }
        if (typeof val === "number") {
            return Math.round(val * 1000) / 1000;
        }
        return val;
    };

    const buildConfigDiffRows = (currentConfig, nextConfig) => {
        const rows = [];
        if (!currentConfig || !nextConfig) return rows;

        const seen = new Set();
        const defConfig = globalThis.DEFAULT_CONFIG || globalThis.QOL_DEFAULT_CONFIG || {};

        const pushRowIfChanged = (key) => {
            const normKey = String(key || "");
            if (!normKey || seen.has(normKey)) return;
            seen.add(normKey);

            const hasCurrent = Object.prototype.hasOwnProperty.call(currentConfig, normKey);
            const hasNext = Object.prototype.hasOwnProperty.call(nextConfig, normKey);
            if (!hasCurrent && !hasNext) return;

            const beforeValue = hasCurrent ? currentConfig[normKey] : undefined;
            const afterValue = hasNext ? nextConfig[normKey] : undefined;

            if (normalizeComparableConfigValue(beforeValue) === normalizeComparableConfigValue(afterValue)) {
                return;
            }

            rows.push({
                key: normKey,
                keyLabel: formatConfigKeyForDiff(normKey),
                categoryLabel: "",
                beforeValue,
                afterValue,
                beforeText: formatConfigValueForDiff(beforeValue, normKey),
                afterText: formatConfigValueForDiff(afterValue, normKey),
            });
        };

        for (const key of Object.keys(defConfig)) {
            pushRowIfChanged(key);
        }
        for (const key of Object.keys(nextConfig)) {
            pushRowIfChanged(key);
        }
        return rows;
    };

    const openConfigDiffPreviewModal = (options) => {
        const opts = options || {};
        const rows = Array.isArray(opts.rows) ? opts.rows : [];
        const title = String(opts.title || "Settings Changes");
        const summary = String(opts.summary || `Changes: ${rows.length}`);
        const details = String(opts.details || "");
        const applyText = String(opts.applyText || "Confirm");
        const cancelText = String(opts.cancelText || "Cancel");

        const rootPanel = $.GetContextPanel?.();
        if (!isAlive(rootPanel)) return;

        prepareSettingsModalOpen();

        const existing = rootPanel.FindChildTraverse("ConfigDiffPreviewModalOverlay");
        if (isAlive(existing)) closeModal(existing);

        const overlay = $.CreatePanel("Panel", rootPanel, "ConfigDiffPreviewModalOverlay");
        if (!overlay) return;

        overlay.AddClass("ModalOverlay");
        overlay.AddClass("QOLModalOverlay");
        overlay.SetPanelEvent("onactivate", () => closeModal(overlay));

        const modalContainer = $.CreatePanel("Panel", overlay, "ConfigDiffModalContainer");
        if (!modalContainer) return;

        modalContainer.AddClass("QOLUnifiedModalSurface");
        modalContainer.AddClass("MetroModalContainer");
        modalContainer.AddClass("ConfigDiffModalContainer");
        modalContainer.SetPanelEvent("onactivate", () => {});
        modalContainer.SetPanelEvent("oncancel", () => {
            if (typeof $.ForceCloseModSettings === "function") {
                $.ForceCloseModSettings();
            }
        });
        overlay.SetPanelEvent("oncancel", () => {
            if (typeof $.ForceCloseModSettings === "function") {
                $.ForceCloseModSettings();
            }
        });

        if (typeof $.Schedule === "function") {
            $.Schedule(0.01, () => {
                if (isAlive(overlay)) {
                    overlay.AddClass("Show");
                    if (isAlive(modalContainer)) {
                        modalContainer.SetFocus();
                    }
                }
            });
        }

        const titleRow = $.CreatePanel("Panel", modalContainer, "");
        if (titleRow) {
            titleRow.AddClass("ConfigDiffTitleRow");

            const header = $.CreatePanel("Label", titleRow, "");
            if (header) {
                header.AddClass("ModalTitle");
                header.AddClass("ConfigDiffTitle");
                header.text = title;
            }

            const titleSpacer = $.CreatePanel("Panel", titleRow, "");
            if (titleSpacer) titleSpacer.AddClass("ConfigDiffTitleSpacer");

            const closeBtn = $.CreatePanel("Button", titleRow, "ConfigDiffCloseBtn");
            if (closeBtn) {
                closeBtn.AddClass("QOLUnifiedModalClose");
                closeBtn.AddClass("ConfigDiffCloseBtn");
                const closeIcon = $.CreatePanel("Label", closeBtn, "");
                if (closeIcon) closeIcon.text = "X";
                closeBtn.SetPanelEvent("onactivate", () => closeModal(overlay));
            }
        }

        if (details.length > 0) {
            const detailsLabel = $.CreatePanel("Label", modalContainer, "");
            if (detailsLabel) {
                detailsLabel.AddClass("ModalInstructions");
                detailsLabel.AddClass("ConfigDiffDetails");
                detailsLabel.text = details;
            }
        }

        const apply = () => {
            if (typeof opts.onApply === "function" && opts.onApply() === false) return false;
            closeModal(overlay);
            return true;
        };
        if (opts.previewConfig) {
            const previewBtn = $.CreatePanel("Button", modalContainer, "ConfigDiffPreviewBtn");
            previewBtn.AddClass("ConfigDiffPreviewBtn");
            previewBtn.AddClass("QOLUnifiedModalPrimary");
            const caption = $.CreatePanel("Label", previewBtn, "");
            caption.text = localize("Preview preset", true);
            const hint = $.CreatePanel("Label", modalContainer, "ConfigDiffPreviewHint");
            hint.AddClass("ConfigDiffPreviewHint");
            hint.text = localize("Preview on your HUD without saving changes.", true);
            previewBtn.SetPanelEvent("onactivate", () => {
                if (!Q.ui.presetPreview.start({ modal: overlay, config: opts.previewConfig, name: opts.previewName || "", onApply: apply })) {
                    hint.text = localize("Live preview is available in a match or sandbox. Close other visual tools and try again.", true);
                }
            });
        }

        const list = $.CreatePanel("Panel", modalContainer, "ConfigDiffList");
        if (list) {
            list.AddClass("ConfigDiffList");

            if (rows.length <= 0) {
                const empty = $.CreatePanel("Label", list, "");
                if (empty) {
                    empty.AddClass("ConfigDiffEmpty");
                    empty.text = localize("No setting changes detected.", true);
                }
            } else {
                const createDiffCell = (parentPanel, rowData, rowIndex) => {
                    const cellPanel = $.CreatePanel("Panel", parentPanel, "");
                    if (!cellPanel) return;
                    cellPanel.AddClass("ConfigDiffCell");
                    cellPanel.AddClass((rowIndex % 2) === 0 ? "Even" : "Odd");

                    const lineRow = $.CreatePanel("Panel", cellPanel, "");
                    if (lineRow) {
                        lineRow.AddClass("ConfigDiffCellLine");

                        const titleLabel = $.CreatePanel("Label", lineRow, "");
                        if (titleLabel) {
                            titleLabel.AddClass("ConfigDiffCellTitle");
                            const categoryText = String(rowData.categoryLabel || "");
                            const settingText = String(rowData.keyLabel || rowData.key || "");
                            titleLabel.text = categoryText ? `${categoryText}: ${settingText}` : settingText;
                        }

                        const valueWrap = $.CreatePanel("Panel", lineRow, "");
                        if (valueWrap) {
                            valueWrap.AddClass("ConfigDiffValueWrap");

                            const beforeLabel = $.CreatePanel("Label", valueWrap, "");
                            if (beforeLabel) {
                                beforeLabel.AddClass("ConfigDiffCellBefore");
                                beforeLabel.text = rowData.beforeText || "";
                            }

                            const arrow = $.CreatePanel("Label", valueWrap, "");
                            if (arrow) {
                                arrow.AddClass("ConfigDiffCellArrow");
                                arrow.text = "\u2192";
                            }

                            const afterLabel = $.CreatePanel("Label", valueWrap, "");
                            if (afterLabel) {
                                afterLabel.AddClass("ConfigDiffCellAfter");
                                afterLabel.text = rowData.afterText || "";
                            }
                        }
                    }
                };

                for (let i = 0; i < rows.length; i += 2) {
                    const gridRow = $.CreatePanel("Panel", list, "");
                    if (gridRow) {
                        gridRow.AddClass("ConfigDiffGridRow");
                        createDiffCell(gridRow, rows[i], i);
                        if (i + 1 < rows.length) {
                            createDiffCell(gridRow, rows[i + 1], i + 1);
                        } else {
                            const filler = $.CreatePanel("Panel", gridRow, "");
                            if (filler) filler.AddClass("ConfigDiffCellFiller");
                        }
                    }
                }
            }
        }

        const btnRow = $.CreatePanel("Panel", modalContainer, "ConfigDiffModalBtnRow");
        if (btnRow) {
            btnRow.AddClass("ModalBtnRow");
            btnRow.AddClass("ConfigDiffModalBtnRow");

            const summaryLabel = $.CreatePanel("Label", btnRow, "");
            if (summaryLabel) {
                summaryLabel.AddClass("ConfigDiffSummaryFooter");
                summaryLabel.text = summary;
            }

            const btnSpacer = $.CreatePanel("Panel", btnRow, "");
            if (btnSpacer) btnSpacer.AddClass("ConfigDiffBtnSpacer");

            const cancelBtn = $.CreatePanel("Button", btnRow, "");
            if (cancelBtn) {
                cancelBtn.AddClass("QOLUnifiedModalSecondary");
                cancelBtn.AddClass("ModalBtnClose");
                cancelBtn.AddClass("ConfigDiffCancelBtn");
                const cancelLbl = $.CreatePanel("Label", cancelBtn, "");
                if (cancelLbl) cancelLbl.text = cancelText;
                cancelBtn.SetPanelEvent("onactivate", () => closeModal(overlay));
            }

            const applyBtn = $.CreatePanel("Button", btnRow, "");
            if (applyBtn) {
                applyBtn.AddClass("QOLUnifiedModalPrimary");
                applyBtn.AddClass("ModalBtnApply");
                applyBtn.AddClass("ConfigDiffApplyBtn");
                const applyLbl = $.CreatePanel("Label", applyBtn, "");
                if (applyLbl) applyLbl.text = applyText;
                applyBtn.SetPanelEvent("onactivate", () => {
                    try { apply(); }
                    catch (error) { $.Msg("[QOLLock] Preset Apply: " + (error.message || error)); }
                });
            }
        }
    };

    const tryApplyImportStringWithDiagnostics = (raw) => {
        const result = {
            ok: false,
            source: "settings",
            schemaVersion: "",
            parsedConfig: null,
            candidateConfig: null,
            appliedKeys: 0,
            unknownKeys: 0,
            clampedKeys: 0,
        };
        if (!raw) return result;
        const trimmed = String(raw).trim();
        if (trimmed.length === 0) return result;

        const normalized = trimmed.replace(/\s+/g, "");
        const tokenMatch = normalized.match(EXPORT_TOKEN_REGEX);
        if (!tokenMatch) return result;

        const schemaSemver = String(tokenMatch[1] || "").replace(/-/g, ".");
        if (!schemaSemver) {
            return result;
        }

        const isSettingsCode = !!tokenMatch[2];
        const encodedPayload = String(tokenMatch[3] || "");
        if (!encodedPayload) return result;

        try {
            const payload = Q.persistence.fromBase64Url(encodedPayload);
            if (isSettingsCode && (!Q.settingsCode?.isPayload(payload) ||
                !/^\[QOL-[0-9]+-[0-9]+-[0-9]+-C\]:[A-Za-z0-9_-]+$/i.test(normalized) ||
                Q.persistence.toBase64Url(payload) !== encodedPayload)) return result;
            if (!isSettingsCode && Q.settingsCode?.isPayload(payload)) return result;
            result.parsedConfig = Q.persistence.deserializeSettings(payload, schemaSemver);
            result.source = payload.charAt(0) === "{" ? "json" : Q.settingsCode?.isPayload(payload) ? "settingsCode" : "legacyCompact";
            result.schemaVersion = isSettingsCode ? globalThis.QOL_SCHEMA_SEMVER : schemaSemver;
        } catch (error) {
            result.requiresUpdate = error.code === "unsupported-settings-code";
            return result;
        }

        try {
            const defConfig = globalThis.DEFAULT_CONFIG || globalThis.QOL_DEFAULT_CONFIG || {};
            const preview = buildCandidateConfigFromParsed(
                result.parsedConfig,
                result.schemaVersion || globalThis.QOL_SCHEMA_SEMVER,
                defConfig
            );
            preserveUiOnlySettings(preview.candidateConfig);
            result.candidateConfig = preview.candidateConfig;
            result.appliedKeys = preview.diagnostics.appliedKeys;
            result.unknownKeys = preview.diagnostics.unknownKeys;
            result.clampedKeys = preview.diagnostics.clampedKeys;
            result.ok = true;
        } catch {
            return result;
        }
        return result;
    };

    const openAvailableModal = () => {
        if (typeof globalThis.SetActiveTabAndRefresh === "function") {
            globalThis.SetActiveTabAndRefresh("Support");
        } else if (typeof Q.ui.window?.setActiveTab === "function") {
            Q.ui.window.setActiveTab("Support");
        }
    };

    // Export API on Q.ui.modal
    Q.ui.modal = {
        prepareSettingsModalOpen,
        closeModal,
        closeConfigDiffPreviewModalIfOpen,
        closeSettingsSideModalsIfOpen,
        cloneConfigSnapshot,
        preserveUiOnlySettings,
        buildCandidateConfigFromParsed,
        formatConfigKeyForDiff,
        formatConfigValueForDiff,
        buildConfigDiffRows,
        openConfigDiffPreviewModal,
        tryApplyImportStringWithDiagnostics,
        openAvailableModal,
    };

    // Backward compatibility globals
    globalThis.PrepareSettingsModalOpen = prepareSettingsModalOpen;
    globalThis.CloseModal = closeModal;
    globalThis.CloseConfigDiffPreviewModalIfOpen = closeConfigDiffPreviewModalIfOpen;
    globalThis.CloseSettingsSideModalsIfOpen = closeSettingsSideModalsIfOpen;
    globalThis.CloneConfigSnapshot = cloneConfigSnapshot;
    globalThis.PreserveUiOnlySettings = preserveUiOnlySettings;
    globalThis.BuildCandidateConfigFromParsed = buildCandidateConfigFromParsed;
    globalThis.FormatConfigKeyForDiff = formatConfigKeyForDiff;
    globalThis.FormatConfigValueForDiff = formatConfigValueForDiff;
    globalThis.BuildConfigDiffRows = buildConfigDiffRows;
    globalThis.OpenConfigDiffPreviewModal = openConfigDiffPreviewModal;
    globalThis.TryApplyImportStringWithDiagnostics = tryApplyImportStringWithDiagnostics;
    globalThis.OpenAvailableModal = openAvailableModal;
})();
