# Iteration cap

Objective: an agent stops and reports after a check fails a fixed number of times instead of looping, and never edits the test to pass (ADD P3). Branch: feat/iteration-cap. Baseline: d2158dc. Delivery strategy: ask-on-risk; chains: stacked-to-main. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Count consecutive failures per check.** A passing run of the command (PostToolUse) resets its count (L4). "Vamos asi" (design approved in conversation): a new hook `iteration-cap.mjs` on PostToolUseFailure counts failed runs of the same Bash command (whitespace-normalized) per agent (the main thread is one agent) per session. Interrupts are not failures.
- **S2 — Cap.** On PreToolUse for Bash, a command that already failed `iteration_cap` times (default 3) for this agent is denied, with a message telling the agent to stop and report what it tried, the failure, and its hypothesis, and never to edit the test to pass.
- **S3 — Reset.** A subagent's counters end when it stops (SubagentStop). The main thread's counters reset when the user sends a new prompt (UserPromptSubmit): the user's reply authorizes another round.
- **S4 — Configurable.** `iteration_cap` in the plugin userConfig (number, default 3; read from `CLAUDE_PLUGIN_OPTION_ITERATION_CAP`; a value that is not a whole number of 1 or more uses the default; 0 turns the cap off). Assumption: 0 disables, like `inline_edit_max_lines` 0 changes the rule.
- **S5 — Fails open.** Any hook error means no output and exit 0; the cap never blocks a command it cannot attribute.
- **S6 — Strong check defined.** The workflow skill defines a strong check: deterministic, runnable now, not written or loosened in the same loop (a locked oracle satisfies the last by construction). The session contract and worker.md carry one line each about the cap.
- **S7 — Measured.** An eval case whose test cannot be made to pass by a correct implementation passes when the agent stops and reports within the cap instead of looping or editing the test.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3, S4, S5 | Acceptance tests by construct:oracle (RED) | oracle | 2, 3 | done | 0b00247 |
| T2 | S1, S2, S3, S4, S5 | iteration-cap hook, hooks.json, userConfig, README, CHANGELOG | worker | 2, 3 | done | 29f7ab6 |
| T4 | S1 | Count consecutive failures: a passing run (PostToolUse) resets the command's count; registration test for all events | inline | 2, 3 | done | f39ca01 |
| T3 | S6, S7 | workflow skill, contract, worker.md, METHODOLOGY P3, eval case | worker | 3 | done | a004bc6 |

## Log

- **L1 (2026-10-28):** "Vamos con P3"; design approved: "Vamos asi" (configurable cap, default 3).
- **L2 (2026-10-28):** First live oracle run: 21 tests RED, lock recorded (construct-gate oracle list: active, matches). The deny reason must contain "never edit the test" and "hypothesis"; failures without session_id are never counted.
- **L3 (2026-10-28):** T2 made the 21 locked tests pass without touching them (oracle list: matches). T3 removed two descriptive hook lines from the workflow skill to fit 700 words (listed, accepted).
- **L4 (2026-10-28):** "vamos con consecutivos!": only consecutive failures count; a passing run resets the command.
- Next step: review and PR.
