# Construct

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.304%2B-blue)](#requirements)
[![Plugin version](https://img.shields.io/badge/version-15.1.0-informational)](plugins/construct/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Construct is a Claude Code plugin that makes every request follow Agent Driven Development (ADD): authorize, explore, size, track, implement test-first, and close with evidence and a Risk line.

> **Preview.** Construct changes quickly, and usage feedback is the most useful contribution right now: [open an issue](https://github.com/carsimax/construct/issues/new/choose) before a pull request. Changes are in [CHANGELOG.md](CHANGELOG.md); vulnerabilities go through [SECURITY.md](SECURITY.md).

## ADD in 30 seconds

An agent writes code faster than you can check it. Organic Driven Development keeps each step small enough to check: the agent stays read-only until you ask for a change, sizes the task, tracks large work in a feature document (`.vault/tasks/<feature>.md`), writes a failing test before the fix, and ends with what it verified and a Risk line naming anything hard to undo or hard to detect. Risky work is reviewed by independent lens agents before hooks let it be pushed.

## What you get

- **ADD workflow.** A session contract, injected by hooks, that Claude follows on every request without being asked.
- **Role agents.** 11 agents (explorer, worker, oracle, verifier, judges, review lenses), each on its own model and effort.
- **Skills.** Procedures that load on demand: workflow (sizing included), delegation, debugging, quality bar, migrations, feature branch with local sub-branches, commits, and the final pull request (`delivery`), review, and more.
- **Mandatory review.** Work whose Risk names a high-risk item is reviewed by lens agents before it can be published. Hooks build the evidence, record the verdicts, and gate `git push`, `gh pr create`, and `gh release create`.
- **Status band.** One row above the prompt with the phase, the active feature with its checkpoints, and the running agents. It leaves the model, branch, context, and plan limits to your status line.

- **Memory.** Provided by [Engram](https://github.com/Gentleman-Programming/engram), which you install separately. See [Memory](#memory).

## Requirements

| Requirement | Why |
|---|---|
| Claude Code 2.1.304 or later, signed in | The status band is a mod, and the mod needs 2.1.304. Tested on 2.1.304 |
| Node.js 22.16 or later | The plugin's scripts and hooks. Claude Code's native install does not bundle Node.js |
| `git` on the PATH | The review and publication hooks read the repository |
| [Engram](https://github.com/Gentleman-Programming/engram) | The memory: recall and save through its `mem_*` tools |

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v15.1.0/install.sh | bash
```

The installer requires Engram: when the `engram` binary or the `engram@engram` plugin is missing, it stops and installs nothing, and prints `brew install gentleman-programming/tap/engram && engram setup claude-code`. It checks the other requirements above and stops before changing anything if one is missing, or if `~/.claude` or `~/.claude/settings.json` is not writable, or if `settings.json` is a directory. Then it runs the manual steps below for you:

- Adds the construct marketplace and installs `construct@construct`.
- Removes a `theme` of `custom:construct:construct` left by earlier versions from `~/.claude/settings.json` (any other theme is left alone). It adds no memory permission rules and leaves your existing rules alone. An empty `settings.json` counts as `{}`. Other keys stay as they are, a symlinked file is written through to its target with its mode kept, and the previous file is saved as `settings.json.bak-<timestamp>`; when there is nothing to change, the file is not touched.

If codegraph is installed, the installer says Construct no longer needs it and removes nothing. Every step is skipped when it is already done, so running the installer again changes nothing. It never changes other permissions or your permission mode.

| Option | Meaning |
|---|---|
| `--no-mcp` | Deprecated: has no effect and prints a warning. It is accepted so earlier install commands keep working, and will be removed in a later release |
| `--force` | Deprecated: has no effect and prints a warning. It is accepted for now so scripted installs keep working, and will be removed in a later release |

Pass options after `bash -s --`, for example `curl -fsSL <url> | bash -s -- --no-mcp`. To read the script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v15.1.0/install.sh -o install.sh
less install.sh
bash install.sh
```

### Manual install

The manual steps the installer runs, for when you want to run them yourself:

1. Add this marketplace and install the plugin:

   ```bash
   claude plugin marketplace add carsimax/construct
   claude plugin install construct@construct
   ```

2. Optional: inside Claude Code, in `/config`, set each role's model and effort (rows such as `Worker model`).

3. Check that it works. Open a session in any git repository:

   - Ask "what does your Construct contract say about Risk lines?". The answer quotes the `Risk: item N` rule.
   - `/agents` lists the `construct:` agents, such as `construct:worker` and `construct:review-risk`.
   - `/construct doctor` prints a setup report.

## First session

Open Claude Code in a git repository and make a request. Construct applies the same steps each time:

1. **Authorize.** Questions, reviews, and planning stay read-only. Files change only when you explicitly ask for a change.
2. **Explore.** Claude reads the existing code first, in proportion to the task.
3. **Size.** A task is small or large. Small work needs no feature document; its code still goes oracle first, then to one worker agent. Large work is tracked in `.vault/tasks/<feature>.md` (specs, tasks, log) before the first source write. An `S#` carrying `NEEDS CLARIFICATION: <question>` blocks its task from `done` (the publication gate denies it; at most 3 open per document), and finished `S#` are written to the living spec `.vault/specs/<feature>.md`.
4. **Implement test-first.** A worker writes a failing test, makes it pass, then refactors, inside the edit surfaces it was given.
5. **Close with evidence.** One report: what was verified, what failed or was skipped, the next step, and a Risk line (`Risk: none` or `Risk: item N (reason)`).

Commit, push, pull request, and merge stay your decisions. A change whose task in the feature document has a Risk column naming a high-risk item is reviewed before it can be published; see [Mandatory review](#mandatory-review-and-the-publication-gate). There is no switch to turn the review off.

To confirm the install works, see step 3 of [Manual install](#manual-install).

## Update

Construct updates through Claude Code's plugin commands. Running `install.sh` again does not update them: it skips every step that is already done.

```bash
claude plugin marketplace update construct     # fetch the latest catalog from carsimax/construct
claude plugin update construct@construct       # install the new version
```

Restart Claude Code afterwards; a plugin update applies to new sessions. `claude plugin list` shows the installed version.

Installers before 12.0.2 pinned the marketplace to a release tag (`claude plugin marketplace list` shows `carsimax/construct#vX.Y.Z`), and `marketplace update` does not move a pin. Replace the pinned marketplace once; the commands above work from then on:

```bash
claude plugin marketplace remove construct
claude plugin marketplace add carsimax/construct
claude plugin install construct@construct
```

## Configuration

Construct has no `/config` options and no session limits. The only autonomy limits are the ones each code task's oracle declares (see [The oracle envelope](#the-oracle-envelope)).

### The oracle envelope

Every code task goes oracle first. `construct:oracle` writes the failing acceptance tests (locked by content hash) and ends its reply with an `## Envelope` section; `oracle-record.mjs` stores it with the lock, keyed by feature and task, and a worker cannot change it:

```
## Envelope
- Command: <shell command that runs the oracle tests>
- Surfaces:
  - <the worker's allowed edit surfaces, one path or narrow glob per line>
- Attempts: <n>
- Minutes: <n>
- Lines: <n>
```

Each budget is clamped to a fixed ceiling in code and a missing one takes the default:

| Budget | Default | Ceiling |
|---|---|---|
| Attempts | `5` | `10` |
| Minutes | `30` | `60` |
| Lines (changed) | `400` | `1500` |

What is enforced (hooks fail open on internal errors, and the checks are a discipline layer inside Claude Code, not a security boundary):

- **The main thread writes only `.vault/` and docs** (a `*.md` file outside `plugins/construct/hooks/contract/`, `skills/`, and `agents/`, which are behavior). `surface-guard` denies every other write, whatever its size, naming `construct:oracle` then `construct:worker`.
- **A code worker needs its task's envelope.** `delegation-admission` denies a `construct:worker` launch whose surfaces include code when its `Spec:` task has no envelope, or whose surfaces are not inside the envelope's. A worker whose surfaces are only docs and `.vault/` needs none.
- **The oracle decides when the worker stops.** At a worker's stop, `oracle-stop.mjs` runs the envelope command (bounded by the remaining minutes, at most 300 seconds). Green allows the stop. Red with budget left blocks it with the failing output, so the worker keeps going. A spent budget allows the stop, `surface-guard` denies that worker's writes, and the orchestrator reports the failure to you.
- **Attempts count progress.** An attempt is one failed oracle run (at a stop, or of the command itself in Bash); a run whose passing-test count rises above the best so far spends none. The budget is per task and shared by its workers; minutes count from the first worker start of the task.
- **The envelope covers Bash writes.** At the stop, the diff since the task started must stay inside the envelope surfaces and its changed-line budget, whatever tool wrote it, or the stop is blocked naming the paths and counts. The diff is of the whole working tree, so a concurrent writer counts against the worker.

**Untestable paths by allowlist.** A `.vault/exempt-paths` file lists lines `<glob> -- <command>` (`#` starts a comment). It is read only from the default branch, so adding an entry needs a merged change. When every non-free surface of a worker's task matches an entry, `delegation-admission` writes the envelope itself (default budget, the matching commands joined with ` && `, `source: allowlist`): no oracle and no `Exempt` menu. A malformed line denies the launch naming the file and line.

**Other code with no deterministic test** (an installer, `hooks.json`, a UI layout) needs your approval: the orchestrator asks with a question that names the task and its exact arguments in backticks, with the options `Exempt` and `Keep the oracle`. On `Exempt` it runs `construct-gate oracle exempt <feature-doc> <T#> -- <surface>...` once from the main thread; that records an envelope with the default budget and no test command. `command-guard` denies the command to a subagent and without that approval, and the command refuses a task that already has an envelope.

### Agents

The plugin ships 11 agents. Their model and effort are not configurable: each runs on its own frontmatter.

| Role | Agent | Model | Effort |
|---|---|---|---|
| Explorer | `construct:explorer` | haiku | medium |
| Worker | `construct:worker` | sonnet | medium |
| Oracle | `construct:oracle` | opus | medium |
| Verifier | `construct:verifier` | opus | medium |
| Judge A | `construct:judge-a` | opus | medium |
| Judge B | `construct:judge-b` | sonnet | medium |
| Review risk | `construct:review-risk` | opus | medium |
| Review readability | `construct:review-readability` | sonnet | medium |
| Review reliability | `construct:review-reliability` | sonnet | medium |
| Review resilience | `construct:review-resilience` | sonnet | medium |
| General | `construct:general` and the built-in `general-purpose` | sonnet | medium |

How it works:

- The mod (`hooks/register.js`) sets no model and no effort for a construct agent. It sends a built-in `general-purpose` launch on `sonnet` with effort `medium`; a model passed explicitly on the Agent call wins.
- Turn budgets: `construct:explorer` stops after 30 turns, `construct:verifier` after 50, and each lens after 2. A capped agent returns its output marked partial, and it can be resumed.
- The `delegation`, `review`, and `workflow` skills are model-only (`user-invocable: false`): the orchestrator loads them, and they do not appear in the `/` menu. Ask for a review in plain words.
- Saved per-role model and effort options from earlier versions have no effect.

## Reference

Deep material for people who want to know how each part works.

### How the ADD contract loads

A plugin cannot ship a `CLAUDE.md`, so Construct loads its rules in layers:

| Layer | Mechanism | Content |
|---|---|---|
| Session contract | `SessionStart` hook (startup, resume, clear, compact) | ADD protocol, task size, high-risk list, Risk line, and delegation triggers, under 8,000 characters |
| Subagent contract | `SubagentStart` hook | Artifact language, edit surfaces, scratch, and the `## Key Learnings` closing block. JSON-only reviewers (`review-*`, `judge-*`) get nothing |
| Skills | Loaded on demand | `workflow`, `delegation`, `review`, `delivery`, `debugging`, `constraints`, `sources`, `migration` |

The contract texts live in `plugins/construct/hooks/contract/`.

After a compaction or a resume, a second `SessionStart` hook (matcher `compact|resume`) re-injects the active feature state. It reads `.vault/tasks/*.md` under the project root and, for up to three documents with unfinished tasks (newest first), emits the path, title, branch line, unfinished task rows, and the last `Next step:` from the log, in at most 2,500 characters. It also lists open `NEEDS CLARIFICATION` questions (warning past 3 per document), warns on an `S#` without a quote found in the Log or an `Assumption`, and warns when a finished document has no `.vault/specs/<feature>.md`. It is read-only and prints nothing when no document is active. Task-to-document sync hooks were dropped: native tasks have no link to the document's `T#` rows, so a hook could corrupt the feature document. The orchestrator keeps the document current, and the re-injection tells it where it was.

### Delegation admission

A `PreToolUse` hook on `Agent` (`hooks/scripts/delegation-admission.mjs`) denies a malformed launch, with a reason that names what is missing and the expected form. It runs next to the review-context hook; an admitted launch prints nothing, so the two never conflict. Other agents are untouched.

- **Writers** (`construct:worker`, `construct:oracle`) need a `## Allowed edit surfaces` section with at least one entry per line. An entry that is absolute, starts with `~` or a drive letter, contains `..`, or starts with a glob (a bare `*` or `**` included) is denied, as is prose inside the section; a path with whitespace goes in backticks, and repeated sections must agree.
- **Spec line.** When an unfinished feature document exists (the same rule the compact/resume re-injection uses), a writer prompt also needs a line `Spec: .vault/tasks/<feature>.md, T<n>` naming an existing regular file under `.vault/tasks/` (a symlink does not count). Without such a document, small work needs no `Spec:` line.
- **Overlap.** A writer whose surfaces overlap those of a writer still open is denied. A glob entry covers what it matches and everything under it; entries are compared segment by segment, and two different literal segments never overlap whatever follows. Parentheses are literal (Next.js route groups such as `(dashboard)`). A segment with brackets, a backslash, or nested or unbalanced braces may match anything at its own position only, while `**` and an extglob (`@(`, `!(`, `+(`, `*(`, `?(`) overlap everything from their segment on. The hook records each admitted writer (its surfaces and a hash of its prompt) under `${CLAUDE_PLUGIN_DATA}/delegation-admission/<session>/` (same fallback as the gates), and a `SubagentStop` hook (`delegation-admission.mjs stop`) removes the record whose prompt hash matches the first user row of `agent_transcript_path`. A record older than one hour counts as a crashed writer and is dropped. The check and the record run under an `mkdir` lock beside the records (`<session>.lock`, a lock older than 10 seconds is broken, a wait over 3 seconds fails open), so two launches in the same parallel batch cannot both pass.
- **Prefix.** `worker` and `verifier` are admitted the same with or without the `construct:` prefix.
- **Verifier** (`construct:verifier`) needs a line `Risk: item N` (N 1-6). `Risk: none` does not admit a verifier.
- **Workflows.** A workflow's `agent()` calls never reach the `Agent` hook, so the same script also runs on `PreToolUse` for `Workflow` and admits a script only when every `agent()` call names a literal `agentType` that cannot edit files: `construct:explorer`, the `construct:review-*` lenses, `construct:judge-a`, `construct:judge-b` (prefix optional), `Explore`, or `Plan`. A call with no `agentType` (the default workflow agent can write), a writing or unknown type, a non-literal, computed, quoted, or spread `agentType` (every `agentType` key counts), `agent` passed, aliased, or destructured, any reference to the global object (`globalThis`, `this`, `self`, `window`, `global`), an escape outside a string, `eval`, `Function`, any `constructor` reference, and a `/` right after `}` (put such a regex in a variable) are denied. The script is read from `script`, from `scriptPath` (relative to the cwd; unreadable is denied), or, for `name`, from a saved workflow in `.claude/workflows/` of the project or of the home directory; a bundled workflow name and a bare `resumeFromRunId` pass. Writes go through `construct:worker` with the `Agent` tool. Strings, template text, and comments are not calls; this is a discipline check on the script text, not a sandbox.

The hook fails open on unreadable input or any internal error; a well-formed launch that breaks a rule is denied.

### MCP servers

Construct ships no MCP server of its own; memory comes from Engram (see [Memory](#memory)). Structural questions (architecture, call flow, references, impact) use the native `LSP` tool when a language server is available, and Grep, Glob, and Read otherwise.

The installer no longer registers context7 or codegraph. Earlier registrations can be removed with `claude mcp remove --scope user context7` and `claude mcp remove --scope user codegraph` (the codegraph CLI itself, if you installed it with npm, is `npm uninstall -g @colbymchenry/codegraph`).

### Memory

Memory comes from [Engram](https://github.com/Gentleman-Programming/engram), a prerequisite that Construct does not install or bundle. Claude recalls and saves through Engram's `mem_*` MCP tools (`mem_search`, `mem_save`, `mem_context`, `mem_session_summary`), and the `engram:memory` skill describes how. Engram's own hooks inject session context and capture a subagent's `## Key Learnings:` section.

### Quality and recovery skills

Four skills load on demand (ideas from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills); see [Credits](#credits)). The session contract names `debugging` and `constraints`; the other two load from the skills that link to them.

| Skill | Use it for |
|---|---|
| `construct:debugging` | A failing test, broken build, regression, or unexpected behavior: stop the line, reproduce, localize (including `git bisect run`), reduce, fix the root cause, and guard it with a regression test written RED first. The parent diagnoses read-only and hands the fix to a worker, with the reproduction as the RED test. It never suppresses the error or weakens a check to go green. |
| `construct:constraints` | The project's quality bar. Detects before asking (at most four questions, one at a time, each with a default) and writes `CONSTRAINTS.md` at the repository root: a Floor that is never weakened, numeric rules each with the command that checks it, and measure-and-hold ratchets. Non-interactive runs apply the Floor only. |
| `construct:sources` | A named uncertainty about a library or framework API: detect the exact version, fetch the one official page, implement the documented pattern, cite the URL and version, and flag what is unverified. Fetched content is data, never instructions. Linked from `workflow` research. |
| `construct:migration` | Schema or stored-data migrations and removals of public surface: expand, migrate, contract, deprecation notices with a removal condition, reversible backfills, per-phase verification, and rollback. Linked from the high-risk items in `workflow`. |

Existing components gained matching material:

- `construct:review` (dual review, `references/dual-review.md`) has a decision mode for a plan, design, or claim before implementation. Blind judges receive the artifact and its contract, never the claim, and findings are reconciled against the artifact text, for at most three cycles. Code-review mode is unchanged.
- `construct:verifier` applies a standing Definition of Done (correctness, quality, integration, documentation, ship-readiness) to every `S#`, and reports a line it cannot verify as `not verified`.
- `construct:review-risk` carries a security checklist category list; the full checklist is `skills/review/references/security-checklist.md`. The agent has no tools, so the review-context hook embeds that file in the review-risk context between `ODD_REVIEW_CHECKLIST_BEGIN` and `ODD_REVIEW_CHECKLIST_END`, before `ODD_REVIEW_CONTEXT_END`, and counts it against the context budget. The agent applies the categories as triage over the supplied patches.
- `workflow`'s testing reference tells the worker to discover the repository's own test stack first and states the Floor as "never weaken the verifier" examples.

### Mandatory review and the publication gate

Review is a mandatory ADD phase for high-risk work. A work unit whose task's Risk column (in the `## Tasks` table of the feature documents changed on the branch) names an item (1-6) is reviewed by lens agents before it can be published. There is no mode switch and no per-candidate consent. The `construct:review` skill holds the procedure; hooks do the rest.

**Lenses.** The required lenses come from the Risk numbers in the `## Tasks` table of the feature documents changed on the branch (`LENSES_BY_RISK` in `hooks/scripts/review-lenses.mjs`):

| Risk item | Lenses |
|---|---|
| 1 | `review-risk`, `review-resilience` |
| 2 | `review-risk` |
| 3 | `review-reliability` |
| 4 | `review-reliability`, `review-resilience` |
| 5 | `review-risk`, `review-resilience` |
| 6 | `review-reliability` |

`review-readability` is optional and never gates publication.

**Launching a lens.** The orchestrator launches each lens as `construct:review-<lens>` with one prompt line, `Review subject: <base>`. The base is normally the merge-base with the default branch; the head is a snapshot of the working tree (tracked and untracked files that are not ignored), so no commit is needed before review. Verdicts key on trees: a later commit with exactly the reviewed content keeps the approval, and any other content needs a new review. A branch whose context exceeds the limit is denied: split the delivery into smaller pull requests.

- **`PreToolUse` on `Agent`** (`hooks/scripts/review-context.mjs`). For a `construct:review-*` agent it resolves the subject, builds the context (binding, name-status, numstat, and the diff, with deleted paths listed but their removed content omitted; the security checklist for `review-risk`), replaces the prompt with it, and records the pending lens. A prompt with no readable subject, an unresolvable ref, an empty diff, or a context over 400 KiB is denied with the expected form.
- **`SubagentStop` on `^construct:review-`** (`hooks/scripts/review-capture.mjs`). It takes the lens report from `last_assistant_message` (the transcript for a background agent), validates it against the lens result shape (`subject_hash`, `inspection`, `findings`, `evidence`), and writes one verdict per lens. An invalid report goes back to the agent with the reason, at most twice; a reply whose `subject_hash` matches no pending record retries against its own session's single pending record of that lens, and otherwise touches nothing. Records older than 30 days are pruned.
- **Verdicts.** Approved means a completed inspection and no BLOCKER or CRITICAL finding. A rejection stands for that lens and tree: fix with a new commit and review again. The orchestrator never writes or pastes evidence or verdicts.

**One Bash hook.** The `PreToolUse` entry on `Bash` runs one process, `hooks/scripts/bash-guard.mjs`, that parses the command once and applies the review-store guard, the command guard, and the publication gate in that order, printing the first denial; the three scripts stay runnable alone with the same denial texts.

**Store.** `$(git rev-parse --git-common-dir)/construct-review/`, shared by linked worktrees, with `pending/<lens>.<subject>.json` and `verdicts/<subject>/<lens>.json`. A `PreToolUse` hook (`hooks/scripts/review-store-guard.mjs`) denies Write, Edit, and Bash commands that name the store. The same guard denies a Bash command naming `review-capture` or `review-context` (quotes, backslashes, and brackets removed first). The guard is a heuristic: an indirect path to the store or an interpreter is not caught.

**Publication gate.** The `PreToolUse` hook on `Bash` (`hooks/scripts/publication-gate.mjs`) denies `git push`, `gh pr create`, and `gh release create` (also through `sh -c`, `eval`, `$(...)`, backticks, wrappers, heredocs, and the `gh pr new` and `gh release new` aliases) until the required lenses approve the published ref. It judges every ref being published (push sources, `gh pr create --head`, `gh release create --target`, the default branch when none; `HEAD` when none is named). It finds the feature documents changed from the merge-base with the default branch, reads every Risk number at the ref and at the merge-base, and requires each required lens to approve one subject from the merge-base tree to the ref tree. The default branch itself with no remote-tracking default to compare with is denied. A risk floor adds items from the published diff paths even with no feature document (migrations and `*.sql` 1; auth, secret, and `.env*` paths 2; lockfiles, CI workflows, `Dockerfile`, and `install.sh` 5), plus the `<glob> <items>` lines of `.vault/risk-paths/` read at the merge-base and the default branch tip, and the denial names the matched paths. A Risk cell that is neither `none` nor readable denies, and so does an unreadable `.vault/risk-paths/` line, and so does any internal error. The denial names the missing lenses and the `construct:review` skill. The hook entry sets `onFailure: "block"`.

**What each layer guarantees.** The `PreToolUse` gate is an early discipline check inside Claude Code sessions, not a security boundary: pushes from other hosts, other tools, and indirect commands are not seen. `construct-gate install` adds a git `pre-push` hook (`hooks/scripts/pre-push.mjs`) that judges every push from that clone with the same verdict, from any host. It is also a discipline layer, not a hard boundary: `git push --no-verify` skips it, the same user can redirect it (`CLAUDE_CONFIG_DIR`, `HOME`, or a planted plugin cache version), it allows with a warning when the plugin is gone, and it needs `node` on PATH (without it the push is denied and the message names `construct-gate uninstall` and `--no-verify`). When no default branch resolves, a pushed commit with no `.vault/tasks/` document is allowed (nothing can be compared); with documents it is denied, and so is a ref with no history in common with the default branch. Risk cells are classified by the agent itself, so a wrong `none` is not caught. CI cannot check reviews: verdicts stay in the clone's local store.

```bash
construct-gate install     # write the pre-push hook into the repository's hooks directory
construct-gate uninstall   # remove it (only Construct's own hook)
construct-gate status      # installed or not, and the resolved script path
construct-gate oracle list            # locked oracles: path, feature, task, active or released, matches or differs from the recorded blob; a corrupt record is listed by file name
construct-gate oracle unlock <path>   # remove that path's lock (you can run it with !; command-guard denies it to agents unless the user just answered `Unlock` to an AskUserQuestion naming the path in backticks and the unlock is the whole command; the CLI refuses a path with a symlink)
```

The installer is opt-in and never runs on its own. It writes to the effective hooks directory (`core.hooksPath` is honored) and refuses to overwrite a hook that is not Construct's. The hook uses the newest installed Construct version; if the plugin is gone it warns on stderr and allows the push. Like the gate, it denies on any internal error. `construct-gate` is on the Bash tool's PATH inside Claude Code sessions; from another terminal run it by path, for example `node ~/.claude/plugins/cache/construct/construct/<version>/bin/construct-gate install`. Lens verdicts are recorded only by Construct's hooks in a Claude Code session, so with the hook installed, review there before pushing from any host.

**Locked oracles.** While a lock is active (its feature document still has unfinished tasks on the remote-tracking default branch), `surface-guard` denies Write, Edit, MultiEdit, and NotebookEdit of a locked oracle to every agent and to the main thread, `delegation-admission` denies a writer whose surfaces cover one and an oracle launched over one, and `command-guard` denies `construct-gate oracle unlock` to every subagent and to the main thread unless the user's latest AskUserQuestion answer, recorded in the review store by a PostToolUse hook for a call a PreToolUse hook saw without pre-filled `answers`, chose `Unlock` (or `Unlock (Recommended)`) for a question naming that path in backticks (one unlock per answer; one live approval at a time; the unlock must be the whole command, one plain `construct-gate oracle unlock <path>` on an existing regular file with no symlink under the root; no record denies), and denies commands that write `refs/remotes/` locally (`git update-ref`, `git symbolic-ref`, `git remote set-head`, a `git fetch` refspec into it), as a discipline layer. Local edit stops trust the local remote-tracking ref; the publication gate verifies it against the remote URL recorded in the lock (one `git ls-remote`) before releasing a lock, and keeps the lock when the remote is unreachable, differs, or no URL was recorded. A new oracle run replaces a released lock. A symlink or directory surface is locked with a marker the gate always reports as changed (unlock it with `construct-gate oracle unlock`), and a corrupt lock record is skipped by the gate and shown by `oracle list`.

**Command and surface guards.** Two more guards fail open. `command-guard.mjs` (run by `bash-guard.mjs` on `Bash`) denies commands that bypass the verifier (such as `git commit --no-verify` or `git config core.hooksPath <value>`) and commands nested past the parser depth cap, and never asks. `surface-guard.mjs` on `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` keeps a writer inside its allowed edit surfaces, never lets a subagent write the plugin data directory, lets the main thread write only `.vault/` and docs, and denies every write of a worker whose oracle budget is spent (see [The oracle envelope](#the-oracle-envelope)). The Risk-line gate (`risk-line.mjs`) compares a fingerprint of `git status --porcelain=v1 -z --untracked-files=all` plus the size and mtime of each listed path between the start of the turn and its stop, instead of hashing the whole tree; a rewrite to the same size with a restored mtime of a path already dirty at the start is missed. It also blocks a turn that adds skipped, focused, or stub test markers.

An approval never authorizes delivery. Commit, push, pull request, and merge stay your decisions.

### Skill state

`workflow`, `review`, and `delivery` open with a `## Current state` line that Claude Code runs when the skill loads (`hooks/scripts/skill-context.mjs <workflow|review|delivery>`): `workflow` shows the unfinished tasks of `.vault/tasks/*.md` first, then `git status --short` (at most 12 lines, with a count of the rest; read without taking the index lock); `review` shows the lenses the Risk cells of the feature documents changed on the branch require (`LENSES_BY_RISK`) and which of them approved HEAD; `delivery` shows the feature branch, the current sub-branch, and the local sub-branches merged or unmerged into it. The script is read-only (it never writes the review store), prints at most 1,500 characters, and always exits 0: any failure (not a repository, no default branch, unknown kind) prints one `(state unavailable: <reason>)` line, because a non-zero exit would abort the skill.

### Construct band (mod)

The mod draws one thing: a **band** above the prompt (the `AbovePrompt` render site), one row, shaped to the ADD flow. It shows only what Construct knows; the model, effort, branch, diff, context, and plan limits belong to your status line and are not repeated. It needs Claude Code 2.1.304 or later, draws in the terminal and the Desktop app, and does not appear in `claude -p` runs, which draw no interface.

**The row.** The status, the active feature, and the running agents, separated by ` · `, each present only when it has content:

- **Status**: `○ ready` when idle; `● building`, `● mapping`, `● verifying`, `● reviewing`, or `● working` while a turn runs (named by the ADD phase of the running agents; plain `● busy` with none running); `◆ waiting on you` (warning color) while Claude waits on you: a `tool.check` verdict of `ask` on a real call (the permission prompt), or a `tool.call` on `AskUserQuestion` or `ExitPlanMode` while it is open. The next settled `tool.call`, `turn.start`, or `turn.complete` clears it.
- **Feature** (only with one): `ADD <feature>` (the newest `.vault/tasks/*.md` with an unfinished task, the rule of `feature-state.mjs`), and one checkpoint per task (done filled, current highlighted, the latest kept behind `…` when there are many). The current task's id and title are not drawn.
- **Agents** (only while subagents run): with one, its glyph by role, short name, and elapsed time (`⚒ worker 1:42`; glyphs `⌕` explorer, `⚒` worker, `⊨` verifier, `⚖` judge, `◎` review lens, and `•` for a subagent type with no construct role); with several, their count and the oldest one's elapsed time (`N agents 1:42`). The routed models are not drawn. Elapsed time is static text.

**Width.** The band draws to the width Claude Code gives it. The plugin version (`v` and the number, dim) sits at the right edge of the row; it is the first part dropped when the row does not fit, and it never shows on an empty band. When the rest does not fit it is clipped with `…`. With nothing to show (idle, no open feature, no agents) the band draws nothing. Other mods share the band: what they draw stays below Construct's row. You can collapse the band with Ctrl+X Ctrl+A; the mod cannot tell, so it is never the only place something that needs your answer appears.

**Colors.** The text colors are theme keys, so they follow the active theme.

**Command.** `/construct doctor` (or plain `/construct`) prints a setup report headed with the plugin version (`Construct doctor v<version>`), then one line per check, `✓ label` or `✗ label — hint`, for Claude Code 2.1.304 or later and Node 22.16 or later. The checks run in parallel with a 3 s timeout each, and a failed check shows as `✗` and never throws. The installer checks Engram, so the doctor does not.

**Refresh and fail-open.** The project root (`git rev-parse --show-toplevel`) and the feature documents are read only on `session.start` and after each main-thread `turn.complete`, in the background with a timeout, never on a redraw. Nothing is animated: elapsed times are computed at each redraw, which happens on the events below, not on a timer. The band's state is kept in a versioned `atom` fed from engine events (`agent.spawn`, `turn.start`, `tool.call`, `tool.check`, and `turn.complete`); the band redraws on those events, not per token. These hooks only observe: each passes its event on unchanged and swallows its own failures, and the model and effort routing is untouched. Any error leaves out the affected segment and never blocks or delays a turn.

**Credit.** The band code is Construct's own; it replaces a docked panel whose card idea came from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) (see [Credits](#credits)).

### Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `construct` |
| `install.sh` | One-command installer (see [One command](#one-command)) |
| `plugins/construct/` | The plugin (manifest name `construct`) |
| `plugins/construct/agents/` | The 11 role agents |
| `plugins/construct/skills/` | Delivery and review skills (`delivery`, `review`, `debugging`, `constraints`, ...) |
| `plugins/construct/hooks/` | `hooks.json`, the mod (`register.js`), its routing helpers, the status modules (`status/`), the band modules (`band/`), and the command hooks (`scripts/`: contract, feature state, the `shell-words` command reader over the vendored mvdan-sh parser (`hooks/vendor/`), oracle envelope and stop, publication gate, review store guard, command and surface guards, Risk line gate, subagent count, delegation admission, review context and capture) |
| `plugins/construct/bin/construct-gate` | Installs, removes, or reports the git pre-push hook (`hooks/scripts/pre-push.mjs`); `oracle list`, `oracle unlock <path>`, and `oracle exempt <feature-doc> <T#> -- <surface>...` (see [The oracle envelope](#the-oracle-envelope)) |
| `plugins/construct/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/construct/evals/` | Behavior eval cases run by `claude plugin eval` (`scripts/eval.sh` also writes `summary.json` with ritual and outcome pass rates, cost, duration, and turns, and keeps the run dirs under /private/tmp; `scripts/probe-review.sh` is the live check for the review behavior; `scripts/eval.sh` leaves the `review-fires` case out because the eval sandbox cannot run git (the macOS `xcrun` shim cannot write its cache) or the review skill's context command (denied in don't-ask mode); recorded results are in [docs/evals/results.md](docs/evals/results.md)) |
| `plugins/construct/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `.vault/tasks/` | ADD feature documents (specs, tasks, log) |
| `.vault/specs/` | Living spec: `README.md` (purpose, `Started:`) and one `<feature>.md` per finished feature with its `S#` |
| `.vault/risk-paths/` | Rule files (`<glob> <items>` lines, all files combined) |

## Contributing

Feedback and bug reports go in [issues](https://github.com/carsimax/construct/issues/new/choose). Setup, checks, and pull request rules are in [CONTRIBUTING.md](CONTRIBUTING.md); vulnerabilities are reported privately as described in [SECURITY.md](SECURITY.md).

## Upgrading to the oracle envelope

The fixed autonomy limits are gone: the inline edit limit (150, ceiling 500), the iteration cap (3, ceiling 10), the five-failure strategy note, the 150k-token context note, and the `construct-limits` command with its recording hook. Every code task now goes oracle first and the oracle's envelope sets the limits (see [The oracle envelope](#the-oracle-envelope)); the main thread writes only `.vault/` and docs. Safety guards (publication gate, `--no-verify` and hooks-path denies, review store, oracle locks, plugin data directory) are unchanged. See [CHANGELOG.md](CHANGELOG.md).

## Upgrading to 7.0

`command-guard` no longer asks before destructive commands by default, so a fully agentic flow is not interrupted. The opt-in that kept the 6.x confirmations was removed later, and `command-guard` never asks; denies (verifier bypasses such as `--no-verify`) always apply.

## Upgrading to 6.0

Agents, skills, and options get Construct-native names; behavior stays or gets stricter.

Agents (the `construct:` prefix stays; the `review-*` lenses keep their names):

| 5.x | 6.0 |
|---|---|
| `odd-worker` | `worker` |
| `odd-explorer` | `explorer` |
| `odd-verify` | `verifier` |
| `odd-general` | `general` |
| `jd-judge-a`, `jd-judge-b` | `judge-a`, `judge-b` |
| `jd-fix-agent` | removed: dual-review fixes go to `construct:worker` |

Skills:

| 5.x | 6.0 |
|---|---|
| `odd-workflow`, `task-size-risk` | `workflow` |
| `odd-delegation`, `lossless-prompts` | `delegation` |
| `rdd-review`, `judgment-day` | `review` (dual review is in `references/dual-review.md`) |
| `branch-pr`, `chained-pr`, `work-unit-commits` | `delivery` |
| `constraint-driven` | `constraints` |
| `source-driven` | `sources` |
| `memory`, `debugging`, `migration` | unchanged |
| `go-testing`, `comment-writer`, `cognitive-doc-design`, `skill-creator`, `skill-improver` | removed |

Options: the 5.x per-role model and effort options were replaced by per-role options in 6.x, and those are removed (see CHANGELOG.md). The `jd_fix_agent` options are gone.

Risk line: one reply can name several items, `Risk: items 2, 5 (reason)`; the Risk-line gate and the verifier admission both accept it. `Risk: item N` and `Risk: none` are unchanged, and a trailing comma or an item outside 1-6 is still rejected.

## Status

Current version: 15.1.0 (`plugins/construct/.claude-plugin/plugin.json`); a minor release. Releases are tagged `vX.Y.Z`.

Changes in 15.1.0: lens review needs no commit, `.vault/exempt-paths` lets listed paths skip the oracle, one Bash hook applies the three Bash guards, and the oracle flow no longer stalls on one-line fixes or spec/test contradictions. See [CHANGELOG.md](CHANGELOG.md).

Changes in 11.0.0: the `Principal Engineer` output style is removed; your own output style and CLAUDE.md govern replies, and if you had picked `construct:Principal Engineer` in `/output-style`, pick another. See [CHANGELOG.md](CHANGELOG.md).

Changes in 10.0.0: the docked panel is replaced by a status band above the prompt that leaves the model, branch, context, and plan limits to your status line; `panel_open_on_start` and `/construct close` are removed, and `/construct doctor` no longer checks Engram. See [CHANGELOG.md](CHANGELOG.md).

Changes in 9.0.0: the built-in `construct-memory` CLI and `memory` MCP server are removed; [Engram](https://github.com/Gentleman-Programming/engram) is required and the installer stops without it. See [CHANGELOG.md](CHANGELOG.md).

Changes in 8.7.0:

- New option `slice_lines` (default `1500`, was a fixed 400): the commit-slice budget of authored changed lines.

Earlier 8.x releases are in [CHANGELOG.md](CHANGELOG.md); older ones follow.

7.0.0 was a major release with one breaking change: `command-guard` no longer asks before destructive commands by default (the opt-in that restored them was removed later), and its denies always apply (see "Upgrading to 7.0"). It also covered `find -delete`, `find -exec`, and `xargs rm -rf`, measured panel width by grapheme cluster, and made the mod test suite run green.

6.1.0 was a minor release: the panel clean-room (#54-#56) and wide-character widths, `command-guard` asks before `git restore ./` and `git restore :/` and denies hooks-path config set through `export`, `declare`, `typeset`, `readonly`, `local`, or a bare assignment, the Risk-line gate flags trailing `// TODO` and `# TODO` comments, and subagents name unrequested work in their report.

6.0.0 was a major release with breaking changes: agents, skills, and options got Construct-native names, `jd-fix-agent` and the merged or removed skills are gone, and the deprecated `odd_*`/`jd_*` options still apply through 6.x (see "Upgrading to 6.0"). It added the role registry, multi-item Risk lines, rewritten contracts, skills, and agents (19 skills became 9), the `review-fires` eval, and `scripts/probe-review.sh`.

5.2.0 made `surface-guard` keep writers inside their allowed edit surfaces (the main thread writes only under `odd/tasks/`), added `command-guard`, the Risk-line gate's test-marker check, memory injection filtering, sharper evidence rules, spec and task coverage warnings, and review-lens learning hints.

5.1.0 moved the status panel to the terminal's own background, switched panel text to `weight: 'semibold'`, and added the Claude 5.5 prompting guidance to the session and subagent contracts.

5.0.1 fixed the publication gate's handling of backticks and `$(...)` inside single quotes.

5.0.0 was a breaking release: CodeGraph is removed and Construct has no third-party dependency. Upgrading from 4.0.1:

- Breaking: the `construct:codegraph` skill, the `codegraph_auto_index` option, the codegraph MCP tool in the agents, and the installer's npm and MCP steps are removed.
- Structural questions (architecture, call flow, references, impact) use the native `LSP` tool when a language server is available, and Grep, Glob, and Read otherwise.
- `--no-mcp` is a deprecated no-op: the installer accepts it and prints a warning.
- Existing users can remove the old registration with `claude mcp remove --scope user codegraph`.

4.0.1 was a patch release: it fixed the publication gate reading a redirection (`2>&1`) as a ref, per-segment surface comparison in delegation admission, a range check on imported relation confidence, and the evals inside the `claude plugin eval` sandbox.

4.0.0 was a breaking release: memory now lives in the repository through `construct-memory`, and the engram dependency is gone.

Upgrading from 3.0.0:

- Breaking: the `engram@engram` dependency is removed, and the engram MCP tools (`mcp__engram__*`) are gone from every agent.
- Breaking: Node 22.16 or later is required, and Node 23 is not supported.
- Breaking: the feature-document mirror and the `mirror-drift` hook are removed.
- New: `construct-memory` keeps per-repository memory, with hooks that load session context, capture prompts, and record passive learnings, and the `construct:memory` skill describes how to use it.
- Migrate: run `engram export`, then `construct-memory import <file> --project <name>`. Uninstalling `engram@engram` is optional.
- The installer no longer adds `mcp__engram*` permission rules and leaves existing ones alone.

3.0.0 was a breaking release that made review a mandatory phase for high-risk work, enforced by hooks, and removed the deterministic review and assessment CLIs.

Upgrading from 2.1.0:

- `odd-review` and `odd-assess` are removed from the PATH; nothing in the plugin invokes them, so drop any script or habit that calls them.
- Review is mandatory for high-risk work (a task whose Risk column names an item). The `odd-review mode` switch and its global and clone mode files are no longer read, so there is nothing to turn on or off.
- `git push`, `gh pr create`, and `gh release create` are denied until the required lenses approve the published ref; run the `construct:review` skill, then publish.
- The `review-refuter` and `review-validator` agents are removed, along with their `model_*` and `effort_*` keys; delete those keys from your plugin configuration.
- The panel's REVIEW card and the doctor's RDD rows are gone.

Upgrading from 2.0.0: nothing to change.

2.0.0 was a breaking release that removed the secret-guard PreToolUse hook (protected-path denies, destructive-command confirms, writer write-scope, delivered-test lint).

Upgrading from 1.4.0:

- Construct no longer denies or asks on tool calls for protected paths, destructive commands (`rm -r`, `git push`), writer edits outside the allowed surfaces, or lint findings in delivered tests; use Claude Code permissions for those guards.

Upgrading from 1.3.1:

- Plain `odd-assess` (no `--json`) exits 1 on an unassessable candidate.
- `odd-review` mutating commands refuse with `rdd_disabled` while RDD is off.
- Lens results with a location outside the candidate's paths, line 0, or a reversed range are refused (`invalid_result`), and a severe claim on unchanged lines is downgraded to `unknown`.
- A `model` passed on the Agent call now wins over the configured per-role model.

Upgrading from 1.1.0:

- Receipts written before 1.2.0 no longer satisfy the publication gate; re-review before publishing.
- `rm -r` and `git push` now ask for confirmation on the main thread and are denied inside subagents.
- The main thread can no longer edit repository files outside `odd/tasks/`.

## Credits

Ideas, with no text or code copied, from these projects:

- Gentle AI, https://github.com/Gentleman-Programming/gentle-ai: orchestrator and delegation routing, review lenses and dual review, ledger-style review.
- agent-skills, https://github.com/addyosmani/agent-skills: root-cause debugging, the written quality bar, source-grounded code, migrations, the security checklist, and the Definition of Done.
- engram, https://github.com/Gentleman-Programming/engram: memory behavior (write rules, search ranking, context format, passive capture).
- BMAD-METHOD, https://github.com/bmad-code-org/BMAD-METHOD: verification-gap shapes, evidence rules, claim and deletion checks, the Baseline field.
- get-shit-done, https://github.com/gsd-build/get-shit-done: wiring levels, orphaned-code checks, scope-reduction checks, the failed-install rule.
- gstack, https://github.com/garrytan/gstack: the test value bar.
- compound-engineering-plugin, https://github.com/EveryInc/compound-engineering-plugin: the durable-memory bar and stale-memory classification.
- spec-kit, https://github.com/github/spec-kit: Given/When/Then lines, converge at close.
- ECC, https://github.com/affaan-m/ECC: the pressure-prompt eval idea.
- claude-flightdeck, https://github.com/scasella/claude-flightdeck: the card-panel idea for the status panel.

## License

Construct is released under the MIT License; see [`LICENSE`](LICENSE).

The agents, skills, contracts, and evals are Construct's own text. Adapted MIT code (the delegation admission and delivery signals hooks) is listed in [`plugins/construct/NOTICE`](plugins/construct/NOTICE), with its license in `plugins/construct/LICENSE-gentle-shell`. The ideas Construct draws on from other projects are in [Credits](#credits).
