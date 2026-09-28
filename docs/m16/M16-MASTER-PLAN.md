# M16: Real-Repo Tool Verification & Edit Correctness — Master Plan

## Milestone

- **GitHub:** https://github.com/backbencher-hq/backbencher-brain/milestone/16
- **ID:** #16
- **Issues:** 16 tracked issues — #386-#401 (15 scoped work issues plus the milestone-resolution test issue #386)

## Origin (v1: real tool run, not assertion)

M15 closed with 79/79 issues and hollow-check-free verifiers. Before M16,
**every tool was run one-by-one through the real CLI handler path** (the exact
code path the MCP server uses) against a real indexed repository
(`rake/lib` — 44 files, 490 symbols, ~1,400 relationships). Result:

| # | Finding | Severity | Disposition |
|---|---------|----------|-------------|
| 1 | `bb_ask` "how many functions" = **0** on a Ruby repo with 300+ methods (stat query counts only `symbol_type='function'`, Ruby stores `method`) | HIGH | **FIXED + committed** (`2a2f7e1`) with cross-language regression |
| 2 | `bb_edit` refactor **silently under-renames**: only sites inside `brain_relationship` caller spans are renamed; missing edges → real call sites stay at the old name while the tool reports success | CRITICAL | Fixed in this milestone (E1-E2) |
| 3 | `bb_edit` forced delete leaves **dangling references** (`private :lookup_prerequisite` survives the deletion) | HIGH | Fixed in this milestone (E3) |
| 4 | `bb_security` reported 19 critical/17 high on a build tool with zero SQL/DB/HTTP — phantom `sql_injection` from a regex sink matching Ruby's literal `def execute` (sink-only rows) | Analyzer-domain | **NOT fixed here** — routed to M14/M-analyzer boundary, documented honestly (X1) |
| 5 | `bb_doc` duplicates `contains` edges (~10× same file) | Analyzer-domain | Routed to M14/M-analyzer boundary, documented (D1) |
| 6 | `bb_patterns` flags Ruby `initialize` as orphan (constructor nuance) | Analyzer-domain | Documented (P1) |
| 7 | `bb_visualize` truncation is honest but the default 16-seed budget yields 0 links | Working as designed | Re-verified (V1) |

## Scope

One milestone per tool was rejected as fake progress; this milestone
concentrates on (a) the two **real, tool-level defects** the run exposed
(edit refactor/delete — the only destructive tool), (b) a **cross-language
stat pass** for `bb_ask`, and (c) **per-tool docs refresh to website-grade
truth** (docs/BB_*.md mirror what the tools actually do, verified by the
same scripts). Analyzer-domain findings are recorded, not papered over.

## Issue Groups

| Code | Tool / Area | Issues | Notes |
|------|-------------|--------|-------|
| C1 | Governance + gate/ledger | 1 | Master plan, closure gate, evidence ledger, quality-gate wiring |
| D1-D3 | Per-tool docs (website truth) | 3 | Every `docs/BB_*.md` claim re-verified against code + real run |
| A1-A4 | bb_ask stat correctness | 4 | function/method union (fixed), class/index coverage, file stats, ghost-answer honesty |
| E1-E5 | bb_edit correctness | 5 verifier sections across 4 scoped issues | refactor completeness, uniqueness/freshness hardening, delete dangling-ref guard, real-repo regression suite, and cross-language field-aware classification |
| X1, P1, V1 | bb_security / bb_patterns / bb_visualize | 3 | real-repo re-verification + documented analyzer-domain routing |

## Per-Issue Protocol (M15 heritage, kept verbatim)

### Title format
`M16.[CODE] tool: [specific concern]`

### Body template
```
## Scope
[file:line-range] — [what's being verified/fixed]

## Acceptance
- [ ] [specific check]: [what must be true]
- [ ] [specific check]: [what must be true]

## Closure Requirements
1. All acceptance checkboxes ticked
2. `npm run typecheck` passes
3. All prior verifiers for this tool pass (zero regressions)
4. Evidence written to `validation/m16/results/[code].json`
5. Quality gate includes this verifier and passes
6. Tool doc regenerated and committed if changed
7. GitHub comment records real run output as evidence (not just "done")
```

### Evidence schema (same as M15, extended with `runLog`)
```json
{
  "issue": "M16.[CODE]",
  "code": "[CODE]",
  "tool": "[tool name]",
  "verified": true,
  "checks": [{ "name": "...", "pass": true, "detail": "..." }],
  "negatives": 0,
  "runLog": ["<real CLI output captured at run time>"],
  "generatedAt": "ISO8601"
}
```

## Attack Priority

1. **E1-E2: bb_edit refactor** — the one destructive tool, and the defect is
   silent-corruption-shaped. Fix first, add real-repo regression suite.
2. **E3: bb_edit delete** — dangling reference guard.
3. **G1: gate/ledger** — infrastructure before evidence.
4. **A1-A4: bb_ask** — cross-language stat honesty (A1 already committed).
5. **D1-D3 + per-tool re-verification** — docs truth (website) driven by real-run output.
6. **X1/P1/D1-dup** — documented analyzer-domain routing (never silent).

## Honesty Rules (from M15, inherited + hardened)

1. No `ck(..., true)`, no `>= 0` tautologies, no `|| true` — a check must be
   able to fail.
2. A verifier that cannot distinguish a pass from a failure is not a verifier.
3. Analyzer-domain bugs are routed to M14/M17 and documented — never silently
   fixed or silently ignored in tools.
4. Each closing comment includes the real CLI output line, not a summary.
5. Nothing is closed on assertion: evidence files are re-read at HEAD by the
   closure gate (`C1`).

## Completed First Step (committed `2a2f7e1`)

- `fix(ask)`: `quick-answer.ts` now counts `function|method` for
  "how many functions" and "most complex function" (cross-language);
  Ruby regression added to `script/m15/verify-ask-deep.ts`.

## Completion Record (2026-08)

All 15 scoped work issues closed with evidence (16 tracked issues including #386). Real product fixes shipped in this milestone:

1. **E1 — refactor completeness (the flagship fix).** The refactor previously
   renamed only the declaration plus sites inside `brain_relationship` caller
   spans; missing edges (proven on rake: `prerequisite_tasks` had zero) left
   real call sites at the old name while the tool reported success. Now the
   declaration file is fully scanned: every AST-classified reference site is
   renamed, with a shadow guard for nested same-name bindings, and the
   classifier is **position-aware** (value/right sides of assignments and
   declarators are references — Ruby/Python/TS/C/Go; the left/name side binds)
   via `parentField` on every occurrence (`safety-primitives.ts`). Results:
   rake `prerequisite_tasks` 6/6 sites renamed, `class Task` rename now also
   catches `Task.format_deps` (previously broken), `all_prerequisite_tasks`
   and other same-stem names untouched, only the intended file changed, and
   `summary.renamedSites` is reported. Verified by `verify-edit-real-repo.ts`
   (E1/E1b/E5).
2. **E3: delete dangling-reference guard.** Delete now scans the post-delete
   file for surviving AST references (e.g. Ruby `private :lookup_prerequisite`)
   — refuses without `force`, and a forced delete reports every surviving
   reference in `warnings`. Never silent. (Message contract updated in the M13
   unit verifier accordingly.)
3. **A-stat cross-language fix** (pre-committed `2a2f7e1`) verified end-to-end
   in A1-A4 including fallback honesty (unsupported nouns, no-index).
4. **Docs refresh to website truth** (D1-D3): `BB_EDIT.md`, `BB_ASK.md`,
   `BB_SECURITY.md` (phantom-sink limitation + M14 route), `BB_PATTERNS.md`
   (lifecycle-method nuance) — every claim dual-anchored to code.
5. **Evidence:** 17 original M16 evidence files (E1,E1b,E2-E5, A1-A4, V1,
   X1, P1, D1-D3, C1) all `verified=true, failed=0`, re-read by the
   closure gate at HEAD.

## Post-Closure Embedding Addendum

After M16 closure, an independent lifecycle pass found that temporary-project
verifiers removed SQLite databases while the non-blocking embedding queue still
held live database handles. That produced `readonly database` warnings and
zero embedding coverage in short-lived runs. This was shared indexer/semantic
infrastructure, not an analyzer defect.

The hardening in `src/ast/parallel-indexer.ts` now queues project identity
instead of a live SQLite handle, reopens only an existing project database,
and drops jobs for removed projects. M16 verifiers flush the queue before
closing/removing temporary databases. The new
`script/m16/verify-embedding-lifecycle.ts` proves durable local vectors and
safe pre-flush project removal; `script/verify-embed.ts` continues to prove
API embeddings, dimensions, semantic retrieval, and local fallback.

- Post-closure evidence: `validation/m16/results/EMB.json`
- Lifecycle gate: `8/8` checks passed
- Existing API/fallback embedding gate: `EMBED VERIFY: ALL PASS`
- Typecheck and M16 regression gates: passed
- The health line may still report zero coverage during indexing because the
  queue is intentionally non-blocking; coverage is evaluated after an
  explicit flush, not before the background pass completes.

## File Map

- `docs/m16/M16-MASTER-PLAN.md` — this file
- `script/m16/verify-closure-gate.ts` — C1: structural + run gates
- `script/m16/verify-edit-real-repo.ts` — E1-E5: real-repo edit suite (rake copy)
- `script/m16/verify-ask-stats.ts` — A1-A4: cross-language stats
- `script/m16/verify-tool-runs.ts` — V1/X1/P1: real-engine runs
- `script/m16/verify-docs-truth.ts` — D1-D3: doc/claim ↔ code verification
- `validation/m16/results/*.json` — evidence ledger (schema above)