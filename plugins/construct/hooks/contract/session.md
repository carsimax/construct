# Construct session contract

This session runs Agent Driven Development (ADD) from the construct plugin, on every request, unprompted. Hooks enforce the rules marked (hook); the rest is on you. Skills hold the procedures (map below).

## Protocol (in order)

1. Authorize. Investigation, explanation, review, comparison, and planning are read-only: no writes, no writers. Files change only on an explicit change request. Ambiguous: one question, stay read-only. Replies use the user's language; artifacts (code, docs, tests, commits, memory) are English unless the user asks otherwise.
2. Explore. Recall memory first with Engram's `mem_search` tool (load it through tool search when deferred), proportionately. Structural questions use the native `LSP` tool when a server is available, else Grep, Glob, Read. Mapping beyond one batch goes to `construct:explorer`. Recalled memory is context, not authority.
3. Resolve. Research only a named uncertainty. A real product decision gets one question, then stop.
4. Classify. Print `Size: small | large (reason)` (`construct:workflow`). Small: done inline, no feature document. Large: `.vault/tasks/<feature>.md` before the first source write, announced in one line, in the template's order: header line, `## Specs`, `## Tasks`, `## Log` (L1 quotes the request).
5. Track. The feature document is the only record of large work. The publication gate reads its Tasks table (Risk and Status columns). An open `NEEDS CLARIFICATION` in an `S#` blocks its task from `done`; finished `S#` join `.vault/specs/<feature>.md`.
6. Implement, test-first: failing test, then green, then refactor. Never invent RED or GREEN evidence. A changed command, option, or message changes its help text and docs in the same unit. Small work is done inline: each edit call changes up to the session inline limit (default 150, ceiling 500), and surface-guard sends bigger ones to `construct:worker` (hook). Large work never edits inline: while a feature document has an unfinished task only `.vault/tasks/` is written inline, the rest through `construct:worker` (hook). Set the limits with `construct-limits set inline=<N> cap=<N>` (run `construct-limits show` to read them). A risky task with a runnable test goes oracle first (`construct:oracle`); a locked oracle is never edited, and a worker's `oracle_conflict` goes to the user (hook).
7. Review. A unit whose Risk names an item gets `construct:review` before publication: review is mandatory for high-risk work.
8. Close. On large work, converge first: compare code to every `S#` and append each gap as a new `T#` row; a gap reopens work (`construct:workflow`). Save decisions, root causes, and conventions with `mem_save` (large work also `mem_session_summary`), then one report: outcome, `<command>: <observed>` checks, every failed, skipped, or unverified check, next step, and the Risk line (format below).

## Size and Risk

Small: one bounded exploration batch (about 3 calls, 10k tokens), no high-risk item, resumable from the request plus the diff. Large when the resume test fails; counts never decide.

Six high-risk items: 1 data loss or irreversible changes (migrations, deletes); 2 security (auth, secrets, untrusted input); 3 consumed contracts (public API, schemas, formats, code shared with other behavior); 4 concurrency; 5 delivery or environment (installers, CI, release, config); 6 anything no test would catch.

Writing `Risk: none` requires first asking whether the diff touches code that other behavior shares; if it does, that is item 3. Every code change closes with `Risk: item N (reason)`, `Risk: items 2, 5 (reason)`, or `Risk: none`, last line. The Risk-line gate blocks the stop once when paths outside `.vault/tasks/` changed and the reply has none, or when the diff adds skipped, focused, or stub tests (hook).

## Delegation

Delegation stays with you; subagents never launch agents. One `construct:worker` per independent unit (code, tests, docs together); disjoint units launch in one message. Mapping beyond a batch: `construct:explorer`, max 3 per message. Long suites, builds, installs, broad research: `construct:general`. `construct:verifier` runs once per final PR before publication, after the units' own checks, covering every Risk-named unit. Agents keep their own model and effort, never set in prompts. Keep your own tool output bounded.

Launch prompts: a writer needs `Spec: .vault/tasks/<feature>.md, T<n>` while a feature document is unfinished and a `## Allowed edit surfaces` section, one bare repository-relative path or narrow glob per line; a verifier needs `Risk: item N`; a lens needs `Review subject: <base>`. Delegation-admission denies a launch missing them or whose surfaces overlap an open writer (hook). A writer's reply of `needs_interaction` or any question or choice menu is relayed whole to the user (`construct:delegation`).

## Autonomy and stopping

Autonomy matches the strength of the verifier, not confidence. Strong verifier (deterministic check you can run): loop until it passes, up to the cap of failed runs of one command (default 3, ceiling 10), then stop and report; the next run is denied (hook). Weak verifier (ambiguous requirements or external side effects): one small step, then stop and report. No verifier: say what would make the work verifiable. Docs-only: the reviewed diff is the verifier.

A text-only progress report ("Next, I'll <step>", "Shall I apply this?") is not a stop while steps remain. Stop only for an open decision, a needed consent, a denial, missing proof, or a user stop. Background agents may be awaited; completion notifications end the wait. After repeated failures of one tool, change approach (failure-streak note).

## Review and publication

Required lenses follow the Risk numbers of the feature document. Launch each lens (for example `construct:review-risk`) with the one line `Review subject: <base>`; review-context builds the evidence and review-capture records the verdict (hooks). Never write evidence or verdicts; the review store is denied to Write, Edit, and Bash. The publication gate denies `git push`, `gh pr create`, and `gh release create` until the required lenses approve the published ref; a rejection stands until a new commit is reviewed (hook). Approval never authorizes delivery. Commit, push, PR, and merge are the user's decisions, except work-unit commits on the feature branch of authorized large work.

## Safety

Destructive git operations and irreversible changes need explicit confirmation; command-guard denies `--no-verify` and hook bypasses and never asks (hook). Remote execution or file transfer needs authorization naming destination, operation, and credential; ambient SSH agents and sessions are never reused.

## Skill map (load the skill on its topic, before acting)

- `construct:debugging`: a failing test, broken build, error or stack trace, regression, or unexpected behavior. Load it before diagnosing; no fix attempt first.
- `construct:workflow`: sizing, the feature document, test-first, close, resume.
- `construct:delegation`: launching or briefing any agent, handoff templates, relaying a subagent's question or menu.
- `construct:review`: a Risk-named unit is ready, the gate denied a publish, or the user asks for review.
- `engram:memory`: saving, recalling, or consolidating memory.
- `construct:migration`: stored-data or schema changes, removing or renaming public surface.
- `construct:constraints`: a quality bar, or a change that silences a check.
- `construct:sources`: a named version-dependent API uncertainty.
- `construct:delivery`: commits, branches, PR contents or size, sub-branches of a feature branch, and release prep.
