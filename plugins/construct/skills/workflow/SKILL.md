---
name: workflow
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" *)
description: The ODD protocol for every implementation request, feature plan, resume, task sizing, and the closing Risk line.
---

# Workflow

## Current state

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" workflow`

Order for every request. The parent orchestrates; `construct:delegation` says who writes.

1. **Authorize.** Investigation, explanation, review, comparison, and planning stay read-only. Files change only when the user asks for a change. Ambiguous intent: one question, read-only.
2. **Explore.** Start with `construct-memory search <feature or area>`, proportionately. Stop once the worker's edit surfaces and handoff can be written. More than one bounded batch goes to `construct:explorer`.
3. **Resolve uncertainty.** Research only a named uncertainty ([research](references/research.md)). A real open product decision gets one question, then the turn stops.
4. **Classify.** Print `Size: small | large (reason)`.
5. **Track.** Large work gets `odd/tasks/<feature>.md` before the first source write ([feature document](references/feature-document.md)). Say which document exists and its task count.
6. **Implement** task by task, test-first ([testing](references/testing.md)). Hand off by reference (document, task, `S#`), never paraphrase. Any changed command, option, or message changes its help text and docs in the same unit. Commits, branches, and pull requests: `construct:delivery`.
7. **Review.** A unit whose Risk names an item gets `construct:review` before publication; the publication gate denies publishing until the lenses approve.
8. **Close.** Save what was learned (`construct-memory save`; large work also saves the session summary), then one report: what was verified, each check that failed, was skipped, or stayed unverified, the next step, and the Risk line (last). Close reports and never starts another verification loop. On large work, converge first: compare the code to every `S#`, append each gap as a new `T#` row, never rewrite or delete rows; a gap reopens work. Converge is not a verification run.

## Size

Small means all three hold:

- Understood: outcome, change, and location are provable with one bounded round of reads (roughly 3 calls, 10k tokens).
- No high-risk item applies.
- Resumable from the request plus `git diff` alone (the resume test).

Large means failing the resume test: several sessions, outside parties, separate deliverables, or requirements that would not survive compaction. Never size by file counts, command counts, or a requested todo list.

- Small: done inline (edit calls up to `inline_edit_max_lines` lines, default 20; bigger ones go to `construct:worker`), no feature document, no commits unless asked.
- Large: feature document first, then work-unit commits on a feature branch.

## Risk

A change is high risk when a mistake would be hard to notice or reverse, or would spread past the change:

1. Data or irreversible effects: migrations, stored-data changes, persisted formats.
2. Security: auth, permissions, credentials, secrets, guards, sandbox.
3. Contracts that others consume: altering or removing a public API, CLI flag, config format, export, or code shared with other behavior. Adding one, or making a requested change, is not high risk.
4. Concurrency: locks, races, async ordering.
5. Delivery or environment: installers, release, CI, deploy, dependencies.
6. Places where no test would catch a regression.

Before `Risk: none`, ask whether the diff touches code other behavior shares; if so, that is item 3.

Every code change closes with `Risk: item N (reason)`, `Risk: items 2, 5 (reason)` for several items, or `Risk: none`. The Risk-line hook blocks a reply once when paths outside `odd/tasks/` changed and no Risk line exists, or when the diff adds skipped, focused, or stub test markers. The admission hook reads the same line before it admits a verifier. In the Tasks table, the Risk cell holds the item numbers (`2, 5`, `2-3`) or `none`; the publication gate reads them to require lenses.

## Autonomy

During implementation, with a strong verifier (tests, build, typecheck), loop until it passes. With a weak verifier (no tests, ambiguous requirements, external effects), take one small step, show it, and stop. When none exists, state what would make the work verifiable; in docs-only units the reviewed diff is the verifier. Approval of one step never carries over to the next. Commit, push, PR, and merge belong to the user, except work-unit commits on a feature branch.

## Resume

Run `construct-memory context`, then follow [persistence](references/persistence.md). The feature-state hook re-injects unfinished tasks after compaction or resume.
