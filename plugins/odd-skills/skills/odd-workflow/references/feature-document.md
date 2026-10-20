# Feature document

Path: `odd/tasks/<feature-name>.md`, with a descriptive, filename-safe feature name. Reuse the same identity for the whole feature, and never overwrite another feature's document. Keep one document per feature, not a separate plan file.

The document is the specification that subagents read by reference. Keep this fixed order: stable content first, the growing log last.

```markdown
# <Feature title>

Objective: <one line>. Branch: <feature branch>. Delivery strategy: <ask-on-risk | auto-chain | single-pr | exception-ok>. Test runner: <command>.

## Specs

- **S1 — <name>.** "<the user's exact words>". Scope, acceptance criteria, applicable checks.
- **S2 — ...**

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | <one line> | inline | none | pending | — |

## Log

- **L1 (<date>, user):** "<the user's original request, verbatim>"
- **L2 (<date>, ...):** <evidence, decision, correction, or progress>
```

## Rules

- **Specs.**
  - Number them `S1`..`Sn`.
  - Quote the user's strings, error messages, commands, and examples verbatim, in the user's language.
  - Never reword those fragments, and never add unrequested requirements.
  - Mark assumptions as assumptions.
- **Tasks.**
  - Give each task a stable ID, its linked `S#`, its route (inline or delegated, with the trigger evidence when delegated), its status, and its commit or RED/GREEN evidence.
  - Plan about 400 authored changed lines per task as a heuristic only. It is not a cap, a stop, or a reason to split artificially.
- **Log.**
  - `L1` is the original request, verbatim.
  - Later user corrections are appended verbatim with their date.
  - Analysis, the rationale for accepted changes, verification evidence, progress, and the next step are appended briefly.
- **Changes.** An accepted requirement change appends its verbatim Log entry, rewrites only the affected `S#`, and reopens only its task. Preserve valid completed work. Findings alone never expand scope. Business scope changes need user authorization.
- **Handoffs.** Workers read the document until `## Log` before editing, and report which `S#` they covered.
