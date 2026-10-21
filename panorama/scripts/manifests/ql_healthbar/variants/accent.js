// OWNS: Accent wash on the current health frame and health-number backers.
// DOES NOT OWN: Native health fill, warning colors, or unrelated healthbars.
(() => {
    "use strict";
    const H = QOL.healthbar;
    const P = QOL.core.panel;
    const readIndex = cfg => P.normalizePaletteIndex(cfg && cfg.PLAYER_HEALTHBAR_ACCENT_COLOR);

    H.registerVariant("accent", function(ctx) {
        let targets = [], signature = null, pending = null, generation = 0, active = false;
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
            const panels = new Set();
            const frame = P.findTraverse(health, "health_bar_frame");
            if (P.isAlive(frame)) panels.add(frame);
            for (const backer of QOL.utils.FindPanelsByClass(health, "healthBacker") || []) {
                if (P.isAlive(backer)) panels.add(backer);
            }
            return Array.from(panels);
        }

        function update(root, cfg, health) {
            const current = discover(health);
            const color = P.resolvePaletteColor(readIndex(cfg));
            const same = current.length === targets.length && current.every((panel, index) => panel === targets[index]);
            if (same && signature === color) {
                if (color) for (const panel of current) owner.apply(panel, { washColor: color });
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
            pending = QOL.core.Scheduler.scheduleOnce(() => {
                pending = null;
                if (token !== generation) return;
                let complete = true;
                for (const panel of current) {
                    if (!owner.apply(panel, { washColor: color })) complete = false;
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
