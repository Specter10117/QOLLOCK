# Building QOLLOCK

This turns the mod's source files into a VPK that Deadlock can load.

1. Download [Reduced CSDK 12](https://deadlockmodding.pages.dev/modding-tools/csdk-12)
   and unpack it to `C:\Reduced_CSDK_12`.
2. Close Deadlock and double-click `build_mod.bat` in this folder.
   It already knows to build QOLLOCK.
3. Choose `1` to save the VPK in `build_mod/builds/`, or `2` to put it straight
   into Deadlock's `game/citadel/addons/` folder. Start the game to try it.

CSDK somewhere else? Enter `0` in the build menu, then `4` to set its folder.
Use `3` there to fix the Steam path if the game was not found. Settings are
remembered in `build_mod/data/config.json`; a saved destination skips the prompt.

Later builds compile changed files. Enter `1 -f` or `2 -f` for a full rebuild,
or launch `build_mod.bat -Force` if the destination prompt is skipped.
`S` starts Deadlock; `R` restarts it. The optional **BuildAndRestart** setting
installs into game addons and restarts the game after a successful build.

The builder comes from [Deadlock-Mod-Compiler](https://github.com/Predi-i/Deadlock-Mod-Compiler).
It builds this mod's `panorama`, `sounds` and `soundevents` folders.
Agents may edit the sources and documentation; compilation, VPK packing and
installation are maintainer actions.
