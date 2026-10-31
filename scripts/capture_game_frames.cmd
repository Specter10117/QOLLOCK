@echo off
setlocal
where pwsh.exe >nul 2>nul
if not errorlevel 1 (
    start "QOLLOCK native FPS capture" pwsh.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0capture_game_frames.ps1" %*
    exit /b
)
for %%P in ("%ProgramFiles%\PowerShell\7\pwsh.exe" "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe") do (
    if exist "%%~P" (
        start "QOLLOCK native FPS capture" "%%~P" -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0capture_game_frames.ps1" %*
        exit /b
    )
)
echo PowerShell 7 was not found. Install PowerShell 7, then run this launcher again.
pause
exit /b 1
