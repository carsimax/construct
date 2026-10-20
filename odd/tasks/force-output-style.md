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
| T2 | S3, S4 | `install.sh` merge, `tests/install/install.test.mjs`, README | inline | 5 | pending | |

Route evidence: two small sequential units; no Writer trigger. Risk item 3: changes the style every existing user gets. Item 5: installer.

## Log

- **L1 (2026-10-20, user):** "si apliquemos asi" — force the style, update installer and README.
- **L2 (2026-10-20):** T1 done. RED: `tests/styles.test.mjs` failed on the missing `force-for-plugin`. GREEN after the frontmatter line. The band style is now the constant `construct:Neutral` in `collect` (`hooks/register.js`); `collect` has no unit test, so S2 rests on review (risk item 6). README drops the `/config` output style step.
