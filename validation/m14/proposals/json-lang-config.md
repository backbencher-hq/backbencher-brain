# PROPOSAL — `LANG_CONFIG` for `json` + `GATED_LANGS` addition

**Author:** toml-lane (json owner) · **Lane:** `json` · **Date:** 2026-10-17
**Target file (LEAD-OWNED, not edited by this lane):** `script/m14/completeness-inventory.ts`
**Status:** PROPOSED. Every value below is measured against committed artifacts; none is invented.

## 1 · THE CONFIG OBJECT (ready to paste into `LANG_CONFIGS`, after the `javascript` entry or alphabetically)

```ts
  json: {
    id: "json",
    wasm: "tree-sitter-json.wasm",
    classification: "json-completeness.json",
    fixturesDir: "validation/m14/fixtures/json",
    docs: ["docs/analyzers/history/json-lane-notes.md", "docs/analyzers/json.md"],
    // The lane's documented PRIMARY corpus (differential.ts LANG_REPOS.json = "terraform"; `otp` is the
    // second corpus, LANG_REPOS_SECOND.json = "otp"). The perfKey names the baseline row the Lead's
    // central sweep must add — this lane does not invent it. E/F fail until that row exists; that is the
    // expected state for a NOT-YET-CONFORMANT lane and is recorded in JSON-STATE.md §2.
    perfKey: "terraform:json",
    // The nine kinds the analyzer's RelationshipType.* emission sites publish. MEASURED two ways:
    // (1) the source sites: Calls, Contains, Exports, Extends, Implements, Imports, Overrides,
    //     References, Uses; (2) a run of the lane over its own fixture sources: contains 217, extends 6,
    //     implements 3, imports 2, overrides 1, references 11, uses 3, plus exports/calls which fire only
    //     for a `package.json` (gated at real-json-analyzer.ts extractManifestExports). The new fixture
    //     `validation/m14/fixtures/json/package.json` pins 3 exports and 1 calls, so ALL NINE are pinned.
    requiredKinds: ["calls", "contains", "exports", "extends", "implements", "imports", "overrides", "references", "uses"],
    // Section C: no Matrix 1b payload row applies to json (no complexity/docstring/parameter surface).
    // Declared empty by ruling, not left out.
    payloads: {},
    title: "JSON / JSONC / JSON-Schema wave (M14 #419, BD-ontology)",
  },
```

## 2 · THE GATE-LIST ADDITION

`GATED_LANGS` (the array the script closes #419 against) gains its id:

```ts
  "json",
```

Placement: alongside the other two-letter lane ids. No other change is needed — the lane's spec, fixtures
and docs already exist and were reshaped/added in this round.

## 3 · WHAT THE GATE WILL CHECK, AND WHAT IT WILL REPORT TODAY

| section | expected on application |
|---|---|
| A structural | **pass** — 14 types (12 named + ERROR/MISSING) classified: 5 handled / 9 silent; each silent row names its construct in `internal_silent._perType` |
| B relationship kinds | **pass** — `requiredKinds` = the 9 emitted kinds, all 9 fixture-pinned (the new `package.json` fixture pins `exports` and `calls`; the other 7 were already pinned) |
| C payload matrix | **pass** — `payloads: {}` (declared-empty by ruling) |
| D evidence tiers | **pass** — `structural` and `usage_contextual` now pinned in fixtures |
| E differential floor | **FAIL until the Lead's sweep adds `terraform:json` to `differential-baseline.json`.** This lane does not run `--update-baseline`. |
| F perf budget | **FAIL until the same row carries `perf.avgMsPerFile`.** Same owner. |
| G docs | **pass** — both doc files committed |
| H cross-language | **pass** — `M14.CC1.json` 12 checks, 0 failing |

**So the expected reading on application is `json: 14 types classified; sections A-H: 6/8 pass` with the
two failures being E and F, the Lead-owned sweep — not lane defects.** Nothing in this proposal claims
CONFORMANT until that row lands.

**UPDATE 2026-10-17 (post-report):** the gate still rejects the lane (`error: unknown language json`) —
this proposal is unapplied. The corrected fixture reader now reads json's own `.json` fixtures (declared
via each expectation's `fixture` field), so Section B will compute the real 9-kind emitted set and pass.
**E has a measured blocker that is NOT the corpus:** `terraform:json` derives 6,206 tree-truth edges over
60 files, but the differential's analyzer side reports `analyzer-edges=0` while the analyzer demonstrably
emits 19 `contains` over the sampled JSON file — an instrument defect in the scoped probe, owned by the
Lead. Corpus recommendation: **keep `terraform:json`** (see `JSON-STATE.md` §4).

## 4 · FILES CHANGED THIS ROUND (all in the json lane's scope)

* `script/m14/spec/json-completeness.json` — buckets reshaped to the gate's contract:
  `handled_verified` = 5 types + `_perType` prose (incl. `ERROR`), `internal_silent` = 9 types with a
  named construct per row, `JSON-G3`'s `node_type: "array"` removed (the array TYPE is handled; the gap
  is identity). No ruling was weakened or deleted.
* `validation/m14/fixtures/json/package.json` + `package.expectation.json` — NEW: the two convention
  constructs (`exports`, `calls`) the lane emits only for a Node manifest, pinned for the first time.
* `validation/m14/fixtures/json/OpenApi.expectation.json` + `Inherit.lsp.expectation.json` — one
  `meta.evidenceClass` pin each (`usage_contextual` on a `uses` row; `structural` on an `implements` row)
  so Section D has two tiers.
* `validation/m14/verification/JSON-STATE.md` — the node-type count and bucket split, the WHY per
  `internal_silent` row, and the section-by-section measurement.
