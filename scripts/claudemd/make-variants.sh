#!/usr/bin/env bash
# Usage: make-variants.sh <evals-dir> <claudemd-file>
# For each case whose case.yaml has `arms: claudemd`, adds a copy named <case>--claudemd whose
# fixture is the original fixture plus a last line that writes the CLAUDE.md file into the workspace
# (appended, not wrapped: an outcome.sh may read the locked files from the variant's fixture.sh).
# Run it on the plugin copy only; it edits case.yaml files (drops the `arms:` line).
set -euo pipefail
evals="$1"
claudemd="$2"
for yaml in "$evals"/*/case.yaml; do
  dir="$(dirname "$yaml")"
  name="$(basename "$dir")"
  grep -q '^arms: *claudemd *$' "$yaml" || continue
  variant="$evals/$name--claudemd"
  cp -R "$dir" "$variant"
  cp "$claudemd" "$variant/CLAUDE.md"
  printf '\ncp "$(dirname "${BASH_SOURCE[0]}")/CLAUDE.md" CLAUDE.md\n' >> "$variant/fixture.sh"
  sed -i.bak -e '/^arms:/d' -e "s/^name: .*/name: $name--claudemd/" "$variant/case.yaml"
  sed -i.bak '/^arms:/d' "$yaml"
  rm -f "$variant/case.yaml.bak" "$yaml.bak"
done
