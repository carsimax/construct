# Config surface


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

