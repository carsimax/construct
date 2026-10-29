---
name: workflow
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" *)
description: The ADD protocol for every implementation request, feature plan, resume, task sizing, and the closing Risk line.
---

# Workflow

## Current state

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" workflow`

Order for every request; the parent orchestrates (`construct:delegation`: who writes).

1. **Authorize.** Investigation, explanation, review, comparison, and planning stay read-only; files change only on a change request. Ambiguous intent: one read-only question.
2. **Explore.** Start with `mem_search`, proportionately; stop once surfaces and handoff can be written. More than one bounded batch goes to `construct:explorer`.
3. **Resolve uncertainty.** Research only a named uncertainty ([research](references/research.md)). A real product decision gets one question, then stop. A gap that changes the outcome and is costly to undo is `NEEDS CLARIFICATION: <question>` in the `S#` (at most 3 open per document); any other gap is a marked `Assumption`. A `done` task cannot depend on an open clarification (the publication gate denies it).
4. **Classify.** Print `Size: small | large (reason)`.
5. **Track.** Large work gets `.vault/tasks/<feature>.md` before the first source write ([feature document](references/feature-document.md)); name it and its task count.
6. **Implement** task by task, test-first; every code task goes oracle first ([testing](references/testing.md)). Hand off by reference (document, task, `S#`), never paraphrased. A changed command, option, or message changes its help and docs in the same unit. Commits, branches, PRs: `construct:delivery`.
7. **Review.** A unit whose Risk names an item gets `construct:review` before publication; the gate denies publishing until lenses approve.
8. **Close.** Save what was learned (`mem_save`; large work also `mem_session_summary`), then one report: what was verified, each check that failed, was skipped, or stayed unverified, the next step, the Risk line (last). Close reports; it never starts another verification loop. On large work, converge first: compare the code to every `S#`, append each gap as a new `T#` row (never rewrite or delete rows); a gap reopens work. Write the feature's `S#` to `.vault/specs/<feature>.md` (a feature changing earlier behavior edits that file).

## Size

Small means all hold:

- Understood: outcome, change, and location provable in one bounded round of reads (about 3 calls, 10k tokens).
- No high-risk item applies.
- Resumable from the request plus `git diff` (resume test).

Large means failing the resume test: several sessions, outside parties, separate deliverables, or requirements not surviving compaction. Never size by file counts, command counts, or a todo list.

- Small: no commits unless asked; code takes the [one-task template](references/feature-document.md#one-task-template), then oracle, then `construct:worker`.
- Large: feature document first, then work-unit commits on a feature branch.

## Risk

High risk: a mistake hard to notice or reverse, or spreading past the change:

1. Data or irreversible effects: migrations, stored-data changes, persisted formats.
2. Security: auth, permissions, credentials, secrets, guards, sandbox.
3. Contracts others consume: altering or removing a public API, CLI flag, config format, export, or code shared with other behavior. Adding one, or a requested change, is not high risk.
4. Concurrency: locks, races, async ordering.
5. Delivery or environment: installers, release, CI, deploy, dependencies.
6. Places no test would catch a regression.

`Risk: none` needs a diff touching no shared code (else item 3).

Code changes close with `Risk: item N (reason)`, `Risk: items 2, 5 (reason)`, or `Risk: none`. The Risk-line hook blocks once when paths outside `.vault/tasks/` changed with no Risk line, or the diff adds skipped, focused, or stub test markers. The Tasks Risk cell holds item numbers (`2, 5`, `2-3`) or `none`; the publication gate reads them to require lenses.

## Autonomy

During implementation, with a strong check (deterministic, runnable now, not written or loosened in the loop; a locked oracle counts), loop until it passes; for code the oracle envelope (attempts, minutes, lines) bounds it: a hook blocks the worker's stop while red with budget left, and allows it once spent. Then stop, reporting attempts, failure, hypothesis; never edit the test. With a weak verifier (no tests, ambiguous requirements, external effects), take one small step, show it, and stop. With none, state what would make the work verifiable; docs-only: the reviewed diff verifies. Approval never carries over. Commit, push, PR, merge are the user's, except work-unit commits on a feature branch.

## Resume

Call `mem_context`, then follow [persistence](references/persistence.md).
