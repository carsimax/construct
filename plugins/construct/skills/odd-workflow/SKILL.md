---
name: odd-workflow
description: "Organic Driven Development protocol: authorize, explore, classify, track large work in odd/tasks/<feature>.md, implement test-first in work units, and close with evidence. Trigger: any implementation request, feature planning, resuming a feature, or writing a feature document."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill for any request that may change code or docs, for planning a feature, for resuming interrupted work, or when a feature document under `odd/tasks/` is involved. Sizing rules live in `construct:task-size-risk`; delegation rules live in `construct:odd-delegation`.

## Hard Rules

- Run the protocol below in order on every request. Never describe it only when asked about it.
- Read-only requests (investigation, explanation, review, audit, comparison, proposals, planning) never write files, delegate a writer, or create implementation artifacts.
- Ask at most one focused question, and only for a real open product decision. Then stop and wait.
- Small work creates no durable task artifacts. Large authorized work gets `odd/tasks/<feature>.md` before the first source write, without asking permission for them.
- Specs quote the user's exact strings, error messages, commands, and examples verbatim. Never summarize them, and never add requirements the user did not ask for. Mark assumptions as assumptions.
- Check a task off only after its outcome and checks were observed. Record failed, skipped, unavailable, and pending checks honestly.
- Commit work units only on a feature branch (branch first when on the default branch). Push, PR creation, and merge stay with the user.

## Decision Gates

| Situation | Action |
|---|---|
| Change intent ambiguous or conditional | Ask one clarifying question; stay read-only |
| Open product or design decision | Ask one focused question; stop |
| High-consequence unproven premise | One scoped, read-only assumption challenge; no debate loop |
| Unresolved question needing external evidence | Recommend optional research (see references/research.md) |
| Small task | One `construct:odd-worker`, no feature document, no commits unless asked |
| Large task | Feature document, task-by-task work units |
| User reports a failure | Reproduce it before deciding it already works |
| Requirement changes mid-feature | Append it verbatim to `## Log`, rewrite only the affected `S#`, reopen only its task |
| Branch passes about 400 changed lines | Apply the delivery strategy before the next commit (references/delivery.md) |

## Execution Steps

1. **Authorize.** Decide whether the request explicitly authorizes a change.
2. **Explore** the existing code and requirements, proportionately, after `construct-memory search <feature or area>`. Explore only for a map needed to decide or route.
3. **Resolve uncertainty.** Research only for a named uncertainty; one question only for a real product decision.
4. **Classify** with `construct:task-size-risk`.
5. **Track** large work: create the feature document (references/feature-document.md) and tell the user in one line which document was created and how many tasks it holds.
6. **Implement task by task.**
   - Hand off by reference (`Spec: odd/tasks/<feature>.md, T2, S3-S4`) and ask which `S#` were covered.
   - Apply the test-first policy (references/testing.md). During implementation a strong verifier means loop until it passes.
   - Update help text and docs with any changed command, option, or message.
   - After each task, update the document.
   - Commit the work unit and record its commit in `## Tasks`.
7. **Close.** Save decisions, root causes, and conventions learned with `construct-memory save` (large work: `construct-memory summary`), then one report: the verified outcome, every failed, skipped, or unverified check, the next step, and the Risk line (last). The Close reports and never starts another verification loop. Partial or missing proof becomes one **Needs your decision** result.

To resume an interrupted feature, read the injected memory context, run `construct-memory search <feature>`, then follow references/persistence.md.

## Output Contract

Every implementation reply ends with: the outcome, the checks run as `<command>: <observed result>`, every failed, skipped, or unverified check, the next step, and `Risk: item N (reason)` or `Risk: none`.

## References

- [references/feature-document.md](references/feature-document.md): feature document format and update rules.
- [references/testing.md](references/testing.md): test-first policy, differential checks, and scratch state.
- [references/delivery.md](references/delivery.md): work-unit commits, line budget, and delivery strategies.
- [references/persistence.md](references/persistence.md): feature document read-back and resume.
- [references/research.md](references/research.md): optional research and evidence quality.
