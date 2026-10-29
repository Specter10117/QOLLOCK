# Captures only the selected Deadlock process. Does not modify the game or addons.
[CmdletBinding()]
param(
    [int]$GameProcessId = 0,
    [string]$GameLog = '',
    [string]$PresentMonPath = '',
    [string]$OutputDirectory = '',
    [ValidateRange(30, 3600)][int]$MaxSeconds = 2100,
    [ValidateRange(0, 30)][int]$ProbeSeconds = 0,
    [string]$SwapChain = ''
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Native capture requires Windows and PowerShell 7.' }
Get-Command node -ErrorAction Stop | Out-Null
$gameProcesses = @(Get-Process -Name deadlock -ErrorAction SilentlyContinue)
if ($GameProcessId) { $gameProcess = Get-Process -Id $GameProcessId }
elseif ($gameProcesses.Count -eq 1) { $gameProcess = $gameProcesses[0] }
else { throw 'Expected one running Deadlock process. Supply -GameProcessId explicitly.' }
if ($gameProcess.ProcessName -ne 'deadlock') { throw 'The selected process is not Deadlock.' }
$targetProcessId = $gameProcess.Id
if (-not $GameLog) {
    $GameLog = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($gameProcess.Path)) '..\..\citadel\console.log'))
}
if (-not $ProbeSeconds -and -not (Test-Path -LiteralPath $GameLog -PathType Leaf)) {
    throw 'The game console log is unavailable. Supply -GameLog for an existing console log.'
}

$expectedDigest = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af'
if (-not $PresentMonPath) {
    $PresentMonPath = Join-Path $env:LOCALAPPDATA 'QOLLOCK\tools\PresentMon-2.6.0-x64.exe'
    if (-not (Test-Path -LiteralPath $PresentMonPath)) {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($PresentMonPath)) -Force | Out-Null
        Invoke-WebRequest -Uri 'https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe' -OutFile $PresentMonPath
    }
}
$PresentMonPath = (Resolve-Path -LiteralPath $PresentMonPath).Path
if ((Get-FileHash -LiteralPath $PresentMonPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedDigest) {
    throw 'PresentMon does not match the pinned official 2.6.0 executable SHA-256.'
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $PSScriptRoot ('..\captures\native-fps-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory already exists; refusing to overwrite a capture.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$csvPath = Join-Path $OutputDirectory 'frames.csv'
$metaPath = Join-Path $OutputDirectory 'capture.json'
$sourcePath = Join-Path $OutputDirectory 'source.json'
$sourceJson = & node (Join-Path $PSScriptRoot 'native_capture_identity.js')
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify local diagnostic sources; fix the reported source error before starting the investigation.' }
$sourceJson | Set-Content -LiteralPath $sourcePath -Encoding utf8
$sourceIdentity = $sourceJson | ConvertFrom-Json -AsHashtable
$gameFiles = @($gameProcess.Path,
    (Join-Path ([IO.Path]::GetDirectoryName($gameProcess.Path)) '..\..\citadel\bin\win64\client.dll'),
    (Join-Path ([IO.Path]::GetDirectoryName($gameProcess.Path)) 'panorama.dll'))
$gameIdentity = @($gameFiles | ForEach-Object {
    $candidate = [IO.Path]::GetFullPath($_)
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $item = Get-Item -LiteralPath $candidate
        @{ path = $candidate; bytes = $item.Length; modifiedUtc = $item.LastWriteTimeUtc.ToString('o');
            fileVersion = $item.VersionInfo.FileVersion; sha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() }
    } else { @{ path = $candidate; missing = $true } }
})

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QollockCaptureForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    public static uint ProcessId() {
        uint processId;
        GetWindowThreadProcessId(GetForegroundWindow(), out processId);
        return processId;
    }
    public static double[] Anchor() {
        long frequency = System.Diagnostics.Stopwatch.Frequency;
        long bestBefore = 0, bestAfter = 0, bestUtc = 0, bestSpan = long.MaxValue;
        for (int i = 0; i < 8; i++) {
            long before = System.Diagnostics.Stopwatch.GetTimestamp();
            long utc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            long after = System.Diagnostics.Stopwatch.GetTimestamp();
            if (after - before < bestSpan) {
                bestBefore = before; bestAfter = after; bestUtc = utc; bestSpan = after - before;
            }
        }
        return new double[] { bestBefore + (bestAfter - bestBefore) / 2.0, bestUtc, frequency, 1.0 + bestSpan * 1000.0 / frequency };
    }
}
'@
function Get-CaptureAnchor {
    # Sample within one managed call; PowerShell/JIT pauses between clock reads
    # must not become uncertainty in every captured frame's wall-clock alignment.
    $sample = [QollockCaptureForeground]::Anchor()
    return @{ qpc = $sample[0]; utcMs = $sample[1]; frequency = $sample[2]; uncertaintyMs = $sample[3] }
}
function New-CaptureProcess([string[]]$Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new($PresentMonPath)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    return [Diagnostics.Process]::Start($info)
}

$traceName = 'QOLLOCK-' + [guid]::NewGuid().ToString('N')
$duration = if ($ProbeSeconds) { $ProbeSeconds } else { $MaxSeconds }
$nativeWindows = [Collections.Generic.List[object]]::new()
$nativePackets = [Collections.Generic.List[object]]::new()
$rawNativePackets = [Collections.Generic.List[string]]::new()
$packetParseErrors = [Collections.Generic.List[string]]::new()
$focus = [Collections.Generic.List[object]]::new()
$anchors = @(Get-CaptureAnchor)
$session = $null
$kind = $null
$reason = 'capture-only'
$failure = $null
$nativeProcess = $null
$reader = $null
$stream = $null
$outputTask = $null
$errorTask = $null
$partialLine = ''
$stdout = ''
$stderr = ''
try {
    if (-not $ProbeSeconds) {
        $stream = [IO.FileStream]::new($GameLog, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $stream.Seek(0, [IO.SeekOrigin]::End) | Out-Null
        $reader = [IO.StreamReader]::new($stream)
    }
    $nativeProcess = New-CaptureProcess @('--process_id', [string]$targetProcessId, '--session_name', $traceName,
        '--output_file', $csvPath, '--timed', [string]$duration, '--terminate_after_timed', '--qpc_time', '--no_console_stats', '--no_track_input')
    $outputTask = $nativeProcess.StandardOutput.ReadToEndAsync()
    $errorTask = $nativeProcess.StandardError.ReadToEndAsync()
    $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $duration * 1000
    $startDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 60000
    $anchorDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000
    Write-Host ('Capturing real game frames for PID ' + $targetProcessId + '. Output: ' + $OutputDirectory)
    if (-not $ProbeSeconds) { Write-Host 'Start Complete minimap investigation in Dev within 60 seconds, close Esc within 5 seconds, and keep the same scene/game focus. Full plan: about 23 minutes; inactive native targets are skipped. Capture ends after the entire investigation.' }
    while (-not $nativeProcess.HasExited) {
        if ($gameProcess.HasExited) { $reason = 'game exited'; break }
        $focus.Add(@{ qpc = [Diagnostics.Stopwatch]::GetTimestamp(); pid = [QollockCaptureForeground]::ProcessId() })
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $anchorDeadline) {
            $anchors += Get-CaptureAnchor
            $anchorDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000
        }
        if (-not $ProbeSeconds) {
            if ($stream.Length -lt $stream.Position) { throw 'Game log was truncated during capture.' }
            $chunk = $partialLine + $reader.ReadToEnd()
            $lines = $chunk -split "`n"
            $partialLine = $lines[-1]
            for ($i = 0; $i -lt $lines.Length - 1; $i++) {
                if ($lines[$i] -match '\[QOLLOCK:NativeFPS\] (\{.*\})\s*$') {
                    $markerJson = $Matches[1]
                    # Payload sizes differ by condition. Decode bulk proof JSON
                    # after ETW stops, avoiding differential concurrent CPU load.
                    if ($markerJson.StartsWith('{"type":"packet",')) { $rawNativePackets.Add($markerJson); continue }
                    $marker = $markerJson | ConvertFrom-Json
                    if ($marker.type -eq 'start' -and -not $session) { $session = [string]$marker.session; $kind = [string]$marker.kind }
                    if ($session -and $marker.session -eq $session) {
                        if ($marker.type -eq 'window') { $nativeWindows.Add($marker) }
                        if ($marker.type -eq 'packet') { $nativePackets.Add($marker) }
                        if ($marker.type -eq 'end') { $reason = [string]$marker.reason; break }
                    }
                }
            }
            if ($reason -ne 'capture-only') { break }
            if (-not $session -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt $startDeadline) {
                throw 'No native trial markers received. Recompile/repack the updated mod, then start its FPS investigation while this collector runs.'
            }
        }
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt $deadline + 5000) { throw 'Native capture exceeded its deadline.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ProbeSeconds -and $reason -eq 'capture-only') { $reason = 'capture deadline / missing investigation end; inspect declared coverage' }
} catch { $failure = $_.Exception.Message }
finally {
    if ($nativeProcess -and -not $nativeProcess.HasExited) {
        # Stop only our unique ETW session, never another profiler's session.
        $stopProcess = New-CaptureProcess @('--session_name', $traceName, '--terminate_existing_session')
        $stopOutput = $stopProcess.StandardOutput.ReadToEndAsync()
        $stopError = $stopProcess.StandardError.ReadToEndAsync()
        if (-not $stopProcess.WaitForExit(10000)) { $failure = 'Stopping the owned ETW session timed out.' }
        if (-not $nativeProcess.WaitForExit(15000)) { $failure = 'The owned native capture did not exit after session stop.' }
    }
    $focus.Add(@{ qpc = [Diagnostics.Stopwatch]::GetTimestamp(); pid = [QollockCaptureForeground]::ProcessId() })
    $anchors += Get-CaptureAnchor
    if ($reader) { $reader.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($nativeProcess -and $nativeProcess.HasExited) {
        $stdout = $outputTask.GetAwaiter().GetResult()
        $stderr = $errorTask.GetAwaiter().GetResult()
        if ($nativeProcess.ExitCode -ne 0 -and -not $failure) { $failure = 'PresentMon exit code: ' + $nativeProcess.ExitCode }
    }
    foreach ($rawPacket in $rawNativePackets) {
        try { $nativePackets.Add(($rawPacket | ConvertFrom-Json)) }
        catch { $packetParseErrors.Add('Malformed proof packet: ' + $_.Exception.Message) }
    }
    $meta = @{ processId = $targetProcessId; session = $session; kind = $kind; reason = $reason; completed = (-not $failure);
        presentMonVersion = '2.6.0'; executableSha256 = $expectedDigest; swapChain = $SwapChain;
        anchors = $anchors; focus = $focus.ToArray(); windows = $nativeWindows.ToArray(); packets = $nativePackets.ToArray();
        sourceIdentity = $sourceIdentity; gameIdentity = $gameIdentity; packetParseErrors = $packetParseErrors.ToArray();
        failure = $failure; stdout = $stdout; stderr = $stderr }
    $meta | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $metaPath -Encoding utf8
    $stdout | Set-Content -LiteralPath (Join-Path $OutputDirectory 'presentmon-stdout.txt') -Encoding utf8
    $stderr | Set-Content -LiteralPath (Join-Path $OutputDirectory 'presentmon-stderr.txt') -Encoding utf8
}
if ($failure) { throw $failure }
$analysis = & node (Join-Path $PSScriptRoot 'analyze_game_frames.js') $csvPath $metaPath --json-output (Join-Path $OutputDirectory 'native-analysis.json') 2> (Join-Path $OutputDirectory 'analysis-stderr.txt')
$analysisExit = $LASTEXITCODE
$analysis | Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.txt') -Encoding utf8
$analysis | Write-Output
if ($analysisExit -ne 0) { throw 'Native frame analysis rejected the capture. Raw data and diagnostics are preserved in the output directory.' }
Write-Host ('Report for a new chat: ' + (Join-Path $OutputDirectory 'report.txt'))
try { Set-Clipboard -Value ($analysis -join [Environment]::NewLine); Write-Host 'The native report is copied to the clipboard.' }
catch { Write-Warning ('Clipboard unavailable; use report.txt. ' + $_.Exception.Message) }
