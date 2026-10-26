// OWNS: Accent wash on the current health frame and health-number backers.
// DOES NOT OWN: Native health fill, warning colors, or unrelated healthbars.
(() => {
    "use strict";
    const H = QOL.healthbar;
    const P = QOL.core.panel;
    const readIndex = cfg => P.normalizePaletteIndex(cfg && cfg.PLAYER_HEALTHBAR_ACCENT_COLOR);

    H.registerVariant("accent", function(ctx) {
        let targets = [], signature = null, pending = null, generation = 0, active = false;
        let colorValue, colorStyles = null;
        const owner = P.createNativeStyleOwner();
        const featureId = ctx && ctx.id || "ql_healthbar";

        function cancel() {
            generation++;
            if (pending) pending.stop();
            pending = null;
        }

        function release() {
            cancel();
            owner.clear();
            active = false;
            targets = [];
            signature = null;
        }

        function discover(health) {
            if (!P.isAlive(health)) return [];
            // Shipped geometry canvas and October 3 native layout share these
            // owners; native number bindings moved out of HealthBarContent.
            const canvas = H.getPlayerScalePanel(health) || health;
            const content = P.findChild(canvas, "HealthBarContent");
            const bars = P.findChild(content, "hud_health_bars");
            const line = P.findChildByClass(bars, "health_bar_line");
            const border = P.findChildByClass(line, "health_bar_border");
            const numbers = P.findChild(canvas, "HealthRegenAndTotal") || P.findChild(content, "HealthRegenAndTotal");
            const group = P.findChildByClass(numbers, "healthContainer");
            return [P.findChild(border, "health_bar_frame"), P.findChildByClass(group, "healthBacker")].filter(P.isAlive);
        }

        function update(root, cfg, health) {
            const value = cfg && cfg.PLAYER_HEALTHBAR_ACCENT_COLOR;
            if (!colorStyles || value !== colorValue) {
                colorValue = value;
                const color = P.resolvePaletteColor(value);
                colorStyles = color ? { washColor: color } : {};
            }
            const color = colorStyles.washColor;
            if (!color) {
                if (active || pending !== null || targets.length) release();
                return;
            }
            const current = discover(health);
            const same = current.length === targets.length && current.every((panel, index) => panel === targets[index]);
            if (same && signature === color) {
                for (const panel of current) owner.apply(panel, colorStyles);
                return;
            }
            cancel();
            owner.retain(color ? current : []);
            active = !!color && current.length > 0;
            targets = current;
            signature = null;
            if (!active) { signature = color; return; }
            // Preserve the existing native wash refresh delay. It belongs to this
            // generation and is cancelled on replacement, settings change or disable.
            const token = generation;
            const styles = colorStyles;
            pending = QOL.core.Scheduler.scheduleOnce(() => {
                pending = null;
                if (token !== generation) return;
                let complete = true;
                for (const panel of current) {
                    if (!owner.apply(panel, styles)) complete = false;
                }
                if (complete) signature = color;
            }, 0.01, featureId);
        }
        return { update, release, isActive: () => active || pending !== null };
    });
    H.accent.readIndex = readIndex;
    QOL.resolvePlayerHealthbarAccentColorIndex = readIndex;
    QOL.applyPlayerHealthbarAccentColor = (...args) => H.accent.update(...args);
})();
