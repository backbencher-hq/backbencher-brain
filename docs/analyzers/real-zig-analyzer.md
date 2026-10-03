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
confidence 0.4/0.5. **The 192 kindless symbols and the 7 sub-0.7 edges pass 1
published are therefore an artefact of how the run was sharded, not a property of
the corpus: 8 of 8 shards report 0 of each.** Every number below is the sharded
re-measurement.

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
6. **Confident** — **0 of 392,550 edges are below 0.7** in the sharded re-measurement
   (pass 1 published 7 of 392,086, all from the fallback path — see the next
   paragraph for why that figure does not reproduce). The sub-1.0 edges the analyzer
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
extent is not a stable number, and pass 2 measured why.** A single long process over
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
| **F5 differential, LANE-OWNED** | `zigw-lane-differential.ts 400` | **RE-RUN 2026-10-03: 60,280 truth rows, 100.00% covered, MISSING 0, unexplained 0** of 56,906 analyzer edges — and **0 on the STRICT axis too** (the rule that keeps the dotted qualifier, which is the axis Z40 hid on). The 2026-09-30 figures were 60,107 / 58,303 on draw `sha256:afee5618d093`; the draw is now `sha256:6ba81e3b477b` because the corpus grew (`ghostty` 805 → 807 tracked `.zig` files), so the two rows are different file sets and neither is a regression. Reproduces the shared harness's semantics exactly (same `normTarget`, same `label + normTarget(target)` key), so the numbers are comparable. Calibrated: `--calibrate` reports 2 MISSING and 1 unexplained. **The corpus root in `script/m14/tmp/zigw-harness.ts` and `zigw-lane-differential.ts` defaults to `$HOME/ishaq/fixtures/repositories`, a path that does not exist here — these instruments only run with `BB_CORPUS_ROOT` set** |
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
| **census sharding + merge** | `fixtures/zig/shard-draw.py`, `ontology-census.ts --files-from`, `fixtures/zig/shard-merge.py` | 8 shards partition the published draw; the merge **asserts the union hash equals the single-process draw hash** and it is equal (`sha256:2f3545f9…`), and it RECOMPUTES the corpus-tier columns and every ratio from the summed primitives. Without sharding the census self-destructs (`[BB-HANG]`) — see the ontology section |
| **M60 rel-type coverage** | `rel-type-coverage-gate.ts --langs=zig` | CHECK 1 DERIVATION **clean** (= 0 findings, the number the handover asks for), CHECK 2 REACHABILITY clean, CHECK 3 AGREEMENT clean, CHECK 4 ENUM clean, baseline "104 recorded, 0 NEW, 104 repaid". **CHECK 1 counts TYPES with an audited label, not independent oracles** — the pass-2 section is what bounds what that is worth. **Not run unscoped, and the run was REVERTED**: `--langs=zig` rewrites `validation/m60/results/rel-type-coverage.json` with only the selected lane, which shrinks a 34-lane evidence file to one — so the file was restored with `git checkout` and the run is reported here rather than committed. §8 |
| **ontology coverage gate (the arbiter)** | `ontology-coverage-gate.ts zig` | **DOES NOT REACH A VERDICT.** Two runs ended `[BB-HANG] parser stuck 120s on zig/lib/std/testing.zig — exiting` with no verdict printed, because the gate scans the corpus before it checks `RULED_BY_LANG`. Its refusal branch is real and was shown by pointing it at an empty corpus root: "no RULING TABLE for zig", **exit 2**. The three RULED verdicts were measured with `construct-probe.ts` instead, and reproduce the 2026-09-30 numbers exactly |
| **doc-truth emissions** | `verify-doc-truth-emissions.ts --no-write` | **zig contributes 0 findings of any kind.** Its verdict table is now parseable (the header is `Relationship type | Emitted?`), so the lane's emission claims are machine-checked: 9 of the 10 rows grade clean — 7 `yes` against 7 emitted kinds and 2 `no` against 2 un-emitted ones, with **0 FALSE_POSITIVE and 0 FALSE_NEGATIVE**. The 10th row (`extends`) is the one `parseClaimTable` cannot read (it skips the first body row of every table — see the caption above). The gate's own summary still reads `-> FAIL` on **7 FALSE_NEGATIVE in other lanes' docs**; zig is not among them |
| **honesty gate** | `verify-honesty.ts` | **20 failures, none of them this lane's.** Its `banned-vocabulary lint over validation/m14 + M14 docs` passes, and no failure names this doc or any file under `validation/m14/fixtures/zig/`. The failures are: banned terms inside OTHER lanes' fixture and result JSON (clean, csharp, html, sql, fsharp, `grammar-pins.json`, 4 `results/*.json`), `M14.0.F7` non-passing `analyzer-hygiene-cpp` and `analyzer-hygiene-elixir`, and 8 evidence-freshness failures (F2–F9) caused by shared `validation/m14/results/*.json` artifacts whose declared inputs have moved on the aggregate branch. §8 |
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

Claim level: **L4, restated at pass 2 — the pass-1 L5 is WITHDRAWN.** Pass 1
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
