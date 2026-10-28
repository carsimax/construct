# Feature document

Path `.vault/tasks/<feature>.md`, created before the first source write of large work. The feature-state hook re-injects its unfinished tasks after compaction or resume; the publication gate reads its Risk cells. Fixed order:

```markdown
# <Feature>

Objective: <one sentence>. Branch: <branch>. Baseline: <commit>. Test runner: <command>.

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
- Large work lives on `feat/<feature>`; a task or cohesive group gets a local sub-branch `feat/<feature>-t<n>` (see `construct:delivery`).
- Tasks have stable IDs linked to `S#`. The hook needs the `ID`, `Task`, `Status`, and `Specs` columns, and warns when a spec has no task or a task names an unknown spec. A Status whose first word is `done` or `dropped` is finished; anything else is unfinished.
- Risk cell: item numbers 1-6 (ranges allowed) or `none`; any other text makes the gate deny.
- Log: L1 is the verbatim request; later corrections are verbatim with a date; progress notes stay brief. Keep a line `Next step: <action>` near the end; the hook shows it.
- A requirement change appends a verbatim Log entry, rewrites just the `S#` it touches, and reopens just its task. Findings never expand scope.
- Record the baseline commit in the header before the first change; the verifier's baseline comes from it.
- An `S#` that cannot be fully specified carries `NEEDS CLARIFICATION: <question>`; the gate denies a `done` task naming it. Ask the user, record the answer in the Log, then rewrite the `S#` without the marker.
- Quote rule: each `S#` quotes its Log entry verbatim in double quotes, or says `Assumption`; the hook warns on an `S#` with neither.
- Feature documents are never deleted. When all tasks are finished, write the `S#` to `.vault/specs/<feature>.md`.
