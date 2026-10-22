# tree-sitter-sql — grammar pin

This directory is the **source of record** for the SQL grammar the product loads, and
`wasm/tree-sitter-sql.wasm` is what `src/ast/engine.ts` resolves for the `sql` language
(`resolveWasm("tree-sitter-sql/tree-sitter-sql.wasm")`).

**The wired bytes are NOT the published release, and the difference is not small.** They are a
**local fork** of `@derekstride/tree-sitter-sql@0.3.11` carrying **67 named types the published
package does not have** — including the whole `plpgsql_*` family. This file is where that fork is
written down, what was measured about it, and what is NOT known about it.

> **⇒ THE ONE THING A READER MUST KNOW UP FRONT: the fork's SOURCE is not in this repository, and
> it was not recoverable from anything the record names. Every statement below about the fork's
> content is a MEASUREMENT against the wired bytes; the source itself is missing, and the patch
> ladder for this lane is blocked on that, with the measurement in §4.**

## Upstream

| | |
| --- | --- |
| repository | `derekstride/tree-sitter-sql` |
| version | `0.3.11` (2025-10-01) — the latest published, and current on its own upstream |
| license | MIT (`LICENSE`) |
| tarball measured against | `npm pack @derekstride/tree-sitter-sql@0.3.11` |
| tarball sha256 | `20f2670c6bee98c442cf0a2afe6e4965b1a96a7752c89d8a37604c173db0c623` |
| upstream | `git+https://github.com/derekstride/tree-sitter-sql.git` |

**Every published alternative was adjudicated and REFUSED** — see
`reviews/m60-sql-grammar-l1xnan-047-refused.md` §0 and §7.3: `@l1xnan/tree-sitter-sql` 0.4.7 and
`tree-sitter-sql-bigquery` 0.8.0 both fail the G1 damage / G2 identity / G3 output gates. The
review's own conclusion is the sentence this lane's ladder starts from: **"sql needs a patch."**

## The wired build

| | |
| --- | --- |
| file | `wasm/tree-sitter-sql.wasm` |
| sha256 | `848e081247247db54545d4122a394dad3c85f79bb96a5713dbd658081b8eb819` (`848e0812`) |
| bytes | 12,620,599 |
| named types (unique) | 590 |
| node-type ids | 825 |
| anonymous types | 231 |
| fields | 62 |
| **id-order digest** | `d75d65d98a2e9011d4c3748d6f17575e984ab511ac3c8f061d4a733661378516` |
| **type-set digest** | `19f3056a971a77fde227c2dae6612847eb468cd883a7f118e893b8e62e7f1e02` |
| **field-set digest** | `6e6552aef40f6a89d1c9b34be84041f2813009ff7acced8429e3dfe41d08418b` |

The three digests are `script/m14/verify-grammar-pins.ts` → `measureSurface`, and they are what
`script/m14/grammar-remedy.ts prove` compares. A cell that names the build it ran on is stating a
fact about its evidence; these three lines ARE that fact for this lane.

**THE FIXTURE SIDE AND THE PRODUCTION SIDE LOAD THE SAME FILE.** Measured 2026-10-21 on both sides:
the same path, the same sha256, the same bytes. sql is therefore **not** one of the two lanes where
the fixture suite and the production path load different grammar builds (L-2026-10-21-11).

## The fork: 67 named types, measured

The wired build is a local fork of the published grammar. The named-type delta between a build of
the published package and the wired build is **67 added, 0 removed** — and the id-order digests
differ, so the two are different sources and not two builds of one source.

```
alter_materialized_view, alter_policy, composite_field, covering_columns, create_policy,
create_procedure, do_statement, drop_materialized_view, drop_policy, drop_procedure,
grant_statement, having, keyword_assert, keyword_continue, keyword_current_role,
keyword_current_user, keyword_debug, keyword_disable, keyword_elsif, keyword_enable,
keyword_exception, keyword_exit, keyword_grant, keyword_include, keyword_info, keyword_log,
keyword_loop, keyword_notice, keyword_perform, keyword_permissive, keyword_policy,
keyword_privileges, keyword_public, keyword_raise, keyword_refresh, keyword_restrictive,
keyword_reverse, keyword_revoke, keyword_rlike, keyword_session_user, keyword_split,
keyword_tablets, keyword_warning, keyword_while, not_rlike, plpgsql_assert, plpgsql_assignment,
plpgsql_block, plpgsql_declarations, plpgsql_execute, plpgsql_exit, plpgsql_for, plpgsql_if,
plpgsql_loop, plpgsql_perform, plpgsql_raise, plpgsql_return, plpgsql_while, procedure_body,
psql_meta_command, refresh_materialized_view, revoke_statement, tablespace, tablet_split,
var_declaration, var_declarations, while_statement
```

**THE RECORD PREVIOUSLY UNDERSTATED THE FORK, AND THIS IS THE CORRECTION.** The spec's
`grammar_provenance.patches` named FIVE patches, and their descriptions account for only a part of
this list — the `grant_statement` / `revoke_statement` / `do_statement` / `drop_policy` family, and
nothing else. They do NOT account for the 13 `plpgsql_*` types, `create_policy` / `alter_policy`,
`procedure_body`, `psql_meta_command`, `tablespace` / `tablet_split`, `var_declaration(s)`,
`while_statement`, `not_rlike`, `having`, `composite_field`, `covering_columns`, the materialized-view
and procedure statements, or the 29 `keyword_*` tokens. **⇒ THE FORK IS SUBSTANTIALLY LARGER THAN
THE FIVE PATCHES THE RECORD NAMED, AND THE RECORD WAS WRONG ABOUT ITS OWN BUILD.**

### What was checked for the fork's source, and what each check said

| candidate | check | result |
| --- | --- | --- |
| `@derekstride/tree-sitter-sql@0.3.11` | `npm pack` → `tree-sitter generate` | **523 named types** — 67 short of the wired build |
| the fork's own tree at `fixtures/sql/grammar/src` | the path the spec's provenance names | **the path no longer exists** |
| this repository's history | `git log --all` over every commit | only `wasm/tree-sitter-sql.wasm` was ever committed — never a source |
| public forks of the upstream | 124 forks probed over `raw.githubusercontent.com` for `plpgsql_block` + `grant_statement` + `psql_meta_command` + `do_statement` | **none carries the vocabulary** |
| `@l1xnan/tree-sitter-sql@0.4.7` | `npm pack` → `grammar.js` | **carries none of the 67 types** — and it is the candidate this lane already REFUSED, on three gates |
| `tree-sitter-postgres@1.2.4` | `npm pack` → its shipped wasm, deltaed | a **different grammar family** (1,235 named types; 585 added / 1,230 removed against the wired build) |
| `grammars/` | the tree the remedy ladder fetches into | **no sql source until this pin was created** |

**⇒ THE FORK'S SOURCE IS UNRECOVERABLE FROM THE RECORD.** Everything above is a measurement, not an
inference, and each row names the check that produced it.

## The R2 patch in this directory: the inheritance clause as a real node

`grammar.js` in this directory is the **published** grammar (0.3.11) **plus one patch**, and the
patch is the R2 rung for the `extends` type. PostgreSQL's table inheritance has three forms:

```sql
CREATE TABLE child ( ... ) INHERITS ( parent [, ...] )   -- the parent LIST
ALTER TABLE child INHERIT parent                         -- ONE parent
ALTER TABLE child NO INHERIT parent                      -- the REMOVAL of one parent
```

**The wired grammar has no production for any of them**, so the words were lexed as identifiers and
the clauses error-recovered. Measured against the wired build:

| statement | wired build | patched build |
| --- | --- | --- |
| `CREATE TABLE c (id INT) INHERITS (p);` | **1 ERROR**, the parent name does **not** survive | 0 ERRORs, an `inherit_clause` node holds the parent |
| `CREATE TABLE c (id INT) INHERITS (p1, p2);` | 1 ERROR | 0 ERRORs, two parents |
| `ALTER TABLE c INHERIT p;` | 0 ERRORs, but a **mis-parse**: a `column_definition` named `INHERIT` whose type is the parent | 0 ERRORs, an `inherit_specification` node |
| `ALTER TABLE c NO INHERIT p;` | **1 ERROR** (the `keyword_no`) | 0 ERRORs, `inherit_specification` with `keyword_no` |

The construct therefore **existed in the language and was only PARTIALLY readable in the grammar** —
the R2 case exactly. The patch adds:

```js
inherit_clause: $ => seq(
  $.keyword_inherits, "(", $.object_reference, repeat(seq(",", $.object_reference)), ")",
),
inherit_specification: $ => prec(1, seq(
  optional($.keyword_no), $.keyword_inherit, $.object_reference,
)),
```

and wires them into `create_table` (after the column list — PostgreSQL's own order) and
`alter_table`. `prec(1)` is on `inherit_specification` because `ALTER TABLE c INHERIT p` is ALSO
readable as `add_column` (a column named `INHERIT` of type `p`), and the inheritance reading must
win: the other reading is the mis-parse this patch exists to remove.

**THE PATCH AS A FILE: `grammars/tree-sitter-sql/0001-inheritance-clause.patch`** — 40 added lines
against the published `grammar.js`, the same shape as the `nim` lane's `0001-nim-dopragma.patch`. It
is the durable form of the change: `diff -u` against the npm tarball's `grammar.js` reproduces it
byte for byte.

**⇒ THE ANALYZER READS THE REAL NODE, AND THE EDGE EXISTS ONLY THERE.**
`src/ast/real-sql-analyzer.ts` reads `inherit_clause` in the create-table path and
`inherit_specification` in the alter-table path, and publishes `extends` from it. The mis-parse
fallback for the wired grammar is **kept** (the wired grammar's ALTER form does keep the parent's
name, in `custom_type`), so the two grammars coexist and neither regresses.

**THE NAMED-TYPE EFFECT OF THE PATCH, MEASURED:** 4 added, 0 removed — `inherit_clause`,
`inherit_specification`, `keyword_inherit`, `keyword_inherits` — and the **field-set digest is
UNCHANGED**, so the patch extends the vocabulary without changing any field contract the analyzer
reads. (The `cpp` lane's patch 4 has the same shape.)

### The patched build

| | |
| --- | --- |
| built from | this directory, `tree-sitter generate` + `tree-sitter build --wasm` |
| wasm | `.tmp-census/sql-inherits.wasm` (rebuild it with the commands below) |
| sha256 | `6ef9cdae2c93e68444aa8f6aeaf5c706dadbc69abf38071380f8d76873ff218b` |
| bytes | 2,448,265 |
| named types (unique) | 527 (523 + the patch's 4) |
| id-order digest | `4254ead34d70986522e9e1f981828a409ff6732acaf8d16ca97afc229b8e1b9f` — the published build's, with the four additions after it |
| type-set digest | the published build's type-set digest, plus the four names |
| field-set digest | `c63f5b80b6b87674744f6c6fc6abff7a69df25dda1d125d851d8822d581352aa` — **unchanged** |

### WHY THE PATCH IS NOT WIRED, AND WHAT IT WOULD COST

**The patch is built on the PUBLISHED source, and the published source is 67 named types short of
the wired build.** Wiring this build in place of the wired one would therefore DELETE the whole
`plpgsql_*` family, the policy statements, the procedure statements, `psql_meta_command` and the
rest — and the corpus exercises them: **6,615 `plpgsql_*` nodes across 366 files** on the admitted
population. The edge-level cost is measured by `script/m14/sql-grammar-remedy.ts` over the whole
admitted population, and it is in `validation/m14/measurements/sql-grammar-remedy.json`.

**⇒ THE PATCH IS CORRECT, PROVEN, AND NOT YET WIREABLE: THE FORK'S SOURCE MUST BE RECOVERED (or
re-derived) FIRST.** That is the blocker, stated with its evidence, and the lane's `extends` type
stays in **GRAMMAR REMEDY PENDING** — out of the denominator — until it leaves that class.

## Rebuilding

```bash
# from the repository root:
bun script/m14/grammar-remedy.ts generate --dir grammars/tree-sitter-sql --wired wasm/tree-sitter-sql.wasm
bun script/m14/grammar-remedy.ts build    --dir grammars/tree-sitter-sql --out .tmp-census/sql-inherits.wasm
bun script/m14/grammar-remedy.ts delta    --from .tmp-census/sql-pristine.wasm --to .tmp-census/sql-inherits.wasm

# the lane's own measurement — the population delta, the three digests, the behavioural red/green:
BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-grammar-remedy.ts \
  --json validation/m14/measurements/sql-grammar-remedy.json
```

`tree-sitter build --wasm` works here with **no docker and no emscripten** (tree-sitter 0.26.9).

**A rebuild that changes the surface digests without a change to `grammar.js` means the toolchain
moved, not the grammar** — which is a fact worth recording, because the whole pin rests on the
bytes being attributable to this source.

## What is vendored, and what is not

| file | vs the 0.3.11 tarball | why |
| --- | --- | --- |
| `src/scanner.c` | **byte-identical** (verified against the tarball: `de17b5cf…`) | the external scanner; carried unchanged from upstream |
| `package.json`, `LICENSE` | **byte-identical** (verified: `e4b01b5e…`, `3b3e4e42…`) | the package identity; MIT requires the license to travel with the source |
| `grammar.js` | **DIFFERS** — upstream → here | the inheritance patch above, and nothing else |
| `src/parser.c`, `src/grammar.json`, `src/node-types.json` | generated | `tree-sitter generate` from this `grammar.js`; the tool writes them here |

**THE FORK IS NOT VENDORED.** This directory is the published grammar plus the inheritance patch.
The wired build's 67 extra types are **not** in it and **cannot be** in it until the fork's source is
recovered — see the table in §"What was checked for the fork's source".
