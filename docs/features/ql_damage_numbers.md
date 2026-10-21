# Damage number presentation

The `ql_damage_numbers` manifest owns native indicator size/opacity overrides
and small-number filtering. The shared HUD projector owns the Fountain, clean,
cumulative and trooper gates; retiring the manifest releases those gates without
changing persisted choices.

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
