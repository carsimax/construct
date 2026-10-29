#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Passes when the project's tests pass and the review store holds an oracle envelope.
set -euo pipefail
ws="$1"
common="$(git -C "$ws" rev-parse --git-common-dir)"
case "$common" in /*) ;; *) common="$ws/$common" ;; esac
found=0
for f in "$common"/construct-review/envelopes/*.json; do
  [ -e "$f" ] || continue
  case "$f" in *.state.json) continue ;; esac
  found=1
done
[ "$found" = 1 ]
tar -C "$ws" --exclude=.git -cf - . | tar -xf -
node --test
