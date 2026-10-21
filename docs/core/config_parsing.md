# Configuration parsing

`panorama/scripts/ql_config.js` provides default merging, setting normalization, compatibility migrations, and storage parsing to both HUD and Escape Menu contexts. It uses the shared schema utilities and envelope helpers from `ql_shared_presets.js`.

## Asynchronous persistence boundary

`ParseStoredConfig(raw)`, exported as `QOL.parseStoredConfig`, is a side-effect-free parser for bridge save/restore operations. It accepts a configuration object in the schema envelope or legacy flat JSON form. Arrays, scalar roots, malformed envelopes, nested/null values for recognized settings, and nonempty objects with no recognized keys are rejected.

The parser copies recognized primitive settings into a fresh object, then runs the existing `MergeConfig` normalization chain. Unknown keys are omitted from the resulting configuration. Recognized values also use the shared `QOL.settings` type/range/step contract.
Malformed setting types reject before publication; compatible numeric strings
are accepted. ConfigStore retains feature-bucket validation and uses the same
current numeric normalization.

Bridge operations serialize the accepted result into a canonical envelope before publishing or saving it. Later HUD reads therefore see normalized data rather than the original untrusted raw object. Validation rejection must not clear panel attributes, replace MOD_CONFIG, or reset State.lastConfig.

## Sharing unpublished settings

The current release and schema numbers remain unchanged until the maintainer
authorizes a version change. `QOL_SETTINGS_FIELDS` describes current control
ranges independently of historical compact layouts. Every new export uses the full JSON storage envelope inside the existing
Base64Url token. Both sharing contexts use the same writer and reader. Unicode
is preserved with JSON escapes through the byte-oriented Base64 codec.
`ql_legacy_compact.js` owns frozen historical tables and binary decoding only;
its development encoder lives in `scripts/legacy_compact_encoder.js` and is not
included by runtime XML. Current settings metadata is declared independently.
Older clients without envelope-token support cannot import new exports. Old
binary codes and existing envelopes remain readable.

## Legacy parsing and compatibility

`SafeParseConfig(raw)` remains the legacy HUD parsing entry point. Its error recovery can clear the context panel's corrupt configuration and report a defaults fallback. Asynchronous bridge operations must use `ParseStoredConfig` instead, because an unsuccessful restore must preserve the live session.

`MergeConfig` starts with defaults, overlays recognized values, and applies the established compatibility normalizers, including split minimap zoom, ammo scales, cooldown modes, healthbar type, and warning settings. Successful JSON parsing alone does not establish valid storage data; envelope
shape and recognized setting types are checked before bridge publication.

`NormalizeConfigFields(target, source)`, also `QOL.normalizeConfigFields`, owns
the shared in-place compatibility chain used by `MergeConfig`, settings load/save
and settings-code import. Import-only language/compass migrations stay in the
settings adapter where the original schema version is available. Current control
diagnostics and preserved UI preferences remain separate from HUD merging.
Settings load uses the same side-effect-free parser rather than a second raw
envelope merge. Compatibility names delegate to these owners; compact layouts,
schema/release versions and existing persistent defaults are unchanged.

Current migrations and import defaults use `QOL_SCHEMA_SEMVER` directly. The
latest historical compact tag is frozen inside the legacy reader; it does not
select current metadata or define the current settings version. Modern import
diagnostics use `QOL.settings` normalization, while decoded old imports can
retain their historical field quantization before compatibility migration.
