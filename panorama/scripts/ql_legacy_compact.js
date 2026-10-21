// Frozen legacy compact import data and decoder. New settings never derive from this module.
"use strict";

if (typeof QOL_CODEC.GetFieldSlotCount !== "function") {
    QOL_CODEC.GetFieldSlotCount = function(field) {
        return Math.round((field.max - field.min) / field.step) + 1;
    };
}

if (typeof QOL_CODEC.GetFieldBitWidth !== "function") {
    QOL_CODEC.GetFieldBitWidth = function(field) {
        var slots = QOL_CODEC.GetFieldSlotCount(field);
        var bits = 0;
        while ((1 << bits) < slots) bits++;
        return bits;
    };
}

if (typeof QOL_CODEC.BuildWireToSemver !== "function") {
    QOL_CODEC.BuildWireToSemver = function(registry) {
        var out = {};
        if (!registry || typeof registry !== "object") return out;
        for (var semver in registry) {
            if (!registry.hasOwnProperty(semver)) continue;
            var entry = registry[semver];
            if (!entry) continue;
            var wireVersion = Math.max(0, Math.round(Number(entry.wireVersion) || 0));
            if (wireVersion <= 0) continue;
            out[wireVersion] = semver;
        }
        return out;
    };
}

if (typeof QOL_CODEC.ResolveSemverFromWire !== "function") {
    QOL_CODEC.ResolveSemverFromWire = function(wireToSemver, registry, wireVersion) {
        var normalized = Math.max(0, Math.round(Number(wireVersion) || 0));
        var semver = wireToSemver ? wireToSemver[normalized] : "";
        if (!semver || !registry || !registry[semver]) return "";
        return semver;
    };
}

if (typeof QOL_CODEC.DeserializeCompactBinary !== "function") {
    QOL_CODEC.DeserializeCompactBinary = function(binaryStr, schema, onDecodedField, onMissingField) {
        var bytes = [];
        var source = String(binaryStr || "");
        for (var i = 0; i < source.length; i++) bytes.push(source.charCodeAt(i) & 255);
        if (bytes.length < 3) throw new Error("Compact string too short");

        var expectedChecksum = bytes[bytes.length - 1] & 255;
        var checksum = 0;
        for (var c = 0; c < bytes.length - 1; c++) checksum = (checksum + (bytes[c] & 255)) & 255;
        if (checksum !== expectedChecksum) throw new Error("Compact checksum mismatch");

        var safeSchema = Array.isArray(schema) ? schema : [];
        var byteIndex = 1;
        var bitPos = 0;

        function readBits(bitCount) {
            var value = 0;
            for (var b = 0; b < bitCount; b++) {
                if (byteIndex >= bytes.length - 1) return null;
                var bit = (bytes[byteIndex] >> bitPos) & 1;
                value |= (bit << b);
                bitPos++;
                if (bitPos === 8) {
                    bitPos = 0;
                    byteIndex++;
                }
            }
            return value;
        }

        var parsed = {};
        for (var f = 0; f < safeSchema.length; f++) {
            var field = safeSchema[f];
            if (!field) continue;
            var bits = QOL_CODEC.GetFieldBitWidth(field);
            var slots = QOL_CODEC.GetFieldSlotCount(field);
            var idx = readBits(bits);
            if (idx === null) {
                if (typeof onMissingField === "function") {
                    for (var m = f; m < safeSchema.length; m++) {
                        try { onMissingField(safeSchema[m], parsed); } catch(e1) { if (typeof $ !== "undefined" && $.Msg) $.Msg("[QOLLock][WARN][presets] op failed: " + (e1 && e1.message ? e1.message : String(e1 || ""))); }
                    }
                }
                break;
            }
            if (idx < 0) idx = 0;
            if (idx >= slots) idx = slots - 1;

            var value = field.min + (idx * field.step);
            var decimals = QOL_CODEC.GetStepDecimals(field.step);
            value = decimals > 0 ? parseFloat(value.toFixed(decimals)) : Math.round(value);

            var handled = false;
            if (typeof onDecodedField === "function") {
                try { handled = (onDecodedField(field, value, parsed) === true); } catch (e2) { handled = false; }
            }
            if (!handled) {
                parsed[field.key] = value;
            }
        }
        return parsed;
    };
}

// ==========================================================================
// QOL_COMPACT_SCHEMA — shared compact schema definitions
// ==========================================================================
// Single source of truth for the compact binary schema used by:
//   - ql_settings.js  (export/import serialization)
//   - ql_core.js      (build category payload serialization)
//
// SCHEMA VERSIONING RULES:
//   - Never silently change the meaning of a released schema version.
//   - Add new fields by creating a new semver entry in the registry.
//   - Changing QOL_SCHEMA_SEMVER requires explicit maintainer authorization.
//   - Run scripts/validate_compact_schema.js after any schema change.
//
// Current semver: see QOL_SCHEMA_SEMVER (top of file)
// ==========================================================================

var QOL_COMPACT_SCHEMA_UTILS = {};

// Wire version constants for the compact binary format.
// Wire version 1 = schema 2.0.0 only; wire version 2 = all later versions.
var QOL_COMPACT_WIRE_VERSION_2_0_0 = 1;
var QOL_COMPACT_WIRE_VERSION_2_0_1 = 2;

// Hero index field used by compact schema serialization.
// The key name must match what serialize/deserialize callbacks check for.
var QOL_COMPACT_DEFAULT_HERO_FIELD = "DEFAULT_HERO_INDEX";
// Default hero options — used to compute the schema field's max value.
// Consumers (ql_settings.js, ql_core.js) may override this with their own
// hero option lists before the schema is used for serialization.
var QOL_COMPACT_DEFAULT_HERO_OPTIONS = [
    "hero_inferno", "hero_gigawatt", "hero_hornet", "hero_ghost", "hero_atlas",
    "hero_wraith", "hero_forge", "hero_chrono", "hero_dynamo", "hero_kelvin",
    "hero_haze", "hero_astro", "hero_bebop", "hero_nano", "hero_orion",
    "hero_krill", "hero_shiv", "hero_tengu", "hero_warden", "hero_yamato",
    "hero_lash", "hero_viscous", "hero_synth", "hero_mirage", "hero_viper",
    "hero_magician", "hero_vampirebat", "hero_drifter", "hero_priest", "hero_frank",
    "hero_bookworm", "hero_doorman", "hero_punkgoat", "hero_necro", "hero_fencer",
    "hero_familiar", "hero_werewolf", "hero_unicorn"
];

var QOL_COMPACT_SCHEMA_V2 = [
    { key: "MINIMAP_SMALL_SIZE", min: 200, max: 1000, step: 5 },
    { key: "MINIMAP_BASE_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "MINIMAL_MINIMAP", min: 0, max: 1, step: 1 },
    { key: "MINIMAP_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "MINIMAP_Y_OFFSET", min: -100, max: 1000, step: 5 },
    { key: "MINIMAP_LARGE_SIZE", min: 400, max: 1200, step: 10 },
    { key: "ZOOM_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "ZOOM_Y_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "ENABLE_ALT_ZOOM", min: 0, max: 1, step: 1 },
    { key: "ALT_ZOOM_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ENABLE_TAB_ZOOM", min: 0, max: 1, step: 1 },
    { key: "TAB_ZOOM_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ENABLE_ONE_TIME", min: 0, max: 1, step: 1 },
    { key: "ENABLE_INTERVAL", min: 0, max: 1, step: 1 },
    { key: "BRIDGE_BUFF_START", min: 0, max: 60, step: 1 },
    { key: "ENABLE_AMMO_STATUS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_PASSIVE_COOLDOWN", min: 0, max: 1, step: 1 },
    { key: "PASSIVE_COOLDOWN_SIZE", min: 30, max: 60, step: 1 },
    { key: "PASSIVE_COOLDOWN_Y", min: -50, max: 50, step: 1 },
    { key: "PASSIVE_COOLDOWN_X", min: -50, max: 50, step: 1 },
    { key: "PASSIVE_COOLDOWN_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ITEM_FILTER_DEF_PASSIVE", min: 0, max: 1, step: 1 },
    { key: "ITEM_FILTER_OFF_PASSIVE", min: 0, max: 1, step: 1 },
    { key: "ITEM_FILTER_DEF_ACTIVE", min: 0, max: 1, step: 1 },
    { key: "ITEM_FILTER_OFF_ACTIVE", min: 0, max: 1, step: 1 },
    { key: "VOICE_TYPE", min: 0, max: 8, step: 1 },
    { key: "ENABLE_COMPASS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SIMPLIFY_COMPASS", min: 0, max: 1, step: 1 },
    { key: "COMPASS_SCALE", min: 50, max: 200, step: 1 },
    { key: "COMPASS_X_OFFSET", min: -2000, max: 2000, step: 5 },
    { key: "COMPASS_Y_OFFSET", min: -1000, max: 300, step: 5 },
    { key: "ENABLE_KEYBOARD_OVERLAY", min: 0, max: 1, step: 1 },
    { key: "ENABLE_FULL_KEYBOARD_LAYOUT", min: 0, max: 1, step: 1 },
    { key: "KEYBOARD_OVERLAY_SCALE", min: 70, max: 150, step: 1 },
    { key: "KEYBOARD_OVERLAY_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "KEYBOARD_OVERLAY_Y_OFFSET", min: -400, max: 1000, step: 5 },
    { key: "ENABLE_MINIMAP_REMINDER", min: 0, max: 1, step: 1 },
    { key: "MINIMAP_REMINDER_INTERVAL", min: 5, max: 60, step: 1 },
    { key: "DISABLE_DAMAGE_REPORT", min: 0, max: 1, step: 1 },
    { key: "DISABLE_QUICK_BUY", min: 0, max: 1, step: 1 },
    { key: "ENABLE_HUD_SHIFT", min: 0, max: 1, step: 1 },
    { key: "SUPPORT_4_3", min: 0, max: 1, step: 1 },
    { key: "ENABLE_UNSPENT_SOULS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_MIN_SOULS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_OBJ_DMG", min: 0, max: 1, step: 1 },
    { key: "ENABLE_OBJ_MAP", min: 0, max: 1, step: 1 },
    { key: "ENABLE_URN_DIFF", min: 0, max: 1, step: 1 },
    { key: "ENABLE_MISSING_HERO", min: 0, max: 1, step: 1 },
    { key: "ENABLE_CUMULATIVE_DMG", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SHOP_STATS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SIMPLIFY_SHOP", min: 0, max: 1, step: 1 },
    { key: "DAMAGE_NUMBER_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ENABLE_ZIP_BOOST", min: 0, max: 1, step: 1 },
    { key: "ZIP_BOOST_X_OFFSET", min: -2000, max: 2000, step: 5 },
    { key: "ZIP_BOOST_Y_OFFSET", min: 0, max: 1000, step: 5 },
    { key: "ENABLE_CLEAN_STACKS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_CENTER_ESC", min: 0, max: 1, step: 1 },
    { key: "HUD_INDICATOR_SIZE", min: 10, max: 60, step: 1 },
    { key: "ENABLE_RED_DIAMOND", min: 0, max: 1, step: 1 },
    { key: "UNIT_TARGET_SIZE", min: 50, max: 300, step: 5 },
    { key: "UNIT_TARGET_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ENABLE_HERO_SCENE_PANEL", min: 0, max: 1, step: 1 },
    { key: "ENABLE_HIDE_FAILED_HINT", min: 0, max: 1, step: 1 },
    { key: "ENABLE_HIDE_ABILITY_SUGGESTION", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SIMPLIFY_ABILITY_ICONS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_HIDE_BEHAVIOR_SUMMARY", min: 0, max: 1, step: 1 },
    { key: "ENABLE_BUFF_HUD", min: 0, max: 1, step: 1 },
    { key: "ENABLE_REJUV_HUD", min: 0, max: 1, step: 1 },
    { key: "ENABLE_COLORED_HEALTHBAR", min: 0, max: 1, step: 1 }
];

var QOL_COMPACT_SCHEMA_V3 = QOL_COMPACT_SCHEMA_V2.concat([
    { key: "ENABLE_COMPASS_SPEED", min: 0, max: 1, step: 1 },
    { key: "COMPASS_STRETCH_X", min: 50, max: 200, step: 1 },
    { key: "COMPASS_STRETCH_Y", min: 50, max: 200, step: 1 },
    { key: "ZIP_BOOST_SCALE", min: 50, max: 200, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V4 = QOL_COMPACT_SCHEMA_V3.concat([
    { key: "ENABLE_SIMPLIFY_ITEMS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V5 = QOL_COMPACT_SCHEMA_V4.concat([
    { key: "MINIMAP_LARGE_SIZE_ALT", min: 400, max: 1200, step: 10 },
    { key: "ZOOM_X_OFFSET_ALT", min: -1500, max: 1500, step: 5 },
    { key: "ZOOM_Y_OFFSET_ALT", min: -1000, max: 1000, step: 5 },
    { key: "MINIMAP_LARGE_SIZE_TAB", min: 400, max: 1200, step: 10 },
    { key: "ZOOM_X_OFFSET_TAB", min: -1500, max: 1500, step: 5 },
    { key: "ZOOM_Y_OFFSET_TAB", min: -1000, max: 1000, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V6 = QOL_COMPACT_SCHEMA_V5.concat([
    { key: "SUPPORT_16_10", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V7 = QOL_COMPACT_SCHEMA_V6.concat([
    { key: "DISABLE_SHOP_BLUE", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V8 = QOL_COMPACT_SCHEMA_V7.concat([
    { key: "SHOP_OFFSET_X", min: -500, max: 500, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V9 = QOL_COMPACT_SCHEMA_V8.concat([
    { key: "ENABLE_HIDE_SMALL_NUMBERS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V10 = QOL_COMPACT_SCHEMA_V9.concat([
    { key: "ENABLE_HIDE_MAGAZINE", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V11 = QOL_COMPACT_SCHEMA_V10.concat([
    { key: "AMMO_PANEL_SCALE", min: 100, max: 300, step: 1 },
    { key: "AMMO_PANEL_X_OFFSET", min: -200, max: 200, step: 5 },
    { key: "AMMO_PANEL_Y_OFFSET", min: -200, max: 200, step: 5 }
]);

// V12 reserved for future expansion, currently identical to V11
var QOL_COMPACT_SCHEMA_V12 = QOL_COMPACT_SCHEMA_V11;

var QOL_COMPACT_SCHEMA_V13 = QOL_COMPACT_SCHEMA_V12.concat([
    { key: "ENABLE_ON_DEATH_GAMES", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V14 = QOL_COMPACT_SCHEMA_V13.concat([
    { key: "ENABLE_RELOAD_COOLDOWN", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V15 = QOL_COMPACT_SCHEMA_V14.concat([
    { key: "ENABLE_HIDE_RELOAD_ICON", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V16 = QOL_COMPACT_SCHEMA_V15.concat([
    { key: "ENABLE_HIDE_RELOAD_CIRCLE", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V17 = QOL_COMPACT_SCHEMA_V16.concat([
    { key: "RELOAD_COOLDOWN_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "RELOAD_COOLDOWN_SIZE", min: 16, max: 60, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V18 = QOL_COMPACT_SCHEMA_V17.concat([
    { key: "TAB_ZOOM_DRAW_OVER_UI", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V19 = QOL_COMPACT_SCHEMA_V18.concat([
    { key: "ALT_ZOOM_DRAW_OVER_UI", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V20 = QOL_COMPACT_SCHEMA_V19.concat([
    { key: "ENABLE_HIDE_TROOPER_DAMAGE", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V21 = QOL_COMPACT_SCHEMA_V20.concat([
    { key: "MINIMAP_ROTATE_WITH_PLAYER", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V22 = QOL_COMPACT_SCHEMA_V21.concat([
    { key: "ENABLE_STAT_BONUSES", min: 0, max: 1, step: 1 },
    { key: "STAT_BONUSES_SCALE", min: 50, max: 200, step: 1 },
    { key: "STAT_BONUSES_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "STAT_BONUSES_Y_OFFSET", min: 0, max: 1000, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V23 = QOL_COMPACT_SCHEMA_V22.concat([
    { key: "ENABLE_UNSECURED_SOUL_TIMER", min: 0, max: 1, step: 1 },
    { key: "UNSECURED_SOUL_TIMER_SCALE", min: 50, max: 200, step: 1 },
    { key: "UNSECURED_SOUL_TIMER_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "UNSECURED_SOUL_TIMER_Y_OFFSET", min: -100, max: 1000, step: 5 }
]);

// NOTE: V24 adds ENABLE_COLORED_HEALTHBAR as a duplicate — it already exists
// in V2 (the base schema). The decode overwrite is harmless (same value wins)
// but costs 2 wasted bits per compact payload. Not fixed for binary compat.
var QOL_COMPACT_SCHEMA_V24 = QOL_COMPACT_SCHEMA_V23.concat([
    { key: "ENABLE_COLORED_HEALTHBAR", min: 0, max: 1, step: 1 }
]);

// V25 reserved, identical to V24
var QOL_COMPACT_SCHEMA_V25 = QOL_COMPACT_SCHEMA_V24;

var QOL_COMPACT_SCHEMA_V26 = QOL_COMPACT_SCHEMA_V25.concat([
    { key: "ENABLE_MINIMALIST_HEALTHBAR", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V27 = QOL_COMPACT_SCHEMA_V26.concat([
    { key: "ENABLE_FORCE_TESTING_TOOLS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V28 = QOL_COMPACT_SCHEMA_V27.concat([
    { key: "RELOAD_COOLDOWN_X_OFFSET", min: -75, max: 75, step: 1 },
    { key: "RELOAD_COOLDOWN_Y_OFFSET", min: -75, max: 75, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V29 = QOL_COMPACT_SCHEMA_V28.concat([
    { key: "UNSECURED_SOULS_HUD_SCALE", min: 50, max: 200, step: 1 },
    { key: "UNSECURED_SOULS_HUD_X_OFFSET", min: -1000, max: 2000, step: 5 },
    { key: "UNSECURED_SOULS_HUD_Y_OFFSET", min: 800, max: 2000, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V30 = QOL_COMPACT_SCHEMA_V29;

var QOL_COMPACT_SCHEMA_V31 = QOL_COMPACT_SCHEMA_V30.concat([
    { key: "ENABLE_BETTER_UNSECURED", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V32 = QOL_COMPACT_SCHEMA_V31.concat([
    { key: "ENABLE_BETTER_UNSECURED_SHOW_ICON_TEXT", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V33 = QOL_COMPACT_SCHEMA_V32.concat([
    { key: "ENABLE_BETTER_UNSECURED_SHOW_ICON", min: 0, max: 1, step: 1 },
    { key: "ENABLE_BETTER_UNSECURED_SHOW_TEXT", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V34 = QOL_COMPACT_SCHEMA_V33.concat([
    { key: "ENABLE_ULT_COOLDOWNS", min: 0, max: 1, step: 1 },
    { key: "ULT_COOLDOWN_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ULT_COOLDOWN_SIZE", min: 10, max: 32, step: 1 },
    { key: "ULT_COOLDOWN_X_OFFSET", min: -60, max: 60, step: 1 },
    { key: "ULT_COOLDOWN_Y_OFFSET", min: -60, max: 60, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V35 = QOL_COMPACT_SCHEMA_V34.concat([
    { key: "LANGUAGE", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V36 = QOL_COMPACT_SCHEMA_V35.concat([
    { key: "MINIMALIST_HEALTHBAR_X_OFFSET", min: -300, max: 300, step: 1 },
    { key: "MINIMALIST_HEALTHBAR_Y_OFFSET", min: -300, max: 300, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V37 = QOL_COMPACT_SCHEMA_V36.concat([
    { key: "ENABLE_HIDE_TESTING_TOOLS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V38 = QOL_COMPACT_SCHEMA_V37.concat([
    { key: "ENABLE_HIDE_COSMETIC_ABILITY", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V39 = QOL_COMPACT_SCHEMA_V38.concat([
    { key: "DAMAGE_REPORT_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "DAMAGE_REPORT_Y_OFFSET", min: -1500, max: 200, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V40 = QOL_COMPACT_SCHEMA_V39.concat([
    { key: "ENABLE_HIDE_AMMO_ALL", min: 0, max: 1, step: 1 }
]);

// V41 reserved, identical to V40
var QOL_COMPACT_SCHEMA_V41 = QOL_COMPACT_SCHEMA_V40;

var QOL_COMPACT_SCHEMA_V42 = QOL_COMPACT_SCHEMA_V41.concat([
    { key: QOL_COMPACT_DEFAULT_HERO_FIELD, min: 0, max: Math.max(0, QOL_COMPACT_DEFAULT_HERO_OPTIONS.length - 1), step: 1 }
]);

var QOL_COMPACT_SCHEMA_V43 = QOL_COMPACT_SCHEMA_V42.concat([
    { key: "ENABLE_OLD_ITEM_COOLDOWNS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V44 = QOL_COMPACT_SCHEMA_V43.concat([
    { key: "OLD_ITEM_COOLDOWNS_SCALE", min: 50, max: 200, step: 1 },
    { key: "OLD_ITEM_COOLDOWNS_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "OLD_ITEM_COOLDOWNS_Y_OFFSET", min: -1000, max: 1000, step: 5 }
]);

// V45 reserved, identical to V44
var QOL_COMPACT_SCHEMA_V45 = QOL_COMPACT_SCHEMA_V44;

var QOL_COMPACT_SCHEMA_V46 = QOL_COMPACT_SCHEMA_V45.concat([
    { key: "ENABLE_LANE_WITH_PARTY", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V47 = QOL_COMPACT_SCHEMA_V46.concat([
    { key: "ENABLE_ONE_TIME_TIER1", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ONE_TIME_TIER2", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ONE_TIME_TIER3", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V48 = QOL_COMPACT_SCHEMA_V47.concat([
    { key: "ENABLE_FG_HEALTHBAR", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V49 = QOL_COMPACT_SCHEMA_V48.concat([
    { key: "HEALTHBAR_TYPE", min: 0, max: 4, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V50 = QOL_COMPACT_SCHEMA_V49.concat([
    { key: "ENABLE_COLOR_WARNING_25", min: 0, max: 1, step: 1 },
    { key: "ENABLE_COLOR_WARNING_65", min: 0, max: 1, step: 1 },
    { key: "ENABLE_COLOR_WARNING_75", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V51 = QOL_COMPACT_SCHEMA_V50.concat([
    { key: "ENABLE_MINIMAP_BUFF_TIMER", min: 0, max: 1, step: 1 },
    { key: "ENABLE_MINIMAP_REJUV_TIMER", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V52 = QOL_COMPACT_SCHEMA_V51.concat([
    { key: "AMMO_CURRENT_SCALE", min: 100, max: 300, step: 1 },
    { key: "AMMO_TOTAL_SCALE", min: 100, max: 300, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V53 = QOL_COMPACT_SCHEMA_V52.concat([
    { key: "ENABLE_IMPROVED_HINT", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V54 = QOL_COMPACT_SCHEMA_V53.concat([
    { key: "ENABLE_COMBAT_STATUS", min: 0, max: 1, step: 1 },
    { key: "COMBAT_STATUS_SCALE", min: 50, max: 200, step: 1 },
    { key: "COMBAT_STATUS_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "COMBAT_STATUS_Y_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "ENABLE_ENEMY_ULT_INDICATOR", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V55 = QOL_COMPACT_SCHEMA_V54.concat([
    { key: "ENABLE_NICKNAMES", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V56 = QOL_COMPACT_SCHEMA_V55.concat([
    { key: "MINIMAL_MINIMAP_OPACITY", min: 0, max: 1, step: 0.05 }
]);

var QOL_COMPACT_SCHEMA_V57 = QOL_COMPACT_SCHEMA_V56.concat([
    { key: "ENABLE_DAMAGE_FOUNTAIN", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V58 = QOL_COMPACT_SCHEMA_V57.concat([
    { key: "PLAYER_HEALTHBAR_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "PLAYER_HEALTHBAR_Y_OFFSET", min: -1000, max: 1000, step: 5 }
]);

var QOL_COMPACT_SCHEMA_V59 = QOL_COMPACT_SCHEMA_V58.concat([
    { key: "PLAYER_HEALTHBAR_SCALE", min: 50, max: 200, step: 1 },
    { key: "PLAYER_HEALTHBAR_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "VOICE_VOLUME", min: 0, max: 100, step: 1 },
    { key: "ENABLE_BUFF_SOUND_1", min: 0, max: 1, step: 1 },
    { key: "ENABLE_BUFF_SOUND_2", min: 0, max: 1, step: 1 },
    { key: "ENABLE_BUFF_SOUND_3", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_V60 = QOL_COMPACT_SCHEMA_V59.concat([
    { key: "ENABLE_ENEMY_COLORED_HEALTHBAR", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ENEMY_COLOR_WARNING_25", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ENEMY_COLOR_WARNING_65", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ENEMY_COLOR_WARNING_75", min: 0, max: 1, step: 1 },
    { key: "ENABLE_URN_COLORS", min: 0, max: 1, step: 1 }
]);

var QOL_COMPACT_SCHEMA_2_0_1_EXTRA_FIELDS = [
    { key: "ENABLE_ENEMY_V2_ENHANCED", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ENEMY_V2_ULT_INDICATOR", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ENEMY_V2_LEVEL", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_MINESWEEPER", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_BLACKJACK", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_FLAPPY_BAT", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_GRAVES_TRAINER", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_ZERGGY_MANIA", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_WHACK_A_REM", min: 0, max: 1, step: 1 }
];

QOL_COMPACT_SCHEMA_UTILS.BuildSchemaWithLanguageMax = function(baseSchema, maxLanguageValue) {
    var out = [];
    var langMax = Math.max(1, Math.round(Number(maxLanguageValue) || 1));
    for (var i = 0; i < baseSchema.length; i++) {
        var field = baseSchema[i];
        if (!field) continue;
        var copy = {
            key: field.key,
            min: field.min,
            max: field.max,
            step: field.step
        };
        if (copy.key === "LANGUAGE") copy.max = langMax;
        out.push(copy);
    }
    return out;
}

QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields = function(baseSchema, extraFields) {
    var out = Array.isArray(baseSchema) ? baseSchema.slice() : [];
    if (!Array.isArray(extraFields) || extraFields.length <= 0) return out;
    var seen = {};
    for (var iSeen = 0; iSeen < out.length; iSeen++) {
        var existing = out[iSeen];
        if (existing && existing.key) seen[String(existing.key)] = true;
    }
    for (var iExtra = 0; iExtra < extraFields.length; iExtra++) {
        var field = extraFields[iExtra];
        if (!field || !field.key) continue;
        var key = String(field.key);
        if (seen[key]) continue;
        out.push({
            key: field.key,
            min: field.min,
            max: field.max,
            step: field.step
        });
        seen[key] = true;
    }
    return out;
}

QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides = function(baseSchema, overrideFields) {
    var out = [];
    var overrides = {};
    var i;
    if (Array.isArray(overrideFields)) {
        for (i = 0; i < overrideFields.length; i++) {
            var overrideField = overrideFields[i];
            if (!overrideField || !overrideField.key) continue;
            overrides[String(overrideField.key)] = overrideField;
        }
    }
    if (!Array.isArray(baseSchema)) return out;
    for (i = 0; i < baseSchema.length; i++) {
        var field = baseSchema[i];
        if (!field || !field.key) continue;
        var key = String(field.key);
        var sourceField = overrides[key] || field;
        out.push({
            key: sourceField.key,
            min: sourceField.min,
            max: sourceField.max,
            step: sourceField.step
        });
    }
    return out;
}

var QOL_COMPACT_SCHEMA_2_0_0 = QOL_COMPACT_SCHEMA_V60;
var QOL_COMPACT_SCHEMA_2_0_1= QOL_COMPACT_SCHEMA_UTILS.BuildSchemaWithLanguageMax(QOL_COMPACT_SCHEMA_2_0_0, 2);
for (var iSchemaExtra = 0; iSchemaExtra < QOL_COMPACT_SCHEMA_2_0_1_EXTRA_FIELDS.length; iSchemaExtra++) {
    QOL_COMPACT_SCHEMA_2_0_1.push(QOL_COMPACT_SCHEMA_2_0_1_EXTRA_FIELDS[iSchemaExtra]);
}
var QOL_COMPACT_SCHEMA_2_1_1 = QOL_COMPACT_SCHEMA_2_0_1;
var QOL_COMPACT_SCHEMA_2_1_2_EXTRA_FIELDS = [
    { key: "ENABLE_CENTER_FRIENDS_LIST", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_1_2 = QOL_COMPACT_SCHEMA_2_1_1.concat(QOL_COMPACT_SCHEMA_2_1_2_EXTRA_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_0_EXTRA_FIELDS = [
    { key: "ENABLE_GAME_AUDIO", min: 0, max: 1, step: 1 },
    { key: "GAME_DEFAULT_DIFFICULTY", min: 0, max: 2, step: 1 },
    { key: "ON_DEATH_GAME_MINESWEEPER", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_BLACKJACK", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_FLAPPY_BAT", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_GRAVES_TRAINER", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_ZERGGY_MANIA", min: 0, max: 1, step: 1 },
    { key: "ON_DEATH_GAME_WHACK_A_REM", min: 0, max: 1, step: 1 },
    { key: "ENABLE_STATLOCKER", min: 0, max: 1, step: 1 },
    { key: "CHAT_SCALE", min: 50, max: 200, step: 1 },
    { key: "CHAT_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "CHAT_Y_OFFSET", min: -1000, max: 1000, step: 5 }
];
var QOL_COMPACT_SCHEMA_2_2_0= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_1_2, QOL_COMPACT_SCHEMA_2_2_0_EXTRA_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_1_OVERRIDE_FIELDS = [
    { key: "CHAT_Y_OFFSET", min: -250, max: 800, step: 5 }
];
var QOL_COMPACT_SCHEMA_2_2_1_EXTRA_FIELDS = [
    { key: "ENABLE_CHAT", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_1= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(QOL_COMPACT_SCHEMA_2_2_0, QOL_COMPACT_SCHEMA_2_2_1_OVERRIDE_FIELDS),
    QOL_COMPACT_SCHEMA_2_2_1_EXTRA_FIELDS
);
var QOL_COMPACT_SCHEMA_2_2_2_EXTRA_FIELDS = [
    { key: "ENABLE_LEGACY_COOLDOWNS", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_2= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_2_1, QOL_COMPACT_SCHEMA_2_2_2_EXTRA_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_3_OVERRIDE_FIELDS = [
    { key: "LANGUAGE", min: 0, max: 3, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_3= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(QOL_COMPACT_SCHEMA_2_2_2, QOL_COMPACT_SCHEMA_2_2_3_OVERRIDE_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_4_OVERRIDE_FIELDS = [
    { key: "LANGUAGE", min: 0, max: 4, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_4= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(QOL_COMPACT_SCHEMA_2_2_3, QOL_COMPACT_SCHEMA_2_2_4_OVERRIDE_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_5_OVERRIDE_FIELDS = [
    { key: "LANGUAGE", min: 0, max: 5, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_5= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(QOL_COMPACT_SCHEMA_2_2_4, QOL_COMPACT_SCHEMA_2_2_5_OVERRIDE_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_6_OVERRIDE_FIELDS = [
    { key: "LANGUAGE", min: 0, max: 6, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_2_6= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(QOL_COMPACT_SCHEMA_2_2_5, QOL_COMPACT_SCHEMA_2_2_6_OVERRIDE_FIELDS);
var QOL_COMPACT_SCHEMA_2_2_7= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_2_6,
    [{ key: "MINIMAP_FLIP", min: 0, max: 1, step: 1 }]
);
var QOL_COMPACT_SCHEMA_2_2_10= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_2_7,
    [
        { key: "ENABLE_MINIMAP_ALWAYS_ON_MID_BOSS", min: 0, max: 1, step: 1 },
        { key: "ENABLE_MINIMAP_BUFF_TIMER_ON_BRIDGE", min: 0, max: 1, step: 1 }
    ]
);
var QOL_COMPACT_SCHEMA_2_3_1= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_2_10,
    [
        { key: "ENABLE_BHOP", min: 0, max: 1, step: 1 }
    ]
);
var QOL_COMPACT_SCHEMA_2_3_3 = QOL_COMPACT_SCHEMA_2_3_1;
var QOL_COMPACT_SCHEMA_2_3_4= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(
        QOL_COMPACT_SCHEMA_2_3_1,
        [{ key: "HEALTHBAR_TYPE", min: 0, max: 5, step: 1 }]
    ),
    [
        { key: "ENABLE_IMAGES_IN_CHAT", min: 0, max: 1, step: 1 },
        { key: "ENABLE_MINECRAFT_HEALTH_NUMBERS", min: 0, max: 1, step: 1 }
    ]
);
const TOPBAR_HP_WARNING_SCHEMA_FIELDS = [
    { key: "ENABLE_TOPBAR_ENEMY_HP_WARNING", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ENEMY_HP_WARNING_25", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ENEMY_HP_WARNING_65", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ENEMY_HP_WARNING_75", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ALLY_HP_WARNING", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ALLY_HP_WARNING_25", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ALLY_HP_WARNING_65", min: 0, max: 1, step: 1 },
    { key: "ENABLE_TOPBAR_ALLY_HP_WARNING_75", min: 0, max: 1, step: 1 }
];
const HUD_BAR_AND_SHOP_SCHEMA_FIELDS = [
    { key: "TOP_BAR_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "TOP_BAR_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "TOP_BAR_Y_OFFSET", min: -500, max: 500, step: 5 },
    { key: "BOTTOM_BAR_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "BOTTOM_BAR_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "BOTTOM_BAR_Y_OFFSET", min: -500, max: 500, step: 5 },
    { key: "SHOP_OFFSET_Y", min: -500, max: 500, step: 5 },
    { key: "SHOP_OPACITY", min: 0, max: 1, step: 0.05 }
];
const HUD_SECTION_AND_PANEL_SCHEMA_FIELDS = [
    { key: "HUD_TOP_BAR_ENABLED", min: 0, max: 1, step: 1 },
    { key: "HUD_BOTTOM_BAR_ENABLED", min: 0, max: 1, step: 1 },
    { key: "HUD_ITEMS_ENABLED", min: 0, max: 1, step: 1 },
    { key: "HUD_SOULS_ENABLED", min: 0, max: 1, step: 1 },
    { key: "HUD_SHOP_ENABLED", min: 0, max: 1, step: 1 },
    { key: "ITEMS_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ITEMS_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "ITEMS_Y_OFFSET", min: -500, max: 500, step: 5 },
    { key: "SOULS_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "SOULS_X_OFFSET", min: -1500, max: 1500, step: 5 },
    { key: "SOULS_Y_OFFSET", min: -500, max: 500, step: 5 }
];
const MINIMAP_CRATE_OVERLAY_SCHEMA_FIELDS = [
    { key: "ENABLE_MINIMAP_CRATE_OVERLAY", min: 0, max: 1, step: 1 }
];
const MINIMAP_REM_TUNNELS_SCHEMA_FIELDS = [
    { key: "ENABLE_MINIMAP_REM_TUNNELS", min: 0, max: 1, step: 1 },
    { key: "MINIMAP_REM_TUNNELS_OPACITY", min: 0, max: 1, step: 0.05 }
];
const MINIMAP_ELEVATION_MARKERS_SCHEMA_FIELDS = [
    { key: "ENABLE_MINIMAP_ELEVATION_MARKERS", min: 0, max: 1, step: 1 }
];
const HUD_BAR_AND_SHOP_SCALE_SCHEMA_FIELDS = [
    { key: "TOP_BAR_SCALE", min: 0.5, max: 1.5, step: 0.05 },
    { key: "BOTTOM_BAR_SCALE", min: 0.5, max: 1.5, step: 0.05 },
    { key: "SHOP_SCALE", min: 0.5, max: 1.5, step: 0.05 }
];
const ZOOM_REM_TUNNELS_SCHEMA_FIELDS = [
    { key: "ENABLE_ALT_ZOOM_REM_TUNNELS", min: 0, max: 1, step: 1 },
    { key: "ALT_ZOOM_REM_TUNNELS_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "ENABLE_TAB_ZOOM_REM_TUNNELS", min: 0, max: 1, step: 1 },
    { key: "TAB_ZOOM_REM_TUNNELS_OPACITY", min: 0, max: 1, step: 0.05 }
];
const DAMAGE_IMPACT_SCHEMA_FIELDS = [
    { key: "ENABLE_DAMAGE_IMPACT", min: 0, max: 1, step: 1 },
    { key: "DAMAGE_IMPACT_SCALE", min: 0.5, max: 2.0, step: 0.05 },
    { key: "DAMAGE_IMPACT_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "DAMAGE_IMPACT_X_OFFSET", min: -1000, max: 1000, step: 5 },
    { key: "DAMAGE_IMPACT_Y_OFFSET", min: -1000, max: 1000, step: 5 }
];
const SETTINGS_THEME_SCHEMA_FIELDS = [
    { key: "SETTINGS_THEME", min: 0, max: 5, step: 1 }
];
const SETTINGS_THEME_SCHEMA_FIELDS_3_0_5 = [
    { key: "SETTINGS_THEME", min: 0, max: 6, step: 1 }
];
const PALETTE_PICKER_SCHEMA_FIELDS = [
    { key: "ITEMS_WASH_COLOR", min: 0, max: 29, step: 1 },
    { key: "PLAYER_HEALTHBAR_ACCENT_COLOR", min: 0, max: 29, step: 1 },
    { key: "BOTTOM_BAR_WASH_COLOR", min: 0, max: 29, step: 1 },
    { key: "KEYBOARD_OVERLAY_WASH_COLOR", min: 0, max: 29, step: 1 },
    { key: "STAMINA_CHARGE_COLOR", min: 0, max: 29, step: 1 },
    { key: "AMMO_TEXT_COLOR", min: 0, max: 29, step: 1 },
    { key: "MINIMAP_ICON_COLOR", min: 0, max: 29, step: 1 }
];
const PALETTE_PICKER_SCHEMA_FIELDS_2_5_4 = [
    { key: "ITEMS_WASH_COLOR", min: 0, max: 25, step: 1 },
    { key: "PLAYER_HEALTHBAR_ACCENT_COLOR", min: 0, max: 25, step: 1 },
    { key: "BOTTOM_BAR_WASH_COLOR", min: 0, max: 25, step: 1 },
    { key: "KEYBOARD_OVERLAY_WASH_COLOR", min: 0, max: 25, step: 1 },
    { key: "STAMINA_CHARGE_COLOR", min: 0, max: 25, step: 1 },
    { key: "AMMO_TEXT_COLOR", min: 0, max: 25, step: 1 }
];
const COMBAT_INDICATOR_SCHEMA_FIELDS = [
    { key: "ENABLE_COMBAT_INDICATOR", min: 0, max: 1, step: 1 }
];
const STAMINA_CHARGE_SCHEMA_FIELDS = [
    { key: "STAMINA_CHARGE_ANGLE", min: 0, max: 360, step: 1 }
];
const CLEAN_DAMAGE_INDICATORS_SCHEMA_FIELDS = [
    { key: "ENABLE_CLEAN_DAMAGE_INDICATORS", min: 0, max: 1, step: 1 }
];
const SHOP_STATS_MINIMALIST_SCHEMA_FIELDS = [
    { key: "ENABLE_SIMPLIFY_SHOP_STATS", min: 0, max: 1, step: 1 }
];
const ENHANCED_QUICKBUY_SCHEMA_FIELDS = [
    { key: "ENABLE_ENHANCED_QUICKBUY", min: 0, max: 1, step: 1 }
];
const ENHANCED_QUICKBUY_COUNT_SCHEMA_FIELDS = [
    { key: "ENHANCED_QUICKBUY_COUNT", min: 1, max: 5, step: 1 }
];
const SHOP_PURCHASE_FEATURE_SCHEMA_FIELDS = [
    { key: "ENABLE_SHOP_CLICK_TO_NOTIFY", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SHOP_RECENT_PURCHASES", min: 0, max: 1, step: 1 }
];
const RECENT_PURCHASES_QUICK_SCHEMA_FIELDS = [
    { key: "RECENT_PURCHASES_QUICK_MAX",         min: 1,    max: 5,   step: 1    },
    { key: "RECENT_PURCHASES_QUICK_DISPLAY_SEC", min: 3,    max: 15,  step: 1    },
    { key: "RECENT_PURCHASES_QUICK_X_OFFSET",    min: -500, max: 500, step: 5    },
    { key: "RECENT_PURCHASES_QUICK_Y_OFFSET",    min: -500, max: 500, step: 5    },
    { key: "RECENT_PURCHASES_QUICK_REJUV",       min: 0,    max: 1,   step: 1    },
    { key: "RECENT_PURCHASES_QUICK_SCOREBOARD",  min: 0,    max: 1,   step: 1    },
    { key: "RECENT_PURCHASES_QUICK_SCALE",       min: 0.5,  max: 1.5, step: 0.05 },
    { key: "RECENT_PURCHASES_PANEL_X_OFFSET",    min: -500, max: 500, step: 5    },
    { key: "RECENT_PURCHASES_PANEL_Y_OFFSET",    min: -500, max: 500, step: 5    },
    { key: "RECENT_PURCHASES_PANEL_SCALE",       min: 0.5,  max: 2.0, step: 0.05 }
];
const RECENT_PURCHASES_OPACITY_SCHEMA_FIELDS = [
    { key: "RECENT_PURCHASES_QUICK_OPACITY", min: 0, max: 1, step: 0.05 },
    { key: "RECENT_PURCHASES_PANEL_OPACITY", min: 0, max: 1, step: 0.05 }
];
const HERO_PURCHASE_POPUPS_SCHEMA_FIELDS = [
    { key: "ENABLE_HERO_PURCHASE_POPUPS", min: 0, max: 1, step: 1 }
];
const SHOW_BUILD_ID_SCHEMA_FIELDS = [
    { key: "ENABLE_SHOW_BUILD_ID", min: 0, max: 1, step: 1 },
    { key: "ENABLE_SHOW_BUILD_ID_TITLE", min: 0, max: 1, step: 1 }
];
const DL4D_REMINDER_SCHEMA_FIELDS = [
    { key: "ENABLE_DL4D_REMINDERS", min: 0, max: 1, step: 1 },
    { key: "DL4D_VOLUME", min: 0, max: 100, step: 1 },
    { key: "ENABLE_DL4D_CAPTIONS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_SMALL_CAMPS_BOXES", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_RUNE_MELEE_TROOPERS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_MEDIUM_CAMPS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_BIG_CAMPS_SINNERS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_MIDBOSS_URN_GOLD_RUNE", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_LANE_GUARDIAN_WEAK", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_RUNE", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_WALKER_WEAK", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_RUNE_FAST_TROOPERS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_RUNE_GOLD_BUFFS", min: 0, max: 1, step: 1 },
    { key: "ENABLE_DL4D_RUNE_TROOPERS20_HP", min: 0, max: 1, step: 1 }
];
const QUICKBUY_CLICK_TO_NOTIFY_SCHEMA_FIELDS = [
    { key: "ENABLE_QUICKBUY_CLICK_TO_NOTIFY", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_2_3_5= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_3_4,
    [
        { key: "DISABLE_PLAYER_NAME_BLUR", min: 0, max: 1, step: 1 }
    ]
);
var QOL_COMPACT_SCHEMA_2_3_6 = QOL_COMPACT_SCHEMA_2_3_5;
var QOL_COMPACT_SCHEMA_2_3_7 = QOL_COMPACT_SCHEMA_2_3_6;
var QOL_COMPACT_SCHEMA_2_4_0= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
            QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
                QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
                    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
                        QOL_COMPACT_SCHEMA_2_3_7,
                        TOPBAR_HP_WARNING_SCHEMA_FIELDS
                    ),
                    COMBAT_INDICATOR_SCHEMA_FIELDS
                ),
                HUD_BAR_AND_SHOP_SCHEMA_FIELDS
            ),
            HUD_SECTION_AND_PANEL_SCHEMA_FIELDS
        ),
        MINIMAP_CRATE_OVERLAY_SCHEMA_FIELDS
    ),
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        SHOP_STATS_MINIMALIST_SCHEMA_FIELDS,
        ENHANCED_QUICKBUY_SCHEMA_FIELDS
    )
);
var QOL_COMPACT_SCHEMA_2_5_0= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_4_0,
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        SHOP_PURCHASE_FEATURE_SCHEMA_FIELDS,
        MINIMAP_REM_TUNNELS_SCHEMA_FIELDS
    )
);
var QOL_COMPACT_SCHEMA_2_5_1= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_5_0,
    MINIMAP_ELEVATION_MARKERS_SCHEMA_FIELDS
);
var QOL_COMPACT_SCHEMA_2_5_2= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_5_1,
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
            HUD_BAR_AND_SHOP_SCALE_SCHEMA_FIELDS,
            ZOOM_REM_TUNNELS_SCHEMA_FIELDS
        ),
        DAMAGE_IMPACT_SCHEMA_FIELDS
    )
);
var QOL_COMPACT_SCHEMA_2_5_3= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_5_2,
    SETTINGS_THEME_SCHEMA_FIELDS
);
var QOL_COMPACT_SCHEMA_2_5_4= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_2_5_3,
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
            PALETTE_PICKER_SCHEMA_FIELDS_2_5_4,
            STAMINA_CHARGE_SCHEMA_FIELDS
        ),
        CLEAN_DAMAGE_INDICATORS_SCHEMA_FIELDS
    )
);
var QOL_COMPACT_SCHEMA_2_5_5= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(
        QOL_COMPACT_SCHEMA_2_5_4,
        PALETTE_PICKER_SCHEMA_FIELDS
    ),
    PALETTE_PICKER_SCHEMA_FIELDS
);
var QOL_COMPACT_SCHEMA_2_5_6 = QOL_COMPACT_SCHEMA_2_5_5;
var QOL_COMPACT_SCHEMA_2_5_7= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_5_6, RECENT_PURCHASES_QUICK_SCHEMA_FIELDS);
var QOL_COMPACT_SCHEMA_2_5_8= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_5_7, SHOW_BUILD_ID_SCHEMA_FIELDS);
var QOL_COMPACT_SCHEMA_2_5_9= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_5_8, DL4D_REMINDER_SCHEMA_FIELDS);
var QOL_COMPACT_SCHEMA_2_5_10= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_5_9, QUICKBUY_CLICK_TO_NOTIFY_SCHEMA_FIELDS);
var QOL_COMPACT_SCHEMA_2_5_11= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(QOL_COMPACT_SCHEMA_2_5_10, RECENT_PURCHASES_OPACITY_SCHEMA_FIELDS);
var QOL_COMPACT_SCHEMA_2_6_0 = QOL_COMPACT_SCHEMA_2_5_11;
var QOL_COMPACT_SCHEMA_2_6_1 = QOL_COMPACT_SCHEMA_2_6_0;
var QOL_COMPACT_SCHEMA_3_0_0 = QOL_COMPACT_SCHEMA_2_6_1;
var QOL_COMPACT_SCHEMA_3_0_2= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(
    QOL_COMPACT_SCHEMA_3_0_0,
    [{ key: "LANGUAGE", min: 0, max: 10, step: 1 }]
);
var QOL_COMPACT_SCHEMA_3_0_3= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_0_2,
    ENHANCED_QUICKBUY_COUNT_SCHEMA_FIELDS
);
var QOL_COMPACT_SCHEMA_3_0_4= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(
    QOL_COMPACT_SCHEMA_3_0_3,
    [{ key: "LANGUAGE", min: 0, max: 11, step: 1 }]
);
var QOL_COMPACT_SCHEMA_3_0_5= QOL_COMPACT_SCHEMA_UTILS.CloneSchemaWithFieldOverrides(
    QOL_COMPACT_SCHEMA_3_0_4,
    SETTINGS_THEME_SCHEMA_FIELDS_3_0_5
);
var QOL_COMPACT_SCHEMA_3_1_0 = QOL_COMPACT_SCHEMA_3_0_5;
var QOL_COMPACT_SCHEMA_3_1_1= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_0,
    HERO_PURCHASE_POPUPS_SCHEMA_FIELDS
);
// Fix: ENABLE_SHOP_ITEM_NOTIFICATIONS was missing from the compact schema.
// The legacy key ENABLE_SHOP_CLICK_TO_NOTIFY was included but not the canonical key.
const SHOP_ITEM_NOTIFICATION_SCHEMA_FIELDS = [
    { key: "ENABLE_SHOP_ITEM_NOTIFICATIONS", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_3_1_2= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_1,
    SHOP_ITEM_NOTIFICATION_SCHEMA_FIELDS
);
// 3.1.3: Add ally healthbar, perf debug, specials, drag, and previews keys
// that were defined in QOL_DEFAULT_CONFIG but missing from compact serialization.
var QOL_COMPACT_SCHEMA_3_0_6_MISSING_FIELDS = [
    { key: "ENABLE_ALLY_COLORED_HEALTHBAR", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ALLY_COLOR_WARNING_25", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ALLY_COLOR_WARNING_65", min: 0, max: 1, step: 1 },
    { key: "ENABLE_ALLY_COLOR_WARNING_75", min: 0, max: 1, step: 1 },
    { key: "ENABLE_PERF_DEBUG", min: 0, max: 1, step: 1 },
    { key: "ENABLE_PERF_DEBUG_DETAIL", min: 0, max: 1, step: 1 },
    { key: "ENABLE_PERF_OVERLAY", min: 0, max: 1, step: 1 },
    { key: "PERF_ALERT_THRESHOLD_MS", min: 1, max: 50, step: 1 },
    { key: "PERF_OVERLAY_OPACITY", min: 0.3, max: 1.0, step: 0.05 },
    { key: "ENABLE_SPECIALS", min: 0, max: 1, step: 1 },
    { key: "DRAG_ENABLED", min: 0, max: 1, step: 1 },
    { key: "PREVIEWS_ENABLED", min: 0, max: 1, step: 1 }
];
// 3.0.6: Full schema including the missing fields that were added as 3.0.6.
// Reconstructed for backward compatibility — saves encoded with 3.0.6 must decode.
var QOL_COMPACT_SCHEMA_3_0_6= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_0_5,
    QOL_COMPACT_SCHEMA_3_0_6_MISSING_FIELDS
);
var QOL_COMPACT_SCHEMA_3_1_3= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_2,
    QOL_COMPACT_SCHEMA_3_0_6_MISSING_FIELDS
);
var QOL_COMPACT_SCHEMA_3_1_4_EXTRA_FIELDS = [
    { key: "UNIT_TARGET_HINT_SIZE", min: 50, max: 200, step: 5 }
];
var QOL_COMPACT_SCHEMA_3_1_4= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_3,
    QOL_COMPACT_SCHEMA_3_1_4_EXTRA_FIELDS
);

// 3.1.5: Add ShowRank feature key (SHOW_RANK).
var SHOWRANK_SCHEMA_FIELDS = [
    { key: "SHOW_RANK", min: 0, max: 1, step: 1 },
    { key: "SHOW_RANK_TOPBAR", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_3_1_5= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_4,
    SHOWRANK_SCHEMA_FIELDS
);
var COMPASS_SPEED_OFFSET_SCHEMA_FIELDS = [
    { key: "COMPASS_SPEED_X_OFFSET", min: -2000, max: 2000, step: 5 },
    { key: "COMPASS_SPEED_Y_OFFSET", min: -2000, max: 2000, step: 5 }
];
// 3.1.6 (in development): minimalistic pause toggle + rift spawn timer.
var MINIMALISTIC_PAUSE_SCHEMA_FIELDS = [
    { key: "ENABLE_MINIMALISTIC_PAUSE", min: 0, max: 1, step: 1 }
];
var URN_TIMER_SCHEMA_FIELDS = [
    { key: "ENABLE_URN_TIMER", min: 0, max: 1, step: 1 }
];
// 3.1.6 (in development): rotate the ammo magazine visualiser (#clip_status).
var AMMO_CLIP_SCHEMA_FIELDS = [
    { key: "AMMO_CLIP_ANGLE", min: 0, max: 360, step: 1 }
];
var QOL_COMPACT_SCHEMA_3_1_6= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_5,
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
            COMPASS_SPEED_OFFSET_SCHEMA_FIELDS,
            QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
                MINIMALISTIC_PAUSE_SCHEMA_FIELDS,
                URN_TIMER_SCHEMA_FIELDS
            )
        ),
        AMMO_CLIP_SCHEMA_FIELDS
    )
);
// 3.1.7: Crosshair Active Stats — mirror active buffs/debuffs vertically by the crosshair.
var CROSSHAIR_STATS_SCHEMA_FIELDS = [
    { key: "ENABLE_CROSSHAIR_STATS", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_DEBUFFS", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_BUFFS", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_X_OFFSET", min: -500, max: 500, step: 5 },
    { key: "CROSSHAIR_STATS_Y_OFFSET", min: -500, max: 500, step: 5 },
    { key: "CROSSHAIR_STATS_SCALE", min: 50, max: 200, step: 1 },
    { key: "CROSSHAIR_STATS_OPACITY", min: 0, max: 1, step: 0.05 }
];
// 3.1.7: Player Stats — move the #hudPlayerStats panel (active + TAB-detailed view)
// left/right with X/Y offsets, and optionally hide either view. STATS_POSITION_SIDE: 0=left
// (default), 1=right. HIDE_* keys move the panel offscreen (NOT collapse) so the Crosshair
// Active Stats mirror keeps reading it; NORMAL = compact view, SCOREBOARD = TAB-detailed view.
var STATS_POSITION_SCHEMA_FIELDS = [
    { key: "ENABLE_STATS_POSITION", min: 0, max: 1, step: 1 },
    { key: "STATS_POSITION_SIDE", min: 0, max: 1, step: 1 },
    { key: "STATS_POSITION_X_OFFSET", min: -500, max: 500, step: 5 },
    { key: "STATS_POSITION_Y_OFFSET", min: -500, max: 500, step: 5 },
    { key: "STATS_POSITION_HIDE_NORMAL", min: 0, max: 1, step: 1 },
    { key: "STATS_POSITION_HIDE_SCOREBOARD", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_3_1_7= QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
        QOL_COMPACT_SCHEMA_3_1_6,
        CROSSHAIR_STATS_SCHEMA_FIELDS
    ),
    STATS_POSITION_SCHEMA_FIELDS
);
// 3.1.8: per-stat visibility toggles for the Crosshair Active Stats overlay. Each gates one
// modifier row (firerate, move speed, resists, lifesteal, etc.); all default on (1).
var CROSSHAIR_STATS_PERSTAT_SCHEMA_FIELDS = [
    { key: "CROSSHAIR_STATS_SHOW_FIRERATE", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_MOVESPEED", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_HEALAMP", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_BULLETRESIST", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_TECHRESIST", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_BULLETLIFESTEAL", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_TECHLIFESTEAL", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_WEAPONPOWER", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_SPIRIT", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_RANGE", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_DURATION", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_DAMAGEAMP", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_CLIPSIZE", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_REGEN", min: 0, max: 1, step: 1 },
    { key: "CROSSHAIR_STATS_SHOW_BULLETEVASION", min: 0, max: 1, step: 1 }
];
var QOL_COMPACT_SCHEMA_3_1_8 = QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_3_1_7,
    CROSSHAIR_STATS_PERSTAT_SCHEMA_FIELDS
);
var QOL_COMPACT_SCHEMA_3_1_9 = QOL_COMPACT_SCHEMA_3_1_8;
// 3.2.0 adds no payload fields — same wire layout as 3.1.9, so tokens written by
// either version decode identically. The bump exists to version the release, not
// the wire format (QOL_SCHEMA_WIRE_VERSION stays 2).
var QOL_COMPACT_SCHEMA_3_2_0 = QOL_COMPACT_SCHEMA_3_1_9;
// 4.0.0 adds no payload fields — same wire layout as 3.2.0, so tokens written by
// either version decode identically. The bump exists to version the release, not
// the wire format (QOL_SCHEMA_WIRE_VERSION stays 2).
var QOL_COMPACT_SCHEMA_4_0_0 = QOL_COMPACT_SCHEMA_3_2_0;
var QOL_COMPACT_SCHEMA_4_0_1 = QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_4_0_0,
    [{ key: "MINIMAP_FIXED_ICON_SIZE", min: 0, max: 1, step: 1 }]
);
// 4.0.2 changes no payload fields; retain the 4.0.1 wire layout.
var QOL_COMPACT_SCHEMA_4_0_2 = QOL_COMPACT_SCHEMA_4_0_1;
// 4.0.3 changes no payload fields; retain the 4.0.2 wire layout.
var QOL_COMPACT_SCHEMA_4_0_3 = QOL_COMPACT_SCHEMA_4_0_2;
// 4.0.4 changes no payload fields; retain the 4.0.3 wire layout.
var QOL_COMPACT_SCHEMA_4_0_4 = QOL_COMPACT_SCHEMA_4_0_3;
var QOL_COMPACT_SCHEMA_4_0_5 = QOL_COMPACT_SCHEMA_UTILS.AppendUniqueSchemaFields(
    QOL_COMPACT_SCHEMA_4_0_4,
    [
        { key: "ACTIVE_ITEMS_SCALE", min: 50, max: 250, step: 1 },
        { key: "ACTIVE_ITEMS_X_OFFSET", min: -1500, max: 1500, step: 1 },
        { key: "ACTIVE_ITEMS_Y_OFFSET", min: -500, max: 500, step: 1 }
    ]
);


// ==========================================================================
// Compact schema version history
// ==========================================================================
// 2.0.0        Initial compact schema (wire version 1, 69 fields from V60).
// 2.0.1        Wire version 2. Added on-death games, DL4D, enemy V2, and
//              quickbuy notification fields.
// 2.1.x        Language max, friends list, center ESC, HUD shift, build ID.
// 2.2.0        Large batch: passive cooldowns, keyboard overlay, zip boost,
//              unsecured souls, minimap rotate/flip, topbar HP warnings, urn.
// 2.2.1-2.2.6  Chat, legacy cooldowns, LANGUAGE max progression (3→6).
// 2.2.7-2.2.10 Minimap additions: flip, mid boss, buff timers on bridge.
// 2.3.x        BHOP, healthbar type (0–5), images in chat, Minecraft numbers,
//              player name blur toggle.
// 2.4.0        Topbar HP warnings, combat indicator, HUD bar/shop toggles,
//              minimap crate overlay, shop stats simplification, quickbuy.
// 2.5.x        Progressive additions: recent purchases, minimap tunnels,
//              elevation markers, zoom tunnels, damage impact, settings theme,
//              palette picker, stamina charge, damage numbers, DL4D, show build
//              ID. Each minor version added 1–3 fields.
// 2.6.x        Aliases for 2.5.11.
// 3.0.0        Major version bump (alias for 2.6.1).
// 3.0.1-3.0.6  LANGUAGE max →10→11, SETTINGS_THEME max→6, 12 missing fields
//              (ally healthbar, perf debug, specials, drag, previews).
// 3.1.0-3.1.4  Hero purchase popups, shop item notifications fix, 12-field
//              reconstruction, UNIT_TARGET_HINT_SIZE.
// 3.1.5-3.1.6  ShowRank + standalone compass speed offsets + minimalistic pause +
//              urn spawn timer + ammo magazine visualiser rotation.
// 3.1.7        Crosshair Active Stats: mirror active buffs/debuffs vertically by
//              the crosshair (master toggle + debuff/buff filters + offset/scale/opacity).
//              + Player Stats Position: move #hudPlayerStats (active + TAB-detailed view)
//              left/right with X/Y offsets (master toggle + side + offsets).
// 3.1.8        Crosshair Active Stats: per-stat visibility toggles (15 fields) so users can
//              hide individual modifier rows (firerate, move speed, resists, lifesteal, ...).
//              All default on.
// 4.0.5        Active item slot scale and X/Y offsets.
// ==========================================================================
// Known issue: ENABLE_COLORED_HEALTHBAR appears twice in V24+ schemas
// (once from V2 base, once from V24 concat). Harmless — the decode
// overwrite produces the same value — but costs 2 bits per payload.
// Not fixed to preserve binary compatibility with existing exports.
// ==========================================================================
var QOL_COMPACT_SCHEMA_REGISTRY = {
    // 2.0.0: Initial compact schema (wire version 1)
    "2.0.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_0,
        schema: QOL_COMPACT_SCHEMA_2_0_0
    },
    "2.0.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_0_1
    },
    "2.1.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_1_1
    },
    "2.1.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_1_1
    },
    "2.1.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_1_2
    },
    "2.2.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_0
    },
    "2.2.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_1
    },
    "2.2.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_2
    },
    "2.2.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_3
    },
    "2.2.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_4
    },
    "2.2.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_5
    },
    "2.2.6": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_6
    },
    "2.2.7": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_7
    },
    "2.2.8": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_7
    },
    "2.2.9": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_7
    },
    "2.2.10": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_10
    },
    "2.3.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_2_10
    },
    "2.3.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_1
    },
    "2.3.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_1
    },
    "2.3.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_3
    },
    "2.3.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_4
    },
    "2.3.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_5
    },
    "2.3.6": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_6
    },
    "2.3.7": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_3_7
    },
    "2.4.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_4_0
    },
    "2.5.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_0
    },
    "2.5.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_1
    },
    "2.5.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_2
    },
    "2.5.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_3
    },
    "2.5.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_4
    },
    "2.5.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_5
    },
    "2.5.6": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_6
    },
    "2.5.7": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_7
    },
    "2.5.8": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_8
    },
    "2.5.9": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_9
    },
    "2.5.10": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_10
    },
    "2.5.11": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_5_11
    },
    "2.6.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_6_0
    },
    "2.6.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_2_6_1
    },
    "3.0.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_0
    },
    "3.0.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_0
    },
    "3.0.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_2
    },
    "3.0.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_3
    },
    "3.0.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_4
    },
    "3.0.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_5
    },
    "3.0.6": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_0_6
    },
    "3.1.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_0
    },
    "3.1.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_1
    },
    "3.1.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_2
    },
    "3.1.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_3
    },
    "3.1.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_4
    },
    "3.1.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_5
    },
    "3.1.6": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_6
    },
    "3.1.7": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_7
    },
    "3.1.8": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_8
    },
    "3.1.9": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_1_9
    },
    "3.2.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_3_2_0
    },
    "4.0.0": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_0
    },
    "4.0.1": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_1
    },
    "4.0.2": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_2
    },
    "4.0.3": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_3
    },
    "4.0.4": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_4
    },
    "4.0.5": {
        wireVersion: QOL_COMPACT_WIRE_VERSION_2_0_1,
        schema: QOL_COMPACT_SCHEMA_4_0_5
    }
};
var QOL_COMPACT_SCHEMA_WIRE_TO_SEMVER = (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.BuildWireToSemver === "function")
    ? QOL_CODEC.BuildWireToSemver(QOL_COMPACT_SCHEMA_REGISTRY)
    : {};

QOL_COMPACT_SCHEMA_UTILS.GetSchema = function(semver) {
    var key = String(semver || "");
    var entry = QOL_COMPACT_SCHEMA_REGISTRY[key];
    if (!entry || !Array.isArray(entry.schema)) throw new Error("Unsupported compact schema semver");
    return entry.schema;
}

QOL_COMPACT_SCHEMA_UTILS.GetWireVersion = function(semver) {
    var key = String(semver || "");
    var entry = QOL_COMPACT_SCHEMA_REGISTRY[key];
    if (!entry) throw new Error("Unsupported compact schema semver");
    var wireVersion = Math.max(0, Math.round(Number(entry.wireVersion) || 0));
    if (wireVersion <= 0) throw new Error("Invalid compact schema wire version");
    return wireVersion;
}

QOL_COMPACT_SCHEMA_UTILS.ResolveSemverFromWire = function(wireVersion) {
    var semver = (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.ResolveSemverFromWire === "function")
        ? QOL_CODEC.ResolveSemverFromWire(QOL_COMPACT_SCHEMA_WIRE_TO_SEMVER, QOL_COMPACT_SCHEMA_REGISTRY, wireVersion)
        : "";
    if (!semver || !QOL_COMPACT_SCHEMA_REGISTRY[semver]) throw new Error("Unsupported compact schema wire version");
    return semver;
}

QOL_COMPACT_SCHEMA_UTILS.AreSemversWireCompatible = function(expectedSemver, resolvedSemver) {
    var expected = String(expectedSemver || "");
    var resolved = String(resolvedSemver || "");
    if (!expected || !resolved) return false;
    if (expected === resolved) return true;
    if (!QOL_COMPACT_SCHEMA_REGISTRY.hasOwnProperty(expected)) return false;
    if (!QOL_COMPACT_SCHEMA_REGISTRY.hasOwnProperty(resolved)) return false;
    try {
        return QOL_COMPACT_SCHEMA_UTILS.GetWireVersion(expected) === QOL_COMPACT_SCHEMA_UTILS.GetWireVersion(resolved);
    } catch (eWire) {
        return false;
    }
}


QOL.legacyCompact = { registry: QOL_COMPACT_SCHEMA_REGISTRY, utils: QOL_COMPACT_SCHEMA_UTILS };
QOL.compactSchemaRegistry = QOL_COMPACT_SCHEMA_REGISTRY;
var QOL_LATEST_COMPACT_SEMVER = "4.0.5";
QOL.latestCompactSemver = QOL_LATEST_COMPACT_SEMVER;

QOL_CODEC.DeserializeLegacySettings = function(raw, expectedSemver) {
    if (!raw) throw new Error("Compact string too short");
    const wire = raw.charCodeAt(0) & 255;
    const version = expectedSemver || QOL_COMPACT_SCHEMA_UTILS.ResolveSemverFromWire(wire);
    if (QOL_COMPACT_SCHEMA_UTILS.GetWireVersion(version) !== wire) throw new Error("Compact schema wire version mismatch");
    return QOL_CODEC.DeserializeCompactBinary(raw, QOL_COMPACT_SCHEMA_UTILS.GetSchema(version), (field, value, parsed) => {
        if (field.key !== QOL_COMPACT_DEFAULT_HERO_FIELD) return false;
        parsed.DEFAULT_HERO = QOL_COMPACT_DEFAULT_HERO_OPTIONS[Math.round(value)] || QOL_DEFAULT_CONFIG.DEFAULT_HERO;
        return true;
    }, (field, parsed) => {
        if (field.key === QOL_COMPACT_DEFAULT_HERO_FIELD) parsed.DEFAULT_HERO = QOL_DEFAULT_CONFIG.DEFAULT_HERO;
        else if (Object.prototype.hasOwnProperty.call(QOL_DEFAULT_CONFIG, field.key)) parsed[field.key] = QOL_DEFAULT_CONFIG[field.key];
    });
};
