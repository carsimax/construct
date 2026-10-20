# Contributing

Construct is a Claude Code plugin (`plugins/construct/`), its local marketplace (`.claude-plugin/marketplace.json`), and a curl installer (`install.sh`). There is no build step: everything is plain Node.js ESM and Markdown. For the user-facing description, see [README.md](README.md).

## Setup

- Node.js 20 or later, `git`, and Claude Code 2.1.304 or later.
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
node --test tests/assess/cli.test.mjs                  # one test file
node --test --test-name-pattern="Risk-line" tests/     # tests matching a name
```

The behavior evals are optional. They spend real usage, because each run is an isolated `claude -p` session:

```bash
scripts/eval.sh                          # all cases
scripts/eval.sh --case small-delegated   # one case
```

`scripts/eval.sh` evaluates a temporary copy of the plugin whose manifest drops the `engram@engram` dependency, because isolated eval runs cannot resolve it and the plugin would not load. It may grant only the commands the eval cases need.

## Consistency the tests enforce

Many tests cross-check text against code, so a change in one place usually needs the matching change elsewhere.

| If you change | Also update |
|---|---|
| An agent (add or remove) | The S6 table in `tests/agents-config.test.mjs`, the `userConfig` options in `plugins/construct/.claude-plugin/plugin.json`, and the agent table in `README.md` |
| A skill (add or remove) | `EXPECTED` in `tests/skills.test.mjs`; relative links inside skills must resolve |
| A contract text | Every construct component it names must exist. The injected session text, including the CodeGraph notice, stays under 8,000 characters, so `hooks/contract/session.md` has about 7,400 characters of room and is near it now (`wc -c`). Rewrite text in place instead of appending |
| A command, option, or message | Its help text and `README.md`, together. Every `odd-review` command or flag that `rdd-review` names must exist in `plugins/construct/lib/review/` |
| A hook | Register it in exec form (`command: "node"`, `args: [...]`); tests check this |
| Agent routing | Role names are the agent name with dashes turned into underscores (`model_<role>`, `effort_<role>`; see `plugins/construct/hooks/routing.js`) |

## Branches and pull requests

- `main` is protected. Work on a feature branch and open a pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). Do not add AI attribution lines.
- Keep a pull request to about 400 changed lines. Split larger work into chained pull requests (see the `construct:chained-pr` skill).
- Technical artifacts (code, comments, docs, commit messages) are written in English.
- Commit, push, pull request, and merge are the maintainer's decisions.

## Releases

1. Bump `version` in `plugins/construct/.claude-plugin/plugin.json` in a `chore: release X.Y.Z` commit.
2. Put the version in the pull request title, for example `feat(delegation): ... (0.3.0)`.
3. Tag the merged release `vX.Y.Z`.

## Third-party material

Adapted content keeps its notice in [`plugins/construct/NOTICE`](plugins/construct/NOTICE). Add an entry there when you adapt material from another project.

## License

Contributions are accepted under the same [MIT License](LICENSE) as the project (inbound = outbound). Adapted third-party material keeps its notice in [`plugins/construct/NOTICE`](plugins/construct/NOTICE).
