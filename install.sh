#!/bin/bash
# Construct installer: sets up engram, the Construct plugin, the optional
# codegraph MCP server, and merges the Construct settings into
# ~/.claude/settings.json. Safe to run again; a second run changes nothing.
#
#   curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v0.1.0/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --no-mcp --force
#
# Runs under the macOS system bash (3.2): no associative arrays, no ${x,,}.
set -euo pipefail

MIN_CLAUDE=2.1.304
MIN_NODE=20
ENGRAM_FORMULA=gentleman-programming/tap/engram
ENGRAM_REPO=Gentleman-Programming/engram
CONSTRUCT_REPO=carsimax/construct
CONSTRUCT_PLUGIN=construct@construct
CODEGRAPH_PACKAGE=@colbymchenry/codegraph

INSTALLED=""
SKIPPED=""
WARNINGS=""

usage() {
  cat <<'EOF'
Usage: install.sh [--no-mcp] [--force]

  --no-mcp  Skip the codegraph CLI and the codegraph MCP server.
  --force   Replace an existing theme in ~/.claude/settings.json.
EOF
}

say() { printf '==> %s\n' "$*"; }
fail() {
  printf 'construct-install: %s\n' "$*" >&2
  exit 1
}
installed() { INSTALLED="$INSTALLED  - $*"$'\n'; }
skipped() { SKIPPED="$SKIPPED  - $*"$'\n'; }
warn() {
  printf 'warning: %s\n' "$*" >&2
  WARNINGS="$WARNINGS  - $*"$'\n'
}

# Every external command reads /dev/null: under `curl | bash` stdin is the script.
run() { "$@" </dev/null; }
has() { command -v "$1" >/dev/null 2>&1; }

# version_ge A B: true when dotted version A >= B.
version_ge() {
  local IFS=.
  local -a a=($1) b=($2)
  local i x y
  for i in 0 1 2; do
    x=${a[i]:-0} y=${b[i]:-0}
    x=${x%%[!0-9]*} y=${y%%[!0-9]*}
    if ((${x:-0} > ${y:-0})); then return 0; fi
    if ((${x:-0} < ${y:-0})); then return 1; fi
  done
}

# check_writable: the merge needs to write ~/.claude and settings.json (through
# a symlink, to its target); say so before any change instead of failing later.
check_writable() {
  local dir="$HOME/.claude" file="$HOME/.claude/settings.json" target
  if [ -e "$dir" ] && [ ! -w "$dir" ]; then
    fail "$dir exists but is not writable, so nothing was installed; fix its permissions and run the installer again"
  fi
  if [ -d "$file" ]; then
    fail "$file is a directory, not a file, so nothing was installed; move it away and run the installer again"
  fi
  if [ -e "$file" ]; then
    target=$(node -p 'require("fs").realpathSync(process.argv[1])' "$file" 2>/dev/null) || target=$file
    if [ ! -w "$target" ]; then
      fail "$file is not writable, so nothing was installed; fix its permissions and run the installer again"
    fi
  fi
}

preflight() {
  has claude || fail "Claude Code (claude) is not on the PATH. Install it from https://claude.com/claude-code"
  local version
  version=$(run claude --version | awk '{print $1}')
  version_ge "$version" "$MIN_CLAUDE" || fail "Claude Code $version is too old; Construct needs $MIN_CLAUDE or later. Run: claude update"
  has node || fail "Node.js $MIN_NODE or later is required (node is not on the PATH). See https://nodejs.org"
  version=$(run node -p 'process.versions.node')
  version_ge "$version" "$MIN_NODE" || fail "Node.js $version is too old; Construct needs $MIN_NODE or later"
  has git || fail "git is required and is not on the PATH"
  check_writable
  local rc=0
  settings_tool check || rc=$?
  if [ "$rc" = 4 ]; then
    fail "$HOME/.claude/settings.json is a symlink loop or a link through a path that is not a directory, so nothing was installed; fix the link and run the installer again"
  fi
  [ "$rc" = 0 ] || fail "nothing was installed"
  if ! has engram; then
    has brew || fail "engram is not installed and Homebrew (brew) is not available to install it. See https://brew.sh"
  fi
  if [ "$WITH_MCP" = 1 ] && ! has codegraph; then
    has npm || fail "npm is required to install the codegraph CLI (or pass --no-mcp)"
  fi
}

setup_engram() {
  if has engram; then
    skipped "engram binary (already installed)"
  else
    say "Installing the engram binary"
    run brew install "$ENGRAM_FORMULA"
    installed "engram binary"
  fi
  local plugins
  plugins=$(run claude plugin list)
  if [[ "$plugins" == *"engram@engram"* ]] && run claude mcp get engram >/dev/null 2>&1; then
    skipped "engram setup (plugin and MCP server present)"
  else
    say "Registering engram with Claude Code"
    run engram setup claude-code
    installed "engram setup claude-code"
  fi
}

add_marketplace() {
  local marketplaces
  marketplaces=$(run claude plugin marketplace list)
  if [[ "$marketplaces" == *"($1)"* ]]; then
    skipped "marketplace $1 (already added)"
  else
    say "Adding the $1 marketplace"
    run claude plugin marketplace add "$1"
    installed "marketplace $1"
  fi
}

install_plugin() {
  local plugins
  plugins=$(run claude plugin list)
  if [[ "$plugins" == *"$CONSTRUCT_PLUGIN"* ]]; then
    skipped "$CONSTRUCT_PLUGIN (already installed)"
  else
    say "Installing $CONSTRUCT_PLUGIN"
    run claude plugin install "$CONSTRUCT_PLUGIN"
    installed "$CONSTRUCT_PLUGIN"
  fi
}

# add_mcp NAME COMMAND...: registers a user-scope MCP server unless it exists.
add_mcp() {
  local name=$1
  shift
  if run claude mcp get "$name" >/dev/null 2>&1; then
    skipped "MCP server $name (already registered)"
  else
    say "Registering the $name MCP server"
    run claude mcp add --scope user "$name" -- "$@"
    installed "MCP server $name"
  fi
}

setup_mcp() {
  if [ "$WITH_MCP" = 0 ]; then
    skipped "codegraph MCP server (--no-mcp)"
    return
  fi
  if has codegraph; then
    skipped "codegraph CLI (already installed)"
  else
    say "Installing the codegraph CLI"
    # Optional: a failure here must not stop the settings merge that follows.
    if ! run npm install -g "$CODEGRAPH_PACKAGE"; then
      warn "npm install -g $CODEGRAPH_PACKAGE failed, so the codegraph MCP server was skipped; fix npm's global prefix and rerun, or rerun with --no-mcp"
      return
    fi
    installed "codegraph CLI"
  fi
  add_mcp codegraph codegraph serve --mcp
}

# settings_tool MODE: "check" only validates ~/.claude/settings.json; "merge"
# prints one line per setting: "+ text" changed, "= text" already set,
# "! text" kept a different value, "backup PATH" when the old file was saved.
settings_tool() {
  node - "$1" "$HOME/.claude/settings.json" "$FORCE" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [mode, file, force] = process.argv.slice(2)
const WANT = { theme: 'custom:construct:construct' }
const ALLOW = ['mcp__engram', 'mcp__plugin_engram_engram']

let text = null
try {
  text = fs.readFileSync(file, 'utf8')
} catch (error) {
  if (error.code === 'ELOOP' || error.code === 'ENOTDIR') {
    process.exit(4)
  }
  if (error.code !== 'ENOENT') throw error
}
let settings = {}
// An empty or whitespace-only file counts as {}.
if (text !== null && text.trim() !== '') {
  try {
    settings = JSON.parse(text)
  } catch (error) {
    console.error(`${file} is not valid JSON (${error.message}); fix it and run the installer again`)
    process.exit(3)
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    console.error(`${file} does not hold a JSON object; fix it and run the installer again`)
    process.exit(3)
  }
}

const permissions = settings.permissions ?? {}
const allow = permissions.allow ?? []
if (typeof permissions !== 'object' || Array.isArray(permissions) || !Array.isArray(allow)) {
  console.error(`${file} has a permissions.allow that is not a list; fix it and run the installer again`)
  process.exit(3)
}
if (mode === 'check') process.exit(0)

const lines = []
let changed = false
for (const [key, value] of Object.entries(WANT)) {
  if (settings[key] === value) {
    lines.push(`= ${key} is ${value}`)
  } else if (settings[key] !== undefined && force !== '1') {
    lines.push(`! ${key} stays ${JSON.stringify(settings[key])}; rerun with --force to use ${value}`)
  } else {
    settings[key] = value
    changed = true
    lines.push(`+ ${key} set to ${value}`)
  }
}
const missing = ALLOW.filter((rule) => !allow.includes(rule))
if (missing.length) {
  settings.permissions = { ...permissions, allow: [...allow, ...missing] }
  changed = true
  lines.push(`+ permissions.allow gained ${missing.join(', ')}`)
} else {
  lines.push('= permissions.allow has the engram MCP servers')
}

if (changed) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (text !== null) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*/, '')
    let backup = `${file}.bak-${stamp}`
    for (let n = 1; fs.existsSync(backup); n++) backup = `${file}.bak-${stamp}-${n}`
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
    lines.push(`backup ${backup}`)
  }
  // Write through a symlink to its target and keep the file's mode, so a
  // dotfiles link or a 0600 file survives the atomic rename.
  // A dangling symlink has no realpath: follow its chain by hand so the write
  // creates the target and the link stays a link.
  let target = file
  if (text !== null) target = fs.realpathSync(file)
  else {
    for (let hops = 0; hops < 40 && fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink(); hops++) {
      target = path.resolve(path.dirname(target), fs.readlinkSync(target))
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
  }
  const mode = text === null ? 0o644 : fs.statSync(target).mode & 0o777
  const temp = `${target}.construct-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { mode })
  fs.chmodSync(temp, mode)
  fs.renameSync(temp, target)
}
console.log(lines.join('\n'))
NODE
}

merge_settings() {
  say "Merging the Construct settings into ~/.claude/settings.json"
  local out line
  out=$(settings_tool merge) || fail "the settings merge failed; ~/.claude/settings.json was not changed"
  while IFS= read -r line; do
    case "$line" in
      "+ "*) installed "setting: ${line#+ }" ;;
      "= "*) skipped "setting: ${line#= }" ;;
      "! "*) warn "${line#! }" ;;
      "backup "*) BACKUP=${line#backup } ;;
    esac
  done <<<"$out"
}

summary() {
  echo
  if [ -n "$INSTALLED" ]; then printf 'Installed:\n%s' "$INSTALLED"; fi
  if [ -n "$SKIPPED" ]; then printf 'Skipped:\n%s' "$SKIPPED"; fi
  if [ -n "$WARNINGS" ]; then printf 'Warnings:\n%s' "$WARNINGS"; fi
  if [ -n "$BACKUP" ]; then printf 'Backup of your previous settings: %s\n' "$BACKUP"; fi
  echo
  echo "Done. Open Claude Code in a git repository and run /agents to see the construct: agents."
}

main() {
  WITH_MCP=1
  FORCE=0
  BACKUP=""
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-mcp) WITH_MCP=0 ;;
      --force) FORCE=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        printf 'construct-install: unknown option %s\n' "$arg" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
  preflight
  setup_engram
  add_marketplace "$ENGRAM_REPO"
  add_marketplace "$CONSTRUCT_REPO"
  install_plugin
  setup_mcp
  merge_settings
  summary
}

main "$@"
