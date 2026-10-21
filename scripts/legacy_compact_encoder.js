// Development-only frozen fixture encoder. Never included by Panorama XML.
"use strict";
function encodeBinary(config, schema, wire, resolve = (field, cfg) => cfg[field.key]) {
    const bytes = [wire], bits = [];
    for (const field of schema) {
        const slots = Math.round((field.max - field.min) / field.step) + 1;
        const width = Math.ceil(Math.log2(slots));
        const value = resolve(field, config);
        const numeric = typeof value === "number" && Number.isFinite(value) ? value : field.min;
        const index = Math.max(0, Math.min(slots - 1, Math.round((numeric - field.min) / field.step)));
        for (let bit = 0; bit < width; bit++) bits.push((index >> bit) & 1);
    }
    for (let offset = 0; offset < bits.length; offset += 8) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) byte |= (bits[offset + bit] || 0) << bit;
        bytes.push(byte);
    }
    bytes.push(bytes.reduce((sum, byte) => sum + byte, 0) & 255);
    return bytes.map(byte => String.fromCharCode(byte)).join("");
}
module.exports = function installLegacyEncoder(g) {
    g.QOL_CODEC.SerializeCompactBinary = encodeBinary;
    const encode = (config, version = g.QOL_SCHEMA_SEMVER) => {
        const entry = g.QOL.legacyCompact.registry[version];
        if (!entry) throw new Error("Unknown historical schema");
        return encodeBinary(config, entry.schema, entry.wireVersion, (field, cfg) => {
            if (field.key === "DEFAULT_HERO_INDEX") return Math.max(0,
                g.QOL_COMPACT_DEFAULT_HERO_OPTIONS.indexOf(cfg.DEFAULT_HERO || g.QOL_DEFAULT_CONFIG.DEFAULT_HERO));
            if (field.key === "ULT_COOLDOWN_X_OFFSET" || field.key === "ULT_COOLDOWN_Y_OFFSET") return 0;
            return cfg[field.key] ?? field.min;
        });
    };
    g.QOL.testEncodeLegacySettings = encode;
    return encode;
};
