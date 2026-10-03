$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'VERSION') -Raw).Trim()
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) {
    throw "VERSION ($version) and package.json ($($manifest.version)) differ."
}

$unpackedDir = Join-Path $repoRoot "Karaoke-Sync-Studio-$version\win-unpacked"
$appExe = Join-Path $unpackedDir 'Karaoke Sync Studio.exe'
$asar = Join-Path $unpackedDir 'resources\app.asar'
if (-not (Test-Path -LiteralPath $appExe -PathType Leaf) -or -not (Test-Path -LiteralPath $asar -PathType Leaf)) {
    throw "Incomplete unpacked app: $unpackedDir"
}

$iscc = @(
    $env:INNO_SETUP_ISCC,
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 compiler (ISCC.exe) was not found.' }

function Get-DesktopDirectory {
    $shellFolders = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
    $registryDesktop = (Get-ItemProperty -LiteralPath $shellFolders -Name Desktop -ErrorAction SilentlyContinue).Desktop
    if ($registryDesktop) {
        $candidate = [Environment]::ExpandEnvironmentVariables($registryDesktop)
        if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
    }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WindowsDesktopFolder {
    [DllImport("shell32.dll")]
    public static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHGetFolderPathW(IntPtr hwnd, int csidl, IntPtr token, uint flags, StringBuilder path);
    [DllImport("ole32.dll")]
    public static extern void CoTaskMemFree(IntPtr pointer);
}
'@
    $desktopGuid = [Guid]'B4BFCC3A-DB2C-424C-B029-7FE99A87C641'
    $pointer = [IntPtr]::Zero
    if ([WindowsDesktopFolder]::SHGetKnownFolderPath([ref]$desktopGuid, 0, [IntPtr]::Zero, [ref]$pointer) -eq 0) {
        try {
            $candidate = [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)
            if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
        } finally {
            [WindowsDesktopFolder]::CoTaskMemFree($pointer)
        }
    }
    $buffer = [Text.StringBuilder]::new(32768)
    if ([WindowsDesktopFolder]::SHGetFolderPathW([IntPtr]::Zero, 0x10, [IntPtr]::Zero, 0, $buffer) -eq 0) {
        $candidate = $buffer.ToString()
        if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
    }
    $candidate = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Desktop'
    if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
    throw 'The Windows Desktop directory could not be resolved.'
}

$desktop = Get-DesktopDirectory
$setupFile = Join-Path $desktop "Karaoke-Sync-Studio_v${version}_Setup.exe"
$script = Join-Path $PSScriptRoot 'KaraokeSyncStudio.iss'
Write-Host "Portable folder: $unpackedDir"
Write-Host "Installer output: $setupFile"
& $iscc "-DAppVersion=$version" "-DAppSourceDir=$unpackedDir" "-O$desktop" $script
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler failed: $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $setupFile -PathType Leaf)) { throw "Installer missing: $setupFile" }
