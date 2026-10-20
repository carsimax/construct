---
name: task-size-risk
description: "Classify ODD work as small or large and name its risk: the three small-task criteria, the resume test, the six high-risk items, and the Risk line every code change closes with. Trigger: sizing a task, deciding on tracking or verification, or writing a Risk line."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill when classifying a request, deciding whether a feature document or an independent verifier is needed, or closing a code change with its Risk line.

## Hard Rules

- Never classify by counting files, commands, tests, fixes, lines, or a requested todo list.
- A task is **small** only when all three hold:
  1. **Understood**: the outcome is specified, what and where to change is known, and no product or design decision is open. Prove it within one bounded read batch (at most 3 calls, about 10k tokens).
  2. **Contained risk**: no high-risk item applies.
  3. **Resumable from the diff**: if the session stopped now, someone could finish from the original request and `git diff` alone.
- A task is **large** only when the resume test fails: several sessions, waiting on something external, separate deliverables the user wants apart (not several features asked at once), or requirements too long to survive compaction.
- Every code change closes with `Risk: item N (reason)` or `Risk: none`.

## High-risk items

A mistake would be hard to detect, hard to undo, or reaches beyond the change.

| Item | Covers | Not covered |
|---|---|---|
| 1 Data | Migrations, changing or deleting stored data, persisted format changes | Saving new records |
| 2 Security | Auth, permissions, credentials, secrets, guards, sandbox | — |
| 3 Contracts | Changing or removing public API, CLI flags, config formats, published exports, mirrored prompts others consume; unrequested breaks in shared code | Adding a flag, command, or optional field; a change the user requested |
| 4 Concurrency | Locks, races, async ordering | — |
| 5 Delivery | Installers, release, CI, deploy, dependencies | — |
| 6 Untested | No test would catch a regression in what changes | — |

Count "unclear" as high only when a bounded look cannot tell whether items 1–5 apply.

## Decision Gates

| Result | Consequence |
|---|---|
| Small | One `construct:odd-worker` writes it, observing RED and the focused test; the parent runs the suite once. No feature document or verifier |
| Large | Feature document and engram mirror, plus work-unit commits (`construct:odd-workflow`); one worker per unit |
| Risk line names an item | One independent `construct:odd-verify` after the change's own checks; give the unit its own commit |
| `Risk: none` | The change's own focused test and suite are enough |

## Execution Steps

1. Check the three small-task criteria with one bounded read batch.
2. Walk the six high-risk items against the planned change.
3. Before writing `Risk: none`, check whether the diff changes code that behavior the request did not mention also uses (shared options, parsers, helpers). If it does, that is item 3.
4. State the size and the Risk line in the reply.

## Output Contract

Return `Size: small | large (reason)` when classifying, and close every code change with `Risk: item N (reason)` or `Risk: none`.
