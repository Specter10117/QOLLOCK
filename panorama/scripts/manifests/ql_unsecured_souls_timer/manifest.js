// OWNS: Estimated unsecured-souls countdown, private samples and overlay labels.
// DOES NOT OWN: Native soul conversion, native amount labels or Better Unsecured state.
// Sources and danger classes follow verified current/legacy native HUD contracts.
// This timer intentionally stays active in hideout and hero testing.
// Overlay parent: native hud.xml HudCore > gameplay_hud.
(() => {
    "use strict";
    const P = QOL.core.panel;
    const MIN_SAMPLE_MS = 250, STALE_RATE_MS = 12000, EMA_ALPHA = 0.35, SEARCH_MS = 1000;

    function parseSouls(text) {
        const value = Number(String(text || "").replace(/[^0-9.-]/g, ""));
        return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    }

    function fallbackEta(souls, gameMinutes) {
        const remaining = Math.max(0, Number(souls) || 0);
        const rate = remaining * 0.02 + 15 * (1 + Math.max(0, Number(gameMinutes) || 0) * 0.05);
        return remaining > 0 && rate > 0 ? remaining / rate : 0;
    }

    function findFallbackSource(root, gold) {
        const underGold = QOL.utils.FindFirstPanelByClass(gold, "death_penalty_gold");
        if (underGold) return underGold;
        for (const candidate of QOL.utils.FindPanelsByClass(root, "death_penalty_gold") || []) {
            if (QOL.utils.FindAncestorWithClass(candidate, "hudDeathGoldContainer")) return candidate;
        }
        return null;
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
            const parentResolver = QOL.panelCache.createIdResolver("gameplay_hud", {
                retryMs: SEARCH_MS, ownerPath: [{ id: "Hud", optional: true }, { className: "HudCore" }]
            });
            const modernResolver = QOL.panelCache.createIdResolver("HudUnsecuredLabel", { retryMs: SEARCH_MS });
            const goldResolver = QOL.panelCache.createIdResolver("gold_and_ap_container", {
                retryMs: SEARCH_MS,
                ownerPath: [{ id: "Hud", optional: true }, { className: "HudCore" }, "StatsAndModsContainer", "LowerLeft"]
            });
            const amountResolver = QOL.panelCache.createIdResolver("hudDeathGoldLabel", { retryMs: SEARCH_MS });
            const rootAmountResolver = QOL.panelCache.createIdResolver("hudDeathGoldLabel", { retryMs: SEARCH_MS });
            let running = false, loop = null, rootOwner = null, model = null, overlay = null, stateLabel = null;
            let source = null, fallbackSource = null, nextSourceSearchMs = 0;
            let nextModernSearchMs = 0;
            let lastSouls = -1, lastSampleMs = 0, rateEma = 0, rateUpdateMs = 0, etaEndMs = 0;

            function readModel() {
                const cfg = QOL.presentation.captureVisibility(ctx, ctx.config.view());
                const scale = QOL.settings.readNumber("UNSECURED_SOUL_TIMER_SCALE", cfg.UNSECURED_SOUL_TIMER_SCALE);
                const x = Math.round(Number(cfg.UNSECURED_SOUL_TIMER_X_OFFSET)) || 0;
                const y = Math.round(Number(cfg.UNSECURED_SOUL_TIMER_Y_OFFSET)) || 0;
                return { enabled: Number(cfg.ENABLE_UNSECURED_SOUL_TIMER) === 1,
                    styles: { x: x + "px", y: -y + "px" },
                    fontSize: Math.max(1, Math.round(16 * scale / 100)) + "px" };
            }

            function resetSamples() {
                lastSouls = -1; lastSampleMs = 0; rateEma = 0; rateUpdateMs = 0; etaEndMs = 0;
            }

            function release(resetSource = true) {
                presentation.clear();
                tree.clear();
                overlay = null; stateLabel = null;
                if (resetSource) {
                    source = null; fallbackSource = null; nextSourceSearchMs = 0; rootOwner = null;
                    nextModernSearchMs = 0;
                    modernResolver.reset(); goldResolver.reset(); amountResolver.reset(); rootAmountResolver.reset();
                    parentResolver.reset();
                    resetSamples();
                }
            }

            function resolveSource(root, now) {
                // Slow only absent modern-label probes while a fallback is in
                // use. Source loss keeps the resolver's normal recovery cadence.
                if (!P.isAlive(source) || source.id === "HudUnsecuredLabel" || now >= nextModernSearchMs) {
                    const modern = modernResolver.resolve(root);
                    if (modern) return modern;
                    nextModernSearchMs = now + 3000;
                }
                const gold = goldResolver.resolve(root);
                const amount = gold ? amountResolver.resolve(gold) || rootAmountResolver.resolve(root) : rootAmountResolver.resolve(root);
                if (amount) return amount;
                if (now >= nextSourceSearchMs) {
                    fallbackSource = findFallbackSource(root, gold);
                    nextSourceSearchMs = now + SEARCH_MS;
                }
                return P.isAlive(fallbackSource) ? fallbackSource : null;
            }

            function ensureOverlay(root) {
                tree.sweep();
                const parent = parentResolver.resolve(root);
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

            function sample(souls, now) {
                if (lastSouls < 0 || souls > lastSouls) {
                    if (souls > lastSouls) { rateEma = 0; rateUpdateMs = 0; }
                    lastSouls = souls; lastSampleMs = now;
                    return;
                }
                const elapsed = now - lastSampleMs;
                if (elapsed < MIN_SAMPLE_MS) return;
                const delta = lastSouls - souls;
                if (delta > 0) {
                    const rate = delta / (elapsed / 1000);
                    if (Number.isFinite(rate) && rate > 0.01) {
                        rateEma = rateEma > 0 ? rateEma + (rate - rateEma) * EMA_ALPHA : rate;
                        rateUpdateMs = now;
                    }
                }
                lastSouls = souls; lastSampleMs = now;
            }

            function estimate(souls, unresolved, root, now) {
                let eta = 0;
                if (!unresolved && souls > 0) {
                    const fallback = fallbackEta(souls, QOL.core.time.readGameTime(root) / 60);
                    if (rateUpdateMs > 0 && now - rateUpdateMs <= STALE_RATE_MS && rateEma > 0.01) eta = souls / rateEma;
                    if (!Number.isFinite(eta) || eta <= 0 || (fallback > 0 && eta > fallback * 2)) eta = fallback;
                    eta = Math.min(999, eta);
                    if (eta > 0) etaEndMs = now + Math.round(eta * 1000);
                } else if (souls <= 0) { etaEndMs = 0; rateEma = 0; rateUpdateMs = 0; }
                const remaining = etaEndMs > now ? (etaEndMs - now) / 1000 : eta;
                return unresolved ? "--" : souls <= 0 ? "" : Math.max(1, Math.ceil(remaining)) + "s";
            }

            function update() {
                if (!running) return;
                const root = P.findHud($.GetContextPanel());
                if (!P.isAlive(root) || (root.id !== "Hud" && root.paneltype !== "CitadelHud") || !model.enabled) { release(); return; }
                if (rootOwner !== root) { release(); rootOwner = root; }
                if (!ensureOverlay(root)) return;
                P.setClass(overlay, "qol-hidden", false);
                presentation.apply(overlay, QOL.presentation.visibilityStyles("unsecuredTimer", QOL.presentation.visibilityConfig(ctx), root, model.styles));
                QOL.utils.SetStyleIfChanged(stateLabel, "fontSize", model.fontSize);
                const now = QOL.utils.PerfNowMs();
                const current = resolveSource(root, now);
                if (current !== source) { resetSamples(); source = current; }
                const rawText = source && typeof source.text === "string" ? source.text : "";
                const unresolved = !rawText || rawText.charAt(0) === "{";
                const souls = unresolved ? 0 : parseSouls(rawText);
                if (!unresolved) sample(souls, now);
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
                const gp = P.findTraverse($.GetContextPanel(), "gameplay_hud");
                if (!gp) return null;
                return { passed: true, name: "Unsecured souls anchor panel exists", message: "",
                    assertions: [{ passed: true, name: "gameplay_hud panel exists" }] };
            } catch (e) {
                return { passed: false, name: "Unsecured souls panel check", message: e.message || String(e) };
            }
        }
    });
})();
