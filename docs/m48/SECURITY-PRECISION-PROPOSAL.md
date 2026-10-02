# bb_security: the 16% precision floor, and what it would take to move it

**Status:** proposal. Not implemented. Owns no code changes.
**Author:** the bb_security review pass, 2026-09-30.
**For:** whoever owns `src/ast/parallel-indexer.ts` and `src/ast/taint-analyzer.ts`.

## Why this document exists

`bb_security` was reviewed, fixed and made honest. Its arithmetic is now correct
(it did not used to be), it states its own limits on its face, and 406 assertions
run in CI. None of that made it a better *detector*.

The measurement is against this repository's own 168k-symbol index:

```
4,046 taint flows → 3,190 findings → 817 critical
456 of 2,847 code findings (16.0%) whose reported line contains any sink call
326 findings (10.2%) in Markdown / JSON / YAML / HTML / CSS
213 of 1,433 symbol names span more than one file
mitigated: 0    crossLanguage: 0
```

This repository has no SQL injection. It calls `better-sqlite3` inside verifier
scripts. A security tool that reports 817 criticals on it, with a 16% hit rate
even on a test as lenient as "is a sink token near the reported line", is a tool
that gets ignored — or, worse, one that gets trusted.

Two of those numbers were fixed in the preceding commit and are not the subject
of this proposal:

- the 10.2% in prose/data files (a language allow-list at the `TaintAnalyzer`
  call site in `pool-worker.ts`);
- the ambiguous hotspot keys (`file::name` in `taint.ts`).

What remains is the 16%, and it is a different kind of problem.

## The actual defect: co-location is not data flow

`parallel-indexer.ts:2846-2872` builds a taint flow from **the cartesian product
of every taint source and every taint sink found in a symbol's text**:

```ts
if (sources.length > 0 && sinks.length > 0) {
  for (const source of sources) {
    for (const sink of sinks) {
      // inserts one brain_taint_flow row: source.type → sink.type
    }
  }
}
```

So a function that reads `req.headers` for a log line and separately calls
`db.find({name})` for an unrelated lookup produces a `confirmed`,
confidence-0.7 `sql_injection` finding. Nothing connects the two.

`src/intelligence/security/taint.ts` then classifies that row `confirmed` because
**both endpoints resolve to indexed symbols** — which is the only check it makes.
The word `confirmed` means "the two ends exist", not "the data flows". That
distinction is now documented, but documenting a precision ceiling does not raise
it.

### Two sharpening facts

The heuristic token matchers make this worse in ways that are cheap to state and
expensive to guess about:

- `TaintAnalyzer` rule 4 (sources) matches `db.query|db.find|findOne\(|select\(|
  \.Exec\b|\.QueryRow\b|\.Query\b|ExecuteReader|executeQuery` — note `.Query\b`.
- `TaintAnalyzer` rule 1 (sinks) matches `db\.query|db\.execute|\bexecute\b|…
  \.Query\b|…`.

The **same token family is a source and a sink**. On this index, `src=database_read
sink=database_write` is the single most common finding shape. Many of those pairs
are one `.Query(` token matching both rules.

Only `src/ast/real-typescript-analyzer.ts` classifies sources and sinks from the
AST (`extractTaintSources` / `extractTaintSinks`, receiver-leaf shaped). Every
other language falls to the token matchers.

## The options, with their real cost

### Option A — declare it a lead-generator, not a scanner *(hours, no false confidence)*

Stop presenting `confirmed` as a verdict. Re-label the state, drop confidence for
co-located flows, and state in the tool description that the tool ranks *where to
look*, not *what is broken*.

Cost: one day's work, all in the tool layer I already own.
Value: the tool stops lying about what it knows. It does not get more accurate.
**This is the right thing to do regardless of which other option is chosen** — the
other options are ways to earn the current claim back.

### Option B — require a real lexical connection *(days, large measured gain)*

A cheap, sound strengthening that fits the existing architecture: **require the
source token and the sink token to be connected by a data-flow-ish path within
the symbol body.** Concretely, in `TaintAnalyzer` or the indexer's pairing step:

1. Collect each match with its byte offsets (the analyzer already has them —
   `extractSources`/`extractSinks` currently discard position and keep only a
   literal label like `"Web Request Data"`).
2. Build a crude intra-symbol assignment chain: variable defined = expression
   containing the source token.
3. Emit a flow only when the sink's argument expression transitively contains a
   source-derived variable.

Not a real reaching-definitions analysis, but it kills the dominant false
positive: two unrelated tokens in the same function. Expected effect, honestly
uncertain without measurement: on the observed distribution, most findings are
`database_read` → `database_write` in functions that are not actually passing
request data to SQL, so this should cut the 84% substantially.

Cost: real work in `taint-analyzer.ts` + `parallel-indexer.ts`, plus an oracle to
measure against.

### Option C — intra-procedural reaching definitions *(weeks, the honest fix)*

Build a real def-use graph per symbol body and propagate taint from source
assignments to sink arguments. This is what a security tool needs and what makes
`confirmed` mean what it says.

Cost: the largest item here. It is a compiler-shaped problem, it needs a
precision/recall oracle before it can be trusted, and it belongs with the
analyzer work that already exists (`real-typescript-analyzer.ts` is 6,000+ lines
of AST-shaped extraction).

## The measurement problem, which blocks all of the above

**There is no oracle.** No verifier in this repository can say "this SHOULD have
been a finding". Every precision number above is a proxy — "is a sink token near
the reported line" is the loosest one available, and even it is a proxy.

Before any of B or C can be accepted, there must be:

1. A **planted-defect corpus**: real vulnerable files with a known ground truth,
   ideally drawn from CVE-fix commits (the fix is the label). `fixtures` is the
   natural home and does not exist on every box.
2. A **measured precision/recall pair**, published with the corpus, so a change
   can be argued about rather than asserted.

Without (1) and (2), Option C is a large refactor with no way to know whether it
helped. The `minConfidence` knob in `SecurityOptions` cannot substitute for an
oracle — it filters a number that is currently calibrated to the wrong thing.

## Recommendation

1. **Do Option A now.** It is small, it is in my lane, and until one of B/C lands
   the tool is currently over-claiming. `confirmed` on a co-located pair is the
   single most misleading thing this tool outputs.
2. **Write the oracle (1 + 2) before B or C.** It is the thing that makes any
   subsequent precision work decidable, and it is the item most likely to be
   skipped and most costly to skip.
3. **Then B, with the oracle measuring it.** B is the largest gain per unit of
   risk, and it degrades to Option A's behaviour cleanly.
4. **C only if B's measurement says the remaining error is dominated by genuinely
   connected flows that B cannot follow.**

## What is explicitly out of scope here

- The dead `is_mitigated` and `mitigation_steps` surfaces. All six production
  write sites in `parallel-indexer.ts` hardcode `0`/omit them; measured `mitigated: 0`
  across 3,190 findings confirms it. Either implement mitigation detection or
  delete the surface so the docs stop describing a feature that cannot occur.
- `crossLanguage`, currently set to a constant `1` by
  `resolveCrossSymbolTaints` with no language comparison
  (`parallel-indexer.ts:3787`); measured `crossLanguage: 0`. Same choice: make it
  mean what it says, or rename it.
- The 7.4 s scan time against a 1.2 s documented budget on a 168k-symbol repo.
  Worth a look, but it is not what makes the tool untrustworthy.

## Evidence for every number quoted

Reproduce with `BB_SECURITY_CORPUS_ROOT` pointed at a `fixtures/repositories`
directory; `script/m15/verify-security-deep.ts` X5 is the corpus leg and records
`skipped` with a reason when no corpus is present, so its absence is never
mistaken for a pass.