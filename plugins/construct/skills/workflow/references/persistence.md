# Persistence and resume

The feature document is the only record of large work: The feature-state hook re-injects the unfinished rows (at most 2,500 characters) after compaction or resume; read the full document before continuing.

## Resume

1. Run `mem_context`, then `mem_search`.
2. Read `.vault/tasks/<feature>.md` fully.
3. Reconcile document, code, and tests (`git log`, `git status`, the test run). Observed code wins; fix the document.
4. Continue from the first unfinished task, or run the converge step when all are done.

## Writing

- A task is `done` only after its outcome and checks were observed. Record failed, skipped, and pending honestly, with the evidence in the Status cell.
- Write the document safely: an interrupted or unsafe write must preserve the prior state. Irreconcilable concurrent edits keep both versions and ask the user.
- Save decisions, root causes, and conventions with `mem_save`; close a session with `mem_session_summary`.
