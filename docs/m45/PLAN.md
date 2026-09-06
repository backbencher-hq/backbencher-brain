# M45: Index Truth, Armed — data-truth fixes made permanent

## The milestone invariant (verbatim, enforced by G1)

> **A full or incremental index over code, config, and real repositories must
> leave zero orphan owners, zero dead source/target edges, and an honest
> symbol-loss bucket on the worker-pool path — and any change that
> reintroduces them must fail a gate, not silently ship.**

Every acceptance criterion in this milestone traces to that sentence. R1/R2/R3
prove the store's invariants; A1 hands the analyzer-lane root causes to the
analyzer owners; X1 refuses milestone close unless every gate passes live at
one stamp.

## Findings recap (evidence from code + a real full index, 2026-09-06)

Post-close deep review (after M44) re-ran the real indexer on this repository
(2,725 files) and SQL-audited the result. Three data-truth claims from earlier
milestones were silently wrong in production-scale runs:

1. **Symbol-loss bucket = newly parsed, unconditionally (worker-pool path).**
   In `parallel-indexer.ts` the pool `file_done` handler pushed only
   `{filePath, success}` into the outcomes array while the full result (with
   `symbols`) went only to the DB batch. `symbolLoss` therefore read
   `r.success && !r.symbols` as true for every pool success. Full index:
   `2725 newly parsed | 2725 symbol-loss`. Genuine ENGINE_EMPTY zero-symbol
   files (the silent-loss class V5 exists to surface) were invisible. The
   m22 V5 fixture gate cannot catch this: its fixtures run the in-process
   path, which attaches symbols correctly. **Fix shipped (`48f26228`)** —
   verified: 2 changed files (1 with symbols, 1 comment-only) now report
   `2 newly parsed | 1 symbol-loss`.

2. **126,894 orphan owner references (~84% of 150k symbols) on a full index.**
   `owner_symbol_id` was written unconditionally. Analyzers attribute
   file/module-scope owners (`…:harness.ts:harness:0`) and JSON/YAML dotted
   parents (`…:package.json:package.imports:0`) that are never emitted as
   symbol rows. Every such child pointed at a row that does not exist,
   breaking bb_trace containment chains. **Fix shipped (`9f26fd38`)** — each
   store batch nulls owners that reference no row, inside the transaction.
   Verified: 126,894 → 0.

3. **3,786 dangling source relationships on a full index.** Two causes:
   (a) analyzer `contains`/`calls` edges sourced from symbols the store skips
   (denylisted names: `module_declaration`, `anonymous_struct`, `Window`,
   `anonymous_Runner`, dotted JSON parents); (b) the health check counted the
   *designed* module-level edge shape (NULL source + `source_external`, a
   documented schema contract) as corruption. **Fix shipped (`9f26fd38`)** —
   dead-source rows deleted per batch; `checkDanglingSources` now counts only
   non-empty missing source ids. Verified: 3,786 → 0.

Net effect on this repo's full index: health 75% → 92%, with the single
remaining warning being 27 genuinely syntax-error files (m14 poison fixtures,
by design — real signal, kept).

## Why a milestone and not just commits

The three failures above all survived earlier "verified" gates. The fixes are
cheap; the *regression armature* is the deliverable:

- **R1** forces the worker-pool path and asserts the bucket counts honestly —
  closing the m22 V5 blind spot (its fixture path is in-process).
- **R2** pins zero orphan/dangling/target corruption on a fixture exercising
  real class containment, top-level decls, JSON/YAML config virtuals, edits
  and re-indexes.
- **R3** pins the same zero-corruption invariants on real repositories (rake,
  ripgrep copies) with full derived passes and recorded time bounds.
- **A1** routes the analyzer-lane root causes (JSON/YAML emit dotted parents
  that never exist as rows; spec/fallback files emit edges from denylisted
  names) to the analyzer owners with this evidence attached — the store now
  defends, but the analyzers should stop producing the defect.

## Codes

| Code | Scope | Gate |
|---|---|---|
| G1 | Governance: ledger, registry, chain, auto-pass audit | verify-governance.ts |
| R1 | Worker-pool symbol-loss honesty (the 48f26228 regression) | verify-r1-pool-symbol-loss.ts |
| R2 | Graph integrity on a fixture (orphan owners / dead edges / containment) | verify-r2-graph-integrity.ts |
| R3 | Real-repo integrity corpus (rake, ripgrep) + time bounds | verify-r3-real-repo-integrity.ts |
| A1 | Analyzer-lane handoff doc (evidence-attached, verifier-checked) | verify-a1-handoff.ts |
| X1 | Closure gate (single-stamp consensus, live read-only re-runs) | verify-closure.ts |

Every content gate joins `npm run verify` in the same change that lands it
(G1 check). No auto-pass predicates in any M45 verifier (G1 audit).
