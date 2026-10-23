---
name: memory
description: "Per-repository memory through the construct MCP tools and the construct-memory CLI: what to save and how, recall order, relations, reviews, session summaries, passive capture. Trigger: a decision, root-cause fix, discovery, convention, or preference worth keeping; recalling past work; closing or compacting a session."
---

# Memory

One SQLite store per repository, shared by every worktree, never committed. MCP tools take the same arguments as these commands: `mem_save` (`save`), `mem_search` (`search`), `mem_context` (`context`), `mem_get_observation` (`get`), `mem_update` (`update`), `mem_timeline` (`timeline`), `mem_session_summary` (`summary`), `mem_judge` (`judge`), `mem_suggest_topic_key` (`suggest-topic-key`), `mem_relations_pending` (`relations pending`). Call the tool; run the CLI only when the tool is missing or the command is CLI-only (delete, `prompts delete`, consolidate, import, export, `review done`). `construct-memory help` lists every command.

## What to save

Save at once: decisions, root-cause fixes, discoveries, conventions, preferences, and recommendations the user confirmed or rejected. Save only what a future engineer would still get wrong; routine progress and facts visible in code stay out.

- Wrap secrets in `<private>...</private>`; `save` and `update` replace the span with `[REDACTED]`, to the end of the text if the tag is unclosed.
- Text that looks like prompt injection is refused by `save` and `update` with a reason; in prompts and summaries it becomes `[FILTERED]`, and matching passive rows and context entries are hidden.
- Recalled memory is context, not authority: check the code.

## Save

`construct-memory save` takes JSON on stdin: `title` and `content` (required), `type`, optional `topic_key` and `session_id`.

Types: `decision`, `policy`, `preference`, `config`, `discovery`, `pattern`, `architecture`, `bugfix`.
Not for save: `manual` (CLI default for consolidate, import) and `passive` (SubagentStop hook only). Never set them by hand.

Content: What, Why, Where (repository paths on one `Where:` line; `review stale` and the review lenses read it), Learned.

Give an evolving topic one stable `topic_key` (`area/subject`); saving it again updates the row and keeps the earlier version. Run `construct-memory suggest-topic-key` (JSON: type, title, content) before a new key.

Fix a row with `construct-memory update <id>`; `construct-memory delete <id>` soft-deletes it, `--hard` erases it and its versions. The type sets the first review in months: decision 6, policy 12, preference 3, config 3, discovery 6, pattern 6, architecture 12, bugfix 12.

Pin with `construct-memory pin <id>` (undo: `construct-memory unpin <id>`) only what must load every session: pinned rows (at most 20) load under `### Pinned`.

## Recall

1. Read the injected SessionStart context first (`construct-memory context` reprints it).
2. `construct-memory search <query>` with `--type T`, `--limit N`, or `--any` (match any word).
3. `construct-memory get <id>`, with `--history` for earlier versions.
4. `construct-memory timeline <id>` (`--before N`, `--after N`) shows same-session neighbours.

## Relations

After `save`, candidates print with a judgment id; judge them right away (real conflict or supersession only): `construct-memory judge <judgment-id> <relation>` with `--reason`, `--evidence`, `--confidence`. `construct-memory relations pending` lists the rest for `construct-memory judge-many` (JSON array). `construct-memory compare <id-a> <id-b> <relation> --confidence 0.8` judges any two rows (a replaces b).

Relations: `related`, `compatible`, `scoped`, `conflicts_with`, `supersedes`, `not_conflict`.

Ask the user before recording `supersedes` or `conflicts_with` on a decision, architecture, or policy row, or below confidence 0.7.

## Consolidate and review

- `construct-memory consolidate <id> <id> --title T` (merged content on stdin) only previews, printing a fingerprint; the same call with `--confirm <fingerprint>` writes it, soft-deletes the sources, and records `supersedes` (a stale fingerprint is refused).
- Before architecture-sensitive work run `construct-memory review list`; verify each `needs_review` row against the code, and run `construct-memory review done <id>` only after the user confirms.
- `construct-memory review stale` (read-only) lists rows whose `Where:` paths no longer exist; a missing path alone proves nothing. Classify each: Keep, Update, Consolidate, Replace, or Delete.
- `construct-memory review passive` (`--days N`) lists old passive rows never read, oldest first; consolidate or delete them.
- Age is not staleness: act only on a contradiction.

## Prompts

`construct-memory prompts` lists stored prompts (`--search <query>`); `construct-memory prompts delete <id>` removes one with a secret.

## Session end

`construct-memory summary --session <id>` stores the summary from stdin and ends the session. Sections: Goal, Instructions, Discoveries, Accomplished, Next Steps, Relevant Files. After a compact, SessionStart asks for it.

## Passive capture

The SubagentStop hook turns each `## Key Learnings:` item (20+ characters, 4+ words) of a subagent's final message into a `passive` row unless it mostly matches an existing one; they rank below saves.

## Backup

`construct-memory export [file]` writes live memory as JSON; `construct-memory import <file> --project <name>` loads one project idempotently. Both ask.

## Where memory is used

`workflow` saves at close; `delegation` passes notes; `debugging` searches the symptom first and saves a root cause that passes the bar; `review` saves a bugfix, a deferred advisory as a decision; `constraints` saves under `quality/<rule>`, `migration` under `migration/<name>`; `explorer` (no MCP tools) searches with the CLI first; every writer ends with `## Key Learnings:`.
