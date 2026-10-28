// T2 of odd/tasks/shell-parser.md: the commands the real shell parser must see through (deny) and
// the idioms it must let pass (allow). `denyShapes(cmd, spelled)` hides one command in each shape:
// `cmd` is the plain text, `spelled` the same command with quoted pieces (`g"i"t pu"s"h`).
export const denyShapes = (cmd, spelled) => [
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
]

// Text a parser cannot read at all: every gate must deny it rather than guess.
export const unparseable = ['echo "unterminated', 'echo $(git status', 'git status )', 'if true; then']
