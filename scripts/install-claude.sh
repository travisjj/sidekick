#!/usr/bin/env bash
# Makes every Sidekick skill available to Claude Code in all projects by symlinking each
# canonical skill directory into ~/.claude/skills/. Links, not copies: a `git pull` in Sidekick
# updates the installed skills, and uninstalling is deleting the links.
#
# Run from anywhere; the script locates Sidekick relative to itself.

set -euo pipefail

SIDEKICK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$SIDEKICK/.cursor/skills"
TARGET="$HOME/.claude/skills"

mkdir -p "$TARGET"

for skill in "$SOURCE"/*/; do
  name="$(basename "$skill")"
  link="$TARGET/$name"
  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "${skill%/}" ]; then
      echo "already linked  $name"
      continue
    fi
    echo "skipping $name: $link is a symlink elsewhere. Remove it and rerun to replace." >&2
    continue
  fi
  if [ -e "$link" ]; then
    echo "skipping $name: $link already exists and is not a symlink. Remove it and rerun to replace." >&2
    continue
  fi
  ln -s "${skill%/}" "$link"
  echo "linked          $name -> ${skill%/}"
done

echo
echo "Done. Start a new Claude Code session and type / to see the Sidekick skills."
