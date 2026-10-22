# Damage number presentation

The `ql_damage_numbers` manifest owns native indicator size/opacity overrides.
CSS collapses small, cumulative (including final totals), and trooper events
without waiting for JavaScript label discovery. The shared HUD projector owns
the Fountain, clean, cumulative and trooper gates; retiring the manifest releases
those gates without changing persisted choices.

Size and opacity are edited directly beside the damage modes in the Crosshair
tab. These indicators follow world/combat events and have no HUD-canvas entry
or screen position controls.

The native `hud_event_indicator.css` import wrapper loads the preserved game
baseline before the QOLLOCK rules and Fountain keyframes. These rules must load
in the event indicator context; importing them only from HUD CSS is insufficient.

Fountain size is a current JSON setting exposed in the Crosshair tab. Its
size-specific root classes exist only while Fountain is enabled. The stylesheet
shares identical rules and namespaces its animation names so disabling Fountain
returns native indicators to their own presentation. Clean and visibility rules
load afterwards and retain their independent settings.

Offline tests cover reactive classes, ownership retirement and settings sharing.
After maintainer compilation/repacking, verify each size with gun, spirit, melee,
pure, critical, cumulative and healing indicators at different distances, plus
clean mode and small/trooper filtering. A static hierarchy without those events
does not establish native class coverage or animation behavior.
