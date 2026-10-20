# Migrating from gentle-ai to Construct

This guide moves a Claude Code setup managed by gentle-ai to the Construct plugin, keeping engram as an independent memory instance. Nothing here runs automatically: every step is a command you run and can check.

## Before you start

| Check | Command | Expected |
|---|---|---|
| Node.js 20 or later | `node --version` | `v20` or newer |
| engram binary | `engram --version` | a version |
| engram MCP server at user scope | `claude mcp list` | `engram` listed |
| engram marketplace and plugin | `claude plugin list` | `engram@engram` enabled |
| codegraph and context7 at user scope (optional) | `claude mcp list` | `codegraph`, `context7` listed |

If engram is missing, follow the README Quick path first. The Construct plugin will not load without `engram@engram`.

## What changes

| gentle-ai piece | Location | After migration |
|---|---|---|
| Orchestrator, routing, engram protocol, codegraph guidance, persona | `~/.claude/CLAUDE.md`, blocks `<!-- gentle-ai:* -->` | Removed. The plugin injects its contract per session, and engram injects its own protocol |
| Local model routing note | `~/.claude/CLAUDE.md`, block `<!-- local:odd-model-routing -->` | Removed. The plugin's mod routes each role's model and effort (`/config`) |
| Review, telemetry, and skill-registry hooks | `~/.claude/settings.json` `hooks`, commands starting `gentle-ai ` (5 entries) | Removed. The plugin ships its own hooks |
| Review and judgment-day agents | `~/.claude/agents/{review-*,jd-*}.md` | Removed. The plugin ships `construct:*` versions |
| Ported skills | `~/.claude/skills/{_shared,chained-pr,cognitive-doc-design,go-testing,judgment-day,skill-creator,skill-improver,skill-registry,work-unit-commits}` | Removed. The plugin ships `construct:*` versions |
| Neutral output style | `~/.claude/output-styles/neutral.md` | Removed after you select the plugin's Neutral style |
| RDD switch and review state | `~/.gentle-ai/state.json`, `gentle-ai review …` | Replaced by `odd-review mode` and `odd-review` |
| Skill registry files | `.atl/` in each project | No longer generated; safe to delete |

These stay exactly as they are:
- engram: binary, MCP server, plugin, hooks, and memories;
- your claude.ai synced skills in `~/.claude/skills/synced/`;
- other tools' hooks (for example Orca, herdr, and `codegraph prompt-hook`);
- `permissions`, `statusLine`, `enabledPlugins`, and every other `settings.json` key;
- the user-scope MCP servers.

## Quick path

### 1. Back up

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a ~/.claude ~/.claude.backup-$STAMP
cp ~/.claude.json ~/.claude.json.backup-$STAMP
```

### 2. Try the plugin side by side

Run one session with the plugin loaded from disk while gentle-ai is still installed:

```bash
claude --plugin-dir <path-to-odd_skills>/plugins/construct
```

Both rule sets are active in this session, which is fine for a trial. Check that `/agents` lists the `construct:` agents, and that the `/construct:` skills appear. Exit when satisfied.

### 3. Install the plugin

```bash
claude plugin marketplace add carsimax/construct
claude plugin install construct@construct
```

### 4. Keep what is personal

The `gentle-ai:persona` block holds two kinds of content:
- **Rules**, for example no `Co-Authored-By` and one question at a time. These are carried by the plugin's Neutral output style ("Working Rules").
- **Expertise**, which is personal and is not shipped by the plugin.

Copy any lines you want to keep before step 5:

```bash
sed -n '/<!-- gentle-ai:persona -->/,/<!-- \/gentle-ai:persona -->/p' ~/.claude/CLAUDE.md
```

### 5. Remove the managed `CLAUDE.md` blocks

Write the result to a new file, review it, then replace:

```bash
perl -0pe 's/<!-- ((?:gentle-ai:[\w-]+)|local:odd-model-routing)\b[^>]*-->.*?<!-- \/\1 -->\n*//gs' \
  ~/.claude/CLAUDE.md > ~/.claude/CLAUDE.md.new
diff ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.new | head -40
mv ~/.claude/CLAUDE.md.new ~/.claude/CLAUDE.md
```

The result keeps only content outside the managed blocks. If you had nothing else, it is empty; add back the lines you saved in step 4.

### 6. Remove the gentle-ai hooks from `settings.json`

This removes only hook entries whose command starts with `gentle-ai `. Every other key and every other hook stays:

```bash
jq '.hooks |= (with_entries(.value |= (map(.hooks |= map(select((.command // "") | test("^gentle-ai ") | not))) | map(select(.hooks | length > 0)))) | with_entries(select(.value | length > 0)))' \
  ~/.claude/settings.json > ~/.claude/settings.json.new
diff <(jq -S . ~/.claude/settings.json) <(jq -S . ~/.claude/settings.json.new)
mv ~/.claude/settings.json.new ~/.claude/settings.json
```

### 7. Remove the agents and skills the plugin now provides

```bash
rm ~/.claude/agents/review-{risk,readability,reliability,resilience,refuter}.md \
   ~/.claude/agents/jd-{judge-a,judge-b,fix-agent}.md \
   ~/.claude/agents/.gentle-ai-native-agent-ownership.json
rm -r ~/.claude/skills/{_shared,chained-pr,cognitive-doc-design,go-testing,judgment-day,skill-creator,skill-improver,skill-registry,work-unit-commits}
```

Do not remove `~/.claude/skills/synced/`; it holds your claude.ai skills.

### 8. Switch the output style and the theme

1. In `/config`, set **Output style** to the plugin's Neutral style.
2. Remove the old file: `rm ~/.claude/output-styles/neutral.md`.
3. Optionally, set the theme to `odd` with `/theme`. You can then remove `~/.claude/themes/gentleman*.json` if you no longer use them.

### 9. Remove the gentle-ai binary and state

Only do this after the checks below pass:

```bash
brew uninstall gentle-ai
rm -r ~/.gentle-ai
```

Do not run `gentle-ai uninstall --all` or `gentle-ai uninstall --agent claude-code`. Its installed components include `engram` and `context7`, so a blanket uninstall can remove their registrations. The manual steps above leave them in place.

Each project may still hold a `.atl/` directory (skill registry). It is no longer generated, and you can delete it.

## Checks

| Check | How | Expected |
|---|---|---|
| Plugins enabled | `claude plugin list` | `construct@construct` and `engram@engram` enabled |
| Contract loads | Start a session and ask "what does your Construct contract say about Risk lines?" | It quotes the `Risk: item N` rule |
| Agents | `/agents` | `construct:odd-worker`, `construct:review-risk`, … |
| Model routing | `/config` | `ODD Worker model` and the other role rows |
| RDD switch | `odd-review mode status` in a repository | `{"mode":"on","source":"default"}` (or your setting) |
| Secret guard | In a scratch directory with a dummy `.env`, ask Claude to read it | The read is denied by `secret-guard` |
| Memory | Ask Claude to run `mem_context` | engram answers |
| No leftovers | the two commands below | `0` and `[]` |

No leftovers:

```bash
grep -c 'gentle-ai' ~/.claude/CLAUDE.md
jq '[.hooks[][].hooks[].command] | map(select(test("^gentle-ai ")))' ~/.claude/settings.json
```

## Roll back

Restore the backup from step 1:

```bash
claude plugin uninstall construct@construct
rm -rf ~/.claude && cp -a ~/.claude.backup-$STAMP ~/.claude
cp ~/.claude.json.backup-$STAMP ~/.claude.json
```

If gentle-ai is still installed, `gentle-ai restore --list` and `gentle-ai restore latest` restore its own snapshots instead.
