// Shared setting semantics. Labels and historical codecs never determine behavior.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const fields = new Map(Q.settingsFields.map(field => [field.key, field]));
    const get = key => fields.get(key) || null;
    function normalize(key, value, clamp = true) {
        const field = get(key);
        if (!field) return null;
        if (field.kind === "text") return typeof value === "string" ? value : null;
        if (field.kind === "toggle") {
            if (value === true || value === 1 || value === "1") return 1;
            if (value === false || value === 0 || value === "0") return 0;
            return null;
        }
        if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) value = Number(value);
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        if (field.kind === "color") return Number.isInteger(value) && ((value >= 0 && value <= 29) ||
            (QOL_UTILS.SupportsCustomColor(key) && QOL_UTILS.IsCustomColor(value))) ? value : null;
        if (!clamp && (value < field.min || value > field.max)) return null;
        const bounded = Math.max(field.min, Math.min(field.max, value));
        return Number(Math.max(field.min, Math.min(field.max,
            field.min + Math.round((bounded - field.min) / field.step) * field.step)).toFixed(6));
    }
    function toDisplayValue(key, value) {
        const transform = get(key)?.displayTransform;
        if (transform === "nativeAngleDelta") return QOL_UTILS.NormalizeDegrees360(Number(value) - 45);
        if (transform === "nativeOriginUp") return Number(QOL_DEFAULT_CONFIG[key]) - Number(value);
        return Number(value);
    }
    function fromDisplayValue(key, value) {
        const transform = get(key)?.displayTransform;
        if (transform === "nativeAngleDelta") return QOL_UTILS.NormalizeDegrees360(Number(value) + 45);
        if (transform === "nativeOriginUp") return Number(QOL_DEFAULT_CONFIG[key]) - Number(value);
        return Number(value);
    }
    function displayBounds(key, min = get(key)?.min, max = get(key)?.max) {
        if (get(key)?.displayTransform === "nativeAngleDelta") return { min: 0, max: 360 };
        const a = toDisplayValue(key, min), b = toDisplayValue(key, max);
        return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    const readNumber = (key, value) => normalize(key, value) ?? QOL_DEFAULT_CONFIG[key];
    function normalizeConfig(target) {
        for (const key of Object.keys(target)) {
            if (!get(key)) continue;
            target[key] = normalize(key, target[key]) ?? QOL_DEFAULT_CONFIG[key];
        }
        return target;
    }
    Q.settings = { get, fields, normalize, normalizeConfig, readNumber, toDisplayValue, fromDisplayValue, displayBounds };
})();
