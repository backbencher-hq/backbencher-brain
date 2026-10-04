# real-sql-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-sql-analyzer.ts`
- Grammar: **patched** `@derekstride/tree-sitter-sql` 0.3.11, built from its own upstream
  source with eight rule groups added; wired at `wasm/tree-sitter-sql.wasm`
  (sha256 `848e081247247db54545d4122a394dad3c85f79bb96a5713dbd658081b8eb819`, 12,620,599 B;
  **825 node-type ids / 590 distinct named types / 62 fields / ABI 15**, re-measured
  2026-09-27 through web-tree-sitter 0.25.9 with `measureSurface` from
  `script/m14/verify-grammar-pins.ts`)
- **The pin record for this lane is STALE and the pin does not currently validate.**
  `validation/m14/grammar-pins.json` → `lanes.sql.wired` records
  sha256 `bcb9888ec30d27adf5dccb13e5fd45ee70102927920fcd5245e9812bed577800` at
  **2,440,507 B** and a 729-id surface — the **pre-V11** build. The wired file is
  12,620,599 B, so `bun run script/m14/verify-grammar-pins.ts` reports a drifted
  sha for `sql` until the record is regenerated (an explicit `--write` act, and
  regenerating it is a lane-owner decision because the regeneration rewrites 27
  lanes at once). The figures quoted in this file are therefore measured against
  the wired bytes **directly**, not read out of the pin.
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

Every rule below is stated **for SQL**, not in general, and every count is from production
`parseFile` over the **1,945-file census** (`validation/m14/fixtures/sql/ontology-census.json`),
which is 141 repositories, 30,690 relationships and 18,322 symbols. The shared corpus grew
from pass 1's 1,459 files in 123 repositories as other lanes cloned into it, so **every count
on this page was re-measured**; nothing is carried forward from the 1,459-file run.

| Relationship | Rule **in SQL** | Census |
| --- | --- | --- |
| `contains` | table → column, and table → index/constraint. A SQL file's containment is its schema: a column is not a member of the query that selects it, and a CTE body is not a member of the statement that holds it | 11,786 |
| `uses` | view / function / query / DML → referenced table. Anonymous statements use `global`. **A CTE name is not a table**: an unqualified reference matching a CTE of the statement's WITH list is suppressed, a qualified one never is. The scope is the WITH LIST, not the enclosing query — see *Pass 2* | 9,017 |
| `references` | FK table → referenced table, index → indexed table, trigger → target table, policy → its table, GRANT/REVOKE → the object granted on. Each target sits in a grammar-mandated slot after `keyword_references` / `keyword_on` | 5,965 |
| `calls` | trigger → executed function, and any `invocation` node **anywhere in the tree**, not only inside a query — a `DEFAULT`, a `CHECK`, a generated column's expression and a policy's `USING (…)` are all `invocation`s in grammar-mandated slots. The callee must be free of ERROR and not a keyword or builtin | 3,827 |
| `imports` | two distinct mechanisms, kept separable in metadata: a psql `\i`/`\ir` include (**22**, `metadata.psqlInclude`, target is a file in this repository) and `CREATE EXTENSION` (**30**, `metadata.extensionInstall`, target is a distribution that must be installed and can never bind) | 52 |
| `overrides` | `CREATE OR REPLACE` on a name **this file already declared of the same kind**. SQL has no method table; this is the only replacement event the language has | 22 |
| `instantiates` | `ROW(...)::composite` — a composite cast, which PostgreSQL implements as a call to the type's constructor. A conversion (`x::my_enum`, `nextval('s')::bigint`) is **not** an instantiation | 21 |
| `exports` | not derivable — RULED, see below | 0 |
| `extends` | not derivable from the wired grammar — RULED, see below | 0 |
| `implements` | not derivable — RULED, see below | 0 |

Relationship identity uses a `Map` keyed by type/source/target. Repeated DML operations merge
operation metadata rather than creating duplicate graph edges. Unresolved tables/functions
remain external names; no cross-file symbol is invented by the analyzer.

### `evidenceClass` — the heuristic/deterministic ratio is a number

Every edge carries `evidenceClass`, which is the honesty contract's §4 requirement made
queryable. Before pass 1 **no** edge carried it, which reads as "no heuristics" and means
"nothing recorded"; an absent field is not the same claim as a uniformly `structural` one.

| Tier | Meaning here | Edges | Share |
| --- | --- | --- | --- |
| `structural` | the fact is in a grammar-mandated position — every `contains`, `references`, `overrides`, `instantiates` | 18,014 | 58.69 % |
| `import_based` | a token names another unit — every `imports` | 52 | 0.17 % |
| `usage_contextual` | a name in a bare slot with nothing around it to disambiguate | 10,590 | 34.51 % |
| `reference_qualified` | a name read through a reference that names its own **schema**, which is its own disambiguation — `app.users`, `public.f(…)` | 2,254 | 7.35 % |

**`reference_qualified` was DEAD until pass 2, and this is the number that says so.**
`evidenceClassFor` has consulted `metadata.qualified` for the tier since it was written, and
`addTableEdge` has passed `metadata.qualified` since it was written — but `evidenceClassFor`'s
`Uses` arm hardcoded `usage_contextual` without looking, and `processCalls`, `processTrigger`'s
action edge and `recordDml` passed **no metadata at all**, so for `calls` the field was
undefined on every edge in the corpus. Measured before the fix: **0 of 3,827 `calls` and 0 of
the qualified `uses` edges carried the tier**, and 2,254 carry it now. The adversarial probe
re-derives the expected tier independently of the analyzer's own table and reports
**3,827 of 3,827 `calls` and 9,017 of 9,017 `uses` edges AGREE, 0 disagree**
(`adversarial-probe.json`, `A3-tier-AGREES-with-the-metadata` / `A4-tier-AGREES-with-the-metadata`)
— a probe that read the analyzer's own mapping could not have reported a disagreement.

`confidence` is **1 on all 30,690 edges and 0 edges fall below 0.7.** That is a claim rather
than an omission: no edge this analyzer emits is a guess about a *name*. Where the analyzer
genuinely cannot tell — a psql variable target, a concatenated `EXECUTE` fragment whose
declaration name is computed at run time, an ERROR-recovery artefact — it emits nothing and
counts the suppression in `metadata.ambiguity`.

Keyword and builtin guards are enforced on every edge, and the guard sets are **exported** so
the lane's own probe can ask the guard's question instead of guessing at it: the probe
separates "a qualified call suppressed because it is a PostgreSQL catalog builtin" (52 edges,
`pg_catalog.pg_table_is_visible(…)` and friends) from "a qualified call dropped for an
unexplained reason", which is 196 and is named as such rather than folded into the first
number. Measured before the guard export the two were indistinguishable, and a drifting copy
of the lists would have turned a working guard into a reported defect.

## Ontology verdicts — all ten types (M14 ontology workstream, re-measured 2026-10-03)

Instrument: production `parseFile` (not `analyze()`) over **1,945 admitted SQL files in 141
repositories**, size cap 512 KB, **every** admitted file sampled rather than a subset — and
**1 further admitted file is excluded and named in the artifact** because it hangs the wasm
parser and the engine answers a hang with `process.exit(1)` (limitation 6). Artifacts:
`validation/m14/fixtures/sql/ontology-census.json`,
`validation/m14/fixtures/sql/adversarial-probe.json`,
`validation/m14/fixtures/sql/construct-probe.json`. Written rulings:
`script/m14/spec/sql-completeness.json` SQL-D11…SQL-D18. **Pass 2 re-ran every probe that
produced a ruling and every zero still reads zero**; the corpus grew by 486 files in the
interval and none of the zero probes moved.

| Type | Verdict | Count | Where it came from, or the ruling's instrument |
| --- | --- | --- | --- |
| `contains` | EMITTED | 11,786 | 639 files; e.g. `Exposed/exposed-maven-plugin/…/V20260720135258__CREATE_TABLE_USERS.sql` |
| `uses` | EMITTED | 9,017 | 1,518 files; e.g. `duckdb/benchmark/aoc24/queries/day02.sql` |
| `references` | EMITTED | 5,965 | 604 files; e.g. `hasura-engine/server/src-rsr/init_pg_source.sql` |
| `calls` | EMITTED | 3,827 | 622 files; e.g. `duckdb/benchmark/clickbench/queries/q27.sql` |
| `imports` | EMITTED (was RULED) | 52 | 22 psql includes in 6 files (`postgrest/test/io/fixtures/load.sql`) + 30 `CREATE EXTENSION` in 8 files (`hasura-engine/server/src-rsr/migrations/1_to_2.sql`) |
| `overrides` | EMITTED (was RULED) | 22 | 4 files; `postgrest/test/io/fixtures/big_schema.sql`, `postgrest/test/io/fixtures/schema.sql`, `postgrest/test/spec/fixtures/schema.sql`, `proxicall/database/archive/2026/20260131_pms_audit_logging_system.sql` |
| `instantiates` | EMITTED (was RULED) | 21 | 10 files; `hasura-engine/v3/crates/engine/tests/db_definition.sql`, `postgrest/test/spec/fixtures/schema.sql` |
| `exports` | RULED | 0 | **Instrument A.** 465 node types, none is an export/module/provide/publication shape. Token counts: 0 `EXPORT`, 0 `MODULE`, 0 `PROVIDE`. |
| `extends` | RULED | 0 | **Instrument A + B + a 5-shape capability battery.** No inheritance node among the 465; 0 `INHERITS`/`INHERIT` tokens inside a `create_table` or `alter_table`; and `INHERITS`, `PARTITION OF`, `ATTACH PARTITION`, `PARTITION BY` and `LIKE` were each PARSED against the wired wasm. See below. |
| `implements` | RULED | 0 | **Instrument A + B.** No interface/supertype node among the 465; 0 `IMPLEMENTS` tokens. SQL has no interface type. |

### The three rulings, and the overturn condition each one carries

**`exports` — instrument A, 465 node types.** The visibility scope in SQL is the *database*, not
the file, and no SQL construct enumerates what a unit publishes. `CREATE EXTENSION` is the
strongest candidate and it is answered with a measurement rather than a sentence: it occurs
**30 times** over the corpus, yields 30 `module` symbols, and is an **inbound** declaration of a
package whose published surface lives in that package's own control file, not in this unit. It
is now published as an `imports` edge (`metadata.extensionInstall`), which is the direction the
construct actually points. psql's file graph is real and its only edge is inbound (`\i`), which
is why `imports` is emitted and `exports` is not.
*Overturn:* any node type among the 465 that expresses a published surface. **Pass 2 also
searched for `partition`, `like`, `of`, `super`, `class`, `interface`, `trait` and `struct` as
substrings over all 465 type names** — the two `partition` hits are a `table_partition` rule
and a `keyword_partition` token, both of which are the `PARTITION BY` strategy and name no
parent, and the `class` hit is the `regclass` type name.

**`extends` — instrument A, plus a FIVE-SHAPE capability battery, and pass 2 replaced the
battery's weakest link.** SQL *does* have table inheritance; the wired grammar cannot represent
it. A corpus count of 0 is consistent both with "SQL lacks inheritance" and with "the grammar
cannot read it", and only a PARSE separates them — so each shape is parsed against
`wasm/tree-sitter-sql.wasm` and the resulting node shape recorded
(`adversarial-probe.json` → `capabilityTests`):

| Shape | Verdict | Node shape |
| --- | --- | --- |
| `CREATE TABLE c (…) INHERITS (p)` | NOT EXPRESSIBLE | `create_table` ends at the column list; the clause lands in a top-level `ERROR` |
| `CREATE TABLE c PARTITION OF p FOR VALUES …` | NOT EXPRESSIBLE | `table_partition(keyword_partition, ERROR(keyword_for, keyword_values, keyword_from), …)` — `OF <parent>` is inside the ERROR |
| `ALTER TABLE p ATTACH PARTITION c FOR VALUES …` | NOT EXPRESSIBLE | the whole clause lands in a top-level `ERROR` |
| `CREATE TABLE p (…) PARTITION BY RANGE (x)` | EXPRESSIBLE, but names no parent | `table_partition` |
| `CREATE TABLE c (LIKE p)` | EXPRESSIBLE, and a structural COPY | `column_definition` whose `custom_type` is `p` |

**Why the battery exists at all, and it is the substantive pass-2 change to this ruling.**
Pass 1's overturn condition was "a `keyword_inherits`/`inherits_clause` node inside
`create_table`". That is a NODE-NAMED condition, and it is unsound: since PostgreSQL 11 a
`PARTITION OF` child inherits its parent's columns with no `INHERITS` clause at all, so a
grammar could grow that clause, call the node anything, and produce **zero** nodes matching
pass 1's condition while making `extends` fully derivable. The ruling would then read 0 on
a corpus where the construct is present and readable — still wrong, and still sounding right.
Corpus count: `table_partition` occurs 6 times and **all 6 are the `PARTITION BY` strategy**;
`PARTITION OF` occurs 0 times corpus-wide.
*Overturn:* a parse in which `OF <parent>` or `INHERITS (…)` survives inside a
`create_table`/`alter_table` without an intervening `ERROR`. That is a statement about the
grammar, not about a node's spelling, and it is the condition the battery actually tests.

**`implements` — instrument A + B.** SQL has no interface type and no clause in which a
declaration names a supertype it satisfies. `CREATE DOMAIN d AS t CHECK (…)` is a
constraint-carrying alias, not interface satisfaction.
*Overturn:* any supertype/interface node type among the 465.

**`imports` — the ruling that was falsified in pass 1, and re-verified.** SQL-D1 recorded "the
analyzer emits no `imports`. SQL has no import statement", justified by the *mechanism* (the
previous implementation scanned for `#import`/`@import` text the grammar can never produce).
That was true of the code and false of the language: psql's `\i` / `\ir` name another
**file**, 22 directives across 6 files, and `CREATE EXTENSION` names another **distribution**,
30 declarations across 8 files. Two guards cost 0 occurrences on this corpus and are kept for
the corpus that needs them: a psql-variable target (`\i :name`) and an argument with no
`.sql`/`.psql`/`.dump` suffix. The 121 other meta-commands are **not** imports and are counted
in `ambiguity.psqlCommandsSkipped`.
**Pass 2 verified the resolvable half.** The 22 psql include targets are paths relative to the
including script, so a consumer must join them — and joining them is not a guess: **22 of 22
exist on disk** after `path.resolve(path.dirname(file), target)` across 6 files
(`adversarial-probe.json` → `A7-psql-include-target-exists-after-join`). The 30 extension
targets are distributions no file can declare and are labelled `external`.
*Overturn:* a corpus file whose `\i`/`\ir` argument is a psql variable or carries no
recognised suffix — 0 occurrences on this corpus.

### The six questions, per emitted type

They fail independently, so the columns fail independently too. "Correct" is the lane's
84-fact hand audit plus the independent adversarial probe; the probe's own limit is stated
under the table.

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (intra / corpus) | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 11,786 | 11,785 of 11,786 member endpoints resolve by `ownerName`; **1 does not**, and it is named below | distinct from `references` (an FK/policy/index target, all in fixed keyword slots) | 99.99 % / 99.99 % | 1.0, all `structural` |
| `uses` | yes | 9,017 | 19 of 19 CTE-named edges are AMBIGUOUS rather than fabricated (a qualified reference reaches the same bare leaf) or unrecoverable (below) | distinct from `calls`; tier agrees with metadata on 9,017 of 9,017 | 32.80 % / 89.62 % | 1.0; 7,209 `usage_contextual`, 1,808 `reference_qualified` |
| `references` | yes | 5,965 | 84/84 facts | distinct from `uses`: every target follows `keyword_references`/`keyword_on` | 69.42 % / 98.26 % | 1.0, all `structural` |
| `calls` | yes | 3,827 | 84/84 facts; 448 qualified invocations emitted, 52 suppressed as keyword/builtin, **196 not emitted for a reason pass 2 did not settle** | distinct from `uses`; tier agrees on 3,827 of 3,827 | 40.29 % / 78.73 % | 1.0; 3,381 `usage_contextual`, 446 `reference_qualified` |
| `imports` | yes | 52 | not in the 84-fact oracle; 0 unexplained by construction and the two mechanisms are separable in metadata | `psqlInclude` (22) vs `extensionInstall` (30) | 57.69 % / 57.69 % | 1.0, all `import_based` |
| `overrides` | yes | 22 | all 22 reconciled against the tree by an independent re-derivation (below) | `orReplace: true` + both line numbers on every edge | 100 % / 100 % | 1.0, all `structural` |
| `instantiates` | yes | 21 | 17 of the construction-shaped casts sit OUTSIDE any query node and **all 17 are emitted**, so the type is not query-only | `construction: true` + the constructor node type; conversions carry no edge | 52.38 % / 90.48 % | 1.0, all `structural` |

Resolution is reported at two rates deliberately. The analyzer emits per-file arrays of bare
names, so "resolved" has two honest meanings: declared in the **same** file, or in **any**
admitted file. A consumer running `bb_graph` is cross-file, so the corpus-wide rate predicts a
dangling edge; the intra-file rate predicts a mis-scoped analyzer. Printing one would hide
whichever half is worse. `global` is the analyzer's synthetic owner for anonymous statements
and is counted and reported, never scored as unresolved.

Three rates deserve naming rather than a footnote.

**`uses` at 32.80 % intra-file** is the lowest of the four structural types and it is expected:
a migrations corpus reads tables a previous migration created, so the honest answer for most of
them is "declared elsewhere". It also moved a great deal this pass: 9,033 → 9,017 edges over a
corpus that grew by 486 files, and 1,047 edges were **removed** by the three CTE-scope fixes —
every one of them an edge naming a CTE alias as a table.

**`imports` at 57.69 % is a property of the construct, not a defect**: the 30 `CREATE
EXTENSION` targets are distributions (`pgcrypto`, `plpgsql`, `uuid-ossp`, `postgis`) that no
file in the corpus can declare, so they *cannot* resolve, and they are labelled `external` for
exactly that reason. The 22 psql includes resolve at 0 % against *symbol names* for a different
and now-measured reason — their targets are paths, not symbols, and **22 of 22 exist on disk**
once joined against the including script's directory.

**`calls` at 40.29 % intra-file is the surface pass 2 widened**, and it is the one number that
moved most: 2,328 edges at pass 1 against 3,827 now, a 64 % increase, because `calls` is no
longer query-only. Its resolution rate went **down** (50.00 % → 40.29 % intra-file) while its
corpus-wide rate went **up** (70.76 % → 78.73 %). That is the expected shape for edges added
from `DEFAULT`/`CHECK`/policy expressions: a column default names the function the schema's
own DDL used, and the owner symbol is in another migration more often than a query's is.

### `overrides` reconciled, and a pass-1 explanation OVERTURNED

Pass 1 recorded that the analyzer emitted **22** `overrides` edges where its own construct
probe counted **15** same-kind OR REPLACE redeclarations, and attributed the 7-edge gap to
`state.redeclared` being keyed on the name alone rather than on kind and name. **That
attribution was wrong, and the measurement says so.** Pass 2 re-derived every same-kind pair in
the four files from the parse tree, independently of the analyzer:

| File | same-kind pairs whose later declaration carries `OR REPLACE` |
| --- | --- |
| `postgrest/test/io/fixtures/big_schema.sql` | 4 (`create_view`: `v_exportevab_beob`, `v_qk_apber_ohnejahr`, `v_qk_feldkontr_ohnezaehlung`, `v_qk_freiwkontr_ohnezaehlung`) |
| `postgrest/test/io/fixtures/schema.sql` | 3 (`mult_them`, `infinite_recursion`, `get_work_mem`) |
| `postgrest/test/spec/fixtures/schema.sql` | 14 (`overloaded`, `overloaded_default`, `overloaded_html_form`, `overloaded_same_args`, `overloaded_unnamed_param`, `overloaded_unnamed_json_jsonb_param`, `color`, `json`, `isodate`, `bytea_b64`, `unixtz`, `monetary`, `geo2json_trans`, `infinite_recursion`) |
| `proxicall/…/20260131_pms_audit_logging_system.sql` | 1 (`prevent_audit_modification`) |

4 + 3 + 14 + 1 = **22**, which is exactly what the analyzer emits. So all 22 edges are sound
and it is the **construct probe's 15 that is short by 7**, and the reason is not established.
The probe walks its tree with a stack, so "the second occurrence" is not in document order —
its own examples read `first at line 192, again at line 184` — and it records a hit only when
`count === 2`, so a three-or-more-times-redeclared name contributes differently depending on
visit order. `overloaded_default` occurs **four** times and `json` **five** times in
`postgrest/test/spec/fixtures/schema.sql`, both with `OR REPLACE` on every declaration.

The kind-keyed `state.redeclared` is still a real fix and is still kept: the code did not
enforce what the field comment and this page both claimed, and the corpus happens not to
exercise it with `OR REPLACE` (the three cross-kind name collisions the probe found — 3 in 2
files — are `create_function`/`create_view` pairs with no `OR REPLACE` on either, so they
produce no edge either way). It is pinned by fixture `sqld14` and by mutant
`sql/override-key-ignores-the-declaration-kind`, and the honest statement is that the corpus
does not exercise it.

### DERIVATION findings — 7 of 7 emitted types

Every type this analyzer emits is a **DERIVATION finding**: stored, and compared against
nothing. `script/m14/differential.ts` exports **116 distinct `derive*` oracle functions**
across `script/m14/` (161 export sites, some re-exported) and **none for SQL** —
`deriveJavaEdges`, `deriveGoEdges`, `deriveCSharpEdges`, `deriveDartEdges`, `deriveZigEdges`,
`deriveJuliaContainsTruth` and 110 others, no `deriveSqlEdges`. Pass 1 reported 68; that number
was a count of one grep pattern on one file and is superseded by the 116 above, which counts
distinct names across the whole directory.

**The mechanism changed too, and the old symptom no longer reproduces.** Pass 1 recorded that a
scoped run exits with "derived ZERO truth edges". Today it does not even get that far:

```
$ BB_CORPUS_ROOT=$HOME/fixtures/repositories npx tsx script/m14/differential.ts --lang sql
[lane] SKIP sql: no corpus repo mapped in LANG_REPOS and none checked out — declared unrun, not measured
probe run (--lang sql): measured 0 lane(s) — M14.0.F5 NOT written.
```

`LANG_REPOS` has no `sql` entry, so the harness now skips the lane rather than running it
against nothing. That is a better failure than pass 1's, and it is the same structural blind
spot one level up: the differential is independent at the level of *implementation*, so it
cannot see a type missing from **both** sides. Here it is missing from the oracle side for all
seven emitted types. Paying it down needs an oracle, and the oracle belongs to shared
machinery — a §8 item, specified in the report.

The lane's *own* correctness instrument is the m12 differential against 84 hand-audited facts,
and it is a genuine independent check: those facts were audited by hand, not derived from the
analyzer. It re-ran after every pass-2 change: **84 facts, precision 1.000, recall 1.000, 0 FP,
0 FN, `earliestFailingLayer=none`, `parseErrors=0`**
(`validation/m12/results/sql-differential.json`). Its limit is unchanged and is not a
formality: those 84 facts are a hand audit of independent fixtures read against ONE parse tree,
so a grammar defect both the auditor and the analyzer accept would be invisible to it. The
construct probe and the capability battery cover that gap by measuring the grammar's own
vocabulary rather than agreeing about it.

## PASS 2 — the adversarial audit (2026-10-03)

Pass 1 measured **whether** each type fires. Pass 2 assumes each label is **wrong** and looks
for the case that proves it. The instrument is
`validation/m14/fixtures/sql/adversarial-probe.mts` (+ `adversarial-probe.json`), committed
beside this page, and it is built so that a broken probe cannot also report a clean result:
every expectation is re-derived from the parse tree or from the analyzer's own exported guard
sets, never read out of the table under test.

The A/B that keeps the numbers honest: with pass-1 code and pass-2 code over the same
300-file slice, `parseFile` returns **1,719 symbols in both** and relationships move
3,132 → 3,131. So the fixes are near-neutral on a slice with no CTE-heavy file, and every
large number below is attributable to a specific construct rather than to a drift in the
instrument.

### Six defects, five of them invisible to the census

**DEFECT 1 — a CTE's own scope was computed from two sets that cannot contain it.**
A CTE's body is a `statement` NESTED INSIDE the `cte` node that declares its name, and a
WITH list's names are visible to every LATER item in the list. So a reference inside a CTE
body needs both its own name (an ANCESTOR) and its siblings (neither ancestor nor descendant).
`processQueryDependencies` built the set from `descendants(node, "cte")` and the declaration
sweep built its own from `descendants(ancestorStatement(current), "cte")`; neither can see
either name. Pass 1 had already found and fixed one entry point to this (the sweep reaching a
CTE body with an empty scope) and pinned it. **Three further entry points reached the same
wrong output**, and each needed its own measurement before it was found:

| Entry point | Shape | Edges removed |
| --- | --- | --- |
| a CTE body referencing **itself** | `WITH RECURSIVE t(n) AS (… FROM t …)`; the name binds with or without `RECURSIVE` | — |
| a CTE body referencing an **earlier sibling** | `WITH b AS (… FROM a …), c AS (… FROM b …)` — 32 edges across 16 DuckDB benchmark files | 32 |
| a WITH list whose `cte` nodes are **siblings under an `ERROR`** | `day05.sql`: 34 unparseable regions in 1,428 lines, every `cte` a sibling of every other, `program` as the `ERROR`'s parent, so there is no `statement` to anchor on and all three scope sets came back empty | 5 |
| a CTE body reached with `state.localCtes` from the sweep | pass 1's entry point, re-verified | 1 |

Fixed by one `cteScope(node)` helper that is the union of three sets: every `cte` under the
outermost enclosing `statement`, every `cte` under the node, the `cte` names on the ancestor
chain, and — for a node that IS a `cte` or sits directly inside one — every `cte` under the
WITH list's shared container. Pinned by `sqld14` from all three directions plus a
negative case (two separate WITH lists in one file, and a real table whose name the first
list's CTE shadows) so a fix cannot pass by over-suppressing. Mutants
`sql/cte-self-reference-escapes-the-scope` and the pre-existing
`sql/declaration-sweep-drops-the-cte-scope` both go red.

**DEFECT 2 — `evidenceClassFor`'s `reference_qualified` tier was UNREACHABLE for `calls`, and
ignored for `uses`.** The switch consulted `metadata.qualified`; `processCalls`,
`processTrigger`'s action edge and `recordDml` passed no metadata at all, and the `Uses` arm
hardcoded `usage_contextual` without looking. So every qualified reference in the corpus was
published as the tier for a name in a bare slot. 2,254 edges now carry the tier they should
have carried, and the probe reports **0 disagreements** on 12,844 `calls`+`uses` edges.

**DEFECT 3 — `processIndex` hardcoded `parent: null`.** Every index symbol in the corpus had
`ownerName: undefined` while the edge two lines below published `contains table -> index`
naming the table as owner. `bb_graph`'s owner-cascade and `bb_impact`'s reverse walk both read
`ownerName`, so the member read as an orphan that happened to be mentioned in an edge. **277
containment edges over the corpus** sat in that state. Fixed in two places, because declaration
order in a SQL file is not the order the analyzer visits in: an immediate lookup for the
ordinary `CREATE TABLE` then `CREATE INDEX` order, and a bounded end-of-analyze pass for the
reverse order and for tables the resync/EXECUTE passes recover afterwards. The pass adds no
edge and no symbol — it writes four fields and counts itself in
`ambiguity.indexOwnersAdopted` / `ambiguity.indexOwnersExternalToFile`. 277 → **1**.

**DEFECT 4 — `state.redeclared` was keyed on the name alone** while its own field comment and
this page both claimed the caller had established the same KIND. Fixed to `kind:name`; the
corpus does not exercise it (see *`overrides` reconciled* above), so it is a latent defect
rather than a measured one, and it is said to be one.

**DEFECT 5 — `calls` was emitted only from query nodes.** `DEFAULT public.f()`,
`CHECK (public.g(x))`, a generated column's expression and a policy's `USING
(public.is_admin())` are all `invocation` nodes in grammar-mandated slots, and
`processCalls` was reachable only from `processQuery`. Measured: 17 qualified invocations in
`proxicall/database/archive/2026/20260129_pms_c1_3_rls_policies.sql` alone, emitted none. This
is a GAP in reading the language rather than a labelling question, so it was closed: one call
to `processCalls` in `processStatement`'s declaration branch, sourced to the declaration's own
name, deduped by the same (type, source, target) key `processQuery` uses. **`calls` 2,328 →
3,827**, and `A6` confirms the 17 construction-shaped casts outside any query node were
already emitted, so `instantiates` is not query-only either.

**DEFECT 6 — 1 of 11,786 `contains` edges names a symbol that does not exist.**
`boundary/internal/db/schema/migrations/oss/postgres/71/11_session_recording.up.sql` publishes
`contains recording_channel_ssh_session_channel -> program`. `program` is a legal SQL column
name, and `keepSymbol`'s `UNIVERSAL` denylist in `src/ast/pool-worker.ts` holds `program` —
the grammar's ROOT node type — beside `root`, `module_declaration` and `source_file`. So the
symbol is deleted on the way to the index and the edge survives, naming something no consumer
can resolve. This is SQL-G13's other half: pass 1 recorded the dropped SYMBOL, and this is the
edge the drop corrupts. `pool-worker.ts` is shared (§8), so it is **filed, not edited**.

### A VACUOUS probe of my own, recorded because the CSS lane found one too

The range-containment probe (`A1`) was specified as "is the member's span inside the owner's
span?" and reports **11,252 of 11,786 violations (95.5 %)** — which reads as a catastrophic
defect and is not one. SQL's symbol ranges are NAME-ANCHORED: a `CREATE TABLE`'s symbol range
is the identifier's span, so `server_tag` is recorded at lines 121-121 while its columns are at
122-127. Worked example:
`boundary/internal/db/schema/migrations/oss/postgres/1/01_server_tags_migrations.up.sql`. The
invariant does not hold for this analyzer's symbol model, so the probe measures a property of
the model rather than a property of the edges, and the CSS lane's DEFECT 2 class
("containment edges pointing at a symbol that does not contain the member") **cannot be tested
by range in SQL at all** — `parseFile` returns no `range` object, only flattened
`startLine`/`endLine`, and a `contains` edge carries no line number either. Ownership
(`ownerName`) is the only available ground truth, which is what `A2`/`A10` use. Declared as
limitation 11 rather than reported as a defect.

The second probe of mine that was wrong before it was right: the A12 capability battery's
`CREATE TABLE c (LIKE p)` case searched the shape string for `(LIKE`, found nothing, and
reported **NOT EXPRESSIBLE** for a clause this page has always said the grammar reads — the
exact shape-vs-role confusion the gate's own header records for bash (`class voice` in a
telnet word list) and json (`new Map(` in a heredoc). The verdict now keys on the shape
(`column_definition` with a `custom_type`) and reads EXPRESSIBLE.

### What is STILL wrong after all of this, as numbers

| Residual | Count | Files | Why it is not fixed here |
| --- | --- | --- | --- |
| `uses` edges from inside an error-bearing CTE | **91** | 56 | when error recovery swallows a WITH list the names in it never become `cte` nodes, so the scope set is complete and still wrong. The fix would have to decide that ANY error inside a CTE body means the WITH list was lost, and that suppresses true table edges for every file with an unrelated unparseable expression in a CTE. Needs a grammar fix, not a guard. |
| `uses` edges targeting a CTE name with no qualified reach | **19** | 11 | down from 32; the remainder is the row above. |
| `uses` edges whose bare leaf is ambiguous between a CTE and a qualified table | **16** | 16 | `uses global->parse` in `duckdb/…/asql_cyk_using_key.sql` is one bare leaf reached both by the CTE `parse` (correctly suppressed) and by the real table `recurring.parse` (correctly emitted). The (type, source, target) key cannot represent two different objects with one leaf; that is limitation 8's shape applied to `uses`. |
| qualified invocations not emitted for a reason not settled | **196** | 11 | 52 are explained (keyword/builtin guard, and the probe separates them). The other 196 are inside damaged subtrees and I did not establish which guard or which pass drops them. |
| `contains` edges naming a symbol `keepSymbol` deletes | **1** | 1 | SQL-G13, shared machinery, filed |
| `calls` edges at confidence 1 whose evidence tier is `usage_contextual` | **3,381** | — | not a defect: that is the honest label for a name in a bare slot, and it is now countable per edge |

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
`validation/m14/fixtures/sql/sqld1..sqld13` (13 fixture lane cases).

Covered: schemas, tables, typed columns, primary keys, unique/named constraints, defaults,
foreign keys, indexes, views, stored functions and procedures, triggers, DML, CTEs, joins,
subqueries, set operations, `CASE`, `SET`/`RESET`, `COMMENT ON`, `MERGE`, `TRUNCATE`,
`GRANT`/`REVOKE`, `DO`, policies, `CREATE OR REPLACE`, composite-type construction, psql
`\i`/`\ir` script includes, `CREATE EXTENSION`, and negative cases proving that anonymous
statements, parameters, fields, literals, built-in calls and CTE names do not become
symbols/calls/edges.

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
| **V11** | plpgsql bodies that hold **embedded SQL**, plus an **opaque-body fallback** | **SHIPPED (current).** The body forms repeat `_plpgsql_body_item` rather than `_plpgsql_statement`, so a `BEGIN…END` can contain `SELECT`/`INSERT`/`CREATE TABLE` and not only procedural forms — before this, a plpgsql body produced **zero relationships**. Function symbols on the extension corpus 3,342 → **6,189**, distinct function names 922 → **1,004** of 1,170, table symbols 13 → **91**, relationships 5,253 → **11,765**. The opaque fallback is what makes it safe: a body the scaffolding cannot read degrades to one token instead of failing the rule and taking the declaration with it |

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
- Result: `validation/m12/results/sql-differential.json`, re-measured 2026-10-03
- What the artifact **now** records: **84/84 facts resolved — precision 1.000,
  recall 1.000, 0 false positives, 0 false negatives, 0 unknown, 0 unsupported**,
  `earliestFailingLayer=none`, `parseErrors=0`, `passing.passed: true`, `falsePositiveIds: []`

**What this section used to say, and why it was wrong twice.** The file previously claimed
precision 1.000 with 0 FP and `earliestFailingLayer=none`, which the artifact it cites contradicted:
the real figure was **0.988 with 1 false positive** and `passed: false`. That was corrected, and
the single FP was then left unnamed here with the note that identifying it required re-running the
differential. It has been re-run and the FP is **not** a ground-truth omission — it was a real
fabrication, `uses global->recent_users`, published because the declaration sweep dispatched a CTE
body without the enclosing statement's CTE scope. Fixed, pinned by `sqld5` and by mutant
`sql/declaration-sweep-drops-the-cte-scope`, and the same differential now reports 0 FP.

The second error was the artifact's **staleness**: `inputs.files["src/ast/real-sql-analyzer.ts"]`
recorded a sha from an analyzer 522 bytes older than the one the page documented, so "the current
precision is not established by any artifact in the repository" was true. It is no longer: the
artifact was regenerated against the analyzer this commit ships, and its recorded digest matches.

**The limitation of this oracle, stated rather than assumed.** The 84 facts are a hand audit of
independent fixtures, so they are independent of the analyzer in the way that matters. They are
**not** independent of the grammar: both the analyzer and the auditor read one parse tree. A
grammar defect that produces a node neither of them questions would be invisible here, which is
exactly the blind spot the ontology census and the construct probe cover instead — they measure the
grammar's own vocabulary (465 node types) rather than agreeing about it.


## Gates

Every row was re-run at pass 2's HEAD unless the row says otherwise, and the reason it was not
is part of the row.

| Gate | Result | Self-test |
| --- | --- | --- |
| `tsc --noEmit` | clean | — |
| M14 fixture lane (`script/m14/run-fixtures.ts --lang sql`) | **14 / 14** (`sqld14` is new) | 5 of `sqld14`'s rows are forbid-side, so a fix cannot pass by emitting nothing |
| SQL ontology mutants (`script/m60/run-sql-ontology-mutants.ts`) | **16 / 16 caught** (4 new) | exits 2 on a survivor, through the shared harness's own `runLang` |
| m12 differential (`script/m12/verify-analyzer.ts sql`) | **84 facts, P = R = 1.000, 0 FP, 0 FN, `earliestFailingLayer=none`, `parseErrors=0`** | the FP that made this 0.988 was a real fabrication; see *A fabrication this lane's own oracle caught* |
| ontology census (`validation/m14/fixtures/sql/ontology-census.mts`) | 1,945 / 1,945 parsed, 0 failures, 0 empty names, 0 `unknown` endpoints, **30,690 relationships / 18,322 symbols** | the exclusion is in the artifact as `excluded` |
| adversarial probe (`validation/m14/fixtures/sql/adversarial-probe.mts`) | full corpus, 24 probe populations, 0 tier disagreements on 12,844 `calls`+`uses` edges | the A12 battery parses 5 shapes; the A1 probe's own vacuity is declared, not hidden |
| construct probe (`validation/m14/fixtures/sql/construct-probe.mts`) | 480 distinct node types over the gate's corpus (465 over the census's), 0 parse failures, **every zero probe still 0** | — |
| ruling table (`validation/m14/fixtures/sql/run-ruling-table.mts`) | **`emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0`** | the arbiter on disk is untouched; the copy is written under `node_modules/` and removed |
| `keepSymbol` census | 18,325 symbols emitted, **3 dropped (0.016 %)** — 2 `function:root`, 1 `property:program`. SQL-G13 / pass-2 DEFECT 6, filed not fixed | — |
| **repeat of the census, identical command, same HEAD** | **the process was killed by the engine's 120 s self-destruct on a file the first run had parsed** — see limitation 6 and *Reproducibility* below | this is a finding, not a pass |
| contract battery (`fixtures/sql/probe/contract-battery.mts`) | **not runnable on this machine** — the directory does not exist here; the recorded 54 / 54 is from 2026-09-27 and is **unverified by this round** | — |
| node-type gate (`script/m12/sql-node-types-compare.ts`) | **not re-run by this round**, for pass 1's reason: re-running it without `fixtures/sql/probe/dialects` lowers its own observation surface from 6 probe files to 0 and would re-baseline a shared artifact downward | — |
| resync corpus gate | not re-run — `fixtures/sql` is absent from this machine | impossible bars → **exit 1** |
| pin contract | sql lane validates | a drifted sha is a `PIN FAILURE` |
| regex census | no sql finding; the exports of `SQL_KEYWORDS`/`SQL_BUILTINS` added this round are `Set`s, not patterns | — |
| perf gate (`script/m60/sql-perf-gate.ts`, `verify:m60-sql-perf`) | not re-run this round | bars are a regression detector, not a benchmark |

**The ruling table's demonstration, verbatim.** `script/m14/ontology-coverage-gate.ts` is
supervisor-owned and its `RULED_BY_LANG` is a literal with no extension point, so unaided it
exits 2 for `sql`:

```
ontology coverage gate — no RULING TABLE for sql.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

`run-ruling-table.mts` applies the supervisor's two lines to a COPY of the arbiter — written
under `node_modules/` so the copy's own `web-tree-sitter` import resolves, and removed
afterwards — and runs the copy. The arbiter on disk is never modified. Its output is in
*Reproducibility* below.

**Two differences between the arbiter's numbers and the census's, both accounted for.** The
arbiter reports `uses` 9,022 against the census's 9,017, because it does **not** exclude
`duckdb/extension/tpcds/dsdgen/queries/83.sql` and that file contributes 5 `uses` edges; and it
reports 480 distinct node types against the construct probe's 465, because its corpus walk is
1 file larger and it makes its own tree pass. Pass 1 recorded the same 5-edge difference in the
other direction and it is a property of the exclusion, not a disagreement.

**The arbiter's citations are wrong, and the mechanism is recorded rather than worked around.**
`rulingFor` matches a type by PROSE — the first RULED decision whose `resolution` mentions the
type name — so it cites `SQL-D11` for `exports` (which is about `imports`), `SQL-D16` for
`extends` and `SQL-D13` for `implements` (which is about `instantiates`). The VERDICT is
decided by the instrument and is unaffected; only the pointer is wrong. The fix is specified in
`script/m60/sql-ontology-ruled.ts` → `SQL_RULING_CITATIONS`: an optional `ontologyType` field on
each decision, with the prose match as the fallback, plus splitting `SQL-D16` into two entries
because it covers two types. §8 item.

### Reproducibility — what does NOT reproduce, measured

This is the most important limitation on every number above and it was found by trying to
reproduce one.

**The census is not byte-reproducible on a loaded machine, and the reason is in the engine.**
`src/ast/engine.ts` arms a per-file timeout and answers it by returning a **basic parse result**
rather than an error. Six corpus files were observed crossing it across pass-2's runs —
`postgrest/test/io/fixtures/big_schema.sql` (6 times), `roles.sql`, `replica.sql`,
`db_config.sql`, `database.sql` and `phpmyadmin/tests/test_data/server_import.sql` — and each
occurrence silently drops that file's symbols and relationships. A pass-1-shaped census and a
pass-2-shaped census of the same corpus on the same HEAD differ by **1,001 symbols and 1,860
relationships** for this reason and no other: the 300-file A/B, run back to back with the two
analyzer versions, differs by **0 symbols and 1 edge**.

**There is also a wasm fault that kills the process, and it is load-dependent.** Two corpus
files report `memory access out of bounds` from the wasm parser and then hang, after which
`engine.ts:1411` answers with `process.exit(1)`:

| File | Behaviour |
| --- | --- |
| `duckdb/extension/tpcds/dsdgen/queries/83.sql` | faults and hangs — excluded by name in the census, on every run |
| `duckdb/extension/tpcds/dsdgen/queries/97.sql` | faults and hangs — **not excluded**, and it killed a pass-2 census repeat |
| `duckdb/benchmark/aoc24/queries/day11.sql` | faults and hangs under load; **parses in 593–758 ms on 3 of 3 solo runs**, yielding 0 symbols either way |

So a census run either completes or dies with no output, and **which files fault depends on the
machine's load, not on the code**. The pass-2 repeat of the census died on `day11.sql`; the
pass-2 adversarial run and the pass-2 ruling-table run completed. The committed artifacts are
from runs that completed. This is a §8 item with a precise specification: `ontology-coverage-gate.ts`
and every lane's `parseFile`-based corpus walk need an `--exclude` for the faulting files, and
`engine.ts` needs to stop answering a parse fault with `process.exit(1)`, because a single
unparseable file makes every instrument built on the production entry point
non-reproducible.

## Known gaps, stated rather than implied

### Added by pass 2 of the ontology workstream (2026-10-03)

The pass-2 defects and their measurements are in *PASS 2 — the adversarial audit* above. What
follows is the residue that is a GAP rather than a fixed defect, plus the two §8 items.

- **SQL-G14 — the shared differential has no SQL oracle and now skips the lane outright.**
  116 distinct `derive*` oracle functions across `script/m14/`, none for SQL, and
  `LANG_REPOS` has no `sql` entry, so `differential.ts --lang sql` prints
  `SKIP sql: no corpus repo mapped in LANG_REPOS` instead of running. All 7 emitted types are
  DERIVATION findings. **§8.** The specification: an oracle must derive SQL truth from the tree
  with no shared rule table with the analyzer. The cheapest first surface is `contains` — both
  ends are names written in the file, so no name resolution is needed and a disagreement is a
  real disagreement rather than two opinions. It should be keyed `kind:name` (which is what
  `sqld14` and mutant `sql/override-key-ignores-the-declaration-kind` show the analyzer's own
  containment and replacement logic depends on), and `uses`/`references` should be scoped to the
  WITH list, because pass 2 showed that is what the analyzer now does and an oracle that did not
  would report 91 errors in 56 files as findings.
- **SQL-G15 — `overrides` sees 22 of 777 real replacement events.** 777 `OR REPLACE`
  declarations exist over the census corpus and all 777 are corpus-wide from the construct probe;
  22 replace a declaration of the same kind in the same file and are therefore visible to a
  per-file analyzer, which is what it emits. The other **755 replace a declaration made in
  another file** — a migration chain re-declaring what the previous migration declared — and a
  per-file analyzer cannot see them. 163 same-kind re-declarations carry no `OR REPLACE` at all
  and PostgreSQL rejects those outright, so calling them overrides would assert a replacement the
  language does not perform. The number that could be recovered is therefore 755, not 0, and it
  is named rather than rounded away.
- **SQL-G16 — 91 `uses` edges from inside an error-bearing CTE.** See limitation 12: the WITH
  list is inside an ERROR node, so its names never become `cte` nodes and no scope rule can
  recover them. Needs a grammar change. Not filed as a shared item because the grammar is this
  lane's own build.
- **SQL-G13, extended — shared machinery deletes a symbol an edge still names.**
  `keepSymbol`'s `UNIVERSAL` denylist in `src/ast/pool-worker.ts` holds `program`, the grammar's
  ROOT node type, beside `root`, `module_declaration` and `source_file`. `program` is also a
  legal SQL column name, so a real symbol is deleted and the `contains` edge naming it survives:
  **1 edge** in `boundary/internal/db/schema/migrations/oss/postgres/71/11_session_recording.up.sql`,
  out of 18,325 symbols emitted and 3 dropped (0.016 %). **§8**: `UNIVERSAL` needs a
  language-scoped exemption list for names that are ordinary identifiers in the lane's language
  (SQL: `program`, `root`, `module_declaration` is not a SQL identifier; `program` and `root`
  are), the same exemption shape `keepSymbol` already applies for `json`/`yaml`/`xml`/`make`/
  `markdown` and for the JS-family globals. The other two drops are the `root` pair pass 1 filed.
- **SQL-G17 — the corpus numbers are not reproducible while the box is loaded.** Six corpus
  files were observed crossing the engine's per-file timeout and silently degrading to a basic
  parse result, and three DuckDB files fault the wasm parser in a way that kills the process.
  See *Reproducibility* for the measurements and for why a 300-file A/B of the two analyzer
  versions differs by 0 symbols while two full-corpus censuses of the SAME corpus and HEAD differ
  by 1,001. **§8**, two changes: `script/m14/ontology-coverage-gate.ts` (and every lane's
  `parseFile`-based walk) needs an `--exclude` for the faulting files, and `engine.ts` needs to
  stop answering a wasm parse fault with `process.exit(1)`.
- **`CREATE TABLE c (LIKE p)` is parsed but not read.** 9 occurrences in 4 files;
  `keyword_like` is 574 nodes corpus-wide (the rest are `GRANT … ON ALL TABLES IN SCHEMA x LIKE
  'pattern'`, which name no table). The clause is a structural **copy**, not inheritance — the
  two tables evolve independently — so it is not an `extends` edge, and the nearest honest label
  for the dependency it does create is one this analyzer does not currently emit. No edge is
  published for it, deliberately, rather than published under an arguable type. The A12 battery
  settles that the clause survives the parse, which is what makes this a choice rather than an
  oversight.
- **`extends` is RULED against the wired grammar, not against SQL.** SQL has table inheritance
  in two forms — `INHERITS (p)` and, since PostgreSQL 11, `PARTITION OF p` — and the grammar
  cannot represent either. The five-shape capability battery that establishes this is recorded
  in `adversarial-probe.json` and the overturn condition is a parse, not a node's spelling.

### Carried from the M60 SQL wave

**Every number in this subsection is corpus- and date-scoped, and NONE of it was re-measured at
pass 2.** It is carried because it is a recorded result, not because it is current — the
ProxiCall-only figures (76 edges, 13,406 edges, 98.18 %) predate both the corpus growth and
every pass-2 change, and where they overlap with the corpus-wide figures above, **the
corpus-wide ones supersede them.** What pass 2 changed that these numbers would otherwise
contradict: `calls` on ProxiCall is now larger (the analyzer reads policy/`DEFAULT`/`CHECK`
expressions), `uses` is smaller (the CTE scope fixes removed fabricated edges), and
`overrides` is unchanged at 22.

- **Distinct-name** function recall on real PostgreSQL extension DDL is **1,004 of 1,170 (85.8 %)**
  under the shipped V11 grammar. The two earlier figures are recorded because they bound the
  grammar's contribution and are not alternatives to this one: **922 of 1,170 (78.8 %)** under
  V8, and **999 of 1,170 (85.4 %)** under pristine 0.3.11. A previous revision of this file
  carried 951/1,170 (81.3 %) as if it were current — that is the **V8-era** figure and it was
  stale the moment V11 shipped. The count ratio says 35.8 %. Report the name-based figure: on a
  versioned extension corpus the two disagree by more than 2x because the same function is
  re-declared in every version script, and the count ratio measures repetition rather than
  coverage.
- `PERFORM 1 FROM t` does not parse. plpgsql's `PERFORM` takes a full query and the shipped
  rule accepts only an expression, so `PERFORM my_func(1)` parses and `PERFORM 1 FROM t`
  does not. This is why sqld12 spells its in-body catalog read as `SELECT`. Fixing it needs a
  select-without-keyword rule, which is a real grammar change and is filed rather than
  half-done.
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
- Unknown relationship targets on ProxiCall, re-measured under the shipped V11 grammar over
  **13,406 edges**: **13,162 resolve (98.18 %)**, **146 (1.09 %) are labelled external**
  (PostgreSQL catalog 109, information_schema 19, platform 12, implicit `public` schema 6), and
  **98 (0.73 %) over 35 names are an unlabelled gap** — `connection_queue_votes` (18),
  `business_rules` (11), `set_session_code` (7), `auth` (6), `_drop_all_policies` (5),
  `businesses` (4). The gap grew from 62 edges to 98 when the grammar started reading the SQL
  inside plpgsql bodies, because bodies contribute edges to things no file declares; that is
  the recall gain showing up as unresolved targets, not a new defect. None of the 146 external
  edges is a mistake, and an unlabelled one is the only kind a consumer can misread as "the
  project declares this and the analyzer missed it".
- The perf gate measures files the analyzer actually processes in full (**<= 400 KB**). 309 of
  the 696 extension-corpus files are larger and hold **91.8 % of its bytes**; the engine
  truncates anything over 1 MB, so throughput over the raw 235 MB corpus is not a meaningful
  number and an earlier figure of "22 symbols/s" that counted those bytes was wrong by ~18x. On
  files actually analyzed the corpus runs at p50 54 ms, p95 2.7 s, max 4.8 s, ~104 KB/s, and
  the primary corpus at p50 24 ms, p95 253 ms. Cost is dominated by the **main analysis pass**
  (70–80 % of wall on the slowest files), not by the grammar and not by the recovery passes,
  which cost zero on those files.

## Declared limitations

A language with the expressive power of a Turing machine, and a blank limitations list, is a
documentation defect rather than an excellence. These are the ones that bound what the numbers
above can be used for.

1. **Cross-file edges are the analyzer's weakest surface.** Every count here is a per-file
   count. `overrides` sees 22 of 777 real replacement events; `uses` resolves intra-file at
   32.80 % for the ordinary reason that a migrations corpus reads tables an earlier migration
   created. No amount of intra-file work changes either number, and a graph consumer that wants
   the 755 cross-file overrides needs a cross-file pass that does not exist.
2. **`confidence` is uniformly 1, and that is a weaker claim than it looks.** It means no edge is
   a guess about a *name*. It does not mean the analyzer is equally certain about the *edge's
   meaning*: the `usage_contextual` tier (**10,590 edges, 34.51 %**) says the name was read from
   a bare slot with nothing around it to disambiguate it. A `uses` edge to `lineitem` could be
   the TPC-H table or a same-named temp table in another schema; the analyzer cannot tell and
   does not pretend to.
3. **The correctness oracle has 84 facts over 5 fixtures.** That is small, and it was audited by
   hand against one parse tree — so a grammar defect both it and the analyzer accept would be
   invisible. The construct probe and the capability battery cover part of that gap by measuring
   the grammar's own vocabulary rather than agreeing about it, but neither is a proof of recall.
4. **The shared differential audits nothing here.** 7 of 7 emitted types are DERIVATION findings
   *and the shared harness now skips the lane entirely* (`LANG_REPOS` has no `sql` entry), so the
   largest correctness instrument in the repository contributes **zero** to this lane, and
   contributes less than zero in the sense that it no longer even reports a row. Every
   correctness number on this page comes from the 84-fact m12 audit and from the lane's own
   probes.
5. **The corpus is migration-heavy.** Most admitted files are schema migrations, which biases
   toward DDL and away from procedural SQL. Figures that depend on the mix — `uses` resolution,
   `calls` count, the plpgsql recall numbers — are properties of *this corpus* and would move on
   one that is not.
6. **Three corpus files kill the whole measurement process, and which of them fires depends on
   machine load.** `duckdb/extension/tpcds/dsdgen/queries/83.sql`,
   `duckdb/extension/tpcds/dsdgen/queries/97.sql` and (under load)
   `duckdb/benchmark/aoc24/queries/day11.sql` return `memory access out of bounds` from the wasm
   parser and then hang; `src/ast/engine.ts:1411` arms a 120-second self-destruct timer around
   the *synchronous* `parser.parse()` and answers a hang with `process.exit(1)`, because
   `setTimeout` cannot interrupt blocked C/WASM code. The file does not fail — it takes the
   process with it, and with it **any instrument built on production `parseFile`**. `day11.sql`
   parses in 593–758 ms on 3 of 3 solo runs, so the fault is a function of concurrent wasm state
   and not of the file. This is also why the shared ontology coverage gate cannot produce a SQL
   verdict unaided on an arbitrary machine: it walks the same corpus through the same entry
   point. See *Reproducibility* for the numbers this costs.
7. **Two gates could not be run on this machine.** `fixtures/sql/` is absent, so the contract
   battery (recorded 54 / 54) and the dialect probe set are prior results, not current ones. The
   node-type gate was deliberately **not** re-run, because doing so without the probe set lowers
   its own observation surface and would have re-baselined a shared artifact downward.
8. **The `overrides` source/target encoding is a compromise, not a design.** The two ends cannot
   be two symbols — SQL replacement is same-name, so any pair collapses to a self-loop `f->f`
   that tells a consumer nothing about which declaration replaced which. The edge is therefore
   `global-><name>` with both line numbers in metadata. A consumer wanting the real predecessor
   must read `metadata.priorLine`; there is no symbol for it. The same shape now costs `uses`
   16 edges: one bare leaf reached by both a CTE and a qualified table cannot be represented by
   a (type, source, target) key.
9. **`evidenceClass` is derived from how the analyzer reads the tree, not from an audit of each
   individual edge.** The mapping is per-relationship-type with four tiers, and every one of
   those tiers is a claim about a mechanism. Pass 2 closed the largest instance of this class
   (the tier consulted a field three call sites never set) and the probe now re-derives the
   expected tier independently — but an edge mislabelled *within* its tier would still not show
   up as a tier error.
10. **`create_extension` is the only `imports` mechanism that can never resolve.** 30 of 52
    `imports` edges target a distribution no file in the corpus declares, so the type's 57.69 %
    resolution rate mixes a fixable shortfall (psql paths relative to the including script) with
    a permanent one. The two are separable in metadata; the headline rate does not separate them.
    Pass 2 measured the fixable half: **22 of 22** psql targets exist on disk once joined.
11. **`contains` cannot be verified from ranges in SQL, so it cannot be tested the way the CSS
    lane tested it.** Symbol ranges are NAME-ANCHORED — a `CREATE TABLE`'s range is its
    identifier's span — so 11,252 of 11,786 containment edges (95.5 %) have a member whose span
    lies outside the owner's. That is a property of the symbol model, not a defect in the edges,
    and it means the CSS lane's defect class ("containment edges pointing at a symbol that does
    not contain the member") is untestable by range here: `parseFile` returns no `range` object
    and a `contains` edge carries no line number. `ownerName` is the only ground truth, and
    11,785 of 11,786 members now agree with their edge on it.
12. **A CTE inside an ERROR-recovery span cannot be scoped.** 91 `uses` edges across 56 files
    come from inside a CTE whose own subtree carries an ERROR; when recovery swallows a WITH
    list the names in it never become `cte` nodes, so the scope set is complete and still wrong.
    The fix would have to treat ANY error in a CTE body as "the WITH list was lost", which
    suppresses true table edges for every file with an unrelated unparseable expression in a CTE.
    It needs a grammar change, not a guard, and it is why `uses` still carries 19 edges naming a
    CTE with no qualified reach.
13. **196 qualified invocations are not emitted and pass 2 did not settle why.** The probe
    separates 52 that the keyword/builtin guard suppresses deliberately from 196 that vanish for
    another reason. The 196 sit in damaged subtrees; I did not establish which guard or which
    recovery pass drops them, so the number is reported as an open item rather than as a
    characterised class.
14. **The construct probe's `overrides` count is short by 7 and the reason is not established.**
    See *`overrides` reconciled*: the analyzer's 22 edges are all sanctioned by an independent
    re-derivation, and the probe's 15 is the figure that cannot be reproduced. Its stack walk
    makes "the second occurrence" document-order-unstable, and a name declared three or more
    times contributes differently depending on visit order — but that is a hypothesis, not a
    measurement, and it is filed rather than claimed.
15. **`SQL_KEYWORDS` and `SQL_BUILTINS` are now exported from the analyzer.** They are read-only
    by every consumer added this round (the adversarial probe calls `has` on them so it can ask
    the guard's question instead of keeping a copy that could drift), but the export widens the
    module's public surface for a test. If the supervisor prefers, the alternative is a
    lane-side re-derivation of the two sets with a check that they have not drifted; the export
    is the cheaper of the two and the drift-proof one.

## Evidence pointers

- Ontology census (every count above): `validation/m14/fixtures/sql/ontology-census.json`, written
  by `validation/m14/fixtures/sql/ontology-census.mts` through production `parseFile`
- Construct probe (the 465-node-type grammar inventory and the semantic counts behind every
  RULED verdict): `validation/m14/fixtures/sql/construct-probe.json`
- `keepSymbol` census (SQL-G13): `validation/m14/fixtures/sql/keep-symbol-census.json`
- Adversarial probe (every number in *PASS 2*): `validation/m14/fixtures/sql/adversarial-probe.json`,
  written by `validation/m14/fixtures/sql/adversarial-probe.mts` — the six questions' adversarial
  half, the A12 capability battery, and the A1 probe whose own vacuity is declared
- Ruling table and its demonstration: `script/m60/sql-ontology-ruled.ts`, run by
  `validation/m14/fixtures/sql/run-ruling-table.mts`
- Ontology mutants and their runner: `script/m60/sql-ontology-mutants.ts` (16, four of them
  pass-2), `script/m60/run-sql-ontology-mutants.ts`
- Review: `fixtures/sql/REVIEW.md` (measured arc, §1 defect table, §3 grammar, §8 second
  corpus, §9–10 the grammar candidates and the EXECUTE pass) — **absent from this machine**
- Fixtures: `validation/m12/fixtures/sql/`, `validation/m14/fixtures/sql/sqld1..sqld14`
  (`sqld14-pass2-adversarial` is the pass-2 regression fixture; five of its rows are
  forbid-side)
- Ground truth: `validation/m12/ground-truth/sql.json`
- Differential: `validation/m12/results/sql-differential.json`
- Corpus errors: `validation/m12/results/sql-corpus-errors.json`
- Completeness spec: `script/m14/spec/sql-completeness.json` (82 handled / 96 internal-silent /
  9 gaps / 18 rulings)
- Lane records: `validation/m60/sql/` — `second-corpus-recall.json`,
  `v3-rejection.json`, `v4-plpgsql-candidate.json`, `execute-literal-recovery.json`
- Gates: `script/m12/sql-node-types-compare.ts`, `script/m12/verify-analyzer.ts`,
  `script/m14/mutate-analyzer.ts`, `script/m14/verify-grammar-pins.ts`,
  `script/m14/ontology-coverage-gate.ts` (supervisor-owned; demonstrated by
  `validation/m14/fixtures/sql/run-ruling-table.mts`),
  `script/m60/verify-sql-resync.ts`, `script/m60/measure-grammar-recovery.ts`
- Probes: `fixtures/sql/probe/` (contract battery, grammar census, field introspection, corpus
  sweep, unknown-symbol, parser-state-leak, grammar A/B) — **absent from this machine**
- Grammar review: `reviews/m60-sql-grammar-l1xnan-047-refused.md`, `reviews/regex-policy.md`

## Issue

M12.33 / GitHub issue #172.
