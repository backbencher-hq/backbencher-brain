# sql → `LANG_CONFIG` + `GATED_LANGS` — ready to paste, and the ONE gate fix it needs

**Lane:** sql · **Date:** 2026-10-17 · **Owner:** script-resolver · **Status: 5 of 8 sections PASS
through the gate itself.** Both target files (`script/m14/completeness-inventory.ts`) are Lead-owned and
were NOT edited. The config below was verified by copying the gate to a scratch path, injecting this
exact object, and running `--lang sql` — so every number here is from the gate's own section checks,
not from my reading of them.

**⚠ STATUS UPDATE 2026-10-17 (later the same day): §3 of this file is now HISTORICAL — the Lead
applied the corrected `emittedKinds()` reader, so section B passes at the root with no field needed. The
CURRENT reading, with only the config injected into the current gate, is 6 of 8:**

```
pass  section-a-structural          592 types, 82 handled, 478 silent, 17 gaps, 25 decisions
pass  section-b-relationship-kinds  pinned: 7; emitted: the same 7 — all accounted for
pass  section-c-payload-matrix
pass  section-d-evidence-tiers      4 tiers pinned
FAIL  section-e-differential        no baseline floor row for duckdb:sql   <- DECLARED ABSENT (SQL-G14)
FAIL  section-f-perf-budget         no avgMsPerFile for duckdb:sql         <- same dependency
pass  section-g-docs
pass  section-h-cross-language      12 checks pass
```

The paste-ready object now lives in **`validation/m14/proposals/sql-langconfig-entry.ts`** (this file's
§1 is the same object with the reasoning). The E/F ruling is in `SQL-STATE.md` §6.

## 1 · THE `LANG_CONFIG` ENTRY — paste-ready, verbatim

Insert into `LANG_CONFIGS` in `script/m14/completeness-inventory.ts` (any position; alphabetically after
`swift`):

```ts
  sql: {
    id: "sql",
    wasm: "tree-sitter-sql.wasm",
    classification: "sql-completeness.json",
    fixturesDir: "validation/m14/fixtures/sql",
    docs: ["docs/analyzers/history/sql-lane-notes.md", "docs/analyzers/sql.md"],
    // E/F await the canonical sweep. The lane has NO differential oracle at all — SQL-G14 records
    // that `script/m14/differential.ts` has 68 per-language derive functions and none is SQL's, so a
    // scoped SQL differential exits "derived ZERO truth edges". A floor row cannot be pinned by a
    // sweep until the oracle exists; naming the key now means section E fails with a precise reason
    // instead of hiding the lane. FLAGGED: do not read the floor as met.
    perfKey: "duckdb:sql",
    requiredKinds: ["contains", "uses", "references", "calls", "imports", "overrides", "instantiates"],
    payloads: {},
    title: "sql schema wave (#419 sections A, C, D, G, H; B blocked on the gate's reverse check; E/F await the canonical sweep)",
  },
```

**Why these values, each measured rather than assumed:**

* `requiredKinds` — the analyzer emits **7 kinds over its own 17 fixture sources**, and **all 7 are pinned
  by expectation files**: `contains` 79 · `uses` 28 · `references` 24 · `calls` 17 · `imports` 5 ·
  `overrides` 3 · `instantiates` 1 (157 relationships total). `exports` and `extends` are NOT emitted:
  SQL-D16 rules exports non-derivable and SQL-D14 rules `extends` unreadable from the wired grammar, so
  they are declared decisions — which section B explicitly allows.
* `payloads: {}` — the lane pins no Matrix 1b payload key (`expectComplexity`/`expectPayload` do not
  occur in any `sql/*.expectation.json`). Three configs already in the file use `payloads: {}`, so this
  is an established form, not a loophole; section C passes with an empty row set.
* `perfKey` — the baseline's only sql-shaped row is `sqlite:c`, which is the **C** analyzer over the
  sqlite corpus, not this lane. Using it would measure another lane. `duckdb:sql` follows the fleet's
  `<repo>:<lang>` convention and is the corpus the lane's own census measures (594 duckdb `.sql`).
* `differentialCheck` — **omitted on purpose**: `M14.0.F5.json` has 67 checks and not one is a SQL
  differential (SQL-G14). Inventing an id would be a claim nothing can check.
* `floorResidual` — omitted: it exists for a lane whose honest floor CARRIES ruled residuals (C's macro
  boundary). sql has no floor at all yet, so there is nothing to pin a residual to.

## 2 · THE `GATED_LANGS` ADDITION

```ts
const GATED_LANGS = [..., "perl", "sql"]
```

**Do not add `sql` until §3 is applied.** Adding it now turns `npm run verify` red on section B for a
reason that is not about this lane (§3 is a gate defect), which is exactly the state the gate's own
comments warn about for `html`.

## 3 · THE GATE FIX SECTION B NEEDS — Lead-owned, one field, backwards compatible

**The finding.** `verifySectionB`'s reverse check is right in principle ("an emitted kind the row omits
is published output no contract row accounts for") but its measurement universe is wrong for a lane whose
fixtures directory contains INSTRUMENTS. `emittedKinds()` (completeness-inventory.ts:1240-1268) reads
**every top-level non-JSON file** in `fixturesDir` and parses each with `ASTEngine.parseFile`, which routes
by extension. The sql lane keeps **~25 `.ts`/`.mts` probe instruments** beside its `.sql` fixtures (the
established layout — `sql-contains-oracle.mts` is imported by lead-owned `script/m14/sql-truth.ts:78`, so
it cannot move). One of them, `sql-contains-oracle.mts`, is parsed as **TypeScript** and emits
`exports` — so the check reports that "the analyzer publishes `exports`" when the analyzer is SQL and
SQL-D16 rules, with a fixture and a mutant behind it, that it publishes none.

**Measured, not inferred:** running the gate's own `emittedKinds` logic over the directory, exactly one
top-level file emits `exports` — `sql-contains-oracle.mts`, a TS instrument — and its emitted set is
`calls,contains,exports,imports,instantiates,references,uses`. The `.sql` sources emit the 7 kinds above.

**The false remedy, REFUSED:** adding `exports` to `requiredKinds`. That would certify a relationship
kind the lane does not emit, contradict SQL-D16 and SQL-G5, and the forward check would then fail
(searching for a pin that cannot exist). A row must not be edited to silence an instrument.

**The proposed fix — a `fixtureExtensions` field, default = current behaviour:**

```diff
   fixturesDir: string
+  // WHICH FILES IN `fixturesDir` ARE THE LANE'S OWN SOURCES. The section-B reverse check RUNS the
+  // analyzer over the fixtures directory, and a lane that keeps its instruments beside its fixtures
+  // (sql, toml, hcl…) had every `.ts` probe parsed by the TYPESCRIPT analyzer and its kinds folded
+  // into the LANE's emitted set — sql's `exports` came from `sql-contains-oracle.mts`, not from the
+  // sql analyzer. Absent means "every non-JSON file", which is the behaviour every current config
+  // keeps; a lane states its extensions to be measured on its own sources.
+  fixtureExtensions?: string[]
   docs: string[]
```

```diff
   const sources = fs.readdirSync(dir).filter((f) => {
     if (f.endsWith(".json")) return false
+    if (cfg.fixtureExtensions && !cfg.fixtureExtensions.some((e) => f.endsWith(e))) return false
     try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
   })
```

and in the sql entry above: `fixtureExtensions: [".sql"],`.

**With that field the section reads: pinned 7, emitted 7, all accounted for → section B passes.** The
check keeps its teeth for every other lane (no field = today's universe) and gains the ability to be
RIGHT for the lanes that keep instruments beside fixtures. `sql` is the first lane to need it; the same
latent false positive exists for any lane whose fixtures directory holds a `.ts` instrument.

## 4 · WHAT THIS MAKES THE LANE

`sql` reaches **5/8 through the gate today** (A, C, D, G, H), **6/8 the moment §3 is applied**, and
**CONFORMANT only after the Lead's baseline sweep supplies E/F** — which for sql is additionally blocked
on SQL-G14 (no differential oracle), so E is not merely un-swept, it is un-sweepable until an oracle
exists. The status ladder entry for sql is therefore **INVENTORY-DONE**, not GAPS-CLOSED and not
CONFORMANT, and the entry's title says so rather than letting a patch-shaped pass imply more.
