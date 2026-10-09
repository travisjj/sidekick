# Scaffolds a new Sidekick skill: the canonical directory under .cursor/skills/<name>/ with a
# SKILL.md template, plus the Claude Code stub under .claude/skills/<name>/ that points at it.
#
# Usage:  .\scripts\new-skill.ps1 -Name my-skill -Description "One sentence on when to use it."

param(
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [string] $Description
)

$ErrorActionPreference = "Stop"

if ($Name -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    Write-Error "Skill names are lowercase words separated by hyphens, e.g. drive-chrome."
    exit 1
}

$sidekick = Split-Path -Parent $PSScriptRoot
$canonical = Join-Path $sidekick ".cursor\skills\$Name"
$stub = Join-Path $sidekick ".claude\skills\$Name"

if (Test-Path $canonical) {
    Write-Error "A skill named $Name already exists at $canonical."
    exit 1
}

New-Item -ItemType Directory -Force -Path $canonical | Out-Null
New-Item -ItemType Directory -Force -Path $stub | Out-Null

$frontmatter = @"
---
name: $Name
description: $Description
---
"@

@"
$frontmatter

# $Name

Describe what the skill does and the rules the agent must follow while doing it.

## Setup

Any helper files live in this directory. Refer to them as "beside this file"; never use an
absolute path.

## Steps

1. ...
"@ | Set-Content -Path (Join-Path $canonical "SKILL.md") -Encoding UTF8

@"
$frontmatter

# $Name (Claude Code entry point)

The canonical skill is at ``../../../.cursor/skills/$Name/SKILL.md`` relative to this file.
Read that file and follow it exactly; treat its directory as the skill directory it refers to.
"@ | Set-Content -Path (Join-Path $stub "SKILL.md") -Encoding UTF8

Write-Host "Created:"
Write-Host "  $canonical\SKILL.md   (edit this one)"
Write-Host "  $stub\SKILL.md   (stub, leave as is)"
Write-Host ""
Write-Host "If Claude Code skills are installed via scripts\install-claude.ps1, rerun it to link the new skill."
