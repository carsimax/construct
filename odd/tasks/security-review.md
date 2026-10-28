# Security review

Objective: fix the three findings of the automated push security review on the hooks shipped in 12.0.0, after reproducing each one. Branch: fix/security-review. Baseline: 01111dc. Delivery strategy: single-pr (no release). Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Work the findings.** "ok contemplalos pra trabajarlos"
  - Finding 1 (HIGH, reproduced): `shell-words.mjs` `closingParen` returns at the first `)` without tracking bare `(` depth, so `substitutionBodies('echo "$( (true); git push origin feat )"')` yields `[" (true"]` and publication-gate allows the push (no output), while plain `git push origin feat` is denied.
    - Given a command substitution that contains a subshell or a `case ... in pat)` When publication-gate parses it Then the nested `git push` is found and gated, or the gate denies because the body cannot be parsed unambiguously (fail closed).
  - Finding 2 (MEDIUM, reproduced, accepted: L3, L6): `delegation-admission.mjs` skips a same-key record with `started === false` without waiting for the start grace window, so two identical parallel launches may skip the overlap check.
  - Finding 3 (MEDIUM, reproduced, fixed: L4, L6): `git-tree.mjs` seeds the temporary index from the repository index and runs `add -A`, trusting the stat cache (and fsmonitor / untracked cache) instead of hashing every file from `HEAD`.
  - Assumption: a finding that does not reproduce is recorded in the Log with the attempt and dropped, not fixed blind.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Failing test for nested parens and `case` in substitutions; `closingParen` tracks bare `(` depth or fails closed | inline | 2 | dropped | reverted: parser back to 01111dc; moved to `odd/tasks/shell-parser.md` |
| T2 | S1 | Reproduce finding 2 with a test; fix only if it reproduces | inline | none | done: accepted and documented (shortcut comment) | fb6fc06 |
| T3 | S1 | Reproduce finding 3 with a test; fix only if it reproduces | inline | 2 | dropped: moved to `odd/tasks/snapshot-budget.md` | — |

## Log

- **L1 (2026-10-27):** automated security review after the push of `docs/methodology` flagged three issues in hooks from #72; finding 1 reproduced by running `substitutionBodies` and publication-gate directly. User: "ok contemplalos pra trabajarlos".
- Order agreed: after the eval baseline, before the risk floor (the floor builds on publication-gate).

- **L2 (2026-10-27):** eval baseline done (see Engram `evals/baseline-01111dc`). User: "si vamos!". T1: eight gate cases added; the four with the substitution inside double quotes failed (unquoted ones were already caught by the outer split). `closingParen` now counts bare `(` depth and ignores `case` pattern `)` until `esac`; `$((1+2))` also closes at the right paren now.

- **L3 (2026-10-27):** T2 reproduces by reading: two identical writer prompts launched before either starts are both admitted (the second skips the first's unstarted same-key record). It is deliberate: `tests/admission/admission.test.mjs:418` protects "resending the prompt of a launch that never started is not an overlap with itself" (a declined launch must not block its own resend). The suggested fix would break that test; needs a user decision.
- **L4 (2026-10-27):** T3 reproduced: a file rewritten with the same size and its mtime restored (`touch -r`) in a non-racy index is missed by `freezeWorkingTree` (and by `git status`); seeding from `read-tree HEAD` detects it. Cost on this repo (251 files): 24 ms seeded vs 53 ms from HEAD. Needs a user decision (correctness vs speed on large repos).

- **L5 (2026-10-27):** a second automated review flagged `#` comments and here-docs inside `$(...)`: comments reproduced (2 of 3 new cases failed), here-docs were already handled by `extractHeredocs`. `closingParen` now skips a word-start `#` to the end of the line and returns -1 when no newline follows.
- **L6 (2026-10-27):** "vamos con las recomendaciones" — T2 (a): accepted, documented as a `shortcut:` comment in `delegation-admission.mjs`; the resend test stays. T3 (a): `freezeWorkingTree` seeds from `read-tree HEAD` again (as before 12.0.0). Full suite 914/914; both original reproductions now deny / detect.

- **L7 (2026-10-27):** "sigamos con los dos pendeintes" — release 12.0.1 and review. A third automated review showed `case`/`esac` counting is fooled by `esac` as an argument or pattern (3 bypasses that bash accepts); a `case` word inside `$(...)` now fails closed (the rest of the command is the body). Release 12.0.1 (e68939c); suite 918/918, `claude plugin validate --strict` passes. Construct is not installed in this session, so the gate and the `construct:review-*` agents are absent; two clean-context reviewers follow the review-risk and review-resilience lens files instead (Risk 2 and 5).

- **L8 (2026-10-27):** lens reports. review-resilience: WARNING, hashing from HEAD costs 4.7-7.8 s per call on 50,000 files (twice per turn, 30 s timeout, fails open silently). review-risk: two CRITICAL regressions introduced by fb6fc06/e72019f — a -1 from closingParen made splitCommands re-read a quoted body character by character, so an odd quote inside single quotes hid the commands after the substitution (`echo "$(echo case 'a"b')"; git push origin feat` allowed; 01111dc denied it); plus pre-existing `${x/)/}` and `<<\EOF`. Stopped after three attempts; user: "Si sigue con la recomendacion".
- **L9 (2026-10-27):** 23f6e96: splitCommands throws UndelimitedSubstitution for an undelimited quoted `$(`; closingParen skips `${...}`; HEREDOC_RE accepts `<<\EOF`. An automated review then showed the gate's publication regex and command-guard's git check ran on raw text (`g"i"t pu"s"h` allowed): eebfed9 denies any UndelimitedSubstitution in both hooks. 3202d81: snapshot hashes from HEAD up to 20,000 index entries, seeds from the index above it with a one-time systemMessage (20,100-file repo: 141 ms, notice once). Suite 932/932. Clean-context lenses re-run on 01111dc..2f73487.

- **L10 (2026-10-27):** second lens pass on 01111dc..2f73487. review-resilience: CRITICAL, the undelimited-substitution deny blocks the heredoc commit idiom `git commit -m "$(cat <<'EOF' ...)"` (extractHeredocs leaves an open `"$(` header). review-risk: CRITICAL, the `${` skip ignores quotes and the `#` rule takes `a\ #` as a comment, each hiding a push that 01111dc denied; WARNING, review-store-guard fails open on the new error. Five heuristic attempts traded bypasses for false denials. User: "si sigue": parser, gate, command-guard, and their tests restored to 01111dc; T1 dropped and moved to `odd/tasks/shell-parser.md`; 12.0.1 keeps T3 (with fsmonitor and untracked cache off on the fast path) and the T2 comment; CHANGELOG lists the known parsing gaps. Suite 905/905.

- **L11 (2026-10-27):** final lens pass on 01111dc..47fa4d2: no CRITICAL. review-resilience WARNINGs: the entry-count budget hashes every byte below 20,000 entries (2 GB: 2.8–4.7 s per call, twice per turn; about 12–20 GB passes the 30 s timeout), a killed mark leaves a stale baseline, and a split index always takes the full hash. User chose "c": T3 and the 12.0.1 bump reverted to 01111dc; T3 moved to `odd/tasks/snapshot-budget.md` with the measurements; no release. Net change against 01111dc: the T2 comment and these feature documents.

Next step: user decides whether to push this branch and open the pull request (docs and a comment only, Risk none).
