#!/bin/bash
# Construct installer: sets up the Construct plugin and merges the Construct
# settings into ~/.claude/settings.json. Safe to run again; a second run changes nothing.
#
#   curl -fsSL https://raw.githubusercontent.com/carsimax/construct/v12.0.1/install.sh | bash
#
# Runs under the macOS system bash (3.2): no associative arrays, no ${x,,}.
set -euo pipefail

MIN_CLAUDE=2.1.304
MIN_NODE=22.16
CONSTRUCT_REPO=carsimax/construct
CONSTRUCT_REF=v12.0.1 # the release this script belongs to; keep in step with the URL above
CONSTRUCT_PLUGIN=construct@construct

INSTALLED=""
SKIPPED=""
WARNINGS=""

usage() {
  cat <<'EOF'
Usage: install.sh [--no-mcp] [--force]

  --no-mcp  Deprecated: has no effect and will be removed in a later release.
  --force   Deprecated: has no effect and will be removed in a later release.
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
    fail "$HOME/.claude/settings.json cannot be read because a component of its path is not a directory, or its link loops, so nothing was installed; fix the path and run the installer again"
  fi
  [ "$rc" = 0 ] || fail "nothing was installed"
}

# Memory is Engram's: stop before anything is written when the binary or its Claude Code plugin is missing.
require_engram() {
  local msg="Construct needs Engram for memory; install it with: brew install gentleman-programming/tap/engram && engram setup claude-code"
  has engram || fail "$msg"
  [[ "$(run claude plugin list)" == *"engram@engram"* ]] || fail "$msg"
}

# Construct no longer uses CodeGraph; an existing CLI or MCP server is left alone, never removed.
note_codegraph() {
  if has codegraph; then
    say "codegraph is installed, but Construct no longer needs it; nothing was removed. To drop its MCP server: claude mcp remove --scope user codegraph"
  fi
}

add_marketplace() {
  local marketplaces
  marketplaces=$(run claude plugin marketplace list)
  if [[ "$marketplaces" == *"($1)"* || "$marketplaces" == *"($1#"* || "$marketplaces" == *"($1@"* ]]; then
    skipped "marketplace $1 (already added)"
    # Never change an existing install silently. A pinned ref blocks every update, and marketplace update does not move it.
    if [[ "$marketplaces" =~ \("$1"#([^\)]*)\) ]]; then
      warn "marketplace $1 is pinned to ${BASH_REMATCH[1]}, so plugin updates stay on it; to follow releases run: claude plugin marketplace remove construct, then claude plugin marketplace add $1, then claude plugin install $CONSTRUCT_PLUGIN"
    fi
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
    local have
    have=$(printf '%s\n' "$plugins" | awk -v id="$CONSTRUCT_PLUGIN" 'index($0, id) { f = 1; next } f && /❯/ { exit } f && /Version:/ { print $2; exit }')
    if [ -n "$have" ] && ! version_ge "$have" "${CONSTRUCT_REF#v}"; then
      skipped "$CONSTRUCT_PLUGIN (already installed, version $have)"
      warn "$CONSTRUCT_PLUGIN $have is installed but this installer is for ${CONSTRUCT_REF#v}; run: claude plugin update $CONSTRUCT_PLUGIN"
    else
      skipped "$CONSTRUCT_PLUGIN (already installed)"
    fi
  else
    say "Installing $CONSTRUCT_PLUGIN"
    run claude plugin install "$CONSTRUCT_PLUGIN"
    installed "$CONSTRUCT_PLUGIN"
  fi
}

# settings_tool MODE: "check" only validates ~/.claude/settings.json; "merge"
# prints one line per setting: "+ text" changed, "= text" already set,
# and "backup PATH" when the old file was saved.
settings_tool() {
  node - "$1" "$HOME/.claude/settings.json" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [mode, file] = process.argv.slice(2)
// Earlier versions set this theme; it is removed, and any other theme stays.
const OLD_THEME = 'custom:construct:construct'

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

if (mode === 'check') process.exit(0)

const lines = []
let changed = false
if (settings.theme === OLD_THEME) {
  delete settings.theme
  changed = true
  lines.push(`+ theme ${OLD_THEME} removed`)
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
  FORCE=0
  NO_MCP=0
  BACKUP=""
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-mcp) NO_MCP=1 ;; # deprecated no-op, kept so old install commands still work
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
  if [ "$FORCE" = 1 ]; then
    warn "--force is deprecated and has no effect; the installer no longer sets a theme"
  fi
  if [ "$NO_MCP" = 1 ]; then
    warn "--no-mcp is deprecated and has no effect; the installer no longer adds an MCP server"
  fi
  preflight
  require_engram
  note_codegraph
  add_marketplace "$CONSTRUCT_REPO"
  install_plugin
  merge_settings
  summary
}

main "$@"
