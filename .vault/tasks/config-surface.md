# Config surface

Objective: shrink `/config`: no per-role model or effort options, no `command_guard_asks`, and `inline_edit_max_lines` and `iteration_cap` set by the orchestrator per session within fixed ceilings, with no inline source writes while a feature document has unfinished tasks. Branch: feat/config-surface (sub-branches feat/config-surface-t<n>). Baseline: 58bd1dd. Test runner: node --test 'tests/**/*.test.mjs'; claude plugin test plugins/construct.

## Specs

- **S1 — No per-role model or effort options.** "los modelos y niveles de pensamiento de los agentes no se configuran, se quedan con el varlo por defecto que y tienen" (L2), "el general-purpose debe tener sonnet/medium" (L3).
  - Given the installed plugin When the user opens `/config` Then no `model_<role>` or `effort_<role>` option is listed.
  - Given a construct agent launch When the mod routes it Then the agent runs on its frontmatter model and effort (the mod sets neither).
  - Given a built-in `general-purpose` launch When the mod routes it Then it runs on `sonnet` with effort `medium`.
- **S2 — No destructive-command asks.** "command_guard_ask debe eliminarse, se asume que los agentes siempre pueden hacer comandos destructivos" (L2), "Si que se mantenga" (L3, about the bypass denies).
  - Given any destructive command (`rm -rf`, `git push --force`, `git reset --hard`, `git clean -f`, `git checkout .`, `git restore .`, `find -delete`) When command-guard runs Then it gives no output, and `command_guard_asks` is gone from `userConfig`.
  - Given `--no-verify`, a hook bypass, or a write to a locked oracle When command-guard runs Then it denies as before.
- **S3 — Orchestrator-set limits.** "Para inline_edit_max_lines y iteration_cap hay forma que el orquestador sea quien determine esos valores? ya que cada proyecto y sesiones pueden tener diferentes criterios y magnitudes" (L2), "A" (L3), "Ok" (L4).
  - `inline_edit_max_lines` and `iteration_cap` are gone from `userConfig`.
  - Given `construct-limits set inline=<N> cap=<N>` run in a session (keyed by `CLAUDE_CODE_SESSION_ID`) When surface-guard or iteration-cap runs in that session Then they use the declared values, each clamped to its ceiling (inline 500, cap 10); undeclared values use the defaults (inline 150, cap 3). `cap=0` turns the cap off and `inline=0` means `.vault/tasks/` only, as today. `construct-limits show` prints the active values; invalid input exits non-zero with a message and changes nothing.
  - Assumption: limits are per session only (no persisted per-project value). `construct-limits show` is how they are seen; the band does not show them (L6).
- **S4 — No inline writes during tracked work.** "nada se haga inline al menos en cuestiones de las task cualquier otra cosa si puede ser inline" (L3).
  - Given a `.vault/tasks/*.md` with an unfinished task (`activeDocuments`) When the main thread writes a repository path outside `.vault/tasks/` Then surface-guard denies it whatever the limit, naming `construct:worker`.
  - Given no unfinished feature document When the main thread writes Then the inline limit of S3 applies.
  - Assumption: the hook cannot tell which task a path belongs to, so the rule covers every main-thread write outside `.vault/tasks/` while any document is unfinished.
- **S5 — Docs.** Assumption: README, CONTRIBUTING consistency table, CLAUDE.md, session contract, workflow, delegation, debugging, and constraints skills, and CHANGELOG describe the new behavior; no doc names a removed option.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S5 | Remove model/effort userConfig and option routing; keep general-purpose on sonnet/medium; docs | worker | 3 | done | c3139b8 |
| T2 | S2, S5 | Remove command_guard_asks and every ask rule from command-guard; docs | worker | 2, 3 | done | 89273d3 |
| T3 | S3, S4, S5 | `construct-limits` session limits read by surface-guard and iteration-cap with ceilings; no inline writes while a document is unfinished; band shows limits; docs | worker | 2, 3 | done | 5712399, 065bb22 |

## Log

- **L1 (2026-10-28):** "Actualmente que es configurable a travez de /config"
- **L2 (2026-10-28):** "Necesito que alginas cosas no se modifiquen, poer ejemplo mos modelos y niveles de pensamiento de los agentes no se configuran, se quedan con el varlo por defecto que y tienen. command_guard_ask debe eliminarse, se asume que los agentes siempre pueden hacer comandos destructivos. Para inline_edit_max_lines y   iteration_cap hay forma que el orquestador sea quien determine esos valores? ya que cada proyecto y sesiones pueden tener diferentes criterios y magnitudes"
- **L3 (2026-10-28):** "1. el general-purpose debe tener sonnet/medium 2. Si que se mantenga 3. A pero con un cambio que ya habioamos hecho que nada se haga inline al menos en cuestiones de las task cualquier otra cosa si puede ser inline, se puede?" (2 = keep the `--no-verify` and hook-bypass denies; 3 A = orchestrator declares the limits, hooks clamp to a fixed ceiling.)
- **L4 (2026-10-28):** "Ok" (accepts ceilings inline 500 / cap 10 and per-session limits). Verified: `CLAUDE_CODE_SESSION_ID` in Bash equals the transcript session id hooks receive.
- **L5 (2026-10-28):** T2 review-risk WARNING: users who had `command_guard_asks` on lose the hook confirmation on upgrade, silently. Accepted: it is the requested behavior (L2) and CHANGELOG marks it Breaking.
- **L6 (2026-10-28):** T3: the mod has no session id or plugin data dir, so the band cannot show the limits without new plumbing; dropped from S3. The user unlocked `tests/iteration-cap/iteration-cap.test.mjs` (old odd/ oracle asserting the removed option) through AskUserQuestion.
- **L7 (2026-10-28):** Live check found the Bash tool has no CLAUDE_PLUGIN_DATA, so construct-limits wrote where hooks never read; fixed (hooks read both dirs, newer wins). Review: subagents may not run `construct-limits set` (fixed). Left open (non-blocking WARNINGs): a set crossing the two dirs drops the other key; a subagent can still write the limits file directly or through `node -e`.
- **L8 (2026-10-28):** Verifier: S1-S5 pass (1290/1290 tests). Advisories left for the user: `echo construct-limits set` from a subagent is also denied; `limits/` is not in `pruneState` STATE_DIRS; stale comment at roles.mjs:26.
- Next step: the PR on the user's word.
