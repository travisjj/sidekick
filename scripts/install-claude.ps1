# Makes every Sidekick skill available to Claude Code in all projects by linking each
# canonical skill directory into ~/.claude/skills/. Links, not copies: a `git pull` in Sidekick
# updates the installed skills, and uninstalling is deleting the links.
#
# Directory junctions are used because they work on Windows without administrator rights or
# Developer Mode. Run from anywhere; the script locates Sidekick relative to itself.

$ErrorActionPreference = "Stop"

$sidekick = Split-Path -Parent $PSScriptRoot
$source = Join-Path $sidekick ".cursor\skills"
$target = Join-Path $env:USERPROFILE ".claude\skills"

New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($skill in Get-ChildItem -Directory $source) {
    $link = Join-Path $target $skill.Name
    if (Test-Path $link) {
        $existing = Get-Item $link -Force
        if ($existing.LinkType -eq "Junction" -and $existing.Target -eq $skill.FullName) {
            Write-Host "already linked  $($skill.Name)"
            continue
        }
        Write-Warning "skipping $($skill.Name): $link already exists and is not a junction to Sidekick. Remove it and rerun to replace."
        continue
    }
    New-Item -ItemType Junction -Path $link -Target $skill.FullName | Out-Null
    Write-Host "linked          $($skill.Name) -> $($skill.FullName)"
}

Write-Host ""
Write-Host "Done. Start a new Claude Code session and type / to see the Sidekick skills."
