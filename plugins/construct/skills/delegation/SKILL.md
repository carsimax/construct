---
name: delegation
user-invocable: false
description: "When and how the ADD orchestrator delegates to construct agents: role mapping, allowed edit surfaces, parallel writers, verifier timing, handoff prompts, and relaying a subagent's blocking question or choice menu. Trigger: deciding to delegate, launching an agent, writing a handoff, or a subagent or tool returns a question, menu, or consent request."
license: MIT
metadata:
  author: Construct
  version: "2.0"
---

## When it applies

The parent orchestrates; agents work. Copy the role's template from `references/handoffs.md`.

## Mapping

The parent writes only `.vault/` and docs (`*.md` outside `hooks/contract/`, `skills/`, `agents/`); surface-guard denies every other write, naming `construct:oracle` then `construct:worker`. Reads and answers stay with you.

- Worker: one per independent unit, code, tests, and docs together. Disjoint units launch in one message; dependent ones in order, never two agents of one role and task in a turn.
- Workflows launch only read-only agents, each `agent()` naming its `agentType` (hook).
- `construct:oracle`: every code task gets `S#` tests RED and its `## Envelope` first; a code worker lacking it, or with surfaces outside it, is denied (hook). No deterministic test: surfaces all matching `.vault/exempt-paths` (default branch only) get an envelope from admission, no oracle or menu; else after the user's `Exempt` answer run `construct-gate oracle exempt <feature-doc> <T#> -- <surface>...` once.
- A worker's stop runs the envelope command: red with budget left blocks it; spent budget stops it and you report.
- `construct:explorer`: mapping beyond one batch or about 5 lookups, one per front, at most 3 per message; dependents wait.
- `construct:general`: long suites, builds, installs, broad research.
- `construct:verifier`: see Verification.
- Agents keep their own model and effort; never set them in a prompt. Keep parent output bounded.

## Writer handoff

delegation-admission denies a `construct:worker` launch that lacks:

- The exact heading `## Allowed edit surfaces`, then one bare repository-relative path or narrow glob per line, nothing else (no `.`, root, absolute path, `..`, leading glob, or notes; prose goes under the next heading).
- While a feature document is unfinished: `Spec: .vault/tasks/<feature>.md, T<n>` pointing at a real file, not a symlink, under `.vault/tasks/`.
- Surfaces disjoint from every writer still open; an entry it cannot interpret counts as overlap. A shared file has one owner; run overlapping writers in sequence or `isolation: worktree`.

surface-guard then denies writes outside those entries. A worker given no list returns `needs_interaction` with candidate paths; the parent offers approve or decline; paths change only on human instruction. Writers run no repo-wide formatters, generators, or installs; other repositories get a fresh worktree.

## Prompt contents

Each handoff holds the task, the Spec line or question, `## Memory` (pasted search hits), reuse pointers, verification commands with strength, known environmental failures, and a request to close with `## Key Learnings:`.

Test-first: RED then GREEN when a deterministic test can run; otherwise the worker states the exception.

## Verification

- Each handoff states verifier strength. Weak (ambiguous requirements or external side effects): the worker stops after one step and reports. No verifier: it names what would make the work verifiable; docs-only, the reviewed diff is the verifier.
- Formatters run before verification, afterwards only check-only commands; a byte change reruns affected checks. Unavailable, partial, or declined proof is never a pass.
- A docs-only change gets a parent structural readback.
- One `construct:verifier` per final PR, before publication, only when a task's Risk names item 1, 2, or 5 (items 3, 4, 6 rely on the oracle and lenses), after their own checks. delegation-admission denies a verifier prompt without `Risk: item N` (N from 1 to 6; `Risk: none` does not admit). It carries the feature document, baseline, candidate, probe forms, scratch directory.

## Correction bounds

A verifier or review round allows one correction batch and one recheck; a second only if the same blocker still fails, never for new findings. Leftovers go to the user as "Needs your decision".

## Relaying a blocking question

When a subagent or tool hands back a question, a menu, a consent request, or an approve/decline choice:

1. Pass the whole envelope (reason, every question in order, headers, labels, descriptions, selection mode, answer domain); never summarize, reorder, merge, or split.
2. Use AskUserQuestion when the envelope fits, else plain text with the answer syntax, then stop. Never choose, default, or launch dependent work meanwhile.
3. Validate the reply: trimmed, case-insensitive label match, exactly one label; ordinals ("first", "2") alias to positions. An invalid answer re-presents the envelope; a valid one is returned once.
4. A question about a choice is answered from the envelope without recommending, then the choice is re-presented.
5. A worker's `oracle_conflict` goes to the user through AskUserQuestion, one option recommended ([form](references/handoffs.md#oracle-conflict)). On `Unlock` run it once; workers never unlock.
