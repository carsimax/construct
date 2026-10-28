# Principle 1 — Literal intent: research notes

Date: 2026-10-27. Scope: quick review (8 web calls). Labels: **measured** (controlled or benchmark result), **vendor** (tool docs/maker), **opinion** (practitioner or author view).

Principle under review (METHODOLOGY.md §1):
> Literal intent. The user's words are the spec. Each requirement (S#) quotes the user verbatim, in their language, and marks every assumption. Ambiguity is a state, not a guess: a requirement is either clear or `NEEDS CLARIFICATION: <question>`, and no task that depends on an unclear requirement can finish.

## 1. Support

- **Agents assume instead of asking, and asking pays.** Ambig-SWE (underspecified SWE-bench Verified): models struggle to tell well-specified from underspecified tasks; without interaction they fill gaps with assumptions; interaction improves results by up to 74% over non-interactive. https://arxiv.org/abs/2502.13069 — measured.
- **Separating detection from execution helps.** "Ask or Assume?" (Edwards & Schuster, 2026): a scaffold that detects underspecification separately from coding reached 69.40% resolve vs 61.20% single-agent (OpenHands + Sonnet 4.5), asking fewer questions on simple tasks and more on complex ones. https://www.alphaxiv.org/abs/2603.26233 — measured (abstract only read).
- **Clarify-then-code raises pass@1.** ClarifyGPT: GPT-4 avg 68.02% → 75.75% across four benchmarks (simulated users); 70.96% → 80.80% on MBPP-sanitized in a 10-person human study. https://arxiv.org/abs/2310.10996v1 — measured (small human n).
- **Requirement inflation is real.** Böckeler saw Kiro turn a small bug into 4 user stories with 16 acceptance criteria. https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html — opinion with direct observation. Verbatim quoting is a direct counter: an agent cannot quote words the user never said.
- **Ambiguity as a visible state.** Spec Kit's `[NEEDS CLARIFICATION]` marker keeps a spec incomplete. https://github.com/github/spec-kit/blob/main/spec-driven.md — vendor.
- **Traceability to the source statement** is standard RE practice (upward trace to documented stakeholder statements of need, based on ISO/IEC/IEEE 29148). https://www.archives.gov/files/contracts/hipgfi/ir-templates/ir-quality-standards-strs-pdd.docx — vendor/standard. Pre-RS traceability (linking requirements to the exact speaker turns) is "under-explored"; Trace2Conv links user stories to transcript turns. https://conf.researchr.org/details/RE-2022/RE-2022-re-next--papers/1/Back-to-the-Roots-Linking-User-Stories-to-Requirements-Elicitation-Conversations — measured (prototype).
- No study found comparing verbatim vs paraphrased requirements directly. The verbatim rule rests on provenance and anti-inflation logic, not on a measured effect.

## 2. Counterarguments and failure modes

- **Spec Kit itself caps and defaults.** The source of the marker says the opposite of "every gap is a stop": "Make informed guesses… Use reasonable defaults (document assumptions)", mark only when scope/UX impact is significant, multiple interpretations differ, and no default exists; "Maximum 3 markers"; over the limit keep the 3 most critical and guess the rest. https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md — vendor. ADD's binary "clear or NEEDS CLARIFICATION" drops this calibration.
- **Over-asking is a failure mode too.** When-to-ask depends on speed/usability vs carefulness and on whether one interpretation dominates (Zhang & Choi, NAACL 2025 Findings). https://papers.cool/venue/2025.findings-naacl.306@ACL — measured (framework). Models can be trained to answer directly when clarification is unnecessary (ICLR 2025). https://arxiv.org/abs/2410.13788v2 — measured. Practitioner guides: proceed with labeled defaults for low-stakes reversible choices, block only when wrong is expensive to undo. https://docs.inkeep.com/guides/agent-engineering/failure-modes ; https://tianpan.co/blog/2026-05-07-ai-clarification-dialogue-convergent-flows — opinion.
- **Verbatim words are often vague, contradictory, or conversational** ("make it nicer", "like before"). A quote alone is not testable; it needs a restatement (Given/When/Then) beside it. Construct already allows that (feature-document.md), but the principle text doesn't say the quote is provenance and the restatement is the testable form.
- **Fabricated quotes.** Nothing stops the agent from "quoting" a paraphrase. Without a check, "verbatim" is a prompt promise.
- **Non-English quotes** are fine for provenance but English artifacts then mix languages; the testable restatement should follow the artifact language (English) while the quote keeps the original. Minor.
- **Corrections over time.** User words change across turns; the quote must point at which Log entry, otherwise the latest correction is lost (feature-document.md already requires verbatim dated Log entries).
- **Tension with the session contract**: "Ambiguous: one question" / "A real product decision gets one question, then stop" (hooks/contract/session.md). A state per S# can accumulate many open questions; they should be batched into that one question.

## 3. Alternatives / refinements seen elsewhere

- Spec Kit: marker only for high-impact gaps, max 3, prioritized scope > security/privacy > UX > technical; rest become documented assumptions (vendor, URL above). `/speckit.clarify` asks up to 5 short multiple-choice questions and writes answers back (third-party skill pages, e.g. https://tessl.io/registry/skills/github/unoplatform/uno/speckit-clarify/review — unverified secondary).
- Ask-or-Assume: uncertainty-aware asking scaled to task complexity (measured, above).
- Reversibility rule: ask only when a wrong guess is expensive to undo (opinion, above).
- RE: trace requirement to source statement rather than replacing it (standard, above).

## 4. Making it verifiable cheaply

The feature document already has `S#` quotes, an `L#` Log with verbatim entries, and a Tasks table with a `Specs` column that `feature-state.mjs` parses.

1. **Quote provenance check (hook/lint):** each S# quoted string must be a substring (whitespace-normalized) of some `L#` entry. Catches paraphrase passed off as quote and invented requirements. Pure text check, no model.
2. **Clarification gate:** if a task's Status starts with `done` and any S# in its `Specs` cell contains `NEEDS CLARIFICATION`, warn in feature-state (or deny in the Stop/risk-line hook). Reuses existing parsing.
3. **Cap check:** more than N open `NEEDS CLARIFICATION` markers in one document → warning (batch them into one question).
4. **Eval:** an ambiguous-prompt case (one high-impact gap, one low-impact gap) graded on: asked exactly one batched question for the high-impact gap, recorded the low-impact one as a marked assumption, wrote no source before the answer. Fits `plugins/construct/evals/`.

## 5. Recommendation: CHANGE

Keep verbatim quoting (strong anti-inflation and provenance value) and the clarification state (measured benefit of asking). Change the binary rule: the evidence and Spec Kit's own template say to stop only for outcome-changing, costly-to-reverse gaps and to record the rest as marked assumptions. Anchor quotes to the Log so they are checkable.

Proposed text:

> **Literal intent.** The user's words are the spec. Each requirement (S#) quotes a Log entry verbatim, in the user's language, and marks every assumption added to it. Ambiguity is a state, not a guess: a gap that changes the outcome and is costly to undo is `NEEDS CLARIFICATION: <question>`, any other gap is a marked assumption, and no task that depends on an unclear requirement can finish.
