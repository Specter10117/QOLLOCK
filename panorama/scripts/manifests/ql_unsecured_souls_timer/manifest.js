// OWNS: Native-rule unsecured-souls conversion forecast and overlay labels.
// DOES NOT OWN: Native soul conversion, native amount labels or Better Unsecured state.
// Source: hud.xml and hud_gold_and_ap_container.xml, confirmed in Panorama Debugger.
// This timer intentionally stays active in hideout and hero testing.
// Overlay parent: native hud.xml HudCore > gameplay_hud.
(() => {
    "use strict";
    const P = QOL.core.panel;
    const SOURCE_PATH = ["StatsAndModsContainer", "LowerLeft", "gold_and_ap_container", "hudGoldContainer"];

    function parseSouls(text) {
        const raw = String(text || "").replace(/[\s,]/g, "").toLowerCase();
        const match = raw.match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
        if (!match) return null;
        const suffix = match[2];
        const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : suffix === "b" ? 1000000000 : 1;
        const value = Number(match[1]) * multiplier;
        return Number.isFinite(value) ? Math.round(value) : null;
    }

    function conversionSeconds(souls, gameSeconds) {
        // GameTracking 17462b250a0ca80e7f80102f2c83cc3eecff5f12,
        // DumpSource2/convars.txt: citadel_secure_gold_{percent,fixed,
        // fixed_growth,rate}. Valve's 12-16-2025 notes describe the same rule.
        // Forecast each 1s conversion, including the shrinking balance and
        // growing match-time term. Recomputed only when the balance changes.
        let remaining = souls;
        for (let seconds = 0; seconds < 999; seconds++) {
            const rate = remaining * 0.005 + 1.6 * (1 + (gameSeconds + seconds) / 60 * 0.08);
            if (remaining <= rate) return seconds + remaining / rate;
            remaining -= rate;
        }
        return 999;
    }

    function directClass(parent, name) {
        return P.isAlive(parent) ? parent.Children().find(panel => P.hasClassToken(panel, name)) || null : null;
    }

    function findSource(core) {
        let owner = core;
        for (const id of SOURCE_PATH) {
            owner = P.findChild(owner, id);
            if (!owner) return null;
        }
        return P.findChild(directClass(owner, "hudDeathGoldContainer"), "hudDeathGoldLabel");
    }

    function dangerLevel(source, souls) {
        let current = source;
        for (let depth = 0; depth < 64 && P.isAlive(current); depth++, current = current.GetParent()) {
            for (let level = 4; level > 0; level--) {
                if (current.BHasClass("death_penalty_gold_danger_level_" + level)) return level;
            }
        }
        return souls >= 1000 ? 3 : souls >= 400 ? 2 : souls > 0 ? 1 : 0;
    }

    QOL.core.FeatureRegistry.register({
        id: "ql_unsecured_souls_timer",
        enableKey: "ENABLE_UNSECURED_SOUL_TIMER",
        enabledByDefault: false,
        settings: [
            ...QOL.presentation.stateSettings("ql_unsecured_souls_timer"),
            { key: "ENABLE_UNSECURED_SOUL_TIMER", type: "toggle" },
            { key: "UNSECURED_SOUL_TIMER_X_OFFSET", type: "slider" },
            { key: "UNSECURED_SOUL_TIMER_Y_OFFSET", type: "slider" },
            { key: "UNSECURED_SOUL_TIMER_SCALE", type: "slider" }
        ],
        create(ctx) {
            const tree = P.createOwnedTree();
            const presentation = P.createNativeStyleOwner();
            let running = false, loop = null, rootOwner = null, model = null, overlay = null, stateLabel = null;
            let source = null;
            let lastSouls = -1, lastGameSeconds = 0, etaEndMs = 0;

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const scale = QOL.settings.readNumber("UNSECURED_SOUL_TIMER_SCALE", cfg.UNSECURED_SOUL_TIMER_SCALE);
                const x = Math.round(Number(cfg.UNSECURED_SOUL_TIMER_X_OFFSET)) || 0;
                const y = Math.round(Number(cfg.UNSECURED_SOUL_TIMER_Y_OFFSET)) || 0;
                return { enabled: Number(cfg.ENABLE_UNSECURED_SOUL_TIMER) === 1,
                    // Saved offsets predate Customize and adjust the centered
                    // margin, whose horizontal movement is half its value.
                    styles: { marginLeft: (-520 + x) + "px", marginBottom: (110 + y) + "px" },
                    fontSize: Math.max(1, Math.round(16 * scale / 100)) + "px" };
            }

            function resetEstimate() {
                lastSouls = -1; lastGameSeconds = 0; etaEndMs = 0;
            }

            function release(resetSource = true) {
                presentation.clear();
                tree.clear();
                overlay = null; stateLabel = null;
                if (resetSource) {
                    source = null; rootOwner = null;
                    resetEstimate();
                }
            }

            function ensureOverlay(parent) {
                tree.sweep();
                if (!P.isAlive(parent)) { release(false); return false; }
                if (!P.isAlive(overlay) || overlay.GetParent() !== parent) {
                    release(false);
                }
                overlay = tree.child(parent, "Panel", "QOLUnsecuredSoulsOverlay");
                if (!P.isAlive(overlay)) return false;
                const icon = tree.child(overlay, "Panel", "QOLUnsecuredSoulsIcon");
                const text = tree.child(overlay, "Panel", "QOLUnsecuredSoulsTextContainer");
                const title = tree.child(text, "Label", "QOLUnsecuredSoulsLabel");
                if (P.isAlive(title) && title.text !== "Unsecured Souls") title.text = "Unsecured Souls";
                stateLabel = tree.child(text, "Label", "QOLUnsecuredSoulsState");
                return P.isAlive(icon) && P.isAlive(title) && P.isAlive(stateLabel);
            }

            function estimate(souls, unresolved, root, now) {
                if (unresolved || souls <= 0) { resetEstimate(); return unresolved ? "--" : ""; }
                const gameSeconds = QOL.core.time.readGameTime(root);
                const restart = souls > lastSouls || gameSeconds < lastGameSeconds || (lastGameSeconds === 0 && gameSeconds > 0);
                if (souls !== lastSouls || restart || etaEndMs === 0) {
                    const nextEndMs = now + conversionSeconds(souls, gameSeconds) * 1000;
                    // Native integer rounding cannot extend an existing forecast
                    // while souls decrease. Gains/source/clock changes rebase it.
                    etaEndMs = restart || etaEndMs === 0 ? nextEndMs : Math.min(etaEndMs, nextEndMs);
                    lastSouls = souls;
                }
                lastGameSeconds = gameSeconds;
                return Math.max(1, Math.ceil((etaEndMs - now) / 1000)) + "s";
            }

            function update() {
                if (!running) return;
                const root = P.findHud($.GetContextPanel());
                if (!P.isAlive(root) || (root.id !== "Hud" && root.paneltype !== "CitadelHud") || !model.enabled) { release(); return; }
                if (rootOwner !== root) { release(); rootOwner = root; }
                const core = directClass(root, "HudCore");
                if (!ensureOverlay(P.findChild(core, "gameplay_hud"))) return;
                P.setClass(overlay, "qol-hidden", false);
                presentation.apply(overlay, QOL.presentation.visibilityStyles("unsecuredTimer", QOL.presentation.visibilityConfig(ctx), root, model.styles));
                QOL.utils.SetStyleIfChanged(stateLabel, "fontSize", model.fontSize);
                const now = QOL.utils.PerfNowMs();
                const current = findSource(core);
                if (current !== source) { resetEstimate(); source = current; }
                const rawText = source && typeof source.text === "string" ? source.text : "";
                const parsed = parseSouls(rawText);
                const unresolved = parsed === null;
                const souls = unresolved ? 0 : parsed;
                const status = estimate(souls, unresolved, root, now);
                const danger = dangerLevel(source, souls);
                for (let level = 1; level <= 4; level++) P.setClass(overlay, "danger_" + level, danger === level);
                P.setClass(overlay, "has_souls", souls > 0);
                P.setClass(overlay, "is_safe", souls <= 0 && !unresolved);
                P.setClass(overlay, "is_syncing", unresolved);
                if (stateLabel.text !== status) stateLabel.text = status;
            }

            function refreshSettings() {
                model = readModel();
                update();
            }

            return QOL.presentation.bindVisibility(ctx, {
                onEnable() {
                    running = true;
                    model = readModel();
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
                const root = P.findHud($.GetContextPanel());
                const gp = P.findChild(directClass(root, "HudCore"), "gameplay_hud");
                if (!gp) return null;
                return { passed: true, name: "Unsecured souls anchor panel exists", message: "",
                    assertions: [{ passed: true, name: "gameplay_hud panel exists" }] };
            } catch (e) {
                return { passed: false, name: "Unsecured souls panel check", message: e.message || String(e) };
            }
        }
    });
})();
