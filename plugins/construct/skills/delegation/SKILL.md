---
name: delegation
user-invocable: false
description: "When and how the ODD orchestrator delegates to construct agents: role mapping, allowed edit surfaces, parallel writers, verifier timing, handoff prompts, and relaying a subagent's blocking question or choice menu. Trigger: deciding to delegate, launching an agent, writing a handoff, or a subagent or tool returns a question, menu, or consent request."
license: MIT
metadata:
  author: Construct
  version: "2.0"
---

## When it applies

The parent orchestrates; agents do the work. Handoff templates are in `references/handoffs.md`; copy the one for the role.

## Mapping

Small work is done inline: the parent edits directly when each call changes at most `inline_edit_max_lines` lines (default 20; 0 restores worker-only). Large work and any bigger edit go to `construct:worker` (surface-guard denies a main-thread edit over the limit); reads, answers, and `odd/tasks/` stay with the parent.

- Worker: one per independent unit, code, tests, and docs together. Disjoint units launch in one message; dependent ones in order. Never launch a second agent of the same role and task in one turn.
- Workflows launch only read-only agents, each `agent()` naming its `agentType` (hook); writes go through `construct:worker`.
- `construct:explorer`: mapping beyond one batch or about 5 sequential lookups, one per front, at most 3 per message; dependents wait.
- `construct:general`: long suites, builds, installs, broad research.
- `construct:verifier`: only for a Risk-named item (see Verification).
- Model and effort come from plugin config (`model_<role>`, `effort_<role>`; routing.js applies them); a prompt never picks a model.
- Keep parent output bounded: counts, stat, tails, summaries.

## Writer handoff

delegation-admission denies a `construct:worker` launch that lacks:

- The exact heading `## Allowed edit surfaces`, then one bare repository-relative path or narrow glob per line, nothing else. No `.`, root, absolute path, `..`, leading glob, or notes; prose goes under the next heading.
- While a feature document is unfinished: `Spec: odd/tasks/<feature>.md, T<n>` pointing at a real file, not a symlink, under `odd/tasks/`.
- Surfaces disjoint from every writer still open. An entry it cannot interpret counts as overlap. A shared file has one owner; run writers in sequence or `isolation: worktree` when files overlap.

surface-guard then denies writes outside those entries. A worker given no list returns `needs_interaction` with candidate paths; the parent offers approve or decline, and paths change only on a human instruction. Writers run no repo-wide formatters, generators, or installs, and other-repository work goes in a fresh worktree.

## Prompt contents

Each handoff holds the task, the Spec line or question, `## Memory` (search hits the parent pastes; subagents may also call `mem_search`, and `construct:explorer` runs `construct-memory search`), reuse pointers, the verification commands with their strength, known environmental failures, and a request to close with `## Key Learnings:` (memory-hooks saves those passively).

Test-first: a runnable deterministic test and a clear expected outcome mean RED, then GREEN. For docs-only or no runnable RED the worker states the exception.

## Verification

- Verifier strength is stated in each handoff. A weak verifier has ambiguous requirements or external side effects: the worker stops after one step and reports. When there is no verifier it names what would make the work verifiable. In docs-only units the reviewed diff is the verifier.
- Formatters run before verification, afterwards only check-only commands. A byte change reruns the affected checks. Unavailable, partial, or declined proof is never a pass.
- A docs-only change gets a parent structural readback; executable, operational, or unknown content gets the verifier when Risk-named.
- One `construct:verifier` per delivery slice (PR), before publication, covering every Risk-named unit in it, after their own checks. delegation-admission denies a verifier prompt without `Risk: item N` (N from 1 to 6; `Risk: none` does not admit). It also carries the whole feature document, baseline, candidate, probe forms, and a scratch directory.

## Correction bounds

A verifier or review round allows one correction batch and one recheck. A second runs only if the same blocker still fails; new findings never earn one. Leftovers go to the user as "Needs your decision". Inside one worker run: one fix attempt per failing check.

## Relaying a blocking question

When a subagent or tool hands back a question, a menu, a consent request, or an approve/decline choice:

1. Pass the whole envelope: reason, every question in order, headers, labels, descriptions, selection mode, answer domain. Never summarize, reorder, merge, or split.
2. Use AskUserQuestion when the envelope fits; otherwise a plain-text envelope with the answer syntax, then stop. Never choose, default, or launch dependent work while the answer is pending.
3. Validate the reply: trimmed, case-insensitive label match, exactly one label; ordinals ("first", "2") alias to positions. An invalid answer re-presents the envelope; a valid one is returned once.
4. A question about a choice is answered from the envelope without recommending, then the choice is re-presented.
