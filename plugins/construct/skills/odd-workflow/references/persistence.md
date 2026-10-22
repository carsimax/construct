# Persistence and resume

## Feature document

For large authorized implementation, the local document `odd/tasks/<feature-name>.md` is the only record of the work; git versions it.

- If a local write is unsafe, preserve existing state and report the limitation.
- On irreconcilable edits, preserve both versions and ask only about the real conflict.

## Resume

1. Read the local task file.
2. Reconcile the document, the code, and the tests before continuing the next unfinished task. Observed code and tests win over a stale document.

Never infer active work from the newest global memory.

## Memory lifecycle

Run `construct-memory review list` before architecture-sensitive work.

- Treat `needs_review` memories as stale context: verify them against current evidence before relying on them.
- Never mark memories reviewed without explicit user confirmation.

## Delegated work

The parent passes the worker:

- its allowed edit surfaces;
- the document locator and task IDs;
- the test-first policy and runner;
- the exact verification commands.

Workers read the document before editing and report the checks they actually ran. Workers save only significant verified discoveries to memory. The parent reconciles the document after each transition. A task checkbox grants no approval.
