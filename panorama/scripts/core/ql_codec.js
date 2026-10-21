// Pure JSON settings sharing and legacy import adapters. No UI or persistence actions.
(() => {
    "use strict";
    const Q = globalThis.QOL;
    const codec = () => QOL_CODEC;
    Q.core.codec = {
        serializeSettings: config => codec().SerializeSettings(config),
        deserializeSettings: (raw, version) => codec().DeserializeSettings(raw, version),
        encodeBase64: value => codec().EncodeBase64Raw(value),
        decodeBase64: value => codec().DecodeBase64(value),
        toBase64Url: value => codec().ToBase64Url(value),
        fromBase64Url: value => codec().FromBase64Url(value)
    };
})();
