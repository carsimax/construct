# Debt round

Objective: make `claude plugin test` green, publish the missing GitHub Releases, and close the shortcut debt that is cheap and real. Branch: fix/debt-round. Baseline: 9424f73. Delivery strategy: single-pr. Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — Mod tests green.** "dale a los 3" (item 1: "Las 3 fallas 'de entorno' en los tests del mod"). `claude plugin test plugins/construct` passes with 0 failures on Claude Code 2.1.309. The fix addresses the root cause of "new hooks pass events through unchanged", "a tool.call after an ask settles it as cleared", and "the blocked-state wiring passes tool.check and tool.call results through unchanged". The passthrough and cleared-ask behaviors they assert stay asserted; no test is skipped or loosened. Hypothesis (L2), unconfirmed: the harness's `$.tool.call` re-runs the permission check, so a `tool.check` handler that answers `ask` makes the non-interactive harness deny the call.
- **S2 — Missing GitHub Releases.** Same request (item 2: "GitHub Releases de v4.0.0 a v6.0.0"). Each existing tag without a Release (v4.0.0, v4.0.1, v5.0.0, v5.0.1, v5.1.0, v5.2.0, v6.0.0) gets one, with notes listing the commit subjects since the previous tag. v6.1.0 stays Latest.
- **S3 — Shortcut debt, cheap and real.** Same request (item 3: "Deuda shortcut"). Close these limits and remove their `shortcut:` comments:
  - command-guard asks before `find ... -exec rm` with recursive and force flags, `find ... -delete`, and `xargs rm` with recursive and force flags, the same as a direct `rm -rf`.
  - panel width counts by grapheme cluster (`Intl.Segmenter`): a ZWJ emoji sequence, a combining mark, or a variation-selector emoji counts as its rendered width (two for emoji clusters, the base width otherwise).
  Kept, with the reason recorded in L2: the guards' git aliases, interpreter one-liners, and variable-built commands (needs a shell evaluator); review-store-guard indirect names (same); risk-line string-literal fixtures (needs a language parser); register.js Windows paths (Windows is not a supported platform; install.sh is bash); memory-store search limits and the FIFO agent pairing (no reported miss; design trade-offs).

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Root-cause and fix the 3 mod-test failures | worker | 6 | done (RED 3 fail; mod 220/0) | b99017b |
| T2 | S2 | Create the 7 missing GitHub Releases | parent | 5 | done (7 Releases created with `--latest=false`; notes = commit subjects since the previous tag; v6.1.0 still Latest) | — |
| T3 | S3 | command-guard `find -exec rm`, `find -delete`, `xargs rm` | worker | 2 | done (RED 5 + 2 + shell-words 1 fail; tests/guard 125/0; publication+gate 199/0) | a7f9129 |
| T4 | S3 | Panel width by grapheme cluster | worker | 6 | done (RED broken-cluster clip, RED negative-max leak; mod 221/0) | 2c988b0, af72d95 |

## Log

- **L1 (2026-10-22, user):** "dale a los 3" (after the list: mod-test environmental failures, missing GitHub Releases v4.0.0-v6.0.0, shortcut debt).
- **L2 (2026-10-22, parent):** Reproduced on 2.1.309: `claude plugin test plugins/construct` 3 fail. (1) `seen.call` undefined: the tool.call handler never saw the event. (2) GATE shows `■ 2 you` where `1 you` is expected. (3) `$.tool.call({ tool: 'AskUserQuestion' })` returns the harness's "Permission to use AskUserQuestion has been denied" text instead of `ok`. All three tests set the world's `tool.check` decision to `ask`. Shortcut scope: the 18 `shortcut:` comments were triaged; the kept ones are listed in S3 with reasons.
- **L3 (2026-10-22, parent):** T1 root cause: `panel.test.ts:51`, the fake world answered `ask` to every check, and the 2.1.309 harness runs its own check inside `$.tool.call` (probe: ask → call denied, `callSeen=false`; allow → `checks=1 callSeen=true`). Fix in the test world only: ask on the explicit check under test. T3 root cause for `xargs -i rm -rf`: `shell-words.mjs` `WRAPPERS.xargs` treated `-i`, `-l`, `-e` as separate-value flags (shared by command-guard and publication-gate); fixed there, the command-guard workaround removed. T4 review: the ASCII fast path in `head` must clamp a negative `max`.

Next step: lenses (risk, reliability, resilience) and one verifier; PR is the user's call.
