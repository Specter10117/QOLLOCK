# Settings previews

The old floating **Preview Changes** samples and their settings-side owner have
been removed. Changing controls no longer creates sample minimaps, crosshairs,
health labels or other floating demonstration panels.

Live HUD previews remain owned by [Customize](customize.md) and
`ui/preset_preview.js`, using the leased transport in
`core/ql_customize_preview.js`. Audio test buttons, theme swatches and the
import confirmation diff retain their own owners.

The retired `PREVIEWS_ENABLED` key is ignored when old settings are restored or
imported. Its historical compact field and settings-code dictionary slot remain
frozen for compatibility; neither controls Auto-Save.

Auto-Save belongs to `ui/cloud_sync.js`; see
[storage bridge](../core/storage_bridge.md) for durable save semantics.
