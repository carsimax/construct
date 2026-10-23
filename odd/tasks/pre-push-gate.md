# Pre-push gate

Objective: enforce the publication gate in git itself, so a push from any host or tool is judged, not only a Claude Code Bash call. Branch: feat/pre-push-gate. Baseline: c2e477e. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — A git pre-push hook judges every pushed commit.** "vamos con lo que sigue" (to: "T8: gate en `pre-push` + required check en CI"; plan T8: "Script `pre-push` opcional (`bin/construct-gate install` lo instala en el repo del usuario) que reutiliza la lógica de `publication-gate.mjs` [...] un push sin aprobación se rechaza, uno con aprobación pasa"). Assumptions (parent, L2):
  - `plugins/construct/hooks/scripts/pre-push.mjs` reads git's pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line); each line whose local sha is not all zeros (a delete) is judged with the same per-ref verdict `publication-gate.mjs` uses; the first denial is printed to stderr and the push exits 1; an error while judging denies (fail closed, as the gate does). No pushed lines: exit 0.
  - `publication-gate.mjs` exports that verdict and runs its hook `main` only when executed directly; its behavior as a hook is unchanged.
- **S2 — Opt-in installer.** Plan T8: "`bin/construct-gate install` lo instala en el repo del usuario". `construct-gate install | uninstall | status`, run inside a repository: install writes the pre-push hook into the effective hooks dir (`git rev-parse --git-path hooks`, which honors `core.hooksPath`), marked as Construct's; it refuses to overwrite a hook that is not Construct's (exit non-zero, message naming the file). The installed hook finds `pre-push.mjs` in the newest installed Construct version at run time (plugin cache), else the path recorded at install; if neither exists (plugin removed) it warns on stderr and allows the push. uninstall removes only Construct's hook; status prints installed or not and the resolved script path.
- **S3 — Docs say what each layer guarantees.** Plan T9: "en el README y en `CLAUDE.md` queda escrito que el gate PreToolUse es un aviso temprano de disciplina, no un límite de seguridad, que la garantía real es `pre-push`/CI y que la celda Risk es autoclasificada". Assumption (L2): CI is out of scope because verdicts live only in the local store; docs say so.

- **S4 — Release 8.1.0 and PR.** "ok" (to: "¿Abro el PR como **8.1.0**? Es funcionalidad nueva y no rompe nada."). Bump as in c804382 (plugin.json, install.sh ref and URL, README badge/URLs/status with a "Changes in 8.1.0" list, install tests); no Upgrading section (nothing breaks). PR title carries (8.1.0).

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | `pre-push.mjs`, exported verdict, `bin/construct-gate`, tests | worker | 2, 5 | done (RED by parent: empty hook fails 2 tests; suite 1083/0) | b5c9c3f |
| T3 | S1, S2, S3 | Fix the L4 review findings | worker | 1, 2, 5 | done (RED 9 fail on T1 code; tests/pre-push 21/21; suite 1092/0) | 89a77da |
| T4 | S1, S2, S3 | Fix the L6 round-2 findings | parent | 2, 5 | done (RED 5 fail; tests/pre-push 26/26; suite 1097/0) | 9ff0a12 |
| T5 | S4 | Release 8.1.0 bump | worker | 5 | done (RED 3 install; suite 1097/0; validate --strict both) | da38784 |
| T2 | S3 | README, CLAUDE.md, CONTRIBUTING table if it names the gate | worker | none | done (CONTRIBUTING table does not name the gate) | 46a9ce8 |

## Log

- **L1 (2026-10-22, user):** "vamos con lo que sigue" (after: "el siguiente paso que recomiendo es **T8: gate en `pre-push` + required check en CI**").
- **L2 (2026-10-22, parent):** `publication-gate.mjs` judges a ref with `refVerdict(root, pub, base, ref)` / `verdict(pub)` (lines 320-385) and runs `main()` at import. Verdicts live in `<git common dir>/construct-review/` (`review-store.mjs:17-19`), local to the clone: a CI check cannot read them without publishing verdicts, so CI is dropped (would need verdicts as git notes or PR comments — a separate design). Installer is opt-in, never automatic: writing into a user's `.git/hooks` unasked is invasive. Context: PR #59 was pushed from a Pi host where the PreToolUse gate never fired (harness-evidence L13).

- **L3 (2026-10-22, parent):** Worker wrote T1 tests after the code; parent observed RED by replacing pre-push.mjs with `process.exitCode = 0`: the reject and judging-error tests fail (10 pass, 2 fail), restored: 1083/0. Docs added: construct-gate is on PATH only in Claude Code sessions (else run by path), and verdicts are recorded only in a Claude Code session, so with the hook installed reviews happen there before a push from any host.

- **L4 (2026-10-22, review):** Blind dual review of c2e477e..022766d (jd-judge-a risk, jd-judge-b resilience; the host's review-* lenses need the native RDD lineage and refused a direct task). A: no unreviewed-Risk push found (branch, tags, HEAD denied; gate main still runs under symlinks and relative paths); B: do not merge. Confirmed, all reproduced:
  - B-001 (blocker): node not on PATH (GUI/IDE push) → `exec: node: not found`, push blocked with no actionable message.
  - B-002 (blocker): default branch unresolvable → every push denied even with no `odd/tasks/` documents; permanent lockout, no way out named.
  - A-001 (major, data loss): ownership is a substring test of the marker; `uninstall` deletes and `install` overwrites a user hook that contains the marker line.
  - B-003 (major): non-atomic write; a truncated hook exits 0 and allows unchecked.
  - B-004 / A-005 (major): `core.hooksPath` inside the working tree (`.husky/`) puts the hook where it can be committed; a global hooksPath installs into every repository; no warning.
  - B-005 (major): a ref with no history in common with the default branch denies with a raw `git merge-base` error.
  - A-002, A-003, A-004, B-007 (minor): malformed stdin line allows; dangling symlink at the hook path is followed; README omits `--no-verify` and the same-user/fail-open bypasses; `status` orders versions differently from the hook.
  Not acted on: B-006 (verdict returns null when repositoryRoot throws; pre-push.mjs resolves the root first and denies, so the hook's claim holds).

- **L5 (2026-10-22, parent):** Real `git push` to a bare remote in mktemp with the hook installed (judges are policy-blocked from real pushes): Risk 2 without verdict → denied, names review-risk and the subject, remote unchanged; same push with PATH lacking node → denied with the node/uninstall/--no-verify message, remote unchanged; branch with no `odd/tasks/` documents → pushed.

- **L6 (2026-10-22, review):** Round 2 (last). Both judges: every round-1 finding fixed. New:
  - A-N1 (major): the T3 "no `odd/tasks/*.md` in the pushed tree → allow" short-cut let a Risk document moved out of `odd/tasks/` or archived under `odd/tasks/archive/` skip review (the gate reads the merge-base and denies). Fixed: the short-cut applies only when no default branch resolves (nothing can be compared); otherwise the gate's verdict stands. Residual, marked `shortcut:` in code: with no default branch, a moved document is not seen.
  - A-N2 = B-N1 (minor): the `merge-base` substring rewrite replaced real denials for branches named `*merge-base*`. Fixed: matches the gate's `could not be checked (git merge-base ` error only.
  - B-N2 (minor): node check ran before the plugin-gone check. Fixed: plugin gone → warn and allow first.
  - A-N3 (minor): set-head advice hard-coded `origin`. Fixed: names the pushed remote (`argv[2]`).
  - A B-002 partial (minor): first push of the default branch with documents and no remote default got no ways out. Fixed: message appends them.
  - Accepted, not fixed: A-N4 (CRLF-converted hook reads as foreign; a copied hook with the marker on line 2 is overwritten on install, by design).
  Parent fixes inline (small edits): RED 5 new tests fail, GREEN tests/pre-push 26/26, suite 1097/0.

- **L7 (2026-10-22, user):** "ok". Added S4, T5.

- **L8 (2026-10-22, parent):** Pushed from the Pi host (the PreToolUse gate does not fire here; the pre-push hook is not installed in this clone). Required lenses (review-risk, review-resilience) were not recorded in Construct's store; the blind dual review of L4 and L6 stands in.

Next step: merge on the user's word; tag v8.1.0 and Release after merge.
