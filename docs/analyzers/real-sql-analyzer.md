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
`parseFile` over the 1,460-file census (`validation/m14/fixtures/sql/ontology-census.json`).

| Relationship | Rule **in SQL** | Census |
| --- | --- | --- |
| `contains` | table → column, and table → index/constraint. A SQL file's containment is its schema: a column is not a member of the query that selects it, and a CTE body is not a member of the statement that holds it | 10,025 |
| `uses` | view / function / query / DML → referenced table. Anonymous statements use `global`. **A CTE name is not a table**: an unqualified reference matching a CTE of the enclosing statement is suppressed, a qualified one never is | 6,575 |
| `references` | FK table → referenced table, index → indexed table, trigger → target table, policy → its table, GRANT/REVOKE → the object granted on. Each target sits in a grammar-mandated slot after `keyword_references` / `keyword_on` | 4,409 |
| `calls` | trigger → executed function, and any `invocation` whose callee is not a SQL builtin or a keyword. The callee must be unqualified-with-no-disambiguation, so it is `usage_contextual` and is labelled as such | 814 |
| `imports` | two distinct mechanisms, kept separable in metadata: a psql `\i`/`\ir` include (**22**, `metadata.psqlInclude`, target is a file in this repository) and `CREATE EXTENSION` (**27**, `metadata.extensionInstall`, target is a distribution that must be installed and can never bind) | 49 |
| `overrides` | `CREATE OR REPLACE` on a name **this file already declared of the same kind**. SQL has no method table; this is the only replacement event the language has | 22 |
| `instantiates` | `ROW(...)::composite` — a composite cast, which PostgreSQL implements as a call to the type's constructor. A conversion (`x::my_enum`, `nextval('s')::bigint`) is **not** an instantiation | 13 |
| `exports` | not derivable — RULED, see below | 0 |
| `extends` | not derivable from the wired grammar — RULED, see below | 0 |
| `implements` | not derivable — RULED, see below | 0 |

Relationship identity uses a `Map` keyed by type/source/target. Repeated DML operations merge
operation metadata rather than creating duplicate graph edges. Unresolved tables/functions
remain external names; no cross-file symbol is invented by the analyzer.

### `evidenceClass` — the heuristic/deterministic ratio is a number

Every edge carries `evidenceClass`, which is the honesty contract's §4 requirement made
queryable. Before this round **no** edge carried it, which reads as "no heuristics" and means
"nothing recorded"; an absent field is not the same claim as a uniformly `structural` one.

| Tier | Meaning here | Edges | Share |
| --- | --- | --- | --- |
| `structural` | the fact is in a grammar-mandated position — every `contains`, `references`, `overrides`, `instantiates` | 14,469 | 66.05 % |
| `import_based` | a token names another unit — every `imports` | 49 | 0.22 % |
| `usage_contextual` | a name in a bare slot with nothing around it to disambiguate — every `uses`, and `calls` whose callee is unqualified | 7,389 | 33.73 % |

`confidence` is **1 on all 21,907 edges and 0 edges fall below 0.7.** That is a claim rather than
an omission: no edge this analyzer emits is a guess about a *name*. Where the analyzer genuinely
cannot tell — a psql variable target, a concatenated `EXECUTE` fragment whose declaration name
is computed at run time, an ERROR-recovery artefact — it emits nothing and counts the
suppression in `metadata.ambiguity`.

Keyword and builtin guards are enforced on every edge. Measured before the guard: **49** edges
pointed at a SQL keyword (`calls global->USING`, `uses global->WITH`, `calls …->FILTER`), a
`REVOKE … FROM joe` published a **role** as a table, and project builtins
(`generate_series`, `jsonb_build_object`, `current_setting`) leaked as calls. All are now zero
on the ProxiCall corpus.

## Ontology verdicts — all ten types (M14 ontology workstream, 2026-10-03)

Instrument: production `parseFile` (not `analyze()`) over **1,459 admitted SQL files in 123
repositories**, size cap 512 KB, **every** admitted file sampled rather than a subset — and **1
further admitted file is excluded and named in the artifact** because it hangs the wasm parser and
the engine answers a hang with `process.exit(1)` (limitation 6). Artifact:
`validation/m14/fixtures/sql/ontology-census.json`. Construct probes:
`validation/m14/fixtures/sql/construct-probe.json` (465 distinct node types the wired grammar
produces over the same corpus). Written rulings: `script/m14/spec/sql-completeness.json`
SQL-D11…SQL-D18.

| Type | Verdict | Count | Where it came from, or the ruling's instrument |
| --- | --- | --- | --- |
| `contains` | EMITTED | 10,025 | 477 files; e.g. `Exposed/exposed-maven-plugin/…/V20260720135258__CREATE_TABLE_USERS.sql` |
| `uses` | EMITTED | 6,575 | 1,140 files; e.g. `duckdb/benchmark/aoc24/queries/day02.sql` |
| `references` | EMITTED | 4,409 | 381 files; e.g. `hasura-engine/server/src-rsr/init_pg_source.sql` |
| `calls` | EMITTED | 814 | 214 files; e.g. `duckdb/benchmark/clickbench/queries/q27.sql` |
| `imports` | EMITTED (was RULED) | 49 | 22 psql includes in 6 files (`postgrest/test/io/fixtures/load.sql`) + 27 `CREATE EXTENSION` in 8 files (`hasura-engine/server/src-rsr/migrations/1_to_2.sql`) |
| `overrides` | EMITTED (was RULED) | 22 | 4 files; `postgrest/test/io/fixtures/big_schema.sql`, `postgrest/test/io/fixtures/schema.sql`, `postgrest/test/spec/fixtures/schema.sql`, `proxicall/database/archive/2026/20260131_pms_audit_logging_system.sql` |
| `instantiates` | EMITTED (was RULED) | 13 | 2 files; `hasura-engine/v3/crates/engine/tests/db_definition.sql`, `postgrest/test/spec/fixtures/schema.sql` |
| `exports` | RULED | 0 | **Instrument A.** 465 node types, none is an export/module/provide/publication shape. Token counts: 0 `EXPORT`, 0 `MODULE`, 0 `PROVIDE`. |
| `extends` | RULED | 0 | **Instrument A + B.** No inheritance node among the 465; **0** `INHERITS`/`INHERIT` tokens inside a `create_table` or `alter_table`. A capability probe settles it: the wired wasm parses `CREATE TABLE c (id int) INHERITS (p);` as `create_table` cut off at the column list followed by `ERROR(identifier)`. |
| `implements` | RULED | 0 | **Instrument A + B.** No interface/supertype node among the 465; 0 `IMPLEMENTS` tokens. SQL has no interface type. |

### The four rulings that carry an overturn condition

**`exports` — instrument A, 465 node types.** The visibility scope in SQL is the *database*, not
the file, and no SQL construct enumerates what a unit publishes. `CREATE EXTENSION` is the
strongest candidate and it is answered with a measurement rather than a sentence: it occurs
**27 times** over the corpus, yields 27 `module` symbols, and is an **inbound** declaration of a
package whose published surface lives in that package's own control file, not in this unit. It is
now published as an `imports` edge (`metadata.extensionInstall`), which is the direction the
construct actually points. psql's file graph is real and its only edge is inbound (`\i`), which
is why `imports` is emitted and `exports` is not.
*Overturn:* any node type among the 465 that expresses a published surface.

**`extends` — instrument A, plus a capability probe.** SQL *does* have table inheritance; the
wired grammar cannot represent it. That distinction is the whole ruling, so the evidence is a
parse of the construct rather than a corpus count of its absence: 0 occurrences corpus-wide is
consistent with both "SQL lacks inheritance" and "the grammar cannot read it", and only the
probe separates them. The adjacent `LIKE` clause **is** parsed (`keyword_like`, 574 nodes, 9 of
them inside a `create_table`) and is a structural **copy**, not inheritance — the two tables
evolve independently — so it is deliberately not an `extends` edge (SQL-D15, SQL-G11).
*Overturn:* a `keyword_inherits`/`inherits_clause` node inside `create_table`.

**`implements` — instrument A + B.** SQL has no interface type and no clause in which a
declaration names a supertype it satisfies. `CREATE DOMAIN d AS t CHECK (…)` is a
constraint-carrying alias, not interface satisfaction.
*Overturn:* any supertype/interface node type among the 465.

**`imports` — the ruling that was falsified.** SQL-D1 recorded "the analyzer emits no
`imports`. SQL has no import statement", justified by the *mechanism* (the previous
implementation scanned for `#import`/`@import` text the grammar can never produce). That was true
of the code and false of the language: psql's `\i` / `\ir` name another **file**, 22 directives
across 6 files, and `CREATE EXTENSION` names another **distribution**, 27 declarations across 8
files. Two guards cost 0 occurrences on this corpus and are kept for the corpus that needs them:
a psql-variable target (`\i :name` — the value lives in another statement, so the target would
be invented) and an argument with no `.sql`/`.psql`/`.dump` suffix. The 121 other meta-commands
(`\echo` 108, `\set` 8, `\gexec`, `\if`, `\endif`, `\gset`, `\pset`) are **not** imports and are
counted in `ambiguity.psqlCommandsSkipped` so a shape added to the grammar later appears in a
number rather than in nothing.
*Overturn:* a corpus file whose `\i`/`\ir` argument is a psql variable or carries no recognised
suffix.

### The six questions, per emitted type

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (intra / corpus) | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 10,025 | 84/84 facts | no confusion found | **100 % / 100 %** | 1.0, all `structural` |
| `uses` | yes | 6,575 | 84/84 facts | distinct from `calls` (a table reference vs a callee) and from `references` (an FK/policy/index target, all in fixed keyword slots) | 37.95 % / **87.21 %** | 1.0, all `usage_contextual` |
| `references` | yes | 4,409 | 84/84 facts | distinct from `uses`: every target follows `keyword_references`/`keyword_on` | 67.93 % / **98.09 %** | 1.0, all `structural` |
| `calls` | yes | 814 | 84/84 facts | distinct from `uses`; 5 edges carry `external` | 50.00 % / 70.76 % | 1.0, all `usage_contextual` |
| `imports` | yes | 49 | not in the 84-fact oracle; **0 unexplained** by construction and the two mechanisms are separable in metadata | `psqlInclude` (22) vs `extensionInstall` (27) | 55.10 % / 55.10 % | 1.0, all `import_based` |
| `overrides` | yes | 22 | not in the 84-fact oracle | `orReplace: true` + both line numbers on every edge | **100 % / 100 %** | 1.0, all `structural` |
| `instantiates` | yes | 13 | not in the 84-fact oracle | `construction: true` + the constructor node type; conversions carry no edge | 84.62 % / 84.62 % | 1.0, all `structural` |

Resolution is reported at two rates deliberately. The analyzer emits per-file arrays of bare
names, so "resolved" has two honest meanings: declared in the **same** file, or in **any** admitted
file. A consumer running `bb_graph` is cross-file, so the corpus-wide rate predicts a dangling
edge; the intra-file rate predicts a mis-scoped analyzer. Printing one would hide whichever half
is worse. `global` is the analyzer's synthetic owner for anonymous statements and is counted and
reported, never scored as unresolved.

Two rates deserve naming rather than a footnote. **`uses` at 37.95 % intra-file** is the lowest of
the four structural types and it is expected: a migrations corpus reads tables a previous migration
created, so the honest answer for most of them is "declared elsewhere". Fixing the CTE-scope defect
below moved it from 36.88 % to 37.95 % intra-file and from 85.14 % to 87.21 % corpus-wide, by
removing **193** edges that named a CTE as a table. **`imports` at 55.10 % is a
property of the construct, not a defect**: the 27 `CREATE EXTENSION` targets are distributions
(`pgcrypto`, `plpgsql`, `uuid-ossp`, `postgis`) that no file in the corpus can declare, so they
*cannot* resolve, and they are labelled `external` for exactly that reason. The 22 psql includes
resolve at 0 % for a different and fixable reason — the targets are paths relative to the
including script's own directory, so a consumer must join them before resolving.

`overrides` resolves at 100 % on both rates by construction: the edge is a same-file,
same-name replacement, so both ends are always present.

### DERIVATION findings — 7 of 7 emitted types

Every type this analyzer emits is a **DERIVATION finding**: stored, and compared against nothing.
`script/m14/differential.ts` has **68** per-language `derive*Edges` oracle functions and **none
for SQL** — `deriveJavaEdges`, `deriveGoUses`, `deriveRustDeclaredTypeRefs`, `deriveBashEdges` and
63 others, no `deriveSqlEdges`. The harness says so out loud rather than reporting a clean 0/0:

```
$ BB_CORPUS_ROOT=$HOME npx tsx script/m14/differential.ts --repo ProxiCall --lang sql
[cold-pool] ProxiCall:sql: 60/60 fresh (rot 1, corpus 437)
Error: differential: ProxiCall:sql parsed 60 file(s) and derived ZERO truth edges —
  the parser or the oracle is dead, not clean (a 0/0 row is a fabricated pass)
```

That is the same structural blind spot the ontology gate's own header documents, one level up: the
differential is independent at the level of *implementation*, so it cannot see a type that is
missing from **both** sides. Here it is missing from the oracle side for all seven emitted types.
Paying it down needs an oracle, and the oracle belongs to shared machinery — a §8 item, specified
in the report below.

The lane's *own* correctness instrument is the m12 differential against 84 hand-audited facts, and
it is a genuine independent check: those facts were audited by hand, not derived from the
analyzer.

### A fabrication this lane's own oracle caught

The 84-fact differential had been reporting exactly **one** false positive since the artifact was
written — `FP rel:Queries.sql:uses:global:recent_users`, precision 0.988 — and this file recorded
it as "left unnamed because re-deriving it requires re-running the differential". Re-running it
names the edge, and the edge was wrong:

```sql
WITH recent_users AS (…), named_users AS (SELECT u.id FROM recent_users u)
SELECT … FROM named_users;
```

A CTE body is itself a `statement`, and the **declaration sweep** dispatches nested statements so
that plpgsql bodies contribute edges. The sweep is a separate walk from `processRoot` and it had no
CTE scope of its own, so it reached `named_users`'s body with both the per-node and the file-level
CTE set **empty**; the guard is `localCtes.has(leaf) || state.localCtes.has(leaf)`, so
`FROM recent_users u` was published as `uses global->recent_users` — a table edge to a name the CTE
itself binds, which no file can declare. The outer `FROM named_users` was suppressed correctly by
the same guard, so the file published exactly the one edge it should not have.

The fix gives the sweep the CTE scope of the statement it descends into, and restores it
afterwards because sibling statements have their own. Pinned by `sqld5`'s new rows
(`forbidRelationships` on `d5_first`, `expectRelationships` on the qualified `d5_real` so a fix
cannot pass by over-suppressing) and by mutant `sql/declaration-sweep-drops-the-cte-scope`. The
differential is now **precision 1.000, recall 1.000, 0 FP, 0 FN, `earliestFailingLayer=none`** —
which also resolves this file's separately-recorded claim that the current precision was "not
established by any artifact in the repository".

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

| Gate | Result | Self-test |
| --- | --- | --- |
| contract battery (`fixtures/sql/probe/contract-battery.mts`) | **not runnable on this machine** — the directory does not exist here; the recorded 54 / 54 is from 2026-09-27 and is **unverified by this round** | — |
| M14 fixture lane | **13 / 13** | 4 were red before their fixtures existed |
| SQL ontology mutants (`script/m60/run-sql-ontology-mutants.ts`) | **12 / 12 caught** | exits 2 on a survivor, through the shared harness's own `runLang` |
| ontology coverage gate (`script/m14/ontology-coverage-gate.ts sql`) | **exit 2 — refuses to report.** `RULED_BY_LANG` has no `sql` entry, and the gate declines to call every un-emitted type `RULED-UNJUSTIFIED` because that would be a verdict about its own table. The table is supplied lane-side in `script/m60/sql-ontology-ruled.ts`; the supervisor's change is two lines | the refusal path is the self-test |
| ontology census (`validation/m14/fixtures/sql/ontology-census.mts`) | 1,459 / 1,459 parsed, 0 failures, 0 empty names, 0 `unknown` endpoints, **21,907 relationships** | the exclusion is in the artifact as `excluded` |
| construct probe (`validation/m14/fixtures/sql/construct-probe.mts`) | 465 distinct node types, 0 parse failures | — |
| `keepSymbol` census | 14,851 symbols emitted, **2 dropped (0.013 %)**, both `function:root` — SQL-G13, filed not fixed | — |
| m12 differential (`script/m12/verify-analyzer.ts sql`) | **84 facts, P = R = 1.000, 0 FP, 0 FN, `earliestFailingLayer=none`** | the FP that made this 0.988 was a real fabrication; see above |
| node-type gate (`script/m12/sql-node-types-compare.ts`) | **not re-run by this round.** Re-running it lowers `distinctNodeTypesObserved` from 415 to 308 and `probeFiles` from 6 to 0, because `fixtures/sql/probe/dialects` is absent from this machine. Committing that would re-baseline the artifact against a smaller observation surface, so it was reverted | — |
| resync corpus gate | not re-run — `fixtures/sql` is absent from this machine | impossible bars → **exit 1** |
| pin contract | sql lane validates | a drifted sha is a `PIN FAILURE` |
| regex census | no sql finding; the psql `\i` reader and the `OR REPLACE` reader added this round are character scans, not regex | — |
| perf gate (`script/m60/sql-perf-gate.ts`, `verify:m60-sql-perf`) | not re-run this round | bars are a regression detector, not a benchmark |

**Two gates are unrunnable here and neither is reported as a pass.** `fixtures/sql/` — the
contract battery, the dialect probe set and `REVIEW.md` — does not exist on this machine at all,
so the "54 / 54" this page carried since 2026-09-27 is a recorded prior result and nothing more.
That is a property of the box, not of the analyzer, and it is stated rather than quietly carried
forward as current.

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

### Added by the ontology workstream (2026-10-03)

- **SQL-G11 — `CREATE TABLE c (LIKE p INCLUDING ALL)` is parsed but not read.** 9 occurrences in
  4 files; `keyword_like` is 574 nodes corpus-wide (the rest are `GRANT … ON ALL TABLES IN SCHEMA
  x LIKE 'pattern'`, which name no table). The clause is a structural **copy**, not inheritance —
  the two tables evolve independently — so it is not an `extends` edge, and the nearest honest
  label for the dependency it does create is one this analyzer does not currently emit. No edge is
  published for it, deliberately, rather than published under an arguable type.
- **SQL-G12 — one phantom column, declared not fixed.**
  `ALTER TABLE log ADD KEY useragent_id (useragent_id)` is MySQL's index-adding syntax and the
  grammar reads it as a column named `KEY` of type `useragent_id` (1 occurrence corpus-wide,
  `cloogle.org/db/install.sql` line 25). Not guarded, because the tree cannot distinguish it from
  `ALTER TABLE t ADD key my_type`, which is legal PostgreSQL, and a text guard would trade one
  wrong symbol for a missing one. `LIKE` and `INHERIT` **are** guarded because both are reserved
  in every dialect this grammar serves while a quoted `"like"` arrives as a `literal` — the guard
  keys on the name *and* on the node being an unquoted `identifier`. Measured: **6 phantom columns
  named `LIKE` in 2 files** suppressed, each of which had been carrying the source table's name as
  its fabricated `sqlType`.
- **SQL-G13 — shared machinery deletes real symbols.** `src/ast/pool-worker.ts`'s `NOISE_TARGETS`
  list contains `root`, so `keepSymbol` drops a real project symbol with that name on the way to
  the index: **14,851 symbols emitted, 2 dropped (0.013 %)**, both `function:root`, e.g.
  `postgrest/test/io/fixtures/schema.sql`, which declares `create or replace function root()
  returns json`. This is the same defect class that file's own comment documents for `type`,
  `parent` and `firstChild`. Instrument:
  `validation/m14/fixtures/sql/keep-symbol-census.mts`, artifact
  `validation/m14/fixtures/sql/keep-symbol-census.json`. **Filed, not edited** —
  `pool-worker.ts` is shared. (An earlier draft said 3 drops, from an ad-hoc probe that was never
  committed; the committed instrument says 2 and the committed number is the one that stands.)
- **`overrides` sees 15 of 666.** 666 `CREATE OR REPLACE` declarations exist over the census
  corpus; **15** replace a declaration of the same kind in the same file and are therefore visible
  to a per-file analyzer, which is what it emits. The other **651 replace a declaration made in
  another file** — a migration chain re-declaring what the previous migration declared — and a
  per-file analyzer cannot see them. **20** same-kind re-declarations carry no `OR REPLACE` at all
  and PostgreSQL rejects those outright, so calling them overrides would assert a replacement the
  language does not perform. The number that could be recovered is therefore 651, not 0, and it is
  named rather than rounded away.
- **`imports` resolves at 55.10 %, and 27 of those edges never can.** The 22 psql includes target
  paths relative to the including script's own directory, so a consumer must join them against
  that directory before resolving — the analyzer does not, because doing so is the pool-worker's
  job and not a fact the tree carries. The 27 `CREATE EXTENSION` targets are distributions
  (`pgcrypto`, `plpgsql`, `uuid-ossp`, `postgis`) that no file in the corpus can declare; they are
  labelled `external` for that reason.
- **7 of 7 emitted types are DERIVATION findings.** `script/m14/differential.ts` has 68
  per-language oracle functions and none for SQL, so the shared differential compares this lane
  against nothing and the harness itself refuses the row. The lane's own 84-fact hand audit is the
  only correctness instrument, and it cannot see a relationship *type* that both it and the
  analyzer omit — which is the class of defect the ontology workstream exists to find. An oracle
  belongs in shared machinery; the specification is in the report.
- **`extends` is RULED against the wired grammar, not against SQL.** SQL has table inheritance;
  the grammar cannot represent `INHERITS (p)` at all, so the ruling is a statement about a
  `.wasm` build. A grammar that could express the clause would make the type derivable, and the
  capability probe that establishes this is recorded in `sqld13` and `construct-probe.json`.

### Carried from the M60 SQL wave

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

1. **Cross-file edges are the analyzer's weakest surface.** Every count here is a per-file count.
   `overrides` sees 15 of 666 real replacement events; `uses` resolves intra-file at 37.95 % for
   the ordinary reason that a migrations corpus reads tables an earlier migration created. No
   amount of intra-file work changes either number, and a graph consumer that wants the 651
   cross-file overrides needs a cross-file pass that does not exist.
2. **`confidence` is uniformly 1, and that is a weaker claim than it looks.** It means no edge is
   a guess about a *name*. It does not mean the analyzer is equally certain about the *edge's
   meaning*: the `usage_contextual` tier (33.73 % of all edges) says the name was read from a bare
   slot with nothing around it to disambiguate it. A `uses` edge to `lineitem` could be the TPC-H
   table or a same-named temp table in another schema; the analyzer cannot tell and does not
   pretend to.
3. **The correctness oracle has 84 facts over 5 fixtures.** That is small, and it was audited by
   hand against one parse tree — so a grammar defect both it and the analyzer accept would be
   invisible. The construct probe covers part of that gap by measuring the grammar's vocabulary
   rather than agreeing about it, but neither instrument is a proof of recall.
4. **The shared differential audits nothing here.** 7 of 7 emitted types are DERIVATION findings,
   so the largest and most sophisticated correctness instrument in the repository contributes
   **zero** to this lane's correctness evidence. Every correctness number on this page comes from
   the 84-fact m12 audit.
5. **The corpus is migration-heavy.** Most admitted files are schema migrations, which biases
   toward DDL and away from procedural SQL. Figures that depend on the mix — `uses` resolution,
   `calls` count, the plpgsql recall numbers — are properties of *this corpus* and would move on
   one that is not.
6. **One corpus file kills the whole measurement process.** `duckdb/extension/tpcds/dsdgen/
   queries/83.sql` returns `memory access out of bounds` from the wasm parser, and then hangs:
   `src/ast/engine.ts:1411` arms a 120-second self-destruct timer around the *synchronous*
   `parser.parse()` and answers a hang with `process.exit(1)`, because `setTimeout` cannot
   interrupt blocked C/WASM code and the indexer is incremental. So the file does not fail — it
   takes the process with it, and with it **any instrument built on production `parseFile`**. The
   census excludes it by an explicit `--exclude` that is recorded in the artifact as `excluded`,
   so the sample is 1,459 of 1,460 and the reader can see which file is missing. This is also why
   the shared ontology coverage gate cannot produce a SQL verdict unaided: it walks the same
   corpus through the same entry point.
7. **Two gates could not be run on this machine.** `fixtures/sql/` is absent, so the contract
   battery (recorded 54 / 54) and the dialect probe set are prior results, not current ones. The
   node-type gate was deliberately **not** re-run, because doing so without the probe set lowers
   its own observation surface and would have re-baselined a shared artifact downward.
8. **The `overrides` source/target encoding is a compromise, not a design.** The two ends cannot be
   two symbols — SQL replacement is same-name, so any pair collapses to a self-loop `f->f` that
   tells a consumer nothing about which declaration replaced which. The edge is therefore
   `global-><name>` with both line numbers in metadata. A consumer wanting the real predecessor
   must read `metadata.priorLine`; there is no symbol for it.
9. **`evidenceClass` is derived from how the analyzer reads the tree, not from an audit of each
   individual edge.** The mapping is per-relationship-type with three tiers, and every one of
   those tiers is a claim about a mechanism. An edge mislabelled *within* its tier — a `uses` that
   actually came from a qualified reference, say — would not show up as a tier error.
10. **`create_extension` is the only `imports` mechanism that can never resolve.** 27 of 49
    `imports` edges target a distribution no file in the corpus declares, so the type's 55.10 %
    resolution rate mixes a fixable shortfall (psql paths relative to the including script) with a
    permanent one. The two are separable in metadata; the headline rate does not separate them.

## Evidence pointers

- Ontology census (every count above): `validation/m14/fixtures/sql/ontology-census.json`, written
  by `validation/m14/fixtures/sql/ontology-census.mts` through production `parseFile`
- Construct probe (the 465-node-type grammar inventory and the semantic counts behind every
  RULED verdict): `validation/m14/fixtures/sql/construct-probe.json`
- `keepSymbol` census (SQL-G13): `validation/m14/fixtures/sql/keep-symbol-census.json`
- SQL's entry for the arbiter's ruling table: `script/m60/sql-ontology-ruled.ts`
- Ontology mutants and their runner: `script/m60/sql-ontology-mutants.ts`,
  `script/m60/run-sql-ontology-mutants.ts`
- Review: `fixtures/sql/REVIEW.md` (measured arc, §1 defect table, §3 grammar, §8 second
  corpus, §9–10 the grammar candidates and the EXECUTE pass) — **absent from this machine**
- Fixtures: `validation/m12/fixtures/sql/`, `validation/m14/fixtures/sql/sqld1..sqld13`
- Ground truth: `validation/m12/ground-truth/sql.json`
- Differential: `validation/m12/results/sql-differential.json`
- Corpus errors: `validation/m12/results/sql-corpus-errors.json`
- Completeness spec: `script/m14/spec/sql-completeness.json` (82 handled / 96 internal-silent /
  9 gaps / 18 rulings)
- Lane records: `validation/m60/sql/` — `second-corpus-recall.json`,
  `v3-rejection.json`, `v4-plpgsql-candidate.json`, `execute-literal-recovery.json`
- Gates: `script/m12/sql-node-types-compare.ts`, `script/m12/verify-analyzer.ts`,
  `script/m14/mutate-analyzer.ts`, `script/m14/verify-grammar-pins.ts`,
  `script/m14/ontology-coverage-gate.ts`,
  `script/m60/verify-sql-resync.ts`, `script/m60/measure-grammar-recovery.ts`
- Probes: `fixtures/sql/probe/` (contract battery, grammar census, field introspection, corpus
  sweep, unknown-symbol, parser-state-leak, grammar A/B) — **absent from this machine**
- Grammar review: `reviews/m60-sql-grammar-l1xnan-047-refused.md`, `reviews/regex-policy.md`

## Issue

M12.33 / GitHub issue #172.
