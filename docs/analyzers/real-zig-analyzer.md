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
`store-denylist-census.ts` (declarations the store refuses on name alone).

### Verdicts

Measured over that draw, through `parseFile` at the shipped analyzer (Z59 included):
**127,536 symbols, 392,086 relationships, 0 symbols with an empty name.**

| type | verdict | edges | files | src marker% | src dangling% | tgt file-local% | tgt corpus-tier% | both-ends corpus-tier% | confidence |
|---|---|---|---|---|---|---|---|---|---|
| `calls` | **EMITTED** | 113,341 | 2,781 | 11.53 | **0.01** | 40.03 | 95.52 | 95.51 | 0.85 ×113,334; 0.5 ×4, 0.4 ×3 (fallback, below) |
| `uses` | **EMITTED** | 132,001 | 2,850 | 22.48 | **0** | 40.15 | 93.28 | 93.28 | 1.0 ×13,371; 0.75 ×118,630 |
| `contains` | **EMITTED** | 77,427 | 1,472 | 0 | 0 | 99.80 | 99.80 | 99.80 | 1.0 |
| `imports` | **EMITTED** | 10,195 | 2,691 | 100 | 0 | 29.79 | 33.54 | 33.54 | 0.9 |
| `references` | **EMITTED** | 30,762 | 2,964 | 100 | 0 | 44.16 | 74.02 | 74.02 | 1.0 ×10,195; 0.9 ×20,567 |
| `exports` | **EMITTED** | 24,084 | 3,162 | 100 | 0 | 99.99 | 99.99 | 99.99 | 1.0 |
| `instantiates` | **EMITTED** | 4,276 | 529 | 54.77 | **0** | 85.69 | 96.02 | 96.02 | 1.0 — ZIG.O.4; the earlier ruling that this branch was unreachable was false and is retracted |
| `extends` | **RULED** | — | ZIG.O.1, instrument A, 0 of 28 inheritance words in the grammar's own tables; 0 UNCLASSIFIED of 1,797 header-slot children |
| `implements` | **RULED** | — | ZIG.O.2, instrument A, same tables; Zig models an interface as `opaque` + fn-pointer fields, so there is no conformance clause to name |
| `overrides` | **RULED** | — | ZIG.O.3, instrument B: 3 duplicate-function, 14 duplicate-binding, 9 duplicate-member occurrences, and every surviving one is a file documenting the compiler's REJECTION |

`script/m14/ontology-coverage-gate.ts zig` **refuses to report for this lane** — it
exits 2 with "no RULING TABLE for zig" because `RULED_BY_LANG` in that shared file
holds only `bash` and `json`. The gate is read-only and shared (§8), so this lane
measured the three rulings with its own instruments and the spec decisions
`ZIG.O.1`–`ZIG.O.4` carry the written reason, the instrument, the probe and the
overturn condition the gate looks for. See the report item.

### The three RULED types, each falsifiable

A ruling that cannot be overturned is an assertion. Each of these names the probe
and the count that would kill it.

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
   `zig-truth.ts` oracle. **Declared limitation: the oracle is a second walker over
   the SAME grammar** (`zig-truth.ts`'s `enclosing()` is line-for-line the same rule
   as the analyzer's), so a grammar defect shared by both paths is invisible to the
   agreement number. The grammar's own defect extent is measured separately and
   reported below rather than assumed away.
4. **Labelled** — the classes are disjoint by construction and gated per class:
   `calls` only from a `call_expression` callee leaf, `uses` only from a
   `field_expression` that is not the callee or a plain-`=` assignment LHS, or a
   bare `identifier` read, `references` only from the grammar's `type` field or an
   import site, `exports` only at file scope. `metadata.relationshipType` carries
   the reason code on every edge and every edge carries an `evidenceClass`.
5. **Resolved** — measured per type below. **The CSS `references` reference point
   is 66.8% at both ends; this lane's `references` is above that at the corpus tier.**
6. **Confident** — **7 of 392,086 edges are below 0.7 (0.0018%)**, and all 7 come
   from the fallback path, not from this analyzer (next paragraph). The sub-1.0
   edges the analyzer itself emits are 0.75 (field read), 0.85 (call) and 0.9
   (import / declared type), each carrying a machine-readable
   `metadata.relationshipType`. The heuristic ratio is therefore countable, and it is
   ~0 for every class this lane emits.

**Two classes of output do not come from this analyzer, and are reported rather than
absorbed into its numbers.** `parseFile`'s parse-error branch returns
`extractFallback(...)`, a REGEX-based extractor in shared machinery
(`src/ast/pool-worker.ts`) whose `BasicSymbol` carries `type` and **no `kind`**. It
fires for the files whose wasm parse traps or exceeds the hang guard, and on this
corpus it contributes **192 symbols with an empty `SymbolKind`** and **7 `calls`
edges at confidence 0.4/0.5 tagged `metadata.method: "regex"`. One of those fallback
edges carries `source: "this"` — a caller name no zig file declares, which is exactly
the fabricated-edge class the workstream's fabrication rule is about. This is **not**
caused by Z59: the identical 400-file draw was measured on both sides of the change
and reports 0 kindless symbols and 0 sub-0.7 edges on both. The fix belongs in shared
machinery and is stated in the report.

### DERIVATION findings

**0.** `script/m60/rel-type-coverage-gate.ts --langs=zig` reports CHECK 1
(DERIVATION — every emitted type has an oracle derivation) **clean**, CHECK 2
(REACHABILITY) clean, CHECK 3 (AGREEMENT) clean, CHECK 4 (ENUM) clean, baseline
"104 recorded, 0 NEW". That matches the handover figure for this lane.

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

- **Named tests are a source with no symbol (Z39 retained deliberately, Z60
  adjacent).** `test foo { … }` is a NAMED scope (Z39) and edges inside it are
  attributed to `foo`, but the analyzer publishes no symbol for a test and the shared
  `SymbolKind` has no `Test` member, so those sources do not resolve. Measured at
  **0 after Z59** on the full corpus — because in every corpus file where a test
  shares a name with a local container's member, Z59 attributes to the member and
  `(global)` covers the rest — but the class is structural, not absent: the synthetic
  case `test helper { helper(); }` with no same-named declaration is dangling. Resolving
  it needs either a `SymbolKind.Test` (shared) or a decision to revert Z39, which
  would attribute test bodies to file scope. **Not decided here.**
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
| F8 completeness census | `completeness-inventory.ts --lang zig` | **98 types classified, sections A–H 8/8 pass.** It runs under `npx tsx`; it had been recorded as bun-only, which was hiding a real section-A failure on the universal `ERROR`/`MISSING` pair (Z50) |
| **F5 differential, LANE-OWNED** | `zigw-lane-differential.ts 400` | **60,107 truth rows, 100.00% covered, MISSING 0, unexplained 0** of 58,303 analyzer edges — and **0 on the STRICT axis too** (the rule that keeps the dotted qualifier, which is the axis Z40 hid on). Reproduces the shared harness's semantics exactly (same `normTarget`, same `label + normTarget(target)` key), so the numbers are comparable, and the draw is hashed (`sha256:afee5618d093`) so a published figure names its files. Calibrated: `--calibrate` reports 2 MISSING and 1 unexplained |
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

Claim level: **L5-SCOPED-VERIFIED** against `wasm/tree-sitter-zig.wasm` as
pinned by `validation/m14/grammar-pins.json`, corpus = the three zig
repositories above. Limitations are non-empty and declared: Z48 (the cross-file `instantiates`
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
