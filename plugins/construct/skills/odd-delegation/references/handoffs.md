# Handoff templates

## Allowed edit surfaces

A bounded writer refuses to write outside its allowed edit surfaces. Deriving them is part of planning the delegation:

- Use exact repository-relative paths or narrow globs, one per line. Never use `.`, a bare repository root, or an absolute path. Wrap paths that contain whitespace in backticks.
- The section ends at the next Markdown heading, and every non-empty line inside it must be a surface entry. Put prose under a later heading.
- List pre-existing untracked targets the writer may write explicitly.
- Name the directories where new files are authorized, when the task needs new files.
- Include nothing beyond the delegated task. A surface wider than the task is the same defect as no surface.

When a worker asks about surfaces, present its candidate paths as an approve/decline choice. Add or drop paths only on the human's explicit instruction.

## Explorer

```markdown
Question: <the decision this map serves>
Scope: <directories or symbols to start from>
Return at most about 2k tokens with path:line evidence: answer, map, open questions.
```

## Worker

```markdown
Spec: odd/tasks/<feature>.md, <task ID>, <S#...> — read the document until ## Log.
(Without a document: the user's request, verbatim.)

## Allowed edit surfaces
path/to/file.ts
path/to/dir/*.test.ts

## Reuse
<existing helpers for shared state, and the invariants they keep>

## Test-first
Runner: <command>. One RED test per rule; prove previous behavior of touched commands still holds.

## Verification
<exact commands to run in the foreground; these are the unit's verifier>
Verifier strength: <strong (tests, build, typecheck): loop until it passes | weak (none or ambiguous): the worker stops after one step and reports>

## Known environmental failures
<exact failing test names or command lines already failing on the base, with evidence>
```

## Verifier

```markdown
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
