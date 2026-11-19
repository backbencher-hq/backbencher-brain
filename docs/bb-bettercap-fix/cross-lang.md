# P0-2 — unscoped leaf-name binding + evidence-bearing cross-language marker (lane `cross-lang`)

Status: **GREEN + GREEN2** (gate + controls + mutant + bettercap-copy arm + retro-honesty on EXISTING
indexes + m26 approved contract correction + `npx tsc --noEmit`). Task: `task-10`. Date: 2026-11-18.
Last source change: retro-honesty read surfaces (CP1 gap). Source is FROZEN for this lane after this page.

## What was broken (triage evidence)

ISSUE-02 / LEAD-FINDINGS L-1+L-2: every resolution arm bound a bare external target by name anywhere in
the project (ranked declaration→same-file→same-language→lowest-id), so `main.go imports "os"` bound to a
YAML matrix key, `fmt` to a Makefile target, `io` to a minified OpenLayers function, and `main = _ref.main`
(JS property destructuring) to Go `package main`. The cross-language marker then certified the binding
because the two files' languages differ (`is_cross_language=1`, `bridge=name-resolution`), and the read
surfaces published the original confidence (0.9/0.6) and a kind-derived tier (`import_based`/`structural`).
Bettercap: 2,423/2,423 cross-language rows name-resolution-only; L-1 qualified-call leaves gave
`session.New` 88 false callers (`errors.New`, `otto.New`, …).

## RED (pre-fix, gate exists and fails)

Gate: `script/m57/verify-p02-name-binding.ts` (new). Fixture = bettercap collision shape (Go package main
importing fmt/io/os + internal/util; `release.yaml` with `os:`; `Makefile` with `fmt:`; `assets/ol.js`
`function io`; `assets/fontawesome.js` `main = _ref.main`; plus `web/a.js → ./b.js` same-language import).
Evidence: `evidence/cross-lang/RED-gate-prefix.txt` — 6/11 assertions passed:

```
FAIL P1a cross-language imports/calls/instantiates = 3        (must be 0)
FAIL P1b bound rows with non-code-language target = 1
FAIL P1c cross-language bare-name imports bound = 3
FAIL P1d bound metadata.isFieldAccess rows = 2
FAIL P1e bound external-claim rows = 4
ok   PC1 java+scala fixture flags 3 bridge rows; PC2 ts+js flags 2; PC3 same-language JS import resolves
```

## Fix (owned files only)

**One authoritative policy pair in `src/ast/parallel-indexer.ts`** — `P02_BINDING_POLICY` (mutation
switch), `applyP02BindingGates()` (refuse, pre-marker) and `applyP02CrossLanguageDegrade()` (candidate
floor, post-marker). Both are called around BOTH marker sites so every arm (eager insert-time resolve,
`_res_*` strategies, `_i13_*` ranked pass, worker-pool deferred resolve) flows through the same gates:

- `storeResults`: gates before the marker; degrade after it.
- `resolveRelationships`: gates before the marker; degrade after it.

Gates (each leaves `target_symbol_id` NULL + `is_cross_language=0` and tags `metadata.bindingPolicy`):

| # | Gate | Triage evidence |
|---|---|---|
| G1 | candidate file language ∈ `NON_CODE_LANGUAGES` (reused from `analysis-exclusions.ts`, no copy) | ISSUE-02: yaml/make/json/md/css structural keys "have no callers" |
| G2 | metadata declares `isStdlib`/`isExternalTarget`/`isPackageQualified`/`isFieldAccess` | L-1: `errors.New`→`session.New`; L-2: Go import `isStdlib:true` rows; fontawesome `isFieldAccess:true` |
| G3 | `imports` row: bare module-name target bound ACROSS languages (same-language bare imports keep pre-existing behavior) | L-2: an import of Go `"os"` cannot be satisfied by a YAML key |
| G4 | `imports`/`calls`/`instantiates` bound across a language pair that is not a declared interop pair | L-1/L-2: cross-language name coincidence, not a bridge |

Degrade (post-marker, and covering declared pairs too — Lead correction (a)): a name-only cross row stays
a stored CANDIDATE but gets `confidence = min(confidence, 0.5)`, `metadata.evidenceClass = "inferred"`,
`metadata.bindingBasis = "name-only"`. Exempt only when the row itself carries import-path/FFI/generated
evidence (`bindingBasis=import-path`, `bridgeMechanism`, `ffi=1`, `generatedFrom`, or a path-shaped import
target). The allowlist can only keep a candidate; it never restores a structural/`symbol` claim.

`P02_BRIDGE_PAIRS` (declared interop pairs, both directions; comment names the triage evidence for each):
java↔scala, java↔kotlin, java↔groovy, scala↔kotlin (JVM interop; M26 java-scala fixture);
typescript↔javascript, tsx↔js, vue/svelte↔ts/js (module graph; M26 ts-js fixture); graphql↔ts/js
(codegen; workspace graphql→ts rows); c↔cpp; objective-c↔swift. Policy is language-agnostic — no
Go-only branch; the same pass serves every analyzer.

**Read surfaces.** `src/lsp/evidence_tier.ts`: `bindingBasisOf()` + `classifyTier` returns `inferred`
when `bindingBasis="name-only"` (before any stored tier claim). `src/lsp/cross_language_hover.ts`: both
row SELECTs now select `json_extract(metadata,'$.bindingBasis')`; hover fact and agent fact expose
`bindingBasis` + `candidate`; hover text appends `[candidate: name-only binding, not an interop edge]`.
No `target_basis` laundering fix in this lane: the generated column lives in `src/brain/schema-ddl.ts`
(not owned) — see Coordination.

## GREEN evidence

- `evidence/cross-lang/GREEN-final.txt` — **13/13 assertions**, exit 0:
  P1a–P1e pass (collision fixture cross rows = 0, no non-code target, no cross bare import, no bound
  field access, no bound external claim), PC1 java+scala 3 bridge rows, PC2 ts+js 2 bridge rows,
  PC3 same-language JS relative import resolves and is not cross-language.
- `evidence/cross-lang/GREEN-mutant-caught.txt` — `BB_P02_MUTANT=1` disables `P02_BINDING_POLICY`; the
  five P1 assertions FAIL again (3 collision cross rows, 4 external-claim bindings, …) → mutant caught,
  exit 0. The gate is load-bearing, not satisfied by an unrelated change.
- `evidence/cross-lang/GREEN-gate-bettercap-arm.txt` + GREEN-final.txt — bettercap arm runs the EXACT
  production passes on a DB **copy** (`.tools/`, source never written):
  `unbound=43,367  degraded=122`;
  **cross-language name-resolution imports/calls == 0** ✓;
  **`session.New` callers from qualified leaves == 0** ✓ (legit `session.New()` calls from `main.go:21`
  are not qualified-leaf rows and are not counted).
- Positive controls after fix (degraded-but-retained candidates, per Lead correction (a)):
  `total→basePrice`, `total→applyDiscount` (ts→js) and `Warehouse→Inventory`, `currentStock→getStock`,
  `refill→restock` (scala→java) all keep `bridge=name-resolution` and `is_cross_language=1`, now
  `confidence=0.5, evidenceClass=inferred, bindingBasis=name-only` — bridge detection survives, no name
  collision is presented as a structural edge.
- `npx tsc --noEmit` → **exit 0** (`evidence/cross-lang/tsc-nohup.txt`, empty).

## GREEN2 — retro-honesty on EXISTING indexes (CP1 gap, no reindex required)

CP1 measured that `bb_cross_language --symbol main` on the CURRENT bettercap DB still rendered the report's 7
facts as `import_based`/`usage_contextual` at 0.9/0.6 with `bindingBasis:null`, because those rows predate the
policy and carry only `bridge_mechanism='name-resolution'`. Fixed on the READ side (no reindex, old DBs honest):

- `src/lsp/evidence_tier.ts`: `classifyTier` now returns `inferred` whenever the stored bridge mechanism is
  `name-resolution` — independent of stored `evidenceClass`, confidence, or a missing `bindingBasis`. A stored
  name-resolution cross row is a CANDIDATE bridge, never structural/import_based. `StoredTierRow` carries the
  optional `bridge_mechanism` column through `classifyStoredRow`.
- `src/lsp/cross_language_hover.ts`: `tierForCrossLanguageEdge` passes `bridge_mechanism`;
  `CrossLanguageFact`/`CrossLanguageAgentFact` expose `bridgeMechanism`; `candidate` is true for
  `bindingBasis="name-only"` OR `bridge_mechanism="name-resolution"`; the hover text already appends
  `[candidate: name-only binding, not an interop edge]`.
- Gate: two new assertions build the OLD-ROW shape (name-resolution bridge + stored `import_based`/
  `usage_contextual` + 0.9/0.6 + no bindingBasis) and require `tier=inferred`, `candidate:true`,
  `bridgeMechanism="name-resolution"`.
- Evidence `evidence/cross-lang/GREEN2-gate.txt`: **15/15 assertions**, exit 0 (the 13 previously green
  assertions still pass; 2 added). `GREEN2-mutant.txt`: mutant still caught (policy disabled → 5 P1 failures,
  exit 0). `tsc-after-green2.txt`: exit 0.
- Evidence `evidence/cross-lang/GREEN2-oldindex-bettercap.txt`: the probe runs the REAL read functions against
  the EXISTING bettercap DB, read-only. All **7/7** report facts now:
  `bridgeMechanism:"name-resolution", bindingBasis:null, candidate:true, tier:"inferred"` —
  e.g. `imports go→yaml os@.github/workflows/release.yaml:15 conf 0.9 → inferred/candidate`.
  The specimen is never written; only the read path is exercised.

## Sibling gates

- `script/m26/verify-polyglot-e2e.ts` — **contract correction APPLIED (Lead-approved) and GREEN**.
  Before: `A1: FAILED (10/12 passed, 1 mutant)` — only the two P3 assertions failed because they read the
  fixture rows' stored confidence (now floored to 0.5 by the mandated candidate degrade) and expected
  `structural`. After: `A1: VERIFIED (12/12 passed, 1 mutant)`, exit 0
  (`evidence/cross-lang/m26-polyglot-after-correction.txt`; pre-correction capture in
  `m26-polyglot-after.txt`). Assertion COUNT is unchanged (12 checks + 1 mutant arm); the two P3 checks now
  assert CANDIDATE RETENTION: flagged rows keep `is_cross_language=1` + `bridge=name-resolution`, and are
  floored candidates (`confidence<=0.5`, `evidenceClass=inferred`, `bindingBasis=name-only`, derived tier
  `inferred`). The tier RULE is still exercised with explicit inputs (its floor-branch check is unchanged),
  and an approving comment cites triage ISSUE-02 + the P02 policy. This is a contract correction, not a
  weakening: the triage proved a name-only row must never be structural.
- `script/m63/verify-cl1-cross-language.ts`: environment-blocked — it requires `BB_CL1_CORPUS` or
  `BB_CL1_DB`+`BB_CL1_PROJECT`; no corpus index may be created in this sandbox, so not run
  (`evidence/cross-lang/m63-cross-language-after.txt`).

## Changed files (this lane)

- `src/ast/parallel-indexer.ts` — policy + 4 call sites (resolution passes only; import-classification
  section untouched).
- `src/lsp/evidence_tier.ts` — binding-basis rule.
- `src/lsp/cross_language_hover.ts` — basis columns/fields/candidate flag.
- `script/m57/verify-p02-name-binding.ts` — NEW gate (+ mutant + bettercap-copy arms).
- `script/m26/verify-polyglot-e2e.ts` — approved P3 contract correction (candidate retention instead of
  structural confidence); all other assertions 1:1.

## Hot-file handoff (Go lane phase 2)

`src/ast/parallel-indexer.ts` is released for the Go lane's **import-classification section** next.
My edits are confined to: the two policy functions + their import (`NON_CODE_LANGUAGES`) above
`storeResults`, and the four policy calls around the two cross-language marker blocks in
`storeResults`/`resolveRelationships`. The Go phase-2 work must not edit those blocks or the policy
functions; coordinate the window with Lead before rebasing.

## Risks / open items (explicit)

1. **Conservative un-bind — 43,367 rows (expected intermediate, NOT a regression)**: the bettercap DB-copy
   arm measures `unbound=43,367` because G2 (external claims: `isPackageQualified`/`isStdlib`/
   `isFieldAccess`) refuses to name-bind qualified-call leaves until import/package scoping exists. That is
   **L-1's declared honest state**: those rows become unresolved `ext:` nodes instead of wrong edges.
   **Owner for the second half: `go-imports` phase 2** must re-bind qualified calls through the source
   file's import/package map (it builds on this policy). Until then Go same-module package-qualified calls
   are unresolved, not wrong — and `session.New` has zero qualified-leaf callers.
2. **`target_basis` generated column still launders to `symbol` for a retained CANDIDATE row**: the
   generated column lives in `src/brain/schema-ddl.ts`, which this lane does NOT own, so it was not edited.
   Read surfaces now publish `bindingBasis` + `bridgeMechanism` + `candidate` and derive tier
   `inferred`, so no reader is misled; a schema/read-path change should make `target_basis` honour the
   metadata basis together with P2-6 / old-index compat (Lead coordination).
3. **Existing indexes require a reindex for WRITE-side honesty**: the candidate floors
   (`confidence<=0.5`, `evidenceClass=inferred`, `metadata.bindingBasis="name-only"`) are written only by a
   new index run; stored rows in old DBs keep their original confidence/evidenceClass. READ-side
   retro-honesty (GREEN2) covers those old rows now via the stored `name-resolution` bridge — but the
   stored numbers themselves change only on reindex. Bettercap honesty is proven on a DB **copy**; the
   specimen is never written or reindexed.
4. m63 gate unrun (environment: needs `BB_CL1_CORPUS` / `BB_CL1_DB`+`BB_CL1_PROJECT`; no corpus index may be
   created in this sandbox) — recorded, not silently skipped.
4. m63 gate unrun (env); m26 P3 needs the flagged contract adjustment.

## Commands

```bash
# gate (GREEN, exit 0)
BB_DATA_DIR=$PWD/.tools/triage-fix/cross-lang/bbdata npx tsx script/m57/verify-p02-name-binding.ts
# mutant (GREEN when it catches the disabled policy, exit 0)
BB_P02_MUTANT=1 BB_DATA_DIR=$PWD/.tools/triage-fix/cross-lang/bbdata npx tsx script/m57/verify-p02-name-binding.ts
# bettercap arm (DB COPY only)
BB_P02_BETTERCAP_DB=/home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db \
  BB_DATA_DIR=$PWD/.tools/triage-fix/cross-lang/bbdata npx tsx script/m57/verify-p02-name-binding.ts
npx tsc --noEmit
```
