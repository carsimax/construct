# Shell parser

Objective: replace the heuristic shell parsing in `shell-words.mjs` (used by publication-gate, command-guard, and review-store-guard) with one that neither hides commands nor denies common idioms. Branch: not started. Baseline: — . Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Parser rewrite.** "Si sigue con la recomendacion" / "si sigue" (recommendation: redo the parser as its own feature with a real shell parser, after five heuristic attempts in `odd/tasks/security-review.md` traded bypasses for false denials).
  - Open: which parser. A new dependency needs the user's OK (CLAUDE.md).
  - Every case below is a test before any implementation.

### Must deny (hidden publication or verifier bypass; bash or zsh runs the hidden command)

- `echo "$( (true); git push origin feat )"` and `echo "$( ( (true) ); git push origin feat )"`
- `echo "$(case x in x) git push origin feat;; esac)"`, `echo "$(case x in x) echo esac) git push origin feat;; esac)"`, `echo "$(case x in esac) git push origin feat;; esac)"`
- `echo "$(true #)` newline `git push origin feat)"`
- `echo "$(echo ${x/)/}; git push origin feat)"`, `echo "$(echo ${a:-'})'}; git push)"`, `echo "$(echo ${a:-\})}; git push)"`
- `echo "$(echo case 'a"b')"; git push origin feat` and the spelling `g"i"t pu"s"h`
- `echo "$(echo a\ #)"; git push; echo "` newline `)"`
- `echo '<<E'` newline `git push` newline `E`; `cat <<<E` newline `git push` newline `E`; `echo "<<E"` newline `git commit -n -m x` newline `E`
- `echo "$(cat <<\EOF` newline `)` newline `EOF` newline `git push origin feat)"`
- The same shapes with `git commit --no-verify` / `-n` for command-guard, and with `node review-capture.mjs` for review-store-guard.

### Must allow (common idioms)

- `git commit -m "$(cat <<'EOF'` newline `fix: add tests` newline `EOF` newline `)"`, including messages with `don't`, `edge case`, `(header only`, `1) read 2) write`
- `gh pr create --body "$(cat <<'EOF' ... EOF)"`
- `echo "$(grep -i case README.md)"`, `VAR="$(git log --oneline | grep case)"`, `echo "$(git branch --show-current)"`

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Choose the parser (user decision on the dependency) | user | none | pending | — |
| T2 | S1 | Tests for every case above, then the parser, then a clean-context review-risk and review-resilience pass | worker | 2 | pending | — |

## Log

- **L1 (2026-10-27):** opened from `odd/tasks/security-review.md` L8–L10; cases from the review-risk and review-resilience lens reports on 01111dc..2f73487.

Next step: T1.
