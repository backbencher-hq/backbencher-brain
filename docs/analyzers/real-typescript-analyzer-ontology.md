# TypeScript relationship ontology — DERIV_EXPORTS_TS lane

Lane working notes. Every claim here carries the command that produced it.
Ownership: `src/ast/real-typescript-analyzer.ts`, this file,
`docs/analyzers/real-typescript-analyzer.md`, and this lane's fixtures.

## 0. Baseline — production firing check (JOB 1, question 2 "fires")

Instrument: `script/m14/firing-check-v2.mjs`, the production path
(`getParser` -> `parser.parse` -> `new RealTypeScriptAnalyzer().analyze`).

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs DERIV_EXPORTS_TS

Result, 2026-10-04, corpus `element-plus`, NFILES=200:

    TYPESCRIPT  8/10  200/200 parsed · imports[] 1144 in 181 files
       fired:  calls extends uses imports exports contains references instantiates
       silent: implements overrides
       counts: calls:7853 imports:1588 references:1203 exports:494 contains:481
               uses:60 extends:9 instantiates:2

**8/10. Silent: `implements`, `overrides`.**

Both channels are reported separately, and both are non-zero for `imports`:
1,588 `imports` rows on the relationship channel and 1,144 entries on
`ParseResult.imports`. So for TypeScript the `imports` verdict does not rest
on the enum-value bug the harness header describes — this lane emits the type
on both channels. Recorded, not treated as a defect.

The analyzer source in the main checkout is byte-identical to this worktree's
at this commit (`diff -q` clean), so the number above is this branch's number.

### Sample-content caveat, measured next

The two files the instrument prints as its examples are
`typings/global.d.ts` and `typings/env.d.ts`. Both are ambient declarations
with no executable bodies. That is why `uses` is 60 and `instantiates` is 2
against 7,853 `calls` — a `.d.ts` heavy sample under-reports every construct
that needs a function body. The handover note says the *old* corpus was
115/126 `.d.ts` and that the earlier 3/10 was that artifact; the same artifact
is present at a lower dose in this 200-file draw and must be measured, not
assumed away.
