# Shell parser

Objective: replace the heuristic shell parsing in `shell-words.mjs` (used by publication-gate, command-guard, and review-store-guard) with one that neither hides commands nor denies common idioms. Branch: not started. Baseline: — . Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Parser rewrite.** "Si sigue con la recomendacion" / "si sigue" (recommendation: redo the parser as its own feature with a real shell parser, after five heuristic attempts in `odd/tasks/security-review.md` traded bypasses for false denials).
  - Parser: `mvdan-sh` 0.10.1 (mvdan/sh compiled with GopherJS, BSD-3-Clause), vendored as one file because the plugin ships no package.json. A parse error denies, as UndelimitedSubstitution does today. sh-syntax was dropped (L3).
  - Every case below is a test before any implementation.

### Must deny (hidden publication or verifier bypass; bash or zsh runs the hidden command)

- `echo "$( (true); git push origin feat )"` and `echo "$( ( (true) ); git push origin feat )"`
- `echo "$(case x in x) git push origin feat;; esac)"` and `echo "$(case x in x) echo esac) git push origin feat;; esac)"` (the second is a syntax error in bash and zsh, denied as unparseable)
- `echo "$(true #)` newline `git push origin feat)"`
- `echo "$(echo ${x/)/}; git push origin feat)"`, `echo "$(echo ${a:-'})'}; git push)"`, `echo "$(echo ${a:-\})}; git push)"`
- `echo "$(echo case 'a"b')"; git push origin feat` and the spelling `g"i"t pu"s"h`
- `echo "$(echo a\ #)"; git push; echo "` newline `)"`
- `echo '<<E'` newline `git push` newline `E`; `cat <<<E` newline `git push` newline `E`; `echo "<<E"` newline `git commit -n -m x` newline `E`
- `echo "$(cat <<\EOF` newline `)` newline `EOF` newline `git push origin feat)"`
- The same shapes with `git commit --no-verify` / `-n` for command-guard, and with `node review-capture.mjs` for review-store-guard.

### Must allow (common idioms)

- `echo "$(case x in esac) git push origin feat;; esac)"` (moved here from Must deny, L5): `esac` right after `in` closes the case, so the `)` ends the substitution and the rest is literal text; bash and zsh print it and run nothing.
- `git commit -m "$(cat <<'EOF'` newline `fix: add tests` newline `EOF` newline `)"`, including messages with `don't`, `edge case`, `(header only`, `1) read 2) write`
- `gh pr create --body "$(cat <<'EOF' ... EOF)"`
- `echo "$(grep -i case README.md)"`, `VAR="$(git log --oneline | grep case)"`, `echo "$(git branch --show-current)"`

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Choose the parser (user decision on the dependency) | user | none | done | — |
| T2 | S1 | Tests for every case above, then the parser, then a clean-context review-risk and review-resilience pass | worker | 2 | in-review | — |
| T3 | S1 | review-context omits the content of `plugins/construct/hooks/vendor/` paths (keeps them in the manifest, notes the sha256 pin) so the lenses can review T2 | worker | 2 | in-review | — |
| T4 | S1 | Heredoc bodies are data only when proven: fix the d8dc191 regressions found by an automated security review (heredoc on a compound command, heredoc reaching a shell through a substitution) and the fail-open on a non-parse exception in splitCommands | worker | 2 | in-review | — |
| T5 | S1 | Narrow the T3 omission (automated security review on 39d3d17): omit a vendored path's content only when it is listed with its sha256 in review-context.mjs and the head blob matches; any other path, including a new file under vendor/, keeps its full diff | worker | 2 | in-review | — |

## Log

- **L1 (2026-10-27):** opened from `odd/tasks/security-review.md` L8–L10; cases from the review-risk and review-resilience lens reports on 01111dc..2f73487.
- **L2 (2026-10-27):** T1. Candidates checked with `npm view`: sh-syntax 0.7.0 (MIT, no deps, ~800 KB, updated 2026-09); mvdan-sh 0.10.1 (deprecated, see mvdan/sh#1145); bash-parser 0.5.0 (unmaintained, many deps); shell-quote (a tokenizer only: no heredocs, case, or nested substitution); tree-sitter-bash (native addon, 20 MB). User chose sh-syntax. Not yet verified: its API, its WASM load time, and how it parses zsh-only syntax.
- **L3 (2026-10-27):** T2 probe (Node 26.12.1, scratchpad, nothing vendored). sh-syntax 0.7.0: import plus parse takes 10-15 ms, but its JSON AST stops at `Stmt`. `Cmd` carries only `Pos`/`End`, with no node type, args, or nested substitutions, so it cannot find a hidden `git push`. mvdan-sh 0.10.1 (1.5 MB, CommonJS): load takes about 25 ms and parse 5 ms. `syntax.Walk` + `NodeType` found the nested `git push` in the `case`, `<<\EOF`, and `${a:-'})'}` cases. Quoted words (`g"i"t`) need their parts joined, because `Lit()` is empty for them. T1 reopened: the dependency choice goes back to the user.
- **L4 (2026-10-27):** user chose mvdan-sh, accepting that it is deprecated upstream.
- **L5 (2026-10-27):** T2 worker. Vendored `mvdan-sh` 0.10.1 `index.js` unmodified as `hooks/vendor/mvdan-sh.cjs` (sha256 pinned in `tests/band-license.test.mjs`) with `LICENSE-mvdan-sh` and a NOTICE section. RED first: 92 new tests (`tests/publication/shell-parser*.mjs`, `tests/guard/shell-parser.test.mjs`) against the old code: 57 failed (every nested-paren, `case`, comment, `${...}`, `<<\EOF`, `echo '<<E'`, `<<<E` shape for all three hooks, plus the four unparseable inputs), 35 passed (the `g"i"t` spelling and the allow idioms already worked). Then `shell-words.mjs` rewritten on the parser: `splitCommands` walks the AST (nested commands, subshell parens, pipelines, here-strings, heredoc bodies); `extractHeredocs`, `closingParen`, `closingBacktick`, `substitutionBodies`, and the gate's `quoteSubstitutions`/`stripComments`/`views` are gone. A parse error throws `ShellParseError` and publication-gate, command-guard, and review-store-guard deny it (review-store-guard used to fail open). GREEN: 992 of 996 pass (the 3 extra are license tests). Decisions and conflicts, for the user:
  - **Spec correction.** `echo "$(case x in esac) git push origin feat;; esac)"` is not a hidden command: `esac` right after `in` closes the case, so the `)` ends the substitution and the rest is literal text. bash 3.2.57 and zsh both print it (`echo "$(case x in esac) echo HID;; esac)"` prints ` echo HID;; esac)`), and mvdan-sh agrees. It moved from Must deny to an allow test (`dataShapes`). `echo esac)` as a case body is a syntax error in bash and zsh, so it is denied as unparseable.
  - **Four existing tests in `tests/publication/publication.test.mjs` conflict with deny-on-parse-error and were left unchanged:** `denies: echo $(echo foo; git push origin feat` and `denies: echo $(echo ')'; git push origin feat` (still denied, but the reason is "could not be parsed", not the review state their `denied` helper matches), and `a non-publishing command with odd quoting stays silent` (its second line, an unterminated `$(`) and `a crash on a command that is no publication stays silent` (30000 nested `$(`) expect silence for unparseable text that mentions no publication. Open question: deny every unparseable command (current, per S1), or deny only when the text mentions a publication.
  - Cost: about 0.10 s per gate or guard call (node alone 0.06 s, the old code 0.06 s), so the 1.5 MB parser adds about 40 ms; it loads on the first parse.
  - Not covered, as before: brace expansion (`{git,push}`), aliases, variable-built names, interpreter one-liners. The README still calls `shell-words` a tokenizer (outside this unit's surfaces).

- **L6 (2026-10-27):** user chose to always deny an unparseable command. The four conflicting tests in `tests/publication/publication.test.mjs` now expect the "could not be parsed" deny (two renamed or split, each with a comment: bash runs the valid lines before a syntax error). The `esac` reclassification was accepted. `node --test 'tests/**/*.test.mjs'`: 996 tests, 996 pass, 0 fail. T2 is in-review.
- **L7 (2026-10-27):** T3 worker. `Review subject: faaefcc` failed with "passed the 409600 byte budget at path 11 of 16" because the unmodified 1.5 MB `hooks/vendor/mvdan-sh.cjs` is in the diff. `review-context.mjs` now omits the content of any path starting with the exact prefix `plugins/construct/hooks/vendor/` (paths from `git diff -z` are repository-relative), printing `vendored; content omitted; its sha256 is pinned by tests/band-license.test.mjs`; the path stays in name-status, numstat, and the manifest, so `subject_hash` still binds it. RED first: the new vendored-path test failed; the near-miss test (`scripts/vendor-x.mjs`, `tests/hooks/vendor/a.mjs`, `hooks/vendorx/`, `hooks/scripts/vendor/`) passed already, as a regression guard. GREEN: `node --test 'tests/**/*.test.mjs'`: 998 tests, 998 pass. Probe on a scratch copy of the hook with the pending-record write stubbed (nothing written under the git directory): base faaefcc now gives an allowed 72,131 byte context, path 11 showing the marker. Docs: `skills/review/SKILL.md` and `CLAUDE.md` describe the omission. T3 is in-review. Lenses no longer see later edits to vendored files; the sha256 pin test is the control for that.

- **L8 (2026-10-27):** an automated security review on d8dc191 found three regressions, all reproduced against publication-gate (faaefcc denied six heredoc shapes that d8dc191 allowed). T4 (3de15eb): a heredoc or here-string body is data only when proven, and any walk-time exception becomes ShellParseError; RED 43 failures, GREEN. A second automated review on 39d3d17 found the vendor-prefix omission too broad. T5: content is omitted only for an exact path whose head blob matches the sha256 pinned in review-context.mjs; RED 3 failures. `node --test 'tests/**/*.test.mjs'`: 1047/1047.

Next step: the review-risk and review-resilience lenses on faaefcc.
