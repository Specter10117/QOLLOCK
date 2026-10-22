// OWNS: Ammo digits/geometry/color, native arc masks and magazine container rotation.
// Native ring/bullet transforms are engine-owned and must remain intact.
// DOES NOT OWN: Reload cooldown, crosshair stats or native weapon/ammo state.
// Sources: hud.xml, element_gun.xml, element_tokamak_custom_semi_circles.xml/css and debugger gun ancestry.
(() => {
    "use strict";
    QOL.core.FeatureRegistry.register({
        id: "ql_ammo",
        enabledByDefault: false,
        enableKeys: ["ENABLE_AMMO_STATUS", "ENABLE_HIDE_MAGAZINE", "ENABLE_HIDE_AMMO_ALL"],
        isEnabled(cfg) {
            if (!cfg) return false;
            if (QOL.presentation.hasStateHiding("ammo", cfg)) return true;
            const isTrue = value => value === true || value === 1 || String(value) === "true";
            if (isTrue(cfg.ENABLE_AMMO_STATUS) || isTrue(cfg.ENABLE_HIDE_MAGAZINE) || isTrue(cfg.ENABLE_HIDE_AMMO_ALL)) return true;
            for (const key of ["AMMO_CURRENT_SCALE", "AMMO_TOTAL_SCALE", "AMMO_PANEL_SCALE", "AMMO_HUD_SCALE"]) {
                if (cfg[key] != null && Number(cfg[key]) !== 100) return true;
            }
            for (const key of ["AMMO_PANEL_X_OFFSET", "AMMO_PANEL_Y_OFFSET", "AMMO_CURRENT_X_OFFSET", "AMMO_CURRENT_Y_OFFSET",
                "AMMO_MAX_X_OFFSET", "AMMO_MAX_Y_OFFSET", "AMMO_CLIP_ANGLE", "AMMO_TEXT_COLOR"]) {
                if (cfg[key] != null && Number(cfg[key]) !== 0) return true;
            }
            return false;
        },
        settings: [
            ...QOL.presentation.stateSettings("ql_ammo"),
            { key: "ENABLE_AMMO_STATUS", type: "toggle" },
            { key: "ENABLE_HIDE_MAGAZINE", type: "toggle" },
            { key: "ENABLE_HIDE_AMMO_ALL", type: "toggle" },
            { key: "AMMO_PANEL_SCALE", type: "slider" },
            { key: "AMMO_HUD_SCALE", type: "slider" },
            { key: "AMMO_CURRENT_SCALE", type: "slider" },
            { key: "AMMO_TOTAL_SCALE", type: "slider" },
            { key: "AMMO_PANEL_X_OFFSET", type: "slider" },
            { key: "AMMO_PANEL_Y_OFFSET", type: "slider" },
            { key: "AMMO_CURRENT_X_OFFSET", type: "slider" },
            { key: "AMMO_CURRENT_Y_OFFSET", type: "slider" },
            { key: "AMMO_MAX_X_OFFSET", type: "slider" },
            { key: "AMMO_MAX_Y_OFFSET", type: "slider" },
            { key: "AMMO_CLIP_ANGLE", type: "slider" },
            { key: "AMMO_TEXT_COLOR", type: "palette" }
        ],
        create(ctx) {
            const panelAPI = QOL.core.panel;
            const gunPath = [{ id: "Hud", optional: true }, { className: "HudCore" },
                "gameplay_hud", "gameplay_hud_alive", "crosshair", "gun", "gun_data"];
            const ammoResolver = QOL.panelCache.createIdResolver("ammo_panel", { retryMs: 500, ownerPath: gunPath });
            const clipResolver = QOL.panelCache.createIdResolver("clip_status", { retryMs: 500, ownerPath: gunPath });
            const geometry = panelAPI.createNativeStyleOwner({ resetValues: { x: "0px", y: "0px" }, releasePosition: true });
            // Digits participate in native flow layout. Treat their code
            // position as one CSS property, including a complete neutral write
            // on retirement; clearing x/y aliases can leave their layout moved.
            // Neutralize the resolved font before releasing its code property.
            // The standard and Tokamak native layouts use different baselines.
            const textStyles = new Map([16, 18].map(fontSize => [fontSize,
                panelAPI.createNativeStyleOwner({ resetValues: { position: "0px 0px 0px", fontSize: fontSize + "px" } })]));
            const clipStyles = new Map([0, 90, 180].map(baseline => [baseline,
                panelAPI.createNativeStyleOwner({ resetValues: { transform: "rotateZ(" + baseline + "deg)" } })]));
            const visualStyles = panelAPI.createNativeStyleOwner();
            let panel = null;
            let model = null;
            let loop = null;
            let active = false;
            // Above this density use the existing continuous native arc. Only
            // capacity selects a mask; C++ still owns every shot/reload update.
            const maxTickCount = 40;

            function renderVisuals(sources) {
                const standard = model.visualEnabled && sources.size === 1 && panelAPI.isAlive(panel);
                let mask = "";
                if (standard) {
                    const maximumLabel = QOL.utils.FindPanelsByClass(panel, "weapon_ammo_max")[0];
                    const maximum = Number(String(maximumLabel?.text ?? "").match(/\d+/)?.[0]);
                    if (Number.isInteger(maximum) && maximum >= 1 && maximum <= maxTickCount) {
                        mask = 'url("s2r://panorama/images/custom/ammo_ticks/' + maximum + '.vsvg")';
                    }
                }
                const retained = [];
                for (const clip of sources.keys()) {
                    visualStyles.apply(clip, {}, { "qol-ammo-native-arc": standard });
                    retained.push(clip);
                    for (const id of ["clip_progress_bar", "clip_bg_progress_bar", "clip_bonus_progress_bar"]) {
                        const target = panelAPI.findChild(clip, id);
                        if (!target) continue;
                        const styles = standard && mask ? { opacityMask: mask } : {};
                        if (standard && id === "clip_progress_bar" && model.currentStyles.color) styles.borderColor = model.currentStyles.color;
                        visualStyles.apply(target, styles);
                        retained.push(target);
                    }
                }
                visualStyles.retain(retained);
            }

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const number = key => QOL.settings.readNumber(key, cfg[key]);
                const current = QOL.settings.readNumber("AMMO_CURRENT_SCALE", cfg.AMMO_CURRENT_SCALE ?? cfg.AMMO_PANEL_SCALE);
                const total = QOL.settings.readNumber("AMMO_TOTAL_SCALE", cfg.AMMO_TOTAL_SCALE ?? cfg.AMMO_PANEL_SCALE);
                const color = panelAPI.resolvePaletteColor(cfg.AMMO_TEXT_COLOR);
                const currentStyles = { fontSize: null, width: null, color: color || null };
                const totalStyles = { fontSize: null, width: null, marginLeft: null, color: color || null };
                const infiniteStyles = { color: color || null };
                if (current !== 100) {
                    currentStyles.fontSize = Math.max(8, Math.round(16 * current / 100)) + "px";
                    currentStyles.width = Math.max(16, Math.round(32 * current / 100)) + "px";
                }
                if (total !== 100) {
                    totalStyles.fontSize = Math.max(8, Math.round(16 * total / 100)) + "px";
                    totalStyles.width = Math.max(25, Math.round(50 * total / 100)) + "px";
                    totalStyles.marginLeft = Math.max(0, Math.round(2 * total / 100)) + "px";
                }
                const groupScale = number("AMMO_HUD_SCALE");
                const xOffset = number("AMMO_PANEL_X_OFFSET");
                const yOffset = number("AMMO_PANEL_Y_OFFSET");
                const textPosition = prefix => {
                    const x = number(prefix + "X_OFFSET");
                    const y = number(prefix + "Y_OFFSET");
                    return x || y ? { position: x + "px " + -y + "px 0px" } : {};
                };
                return { visualEnabled: Number(cfg.ENABLE_AMMO_STATUS) === 1, angle: number("AMMO_CLIP_ANGLE"), current, total, currentStyles, totalStyles, infiniteStyles,
                    currentPosition: textPosition("AMMO_CURRENT_"), maxPosition: textPosition("AMMO_MAX_"),
                    clipStyles: {
                        ...(groupScale !== 100 ? { uiScale: groupScale + "%" } : {}),
                        ...(xOffset ? { x: xOffset + "px" } : {}),
                        ...(yOffset ? { y: -yOffset + "px" } : {})
                    },
                    panelStyles: {
                        ...(xOffset ? { marginLeft: xOffset + "px" } : {}),
                        ...(yOffset ? { marginTop: -yOffset + "px" } : {}),
                        ...(groupScale !== 100 ? { uiScale: groupScale + "%" } : {})
                    }
                };
            }

            function releaseMain() {
                for (const owner of textStyles.values()) owner.clear();
                if (panelAPI.isAlive(panel)) panelAPI.setClass(panel, "qol-hidden", false);
            }

            function discoverTexts() {
                const sources = new Map();
                const fontSize = panelAPI.findChild(panel.GetParent(), "clip_status_mirrored") ? 18 : 16;
                for (const [className, plan, position, scale] of [["weapon_ammo", model.currentStyles, model.currentPosition, model.current],
                    ["weapon_ammo_max", model.totalStyles, model.maxPosition, model.total], ["weapon_ammo_infinite", model.infiniteStyles, {}, 100]]) {
                    const styles = { ...plan };
                    if (fontSize === 18) {
                        if (scale !== 100) styles.fontSize = Math.max(8, Math.round(fontSize * scale / 100)) + "px";
                        // Tokamak's digits have native content widths and no gap.
                        delete styles.width;
                        delete styles.marginLeft;
                    }
                    for (const target of QOL.utils.FindPanelsByClass(panel, className)) {
                        // Keep native multi-class precedence: a later role may
                        // replace shared properties, without dropping earlier ones.
                        sources.set(target, { styles: Object.assign({}, sources.get(target)?.styles, styles), position, fontSize });
                    }
                }
                return sources;
            }

            function renderTexts(sources) {
                const retained = new Map([...textStyles.keys()].map(fontSize => [fontSize, []]));
                for (const [target, { styles: plan, position, fontSize }] of sources) {
                    const styles = Object.fromEntries(Object.entries(plan).filter(([, value]) => value !== null));
                    textStyles.get(fontSize).apply(target, Object.assign(styles, position));
                    retained.get(fontSize).push(target);
                }
                for (const [fontSize, owner] of textStyles) owner.retain(retained.get(fontSize));
            }

            function discoverClips(root) {
                const sources = new Map();
                // The live ammo owner wins over duplicate IDs in retained templates.
                const owner = panelAPI.isAlive(panel) ? panel.GetParent() : null;
                const clip = panelAPI.findChild(owner, "clip_status") || panelAPI.findTraverse(owner, "clip_status") || clipResolver.resolve(root);
                if (!clip) return sources;
                let parent = null;
                try { parent = clip.GetParent(); } catch (_) { /* stale native owner */ }
                const mirrored = panelAPI.findChild(parent, "clip_status_mirrored") || panelAPI.findTraverse(parent, "clip_status_mirrored");
                if (mirrored) {
                    // Tokamak's centered heat halves start at 90 and 180 degrees.
                    sources.set(clip, { angle: 90 - model.angle, baseline: 90 });
                    sources.set(mirrored, { angle: 180 - model.angle, baseline: 180 });
                } else {
                    sources.set(clip, { angle: -model.angle, baseline: 0 });
                }
                return sources;
            }

            function renderClips(sources, root) {
                const retained = new Map([...clipStyles.keys()].map(baseline => [baseline, []]));
                for (const [target, source] of sources) {
                    geometry.apply(target, QOL.presentation.visibilityStyles("ammo", QOL.presentation.visibilityConfig(ctx), root, model.clipStyles));
                    clipStyles.get(source.baseline).apply(target,
                        model.angle ? { transform: "rotateZ(" + source.angle + "deg)" } : {},
                        { "qol-ammo-visual-enabled": model.visualEnabled, "qol-ammo-visual-disabled": !model.visualEnabled });
                    retained.get(source.baseline).push(target);
                }
                for (const [baseline, owner] of clipStyles) owner.retain(retained.get(baseline));
            }

            function update() {
                if (!active) return;
                const candidate = panelAPI.findHud($.GetContextPanel());
                const root = panelAPI.isAlive(candidate) && (candidate.id === "Hud" || candidate.paneltype === "CitadelHud") ? candidate : null;
                const current = ammoResolver.resolve(root);
                if (current !== panel) {
                    releaseMain();
                    panel = current;
                }
                const clipSources = discoverClips(root);
                renderClips(clipSources, root);
                renderVisuals(clipSources);
                const textSources = panel ? discoverTexts() : new Map();
                renderTexts(textSources);
                geometry.retain([panel, ...clipSources.keys()]);
                if (!panel) return;
                panelAPI.setClass(panel, "qol-hidden", false);
                geometry.apply(panel, QOL.presentation.visibilityStyles("ammo", QOL.presentation.visibilityConfig(ctx), root, model.panelStyles));
            }

            function refreshSettings() {
                if (!active) return;
                model = readModel();
                ammoResolver.reset();
                clipResolver.reset();
                update();
                QOL.core.hud.refreshRootClasses(panelAPI.findHud($.GetContextPanel()));
            }

            return QOL.presentation.bindVisibility(ctx, {
                onEnable() {
                    active = true;
                    refreshSettings();
                    loop = QOL.core.Scheduler.createPollLoop(update, 0.5, ctx.id);
                },
                onSettingsChanged: refreshSettings,
                onDisable() {
                    active = false;
                    if (loop) { loop.stop(); loop = null; }
                    QOL.core.Scheduler.cancelAllForFeature(ctx.id);
                    releaseMain();
                    visualStyles.clear();
                    for (const owner of clipStyles.values()) owner.clear();
                    geometry.clear();
                    panel = model = null;
                    ammoResolver.reset();
                    clipResolver.reset();
                }
            }, update);
        },
        test() {
            try {
                const root = $.GetContextPanel();
                const panel = QOL.core.panel.findTraverse(root, "ammo_panel") || QOL.core.panel.findTraverse(root, "clip_status");
                if (!panel) return null;
                return { passed: true, name: "Ammo panel exists", message: "", assertions: [{ passed: true, name: "ammo_panel or clip_status exists" }] };
            } catch (e) { return { passed: false, name: "Ammo panel check", message: (e && e.message ? e.message : String(e)) }; }
        }
    });
})();
