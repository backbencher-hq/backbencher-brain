# real-sql-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-sql-analyzer.ts`
- Grammar: **patched** `@derekstride/tree-sitter-sql` 0.3.11, built from its own upstream
  source with eight rule groups added; wired at `wasm/tree-sitter-sql.wasm`
  (sha256 `486ec2159ecff99bfb94c1549c3e1306594b252f653e13d920e2fdddcff99369`, 12,555,354 B;
  826 node types, 62 fields)
- Wiring: `ASTEngine.parseFile` → `RealSqlAnalyzer`; the engine also hands the analyzer its
  loaded grammar through `RealSqlAnalyzer.setGrammar` in `parseRaw` (see *Recovery passes*)
- Corpora: `proxicall@1f3e3567` (441 tracked SQL files), `postgrest@978b169` (32), and — added
  2026-09-27 — the PostgreSQL 14 extension corpus at `/usr/share/postgresql/14/extension`
  (696 files) plus 30 Geary ORM migrations

**The grammar is not upstream 0.3.11.** `reviews/m60-sql-grammar-l1xnan-047-refused.md`
adjudicated every published alternative and refused them on measured grounds, concluding
"sql needs a patch, not a swap". The patch adds: `CONSTRAINT <name> UNIQUE | FOREIGN KEY |
INDEX`; `DELETE … AS alias` and `DELETE … USING`; `grant_statement` / `revoke_statement` as
**visible** nodes; `do_statement` / `drop_policy`; and — largest of all — **PL/pgSQL procedural
statement scaffolding** (`IF/ELSIF/ELSE/END IF`, `LOOP`, `WHILE`, `FOR … IN`,
`BEGIN/EXCEPTION/END`, assignment, `RETURN`, `RAISE`, `EXECUTE`, `PERFORM`, `ASSERT`,
`EXIT`/`CONTINUE`, plus a `DECLARE` section that reuses the existing `function_declaration`).
The plpgsql group reuses `$._expression` and `$.statement` unchanged rather than
reimplementing plpgsql expressions; the measurement that scoped it is that the expression
grammar was never the problem. The pristine build is kept at
`fixtures/sql/grammar/pristine-sql.wasm` so the A/B stays reproducible. The lane is registered
in the pin contract (`validation/m14/grammar-pins.json`), by sha256 + surface + provenance
rather than source rebuildability — a rebuild attempt produced a parser.c 111,557 bytes off the
wired one, so the source is *not* claimed to rebuild these bytes, and the pin says so.

The engine SQL preprocessing block was removed. SQL is parsed as written; there is no
source-text substitution that changes the language before AST analysis or shifts the meaning
of a declaration.

## Symbol contract

| Construct | Symbol kind | AST extraction |
| --- | --- | --- |
| schema | `namespace` | `create_schema` identifier |
| table | `class` | `create_table` → `object_reference.name` |
| column | `property` | `column_definition.name`, owned by the table |
| index | `constant` | `create_index` first identifier, table from object reference |
| view/materialized view | `class` | `create_view`/`create_materialized_view` object reference |
| stored function | `function` | `create_function` object reference, arguments and return type fields |
| trigger | `function` | `create_trigger` first object reference |
| custom/enum type | `type` | `create_type` object reference and enum elements |
| sequence, role, extension | `constant`, `namespace`, `module` | dedicated `create_*` AST nodes |

The table→`class` and index→`constant` mapping is **measured, not assumed**: on a corpus file
with known ground truth, 2 textual `CREATE TABLE` yield 2 `class` symbols and 6 `CREATE INDEX`
yield 6 `constant` symbols. An early recall probe of this lane mapped `table` to `type` and
reported a false 0 % table recall; the mapping is recorded here because that mistake is easy to
repeat.

Columns and named constraints carry exact AST ranges, owner names, SQL type, primary-key /
unique / foreign-key metadata, and reference targets. Function parameters are represented in
`parameters`; they are not phantom variable symbols. Anonymous `SELECT`, DML, CTE aliases,
literals, fields, aliases, and built-in function names are not declarations.

All ranges are **1-based** on both line and column. This was a measured defect class, not a
style preference: `range()` originally used 0-based columns, so the only 0-based range in the
engine was SQL's, and all four column fields of every SQL symbol were off by one, corpus-wide.
Pinned by mutant `sql/range-columns-zero-based` and fixture `sqld8-range-and-ids`.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | table → column and table → index/constraint; deduplicated by type/source/target |
| `uses` | view/function/query/DML → referenced table; anonymous queries use `global` |
| `references` | foreign-key table → table, index → indexed table, trigger → target table |
| `calls` | trigger → executed function and SQL invocations that are not known built-ins |
| `imports` | explicit `#import`/`@import` comment directives, with AST comment ranges |

Relationship identity uses a `Map` keyed by type/source/target. Repeated DML operations merge
operation metadata rather than creating duplicate graph edges. Unresolved tables/functions
remain external names; no cross-file symbol is invented by the analyzer.

Keyword and builtin guards are enforced on every edge. Measured before the guard: **49** edges
pointed at a SQL keyword (`calls global->USING`, `uses global->WITH`, `calls …->FILTER`), a
`REVOKE … FROM joe` published a **role** as a table, and project builtins
(`generate_series`, `jsonb_build_object`, `current_setting`) leaked as calls. All are now zero
on the ProxiCall corpus.

## Recovery passes

The analyzer has **three** passes beyond the main tree walk. Each is strictly additive — the
main pass's declarations are keyed by absolute start index, so a re-parse can only contribute
what was missing. Each reports what it did in `metadata.ambiguity`, so a pass that buys nothing
is visible rather than silent.

| Pass | What it recovers | Gate |
| --- | --- | --- |
| declaration sweep | declarations nested **inside** another declaration. `program` requires top-level items to be `statement`/`block`/`transaction`, so error recovery routinely buries one inside another. Measured on `database/schema.sql`: 401 of 3,557 symbols, including `business_profiles`, `business_rules`, `business_content`, `business_locations`. Walks the whole tree and **descends through** declarations — a version that stopped at the first declaration left every nested one invisible | fixture `sqld9`, `sqld10`; mutant `sql/sweep-stops-at-a-declaration` |
| statement resync | a catastrophic top-level ERROR span (one unterminated dollar-quote swallowed `database/schema.sql` rows 1–10573). Re-parses the file statement by statement, with absolute-offset translation | `script/m60/verify-sql-resync.ts` (C1–C3: 19 firings, all recover, 0 range violations), package script `verify:m60-sql-resync` |
| EXECUTE-literal | declarations handed to the database as a **string**: `EXECUTE 'CREATE TRIGGER …'`. See below | fixture `sqld11`; mutants `sql/execute-literal-recovery-removed`, `sql/execute-literal-ignores-comments` |

### The EXECUTE-literal pass, and why it is text-based

A tree-sitter grammar parses one language and cannot produce `statement` nodes for SQL that is
text inside a string literal. This was **tested, not assumed**: the V4 plpgsql grammar
candidate cut ProxiCall error nodes 36 % and added 9 % structure while leaving product output
byte-identical, because parsing the body still leaves the DDL inside a string. The recovery is
therefore in the text, and it needs no grammar change.

`scanExecuteLiterals` is a character state machine (zero regex, per the policy below) that looks
for `EXECUTE [IMMEDIATE] '<sql>'`, skipping `--` and `/* */` comments and `'…'` / `"…"` /
backtick regions, and **deliberately not** skipping dollar-quoted regions, which is where these
literals live. Each literal's **raw** inner text is re-parsed with `state.slice` translating
offsets.

The raw slice is handed on **with its `''` escapes intact**, and that is load-bearing: `''` is a
valid escaped quote inside a SQL string, so the parser reads it correctly as written *and* the
slice stays a contiguous substring of the file, so `slice.byteOffset` maps every recovered range
to its true absolute position. Unescaping first would shorten the text and silently shift every
range after the first escaped quote. Pinned by the `quoted_name` case in `sqld11`.

Yield: ProxiCall 5,891 → **5,923** symbols; the extension corpus 2,172 → **2,328** symbols and
3,050 → **3,284** relationships.

**Its limit is measured and it is a hard one.** 94 % of the extension corpus's `EXECUTE` literals
are *concatenated fragments* — `EXECUTE 'CREATE SEQUENCE ' || quote_ident(x) || …` — where the
literal is three words and the declaration's **name is computed at run time**. The pass recovers
the kind; the name is unrecoverable in principle. Only 78 of those literals are standalone
statements. `EXECUTE format('…', x)` is a separate real shape and is not matched.

### The harness bug this exposed

`script/m14/run-fixtures.ts` calls `analyzer.analyze(...)` directly, so the engine's `setGrammar`
handoff in `parseRaw` never ran for the fixture lane — and `analyze` is synchronous while
`Language.load` is not. **Every recovery pass was inert in the fixture lane.** That is why the
resync needed its own corpus gate instead of a synthetic fixture, and why the first version of
`sql/execute-literal-recovery-removed` was a vacuous mutant that "passed" by never running.
`runLang` now performs the handoff, through `analyzer.constructor` because `setGrammar` is
static and reaching for it on the instance silently does nothing.

## Supported constructs

Fixtures: `validation/m12/fixtures/sql/` (Schema, Queries, Negative) and
`validation/m14/fixtures/sql/sqld1..sqld11` (11 fixture lane cases).

Covered: schemas, tables, typed columns, primary keys, unique/named constraints, defaults,
foreign keys, indexes, views, stored functions and procedures, triggers, DML, CTEs, joins,
subqueries, set operations, `CASE`, `SET`/`RESET`, `COMMENT ON`, `MERGE`, `TRUNCATE`,
`GRANT`/`REVOKE`, `DO`, policies, and negative cases proving that anonymous statements,
parameters, fields, literals, and built-in calls do not become symbols/calls.

`MERGE` and `TRUNCATE` deserve a note: the grammar's rules for them are **hidden**, so their
keywords inline into `statement` and an arm keyed on the node type can never run. They emit
their edges from the keyword shape instead, which is why the first version of those arms was
dead code that was replaced rather than kept. Pinned by `sqld4` and mutant
`sql/unreachable-arms-reinstated`.

## Unsupported / explicit-unknown constructs

- **PL/pgSQL bodies.** A body is only parseable if every statement in it is ordinary SQL, and
  real PostgreSQL DDL is not shaped like that. 56.7 % of all `CREATE` declarations across the
  three corpora sit inside a dollar-quoted body. A procedural grammar was built and measured
  (V4, and V5); see *Grammar candidates* below for whether it shipped.
- **Dynamic SQL by construction.** `EXECUTE format(…)`, runtime-computed identifiers, and
  cross-file schema resolution are unresolved by syntax-only analysis and remain external
  edges. The EXECUTE-literal pass deliberately does not invent names it cannot know.
- **Known corpus exclusions.** 121 of 440 ProxiCall files yield zero symbols; most are
  `verify_*.sql` scripts that are almost entirely `DO` blocks of `RAISE` and genuinely declare
  nothing. This is stated rather than hidden, and is not counted as recall.

## Grammar candidates that were measured and not shipped

Recorded because "we looked and it did not help" is a result, and because both were built rather
than argued.

| Candidate | What it was | Verdict |
| --- | --- | --- |
| **V3** | opaque `DO $$ … $$` (bodies consumed as one token) | **Rejected.** Cuts tree-level error files 320 → 196, but 49/256 damaged files lose ≥25 % of their structure (worst −95.8 %, 2,278 → 79 named nodes) and 0 files gain any, because the gain is an opaque token swallowing real declarations. Product output byte-identical to V2 |
| **V4** | plpgsql statement scaffolding, 17 rules + 16 keywords, reusing `$._expression` | **Blocked on first build.** −36 % ProxiCall error nodes, +9.4 % structure, but it regressed the pinned `block-declarations` contract case (53/54) |
| **V5** | V4 plus the DECLARE section restored and the conflict declared | **Blocked, and it disproved the diagnosis.** It failed the *same* case identically, which is how the real cause was found |
| **V6** | `optional(';')` restored after `END` in both dollar-quoted body forms, plus `[$.plpgsql_block]` declared | **SHIPPED, superseded by V8.** `errors=0` on the blocking input. Function recall 17.6 % → 37.0 % by the count ratio |
| **V8** | psql meta-commands as an **`extra`**, quoted `LANGUAGE 'sql'`, C-language body `AS 'modulename', 'symbolname'` | **SHIPPED (current).** Files parsing with zero errors on the extension corpus **4/387 → 105/387**; distinct function names **834 → 951** of 1,170; class symbols 11 → 13. The psql directive was the top damage shape by *file count* (301 of 302) and it LOST declarations, not just error spans |

Six conflicts were resolved by measurement, not guesswork, and three of them are **declared**
rather than resolved by deletion: `[$.plpgsql_block, $._plpgsql_body_item]`,
`[$.function_body, $.plpgsql_declarations]`, and `[$.plpgsql_block]`. Two lessons worth
carrying, both paid for in builds. **An ambiguity between two rules is a reason to declare the
conflict, not to delete a capability** — deleting `plpgsql_block`'s DECLARE section looked like a
simplification and was a regression. And **when a build names a conflict for one rule, changing a
different rule is collateral, not progress**: while fixing the `do_statement` conflict I also
removed `optional(';')` from `function_body`, and that — not the DECLARE section V5 went on to
re-add — was the actual regression. The discriminator was noticing that V5 changed the blamed rule
and the observed ERROR span did not move.

## Regex inventory

The SQL analyzer has **zero regex usages**, and this is now enforced rather than asserted.
`reviews/regex-policy.md` requires zero by default; the census
(`validation/m12/results/regex-census.json`) had never recorded SQL at all, so the two regexes
this lane introduced were unregistered and `script/m12/verify-regex-census.ts` reported them
`PENDING` while passing silently on the drift. Both were replaced with character scans — a
dollar-quote tag reader and a `CONSTRAINT` prefix reader — and equivalence was proven over
**3,406,758 dollar positions** across the corpus plus adversarial input, 0 mismatches. The
EXECUTE-literal scanner is a character state machine for the same reason. The remaining census
failures belong to other lanes.

## Complexity envelope

Evidence: `validation/m12/results/sql-corpus-complexity.json`. **Stale relative to the passes
above** — it predates the sweep, the resync and the EXECUTE-literal pass, and there is still no
perf gate for this lane. The structural claims that remain valid: one iterative traversal per
root/declaration/query, constant-time set/map deduplication for symbols and relationships, no
per-symbol rescan of the symbol or relationship arrays, and no O(n²) resolution path. The three
recovery passes are bounded (one whole-tree sweep, one parse per statement slice, one parse per
EXECUTE literal) and none of them is proportional to the symbol count.

The known unmeasured cost: the EXECUTE-literal pass re-parses each literal, so a file with many
literals pays one extra parse per literal. Not separately benchmarked.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/sql.json` — **84 hand-audited facts** over 5
  fixtures, extended 2026-09-27 with `Schema2.sql`/`Queries2.sql`
- Authority: manual audit of independent fixtures
- Result: `validation/m12/results/sql-differential.json`
- Differential: **84/84 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown, 0
  unsupported**, `earliestFailingLayer=none`, `parseErrors=0`

## Gates

| Gate | Result | Self-test |
| --- | --- | --- |
| contract battery (`fixtures/sql/probe/contract-battery.mts`) | 54 / 54 | — |
| M14 fixture lane | 11 / 11 | — |
| mutation harness, SQL mutants | **13 / 13 caught** (1 retired, see below) | 9 were red before their fixtures existed |
| node-type gate (`script/m12/sql-node-types-compare.ts`) | 83 referenced, **0 dead**, 0 unjustified | injecting one dead reference → **exit 1** (previously the assertion was vacuous) |
| resync corpus gate | C1–C3 plus **S1–S2** (sweep reachable; ≥50 declarations recovered) — 5 firings, 77 sweep-recovered | impossible bars → **exit 1** |
| m12 differential | 84 facts, P = R = 1.000 | phantom classes pinned as **absences** |
| pin contract | sql lane validates | a drifted sha is a `PIN FAILURE` |
| regex census | no sql finding | — |
| perf gate (`script/m60/sql-perf-gate.ts`, `verify:m60-sql-perf`) | P1–P5 pass | bars are a regression detector, not a benchmark; `BB_PERF_QUIET=1` skips writing the artifact |

Two mutants are **retired rather than left green**, and the harness now has a `retired` flag so
the record stays in the file, is printed on every run, and is not silently skipped.

- `sql/resync-declarations-dropped` — the resync fires on cumulative multi-error corpus files and
  on no synthetic fixture, so a fixture mutant could not be shown to fail. Pinned by
  `script/m60/verify-sql-resync.ts` (C1–C3) instead.
- `sql/sweep-stops-at-a-declaration` — retired 2026-09-27 after the plpgsql grammar stopped
  collapsing the small fixture cases that made the sweep catchable there. The pass is worth
  *more* than when the mutant was written (77 declarations across 8 ProxiCall files, 375 across 79
  extension files), so it is re-pinned by the new corpus assertions S1/S2. A templating shape
  (`CREATE TABLE {{ ref('x') }}`) was tried as a substitute fixture and does **not** work: the
  declarations either side stay reachable and the sweep never fires. Restore the mutant when a
  shape exists that still buries a declaration inside another declaration.

## Known gaps, stated rather than implied

- **Distinct-name** function recall on real PostgreSQL extension DDL is **951 of 1,170 (81.3 %)**;
  the count ratio says 35.8 %. Report the name-based figure: on a versioned extension corpus the
  two disagree by more than 2x because the same function is re-declared in every version script,
  and the count ratio measures repetition rather than coverage.
- **282 of 387 extension files still contain at least one ERROR**, so most of the cascade loss
  remains. The next dominant damage shapes should be re-measured, not assumed.
- `@placeholder@` templating (154 files) is not addressed; it needs a template token in
  identifier and type positions and was deliberately deferred rather than half-done. **Table recall is 4.1 %** (13 of 314) and was *not* improved by that grammar, which
  makes it the sharpest remaining target: `CREATE TABLE` inside a plpgsql body is still
  unreachable, and the 94 % of `EXECUTE` literals that are concatenated fragments have a
  run-time-computed name that no technique can recover. 56 of 387 extension files yield zero
  symbols.
- The node-type gate proves every node type the analyzer *names* is one the grammar emits. It
  says nothing about types the grammar produces that nobody reads.
- F11 (`script/m14/verify-grammar-leaves.ts`) still reports **INADMISSIBLE**. Every sub-verdict
  is adjudicated in `fixtures/sql/REVIEW.md` §3 — 138 of the 177 "lost" symbols are
  `property:ENABLE` phantoms the pinned grammar invents from `ALTER TABLE … ENABLE ROW LEVEL
  SECURITY`, and all 5 changed-shape files gain a `having` node. The gate has no bucket for
  either, and its verdict has not been changed.
- Unknown relationship targets on ProxiCall are **76 edges (0.61 % of 12,470)**, re-measured
  2026-09-27 after the plpgsql grammar and the EXECUTE-literal pass. The count was **165
  (1.31 %)** before `SQL_BUILTINS` was extended with the measured set of PostgreSQL- and
  extension-provided names; 89 of those edges were `encode`, `digest`, `daterange`,
  `uuid_generate_v4`, `gen_random_bytes`, `array_append`, `regexp_replace` and friends — SQL
  functions an agent reading the graph could easily mistake for project code. The remaining
  76 are dominated by system catalogs (82 edges / 17 names, `pg_policies`, `pg_class`,
  `pg_namespace`) which are legitimate external references rather than unknowns, and by names
  declared in files the grammar still cannot parse.
- The perf gate measures files the analyzer actually processes in full (**<= 400 KB**). 309 of
  the 696 extension-corpus files are larger and hold **91.8 % of its bytes**; the engine
  truncates anything over 1 MB, so throughput over the raw 235 MB corpus is not a meaningful
  number and an earlier figure of "22 symbols/s" that counted those bytes was wrong by ~18x. On
  files actually analyzed the corpus runs at p50 54 ms, p95 2.7 s, max 4.8 s, ~104 KB/s, and
  the primary corpus at p50 24 ms, p95 253 ms. Cost is dominated by the **main analysis pass**
  (70–80 % of wall on the slowest files), not by the grammar and not by the recovery passes,
  which cost zero on those files.

## Evidence pointers

- Review: `fixtures/sql/REVIEW.md` (measured arc, §1 defect table, §3 grammar, §8 second
  corpus, §9–10 the grammar candidates and the EXECUTE pass)
- Fixtures: `validation/m12/fixtures/sql/`, `validation/m14/fixtures/sql/`
- Ground truth: `validation/m12/ground-truth/sql.json`
- Differential: `validation/m12/results/sql-differential.json`
- Corpus errors: `validation/m12/results/sql-corpus-errors.json`
- Completeness spec: `script/m14/spec/sql-completeness.json` (82 handled / 96 internal-silent /
  6 gaps / 10 rulings)
- Lane records: `validation/m60/sql/` — `second-corpus-recall.json`,
  `v3-rejection.json`, `v4-plpgsql-candidate.json`, `execute-literal-recovery.json`
- Gates: `script/m12/sql-node-types-compare.ts`, `script/m12/verify-analyzer.ts`,
  `script/m14/mutate-analyzer.ts`, `script/m14/verify-grammar-pins.ts`,
  `script/m60/verify-sql-resync.ts`, `script/m60/measure-grammar-recovery.ts`
- Probes: `fixtures/sql/probe/` (contract battery, grammar census, field introspection, corpus
  sweep, unknown-symbol, parser-state-leak, grammar A/B)
- Grammar review: `reviews/m60-sql-grammar-l1xnan-047-refused.md`, `reviews/regex-policy.md`

## Issue

M12.33 / GitHub issue #172.
