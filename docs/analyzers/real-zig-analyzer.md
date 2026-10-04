# Real Zig Analyzer

Real, grammar-grounded Zig code intelligence for the Backbencher Brain universal
code-intel engine. Mirrors the declaration-site-only, evidence-tiered,
corpus-verified family contract shared by the go / rust / c / cpp systems
analyzers.

## Language

- Analyzer file: `src/ast/real-zig-analyzer.ts`
- Parser: `tree-sitter-zig` (WASM at `wasm/tree-sitter-zig.wasm`, loaded by `engine.ts` via `resolveWasm`)
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: a **REDISTRIBUTOR BUILD**, not a build of this lane's own npm
  package. `wasm/tree-sitter-zig.wasm` is byte-identical to `tree-sitter-wasms@0.1.13`'s `out/` wasm
  (sha256 `59cc4531aa661e2d…`).

  **That collection publishes no source** — 0 `grammar.js`, 0 `parser.c`, only prebuilt wasms — so
  these bytes cannot be regenerated from it, and the underlying GRAMMAR version is recorded
  nowhere in this repository and must not be inferred from the collection's version.

  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`. This matters for the
  web-tree-sitter 0.27.0 migration: this is one of the lanes whose wasm cannot simply be rebuilt
  from what we have, only re-sourced and re-admitted.

## Declaration surface (grounded in tree-sitter-zig, probe-verified 2026-08-29)

Everything below is stated against the **pinned `tree-sitter-zig` wasm** and
measured over **three real corpora** — the upstream `zig` compiler (2,950 files),
`zls` (90) and `ghostty` (799), 3,839 `.zig` files in total. The 2026-09-28 deep
review re-measured the grammar itself: 92 named node types, 140 anonymous token
types, 16 field names. Instruments: `script/m14/tmp/zigw-*.ts`; findings and their
counts: `reviews/zig/master-review.md`; rulings: `script/m14/spec/zig-completeness.json`.

## Declaration surface (grammar-anchored)

| Form | Published as | Notes |
|---|---|---|
| `const X = struct{…}` / `enum{…}` / `union(enum){…}` / `error{…}` | `Struct` / `Enum` / `Union` / `Enum` | containers; members carry `scope`/`ownerName` and a `contains` edge |
| `const X = opaque { … }` | `Type` **and a container** | Zig models interfaces as opaque types + fn pointers. The shared `SymbolKind` has no `Opaque`, so it is published as `Type` — which is true — and it OWNS its declarations (`pub fn` members are `Method`s with `contains` edges) |
| `container_field` with a `type` field | `Property` (struct/union) or `EnumMember` (enum) | the field's type is published as `returnType`, verbatim |
| `container_field` with **no** `type` field | `EnumMember` | the same node type carries both forms; the field is the discriminator, and an enum member's value is not a type |
| error-set members (`error{ A, B }`) | `EnumMember` | identifiers that are DIRECT children of the `error_set_declaration` |
| `function_declaration` | `Function` at file scope, `Method` inside a container | ownership decides, not the kind: an opaque container is published as `Type` and still owns its members |
| `function_signature` | *(nothing)* | the anonymous fn-type form (`f: *const fn (u8) void`); an fn type has no name identifier, so it declares nothing |
| `variable_declaration` at file/container scope | see **Kind dispatch** below | a `var` global is `Variable` |
| `@import("…")` / `@cImport` | *(no symbol)* + an `imports` entry + a `references` edge with `meta.isImport` | a module alias is a binding, not a declaration of a type — the Java/Go/Rust family contract |
| `test` / `comptime` blocks, any `block` | *(nothing)* | executable scope: their `var`/`const` are execution artifacts |
| a container inside an executable body | *(nothing for its members)* | a LOCAL type has no file-scope identity, so it owns nothing — its declarations would otherwise be filed under the enclosing container (Z22) |
| `function_signature` (a function-pointer type) | *(nothing — it is a type, not a declaration)* | it has no `declarator` field, so any name taken from it is the return type or a parameter's qualified segment (Z26) |
| a field with a name ≥ 50 characters | **published** | a length test is not a junk filter: 14 of 27,004 corpus field names are ≥ 50 chars, and all 14 are real declarations (Z28) |

**Anonymous containers produce no symbols.** Fields of an anonymous struct
returned by a generic function (`fn GenericStack(…) type { return struct{…} }`)
have no stable container identity (the C negative contract), and a container
literal used in a **type position** (`fn f(s: struct { FLAG: u8 })`) names
nothing, so it publishes no declared-type reference (only its field names are in
the tree, and a field name is not a type).

## Kind dispatch (Z11)

A declaration's kind is decided by the grammar's node type, not by the shape of
its name alone:

1. a container declaration (`struct`/`enum`/`union`/`error`/`opaque`) → its container kind;
2. a `var` → `Variable`;
3. a **type** node (`builtin_type`, `pointer_type`, `slice_type`, `array_type`,
   `nullable_type`, `error_union_type`, `anyframe_type`, `function_signature`,
   `opaque_declaration`) → `Type`, whatever the name's case — `const Pos = c_long;`
   is a type alias;
4. a **value** node (`integer`, `float`, `string`, `multiline_string`, `boolean`,
   `character`, `binary_expression`, `unary_expression`,
   `null_coercion_expression`, `index_expression`, `catch_expression`, `block`,
   `initializer_list`, `range_expression`, `assignment_expression`, `error_type`,
   `anonymous_struct_initializer`, `dereference_expression`) → `Constant`, whatever
   the name's case — no Zig type is a bit-shift, a negation, an index, a catch or
   a labeled block, so `pub const DockSpace = 1 << 10;` is a Constant;
5. an initializer whose element type is `type`/`comptime_int`/`comptime_float`
   (`pub const Implements = [_]type{gtk.Scrollable};`) → `Type`;
6. a `labeled_type_expression` that breaks and never returns (a labeled block)
   → `Constant` (see ZIG.GAP.5);
7. **otherwise** the two-sided forms keep the name heuristic: an upper-case name
   is a type alias. This is the pinned `pub const B = A` contract, and it still
   governs `identifier`, `field_expression`, `call_expression`, `if_expression`,
   `switch_expression`, `struct_initializer`, `parenthesized_expression` and
   `builtin_function` — counted, declared limitations rather than guesses
   (ZIG.GAP.4).

## Relationships

- **`calls`** — a `call_expression` emits a `calls` edge to the callee **leaf**
  (`std.math.add` → `add`), at the line of the name-bearing node. Builtin
  `@`-intrinsics emit no call edge. A same-named method called from within that
  method is a REAL edge and is kept.
- **`uses` (field read)** — a `field_expression` that is not the call callee emits
  a `uses` edge to its field leaf. Suppressed: an assignment LHS whose operator
  is a plain `=` (a write), an enum literal / init key (`.bad`, a single named
  child), and a type position (a qualified type annotation belongs to the
  declared-type graph). A **compound** assignment is a read-modify-write and is
  NOT suppressed: `self.count += 1` reads `self.count`.
- **`uses` (bare value read)** — every bare `identifier` naming a file-scope
  `Constant`/`Variable`/`Function`, plus an error-set member as the leaf of a
  **value-position** `error.X`. Lexically scoped: params, block locals, payload
  captures and `var`/`const` bindings shadow; declaration positions, callees,
  member leaves, labels, `_` and `$`-builtins never read; resolvability is
  required, so `std`/dot-imported/external names stay silent.
- **`imports`** — one edge per `@import`/`@cImport`/`usingnamespace @import` site,
  target the **path literal as written** (176 of the 394 distinct module targets in
  400 corpus files contain a path separator, which no Zig declaration name can
  hold), on the line of the literal. A module-prefixed form (`@import("x").T`) is
  the same site — the import names a MODULE, not a symbol.
- **`instantiates`** — two statically derivable forms: a **construction** of a
  type this file names (`var x: Foo = .{}`, `Foo{ … }`), and an **application** of a
  generic function (`fn make(T: type) T`, called `make(Bar)`). Both carry the
  enclosing function **or named test** as source, and the callee/type leaf as
  target. In-file population: 132 over 400 files (77 constructions, 55
  applications), gated bidirectionally at 0 phantom / 0 missing.
- **`exports`** — a file-scope `pub`/`export` declaration, with
  `metadata.exportKind`. A container-MEMBER `pub` is **not** an `exports` edge: it
  is ownership plus visibility, already carried by `contains` and the member's
  visibility (Z20). 1,584 over 400 files, gated at 0/0.
- **`contains`** — every owner→member edge, at the member's declaration line.
- **`references` (declared type)** — the type a declaration NAMES, read from the
  grammar's `type` field: a parameter, a container field, a local annotation and
  a return type (the four family positions). Builtins excluded. A type that
  names nothing publishes nothing (anonymous container, error set, `!T`'s error
  half, labeled block).
- **`references` (import)** — `@import`/`@cImport` module paths, with
  `meta.isImport` and the line of the path literal.

**Source attribution**: a call or read inside a function carries the enclosing
function/method name; any call or read in a **non-function** context (a top-level
`const` initializer, a `comptime` block) emits with source `(global)` — the go
family package-scope contract (ZIG.D.2). A **named `test` is a scope with a
name** (Z39): reads and calls inside `test progressBar { … }` are attributed to
`progressBar`, not to `(global)`. That is not a cosmetic change — the shared F5
matcher keys on `label + target` and discards the source, so before Z39 every read
in every named test in the corpus was attributed to the file and nothing could
see it.

**Evidence tiers** (`#419-D`): assigned by `classifyEvidenceTier` under the
family rule, and gated by `zigw-evidence-tier.ts` so the assignment is a property
that can FAIL rather than a comment: `contains` → `structural`; a declared type
→ `reference_qualified`; `imports`/`exports`/the import `references` twin →
`import_based`; a **proven** `instantiates` → `structural` (it is derived from the
grammar, not guessed) and an unproven one → `inferred`; calls/uses →
`usage_contextual`, or `inferred` below threshold. Confidence: 1.0 for contains/declared-type/bare reads, 0.85
for a call, 0.75 for a field read, 0.9 for a declared type — every heuristic
edge carries a machine-readable `metadata.relationshipType` reason code.

## M60 line numbers

Every published relationship carries `line_number`, and it is the line of the
**name-bearing node** — the identifier, member leaf, callee or path literal the
edge names, not the start of the enclosing statement (M59.A7 / #825). For an
import that is the line of the **path literal** (M60.A7); for a `contains` it is
the member's own declaration line; for a bare read it is the identifier's line.

Two properties are measured separately, because they fail independently:

- **Presence** (M59): the edge has a line at all, and it is in range. 100% over
  400 files / 38,271 relationships.
- **Accuracy** (M60): the line is the RIGHT line — checked by reading the source
  line back and requiring it to contain the name the edge names, with per-class
  rules (an `imports` edge must show the path as written or its last segment; a
  `calls`/`uses` edge must show the leaf). `zigw-line-accuracy.ts 300`:
  **28,355 relationships, 100.00%, 0 off**, every class at 100%.

The accuracy claim is **falsifiable on demand**, which matters more than the
number: `--shift 1` moves every reported line by one before the check, and the
verdict must collapse. It does — **13.50%, 24,528 of 28,355 off**. A gate that
cannot be shown to fail is not evidence of accuracy; it is evidence that the
comparison is loose, and the shift control is what separates the two. The generic
cross-language probe `line-accuracy.ts` agrees independently at 41,635 edges,
0 wrong, over the same 300 files.

**Six of this lane's defects were the same mistake** — a name rule applied on one
side of a comparison and not the other (Z24, Z25, Z29, Z34, Z41, Z43). Every one
of them turned a correct analyzer edge into a phantom, and every one of them was
found by a gate comparing the same relationships by a different key. The
canonicalizer is now imported wherever a name is compared, for that reason.

Line numbers are NOT claimed for complexity (`metadata.complexity` /
`cyclomaticComplexity` are counts, not positions) or for symbol declarations
beyond their own declaration line.

## Complexity

Per-symbol cyclomatic complexity on every function/method, from a base of 1:
`if`/`for`/`while`/`switch`/`else`/`catch` (statement **and** expression forms —
`const a = if (c) 1 else 2;` is Zig's dominant form) and the `and`/`or`/`orelse`
operator **tokens**. The operator is matched as a token type, never as a
substring of the expression text (`x + standard + order` must not count).
`metadata.complexity` on the symbol and `metadata.cyclomaticComplexity` on the
file both carry the real number.

## Ontology workstream — the 10 relationship types (ZIG.O.1 … ZIG.O.4)

Every count below comes from the PRODUCTION entry point, `parseFile` from
`src/ast/pool-worker.ts`, never from `analyze()` — `analyze()` is the per-file unit
and skips the pipeline stages, so a count taken from it is a count of the analyzer
rather than of the indexer.

**Corpus.** `$HOME/fixtures/repositories`, **100% of the admitted zig
files: 3,834 of 3,834** — the whole population, not a sample. `zig` 2,938 parsed, `ghostty` 805, `zls` 90,
`nvim-treesitter` 1. Admission is the same `git ls-files -- '*.zig'` walk per repo
the coverage gate uses, ordered by `sha256(seed|<repo>/<rel>)`; with no truncation
the draw is the population, and it is named by
`sha256:2f3545f92c470090d61c9a745bb427d8d7dec1630d93d0fbc01cb2acdc5ce1ac`.
**Sampling method:** deterministic hashed order, not a statistical random sample;
re-drawable with `--seed`.

**Instruments.** `validation/m14/fixtures/zig/ontology-census.ts` (the type census,
every question below), `construct-probe.ts` (instrument A grammar-inventory and
instrument B parse-tree-count for the un-emitted types), `dangling-source-census.ts`
(endpoint resolution by cause), `parse-defect-census.ts` (grammar defect extent),
`store-denylist-census.ts` (declarations the store refuses on name alone),
`pass2-adversarial.ts` (the pass-2 audit: a question asked of the analyzer's own
OUTPUT, one probe per emitted type).

**The census must be run in SHARDS, and the reason is a production finding rather
than a harness preference.** `parseFile` carries cumulative WASM state, and one
process over the whole draw self-destructs: three runs produced
`[BB-HANG] parser stuck 120s` on three DIFFERENT files
(`zig/lib/std/builtin/assembly.zig`, `zig/src/link/C.zig`,
`zig/lib/std/testing.zig`), and `zig/lib/std/builtin/assembly.zig` parses in
**2.98 s on its own**, so the trigger is the accumulated parse state and not the
file. Two of those runs also printed `[BB-PARSE-ERR] zig | … | memory access out of
bounds` first — a WASM trap that `parseFile`'s `catch` converts into
`extractFallback`, silently, replacing a file's real graph with the regex
extractor's. `shard-draw.py` reproduces the draw independently (and prints the
same `sha256:2f3545f9…`), `ontology-census.ts --files-from` takes one shard, and
`shard-merge.py` re-resolves the corpus-tier columns against the UNION and
**asserts the union hash equals the single-process draw hash** — it is equal, so the
sharded figures are the same population, not a different one. Without sharding the
census cannot finish on this corpus at all.

### Verdicts

Measured over that draw, through `parseFile` at the shipped analyzer (Z59 included),
**re-measured 2026-10-03 in 8 shards**: **127,429 symbols, 392,550 relationships,
0 symbols with an empty name, 0 kinds outside the shared `SymbolKind`.**

The pass-1 figures were 127,536 / 392,086 / 0 empty names / **192 kindless symbols**.
The draw is byte-identical (`sha256:2f3545f9…`, 3,834 of 3,834, asserted by the
merge), so the difference is not the corpus: pass 1's single long process hit the
WASM trap above on some files and replaced their output with `extractFallback`'s,
whose `BasicSymbol` carries no `kind` and whose edges are regex-derived at
confidence 0.4/0.5. **Every number below is the sharded re-measurement.**

**PASS 3 CORRECTION — the "0 of each" was a property of one run, not of the
corpus.** This paragraph originally read *"8 of 8 shards report 0 of each"*, which
is what the 2026-10-03 run found. Re-running the identical draw at the identical
commit, in the same eight shards, **read 510 kindless symbols and 21 sub-0.7 edges
— three shards of eight degraded.** Sharding reduces the rate; it does not remove
it, and the mechanism is a shared temp path that concurrent processes write and
read (`src/ast/engine.ts`), not the parser state this paragraph blames. The
degradation is now RATE-measured by
`validation/m14/fixtures/zig/fallback-degradation-rate.py`, both instruments count
`parseFile`'s `fallback: true` per file, and both merges REFUSE a degraded shard
rather than publishing a mixture. On a run where every shard reports 0 the
figures above reproduce exactly — 127,429 symbols, 392,550 relationships, 0 empty
names, 0 kinds outside `SymbolKind`, 0 edges below 0.7 — so the numbers are right
and what was wrong was calling one run's value a property. **The 192 kindless
symbols and the 7 sub-0.7 edges pass 1 published were real, and they were the same
class pass 3 re-measured at 510 and 21.** See the pass-3 section.

The `Emitted?` column is written so `script/m14/verify-doc-truth-emissions.ts` can
read it: this table used to be headed `type | verdict`, which that gate cannot
parse, so the lane's emission claims were reported as `NO_CLAIM_TABLE` — "I found no
table to check" recorded in the same shape as "I checked the table and it is clean".

**`extends` leads the table so that it is the row the gate cannot read.**
`parseClaimTable` in that shared script skips the FIRST body row of any claim table
(`if (!started) { started = true; continue }` runs before a row is pushed), which is
observable on every lane: `dart`, `julia`, `haskell`, `typescript`, `go` and `rust`
all lose their first row the same way, and this lane measured it rather than
inferred it. Putting the one type the analyzer genuinely does not emit first costs
that row its machine check and buys the other NINE rows theirs — `calls` was the row
being dropped before, and `calls` is the largest class in the corpus. The dropped
row is still here for a reader; it is simply the row no script grades.

| Relationship type | Emitted? | edges | files | src marker% | src dangling% | tgt file-local% | tgt corpus-tier% | both-ends corpus-tier% | confidence |
|---|---|---|---|---|---|---|---|---|---|
| `extends` | no — RULED, ZIG.O.1, instrument A: 0 of 28 inheritance words in the grammar's own 239-entry type table or its 16 fields; 0 UNCLASSIFIED of 1,797 header-slot children | 0 | 0 | — | — | — | — | — | — |
| `calls` | yes — emitted, and every target is called at its own line (A2: 0 of 113,476) | 113,476 | 2,781 | 11.53 | **0** | 40.03 | 95.53 | 95.53 | 0.85 ×113,476 |
| `uses` | yes — emitted, and 0 of 132,201 targets contradict their reason code (A3) | 132,201 | 2,850 | 22.48 | **0** | 40.16 | 93.29 | 93.29 | 1.0 ×13,406; 0.75 ×118,795 |
| `contains` | yes — emitted; 4.80% of owners are name-ambiguous (A5) | 77,459 | 1,472 | 0 | 0 | 99.80 | 99.80 | 99.80 | 1.0 |
| `imports` | yes — emitted; 20,396 of 20,400 spell `@import` on the line, 0 paths absent (A8) | 10,200 | 2,691 | 100 | 0 | 29.77 | 33.52 | 33.52 | 0.9 |
| `references` | yes — emitted; 75 of 20,594 declared-type targets are not type names (A7) | 30,794 | 2,964 | 100 | 0 | 44.14 | 74.03 | 74.03 | 1.0 ×10,200; 0.9 ×20,594 |
| `exports` | yes — emitted; 0 of 24,114 targets name a non-public symbol (A6) | 24,114 | 3,162 | 100 | 0 | 99.99 | 99.99 | 99.99 | 1.0 |
| `instantiates` | yes — emitted; 615 of 4,306 targets bind to nothing published (A4) | 4,306 | 529 | 55.04 | **0** | 85.72 | 96.05 | 96.05 | 1.0 — ZIG.O.4; the earlier ruling that this branch was unreachable was false and is retracted |
| `implements` | no — RULED, ZIG.O.2, instrument A, same tables; Zig models an interface as `opaque` + fn-pointer fields, so there is no conformance clause to name | 0 | 0 | — | — | — | — | — | — |
| `overrides` | no — RULED, ZIG.O.3, instrument B: 3 duplicate-function, 14 duplicate-binding, 9 duplicate-member occurrences, and every surviving one is a file documenting the compiler's REJECTION | 0 | 0 | — | — | — | — | — | — |

**`script/m14/ontology-coverage-gate.ts zig` does not reach a verdict on this
corpus, and the reason is the shared gate's, not this lane's.** The gate scans the
whole corpus BEFORE it checks `RULED_BY_LANG`, so it is subject to the same
single-process WASM degradation as the census: two runs ended in
`[BB-HANG] parser stuck 120s on zig/lib/std/testing.zig — exiting` with no verdict
printed. The refusal branch itself is real and was demonstrated by pointing the
gate at an empty corpus root (`BB_CORPUS_ROOT=<empty>`): it then prints "no RULING
TABLE for zig" and **exits 2**, because `RULED_BY_LANG` in that shared file holds
only `bash` and `json`. **An earlier revision of this document stated the exit-2 as
the observed outcome of a normal run; that was not what a normal run does, and the
statement is corrected here.** The gate is read-only and shared (§8), so this lane
measured the three rulings with its own instruments and the spec decisions
`ZIG.O.1`–`ZIG.O.4` carry the written reason, the instrument, the probe and the
overturn condition the gate looks for. See the report item.

### The three RULED types, each falsifiable

A ruling that cannot be overturned is an assertion. Each of these names the probe
and the count that would kill it. **All three were re-run on 2026-10-03 over the
same 3,834-file draw (`sha256:2f3545f9…`) and every count is unchanged** — 239
declared node types, 16 declared field names, 28 of 28 inheritance words absent
from both, A4's 1,797 header-slot children with **0 UNCLASSIFIED**, B1 = 3, B2 = 14
(9 destructuring / 5 plain), B3 = 9 with 0 outside `compile_errors/`, and 12 of 12
controls as expected.** A ruling that has not been re-read is not a ruling; this
one survives the re-read.

**`extends` — instrument A (grammar-inventory).** The pinned wasm's own
`Language.types` declares **239** entries and `Language.fields` declares **16**
(`alternative, argument, body, condition, error, function, index, left, member,
name, object, ok, operator, right, sentinel, type`). Of **28** probed inheritance
words (`extends, implements, inherits, class, interface, trait, protocol,
superclass, super, bases, interfaces, override, overrides`, …) **0 are present as
a node type or keyword and 0 as a field**. `Language.types` carries the ANONYMOUS
TOKEN types as well as the named ones — calibrated by asserting that **11 of 11**
tested zig keywords (`fn, const, var, pub, struct, enum, union, opaque, error,
comptime, usingnamespace`) are present in it — so this also answers the decisive
zig question: `extends` is an ordinary IDENTIFIER there, so a text probe for it
would match any variable with that spelling, which is the false-positive class the
coverage gate's own header records.
**A4**, the position test an inventory cannot substitute for: the non-member
children of every `struct`/`enum`/`union`/`opaque`/`error` declaration, counted on
the tree and then **classified** — **1,797 across 443 files**, as 1,030
`enum-backing-type`, 275 `packed-struct-field-count`, 369 `nested-executable-block`,
122 `union-tag-type`, 1 `error-recovery`, and **0 `UNCLASSIFIED`**. `UNCLASSIFIED`
is the only bucket a supertype slot could occupy. A4 is deliberately not published
as a bare count: an earlier run published 2,168 with no classification, which reads
as a non-zero and would have overturned the ruling for the wrong reason.
**Overturn condition:** any of (a) `UNCLASSIFIED` > 0, (b) any of the 28 words in
`Language.types` or `Language.fields`, (c) a container declaration carrying a named
child that is not a backing type, packed field count, union tag or nested
executable block.

**`implements` — instrument A, the same run.** Same tables, same zero. Zig models
an interface as an `opaque` container plus a table of function POINTERS, and a
pointer-to-function type is a `function_signature` with no declaring name (ZIGD2:
960 `function_signature` nodes corpus-wide, all the anonymous fn-type form). There
is no conformance clause for an edge to point at. **Overturn condition:** identical
to `extends` (a)–(c); an `opaque` declaration carrying a named child other than its
members is the shape that would do it.

**`overrides` — instrument B (parse-tree-count).** Zig has no `override` keyword
(0 of 28 in the keyword table) and no vtable slot. The only thing that could stand
in for an override is a redefinition, and **a same-scope duplicate declaration in
zig is a compiler diagnostic** ("duplicate struct member name"), not a language
feature — so the corpus contains files that are MEANT to fail, and they document
the compiler's REJECTION. Three probes over the full corpus:
- **B1** duplicate `function_declaration` in one scope: **3 occurrences in 3 files**,
  and all 3 are test cases carrying the compiler's own rejection text in a comment
  (`zig/test/cases/compile_errors/colliding_invalid_top_level_functions.zig`,
  `…/multiple_function_definitions.zig`, `zig/test/cases/function_redeclaration.zig`,
  whose body reads `:2:4: error: duplicate struct member name 'entry'`).
- **B2** duplicate `const`/`var` binding in one scope: **14 in 11 files**,
  decomposed — **9 are zig destructuring** (`x, const y, var z: u64 = .{1,2,3}` is
  ONE declaration with several binding slots, a legal rebinding) and 5 are plain
  rebinding, and every plain one sits in a `compile_errors/` or `redefinition_of_*`
  case. All 8 hits outside `compile_errors/` are destructuring.
- **B3** duplicate member in one container: **9 in 8 files, 9 of 9 inside
  `compile_errors/`, 0 outside.**
**Overturn condition:** any of (a) a duplicate-declaration hit outside
`zig/test/cases/` that zig COMPILES, (b) a B3 count > 0 outside `compile_errors/`,
(c) `override`/`overrides` appearing in `Language.types`.

### The six questions, per emitted type

Resolution is reported at two tiers, and the tier is named because a single number
has to pick one and each under-reports differently. **File-local** = the name is a
symbol in the SAME file, which is the strict reading and which calls every `std.*`
leaf dangling. **Corpus-tier** = the name is a symbol anywhere in the draw, which is
the reading a whole-repository index can satisfy and which is capped by a 3,834-file
draw's coverage. A `(global)`/`(file)`/`(declared-type)` source is a SCOPE MARKER,
not a symbol, and is counted apart from a source that fails to resolve.

1. **Exists** — derived from source; each of the seven is constructed by a named
   branch, and the branches are listed under **Relationships** above.
2. **Fires** — measured, not derived. Every one of the seven produces edges on this
   corpus (counts in the table below), so none is dead code. This question fails
   independently of existence and source-reading cannot answer it.
3. **Correct** — `script/m14/differential.ts` (F5) and the lane's own
   `zig-truth.ts` oracle, which report 0 unexplained and 0 missing over a 400-file
   draw. **Declared limitation, and pass 2 sharpened it from "shares the grammar"
   to "shares the RULES":** `zig-truth.ts`'s `leaf()` is the analyzer's type-leaf
   rule line for line and its `enclosing()` is the analyzer's nearest-declaration
   rule, so a wrong RULE is invisible to the agreement number, not merely a wrong
   grammar. **Pass 2 therefore does not take the agreement number as the answer to
   this question at all**: probes A2, A3, A4, A7 and A9 ask the analyzer's own output
   a question the oracle does not, and they find **4 defect classes the differential
   scores as 100% agreement on** (759 wrong-source rows, 75 wrongly-named declared-type
   targets, 615 unbindable `instantiates` targets, 3,721 name-ambiguous `contains`
   owners). The grammar's own defect extent is measured separately below.
4. **Labelled** — the classes are disjoint by construction and gated per class:
   `calls` only from a `call_expression` callee leaf, `uses` only from a
   `field_expression` that is not the callee or a plain-`=` assignment LHS, or a
   bare `identifier` read, `references` only from the grammar's `type` field or an
   import site, `exports` only at file scope. `metadata.relationshipType` carries
   the reason code on every edge and every edge carries an `evidenceClass`.
   **Pass 2 tested this per class rather than by construction: 0 of 113,476 `calls`
   targets name a reserved spelling or an intrinsic, 0 of 132,201 `uses` targets
   contradict their reason code at their own line, 0 of 24,114 `exports` targets name
   a non-public symbol — and 75 `references` targets are not type names, which is
   the one class where the disjointness holds but the CONTENT does not.**
5. **Resolved** — measured per type below, at both tiers. **The CSS `references`
   reference point is 66.8% at both ends; this lane's `references` is 74.03% at the
   corpus tier.** **Pass 2's finding is that a name-keyed rate is the wrong
   instrument here**: resolution measured by NAME reads `calls Hash -> init` as
   resolved because `Hash` is a symbol, when the `Hash` in question is a struct and
   the caller was a test. Adding an IDENTITY tier takes `calls` sources from a
   published 0.00% dangling to **0.49% bound to something that is not callable**, and
   `instantiates` targets from 85.72% file-local to **85.72% file-local with 14.28%
   naming a container the analyzer publishes nothing for**. Both numbers are
   reported; neither replaces the other.
6. **Confident** — **0 of 392,550 edges are below 0.7** in the sharded re-measurement,
   and **pass 3 reproduced that 0 exactly** on a run where all eight shards
   reported no fallback. It is a per-run figure and not a per-lane one: the same
   draw at the same commit also produced 21 sub-0.7 edges from three degraded
   shards (pass 1 published 7 of 392,086, all from the fallback path). The
   analyzer's OWN sub-1.0 values do not vary with the run, and those are what the
   next sentence is about. The sub-1.0 edges the analyzer
   itself emits are 0.75 (field read), 0.85 (call) and 0.9 (import / declared type),
   each carrying a machine-readable `metadata.relationshipType`. The heuristic ratio
   is countable and it is ~0 for every class this lane emits — **which is a
   statement about the numbers the analyzer assigns, not about the edges: probes
   A2/A3 show the class labels are right, and A4/A7/A9 show that a right label on a
   wrong endpoint is still a wrong edge, and no confidence value on this lane
   distinguishes the two.**

**Two classes of output do not come from this analyzer, and are reported rather than
absorbed into its numbers.** `parseFile`'s parse-error branch returns
`extractFallback(...)`, a REGEX-based extractor in shared machinery
(`src/ast/pool-worker.ts`) whose `BasicSymbol` carries `type` and **no `kind`**. It
fires for the files whose wasm parse traps or exceeds the hang guard. **Its corpus
extent is not a stable number, and passes 2 and 3 both measured
why.** A single long process over
the 3,834-file draw trapped with `memory access out of bounds` on two files
(`zig/src/link/C.zig`,
`zig/test/cases/compile_errors/extra_comma_in_destructure.zig`), and a third run
trapped on `zig/lib/std/testing.zig`; pass 1's run produced **192 symbols with an
empty `SymbolKind`** and **7 `calls` edges at confidence 0.4/0.5 tagged
`metadata.method: "regex"` from this branch. **Eight sharded runs of the same draw
at the same commit produce 0 and 0.** One of pass 1's fallback edges carried
`source: "this"` — a caller name no zig file declares, which is exactly the
fabricated-edge class the workstream's fabrication rule is about, and it is
reachable only through this branch. This is **not** caused by Z59: the identical
400-file draw was measured on both sides of that change and reports 0 kindless
symbols and 0 sub-0.7 edges on both. The fix belongs in shared machinery and is
stated in the report: a WASM trap must not be silently downgraded to a regex
extraction, and the 120 s guard must not take the whole process down with it.

## Pass 2 — the adversarial audit (2026-10-03)

Pass 1 answered the six questions at the level "does the aggregate number hold".
That level cannot find a wrong edge: a census COUNTS edges and counts a false one
exactly as readily as a true one. Pass 2 asks each question the other way — for
every emitted type, find a case where the label or the endpoint is WRONG — with one
new instrument.

**Instrument.** `validation/m14/fixtures/zig/pass2-adversarial.ts`, run through
production `parseFile` over the same 3,834-file draw (`sha256:2f3545f9…`), in the
same 8 shards, merged by `merge-pass2.py` with the derived ratios RECOMPUTED from
the summed primitives (summing eight per-shard percentages produced a first version
of this merge that reported "3606% sites per edge", which is how a merge bug and a
corpus finding look identical). Production facts come from `parseFile` and nothing
else; tree facts come from a second parse of the same bytes through the same pinned
wasm. The two paths are separate on purpose — the point is to ask the analyzer's
OUTPUT a question the analyzer did not answer, and a tree walked by the analyzer's
own code agrees with it by construction.

**45 controls, 0 failing.** Every line-level predicate is a pure function of
(line, name) and its controls are direct calls on strings, so a control cannot be
satisfied by an unrelated code path and a zero it certifies is a zero about the
predicate rather than about the run. Every tree-level walker gets a synthetic
snippet it must find.

**The whole audit was run twice, end to end, and 0 of 91 compared fields differ**
(same draw, same commit, eight fresh shards each time). That is the reproducibility
claim for every number in this section, and it is a claim about the instrument
rather than about the analyzer: the same two runs of the CENSUS, by contrast, did
not agree with each other until they were sharded — see the ontology section for
why.

### The one methodological trap, and why the code is built around it

An edge carries a LINE, not a column. `hash -> hash` at
`std.hash.Wyhash.hash(pp.prefix, …)` is a TRUE edge whose target appears three times
on that line, once as a call. A probe that reads the FIRST whole-word occurrence
reports a defect that does not exist — and written that way it "found" 143 false
positives in 480 files on the first run, and 1,137 / 14,701 over the corpus. That is
the same mistake this lane's own history records six times (Z24, Z25, Z29, Z34,
Z41, Z43: a name rule applied on one side of a comparison and not the other).

So every line-level probe asks the ANY-occurrence question, and the weaker
first-occurrence count is published BESIDE it, labelled as the weaker thing it is.
Four Zig spellings each had to become a named rule with its own controls, because
each produced false positives before it was named:

| spelling | the `.` is really | control |
|---|---|---|
| `many_u32[0..runtime_index]` | the second half of the `..` RANGE operator | the range arm and `a[0..b.c]` |
| `error.CacheCheckFailed` | an ERROR-SET LEAF, which in Zig resolves by name | the leaf arm and `self.error` |
| `@typeInfo(T).@"struct".backing_integer` | a QUOTED member (M60 strips the quotes from the name) | the member arm and `@"weird function name"()` |
| `try expect(@"weird function name"())` | the leaf is followed by `"` then `(` | the call arm and a quoted non-call |

### Per-probe result, and the argument each type's strongest opponent would make

| probe | question | denominator | findings | rate |
|---|---|---|---|---|
| A1 | does a `calls` target name something the pinned grammar RESERVES? | 113,476 `calls` | **0** `@`-prefixed, **0** reserved spellings, **0** digit-headed, 2 quoted names | 0% |
| A2 | at its recorded line, is a `calls` target CALLED at all? | 113,476 | **0** absent from the line, **0** with no call occurrence (weaker first-occurrence variant 1,137) | 0% |
| A3 | at its recorded line, does a `uses` target match its reason code? | 132,201 | **0** absent, **0** field edges with no member occurrence, **0** bare reads with no bare occurrence (weaker variant 14,701) | 0% |
| A4 | does an `instantiates` target bind to a symbol this analyzer PUBLISHED? | 4,306 | **615** | **14.28%** |
| A5 | does a `contains` owner bind to exactly one container? | 77,459 | **1** unresolved, **3,721** ambiguous; **96** owner→member pairs at two different lines | 4.80% ambiguous |
| A6 | does an `exports` target bind, uniquely, to a PUBLIC symbol? | 24,114 | **3** unresolved, **0** not public, **494** ambiguous | 2.05% ambiguous |
| A7 | is a declared-type target really a type name, and how many sites collapse into one edge? | 20,594 | **24** unquoted keywords, **3** digit-headed, **48** whose leaf is a VALUE position; **93,601** tree sites = **454.5%** sites per edge, max **444** sites on one edge | 0.14% / 0.01% / 0.23% |
| A8 | is every import edge backed by an `@import` site, and is the path on its line? | 20,400 | **0** paths absent from the line; **20,396** spell `@import`, **4** lines carry no import token; **0** files anywhere in the corpus have a bare `import` callee identifier | — |
| A9 | does a `calls`/`uses` SOURCE bind to something CALLABLE? | 100,397 + 102,487 named sources | **494** `calls` + **265** `uses` sources bind to a struct, type, constant or union | 0.49% / 0.26% |
| A10 | is a non-callable source a NAMED TEST? | the 759 non-callable sources | **759**, and **0** that are not | 100% |
| A11 | does a `payload` bind an identifier the language never declares there? | 29,222 identifiers under payloads | **0** non-declared, **0** shadowing a file-scope value | 0% |

**A1–A3 are the strongest argument the three big classes had against themselves, and
the corpus refuses it.** `calls` publishes no reserved spelling and no intrinsic;
every `calls` target is called at its own line under the any-occurrence rule; every
`uses` target matches its reason code at its own line. **A11 closes a registered
defect class with a number rather than a caveat**: `bindIdentifiersUnder` binds
every identifier under a `payload`, which the M49 W9 note describes as a live
unsoundness ("a name that appears only in a parameter's type becomes a binding and
shadows the real file-level value"). Over the whole corpus a Zig `payload` contains
**29,222 identifiers and not one of them is anything other than a direct capture
child** — the class is structurally unreachable in this grammar, and the Z7 fix in
the parameter path plus the shape of `payload` are why. The limitation stands as a
shape statement, not as an unmeasured risk.

**A8 retires a live-but-unexercised branch.** `collectZigImportSites` accepts a bare
`import` identifier as well as `@import`/`@cImport`, and **0 of 3,834 files contain a
`call_expression`/`builtin_function` whose callee is the bare identifier `import`** —
so that disjunct is exercised by nothing and reads exactly like a working one. The 4
edges whose line carries no import token are the multi-line `@import(` shape
(`zig/test/cases/compile_errors/bad_import.zig:1-2`): the edge's line is the path
LITERAL's line, which is M59.A7's rule, not a miss.

### The four classes that ARE wrong, with the count for each

**1. An edge SOURCE that names an entity which is not the caller — 759 edges
(0.49% of `calls` sources, 0.26% of `uses` sources).** Z39 makes `test foo { … }` a
scope with a name and attributes the calls and reads inside it to `foo`, while the
analyzer publishes no symbol for a test (the shared `SymbolKind` has no `Test`
member). When the test's name happens to coincide with a declaration in the same
file, the edge's source silently resolves to THAT declaration, and the graph says the
struct calls the function:

- `zig/src/Package.zig:195` `calls Hash -> init` where the source kinds are `{struct}`
  — `pub const Hash = struct {…}` at line 48, and `test Hash {` at line 190.
- `ghostty/src/benchmark/Benchmark.zig:157` `calls Benchmark -> init`, source kinds
  `{type}` — `const Benchmark = @This()` at line 2, `test Benchmark {` at line 136.

**All 759 are a named test and 0 are anything else** — one cause, measured, not a
coincidence of the sample. That is also the sharpest statement of why the lane's
resolution rates are flattered: the census reports `calls` source dangling at
**0.00%** because it resolves endpoints BY NAME, and `Hash` is in the file. The
identity question and the name question give different answers, and only the second
one is what the published rate measures. This is the fabricated-caller class the
workstream's rule names, in the one form where the CALL is real and the SOURCE is
not.

**2. A declared-type reference whose TARGET is not a type name — 24 + 3 + 48 edges
(the three arms are not additive: `c` and `16` are counted by more than one).**
`references (declared_type)` reads the type leaf as "the last `identifier` at or
under the grammar's `type` field". For a function-POINTER type that is the CALLING
CONVENTION, not the return type:

- `ghostty/src/apprt/embedded.zig:50` `wakeup: *const fn (AppUD) callconv(.c) void`
  publishes `references -> c`, and `c` is in the grammar's own 239-entry type table.
- `zig/test/behavior/fn.zig:154` `ptr: *const fn () callconv(if (…) .{…} else .c) i32`
  publishes `references -> c` and never `i32`.
- `zig/lib/std/heap/memory_pool.zig:366` `var pool: Aligned(Foo, .@"16") = .empty;`
  publishes `references -> 16`. **The analyzer's own digit-head guard is written to
  refuse exactly this** (`const c0 = head.charCodeAt(0); if (c0 >= 48 && c0 <= 57) return`),
  and it does not fire, because the guard reads the QUOTED spelling `"16"` while
  `canonicalizePublishedNames` strips the quotes afterwards. A guard applied to the
  pre-canonical spelling is a guard on a string the analyzer does not publish.
- `zls/src/DiagnosticsCollection.zig:20` publishes `references -> empty`, an enum
  literal in a value position.

**3. An `instantiates` TARGET the analyzer declines to publish — 615 of 4,306
(14.28%).** This is the TARGET-side twin of Z59, which fixed the SOURCE side only.
`analyzeZigInstantiation` builds its `typeNames` from every container declaration the
tree bears, including one declared inside a function or test body — which the Z22 /
C-negative contract correctly declines to publish, because a local type has no
file-scope identity. `zig/lib/std/meta.zig:604-610` declares `const U = union(UE)`
inside `test activeTag`'s body and then writes `var u = U{ .Int = 32 };`, so the
analyzer emits `instantiates activeTag -> U` for a construction that is REAL and a
type the index will never hold. 561 of the 615 are constructions, 54 generic
applications, 110 sit inside a named test. The edge is not fabricated — dropping it
would lose a true fact — and unlike the source side there is no nearer published name
to fall back to. It is reported here as a resolution rate, on the same terms as the
`imports` target below, and the honest alternative (publishing every local container
as a symbol) would reverse a ratified decision about what a symbol is.

**4. `contains` is keyed on a NAME, and the corpus has same-named containers —
3,721 of 77,459 edges (4.80%) name an owner that matches two or more containers in
the same file, and 96 edges are the same (owner, member) pair at two different
lines.** `zig/lib/compiler/aro/aro/pragmas/gcc.zig` declares `const Diagnostics =
@import("../Diagnostics.zig")` at file scope (line 5) and `const Diagnostics = enum
{…}` nested in `Directive` (line 31), so `contains Diagnostics -> ignored` cannot
say which. `ghostty/src/terminal/clipboard.zig` publishes `contains Status ->
success` at both line 112 and line 205 for two different enums. The store resolves
ownership by extent (`enclosingStoreableIdByName`), so the index is not ambiguous —
the EDGE is, and a consumer reading the relationship alone cannot tell. Not fixable
in the analyzer: an edge keyed on a symbol id would be a different relationship type.

### Why none of the four was fixed here, stated as a rule and not as an excuse

Each of the four changes the SET of edges the analyzer emits, and this lane's oracle
mirrors the analyzer's rules rule-for-rule: `script/m14/zig-truth.ts`'s `leaf()` is
the analyzer's "last identifier under the type node" line for line (its own header
says "The leaf rules below MIRROR the analyzer's"), and its `enclosing()` is the
analyzer's nearest-declaration rule. A unilateral analyzer fix therefore turns the
lane's own source-keyed gate `zigw-uses-calls.ts` red against an oracle that
reproduces the very defect being fixed — the "mirror that reproduces the defect it
is meant to convict" failure this file's own comments warn about, in the one place it
is hardest to see. `script/m14/zig-truth.ts` and `script/m14/completeness-inventory.ts`
are §8 shared files; the change each defect needs is written out precisely in the
report so it can be applied without re-deriving it. **Nothing in this lane's
committed output was changed in pass 2 except the instruments and this document.**

### What the shared F5 differential can and cannot see, as a number

The lane-owned differential reproduces the shared harness's semantics exactly (same
`normTarget`, same `label + normTarget(target)` key) over a 400-file draw and reports
**60,280 truth rows, 100.00% covered, MISSING 0, unexplained 0 of 56,906 analyzer
edges, and 0/0 on the STRICT axis too**. That is true and it is the ceiling of what it
can show, for two structural reasons now measured rather than asserted:

1. **it discards the SOURCE**, so all 759 class-1 rows read as covered — the label and
   the target are right and the caller is not;
2. **the oracle mirrors the rules**, so class 2 (a wrong type leaf) and class 3 (a
   target from an unpublished container) are cases where both walkers are wrong in
   the same direction. The workstream's own framing applies: nothing agrees with
   nothing, and here nothing disagrees with itself.

That is why the pass-2 instrument exists, why it asks the OUTPUT rather than the
code, and why its findings are reported per type rather than as an aggregate
agreement figure.

### DERIVATION findings

**0**, as a NUMBER, re-measured 2026-10-03.
`script/m60/rel-type-coverage-gate.ts --langs=zig` reports CHECK 1 (DERIVATION —
every emitted type has an oracle derivation) clean, CHECK 2 (REACHABILITY) clean,
CHECK 3 (AGREEMENT) clean, CHECK 4 (ENUM) clean, baseline "104 recorded, 0 NEW,
104 repaid". That matches the handover figure for this lane, and it is a count of
TYPES, not of oracles: CHECK 1 asks whether each emitted type is in the language's
audited-label set in `script/m14/differential.ts`, and all seven emitted types are.

**"Audited" is not "independent", and the pass-2 audit is what makes the
difference visible.** `script/m14/zig-truth.ts` states in its own header that its
leaf rules "MIRROR the analyzer's", and its `leaf()` is the analyzer's
"last `identifier` at or under the type node" rule line for line; its
`enclosing()` is the analyzer's nearest-declaration rule. So a DERIVATION count of 0
means every emitted type is compared against SOMETHING, and what that something is
worth is a separate question — answered below, with numbers, by an instrument that
does not share the analyzer's rules.

### Grammar defect extent (Z42, re-measured at full corpus)

`parse-defect-census.ts` over the same 3,834 files: **810 ERROR nodes in 92 files
(2.40%)**, **44 MISSING nodes in 28 files (0.73%)**, bucketed by the node the
defect sits in — `ERROR in asm_expression` 335 (inline assembly the pinned grammar
cannot parse), `ERROR in field_expression` 212, `ERROR in initializer_list` 120,
`ERROR in call_expression` 46, `ERROR in variable_declaration` 32,
`MISSING ; in variable_declaration` 32, and 25 further classes of 1–18. Each bucket
carries a source snippet in the evidence file so the trigger is visible rather than
described. The two NAMED defect classes this lane pinned —
`ERROR_CHILD_COMMA` (a container carrying an `ERROR` child whose text is `,`) and
`MISSING_BRACE` — are **0 over the whole corpus**, and that zero is calibrated: both
fire 1 on their positive controls and 0 on their three negatives, so the probe can
see the shape and the corpus does not use it. One corpus file, `ghostty/src/Command.zig`,
contributed 9 of the 44 MISSING nodes through a labelled range
(`if (c) c_int else u32` parses as a range), and `zig/lib/std/Io/{IoUring,Kqueue}.zig`
account for most of the async/await and `MISSING }` rows.

## Pass 3 — the third reading, and a correction to pass 2's headline number

Pass 2 asked each emitted type for a case where its label or its endpoint is
wrong, and found four. Every one of its thirteen probes begins from a branch in
`real-zig-analyzer.ts` — from a reason code, a metadata key, an emission site.
That is the right way to find a bug in a rule you can see, and the wrong way to
find a bug in a rule you cannot: **every suppressor is a branch whose firing is
invisible in the output, because the output is the set of edges that survived
it.** A suppressor that fires when it should not produces a MISSING edge, and a
missing edge is invisible to every count in this lane — a census counts what was
published, so a loss reads as the same number as a correct run.

So pass 3 is built from LOSS probes and from SHAPE probes, and it re-asks
pass 1's and pass 2's published numbers for reproduction.

**Instrument.** `validation/m14/fixtures/zig/pass3-adversarial.ts`, run through
production `parseFile` over the same 3,834-file draw
(`sha256:2f3545f92c470090d61c9a745bb427d8d7dec1630d93d0fbc01cb2acdc5ce1ac`), in
8 shards, merged by `pass3-merge.py` with every ratio recomputed from summed
primitives and the union hash asserted against the published draw. Tree facts
come from a second parse of the same bytes through the same pinned wasm.
**27 controls, 0 failing** — 13 pure-predicate controls and 14 END-TO-END ones
that call the same `probeFile` over synthetic files whose right answer is known,
in both directions. The end-to-end half is not decoration: P1's denominator was
**0** on a 40-file draw before it existed, which is indistinguishable from a
probe that cannot see, and the positive control
(`const Foo = 1; fn f() !void { return error.Foo; }`) fires.

### THE CORRECTION: the fallback figure was a property of one run

The ontology section above states, from pass 2, that the run's sharded
re-measurement reports **0 symbols outside `SymbolKind` and 0 edges below 0.7**,
and attributes pass 1's 192 kindless symbols to how the run was sharded.
**Pass 3 re-ran the identical draw at the identical commit, in the same eight
shards, and read 510 kindless symbols and 21 sub-0.7 edges** — three shards of
eight degraded. So the "0" is not a property of the lane; it is a property of a
run. Repeated, it has a rate, and the rate is now measured by a committed script.

`validation/m14/fixtures/zig/fallback-degradation-rate.py` re-runs the eight
shards concurrently and one at a time and counts `parseFile` results carrying
`fallback: true`. **Measured, 4 concurrent rounds x 8 shards against 8 sequential
shards, every one a full 3,834-file parse of the same draw at the same commit:**

| | degraded shard-runs | files that fell back | kindless symbols seen | sub-0.7 edges seen |
|---|---|---|---|---|
| **concurrent** | **6 of 32** | **7 of 14,856** | 0 / 4 / 4 / 145 across the degraded rounds | 0 / 1 / 0 / 9 |
| **sequential** | **0 of 8** | **0** | 0 | 0 |

One concurrent round lost a shard process outright — 3,354 files parsed where
3,834 were asked for, with no raw dump — which is the `[BB-HANG] parser stuck
120s` self-destruct pass 2 reported and this script's fourth signature. Across
every concurrent measurement in this lane the cumulative figure is **12 degraded
shard-runs of 64**, against **0 of 11 sequential**. So the degradation is a
property of CONCURRENCY, established by a controlled comparison rather than
inferred from a symptom — and the operational consequence is immediate: **shard
this lane SEQUENTIALLY, or check `fallbackFiles` before believing a merge.**

The stderr signatures, as recorded by the script:

    2x  Language.load failed for zig: need to see wasm magic number
    1x  Language.load failed for zig: WebAssembly.instantiate(): section (code 10, "Code") extends past end of the module (length 18911, remaining bytes 12029) @+255
    1x  Language.load failed for zig: <empty message>

and, from the pass-3 run of the shared arbiter, a fifth:

    [BB-PARSE-ERR] zig | zig/test/cases/compile_errors/non_int_passed_to_floatFromInt.zig | memory access out of bounds

Every one of them ends in the same place, and that is the point: **the message
varies and the consequence does not.**

The mechanism is not a mystery and it is not in this lane:

- `resolveWasm("tree-sitter-zig/tree-sitter-zig.wasm")` in `src/ast/engine.ts`
  walks its candidates, and in a worktree whose `node_modules` is symlinked from
  another checkout every step misses — including
  `node_modules/tree-sitter-wasms/out/`, the collection this grammar's bytes are
  byte-identical to per the provenance note above.
- It therefore reaches its LAST fallback, which writes the grammar to
  `os.tmpdir() / ("bb-wasm_" + relativePath.replace(/\//g, "_"))` —
  **`/tmp/bb-wasm_tree-sitter-zig_tree-sitter-zig.wasm`**, a name derived only
  from the grammar. Every process that parses a zig file writes that path and
  then reads it back. `writeFileSync` truncates before it writes, so a reader in
  another process can observe a short file.
- `Language.load` then throws, with one of two messages recorded on real runs:
  `need to see wasm magic number`, and
  `WebAssembly.instantiate(): section (code 10, "Code") extends past end of the
  module (length 18911, remaining bytes 12029) @+255`.
- `pool-worker.parseFile`'s `catch` converts that into `extractFallback`, a
  REGEX extractor, **silently**. That file's real graph is replaced by
  regex-derived symbols carrying no `kind` and edges at confidence 0.4/0.5,
  including `calls this -> …` — a caller name no zig file declares, which is the
  fabricated-edge class the workstream's rule names, reachable only here.

**What changed in this lane's own instruments because of it.** Both merges now
REFUSE a degraded shard rather than publishing a mixture, and both census and
audit report the count:

- `ontology-census.ts` counts `fallbackFiles` and prints
  `parseFile FALLBACK files N`, with N > 0 flagged as *"this run is a MIXTURE of
  the analyzer and extractFallback"*.
- `shard-merge.py` exits 3, naming the shards, instead of summing them.
- `pass3-adversarial.ts` counts it per file and `pass3-merge.py` exits 3.

**What did not change.** On a run where every shard reports 0, the published
census reproduces EXACTLY: **127,429 symbols, 392,550 relationships, 0 empty
names, 0 kinds outside `SymbolKind`, 0 edges below 0.7**, and P5 independently
maps **127,429 of 127,429** published symbols back to the grammar node each was
read from. The numbers are right; what was wrong was calling a single run's
value a property.

### Per-probe result

| probe | question | denominator | findings | rate |
|---|---|---|---|---|
| P1 | is an `error.X` leaf charged to a symbol that is not an error-set member? | 32 candidate reads in 5 files | **4** | 12.5% |
| P2 | does a destructuring declaration bind every slot it declares? | 903 declarations, 1,033 non-first slots | **0** colliding, **0** wrong | 0% |
| P3 | is the RECEIVER of a method call — a bare read — ever published? | 25,048 receivers naming a file-scope value | **683** lost, +115 ambiguous on alias receivers | 2.73% / 0.46% |
| P4 | does an edge's SOURCE disagree with the named scope its recorded line sits in? | 249,983 `calls`/`uses`/`instantiates` | **0**; +5,643 inside an UNPUBLISHED local scope | 0% |
| P5 | does a published symbol's KIND match the grammar node it was read from? | 127,429 symbols | **127,429 mapped, 0 unmapped, 0 start-index collisions** | 100% mapped |
| P6 | does an `instantiates` target bind to the kind its own reason code claims? | 4,306 | **10** wrong kind, **615** unbound — one root cause, 625 edges | 14.51% |
| P7 | does the tree say the named owner declares the named member? | 77,459 `contains` | **0**; 170 owner-unknown | 0% |
| P8 | is an `exports` target declared at file scope? | 24,114 | **1** self-referential name, **3** dangling | 0.004% |
| P9 | how many tree sites collapse into one published edge? | see below | `calls` 2.71, `uses`(field) 7.84, `uses`(bare) 39.27, `references`(declared type) 3.19, `instantiates` 2.97 sites per edge | — |

### The two classes that ARE wrong, and the one hypothesis that was refuted

**1. A bare read of a file-scope value as the RECEIVER of a method call is never
published — 683 edges' worth of LOSS, 2.73% of 25,048.** The call edge is right
(`fromInterned(x).put(...)` calls `put`) and the receiver read is a real read of a
real declaration that the index holds, and nothing publishes it:
`zig/src/Value.zig:2555`, `2806`, `2813`, `2836`, `2847`, `3015` and 677 more
name `fromInterned`, a file-scope `fn` used as a receiver. The cause is
`isCallCallee` in the bare-read pass: it walks up from an identifier to the
enclosing `call_expression` and treats the whole callee subtree as the callee,
so the OBJECT of `a.b()` is suppressed along with the member leaf. The class is
invisible to every gate in this lane by construction — a differential asks
whether a published edge is explained, and this is the absence of one. **115
further rows are counted separately and NOT charged**: their receiver is bound by
a qualified-path alias (`const cmath = math.complex;`), which is indistinguishable
from a value by name. A further set is excluded entirely — a receiver bound by
`@import` is a module, and `std.mem.copy(…)` reads `copy`, not `std`; counting
those made the first draft of this probe report 107 losses in 146 rows, all of
them `uses -> std`.

**2. An `error.X` leaf charged to a symbol that is not an error-set member — 4
edges.** `zig/test/behavior/underscore.zig` declares
`fn optionalReturnError() !?u32 { return error.optionalReturnError; }`: the name
is BOTH a function and the error member it returns. The bare-read gate is
`fileValues.has(name) || (inError && enumMemberNames.has(name))` — an `or`, so
the function alone admits the read, and the published target resolves to the
function. Three of the four are in that one file; the fourth is
`zig/test/cases/compile_errors/binary_OR_operator_on_error_sets.zig:1`, where the
name is a constant. Every other one of the lane's error-leaf reads (28 of 32)
charges an actual error-set member.

**3. An `instantiates` construction of a container the analyzer declines to
publish — 615 unbound targets, plus 10 more where the name collides with a
published non-container symbol and so reads as bound to the WRONG KIND. 625 of
4,306 edges (14.51%).** P6 splits the two forms, because asking one question of
both convicts the analyzer on every generic application:
`isGenericTypeApplication` names a generic FUNCTION (`Once(u8)` instantiates
`Once`, published `function`) and only `isConstructorApplication` must name a
container. With the split, **0 of the applications are wrong** and both arms are
the same root cause: a construction of a type declared inside a function or test
body, which Z22 correctly declines to publish because a local type has no
file-scope identity. The 615 reproduce pass 2's class 3 (ZIG.O.4) to the edge.
The 10 are the subset where the unpublished local's name happens to match a
symbol the file DOES publish, of a kind that cannot be constructed — so the
target resolves and resolves wrong, which is the more misleading of the two
shapes. All 10 are in one file, `zig/test/behavior/union.zig:625-627` and
`1016-1023`, where `const A = struct { b: B };` is declared inside
`fn doTheTest()`'s block and written `A{ .b = B{ .c = C{} } }`, while a union
field or enum member named `A` elsewhere in the same file is published as a
`property`/`enum_member`. Finding them needed its own example bucket: the unbound
arm is 60x larger and shares the row cap, so the 10 rarer rows were counted with
zero examples until the two were split.

**4. REFUTED — the destructuring hypothesis.** `const a, const c = .{1,2}` is ONE
`variable_declaration` with two binding slots, the analyzer binds the first and
breaks, so a read of the second should resolve outward to the file-scope
declaration of the same name. **Over the corpus: 903 such declarations, 1,033
non-first slots, and not ONE of those slot names is declared at file scope in the
same file.** The class is empty, and the honest statement is that the rule is
latent rather than wrong — it would misattribute a read the moment a file
shadowed a global with a destructuring slot, which no file in this corpus does.
Getting to that zero took two corrections to the probe itself, and both wrong
versions manufactured a defect class out of correct code: "two or more direct
`identifier` children" convicts the analyzer of 128 wrong edges (`pub const Error =
IteratorError;` has two — the bound name and a right-hand-side READ the analyzer
publishes correctly), and "identifiers before the `=`" convicts it of 38 more
(`var dummy_execute_header: mach_hdr = undefined;` puts the TYPE between the name
and the `=`). The shape that is actually a destructuring has a COMMA between its
slots before the `=`. This is the same mistake this lane's history records six
times — a rule applied on one side of a comparison and not the other — committed
by the instrument rather than the analyzer, which is why the controls exist.

### P5 — the symbol-level label question nothing had asked

Every label question in passes 1 and 2 was asked about EDGES. P5 asks it about
SYMBOLS, by mapping each published symbol's `startIndex` back to the grammar node
it was read from on an independent parse. **127,429 of 127,429 map; 0 unmapped; 0
start-index collisions.** The resulting (kind ← node-type) histogram is the
first published evidence for this lane that a symbol's kind matches the
declaration form it came from:

| count | kind ← node type | | count | kind ← node type |
|---|---|---|---|---|
| 33,242 | `enum_member` ← `container_field` | | 5,378 | `struct` ← `variable_declaration` |
| 22,262 | `constant` ← `variable_declaration` | | 1,974 | `enum` ← `variable_declaration` |
| 22,073 | `property` ← `container_field` | | 1,907 | `constant` ← `source_file` |
| 18,573 | `function` ← `function_declaration` | | 1,462 | `enum_member` ← `identifier` |
| 10,480 | `method` ← `function_declaration` | | 678 | `function` ← `source_file` |
| 8,107 | `type` ← `variable_declaration` | | 579 | `union` ← `variable_declaration` |
| 331 | `variable` ← `variable_declaration` | | 127/119/86/29/22 | `type`/`struct`/`enum`/`union`/`variable` ← `source_file` |

Two rows deserve naming rather than leaving in the table. **`enum_member` ←
`identifier` (1,462) is the error-set form** — the members of `error{ A, B }` are
bare identifiers directly under an `error_set_declaration`, which is the one
declaration form with no field and no `container_field`, and the analyzer
publishes them correctly. **The `← source_file` rows (2,968 in total) are symbols
whose production `startIndex` is 0**, so they map onto the FILE ROOT rather than a
declaration node; they are counted apart in the instrument
(`p5.zeroStartIndex`) rather than presented as if the root were a declaration
form. A consumer that maps a symbol to its declaration by byte offset cannot
locate these 2,968, and that is a fact about the production payload shape rather
than about the analyzer's choice of kind.

**A production-shape finding, since P5 is what ran into it.** The analyzer builds
`UniversalSymbol.range = { startLine, startColumn, endLine, endColumn, startIndex,
endIndex }`, but what production `parseFile` returns carries those fields FLAT on
the symbol — `symbol.startIndex`, not `symbol.range.startIndex` — and
`symbol.range` is `undefined` for **0 of 8** symbols in a spot check. A consumer
written against the `UniversalSymbol` interface in `src/ast/types.ts` finds no
range at all. This is shared machinery (§8) and is reported, not edited.

### P9 — deduplication, as a number

The emitted edge keys are `source->leaf` (`calls`, `uses`) and a bare leaf name
(`references`, `imports`), so N sites of one name from one source are ONE edge.
Measured over the same draw, tree sites per published edge: **`calls` 2.71**
(307,901 sites / 113,476 edges), **`uses`(field) 7.84** (931,306 / 118,795),
**`uses`(bare) 39.27** (526,463 / 13,406), **`references`(declared type) 3.19**
(65,622 / 20,594), **`instantiates` 2.97** (12,777 / 4,306). The bare-read figure
is the largest and it is a direct consequence of the key: a file-scope constant
read from ten functions is ten edges, read from one function forty times is one.
A consumer that re-derives a call site from an edge will find a median of three
per `calls` edge, and the line recorded is the FIRST site — which the M60
line-accuracy gate already certifies at 100% for the line it does record.

### Two properties of the instrument itself

**`--sample 0` is required with `--files-from`, and the pass-1 usage string did
not say so.** `ontology-census.ts` truncates the hashed draw by `SAMPLE` BEFORE
the shard filter, so the documented default `--sample 400` silently caps a
480-file shard at 400 files and prints a report that looks finished. The merge's
union-hash assertion catches it, which is how it was caught here; the usage
string now names the requirement and `pass3-adversarial.ts` states it in its own
header.

**Reading a symbol's range needs the production shape, not the declared one.**
Stated above; it is why P5's first run reported "0 of 289 mapped" for a corpus it
mapped entirely.

### Why none of the two was fixed here, stated as a rule

Both changes the SET of edges the analyzer emits, and this lane's oracle mirrors
the analyzer's rules rule-for-rule (`script/m14/zig-truth.ts` is a §8 shared
file), so a unilateral analyzer fix turns the lane's own source-keyed gate red
against an oracle that reproduces the very defect being fixed. The specific
changes are written out in the report so they can be applied without
re-deriving them. **Nothing in this lane's committed output changed in pass 3
except the instruments and this document.**

## Pass 4 — the question the analyzer's own vocabulary cannot ask (2026-10-03)

Pass 2's probes each begin from a branch in `real-zig-analyzer.ts`. Pass 3's each
begin from a suppressor — a branch whose firing is invisible in the output. Both
are the right way to audit a rule you can SEE, and both still ask the question in
the analyzer's own words: *does this emitted edge have the right label, endpoint or
source*. Pass 4 changes the question. It enumerates **what Zig can express** and
asks whether the ontology has an edge for it, without reference to the analyzer's
rule inventory. That is the only direction that can find a class the analyzer does
not know it has — and the workstream's own correction says a source count is not
evidence, so a rule whose branch never matches greps as loudly as one that fires.

**Population.** 3,834 of 3,834 admitted files, `popHash sha256:2f3545f9…` — the
hash every other published zig figure in this document names. 8 shards;
`pass4-merge.py` asserts the union IS the population by re-walking the corpus
itself, recomputes every ratio from summed primitives, and **refuses** any shard
reporting `fallback > 0` or a failing precondition. All 8 shards: `fallback 0`,
**11 of 11 preconditions** ok.

### The five classes, measured

| probe | construct | sites | own line | named at another line (dedup) | NOT named in the file |
|---|---|---|---|---|---|
| P10 | generic container instantiation in a TYPE position (`var x: std.ArrayList(u8)`) | **3,086** across 661 files | 2,056 (66.62%) | 1,030 (33.38%) | **0 (0.00%)** |
| P11 | generic FUNCTION application (`fn make(comptime T: type) T`, called `make(u8)`) | **9,677** across 398 files | 2,097 (21.67%) | 7,580 (78.33%) | **0 (0.00%)** |
| P12 | call to an in-file `fn … type` — Z32's documented `instantiates` class | **1,528** across 278 files | **1,528 (100.00%)** | 0 | **0 (0.00%)** |
| P13 | `Self` in a type position | **0** across 0 files | — | — | — |
| P14 | `@embedFile("…")` | **230** across 52 files | — | — | 0 `imports` edges |

**Three classes that passes 2 and 3 could not see are not defects.** Across 12,765
generic applications (P10 + P11) not one is unnamed in its file, and the
`instantiates` class fires at **1,528 of 1,528** — 100% — of the exact construct
its rule names. P14's 230 `@embedFile` sites carry no edge, and none can: the
target is a data file, the schema holds no file-level node, and pointing an edge
at one would mean minting a symbol the language does not declare. Reported, not
fabricated.

**Zig has no `Self`.** P13's premise was borrowed from a language that has one;
0 sites across 0 files is the correct reading, and the first revision's
precondition `p13SelfSites > 0` demanded the impossible, so the instrument's own
verdict line read `NO` on all eight *clean* runs. The measurable half of P13 is the
other clause: **a `comptime T: type` parameter is a local binding, not a
declaration**, it appears in a type position **1,501 times across 219 files**, and
**268 distinct (file, name) pairs each receive a `declared_type` `references`
edge**. `T` alone accounts for 818 sites. The edge is a type-position read, which
is true; the target is a name nothing declares, so a reverse walk resolves it to
whatever `T` it finds first. `references` here resolves at a rate the table below
reports, and this is a measurable part of why.

**The dedup column is a property, not a loss.** `calls` keys on
`${source}->${leaf}` with **no line** (`real-zig-analyzer.ts:1119`), so the 2nd..nth
call of a name inside one enclosing declaration has no edge of its own *by
construction*. Reading those as a missing edge is how the first revision of this
instrument reported a 64.52% loss on a 60-file draw; the corrected three-way
classifier separates "named here", "named at an earlier occurrence" and "named
nowhere", and only the third is a gap.

### Three instrument defects, each of which had already produced a verdict

This is the fourth time in this lane that the instrument rather than the analyzer
manufactured a class, and the third time it did so by reading the analyzer's
metadata as if its names were its meaning.

1. **P12 was keyed on the wrong bucket entirely.** `isGenericTypeApplication` is
   pushed at `real-zig-analyzer.ts:1482` for a call to an in-file `fn … type` — a
   TYPE-RETURNING FUNCTION, not a generic type application — while
   `isConstructorApplication` (`:1494`) is `TypeName{ … }`. P11, which asks about
   generic functions, was reading the type-returning-fn bucket; P12, which asks
   about type-returning functions, was reading the constructor bucket. **P12
   therefore reported 0 `instantiates` edges over 1,528 sites and read as a clean
   negative about a class that fires at 100%.** The metadata name is a misnomer in
   the ANALYZER, which is worth fixing on its own account; the probe now keys on
   the rule, not the label.
2. **P11/P12 matched on LINE alone** while the edge keys on `(line, target)`, and
   **P13 counted edge PRESENCE where it printed a per-site percentage** — one edge
   per name per file was being credited to every site naming it, which is how P13
   printed a clean `100.00%` that meant nothing. P13 is now reported at the
   `(file, name)` granularity the dedup key actually exists at.
3. **The `Self` precondition**, above.

Two controls gate the file (9 assertions over synthetic snippets, exit 2 on
failure), and `pass4-merge.py` independently re-derives the population hash rather
than trusting the shards' agreement.

### What pass 4 could not settle

The two P11/P12 classes are *unlabelled by omission* rather than mislabelled: a
generic function application receives `calls`, never `instantiates`, and this
document's own ZIG.O.4 note calls `instantiates` "the type ZIG.D.1 ruled out". Both
spellings are defensible — a monomorphized call is a call, and `ArrayList(u8)` in a
type position is a call in Zig's own semantics — so the lane records the split
rather than choosing it. **What would settle it is a consumer-side decision** about
whether `instantiates` in this ontology means "generic type application" or
"monomorphization", and no instrument can decide a question of definition. The
numbers to decide it with are 3,086 + 9,677 = 12,765 sites.

## The incoming edge — what a reverse walk can actually bind to (2026-10-03)

`src/lsp/impact.ts` does bounded reverse-dependency traversal with declared
budgets, depth limits, truncation disclosure and verifier gates. It obtains its
inbound edges by **scanning outgoing edges and matching targets**; no inbound edge
is stored anywhere, because the schema holds none. So the reverse walk is exactly
as good as target matching, and this section measures that.

**The two named scripts do not exist.** The workstream's incoming section names
`script/m14/firing-check.ts` and `script/m14/incoming-check.ts`. `script/m14/` holds
100 files and neither name is among them; both would be shared machinery under §8.
The instruments below are the lane-owned equivalents and are what every number here
comes from: `validation/m14/fixtures/zig/incoming-check.ts` (per-shard dump of
production `parseFile` output plus a tree-declared-name index) and
`incoming-resolve.ts` (the resolver, with 2 controls and a non-zero exit).
`incoming-check.ts` carries control C3 — a top-level `const`, a container field, a
`comptime` parameter and a function-local of the same shape must classify
differently — because without it this file cannot tell "the analyzer dropped a
declaration" from "this is a local variable", which is the whole content of the
`neverIndexed` claim. **A third refinement was written and withdrawn**, and the
reason belongs here rather than in a commit message: it split `neverIndexed-field`
into "a field of an anonymous container" and "a lost field", which needs a
re-derivation of Z21/Z22, and a control pinning that re-derivation read
`var anon: struct { orphan: u8 }`'s `orphan` as *owned* — because the struct is the
payload of a named `variable_declaration` even though the struct type has no name.
An instrument that re-implements the rule it audits has produced three false
classes in this lane, so the split is not made and `field` stays one bucket.

### The counts

**392,550 edges and 127,429 published symbols** — an exact, independent
reproduction of pass 1's census by different code.

| type | edges | files | tgt unique | tgt AMBIGUOUS | tgt zero | MISBIND | of which UNIQUE-in-another-file | UNBIND | src is a symbol | conf < 0.7 |
|---|---|---|---|---|---|---|---|---|---|---|
| `calls` | 113,476 | 2,781 | 28.95% | **66.58%** | 4.47% | 62,983 | 16,598 | 5,156 | 88.47% | 0 |
| `uses` | 132,201 | 2,852 | 15.81% | **77.48%** | 6.71% | 70,239 | 10,002 | 15,377 | 77.52% | 0 |
| `contains` | 77,459 | 1,474 | 35.33% | 64.47% | 0.20% | **0** | 0 | 314 | 100.00% | 0 |
| `imports` | 10,200 | 2,693 | 0.15% | 33.37% | 66.48% | 382 | 0 | 6,810 | 0.00% (marker) | 0 |
| `references` | 30,794 | 2,966 | 15.23% | 58.80% | 25.97% | 9,207 | 1,733 | 8,253 | 0.00% (marker) | 0 |
| `exports` | 24,114 | 3,164 | 44.31% | 55.68% | 0.01% | **0** | 0 | 6 | 0.00% (marker) | 0 |
| `instantiates` | 4,306 | 530 | 25.85% | 70.20% | 3.95% | 445 | 40 | 171 | 44.96% | 0 |
| `extends` | 0 | 0 | — | — | — | — | — | — | — | — |
| `implements` | 0 | 0 | — | — | — | — | — | — | — | — |
| `overrides` | 0 | 0 | — | — | — | — | — | — | — | — |

**265,887 of 392,550 edges (67.73%) name a target that two or more published
symbols share.** Mean candidates per ambiguous edge: `uses` 102.53, `calls` 84.87,
`references` 337.53; the maximum is 2,216. The worst offenders are the shortest
names in the language — `std` (2,216 published symbols across 2,214 files),
`len`, `assert`, `items`, `init`, `deinit`, `mem`, `builtin`, `debug`. **Only
69,245 edges (17.64%) are in the shape where name matching is sufficient on its
own: a unique target that is in the edge's own file.**

### Two unresolved targets that look identical and are opposite findings

Both read "not resolved" in a count. They fail differently, and the difference is
whether the walk produces **wrong** advice or **no** advice.

- **MISBINDABLE — 143,256 edges.** The name IS published somewhere, so the walk
  *will* bind the edge, and no candidate is in the edge's own file. `calls` 62,983,
  `uses` 70,239, `references` 9,207, `instantiates` 445, `imports` 382.
  **The sharp case is 28,373 of them**: the target resolved to exactly ONE
  declaration, in another file, so the walk is about to be *confident* and wrong.
- **UNBINDABLE — 36,087 edges.** No symbol carries the name anywhere; the walk
  finds nothing. `uses` 15,377, `references` 8,253, `calls` 5,156, `imports`
  6,810, `contains` 314, `instantiates` 171, `exports` 6.

Cause, per type, and the external/never-indexed separation the incoming section
asks for:

| type | zero | path | external | neverIndexed-decl | neverIndexed-field | declared-local | declared-parameter | non-identifier | builtin-fn | builtin-type |
|---|---|---|---|---|---|---|---|---|---|---|
| `calls` | 5,067 | 0 | 2,580 | 51 | 38 | 2,353 | 44 | 1 | 0 | 0 |
| `uses` | 8,871 | 0 | 1,799 | 151 | **6,355** | 342 | 26 | 198 | 0 | 4 |
| `contains` | 157 | 0 | 0 | 148 | 9 | 0 | 0 | 0 | 0 | 0 |
| `imports` | 6,781 | **6,621** | 92 | 28 | 1 | 13 | 0 | 24 | 2 | 0 |
| `references` | 7,996 | **6,621** | 531 | 205 | 52 | 436 | 116 | 33 | 2 | 0 |
| `exports` | 3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| `instantiates` | 170 | 0 | 0 | 1 | 0 | 155 | 14 | 0 | 0 | 0 |

`declared-local` and `declared-parameter` are reported apart and are **not**
`neverIndexed`: this project's model carries a function's signature on the function
symbol and does not publish a symbol per local, so an edge to one of those names is
not a dropped declaration. `uses`'s 6,355 `neverIndexed-field` is a field name the
analyzer publishes no symbol for, and the withdrawal above is why no finer split is
claimed for it. `instantiates`'s 170 are 155 locals and 14 parameters — the Z22
anonymous-container rule again, measured from the other side.

**The largest single unresolved name is a defect this lane does not own.**
`Self` appears in 240 edges and is declared at container or file scope in **169
files**: `const Self = @This();` is Zig's self-type idiom and a real top-level
declaration. `keepSymbol`'s `UNIVERSAL` denylist at `src/ast/pool-worker.ts:449`
lists `"Self"` — a JS/Rust `this`-analogue, not a Zig keyword — so the store
refuses to publish **any** symbol with that name. The lane's own
`store-denylist-census.ts` already measured it (262 declarations, 97 published,
165 never, 167 files); this section is the independent arrival at the same place
from the edge side. `root` (157 edges, 57 files) and `unknown` (39 edges, 33 files)
are the same denylist entry. §8.

Also measured, and counter-intuitive: **36 of the 37 names in the analyzer's own
`ZIG_DECLARED_TYPE_BUILTINS` ARE published symbol names somewhere in this corpus** —
including `u8`, for `zig/test/behavior/basic.zig`'s `const @"u8" = u16;` and
`zls/.../Interner.zig`'s `f80`. This is the Z57 rule working, and it is why the
resolver's builtin rung must be tested on a name that satisfies its own
precondition: the first revision asserted it on the literal `u8` and failed at
8/8 scale while passing at 1/8, which is a control asserting a corpus fact rather
than a rule.

## Z65 — target scope: making the breakable half breakable (2026-10-03)

**265,887 ambiguous edges; 151,004 (56.79%) have a candidate in the edge's OWN file
and are therefore resolvable by a per-file rule; 114,883 have no local candidate
and no per-file rule can pick them.** Per type, the breakable share is `contains`
49,939 (100.00%), `exports` 13,427 (100.00%), `instantiates` 2,618 (86.60%),
`imports` 3,022 (88.78%), `references` 10,633 (58.72%), `uses` 42,197 (41.19%),
`calls` 29,168 (38.61%). The 114,883 that no per-file rule can reach are the
honest remainder and are named as such rather than papered over.

A zig relationship carries six keys — `source`, `target`, `type`, `confidence`,
`line_number`, `metadata` — and **both endpoints are name strings**, so an edge has
no room to disambiguate anything. It does have `metadata`, and the analyzer knows
which names IT published, so `annotateTargetScope` adds a label to every existing
edge:

- `file-local` — this file publishes a symbol with exactly this name, plus
  `targetKind` when the file publishes exactly one kind under it, or
  `targetKindCount` when it publishes several. **A collision inside one file is the
  case a name-keyed walk gets wrong most confidently**, and this is where the
  annotation refuses to pick: `const Collide = struct{}` and `fn Collide()` in one
  file leaves `targetKind` absent and `targetKindCount` at 2.
- `file-external` — the file publishes none. An external `std.*` name, a builtin, an
  import path. Stated rather than implied.
- `scope-marker` — the endpoint is `(global)` / `(file)` / `(declared-type)`.

Measured over the population, read back from production metadata:

| | edges | share |
|---|---|---|
| `file-local` | **220,528** | 56.18% |
| `file-external` | 172,022 | 43.82% |
| `scope-marker` / absent | 0 / 0 | — |

**And the check on the annotation itself, which is the number that matters:** of the
220,528 `file-local` edges, **220,208 (99.85%) do have a candidate in their own
file. 320 (0.15%) do not** — and all 320 are 9 names, every one of them on the
shared `keepSymbol` denylist: `Self` ×145, `root` ×98, `unknown` ×37, `self` ×23,
`super` ×10, `this` ×3, `program` ×2, `destructor` ×1, `source_file` ×1. The
analyzer can see the symbol and the store refuses to keep it, so those 320 edges
carry a `file-local` label naming something the store will not publish. The
annotation cannot know the store's denylist without importing it, which would
couple the analyzer to the store it feeds; §8 carries the fix. **The change is not a
regression for those 320:** a consumer that follows `file-local` and finds nothing
gets exactly the outcome it got before, because there was nothing to find.

**It adds no edge, removes no edge, and moves no count.** Verified three ways at
the full population: 127,429 symbols and 392,550 edges before and after, per-type
identical; shard 0's per-type counts identical (15,766 / 17,290 / 10,478 / 4,319 /
1,490 / 672 / 4,237); and the arbiter's emitted counts identical on a bounded
1,200-file root (29,588 / 35,867 / 21,733 / 3,143 / 9,076 / 6,433 / 1,253). A
consumer that ignores the label behaves exactly as before, which is why it cannot
regress a budgeted lane.

**What it does not do.** It says whether the target is *in this file*, not whether
it is the declaration the author meant. Resolving `x.y.z()` to `z` needs the
receiver's type, which needs a type index, which is the limitation already declared
above. And the change is lane-side only: the name→id mapping that turns a target
string into a symbol happens in `src/ast/engine.ts`, so **nothing consumes
`targetScope` yet** and no `bb_impact` answer changes until §8 item 6 lands.

### The fixture, and the mutant that survived it

`validation/m14/fixtures/zig/target-scope.zig` +
`.expectation.json` pin the file-local kind, the in-file collision, the external
name and the import path, and **9 of 9 zig fixtures pass**.

`validation/m14/fixtures/zig/z65-mutants.mts` injects 5 defects and requires the
fixture to catch each: `drop-target-scope`, `all-external`, `all-local`,
`pick-a-kind-on-collision`, `key-on-the-path-not-the-binding`. **5 of 5 CAUGHT.**

Two things about that harness are the point rather than the count. It imports
`matchConstraints` from `script/m14/run-fixtures.ts` instead of restating the
comparison, because a mutant harness that reimplements the matcher can pass a mutant
the real runner would catch and then log "caught" while the suite disagrees — the
first revision shelled out to `tsx -e` and evaluated the fixture by hand, which is
that failure one step further out. And **one mutant survived the first run of the
fixture**: `key-on-the-path-not-the-binding` flips `std` from `file-local` to
`file-external`, and the fixture had a *forbid* row saying `std` must not be
external and no *expect* row saying it must be local — so the mutant satisfied the
forbid and violated nothing. A negative assertion with no positive counterpart is
satisfied by any behaviour. The missing `expect` row is now in the fixture and the
mutant is caught. A fixture suite that has never had a mutant survive it has not
been asked the question.

M5 is deliberately a *realistic* defect rather than a strawman: it is what an
implementation keying on the import PATH instead of the published binding would do,
and it is invisible to a fixture that only pins the external cases.

## Defects this lane found while establishing the ontology (Z59, Z60)

Establishing the ten types is the half of the job that finds things. Two defects
surfaced that the existing gates could not see, because both live on the SOURCE side
of an edge and the differential's coverage match discards the source.

**Z59 — FIXED. An edge source named a declaration the analyzer does not publish.**
The three edge passes each took the nearest `function_declaration` /
`test_declaration` identifier as the source name without asking whether a symbol was
published for it. That is wrong for a function the analyzer DELIBERATELY declines to
publish: a member of a container written inside a function or test body, a member of
an anonymous container, or a member of a container nested in another unpublished one
(Z22 / the C negative contract — such a type has no file-scope identity). Measured
through production `parseFile` over the full corpus by
`dangling-source-census.ts`, which asks the PARSE TREE what declaration each dangling
source name belongs to: **11,332 of 224,599 `calls` + `uses` + `instantiates` edges
= 5.05%** carried such a source, and the class residual — a dangling source no tree
declaration explains — was **0**, so that is the whole population and not a sample of
it. Every one was `member-of-unpublished-container`.

The largest single site is `zig/lib/compiler/aro/aro/Builtins/powerpc.zig`: a
175 KB generated file whose entire body is the anonymous struct returned by
`pub fn with(comptime Properties: type) type`, so the analyzer publishes **2** symbols
(`std`, `with`) and ~552 edges named members of the struct.

The fix is one predicate, `zigFunctionScopeIsPublished`, applied at all three sites,
and a source that falls back to the nearest scope the analyzer DOES publish — which
for that file is `with`. After it, over the same draw: **1 dangling source in 249,983
edges**, the single residual being `uses root -> node @22` in
`zig/lib/compiler/resinator/ast.zig`, which is Z60 below.
Post-fix full-corpus: **1 dangling source in 249,983 edges (0.0004%)**, of which 1 is
`published-file-scope` and 0 are the class above. The fix also **removed 7,616 edges**
(3.08% of the three types) that the old rule had split into duplicates: `calls` keys
on `source->leaf` and `uses` on `source::leaf`, so two edges that differed only in an
unpublished member's name are now one edge.

Pinned by `validation/m14/fixtures/zig/unpublished-scope-source-z59.{zig,expectation.json}`,
whose `forbidRelationships` are the six pre-fix shapes. **Calibrated:** reverting the
analyzer makes the fixture fail with 5 missing expectations and all 6 forbidden
shapes present.

**Z60 — REPORTED, NOT FIXED. The store drops 168 real Zig declarations on name alone.**
`parseFile`'s `keepSymbol` gate applies a UNIVERSAL denylist commented "language
keywords / conventions and synthetic tree-sitter artifact names — never legitimate
declarations in any language". The second half of that claim is false for zig.
`store-denylist-census.ts` reads the list out of `src/ast/pool-worker.ts` at run time
(a hand copy is a list that keeps reporting the old answer) and counts declarations
the tree bears in a declaring position: **683 declarations carrying a denylisted
name across 336 of 3,834 files, of which 168 are PUBLISHED by the analyzer and so
genuinely lost from the index, across 130 files.** By name: `Self` 97, `unknown` 28,
`root` 24, `self` 9, `program` 4, `super` 3, `destructor` 1, `source_file` 1,
`this` 1.

`Self` is the one that matters: `const Self = @This();` is a container-member type
alias in `zig/lib/compiler/resinator/parse.zig:23` and
`ghostty/src/config/io.zig:16`, published by the analyzer and then discarded, so every
`contains Parser -> Self` edge the analyzer emits points at a symbol the store will
never hold. `root` is `pub fn root(self: *Tree) *Node.Root` at
`zig/lib/compiler/resinator/ast.zig:21` — the one surviving Z59 residual. `unknown`
is an enum member the analyzer publishes as a truthful declaration, which is why the
census reports 39 edges with a literal `unknown` endpoint and can separate the 2 that
are placeholders from the 37 where the source file really declares a member called
`unknown` (`const Outcome = union(enum) { unknown, … }`) — a name that is a finding on
the denylist and not on the analyzer.

The list lives in shared machinery (`src/ast/pool-worker.ts`, §8), so this lane
measures and reports rather than edits. The change needed is stated in the report.

## Declared limitations (non-empty by measurement, not by form)

A blank limitations list on a Turing-complete language is treated as dishonesty
rather than excellence, so each entry below names the number that bounds it.

- **The RECEIVER of a method call is a bare read and is never published — 683
  lost reads, 2.73% of the 25,048 method-call receivers that name a file-scope
  value.** `isCallCallee` in the bare-read pass walks up to the enclosing
  `call_expression` and treats the whole callee subtree as the callee, so
  `fromInterned(x).put(…)` publishes `calls -> put` and nothing for the read of
  `fromInterned`. A differential cannot see this class at all: it asks whether a
  published edge is explained, and this is the ABSENCE of one, so a run with the
  defect and a run without it report the same agreement. **115 further rows are
  counted apart and not charged** (their receiver is a qualified-path alias such
  as `const cmath = math.complex;`, indistinguishable from a value by name), and
  receivers bound by `@import` are excluded entirely because a module is not a
  value read. The fix is to suppress the member LEAF and the qualified non-leaves
  while leaving the chain's base identifier readable — the rule the pass-2 doc
  comment already describes and the code does not implement.
- **An `error.X` leaf can be charged to a symbol that is not an error-set member
  — 4 edges, 12.5% of the 32 candidate error-leaf reads.** In
  `zig/test/behavior/underscore.zig` the name `optionalReturnError` is both a
  `fn` and the error member it returns; the gate
  `fileValues.has(name) || (inError && enumMemberNames.has(name))` admits the
  read on the strength of the function, and the published target resolves to the
  function. The remaining 28 of 32 charge a declared error-set member. The fix is
  to prefer `enumMemberNames` over `fileValues` when `inError` is true, which is
  a one-clause change to the same gate and needs `script/m14/zig-truth.ts`
  changed in step (§8).
- **`instantiates` names a type the analyzer declines to publish — 625 of 4,306
  edges (14.51%), in two shapes.** 615 targets bind to nothing at all and 10 bind
  to a same-named symbol of a kind that cannot be constructed; both are
  constructions of a container declared inside a function or test body. The edge
  is TRUE and the type is deliberately unpublished (Z22), and unlike the source
  side there is no nearer published name for a target to fall back to. A4 asked
  whether the target binds to anything published and this asks whether it binds
  to the kind the edge's own reason code claims; splitting the two FORMS is
  load-bearing, because a generic application legitimately names a generic
  FUNCTION and one question asked of both convicts the analyzer on every one.
- **A destructuring declaration binds only its FIRST slot — latent, and measured
  empty.** `const a, const c = .{1,2}` is one `variable_declaration` with two
  binding slots and the analyzer binds the first. Over the corpus: **903
  declarations, 1,033 non-first slots, 0 of which name a file-scope declaration in
  the same file.** So no published edge is wrong today; the rule would misattribute
  a read the moment a file shadowed a global with a destructuring slot, and no
  file in this corpus does. Declared because a clean zero on a corpus of this size
  is a statement about the corpus and not about the rule.
- **Site multiplicity is not recoverable from an edge — 2.71 tree sites per
  `calls` edge, 7.84 per field-read `uses`, 39.27 per bare-read `uses`, 3.19 per
  declared-type `references`, 2.97 per `instantiates`.** The keys are
  `source->leaf` and a bare leaf name, so N sites of one name from one source are
  one edge and the recorded line is the FIRST of them. A consumer re-deriving a
  site from an edge needs to know this before it looks for one.
- **2,968 published symbols carry `startIndex` 0** and therefore cannot be
  located by byte offset; they are counted apart by `p5.zeroStartIndex` rather
  than presented as mapping to a declaration form. Related and separate: what
  production `parseFile` returns carries the range fields FLAT on the symbol
  (`symbol.startIndex`), while `src/ast/types.ts` declares them nested under
  `symbol.range` — so a consumer written against the declared interface reads no
  range at all. Shared machinery (§8), reported not edited.
- **A named test is an edge source with no symbol, and when the name collides the
  source is WRONG rather than dangling (Z39 retained deliberately; Z60 adjacent).
  CORRECTED 2026-10-03.** This entry previously read "measured at 0 after Z59 on the
  full corpus". **That measurement was name-keyed and pass 2 shows it does not hold
  as an identity claim.** `test foo { … }` is a NAMED scope (Z39) and edges inside it
  are attributed to `foo`, but the analyzer publishes no symbol for a test and the
  shared `SymbolKind` has no `Test` member. Two sub-classes, both measured over the
  3,834-file draw:
  - the name matches NOTHING in the file — **6,238 of the 6,997 edges sourced at a
    named test**. That is a dangling source, which is the honest reading and is what
    Z39's entry has always described.
  - the name matches a declaration that is NOT callable — **759 edges**
    (494 `calls` + 265 `uses`), and **all 759 are this sub-class and none is
    anything else**. `zig/src/Package.zig` has `pub const Hash = struct {…}` at line
    48 and `test Hash {…}` at line 190, so the graph records `calls Hash -> init`.
    Resolution BY NAME reads those as resolved, which is why the census reports
    `calls` source dangling at 0.00% and why the Z59 census reported 0.
  Resolving it properly needs a `SymbolKind.Test` (shared, §8) so the test is a node
  the edge can point at; the interim fix, which pass 2 does not apply unilaterally
  because it needs the oracle's `enclosing()` changed in step, is to fall back to
  `(global)` when the test's name binds to a non-callable symbol, since a wrong
  caller is worse than a scope marker. Reverting Z39 is the third option and it
  attributes test bodies to file scope. **Not decided here.**
- **A declared-type reference can name a CALLING CONVENTION or an ENUM LITERAL
  rather than a type — 24 unquoted-keyword targets, 3 digit-headed, 48 whose leaf is
  a value position.** `*const fn (AppUD) callconv(.c) void` publishes
  `references -> c`; `Aligned(Foo, .@"16")` publishes `references -> 16` because the
  digit-head guard reads the quoted spelling and canonicalization strips the quotes
  afterwards. Bounded at **under 0.25% of the 20,594 declared-type edges**, measured
  per arm in pass 2 and reported with the three arms named because they overlap. The
  fix is a `function_signature` case in `leafOfTypeNode` plus a strip before the digit
  guard; both change the emitted set and need `script/m14/zig-truth.ts` changed in
  step (§8). Not applied here.
- **`instantiates` targets do not resolve for a container declared inside a function
  or test body — 615 of 4,306 edges (14.28%).** The edge is TRUE (the construction
  happens) and the type is deliberately unpublished (Z22: a local type has no
  file-scope identity), and there is no nearer published name for a target edge to
  fall back to the way Z59 gave the source side. Same terms as the `imports` entry
  below: a resolution rate, not a defect count, and reported rather than absorbed.
- **`contains` is keyed on a NAME, so 3,721 of 77,459 edges (4.80%) name an owner
  that matches two or more containers in the same file, and 96 edges are the same
  (owner, member) pair at two different lines.** The store resolves ownership by
  extent, so the INDEX is unambiguous and the EDGE is not. `exports` has the same
  shape at a lower rate: 494 of 24,114 targets (2.05%) match more than one symbol in
  the file. An id-keyed edge would be a different relationship type, so this is a
  shape limitation of the shared model, not of the analyzer.
- **An edge carries a LINE, not a column.** 1,137 `calls` edges and 14,701 `uses`
  edges have their target's FIRST occurrence on the recorded line in a
  non-matching position while a later occurrence on the same line matches. Both
  figures are published rather than dropped, because any consumer that re-derives the
  site from the line has to make the same any-occurrence choice this lane's pass-2
  instrument made, and should know the number before it makes it.
- **`imports` targets do not resolve, by design and by necessity.** The target is the
  module path AS WRITTEN (`"std/mem.zig"`), because a module is not a declaration. The
  census therefore reports `imports` target resolution at 29.77% file-local / 33.52%
  corpus-tier, and that number is not a defect rate — it is the price of typing the
  edge against a path rather than against a name. Reporting it as an unresolved rate
  without saying this would read as 66% of imports being broken.
- **The oracle shares the analyzer's grammar.** `zig-truth.ts`'s `enclosing()` is the
  same nearest-declaration rule as the analyzer's, so F5's agreement rate cannot see a
  grammar defect both walkers share. The grammar's defect extent is therefore measured
  independently (810 ERROR / 44 MISSING nodes over 3,834 files, bucketed above)
  rather than taken from the agreement number.
- **Cross-file `instantiates`.** Z48: the cross-file remainder is ~12,900 sites
  (4.2%); 63.8% of the qualified-callee population is a method call through a VALUE
  chain (`b.build_root.handle.readFileAlloc`), which no type index should resolve.
  Closing the rest needs the index passed INTO `analyze(root, source, filePath)`,
  which has no parameter for it — an API question, not a detection one.
- **267 of 392,550 edges (0.07%) carry a `file-local` label naming a symbol the
  store refuses to publish** — Z65's own correctness check, and the one class its
  measurement found in itself. 320 edges, 9 names, every one on the shared
  `keepSymbol` UNIVERSAL denylist at `src/ast/pool-worker.ts:449`: `Self` ×145,
  `root` ×98, `unknown` ×37, `self` ×23, `super` ×10, `this` ×3, `program` ×2,
  `destructor` ×1, `source_file` ×1. The analyzer publishes the symbol and the
  store drops it by NAME ALONE, so the label is true of the analyzer and false of
  the graph. `Self` is the substantive one: it is Zig's self-type idiom,
  `const Self = @This();`, a real top-level declaration present in **169 of 3,834
  files**, and 240 edges name it. Fixing it means the denylist needs a per-language
  exemption, which is shared machinery (§8), not an analyzer change — and an
  analyzer that imported the store's denylist to compensate would be coupling the
  thing it feeds to the thing that filters it.
- **143,256 edges (36.50%) will bind to a declaration in ANOTHER file if a
  consumer matches targets by name, and 28,373 of those bind to EXACTLY ONE such
  declaration**, so the walk is confident and wrong rather than merely unsure.
  Z65 labels 220,528 edges `file-local` and 172,022 `file-external`, which is the
  honest per-file half; the cross-file half cannot be resolved without a type index
  and **nothing consumes `targetScope` yet**, so no `bb_impact` answer has changed.
  The count is the size of the remaining work, not a description of today's
  behaviour.
- **1,501 type-position reads across 219 files name a `comptime T: type`
  parameter — a local binding, not a declaration — and 268 distinct (file, name)
  pairs each receive a `declared_type` `references` edge** (P13). `T` alone is 818
  sites. The read is real; the target is a name nothing declares, so a name-keyed
  reverse walk resolves it to an unrelated `T`. Suppressing it would lose a genuine
  type dependency, and there is no edge kind for "a type parameter of the
  enclosing declaration" in the shared schema (§8).
- **`uses` has 6,355 unresolved field-name targets (36.10% of its zeros) and this
  lane does NOT split them.** The honest split is "a field of an anonymous
  container, correctly unpublished under Z21/Z22" against "a field of a named
  container that went missing" — two opposite findings — and telling them apart
  requires re-deriving Z21/Z22 inside the instrument. A control pinning that
  re-derivation read `var anon: struct { orphan: u8 }`'s `orphan` as OWNED, because
  the struct is the payload of a named `variable_declaration` even though the struct
  type has no name. An instrument that reimplements the rule it audits has produced
  three false classes in this lane, so the split is withdrawn and `field` stays one
  bucket. **The 6,355 is therefore an upper bound on the defect and a lower bound
  on nothing** — it is not yet a defect count.
- **Grammar-version drift.** The analyzer reads the `type`, `body`, `name`, `left`,
  `right` and `operator` fields and the anonymous tokens `const`/`var`/`pub`; a
  grammar bump can change what it sees. The grammar pin is a gate, not a comment.
- **The wasm cannot be regenerated.** `wasm/tree-sitter-zig.wasm` is byte-identical to
  `tree-sitter-wasms@0.1.13`'s published build and that collection publishes no source,
  so the underlying grammar version is recorded nowhere in this repository.

## What is deliberately NOT emitted (ZIG.GAP.*)

- **No `extends` / `implements` / `overrides`** — RULED with instruments, probes and
  overturn conditions in **ZIG.O.1**–**ZIG.O.3** above, not by assertion. The
  previous text ("Zig has no class inheritance and no interface with an implements
  clause") was a prose justification with no measurement, which is the failure mode
  that let a missing type survive a green differential in another lane.
- ~~No `instantiates`.~~ **This was wrong and said so confidently.** An earlier
  draft of this document ruled that composition is expressed through struct
  fields and opaque vtables and that generics are monomorphized without a
  runtime dispatch, and therefore that the `instantiates` branch in
  `classifyEvidenceTier` was unreachable. Z32 measured the opposite, and the full
  corpus re-measures it at **4,306 edges over 530 files** — see ZIG.O.4. A doc that
  rules a class out is making the same claim as an analyzer that emits one, and it
  needs the same evidence.
- No `calls`/`uses` edge for a type used in a value position with no annotation
  (`Point{ … }`) beyond the `instantiates` construction form — declared and counted
  (ZIG.GAP.3) rather than left silent.
- No declared-type reference for a type that names nothing (ZIG.GAP.3/4 above).

## Verification (re-run 2026-09-30)

**Re-verified from a fresh `git worktree` of HEAD, not from a working tree.** That
distinction is not pedantry: an earlier pass in this lane reported 48/48 mutants
and 0 unexplained while six of the artifacts producing those numbers — including
the Z38/Z39 analyzer hunks, the fixture rows pinning them, and four of the gates
themselves — existed only on disk. The figures below are the ones a fresh clone
reproduces.

| gate | instrument | result |
|---|---|---|
| F1 grammar audit | `audit-analyzer-grammar.ts` | **PASS** — 50 refs, 0 unknown node types, 0 unknown fields. It read **FAIL with 2 unknown** until Z45: `field_identifier` and `struct_literal` are not node types in the pinned grammar, so two comparisons were dead disjuncts left by a grammar rename |
| relationship-type census | `zig-relationship-census.ts` | **15 / 15 engine types accounted for** — 7 emitted and gated, 4 ruled not applicable (`extends`, `implements`, `overrides`, `depends_on`), 4 above the analyzers (`similar_to`, `relates_to_pattern`, `part_of_feature`, `affected_by`) |
| F3 fixtures | the project's own `runLang("zig")` | **7 / 7 pass**, including 8 hand-computed complexity pins, 7 reason-code assertions and the Z46 blank-identifier pair; calibrated at **5 / 7** with the `contains` reason code removed — `bare-value-reads`, `calls-uses-complexity`, `callsite-lines-825`, `declaration-vs-definition-612`, `kinds-and-owners`, `declared-type-leaf`, `relationship-classes` |
| F4 mutations | `BB_MUTANT_ONLY="zig/" mutate-analyzer.ts` | **50 / 50 CAUGHT**, one per fixed class plus payload reverts. A mutant transforms the ANALYZER, so the count cannot reach an ORACLE defect — Z40 and Z41 were both mirror-side and neither had a mutant, which is the argument for the lane gates rather than a larger registry |
| F8 completeness census | `completeness-inventory.ts --lang zig` | **RE-RUN 2026-10-03: section-b FAILS. 98 types classified, 7 of 8 sections pass.** `section-b-relationship-kinds — EMITTED but absent from requiredKinds: exports, instantiates`. The analyzer publishes both (24,114 `exports` and 4,306 `instantiates` edges, measured through production `parseFile` at the 3,834-file draw), and the zig `requiredKinds` row in `script/m14/completeness-inventory.ts` still lists only `["calls","uses","contains","references","imports"]` — pass 1 added the two emissions without updating the contract row, and the row is a §8 shared file. The comment above that row still asserts "no `exports` GRAPH edge … would be a phantom", which Z33 made false: `exports` targets resolve at 99.99% and 0 of them name a non-public symbol. **The 2026-09-30 row's "sections A–H 8/8 pass" is therefore retracted**: it was true before `exports` and `instantiates` were emitted and stopped being true when they were, and the gate that says so has been saying so since. Sections A, C, D, E, F, G, H all pass (E: floor zig:zig missing=0 unexplained=0; F: 85.5 ms/file; H: 12 checks). Earlier note retained: it runs under `npx tsx`; it had been recorded as bun-only, which was hiding a real section-A failure on the universal `ERROR`/`MISSING` pair (Z50) |
| **F5 differential, LANE-OWNED** | `zigw-lane-differential.ts 400` | **RE-RUN AT PASS 3, IDENTICAL TO THE PUBLISHED ROW: 60,280 truth rows, 100.00% covered, MISSING 0, unexplained 0** of 56,906 analyzer edges, on the same draw `sha256:6ba81e3b477b`, and 0/0 on the STRICT axis too (per class: contains 8,306/8,349, uses 21,897/20,804, calls 16,037/15,573, references 7,940/6,080, imports 2,339/2,339, exports 2,930/2,930, instantiates 831/831). It needs `BB_CORPUS_ROOT` set — the corpus root in that instrument defaults to a path that does not exist here — and **0 on the STRICT axis too** (the rule that keeps the dotted qualifier, which is the axis Z40 hid on). The 2026-09-30 figures were 60,107 / 58,303 on draw `sha256:afee5618d093`; the draw is now `sha256:6ba81e3b477b` because the corpus grew (`ghostty` 805 → 807 tracked `.zig` files), so the two rows are different file sets and neither is a regression. Reproduces the shared harness's semantics exactly (same `normTarget`, same `label + normTarget(target)` key), so the numbers are comparable. Calibrated: `--calibrate` reports 2 MISSING and 1 unexplained. **The corpus root in `script/m14/tmp/zigw-harness.ts` and `zigw-lane-differential.ts` defaults to `$HOME/ishaq/fixtures/repositories`, a path that does not exist here — these instruments only run with `BB_CORPUS_ROOT` set** |
| file-scope declaration coverage | `zigw-decl-coverage.ts` | **20,944 declared, 20,944 published, 100.00%**, zero files short across all three corpora. Exits non-zero below 100% |
| `contains` gate | `zigw-contains.ts 200` | **PHANTOM 0, MISSING 0** (owner-keyed, bidirectional) |
| `imports` gate | `zigw-imports.ts 200` | **PHANTOM 0, MISSING 0** (site-keyed, bidirectional) |
| `instantiates` gate | `zigw-instantiation.ts 200` | **PHANTOM 0, MISSING 0** |
| `exports` gate | `zigw-exports.ts 200` | **PHANTOM 0, MISSING 0** |
| source-keyed `uses`/`calls` gate | `zigw-uses-calls.ts 200` | **PHANTOM 0, MISSING 0, 4,590 source agreements** — the axis F5 structurally discards, compared as source SETS per (label, target) |
| name-level gate | `zigw-unexplained.ts 1200` | **UNEXPLAINED 0, MISSING 0** in BOTH directions at (label, `normTarget(target)`) level — the axis the five site-level gates structurally cannot see, and the one that found Z40 |
| M60 line accuracy | `zigw-line-accuracy.ts 300` | **28,355 relationships, 100.00%, 0 off**, every class at 100%. Calibration: `--shift 1` collapses it to **13.50%** (24,528 off), so the check is tight rather than merely green |
| M60 line cross-check | `line-accuracy.ts zig zig,zls,ghostty 300` | **41,635 relationships, 0 wrong** — an independent generic probe over the same files; a different instrument counting a different draw, which is why the two totals are both stated rather than reconciled to one |
| evidence tiers | `zigw-evidence-tier.ts` | every class carries a tier the family rule allows (`import_based` for `imports`/`exports` and the import `references` twin, `structural` for a proven `instantiates`, `declared_type` for a type reference) |
| F5 wiring | `zigw-f5-wiring.ts` | the lane's audit is wired — and this gate has reported a real loss five times, including a commit that reverted `zig-truth.ts` from seven exports to four and dropped the whole of the Z37–Z39 work from HEAD |
| output-channel invariants | `zigw-invariants.ts 300` | **0 violations** over 1,110 symbols / 2,908 relationships / 319 functions: no duplicate edge at a line, no self-loop outside `calls`, every confidence in (0,1] and equal to the contract table, every relationship carrying a reason code and a line, every kind in the shared `SymbolKind`, no `ownerName` the file does not declare, no duplicate symbol, every function carrying an integer complexity ≥ 1, and **no DANGLING target** (an edge whose target is declared at file scope with no symbol published — the invariant that found Z46). Calibrated: `--calibrate` reports 2 classes |
| **ontology census (M14/ZIG.O)** | `fixtures/zig/ontology-census.ts` | **3,834 of 3,834 files, the whole admitted corpus** — symbols, kinds, empty names, `unknown` endpoints, per-type resolution at two tiers, confidence and evidenceClass histograms |
| **construct probe (M14/ZIG.O)** | `fixtures/zig/construct-probe.ts` | instrument A + instrument B over the same draw; **12 / 12 controls pass**, corpus and control recorders separated and asserted uncontaminated |
| **dangling-source census** | `fixtures/zig/dangling-source-census.ts` | **8 / 8 controls pass**; residual class 0 before the Z59 fix and after it |
| **parse-defect census** | `fixtures/zig/parse-defect-census.ts` | 810 ERROR / 44 MISSING nodes bucketed with snippets; 6 / 6 controls pass; the two named classes are 0 corpus-wide with the controls firing |
| **store-denylist census** | `fixtures/zig/store-denylist-census.ts` | 4 / 4 controls pass; the denylist is PARSED from `src/ast/pool-worker.ts`, not copied |
| F3 fixtures (Z59 pin) | `fixtures/zig/unpublished-scope-source-z59` | **8 / 8 pass**; calibrated — reverting the analyzer fails it with 5 missing expectations and all 6 forbidden pre-fix shapes present |
| F4 mutations after Z59 | `BB_MUTANT_ONLY="zig/" mutate-analyzer.ts` | **50 / 50 CAUGHT** (50 of 1,483). The new fixture is the catcher for 4 of them — `container-member-exported`, `instantiates-generic-dropped`, `exports-edge-dropped`, `import-binding-symbol-dropped` — so it adds mutation-catching power and not only a row |
| F1 grammar audit after Z59 | `audit-analyzer-grammar.ts` | **zig PASS — 50 refs, 0 unknown node types, 0 unknown fields**, unchanged by the new predicate |
| parse-error census | `zigw-parse-errors.ts` | **93 / 3,839 (2.4%)** files carry ERROR nodes, 811 ERROR nodes, 0 MISSING — bucketed: 43 intentionally invalid (`compile_errors` plus a langref page), 45 inline asm, 2 keyword-named fields, 3 labeled blocks in expression position. No analyzer defect in any of them (Z42) |
| **pass-2 adversarial audit** | `fixtures/zig/pass2-adversarial.ts` | **3,834 of 3,834 files, 8 shards merged, 45 distinct controls with 0 failing.** 13 probes: 7 classes at 0 findings (`calls` reserved target / not-called / digit-headed; `uses` reason code ×3; `exports` not-public; `payload` non-declared identifier) and 6 with counts, every one reported above. Production facts from `parseFile`, tree facts from a second parse of the same bytes |
| **pass-3 adversarial audit** | `fixtures/zig/pass3-adversarial.ts` + `pass3-merge.py` | **3,834 of 3,834 files, 8 shards merged, union hash asserted equal to the published draw, `fallbackFiles` 0, 27 controls with 0 failing** (13 pure-predicate + 14 END-TO-END, each running the same `probeFile` the corpus runs). 9 probes: 4 at zero findings (P2 destructuring, P4 source-vs-scope, P5 unmapped symbols, P7 `contains` owner), P5's 127,429/127,429 symbol→node mapping with the (kind ← node-type) histogram published, and 5 with counts — 683 lost receiver reads, 4 error-leaf misattributions, 10 wrong-kind `instantiates` targets, 1+3 `exports`, plus P9's site-multiplicity ratios |
| **fallback degradation rate** | `fixtures/zig/fallback-degradation-rate.py` | the rate behind the pass-3 correction. **4 concurrent rounds x 8 shards: 6 of 32 shard-runs degraded, 7 of 14,856 files fell back to `extractFallback`, and one shard process died outright at 3,354 of 3,834 files. 8 sequential shards: 0 of 8 degraded, 0 files fell back.** Cumulative across every concurrent measurement in this lane, 12 of 64 shard-runs against 0 of 11 sequential — so the degradation is a property of concurrency, established by comparison rather than inferred from a symptom. Five distinct stderr signatures recorded, one consequence. **See the pass-3 section for the mechanism in `src/ast/engine.ts`** |
| **census + audit self-certification (pass 3)** | `ontology-census.ts`, `shard-merge.py`, `pass3-merge.py` | both instruments now count `fallback: true` per file and BOTH merges **exit 3 naming the degraded shards** instead of summing a mixture of the analyzer and the regex extractor. The census prints `parseFile FALLBACK files N` and flags N > 0 as *"this run is a MIXTURE"*. Demonstrated by the pass-3 census run that read 510 kindless symbols and 21 sub-0.7 edges from 3 degraded shards |
| **census sharding + merge** | `fixtures/zig/shard-draw.py`, `ontology-census.ts --files-from`, `fixtures/zig/shard-merge.py` | 8 shards partition the published draw; the merge **asserts the union hash equals the single-process draw hash** and it is equal (`sha256:2f3545f9…`), and it RECOMPUTES the corpus-tier columns and every ratio from the summed primitives. Without sharding the census self-destructs (`[BB-HANG]`) — see the ontology section. **`--sample 0` is REQUIRED with `--files-from`** (pass 3): `SAMPLE` truncates the hashed draw before the shard filter, so the documented default silently caps a 480-file shard at 400 and prints a report that looks finished; the merge's union-hash assertion catches it |
| **M60 rel-type coverage** | `rel-type-coverage-gate.ts --langs=zig` | CHECK 1 DERIVATION **clean** (= 0 findings, the number the handover asks for), CHECK 2 REACHABILITY clean, CHECK 3 AGREEMENT clean, CHECK 4 ENUM clean, baseline "104 recorded, 0 NEW, 104 repaid" — **re-run at pass 3, all four checks clean, same baseline, so the lane's DERIVATION count is still 0 as a NUMBER.** **CHECK 1 counts TYPES with an audited label, not independent oracles** — the pass-2 section is what bounds what that is worth. **Not run unscoped, and the run was REVERTED, twice**: `--langs=zig` rewrites `validation/m60/results/rel-type-coverage.json` with only the selected lane, which shrinks a 34-lane evidence file to one — so the file was restored with `git checkout` and the run is reported here rather than committed. §8 |
| **ontology coverage gate (the arbiter)** | `ontology-coverage-gate.ts zig` | **DOES NOT REACH A VERDICT, and pass 3 pins down why it is exit 1 and not a hang.** Pass 2 reported two runs ending `[BB-HANG] parser stuck 120s on zig/lib/std/testing.zig — exiting`. Pass 3 ran it twice: **both runs ran the corpus scan to the end in ~5 minutes and printed `ontology coverage gate — no RULING TABLE for zig.` followed by `Refusing to report: a gate with an empty table would call every un-emitted type RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane`, exit code 1.** `RULED_BY_LANG` in that shared file holds only `bash` and `json`, so zig's three RULED verdicts can never be graded by it; the corpus scan happens first, which is why a degradation in that scan can look like a hang. Both pass-3 runs also logged one `[BB-PARSE-ERR] … memory access out of bounds`, the third signature of the fallback class — see the pass-3 section. The three RULED verdicts were measured with `construct-probe.ts` and re-probed unchanged |
| **doc-truth emissions** | `verify-doc-truth-emissions.ts --no-write` | **zig contributes 0 findings of any kind.** Its verdict table is now parseable (the header is `Relationship type | Emitted?`), so the lane's emission claims are machine-checked: 9 of the 10 rows grade clean — 7 `yes` against 7 emitted kinds and 2 `no` against 2 un-emitted ones, with **0 FALSE_POSITIVE and 0 FALSE_NEGATIVE**. The 10th row (`extends`) is the one `parseClaimTable` cannot read (it skips the first body row of every table — see the caption above). The gate's own summary still reads `-> FAIL` on **7 FALSE_NEGATIVE in other lanes' docs**; zig is not among them |
| **honesty gate** | `bun run script/m14/verify-honesty.ts` | **22 failures at pass 3, none of them this lane's** — the published row said 20, and the two extra are shared-evidence movement on the aggregate branch, not this lane. The `banned-vocabulary lint over validation/m14 + M14 docs` line still reports **ok**; the 11 banned-term failures are in OTHER lanes' artifacts (`fixtures/html`, `fixtures/c`, `fixtures/clean`, `fixtures/csharp`, `fixtures/sql`, `grammar-pins.json`, 4 `results/*.json`) and none names this doc or any file under `validation/m14/fixtures/zig/`. The rest: `M14.0.F7` non-passing `analyzer-hygiene-cpp` and `analyzer-hygiene-elixir`, F1–F9 evidence-freshness (declared inputs moved on the aggregate branch), and `freshness rule flags every artifact — it cannot distinguish current from stale`. Note the lint's own scope: it walks `.md`/`.json` under `validation/m14/` and `docs/**M14**`, and `docs/analyzers/real-zig-analyzer.md` matches neither, so this lane's prose is not machine-linted for banned vocabulary. §8 |
| **incoming-check paired (pass 6)** | `fixtures/zig/incoming-check-paired.ts` | **PASS.** SHARED instrument vs a `/tmp` copy carrying one token (`"brain_import"` → `"imports"`), diffed field by field: **0 differing fields outside the two rows that spell the import class.** Shared reports `fired: false`, 0 edges; patched reports `fired: true`, **253 edges**, 13 distinct targets, 1 ambiguous, 159 unresolved, 0 self-loops; production `parseFile` over the same 134 arguments emits **253**. Three negative controls exit 2: a delta outside the import rows, a patched count disagreeing with production, and a shared run that already reports a non-zero import row. The shared file on disk is unmodified |
| **zero-regex, pass 6** | `script/m12/verify-regex-census.ts` | the shared gate still prints `regex census gate FAILED` and **zig is in none of its 39 MISSING/STALE rows**; `real-zig-analyzer.ts` carries no regex literal and no `new RegExp` / `.match(` / `.replace(` / `RegExp(` |
| **reproduction at HEAD (pass 6)** | fixtures + mutations + firing-check + ruled-gate | **9/9 fixtures pass, 50/50 mutants caught, `firing-check` 7/10 fired and 8,445 edges, `ruled-gate` 7 EMITTED + 3 RULED-SOUND / FALSIFIED 0 / exit 0 with 0 `BB-PARSE-ERR` and 0 `BB-HANG`, and `incoming-check`'s seven-row per-type table identical field for field.** Every published number in this document was re-read at this commit |
| ownership verifier | `zigw-ownership.ts 3000` | 136,720 symbols, AGREE 84,442, **PHANTOM_OWN 0, ORPHAN 0**, COLLISION 1,485 — of which **enclosure disambiguates 1,485, leaving 0 genuinely ambiguous**. The store already resolved ownership by extent (`enclosingStoreableIdByName`), so #963 was filed against a fixed defect and is **resolved** (Z49) | Needed because the differential's coverage match ignores the SOURCE, so it cannot see an ownership error at all. This instrument was itself broken until Z43: it read a quoted name raw where the published symbol name is canonicalized, so it reported **701 phantom owners** that `zigw-contains.ts` — which derives from the grammar and keys on the owner — read as zero |
## Verification (re-run at HEAD, 2026-09-28)

| gate | instrument | result |
|---|---|---|
| F1 grammar audit | `audit-analyzer-grammar.ts` | **PASS** — 43 refs, 0 unknown node types, 0 unknown fields |
| F3 fixtures | `run-fixtures.ts --lang zig` | **6 / 6 pass** — `bare-value-reads`, `calls-uses-complexity`, `callsite-lines-825`, `declaration-vs-definition-612`, `kinds-and-owners` (Z11/Z12/Z19/R1), `declared-type-leaf` (Z13/Z16/Z18) |
| F4 mutations | `BB_MUTANT_ONLY="zig/" mutate-analyzer.ts` | **46 / 46 CAUGHT** (23 from the previous waves, 18 added here — one per fixed class plus three payload reverts) |
| F5 differential, 200-file draw | `differential.ts --repo zig --sample 200` | see `reviews/zig/master-review.md` for the measured row; the `references` class is compared against an independent oracle (Z14) |
| oracle red-team (M14 §5.7) | `zigw-oracle-check.ts` | the same comparison against a pre-fix leaf convicts it — 702 unexplained / 660 missing per 400 files — so the audit is not a tautology |
| ownership verifier | `zigw-ownership.ts` (3,000 files) | 130,192 symbols: AGREE 84,360, **PHANTOM_OWN 0, ORPHAN 0**, COLLISION 1,509 — all same-named containers, filed as #963. Needed because the differential's coverage match ignores the SOURCE, so it cannot see an ownership error at all |
| A/B of the executable-body change | `zigw-dump.ts` (800 files) | 161 spurious symbols removed, 23 genuine `uses` edges gained, 27 fabricated `contains` edges removed |
| zero-regex | `script/m49/verify-r2-regex.ts` + `reviews/regex-policy.md` | **0 regexes** in this analyzer (was 1; see Z18) |

Claim level: **L4, restated at pass 2 and again at pass 3 — the pass-1 L5 is
WITHDRAWN.** Pass 3 adds no level and withdraws none: it re-derived every
published number (the census reproduces exactly at 127,429 / 392,550; the
lane-owned F5 differential reproduces exactly at 60,280 truth rows and 0
unexplained of 56,906; the arbiter's behaviour is now characterised rather than
guessed), and it withdrew one PUBLISHED CLAIM — the "8 of 8 shards report 0 and
0" figure, which was a property of a run rather than of the lane and which is now
a measured rate. It also found two classes of wrong or missing edge that no gate
in this lane can see by construction (a suppressor that fires when it should not
produces an ABSENCE, and an absence reads as the same count as a correct run):
**683 lost receiver reads** and **4 error-leaf misattributions**, plus one
latent rule (a destructuring binds its first slot only) that is measured empty
over 1,033 slots. Pass 1
recorded L5-SCOPED-VERIFIED. Pass 2 found four classes of wrong edge the differential
scores as agreement (759 wrong-source rows, 75 wrongly-named declared-type targets,
615 unbindable `instantiates` targets, 3,721 name-ambiguous `contains` owners), a
gate in this lane's own battery that now FAILS (`completeness-inventory` section-b,
because the shared zig `requiredKinds` row predates the `exports` and `instantiates`
emissions), and a published claim that did not reproduce (the ontology coverage
gate's exit-2, which in fact never prints on a normal run). **L5 requires L2 ∧ L3 ∧
L4 with fresh evidence and declared limitations; L3 is differential agreement, and
the lane's own audit shows what that agreement is worth on four classes of edge, so
L5 is not available for those classes and this document does not claim it.** What
the evidence supports at this commit, against `wasm/tree-sitter-zig.wasm` as pinned
by `validation/m14/grammar-pins.json` and the 3,834-file draw
`sha256:2f3545f92c470090d61c9a745bb427d8d7dec1630d93d0fbc01cb2acdc5ce1ac`: **L2
(grammar audit clean — 50 refs, 0 unknown node types, 0 unknown fields), L4
(50 of 50 zig mutants caught), L1 for the eight fixtures, and L3 for the seven
emitted types WITH the four classes above named as its ceiling.** Limitations are
non-empty and declared below and in **Declared limitations**; the previous footer's
list is retained and extended. Limitations are non-empty and declared: Z48 (the cross-file `instantiates`
remainder is on the order of **1,200 sites (6%)**, not 19,318 — 63.8% of the
qualified-callee population is method calls through a VALUE chain such as
`b.build_root.handle.readFileAlloc`, which no type index should resolve; a
cross-file index buys 541 sites today, and closing the rest needs the index passed
INTO `analyze(root, source, filePath)`, which has no parameter for it, so this is
an API question rather than a detection one), Z42 (93 of 3,839 files carry ERROR nodes —
43 of them intentionally, and the rest confined to three named syntaxes rather than
distributed invisibly), ZIG.GAP.3 (constructions), ZIG.GAP.4 (three two-sided
RHS forms), ZIG.GAP.5 (the labeled-TYPE form does not parse in this grammar),
Z10 (if/while else-arm capture scope), the nested-shadowing
and synthetic-shape rulings in `reviews/zig/master-review.md`, and grammar-version
drift exposure (the analyzer reads `type`, `body`, `name`, `ok` and `operator`
fields, so a grammar bump can change what it sees — which is why the grammar pin
is a gate and not a comment).
---

## The ruling table for the ontology arbiter — `script/m14/zig-ruled.ts` (2026-10-03)

### What the arbiter could and could not say about this lane before

`script/m14/ontology-coverage-gate.ts` is the workstream's arbiter, and its own
header records why it exists: `overrides` was missing from Bash for a whole wave
and the differential stayed green, because the analyzer omitted it and the oracle
was written after that ruling — nothing agrees with nothing. A ruling table is
that gate's instrument for a type the analyzer does not emit, and the table lives
in the shared file's `RULED_BY_LANG`, which held `bash` and `json` only.

**So this lane's three RULED verdicts had never been checked by the arbiter.**
Run unwired, the gate scans the corpus and then refuses:

```
ontology coverage gate — no RULING TABLE for zig.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

(`exit 2`; measured at a bounded 1,200-file `BB_CORPUS_ROOT` and at an empty one.)

### The table

`script/m14/zig-ruled.ts` — three rows, each with the instrument the workstream
defines and the measurement behind it.

| type | instrument | what the probe measures | full-corpus count (3,834 files, draw `sha256:2f3545f9…`) |
|---|---|---|---|
| `extends` | A: grammar-inventory | 17 node types that would express a supertype relation (`class_declaration`, `trait_declaration`, `extends_clause`, `superclass`, `protocol_conformance`, …) | **0 present** of the 232 node types the grammar produces; 0 of 28 inheritance words in the wasm's own 239-entry type table or its 16 fields; A4's header-slot classification 1,797 children / 443 files / **0 UNCLASSIFIED** |
| `implements` | A: grammar-inventory | the same 17, a conformance clause among them | **0 present**; same tables, same zero |
| `overrides` | B: parse-tree-count | a same-scope duplicate DECLARATION, excluding destructuring rebinds, files that quote the compiler's own diagnostic for that identifier, and duplicate error-set members (which the compiler rejects too) | **0 read by the probe; 19 raw duplicate sites, 21 including 2 duplicate error-set members — every one a construct the compiler refuses** |

`Ruled` is restated in the file because the gate does not export it and the gate
is shared. **Wiring needed (§8): one import and one map entry** —
`import { ZIG_RULED } from "./zig-ruled"` and
`{ bash: BASH_RULED, json: JSON_RULED, zig: ZIG_RULED }` — the same shape css, nim,
protobuf, json, clean, powershell, julia, markdown, scss, solidity, yaml and sql
already needed in this wave. The two lines were applied locally to measure the
table and **reverted before this commit**: the gate file is not mine.

### The arbiter's verdict, on the FULL corpus

```
ontology coverage gate — zig
corpus: 3834 admitted files

type          status            detail
-----------------------------------------------------------------------------------------------
calls         EMITTED           113,476 edges in 4+ files, e.g. ghostty/example/c-vt-build-info/build.zig, ghostty/build.zig
uses          EMITTED           132,201 edges in 4+ files, e.g. ghostty/example/c-vt-build-info/build.zig, ghostty/build.zig
contains      EMITTED           77,459 edges in 4+ files, e.g. ghostty/pkg/apple-sdk/build.zig, ghostty/pkg/dcimgui/main.zig
imports       EMITTED           10,200 edges in 4+ files, e.g. ghostty/example/c-vt-build-info/build.zig, ghostty/build.zig
references    EMITTED           30,794 edges in 4+ files, e.g. ghostty/example/c-vt-build-info/build.zig, ghostty/build.zig
exports       EMITTED           24,114 edges in 4+ files, e.g. ghostty/example/c-vt-build-info/build.zig, ghostty/build.zig
extends       RULED-SOUND       NOT EMITTED; the grammar produced 232 distinct node types across the corpus and NONE expresses it
implements    RULED-SOUND       NOT EMITTED; the grammar produced 232 distinct node types across the corpus and NONE expresses it
overrides     RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree
instantiates  EMITTED           4,306 edges in 4+ files, e.g. ghostty/pkg/fontconfig/pattern.zig, ghostty/pkg/freetype/face.zig
-----------------------------------------------------------------------------------------------
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
```

**7 EMITTED + 3 RULED-SOUND = 10 of 10 decided**, the first time an arbiter has
ruled for this lane and the first time the three RULED verdicts were checked by
anything other than the lane that wrote them.

**The arbiter's seven emitted counts equal the lane census's, edge for edge**
(113,476 / 132,201 / 77,459 / 10,200 / 30,794 / 24,114 / 4,306). That is a second
account of the same population taken by different code, and it is worth recording
*how* it nearly did not: an earlier run of the same command on the same corpus
printed 4 `[BB-PARSE-ERR] … memory access out of bounds` lines and came back
**27 edges low** (calls 113,475, uses 132,191, references 30,793, exports 24,100,
instantiates 4,305) before dying on
`[BB-HANG] parser stuck 120s on zig/test/cases/compile_errors/bad_usage_of_call.zig
— exiting`. Each degraded file is silently replaced by the regex `extractFallback`,
which emits none of the five affected classes, so a run of the arbiter is only
trustworthy when it prints no `BB-PARSE-ERR`. **That is a property of the run, not
of the corpus** — the pass-3 section above measures a rate for the cross-process
half of it. Which half degraded THIS run is not established: the gate is a single
process, so the accumulated-WASM-state trap and the shared
`os.tmpdir()/bb-wasm_<grammar>` race are both consistent with it, and one run does
not vary the other factor. The arbiter has no fallback counter of its own to notice
either.

A bounded root was also run, through
`validation/m14/fixtures/zig/arbiter-corpus-root.py` (the first 1,200 files of the
same draw, `sha256:d60b554a…`, 26 MB, `ghostty=234 zig=930 zls=36`): 7 EMITTED,
3 RULED-SOUND, 0 FALSIFIED, with the emitted counts at 29,588 calls / 35,867 uses /
21,733 contains / 3,143 imports / 9,076 references / 6,433 exports / 1,253
instantiates. That path exists because the gate scans the whole corpus BEFORE it
consults `RULED_BY_LANG`, so a lane whose corpus trips the hang guard gets no
verdict at all rather than the cheap refusal.

### The arbiter convicted MY OWN PROBE three times, which is the part worth keeping

A ruling table is only as good as the probe in it, and every one of the arbiter's
objections to this one was a false positive that read as "derivable" — the exact
verdict a wrong instrument produces.

1. **942 phantom sites on a 200-file draw.** Three scope errors in one walk: a
   child scope was seeded with a COPY of its parent's declarations (so
   `error_bundle` in a nested anonymous struct collided with the outer struct's
   field of the same name), error-set members were filed under the ENCLOSING scope
   (so two unrelated error sets collided at file scope), and only `block` opened a
   scope when an expression-position `{ … }` is a `block_expression`. Fixed by
   seeding an empty map, by reading error-set members on the `error_set_declaration`
   itself, and by taking the scope openers from the node types the grammar
   actually produces.
2. **`overrides … FALSIFIED … zig/test/behavior/optional.zig: ZeroBit member
   declared twice`.** The site is `var two: ?struct { ZeroBit, ZeroBit }` — a
   TUPLE type annotation, whose two positional fields put a user-declared type name
   in the `name` field with no `type` field. Z28's rule ("read the name field only
   when it is an identifier") is necessary and not sufficient; the discriminator is
   the missing `type` field, because a named field is `name: Type`.
3. **`overrides … FALSIFIED … zls/tests/analysis/error_union.zig: Foo error-member
   declared twice`.** `const DuplicateErrorName = error{ Foo, Foo } || error{Bar};`
   in a zls ANALYSIS test, which — unlike the zig fixtures — does not quote the
   diagnostic. The compiler settles it: `lib/std/zig/AstGen.zig:5945` in the
   corpus's own checkout emits `duplicate error set field '{s}'` and returns
   `astgen.failTokNotes`, and
   `zig/test/cases/compile_errors/duplicate_error_value_in_error_set.zig` is its
   rejection fixture. An error set has no second spelling, so no accepting program
   contains a duplicate member; the probe now excludes that kind on the compiler's
   authority rather than on a quoted message.

The same shapes run against the SHIPPED analyzer found **no phantom symbol and no
phantom `contains` edge** — `parseFile` on `zig/test/behavior/optional.zig` and
`zig/lib/std/Build.zig` publishes 0 symbols named `ZeroBit`, `u16` or `u8`, and 0
member edges for the tuple types, because an anonymous container owns nothing under
Z21/Z22. So all three were defects in the instrument and not in the analyzer, which
is the correct place for them to be, and it is the third time in this lane's
history that the instrument rather than the analyzer manufactured the class.

Ten controls run through the exported probe on every invocation — three positives
that must fire, seven negatives that must not — and `zig-ruled-probe.ts` exits
non-zero if any control fails, if the probe reads non-zero, if any listed supertype
node type is produced, or if the keyword calibration drops below 10 of 11. Both
tuple shapes, the error-set duplicate and the quoted-diagnostic duplicate are
controls now.

### Full-corpus numbers, from instruments that never touch `parseFile`

The two instruments that carry the full-population measurements load the pinned
wasm directly (`wasm/tree-sitter-zig.wasm`), so they are immune to the
`extractFallback` degradation above and the fallback flag cannot make one of their
zeros mean "cannot see".

- `construct-probe.ts`, re-run today over the whole admitted population:
  **3,834 files, draw `sha256:2f3545f9…` — byte-identical to the draw every other
  published zig figure names**, 239 declared node types, 16 declared field names,
  28 of 28 inheritance words absent from both, A4 1,797 header-slot children in
  443 files with 0 UNCLASSIFIED, B1 = 3, B2 = 14 (9 destructuring, 5 plain),
  B3 = 9 with 9 of 9 inside `compile_errors/`, and 12 of 12 controls as expected.
  Every number in **The three RULED types, each falsifiable** above reproduced
  exactly, which is what re-reading a ruling is for.
- `zig-ruled-probe.ts`, new today: **0 hits from the probe the gate runs, 19 raw
  same-scope duplicate declarations (21 including the 2 duplicate error-set
  members), 232 distinct node types produced, 0 of the 17 supertype names
  present**, keyword calibration 10 of 11 — the missing one is `usingnamespace`,
  which this grammar spells as a named node rather than an anonymous token, and the
  calibration's purpose is to show the inventory holds keywords at all.

The raw sites decompose as the lane's B1/B2/B3 probes do (3 duplicate functions,
5 duplicate bindings, 9 duplicate members = 17 counted by probe identity rather
than by site; this probe counts SITES, 19, and 21 with the error-set class). Every
one of them sits in a file that quotes the compiler's own diagnostic for that
identifier in a comment — including
`zig/test/cases/global_variable_redeclaration.zig`, which sits OUTSIDE
`compile_errors/`. A path rule would have missed that file; reading the comment is
what makes the exclusion a fact about the file rather than a convention about a
directory. **OVERTURN condition, stated so the arbiter can check it without this
document:** a same-scope duplicate declaration in a file that does not carry the
compiler's own duplicate/redeclaration diagnostic naming that identifier, and is not
a duplicate error-set member. The probe pushes only those, so the arbiter flips the
`overrides` row to FALSIFIED by itself.

### Items for the supervisor (§8), stated so they can be applied directly

1. **Wire the table.** `script/m14/ontology-coverage-gate.ts`: add
   `import { ZIG_RULED } from "./zig-ruled"` and the `zig:` entry in
   `RULED_BY_LANG`. Exporting the `Ruled` type from the gate would also let lane
   tables stop restating it.
2. **The gate decides after it scans.** `RULED_BY_LANG[LANG] === undefined` is
   checked at line ~312, AFTER the `parseFile` sweep, so a lane whose corpus trips
   the engine's 120 s hang guard gets `[BB-HANG] … exiting` and no verdict rather
   than the cheap `exit 2`. Moving the refusal above the corpus walk makes the
   refusal observable on every lane.
3. **`rulingFor` picks the SUPERSEDED decision.** All three RULED rows cite
   `script/m14/spec/zig-completeness.json#ZIG.D.1`, whose own text begins
   "SUPERSEDED per type by ZIG.O.1 … ZIG.O.4"; the live decisions are ZIG.O.1,
   ZIG.O.2 and ZIG.O.3. `rulingFor` takes the first `status === "RULED"` decision
   whose body mentions the type, and ZIG.D.1 mentions all four in one sentence. A
   decision whose resolution opens with `SUPERSEDED` should be skipped.
4. **Instrument A cannot express a POSITION probe.** The `Ruled` shape has two
   instruments and one of them is a table lookup, so `extends`/`implements` are
   decided in the gate by node-type presence alone. For zig the closing evidence is
   positional — the header slot of a type declaration, 1,797 children,
   **0 UNCLASSIFIED** — and that cannot be carried in this shape. Either
   `countOnTree` becomes legal for instrument A (an enum, not a literal union), or
   the gate's own output should say that an instrument-A ruling is a vocabulary
   absence rather than a position test. Today it prints only the first, and the
   lane's `describe` string — which does carry it — is never printed by the gate.
5. **The arbiter cannot see its own degradation.** A full-corpus run that trips the
   WASM trap publishes counts 27 edges low with no marker in its verdict table
   (`fallback: true` exists on the `parseFile` result and nothing reads it). A
   counter beside the corpus line — files parsed, files fallen back — would make the
   difference between a run that measured the analyzer and one that measured a
   mixture visible in the arbiter's own output.
6. **Nothing consumes `metadata.targetScope`, so Z65 changes no answer yet.**
   `src/ast/engine.ts` (shared) is where a relationship's `target` STRING becomes a
   `target_symbol_id`, and it matches by name. Two changes make the label load-bearing
   and neither is in a lane's file: (a) when `targetScope === "file-local"`,
   restrict candidate resolution to the edge's own file before falling back to the
   corpus — this is what converts the measured 151,004 breakable ambiguous edges
   into resolved ones and it removes the 143,256 misbindings; (b) when
   `targetScope === "file-external"`, do not resolve by name across the corpus at
   all, because 172,022 edges name something outside the file and a cross-file
   name match on them is a guess. `src/lsp/identity.ts`'s resolver is the other
   candidate site; it already reports `rootMatch.nameMatches`, and the number to
   compare against is the `tgt AMBIGUOUS` column above.
7. **RESOLVED, then two defects in the pair that landed.** Both files now exist and
   this lane has been re-run through them (sections A and C above). Two defects,
   each a report rather than a fix:

   - `script/m14/incoming-check.ts:65-76` keys its per-type table on the literal
     `"brain_import"`, and lines 161-162 drop any label not in that array. The
     store's relationship label is `"imports"` — `src/ast/engine.ts:454`
     `RelationshipType.Imports = "imports"`, `src/ast/graph.ts:38`, and the DB
     column values are `relationship_type IN ('imports','exports')`
     (`src/ast/real-nim-analyzer.ts:1217,1311`) — and `brain_import` is a TABLE
     name. Measured on this lane's own 120-file draw through production
     `parseFile`: `firing-check.ts` reports 256 `imports` edges,
     `incoming-check.ts` reports **0**. Fix: add `"imports"` to that array, or route
     the label through `firing-check.ts`'s `LABEL_ALIASES`. Every lane that emits
     the store's own label is currently invisible to this instrument.
   - `script/m14/incoming-check.ts:102` derives one `projectPath` from
     `path.dirname(files[0])` and passes it to `parseFile` for every file. It is
     harmless today (`parseFile`'s second parameter is unused by the parse path)
     but it reads as project scoping and is not. Separately, a corpus path
     containing a space is split into separate arguments — 17 ENOENT
     `parseFailures` in the 120-file run are fragments of 3 real paths, e.g.
     `zig/test/cases/safety/@intFromFloat cannot fit/boundary/case/max.zig`.

   The lane-owned equivalents are kept: `validation/m14/fixtures/zig/incoming-check.ts`
   and `incoming-resolve.ts`, because they carry the cause ladder
   (`path` / `external` / `neverIndexed` / `declared-local` / `declared-parameter` /
   `builtin-*`) and the `neverIndexed` discriminator — a name is only "never
   indexed" when the TREE declares it and no symbol was published — and because they
   measure the full population, which a single-file universe cannot.

8. **`keepSymbol`'s UNIVERSAL denylist needs a per-language exemption for `Self`,
   `root` and `unknown`** (`src/ast/pool-worker.ts:449`, shared). `Self` is not a Zig
   keyword: `const Self = @This();` is the language's own self-type idiom and a real
   top-level declaration, present in **169 of 3,834 corpus files**, and **240 edges
   name it** — 145 of them now carrying a `file-local` label the store then refuses
   to honour. `root` (157 edges, 57 files) and `unknown` (39 edges, 33 files) are the
   same entry. The list reads as a JS/Rust `this`-analogue set, and `module` /
   `exports` are already handled by a JS_FAMILY guard two lines above; `Self`,
   `root`, `unknown` and `self` need the same treatment, because in Zig they are
   ordinary declaration names rather than a receiver.

9. **`script/m14/firing-check.ts:340` assigns the `files` column instead of
   accumulating it**, so every fired type reads `files: 1` on any population
   (`filesByType` is created per file at line 294). `edges` accumulates correctly
   at line 310. The fsharp lane reported the same line independently.
10. **`script/m14/firing-check.ts:429` names the wrong degradation mechanism, and the
    NDJSON form names no file at all.** It prints "fell back to the regex extractor",
    but `src/ast/pool-worker.ts:779-794` returns
    `{symbols: [], relationships: [], fallback: true}` for a file over 5 MB
    WITHOUT running `extractFallback`, which is the 1–5 MB path (line 811). The one
    degraded file in this lane's 120-file draw is
    `zig/lib/compiler_rt/udivmodti4_test.zig` at 10,249,535 bytes, contributing 0
    symbols and 0 edges. Corpus-wide: 3,834 files ≤ 512 KB, 10 at 512 KB–1 MB, 2 at
    1–5 MB, 2 over 5 MB — 4 of 3,848 degrade, and 14 exceed the 512 KB ceiling the
    arbiter admits under. Line 392 emits `degradedDetail: {}`: the field exists and
    is always empty, so the machine-readable output can name neither file nor cause.
11. **The shared arbiter's exit code is not a verdict on this lane.** Three runs of
    the patched copy over the same 1,200-file root gave an identical verdict table
    and exit codes 0, 1, 0, because the pinned zig wasm crashes under the concurrent
    fan-out — a DIFFERENT `zig/test/cases/compile_errors/` fixture each round — and
    the engine's 120 s `[BB-HANG]` guard fires on that same file. The same file
    parses alone in 865 ms with 4 symbols and 4 relationships, and 3 rounds × 8
    workers over 61 files produced no crash at all, so the population size matters.
    A `fallback` counter beside the corpus line (already item 5) and not exiting the
    process on a parse that already recovered are the two changes that would make
    the arbiter's own output trustworthy here.
## Pass 5 — the shared instruments, and the arbiter run as a proof (2026-10-03)

The two shared instruments this lane previously recorded as non-existent
(§8 item 7 below) now exist, and the arbiter can rule for five lanes. Everything
below is measured through those shared paths so the numbers are comparable with
every other lane's, not through lane-owned equivalents.

### A. `script/m14/firing-check.ts` — what fires, on its own 120-file draw

```
npx tsx script/m14/firing-check.ts --files 120 zig
7/10 fired, 8445 edges, 120/120 files, 1 DEGRADED
```

Corpus 3,848 tracked `.zig` files; the draw is the instrument's own stride
(stride 32, sorted), reproduced byte-identically in
`/tmp/opencode/zig-lane/draw120.ts` so the incoming run below used the same 120
files.

| type | edges | source published | source external | both ends resolve | conf < 0.7 | `evidenceClass` missing |
|---|---|---|---|---|---|---|
| `calls` | 2,569 | 2,121 | 448 | 714 | 0 | 0 |
| `uses` | 2,623 | 1,911 | 712 | 587 | 0 | 0 |
| `contains` | 1,722 | 1,722 | 0 | 1,722 | 0 | 0 |
| `imports` | 256 | 0 | 256 | 0 | 0 | 0 |
| `references` | 720 | 0 | 720 | 0 | 0 | 0 |
| `exports` | 415 | 0 | 415 | 0 | 0 | 0 |
| `instantiates` | 140 | 66 | 74 | 63 | 0 | 0 |
| `extends` `implements` `overrides` | 0 | — | — | — | — | — |

Also from that run: `emptySymbolNames 0`, `emptyOrUnknownKind 0`,
`unknownEndpoints 0`, `parseFailures 0`.

Three readings of this table, none of them flattering by default:

- **`calls`/`uses`/`instantiates` are mostly external-source edges.** 448 of 2,569
  `calls` edges have a source the run did not publish. A graph cannot walk out of
  those, and it is not a defect in the analyzer: a call inside a function body has
  the function as its source, and the count is published per file, so this needs
  the per-class breakdown below before it is called anything.
- **`imports`, `references` and `exports` read 0 published sources and 0
  resolution** on a per-file universe. That is CORRECT for zig and it is the
  incoming check's point: these three carry a MODULE PATH or a PUBLISHED API name
  as their target, and a single file publishes neither the imported module nor the
  consumer of an export. `contains` resolves 1,722 of 1,722 because both endpoints
  of a containment edge are declarations in the same file. The comparison the
  workstream asks for — CSS `references` at 66.8% both-ends — has no zig
  equivalent, and saying "zig resolves references at 0%" without that sentence
  would be the misleading number.
- **0 edges below confidence 0.7 and 0 missing `evidenceClass`** across all 8,445
  edges: the heuristic ratio this lane publishes is 0, and it is countable rather
  than asserted.

### B. The instrument's own two defects, measured (not mine to fix)

1. **`files` is assigned, not accumulated** — `script/m14/firing-check.ts:340`,
   `for (const [type, set] of filesByType) res.types[type].files = set.size`.
   `filesByType` is created fresh per file (line 294), so every fired type reads
   `files: 1` on any population. `edges` is correct (`row.edges++`). Any lane
   quoting that column is quoting 1. Identical to the defect the fsharp lane
   reported; the per-type file counts elsewhere in this document come from
   instruments that accumulate into a `Set` outside the loop.
2. **"fell back to the regex extractor" is the wrong mechanism, and this lane can
   name the file.** The 1 degraded file in the 120-file draw is
   `zig/lib/compiler_rt/udivmodti4_test.zig`, **10,249,535 bytes**.
   `src/ast/pool-worker.ts:779-794` returns `{symbols: [], relationships: [],
   fallback: true}` for any file over 5 MB — no regex extractor runs, and the file
   contributes 0 symbols and 0 edges. `extractFallback` is the 1–5 MB path
   (line 811). Measured over the whole corpus: **3,834 files ≤ 512 KB, 10 in
   512 KB–1 MB, 2 in 1–5 MB, 2 over 5 MB**, so 4 of 3,848 (0.104%) degrade and 14
   (0.364%) exceed the 512 KB ceiling the arbiter admits under. The NDJSON form
   compounds it: `degradedDetail: {}` is emitted empty (line 392), so the
   machine-readable output names neither the file nor the cause.

### C. `script/m14/incoming-check.ts` — and a disagreement between the two

```
npx tsx script/m14/incoming-check.ts --json zig <the same 120 files>
distinctIncomingTargets 1892   orphanDeclarations 114 of 2807 (4.06%)
degraded 1   symbols 2807   target names resolving to >1 published symbol: 82
```

| type | fired | edges | distinct targets | ambiguous | unresolved | self-loops |
|---|---|---|---|---|---|---|
| `calls` | yes | 2,562 | 382 | 301 | 1,359 | 78 |
| `uses` | yes | 2,613 | 577 | 288 | 1,101 | 53 |
| `contains` | yes | 1,722 | 1,245 | 175 | 0 | 0 |
| `references` | yes | 714 | 214 | 38 | 323 | 0 |
| `exports` | yes | 409 | 342 | 65 | 0 | 0 |
| `instantiates` | yes | 140 | 13 | 111 | 3 | 0 |
| `brain_import` | **NO** | **0** | 0 | 0 | 0 | 0 |

**`brain_import` is 0 here and 256 in `firing-check.ts`, on the same production run
over the same 120 files. The cause is a key, not the analyzer.**
`script/m14/incoming-check.ts:65-76` lists `"brain_import"` in its `TYPES`, and
line 161-162 does `const row = perType[label]; if (!row) continue`. This lane's
analyzer emits the label `"imports"` — and `"imports"` is the STORE's spelling:
`src/ast/engine.ts:454 RelationshipType.Imports = "imports"`,
`src/ast/graph.ts:38 Imports = "imports"`, and the DB column values are
`relationship_type IN ('imports','exports')`
(`src/ast/real-nim-analyzer.ts:1217,1311`). `brain_import` is a TABLE name, not a
relationship label. `firing-check.ts:96-107` bridges both spellings through
`LABEL_ALIASES`; `incoming-check.ts` does not, so it drops every import edge in
every language that emits the store's own label. One-line fix (§8): put
`"imports"` in that `TYPES` array, or route the label through the same
`LABEL_ALIASES` bridge. Until then, `incoming-check`'s `imports` row is 0 for zig
and is not a fact about zig.

Two more consequences of the same file, both measured here:

- **`projectPath` is the first file's directory, for every file.**
  `incoming-check.ts:102` takes `path.dirname(files[0])` and passes it to
  `parseFile` for all 120. `parseFile`'s second parameter is unused by the parse
  path (`src/ast/pool-worker.ts:772` is its only occurrence), so no count here is
  affected — but the signature invites a reader to believe the run was
  project-scoped.
- **A path with a space is split into two arguments.** 17 `parseFailures` in that
  run are ENOENT on fragments (`cannot`, `fit`, `boundary`, `-`, `max.zig`, …) of
  3 real zig paths, e.g.
  `zig/test/cases/safety/@intFromFloat cannot fit/boundary/case/max.zig`. The tool
  takes `<file>...` positionally and the shell has already split them. Those 3
  files are absent from every count above.

### D. The `overrides` ruling-table numbers, measured through the SHARED arbiter

`validation/m14/fixtures/zig/ruled-gate.ts` copies
`script/m14/ontology-coverage-gate.ts` to `/tmp`, applies exactly the two lines
the permanent wiring needs, prints them, runs the copy, and then diffs the gate's
printed rows against an INDEPENDENT restatement. `script/m14/ontology-coverage-gate.ts`
on disk is untouched.

```
BB_CORPUS_ROOT=<1,200-file root> BB_ZIG_RULED_WORKERS=4 \
  npx tsx validation/m14/fixtures/zig/ruled-gate.ts
```

Population: the first 1,200 files of this lane's own
`sha256(ontology-census-v1|repo/rel)` draw — `sha256:d60b554a…`,
`ghostty=234 zig=930 zls=36`, built by `arbiter-corpus-root.py`.

```
calls         EMITTED      29,588 edges
uses          EMITTED      35,867 edges
contains      EMITTED      21,733 edges
imports       EMITTED       3,143 edges
references    EMITTED       9,076 edges
exports       EMITTED       6,433 edges
extends       RULED-SOUND  the grammar produced 231 distinct node types across the corpus and NONE expresses it
implements    RULED-SOUND  the grammar produced 231 distinct node types across the corpus and NONE expresses it
overrides     RULED-SOUND  the construct occurs 0x on the parse tree
instantiates  EMITTED       1,253 edges
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
exit 0
```

The three RULED rows are the first verdicts on this lane's rulings produced by
anything other than the lane that wrote them. The gate's EMITTED counts here match
the run recorded above for the same 1,200-file root (29,588 / 35,867 / 21,733 /
3,143 / 9,076 / 6,433 / 1,253).

### E. The diff, and the two claims of mine it falsified

The runner compares three sources: `EXPECTED` (restated as literals in the runner),
`script/m14/zig-ruled.ts` as the gate reads it, and the gate's own printed rows.
Fields per ruled row: `type`, `instrument`, `nodeTypesThatWouldMeanIt`
element-wise, `countOnTree` presence, every measured number in `describe`
cross-checked against the spec decision `ZIG.O.1`–`ZIG.O.3`, and the gate's status,
basis string and cited ruling source.

**It failed twice on first run, both times on my own table.**

1. `overrides.describe-numbers: describe states [28, 17, 17, 17] and ZIG.O.3's
   resolution does not`. The describe claimed "17 duplicate-declaration sites …
   17 of 17" and attributed them to `construct-probe.ts`. Running **the probe the
   gate runs** over the full 3,834-file corpus gives **21 raw** — 8 container
   members, 4 functions, 7 bindings, 2 error-set members — and 0 surviving. The 17
   is real and belongs to `construct-probe.ts`'s three narrower sub-probes; the
   two numbers were never reconcilable from the text. Both are now stated, each
   attributed to the instrument that measured it.
2. `keywordCalibrationPresent: 10` of 11 in the probe's own artifact, against
   "11 of 11 tested zig keywords" in the ruling table. Measured to settle it:
   `Language.types` declares 239 node types and holds **11 of 11** of the tested
   keywords, including `usingnamespace`; the corpus **produces** 232 node types
   and **10 of 11**, the absence being `usingnamespace`, which occurs in **0 of the
   corpus's 3,848 files** (checked in `zig@738d2be9`, `zls` and `ghostty` — upstream
   deprecated it). It is a fact about the corpus, not about the grammar: the same
   wasm parses `usingnamespace std;` into
   `(using_namespace_declaration (identifier))`. The probe had been filtering the
   PRODUCED set when the calibration's purpose is to test the DECLARED table, and
   it therefore failed its own exit criterion while the ruling table asserted the
   declared-table number. Both numbers are now recorded; the exit criterion is the
   declared one.

A third correction, found by the 2×2 the probe now runs rather than by the diff:
the `overrides` probe's comment claimed the error-set-member rule "is the rule
that takes the count from 1 to 0" while implying it removed the whole raw set.
Measured, with the new fifth parameter switching that rule off:

| quoted-diagnostic | error-set-member | sites |
|---|---|---|
| OFF | ON | 19 |
| OFF | OFF | 21 |
| ON | ON | **0** (what the gate reads) |
| ON | OFF | 1 |

So the corpus carries 2 duplicate error-set members, the quoted-diagnostic rule
removes 19, and the error-set-member rule removes exactly the 1 that survives it —
a zls analysis test whose expected annotation is the resulting error SET. The
earlier sentence was half right and has been replaced by the table.

**Negative control.** Two mutations of `EXPECTED` — `overrides`'s instrument
changed to `A:grammar-inventory`, and one extra node type `class_body` added to
`extends` — produce 3 `DIFF` lines and `exit 2`:

```
DIFF: extends.nodeTypes.length: table 17 vs expected 18
DIFF: extends.nodeTypes[17]: table undefined vs expected "class_body"
DIFF: overrides.instrument: table B:parse-tree-count vs expected A:grammar-inventory
```

So a clean diff is a fact about the three sources agreeing, not a comparison that
cannot fail.

### F. The gate's exit code is not about the verdicts, and this is measurable

Three proof runs on the same 1,200-file root: **the verdict table was byte-identical
every time** (`emitted 7/10  ruled-sound 3  FALSIFIED 0  ruled-without-justification 0`)
while the **process exit code read 0, 1, 0**. The non-zero runs are the pinned wasm
crashing under the concurrent fan-out, not a ruling being falsified.

The crash class, measured with 8 workers over the same 1,200 files, two rounds:

```
round 1  [BB-PARSE-ERR] zig | zig/test/cases/compile_errors/undefined_value_call.zig | memory access out of bounds
         [BB-HANG]      parser stuck 120s on the same file — exiting
round 2  [BB-PARSE-ERR] zig | zig/test/cases/compile_errors/union_access_of_inactive_field.zig | memory access out of bounds
         [BB-HANG]      parser stuck 120s on the same file — exiting
```

A **different file each round**, so it is a class and not a file — the same shape
the fsharp lane reported for F#. Each crash is followed by a 120 s hang on that
same file and the engine's guard fires. The same file parsed ALONE is fine:
`truncate_sign_mismatch.zig`, 583 bytes, **865 ms, 4 symbols, 4 relationships, no
fallback**. A control that isolates the fan-out — 3 rounds × 8 workers × 61 files
including an offender — produced 0 crashes and 1 `fallback` (the 10 MB file's size
guard), so 61 files is too small a population to reproduce it and 1,200 is not.

`src/ast/engine.ts` is shared (§8). Not fixed here.

### G. Coverage, reported as applicable

**7 EMITTED + 3 RULED-SOUND = 10 of 10 applicable, decided**, and now decided by the
shared arbiter rather than by this lane's own instruments:

- numerator (7 fired) from `script/m14/firing-check.ts` through production `parseFile`;
- denominator (3 measured-absent) from the shared arbiter's instrument A over the
  grammar's own node inventory and instrument B over the parse tree.

Two different instruments, as the workstream requires. The 3 RULED rows each carry
an instrument, a probe, a measured count and an overturn condition that the arbiter
re-measures by itself — which is why `FALSIFIED 0` is a result and not an absence.

## Pass 6 — re-measuring every published number at HEAD, and the number the shared `imports` blind spot hides (2026-10-03)

Pass 5 ended without a handover, so the first question pass 6 asks is whether its
numbers survive a fresh reading of the same commits. Every one of them does, and
two of them were being read past a shared instrument that cannot see this lane.

### A. What reproduces, and how it was re-read

| claim | pass 5 / earlier | pass 6 at HEAD | instrument |
|---|---|---|---|
| fixtures | 9 / 9 pass | **9 / 9 pass** — `bare-value-reads`, `calls-uses-complexity`, `callsite-lines-825`, `declaration-vs-definition-612`, `declared-type-leaf`, `kinds-and-owners`, `relationship-classes`, `target-scope`, `unpublished-scope-source-z59` | `run-fixtures.ts --lang zig` |
| mutants | 50 / 50 caught | **50 / 50 caught** (50 of 1,748) | `BB_MUTANT_ONLY="zig/" mutate-analyzer.ts` |
| what fires | 7/10, 8,445 edges | **7/10 fired, 8,445 edges, 120/120 files, 1 degraded** | `script/m14/firing-check.ts --files 120 zig` |
| the 10 verdicts | 7 EMITTED + 3 RULED-SOUND | **7 EMITTED + 3 RULED-SOUND, FALSIFIED 0, exit 0**, 0 `BB-PARSE-ERR`, 0 `BB-HANG`, 204 s | `fixtures/zig/ruled-gate.ts` on the 1,200-file root |
| the arbiter's emitted counts | 29,588 / 35,867 / 21,733 / 3,143 / 9,076 / 6,433 / 1,253 | **identical, edge for edge** | same run |
| `incoming-check` per type | the 7-row table above | **identical, field for field** (2,562 / 2,613 / 1,722 / 714 / 409 / 140 and every companion column) | `script/m14/incoming-check.ts --json` |
| regex census | 0 zig entries | **0 zig entries**; `grep -nE '/[^/ ][^/]*/[gimsuy]*'` on `real-zig-analyzer.ts` matches only comment prose (`integer`/`float`), and there is no `new RegExp`, `.match(`, `.replace(` or `RegExp(` anywhere in the file | `script/m12/verify-regex-census.ts` |

The gate named by the workstream's last correction —
`npx tsx script/m12/verify-regex-census.ts` — still prints `regex census gate FAILED`,
and **zig is not in its output**: the 39 `MISSING`/`STALE` rows are `real-css-`,
`real-scss-`, `real-sql-`, `real-svelte-`, `real-xml-`, `real-clean-`, `real-fsharp-`,
`real-javascript-`, `real-python-`, `real-typescript-` and `real-vue-` analyzers.
This lane's own defect in that class was paid down before pass 5 and there is
nothing here to fix.

### B. The `imports` blind spot, measured rather than described

Pass 5 reported that `incoming-check.ts` reads `brain_import` at 0 while
`firing-check.ts` reads `imports` at 256, and correctly declined to quote the
missing row's contents because the lane had never run the instrument with the key
corrected. That left the workstream's deliverable **D — every applicable
relationship must resolve — unmeasured for the one class the shared instrument
drops entirely.**

`validation/m14/fixtures/zig/incoming-check-paired.ts` closes that. It runs the SHARED
instrument unmodified, then a `/tmp` copy carrying **exactly one token changed**
(`"brain_import"` → `"imports"` in the `TYPES` literal), diffs the two per-type
tables field by field, and re-measures the class a third time through production
`parseFile` over the same files. `script/m14/incoming-check.ts` on disk is untouched
and the patched copy is never committed.

Over `firing-check.ts`'s own 120-file draw (`/tmp/opencode/zig-lane/zig120.txt`,
reproduced by `draw120.ts` from the same rule at `firing-check.ts:172-194`):

| | shared, unmodified | patched, one token | production `parseFile` |
|---|---|---|---|
| import row name | `brain_import` | `imports` | — |
| `fired` | **false** | **true** | — |
| `edges` | **0** | **253** | **253** |
| `targetsDistinct` | 0 | **13** | — |
| `ambiguousTargets` | 0 | **1** | — |
| `unresolvedTargets` | 0 | **159** | — |
| `selfLoops` | 0 | 0 | — |
| symbols / degraded / parseFailures | 2,807 / 1 / 17 | 2,807 / 1 / 17 | — |

**253 of 253 agree between the patched instrument and production**, and the
field-by-field diff is **0 differing fields outside the two rows that spell the
import class** — so the patch is a key change and not a behaviour change, which is
what makes the number quotable. A run whose delta spilled into another type would
have exited 2; so would a patched count that disagreed with production, and so
would a shared run that already reported a non-zero import row. All three are
negative controls on the instrument itself.

**So the row the shared instrument reads as `0 / not fired` is 253 edges over 13
distinct target names, of which 1 is ambiguous and 159 are unresolved edges (37.16%
of the class resolving).** That is the `imports` resolution rate through the
shared incoming path, and it is not a defect rate: the target is a module path as
written, for the reason already stated in **Declared limitations**. What it was
before this pass is worse than a defect rate — it was a **zero**, in a table whose
other nine rows were non-zero, from an instrument that reads the store's own label
wrongly in every language that emits it.

### C. The 256 / 253 difference, attributed to the byte

`firing-check.ts` reports **256** imports edges and `incoming-check.ts` **253** on the
same draw, and the gap is not noise:

- `firing-check.ts` parses its sample in-process and reads **120/120 files**;
- `incoming-check.ts` takes `<file>...` **positionally**, so the shell has already
  split the draw's 3 paths containing spaces
  (`zig/test/cases/safety/@intFromFloat cannot fit - boundary case - signed max.zig`,
  `…/integer negation overflow.zig`, `…/slice sentinel mismatch - floats.zig`) into
  14 fragments. **17 `parseFailures` are ENOENT on those fragments** and the 3 files
  are absent from every count in both rows of the table above.

Those 3 files carry **exactly 3 `imports` edges** — measured through production
`parseFile`, 1 each, 11 + 11 + 10 relationships and 4 + 4 + 3 symbols. So
**256 − 3 = 253**, and every file the two instruments disagree about is accounted
for by name. Two numbers, both correct for their own universe; the difference is a
shell quoting rule in a shared instrument and not a property of the analyzer.

### D. Three §8 items re-checked at HEAD, and one of them is now the last unblocked gap

All three shared-instrument defects pass 5 reported are **still present**:

- `script/m14/incoming-check.ts:65-76` still lists `"brain_import"` — measured this
  pass, and §B is the number it hides.
- `script/m14/firing-check.ts:340` still assigns `res.types[type].files = set.size`
  from a `filesByType` created **inside** the per-file loop (line 294), so the
  column reads `1` for every fired type on any population. Pass 5's table quoted
  no `files` column for that reason; the lane's own instruments accumulate into a
  `Set` outside the loop and are the source of the real file counts.
- `script/m14/ontology-coverage-gate.ts:195`'s `RULED_BY_LANG` now reads
  `{ bash, json, lua, toml, fsharp }` — **five lanes, and zig is not one of them.**
  The supervisor has wired the others since pass 5, so the one-line gap §8 item 1
  describes is now the **only** thing standing between this lane's three RULED
  verdicts and the real gate. The proof runner exists precisely so that applying it
  needs no re-derivation: it prints the two lines.

Nothing in `src/ast/real-zig-analyzer.ts` changed in pass 6. The analyzer was
verified, not edited: fixtures, mutations, the grammar audit and the regex census
are all read-only checks of a file that has been stable since Z65.
## Pass 7 — the arbiter adjudicated, and a published number that was one run's luck (2026-10-04)

Pass 6 published `0 BB-PARSE-ERR, 0 BB-HANG, 204 s, exit 0` for the arbiter run and
re-verified everything else. Re-running the same arbiter at the same commit produced
`3 BB-PARSE-ERR, 1 BB-HANG, 450 s, exit 1`. So one published number did not survive
re-reading, and the correction is a measurement rather than an explanation.

### A. What reproduces at HEAD, unchanged

| claim | published | re-measured at HEAD | instrument |
|---|---|---|---|
| fixtures | 9 / 9 | **9 / 9**, 0 fail | `run-fixtures.ts --lang zig` |
| mutants | 50 / 50 | **50 / 50** (50 of 1,748 filtered) | `BB_MUTANT_ONLY="zig/"` |
| what fires | 7/10, 8,445 edges, 120/120 files, 1 degraded | **7/10, 8,445 edges, 120/120, 1 degraded** | `firing-check.ts --files 120 zig` |
| the `imports` class | 253 edges, 13 distinct, 1 ambiguous, 159 unresolved | **identical, field for field**; 253 == production | `incoming-check-paired.ts` on the 120-file draw |
| rule shape vs the gate's `Ruled` | 5 fields identical | **5 fields identical** | `ruled-gate.ts` shape check |
| the 7 emitted counts | 113,476 / 132,201 / 77,459 / 10,200 / 30,794 / 24,114 / 4,306 | **identical, edge for edge** | the arbiter's own verdict table |
| doc-truth emission claims | table at line 283, 9 rows | **line 283, 9 rows, 0 FALSE_POSITIVE** | `verify-doc-truth-emissions.ts` |
| honesty gate | — | **no zig finding**; the only zig line is `ok corpus pins present (… zig, zls)` | `script/m14/verify-honesty.ts` |
| regex census | 0 zig entries | **0 zig entries** | `script/m12/verify-regex-census.ts` |

### B. The correction: the clean arbiter run was a property of one run

Four full-corpus arbiter runs at this commit, all over the same 3,834 admitted files,
differing only in the corpus fan-out (`BB_ZIG_RULED_WORKERS` patches
`Array.from({ length: 8 }, …)` on the copy — the shared file is never touched):

| fan-out | exit | `[BB-PARSE-ERR]` | `[BB-HANG]` | wall clock | verdict table printed |
|---|---|---|---|---|---|
| 8 (pass 6) | 0 | 0 | 0 | 204 s | yes |
| 8 (pass 7) | 1 | 3 | 1 | 450 s | no — aborted |
| 2 (pass 7) | 1 | 1 | 1 | 556 s | no — aborted |
| **1 (pass 7)** | **0** | **0** | **0** | **651 s** | **yes** |

**Pass 6's `0 / 0 / 204 s / exit 0` was one run, not a property of the gate on this
corpus.** Over four runs at one commit, 2 completed clean and 2 aborted. Any single
figure quoted from one run — including a favourable one — is a sample of size one.

Two things this narrows, stated as narrowings because n = 4:

1. **§8 item 11's mechanism was the wrong variable.** It attributed the crash to
   *population size* ("3 rounds × 8 workers over 61 files produced no crash at all, so
   the population size matters"). Here the population is held at 3,834 in all four runs
   and the fan-out alone separates them: 2 of 2 at fan-out ≥ 2 trapped, 1 of 1 at
   fan-out 1 did not. Concurrency fits this data and population size does not separate
   anything in it. That is 4 observations against a claim that had 2, and it is a reason
   to re-test §8 item 11, not proof that the supervisor's other lanes will agree.
2. **The file is not identified by anything in the corpus.** The trapping paths were
   `zig/lib/docs/wasm/markdown/Document.zig` (fan-out 8), `zig/lib/std/process.zig`
   (fan-out 2) and `zig/lib/std/tar/Writer.zig` + `zig/lib/std/testing/FailingAllocator.zig`
   in the first pass-7 run. **0 of the 5 observed trapping paths is under
   `test/cases/compile_errors/`.** The proof runner had asserted that they were
   compile_errors fixtures; two runs falsified it and the runner now reports the paths it
   read instead of a mechanism it cannot observe.

### C. The shared arbiter has now ruled on this lane

The clean fan-out-1 run is the **first time `script/m14/ontology-coverage-gate.ts` has
produced a verdict table for zig at all**, on the full corpus:

```
type          status        detail
calls         EMITTED       113,476 edges in 4+ files
uses          EMITTED       132,201 edges in 4+ files
contains      EMITTED        77,459 edges in 4+ files
imports       EMITTED        10,200 edges in 4+ files
references    EMITTED        30,794 edges in 4+ files
exports       EMITTED        24,114 edges in 4+ files
extends       RULED-SOUND   NOT EMITTED; the grammar produced 232 distinct node types across the corpus and NONE expresses it
implements    RULED-SOUND   NOT EMITTED; the grammar produced 232 distinct node types across the corpus and NONE expresses it
overrides     RULED-SOUND   NOT EMITTED; the construct occurs 0x on the parse tree
instantiates  EMITTED         4,306 edges in 4+ files
--------------------------------------------------------------------
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
```

**FALSIFIED 0** is the outcome that matters: the arbiter re-measures instruments A and B
itself, and it did not overturn any of the three rulings. The runner's field-by-field
diff also passes — 3 ruled rows × 5 `Ruled` fields, plus every number quoted in each
`describe` cross-checked against `ZIG.O.1`–`ZIG.O.3` (31, 5 and 33 numbers respectively).

**Coverage is therefore 7/10, reported as applicable and not as a flat 10**: 7 types
EMITTED with counts from production `parseFile`, 3 RULED-SOUND with a corpus
measurement and an instrument the arbiter re-ran. Numerator and denominator come from
different sources — the 7 from `parseFile`, the 3 from the arbiter's own instruments —
so neither was self-graded.

The gate's `232 distinct node types` and this document's `239` are different
measurements of different things, not a disagreement: 239 is what the pinned wasm's
`Language.types` **declares** (including anonymous keyword tokens), 232 is what the
corpus **produces**. `script/m14/zig-ruled.ts` carries both and names each.

### D. Two defects in this lane's own proof runner, found by running it

Both are committed (`0fcfa70bf`), and both are in the layer that decides what a failed
run *means*, which is why they survived six passes of writing:

1. It printed `the pinned zig wasm crashed on a compile_errors fixture under this
   fan-out` unconditionally — a hardcoded claim about the corpus, falsified twice above.
   It now prints the paths it read and counts how many are really compile_errors.
2. A missing `type status detail` header was reported as *a change to the shared gate's
   report shape — a report-to-supervisor item*, **including when the run had aborted**.
   `[BB-HANG]` exits at `src/ast/engine.ts:1442` during the corpus walk, long before the
   verdict table, so a hung run prints no header whatever the shape. The two cases mean
   opposite things — "the gate changed" versus "the gate never got there" — and are now
   separated by whether a hang was actually observed on stderr.

### E. Still unblocked, still not mine

`script/m14/ontology-coverage-gate.ts:195` still reads
`{ bash, json, lua, toml, fsharp }` at HEAD and does not import `zig-ruled`, so
§8 item 1 remains the one line between this lane's table and the real gate. §C is the
evidence that applying it works: the patched copy reaches
`emitted 7/10 · ruled-sound 3 · FALSIFIED 0`.

One addition to §8, from §B: **`ontology-coverage-gate.ts:236` hardcodes its fan-out at
`Array.from({ length: 8 }, …)`, and that literal is the whole difference between a run
that prints a verdict table and a run that aborts.** A `BB_GATE_WORKERS` env override
would let every lane that hits the wasm trap run at fan-out 1 and still adjudicate; on
this lane's corpus that is the difference between `FALSIFIED 0` printed and no verdict
at all. Re-baselining the arbiter's own budgets is not this lane's file to touch.

Nothing in `src/ast/real-zig-analyzer.ts` changed in pass 7 either. Third consecutive
pass verified rather than edited: the analyzer has been stable since Z65, and its
correctness at this commit rests on 9 fixtures, 50 caught mutants, 7 arbiter-emitted
counts and 3 arbiter-adjudicated rulings.
