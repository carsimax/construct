# Unpinned marketplace

Objective: make `claude plugin marketplace update` plus `claude plugin update` upgrade an installer-made install, by not pinning the marketplace to a tag, and give existing pinned installs a working migration path. Branch: fix/unpinned-marketplace. Baseline: 9b4aed4. Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Installer stops pinning.** "Dejar de anclar (Recommended)"
  - Given a machine without the construct marketplace When `install.sh` runs Then it runs `claude plugin marketplace add carsimax/construct` with no `#ref`.
  - `CONSTRUCT_REF` stays: it still drives the installed-version warning and the header URL (assumption: the installer keeps belonging to one release).
- **S2 — Pinned installs are told how to migrate.** "la sección Update del README recomiendan justo ese comando, que no sirve" (from the question the user answered)
  - Given an existing marketplace pinned to any ref When `install.sh` runs Then it warns with the sequence that works: `claude plugin marketplace remove construct`, `claude plugin marketplace add carsimax/construct`, `claude plugin install construct@construct`. An unpinned marketplace gets no warning.
  - Assumption: any pin warns, including this release's own tag, since a pin at any ref blocks later updates.
  - Assumption: the verified sequence (user, 2026-10-27, re-added with `#v12.0.1`) works the same without the ref.
- **S3 — README matches.** The Update section documents the migration for pinned installs; Manual install no longer says the installer pins (it also named the stale `v12.0.0`). CHANGELOG `Unreleased` records the change.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Tests first in `tests/install/install.test.mjs`, then `install.sh` `add_marketplace` | inline | 5 | done | (this commit) |
| T2 | S3 | README Update and Manual install, CHANGELOG Unreleased | inline | none | done | (this commit) |

## Log

- **L1 (2026-10-27):** "Bien primero vamos con los pencientes abiertos de odd" — answered "Dejar de anclar (Recommended)" for the pinned-install question (Engram #35).

- **L2 (2026-10-27):** T1 RED: 3 install tests failed on the old pinning; GREEN after the change; full suite 1081/1081.

Next step: review-risk and review-resilience on the branch, then the user decides push and PR.
