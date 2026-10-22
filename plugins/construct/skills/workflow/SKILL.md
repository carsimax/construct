---
name: workflow
description: The ODD protocol for every implementation request, feature plan, resume, task sizing, and the closing Risk line. Use it to authorize, explore, classify small or large, track large work in odd/tasks/<feature>.md, implement test-first, and close with evidence.
---

# Workflow

Order for every request. The parent orchestrates; `construct:delegation` says who writes.

1. **Authorize.** Investigation, explanation, review, comparison, and planning stay read-only. Files change only when the user asks for a change. Ambiguous intent: one question, read-only until answered. The surface-guard hook denies a main-thread write outside `odd/tasks/`.
2. **Explore.** Start with `construct-memory search <feature or area>`, proportionately. Stop once the worker's edit surfaces and handoff can be written. More than one bounded batch goes to `construct:explorer`.
3. **Resolve uncertainty.** Research only a named uncertainty ([research](references/research.md)). A real open product decision gets one question, then the turn stops.
4. **Classify.** Print `Size: small | large (reason)`.
5. **Track.** Large work gets `odd/tasks/<feature>.md` before the first source write ([feature document](references/feature-document.md)). Say in one line which document exists and its task count.
6. **Implement** task by task, test-first ([testing](references/testing.md)). Hand off by reference (document, task, `S#`), never paraphrase. Any changed command, option, or message changes its help text and docs in the same unit. Commits and branches: [delivery](references/delivery.md).
7. **Review.** A unit whose Risk names an item gets `construct:review` before publication; the publication gate denies `git push`, `gh pr create`, and `gh release create` until the lenses approve.
8. **Close.** Save what was learned (`construct-memory save`; large work also saves the session summary), then one report: the verified outcome, every failed, skipped, or unverified check, the next step, and the Risk line (last). Close reports and never starts another verification loop. On large work, converge first: compare the code to every `S#`, append each gap as a new `T#` row, never rewrite or delete rows; a gap reopens work. Converge is not a verification run.

## Size

Small means all three hold:

- Understood: outcome, change, and location are provable in one bounded read batch (about 3 calls, 10k tokens).
- No high-risk item applies.
- Resumable from the request plus `git diff` alone (the resume test).

Large means the resume test fails: several sessions, external waits, separate deliverables, or requirements too long to survive compaction. File counts, command counts, or a requested todo list never decide size.

- Small: one `construct:worker`, no feature document, no commits unless asked.
- Large: feature document first, then work-unit commits on a feature branch.

## Risk

High risk means a mistake is hard to detect, hard to undo, or reaches beyond the change:

1. Data or irreversible effects: migrations, stored-data changes, persisted formats.
2. Security: auth, permissions, credentials, secrets, guards, sandbox.
3. Contracts others consume: changing or removing public API, CLI flags, config formats, exports, or shared code other behavior uses. Adding one, or making a requested change, is not high risk.
4. Concurrency: locks, races, async ordering.
5. Delivery or environment: installers, release, CI, deploy, dependencies.
6. Places where no test would catch a regression.

Before `Risk: none`, check whether the diff touches shared code other behavior uses; if so, that is item 3.

Every code change closes with `Risk: item N (reason)`, `Risk: items 2, 5 (reason)` for several items, or `Risk: none`. The Risk-line hook blocks a reply once when paths outside `odd/tasks/` changed and no Risk line exists, or when the diff adds skipped, focused, or stub test markers. The admission hook reads the same line before it admits a verifier. In the Tasks table, the Risk cell holds the item numbers (`2, 5`, `2-3`) or `none`; the publication gate reads them to require lenses.

## Autonomy

During implementation, with a strong verifier (tests, build, typecheck), loop until it passes. With a weak verifier (no tests, ambiguous requirements, external effects), take one small step, show it, and stop. With none, say what would make the work verifiable; for docs-only units the reviewed diff is the verifier. Approval for one step is never approval for the next. Commit, push, PR, and merge belong to the user, except work-unit commits on a feature branch.

## Resume

Run `construct-memory context`, then follow [persistence](references/persistence.md). The feature-state hook re-injects unfinished tasks after compaction or resume.
