# Contributing

Construct is a Claude Code plugin (`plugins/construct/`), its local marketplace (`.claude-plugin/marketplace.json`), and a curl installer (`install.sh`). There is no build step: everything is plain Node.js ESM and Markdown. For the user-facing description, see [README.md](README.md).

## Setup

- Node.js 22.16 or later (Node 23 is not supported), `git`, and Claude Code 2.1.304 or later.
- Load the plugin for one session without installing it:

```bash
claude --plugin-dir ./plugins/construct
```

## How work is done here

The repository follows its own workflow, Organic Driven Development (ODD).

- **Small changes** (understood, no high-risk item, resumable from the request plus `git diff`) need no tracking document.
- **Large changes** are tracked in `odd/tasks/<feature>.md`: specs (`S#`), tasks (`T#`), and a log. Tests and comments reference spec ids such as `S6`.
- **Test-first.** Write a failing test for the rule, watch it fail, make it pass, then refactor. Never weaken a check to get to green.
- **Risk line.** Every code change closes with `Risk: none` or `Risk: item N (reason)`. The six high-risk items are in `plugins/construct/hooks/contract/session.md`.

## Checks before a pull request

Run all four and fix failures at the cause:

```bash
node --test tests/                       # repository tests
claude plugin test plugins/construct     # mod tests (plugins/construct/tests/*.test.ts)
claude plugin validate --strict .        # marketplace manifest
claude plugin validate --strict ./plugins/construct
```

Useful narrower runs:

```bash
node --test tests/publication/publication.test.mjs    # one test file
node --test --test-name-pattern="Risk-line" tests/     # tests matching a name
```

The behavior evals are optional. They spend real usage, because each run is an isolated `claude -p` session:

```bash
scripts/eval.sh                          # all cases
scripts/eval.sh --case small-delegated   # one case
```

The `small-delegated-pressure` case reuses the `small-delegated` fixture and graders with a prompt that pushes against the rules through urgency; `claude plugin eval` runs a no-plugin baseline arm by default, and `scripts/eval.sh` keeps it on.

`scripts/eval.sh` runs each case in an isolated `claude -p` session. It may grant only the commands the eval cases need.

`scripts/probe-review.sh [--runs N]` stands in for the `review-fires` case where the eval sandbox has no working git: it runs the case's fixture and prompt in one headless `claude -p` session with only this repository's plugin and exits non-zero unless `construct:review-risk` is launched before any `git push`. It spends real usage (one sonnet session of up to 20 turns per run).

Two sandbox limits shape the cases: npm scripts only start there with `script-shell=/bin/sh` in a project `.npmrc`, which every fixture writes, and the plugin `bin/` and `CLAUDE_PLUGIN_ROOT` are not available to the agent's Bash, so the SessionStart memory line also names the absolute `node "<plugin root>/bin/construct-memory"` form, which `scripts/eval.sh` allows.

## Consistency the tests enforce

Many tests cross-check text against code, so a change in one place usually needs the matching change elsewhere.

| If you change | Also update |
|---|---|
| An agent (add or remove) | Start at the role registry `plugins/construct/hooks/scripts/roles.mjs` (name and kind; `tests/roles.test.mjs` cross-checks it against `agents/`, `plugin.json`, `hooks.json`, and `README.md`), then the S6 table in `tests/agents-config.test.mjs`, the `userConfig` options in `plugins/construct/.claude-plugin/plugin.json`, and the agent table in `README.md` |
| The role registry (`hooks/scripts/roles.mjs`) | The agents, `plugin.json` `userConfig`, `hooks.json`, and the agent table in `README.md`; `tests/roles.test.mjs` cross-checks all of them |
| Delivery's slice budget or vocabulary (`SLICE_LINES` in `hooks/scripts/delivery-signals.mjs`, the feature-document header) | `skills/delivery/` and the feature-document reference in `skills/workflow/`; `tests/delivery.test.mjs` compares them |
| The memory skill, the store, or the CLI | `skills/memory/SKILL.md`, `hooks/scripts/memory-store.mjs`, and `bin/construct-memory` together; `tests/memory/skill.test.mjs` checks the skill against both |
| A regex eval grader | The case's `case.yaml` and its grader file; `tests/evals.test.mjs` pins what each regex grader matches and rejects |
| A skill (add or remove) | `EXPECTED` in `tests/skills.test.mjs`; relative links inside skills must resolve |
| A contract text | Every construct component it names must exist. The injected session text stays at or under 8,000 characters (`tests/contract.test.mjs`). `hooks/contract/session.md` is near 7,000 characters injected, so measure with `node plugins/construct/hooks/scripts/contract.mjs session </dev/null | wc -c` and rewrite text in place instead of appending |
| A command, option, or message | Its help text and `README.md`, together (the `construct-memory` commands: `plugins/construct/bin/construct-memory`, its README Memory section, and `skills/memory/SKILL.md`) |
| The lens mapping (`LENSES_BY_RISK` in `hooks/scripts/review-lenses.mjs`) | The table in `skills/review/SKILL.md`; `tests/skills.test.mjs` compares them |
| A hook | Register it in exec form (`command: "node"`, `args: [...]`); tests check this |
| Agent routing | Role names are the agent name with dashes turned into underscores (`model_<role>`, `effort_<role>`; see `plugins/construct/hooks/routing.js`) |

## Branches and pull requests

- `main` is protected. Work on a feature branch and open a pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). Do not add AI attribution lines.
- Keep a pull request to about 400 changed lines. Split larger work into chained pull requests (see the `construct:delivery` skill).
- Technical artifacts (code, comments, docs, commit messages) are written in English.
- Commit, push, pull request, and merge are the maintainer's decisions.

## Releases

1. Bump `version` in `plugins/construct/.claude-plugin/plugin.json` in a `chore: release X.Y.Z` commit.
2. Put the version in the pull request title, for example `feat(delegation): ... (0.3.0)`.
3. Bump `CONSTRUCT_REF` in `install.sh` and the tag in its header URL together with the version.
4. Tag the merged release `vX.Y.Z`.

## Third-party material

Adapted code keeps its license in a `plugins/construct/LICENSE-<project>` file and in the header of each adapted file (see `LICENSE-flightdeck`). Ideas from another project, with no text or code copied, get one acknowledgement line in [`plugins/construct/NOTICE`](plugins/construct/NOTICE); NOTICE carries no license text.

## License

Contributions are accepted under the same [MIT License](LICENSE) as the project (inbound = outbound). Adapted third-party code keeps its license in a `LICENSE-<project>` file; ideas are credited in [`plugins/construct/NOTICE`](plugins/construct/NOTICE).
