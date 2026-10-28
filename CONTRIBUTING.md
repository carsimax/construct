# Contributing

Construct is a Claude Code plugin (`plugins/construct/`), its local marketplace (`.claude-plugin/marketplace.json`), and a curl installer (`install.sh`). There is no build step: everything is plain Node.js ESM and Markdown. For the user-facing description, see [README.md](README.md).

## Before you start

- Construct is a preview and changes quickly. Open an [issue](https://github.com/carsimax/construct/issues/new/choose) first, so a pull request does not chase a moving target; issues labeled `good first issue` are a good place to begin.
- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
- CI runs the [four checks](#checks-before-a-pull-request) on every pull request, so you can open one even if you cannot run `claude` locally.

## Setup

- Node.js 22.16 or later, `git`, Claude Code 2.1.304 or later, and [Engram](https://github.com/Gentleman-Programming/engram) (the memory the contract and skills call). Install Engram with `brew install gentleman-programming/tap/engram && engram setup claude-code`.
- Load the plugin for one session without installing it:

```bash
claude --plugin-dir ./plugins/construct
```

## How work is done here

The repository follows its own workflow, Agent Driven Development (ADD).

- **Small changes** (understood, no high-risk item, resumable from the request plus `git diff`) need no tracking document.
- **Large changes** are tracked in `.vault/tasks/<feature>.md`: specs (`S#`), tasks (`T#`), and a log. Tests and comments reference spec ids such as `S6`.
- **Test-first.** Write a failing test for the rule, watch it fail, make it pass, then refactor. Never weaken a check to get to green.
- **Risk line.** Every code change closes with `Risk: none` or `Risk: item N (reason)`. The six high-risk items are in `plugins/construct/hooks/contract/session.md`.

## Checks before a pull request

Run all four and fix failures at the cause:

```bash
node --test 'tests/**/*.test.mjs'        # repository tests (Node 22 needs the quoted glob, not tests/)
claude plugin test plugins/construct     # mod tests (plugins/construct/tests/*.test.ts)
claude plugin validate --strict .        # marketplace manifest
claude plugin validate --strict ./plugins/construct
```

Useful narrower runs:

```bash
node --test tests/publication/publication.test.mjs    # one test file
node --test --test-name-pattern="Risk-line" 'tests/**/*.test.mjs'    # tests matching a name
```

The behavior evals are optional. They spend real usage, because each run is an isolated `claude -p` session:

```bash
scripts/eval.sh                          # all cases
scripts/eval.sh --case small-inline   # one case
```

The `small-inline-pressure` case copies the `small-inline` fixture and graders (edit both; `tests/evals.test.mjs` checks they match) with a prompt that pushes against the rules through urgency; `claude plugin eval` runs a no-plugin baseline arm by default, and `scripts/eval.sh` keeps it on.

`scripts/eval.sh` runs each case in an isolated `claude -p` session. It may grant only the commands the eval cases need.

`scripts/probe-review.sh [--runs N]` is the live check for the review behavior, which the eval sandbox cannot run: it runs the case's fixture and prompt in one headless `claude -p` session with only this repository's plugin and exits non-zero unless `construct:review-risk` is launched before any `git push`. It spends real usage (one sonnet session of up to 20 turns per run).

Two sandbox limits shape the cases: npm scripts only start there with `script-shell=/bin/sh` in a project `.npmrc`, which every fixture writes, and the plugin `bin/` and `CLAUDE_PLUGIN_ROOT` are not available to the agent's Bash.

## Consistency the tests enforce

Many tests cross-check text against code, so a change in one place usually needs the matching change elsewhere.

| If you change | Also update |
|---|---|
| An agent (add or remove) | Start at the role registry `plugins/construct/hooks/scripts/roles.mjs` (name and kind; `tests/roles.test.mjs` cross-checks it against `agents/`, `plugin.json`, `hooks.json`, and `README.md`), then the S6 table in `tests/agents-config.test.mjs`, the `userConfig` options in `plugins/construct/.claude-plugin/plugin.json`, and the agent table in `README.md` |
| The role registry (`hooks/scripts/roles.mjs`) | The agents, `plugin.json` `userConfig`, `hooks.json`, and the agent table in `README.md`; `tests/roles.test.mjs` cross-checks all of them |
| Delivery's branch model or vocabulary (the `feat/<feature>-t<n>` sub-branches, the single final PR, the feature-document header) | `skills/delivery/` and the feature-document reference in `skills/workflow/`; `tests/delivery.test.mjs` checks them |
| A regex eval grader | The case's `case.yaml` and its grader file; `tests/evals.test.mjs` pins what each regex grader matches and rejects |
| `skill-context.mjs` or the `## Current state` line of `workflow`, `review`, or `delivery` | The `!` line and `allowed-tools` entry in all three skills, the `Skill state` section of `README.md`; `tests/skill-context/` and `tests/skills.test.mjs` check them. The script must always exit 0 and stay under 1,500 characters |
| A skill (add or remove) | `EXPECTED` in `tests/skills.test.mjs`; relative links inside skills must resolve |
| A contract text | Every construct component it names must exist. The injected session text stays at or under 8,000 characters (`tests/contract.test.mjs`). `hooks/contract/session.md` is near 7,000 characters injected, so measure with `node plugins/construct/hooks/scripts/contract.mjs session </dev/null | wc -c` and rewrite text in place instead of appending |
| A command, option, or message | Its help text and `README.md`, together |
| The lens mapping (`LENSES_BY_RISK` in `hooks/scripts/review-lenses.mjs`) | The table in `skills/review/SKILL.md`; `tests/skills.test.mjs` compares them |
| A hook | Register it in exec form (`command: "node"`, `args: [...]`); tests check this |
| Agent routing | Role names are the agent name with dashes turned into underscores (`model_<role>`, `effort_<role>`; see `plugins/construct/hooks/routing.js`) |

## Branches and pull requests

- `main` is protected. Work on a feature branch and open a pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). Do not add AI attribution lines.
- Large work lives on one `feat/<feature>` branch, split by work unit into local sub-branches `feat/<feature>-t<n>` merged with `git merge --no-ff`, and goes out as one pull request; there is no line budget (see the `construct:delivery` skill). Keep a feature small enough that its whole diff stays under the 400 KB review-context budget.
- Technical artifacts (code, comments, docs, commit messages) are written in English.
- Commit, push, pull request, and merge are the maintainer's decisions.

## Releases

1. Bump `version` in `plugins/construct/.claude-plugin/plugin.json` and `VERSION` in `plugins/construct/hooks/status/version.js` (the band and `/construct doctor` show it) to the same number in a `chore: release X.Y.Z` commit.
2. Put the version in the pull request title, for example `feat(delegation): ... (0.3.0)`.
3. Bump `CONSTRUCT_REF` in `install.sh` and the tag in its header URL together with the version.
4. Move the `Unreleased` entries of [CHANGELOG.md](CHANGELOG.md) under the new version.
5. Tag the merged release `vX.Y.Z`.

## Third-party material

Adapted code keeps its license in a `plugins/construct/LICENSE-<project>` file and in the header of each adapted file (see `LICENSE-gentle-shell`), and is listed in [`plugins/construct/NOTICE`](plugins/construct/NOTICE), which carries no license text. Third-party code copied unmodified (`hooks/vendor/mvdan-sh.cjs`, BSD-3-Clause) keeps its license in `LICENSE-<project>` too and is listed in NOTICE under Vendored code; `tests/band-license.test.mjs` pins the file's hash, so a new version is a new file and a new hash. Ideas from another project, with no text or code copied, get one credit line in the README's Credits section.

## License

Contributions are accepted under the same [MIT License](LICENSE) as the project (inbound = outbound). Adapted third-party code keeps its license in a `LICENSE-<project>` file; adapted code is listed in [`plugins/construct/NOTICE`](plugins/construct/NOTICE) and ideas are credited in the README's Credits section.
