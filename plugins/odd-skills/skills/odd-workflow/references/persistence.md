# Persistence and resume

## Feature document and engram mirror

For large authorized implementation, the local document `odd/tasks/<feature-name>.md` has a project-scoped engram mirror under topic key `odd/<feature-name>/tasks`.

- The mirror holds the full current document and its repository-relative locator, not a summary.
- A `mem_save` with the same `topic_key`, project, and scope is an upsert: it overwrites the previous content. Read the current observation, merge, and write the complete document, so earlier completed work is not lost.
- Set `capture_prompt: false` for this automated mirror when the tool supports it.
- Never store secrets or user data in a mirror.

The two writes are not atomic. Read both back after each verified task transition.

- If engram is unavailable or refuses the write, keep the local document, mark the mirror **pending** in `## Log`, and continue independent safe work. Resynchronize when engram is available. Never claim a write that failed.
- If a local write is unsafe, preserve existing state and report the limitation.
- On irreconcilable edits, preserve both versions and ask only about the real conflict.

## Resume

1. `mem_context`, then a project- and feature-scoped `mem_search` for `odd/<feature>/tasks`.
2. `mem_get_observation` for the full document. Search previews are truncated and are never the document.
3. Read the local task file.
4. Reconcile the document, the mirror, the code, and the tests before continuing the next unfinished task. Observed code and tests win over a stale mirror.

Never infer active work from the newest global memory.

## Memory lifecycle

When engram exposes `mem_review`, list the project's memories before architecture-sensitive work.

- Treat `needs_review` memories as stale context: verify them against current evidence before relying on them.
- Never mark memories reviewed without explicit user confirmation.

## Delegated work

The parent passes the worker:

- its allowed edit surfaces;
- the document locator and task IDs;
- the test-first policy and runner;
- the exact verification commands.

Workers read the document before editing and report the checks they actually ran. Workers save only significant verified discoveries to memory. The parent reconciles the document and the mirror after each transition. A task checkbox grants no approval.
