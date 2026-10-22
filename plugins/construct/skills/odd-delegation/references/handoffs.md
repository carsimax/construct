# Handoff templates

## Allowed edit surfaces

A bounded writer refuses to write outside its allowed edit surfaces. Deriving them is part of planning the delegation:

- The heading is exactly `## Allowed edit surfaces`. Under it, one bare repository-relative path or narrow glob per line, and nothing else: no `- path (new)` notes, no trailing comments, no prose. Never use `.`, a bare repository root, an absolute path, `..`, or a glob in the first segment (`*`, `**`). Wrap paths that contain whitespace in backticks.
- The section ends at the next Markdown heading, and every non-empty line inside it must be a surface entry. Put notes (which paths are new, why) under a later heading such as `## Reuse`.
- Two writers open at once need disjoint surfaces; the hook denies an overlap, and an entry it cannot interpret counts as overlapping. Wait for the first writer or split the paths.
- A writer (`construct:odd-worker`, `construct:jd-fix-agent`) is also denied without a line `Spec: odd/tasks/<feature>.md, T<n>` naming an existing regular file (not a symlink) while an unfinished feature document exists.
- `construct:odd-verify` is denied without a line `Risk: item N` (N 1-6); `Risk: none` does not admit it.
- List pre-existing untracked targets the writer may write explicitly.
- Name the directories where new files are authorized, when the task needs new files.
- Include nothing beyond the delegated task. A surface wider than the task is the same defect as no surface.

When a worker asks about surfaces, present its candidate paths as an approve/decline choice. Add or drop paths only on the human's explicit instruction.

## Explorer

```markdown
Question: <the decision this map serves>
Front: <the one module, layer, or question this explorer maps>
Out of scope: <the other fronts, owned by parallel explorers>
Scope: <directories or symbols to start from>
Memory: <optional: relevant `construct-memory search` hits the parent pastes>
Return at most about 2k tokens with path:line evidence: answer, map, open questions.
```

## General

`construct:odd-general` has no hook-enforced fields: state the command or research, its bounds, and what to return.

## Worker

```markdown
Spec: odd/tasks/<feature>.md, T<n>, <S#...> — read the document until ## Log.
(Without a document: the user's request, verbatim.)

## Allowed edit surfaces
path/to/file.ts
path/to/dir/*.test.ts

## Memory
<optional: relevant `construct-memory search` hits the parent pastes; omit when none>

## Reuse
<existing helpers for shared state, and the invariants they keep>

## Test-first
Runner: <command>. One RED test per rule; prove previous behavior of touched commands still holds.

## Verification
<exact commands to run in the foreground; these are the unit's verifier>
Verifier strength: <strong (tests, build, typecheck): loop until it passes | weak (ambiguous requirements or external side effects): the worker stops after one step and reports | no verifier: say what would make it verifiable; for docs-only units the reviewed diff is the verifier, so the worker proceeds>

## Known environmental failures
<exact failing test names or command lines already failing on the base, with evidence>
```

## Verifier

```markdown
Risk: item N (reason), N from 1 to 6 as in the Risk line.
Feature document: odd/tasks/<feature>.md (all S#).
Baseline commit: <sha>. Candidate: <branch or sha>.
Probe command forms: <authorized commands>.
Run probes in a fresh mktemp -d copy outside the workspace. Return a verdict per S#, blockers, advisories, probes to commit, and scratch paths.
```

## Correction bounds

- Verifier blockers get one correction batch that fixes every reported blocker, then one recheck limited to those blockers.
- A second correction runs only when the same blocker still fails. A new finding never earns one.
- Blockers still open after that become one **Needs your decision** result.
- A writer's self-review follows the same bound, then reports `partial`.
