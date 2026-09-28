# Backbencher V2 — Project "Quill": a new language, invented to be verifiable

> Status: **design spike, opened by owner directive 2026-09-18.** Nothing is
> built yet: no grammar, no analyzer, no fixtures. This doc is the design and
> the honest costing. It closes nothing and un-closes nothing — the open JVM
> items (#841, #824/#825), the web remainders (#868, #834) and the
> data-quality/corpus list stay on the tracker exactly as they are.

## Why invent a language at all

Every one of the 22 onboarded languages fights the same war: the language was
designed for humans first, and the analyzer inherits whatever ambiguity the
spec left behind (groovy's 322 residual parse failures are the current
example — #841). A language designed **for analyzability** removes that war:

- **Every call site is syntactically marked.** No overloading, no implicit
  conversions, no `operator()`. A call is a call keyword. The analyzer never
  guesses whether an identifier is a read or an invocation.
- **No preprocessor, no macros.** What is parsed is what is written.
- **Mandatory delimiters.** No significant whitespace, no optional semicolons,
  no brace-optional forms. The grammar is (aimed to be) LR-clean — no GLR
  conflicts to chase, no error-recovery artifacts like the 40
  `firstErrorLineSignatures` the groovy census exposed.
- **One construct = one relationship.** The spec enumerates the construct
  table and the relationship table side by side; a construct that has no
  relationship row does not exist.

The payoff is a **reference implementation**: a language whose analyzer can be
correct by construction, proving the whole pipeline — emit → store →
enrichment → tool — end to end on ground truth we authored ourselves. That is
the V2 deliverable and the reason it is worth doing inside this repo rather
than as a toy.

## The language (spike-level)

Working name **Quill** (provisional). Shape:

- Statically typed, explicit, block-structured; C-family surface so the
  existing tree-sitter tooling habits apply.
- Calls: `call target(args)` — the keyword is part of the syntax, so a call
  edge can never be confused with a member read.
- Imports/exports explicit; the exports contract (the M49 JAD3 ruling) is a
  language rule: only top-level types and functions are importable.
- Lines: every declaration and every call occupies exactly one source line —
  the line-number contract is a language guarantee, not an analyzer feat.

These are the parts of the design where the analyzer's hardest-won rulings
(#855 attribution, #825 phantom members, #873 line base, #822 multiplicity)
become *syntactically enforced* rather than defended against.

## Honest costing — with a reference point

The freshest real onboarding is **Erlang**: first wave opened ~2026-09-14 and
still in flight (M14 #275/#880) after days of real sessions — and Erlang had
an upstream grammar to vendor. Quill has no upstream grammar; the grammar is
authored here. Phases, in order:

| phase | deliverable | honest size |
|---|---|---|
| 1. spec + grammar | `grammars/tree-sitter-quill/` authoring, `tree-sitter generate` clean, no unresolved conflicts | multiple sessions |
| 2. analyzer | `real-quill-analyzer.ts` emitting the full payload, char-scan policy per regex-policy.md from day one | multiple sessions |
| 3. fixtures + mutants | M14 fixture lane + mutation registration (the 634-mutant battery grows by Quill's set) | 1–2 sessions |
| 4. census + corpus | regex census row, a real Quill corpus, F-lanes green | 1–2 sessions |
| 5. registration | R1 milestone registration in `validation/m60/ledger.json` (a new milestone is registered honestly, not invented), onboarding row | 1 session |

**This is sessions of work, not one chat.** Nothing in this project completes
in the gap between two messages, and the 22-lane history is the evidence.

## Not claimed

- No closure ceremony is triggered by this doc; the M60 gate still reads
  `not-closed`.
- No completion date is promised beyond the phase ordering above.
- The JVM list is untouched: #824/#825, #854/#837/#885, #841 remain open and
  remain the fastest path to a real launch.
