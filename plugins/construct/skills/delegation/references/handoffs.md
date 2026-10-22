# Handoff templates

Fill every `<placeholder>`; drop an optional section when empty. Each role has its own `##` heading and fenced template; tests/admission/templates.test.mjs sends them through delegation-admission.

Verifier strength: strong (a deterministic command with a clear expected outcome), weak (ambiguous requirements or external side effects: the agent stops after one step and reports), or none. With no verifier the agent says what would make the work verifiable; for docs-only units the reviewed diff is the verifier.

## Worker

```markdown
Spec: odd/tasks/<feature>.md, T<n> (covers S<n>)

<task: the one unit of behavior, with its acceptance rule>

## Allowed edit surfaces
<repo-path-or-glob>
<another-path>

## Memory
<search hits, or omit>

## Reuse
<existing helpers and invariants to keep>

## Test-first
<the failing test per rule; existing behavior to keep covered>

## Verification
<command: expected result>
Verifier strength: <strong|weak|none>

## Known environmental failures
<failures to ignore, or none>

Close with `## Key Learnings:`.
```

## Explorer

```markdown
Question: <one front to map>

## Memory
<search hits, or omit>

## Report
<what to return: path:line evidence, facts split from assumptions>

Read-only. Close with `## Key Learnings:`.
```

## General

```markdown
Task: <suite, build, install, or research to run>

## Memory
<search hits, or omit>

## Verification
<command: expected result>
Verifier strength: <strong|weak|none>

## Known environmental failures
<failures to ignore, or none>

Report each command as `<command>: <observed result>`. Close with `## Key Learnings:`.
```

## Verifier

```markdown
Risk: item N (<reason>)

Feature document: odd/tasks/<feature>.md (read in full)
Baseline: <ref before>
Candidate: <ref or worktree after>
Probes: <commands or forms that exercise each Risk-named unit>
Scratch: <mktemp -d path outside the worktree>

## Memory
<search hits, or omit>

Report each probe as `<command>: <observed result>`. Close with `## Key Learnings:`.
```
