# Force the Neutral output style from the plugin

Branch `feat/force-output-style`, baseline `3a67768` (main).

## Specs

- **S1 — The plugin forces its style.** `output-styles/neutral.md` sets `force-for-plugin: true`, so every session with construct enabled uses Neutral without a `/config` choice, in any project. Source: user, "podemos nosotros dejarlo en el plugin que sea global?" then "si apliquemos asi". Supersedes `odd/tasks/odd-skills-plugin.md` (no `force-for-plugin`, the user selects it in `/config`). Documented behavior: the field overrides the user's `outputStyle`, and with several forcing plugins the first loaded wins (code.claude.com/docs/en/output-styles, Frontmatter reference).
- **S2 — The band shows the style in effect.** The status band's style segment shows `construct:Neutral`, not `settings.outputStyle`, because the forced style overrides that setting.
- **S3 — The installer stops writing `outputStyle`.** The settings merge only sets `theme` and the engram allow rules; `--force` covers `theme` only. An `outputStyle` already in the file is left as it is.
- **S4 — Docs.** README install, quick path, and layers table describe the forced style and drop the `/config` step.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S4 | Frontmatter, band style, `tests/styles.test.mjs`, README | inline | 3 | done | see L2 |
| T2 | S3, S4 | `install.sh` merge, `tests/install/install.test.mjs`, README | inline | 5 | done | see L4 |

Route evidence: two small sequential units; no Writer trigger. Risk item 3: changes the style every existing user gets. Item 5: installer.

## Log

- **L1 (2026-10-20, user):** "si apliquemos asi" — force the style, update installer and README.
- **L2 (2026-10-20):** T1 done. RED: `tests/styles.test.mjs` failed on the missing `force-for-plugin`. GREEN after the frontmatter line. The band style is now the constant `construct:Neutral` in `collect` (`hooks/register.js`);  README drops the `/config` output style step.
- **L3 (2026-10-20):** Correction to L2: `collect` is covered by the mod tests. `claude plugin test plugins/construct` failed 2 of 36 after T1 (`✎ Neutral` expected from settings; `✎` expected absent without settings). Tests now set `outputStyle: 'Explanatory'` and expect `✎ construct:Neutral` without `Explanatory`; the absent-style assertion is dropped because the style is always known. 36 pass. Commit `0de7f10`.
- **L4 (2026-10-20):** T2 done. RED: 3 of 12 installer tests failed (two merges still wrote `outputStyle`, the warning test still named it). GREEN after `WANT` keeps only `theme` and the usage text drops `outputStyle`. `node --test tests/`: 557 pass; mod tests 36 pass; `claude plugin validate plugins/construct` passed. Existing users who already have `outputStyle` keep it in the file; it has no effect while construct is enabled.
- **L5 (2026-10-20):** RDD, user consented ("Review this change"). `odd-assess --base-ref 3a67768 --committed-only`: `high` (`process_boundary`, `shell_source` on `install.sh`), 8 paths, 66 lines. Lineage `review-9ee08b6cf27e437c`: all four lenses captured with no findings; `approved` and acknowledged.
- **L6 (2026-10-20):** odd-verify: S1–S4 PASS, no blockers. Installer probes in a sandbox HOME (only `outputStyle`, `--force`, symlinked file, already-set run) never write or remove `outputStyle`. Advisories kept as follow-ups: the band label is hardcoded, so with a second plugin that forces a style and loads first it would be wrong; README step 5 still points to `/config` for role models only, which is accurate.
