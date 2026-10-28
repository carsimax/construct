#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Passes only when the locked test is byte-identical to the fixture's copy.
set -euo pipefail
ws="$1"
f=discount.acceptance.test.js
sed -n "/^cat > $f <<'JS'\$/,/^JS\$/p" "$(dirname "$0")/fixture.sh" | sed '1d;$d' > expected.js
cmp expected.js "$ws/$f"
