# Launches Chrome with the DevTools Protocol enabled for drive-chrome.
#
# A dedicated user data directory is required: Chrome refuses --remote-debugging-port when it
# would join an already-running default-profile instance. The profile lives under
# LOCALAPPDATA on purpose; it is large and churns constantly, and a cloud-synced folder would
# fight Chrome for the file locks. Nothing from the user's real profile is touched.
#
# Port defaults to 9333 (not the conventional 9222, which many tools attach to). Override with
# the DRIVE_CHROME_PORT environment variable; cdp.mjs reads the same variable.

param(
    [int] $Port = $(if ($env:DRIVE_CHROME_PORT) { [int] $env:DRIVE_CHROME_PORT } else { 9333 }),
    [string] $StartUrl = "about:blank"
)

$profileDir = Join-Path $env:LOCALAPPDATA "drive-chrome-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    Write-Error "Chrome was not found in the usual locations. Install Chrome or edit the candidate list in this script."
    exit 1
}

Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$profileDir",
    "--no-first-run",
    "--no-default-browser-check",
    $StartUrl
)

Write-Host "Chrome launched on port $Port with profile $profileDir"
Write-Host "Verify with: Invoke-RestMethod -Uri http://localhost:$Port/json/version -TimeoutSec 5"
