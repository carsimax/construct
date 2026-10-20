---
name: branch-pr
description: "Prepare a branch and pull request that follow the target repository's own rules. Trigger: creating, opening, or preparing PRs for review."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "3.0"
---

## Activation Contract

Load this skill when creating, opening, or preparing a pull request, or when preparing a branch for submission.

## Hard Rules

- Commit, push, PR creation, and merge are human decisions. Draft them; never run them without an explicit instruction for that exact action.
- Before any remote read or write, get explicit authorization for the exact target repository, the operation, and the credential or session to use. Never probe ambient credentials.
- The target repository's own rules win over this skill: `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, branch protection, and required checks.
- Use the current PR template as the body authority, with every required section. Never pre-check a box without observed evidence.
- Resolve the default or base branch from current repository metadata. Never assume `main`.
- Keep each PR within 400 changed lines (additions plus deletions). Over budget, load the `chained-pr` skill before creating the PR.
- Never add `Co-Authored-By` or AI attribution trailers unless the user asks for them.

## Decision Gates

| Condition | Action |
|---|---|
| Repository requires a linked issue | Ask the user whether the link closes the issue (`Closes/Fixes/Resolves #N`) or only references it (`Refs #N`); keep their choice |
| Repository requires labels | Apply only the labels its policy defines, and only after the user authorizes the remote write |
| PR template exists | Fill every required section from observed evidence |
| No template | Use the default body below |
| Over 400 changed lines | Load `chained-pr`; follow the cached chain strategy |
| Required checks unknown | Read branch protection or rulesets; unknown requiredness is not merge-ready |

## Execution Steps

1. Read `CONTRIBUTING.md`, the PR template, and the branch naming and commit rules of the target repository.
2. Check the branch name against the repository's pattern, or the default pattern below.
3. Run the applicable local checks and record each as `<command>: <observed result>`, failures included.
4. Draft the PR title and body. Show them to the user.
5. Push and create the PR only after the user authorizes that exact action.
6. Read the PR's required checks and report which are pending, passing, or failing.

## Default Conventions

Use these only when the repository defines none.

Branch names match:

```
^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$
```

Commit messages follow Conventional Commits:

```
^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9\._-]+\))?!?: .+
```

Default PR body:

```markdown
## Summary
- <1-3 bullets: what changes and why>

## Changes
| File | Change |
|------|--------|
| `path/to/file` | What changed |

## Test plan
- [ ] `<command>` (check only if run and passed)

## Linked issue
<Closes #N | Refs #N | none>
```

## Output Contract

Return the target repository and base branch, the branch name check, the local check results, the drafted title and body, the changed-line count, and the pending human decisions (push, PR creation, labels, merge).
