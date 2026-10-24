// OWNS: Read-only native pregame/crosshair/top-bar hero evidence for the FG portrait.
// DOES NOT OWN: Entity identity, shop/build actions, config, history or schedules.
// Sources retain verified native IDs/classes; conflicting or unreadable evidence is empty.
(() => {
    "use strict";
    const P = QOL.core.panel;
    // Native m_HeroID values from scripts/heroes.vdata; zero is a retained
    // class-only alias without a current native ID.
    const aliases = {
        airheart: 0,
        inferno: 1,
        gigawatt: 2,
        hornet: 3,
        ghost: 4,
        atlas: 6,
        wraith: 7,
        forge: 8,
        chrono: 10,
        dynamo: 11,
        kelvin: 12,
        haze: 13,
        astro: 14,
        bebop: 15,
        nano: 16,
        orion: 17,
        krill: 18,
        shiv: 19,
        tengu: 20,
        kali: 21,
        warden: 25,
        yamato: 27,
        lash: 31,
        viscous: 35,
        gunslinger: 38,
        yakuza: 39,
        genericperson: 46,
        tokamak: 0,
        wrecker: 48,
        rutger: 49,
        synth: 50,
        thumper: 51,
        mirage: 52,
        slork: 53,
        cadence: 54,
        targetdummy: 55,
        bomber: 56,
        shieldguy: 57,
        viper: 58,
        vandal: 59,
        magician: 60,
        trapper: 61,
        operative: 62,
        vampirebat: 63,
        drifter: 64,
        priest: 65,
        frank: 66,
        bookworm: 67,
        boho: 68,
        doorman: 69,
        skyrunner: 70,
        swan: 71,
        punkgoat: 72,
        fortuna: 75,
        necro: 76,
        fencer: 77,
        druid: 73,
        graf: 74,
        opera: 82,
        familiar: 79,
        werewolf: 80,
        unicorn: 81
    };

    const heroAliases = Object.keys(aliases);
    const heroesById = new Map(heroAliases.filter(alias => aliases[alias] > 0).map(alias => [aliases[alias], "hero_" + alias]));
    function currentHud(root) {
        if (root && !P.isAlive(root)) return null;
        const hud = P.findHud(root || $.GetContextPanel());
        return P.isAlive(hud) && (hud.id === "Hud" || hud.paneltype === "CitadelHud") ? hud : null;
    }
    function createReader() {
        // Paths are native hud.xml ownership, with bounded discovery fallback
        // for older/conditional trees. Only handles are cached, never hero classes.
        const cache = QOL.panelCache;
        const crosshairSource = cache.createIdResolver("crosshair", {
            ownerPath: [{ className: "HudCore" }, "gameplay_hud", "gameplay_hud_alive"]
        });
        const pregameSource = cache.createIdResolver("Pregame", { ownerPath: [{ className: "HudTakeovers" }] });
        const abilitiesSource = cache.createIdResolver("HeroAbilities");
        const topBarSource = cache.createIdResolver("TopBar", { ownerPath: [{ className: "HudCore" }] });
        let dashRoot = null, dashSources = [], dashChildCount = -1, nextDashSearchMs = 0;
        function reset() {
            crosshairSource.reset(); pregameSource.reset(); abilitiesSource.reset(); topBarSource.reset();
            dashRoot = null; dashSources = []; dashChildCount = -1; nextDashSearchMs = 0;
        }
        function readHeroFromTopBar(root) {
            const top = topBarSource.resolve(currentHud(root));
            if (!P.isAlive(top)) return "";
            // Native top-bar CSS identifies the viewed pawn. Do not cache the
            // selected card: both spectating and hero testing can replace it.
            const teams = P.findChild(top, "TeamsContainer");
            if (!P.isAlive(teams)) return "";
            const targets = [], locals = [];
            for (const team of teams.Children()) {
                const roster = P.findChild(P.findChild(team, "PlayerContents"), "PlayersContainer");
                if (!P.isAlive(roster)) continue;
                for (const player of roster.Children()) {
                    if (!P.isAlive(player)) continue;
                    if (player.BHasClass("SpectatorTarget")) targets.push(player);
                    if (player.BHasClass("LocalPlayer")) locals.push(player);
                }
            }
            const players = targets.length ? targets : locals;
            if (players.length !== 1 || !P.isAlive(players[0]) || players[0].BHasClass("Empty")) return "";
            const badge = P.findTraverse(players[0], "HeroBadge");
            return P.isAlive(badge) ? heroesById.get(Number(badge.heroid)) || "" : "";
        }
        function readHeroFromCrosshair(root) {
            const crosshair = crosshairSource.resolve(currentHud(root));
            if (!P.isAlive(crosshair)) return "";
            // A pawn transition can leave two live dash indicators. Every recognized
            // class must agree instead of selecting the first alias/panel match.
            try {
                const now = Date.now(), childCount = crosshair.GetChildCount();
                // Retry only an absent compatibility class at a bounded cadence.
                // Live sources still rescan every update to detect conflicting pawns.
                if (crosshair !== dashRoot || childCount !== dashChildCount || dashSources.length || now >= nextDashSearchMs) {
                    dashSources = crosshair.FindChildrenWithClassTraverse("citadel_ability_dash") || [];
                    dashRoot = crosshair; dashChildCount = childCount; nextDashSearchMs = now + 250;
                }
                const candidates = [crosshair, ...dashSources];
                let found = "";
                for (const panel of candidates) {
                    if (!P.isAlive(panel)) continue;
                    for (const alias of heroAliases) {
                        if (!panel.BHasClass("hero_" + alias) && !panel.BHasClass(alias)) continue;
                        const hero = "hero_" + alias;
                        if (found && found !== hero) return "";
                        found = hero;
                    }
                }
                return found;
            } catch (_) { return ""; }
        }
        function readHeroFromPregame(root) {
            const hud = currentHud(root);
            if (!hud) return "";
            // A hidden old reveal cannot override the current gameplay pawn. In
            // hero testing the verified ShowingHero reveal has priority in FG.
            try {
                if (!["GameStatePreGame", "GameStatePreGameWait", "connectedToHeroTesting"].some(name => hud.BHasClass(name))) return "";
                const abilities = abilitiesSource.resolve(pregameSource.resolve(hud));
                if (!P.isAlive(abilities) || !abilities.BHasClass("ShowingHero")) return "";
                let found = "";
                for (const alias of heroAliases) {
                    if (!abilities.BHasClass("hero_" + alias)) continue;
                    const hero = "hero_" + alias;
                    if (found && found !== hero) return "";
                    found = hero;
                }
                return found;
            } catch (_) { return ""; }
        }
        return { readHeroFromCrosshair, readHeroFromPregame, readHeroFromTopBar, reset };
    }
    // The core script precedes panelCache in the HUD includes. Compatibility
    // readers allocate only on first use after HUD boot.
    let reader = null;
    function shared() { return reader || (reader = createReader()); }
    QOL.core.heroProbe = {
        createReader,
        readHeroFromCrosshair: root => shared().readHeroFromCrosshair(root),
        readHeroFromPregame: root => shared().readHeroFromPregame(root)
    };
})();
