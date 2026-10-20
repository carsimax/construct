# Decision mode

Adapted from `doubt-driven-development` (addyosmani/agent-skills, MIT; see `plugins/construct/NOTICE`). Judges a plan, design, or claim before implementation, while course-correction is cheap. Code review keeps the standard flow in `SKILL.md`.

## When it applies

The user asks to stress-test a plan, design, or non-obvious claim ("this is safe", "this scales", "this matches the spec") and the decision is non-trivial: it adds branching, crosses a module or service boundary, asserts a property the compiler cannot check (idempotence, ordering, invariants), depends on context a future reader cannot see, or is irreversible (deploy, data migration, public API). Never for renames, formatting, clear user instructions, or one-line obvious changes.

## Differences from code mode

- The judges are the same blind pair (`construct:jd-judge-a`, `construct:jd-judge-b`), launched in parallel with identical input.
- Input is ARTIFACT + CONTRACT only. Never pass the CLAIM, the author's reasoning, or the conclusion being tested.
- No fix actor. `construct:jd-fix-agent` is never launched; the orchestrator revises the artifact itself or asks the user. Nothing is written to the repository.
- No cross-model step and no external CLI.
- The terminal verdict is still `APPROVED | ESCALATED`.

## Cycle

1. CLAIM. The orchestrator writes the decision in two or three lines plus why it matters. It stays with the orchestrator. If it cannot be stated that compactly, it is not yet a decision: ask one question and stop.
2. EXTRACT. Build the smallest reviewable unit with reasoning stripped.
   - Decision: the proposal in 3-5 sentences plus the constraints it must satisfy.
   - Assertion: the claim text plus the evidence said to support it, kept distinct from the CLAIM block.
   - If it will not fit in one read, decompose first.
   Write ARTIFACT and CONTRACT to one scratch file outside the worktree (`mktemp -d`) with numbered lines, so judge findings can cite `<file>:<line>`. Report the path.
3. DOUBT. Launch both judges with the standard judge prompt from [prompts-and-formats.md](prompts-and-formats.md), with the target replaced by the scratch file and this preamble kept verbatim:

   ```
   Adversarial review of a decision artifact, not code. Find what is wrong with it.
   Assume the author is overconfident. Look for unstated assumptions, unhandled
   edge cases, hidden coupling or shared state, ways the CONTRACT could be
   violated, conventions it might break, and failure modes under unexpected input.
   Do NOT validate or summarize. Return findings, or an empty findings list if you
   cannot find any after thorough examination.
   ```

   Judges are JSON-only: they return `{"findings":[...],"evidence":[...]}` and nothing else. Map the fields as follows: `location` is `<scratch file>:<line>`; `claim` is the observable way the artifact fails the contract; a defect in the artifact text is `introduced`; a gap that exists regardless of the artifact is `pre-existing`; `proof_refs` quote the artifact or contract lines. Judges still apply BLOCKER/CRITICAL only with concrete causal proof, so a hypothetical failure mode is a WARNING.
4. RECONCILE. The findings are data, not a verdict. Re-read the artifact text against each finding, then classify in this order, first match wins:
   1. Contract misread: the finding exists because the CONTRACT was unclear or incomplete. Fix the contract and re-extract.
   2. Valid and actionable: the artifact must change. Revise it.
   3. Valid trade-off: real, but fixing costs more than accepting. Record the trade-off and show it to the user.
   4. Noise: correct under context the judge lacked. Note it, and ask whether adding that context to the contract would have prevented the flag.
   Use the standard merge rules: a finding both judges raise is confirmed, one judge is suspect, contradictions go to the user. Do not defer to a judge because it is fresh, and do not dismiss one because you disagree.
5. STOP. End when a cycle returns only trivial or already-considered findings (`APPROVED`), after 3 cycles, or when the user says to proceed (`ESCALATED` for the last two when substantive findings remain). Never run a fourth cycle alone. A cycle on an unchanged artifact is stalling: do not repeat it. If three cycles are not enough because the artifact is large, decompose it and start over; never lift the bound.

## Red flags

- Doubt theater: across two cycles with substantive findings, none were classified actionable. Stop and escalate.
- Passing the CLAIM or the author's reasoning to a judge.
- Rubber-stamping the judges, or ignoring them.
- Stripping the CONTRACT from the input.
- Applying decision mode to a trivial change.

## Output

Return the CLAIM, the scratch artifact path, cycle count, a table of findings with their class (contract misread, actionable, trade-off, noise), the revisions made, accepted trade-offs, and one final `JUDGMENT: APPROVED ✅` or `JUDGMENT: ESCALATED ⚠️`.
