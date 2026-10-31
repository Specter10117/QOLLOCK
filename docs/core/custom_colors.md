# Custom RGB colors

Supported palette owners accept either their existing palette index or a tagged
RGB integer. `QOL_UTILS.SupportsCustomColor` is the authoritative key whitelist;
it covers inventory, stamina, ammo text, bottom bar, keyboard overlay, healthbar
accent and minimap icons. Existing defaults remain unchanged. No setting keys
were added. The shared helpers in `ql_utils.js` encode `#RRGGBB`
as an RGB payload in a reserved numeric band and resolve it back to a color.
The tag distinguishes literal black from native/default. Invalid HEX input is
rejected; it must not replace a previous value.

Historical compact schemas retain their original bounds, order and palette
meanings. New clipboard exports use [lossless settings codes](settings_codes.md)
and preserve tagged colors without the historical palette bounds. Both runtime
contexts read these codes as well as old binary and JSON envelope tokens.
Storage continues to use JSON with the tagged numeric values. Historical schema
versions remain unchanged; older clients cannot read the new `-C` tokens.

The ordinary palette rows preserve an existing custom value when synchronizing.
Choosing a swatch replaces it with that palette index; choosing Default uses the
owning feature's native reset path. Custom RGB does not replace charge-state,
warning or team logic. Opacity remains a separate setting.

Offline tests cover tagged black/white, malformed input, HUD delivery,
export/import and historical schema preservation. Actual native tint and reset
still require a maintainer compile/repack and client check.
