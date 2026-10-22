# Post-memory follow-ups

Objective: close the follow-ups left by `odd/tasks/construct-memory.md` (L45, L46) and the admission false positive reported from another project. Baseline `0c22366` (main, 4.0.0 merged, untagged). Branch: `fix/post-memory-followups`. Delivery strategy: single-pr (small fixes, one commit per task). Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict .` and `--strict ./plugins/construct`.

## Specs

Source: L1-L3.

- **S1 — Memory minors.** From the second PR 2 review (construct-memory L45): an imported relation's `confidence` outside [0,1] (or not a number) is stored as null instead of as given; the doctor test that leaves a store connection open closes it.
- **S2 — Shell redirections are not words.** From construct-memory L46: the publication gate read the `2` of `git push -u origin feat/x 2>&1 | tail -5` as a refspec and denied the push. In `shell-words.mjs`, a digit-only prefix glued to a redirection operator (`2>&1`, `2>/dev/null`, `1>out`, `2>>log`, `0<in`) is the operator's file descriptor, not a word; `&>file` and `&>>file` are redirections too. Everything the gate checks today keeps working (its tests stay green).
- **S3 — Literal route segments do not overlap everything.** Reported from another project (construct-memory session, kept in memory): delegation admission counts any surface containing `[`, `]`, `(`, `)`, or `\` as overlapping every other surface (`delegation-admission.mjs:137-138`, `:193-196`), so Next.js route folders such as `apps/web/src/app/(dashboard)/portafolios/[id]/_components/**` block a writer on `apps/api/...`. Decide per segment: two literal segments that differ never overlap whatever follows; parentheses are literal unless they form an extglob (`@(`, `!(`, `+(`, `*(`, `?(`); a segment with `[...]` may match at its own position only. Two writers inside the same `[id]` folder still overlap.
- **S4 — Evals run in their sandbox.** From construct-memory L45 and the eval runs: inside the `claude plugin eval` sandbox `npm test` (`node --test`) exits 255 with no output, and executing the plugin's `bin/construct-memory` is refused (`operation not permitted`), so `small-delegated`, `memory-recall`, and possibly `large-tracked` fail with and without the plugin. Find the causes, fix the fixtures, `scripts/eval.sh`, or graders, and rerun the six cases; report the scores. If a cause is in Claude Code's sandbox itself and cannot be fixed here, document it in CONTRIBUTING's eval paragraph.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Relation confidence range on import; close the doctor test's connection; tests | odd-worker, parallel with T2, T3 | 1 | done (RED 1 → GREEN 233/233) | `d53fd4c` |
| T2 | S2 | Redirection file descriptors and `&>` in `shell-words.mjs`; tests | odd-worker, parallel with T1, T3 | 2 | in progress | — |
| T3 | S3 | Per-segment overlap in `delegation-admission.mjs`; tests | odd-worker, parallel with T1, T2 | 2 | done (RED 5/6 on a HEAD copy, code written first → GREEN 75/75) | see L5 |
| T4 | S4 | Eval sandbox causes and fixes; rerun the evals | odd-general for the diagnosis, then odd-worker | 5 | in progress (diagnosis) | — |

## Log

- **L1 (2026-10-21, user):** "ok vamos con ese plan", for the plan whose post-merge step lists: commit L45, fix the eval environment (`node --test` in the sandbox, the plugin `bin/` refused, `large-tracked` `document-sections`) and rerun the six evals, the two review minors, and the Next.js overlap false positive from the other project.
- **L2 (2026-10-21, user):** "Listo" after merging #34 (`0c22366`). Tag `v4.0.0` not created yet.
- **L3 (2026-10-21, parent):** The publication gate parser bug (`2>&1` read as a refspec) joins the list from construct-memory L46. Under construct-memory L21 (apply the parent's recommendations), the fixes run without further questions; tags and releases stay the user's.
- **L4 (2026-10-21, T1):** Relation import stores `confidence` only when it is a finite number in [0,1], else null (a numeric string is null too); the doctor test that opened a `DatabaseSync` probe now closes it in a `finally`. RED 1 → GREEN 233/233 (parent rerun of `tests/memory/`).
- **L5 (2026-10-21, T3):** `uninterpretable()` takes one segment (brackets, backslash, nested or unbalanced braces) and only makes that position compatible; parentheses are literal; `**` and extglob segments (`[@!+*?](`) overlap everything from their position on; differing literal segments end the comparison as no overlap. `tests/admission/overlap.test.mjs` (6 tests: the reported Java/Next.js pair, two writers in one `[id]/_components/**`, route groups, extglob, `[id]/a.ts` vs `[id]/b.ts`, backslash and braces). One existing assertion encoded the defect (`src/[ab].js` vs `docs/readme.md`, different at the first segment, expected to overlap); now `src/readme.md`. README Overlap bullet reworded. RED shown afterwards on a HEAD copy (5 of 6 fail). Parent checks: diff read; `node --test tests/admission/` 75/75.
