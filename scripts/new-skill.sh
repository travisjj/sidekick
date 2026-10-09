#!/usr/bin/env bash
# Scaffolds a new Sidekick skill: the canonical directory under .cursor/skills/<name>/ with a
# SKILL.md template, plus the Claude Code stub under .claude/skills/<name>/ that points at it.
#
# Usage:  ./scripts/new-skill.sh my-skill "One sentence on when to use it."

set -euo pipefail

NAME="${1:-}"
DESCRIPTION="${2:-}"

if [ -z "$NAME" ] || [ -z "$DESCRIPTION" ]; then
  echo "Usage: $0 <skill-name> \"<one sentence description>\"" >&2
  exit 1
fi

if ! [[ "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Skill names are lowercase words separated by hyphens, e.g. drive-chrome." >&2
  exit 1
fi

SIDEKICK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="$SIDEKICK/.cursor/skills/$NAME"
STUB="$SIDEKICK/.claude/skills/$NAME"

if [ -e "$CANONICAL" ]; then
  echo "A skill named $NAME already exists at $CANONICAL." >&2
  exit 1
fi

mkdir -p "$CANONICAL" "$STUB"

FRONTMATTER="---
name: $NAME
description: $DESCRIPTION
---"

cat > "$CANONICAL/SKILL.md" <<EOF
$FRONTMATTER

# $NAME

Describe what the skill does and the rules the agent must follow while doing it.

## Setup

Any helper files live in this directory. Refer to them as "beside this file"; never use an
absolute path.

## Steps

1. ...
EOF

cat > "$STUB/SKILL.md" <<EOF
$FRONTMATTER

# $NAME (Claude Code entry point)

The canonical skill is at \`../../../.cursor/skills/$NAME/SKILL.md\` relative to this file.
Read that file and follow it exactly; treat its directory as the skill directory it refers to.
EOF

echo "Created:"
echo "  $CANONICAL/SKILL.md   (edit this one)"
echo "  $STUB/SKILL.md   (stub, leave as is)"
echo
echo "If Claude Code skills are installed via scripts/install-claude.sh, rerun it to link the new skill."
