# Audit findings

Objective: fix the 20 findings of the 2026-10-20 ponytail audit (engram `audit/2026-10-20`). Branch: `fix/audit-findings`, baseline `bfdd691` (main, 1.3.0). Delivery strategy: one PR; slice boundaries are the task commits (L2). Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict ./plugins/construct`.

## Specs

Source for every spec: the user's "trabaja en los 20 puntos" (L1) over the audit report. Spec `S<n>` is audit finding `<n>`. Paths are under `plugins/construct/` unless they start with `install.sh` or `tests/`.

- **S1 — One git value-flag list.** `command-guard.mjs` and `publication-gate.mjs` share one `GIT_VALUE_FLAGS` (the publication-gate set, which has `--super-prefix` and `--config-env`). `git --super-prefix x reset --hard` and `git --config-env a=B push --force origin main` are denied.
- **S2 — Installer survives an MCP failure.** A failing `claude mcp add` warns and the installer still runs `merge_settings` and `summary`.
- **S3 — Secret guard sees through globs and expansions.** Denied: `cat .en?`, `cat .[e]nv`, `cat ~/.s?h/id_rsa`, `f=.en; cat ${f}v`, `cat .e$(true)nv`, `cat $'.en\x76'`. Still allowed: `cat $f`, `cat "$HOME/notes.txt"`, `ls *.js`, `cat src/*.ts`. Assumption: only adds denies (fail closed); the guard corpus pins each new deny as a named difference from main.
- **S4 — Symlinks to protected paths are denied.** `ruleFor` resolves symlinks (reuse `realPath` from `write-scope.mjs`); a repo file linking to a protected path is denied for Read and `cat`.
- **S5 — Lock waits for a live holder.** `withLock` (`lib/review/store.mjs`) retries for a short bounded time (about 2 s) while a live holder has the lock, then refuses. Four lens captures in parallel all land.
- **S6 — One sound-receipt rule.** `boundary.mjs` and the "already acknowledged" check in `start` use the gate's `ok` receipt predicate, so a damaged receipt no longer dead-ends the gate's suggested `start`.
- **S7 — No silent `no_base`.** The base lookup also tries `init.defaultBranch` (local and `origin/`); `DEFAULT_BRANCH_REFS` lives in one place. A repo whose default is `develop` gates a high-risk push.
- **S8 — Id-less subagent stop closes a named start.** `subagent-count.mjs` falls back to the oldest entry of any name.
- **S9 — PEM header found in any text file.** `.md` and `.html` with a private-key header classify high with `private_key_content`.
- **S10 — Operational docs never passive, whatever the extension.** `isOperationalMarkdownPath` applies to every passive document extension (`.rst`, `.mdx`, `.adoc`, ...).
- **S11 — Linear `alter ... drop` check.** Same result as `/\balter\s[\s\S]*\bdrop\b/i`, linear time; a 100k-`alter` statement finishes under a time bound.
- **S12 — Quoted diff header paths.** C-quoted `diff --git "a/..." "b/..."` headers are unquoted; a quoted name no longer forces `process_scan_limit` high.
- **S13 — Publication gate shares one deadline.** All `odd-review` spawns in one hook call share a deadline under the 30 s hook timeout; on expiry the push is denied.
- **S14 — Bare `cd`, `cd -`, `pushd` are an unknown directory** for the publication gate (deny path that already exists).
- **S15 — One minimum-version source.** A test asserts `install.sh` `MIN_CLAUDE`/`MIN_NODE` equal `status/doctor.js`.
- **S16 — Installer installs the release it names.** Pin the marketplace to the tag only if the documented `claude plugin marketplace add` source syntax supports a ref; otherwise no code change and the limit is logged here.
- **S17 — Dead code removed.** Unused exports lose `export` or are deleted; `touchesHotPath`, `layout.js` `key`/`seq`, `PALETTE.text`, `live.dir` and its `$.session.cwd()` call, test-only `isBlocked`/`unfinishedCount` (with their tests), unreachable branches in `commands.mjs`, and the never-incremented `final_verifications` (only if no persisted receipt format depends on it; otherwise keep and log).
- **S18 — Near-copies merged.** One rm-root rule and one `SHELLS` (guards); one `isNum` (panel); one Tasks-table parser (`status/tasks.js` / `feature-state.mjs`) if both can import it; one `isAncestor`, receipt reader, terminal-state set, `neutral`, lineage regex (review).
- **S19 — Bounded long-session state.** `risk-line.mjs` returns early for a seen `prompt_id` before `git add -A`; `review-gate baseline` prunes this plugin's per-session state older than 7 days; `roleByAgent` is capped (oldest dropped).
- **S20 — Review-store edge cases.** A non-empty lock older than a bound is stale even if its PID is alive; pending lens records are keyed by `agent_id`; an unreadable reminder file is treated as empty.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S3, S4, S13, S14, S17/S18 guard parts | `hooks/scripts/{secret-guard,command-guard,publication-gate,write-scope,delivery-signals,test-lint,mirror-drift}.mjs`, `tests/{guard,publication,signals,mirror-drift}/**` | odd-worker, wave A | 2 | done | `10836a8` |
| T2 | S5, S6, S7, S20 store/lock, S17/S18 review parts | `lib/review/**`, `tests/review/**` | odd-worker, wave A | 4 | done | `dc6a2c9` |
| T3 | S8, S19 hook parts, S20 pending/reminder | `hooks/scripts/{subagent-count,risk-line,review-gate,review-context,review-capture,hook-io}.mjs`, `tests/{gate,risk-line,review-hooks}/**` | odd-worker, wave A | 4 | done | `c43ec6f` |
| T4 | S9, S10, S11, S12, S17 assess parts | `lib/assess/**`, `tests/assess/**` | odd-worker, wave A | 3 | done | `94aa4e6` |
| T5 | S2, S15, S16, S17/S18 mod parts, S19 `roleByAgent` | `install.sh`, `tests/install/**`, `hooks/{register.js,panel/**,status/**}`, `hooks/scripts/feature-state.mjs`, `tests/feature-state/**`, `tests/*.test.ts` under `plugins/construct/tests/` | odd-worker, wave A | 5 | done | `71fc25a` |
| T6 | docs for changed messages | `README.md`, skills text | odd-worker, wave B | none | done | this commit |
| T7 | S9, S12 | key-only diff scan apart; ` b/` header parse | odd-worker, after verify | 3 | done | `f7b61d9` |
| T8 | S3, S8, S15, S16, S18 | verify blockers 2-3 and advisories | odd-worker, after verify | 2, 5 | done | `33b3a79` |
| T9 | S17 | dead `scanTasks` export | odd-worker | none | done | this commit |

## Log

- **L1 (2026-10-20, user):** "trabaja en los 20 puntos"
- **L2 (2026-10-20, progress):** Wave A in five commits: T5 `71fc25a`, T4 `94aa4e6` (RED 6 → GREEN), T3 `c43ec6f` (RED 9 → GREEN), T2 `dc6a2c9` (RED 6 → GREEN), T1 `10836a8` (RED on new guard and corpus tests → GREEN). The branch passed the ~400-line slice at T3; the user chose one PR for the previous feature, so the task commits are the review slices.
- **L3 (2026-10-20, deviations):** S20 pending records are keyed by lens plus lineage and matched by `subject_hash`, not `agent_id`: the PreToolUse Agent input has no child id. `final_verifications` kept: `ONE_SHOT` feeds `policy_hash` of persisted receipts. S16: `owner/repo#ref` is documented (code.claude.com/docs/en/plugins/cli-reference); an already-added unpinned marketplace is left as is on rerun. S1/S3 side effects: `rm -r ~/*` is now a deny in command-guard; `ls .*` is denied; a publication-gate spawn timeout now denies.
- **L4 (2026-10-20, docs):** T6: README, CONTRIBUTING (bump `CONSTRUCT_REF` with the tag), lifecycle.md; `STATE_DIRS` also prunes `delegation-admission`, `delivery-signals`, `mirror-drift` (RED → GREEN). `node --test tests/`: 1244 pass, 0 fail; `claude plugin test plugins/construct`: 160 pass; both validations pass.
- **L5 (2026-10-20, verify):** `odd-verify` on `32d7728`: 17 pass, 3 fail. B1 S9 — key-only paths joined the diff scan, so a >8 MiB text change or a path with ` b/` became high `process_scan_limit`. B2 S18 — `feature-state.mjs` importing `status/tasks.js` crashes on Node before 20.19/22.7 (typeless `.js` loads as CommonJS). B3 S8 — README and comment stale. Advisories: dotfile-glob denies unpinned; duplicate SubagentStop closed another agent's entry; marketplace prefix match; redundant S15 assertion.
- **L6 (2026-10-20, correction):** T7 `f7b61d9` (RED 7 → GREEN; ` b/` fixed for code files too; shortcut: one key-only file whose own diff exceeds the scan limit is skipped). T8 `33b3a79`: feature-state keeps its own parser (RED → GREEN under `--no-experimental-detect-module`), unknown-id stop closes only anonymous entries (RED → GREEN), exact marketplace match (RED → GREEN), five dotfile-glob corpus pins. T9 drops the dead `scanTasks` export. `node --test tests/`: 1254 pass, 0 fail; `claude plugin test`: 160 pass.
- **L7 (2026-10-20, review):** `odd-assess bfdd691..cdce373`: high (install.sh process boundary). User consent: "Lanza". Lineage `review-9f672bc2b9f21b66`, four lenses (reliability relaunched once after a turn-limit stop), approved and acknowledged. Advisory follow-ups, not fixed: (F1) `review-capture.mjs` `pendingFor` falls back to the oldest pending record when a reply has no matching `subject_hash`, which can be a stale lineage; (F2) `passive.mjs:177` tests the whole file for a PEM header, so editing a Markdown/HTML file that already holds one makes it medium; (F3) the shared `isRootOrHome` turns `rm -r ./*` and `rm -r ../*` from ask into deny in command-guard (not listed in L3); (F4) `gate.mjs:61` keeps its own `SOUND` set next to `isSound` in receipt.mjs.
