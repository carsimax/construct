# Construct

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.304%2B-blue)](#requirements)
[![Plugin version](https://img.shields.io/badge/version-1.2.0-informational)](plugins/construct/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Construct is a Claude Code plugin that makes every request follow Organic Driven Development (ODD): authorize, explore, size, track, implement test-first, and close with evidence and a Risk line.

## What you get

- **ODD workflow.** A session contract, injected by hooks, that Claude follows on every request without being asked.
- **Role agents with model routing.** 13 agents (explorer, worker, verifier, judges, review lenses). You choose each role's model and effort in `/config`.
- **Skills.** Procedures that load on demand: workflow, delegation, task sizing, debugging, quality bar, migrations, branches and pull requests, and more.
- **Receipt-driven review.** `odd-assess` classifies risk and `odd-review` runs a bounded outside review of high-risk changes, with your consent.
- **Secret guard.** A hook that denies reads and writes of credentials and destructive commands, including under `bypassPermissions`.
- **Status panel.** A docked panel with the model, context, cost, plan limits, active feature, review state, permission gate, agents, and changes. Open it with `/construct`.
- **Output style.** The `Principal Engineer` output style.

Memory comes from the separate `engram@engram` plugin, which Construct depends on.

## Requirements

| Requirement | Why |
|---|---|
| Claude Code 2.1.304 or later, signed in | The panel is a mod, and the panel needs 2.1.304. Tested on 2.1.304 |
| Node.js 20 or later, with npm | The plugin's scripts and hooks (`odd-assess`, `odd-review`, the hook scripts). Claude Code's native install does not bundle Node.js |
| `git` on the PATH | `odd-assess` and `odd-review` read the repository |
| Homebrew (macOS or Linux) | Installs the engram binary |

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v1.2.0/install.sh | bash
```

The installer checks the requirements above and stops before changing anything if one is missing, or if `~/.claude` or `~/.claude/settings.json` is not writable, or if `settings.json` is a directory. Then it runs the manual steps below for you:

- Installs the engram binary through Homebrew when it is missing, and runs `engram setup claude-code`.
- Adds the engram and construct marketplaces and installs `construct@construct`.
- Installs the CodeGraph CLI and registers the codegraph MCP server. If `npm install -g` fails, it warns, skips the server, and continues.
- Merges into `~/.claude/settings.json`: the `permissions.allow` rules `mcp__engram` and `mcp__plugin_engram_engram`, and removes a `theme` of `custom:construct:construct` left by earlier versions (any other theme is left alone). An empty `settings.json` counts as `{}`. Other keys stay as they are, a symlinked file (even a dangling one, whose target is then created) is written through to its target with its mode kept, and the previous file is saved as `settings.json.bak-<timestamp>`.

Every step is skipped when it is already done, so running the installer again changes nothing. It never changes other permissions or your permission mode. The output style needs no setting: the plugin forces `Principal Engineer`, and an `outputStyle` you already have stays in the file but has no effect while construct is enabled.

| Option | Meaning |
|---|---|
| `--no-mcp` | Skip the CodeGraph CLI and the codegraph MCP server |
| `--force` | Deprecated: has no effect and prints a warning. It is accepted for now so scripted installs keep working, and will be removed in a later release |

Pass options after `bash -s --`, for example `curl -fsSL <url> | bash -s -- --no-mcp`. To read the script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v1.2.0/install.sh -o install.sh
less install.sh
bash install.sh
```

### Manual install

The manual steps the installer runs, for when you want to run them yourself:

1. Install the engram binary and register its MCP server:

   ```bash
   brew install gentleman-programming/tap/engram
   engram setup claude-code
   ```

2. Make sure the engram marketplace is added. `engram setup claude-code` normally adds it and installs the engram plugin; running the command again is harmless. Construct declares `engram@engram` as a dependency, and the dependency resolves only from a marketplace you have already added:

   ```bash
   claude plugin marketplace add Gentleman-Programming/engram
   ```

3. Add this marketplace and install the plugin:

   ```bash
   claude plugin marketplace add carsimax/construct
   claude plugin install construct@construct
   ```

   The install output ends with `(+ 1 dependency: engram)` when engram was not installed yet.

4. Optional: install the CodeGraph CLI and register the codegraph MCP server (see [MCP servers](#mcp-servers)).

5. Optional: inside Claude Code, in `/config`, set each role's model and effort (rows such as `ODD Worker model`).

6. Check that it works. Open a session in any git repository:

   - Ask "what does your Construct contract say about Risk lines?". The answer quotes the `Risk: item N` rule.
   - `/agents` lists the `construct:` agents, such as `construct:odd-worker` and `construct:review-risk`.
   - Ask Claude to run `odd-review mode status`; it prints `{"mode":"on","source":"default"}`. The plugin's `bin/` is on the PATH of Claude's Bash tool only, not your own shell.
   - After a turn ends, the panel shows the RDD state (`clear`, `review due` or `reviewed`); `/construct` opens it.

## First session

Open Claude Code in a git repository and make a request. Construct applies the same steps each time:

1. **Authorize.** Questions, reviews, and planning stay read-only. Files change only when you explicitly ask for a change.
2. **Explore.** Claude reads the existing code first, in proportion to the task.
3. **Size.** A task is small or large. Small work goes to one worker agent. Large work is tracked in `odd/tasks/<feature>.md` (specs, tasks, log) before the first source write.
4. **Implement test-first.** A worker writes a failing test, makes it pass, then refactors, inside the edit surfaces it was given.
5. **Close with evidence.** One report: what was verified, what failed or was skipped, the next step, and a Risk line (`Risk: none` or `Risk: item N (reason)`).

Commit, push, pull request, and merge stay your decisions. For a high-risk change, Construct offers a review and asks for your consent first. `odd-review mode disable` turns the review off.

To confirm the install works, see step 6 of [Manual install](#manual-install).

## Update

Construct and engram update through Claude Code's plugin commands. Running `install.sh` again does not update them: it skips every step that is already done.

```bash
claude plugin marketplace update construct     # fetch the latest catalog from carsimax/construct
claude plugin update construct@construct       # install the new version
```

Restart Claude Code afterwards; a plugin update applies to new sessions. `claude plugin list` shows the installed version.

To update engram as well, upgrade the binary and rerun its setup, which also updates the `engram@engram` plugin:

```bash
brew upgrade engram
engram setup claude-code
```

## Configuration

Options are plugin settings, edited in `/config`:

| Option | Effect |
|---|---|
| Model and effort per role | See the routing table below |
| `panel_open_on_start` (boolean, default `true`) | Open the panel at every session start |
| `codegraph_auto_index` (boolean, default `false`) | Index a git root with CodeGraph at session start (see [MCP servers](#mcp-servers)) |

### Agents and model routing

The plugin ships 13 agents. Each role's model and effort can be changed in `/config`, where every option appears as a row such as `ODD Worker model` or `RDD Risk effort`.

| Role | Agent | Model | Effort |
|---|---|---|---|
| ODD Explorer | `construct:odd-explorer` | haiku | default |
| ODD Worker | `construct:odd-worker` | sonnet | medium |
| ODD Verify | `construct:odd-verify` | opus | medium |
| JD Judge A | `construct:jd-judge-a` | opus | medium |
| JD Judge B | `construct:jd-judge-b` | sonnet | medium |
| JD Fix Agent | `construct:jd-fix-agent` | sonnet | medium |
| RDD Risk | `construct:review-risk` | opus | medium |
| RDD Readability | `construct:review-readability` | sonnet | medium |
| RDD Reliability | `construct:review-reliability` | sonnet | medium |
| RDD Resilience | `construct:review-resilience` | sonnet | medium |
| RDD Refuter | `construct:review-refuter` | opus | medium |
| RDD Validator | `construct:review-validator` | opus | medium |
| General delegation | `construct:odd-general` and the built-in `general-purpose` | sonnet | medium |

How the routing works:

- The plugin's mod (`hooks/register.js`) applies the configured model when a subagent spawns and the configured effort on each of its requests.
- The configured model replaces any model passed for that agent at call time.
- An effort of `default` keeps the model's own effort.
- If the mod cannot run, each agent keeps the model and effort in its own frontmatter.

## Reference

Deep material for people who want to know how each part works.

### How the ODD contract loads

A plugin cannot ship a `CLAUDE.md`, so Construct loads its rules in layers:

| Layer | Mechanism | Content |
|---|---|---|
| Session contract | `SessionStart` hook (startup, resume, clear, compact) | ODD protocol, task size, high-risk list, Risk line, and delegation triggers, under 8,000 characters |
| Subagent contract | `SubagentStart` hook | Artifact language, edit surfaces, scratch, and the `## Key Learnings` closing block. JSON-only reviewers (`review-*`, `jd-judge-*`) get nothing |
| Skills | Loaded on demand | `odd-workflow`, `odd-delegation`, `task-size-risk`, `lossless-prompts`, `debugging`, `constraint-driven` |
| Output style | Forced by the plugin (`force-for-plugin`), in every project | Reply tone, language, response length, verification, and working rules (no AI attribution in commits, one question at a time) |

The contract texts live in `plugins/construct/hooks/contract/`.

After a compaction or a resume, a second `SessionStart` hook (matcher `compact|resume`) re-injects the active feature state. It reads `odd/tasks/*.md` under the project root and, for up to three documents with unfinished tasks (newest first), emits the path, title, branch line, unfinished task rows, and the last `Next step:` from the log, in at most 2,500 characters. It is read-only and prints nothing when no document is active. Task-to-document sync hooks were dropped: native tasks have no link to the document's `T#` rows, so a hook could corrupt the feature document. The orchestrator keeps the document current, and the re-injection tells it where it was.

### Delegation admission

A `PreToolUse` hook on `Agent` (`hooks/scripts/delegation-admission.mjs`) denies a malformed launch, with a reason that names what is missing and the expected form. It runs next to the review-context hook; an admitted launch prints nothing, so the two never conflict. Other agents are untouched.

- **Writers** (`construct:odd-worker`, `construct:jd-fix-agent`) need a `## Allowed edit surfaces` section with at least one entry per line. An entry that is absolute, starts with `~` or a drive letter, contains `..`, or starts with a glob (a bare `*` or `**` included) is denied, as is prose inside the section; a path with whitespace goes in backticks, and repeated sections must agree.
- **Spec line.** When an unfinished feature document exists (the same rule the compact/resume re-injection uses), a writer prompt also needs a line `Spec: odd/tasks/<feature>.md, T<n>` naming an existing regular file under `odd/tasks/` (a symlink does not count). Without such a document, small work needs no `Spec:` line.
- **Overlap.** A writer whose surfaces overlap those of a writer still open is denied. A glob entry covers what it matches and everything under it; brackets, extglobs, and nested or unbalanced braces count as overlapping everything. The hook records each admitted writer (its surfaces and a hash of its prompt) under `${CLAUDE_PLUGIN_DATA}/delegation-admission/<session>/` (same fallback as the gates), and a `SubagentStop` hook (`delegation-admission.mjs stop`) removes the record whose prompt hash matches the first user row of `agent_transcript_path`. A record older than one hour counts as a crashed writer and is dropped. The check and the record run under an `mkdir` lock beside the records (`<session>.lock`, a lock older than 10 seconds is broken, a wait over 3 seconds fails open), so two launches in the same parallel batch cannot both pass.
- **Prefix.** `odd-worker`, `jd-fix-agent`, and `odd-verify` are admitted the same with or without the `construct:` prefix.
- **Verifier** (`construct:odd-verify`) needs a line `Risk: item N` (N 1-6). `Risk: none` does not admit a verifier.

The hook fails open on unreadable input or any internal error; a well-formed launch that breaks a rule is denied.

### MCP servers

The plugin ships no MCP servers, so it never duplicates servers you already registered (duplicates would load every tool twice). The agents and the `codegraph` skill expect this user-scope server. Install the CodeGraph CLI, then register the server once:

```bash
npm install -g @colbymchenry/codegraph
claude mcp add-json --scope user codegraph '{"type":"stdio","command":"codegraph","args":["serve","--mcp"],"alwaysLoad":true}'
```

`alwaysLoad: true` keeps `codegraph_explore` loaded from the first prompt instead of deferred behind tool search (`claude mcp add` has no flag for it, hence `add-json`). To skip permission prompts, add `"mcp__codegraph__*"` to `permissions.allow` in `~/.claude/settings.json`. Indexing stays your decision: agents never run `codegraph init`, so run `codegraph init` in each project you want indexed, or opt in to automatic indexing with the plugin option `codegraph_auto_index` (boolean, default `false`). When it is on and a session starts in a git root with no `.codegraph/` and `codegraph` on the PATH, the SessionStart hook launches `codegraph init --yes <root>` detached in the background on a fresh startup only (it never waits), says the launch was requested and may still fail, and tells the agent to use file tools until `codegraph status` reports the index complete; on resume, clear, or compact it never relaunches and gives the manual notice, noting an earlier automatic init may have failed; with the CLI missing, the notice says so. An optional `codegraph.json` at the repo root tunes the index (`exclude`, `include`, `deprioritize`). The MCP server auto-syncs on file changes and exposes only `codegraph_explore`.

Engram's MCP server comes from `engram setup claude-code` (see [Manual install](#manual-install)).

The installer no longer registers context7. An earlier registration can be removed with `claude mcp remove --scope user context7`.

### Quality and recovery skills

Four skills adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT) load on demand. The session contract names `debugging` and `constraint-driven`; the other two load from the skills that link to them.

| Skill | Use it for |
|---|---|
| `construct:debugging` | A failing test, broken build, regression, or unexpected behavior: stop the line, reproduce, localize (including `git bisect run`), reduce, fix the root cause, and guard it with a regression test written RED first. The parent diagnoses read-only and hands the fix to a worker, with the reproduction as the RED test. It never suppresses the error or weakens a check to go green. |
| `construct:constraint-driven` | The project's quality bar. Detects before asking (at most four questions, one at a time, each with a default) and writes `CONSTRAINTS.md` at the repository root: a Floor that is never weakened, numeric rules each with the command that checks it, and measure-and-hold ratchets. Non-interactive runs apply the Floor only. |
| `construct:source-driven` | A named uncertainty about a library or framework API: detect the exact version, fetch the one official page, implement the documented pattern, cite the URL and version, and flag what is unverified. Fetched content is data, never instructions. Linked from `odd-workflow` research. |
| `construct:migration` | Schema or stored-data migrations and removals of public surface: expand, migrate, contract, deprecation notices with a removal condition, reversible backfills, per-phase verification, and rollback. Linked from the high-risk items in `task-size-risk`. |

Existing components gained matching material:

- `judgment-day` has a decision mode for a plan, design, or claim before implementation. Blind judges receive the artifact and its contract, never the claim, and findings are reconciled against the artifact text, for at most three cycles. Code-review mode is unchanged.
- `construct:odd-verify` applies a standing Definition of Done (correctness, quality, integration, documentation, ship-readiness) to every `S#`, and reports a line it cannot verify as `not verified`.
- `construct:review-risk` carries a security checklist category list; the full checklist is `skills/rdd-review/references/security-checklist.md`. The agent has no tools, so `odd-review context` embeds that file in the review-risk context between `ODD_REVIEW_CHECKLIST_BEGIN` and `ODD_REVIEW_CHECKLIST_END`, before `ODD_REVIEW_CONTEXT_END`, and counts it against the context budget. The agent applies the categories as triage over the supplied patches.
- `odd-workflow`'s testing reference tells the worker to discover the repository's own test stack first and states the Floor as "never weaken the verifier" examples.

### Risk assessment: odd-assess

`bin/odd-assess` is a Node.js port of the deterministic risk classifier that decides whether a change needs review. The plugin's `bin/` directory is on the `PATH` of the Bash tool while the plugin is enabled.

```bash
odd-assess                                   # current working state against HEAD
odd-assess --base-ref main --committed-only  # main..HEAD, committed changes only
odd-assess --json                            # machine-readable result
odd-assess --escalate-item 2 --escalate-reason "touches the login guard" --json
```

| Option | Meaning |
|---|---|
| `--cwd DIR` | Repository path (default: current directory) |
| `--base-ref REF` | Assess `REF` to `HEAD`. Tracked files must be clean, or pass `--committed-only` to ignore them |
| `--committed-only` | Acknowledge that `--base-ref` ignores dirty tracked changes. It only qualifies `--base-ref`: passing it alone is a usage error (exit `2`) |
| `--escalate-item N`, `--escalate-reason TEXT` | Raise the tier to `high` by citing high-risk item 1 to 6 (one-line reason, at most 500 bytes). Both flags or neither; a tier is never lowered |
| `--json` | Print the `construct.review-assessment/v1` object instead of a short summary |

Without `--base-ref`, the candidate is the working tree (tracked plus untracked, not ignored), frozen through a temporary index. Your real index is never changed.

JavaScript and TypeScript module files (`.mjs`, `.cjs`, `.mts`, `.cts`) are read as source, like `.js` and `.ts`: an added line that spawns a process (`process_boundary`) or calls a dangerous sink (`dangerous_sink`) makes the change `high`. In any source file outside tests, an added non-comment line that names a hook's `permissionDecision` (`permission_decision`, signal `permissions`) also makes it `high`. An added line that weakens the verifier (`verifier_weakening`, signal `verifier_weakening`) makes it `high` too: a suppression comment (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `# noqa`, `# type: ignore`, `//nolint`) in a source or test file, or a skip or focus marker (`.skip(`, `.only(`, `xit(`, `xdescribe(`, `test.todo(`, `{ skip:` or `{ todo:` in `node:test`, `@pytest.mark.skip`, `t.Skip(`) in a test file. Removed lines never count, and `docs/`, fixtures, and testdata are excluded.

Three high-risk items are recognized by path or content, and each reason carries `high-risk item N (...)` in its `detail`. Item 1 (`database_migration`, `destructive_sql`, signal `data_loss`): code, SQL, or config files (`.sql`, `.py`, `.rb`, JS/TS, `.go`, `.php`, `.java`, `.kt`, `.cs`, `.ex`/`.exs`, `.yaml`/`.yml`, `.json`, `.xml`, and extensionless files, which fail toward high) under `migrations/` or `migration/` directories (Django, Prisma, Knex, Flyway) or Rails `db/migrate/`, files under `alembic/versions/`, Flyway `V<n>__*.sql`, `U<n>__*.sql`, and repeatable `R__*.sql` names (anywhere in the tree), and added `DROP`, `TRUNCATE`, `ALTER ... DROP`, or `DELETE FROM` without `WHERE` in a `.sql` file (comments are ignored). Item 2 (`private_key`, `credential_file`, `private_key_content`, signal `security`): `id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519` with an optional suffix (never `*.pub`), `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.ppk`, `credentials.json`, `.npmrc` or `.pypirc` with an added token or password line, and an added PEM `PRIVATE KEY` header in any scanned text file. Item 5 (`dependency_manifest`, `git_hook`, signal `delivery`): package manifests and lockfiles (npm, pnpm, yarn, pip `requirements*.txt`, pyproject, poetry, Pipfile, Go, Cargo, Bundler, Composer), `Dockerfile*`, and git hooks (`.githooks/`, `.husky/`, `.git/hooks/`, `lefthook.yml`, `.pre-commit-config.yaml`). Test files and `test`, `tests`, `spec`, `docs`, `fixtures`, `testdata` directories are never evidence for these items, and Markdown stays passive. Known fail-toward-high cases: a Keynote `.key` file and a string literal such as `SELECT 'drop table'` still count.

The JSON result has `risk` (`passive`, `medium`, `high`), `reasons`, `changed_paths`, `changed_lines`, `candidate`, `review_due`, `review_due_reason`, and `lenses` (empty for passive and medium, the four canonical lenses for high). Only `high` makes a review due; `medium` reports `under_budget` and `passive` reports `passive`. When the exact candidate already has a receipt from `odd-review acknowledge`, `candidate.consumed` is `true` and the result reports `review_due: false` with `review_due_reason: "already_reviewed"`, whatever the tier.

Exit codes: `0` for any successful assessment, including a fail-closed one (`risk: "high"` with one `unassessable` reason, for example when `--base-ref` names a missing ref); `2` for bad usage, with the message on stderr.

### Review lifecycle (`odd-review`)

`bin/odd-review` runs the review lifecycle without any external binary: it freezes the candidate, serves immutable evidence to the review agents, validates their results, drives one bounded correction, and records a receipt. It never asks for consent; that belongs to the review skill.

```bash
odd-review start                                    # lenses from odd-assess; or --base-ref main --committed-only
odd-review start --lenses risk,reliability --lenses-reason "touches the login guard"   # explicit lenses
odd-review start --escalate-item 2 --escalate-reason "touches the login guard"   # raise the tier to high first
odd-review context --lineage L --lens risk          # evidence for one lens (binding + block)
odd-review capture --lineage L --lens risk --input result.json     # one per selected lens ("-" reads stdin)
odd-review capture-refuter --lineage L --input refuter.json        # only after refutation_required
odd-review correct --lineage L                      # once, after correction_required
odd-review capture-validation --lineage L --input validator.json
odd-review status --lineage L                       # counters; receipt_check once acknowledged
odd-review abandon --lineage L                      # close an open review; invalidate needs --reason and a pristine review
odd-review capture-unachievable --lineage L --lens risk --reason "agent could not run"   # escalates
odd-review start --focus resilience                 # a medium candidate gets that one lens
odd-review acknowledge --lineage L                  # only when approved; writes the receipt
odd-review validate --gate pre-push                 # the publication gate; see below
```

States: `collecting` to `approved`, `refutation_required`, or `correction_required`; `refutation_required` to `approved` or `correction_required`; `correction_required` to `validation_required`; `validation_required` to `approved` or `escalated` (a human decision); `approved` to `acknowledged`.

- Every command prints JSON with the exact `next` commands. Exit `0` is success, `1` a refused transition (`{"error":{"code","message"}}` on stderr), `2` bad usage.
- Lenses are `review-risk`, `review-resilience`, `review-readability`, and `review-reliability`; the short names work and the canonical order is kept. Without `--lenses` (and `--lenses-reason`), `start` takes the lenses `odd-assess` assigns to the frozen candidate, all four for `high`, and records `odd-assess: <risk> risk (<reasons>)` as the reason; a `medium` candidate takes one lens with `--focus LENS` (not with `--lenses`; a `high` candidate ignores it), and without it, like a `passive` one, refuses with `lenses_required`. `--escalate-item N --escalate-reason TEXT` (same validation as `odd-assess`, both or neither) raises a `medium` or `passive` candidate to `high` before the lenses are chosen, so it gets all four and the reason includes the `agent_escalation` detail; it cannot be combined with `--lenses`. `--lenses` and `--lenses-reason` go together.
- The candidate is frozen into immutable git trees (the working state goes through a temporary index). `context` serves name-status, numstat, and one verbatim patch per changed path from those trees only, and refuses with `context_budget_exceeded` above 400 KB (`--max-bytes N` overrides it); split the change into smaller slices when that happens.
- `capture` validates the result against the agent's output contract: matching `subject_hash`, no unknown or missing fields, a completed inspection that lists exactly the changed paths, a selected lens, and one capture per lens.
- Only a BLOCKER or CRITICAL finding introduced by the candidate blocks. Deterministic ones need a correction; inferential ones go to the refuter first. Everything else is advisory and lands in the receipt.
- `correct` is allowed once per lineage and may change at most `min(200, ceil(n/2))` lines, where `n` is the reviewed line count, with a floor of 2 so a one-line candidate fits one line replacement. A correction over the budget is refused and does not use up the one correction.
- One-shot counters (`full_reviews`, `refuter_batches`, `fix_batches`, `scoped_fix_validations`, `final_verifications`) are printed by every command. A second batch of a kind in a live review (for example a second `correct`) makes the transaction terminal `escalated` with `reason: budget_exhausted` and the counter's name. The lifecycle has no final verification step, so `final_verifications` stays 0; `full_reviews` counts the completed lens collection.
- `capture-unachievable --lens LENS --reason TEXT` records that a selected lens cannot run and escalates the review (`lens_unachievable`), since it can no longer approve. `abandon [--reason TEXT]` closes any open review (`abandoned`); `invalidate --reason TEXT` closes one that no lens has touched (`invalidated`, otherwise `not_pristine`). Neither writes a receipt, and both stop counting as an open lineage for the Stop gate.
- The receipt carries `paths_digest`, `policy_hash`, `ledger_hash`, `evidence_hash`, `fix_delta_hash` (the empty-input hash when there was no correction), and the counters. After acknowledgement `status` recomputes the hashes and prints `receipt_check` (`ok`, `mismatch` with the field names, `legacy` for a receipt from before the hashes, `missing`, `unreadable`). Schema ids stay `v1`: every change is an additive field.
- The refuter result must carry the `subject_hash` from its `ODD_REVIEW_BINDING`, which binds it to the lineage, target, and batch (`subject_mismatch` otherwise).
- `acknowledge` accepts only `approved` and refuses a replay. If a crash left the receipt written but the transaction still `approved`, running it again completes the transaction and reports `recovered: true`; a receipt of another lineage is refused as `target_already_acknowledged`. `start` refuses a candidate that already has a receipt.

#### The RDD switch, the boundary, and the Stop gate

```bash
odd-review mode status                      # {"mode":"on","source":"default"}; read-only
odd-review mode status --scope clone        # {"scope":"clone","mode":"off"|"on"|null,"set":…,"effective":{…}}; one scope only
odd-review mode disable                     # global scope (default); enable turns it back on
odd-review mode enable --scope clone        # this clone only
odd-review boundary                         # {"commit":"<sha>","source":"receipt|merge-base|root"}
```

- The switch is on by default. Precedence is the clone file (`<git-common-dir>/odd-review/mode.json`), then the global file (`${XDG_CONFIG_HOME:-$HOME/.config}/construct/rdd.json`), then the default. An unreadable file is skipped. Writes are atomic.
- `boundary` is the start of the next committed range: among the receipts whose `candidate_commit` is an ancestor of (or equal to) `HEAD`, the one closest to `HEAD` by ancestry (ties go to the newest acknowledgement, so reviewing an older commit later never moves the boundary back), else the merge-base with the default branch (the first of `origin/HEAD`, `main`, `master`, `origin/main`, `origin/master` that resolves and differs from `HEAD`), else the root commit. Receipts of committed-mode reviews record `candidate_commit` (and `base_commit` when `--base-ref` names a commit); older receipts without them stay valid and are ignored by `boundary`.
- The plugin's `Stop` hook (`hooks/scripts/review-gate.mjs`) assesses any uncommitted changes, and `boundary..HEAD` when the boundary comes from a receipt or a merge-base. A root boundary (for example the default branch of an existing repository with no receipts) never opens a committed range, so the gate does not review a whole history. When one is `high`, has no receipt, and was not yet reminded in this session, it blocks the stop once with the range, up to three reasons, and the next step (load `construct:rdd-review`, ask for consent, or skip). Reminders are kept per session under `${CLAUDE_PLUGIN_DATA}/review-gate/`; without `CLAUDE_PLUGIN_DATA` they go to a private `construct-<uid>` directory in the system temp dir, which must be owned by the user with no group or other access (otherwise the gate stays silent). It does nothing when the switch is off, outside a repository, in a repository without commits, or when `stop_hook_active` is set, stays silent for a target that has an open lineage (any state but `escalated`, `acknowledged`, `abandoned`, and `invalidated`, with a transition in the last six hours; an older one counts as abandoned), and fails open on any error. While a subagent of the session is open (`hooks/scripts/subagent-count.mjs` records each start on `SubagentStart` and removes it on `SubagentStop`, one file per agent id under `${CLAUDE_PLUGIN_DATA}/subagent-count/`, and an entry older than one hour counts as abandoned, and a stop whose id was never recorded closes the oldest entry that has no id), the gate stays silent and records nothing, so the check runs at the first `Stop` after the agents finish; missing or unreadable state means the gate runs as usual.
- The Risk line gate (`hooks/scripts/risk-line.mjs`) has two hooks. `mark` runs on `UserPromptSubmit`, records the working-state tree for the session under `${CLAUDE_PLUGIN_DATA}/risk-line/`, and prints nothing. `UserPromptSubmit` also fires again inside one turn (for example for a task notification) with the same `prompt_id`; such a repeat keeps the turn's record, and only a new `prompt_id` (or none) marks again. `check` runs on `Stop`: when paths outside `odd/tasks/` changed since the mark and the final message has no `Risk: none` or `Risk: item N` (N 1-6) line, it blocks the stop once per turn, naming up to three changed paths and the expected form. The line may start with a list marker (`-`, `*`, `+`, `1.`, `1)`) and may wrap the label or the value in Markdown emphasis (`**Risk**: none`, `Risk: **none**`, `` Risk: `none` ``), with or without a space after the colon; `risk: none`, `Risk: None`, a quote or heading prefix, and the phrase mid-sentence do not count. The record stores the repository root, and a record from another repository, or an old one without a root, is ignored. It fails open on a missing record, no repository, no commits, `stop_hook_active`, a missing final message, or any error. While a subagent of the session is open (see the review gate above), `check` stays silent and leaves the turn's record unspent, so it runs at the first `Stop` after the agents finish.

#### Publication gate and session baseline

```bash
odd-review validate --gate pre-push                 # exit 0 {"ok":true,"result":"ok","reason":…} or exit 1 review_required
odd-review validate --gate pre-pr --base-ref main   # the PR base branch
odd-review validate --gate release --tag v1.2.0     # the nearest earlier tag is the base
odd-review validate --gate pre-push --head-ref feat --base-ref origin/feat
```

- `validate --gate pre-push|pre-pr|release` fails with `review_required` (JSON on stderr: `gate`, `base`, `head`, `tree`, `target`, `risk`, `receipt`) when RDD is on and the committed range being published is review-due (`high` by `odd-assess`) without a sound receipt for its tree. A receipt is sound when its outcome is `approved`, its `candidate_tree` equals the published tree, and its transaction still reproduces its hashes (`receipt_check` `ok`); a `legacy` receipt (from before the hashes), a `mismatch`, or an unreadable transaction is reported as the receipt state and does not cover. A receipt that records a `base_commit` covers the range only when that base is the range start or an ancestor of it; a working-tree review (no `base_commit`) covers it only when its recorded `base_tree` equals the tree at the range start, so it never hides an unreviewed commit before the reviewed changes, and a receipt with neither covers nothing. It exits 0 with `reason` `rdd_off`, `not_due`, `empty`, `no_base`, `no_commits`, or `covered`. There is no `pre-commit` gate: Construct reviews committed work units. A bad `--base-ref` or `--head-ref` is a `bad_ref` refusal, and `--gate` must be one of the three names (exit 2 otherwise).
- Published range (assumptions): committed work only, `merge-base(base, head)..head`, so uncommitted changes are never part of it. The head is `HEAD` or `--head-ref`. The base is `--base-ref`; else for `pre-push` the upstream branch (`@{upstream}`, when the head is `HEAD`); else for `release` the nearest tag reachable from the head, skipping `--tag`; else the first default-branch ref that is not the head (`origin/HEAD`, `main`, `master`, `origin/main`, `origin/master`). With no base at all (for example pushing the default branch with no upstream) the gate allows with `no_base`. A sound receipt whose `candidate_commit` lies inside the range and whose `base_commit` is the current start or an ancestor of it moves the start up (repeated until nothing moves), so work units reviewed one by one are not judged again, while a review of only `A..B` never hides an unreviewed `A`; a receipt with no `base_commit` (a working-tree review) does not narrow; the rest of the range is then assessed and needs a receipt for the head tree.
- The `PreToolUse` hook on `Bash` (`hooks/scripts/publication-gate.mjs`) runs the gate for `git push`, `gh pr create`, and `gh release create`, including through `sh -c`/`bash -c`, `eval`, `$(...)`, backticks, wrappers (`sudo`, `env`, `timeout`, `nice`, `xargs`, ...), `git -C DIR`, and a preceding `cd DIR`, and denies with the gate's reason. Commands are found through the same unwrapping as `command-guard.mjs` (`sh -c [--] 'cmd'`, `env -S`/`--split-string`, `eval`, substitutions, wrappers). In `-C` and `cd` directories, `~`, `$HOME`, and `${HOME}` expand from `HOME`; any other directory with `$` or a backtick (`git -C "$REPO" push`, `cd "$(pwd)" && git push`) is denied with a reason asking for the path written literally, because the gate cannot know the repository. A literal directory that does not exist or is not a repository keeps the allow (git itself fails there). A dry run (`-n`, `--dry-run`), a branch deletion (`--delete`, `:ref`), and every other command are not gated. The hook maps the command onto the range: for `git push REMOTE SRC[:DST]` the head is `SRC` (unless `HEAD`) and the base is `refs/remotes/REMOTE/DST` when that ref exists; for `gh pr create --base B` the base is `origin/B` or the local `B`; for `gh release create TAG --target T` the head is `T` when it resolves. `git push --all`, `--mirror`, and `--tags` are judged as a push of `HEAD`, and only the first refspec of a multi-refspec push picks the base. A push source that contains `$` or a backtick, or does not resolve to a commit, is judged as `HEAD`, and a `bad_ref` answer from the CLI is retried for `HEAD`, so an unreadable ref never allows what `HEAD` would deny. Only `review_required` denies; the hook fails open on every other outcome: no repository, a usage or internal `odd-review` error, a timeout (25 seconds), or unreadable input means no output and exit 0.
- Session baseline: `review-gate.mjs baseline` runs on `SessionStart` (`startup`, `resume`, `clear`; not `compact`), records the identities of the review-due candidates that already exist under `${CLAUDE_PLUGIN_DATA}/review-gate/<session>.json` (`baseline`, next to the reminded `targets`), and prints nothing. The Stop gate stays silent for a candidate whose identity equals a recorded one, because this session did not produce it; any other candidate, including the same files after another change, still blocks once. A new baseline replaces the old one.

#### Review hooks: context in, results out

Two hooks move the hand-offs between the orchestrator and the lens agents into code. The orchestrator launches each lens with only the lineage id as its prompt (for example `Review lineage review-0123456789abcdef`).

- **`PreToolUse` on `Agent`** (`hooks/scripts/review-context.mjs`). For a `construct:review-*` agent (the four lenses, the refuter, and the validator) whose prompt names a lineage, it runs `odd-review context` for that agent and returns it as `updatedInput.prompt` with `permissionDecision: allow`. A review agent without a lineage, or one `odd-review` refuses (for example `lens_not_selected`), is denied with the reason. A prompt naming two or more distinct lineages is denied with a message to name exactly one (the same lineage repeated is fine). A new spawn of a lens overwrites that lens's pending record. A prompt that already starts with the `ODD_REVIEW_BINDING` line passes through. Other agents are untouched. The `allow` only skips the permission prompt: Claude Code still evaluates the user's deny and ask rules against the rewritten input, so a matching deny rule blocks the lens and a matching ask rule still prompts.
- **`SubagentStop` on `^construct:review-`** (`hooks/scripts/review-capture.mjs`). For an agent the first hook prepared, it pipes the agent's report to `capture`, `capture-refuter`, or `capture-validation`: `last_assistant_message`, or, when that has no text (a background agent reports through its `SubagentHandback` call), the handback message or last text read from `agent_transcript_path`. Only a surrounding code fence is removed; the JSON is never edited. A `malformed_result` or `invalid_result` refusal blocks the stop with the validator's message, at most twice; any other answer lets the agent stop. The orchestrator then reads `odd-review status`.

The lineage of each spawned agent is kept per session and agent type under `${CLAUDE_PLUGIN_DATA}/review-hooks/` (same fallback rules as the gate). Both hooks fail open on errors.

Store: `$(git rev-parse --git-common-dir)/odd-review/`, so nothing is written into the worktree and linked worktrees share it.

```
odd-review/transactions/<lineage>.json   # one per review; <lineage>.lock while a command writes it
odd-review/receipts/<target hex>.json    # written by acknowledge
```

Writes are a temporary file plus a rename. A second writer on a locked transaction is refused (`transaction_locked`); a lock left by a dead process (or an empty one older than 10 seconds) is reclaimed under a separate `<lock>.reclaim` lock, and only if it is still the very file (same inode and content) that was inspected as stale, so a live lock is never removed. A contender that cannot reclaim does not wait; it gets `transaction_locked`. No command changes the index, `HEAD`, or the working tree.

### Secret guard and destructive commands

A `PreToolUse` hook (`hooks/scripts/secret-guard.mjs`) denies tool calls that touch secrets. It replaces a `permissions.deny` list, which a plugin cannot set. It covers `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Grep`, `Glob`, and `Bash`, in the main session and in subagents, and holds under `bypassPermissions`.

Protected, anywhere in the tree (paths resolve against `cwd`; `~` and `$HOME` expand):

- `.env` and `.env.*`
- any `.ssh` or `.credentials` directory, `Library/Keychains`
- `.aws/credentials` and `.config/gh/hosts.yml`
- `*.pem` and `*.key` files
- any `secrets` directory
- `rm -rf` (any flag order or spelling, with or without `sudo`) aimed at `/`, `~`, `$HOME`, or `/*`

The same hook also applies two tiers to `Bash` commands (`hooks/scripts/command-guard.mjs`, a port of gentle-shell's destructive command guard). A hard deny names the rule and cannot be confirmed; the confirm tier returns `permissionDecision: "ask"`, so the user decides, and inside a subagent (the hook payload carries `agent_id`) it becomes a deny, because nothing can answer.

- **Deny:** `rm -r` of `/`, `/*`, `~`, `$HOME`, `.`, or `..`; `git reset --hard`; `git clean` with force and directories (`-fd`, `-fdx`, `-xdf`); `git push` with `--force`, `--force-with-lease`, or `-f`; `chmod -R 777`; `chown -R`; `npm publish`.
- **Confirm:** other `rm -r`; SQL `DROP`, `TRUNCATE`, or `DELETE` without `WHERE` fed to `psql`, `mysql`, `mariadb`, or `sqlite3`; `find -delete`; `git restore`; `git checkout -- <path>`; `git stash drop` and `clear`; `git push`; `git rebase`; `git branch -D`; `git clean -f` without directories.
- **Unwrapping:** `sh`/`bash`/`zsh -c`, `eval`, `find -exec`, `$(...)`, backticks, and the wrappers `sudo`, `env`, `xargs`, `timeout`, `nice`, `command`, and variable assignments are looked through, including their flags and values (`timeout -k 2 --foreground 5 cmd`, `nice -n 5 cmd`, `sudo -u me cmd`, `env -u NAME cmd`), the string of `env -S "cmd args"`, the command after `--` in `bash -c -- 'cmd'`, and a backslash-newline continuation, which is joined before the line is split. `npm publish` is found after flags that take a value (`npm --access public publish`). `git checkout .` and `git switch -f` stay allowed: upstream does not treat them as data loss either. Heredoc bodies and quoted arguments (`echo`, `printf`, `grep`, `rg`, `git commit -m`) are data, not commands, unless the heredoc feeds a shell or a SQL client.

The same hook also scopes writes (`hooks/scripts/write-scope.mjs`) for `Edit`, `Write`, `MultiEdit`, and `NotebookEdit`, after the secret check:

- **Main thread.** A write to a path inside the project's git repository and outside `odd/tasks/` is denied, with a reason that names `construct:odd-worker`: the parent orchestrates and delegates code. Paths outside the repository (scratchpad, memory, home config) and a working directory outside any repository are allowed. Relative paths resolve against `cwd`; `NotebookEdit` uses `notebook_path`.
- **Writers.** A call from `construct:odd-worker` or `construct:jd-fix-agent` (the payload carries `agent_id` and `agent_type`) is checked against the `## Allowed edit surfaces` of the writer's own prompt, read from `<session dir>/subagents/agent-<agent_id>.jsonl` (first user row) with the parser the admission hook uses. Where a write would really land decides: a symlink under `odd/tasks/` (a dangling one too, followed with `readlink`) or an `odd/tasks` that is itself a link is judged by its real target, so a link into `src/` is denied. A path outside every surface is denied; a glob entry covers what it matches and everything under it. A missing or unreadable transcript, or no section, allows the write. `Bash` writes are out of scope, and other subagents are unaffected.

Exception: `.env.example`, `.env.sample`, and `.env.template` are allowed, since they are committed templates. Matching ignores case (`.ENV`, `~/.SSH/id_rsa`), including for the templates.

How each tool is read:

- **Globs.** A `Glob` pattern and a `Grep` `glob` are treated as globs: each segment (with `*`, `?`, `[..]`, `{a,b}`) is tested against the protected names, so `*.env*`, `.e*`, `{a,.env}`, `*.pem`, and `**/.ss?/**` are denied while `*.ts` and `.env.example` pass. Wildcard-only segments (`*`, `**`) are not blocked. A `Grep` content `pattern` is never a path.
- **Search commands.** For `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack`, and `git grep`, the pattern is data (`rg ".env" src` is allowed); only the path arguments and glob flags (`-g`, `--include`) are checked.
- **`echo` and `printf`.** Their arguments are data (`echo .env >> .gitignore` is allowed). Only redirection targets and sources (`>`, `>>`, `<`, `&>`) are checked, so `echo x > .env` is denied.
- **Pipes.** The data words of an upstream `echo` or `printf` are checked as paths (or parsed as commands, when they contain spaces) when the next stage runs or reads them: `xargs` with any command, `sh`, `bash`, `zsh`, `source`, `.`, `eval`, and `while read`. `echo .env | xargs cat` and `echo "cat .env" | sh` are denied; `echo .env | wc -c` is allowed.
- **Path-valued flags and flag arity.** Pattern-file and ignore-file flags take a path that is checked: `grep -f`/`--file`, `rg -f`/`--file`/`--ignore-file`, `ag --path-to-ignore`, `git grep -f`. Which flags take a value is modeled per command: `rg -t`/`-T` take a type, GNU `grep -T` and `ag -t` do not, so `grep -T KEY .env` is denied.
- **Invalid globs.** A glob that does not compile (`[z-a]`) is matched permissively, with the broken bracket class standing for any characters, so it can only deny more and never allows because of the error.
- **`rev:path` tokens.** For a token such as `HEAD:.env`, the part after `:` is also checked.
- **Interpreter one-liners.** The `-c` argument of `python`/`python3` and the `-e` argument of `node`, `perl`, and `ruby` are scanned for quoted string literals that name a protected path; `bash -c` and `eval` strings are parsed as commands. Heredoc bodies are read as commands, so a heredoc that names a protected path is denied. To write a file or a commit message that names a protected path, use the Write tool (for a commit, write the message to a file and run `git commit -F <file>`).
- **Prose.** A quoted multi-word string given to another command is not checked. Each line of a multi-line command is also checked on its own, so quoted text that spans lines and names a protected path on any line (for example a heredoc body with an apostrophe followed by `cat .env`) is denied; use the Write tool for such text.

The denial says which rule matched and that the user can run the command manually. Unreadable hook input is allowed with a stderr note.

Known lexical limits: the guard reads the command text and cannot see through whole-directory searches such as `grep -rn KEY .`, symlinks, shell globs (`cat .e*`), variables, or obfuscation (`cat $(echo .e)nv`, encoded payloads).

### Delivery signals

Three deterministic checks that used to be prompt-only (ports of gentle-shell's `commit-slice-signal`, `context-backstop`, and `delivered-test-lint`).

- **Commit slice** (`hooks/scripts/delivery-signals.mjs`, `PostToolUse`, main thread and subagents). After a successful `git commit` on a branch other than the default branch (`origin/HEAD`, else `main` or `master`), the hook adds context with the authored changed lines from the merge base to `HEAD` (added plus deleted, renames counted by what changed; lock files such as `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, minified `.min.js`/`.min.css`, and generated golden files excluded) and the number of lines left before the ~400-line slice. Past 400 it asks you to apply the feature's delivery strategy before the next commit. Failed, interrupted, and background commands, text that only mentions `git commit`, and commits on the default branch add nothing. `git -C DIR` and a preceding `cd DIR` pick the repository.
- **Context backstop** (same hook, main thread only). When the latest assistant usage in the transcript (input, cache read, cache write, and output tokens) reaches 150,000 tokens, one notice asks you to delegate the next multi-step unit to `construct:odd-worker`. It fires once per crossing: a later reading below the threshold (after compaction) re-arms it. The hook reads only the last 256 KB of `transcript_path`. The hook payload and transcript give no context window and the model id does not reveal it, so the window is treated as unknown and the absolute cap applies (as in gentle-shell, where an unknown window leaves the cap alone). The notice is advice, not a gate.
- **Delivered-test lint** (`hooks/scripts/test-lint.mjs`, called from `secret-guard.mjs` after the write scope). A `Write`, `Edit`, or `MultiEdit` to a test path (`test/`, `tests/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`) is denied when the new text reads git history at a literal commit id (`git show|checkout|diff|cat-file|archive` followed by a 7-40 character hex id that mixes digits and letters) or assigns `TMPDIR` a path inside the working directory (`$PWD`, `process.cwd()`, `__dirname`, a relative path). A test must pass in any clone: build the previous behavior from a fixture and create scratch with `mktemp` outside the repository. Text written through `Bash` is not seen.

Both `PostToolUse` signals fail open (no output, exit 0).

### Mirror drift gate

The ODD feature documents (`odd/tasks/<f>.md`) are mirrored into engram so a later session can resume them. No hook enforced that; `hooks/scripts/mirror-drift.mjs` does, on `Stop`. It reuses the Risk line gate's per-turn record (`mark` on `UserPromptSubmit`): when an `odd/tasks/<f>.md` was added or changed since the turn began and the transcript, since the last real user prompt (a prompt row, not a tool result), holds no engram `mem_save` call (`mcp__engram__mem_save` or `mcp__plugin_engram_engram__mem_save`) whose `topic_key` is exactly `odd/<f>/tasks`, it blocks the stop once per turn. The reason names each unsaved document and its topic key; a document that was saved is not named. It stays silent while a subagent of the session is open (the first `Stop` after the agents finish runs the check), on `stop_hook_active`, with no mark record, and for changes outside `odd/tasks/*.md`. It reads only the last 512 KB of `transcript_path`; a turn longer than that has no prompt boundary in view and the gate stays silent. It fails open (no output, exit 0) on any error.

### Construct panel (mod)

The mod draws one thing: a docked **panel** (a `Pane` with id `construct`) laid out as [claude-flightdeck](https://github.com/scasella/claude-flightdeck) cards and adapted to the ODD flow: one column at any width, no header or legend, `round` bordered cards, the bold title on the left and the status on the right. The band above the prompt is not drawn. It needs Claude Code 2.1.304 or later and does not appear in `claude -p` runs, which draw no interface.

**Commands and opening.** `/construct` opens the panel and `/construct close` closes it. The panel opens at every session start; to turn that off, set the plugin option `panel_open_on_start` (boolean, default `true`) to `false`.

**Width.** The panel asks for 66 columns when it opens (`columns: 66` on `ui.open`). That is a request, not a guarantee: a width you drag or keep wins, and the layout reads the real width (never below 40). Rows that do not fit are clipped, and the changes card keeps only the file rows that fit the pane height.

**Colors.** All colors are theme keys, so the panel follows the active theme.

**The panel, top to bottom.** A card with nothing to show takes no room.

1. **main card** (always drawn, with or without a `statusLine`): `<Model>` (no suffix) and idle, busy, or `◆ blocked` (warning color) while Claude waits on you: a `tool.check` verdict of `ask` on a real call (the permission prompt), or a `tool.call` on `AskUserQuestion` or `ExitPlanMode` while it is open; the next settled `tool.call`, `turn.start` or `turn.complete` clears it, and the idle "waiting for your input" state never sets it (it is the one indicator, with no extra row; the mod's `classic.*` hooks are bypassed by a higher-tier module, so none is used); the current git branch (`⎇ <branch>`, hidden without one); the effort meter (`▮▯`), the permission mode (from the main thread's spawns), and the main request count; the context gauge with tokens used and window; the session cost; the 5-hour and 7-day gauges (`▰▱`) with the time to each reset (`↻3h10m`, `↻4d2h`), omitted when the figure is missing, for example off a subscription.
2. **rail**: a connector between cards, animated while the main thread is busy on terminals that can draw `Client` elements, a static line otherwise.
3. **ODD card** (only with an active feature): the feature (newest `odd/tasks/*.md` with an unfinished task, the rule of `feature-state.mjs`), the current task, one checkpoint per task (done filled, current highlighted) and the open count.
4. **REVIEW card** (only when RDD is on): the state `review due`, `reviewed` or `clear` (a `root` boundary is not assessed).
5. **GATE card**: a stacked bar of permission verdicts, allowed / asked (`you`, or `classifier` in `auto` mode) / pending / denied counts, `file`, `shell` and `other` bucket counts, the last denied tool with credential-like values masked, and the inline-write alert (a main-thread `Edit`, `Write`, `MultiEdit` or `NotebookEdit` outside `odd/tasks/`: the count and last path, error color). It only observes and never blocks.
6. **agents**: `agents · N running · M total`, one row per subagent (up to 6) with a status mark, its construct role (else the subagent type), a timeline bar placed on the session's time span and its duration; running clocks tick live where `Client` is available.
7. **last turn card**: duration of the running or last main-thread turn, agents, edits, errors and the cost added.
8. **changes card** (only with something to show): round card titled with the branch, `↑N` (commits to push) and `↓N` (commits to pull) on the right, each shown only when above 0. One row per changed file, biggest change first: the path (long paths keep their basename: `…/dir/name`) and `+added` / `-removed` lines (`bin` for a binary file). Changes are the working tree against `HEAD`, staged and unstaged; an untracked file shows `+lines` (counted for the first 20 untracked files) or `new` when it is a directory, past the first 20, or not countable. Rows fit the pane height; when some are cut the last row is `+N more`. The card is hidden when the repository is clean and in sync.

**Refresh and fail-open.** Git (status, `diff --numstat HEAD` and a line count per untracked file), `odd-review`, `odd-assess`, and the feature documents are read only on `session.start` and after each main-thread `turn.complete`, in the background with a timeout, never on a redraw. Context, cost and the plan limits are read from the session usage on each redraw. The panel's own state is kept in a versioned `atom` fed from engine events (`agent.spawn`, `turn.start`, `turn.step`, `tool.call`, `tool.check`, `turn.complete`, and `session.compact`); the panel redraws on those events, not per token. These hooks only observe: each passes its event on unchanged and swallows its own failures, and the model and effort routing is untouched. Any error leaves out the affected card and never blocks or delays a turn.

**Credit.** The drawing code (gauges, effort meter, timeline geometry, the animated rail and the elapsed clock) is adapted from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella, MIT License. The copyright and permission notice are in [`plugins/construct/LICENSE-flightdeck`](plugins/construct/LICENSE-flightdeck) and at the top of each adapted file.

### Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `construct`; allows the cross-marketplace `engram` dependency |
| `install.sh` | One-command installer (see [One command](#one-command)) |
| `plugins/construct/` | The plugin (manifest name `construct`) |
| `plugins/construct/agents/` | The 13 role agents |
| `plugins/construct/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, `debugging`, `constraint-driven`, ...) |
| `plugins/construct/hooks/` | `hooks.json`, the mod (`register.js`), its routing helpers, the status modules (`status/`), the panel modules (`panel/`), and the command hooks (`scripts/`: contract, feature state, secret guard (with `command-guard`, `write-scope`, `test-lint`, and the shared `shell-words` tokenizer), delivery signals, review gate and session baseline, publication gate, Risk line gate, mirror drift gate, subagent count, delegation admission, review context and capture) |
| `plugins/construct/bin/` | Executable scripts put on the `PATH` (`odd-assess`, `odd-review`) |
| `plugins/construct/lib/assess/` | `odd-assess` modules: git, stats, passive, signals, sinks, content, classify, escalation, output |
| `plugins/construct/lib/review/` | `odd-review` modules: the review lifecycle, its mode switch, and its store |
| `plugins/construct/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/construct/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/construct/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## Contributing

Setup, checks, and pull request rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Current version: 1.2.0 (`plugins/construct/.claude-plugin/plugin.json`); it adds the deterministic gentle parity: destructive-command tiers, delegation admission and write scope, the publication gate and review transaction limits, delivery signals, and the mirror drift gate. Releases are tagged `vX.Y.Z`.

Upgrading from 1.1.0:

- Receipts written before 1.2.0 no longer satisfy the publication gate; re-review before publishing.
- `rm -r` and `git push` now ask for confirmation on the main thread and are denied inside subagents.
- The main thread can no longer edit repository files outside `odd/tasks/`.

## License

Construct is released under the MIT License; see [`LICENSE`](LICENSE).

Part of the agents and skills are adapted from MIT-licensed material (Gentle AI and agent-skills); see [`plugins/construct/NOTICE`](plugins/construct/NOTICE).
