# SQL lane — `sql` (engine language id) / `SQL` (firing-check name)

Lane owner: **sql-lane**. Branch `analyzers/ontology-laptop-b`.

**Corpus.** `$HOME/fixtures/repositories` — 20 repositories carry `.sql`.
**1,970** git-tracked `.sql` files (list sha256 `3dd1e6c0…`), **1,964** admitted under the engine's
own 1 MB `FULL_AST_LIMIT` (list sha256 `80837fae…`), 6 over the cap (largest 3,926,506 B),
0 parse failures, **0 degraded** (no regex-fallback rows in any figure below).

The lane's population is the **extension** (`LANES_B.sql = "sql"`), not a repository. The firing
instrument is wired to **one** repository (`duckdb`, 594 `.sql`), which is a **30%** subset of the
lane's population and is why every number on this page is given at **both** scopes, labelled.

---

## 1. THE CONTRADICTION, AND WHICH OF THE TWO NUMBERS WAS WRONG

The board read `sql 6/8 from=spec coverage block` while the firing log read
`SQL 3 types fired … SILENT: extends implements imports exports references overrides instantiates`.
**Both were wrong, in opposite directions, and neither was a measurement of the language.**

* `6/8` was a declaration about **rulings**: `implemented` was `[calls, uses, contains, imports,
  references, overrides]` with `implements`/`instantiates` excluded as grammar-absence
  (`d726f9a69`). `imports` and `overrides` were in that set on the strength of SQL-D11/SQL-D12
  alone — **no corpus count stood behind either**, which is exactly what §7.2 of the handoff
  forbids.
* `3 types fired` is a **draw artifact**. The instrument's stride is an even stride over a
  sorted list, but `duckdb`'s first files are `benchmark/*/queries/*.sql` — read-only analytics
  SELECTs. `firing-check.mjs`'s own recorded measurement for this corpus: **5 of 120 sampled files
  contain any `CREATE/ALTER/DROP` (4.2%), against 108 of 594 corpus-wide (18.2%)** — so the
  DDL-derived types cannot fire in the sample however correct the analyzer is. The instrument's
  own header says the column is a claim about *these files*.

**The answer came from the whole population, and it split the difference:** the 120-file stride
was a sample artifact; the `6/8` declaration was *right about six types* and *wrong about one
exclusion*; and the `4/8` correction that replaced it (`56e37ff86`) was itself **too strong in the
other direction** — see §4.

---

## 2. WHOLE-CORPUS TYPING, PER TYPE, BOTH SCOPES

`npx tsx script/m14/incoming-gate.ts sql sql 0` — 1,964/1,964 files, 0 degraded, TABLE 1
(per-project, production's scope), ONE RUN 2026-10-11:

| type | whole population (1,964) | resolved | amb(decl) | unresolved | collRes | pinned duckdb (594, firing) |
|---|---|---|---|---|---|---|
| calls | 3,908 | 484 | 2,411 | 1,007 | 0 | 189 |
| uses | 9,160 | 4,560 | 3,582 | 734 | 0 | 2,296 |
| contains | 12,132 | 12,132 | 0 | 0 | **424** | 1,076 |
| references | 6,015 | 2,346 | 3,598 | 71 | 0 | 1 |
| imports | **53** | 16 | 31 | 6 | 0 | **0** |
| overrides | **8** | 0 | 8 | 0 | 0 | **0** |
| instantiates | **21** | 11 | 8 | 2 | 0 | **0** |
| extends | 0 | 0 | 0 | 0 | 0 | 0 |
| implements | 0 | 0 | 0 | 0 | 0 | 0 |
| exports | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **31,297** | 19,549 | 9,638 | 1,820 | 424 | — |

`extOK` 290, `ext?` 0, `extFAIL` **0**, `bindFAIL` 0, `causeFAIL` 0.
Pinned scope: `BB_PICK_CAP=2000 NFILES=1000 bun script/m14/firing-check.mjs SQL` →
`SQL 4 types fired 594/594 parsed of 594 admitted (even stride) [corpus=duckdb WHOLE]`
(`calls:189 contains:1076 references:1 uses:2296`).

**The three types the pinned corpus reads ZERO for and the whole population FIRES are exactly the
three the block had placed outside `implemented`** — `imports`, `overrides`, and `instantiates`
(the last behind a grammar-absence, which *leaves* the denominator).

Artifacts: `validation/m14/fixtures/sql/whole-corpus-typing.txt` (raw instrument output) and
`whole-corpus-typing.json` (machine-readable per-type table, populations, sha256s).

### 2.1 THE CROSS-TAB — a second instrument, and a defect it found in itself

`validation/m14/fixtures/sql/lane-census.ts` measures firing a different way: it walks the tree
**itself** and counts **construct sites** per type, so agreement with the gate is two methods, one
answer rather than one method twice. Run over the pooled corpus root, it reproduced the decisive
fact — **`imports`, `overrides` and `instantiates` all fire** — and then disagreed with the gate on
the TOTAL by **1.9×**, which is the part worth recording:

| | files | TOTAL edges | calls | uses | contains | references | imports | overrides | instantiates |
|---|---|---|---|---|---|---|---|---|---|
| census **before** the fix | 1,526 | 16,273 | 1,975 | 6,740 | 5,400 | 2,092 | 38 | 7 | 21 |
| census **after** the fix | 1,965 | 31,051 | 3,873 | 9,106 | 12,024 | 5,966 | **53** | **8** | **21** |
| incoming gate (TABLE 1) | 1,964 | 31,297 | 3,908 | 9,160 | 12,132 | 6,015 | **53** | **8** | **21** |

**CAUSE, MEASURED: `repositories/proxicall` is a SYMLINK** (`proxicall -> $HOME/ProxiCall`)
and the census's `walk` tested `readdirSync(…, { withFileTypes: true }).isDirectory()`, which is
**false for a symlink**, so it dropped **439 `.sql` files — 22.3% of the 1,965-file population and
~48% of its edges — in silence**. Every "pooled, whole corpus" figure this instrument had produced
(`lane-census-pooled.json`, 1,526 files — quoted by this spec's own `gap` prose and by SQL-D11/D12/
D13/D24) was short by **one entire repository**. The corpus root holds exactly one such symlink;
180 symlinked directories in total are now followed, counted and printed.

**Fix, and the before/after is over the SAME population**: the walk follows a symlinked directory
and counts it (`CAP` also aligned to the engine's own `FULL_AST_LIMIT` 1,048,576 — on this corpus no
file moves, measured). Nothing else changed: **1,526 → 1,965 files, 16,273 → 31,051 edges.** The
1,526-file artifact is preserved, stamped `_WITHDRAWN` inline, as
`lane-census-pooled.SUPERSEDED-1526-files.json`.

**The cross-tab now reads: `imports` 53 = 53, `overrides` 8 = 8, `instantiates` 21 = 21 — EXACT**,
and every other type is within 0.9% (TOTAL within 0.8%), the residual being the two paths (this
census calls `parser.parse` + `analyze()`; the gate and firing instruments call `engine.parseFile`)
plus a 1-file admission difference. One site-to-edge check is exact where it can be:
`importsPsql` 22 + `importsExtension` 31 = **53 sites → 53 edges**.

**This is the programme's own defect class aimed at this lane's instrument** — an instrument that
MISREPORTED rather than refused — and it is the reason every number in §2 is quoted from the gate
and cross-checked, not from the census alone.

---

## 3. THE DECLARATION, AND ITS ARITHMETIC

    applicable = 10 − 1 grammar-absence (implements) − 0 unclassified = 9
    implemented (7)   calls · uses · contains · references · imports · overrides · instantiates
    corpusUnexercised (2)   extends · exports      <- each with a COUNTED citation
    gaps (0)                                       7 + 2 + 0 = 9  CLOSED

Board row after the correction: **`sql 7/9 from=spec coverage block`**.
`coverage-block-gate.ts`: **0 problems**, and all four silent-but-implemented types
(`references imports overrides instantiates`) are attributed by a **per-type count**, not prose.

This is a *lower*-looking ratio than `6/8` and it is the honest one: `applicable` **grew** from 8 to
9 (a type that fires corpus-wide is not grammar-absent) and `implemented` grew from 4 to 7.

### 3.1 `implements` — the ONLY grammar-absence, with two independent instruments

* **Instrument A (grammar inventory, re-measured from the pinned wasm):** 820 node types
  enumerated through `Language.nodeTypeCount`/`nodeTypeForId`; **0** contain `implement`,
  `interface` or `super`. Controls: `create` 31, `table` 26 — so the enumeration is readable, and
  a zero is distinguishable from a probe that read nothing.
* **Instrument B (corpus keyword census):** `git grep -liE '\bimplements\b' -- '*.sql'` →
  **0 of 1,970** files, control `create` → 132 files in duckdb alone.
* **Analyzer:** no emission site (the single `RelationshipType.Implements` occurrence is the
  `evidenceClassFor` switch).

### 3.2 `extends` — zero-sites, and it STAYS IN the denominator

Table inheritance **exists in SQL** (`CREATE TABLE c (…) INHERITS (p)`, `ALTER TABLE c INHERIT p`)
— so this is *not* grammar-absence in the rule-book §6 sense, and SQL-D14's own text says the
ruling "is a statement about the wired grammar rather than about SQL". The pinned grammar parses
`ALTER TABLE c INHERIT p` as a column named `INHERIT` (`real-sql-analyzer.ts:506`).

Measured: **0 edges** over 1,964 files; `inherits?(` **0 of 1,970** tracked files (control fires).
A construct the language has and our corpus lacks is `zero-sites`: it stays in the denominator.

### 3.3 `exports` — zero-sites, and SQL-D16's Instrument B is CORRECTED

The analyzer has **no** emission site. Over the whole population: **0 edges**.
**Correction:** SQL-D16 Instrument B cites *"0 occurrences of an `EXPORT` … token"*. That is false
as measured today — **14 of 1,970 tracked files carry the token**: duckdb 4 are the real statement
`EXPORT DATABASE 'duckdb_benchmark_data/tpcds_parquet' (FORMAT PARQUET);`, the other ten are
comments and column names (`export_ready_at TIMESTAMPTZ`, `'Saved export templates'`). None names a
symbol the file publishes to another unit, which is what an `exports` edge asserts, so SQL-D16's
**conclusion** stands and its **count** did not. The class is left in the **denominator** rather
than promoted to grammar-absence.

### 3.4 A stale count in the fleet ruling, not a changed conclusion

`docs/analyzers/EXPORTS-CONTAINS-RULING.md` and SQL-D16 both cite **"0 of 480 node types"** /
*"465 distinct node types"*. The pinned wasm enumerates **820** today. The `export`-family count is
0 in both readings, so the ruling is unaffected; the citation's number is stale.

---

## 4. THE CORRECTION THAT OVERSHOT — and the two self-refutations in the block

The block's own history, all three states committed:

| state | `implemented` | applicable | why it was wrong |
|---|---|---|---|
| `d726f9a69` → `6/8` | + `imports`, `overrides` | 8 | declared from RULINGS; no whole-corpus count stood behind either type |
| `56e37ff86` → `4/8` | `calls uses contains references` | 8 | corrected OUT on a **594-file single-repo** measurement — `instantiates` still grammar-absent |
| **this commit → `7/9`** | + `imports`, `overrides`, `instantiates` | 9 | whole population: each fires, with counts |

**The middle state is this lane's own instance of the defect HANDOFF §5.17 names in the Lead's
work** — *a lane whose `LANES` entry pins one repo cannot have absence certified from that repo*
(the xml precedent: `calls`/`extends`/`overrides` declared unexercised on 537 libxslt files while
the lane's 11,552-file population fired all three). Here the pinned corpus is 594 of 1,964 files,
and the three types it reads zero for are precisely the three that were moved out of
`implemented`.

**`instantiates` is the sharpest of the three**, because it was not merely unexercised but
**grammar-absent — the class that leaves the denominator**: the exclusion cites *"SQL has no
type-declaration or constructor node … 0 edges over all 594 admitted .sql files"*, while the lane's
own **SQL-D13** rules *"RULED: YES, and it is a composite-type cast"* and **SQL-D24** rules the
DuckDB zero *"THE EXCLUSION IS WORKING, the type is not under-delivering"* over a **pooled** census
of 36 construction sites → 21 edges. The analyzer carries a real emission site
(`real-sql-analyzer.ts:3435`). One exclusion was therefore buying ratio with no measurement.

---

## 5. RESIDUAL STATE AT WHOLE POPULATION — this lane is NOT at the four-clause bar

Stated plainly, because the ratio is not the bar:

    residual = amb 9,638 + unres 1,820 + extFAIL 0 + bindFAIL 0 + causeFAIL 0 = 11,458 of 31,297  (36.6%)
    clause 1  FAILS by 11,458 edges
    clause 2  PASSES  — extFAIL 0 · bindFAIL 0 · causeFAIL 0 at whole population
    clause 3  NOT MET  — the buckets are not yet attributed to NAMED causes with counts
    clause 4  FAILS   — collRes 424 (all on `contains`): resolved edges on a name with more than one
                        declaration, where production's `s.id` tie-break chose the row. `ofWhich`
                        is an UPPER BOUND; the store split has not been run for this lane.

What IS measured about the two largest buckets, from the gate's own BINDING INTENT block
(whole population, exact test): `calls` intended 0 / sameFileUnproven 1,581 / arbitraryTwin 1,488 /
noDeclaration 839 · `uses` 0 / 3,101 / 5,156 / 903 · `references` 0 / 4,239 / 1,718 / 58.
Overrides is the cleanest named cause at whole population: **8 edges, 8 ambiguous, 0 resolved**,
and the analyzer's `overrides` target is a bare leaf (SQL-D5) that another file also declares.

**A BOARD-LOG FINDING, reconciled exactly.** The board's incoming column for sql reads
`10062 ambiguous + 1821 unresolved of 31298 edges`. That is the **whole-population** run (the
measurement above is `31297 / 9638 / 1820`, 1 edge apart — a different run), but its ambiguous
column is **424 higher, which is exactly this run's `collRes`**: the log was written at 22:33 on
2026-10-09 (`48aa968bf`) and `fa2dc27e8` — *"`contains` was being classified by DECLARATION COUNT"*
— landed at **23:46 the same day**. The board's sql residual therefore overstates by 424
`contains` rows production binds with its own statement.

---

## 6. INSTRUMENTS, AND HOW TO RE-RUN EVERY NUMBER HERE

    firing, pinned corpus   BB_PICK_CAP=2000 NFILES=1000 bun script/m14/firing-check.mjs SQL
    whole population        npx tsx script/m14/incoming-gate.ts sql sql 0
    declaration             npx tsx script/m14/coverage-block-gate.ts
    board row               bun script/m14/language-board.ts --coverage
    fixtures                npx tsx script/m14/run-fixtures.ts --lang sql
    grammar inventory       npx tsx validation/m14/fixtures/sql/grammar-node-inventory.mts
    zero-claim keywords     git -C <repo> grep -liE '<pattern>' -- '*.sql'   (all 20 repos, with a control)
    second instrument       CENSUS_OUT=<path> bun validation/m14/fixtures/sql/lane-census.ts \
                              $HOME/fixtures/repositories 0 --pools
                            (its printed `walk:` line names how many SYMLINKED directories it followed)

**Fixtures, verbatim:** `summary: {"sql":{"pass":17,"fail":0}}` ·
`fixture baseline gate: no regressions` · `all fixtures pass`.
**No analyzer code changed** for this verdict: the defect was in the DECLARATION, and
`src/ast/real-sql-analyzer.ts` is untouched.

Both corpus-scale runs were the sanctioned **labelled, unguarded `nice -n 10`** form —
`.bb-heavy-v3.lock` was held by another agent (the guarded attempt produced 0 bytes for >5 minutes;
`firing-check.mjs` prints `enum has 10 types` *before* its loop, which is how "never started" was
distinguished from "running" rather than assumed).

---

## 7. OPEN ITEMS

1. **Residual** — 11,458 edges at whole population, clauses 1/3/4 open (§5). The `contains`
   `collRes` 424 needs the store split before it is called irreducible.
2. **SQL-D5's citation** — *"441 files / 6,917 edges"* for `references` is not reproduced by this
   whole-population run (6,015 edges over 1,964 files, 1 over duckdb). It must not be quoted again
   without its own population.
3. **`instantiates` sizing instruments** (`instantiates-sizing.ts`, `instantiates-sizing-pooled.txt`)
   predate this run and were **not** re-run here; their 36-constructions → 21-edges funnel is
   consistent with the 21 edges both instruments above measure, and it is cited as SQL-D24's, not
   as this page's. The census's own precise counter reads `instantiatesCtor 184 site(s) in 35
   file(s)` — a different predicate (every `cast` carrying a `custom_type` FIELD) and therefore a
   different denominator, which is why the two are quoted separately.
4. **`docs/analyzers/real-sql-analyzer.md`** is the M60-wave doc and is **not** this lane's record;
   it is outside this lane's write scope. Lane records live at `docs/analyzers/<lane>.md`
   (`hcl.md`, `r.md`, `markdown.md`), which is why this file exists.
