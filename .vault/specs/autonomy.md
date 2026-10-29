# Autonomy and simplification

- **S1 — Review without a commit.** "Revisar sobre el árbol de trabajo, sin exigir commit" (L1).
  - Given `Review subject: <base>` When review-context builds a lens's evidence Then the head is a snapshot of the working tree (tracked and untracked files that are not ignored, as `freezeWorkingTree` takes it), not `HEAD`; the subject hash is (base tree, that tree).
  - A later commit whose tree equals the reviewed tree keeps the approval (the publication gate already keys verdicts on trees); any other content needs a new review.
  - The review skill no longer says to commit first: run the formatters, then review the working tree.
- **S2 — Small code tasks need no hand-made ceremony.** "doc de una tarea automático" (L1). Assumption: the feature-document reference carries a five-line one-task template (header, one `S#` quoting the request, one `T#` row, `L1`), and the workflow skill and session contract point to it; no new command.
- **S3 — Untestable paths by allowlist.** "lista de código no testeable" (L1).
  - `.vault/exempt-paths` lines are `<glob> -- <command>`; `#` starts a comment. It is read at the default-branch tip only (like the risk floor reads trusted commits), so adding an entry needs a merged change.
  - Given a construct:worker launch with a `Spec:` task that has no envelope When every non-free surface matches an entry Then delegation-admission writes the envelope itself (the default budget, the worker's surfaces, the matching entries' commands joined with ` && `, `source: allowlist`) and admits it, with no oracle and no `Exempt` menu.
  - A malformed line denies the launch naming the file and line. Surfaces that match no entry keep today's rule (oracle or `Exempt`).
- **S4 — One verifier rule.** "regla única de verifier" (L1). Assumption: `construct:verifier` runs once per pull request, only when a task's Risk names item 1, 2, or 5; items 3, 4, and 6 rely on the oracle and the lenses. The session contract and the delegation skill state the same rule.
- **S5 — One Bash hook.** "Un solo hook de Bash" (L1).
  - PreToolUse on Bash runs one process, `bash-guard.mjs`, that parses the command once and applies the review-store guard, the command guard, and the publication gate in that order, printing the first denial. The three scripts stay runnable alone (their tests keep spawning them) and keep their exact denial texts.
  - The Bash entry keeps the publication gate's `onFailure: block` and the longest of the three timeouts.
- **S6 — A cheap Risk-line fingerprint.** "huella barata para Risk" (L1).
  - `risk-line.mjs mark` and `check` compare a fingerprint built from `git status --porcelain=v1 -z --untracked-files=all` plus size and mtime of each listed path, instead of hashing the whole tree; the changed paths are those whose entry differs between mark and check.
  - Assumption: a rewrite to the same size with a restored mtime of a path already dirty at mark is missed (accepted for a reminder gate). Worker stops keep the full snapshot.
- **S7 — Docs.** Assumption: README, CLAUDE.md, CONTRIBUTING consistency table, session contract, review, workflow, delegation skills, feature-document reference, and CHANGELOG Unreleased describe S1-S6.
