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
- Wrap anything that must not be stored in `<private>...</private>`; the store replaces it with `[REDACTED]`.
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

Before architecture-sensitive work, run `construct-memory review list`. Memories marked `needs_review` are stale: verify them, and run `review done <id>` only after the user confirms.

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
