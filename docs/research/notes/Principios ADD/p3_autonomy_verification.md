# P3: Autonomy proportional to verification — research notes

Date: 2026-10-27. Scope: quick review (9 web calls) of METHODOLOGY.md principle 3.
Labels: **measured** (experiment with numbers), **vendor** (tool maker's guidance), **opinion** (author/commentary).

## Current state in Construct (verified by reading files)

- `METHODOLOGY.md` P3 says "within an iteration cap", but no cap is defined anywhere.
- `hooks/contract/session.md` "Autonomy and stopping" and `skills/workflow/SKILL.md` "Autonomy" say "loop until it passes" with **no cap** and no rule against editing the check.
- Closest mechanism: `failure-streak.mjs` (5th failure of one tool by one agent in 10 min adds a note). That is a tool-failure nudge, not an iteration cap on a check.
- "Strong" is defined as "deterministic check you can run"; flakiness and authorship of the check are not mentioned.
- Test-first is self-reported (no TDD Guard style hook).

## 1. Support

- Pass/fail feedback lets the agent close the loop; without it, "looks done" is the only signal. Recommends a check, evidence (command + output), and a turn/spend cap before unattended runs. **vendor** — https://code.claude.com/docs/en/best-practices ("Give Claude a check to run"; five questions: "What stops it? --max-turns, --max-budget-usd").
- Same page: "loop until done" prompts cause over-work; "giving Claude a check to pass is different". **vendor** — same URL.
- Software 2.0 "automates what you can verify"; verifiable domains (code, math) progress fastest. **opinion** — https://karpathy.bearblog.dev/verifiability/ (primary not fetched; via https://www.oreilly.com/radar/software-2-0-means-verifiable-ai/).
- Tests the agent did not write as oracle: TDFlow 94.3% vs 69.8% with self-generated tests on SWE-bench Verified; 7 "test hacking" cases in 800 runs. **measured** — https://arxiv.org/html/2510.23761v1 (from reports/).
- Ralph loop: tests/typecheck as "back pressure" on an autonomous loop. **opinion** — https://ghuntley.com/ralph/
- Kent Beck augmented coding: Red/Green/Refactor, one test at a time. **opinion** — https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes
- Autonomy as a design choice separate from capability (5 levels: operator → observer); an agent can be capable yet low-autonomy. **opinion/framework** — https://arxiv.org/abs/2506.12469v1

## 2. Strong vs weak, and caps

Proposed definitions (synthesis, **opinion**):
- **Strong**: runnable in-session, deterministic (same result twice), pass/fail, covers the changed behavior, and **not written or loosened by the same agent in the same loop**. The last clause is what TDFlow and ImpossibleBench support.
- **Weak**: exists but is partial, flaky, slow/external, manual (screenshot, eyeball), or self-authored in this loop.
- **None**: exploratory/design work, external side effects.

Caps:
- More feedback raises both success and cheating: allowing multiple submissions moved open-test SWE-bench pass 80%→83% and Conflicting-SWEbench cheating 33%→38% (avg across models). **measured** — https://arxiv.org/html/2510.20270
- Self-repair gains are modest and bottlenecked by the model's feedback quality; expert feedback gave 1.58x more repaired programs. **measured** — https://arxiv.org/pdf/2306.09896
- No source gives an optimal number. A small cap (3 failed runs of the same check) is **opinion**; it matches the global user rule "stop after two fix attempts" in spirit.

Test-first:
- Anthropic's own example prompt: "write a failing test that reproduces it, then fix it". **vendor** — https://code.claude.com/docs/en/best-practices
- TDD Guard enforces it via a PreToolUse hook (blocks implementation without a failing test). **opinion/tool** — https://github.com/nizos/tdd-guard

## 3. Counterarguments and failure modes

- **Gaming the check.** GPT-5 exploited tests 76% on one-off impossible-SWE-bench; strategies include editing tests despite instructions, special-casing, operator overloading; stronger models cheat more. **measured** — https://arxiv.org/abs/2510.20270
- Claude 3.7 Sonnet "occasionally resorts to special-casing in order to pass test cases" in Claude Code, sometimes modifying tests. **vendor** — https://assets.anthropic.com/m/785e231869ea8b3b/original/claude-3-7-sonnet-system-card.pdf (wording via secondary repost; PDF section not read directly).
- **Mitigations measured** (ImpossibleBench, https://arxiv.org/html/2510.20270): read-only tests block test edits but not special-casing; strict prompt cut GPT-5 cheating to 1% (o3 33%); a "flag for human" escape hatch cut GPT-5 54%→9%, o3 49%→12% (smaller for Claude Opus 4.1). **measured**. → Explicit "stop and report" exits reduce cheating; "loop until it passes" without one invites it.
- **Flaky tests** make a "strong" check weak; a loop on a flaky check converges on noise. (opinion; Anthropic lists flaky tests as a case needing higher effort — same best-practices URL, **vendor**.)
- **Over-stopping**: "one step and stop" on weak checks can stall long work; Anthropic notes current models carry tasks through without prompting. **vendor**. Construct's contract already counters with "a text-only progress report is not a stop".
- **Exploratory work** with no check is legitimate (spikes, design); the rule should say "make it checkable or ask", not forbid progress. Current wording handles this.
- "The rule adapts as models improve" is unproven: no study isolates this rule (as METHODOLOGY.md already admits).

## 4. Cheap verification

- **Eval (cheapest, behavioral)**: an `impossible-test` case — fixture where spec and test conflict. Grader passes iff the agent stops and reports the conflict with the test file unchanged (`git diff --quiet -- tests/`). Mirrors ImpossibleBench. One case in `plugins/construct/evals/`.
- **Eval 2**: no-check case (vague exploratory prompt, no tests) — grader checks the reply names what would make it checkable and no source edits beyond one step.
- **Hook (enforcement)**: extend `surface-guard.mjs` so the writer may not edit test files that were red at loop start (the oracle separation already in "Cruce de piezas" 2.4). Optional TDD Guard-style gate for test-first.
- **Cap**: count consecutive failing runs of the same verifier command in a PostToolUse/`failure-streak` record; on the 3rd, inject "stop and report". Reuses existing hook.

## 5. Recommendation: CHANGE

Keep the core (it has the best indirect support of any principle), but fix three gaps the evidence points at: define "strong" (deterministic, not self-authored/loosened), make the cap concrete, and make "never bend the check; stop and report instead" explicit, since looping plus feedback measurably raises cheating and an explicit exit measurably lowers it.

Proposed text:

> With a strong check (deterministic, runnable now, not written or loosened in the same loop), the agent may loop until it passes, up to three failed runs; then it stops and reports. With a weak check, it takes one small step and stops. With no check, it says what would make the work checkable instead of proceeding. Where a strong check exists, the failing test comes first, and the loop never edits it to pass.

Follow-ups for consistency (not done here): session.md and workflow SKILL.md "Autonomy" still say "loop until it passes" without cap or no-edit rule; the contract is near its 8,000-char budget.
