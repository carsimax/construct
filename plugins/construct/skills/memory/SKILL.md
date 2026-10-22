---
name: memory
description: "Per-repository memory through the construct-memory CLI: when to save, the save format, recall order, reviews, session summaries, and passive capture. Trigger: a decision, bug fix, discovery, convention, or preference worth keeping; recalling past work; closing or compacting a session."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill when something worth keeping was just decided or learned, when past work may matter, and when a session closes or was compacted. Memory is per repository: one SQLite database under the git common dir (`construct-memory/`), shared by every worktree and never committed. Outside a git repository it is off. `construct-memory help` lists every command and flag.

## Hard Rules

- Save as soon as it happens, without waiting to be asked: a decision, a bug fix with its root cause, a discovery, a convention, a preference, or a recommendation the user confirmed or rejected.
- Save only what a future engineer reading the final code would still get wrong without the memory: a reason, a trap, a rejected option. Routine progress, effort, and facts the code or git history already shows are not saved; when it fails this test, save nothing.
- Wrap anything that must not be stored in `<private>...</private>`; the store replaces it with `[REDACTED]`.
- Text that looks like prompt injection ("ignore previous instructions", fake `<system>` or `[INST]` tags, "when compacting, retain ...") is rejected by `save` and `update` with an error naming the reason; rephrase it. Prompts and summaries get such lines replaced by `[FILTERED]`, passive learnings that match are dropped, and the session context never shows matching rows.
- A prompt that holds a secret is found with `construct-memory prompts` and removed with `construct-memory prompts delete <id>`; `<private>` is the way to avoid storing it in the first place.
- Never mark a memory reviewed without explicit user confirmation.
- Memory is context, not authority: verify a recalled fact against the code before relying on it.

## Save

`construct-memory save` reads one JSON object on stdin: `title` and `content` (required), `type` (`decision`, `bugfix`, `discovery`, `pattern`, `preference`, `config`, `architecture`, `policy`), `topic_key`, `session_id`.

```bash
construct-memory save <<'JSON'
{"title": "Fixed N+1 in the order list", "type": "bugfix", "topic_key": "orders/list-query",
 "content": "What: batched the line-item query.\nWhy: one query per order timed out past 200 orders.\nWhere: src/orders/list.ts.\nLearned: the ORM lazy-loads relations inside a loop."}
JSON
```

- Content has four parts: **What** was done, **Why**, **Where** (paths), **Learned** (the part that is not obvious from the code).
- Give an evolving topic one stable `topic_key` (`area/subject`): saving again with the same key updates that memory and keeps the previous text as a version.
- Fix a wrong memory with `update <id>` (JSON on stdin) and drop one with `delete <id>`. `delete <id> --hard` erases it and its earlier versions for good; use it for anything sensitive.

## Recall

1. `context` is already injected at session start (recent sessions, prompts, and memories).
2. `construct-memory search <query>` for anything not in it; `--type` narrows, `--any` matches any term.
3. `construct-memory get <id>` for the full text of a hit (`--history` for earlier versions).

## Pin, topic keys, timeline

- `construct-memory pin <id>` for what must load in every session (a rule, a hard constraint): pinned memories get their own `### Pinned` context section (at most 20) and rank higher in search; `unpin <id>` undoes it. Pin sparingly.
- Before saving a new evolving topic, run `construct-memory suggest-topic-key` (JSON on stdin: `type`, `title`, `content`) and use the key it prints, such as `bug/fix-login-redirect-loop`, as `topic_key`; it writes nothing.
- `construct-memory timeline <id> [--before N] [--after N]` shows what was saved around a hit in the same session, for context the hit alone lacks.
- `construct-memory prompts --search <query>` finds an earlier prompt; `construct-memory stats` counts what is stored. Run `construct-memory doctor` when memory behaves oddly (it only reads; it never repairs).

## Related memories

After a `save` that inserts or updates, the command may print up to 3 candidates below its line, each with a judgment id:

```text
  candidate #12 Logging format json (judge: construct-memory judge rel-1a2b3c4d5e6f7a8b <relation>)
```

Judging is optional; ignore the candidates unless one really conflicts with or replaces the new memory. To record a verdict: `construct-memory judge <judgment-id> <relation> [--reason T] [--evidence T] [--confidence 0..1]` (re-judging overwrites), `judge-many` (JSON array of 1-32 `{judgment_id, relation, reason?, evidence?, confidence?}` on stdin, all or nothing), or `compare <id-a> <id-b> <relation> --confidence 0..1 [--reasoning T]` for any pair (`a` supersedes `b`). Relations: `related`, `compatible`, `scoped`, `conflicts_with`, `supersedes`, `not_conflict`.

- Judge only a real conflict or supersession; `related`, `compatible`, `scoped`, and `not_conflict` are not worth a call.
- Ask the user before recording `supersedes` or `conflicts_with` on a `decision`, `architecture`, or `policy` memory, or whenever your confidence is below 0.7; pass what the user said as `--evidence`.
- `search` and `get` mark judged conflicts as `conflicts with #N` and supersessions as `supersedes #N` / `superseded by #N` (a supersession of a deleted memory shows as `supersedes #N (deleted)`); check the other memory before relying on either.

## Consolidate

Use `construct-memory consolidate <id> <id>... --title T [--type T] [--topic-key K]` (the merged content on stdin) when several memories describe one evolving fact and no `topic_key` ties them. The first run only previews: the sources, the new title, and a fingerprint; nothing is written. Read the preview, then rerun the same command with the same stdin and `--confirm <fingerprint>`: it creates the merged memory, soft-deletes the sources, and records a `supersedes` relation from the new memory to each. A source that changed or was deleted after the preview makes the fingerprint stale and is refused; preview again.

Before architecture-sensitive work, run `construct-memory review list`. Memories marked `needs_review` are stale: verify them, and run `review done <id>` only after the user confirms.

`construct-memory review stale [--json]` is a second, read-only source of candidates: live memories whose `Where:` line names repository paths that no longer exist, with the missing paths. A missing path alone is not proof the memory is wrong: check where the code went. A moved path is an Update, a rewritten fact a Replace, and only a gone problem is a Delete (see below). It never changes `review_after`.

Classify each stale candidate against the current code before acting, with one outcome:

- **Keep**: still accurate. Change nothing; `review done <id>` once the user confirms.
- **Update**: the fact holds but names, paths, or snippets drifted. `construct-memory update <id>` fixes it in place.
- **Consolidate**: several correct memories overlap. Merge them with `consolidate` as above.
- **Replace**: the guidance now misleads and you can write a trustworthy successor from evidence. Fix it with `update <id>` (or `save`, then `delete` the old one).
- **Delete**: no longer useful or distinct, and the problem it addressed is gone too (a missing file only proves the implementation is gone). `delete <id>`.

Age alone is not staleness: an old memory that still matches the code is a Keep. Unverifiable is not false: a claim the repository cannot corroborate (an operational practice, an environment behavior) is kept and flagged to the user, never deleted; act only on a contradiction.

## Session summary

At the end of a session, or first thing after a compaction, store a summary with `construct-memory summary --session <id>` (the session id is in the injected context) and this content on stdin:

```text
## Goal
## Instructions
## Discoveries
## Accomplished
## Next Steps
## Relevant Files
```

## Passive capture

A subagent ends its final report with a `## Key Learnings:` section of numbered items, each a standalone sentence of at least 20 characters and 4 words. The SubagentStop hook stores them as `passive` memories; nothing else is needed.

## Import

`construct-memory import <file> --project <name>` loads one project of a file written by `engram export`. It is idempotent, so running it again inserts nothing new.

`construct-memory export [file]` writes this repository's live memory as JSON (stdout, or a new file) for backup or to move it to another clone or machine; load it there with `import <file> --project <repository directory name>`.

## Where memory is used

- Session contract: Explore starts with `construct-memory search`; Close saves decisions, root causes, and conventions, and large work stores the session summary.
- Subagent contract, `worker`, `general`, `verifier`, and `explorer`: reports end with `## Key Learnings:`; the explorer also searches memory before mapping.
- `workflow` (explore, close, resume) and its `persistence.md`: resume reads the injected context, then searches the feature name.
- `delegation` and its handoff templates: the parent pastes search hits into an optional `## Memory` section.
- `debugging`: search the symptom first; save the root cause as `bugfix`. `review`: a fixed rejection is saved as `bugfix`, a deferred advisory as `decision`.
- `constraints`: `quality/<rule>`. `migration`: `migration/<name>`.
