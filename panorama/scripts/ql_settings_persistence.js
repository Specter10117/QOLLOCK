// ql_settings_persistence.js — Config serialization utilities (base64 encoding,
// JSON export, legacy import and settings-aware config apply)
// OWNS: Settings-code encoding/decoding and import diagnostics/UI preference preservation.
// DOES NOT OWN: Shared normalization, live panel publication or durable CEF storage.
(function() {
    'use strict';

    // ── Base64 encoding ──

function EncodeBase64Raw(str) {
    if (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.EncodeBase64Raw === "function") {
        return QOL_CODEC.EncodeBase64Raw(str);
    }
    return "";
}

function EncodeBase64(str) {
    var raw = EncodeBase64Raw(str);
    return raw && raw.length > 0 ? raw.match(/.{1,40}/g).join(" ") : "";
}

function DecodeBase64(str) {
    if (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.DecodeBase64 === "function") {
        return QOL_CODEC.DecodeBase64(str);
    }
    return "";
}

function GetDefaultConfig() {
    if (typeof QOL_DEFAULT_CONFIG === "object" && QOL_DEFAULT_CONFIG) {
        return QOL_DEFAULT_CONFIG;
    }
    if (typeof globalThis !== "undefined") {
        if (typeof globalThis.DEFAULT_CONFIG === "object" && globalThis.DEFAULT_CONFIG) return globalThis.DEFAULT_CONFIG;
        if (typeof globalThis.QOL_DEFAULT_CONFIG === "object" && globalThis.QOL_DEFAULT_CONFIG) return globalThis.QOL_DEFAULT_CONFIG;
        if (globalThis.QOL && typeof globalThis.QOL.defaultConfig === "object" && globalThis.QOL.defaultConfig) return globalThis.QOL.defaultConfig;
    }
    return {};
}

// ── Settings-code export/import adapters ──

function GetStepDecimals(step) {
    if (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.GetStepDecimals === "function") {
        return QOL_CODEC.GetStepDecimals(step);
    }
    var s = String(step);
    var idx = s.indexOf(".");
    return idx === -1 ? 0 : (s.length - idx - 1);
}

function ToBase64Url(binaryStr) {
    if (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.ToBase64Url === "function") {
        return QOL_CODEC.ToBase64Url(binaryStr);
    }
    return EncodeBase64Raw(binaryStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function FromBase64Url(urlStr) {
    if (typeof QOL_CODEC === "object" && QOL_CODEC && typeof QOL_CODEC.FromBase64Url === "function") {
        return QOL_CODEC.FromBase64Url(urlStr);
    }
    var padded = String(urlStr || "").replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4 !== 0) padded += "=";
    return DecodeBase64(padded);
}

const SerializeSettings = config => QOL_CODEC.SerializeSettings(config);
const DeserializeSettings = (raw, version) => QOL_CODEC.DeserializeSettings(raw, version);

function ApplyParsedConfig(parsed) {
    for (var key in parsed) {
        if (MOD_CONFIG.hasOwnProperty(key)) {
            MOD_CONFIG[key] = parsed[key];
        }
    }
    QOL.normalizeConfigFields(MOD_CONFIG, parsed);
    NormalizeLanguageSchemaMigration(MOD_CONFIG, parsed, QOL_SCHEMA_SEMVER);
}

function ClampToSchemaField(value, field) {
    if (!field) return { value: value, changed: false };
    if (QOL.settings?.get(field.key) === field) {
        const accepted = QOL.settings.normalize(field.key, value);
        const changed = accepted !== null && NormalizeComparableConfigValue(accepted) !== NormalizeComparableConfigValue(value);
        return { value: accepted ?? value, changed };
    }
    // Frozen import fields retain their historical quantization.
    var n = Number(value);
    if (!isFinite(n)) return { value: value, changed: false };
    var clamped = Math.max(Number(field.min), Math.min(Number(field.max), n));
    var step = Number(field.step);
    if (isFinite(step) && step > 0) {
        clamped = field.min + (Math.round((clamped - field.min) / step) * step);
    }
    var decimals = GetStepDecimals(field.step);
    clamped = decimals > 0 ? parseFloat(clamped.toFixed(decimals)) : Math.round(clamped);
    return { value: clamped, changed: NormalizeComparableConfigValue(clamped) !== NormalizeComparableConfigValue(value) };
}

function BuildSchemaFieldMap(version) {
    const semver = String(version || QOL_SCHEMA_SEMVER);
    // Only decoded historical imports consult frozen binary field metadata.
    const fields = semver === QOL_SCHEMA_SEMVER ? QOL.settingsFields : QOL.legacyCompact.utils.GetSchema(semver) || [];
    return Object.fromEntries(fields.filter(field => field?.key).map(field => [field.key, field]));
}

function ApplyParsedConfigWithDiagnostics(parsed, schemaVersion) {
    var diagnostics = {
        appliedKeys: 0,
        unknownKeys: 0,
        clampedKeys: 0
    };
    if (!parsed || typeof parsed !== "object") return diagnostics;

    var preservedDragEnabled = MOD_CONFIG.DRAG_ENABLED;
    var preservedPreviewsEnabled = MOD_CONFIG.PREVIEWS_ENABLED;
    var preservedUpdateCheckerEnabled = MOD_CONFIG.ENABLE_UPDATE_CHECKER;
    var fieldMap = BuildSchemaFieldMap(schemaVersion);
    var defConfig = GetDefaultConfig();
    for (var defaultKey in defConfig) {
        MOD_CONFIG[defaultKey] = defConfig[defaultKey];
    }
    for (var key in parsed) {
        if (!MOD_CONFIG.hasOwnProperty(key)) {
            diagnostics.unknownKeys++;
            continue;
        }
        var nextValue = parsed[key];
        var field = fieldMap[key] || null;
        if (field && typeof nextValue === "number") {
            var clampResult = ClampToSchemaField(nextValue, field);
            nextValue = clampResult.value;
            if (clampResult.changed) diagnostics.clampedKeys++;
        }
        MOD_CONFIG[key] = nextValue;
        diagnostics.appliedKeys++;
    }
    QOL.normalizeConfigFields(MOD_CONFIG, parsed);
    NormalizeCompassSpeedSchemaMigration(MOD_CONFIG, parsed, schemaVersion || QOL_SCHEMA_SEMVER);
    NormalizeLanguageSchemaMigration(MOD_CONFIG, parsed, schemaVersion || QOL_SCHEMA_SEMVER);
    MOD_CONFIG.DRAG_ENABLED = preservedDragEnabled;
    MOD_CONFIG.PREVIEWS_ENABLED = preservedPreviewsEnabled;
    if (preservedUpdateCheckerEnabled !== undefined) {
        MOD_CONFIG.ENABLE_UPDATE_CHECKER = preservedUpdateCheckerEnabled;
    }
    SetRuntimePresetName("");
    return diagnostics;
}


    // ── Public API ──
    QOL.persistence = {
        // Base64
        encodeBase64Raw: EncodeBase64Raw,
        encodeBase64: EncodeBase64,
        decodeBase64: DecodeBase64,
        toBase64Url: ToBase64Url,
        fromBase64Url: FromBase64Url,
        // Settings sharing
        serializeSettings: SerializeSettings,
        deserializeSettings: DeserializeSettings,
        applyParsedConfig: ApplyParsedConfig,
        applyParsedConfigWithDiagnostics: ApplyParsedConfigWithDiagnostics,
        buildSchemaFieldMap: BuildSchemaFieldMap,
        clampToSchemaField: ClampToSchemaField
    };
})();
