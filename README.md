# odd_skills

odd_skills is a Claude Code plugin for Organic Driven Development (ODD). It ships orchestration rules, review lenses, and delivery skills as plugin components only: agents, skills, hooks, mods, workflows, and output styles. Engram stays an independent memory instance; this plugin depends on it.

## Requirements

- Claude Code with plugin support.
- Node.js 20 or later for the plugin's scripts and hooks (`bin/odd-assess`, and the hook scripts as they land). Claude Code's native install does not bundle Node.js.
- `git` on the PATH for `odd-assess`.
- The engram binary and marketplace (see Quick path).

## Quick path

1. Install the engram binary and register its MCP server:

   ```bash
   brew install gentleman-programming/tap/engram
   engram setup claude-code
   ```

2. Add the engram marketplace first. odd_skills declares `engram@engram` as a dependency, and the dependency resolves only from a marketplace you have already added:

   ```bash
   claude plugin marketplace add Gentleman-Programming/engram
   ```

3. Add this marketplace and install the plugin:

   ```bash
   claude plugin marketplace add <path-or-repo-of-odd_skills>
   claude plugin install odd-skills@odd-skills
   ```

   The install output ends with `(+ 1 dependency: engram)` when engram was not installed yet.

## How the ODD contract loads

A plugin cannot ship a `CLAUDE.md`, so odd_skills loads its rules in three layers:

| Layer | Mechanism | Content |
|---|---|---|
| Session contract | `SessionStart` hook (startup, resume, clear, compact) | ODD protocol, task size, high-risk list, Risk line, and delegation triggers, under 8,000 characters |
| Subagent contract | `SubagentStart` hook | Artifact language, edit surfaces, scratch, and the `## Key Learnings` closing block. JSON-only reviewers (`review-*`, `jd-judge-*`) get nothing |
| Skills | Loaded on demand | `odd-workflow`, `odd-delegation`, `task-size-risk`, `lossless-prompts` |
| Output style | `/config` → Output style → `Neutral` | Reply tone, language, response length, verification, and working rules (no AI attribution in commits, one question at a time) |

The contract texts live in `plugins/odd-skills/hooks/contract/`.

After a compaction or a resume, a second `SessionStart` hook (matcher `compact|resume`) re-injects the active feature state. It reads `odd/tasks/*.md` under the project root and, for up to three documents with unfinished tasks (newest first), emits the path, title, branch line, unfinished task rows, and the last `Next step:` from the log, in at most 2,500 characters. It is read-only and prints nothing when no document is active. Task-to-document sync hooks were dropped: native tasks have no link to the document's `T#` rows, so a hook could corrupt the feature document. The orchestrator keeps the document current, and the re-injection tells it where it was.

## MCP servers

The plugin ships no MCP servers, so it never duplicates servers you already registered (duplicates would load every tool twice). The agents and the `codegraph` skill expect these user-scope servers; register them once:

```bash
claude mcp add --scope user codegraph -- codegraph serve --mcp
claude mcp add --scope user context7 -- npx -y --package=@upstash/context7-mcp@2.2.5 -- context7-mcp
```

Engram's MCP server comes from `engram setup claude-code` (see Quick path).

## Agents and model routing

The plugin ships 13 agents. Each role's model and effort can be changed in `/config`, where every option appears as a row such as `ODD Worker model` or `RDD Risk effort`.

| Role | Agent | Model | Effort |
|---|---|---|---|
| ODD Explorer | `odd-skills:odd-explorer` | haiku | default |
| ODD Worker | `odd-skills:odd-worker` | sonnet | medium |
| ODD Verify | `odd-skills:odd-verify` | opus | medium |
| JD Judge A | `odd-skills:jd-judge-a` | opus | medium |
| JD Judge B | `odd-skills:jd-judge-b` | sonnet | medium |
| JD Fix Agent | `odd-skills:jd-fix-agent` | sonnet | medium |
| RDD Risk | `odd-skills:review-risk` | opus | medium |
| RDD Readability | `odd-skills:review-readability` | sonnet | medium |
| RDD Reliability | `odd-skills:review-reliability` | sonnet | medium |
| RDD Resilience | `odd-skills:review-resilience` | sonnet | medium |
| RDD Refuter | `odd-skills:review-refuter` | opus | medium |
| RDD Validator | `odd-skills:review-validator` | opus | medium |
| General delegation | `odd-skills:odd-general` and the built-in `general-purpose` | sonnet | medium |

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
| `--json` | Print the `odd-skills.review-assessment/v1` object instead of a short summary |

Without `--base-ref`, the candidate is the working tree (tracked plus untracked, not ignored), frozen through a temporary index. Your real index is never changed.

The JSON result has `risk` (`passive`, `medium`, `high`), `reasons`, `changed_paths`, `changed_lines`, `candidate`, `review_due`, `review_due_reason`, and `lenses` (empty for passive and medium, the four canonical lenses for high). Only `high` makes a review due; `medium` reports `under_budget` and `passive` reports `passive`. When the exact candidate already has a receipt from `odd-review acknowledge`, `candidate.consumed` is `true` and the result reports `review_due: false` with `review_due_reason: "already_reviewed"`, whatever the tier.

Exit codes: `0` for any successful assessment, including a fail-closed one (`risk: "high"` with one `unassessable` reason, for example when `--base-ref` names a missing ref); `2` for bad usage, with the message on stderr.

## Review lifecycle (`odd-review`)

`bin/odd-review` runs the review lifecycle without any external binary: it freezes the candidate, serves immutable evidence to the review agents, validates their results, drives one bounded correction, and records a receipt. It never asks for consent; that belongs to the review skill.

```bash
odd-review start --lenses risk,reliability --lenses-reason "touches the login guard"   # or --base-ref main --committed-only
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
- Lenses are `review-risk`, `review-resilience`, `review-readability`, and `review-reliability`; the short names work and the canonical order is kept.
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

- The switch is on by default. Precedence is the clone file (`<git-common-dir>/odd-review/mode.json`), then the global file (`${XDG_CONFIG_HOME:-$HOME/.config}/odd-skills/rdd.json`), then the default. An unreadable file is skipped. Writes are atomic.
- `boundary` is the start of the next committed range: among the receipts whose `candidate_commit` is an ancestor of (or equal to) `HEAD`, the one closest to `HEAD` by ancestry (ties go to the newest acknowledgement, so reviewing an older commit later never moves the boundary back), else the merge-base with the default branch (the first of `origin/HEAD`, `main`, `master`, `origin/main`, `origin/master` that resolves and differs from `HEAD`), else the root commit. Receipts of committed-mode reviews record `candidate_commit` (and `base_commit` when `--base-ref` names a commit); older receipts without them stay valid and are ignored by `boundary`.
- The plugin's `Stop` hook (`hooks/scripts/review-gate.mjs`) assesses any uncommitted changes, and `boundary..HEAD` when the boundary comes from a receipt or a merge-base. A root boundary (for example the default branch of an existing repository with no receipts) never opens a committed range, so the gate does not review a whole history. When one is `high`, has no receipt, and was not yet reminded in this session, it blocks the stop once with the range, up to three reasons, and the next step (load `odd-skills:rdd-review`, ask for consent, or skip). Reminders are kept per session under `${CLAUDE_PLUGIN_DATA}/review-gate/`; without `CLAUDE_PLUGIN_DATA` they go to a private `odd-skills-<uid>` directory in the system temp dir, which must be owned by the user with no group or other access (otherwise the gate stays silent). It does nothing when the switch is off, outside a repository, in a repository without commits, or when `stop_hook_active` is set, and it fails open on any error.

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

## Status band (mod)

The mod draws a band above the prompt (`AbovePrompt`, which holds a multi-row tree; `PromptHint` is a single text line). It needs Claude Code 2.1.304 or later and does not appear in `claude -p` runs, which draw no interface.

What it shows, top to bottom:

1. **Budget line** (replica): context window, 5-hour and 7-day plan limits as 8-cell meters (green below 50%, yellow below 80%, red above), each limit with its reset (`↻HH:MM`, and `↻Day HH:MM` for 7d).
2. **Where line** (replica): `~`-shortened directory, git state (`⎇ branch`, `±dirty`, `↑ahead`, `↓behind`, `wt:<worktree>`), `◆ model effort`, `✎ output style`, and `@agent`. Segments are joined by a dim `│`.
3. **ODD line**: the active feature document (newest `odd/tasks/*.md` with a task whose status is not `done` or `dropped`, the rule of `feature-state.mjs`) and its open task count.
4. **RDD line**: the switch (`RDD on` or `RDD off`) and, when on, `review due` (the committed range since `odd-review boundary`, or the uncommitted changes, classify high and have no receipt), `reviewed`, or `clear`. A `root` boundary is not assessed.

**When the replica is hidden.** The two replica lines are drawn only when your merged settings have no `statusLine`; with one, they would show everything twice. The ODD and RDD lines are always drawn. The band yields to a survey.

**Data gaps.** The mods API has no source for these fields of a statusline script, so the band leaves them out: lines added and removed, PR number and state, and vim mode. Other fields differ from a statusline's:

- The model is the id `$.session.model()` returns, not a display name.
- Effort is the one seen on the main thread's last request, so it appears after the first turn.
- Output style and agent come from your settings (`outputStyle`, `agent`), not from a flag.
- The worktree name comes from git.
- Resets and meters are omitted when the figure is missing, for example off a subscription.

**Refresh and fail-open.** Git, `odd-review`, `odd-assess`, and the feature documents are read only on `session.start` and after each main-thread `turn.complete`, in the background with a timeout, never on a redraw. Every hook has a `.catch`; any error leaves out the affected segment (or the whole band) and never blocks or delays a turn.

## Local development

Load the plugin for one session without installing it:

```bash
claude --plugin-dir ./plugins/odd-skills
```

Validate the marketplace and the plugin:

```bash
claude plugin validate --strict .
claude plugin validate --strict ./plugins/odd-skills
```

Run the tests:

```bash
node --test tests/                       # repository checks, odd-assess and odd-review tests
claude plugin test plugins/odd-skills    # mod tests (*.test.ts)
```

Run the behavior evals (they spend real usage; each run is an isolated `claude -p` session):

```bash
scripts/eval.sh                 # all cases, 1 run per arm, sonnet
scripts/eval.sh --case small-inline
```

`scripts/eval.sh` evaluates a temporary copy of the plugin without the `engram@engram` dependency, because isolated eval runs cannot resolve it and the plugin would not load.

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `odd-skills`; allows the cross-marketplace `engram` dependency |
| `plugins/odd-skills/` | The plugin (manifest name `odd-skills`) |
| `plugins/odd-skills/agents/` | The 13 role agents |
| `plugins/odd-skills/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, ...) |
| `plugins/odd-skills/hooks/` | `hooks.json`, the mod (`register.js`), its routing helpers, and the status band modules (`status/`) |
| `plugins/odd-skills/bin/` | Executable scripts put on the `PATH` (`odd-assess`) |
| `plugins/odd-skills/lib/assess/` | `odd-assess` modules: git, stats, passive, signals, sinks, content, classify, escalation, output |
| `plugins/odd-skills/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/odd-skills/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/odd-skills/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## License notice

Part of the agents and skills are adapted from MIT-licensed material; see [`plugins/odd-skills/NOTICE`](plugins/odd-skills/NOTICE).

## Status

Work in progress. The plan and task list live in [`odd/tasks/odd-skills-plugin.md`](odd/tasks/odd-skills-plugin.md).
