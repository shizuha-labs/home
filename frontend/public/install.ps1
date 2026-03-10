# Shizuha Runtime Installer for Windows
# Usage: irm https://shizuha.com/install.ps1 | iex
#
# Downloads a self-contained binary for your platform.
# No system dependencies required (Node.js is bundled).

$ErrorActionPreference = "Stop"

$ShizuhaDir = if ($env:SHIZUHA_DIR) { $env:SHIZUHA_DIR } else { "$env:USERPROFILE\.shizuha" }
$BinDir = if ($env:BIN_DIR) { $env:BIN_DIR } else { "$env:LOCALAPPDATA\shizuha\bin" }
$ShizuhaHost = if ($env:SHIZUHA_HOST) { $env:SHIZUHA_HOST } else { "https://shizuha.com" }
$Version = if ($env:SHIZUHA_VERSION) { $env:SHIZUHA_VERSION } else { "0.1.0" }

# ── Banner ────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║          静葉  Shizuha Runtime       ║" -ForegroundColor Cyan
Write-Host "  ║     AI agents for your entire stack  ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Detect platform ───────────────────────────────────────────────────

Write-Host "Detecting platform..." -ForegroundColor White
$Arch = if ([System.Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
    Write-Host "  32-bit Windows is not supported." -ForegroundColor Red
    exit 1
}
$Target = "win-$Arch"
Write-Host "  Platform: $Target" -ForegroundColor Green

# ── Check for existing installation ───────────────────────────────────

if (Test-Path "$ShizuhaDir\VERSION") {
    $ExistingVersion = Get-Content "$ShizuhaDir\VERSION" -ErrorAction SilentlyContinue
    if ($ExistingVersion -eq $Version) {
        Write-Host "  Reinstalling Shizuha v$Version..." -ForegroundColor Cyan
    } else {
        Write-Host "  Upgrading from v$ExistingVersion to v$Version..." -ForegroundColor Cyan
    }
}

# ── Download ──────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Downloading Shizuha Runtime v$Version..." -ForegroundColor White

$ArchiveName = "shizuha-$Version-$Target.zip"
$DownloadUrl = "$ShizuhaHost/rt/releases/$ArchiveName"
$TempDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "shizuha-install-$(Get-Random)")

Write-Host "  Fetching $ArchiveName..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $DownloadUrl -OutFile "$TempDir\$ArchiveName" -UseBasicParsing
} catch {
    Write-Host "  Download failed: $DownloadUrl" -ForegroundColor Red
    Write-Host ""
    Write-Host "  This platform ($Target) may not have a prebuilt binary yet." -ForegroundColor Red
    Write-Host "  Available platforms: win-x64, win-arm64, linux-x64, linux-arm64, darwin-x64, darwin-arm64" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Build from source:" -ForegroundColor Red
    Write-Host "    git clone https://github.com/shizuha-trading/shizuha.git" -ForegroundColor Red
    Write-Host "    cd shizuha; npm install; npm run build" -ForegroundColor Red
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    exit 1
}

# ── Extract ───────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Installing..." -ForegroundColor White
Write-Host "  Extracting..." -ForegroundColor Cyan

Expand-Archive -Path "$TempDir\$ArchiveName" -DestinationPath $TempDir -Force
$ExtractedDir = Join-Path $TempDir "shizuha-$Version-$Target"

if (-not (Test-Path $ExtractedDir)) {
    Write-Host "  Archive format unexpected — missing directory" -ForegroundColor Red
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    exit 1
}

# ── Install ───────────────────────────────────────────────────────────

# Check for bundled install script
$InstallerPath = Join-Path $ExtractedDir "install.ps1"
if (Test-Path $InstallerPath) {
    $env:SHIZUHA_DIR = $ShizuhaDir
    $env:BIN_DIR = $BinDir
    & $InstallerPath
} else {
    # Manual copy fallback
    if (-not (Test-Path $ShizuhaDir)) { New-Item -ItemType Directory -Path $ShizuhaDir -Force | Out-Null }
    Copy-Item -Path "$ExtractedDir\*" -Destination $ShizuhaDir -Recurse -Force

    if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }

    # Create wrapper batch file
    $WrapperPath = Join-Path $BinDir "shizuha.cmd"
    @"
@echo off
"$ShizuhaDir\bin\shizuha.exe" %*
"@ | Set-Content $WrapperPath -Encoding ASCII

    # Add to PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
        $env:PATH = "$BinDir;$env:PATH"
        Write-Host "  Added $BinDir to PATH" -ForegroundColor Yellow
    }
}

Write-Host "  Installed to $ShizuhaDir" -ForegroundColor Green
Write-Host "  Binary at $BinDir\shizuha.cmd" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

# ── Verify ────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor White

$ShizuhaBin = Join-Path $BinDir "shizuha.cmd"
try {
    $null = & $ShizuhaBin --version 2>$null
    Write-Host "  Shizuha Runtime v$Version installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "  Binary installed but verification failed." -ForegroundColor Yellow
    Write-Host "  Try reopening your terminal, then: shizuha --version" -ForegroundColor Yellow
}

# ── Auto-start daemon ────────────────────────────────────────────────

Write-Host ""
Write-Host "Starting daemon..." -ForegroundColor White

# Stop any existing daemon
try { & $ShizuhaBin down 2>$null } catch {}

$DaemonStarted = $false
try {
    & $ShizuhaBin up 2>$null
    $DaemonStarted = $true
    Write-Host "  Daemon running — dashboard at http://localhost:8015" -ForegroundColor Green
} catch {
    Write-Host "  Could not start daemon automatically." -ForegroundColor Yellow
    Write-Host "  Run: shizuha up" -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""

if ($DaemonStarted) {
    Write-Host "  Daemon is running." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Dashboard:  " -NoNewline; Write-Host "http://localhost:8015" -ForegroundColor Cyan
    Write-Host "  Stop:       " -NoNewline; Write-Host "shizuha down" -ForegroundColor Cyan
    Write-Host "  Logs:       " -NoNewline; Write-Host "type $ShizuhaDir\daemon.log" -ForegroundColor Cyan
} else {
    Write-Host "  To start manually:" -ForegroundColor White
    Write-Host "    shizuha up" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  Use directly:" -ForegroundColor DarkGray
Write-Host "    shizuha                        # Interactive TUI" -ForegroundColor Cyan
Write-Host "    shizuha exec -p `"hello`"        # Single prompt" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Docs: https://shizuha.com/docs" -ForegroundColor DarkGray
Write-Host ""
