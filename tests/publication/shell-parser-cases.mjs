// T2 of .vault/tasks/shell-parser.md: the commands the real shell parser must see through (deny) and
// the idioms it must let pass (allow). `denyShapes(cmd, spelled)` hides one command in each shape:
// `cmd` is the plain text, `spelled` the same command with quoted pieces (`g"i"t pu"s"h`).
export const denyShapes = (cmd, spelled) => [...shapes(cmd, spelled), ...heredocShapes(cmd)]
const shapes = (cmd, spelled) => [
  `echo "$( (true); ${cmd} )"`,
  `echo "$( ( (true) ); ${cmd} )"`,
  `echo "$(case x in x) ${cmd};; esac)"`,
  `echo "$(case x in x) echo esac) ${cmd};; esac)"`,
  `echo "$(true #)\n${cmd})"`,
  `echo "$(echo \${x/)/}; ${cmd})"`,
  `echo "$(echo \${a:-'})'}; ${cmd})"`,
  `echo "$(echo \${a:-\\})}; ${cmd})"`,
  `echo "$(echo case 'a"b')"; ${cmd}`,
  `echo "$(echo case 'a"b')"; ${spelled}`,
  `echo "$(echo a\\ #)"; ${cmd}; echo "\n)"`,
  `echo '<<E'\n${cmd}\nE`,
  `cat <<<E\n${cmd}\nE`,
  `echo "<<E"\n${cmd}\nE`,
  `echo "$(cat <<\\EOF\n)\nEOF\n${cmd})"`,
]

// A heredoc body is a script unless proven data: these hand it to a shell through a compound command,
// a loop, or an enclosing substitution, and must be denied.
const heredocShapes = (cmd) => [
  `{ bash; } <<'E'\n${cmd}\nE`,
  `if true; then bash; fi <<'E'\n${cmd}\nE`,
  `while read l; do bash -c "$l"; done <<'E'\n${cmd}\nE`,
  `bash -c "$(cat <<'E'\n${cmd}\nE\n)"`,
  `bash <(cat <<'E'\n${cmd}\nE\n)`,
  `bash < <(cat <<'E'\n${cmd}\nE\n)`,
  `echo "$(cat <<'E'\n${cmd}\nE\n)" | bash`,
  `eval "$(cat <<'E'\n${cmd}\nE\n)"`,
  `source <(cat <<'E'\n${cmd}\nE\n)`,
  `. /dev/stdin <<'E'\n${cmd}\nE`,
  `{ bash; } <<< '${cmd}'`,
  // Bodies fed to a consumer the parser cannot prove is data are read best-effort: a body that parses is checked.
  `f() { bash; }; f <<'E'\n${cmd}\nE`,
  `alias c=bash\nc <<'E'\n${cmd}\nE`,
  `su -c bash <<'E'\n${cmd}\nE`,
  `busybox sh <<'E'\n${cmd}\nE`,
  `ssh host <<'E'\n${cmd}\nE`,
  `ssh host <<'E'\necho hi\n${cmd}\nE`,
  `ssh host <<'E'\ncat <<'F'\n${cmd}\nF\nE`,
]

// `esac` right after `in` closes the case, so the `)` ends the substitution and the rest is literal
// text inside the double quotes: bash 3.2.57 and zsh print it instead of running it. The spec listed
// this shape as a hidden command; it is data (L5), so every guard must let it pass.
export const dataShapes = (cmd) => [`echo "$(case x in esac) ${cmd};; esac)"`]

export const PUSH = ['git push origin feat', 'g"i"t pu"s"h origin feat']
export const NO_VERIFY = ['git commit -n -m x', 'g"i"t commit --no-ver"i"fy -m x']
export const NO_VERIFY_LONG = ['git commit --no-verify -m x', "g'i't commit --no-verify -m x"]
export const CAPTURE = ['node review-capture.mjs', 'n"o"de review-"c"apture.mjs']

const MESSAGE = "fix: add tests\n\ndon't touch the edge case\n(header only\n1) read 2) write"
export const allowIdioms = [
  `git commit -m "$(cat <<'EOF'\n${MESSAGE}\nEOF\n)"`,
  `gh pr create --body "$(cat <<'EOF'\n${MESSAGE}\nEOF\n)"`,
  'echo "$(grep -i case README.md)"',
  'VAR="$(git log --oneline | grep case)"',
  'echo "$(git branch --show-current)"',
  // A body that does not parse as shell, or holds no checked command, is data.
  `python3 <<'EOF'\nimport os\nprint("git push origin feat")\nfor x in range(3):\n    print(x)\nEOF`,
  `cat <<'EOF' > notes.md\nRemember to run git push after the review, and node review-capture.mjs is not for you.\nEOF`,
]

// Text a parser cannot read at all: every gate must deny it rather than guess.
// The last one is valid shell the parser reads, but `$'\U..'` is not a code point, so reading the word throws.
export const unparseable = ['echo "unterminated', 'echo $(git status', 'git status )', 'if true; then', "echo $'\\UFFFFFFFF'"]
