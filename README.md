# Construct

Construct is a Claude Code plugin for Organic Driven Development (ODD). It ships orchestration rules, review lenses, and delivery skills as plugin components only: agents, skills, hooks, mods, workflows, and output styles. Engram stays an independent memory instance; this plugin depends on it.

## Requirements

| Requirement | Why |
|---|---|
| Claude Code 2.1.304 or later, signed in | The panel is a mod, and the panel needs 2.1.304. Tested on 2.1.304 |
| Node.js 20 or later, with npm | The plugin's scripts and hooks (`odd-assess`, `odd-review`, the hook scripts). Claude Code's native install does not bundle Node.js |
| `git` on the PATH | `odd-assess` and `odd-review` read the repository |
| Homebrew (macOS or Linux) | Installs the engram binary |

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v0.1.0/install.sh | bash
```

The installer checks the requirements above and stops before changing anything if one is missing. Then it runs the Quick path below for you:

- Installs the engram binary through Homebrew when it is missing, and runs `engram setup claude-code`.
- Adds the engram and construct marketplaces and installs `construct@construct`.
- Installs the CodeGraph CLI and registers the codegraph and context7 MCP servers. If `npm install -g` fails, it warns, skips both servers, and continues.
- Merges into `~/.claude/settings.json`: `theme: "custom:construct:construct"` and the `permissions.allow` rules `mcp__engram` and `mcp__plugin_engram_engram`. Other keys stay as they are, a symlinked file is written through to its target with its mode kept, and the previous file is saved as `settings.json.bak-<timestamp>`.

Every step is skipped when it is already done, so running the installer again changes nothing. It never changes other permissions or your permission mode. A `theme` in `~/.claude/settings.local.json` still overrides the merged value. The output style needs no setting: the plugin forces `Neutral`, and an `outputStyle` you already have stays in the file but has no effect while construct is enabled.

| Option | Meaning |
|---|---|
| `--no-mcp` | Skip the CodeGraph CLI and the codegraph and context7 MCP servers |
| `--force` | Replace an existing `theme`. Without it, a different value stays and the installer prints a warning |

Pass options after `bash -s --`, for example `curl -fsSL <url> | bash -s -- --no-mcp`. To read the script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v0.1.0/install.sh -o install.sh
less install.sh
bash install.sh
```

## Quick path

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

4. Optional: install the CodeGraph CLI and register the codegraph and context7 MCP servers (see [MCP servers](#mcp-servers)).

5. Inside Claude Code:

   - `/theme` → **Construct** (the Matrix theme).
   - Optionally, in `/config`, set each role's model and effort (rows such as `ODD Worker model`).

6. Check that it works. Open a session in any git repository:

   - Ask "what does your Construct contract say about Risk lines?". The answer quotes the `Risk: item N` rule.
   - `/agents` lists the `construct:` agents, such as `construct:odd-worker` and `construct:review-risk`.
   - Ask Claude to run `odd-review mode status`; it prints `{"mode":"on","source":"default"}`. The plugin's `bin/` is on the PATH of Claude's Bash tool only, not your own shell.
   - After a turn ends, the panel shows the RDD state (`clear`, `review due` or `reviewed`); `/construct` opens it.

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

## How the ODD contract loads

A plugin cannot ship a `CLAUDE.md`, so Construct loads its rules in three layers:

| Layer | Mechanism | Content |
|---|---|---|
| Session contract | `SessionStart` hook (startup, resume, clear, compact) | ODD protocol, task size, high-risk list, Risk line, and delegation triggers, under 8,000 characters |
| Subagent contract | `SubagentStart` hook | Artifact language, edit surfaces, scratch, and the `## Key Learnings` closing block. JSON-only reviewers (`review-*`, `jd-judge-*`) get nothing |
| Skills | Loaded on demand | `odd-workflow`, `odd-delegation`, `task-size-risk`, `lossless-prompts` |
| Output style | Forced by the plugin (`force-for-plugin`), in every project | Reply tone, language, response length, verification, and working rules (no AI attribution in commits, one question at a time) |

The contract texts live in `plugins/construct/hooks/contract/`.

After a compaction or a resume, a second `SessionStart` hook (matcher `compact|resume`) re-injects the active feature state. It reads `odd/tasks/*.md` under the project root and, for up to three documents with unfinished tasks (newest first), emits the path, title, branch line, unfinished task rows, and the last `Next step:` from the log, in at most 2,500 characters. It is read-only and prints nothing when no document is active. Task-to-document sync hooks were dropped: native tasks have no link to the document's `T#` rows, so a hook could corrupt the feature document. The orchestrator keeps the document current, and the re-injection tells it where it was.

## MCP servers

The plugin ships no MCP servers, so it never duplicates servers you already registered (duplicates would load every tool twice). The agents and the `codegraph` skill expect these user-scope servers. Install the CodeGraph CLI, then register both servers once:

```bash
npm install -g @colbymchenry/codegraph
claude mcp add --scope user codegraph -- codegraph serve --mcp
claude mcp add --scope user context7 -- npx -y --package=@upstash/context7-mcp@2.2.5 -- context7-mcp
```

Engram's MCP server comes from `engram setup claude-code` (see Quick path).

## Agents and model routing

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

## Risk assessment: odd-assess

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
| `--escalate-item N`, `--escalate-reason TEXT` | Raise the tier to `high` by citing high-risk item 1 to 6 (reason at most 500 bytes). Both flags or neither; a tier is never lowered |
| `--json` | Print the `construct.review-assessment/v1` object instead of a short summary |

Without `--base-ref`, the candidate is the working tree (tracked plus untracked, not ignored), frozen through a temporary index. Your real index is never changed.

JavaScript and TypeScript module files (`.mjs`, `.cjs`, `.mts`, `.cts`) are read as source, like `.js` and `.ts`: an added line that spawns a process (`process_boundary`) or calls a dangerous sink (`dangerous_sink`) makes the change `high`. In any source file outside tests, an added non-comment line that names a hook's `permissionDecision` (`permission_decision`, signal `permissions`) also makes it `high`.

The JSON result has `risk` (`passive`, `medium`, `high`), `reasons`, `changed_paths`, `changed_lines`, `candidate`, `review_due`, `review_due_reason`, and `lenses` (empty for passive and medium, the four canonical lenses for high). Only `high` makes a review due; `medium` reports `under_budget` and `passive` reports `passive`. When the exact candidate already has a receipt from `odd-review acknowledge`, `candidate.consumed` is `true` and the result reports `review_due: false` with `review_due_reason: "already_reviewed"`, whatever the tier.

Exit codes: `0` for any successful assessment, including a fail-closed one (`risk: "high"` with one `unassessable` reason, for example when `--base-ref` names a missing ref); `2` for bad usage, with the message on stderr.

## Review lifecycle (`odd-review`)

`bin/odd-review` runs the review lifecycle without any external binary: it freezes the candidate, serves immutable evidence to the review agents, validates their results, drives one bounded correction, and records a receipt. It never asks for consent; that belongs to the review skill.

```bash
odd-review start                                    # lenses from odd-assess; or --base-ref main --committed-only
odd-review start --lenses risk,reliability --lenses-reason "touches the login guard"   # explicit lenses
odd-review context --lineage L --lens risk          # evidence for one lens (binding + block)
odd-review capture --lineage L --lens risk --input result.json     # one per selected lens ("-" reads stdin)
odd-review capture-refuter --lineage L --input refuter.json        # only after refutation_required
odd-review correct --lineage L                      # once, after correction_required
odd-review capture-validation --lineage L --input validator.json
odd-review status --lineage L
odd-review acknowledge --lineage L                  # only when approved; writes the receipt
```

States: `collecting` to `approved`, `refutation_required`, or `correction_required`; `refutation_required` to `approved` or `correction_required`; `correction_required` to `validation_required`; `validation_required` to `approved` or `escalated` (a human decision); `approved` to `acknowledged`.

- Every command prints JSON with the exact `next` commands. Exit `0` is success, `1` a refused transition (`{"error":{"code","message"}}` on stderr), `2` bad usage.
- Lenses are `review-risk`, `review-resilience`, `review-readability`, and `review-reliability`; the short names work and the canonical order is kept. Without `--lenses` (and `--lenses-reason`), `start` takes the lenses `odd-assess` assigns to the frozen candidate, all four for `high`, and records `odd-assess: <risk> risk (<reasons>)` as the reason; a `medium` or `passive` candidate refuses with `lenses_required`. `--lenses` and `--lenses-reason` go together.
- The candidate is frozen into immutable git trees (the working state goes through a temporary index). `context` serves name-status, numstat, and one verbatim patch per changed path from those trees only, and refuses with `context_budget_exceeded` above 400 KB (`--max-bytes N` overrides it); split the change into smaller slices when that happens.
- `capture` validates the result against the agent's output contract: matching `subject_hash`, no unknown or missing fields, a completed inspection that lists exactly the changed paths, a selected lens, and one capture per lens.
- Only a BLOCKER or CRITICAL finding introduced by the candidate blocks. Deterministic ones need a correction; inferential ones go to the refuter first. Everything else is advisory and lands in the receipt.
- `correct` is allowed once per lineage and may change at most `min(200, ceil(n/2))` lines, where `n` is the reviewed line count. A correction over the budget is refused and does not use up the one correction.
- The refuter result must carry the `subject_hash` from its `ODD_REVIEW_BINDING`, which binds it to the lineage, target, and batch (`subject_mismatch` otherwise).
- `acknowledge` accepts only `approved` and refuses a replay. If a crash left the receipt written but the transaction still `approved`, running it again completes the transaction and reports `recovered: true`; a receipt of another lineage is refused as `target_already_acknowledged`. `start` refuses a candidate that already has a receipt.

### The RDD switch, the boundary, and the Stop gate

```bash
odd-review mode status                      # {"mode":"on","source":"default"}; read-only
odd-review mode status --scope clone        # {"scope":"clone","mode":"off"|"on"|null,"set":…,"effective":{…}}; one scope only
odd-review mode disable                     # global scope (default); enable turns it back on
odd-review mode enable --scope clone        # this clone only
odd-review boundary                         # {"commit":"<sha>","source":"receipt|merge-base|root"}
```

- The switch is on by default. Precedence is the clone file (`<git-common-dir>/odd-review/mode.json`), then the global file (`${XDG_CONFIG_HOME:-$HOME/.config}/construct/rdd.json`), then the default. An unreadable file is skipped. Writes are atomic.
- `boundary` is the start of the next committed range: among the receipts whose `candidate_commit` is an ancestor of (or equal to) `HEAD`, the one closest to `HEAD` by ancestry (ties go to the newest acknowledgement, so reviewing an older commit later never moves the boundary back), else the merge-base with the default branch (the first of `origin/HEAD`, `main`, `master`, `origin/main`, `origin/master` that resolves and differs from `HEAD`), else the root commit. Receipts of committed-mode reviews record `candidate_commit` (and `base_commit` when `--base-ref` names a commit); older receipts without them stay valid and are ignored by `boundary`.
- The plugin's `Stop` hook (`hooks/scripts/review-gate.mjs`) assesses any uncommitted changes, and `boundary..HEAD` when the boundary comes from a receipt or a merge-base. A root boundary (for example the default branch of an existing repository with no receipts) never opens a committed range, so the gate does not review a whole history. When one is `high`, has no receipt, and was not yet reminded in this session, it blocks the stop once with the range, up to three reasons, and the next step (load `construct:rdd-review`, ask for consent, or skip). Reminders are kept per session under `${CLAUDE_PLUGIN_DATA}/review-gate/`; without `CLAUDE_PLUGIN_DATA` they go to a private `construct-<uid>` directory in the system temp dir, which must be owned by the user with no group or other access (otherwise the gate stays silent). It does nothing when the switch is off, outside a repository, in a repository without commits, or when `stop_hook_active` is set, stays silent for a target that has an open lineage (any state but `escalated` and `acknowledged`, with a transition in the last six hours; an older one counts as abandoned), and fails open on any error.

### Review hooks: context in, results out

Two hooks move the hand-offs between the orchestrator and the lens agents into code. The orchestrator launches each lens with only the lineage id as its prompt (for example `Review lineage review-0123456789abcdef`).

- **`PreToolUse` on `Agent`** (`hooks/scripts/review-context.mjs`). For a `construct:review-*` agent (the four lenses, the refuter, and the validator) whose prompt names a lineage, it runs `odd-review context` for that agent and returns it as `updatedInput.prompt` with `permissionDecision: allow`. A review agent without a lineage, or one `odd-review` refuses (for example `lens_not_selected`), is denied with the reason. A prompt that already starts with the `ODD_REVIEW_BINDING` line passes through. Other agents are untouched. The `allow` only skips the permission prompt: Claude Code still evaluates the user's deny and ask rules against the rewritten input, so a matching deny rule blocks the lens and a matching ask rule still prompts.
- **`SubagentStop` on `^construct:review-`** (`hooks/scripts/review-capture.mjs`). For an agent the first hook prepared, it pipes the agent's report to `capture`, `capture-refuter`, or `capture-validation`: `last_assistant_message`, or, when that has no text (a background agent reports through its `SubagentHandback` call), the handback message or last text read from `agent_transcript_path`. Only a surrounding code fence is removed; the JSON is never edited. A `malformed_result` or `invalid_result` refusal blocks the stop with the validator's message, at most twice; any other answer lets the agent stop. The orchestrator then reads `odd-review status`.

The lineage of each spawned agent is kept per session and agent type under `${CLAUDE_PLUGIN_DATA}/review-hooks/` (same fallback rules as the gate). Both hooks fail open on errors.

Store: `$(git rev-parse --git-common-dir)/odd-review/`, so nothing is written into the worktree and linked worktrees share it.

```
odd-review/transactions/<lineage>.json   # one per review; <lineage>.lock while a command writes it
odd-review/receipts/<target hex>.json    # written by acknowledge
```

Writes are a temporary file plus a rename. A second writer on a locked transaction is refused (`transaction_locked`); a lock left by a dead process (or an empty one older than 10 seconds) is reclaimed under a separate `<lock>.reclaim` lock, and only if it is still the very file (same inode and content) that was inspected as stale, so a live lock is never removed. A contender that cannot reclaim does not wait; it gets `transaction_locked`. No command changes the index, `HEAD`, or the working tree.

## Secret guard

A `PreToolUse` hook (`hooks/scripts/secret-guard.mjs`) denies tool calls that touch secrets. It replaces a `permissions.deny` list, which a plugin cannot set. It covers `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Grep`, `Glob`, and `Bash`, in the main session and in subagents, and holds under `bypassPermissions`.

Protected, anywhere in the tree (paths resolve against `cwd`; `~` and `$HOME` expand):

- `.env` and `.env.*`
- any `.ssh` or `.credentials` directory, `Library/Keychains`
- `.aws/credentials` and `.config/gh/hosts.yml`
- `*.pem` and `*.key` files
- any `secrets` directory
- `rm -rf` (any flag order or spelling, with or without `sudo`) aimed at `/`, `~`, `$HOME`, or `/*`

Exception: `.env.example`, `.env.sample`, and `.env.template` are allowed, since they are committed templates. Matching ignores case (`.ENV`, `~/.SSH/id_rsa`), including for the templates.

How each tool is read:

- **Globs.** A `Glob` pattern and a `Grep` `glob` are treated as globs: each segment (with `*`, `?`, `[..]`, `{a,b}`) is tested against the protected names, so `*.env*`, `.e*`, `{a,.env}`, `*.pem`, and `**/.ss?/**` are denied while `*.ts` and `.env.example` pass. Wildcard-only segments (`*`, `**`) are not blocked. A `Grep` content `pattern` is never a path.
- **Search commands.** For `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack`, and `git grep`, the pattern is data (`rg ".env" src` is allowed); only the path arguments and glob flags (`-g`, `--include`) are checked.
- **`echo` and `printf`.** Their arguments are data (`echo .env >> .gitignore` is allowed). Only redirection targets and sources (`>`, `>>`, `<`, `&>`) are checked, so `echo x > .env` is denied.
- **Pipes.** The data words of an upstream `echo` or `printf` are checked as paths (or parsed as commands, when they contain spaces) when the next stage runs or reads them: `xargs` with any command, `sh`, `bash`, `zsh`, `source`, `.`, `eval`, and `while read`. `echo .env | xargs cat` and `echo "cat .env" | sh` are denied; `echo .env | wc -c` is allowed.
- **Path-valued flags and flag arity.** Pattern-file and ignore-file flags take a path that is checked: `grep -f`/`--file`, `rg -f`/`--file`/`--ignore-file`, `ag --path-to-ignore`, `git grep -f`. Which flags take a value is modeled per command: `rg -t`/`-T` take a type, GNU `grep -T` and `ag -t` do not, so `grep -T KEY .env` is denied.
- **Invalid globs.** A glob that does not compile (`[z-a]`) is matched permissively, with the broken bracket class standing for any characters, so it can only deny more and never allows because of the error.
- **`rev:path` tokens.** For a token such as `HEAD:.env`, the part after `:` is also checked.
- **Interpreter one-liners.** The `-c` argument of `python`/`python3` and the `-e` argument of `node`, `perl`, and `ruby` are scanned for quoted string literals that name a protected path; `bash -c` and `eval` strings are parsed as commands. Heredoc bodies are read as commands.
- **Prose.** A quoted multi-word string given to another command is not checked.

The denial says which rule matched and that the user can run the command manually. Unreadable hook input is allowed with a stderr note.

Known lexical limits: the guard reads the command text and cannot see through whole-directory searches such as `grep -rn KEY .`, symlinks, shell globs (`cat .e*`), variables, or obfuscation (`cat $(echo .e)nv`, encoded payloads).

## Construct panel (mod)

The mod draws one thing: a docked **panel** (a `Pane` with id `construct`) laid out as [claude-flightdeck](https://github.com/scasella/claude-flightdeck) cards and adapted to the ODD flow: one column at any width, `round` bordered cards, the bold title on the left and the status on the right. The band above the prompt is not drawn. It needs Claude Code 2.1.304 or later and does not appear in `claude -p` runs, which draw no interface.

**Commands and opening.** `/construct` opens the panel and `/construct close` closes it. The panel opens at every session start; to turn that off, set the plugin option `panel_open_on_start` (boolean, default `true`) to `false`.

**Width.** The panel asks for 66 columns when it opens (`columns: 66` on `ui.open`). That is a request, not a guarantee: a width you drag or keep wins, and the layout reads the real width (never below 40). Rows that do not fit are clipped, and the session log keeps only the rows that fit the pane height.

**Colors.** All colors are theme keys, so the panel follows the active theme.

**The panel, top to bottom.** A card with nothing to show takes no room.

1. **header**: `CONSTRUCT · <MODEL> <IDLE|BUSY> · ODD <task>` centered, with a `■` legend (main, agents, gate, odd, review).
2. **main card** (always drawn, with or without a `statusLine`): `<Model> · main` and idle or busy; the effort meter (`▮▯`), the permission mode (from the main thread's spawns), and the main request count; the context gauge with tokens used and window; the session cost; the 5-hour and 7-day gauges (`▰▱`) with the time to each reset (`↻3h10m`, `↻4d2h`), omitted when the figure is missing, for example off a subscription.
3. **rail**: a connector between cards, animated while the main thread is busy on terminals that can draw `Client` elements, a static line otherwise.
4. **ODD card** (only with an active feature): the feature (newest `odd/tasks/*.md` with an unfinished task, the rule of `feature-state.mjs`), the current task, one checkpoint per task (done filled, current highlighted) and the open count.
5. **REVIEW card** (only when RDD is on): the state `review due`, `reviewed` or `clear` (a `root` boundary is not assessed).
6. **GATE card**: a stacked bar of permission verdicts, allowed / asked (`you`, or `classifier` in `auto` mode) / pending / denied counts, `file`, `shell` and `other` bucket counts, the last denied tool with credential-like values masked, and the inline-write alert (a main-thread `Edit`, `Write`, `MultiEdit` or `NotebookEdit` outside `odd/tasks/`: the count and last path, error color). It only observes and never blocks.
7. **agents**: `agents · N running · M total`, one row per subagent (up to 6) with a status mark, its construct role (else the subagent type), a timeline bar placed on the session's time span and its duration; running clocks tick live where `Client` is available.
8. **last turn card**: duration of the running or last main-thread turn, agents, edits, errors and the cost added.
9. **session log**: a bordered `session log` with `HH:MM:SS` rows (who, what): agent spawned and done, denied tool, inline write, and ODD additions: the ODD task changed and the RDD state changed. The log is a bounded ring buffer; the first load writes no row.

**Refresh and fail-open.** Git, `odd-review`, `odd-assess`, and the feature documents are read only on `session.start` and after each main-thread `turn.complete`, in the background with a timeout, never on a redraw. The ODD task and RDD state log rows come from comparing two consecutive refreshes. Context, cost and the plan limits are read from the session usage on each redraw. The panel's own state is kept in a versioned `atom` fed from engine events (`agent.spawn`, `turn.start`, `turn.step`, `tool.call`, `tool.check`, `turn.complete`, `session.compact`); the panel redraws on those events, not per token. These hooks only observe: each passes its event on unchanged and swallows its own failures, and the model and effort routing is untouched. Any error leaves out the affected card and never blocks or delays a turn.

**Credit.** The drawing code (gauges, effort meter, timeline geometry, log rows, the animated rail and the elapsed clock) is adapted from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella, MIT License. The copyright and permission notice are in [`plugins/construct/LICENSE-flightdeck`](plugins/construct/LICENSE-flightdeck) and at the top of each adapted file.

## Theme: Construct

The plugin ships one color theme, **Construct**, in the style of *The Matrix*: phosphor green `#00FF41` for the accent, success, permissions, and the usage meter; deeper greens for borders, hints, and backgrounds; pale green text on near-black. Errors stay red and warnings yellow, so they still stand out. Select it with `/theme` (it is listed as from this plugin); the panel turns matrix green with it, since it colors with theme keys.

## Local development

Load the plugin for one session without installing it:

```bash
claude --plugin-dir ./plugins/construct
```

Validate the marketplace and the plugin:

```bash
claude plugin validate --strict .
claude plugin validate --strict ./plugins/construct
```

Run the tests:

```bash
node --test tests/                       # repository checks, odd-assess and odd-review tests
claude plugin test plugins/construct    # mod tests (*.test.ts)
```

Run the behavior evals (they spend real usage; each run is an isolated `claude -p` session):

```bash
scripts/eval.sh                 # all cases, 1 run per arm, sonnet
scripts/eval.sh --case small-delegated
```

`scripts/eval.sh` evaluates a temporary copy of the plugin without the `engram@engram` dependency, because isolated eval runs cannot resolve it and the plugin would not load.

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `construct`; allows the cross-marketplace `engram` dependency |
| `install.sh` | One-command installer (see [One-command install](#one-command-install)) |
| `plugins/construct/` | The plugin (manifest name `construct`) |
| `plugins/construct/agents/` | The 13 role agents |
| `plugins/construct/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, ...) |
| `plugins/construct/hooks/` | `hooks.json`, the mod (`register.js`), its routing helpers, the status modules (`status/`), the panel modules (`panel/`), and the command hooks (`scripts/`: contract, feature state, secret guard, review gate, review context and capture) |
| `plugins/construct/bin/` | Executable scripts put on the `PATH` (`odd-assess`) |
| `plugins/construct/lib/assess/` | `odd-assess` modules: git, stats, passive, signals, sinks, content, classify, escalation, output |
| `plugins/construct/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/construct/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/construct/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## License notice

Part of the agents and skills are adapted from MIT-licensed material; see [`plugins/construct/NOTICE`](plugins/construct/NOTICE).

## Status

Work in progress. The plan and task list live in [`odd/tasks/odd-skills-plugin.md`](odd/tasks/odd-skills-plugin.md).
