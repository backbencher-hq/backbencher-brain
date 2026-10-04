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

Every rule below is stated **for SQL**, not in general. Pass 4 re-measured every count through
production `parseFile` over **1,955 of 1,955 admitted SQL files, of which 16 corpus repositories
contribute at least one** (`duckdb` 594, `boundary` 486, `proxicall` 438, `hasura-engine` 346,
`postgrest` 32, `sqlite` 13, `dark` 9, `phpmyadmin` 9, `Exposed` 8, `redwood` 8,
`nvim-treesitter` 7, and 5 repositories contributing 1 each; a 17th, `kong`, tracks one `.sql`
that is over the 512 KB cap and contributes 0)
(`validation/m14/fixtures/sql/measurements/pass4-census.json`): **31,066 relationships and
18,482 symbols**, with **0 files degraded by the analyzer timeout and 0 in the regex-extractor
fallback**. Every count on this page was re-measured at pass 4's HEAD; nothing is carried
forward. Pass 3's artifacts are kept at `measurements/pass3-final-census.json` and are superseded,
not deleted — the difference between them is itself a measurement (see *Reproducibility*).

| Relationship | Rule **in SQL** | Census |
| --- | --- | --- |
| `contains` | table → column, and table → index/constraint. A SQL file's containment is its schema: a column is not a member of the query that selects it, and a CTE body is not a member of the statement that holds it. **Every edge carries `metadata.memberKind`** — see *Pass 3* | 11,977 |
| `uses` | view / function / query / DML → referenced table. Anonymous statements use `global`. **A CTE name is not a table**: an unqualified reference matching a CTE of the statement's WITH list is suppressed, a qualified one never is. The scope is the WITH LIST, not the enclosing query — see *Pass 2* | 9,106 |
| `references` | FK table → referenced table, index → indexed table, trigger → target table, policy → its table, GRANT/REVOKE → the object granted on. Each target sits in a grammar-mandated slot after `keyword_references` / `keyword_on` | 5,996 |
| `calls` | trigger → executed function, and any `invocation` node **anywhere in the tree**, not only inside a query — a `DEFAULT`, a `CHECK`, a generated column's expression, a policy's `USING (…)`, a `DO` block's `PERFORM`, and an `ALTER COLUMN … SET DEFAULT` are all `invocation`s in grammar-mandated slots. The callee must be free of ERROR and not a keyword or builtin. Two of those routes were dead until pass 3 | 3,892 |
| `imports` | two distinct mechanisms, kept separable in metadata: a psql `\i`/`\ir` include (**22**, `metadata.psqlInclude`, target is a file in this repository) and `CREATE EXTENSION` (**30**, `metadata.extensionInstall`, target is a distribution that must be installed and can never bind) | 52 |
| `overrides` | `CREATE OR REPLACE` on a name **this file already declared of the same kind**. SQL has no method table; this is the only replacement event the language has | 22 |
| `instantiates` | `ROW(...)::composite` — a composite cast, which PostgreSQL implements as a call to the type's constructor. A conversion (`x::my_enum`, `nextval('s')::bigint`) is **not** an instantiation | 21 |
| `exports` | not derivable — RULED, and the ruling is the **weakest of the three**: no correct implementation could meet its condition. See below | 0 |
| `extends` | **SQL HAS table inheritance and the wired grammar cannot read it.** RULED on a grammar inventory, but this is a GRAMMAR GAP, not an inapplicability — see below | 0 |
| `implements` | not derivable — RULED, instrument A + B | 0 |

Relationship identity uses a `Map` keyed by type/source/target. Repeated DML operations merge
operation metadata rather than creating duplicate graph edges. Unresolved tables/functions
remain external names; no cross-file symbol is invented by the analyzer.

### `evidenceClass` — the heuristic/deterministic ratio is a number

Every edge carries `evidenceClass`, which is the honesty contract's §4 requirement made
queryable. Before pass 1 **no** edge carried it, which reads as "no heuristics" and means
"nothing recorded"; an absent field is not the same claim as a uniformly `structural` one.

| Tier | Meaning here | Edges | Share |
| --- | --- | --- | --- |
| `structural` | the fact is in a grammar-mandated position — every `contains`, `references`, `overrides`, `instantiates` | 18,016 | 57.99 % |
| `import_based` | a token names another unit — every `imports` | 52 | 0.17 % |
| `usage_contextual` | a name in a bare slot with nothing around it to disambiguate | 10,693 | 34.42 % |
| `reference_qualified` | a name read through a reference that names its own **schema**, which is its own disambiguation — `app.users`, `public.f(…)` | 2,305 | 7.42 % |

(31,066 edges; shares are of that total, computed from the per-type `evidenceClass` census in
`measurements/pass4-census.json` — `contains` 11,977 + `references` 5,996 + `overrides` 22
+ `instantiates` 21 = 18,016 structural; `calls` 3,417 + 475; `uses` 7,276 + 1,830.)

**`reference_qualified` was DEAD until pass 2, and this is the number that says so.**
`evidenceClassFor` has consulted `metadata.qualified` for the tier since it was written, and
`addTableEdge` has passed `metadata.qualified` since it was written — but `evidenceClassFor`'s
`Uses` arm hardcoded `usage_contextual` without looking, and `processCalls`, `processTrigger`'s
action edge and `recordDml` passed **no metadata at all**, so for `calls` the field was
undefined on every edge in the corpus. Measured before the fix: **0 of 3,827 `calls` and 0 of
the qualified `uses` edges carried the tier**, and 2,254 carry it now. The adversarial probe
re-derives the expected tier independently of the analyzer's own table and reports, at this HEAD,
**3,892 of 3,892 `calls` and 9,106 of 9,106 `uses` edges AGREE, 0 disagree**
(`adversarial-probe.json`, `A3-tier-AGREES-with-the-metadata` / `A4-tier-AGREES-with-the-metadata`)
— a probe that read the analyzer's own mapping could not have reported a disagreement.

`confidence` is **1 on all 31,066 edges and 0 edges fall below 0.7.** That is a claim rather
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

## Ontology verdicts — all ten types (verdicts and counts re-measured at pass 4, 2026-10-04; incoming direction at pass 5; every gate re-confirmed at pass 6, 2026-10-04)

Instrument: production `parseFile` (not `analyze()`) over **1,955 of 1,955 admitted SQL files, of
which 16 corpus repositories contribute at least one**, size cap 512 KB, **every** admitted file sampled rather than a subset, walked as
**8 strided shards and merged** (see *Reproducibility*). Artifacts, all under
`validation/m14/fixtures/sql/measurements/`:
`pass4-census.json`, `pass4-census-4shard.json`, `pass4-sharded-arbiter.json`,
`pass4-arbiter-shape-diff.json`, `pass4-descendants-equivalence.json`,
`pass3-adversarial-probe.json`, `pass3-construct-probe.json`, `pass3-incoming-corpus.json`,
`pass3-invocation-why-after.json`, `pass3-phantom-constraint-{before,after}.json`.
Written rulings: `script/m14/sql-ruled.ts`, applied to a COPY of the arbiter by
`run-ruling-table.mts` / `run-sharded-arbiter.mts`.

**The arbiter's own verdict on this lane's own ruling table**, copy patched, arbiter on disk
untouched, all 8 shards answering all ten rows:
**`emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0`.**
The arbiter's single-process run does not finish at all — it dies on `[BB-HANG] parser stuck 120s`
and prints its header and nothing else, which is why the verdict is taken over 8 repo-shards and
merged by the arbiter's own precedence. See *PASS 4*.

| Type | Verdict | Count | Where it came from, or the ruling's instrument |
| --- | --- | --- | --- |
| `contains` | EMITTED | 11,977 | 648 files; e.g. `Exposed/exposed-maven-plugin/…/V20260720135258__CREATE_TABLE_USERS.sql` |
| `uses` | EMITTED | 9,106 | 1,522 files; e.g. `duckdb/benchmark/aoc24/queries/day02.sql` |
| `references` | EMITTED | 5,996 | 612 files; e.g. `hasura-engine/server/src-rsr/init_pg_source.sql` |
| `calls` | EMITTED | 3,892 | 630 files; e.g. `duckdb/benchmark/clickbench/queries/q27.sql` |
| `imports` | EMITTED | 52 | 25 files; 22 psql includes in 6 (`postgrest/test/io/fixtures/load.sql`) + 30 `CREATE EXTENSION` in 8 (`hasura-engine/server/src-rsr/migrations/1_to_2.sql`) |
| `overrides` | EMITTED | 22 | 4 files; `postgrest/test/io/fixtures/big_schema.sql`, `postgrest/test/io/fixtures/schema.sql`, `postgrest/test/spec/fixtures/schema.sql`, `proxicall/database/archive/2026/20260131_pms_audit_logging_system.sql` |
| `instantiates` | EMITTED | 21 | 10 files; `hasura-engine/v3/crates/engine/tests/db_definition.sql`, `postgrest/test/spec/fixtures/schema.sql` |
| `exports` | RULED | 0 | **Instrument A.** 480 distinct node types across the corpus and **no node type anywhere in that vocabulary contains `export`, `module` or `provide`**, keyword or otherwise. Token counts: 0 `EXPORT`, 0 `MODULE` as a KEYWORD, 0 `PROVIDE`; 1 occurrence of the TEXT `module`, which is a column name — see *Pass 3*. |
| `extends` | RULED | 0 | **Instrument A + B + a 5-shape capability battery.** No inheritance node among the 480; 0 `INHERITS` tokens inside a `create_table` or `alter_table`; and `INHERITS`, `PARTITION OF`, `ATTACH PARTITION`, `PARTITION BY` and `LIKE` were each PARSED against the wired wasm. See below. |
| `implements` | RULED | 0 | **Instrument A + B.** No interface/supertype node among the 480; 0 `IMPLEMENTS` tokens. SQL has no interface type. |

Coverage is reported as **7 of 7 applicable types emitted**, with 3 of 10 ruled by measurement. The
denominator shrank only through RULED verdicts carrying a corpus measurement, and the numerator
(what fires) and the denominator (measured non-applicability) come from different instruments: the
census and the construct probe.

### The three rulings, and the overturn condition each one carries

**`exports` — instrument A, 480 node types.** The visibility scope in SQL is the *database*, not the
file, and no SQL construct enumerates what a unit publishes. `CREATE EXTENSION` is the strongest
candidate and it is answered with a measurement rather than a sentence: it occurs **30 times** over
the corpus, yields 30 `module` symbols, and is an **inbound** declaration of a package whose
published surface lives in that package's own control file, not in this unit. It is published as an
`imports` edge (`metadata.extensionInstall`), which is the direction the construct actually points.
psql's file graph is real and its only edge is inbound (`\i`), which is why `imports` is emitted and
`exports` is not.
*Overturn:* any node type among the 480 that expresses a published surface. **Pass 3 searched every
type name for `export`, `module`, `provide`, `partition`, `like`, `of`, `super`, `class`, `interface`,
`trait` and `struct` as substrings and found ZERO hits for the first three** — the two `partition`
hits are a `table_partition` rule and a `keyword_partition` token, both the `PARTITION BY` strategy
and neither naming a parent; the `class` hit is `keyword_regclass`.

**`extends` — instrument A, plus a FIVE-SHAPE capability battery, all six verdicts decided from the
TREE at pass 3.** SQL *does* have table inheritance; the wired grammar cannot represent it. A corpus
count of 0 is consistent both with "SQL lacks inheritance" and with "the grammar cannot read it", and
only a PARSE separates them — so each shape is parsed against `wasm/tree-sitter-sql.wasm` and the
NODE TYPES recorded (`pass3-adversarial-probe.json` → `capabilityTests`):

| Shape | Verdict | What the tree shows |
| --- | --- | --- |
| `CREATE TABLE c (…) INHERITS (p)` | NOT EXPRESSIBLE | `create_table` ends at the column list; the clause lands in a top-level `ERROR` |
| `CREATE TABLE c PARTITION OF p FOR VALUES …` | NOT EXPRESSIBLE | the whole `create_table` is inside an `ERROR`; `table_partition(keyword_partition, ERROR(keyword_for, keyword_values, keyword_from), ERROR)` — `OF <parent>` is inside the inner ERROR |
| `ALTER TABLE p ATTACH PARTITION c FOR VALUES …` | NOT EXPRESSIBLE | the `alter_table`'s only action is an `add_column` whose `column_definition` has `name: ATTACH` and `custom_type: PARTITION`; `FOR VALUES …` lands in a **top-level** `ERROR`. The attachment is not represented at all — it is misread as a column |
| `CREATE TABLE p (…) PARTITION BY RANGE (x)` | EXPRESSIBLE, but names no parent | `table_partition(keyword_partition, keyword_by, keyword_range, …)`, 5 occurrences corpus-wide, all of them this form |
| `CREATE TABLE c (LIKE p)` | EXPRESSIBLE, and a structural COPY | a `column_definition` whose `custom_type` **field** is `p` and whose `name` field is the bare `LIKE` token |

Pass 3 replaced this battery's instrument. Pass 2 decided all five from REGEXES over a rendered
`rootNode.toString()` dump, which is the instrument the ontology gate's own header rejects — and which
had already produced one wrong verdict here (a `LIKE p` case that searched the shape for `(LIKE`, found
nothing, and reported NOT EXPRESSIBLE for a clause the grammar reads cleanly). Every verdict is now read
off node types, named children and **fields**, which is not a cosmetic change: `custom_type` is a field
on `column_definition` and not a node type, so the first tree-based attempt answered NO for that same
clean clause. The battery's verdicts did not change in substance; the reasoning behind two of them is
now sharper than the text it replaced.
Corpus count: `table_partition` occurs 6 times and **all 6 are the `PARTITION BY` strategy**;
`PARTITION OF` occurs 0 times corpus-wide.
*Overturn:* a parse in which `OF <parent>` or `INHERITS (…)` survives inside a
`create_table`/`alter_table` without an intervening `ERROR`. That is a statement about the
grammar, not about a node's spelling, and it is the condition the battery actually tests.

**`implements` — instrument A + B.** SQL has no interface type and no clause in which a
declaration names a supertype it satisfies. `CREATE DOMAIN d AS t CHECK (…)` is a
constraint-carrying alias, not interface satisfaction.
*Overturn:* any supertype/interface node type among the 480.

**`imports` — the ruling that was falsified in pass 1, and re-verified twice since.** SQL-D1 recorded
"the analyzer emits no `imports`. SQL has no import statement", justified by the *mechanism*. That was
true of the code and false of the language: psql's `\i` / `\ir` name another **file**, 22 directives
across 6 files, and `CREATE EXTENSION` names another **distribution**, 30 declarations across 8 files.
Two guards cost 0 occurrences on this corpus and are kept for the corpus that needs them: a
psql-variable target (`\i :name`) and an argument with no `.sql`/`.psql`/`.dump` suffix. The other 136
meta-commands are **not** imports and are counted in `ambiguity.psqlCommandsSkipped`
(`echo` 108, `ir` 22, `set` 8, `gexec` 1, `endif` 1, `if` 1, `gset` 1, `pset` 1).
**The resolvable half is measured: 22 of 22 psql include targets exist on disk** after
`path.resolve(path.dirname(file), target)`.
*Overturn:* a corpus file whose `\i`/`\ir` argument is a psql variable or carries no
recognised suffix — 0 occurrences on this corpus.

### The six questions, per emitted type

They fail independently, so the columns fail independently too. "Correct" is the lane's
84-fact hand audit plus the independent adversarial probe; the probe's own limit is stated
under the table.

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (intra / corpus) | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 11,977 | 11,976 of 11,977 member endpoints resolve by `ownerName`; **1 does not**, and it is named below | distinct from `references` (an FK/policy/index target, all in fixed keyword slots) | 99.99 % / 99.99 % | 1.0, all `structural` |
| `uses` | yes | 9,106 | 19 of 19 CTE-named edges are AMBIGUOUS rather than fabricated (a qualified reference reaches the same bare leaf) or unrecoverable (below) | distinct from `calls`; tier agrees with metadata on every edge | 32.51 % / 88.95 % | 1.0; 7,276 `usage_contextual`, 1,830 `reference_qualified` |
| `references` | yes | 5,996 | 84/84 facts | distinct from `uses`: every target follows `keyword_references`/`keyword_on` | 69.56 % / 98.27 % | 1.0, all `structural` |
| `calls` | yes | 3,892 | 84/84 facts; **629 of 742** qualified invocations on the tree emitted, **53** guard-suppressed, **60** inside an error subtree, **0 unexplained** | distinct from `uses`; tier agrees on 3,892 of 3,892 edges | 40.34 % / 78.75 % | 1.0; 3,417 `usage_contextual`, 475 `reference_qualified` |
| `imports` | yes | 52 | not in the 84-fact oracle; 0 unexplained by construction and the two mechanisms are separable in metadata | `psqlInclude` (22) vs `extensionInstall` (30) | 57.69 % / 57.69 % | 1.0, all `import_based` |
| `overrides` | yes | 22 edges from **34 events** | the analyzer's own rule re-implemented on parse trees yields 34 events → 22 per-file edge keys, **exactly production's 22**; the probe's rule yields 15 and the 19-edge difference decomposes to 12 multiplicity + 7 visit order, exact | `orReplace: true` + both line numbers on every edge | 100 % / 100 % | 1.0, all `structural` |
| `instantiates` | yes | 21 | 17 of the construction-shaped casts sit OUTSIDE any query node and **all 17 are emitted**, so the type is not query-only | `construction: true` + the constructor node type; conversions carry no edge | 52.38 % / 90.48 % | 1.0, all `structural` |

Resolution is reported at two rates deliberately. The analyzer emits per-file arrays of bare
names, so "resolved" has two honest meanings: declared in the **same** file, or in **any**
admitted file. A consumer running `bb_graph` is cross-file, so the corpus-wide rate predicts a
dangling edge; the intra-file rate predicts a mis-scoped analyzer. Printing one would hide
whichever half is worse. `global` is the analyzer's synthetic owner for anonymous statements
and is counted and reported, never scored as unresolved — but see *Pass 3*, because 77 % of
`uses` edges are sourced to it and that is a real limit on the INCOMING direction.

### `calls` residual, bucketed by CAUSE — pass 2's open item, closed

Pass 2 recorded: "196 qualified invocations are not emitted and pass 2 did not settle why …
the number is reported as an open item rather than as a characterised class." A count with no
cause is a to-do. `pass3-invocation-why.mts` assigns each miss a cause by asking the TREE what
shape it is in, over 1,955 files:

| Bucket | Pass 2 | Pass 3 | Pass 5 (this HEAD) | What it is |
| --- | --- | --- | --- | --- |
| qualified invocations on the tree | 742 | 742 | **742** | the denominator, unchanged across three passes |
| emitted as a `calls` edge | 449 | 579 | **629** | the two dispatch fixes, still in |
| suppressed by the keyword/builtin guard | 53 | 53 | **53** | a guard working as designed |
| inside an error subtree | 224 | 107 | **60** | a grammar bound, not a lane defect: the names in a swallowed WITH list never become nodes |
| inside a `plpgsql_block` / `function_body` | 2 | 5 | **0** | absorbed into the row above — the probe's own chains read `…>plpgsql_assignment>function_body>create_function`, i.e. an error *above* the plpgsql body, so it is one class and splitting it was double-counting |
| reachable shape, still not emitted | **196 (unsplit)** | **0** | **0** | the candidate defects, and the reason pass 2's number was a to-do |

629 + 53 + 60 = 742, so the decomposition is closed at pass 5 as well as at pass 3. Two dispatch
gaps accounted for 14 of pass 2's reachable bucket, and both are the failure mode this workstream
exists on: a branch that reads as constructible and never runs. See *PASS 3*.

**The lane's two probes ask this question with DIFFERENT POPULATIONS, and the difference is a
filter rather than a disagreement.** `pass3-invocation-why.mts` counts every `invocation` with a
two-part callee and then buckets the misses by cause, so it reports 742 / 629 / 53 / 60.
`adversarial-probe.mts` A3 skips any invocation whose own subtree carries an error
(`if (n.type !== "invocation" || n.hasError) return`), so those nodes are outside its population
entirely and it reports **696 = 628 + 16 + 52**. 742 − 696 = **46**, which is the filter. The two
probes also disagree by **1** on the emitted bucket and **1** on the guard bucket — 2 of 742,
0.27 % — and I did not settle why; the candidates are A3's global quote-strip on the leaf against
this probe's leading/trailing-only `unquote`, and `Set`-membership on a leaf shared by two
invocations in one file. It is reported rather than chosen between, because either probe's number
alone would have read as the whole population.

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
and it is the **construct probe's 15** that is short — and pass 5 measured **why**, which closes
limitation 14. See *`overrides` reconciled by measurement, pass 5* below.

The kind-keyed `state.redeclared` is still a real fix and is still kept: the code did not
enforce what the field comment and this page both claimed, and the corpus happens not to
exercise it with `OR REPLACE` (the three cross-kind name collisions the probe found — 3 in 2
files — are `create_function`/`create_view` pairs with no `OR REPLACE` on either, so they
produce no edge either way). It is pinned by fixture `sqld14` and by mutant
`sql/override-key-ignores-the-declaration-kind`, and the honest statement is that the corpus
does not exercise it.

### `overrides` reconciled by measurement, and pass 3's mechanism was only half of it

Pass 3 proposed in prose that the probe's `count === 2` rule and its stack walk explained the
7-edge gap, and left it as a hypothesis because a prose mechanism is not a measurement.
`validation/m14/fixtures/sql/overrides-reconciliation.mts` re-implements **both** rules on the
same 1,955 parse trees — `recordReplacement`'s and the construct probe's P4 — and decomposes the
difference. It reports, over 4,645 declarations and 178 redeclared `kind:name` groups:

| | Count |
| --- | --- |
| analyzer's rule (an OR REPLACE declaration at document index ≥ 1 of its key) | **34 events** |
| the probe's rule (same nodes, the probe's own visit order) | **15 hits** — reproduces the committed 15 |
| gap | 19 |
| decomposed: multiplicity | **12** |
| decomposed: visit order | **7** |
| sum | **19 — EXACT**, checked by the probe rather than asserted |

**The cause is a WALK, not a rule, and pass 3 named the wrong half of it.** `construct-probe.mts`
pushes children *forward* into a LIFO stack, so siblings are visited in **reverse** document
order, and it classifies only the declaration it visits second. All 6 groups whose `orReplace`
flags read `[false, true]` are therefore visited `[1, 0]`: the probe inspects the
*non*-replacing declaration second and records no hit. Pass 3 saw this symptom in the probe's own
stored examples (`first at line 192, again at line 184`) and attributed the whole gap to it;
multiplicity is **12 of the 19**, from `json` declared 6 times, `overloaded_unnamed_param` 5 and
`overloaded_default` 4, all with `OR REPLACE` on every declaration.

**A second cause the pass-3 framing could not see, because it was comparing edges to events.**
The analyzer's rule finds **34 events** and production `parseFile` emits **22 edges**. That
difference is not a miss: `addRelationship` keys identity on `(type, source, target)` and
`recordReplacement`'s source is the synthetic owner `global`, so repeat replacements of one NAME
collapse onto a single edge. 34 events → **22 distinct per-file edge keys, which is production's
22 exactly**. It has to be counted per file, because `parseFile` is per file and rebuilds the
identity map each call: a corpus-wide set of names reads **21**, and the missing one is
`infinite_recursion`, replaced in two different files. The kind is *not* part of the edge key, and
**0** names are carried by two kinds here, so that half of the collision space is unexercised.

The two 12s — multiplicity excess and edge collapse — are **independent sums that agree on this
corpus**, which is why the observable 22-vs-15 gap reduces exactly to the visit-order component.
They are not equal by rule. The case that separates them is a name whose second declaration lacks
`OR REPLACE` and a later one carries it, where multiplicity is 1 and the collapse is 0; that case
occurs **0 times** in the admitted corpus, which is exactly why this corpus cannot tell the two
apart. That is a statement about the corpus, not a proof they are the same quantity.

**The probe's text read of `OR REPLACE` is a measured non-finding.** The probe reads
`n.text.slice(0, 48).toUpperCase().includes("OR REPLACE")` and the analyzer reads a
`keyword_replace` child node; on all **4,645 declarations the two disagree 0 times**, and both
rules return the same 34 / 15. So the text read is harmless *on this corpus* — recorded as a
number because it is the thing the lane's regex policy objects to, and an argument would have been
weaker evidence than the count.

**Withdrawn: the "of 777 real replacement events" in limitation 1.** Measured per file **34**,
corpus-wide **34** on the same rule, 78 names declared 2+ times. Every same-name re-declaration in
the admitted corpus is intra-file, so the extension corpus's one-file-per-version pattern — which
is what a cross-file denominator would have counted — contributes nothing here. 777 was carried
from a pass that did not measure it, and no instrument in this repository reproduces it.

### DERIVATION findings — 7 of 7 emitted types

Every type this analyzer emits is a **DERIVATION finding**: stored, and compared against
nothing. `script/m14/differential.ts` exports **116 distinct `derive*` oracle functions**
across `script/m14/` (161 export sites, some re-exported) and **none for SQL** — re-counted at
pass 3 and unchanged, so **7 of 7 emitted types** remain DERIVATION findings —
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
*(11,786 is the pass-3 edge count; at this HEAD `contains` is 11,977 and the same 1 edge is still
there — re-confirmed by `pass5-adversarial-probe.json` under
`A10-contains-target-has-no-symbol-in-this-file`.)*
`boundary/internal/db/schema/migrations/oss/postgres/71/11_session_recording.up.sql` publishes
`contains recording_channel_ssh_session_channel -> program`. `program` is a legal SQL column
name, and `keepSymbol`'s `UNIVERSAL` denylist in `src/ast/pool-worker.ts` holds `program` —
the grammar's ROOT node type — beside `root`, `module_declaration` and `source_file`. So the
symbol is deleted on the way to the index and the edge survives, naming something no consumer
can resolve. This is SQL-G13's other half: pass 1 recorded the dropped SYMBOL, and this is the
edge the drop corrupts. `pool-worker.ts` is shared (§8), so it is **filed, not edited**.

### A VACUOUS probe of my own, recorded because the CSS lane found one too

The range-containment probe (`A1`) was specified as "is the member's span inside the owner's
span?" and reports **11,252 of 11,786 violations (95.5 %)** at pass 2 — **11,392 of 11,977
(95.1 %) at this HEAD**, the same shape at a larger corpus — which reads as a catastrophic
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

**SUPERSEDED — this is the pass-2 state, kept because the sequence is the evidence.** Every row
below is re-measured or retired in pass 3's table and in *Declared limitations*: the `196`
unexplained invocations are now **0 unexplained** with the residual split 107 / 5 by cause, the
3,381 `usage_contextual` `calls` edges are **3,417**, and both `uses` rows moved. Read this table
as history, not as the current state.

| Residual | Count | Files | Why it is not fixed here |
| --- | --- | --- | --- |
| `uses` edges from inside an error-bearing CTE | **91** | 56 | when error recovery swallows a WITH list the names in it never become `cte` nodes, so the scope set is finished and still wrong. The fix would have to decide that ANY error inside a CTE body means the WITH list was lost, and that suppresses true table edges for every file with an unrelated unparseable expression in a CTE. Needs a grammar fix, not a guard. |
| `uses` edges targeting a CTE name with no qualified reach | **19** | 11 | down from 32; the remainder is the row above. |
| `uses` edges whose bare leaf is ambiguous between a CTE and a qualified table | **16** | 16 | `uses global->parse` in `duckdb/…/asql_cyk_using_key.sql` is one bare leaf reached both by the CTE `parse` (correctly suppressed) and by the real table `recurring.parse` (correctly emitted). The (type, source, target) key cannot represent two different objects with one leaf; that is limitation 8's shape applied to `uses`. |
| qualified invocations not emitted for a reason not settled | **196** | 11 | 52 are explained (keyword/builtin guard, and the probe separates them). The other 196 are inside damaged subtrees and I did not establish which guard or which pass drops them. |
| `contains` edges naming a symbol `keepSymbol` deletes | **1** | 1 | SQL-G13, shared machinery, filed |
| `calls` edges at confidence 1 whose evidence tier is `usage_contextual` | **3,381** | — | not a defect: that is the honest label for a name in a bare slot, and it is now countable per edge |

## PASS 3 — the incoming direction, and two dead code paths (2026-10-03)

Pass 1 measured whether each type fires. Pass 2 assumed each label was wrong and looked for the case
that proves it. **Pass 3 asks the question from the other end**: not what a file declares, but what a
graph can *walk to*, and then assumes the emission paths are reachable.

### The census was not a measurement until now, and the reason is the engine

Two mechanisms in the production path return a result SHAPED LIKE SUCCESS while contributing nothing,
and this census counted both as successful parses:

- `engine.ts:1717` answers its own 120-second analyzer timeout with a basic parse result —
  `symbols: []`, `relationships: []`, one `errors[]` entry, `metadata.analysisVersion:
  "2.0-basic-fallback"`. A load policy.
- `pool-worker.parseFile`'s catch returns `extractFallback` — the language-agnostic **REGEX**
  extractor — for ANY parse error, marked `fallback: true`. All files observed with it are under
  20 KB, so it is **not** the >1 MB size policy.

So `parseFailures: 0` was printed by runs in which files had contributed nothing. Two smaller
instrument defects in the same file: `topUnresolvedNames` serialised `[name, count]` pairs, so every
consumer read `undefined` for all twelve entries and the artifact's unresolved-target list was
unreadable while looking well-formed; and `--merge` consumed only its first path, so a merge reported
244 of 1,951 rows as the corpus.

**Name-based exclusion cannot fix this, and that is measured rather than asserted.** Pass 3 was killed
four times by four DIFFERENT files (`day03`, `day11`, `day04`, `day01`). Test: all 25
`duckdb/benchmark/aoc24/queries/day*.sql` parse solo in 0.7–7.6 s with no fault, and across 4 rounds
of 8-way contended parsing of exactly those files, **0 faults and 0 hangs**
(`measurements/pass3-fault-contended-r1.json`). So the fault is neither a property of a file nor of
concurrency alone — it emerges from SUSTAINED wasm state over a long walk, which file faults moves
between runs, and pass 2's three-name exclusion list grew to seven by pass 3 purely by being killed
again. A name list is a record of the day.

What does work is bounding the process: **8 contiguous shards** (run C used 4, to test that the count
does not depend on the slicing), a **serial repair pass** for files that degrade, and a **merge** that
replays shard rows through the same tally code. Two independent walks of the same corpus at the same
HEAD, with different partitioning:

| Walk | Shards | Files measured | Symbols | Relationships |
| --- | --- | --- | --- | --- |
| B | 8 | 1,951 | 17,581 | 29,019 |
| C | 4 | 1,952 | 18,524 | 30,893 |

**The entire difference is ONE file.** `postgrest/test/io/fixtures/big_schema.sql` is worth 943 symbols
(5.1 %) and 1,874 relationships (6.5 %), and both artifacts name it in `filesWithNoShardRow`. It is not
repairable: solo, in a dedicated process, it crosses the 120 s budget and the process takes 205 s to
unwind. Run C's numbers are the lane's, and **run C reproduces pass 2's headline** — 30,893 against
30,690 relationships, and `overrides` 22 against 22, which is the count pass 2 attributed partly to
this file. Pass 2's "the corpus numbers are not reproducible" was one file crossing a budget.

### DEFECT 1 — 53 declarations the files do not contain

`processConstraint` reads a constraint's name from the identifier after `keyword_constraint`. With no
`CONSTRAINT` keyword it fell back to `directChild(node, "identifier")`, a fallback added for MySQL's
`UNIQUE KEY <name> (cols)`. An unnamed FOREIGN KEY also has direct identifier children, and they are
the **REFERENCED table's columns**:

```
foreign key (a, b) references u (x, y)
  constraint
    keyword_foreign  keyword_key
    ordered_columns (a, b)          <- LOCAL columns, nested under `column`
    keyword_references  object_reference u
    identifier x   identifier y    <- DIRECT children: u's columns
```

so the fallback took `x` and published `constant:x` owned by the referencing table. Exemplar:
`boundary/internal/db/schema/migrations/oss/postgres/0/07_auth.up.sql` published two
`constant:scope_id` under `auth_account` (lines 90 and 94 — one per foreign key, both named after
`auth_method`'s first referenced column) against the real `property:scope_id` at line 72.

| | phantoms | files |
| --- | --- | --- |
| before | **53** | 22 |
| after | **0** | 0 |

The instrument is a **parse-tree oracle**, not the heuristic, and the reason is measured: phpMyAdmin's
`resources/sql/create_tables.sql` line 68 writes ``UNIQUE KEY `db_name` (`db_name`,`table_name`)`` — a
REAL index named after one of its own columns — so "a `constant` whose name equals a column name" flags
a true declaration. The oracle asks whether a NAMED constraint sits on the symbol's own line and clears
those 4 on both runs. The fix is **order**, read off the grammar: MySQL's index name PRECEDES
`ordered_columns`, the foreign key's referenced columns FOLLOW it.

Two errors in the probe itself are recorded in its header rather than in its results, because both
first read as clean results. It keyed on `symbol.metadata.type === "constraint"` and found **ZERO**
phantoms — `pool-worker.ts` forwards a WHITELIST of symbol metadata keys and the list is CSS-only plus
markdown-only, so every `metadata.type` this analyzer writes is dropped before a consumer sees it; and
the oracle compared the tree's raw `` `db_name` `` against a symbol named `db_name`.

### DEFECT 2 — a `contains` target naming two declarations, and the graph cannot choose

`src/lsp/impact.ts` obtains its reverse edges by scanning outgoing edges and matching targets. A
`contains` edge names its member by BARE NAME, and SQL makes bare-name collisions ordinary:

| Match rule | Unique | Ambiguous | Share unique |
| --- | --- | --- | --- |
| bare name alone, corpus-wide | 10,649 | 842 | 92.7 % |
| (name, `ownerName`), within the edge's own file | 11,436 | 55 | 99.52 % |
| + the edge's `metadata.memberKind` | **11,444** | **47** | **99.59 %** |

`ownerName` was **already on the member symbol**, so most of that is a consumer rule and not a schema
change — the single highest-value fact this round produced for anyone walking the graph. The last 47
needed the member's KIND on the edge, and that key had to join the dedup KEY too: two members of one
name under one owner are two true facts, and a `(type, source, target)` key was silently deleting the
index's containment edge. Carrying `memberKind` in the payload alone would have been worse — the
surviving edge's key would still claim to be the only fact about that name.

A regression I introduced and caught with the fixture: adding `memberKind` to `createSymbol` but not to
the explicit call sites made every ordinary containment edge store **TWICE**. Pinned by an
`equals: 1` row.

Cross-file, `ownerName` alone is not enough — 4,980 unique / 6,511 ambiguous, median 2 matches at
pass 3, and **5,463 unique / 6,513 ambiguous, median 2 at this HEAD** — because a migrations corpus
declares `users(id)` in many files. **The file is the disambiguator a cross-file
consumer needs, and `bb_impact`'s target-matching does not currently use it.** §8.

### DEFECT 3 — `processDo` was UNREACHABLE DEAD CODE

Its only caller sat in `dispatchDeclaration`, which runs for `DECLARATION_NODES` only, and
`do_statement` is not a declaration — it declares nothing. The method exists, its body is three real
calls, and a source-derivation count of "which types can this analyzer construct" would have counted
`calls` from a `DO` block as constructible. Measured on single statements, not inferred:

| Input | Before | After |
| --- | --- | --- |
| `DO $p$ BEGIN PERFORM f(1); END $p$;` | no `calls` edge | `calls global->f` |
| `DO $p$ BEGIN PERFORM g('x', (SELECT public.h(1))); END $p$;` | nothing | `calls global->g`, `calls global->h` |
| `DO $p$ BEGIN SELECT id FROM t; END $p$;` | `uses` from the sweep, **no `Anonymous Procedural Block` pattern** | both, plus the pattern |

The second row is the shape that hid half of it: the `SELECT` inside a `PERFORM` argument is a `select`
EXPRESSION, not a `statement`, so the declaration sweep's nested-statement re-entry never reached it
either. That is `proxicall/database/verify_m95_3043_coms_rls_hardening.sql` lines 395–402.

### DEFECT 4 — `ALTER TABLE … SET DEFAULT` never read its expression slot

`ALTER TABLE t ALTER COLUMN c SET DEFAULT app.f()` puts an `invocation` in a grammar-mandated slot and
produced no edge: `alter_table` is neither a query nor a declaration, and `processAlterTable` returns
early when the statement adds no column — exactly this shape. 8 of the 14 reachable misses.
`hasura-engine/server/src-rsr/migrations/41_to_42.sql` writes `SET DEFAULT hdb_catalog.gen_hasura_uuid()`
five times in one file. Sourced to the **altered table** rather than to `global`, because a table is a
published symbol and `global` is not.

### What is STILL wrong after all of this, as numbers

| Residual | Count | Files | Why it is not fixed here |
| --- | --- | --- | --- |
| qualified invocations inside an error subtree | **107** | — | a grammar bound, not a lane defect: when error recovery swallows an expression the callee never becomes an `invocation` node. Needs a grammar change |
| qualified invocations inside a `plpgsql_block` / `function_body` | **5** | — | same class |
| qualified invocations in a reachable shape, not emitted | **0** | 0 | was 14 at pass 2; both dispatch gaps are closed |
| `uses` edges from inside an error-bearing CTE | **91** | 56 | limitation 12: the WITH list is inside an ERROR node, so its names never become `cte` nodes and no scope rule can recover them |
| `uses` edges targeting a CTE name with no qualified reach | **19** | 11 | the row above |
| `uses` edges whose bare leaf is ambiguous between a CTE and a qualified table | **16** | 16 | limitation 8's shape: a (type, source, target) key cannot represent two objects with one leaf |
| `contains` edges ambiguous even with (name, owner, memberKind) | **47** | — | 37 are two `property` symbols of one name under one owner (a column re-declared by `ALTER TABLE ADD COLUMN`) and 10 are two `constant`s. A per-file analyzer cannot merge them without deciding the column is declared twice |
| symbols whose name is in the analyzer's own `SQL_KEYWORDS` | **46** | — | 11 are `ALTER TABLE ADD CONSTRAINT` keywords read as column names (`key` 5, `KEY` 1, `PRIMARY` 3, `primary` 2); the other 35 are legal identifiers the measure cannot separate from keywords without checking the source spelling (`comment` 25, `filter`, `start`, `end`). `RESERVED_AS_COLUMN_NAME` holds two words, which is a record of two encounters and not a list. §8 |
| `calls` self-loops that mean "trigger X runs function X" | **441** | — | PostgreSQL's convention names a trigger after its function, and the analyzer gives both `kind: function`, so `calls X -> X` here is not recursion. The edge is not fabricated and it already carries `metadata.triggerAction`; the 7 self-loops WITHOUT that flag are real recursion (`new_code := generate_session_code()`), which is the control case. 171 distinct names carry both. §8 |
| `contains` edges naming a symbol `keepSymbol` deletes | **1** | 1 | SQL-G13, shared machinery, filed |
| `calls` edges at confidence 1 whose evidence tier is `usage_contextual` | **3,417** | — | not a defect: that is the honest label for a name in a bare slot, and it is countable per edge |

## PASS 4 — the walk was the bottleneck, and the corpus count was bimodal because of it (2026-10-04)

Pass 1 measured whether each type fires. Pass 2 assumed each label was wrong. Pass 3 asked the
question from the other end. **Pass 4 assumed the lane's own NUMBERS were wrong, and they were.**

### The total was bimodal, and the cause was this analyzer

Pass 3 reported 31,037 relationships and 1,952 of 1,955 files, and recorded that the corpus numbers
did not reproduce. Pass 4 pinned it to one file and then to one number:

| `postgrest/test/io/fixtures/big_schema.sql`, solo, fresh process | ms | result |
| --- | --- | --- |
| run 1 | **116,589** | 943 symbols, 1,874 relationships, `analysisVersion: "m10.06-cut"` |
| run 2 | 123,743 | 0 symbols, 0 relationships, `"2.0-basic-fallback"` |
| run 3 | 127,059 | 0 symbols, 0 relationships, `"2.0-basic-fallback"` |

**3.4 seconds of headroom against a 120-second budget.** Which side it landed on decided the lane's
headline: `31,037 − 1,874 = 29,163`, and 29,163 is exactly what the same corpus measures when the
file times out. Pass 3 had attributed this to files crossing the engine's budget and stopped there.
The budget was real; the cost was not.

### `node --cpu-prof`: 87 % of the run was one helper

| | |
| --- | --- |
| `walkDescendants` self time | **133.97 s of 154 s (87.0 %)** |
| `ts_parser_parse_wasm` (the actual parse) | **0.33 s** |
| nodes in the file | 67,508 named, depth 43, 392 KB |
| `descendants` calls → distinct (node, type) queries | 29,662 → **4,199** |
| nodes those 4,199 walks visited | **99,159,647** — 1,469 per node in the file |

The grammar was never the problem. `descendants(node, type)` was a full preorder subtree walk, and
the queries sit near the root, so each one rescanned a near-root subtree. `firstDescendant` and
`containsType` made it worse by materialising the **entire** match list to read its first element
or its length.

### Two things had to be MEASURED before the fix could be written

**1. Node object identity does not exist.** web-tree-sitter's `unmarshalNode` ends in
`new Node(...)`, so every property access returns a fresh wrapper. Verified directly on the wired
wasm (`descendants-equivalence.mts`'s sibling probe, since removed):

```
rootNode === rootNode                          false
namedChild(0) === namedChild(0)                false
rootNode.tree === rootNode.tree                true
namedChild(0).id === namedChild(0).id          true
```

A `WeakMap<Node, …>` cache therefore misses on nearly every lookup. A first attempt did exactly
that: it removed **85 % of the CALLS and none of the COST**, and an index keyed the same way
rebuilt itself **200+ times for a single tree** because the root handle it keyed on was a new
object each time. `Node.id` is documented as unique within a tree and `Node.tree` is the tree it
belongs to, and both are plain fields — so `(node.tree, node.id)` is the key.

**2. There is more than one tree per parse.** `runResync` re-parses each top-level statement into
its OWN tree and feeds those nodes back through `processRoot`, so "the" tree is not a field anyone
can set. `node.tree` is what says which tree a query belongs to.

### The fix

`descendants(node, type)` is now a binary search over a document-order per-type run plus an
interval test; `namedChildren` is a map lookup; `firstDescendant`/`containsType` stop at the first
match. One preorder walk per tree builds it, touching each node once with the minimum number of
accesses, and the children it reads are kept.

| File | Before | After |
| --- | --- | --- |
| `postgrest/test/io/fixtures/big_schema.sql` | 116,589–156,694 ms, **usually 0 symbols / 0 relationships** | **3,551 ms, 943 symbols, 1,874 relationships** |
| `postgrest/test/spec/fixtures/schema.sql` | 5,307 ms | **1,612 ms** |
| `postgrest/test/io/fixtures/schema.sql` | 5,323 ms | **1,238 ms** |
| `proxicall/database/schema.sql` (516 KB) | 2,832 ms | 2,807 ms — it was never slow |

33× on the file that decided the headline, and **the same 943 symbols and 1,874 relationships**
on the runs that finish inside the budget — the optimization changed the cost, not the answer.

### The optimization is CHECKED, not trusted

`validation/m14/fixtures/sql/descendants-equivalence.mts` compares the index against a preorder
walk written out in that file, for every node against every type the grammar produces, comparing
**sequence** and not just count:

> **1,955 files, 7,807 nodes, 454 types, 2,624,148 queries, 0 mismatches — exact on every one.**

It earned its keep before the fix was finished. A byte-interval test alone **cannot** separate a
DESCENDANT from an ANCESTOR that opens on the same byte: `statement` wrapping `insert` with no
token between them shares a start index, and with nothing at the end shares the end too. That was
**1,432 queries across 1,955 files** reading 1 where the walk read 0 — and on `object_reference`
(337 sampled), `relation` (117) and `literal` (46), **all of which the analyzer queries at 14, 1
and 3 sites**. Not a latent bug: it would have shipped wrong `references`, `uses` and
`instantiates` edges. Depth closes it.

The oracle's own first version was wrong too, and that is recorded in its header rather than
quietly dropped: it compared `findDescendant` against a plain walk and reported **7,807
disagreements — exactly one per node tested**, every one of them the documented self-match rule
(`findDescendant(node, type)` returns `node` itself when `node.type === type`) and none of them a
defect. The rule now lives in the oracle as `expectedFirst`.

### `imports` reads 0 on a 120-file sample and 52 on the corpus

The 26-lane sweep at `validation/m14/measurements/firing-sweep-26-lanes.ndjson` records this lane
as `imports: 0 edges / 0 files` over `120/120` files. That is a sampling artefact, not a verdict:
the 52 edges live in **25 files** out of 1,955, and a 120-file sample that reports `files: 1` for
`calls` (167 edges) has not covered the corpus. The brief's own reading applies — a type that did
not fire on a sample is **unadjudicated**, not inapplicable.

### The arbiter, run over the whole corpus

`script/m14/ontology-coverage-gate.ts` in one process over 1,955 files does not finish: it prints
its header and corpus size and then dies on `[BB-HANG] parser stuck 120s`. `run-sharded-arbiter.mts`
applies the bound that works — 8 shards of whole repos, the arbiter's own admission rule for the
split, the patched copy run per shard, and the arbiter's own precedence for the merge. Result, all
8 shards answering all ten rows: **emitted 7/10, ruled-sound 3, FALSIFIED 0,
ruled-without-justification 0**. Re-run at pass 5's HEAD over the same 1,955 files, the per-type
edge counts came back identical to the census — 3,892 / 9,106 / 11,977 / 52 / 5,996 / 22 / 21 — so
the arbiter and the census agree on every emitted type at this HEAD, not only on the verdicts.

`arbiter-vs-shard.mts` then diffed the two process shapes **per file**: **11 of 1,955 files
differ, and every one carries an explicit fallback marker on exactly the side that read lower** —
8 `analysisVersion: "2.0-basic-fallback"` instances (the engine's timeout load policy, all at
167,176–168,379 ms) and 3 `fallback: true` instances (the pool-worker's regex extractor). There is
no unexplained residual.

### The ruling table audits its own falsifiability

`script/m14/sql-ruled.ts` (moved from `script/m60/`, because the arbiter prints
`Written ruling: script/m14/sql-ruled.ts` and that path did not exist) adds
`SQL_RULING_FALSIFIABILITY`, applying the brief's test — *could an implementation that is right and
has no gaps left meet this condition?* — to each entry:

| Type | Kind | A correct implementation could meet it? |
| --- | --- | --- |
| `extends` | grammar + implementation | **yes — and this is the finding** |
| `implements` | grammar + implementation | yes, with no counter-example |
| `exports` | corpus only | **no**, and it is labelled the weakest of the three rather than presented as falsifiable |

**`extends` is a GRAMMAR GAP, not an inapplicability, and saying otherwise was wrong.** SQL has
table inheritance — `CREATE TABLE c (…) INHERITS (p)`, and since PostgreSQL 11
`CREATE TABLE c PARTITION OF p …` and `ALTER TABLE p ATTACH PARTITION c …`, which make a child a
subtype of a parent with no `INHERITS` clause at all. All three were **parsed** against the wired
wasm and all three put the parent clause inside an `ERROR`. A correct implementation meets the
condition by patching the grammar to parse the clause and emitting the edge — and this lane has
already rebuilt the grammar eight times to add rule groups. It is not shipped here because the
grammar build and `validation/m14/grammar-pins.json` are shared artefacts (§8), and a rebuild
attempt has already produced a `parser.c` 111,557 bytes off the wired one. Reported, not done
quietly.

## PASS 6 — the denominator no instrument on the page was producing (2026-10-04)

Pass 5 re-measured the incoming direction. Pass 6 re-ran every gate this lane can run at HEAD
`f918e9055` — 16 commits after pass 4's census — and read the page against what the gates printed.
**The per-type numbers all reproduced. One number about the CORPUS did not, and nothing on the page
could have caught it.**

### The corpus denominator was wrong, and the arbiter had been printing the right one

The page said, in two places, that the census covered "1,955 of 1,955 admitted SQL files in **169
corpus repositories**". The arbiter's own walk prints, from the same corpus root and the same
admission rule:

```
admitted: 1955 SQL files in 16 repositories
```

169 was wrong and 16 is measured. The reason it survived four passes is structural rather than
careless: **every instrument on this page counts files and edges, and none of them counted
repositories.** A per-type census cannot produce a repository count, so there was nothing to
disagree with 169 — it was a free-floating figure with no instrument behind it, and the arbiter's
own `16` sat in a different document from the page that contradicted it.

`corpus-composition.mts` now produces the denominator, under the admission rule **copied** from
`script/m14/ontology-coverage-gate.ts:203-208` (`git ls-files`, ≤ 512 KiB,
`detectLanguageFromPath === "sql"`) — copied because the population a ruling is measured over is
the population the arbiter admits, and a second rule would make the two differ by an unknown
amount. `script/m14/` is supervisor-owned (§8).

| Figure | Value |
| --- | --- |
| repository directories in the corpus root | **183** |
| with at least one tracked `.sql` path | **17** |
| contributing ≥ 1 **admitted** file | **16** |
| tracked `.sql` paths | **1,963** |
| admitted under the arbiter's rule | **1,955** — agrees with the arbiter exactly |
| excluded | **8**: 7 over the 512 KB cap in `hasura-engine`, 1 in `kong` |

`git ls-files '*.sql'` is deliberately not the instrument: it reads 1,963 against the arbiter's
1,955, and the 8-file difference IS the cap and the detection, which is the thing worth measuring.

**The corpus root contains a repo reached through a SYMLINK out of it** — `proxicall ->
$HOME/ProxiCall` — and it supplies **438 of the 1,955 admitted files (22.4 %)**. Every
figure on this page therefore depends on a path outside the corpus root, and `bb_index`-style
realpath containment checks would refuse it. `run-sharded-arbiter.mts` builds each shard as a
directory of symlinks for the same reason and reads them fine.

**That symlink cost this script a wrong first answer, and the failure is worth recording because it
was invisible in the rows and visible only in the total.** The first version filtered the corpus
root with `readdirSync(..., { withFileTypes: true }).isDirectory()`, which reports a symlink as
`isSymbolicLink()`, so `proxicall` was skipped entirely: 181 repos walked, **1,517** admitted — and
`1,955 − 1,517 = 438`, exactly the missing repository. The per-repo table would have read as a
finished answer with a repo absent from it; only the disagreement with the arbiter's 1,955 named
it. Fixed to `statSync(dir).isDirectory()`, which follows the link.

### Every gate this lane can run, re-run at `f918e9055`

| Gate | Command | Result at this HEAD |
| --- | --- | --- |
| ontology arbiter, whole corpus, 8 repo-shards | `npx tsx validation/m14/fixtures/sql/run-sharded-arbiter.mts` | **`emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0`**, 8/8 shards answering all ten rows, and per-type edges **identical to the pass-4 census**: 3,892 / 9,106 / 11,977 / 52 / 5,996 / 22 / 21 |
| arbiter on a COPY with the ruling table patched in | `npx tsx validation/m14/fixtures/sql/run-ruling-table.mts` | same verdict line. Single process, so it dies on `[BB-HANG] parser stuck 120s` on `duckdb/benchmark/aoc24/queries/day02.sql` partway through and its partial per-type counts read 3,875 / 9,100 / 11,873 / 51 / 5,951 — the sharded run is the authoritative one, and this is the known `engine.ts` `process.exit(1)` behaviour (§8) |
| fixture lane | `npx tsx script/m14/run-fixtures.ts --lang sql` | **15 / 15 PASS, exit 0**. Unscoped, the same script **exits 6 before running any lane** because `lua` and `r` have fixture directories no runner lane claims — other lanes' defect, not this one's (§8) |
| ontology mutants | `bun run script/m14/mutate-analyzer.ts sql` | **34 / 34 `sql/*` mutants CAUGHT, 0 `sql/*` SURVIVED**. The script's 6 survivors are `java` ×1, `groovy` ×2, `scala`, `make`, `php` — other lanes. **It does not honour the language argument**: it sweeps every lane and **rewrites the shared `validation/m14/results/M14.0.F4.json`**, changing 22,627 lines of other lanes' rows as a side effect of running this lane's gate. That file is §8-owned, so this lane restores it (`git restore`) and does not commit the rewrite. Running this command as the workstream instructions direct is therefore not lane-scoped and mutates a shared artifact (§8 item) |
| regex census | `npx tsx script/m12/verify-regex-census.ts` | **0 SQL rows.** The gate FAILS on `MISSING` rows for `real-css-analyzer.ts` (9) and `real-julia-analyzer.ts` (5) and `STALE` rows for clean, fsharp, javascript, python, svelte, typescript. This lane contributes 0 rows to that failure |
| m14 differential | `npx tsx script/m14/differential.ts --lang sql` | **`SKIP sql: no corpus repo mapped in LANG_REPOS and none checked out — declared unrun, not measured`**, and 0 lanes measured. `script/m14/differential.ts` is shared machinery (§8): `sql` needs an entry in its `LANG_REPOS`, and the m12 hand-audited oracle (`validation/m12/ground-truth/sql.json`, 84 facts) is the lane's correctness instrument instead |
| corpus composition | `npx tsx validation/m14/fixtures/sql/corpus-composition.mts` | 183 / 17 / 16 / 1,963 / **1,955**, agreeing with the arbiter |

**So the page's seven emitted counts and three rulings reproduce at a HEAD 16 commits later, and the
one figure that did not is now measured rather than asserted.** No verdict moved. Nothing on this
lane is un-adjudicated: all ten types carry EMITTED or a corpus-measured RULED.

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

**ONE regex remains in the analyzer, and an earlier revision of this section claimed zero. That
claim was false and is withdrawn.** The survivor is `POSTGRES_CATALOG = /^pg_[a-z_]+$/` at
`src/ast/real-sql-analyzer.ts:167`, used once at :189 to answer "is this target in PostgreSQL's
system-catalog namespace", on a name already extracted from the parse tree.

It is kept rather than converted, and the reason is that the rule's rationale does not reach it:
`reviews/regex-policy.md`'s objection is that a regex over SOURCE TEXT matches comments and string
literals, misses nested syntax, and breaks on the next grammar version. This pattern is applied to
a single lowercased identifier that came out of a grammar-mandated slot, it is anchored at both
ends, and it tests a naming convention PostgreSQL itself guarantees for catalog objects. Replacing
it with a `Set` would mean enumerating every `pg_*` name in the catalogue, which replaces a
specification with a snapshot of one release. **That is a judgement and it is stated rather than
assumed** — and it is registered here rather than left for the next reader to discover as a
discrepancy, which is how this sentence came to be wrong in the first place. `script/m12/verify-regex-census.ts`
reports **0 SQL entries**, so the gate does not see it; that is a gap in the gate's coverage of
this lane rather than a clean bill, and it is a §8 item.

**Pass 3 extended the zero-regex property to this lane's census scripts and probes, which is where
the remaining ones were.** The gate's own scan covers `src/ast/real-*-analyzer.ts`, so it reported no SQL
finding while the lane's PROBES still carried nine regexes — seven in `adversarial-probe.mts`,
deciding the A12 capability battery by matching REGEXES over a rendered `rootNode.toString()`
dump. That is the instrument the ontology gate's header rejects, and it had already produced
one wrong verdict here. All seven are gone: the battery now reads node types, named children and
fields, and the rendered shape is kept as recorded evidence rather than as the instrument.
`run-ruling-table.mts` retains **two**, both applied to the ARBITER'S OWN TYPESCRIPT SOURCE to
rewrite its import specifiers — a code-patching operation on JS/TS, not an analysis of SQL, where
the rule's rationale (regex over source text matches comments and string literals) does not
apply. That is a judgement and it is stated rather than assumed.
`reviews/regex-policy.md` requires zero by default; the census
(`validation/m12/results/regex-census.json`) had never recorded SQL at all, so the two regexes
this lane introduced were unregistered and `script/m12/verify-regex-census.ts` reported them
`PENDING` while passing silently on the drift. Both were replaced with character scans — a
dollar-quote tag reader and a `CONSTRAINT` prefix reader — and equivalence was proven over
**3,406,758 dollar positions** across the corpus plus adversarial input, 0 mismatches. The
EXECUTE-literal scanner is a character state machine for the same reason. The census gate still
FAILS, on **other lanes**: CSS, Julia, Clean, F#, JavaScript, Python, Svelte and TypeScript, with
`MISSING` and `STALE` rows for each. This lane contributes **0 rows** to that failure.

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
grammar's own vocabulary (480 node types) rather than agreeing about it.


## Gates

Every row was re-run at pass 3's HEAD unless the row says otherwise, and the reason it was not
is part of the row.

| Gate | Result | Self-test |
| --- | --- | --- |
| `tsc --noEmit` | clean | — |
| M14 fixture lane (`script/m14/run-fixtures.ts --lang sql`) | **15 / 15** (`sqld15` is new) | 6 of `sqld15`'s sections are forbid-side or negative, and **reverting the analyzer makes it fail with 6 named problems** — verified, not asserted |
| SQL ontology mutants (`script/m60/run-sql-ontology-mutants.ts`) | **21 / 21 caught** (5 new) | exits 2 on a survivor. One of the five **survived its first run** because its transform scanned the fixture text for `DO $` and matched the fixture's own prose; that is recorded in the mutant's description rather than quietly fixed |
| m12 differential (`script/m12/verify-analyzer.ts sql`) | **84 facts, P = R = 1.000, 0 FP, 0 FN, `earliestFailingLayer=none`, `parseErrors=0`** | the FP that made this 0.988 was a real fabrication; see *Differential ground truth* |
| ontology census (`validation/m14/fixtures/sql/ontology-census.mts`, 8 shards + merge) | **1,955 of 1,955 admitted parsed, 0 parse failures, 0 degraded by timeout, 0 in regex fallback, 0 empty names, 0 `unknown` endpoints, 31,066 relationships / 18,482 symbols** | nothing is unmeasured and nothing is degraded, so there is no `filesWithNoShardRow` to name; the same figure comes out of a 4-shard walk (`pass4-census-4shard.json`) |
| **two independent walks, different partitioning, same HEAD** | **8 strided shards and 4 contiguous shards each measure 1,955 / 1,955 files, 18,482 symbols and 31,066 relationships, with identical per-type totals, resolution rates and `evidenceClass` splits** | this is the row pass 2 could not fill and pass 3 could not either; it is why the census is sharded and merged from shard rows. `measurements/pass4-census.json` and `measurements/pass4-census-4shard.json` |
| incoming probe (`validation/m14/fixtures/sql/pass3-incoming.mts`) | re-run at this HEAD over 1,955 files: 31,066 edges, 0 parse failures, 0 degraded. `contains` resolves **99.54 %** intra-file by (name, `ownerName`), **99.61 %** with `metadata.memberKind`, against **92.71 %** on the bare name corpus-wide, and **45.62 %** on (name, `ownerName`) corpus-wide | reads only fields that SURVIVE production `parseFile` — see DEFECT 1's note on the metadata whitelist. Artifact `measurements/pass5-incoming-corpus.json` |
| invocation-cause probe (`pass3-invocation-why.mts`) | re-run at this HEAD: **742 qualified invocations on the tree → 629 emitted, 53 guard-suppressed, 60 inside an error subtree, 0 unexplained**; 629 + 53 + 60 = 742, so the decomposition is closed. 0 files degraded | closes pass 2's open item. Its population is LARGER than the adversarial probe's A3 by 46, because A3 excludes error-bearing invocations from its population — see the cross-probe note under *`calls` residual* |
| phantom-constraint probe (`pass3-phantom-constraint.mts`) | **53 phantoms in 22 files → 0**, same oracle both sides, which also clears 4 legitimate same-name indexes | a parse-tree oracle, because the name heuristic cannot decide it |
| adversarial probe (`validation/m14/fixtures/sql/adversarial-probe.mts`) | re-run at this HEAD over all 1,955 files, 23 probe populations: **628 qualified invocations emitted**, 52 guard-suppressed, 16 unexplained by this probe's population, **3,892 of 3,892** `calls` tiers and **9,106 of 9,106** `uses` tiers AGREE, A12's 6 verdicts read off node types and fields | **0 files degraded at this HEAD**, against 1 engine-timeout and 6 regex-fallback files at pass 3 — the pass-4 optimization is what removed them. The 16 is not a defect: see the cross-probe note under *`calls` residual* |
| `overrides` reconciliation (`validation/m14/fixtures/sql/overrides-reconciliation.mts`) | **34 events → 22 per-file edge keys = production's 22 exactly**; the probe's rule reproduces its committed **15**, and the 19-edge difference is **12 multiplicity + 7 visit order = 19, exact**. The probe's 48-char text read of `OR REPLACE` and the analyzer's `keyword_replace` node read disagree on **0 of 4,645 declarations** | closes limitation 14. Its own first version joined pass 2 to pass 1 on line number and produced visit indices of 48 and 216 for a group of two declarations; the fix keys on `startIndex` and that failure is recorded in its header |
| construct probe (`validation/m14/fixtures/sql/construct-probe.mts`) | **480 distinct node types**, 0 parse failures, **every zero probe 0**, and no node type anywhere contains `export`/`module`/`provide` | `exports-keyword` was 1 and is now 0: the 1 was a COLUMN named `module`, and the old probe counted declaration names |
| ruling table (`validation/m14/fixtures/sql/run-ruling-table.mts`) and the 8-shard arbiter (`run-sharded-arbiter.mts`) | **re-run at this HEAD: `emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0`, with 8/8 shards answering all ten rows** and per-type edge counts identical to the census (3,892 / 9,106 / 11,977 / 52 / 5,996 / 22 / 21) | the arbiter on disk is untouched; the copy is written under `node_modules/` and removed. Its patch anchor was **stale** and exited 2 until pass 3 re-anchored it on the declaration rather than the literal. Its printed node-type count is wrong — see *Instrument A's denominator* |
| `keepSymbol` census | re-measured at this HEAD: **18,485 symbols emitted by `analyze()` over 1,955 files, 3 refused (0.016 %)** — 2 `function:root`, 1 `property:program` — and **18,485 − 3 = 18,482, exactly the symbol count production `parseFile` publishes**, so `keepSymbol` accounts for the whole analyzer-to-index difference. SQL-G13, filed not fixed | this is the row that settles limitation 19. The pass-3 incoming probe's `0` was not a competing measurement: it reads `parseFile` output, which is already filtered, so a drop is structurally unobservable there. Artifact `measurements/pass5-keep-symbol-census.json` |
| contract battery (`fixtures/sql/probe/contract-battery.mts`) | **not runnable on this machine** — the directory does not exist here; the recorded 54 / 54 is from 2026-09-27 and is **unverified by this round** | — |
| node-type gate (`script/m12/sql-node-types-compare.ts`) | **not re-run by this round**, for pass 1's reason: re-running it without `fixtures/sql/probe/dialects` lowers its own observation surface from 6 probe files to 0 and would re-baseline a shared artifact downward | — |
| resync corpus gate | not re-run — `fixtures/sql` is absent from this machine | impossible bars → **exit 1** |
| pin contract | **does NOT validate** — `validation/m14/grammar-pins.json` records the pre-V11 sha for `sql`, so `bun run script/m14/verify-grammar-pins.ts` reports a drifted sha | unchanged from pass 1/2 and still a §8 item; every figure on this page is measured against the wired bytes directly |
| regex census | no sql finding. Pass 3 separately removed the lane's last **probe** regexes (seven) and states why two remain in `run-ruling-table.mts` | — |
| perf gate (`script/m60/sql-perf-gate.ts`, `verify:m60-sql-perf`) | not re-run this round | bars are a regression detector, not a benchmark |
| honesty gate (`script/m14/verify-honesty.ts`) | run at pass 3; see the report for its verdict | it lints `docs/`, `plans/`, `validation/m14/` for the banned vocabulary |

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
reports **256** distinct node types where this lane's own walker measures **480**, and that
difference is not a rounding of anything — see *Instrument A's denominator, measured three ways*.
The first difference survives and is accounted: Pass 1 recorded the same 5-edge difference in the
other direction and it is a property of the `uses` exclusion, not a disagreement.

### Instrument A's denominator, measured three ways — and the arbiter's number is not one of them

Instrument A is a vocabulary count, and a ruling that says "the grammar has no node expressing X"
rests entirely on how that vocabulary was collected. Three walkers over the same 1,955 admitted
files, all at this HEAD:

| Walker | Counts | Distinct node types |
| --- | --- | --- |
| `construct-probe.mts` (this lane's instrument A) | every node the walk reaches | **480** |
| a 20-line independent walker written for this check, sharing no code with either | every node | **480** — exact agreement |
| the same, filtered to `isNamed` | named nodes only | **454** |
| `descendants-equivalence.mts` | named nodes only | **454** — consistent, and it is why the equivalence figure reads "454 types" |
| **the sharded arbiter** | — | **256** |

**480 is right for the vocabulary, and the rulings rest on it.** All 480 names were searched for
`export`, `module` and `provide` as substrings: **0 hits for all three**, which is the whole basis
of the `exports` ruling. The 454/480 gap is exactly the anonymous-token set — 26 token types such as
`keyword_create` — and it is worth naming because a vocabulary that excludes anonymous tokens would
have missed `keyword_module` had the grammar had one, so the larger figure is the correct one for a
ruling and the smaller is the right one for a query planner.

**The arbiter's 256 is not a measurement of its shard's walk, and the reason is checkable in one
step: it reports the SAME 256 in all 8 shards, whose file counts range from 19 to 594.** A
vocabulary collected by walking a shard's own files cannot be identical across eight different file
sets. So the number the arbiter prints in `the grammar produced ${grammarNodeTypes.size} distinct
node types across the corpus` does not describe that corpus. This does not overturn a verdict: a
vocabulary that omits 224 types can only weaken a ruling if one of the omitted 224 expresses the
construct, and the 480-walker confirms none of them contains `export`, `module` or `provide`. But the
figure should not be quoted, and `script/m14/ontology-coverage-gate.ts` is supervisor-owned, so it
is reported rather than touched. §8.

**The arbiter's citations are wrong, and the mechanism is recorded rather than worked around.**
`rulingFor` matches a type by PROSE — the first RULED decision whose `resolution` mentions the
type name — so it cites `SQL-D11` for `exports` (which is about `imports`), `SQL-D16` for
`extends` and `SQL-D13` for `implements` (which is about `instantiates`). The VERDICT is
decided by the instrument and is unaffected; only the pointer is wrong. The fix is specified in
`script/m14/sql-ruled.ts` → `SQL_RULING_CITATIONS`: an optional `ontologyType` field on
each decision, with the prose match as the fallback, plus splitting `SQL-D16` into two entries
because it covers two types. §8 item.

### Reproducibility — measured at pass 4, and it now holds

**At pass 4 the corpus measurement reproduces, which it did not at any earlier pass.** Two walks
of the same 1,955-file corpus at the same HEAD with DIFFERENT partitioning — **8 strided shards**
and **4 contiguous shards** — produce identical merged totals for all seven emitted types,
identical per-type resolution rates and identical `evidenceClass` splits:

| Walk | Files measured | Degraded by timeout | Regex fallback | Symbols | Relationships |
| --- | --- | --- | --- | --- | --- |
| 8 strided shards | 1,955 / 1,955 | 0 | 0 | 18,482 | **31,066** |
| 4 contiguous shards | 1,955 / 1,955 | 0 | 0 | 18,482 | **31,066** |

(`measurements/pass4-census.json`, `measurements/pass4-census-4shard.json`.) The per-SHARD rows do
differ — `big_schema.sql` is 1,874 relationships and lands in whichever shard owns it — which is
exactly why the merge is a separate pass over shard rows rather than an in-process sum. The number
is now a property of the corpus and not of the slicing.

**What changed to make it hold is a defect fix, not a better procedure.** Pass 3 recorded the
total as bimodal and attributed the instability to files crossing `engine.ts`'s 120 s analyzer
timeout. `postgrest/test/io/fixtures/big_schema.sql` measured **116,589 ms in 1 of 3 solo runs and
123,743 / 127,059 ms in the other two** — 3.4 seconds of headroom against a 120-second budget —
so which side of the budget it landed on decided whether the lane read 31,037 or 29,163, and
`31,037 − 1,874 = 29,163` exactly. Pass 4 found the cause was **this analyzer's own walk**, and
fixed it. See *PASS 4*. With `big_schema.sql` at 3,551 ms, **0 files degrade** instead of 4–8.

**What still does not reproduce, and is not claimed to.** The `[BB-HANG]` wasm fault is a property
of the ENGINE's budget on a loaded machine, not of any file, and it is still live: pass 4 was
killed by `duckdb/extension/tpcds/dsdgen/queries/90.sql` on one run and by
`duckdb/benchmark/aoc24/queries/day03.sql` on another, **two different files on two runs of the
same code**. The machine has 8 cores, 15 GB of RAM and 11 GB of it in use by the other lanes, and a
758-byte file (`postgrest/test/pgbench/1567/old.sql`) that parses solo in **650–1,062 ms** took
**167,184 ms** under 8-way contention — a factor of 190 that is load, not code. So a single
long `parseFile` walk is still not a reproducible instrument on this box, which is why the census,
the arbiter run and the equivalence probe are all sharded, and why `engine.ts` answering a parse
fault with `process.exit(1)` remains a §8 item: it makes every instrument built on the production
entry point all-or-nothing.

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
- **SQL-G15 — `overrides` emits 22 edges from 34 replacement events. THE 777 AND THE 755 ARE
  WITHDRAWN AS UNMEASURED, and the cross-file claim is falsified.** This item previously read "777
  `OR REPLACE` declarations exist … the other 755 replace a declaration made in another file …
  the number that could be recovered is therefore 755". Measured at pass 5 over all 1,955 admitted
  files and 4,645 declarations, with the analyzer's own rule applied to a corpus-wide declaration
  list per `kind:name`:

  | | Count |
  | --- | --- |
  | redeclared `kind:name` groups | **178** |
  | groups carrying at least one replacement event | **22** |
  | groups carrying none (duplicate or re-creation, no `OR REPLACE`) | **156** |
  | replacement events, per file | **34** |
  | replacement events, corpus-wide | **34** |

  Per-file and corpus-wide are the SAME number, so **every same-name re-declaration in the admitted
  corpus is intra-file and there are no cross-file replacements to recover.** The 755 was wrong, and
  the mechanism that made it plausible — PostgreSQL's extension corpus shipping one file per
  version with the same function in every version — contributes nothing here, because the extension
  corpus at `/usr/share/postgresql/14/extension` is not in the git-tracked corpus this lane admits.
  What remains true and is the reason this is filed at all: 34 events become 22 edges because the
  edge key is `(type, source, target)` with source `global`, so the replacement CHAIN of a name
  declared 6 times is unreconstructable from the graph even though both line numbers survive.
- **SQL-G16 — 91 `uses` edges from inside an error-bearing CTE.** See limitation 12: the WITH
  list is inside an ERROR node, so its names never become `cte` nodes and no scope rule can
  recover them. Needs a grammar change. Not filed as a shared item because the grammar is this
  lane's own build.
- **SQL-G13, extended — shared machinery deletes a symbol an edge still names.**
  `keepSymbol`'s `UNIVERSAL` denylist in `src/ast/pool-worker.ts` holds `program`, the grammar's
  ROOT node type, beside `root`, `module_declaration` and `source_file`. `program` is also a
  legal SQL column name, so a real symbol is deleted and the `contains` edge naming it survives:
  **1 edge** in `boundary/internal/db/schema/migrations/oss/postgres/71/11_session_recording.up.sql`.
  Re-measured at pass 5: **18,485 symbols emitted, 3 dropped (0.016 %)**, and `18,485 − 3 = 18,482`
  is exactly what production `parseFile` publishes. **§8**: `UNIVERSAL` needs a
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

### Added by pass 3 (2026-10-03)

Full measurements are in *PASS 3* above. These are the items that need a file this lane does not own,
each specified so it can be applied without re-deriving it.

- **`engine.ts` must stop answering a wasm parse fault with `process.exit(1)` (SQL-G17, extended
  with two measurements).** `engine.ts:1411` arms a 120-second self-destruct around the SYNCHRONOUS
  `parser.parse()` and kills the process on a hang, because `setTimeout` cannot interrupt blocked
  C/WASM code. Pass 3 was killed four times by four DIFFERENT files. The fault is not a property of a
  file and not of concurrency alone: 25 `aoc24` files parse solo in 0.7–7.6 s with no fault and
  across 4 rounds of 8-way contended parsing of exactly those files there were 0 faults and 0 hangs,
  so it emerges from SUSTAINED wasm state over a long walk. Needed: (a) a parse fault returns an error
  result rather than taking the process with it, so one unparseable file cannot destroy every
  instrument built on `parseFile`; (b) `parseFile`'s catch should not answer a real parse error with
  `extractFallback` silently — it is the language-agnostic **REGEX** extractor, and a degraded file
  then returns fewer edges with no error, which is how the census read clean while the number was
  wrong. The supabase commit `7a7f0810f` fixed a related wasm temp-path race; this is the second half.
- **`src/lsp/impact.ts` should match reverse-edge targets by (name, owner, file), not by name.**
  Re-measured over 1,955 files at this HEAD: a `contains` target resolves uniquely by bare name
  corpus-wide on **92.71 %** of edges, by (name, `ownerName`) within its own file on **99.54 %**,
  and **99.61 %** once `metadata.memberKind` is added — while (name, `ownerName`) corpus-wide is
  unique on only **45.62 %**, median 2 matches. So the file is not optional: without it the reverse
  walk is ambiguous on more than half the edges. `ownerName` and `kind` are ALREADY on the member
  symbol and `metadata.memberKind` is on the edge, so no schema change and no stored inbound edge is
  required — only the match rule. The residual 47 intra-file cases are two `property` symbols of one
  name under one owner (a column re-declared by `ALTER TABLE ADD COLUMN`, 37 of them) plus 8
  `constant`+`property` and 10 `constant` pairs, which a per-file analyzer cannot merge.
- **`src/ast/types.ts` needs a `trigger` SymbolKind, or the trigger/function collision stays.** Both a
  `CREATE TRIGGER t` and a `CREATE FUNCTION t()` publish as `kind: function`, so **483 of 490**
  `calls` self-loops are `calls X -> X` meaning "trigger X runs function X" rather than recursion;
  **213** distinct names carry both a trigger and a function symbol that a `calls` edge names. The
  other 7 self-loops are real recursion and are the control case. The edge already carries `metadata.triggerAction` so a consumer can
  disambiguate the EDGE, but `bb_impact` on the name still picks one of two declarations.
- **`pool-worker.ts`'s symbol-metadata whitelist should be widened, or a lane cannot use its own
  metadata.** The whitelist (`metadata: (() => { … })`) forwards CSS keys and markdown keys and drops
  everything else, so every `metadata.type`, `sqlType`, `constraintKind`, `isPrimaryKey` or
  `addedByAlter` this analyzer writes is deleted before a consumer sees it. This is not a cosmetic
  gap: `pass3-phantom-constraint.mts` keyed on `symbol.metadata.type` and reported **ZERO** phantom
  declarations on a corpus with 53, purely because of it. Only `kind`, `ownerName`, `ownerKind`,
  `qualifiedName` and the file/line survive.
- **The shared differential has no SQL oracle and skips the lane (SQL-G14).** Unchanged from pass 2:
  7 of 7 emitted types are DERIVATION findings, and `LANG_REPOS` has no `sql` entry so the harness
  prints `SKIP` rather than a row. The cheapest first surface is still `contains`: both ends are names
  written in the file, it is now 99.59 % resolvable, and `memberKind` gives an oracle something
  concrete to disagree about. `uses`/`references` must be scoped to the WITH list or the oracle would
  report 91 errors in 56 files as findings.
- **SQL-G13, unchanged.** `keepSymbol`'s `UNIVERSAL` denylist holds `program`, the grammar's ROOT node
  type, and `program` is a legal SQL column name, so the symbol is deleted and the `contains` edge
  naming it survives: **1 edge** in `boundary/…/postgres/71/11_session_recording.up.sql`. Needs a
  language-scoped exemption list for names that are ordinary identifiers in the lane's language, the
  shape `keepSymbol` already applies for json/yaml/xml/make/markdown. The whole-corpus size of the
  leak is now **3 symbols in 1,955 files** and reconciles exactly against production `parseFile`
  (18,485 emitted − 3 refused = 18,482 published), so this is a 0.016 % leak and the `contains`
  edge above is its only graph-visible consequence. Limitation 19's apparent 3-versus-0
  disagreement is closed; see `measurements/pass5-keep-symbol-census.json`.
- **The arbiter's instrument-A vocabulary count does not describe its own corpus (SQL-G18, new).**
  `script/m14/ontology-coverage-gate.ts` prints `the grammar produced ${grammarNodeTypes.size}
  distinct node types across the corpus`; over the same 1,955 files three independent walkers
  measure **480** (all nodes) and **454** (named only), and the arbiter reports **256** — the same
  256 in all 8 shards of a run whose shards hold 19 to 594 files each, which a per-shard vocabulary
  cannot be. Needed: the loop at the `// Instrument A` comment walks `files`, so either `files` is
  not the shard's admitted set at that point, or `grammarNodeTypes` is not reset between runs and
  the patched single-process copy inherits a prior count. Which of the two it is, I did not
  determine, because the file is supervisor-owned. No verdict depends on it — see *Instrument A's
  denominator, measured three ways* — but the printed figure is currently not the corpus's.
- **The arbiter needs an `--exclude` for faulting files, and `rulingFor` needs a non-prose citation.**
  The first was pass 2's §8 item and pass 3 shows the name list cannot work — it grew from three to
  seven by being killed. The citation bug is also pass 2's and unchanged: `rulingFor` matches a type by
  PROSE, so it cites `SQL-D11` for `exports` (which is about `imports`). The fix is an optional
  `ontologyType` on each decision with the prose match as fallback, plus splitting `SQL-D16` into two
  entries. Specified in `script/m14/sql-ruled.ts` → `SQL_RULING_CITATIONS`.

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
   count. `overrides` emits **22 edges from 34 replacement events**, and the corpus-wide count
   under the same rule is also **34** — every same-name re-declaration in the admitted corpus is
   intra-file, so this corpus does not exercise the cross-file case at all (the old denominator
   of 777 is withdrawn as unmeasured; see *`overrides` reconciled by measurement*). `uses` resolves
   intra-file at **32.51 %** for the ordinary reason that a migrations corpus reads tables an
   earlier migration created. No amount of intra-file work changes either number.
2. **`confidence` is uniformly 1, and that is a weaker claim than it looks.** It means no edge is
   a guess about a *name*. It does not mean the analyzer is equally certain about the *edge's
   meaning*: the `usage_contextual` tier (**10,693 edges, 34.42 %** — 7,276 `uses` and 3,417
   `calls`) says the name was read from a bare slot with nothing around it to disambiguate it. A
   `uses` edge to `lineitem` could be the TPC-H table or a same-named temp table in another
   schema; the analyzer cannot tell and does not pretend to.
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
    identifier's span — so **11,392 of 11,977** containment edges (**95.1 %**, 380 files) have a
    member whose span lies outside the owner's. That is a property of the symbol model, not a defect in the edges,
    and it means the CSS lane's defect class ("containment edges pointing at a symbol that does
    not contain the member") is untestable by range here: `parseFile` returns no `range` object
    and a `contains` edge carries no line number. `ownerName` is the only ground truth, and
    **11,976 of 11,977** members agree with their edge on it; the 1 that does not is named in
    `pass5-adversarial-probe.json` under `A10-contains-target-has-no-symbol-in-this-file`.
12. **A CTE inside an ERROR-recovery span cannot be scoped.** 91 `uses` edges across 56 files
    come from inside a CTE whose own subtree carries an ERROR; when recovery swallows a WITH
    list the names in it never become `cte` nodes, so the scope set is finished and still wrong.
    The fix would have to treat ANY error in a CTE body as "the WITH list was lost", which
    suppresses true table edges for every file with an unrelated unparseable expression in a CTE.
    It needs a grammar change, not a guard, and it is why `uses` still carries 19 edges naming a
    CTE with no qualified reach.
13. **60 qualified invocations are inside an error subtree, and they are not lane defects.** Pass
    2's version of this item said "196, reason not settled"; the reason is settled and the residual
    has fallen at every pass — 196 unsplit, then 107 + 5, now **60 in one bucket** — because the two
    dispatch gaps closed and because the plpgsql body cases turned out to be the same class (their
    ancestor chain carries an error above the body, so pass 3's separate bucket was double-counting
    one population). They are a property of the TREE: when error recovery swallows an expression the
    callee never becomes an `invocation` node at all. **0 remain unexplained.** Reaching the 60 needs
    a grammar change, not a guard.
14. **`overrides` is the one emitted type whose edge count is not its event count, and the
    difference is in the graph's identity key rather than in the analyzer.** 34 replacement events
    become 22 edges because `addRelationship` keys on `(type, source, target)` and the source is
    the synthetic owner `global`, so a name replaced 6 times is one edge. Both line numbers survive
    in `metadata.priorLine` / `metadata.replacementLine`, but only the LAST pair: a consumer cannot
    reconstruct the replacement CHAIN from the edge, because the 3 collapsed events of
    `overloaded_default` are gone. This was measured at pass 5 and it is the reason the analyzer's
    `22` and its event count `34` are both correct and both on this page. The construct probe's 15
    is now decomposed exactly — see *`overrides` reconciled by measurement* — so it is no longer an
    open item.
15. **`SQL_KEYWORDS` and `SQL_BUILTINS` are now exported from the analyzer.** They are read-only
    by every consumer added this round (the adversarial probe calls `has` on them so it can ask
    the guard's question instead of keeping a copy that could drift), but the export widens the
    module's public surface for a test. If the supervisor prefers, the alternative is a
    lane-side re-derivation of the two sets with a check that they have not drifted; the export
    is the cheaper of the two and the drift-proof one.

16. **69.3 % of `uses` edges are sourced to `global`, which is not a published symbol.** 6,311 of
    9,106. For an anonymous statement that is the honest owner — a SQL file's top-level DML is not
    inside any declaration — but it means those edges can be walked TO their target and not FROM
    their source. Publishing a per-file symbol would fix it and is not done here: it changes the
    symbol census for every SQL file, and `keepSymbol`'s denylist already drops the grammar's own
    root name (`program`), so a file-level symbol is a shared-machinery decision. §8.
17. **A trigger and its function are the same kind with the same name, and `calls X -> X` does not
    say which is which.** **483 of 490** `calls` self-loops are this shape — PostgreSQL's convention
    is to name a trigger after the function it runs — and the other **7** are real recursion
    (`generate_session_code()`, `validate_json_schema()`), which is the control case proving the
    self-loop encoding is sound for recursion and ambiguous for triggers. **213** distinct names
    carry both a trigger and a function symbol that a `calls` edge mentions.
    `metadata.triggerAction` already marks the trigger shape so a consumer CAN tell, but the two
    SYMBOLS remain indistinguishable and `bb_impact` on the name picks one. Closing it needs a
    `trigger` SymbolKind, and `src/ast/types.ts` is supervisor-owned. §8.
18. **Cross-file, `ownerName` does not disambiguate a `contains` target.** Intra-file (name,
    `ownerName`) resolves **11,921 of 11,977 = 99.54 %** — 11,929 = 99.61 % once the edge's own
    `metadata.memberKind` is added — but corpus-wide (name, `ownerName`) is unique for only **5,463
    of 11,977 = 45.62 %**, median 2 matches, because a migrations corpus declares `users(id)` in
    many files. The disambiguator a cross-file consumer needs is the FILE, and `src/lsp/impact.ts`
    currently matches targets by name alone. §8.
19. **The two `keepSymbol` measurements that two earlier passes recorded as disagreeing are
    reconciled, and the reconciliation is exact.** `analyze()` over the corpus emits **18,485**
    symbols; `keepSymbol` refuses **3** of them (2 `function:root`, 1 `property:program`); production
    `parseFile` publishes **18,482**. `18,485 − 3 = 18,482`, so `keepSymbol` accounts for the whole
    difference between what the analyzer emits and what the index sees, and the earlier `18,325`
    was an older analyzer rather than a different rule. Pass 3's "0 dropped" was never a competing
    measurement: that probe reads `parseFile` output, which is already filtered, so a drop is
    structurally unobservable in it. This limitation existed because the two numbers were compared
    without asking what each instrument could see; it is closed by `measurements/pass5-keep-symbol-census.json`.
20. **47 symbols are named with a SQL keyword, and the count splits into 11 that are a defect and
    36 that the measure cannot separate from keywords.** The 11 are one shape — `ALTER TABLE … ADD
    FOREIGN KEY / UNIQUE / PRIMARY KEY` read as a column named after the keyword (`key` 5, `KEY` 1,
    `PRIMARY` 3, `primary` 2) — and fixing that needs a decision about what `ADD CONSTRAINT`
    should publish, not a longer denylist. The other 36 are `comment` 25 (legal: it is not
    reserved in a column position) and 11 singletons the analyzer cannot clear without reading
    whether the source spelled the identifier quoted: `filter`, `start`, `end`, `from`, `to`,
    `table`, `conflict`, `range`, `DEFERRABLE`, `first`, `true`.
21. **One corpus file used to be worth 5 % of this lane's symbols and was unmeasurable; pass 4
    fixed the cost and the figure no longer applies, but the shape of the limit survives.**
    `postgrest/test/io/fixtures/big_schema.sql` measured 116,589–156,694 ms against the engine's
    120 s analyzer budget and returned 0 symbols in 2 of 3 solo runs, so the lane's headline
    alternated between 31,037 and 29,163 depending on machine load. Pass 4 found the cause in this
    analyzer's own `walkDescendants` (87 % of the run) and the file is now **3,551 ms with the same
    943 symbols and 1,874 relationships every time**, and two walks at different shard counts agree
    exactly. So the residual limit is narrower and it is this: a file at 3.5 s is 5× the median
    corpus file, and the equivalence probe that proved the fix correct reports 2,624,148 index
    queries over 1,955 files, so the index is correct but its cost is still linear in tree size per
    query until the queries are hoisted. No corpus file degrades, and no headline number depends on
    which side of a budget a file lands on.

## Evidence pointers

Everything above is written by a committed script and lands in a committed artifact. Pass 3's
artifacts are under `validation/m14/fixtures/sql/measurements/`:

| Artifact | Written by | What it carries |
| --- | --- | --- |
| `pass3-final-census.json` (+ `.shard0..3.json`) | `validation/m14/fixtures/sql/ontology-census.mts` | every headline count, through production `parseFile`, sharded and merged; `degradedByTimeout` and `filesWithNoShardRow` per shard, replayed into the merge |
| `pass3b-census.json`, `pass3c-census.json` | the same script at 8 and 4 shards | the reproducibility pair — 0 differences but for one named file |
| `pass3-fault-contended-r1.json` | `validation/m14/fixtures/sql/fault-classify.mts` | 25 `aoc24` files parsed 8-way concurrently, 0 faults, against 0 faults solo — the measurement that makes `--exclude` provably insufficient |
| `pass3-adversarial-probe.json` | `validation/m14/fixtures/sql/adversarial-probe.mts` | the six questions' adversarial half, the A12 capability battery decided from node types and fields, and the probe's own degradation disclosure |
| `pass3-construct-probe.json` | `validation/m14/fixtures/sql/construct-probe.mts` | the 480-node-type grammar inventory and the nine zero-probes behind every RULED verdict |
| `pass5-incoming-corpus.json` | `validation/m14/fixtures/sql/pass3-incoming.mts` | the incoming direction re-measured at this HEAD: ambiguity, `contains` resolution under four match rules, the trigger/function collision, keyword-named symbols, orphan declarations |
| `pass5-keep-symbol-census.json` | `validation/m14/fixtures/sql/keep-symbol-census.mts` | 18,485 emitted − 3 refused = 18,482 published, the reconciliation that closes limitation 19 |
| `pass5-overrides-reconciliation.json` | `validation/m14/fixtures/sql/overrides-reconciliation.mts` | both `overrides` rules re-implemented and the difference decomposed with an exactness check, plus the per-file edge-identity collapse that turns 34 events into 22 edges |
| `pass5-adversarial-probe.json` | `validation/m14/fixtures/sql/adversarial-probe.mts` | the six questions' adversarial half re-measured at this HEAD over all 1,955 files with **0 degraded**, and the A12 capability battery's 6 verdicts |
| `pass5-invocation-why.json` | `validation/m14/fixtures/sql/pass3-invocation-why.mts` | the cause breakdown for every qualified invocation carrying no `calls` edge, closed at 742 = 629 + 53 + 60 with **0 unexplained** |
| `pass6-corpus-composition.json` | `validation/m14/fixtures/sql/corpus-composition.mts` | the corpus DENOMINATOR the per-type census never produced: 183 repo directories walked, 17 with a tracked `.sql`, **16 contributing an admitted file**, 1,963 tracked paths → **1,955 admitted**, agreeing with the arbiter. Names `proxicall`, the symlink out of the corpus root that supplies 438 of those files, and the 8 excluded paths |
| `pass3-incoming-corpus.json`, `pass3-incoming-boundary.json` | `validation/m14/fixtures/sql/pass3-incoming.mts` | the incoming direction: ambiguity per type, `contains` resolution under three match rules, the trigger/function collision, keyword-named symbols, orphan declarations |
| `pass3-invocation-why.json`, `pass3-invocation-why-after.json` | `validation/m14/fixtures/sql/pass3-invocation-why.mts` | the cause breakdown for every qualified invocation that carries no `calls` edge, and the 0 that remain unexplained |
| `pass3-phantom-constraint-before.json`, `pass3-phantom-constraint-after.json` | `validation/m14/fixtures/sql/pass3-phantom-constraint.mts` | 53 fabricated declarations → 0, by the same parse-tree oracle on both sides |

Carried forward from pass 2 and still the correctness instruments: `ontology-census.json`
(superseded), `construct-probe.json`, `adversarial-probe.json`, `keep-symbol-census.json`.

- Ruling table and its demonstration: `script/m14/sql-ruled.ts`, run by
  `validation/m14/fixtures/sql/run-ruling-table.mts`
- Ontology mutants and their runner: `script/m60/sql-ontology-mutants.ts` (21, five of them
  pass-3), `script/m60/run-sql-ontology-mutants.ts`
- Review: `fixtures/sql/REVIEW.md` — **absent from this machine**
- Fixtures: `validation/m12/fixtures/sql/`, `validation/m14/fixtures/sql/sqld1..sqld15`
  (`sqld14` is the pass-2 regression fixture, `sqld15` the pass-3 one; reverting the analyzer
  makes `sqld15` fail with 6 named problems)
- Ground truth: `validation/m12/ground-truth/sql.json`
- Differential: `validation/m12/results/sql-differential.json` — regenerated at pass 3's HEAD and
  its declared analyzer sha256 matches the file on disk
- Completeness spec: `script/m14/spec/sql-completeness.json`
- Lane records: `validation/m60/sql/`
- Gates: `script/m12/verify-analyzer.ts`, `script/m14/verify-grammar-pins.ts`,
  `script/m14/ontology-coverage-gate.ts` (supervisor-owned; demonstrated by
  `validation/m14/fixtures/sql/run-ruling-table.mts`), `script/m14/verify-honesty.ts`,
  `script/m60/verify-sql-resync.ts`
- Grammar review: `reviews/m60-sql-grammar-l1xnan-047-refused.md`, `reviews/regex-policy.md`

## Issue

M12.33 / GitHub issue #172.
