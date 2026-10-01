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

### M59 / M60 compliance, measured by two independent instruments

M59's contract (`reviews/m49-callsite-line-gap.md`) is three obligations. All three
are measured here **twice** — by this lane's `zigw-line-accuracy.ts` and by M59's own
`script/m59/oracle-callsite.ts`:

| obligation | instrument | result |
|---|---|---|
| every relationship corresponding to a source construct carries that construct's **1-based** line | `oracle-callsite.ts --lang=zig --files-per-lang=1200` | **31,128 / 31,128 with a line, 0 without** |
| " | `zigw-line-accuracy.ts 3839` (full corpus) | **453,933 relationships, 0 without a line** |
| the line is the **right** line — it carries the name the edge names | `oracle-callsite.ts` | **0 INCONSISTENT** |
| " | `zigw-line-accuracy.ts 3839` | **453,933 at 100.00%, 0 off**; per-class 100% |
| the claim is **falsifiable** | `--shift 1` | **13.76%** — one line collapses it, so 100% is a measurement, not a tautology |

**The declared exception list.** M59 requires relationships with no single source
construct to be *declared* rather than given an invented line. Zig's list is
**empty**, and per class the construct each line points at is: `calls` the callee
leaf · `uses` the member leaf or the identifier · `contains` the **member's own
declaration line** (synthesized from the symbol table rather than walked at a site,
but still a real construct) · `references` the type **name** node (M59.A7) · the
import twin the **path literal** inside `@import("…")` (M60.A7) · `instantiates` the
construction site · `exports` the `pub` declaration. Where a line genuinely cannot be
derived the field is **omitted, never written as 0** (#820) — which is why presence
is 100% rather than 100%-of-a-guess.

**What M59's oracle could not check, and why it is not Zig's problem.** The oracle
reports **80 of 31,128 rows (0.26%)** as `notCheckable`: an `@import` target is a
*path inside a string literal*, so it is written on the line but is not an
identifier-shaped token. The same shape makes go's and ruby's `imports` rows
uncheckable. The path-specific rule here checks an `imports` edge against the path as
written or its last segment and reports 100% over 453,933 edges. Worth stating rather
than leaving as a number: M59's artifact retains `notCheckableSample` for only **3
files per language**, so those rows cannot be itemised from it — **for any lane**. That
is a cap on what M60's fold-in can evidence, and it belongs to the shared instrument.

## Complexity

Per-symbol cyclomatic complexity on every function/method, from a base of 1:
`if`/`for`/`while`/`switch`/`else`/`catch` (statement **and** expression forms —
`const a = if (c) 1 else 2;` is Zig's dominant form) and the `and`/`or`/`orelse`
operator **tokens**. The operator is matched as a token type, never as a
substring of the expression text (`x + standard + order` must not count).
`metadata.complexity` on the symbol and `metadata.cyclomaticComplexity` on the
file both carry the real number.

## What is deliberately NOT emitted (ZIG.D.1, ZIG.GAP.*)

- No `extends`/`implements`/`overrides`: Zig has no class inheritance and no
  interface with an implements clause.
- ~~No `instantiates`.~~ **This was wrong and said so confidently.** An earlier
  draft of this document ruled that composition is expressed through struct
  fields and opaque vtables and that generics are monomorphized without a
  runtime dispatch, and therefore that the `instantiates` branch in
  `classifyEvidenceTier` was unreachable. Z32 measured the opposite: a
  construction (`Foo{ … }`, `var x: Foo = .{}`) and a generic application
  (`make(Bar)`) are both statically derivable from the grammar, and the lane
  emits 132 of them over 400 files. The premise was false and the `instantiates`
  branch is very much reachable. A doc that rules a class out is making the same
  claim as an analyzer that emits one, and it needs the same evidence.
- No `calls`/`uses` edge for a type used in a value position with no annotation
  (`Point{ … }`) — the family alternative is `instantiates`, ruled above, so the
  gap is declared and counted (ZIG.GAP.3) rather than left silent.
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
| M60 line accuracy | `zigw-line-accuracy.ts 3839` | **453,933 relationships, 100.00%, 0 off**, every class at 100%. Calibration: `--shift 1` collapses it to **13.76%** (391,467 off), so the check is tight rather than merely green |
| M60 line cross-check | `line-accuracy.ts zig zig,zls,ghostty 300` | **41,635 relationships, 0 wrong** — an independent generic probe over the same files; a different instrument counting a different draw, which is why the two totals are both stated rather than reconciled to one |
| evidence tiers | `zigw-evidence-tier.ts` | every class carries a tier the family rule allows (`import_based` for `imports`/`exports` and the import `references` twin, `structural` for a proven `instantiates`, `declared_type` for a type reference) |
| F5 wiring | `zigw-f5-wiring.ts` | the lane's audit is wired — and this gate has reported a real loss five times, including a commit that reverted `zig-truth.ts` from seven exports to four and dropped the whole of the Z37–Z39 work from HEAD |
| output-channel invariants | `zigw-invariants.ts 300` | **0 violations** over 1,110 symbols / 2,908 relationships / 319 functions: no duplicate edge at a line, no self-loop outside `calls`, every confidence in (0,1] and equal to the contract table, every relationship carrying a reason code and a line, every kind in the shared `SymbolKind`, no `ownerName` the file does not declare, no duplicate symbol, every function carrying an integer complexity ≥ 1, and **no DANGLING target** (an edge whose target is declared at file scope with no symbol published — the invariant that found Z46). Calibrated: `--calibrate` reports 2 classes |
| parse-error census | `zigw-parse-errors.ts` | **93 / 3,839 (2.4%)** files carry ERROR nodes, 811 ERROR nodes, 0 MISSING — bucketed: 43 intentionally invalid (`compile_errors` plus a langref page), 45 inline asm, 2 keyword-named fields, 3 labeled blocks in expression position. No analyzer defect in any of them (Z42) |
| ownership verifier | `zigw-ownership.ts 3000` | 136,720 symbols, AGREE 84,442, **PHANTOM_OWN 0, ORPHAN 0**, COLLISION 1,485 — of which **enclosure disambiguates 1,485, leaving 0 genuinely ambiguous**. The store already resolved ownership by extent (`enclosingStoreableIdByName`), so #963 was filed against a fixed defect and is **resolved** (Z49) | Needed because the differential's coverage match ignores the SOURCE, so it cannot see an ownership error at all. This instrument was itself broken until Z43: it read a quoted name raw where the published symbol name is canonicalized, so it reported **701 phantom owners** that `zigw-contains.ts` — which derives from the grammar and keys on the owner — read as zero |
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
distributed invisibly), ZIG.GAP.3 (constructions),
ZIG.GAP.4 (three two-sided RHS forms), ZIG.GAP.5 (the labeled-TYPE form does not
parse in this grammar), Z10 (if/while else-arm capture scope), the nested-shadowing
and synthetic-shape rulings in `reviews/zig/master-review.md`, and grammar-version
drift exposure (the analyzer reads `type`, `body`, `name`, `ok` and `operator`
fields, so a grammar bump can change what it sees — which is why the grammar pin
is a gate and not a comment).
