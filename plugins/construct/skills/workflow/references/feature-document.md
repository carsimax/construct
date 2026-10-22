# Feature document

Path `odd/tasks/<feature>.md`, created before the first source write of large work. The feature-state hook re-injects its unfinished tasks after compaction or resume; the publication gate reads its Risk cells. Fixed order:

```markdown
# <Feature>

Objective: <one sentence>. Branch: <branch>. Baseline: <commit>. Delivery strategy: <ask-on-risk | auto-chain | single-pr | exception-ok; chains: stacked-to-main | feature-branch-chain>. Test runner: <command>.

## Specs

- **S1 — <name>.** "<user words, verbatim, in their language>"
  - Given <state> When <action> Then <observable result>.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | <task> | worker | none | pending | — |

## Log

- **L1 (<date>):** "<the request, verbatim>"
```

## Rules

- Specs quote the user verbatim, mark every assumption, and add nothing unrequested. Given/When/Then is optional.
- Tasks have stable IDs linked to `S#`. The hook needs the `ID`, `Task`, `Status`, and `Specs` columns, and warns when a spec has no task or a task names an unknown spec. A Status whose first word is `done` or `dropped` is finished; anything else is unfinished.
- Risk cell: item numbers 1-6 (ranges allowed) or `none`; any other text makes the gate deny.
- Log: L1 is the verbatim request; later corrections are verbatim with a date; progress notes stay brief. Keep a line `Next step: <action>` near the end; the hook shows it.
- A requirement change appends a verbatim Log entry, rewrites just the `S#` it touches, and reopens just its task. Findings never expand scope.
- Record the baseline commit in the header before the first change; the verifier's baseline comes from it.
