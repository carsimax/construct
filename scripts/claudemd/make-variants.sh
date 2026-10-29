#!/usr/bin/env bash
# Usage: make-variants.sh <evals-dir> <claudemd-file>
# For each case whose case.yaml has `arms: claudemd`, adds a copy named <case>--claudemd whose
# fixture runs the original fixture and then writes the CLAUDE.md file into the workspace.
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
  mv "$variant/fixture.sh" "$variant/fixture-base.sh"
  cat > "$variant/fixture.sh" <<'FX'
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/fixture-base.sh"
cp "$here/CLAUDE.md" CLAUDE.md
FX
  sed -i.bak -e '/^arms:/d' -e "s/^name: .*/name: $name--claudemd/" "$variant/case.yaml"
  sed -i.bak '/^arms:/d' "$yaml"
  rm -f "$variant/case.yaml.bak" "$yaml.bak"
done
