# Historical player preset tools

`decode_presets.js` and `apply_presets.js` are one-shot tools retained for old
binary share codes. They are not loaded by the game and are not the current
settings importer.

The decoder accepts version-tagged `[QOL-x-y-z]:...` binary tokens from its
hardcoded `PRESETS` array. It loads `ql_utils.js`, `ql_shared_presets.js` and
`ql_legacy_compact.js`, then writes sparse differences from current defaults to
`decoded_presets.json` beside the tool. Its hero-index mapping and missing-field
fallbacks are local historical logic, so its result is not guaranteed to match
the production importer's migrations.

Current Export writes lossless settings codes. This decoder does not load
`ql_settings_code.js` or use the current canonical parsing path; do not feed new
exports into it or use it to validate their compatibility. See
[settings codes](../../../../docs/core/settings_codes.md) and
[preset maintenance](../../../../docs/PRESET_BINDINGS.md).

For a deliberate old-code update:

1. Review the full token, schema and hero mapping before editing `PRESETS`.
2. Run `node panorama/scripts/tools/presets/decode_presets.js` from the repo root
   and inspect every decoded value and error. Successful file output alone is
   insufficient: individual decode errors are printed and can leave missing entries.
3. Review `TARGETS` and each existing preset block before running
   `node panorama/scripts/tools/presets/apply_presets.js`. It rewrites matching
   blocks in `ql_shared_presets.js` in place; it is not an interactive editor.
4. Review the source diff, exercise application and export/import through the
   production settings path, then run `npm test` before committing.

Presets can be sparse or complete objects. Do not infer the current default hero,
roster or codec format from the historical examples in these tools. Neither tool
publishes settings, compiles a mod or proves client behavior.
