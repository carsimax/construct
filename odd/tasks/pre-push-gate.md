# Pre-push gate

Objective: enforce the publication gate in git itself, so a push from any host or tool is judged, not only a Claude Code Bash call. Branch: feat/pre-push-gate. Baseline: c2e477e. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — A git pre-push hook judges every pushed commit.** "vamos con lo que sigue" (to: "T8: gate en `pre-push` + required check en CI"; plan T8: "Script `pre-push` opcional (`bin/construct-gate install` lo instala en el repo del usuario) que reutiliza la lógica de `publication-gate.mjs` [...] un push sin aprobación se rechaza, uno con aprobación pasa"). Assumptions (parent, L2):
  - `plugins/construct/hooks/scripts/pre-push.mjs` reads git's pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line); each line whose local sha is not all zeros (a delete) is judged with the same per-ref verdict `publication-gate.mjs` uses; the first denial is printed to stderr and the push exits 1; an error while judging denies (fail closed, as the gate does). No pushed lines: exit 0.
  - `publication-gate.mjs` exports that verdict and runs its hook `main` only when executed directly; its behavior as a hook is unchanged.
- **S2 — Opt-in installer.** Plan T8: "`bin/construct-gate install` lo instala en el repo del usuario". `construct-gate install | uninstall | status`, run inside a repository: install writes the pre-push hook into the effective hooks dir (`git rev-parse --git-path hooks`, which honors `core.hooksPath`), marked as Construct's; it refuses to overwrite a hook that is not Construct's (exit non-zero, message naming the file). The installed hook finds `pre-push.mjs` in the newest installed Construct version at run time (plugin cache), else the path recorded at install; if neither exists (plugin removed) it warns on stderr and allows the push. uninstall removes only Construct's hook; status prints installed or not and the resolved script path.
- **S3 — Docs say what each layer guarantees.** Plan T9: "en el README y en `CLAUDE.md` queda escrito que el gate PreToolUse es un aviso temprano de disciplina, no un límite de seguridad, que la garantía real es `pre-push`/CI y que la celda Risk es autoclasificada". Assumption (L2): CI is out of scope because verdicts live only in the local store; docs say so.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | `pre-push.mjs`, exported verdict, `bin/construct-gate`, tests | worker | 2, 5 | done (RED by parent: empty hook fails 2 tests; suite 1083/0) | b5c9c3f |
| T2 | S3 | README, CLAUDE.md, CONTRIBUTING table if it names the gate | worker | none | done (CONTRIBUTING table does not name the gate) | 46a9ce8 |

## Log

- **L1 (2026-10-22, user):** "vamos con lo que sigue" (after: "el siguiente paso que recomiendo es **T8: gate en `pre-push` + required check en CI**").
- **L2 (2026-10-22, parent):** `publication-gate.mjs` judges a ref with `refVerdict(root, pub, base, ref)` / `verdict(pub)` (lines 320-385) and runs `main()` at import. Verdicts live in `<git common dir>/construct-review/` (`review-store.mjs:17-19`), local to the clone: a CI check cannot read them without publishing verdicts, so CI is dropped (would need verdicts as git notes or PR comments — a separate design). Installer is opt-in, never automatic: writing into a user's `.git/hooks` unasked is invasive. Context: PR #59 was pushed from a Pi host where the PreToolUse gate never fired (harness-evidence L13).

- **L3 (2026-10-22, parent):** Worker wrote T1 tests after the code; parent observed RED by replacing pre-push.mjs with `process.exitCode = 0`: the reject and judging-error tests fail (10 pass, 2 fail), restored: 1083/0. Docs added: construct-gate is on PATH only in Claude Code sessions (else run by path), and verdicts are recorded only in a Claude Code session, so with the hook installed reviews happen there before a push from any host.

Next step: lenses on the branch, then PR on the user's word.
