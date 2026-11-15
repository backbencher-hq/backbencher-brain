# Backbencher (bb) installer — https://backbencher.cc/install.ps1
# Run in PowerShell: irm https://backbencher.cc/install.ps1 | iex
#
# Two install channels, in this order:
#   1. npm — `npm install -g backbencher-brain`. PRIMARY path: the package is
#      published for every release, so the binary and the package always agree.
#   2. GitHub release binary — only when npm is unavailable, or when the caller
#      asks for it with BB_INSTALL_CHANNEL=release. The asset must exist for
#      this architecture AND be covered by the release checksums.txt; an
#      unverified binary is never installed silently.
#
# Pinning: set VERSION to install that exact release. Unset = current release.
# Force a channel with BB_INSTALL_CHANNEL=npm|release. Set BB_ALLOW_UNVERIFIED=1
# only if you deliberately accept a binary the release did not checksum.
# Every failure names the exact URL or command that was tried.

$ErrorActionPreference = "Stop"

$VersionPinned = [bool]$env:VERSION
$Version = if ($env:VERSION) { $env:VERSION } else { "0.1.0" }
$Repo = "backbencher-hq/backbencher-brain"
$NpmPackage = "backbencher-brain"
$Channel = if ($env:BB_INSTALL_CHANNEL) { $env:BB_INSTALL_CHANNEL } else { "auto" }
$InstallDir = "$HOME\.local\bin"
$TempDir = [System.IO.Path]::GetTempPath()
$OS = "windows"

function Fail($Message, [string[]]$Hints) {
    Write-Host ""
    Write-Host "install.ps1: $Message" -ForegroundColor Red
    foreach ($Hint in $Hints) { Write-Host "  $Hint" -ForegroundColor Yellow }
    throw $Message
}

# Detect architecture
$ProcArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($ProcArch -eq "AMD64") {
    $ArchName = "x64"
} elseif ($ProcArch -eq "ARM64") {
    $ArchName = "arm64"
} else {
    Fail "unsupported architecture: $ProcArch" @(
        "Prebuilt binaries cover x64 and ARM64.",
        "Install from npm instead: npm install -g $NpmPackage"
    )
}

$BinaryName = "bb-$OS-$ArchName.exe"

Write-Host "Installing Backbencher (bb) for $OS-$ArchName..." -ForegroundColor Cyan

function Install-ViaNpm {
    $Spec = if ($VersionPinned) { "$NpmPackage@$Version" } else { "$NpmPackage@latest" }
    Write-Host "Installing $Spec with npm..." -ForegroundColor Cyan
    & npm install -g $Spec 2>&1 | Out-Host
    return ($LASTEXITCODE -eq 0)
}

function Install-ViaRelease {
    if ($VersionPinned) {
        $Tag = "v$Version"
    } else {
        $Api = "https://api.github.com/repos/$Repo/releases/latest"
        try {
            $Release = Invoke-RestMethod -Uri $Api -UseBasicParsing
        } catch {
            Fail "no published GitHub release found for $Repo ($Api)" @(
                "Install from npm instead: npm install -g $NpmPackage@latest",
                "Or build from source: https://github.com/$Repo#from-source"
            )
        }
        $Tag = $Release.tag_name
        if (-not $Tag) {
            Fail "could not read a release tag from $Api" @(
                "Install from npm instead: npm install -g $NpmPackage@latest"
            )
        }
    }

    $Url = "https://github.com/$Repo/releases/download/$Tag/$BinaryName"
    $ChecksumsUrl = "https://github.com/$Repo/releases/download/$Tag/checksums.txt"
    $BinaryPath = Join-Path $TempDir $BinaryName

    try {
        Invoke-WebRequest -Uri $Url -OutFile $BinaryPath -UseBasicParsing
    } catch {
        $NpmHint = if ($VersionPinned) { "Install from npm instead: npm install -g $NpmPackage@$Version" } else { "Install from npm instead: npm install -g $NpmPackage@latest" }
        Fail "no prebuilt $OS-$ArchName binary at $Url" @(
            $NpmHint,
            "Or build from source: https://github.com/$Repo#from-source"
        )
    }

    $ChecksumsPath = Join-Path $TempDir "checksums.txt"
    $ChecksumsAvailable = $true
    try {
        Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -UseBasicParsing
    } catch {
        $ChecksumsAvailable = $false
    }

    if (-not $ChecksumsAvailable) {
        if ($env:BB_ALLOW_UNVERIFIED -eq "1") {
            Write-Host "WARNING: $Tag publishes no checksums.txt - installing an UNVERIFIED binary (BB_ALLOW_UNVERIFIED=1)." -ForegroundColor Yellow
        } else {
            Fail "release $Tag has no checksums.txt ($ChecksumsUrl); refusing to install an unverified binary" @(
                "Install from npm instead: npm install -g $NpmPackage",
                "Override deliberately with `$env:BB_ALLOW_UNVERIFIED = 1"
            )
        }
    } else {
        $Line = (Get-Content $ChecksumsPath | Where-Object { (($_ -split '\s+')[-1]) -eq $BinaryName }) | Select-Object -First 1
        if (-not $Line) {
            Fail "checksums.txt in $Tag has no entry for $BinaryName; refusing to install an unverified binary" @(
                "Released checksums: $ChecksumsUrl",
                "Install from npm instead: npm install -g $NpmPackage"
            )
        }
        $Expected = (($Line -split '\s+')[0]).ToLower()
        $Actual = (Get-FileHash -Algorithm SHA256 -Path $BinaryPath).Hash.ToLower()
        if ($Expected -ne $Actual) {
            Remove-Item $BinaryPath -ErrorAction SilentlyContinue
            Fail "checksum verification failed for $Url" @(
                "expected sha256 $Expected",
                "got      sha256 $Actual"
            )
        }
        Write-Host "Checksum verified (sha256 $Expected)." -ForegroundColor Green
    }

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    $FinalPath = Join-Path $InstallDir "bb.exe"
    Copy-Item -Path $BinaryPath -Destination $FinalPath -Force
    Remove-Item $BinaryPath -ErrorAction SilentlyContinue
    return $FinalPath
}

$InstalledVia = ""
$FinalPath = ""

switch ($Channel) {
    "npm" {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Fail "BB_INSTALL_CHANNEL=npm but npm is not on PATH" @(
                "Install Node.js >= 18 (https://nodejs.org) and re-run.",
                "Or use a release binary: `$env:BB_INSTALL_CHANNEL='release'; irm https://backbencher.cc/install.ps1 | iex"
            )
        }
        if (-not (Install-ViaNpm)) {
            Fail "npm install -g $NpmPackage failed (see npm output above)" @()
        }
        $InstalledVia = "npm"
    }
    "release" {
        $FinalPath = Install-ViaRelease
        $InstalledVia = "release"
    }
    { $_ -in @("auto", "") } {
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            if (Install-ViaNpm) {
                $InstalledVia = "npm"
            } else {
                Write-Host "npm install failed; falling back to a GitHub release binary." -ForegroundColor Yellow
                $FinalPath = Install-ViaRelease
                $InstalledVia = "release"
            }
        } else {
            Write-Host "npm is not on PATH; using a GitHub release binary instead." -ForegroundColor Yellow
            $FinalPath = Install-ViaRelease
            $InstalledVia = "release"
        }
    }
    default {
        Fail "unknown BB_INSTALL_CHANNEL='$Channel'" @(
            "Accepted values: auto (default), npm, release."
        )
    }
}

Write-Host ""

# Create default config with bb_* tool permissions (no TUI prompts)
$ConfigDir = "$HOME\.config\opencode"
$ConfigFile = "$ConfigDir\opencode.json"
if (!(Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }
if (!(Test-Path $ConfigFile)) {
  $DefaultConfig = @'
{
  "$schema": "https://backbencher.cc/config.json",
  "permission": {
    "bb_search": "allow",
    "bb_ask": "allow",
    "bb_analyze": "allow",
    "bb_graph": "allow",
    "bb_impact": "allow",
    "bb_visualize": "allow",
    "bb_patterns": "allow",
    "bb_security": "allow",
    "bb_doc": "allow",
    "bb_cross_language": "allow",
    "bb_migrate": "allow",
    "bb_health": "allow",
    "bb_index": "allow",
    "bb_edit": "allow",
    "bb_annotate": "allow",
    "bb_annotations": "allow"
  }
}
'@
  Set-Content -Path $ConfigFile -Value $DefaultConfig
}

Write-Host ""
if ($InstalledVia -eq "npm") {
    if (Get-Command bb -ErrorAction SilentlyContinue) {
        Write-Host "✅ Installed via npm. Run: bb --version" -ForegroundColor Green
    } else {
        $NpmPrefix = ""
        try { $NpmPrefix = (& npm prefix -g 2>$null) } catch { }
        Write-Host "✅ Installed via npm." -ForegroundColor Green
        Write-Host "   bb is not on PATH yet - add $NpmPrefix to PATH, then run: bb --version"
    }
} else {
    Write-Host "✅ Installed to $FinalPath" -ForegroundColor Green
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrEmpty($UserPath) -or ($UserPath -notlike "*$InstallDir*")) {
        Write-Host "Add $InstallDir to your PATH, then run: bb --version"
    } else {
        Write-Host "Run: bb --version"
    }
}
