# Construct

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.304%2B-blue)](#requirements)
[![Plugin version](https://img.shields.io/badge/version-4.0.0-informational)](plugins/construct/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Construct is a Claude Code plugin that makes every request follow Organic Driven Development (ODD): authorize, explore, size, track, implement test-first, and close with evidence and a Risk line.

## What you get

- **ODD workflow.** A session contract, injected by hooks, that Claude follows on every request without being asked.
- **Role agents with model routing.** 11 agents (explorer, worker, verifier, judges, review lenses). You choose each role's model and effort in `/config`.
- **Skills.** Procedures that load on demand: workflow, delegation, task sizing, debugging, quality bar, migrations, branches and pull requests, and more.
- **Mandatory review.** Work whose Risk names a high-risk item is reviewed by lens agents before it can be published. Hooks build the evidence, record the verdicts, and gate `git push`, `gh pr create`, and `gh release create`.
- **Status panel.** A docked panel with the model, context, plan limits, active feature, permission gate, agents, and changes. Open it with `/construct`.
- **Output style.** The `Principal Engineer` output style.

- **Memory.** A per-repository memory built in (`construct-memory`), with no extra plugin, server, or binary. See [Memory](#memory).

## Requirements

| Requirement | Why |
|---|---|
| Claude Code 2.1.304 or later, signed in | The panel is a mod, and the panel needs 2.1.304. Tested on 2.1.304 |
| Node.js 22.16 or later (Node 23 is not supported), with npm | The plugin's scripts and hooks, and the memory's `node:sqlite` with FTS5. Claude Code's native install does not bundle Node.js |
| `git` on the PATH | The review and publication hooks read the repository |

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v4.0.0/install.sh | bash
```

The installer checks the requirements above and stops before changing anything if one is missing, or if `~/.claude` or `~/.claude/settings.json` is not writable, or if `settings.json` is a directory. Then it runs the manual steps below for you:

- Adds the construct marketplace and installs `construct@construct`.
- Installs the CodeGraph CLI and registers the codegraph MCP server. If `npm install -g` fails, it warns, skips the server, and continues.
- Merges into `~/.claude/settings.json`: the `permissions.allow` rule `Bash(construct-memory *)`, and removes a `theme` of `custom:construct:construct` left by earlier versions (any other theme is left alone). An empty `settings.json` counts as `{}`. Other keys stay as they are, a symlinked file (even a dangling one, whose target is then created) is written through to its target with its mode kept, and the previous file is saved as `settings.json.bak-<timestamp>`.

If engram is installed, the installer says Construct no longer needs it and removes nothing. Every step is skipped when it is already done, so running the installer again changes nothing. It never changes other permissions or your permission mode. The output style needs no setting: the plugin forces `Principal Engineer`, and an `outputStyle` you already have stays in the file but has no effect while construct is enabled.

| Option | Meaning |
|---|---|
| `--no-mcp` | Skip the CodeGraph CLI and the codegraph MCP server |
| `--force` | Deprecated: has no effect and prints a warning. It is accepted for now so scripted installs keep working, and will be removed in a later release |

Pass options after `bash -s --`, for example `curl -fsSL <url> | bash -s -- --no-mcp`. To read the script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v4.0.0/install.sh -o install.sh
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

   The installer (`install.sh`) pins this marketplace to the release tag (`carsimax/construct#v4.0.0`); the command above follows the default branch. A failed `claude mcp add` in the installer warns and the install continues.

2. Optional: install the CodeGraph CLI and register the codegraph MCP server (see [MCP servers](#mcp-servers)).

3. Optional: inside Claude Code, in `/config`, set each role's model and effort (rows such as `ODD Worker model`).

4. Check that it works. Open a session in any git repository:

   - Ask "what does your Construct contract say about Risk lines?". The answer quotes the `Risk: item N` rule.
   - `/agents` lists the `construct:` agents, such as `construct:odd-worker` and `construct:review-risk`.
   - `/construct` opens the panel; `/construct doctor` prints a setup report.

## First session

Open Claude Code in a git repository and make a request. Construct applies the same steps each time:

1. **Authorize.** Questions, reviews, and planning stay read-only. Files change only when you explicitly ask for a change.
2. **Explore.** Claude reads the existing code first, in proportion to the task.
3. **Size.** A task is small or large. Small work goes to one worker agent. Large work is tracked in `odd/tasks/<feature>.md` (specs, tasks, log) before the first source write.
4. **Implement test-first.** A worker writes a failing test, makes it pass, then refactors, inside the edit surfaces it was given.
5. **Close with evidence.** One report: what was verified, what failed or was skipped, the next step, and a Risk line (`Risk: none` or `Risk: item N (reason)`).

Commit, push, pull request, and merge stay your decisions. A change whose task in the feature document has a Risk column naming a high-risk item is reviewed before it can be published; see [Mandatory review](#mandatory-review-and-the-publication-gate). There is no switch to turn the review off.

To confirm the install works, see step 4 of [Manual install](#manual-install).

## Update

Construct updates through Claude Code's plugin commands. Running `install.sh` again does not update them: it skips every step that is already done.

```bash
claude plugin marketplace update construct     # fetch the latest catalog from carsimax/construct
claude plugin update construct@construct       # install the new version
```

Restart Claude Code afterwards; a plugin update applies to new sessions. `claude plugin list` shows the installed version.

## Configuration

Options are plugin settings, edited in `/config`:

| Option | Effect |
|---|---|
| Model and effort per role | See the routing table below |
| `panel_open_on_start` (boolean, default `true`) | Open the panel at every session start |
| `codegraph_auto_index` (boolean, default `false`) | Index a git root with CodeGraph at session start (see [MCP servers](#mcp-servers)) |

### Agents and model routing

The plugin ships 11 agents. Each role's model and effort can be changed in `/config`, where every option appears as a row such as `ODD Worker model` or `RDD Risk effort`.

| Role | Agent | Model | Effort |
|---|---|---|---|
| ODD Explorer | `construct:odd-explorer` | haiku | medium |
| ODD Worker | `construct:odd-worker` | sonnet | medium |
| ODD Verify | `construct:odd-verify` | opus | medium |
| JD Judge A | `construct:jd-judge-a` | opus | medium |
| JD Judge B | `construct:jd-judge-b` | sonnet | medium |
| JD Fix Agent | `construct:jd-fix-agent` | sonnet | medium |
| RDD Risk | `construct:review-risk` | opus | medium |
| RDD Readability | `construct:review-readability` | sonnet | medium |
| RDD Reliability | `construct:review-reliability` | sonnet | medium |
| RDD Resilience | `construct:review-resilience` | sonnet | medium |
| General delegation | `construct:odd-general` and the built-in `general-purpose` | sonnet | medium |

How the routing works:

- The plugin's mod (`hooks/register.js`) applies the configured model when a subagent spawns and the configured effort on each of its requests.
- A model passed explicitly on the Agent call wins; the configured model applies only when the call names none.
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

The installer no longer registers context7. An earlier registration can be removed with `claude mcp remove --scope user context7`.

### Memory

Memory is per repository: one SQLite database at `<git common dir>/construct-memory/memory.db`, shared by every worktree of the clone and never committed. It needs Node 22.16 or later and is off outside a git repository. There is no MCP server; Claude uses the `construct-memory` command (on the Bash tool's PATH) and the `construct:memory` skill.

- **Commands.** `save`, `search`, `get`, `context`, `update`, `delete`, `summary --session <id>`, `review list|done <id>`, `import <file>`, `export [file]`, `suggest-topic-key` (prints a key from a JSON `type`, `title`, `content` on stdin), `timeline <id>`, `pin <id>` / `unpin <id>` (pinned memories load in every session context and rank higher in search), `stats`, `doctor [--json]` (read-only health checks, exit 1 when one fails), and `prompts --search <query>`. `construct-memory help` lists the flags.
- **Hooks.** At session start the recent memory is injected (after a compaction, with an instruction to save a summary first). Each prompt is stored, a subagent's `## Key Learnings:` section is captured as memories, and a one-line reminder appears after 15 minutes without a save. `<private>...</private>` text is never stored.
- **Erasing a memory.** `construct-memory delete <id>` hides it; `delete <id> --hard` erases it and its earlier versions for good, and an imported one is not re-imported.
- **Stored prompts.** `construct-memory prompts [--limit N]` lists them with their ids and `construct-memory prompts delete <id>` removes one for good; `<private>` keeps text out in the first place.
- **Import from engram.** Run `engram export` once, then `construct-memory import <file> --project <name>` (`--project` is required when the file holds several). Re-running it inserts nothing new, and it never reads `~/.engram`.
- **Export.** `construct-memory export [file]` writes live observations, sessions, and prompts as JSON, to stdout or a new file, so you can back them up or move them to another clone with `import <file> --project <repository directory name>`.
- **Uninstalling `engram@engram` is optional.** Construct no longer uses it.

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
- `construct:review-risk` carries a security checklist category list; the full checklist is `skills/rdd-review/references/security-checklist.md`. The agent has no tools, so the review-context hook embeds that file in the review-risk context between `ODD_REVIEW_CHECKLIST_BEGIN` and `ODD_REVIEW_CHECKLIST_END`, before `ODD_REVIEW_CONTEXT_END`, and counts it against the context budget. The agent applies the categories as triage over the supplied patches.
- `odd-workflow`'s testing reference tells the worker to discover the repository's own test stack first and states the Floor as "never weaken the verifier" examples.

### Mandatory review and the publication gate

Review is a mandatory ODD phase for high-risk work. A work unit whose task's Risk column (in the `## Tasks` table of the feature documents changed on the branch) names an item (1-6) is reviewed by lens agents before it can be published. There is no mode switch and no per-candidate consent. The `construct:rdd-review` skill holds the procedure; hooks do the rest.

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

**Launching a lens.** The orchestrator launches each lens as `construct:review-<lens>` with one prompt line, `Review subject: <base>`. The base is normally the merge-base with the default branch; the head is `HEAD`. A branch whose context exceeds the limit is denied: split the delivery into smaller pull requests.

- **`PreToolUse` on `Agent`** (`hooks/scripts/review-context.mjs`). For a `construct:review-*` agent it resolves the subject, builds the context (binding, name-status, numstat, and the diff, with deleted paths listed but their removed content omitted; the security checklist for `review-risk`), replaces the prompt with it, and records the pending lens. A prompt with no readable subject, an unresolvable ref, an empty diff, or a context over 400 KiB is denied with the expected form.
- **`SubagentStop` on `^construct:review-`** (`hooks/scripts/review-capture.mjs`). It takes the lens report from `last_assistant_message` (the transcript for a background agent), validates it against the lens result shape (`subject_hash`, `inspection`, `findings`, `evidence`), and writes one verdict per lens. An invalid report goes back to the agent with the reason, at most twice; a reply whose `subject_hash` matches no pending record retries against its own session's single pending record of that lens, and otherwise touches nothing. Records older than 30 days are pruned.
- **Verdicts.** Approved means a completed inspection and no BLOCKER or CRITICAL finding. A rejection stands for that lens and tree: fix with a new commit and review again. The orchestrator never writes or pastes evidence or verdicts.

**Store.** `$(git rev-parse --git-common-dir)/construct-review/`, shared by linked worktrees, with `pending/<lens>.<subject>.json` and `verdicts/<subject>/<lens>.json`. A `PreToolUse` hook (`hooks/scripts/review-store-guard.mjs`) denies Write, Edit, and Bash commands that name the store. The same guard denies a Bash command naming `review-capture` or `review-context` (quotes, backslashes, and brackets removed first). The guard is a heuristic: an indirect path to the store or an interpreter is not caught.

**Publication gate.** The `PreToolUse` hook on `Bash` (`hooks/scripts/publication-gate.mjs`) denies `git push`, `gh pr create`, and `gh release create` (also through `sh -c`, `eval`, `$(...)`, backticks, wrappers, heredocs, and the `gh pr new` and `gh release new` aliases) until the required lenses approve the published ref. It judges every ref being published (push sources, `gh pr create --head`, `gh release create --target`, the default branch when none; `HEAD` when none is named). It finds the feature documents changed from the merge-base with the default branch, reads every Risk number at the ref and at the merge-base, and requires each required lens to approve one subject from the merge-base tree to the ref tree. The default branch itself with no remote-tracking default to compare with is denied. A Risk cell that is neither `none` nor readable denies, and so does any internal error. The denial names the missing lenses and the `construct:rdd-review` skill. The hook entry sets `onFailure: "block"`.

An approval never authorizes delivery. Commit, push, pull request, and merge stay your decisions.

### Delivery signals

Two deterministic checks that used to be prompt-only (ports of gentle-shell's `commit-slice-signal` and `context-backstop`).

- **Commit slice** (`hooks/scripts/delivery-signals.mjs`, `PostToolUse`, main thread and subagents). After a successful `git commit` on a branch other than the default branch (`origin/HEAD`, else `main` or `master`), the hook adds context with the authored changed lines from the merge base to `HEAD` (added plus deleted, renames counted by what changed; lock files such as `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, minified `.min.js`/`.min.css`, and generated golden files excluded) and the number of lines left before the ~400-line slice. Past 400 it asks you to apply the feature's delivery strategy before the next commit. Failed, interrupted, and background commands, text that only mentions `git commit`, and commits on the default branch add nothing. `git -C DIR` and a preceding `cd DIR` pick the repository.
- **Context backstop** (same hook, main thread only). When the latest assistant usage in the transcript (input, cache read, cache write, and output tokens) reaches 150,000 tokens, one notice asks you to delegate the next multi-step unit to `construct:odd-worker`. It fires once per crossing: a later reading below the threshold (after compaction) re-arms it. The hook reads only the last 256 KB of `transcript_path`. The hook payload and transcript give no context window and the model id does not reveal it, so the window is treated as unknown and the absolute cap applies (as in gentle-shell, where an unknown window leaves the cap alone). The notice is advice, not a gate.

Both `PostToolUse` signals fail open (no output, exit 0).

### Construct panel (mod)

The mod draws one thing: a docked **panel** (a `Pane` with id `construct`) laid out as [claude-flightdeck](https://github.com/scasella/claude-flightdeck) cards and adapted to the ODD flow: one column at any width, no header or legend, `round` bordered cards, the bold title on the left and the status on the right. The band above the prompt is not drawn. It needs Claude Code 2.1.304 or later and does not appear in `claude -p` runs, which draw no interface.

**Commands and opening.** `/construct` opens the panel, `/construct close` closes it, and `/construct doctor` prints a setup report instead: one line per check, `✓ label` or `✗ label — hint`, for Claude Code 2.1.304 or later, Node 22.16 or later, memory (`node:sqlite` with FTS5 trigram), a CodeGraph index (`.codegraph/`) at the project root. The checks run in parallel with a 3 s timeout each, and a failed check shows as `✗` and never throws. The panel opens at every session start; to turn that off, set the plugin option `panel_open_on_start` (boolean, default `true`) to `false`.

**Width.** The panel asks for 66 columns when it opens (`columns: 66` on `ui.open`). That is a request, not a guarantee: a width you drag or keep wins, and the layout reads the real width (never below 40). Rows that do not fit are clipped, and the changes card keeps only the file rows that fit the pane height.

**Colors.** The text colors are theme keys, so they follow the active theme, while the panel background is fixed: it draws on pure black (`#000000`) whatever the terminal theme.

**The panel, top to bottom.** Every section is a card of the same width (round border, bold title on the left, status on the right); the borders separate the sections. A card with nothing to show takes no room.

1. **main card** (always drawn, with or without a `statusLine`): `<Model>` (no suffix) and idle, busy (named by the ODD phase of the running agents: `● verifying`, `● reviewing`, `● implementing`, `● exploring`, `● working`; plain `● busy` with none running), or `◆ blocked` (warning color) while Claude waits on you: a `tool.check` verdict of `ask` on a real call (the permission prompt), or a `tool.call` on `AskUserQuestion` or `ExitPlanMode` while it is open; the next settled `tool.call`, `turn.start` or `turn.complete` clears it, and the idle "waiting for your input" state never sets it (it is the one indicator, with no extra row; the mod's `classic.*` hooks are bypassed by a higher-tier module, so none is used); the current git branch (`⎇ <branch>`, hidden without one); the effort meter (`▮▯`), the permission mode (from the main thread's spawns), and the main request count; the context gauge with tokens used and window; the 5-hour and 7-day gauges (`▰▱`) with the time to each reset (`↻3h10m`, `↻4d2h`), omitted when the figure is missing, for example off a subscription.
2. **ODD card** (only with an active feature): the feature (newest `odd/tasks/*.md` with an unfinished task, the rule of `feature-state.mjs`), the current task, one checkpoint per task (done filled, current highlighted) and the open count.
3. **GATE card**: a stacked bar of permission verdicts, allowed / asked (`you`, or `classifier` in `auto` mode) / pending / denied counts, `file`, `shell` and `other` bucket counts, the last denied tool with credential-like values masked, and the inline-write alert (a main-thread `Edit`, `Write`, `MultiEdit` or `NotebookEdit` outside `odd/tasks/`: the count and last path, error color). It only observes and never blocks.
4. **agents card**: titled `agents`, with `N running · M total` on the right, one row per subagent (up to 6, then `+N earlier`): a status mark, a short name (the construct role without the `odd_` prefix, as in `worker` or `review-risk`; the subagent type when there is no construct role), the routed model with its effort meter (for example `Sonnet 5.5 ▮▮▮▯`), and the elapsed time as static text.
5. **changes card** (only with something to show): round card titled with the branch, `↑N` (commits to push) and `↓N` (commits to pull) on the right, each shown only when above 0. One row per changed file, biggest change first: the path (long paths keep their basename: `…/dir/name`) and `+added` / `-removed` lines (`bin` for a binary file). Changes are the working tree against `HEAD`, staged and unstaged; an untracked file shows `+lines` (counted for the first 20 untracked files) or `new` when it is a directory, past the first 20, or not countable. Rows fit the pane height; when some are cut the last row is `+N more`. The card is hidden when the repository is clean and in sync.

**Refresh and fail-open.** Git (status, `diff --numstat HEAD` and a line count per untracked file) and the feature documents are read only on `session.start` and after each main-thread `turn.complete`, in the background with a timeout, never on a redraw. Context and the plan limits are read from the session usage on each redraw. Nothing is animated: the agents' elapsed times are static text computed at each redraw, which happens on the events below, not on a timer. The panel's own state is kept in a versioned `atom` fed from engine events (`agent.spawn`, `turn.start`, `turn.step`, `tool.call`, `tool.check`, `turn.complete`, and `session.compact`); the panel redraws on those events, not per token. These hooks only observe: each passes its event on unchanged and swallows its own failures, and the model and effort routing is untouched. Any error leaves out the affected card and never blocks or delays a turn.

**Credit.** The drawing code (gauges, effort meter, and the card layout) is adapted from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella, MIT License. The copyright and permission notice are in [`plugins/construct/LICENSE-flightdeck`](plugins/construct/LICENSE-flightdeck) and at the top of each adapted file.

### Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `construct` |
| `install.sh` | One-command installer (see [One command](#one-command)) |
| `plugins/construct/` | The plugin (manifest name `construct`) |
| `plugins/construct/agents/` | The 11 role agents |
| `plugins/construct/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, `debugging`, `constraint-driven`, ...) |
| `plugins/construct/hooks/` | `hooks.json`, the mod (`register.js`), its routing helpers, the status modules (`status/`), the panel modules (`panel/`), and the command hooks (`scripts/`: contract, feature state, the `shell-words` tokenizer, delivery signals, publication gate, review store guard, Risk line gate, subagent count, delegation admission, review context and capture, and the memory store `memory-store.mjs` with its hooks `memory-hooks.mjs`) |
| `plugins/construct/bin/construct-memory` | The memory command line (on the Bash tool's PATH) |
| `plugins/construct/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/construct/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/construct/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## Contributing

Setup, checks, and pull request rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Current version: 4.0.0 (`plugins/construct/.claude-plugin/plugin.json`); memory now lives in the repository through `construct-memory`, and the engram dependency is gone. Breaking. Releases are tagged `vX.Y.Z`.

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
- `git push`, `gh pr create`, and `gh release create` are denied until the required lenses approve the published ref; run the `construct:rdd-review` skill, then publish.
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
- A `model` passed on the Agent call now wins over `model_<role>`.

Upgrading from 1.1.0:

- Receipts written before 1.2.0 no longer satisfy the publication gate; re-review before publishing.
- `rm -r` and `git push` now ask for confirmation on the main thread and are denied inside subagents.
- The main thread can no longer edit repository files outside `odd/tasks/`.

## License

Construct is released under the MIT License; see [`LICENSE`](LICENSE).

Part of the agents and skills are adapted from MIT-licensed material (Gentle AI, agent-skills, and engram); see [`plugins/construct/NOTICE`](plugins/construct/NOTICE).
