// OWNS: Unsecured amount/icon/text mirror and component-size presentation.
// DOES NOT OWN: Native soul labels, their feedback classes or decay tracking.
// Offsets retain their established convention: X right, Y down from the saved native baseline.
// Native hud.xml places StatsAndModsContainer and gameplay_hud under HudCore.
(() => {
    "use strict";
    QOL.core.FeatureRegistry.register({
        id: "ql_better_unsecured_hud",
        enableKey: "ENABLE_BETTER_UNSECURED",
        enabledByDefault: false,
        settings: [
            ...QOL.presentation.stateSettings("ql_better_unsecured_hud"),
            { key: "ENABLE_BETTER_UNSECURED", type: "toggle" },
            { key: "UNSECURED_SOULS_HUD_SCALE", type: "slider" },
            { key: "UNSECURED_SOULS_HUD_X_OFFSET", type: "slider" },
            { key: "UNSECURED_SOULS_HUD_Y_OFFSET", type: "slider" },
            { key: "ENABLE_BETTER_UNSECURED_SHOW_ICON", type: "toggle" },
            { key: "ENABLE_BETTER_UNSECURED_SHOW_TEXT", type: "toggle" },
            { key: "ENABLE_BETTER_UNSECURED_SHOW_ICON_TEXT", type: "toggle" }
        ],
        create(ctx) {
            const P = QOL.core.panel;
            const tree = P.createOwnedTree();
            const presentation = P.createNativeStyleOwner();
            let running = false, loop = null, rootOwner = null, model = null, overlay = null;
            let mirror = null, icon = null, text = null;

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const scale = QOL.settings.readNumber("UNSECURED_SOULS_HUD_SCALE", cfg.UNSECURED_SOULS_HUD_SCALE);
                const x = Number(cfg.UNSECURED_SOULS_HUD_X_OFFSET);
                const y = Number(cfg.UNSECURED_SOULS_HUD_Y_OFFSET);
                const both = Number(cfg.ENABLE_BETTER_UNSECURED_SHOW_ICON_TEXT) === 1;
                return {
                    enabled: Number(cfg.ENABLE_BETTER_UNSECURED) === 1,
                    showIcon: both || Number(cfg.ENABLE_BETTER_UNSECURED_SHOW_ICON) === 1,
                    showText: both || Number(cfg.ENABLE_BETTER_UNSECURED_SHOW_TEXT) === 1,
                    fontSize: Math.max(1, Math.round(14 * scale / 100)) + "px",
                    styles: {
                        marginLeft: "115px", marginBottom: "130px",
                        x: Math.round(x - QOL_DEFAULT_CONFIG.UNSECURED_SOULS_HUD_X_OFFSET) + "px",
                        y: Math.round(y - QOL_DEFAULT_CONFIG.UNSECURED_SOULS_HUD_Y_OFFSET) + "px"
                    }
                };
            }

            function parseSouls(valueText) {
                const raw = String(valueText || "").replace(/,/g, "").trim().toLowerCase();
                const suffix = raw.slice(-1);
                const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : suffix === "b" ? 1000000000 : 1;
                const number = parseFloat(raw) * multiplier;
                return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
            }

            function release(resetRoot = true) {
                presentation.clear();
                tree.clear();
                overlay = null; mirror = null; icon = null; text = null;
                if (resetRoot) rootOwner = null;
            }

            function ensureOverlay(parent) {
                tree.sweep();
                if (!P.isAlive(parent)) { release(false); return false; }
                if (!P.isAlive(overlay) || overlay.GetParent() !== parent) {
                    release(false);
                }
                overlay = tree.child(parent, "Panel", "QOLBetterUnsecuredOverlay");
                if (!P.isAlive(overlay)) return false;
                icon = tree.child(overlay, "Panel", "QOLBetterUnsecuredMirrorIcon");
                mirror = tree.child(overlay, "Label", "QOLBetterUnsecuredMirrorLabel");
                text = tree.child(overlay, "Label", "QOLBetterUnsecuredMirrorText");
                for (const child of [icon, mirror, text]) {
                    if (!P.isAlive(child)) return false;
                }
                P.setClass(mirror, "death_penalty_gold", true);
                return true;
            }

            function update() {
                if (!running) return;
                const root = P.findHud($.GetContextPanel());
                if (!P.isAlive(root) || (root.id !== "Hud" && root.paneltype !== "CitadelHud") || !model.enabled) { release(); return; }
                if (rootOwner !== root) { release(); rootOwner = root; }
                const preview = QOL.presentation.preview.selected(root, "unsecuredSouls");
                const core = P.findChildByClass(root, "HudCore");
                const stats = P.findChild(core, "StatsAndModsContainer");
                const gold = P.findChild(P.findChild(stats, "LowerLeft"), "gold_and_ap_container");
                const body = P.findChild(gold, "hudGoldContainer");
                const container = P.findChildByClass(body, "hudDeathGoldContainer");
                if (!container && !preview) { release(false); return; }
                const source = P.findChild(container, "hudDeathGoldLabel");
                if (!ensureOverlay(stats || P.findChild(core, "gameplay_hud"))) return;
                const sourceText = P.hasClassToken(source, "death_penalty_gold") && typeof source.text === "string" ? source.text : "";
                const hasAmount = parseSouls(sourceText) > 0;
                const shown = hasAmount || preview;
                P.setClass(overlay, "qol-hidden", !shown);
                if (!shown) return;
                presentation.apply(overlay, QOL.presentation.visibilityStyles("unsecuredSouls", QOL.presentation.visibilityConfig(ctx), root, model.styles));
                P.setClass(icon, "qol-hidden", !model.showIcon);
                P.setClass(text, "qol-hidden", !model.showText);
                P.setClass(mirror, "qol-hidden", false);
                const nativeText = P.findChild(container, "hudUnsecuredLabel");
                const caption = nativeText && typeof nativeText.text === "string" && nativeText.text ? nativeText.text : "UNSECURED";
                if (text.text !== caption) text.text = caption;
                // The selected editor sample belongs only to this mirror; the
                // game-owned amount, feedback classes and decay state stay native.
                const amountText = hasAmount ? sourceText : "100";
                if (mirror.text !== amountText) mirror.text = amountText;
                QOL.utils.SetStyleIfChanged(mirror, "fontSize", model.fontSize);
            }

            function refreshSettings() {
                model = readModel();
                update();
            }

            return QOL.presentation.bindVisibility(ctx, {
                onEnable() {
                    running = true;
                    refreshSettings();
                    loop = QOL.core.Scheduler.createPollLoop(update, 0.2, ctx.id);
                },
                onSettingsChanged: refreshSettings,
                onDisable() {
                    running = false;
                    if (loop) { loop.stop(); loop = null; }
                    release();
                    model = null;
                    tree.dispose();
                }
            }, update);
        },
        test() {
            try {
                const gp = QOL.core.panel.findTraverse($.GetContextPanel(), "gameplay_hud");
                if (!gp) return null;
                return { passed: true, name: "Gameplay HUD exists for unsecured overlay", message: "",
                    assertions: [{ passed: true, name: "gameplay_hud panel exists" }] };
            } catch (e) {
                return { passed: false, name: "Better unsecured HUD check", message: e.message || String(e) };
            }
        }
    });
})();
