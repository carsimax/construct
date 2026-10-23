---
name: memory
description: "Per-repository memory through the construct-memory CLI: what to save and how, recall order, relations, reviews, session summaries, passive capture. Trigger: a decision, root-cause fix, discovery, convention, or preference worth keeping; recalling past work; closing or compacting a session."
---

# Memory

One SQLite store per repository, shared by every worktree, never committed. `construct-memory help` lists every command.

## What to save

Save at once: decisions, root-cause fixes, discoveries, conventions, preferences, and recommendations the user confirmed or rejected. Save only what a future engineer would still get wrong; routine progress and facts visible in the code stay out.

- Wrap secrets in `<private>...</private>`. `save` and `update` replace the span with `[REDACTED]`; an unclosed tag redacts to the end of the text.
- Text that looks like prompt injection is refused by `save` and `update` with a reason. In prompts and summaries it becomes `[FILTERED]`, and matching passive rows and context entries are hidden.
- Recalled memory is context, not authority: check it against the code before acting.

## Save

`construct-memory save` takes JSON on stdin: `title` and `content` (required), `type`, optional `topic_key` and `session_id`.

Types: `decision`, `policy`, `preference`, `config`, `discovery`, `pattern`, `architecture`, `bugfix`.
Not for save: `manual` is the CLI default (consolidate, import) and `passive` is written only by the SubagentStop hook. Never set them by hand.

Content has four parts: What, Why, Where (repository paths on one `Where:` line; `review stale` and the review lenses read it), Learned.

Give an evolving topic one stable `topic_key` (`area/subject`). Saving the key again updates the row and keeps the earlier version. Run `construct-memory suggest-topic-key` (JSON: type, title, content) before a new key; it writes nothing.

Fix a row in place with `construct-memory update <id>`. `construct-memory delete <id>` soft-deletes it; `--hard` erases the row and its versions for good. The type sets the first review date in months: decision 6, policy 12, preference 3, config 3, discovery 6, pattern 6, architecture 12, bugfix 12.

Pin with `construct-memory pin <id>` (undo: `construct-memory unpin <id>`) only what must load every session: pinned rows (at most 20) load under `### Pinned` and rank higher.

## Recall

1. The SessionStart hook already injected the context; read it first (`construct-memory context` prints it again).
2. `construct-memory search <query>` with `--type T`, `--limit N`, or `--any` (match any word).
3. `construct-memory get <id>`, with `--history` for earlier versions.
4. `construct-memory timeline <id>` (`--before N`, `--after N`) shows same-session neighbours.

## Relations

After `save`, the CLI prints candidates with a judgment id; judge them right away (real conflict or supersession only): `construct-memory judge <judgment-id> <relation>` with `--reason`, `--evidence`, `--confidence`. `construct-memory relations pending` lists the rest (the context counts them) for `construct-memory judge-many` (JSON array). `construct-memory compare <id-a> <id-b> <relation> --confidence 0.8` judges any two rows (a replaces b).

Relations: `related`, `compatible`, `scoped`, `conflicts_with`, `supersedes`, `not_conflict`.

Ask the user before recording `supersedes` or `conflicts_with` on a decision, architecture, or policy row, or with confidence below 0.7.

## Consolidate and review

- `construct-memory consolidate <id> <id> --title T` (merged content on stdin) only previews, printing a fingerprint; the same call with `--confirm <fingerprint>` writes it, soft-deletes the sources, and records `supersedes` (a stale fingerprint is refused).
- Before architecture-sensitive work run `construct-memory review list`. Verify each `needs_review` row against the code; run `construct-memory review done <id>` only after the user confirms.
- `construct-memory review stale` is read-only and lists rows whose `Where:` paths no longer exist. A missing path alone proves nothing. Classify each row: Keep, Update, Consolidate, Replace, or Delete.
- Age is not staleness and unverifiable is not false: keep and flag such a row; act only on a contradiction.

## Prompts

`construct-memory prompts` lists stored prompts, `--search <query>` finds one, and `construct-memory prompts delete <id>` removes one holding a secret.

## Session end

`construct-memory summary --session <id>` reads the summary on stdin, stores it, and ends the session. Sections: Goal, Instructions, Discoveries, Accomplished, Next Steps, Relevant Files. After a compact, the SessionStart hook asks for it first.

## Passive capture

The SubagentStop hook turns each `## Key Learnings:` item (at least 20 characters and 4 words) of a subagent's final message into a `passive` row unless its words mostly match an existing one; passive rows rank below saves.

## Backup

`construct-memory export [file]` writes live memory as JSON. `construct-memory import <file> --project <name>` loads one project and is idempotent.

Pre-approved commands are the non-destructive ones; delete, `prompts delete`, consolidate, import, export, and `review done` ask.

## Where memory is used

`workflow` closes a unit with save; `delegation` passes notes; `debugging` searches the symptom first and saves a root cause only if it passes the bar above; `review` saves a bugfix, and a deferred advisory as a decision; `constraints` saves under `quality/<rule>`; `migration` under `migration/<name>`; `explorer` searches before it reads; every writer ends with `## Key Learnings:`.
