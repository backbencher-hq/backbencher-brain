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
- **`contains`** — every owner→member edge, at the member's declaration line.
- **`references` (declared type)** — the type a declaration NAMES, read from the
  grammar's `type` field: a parameter, a container field, a local annotation and
  a return type (the four family positions). Builtins excluded. A type that
  names nothing publishes nothing (anonymous container, error set, `!T`'s error
  half, labeled block).
- **`references` (import)** — `@import`/`@cImport` module paths, with
  `meta.isImport` and the line of the path literal.

**Source attribution**: a call or read inside a function carries the enclosing
function/method name; any call or read in a **non-function** context (a
top-level `const` initializer, a `comptime` block, a `test` body) emits with
source `(global)` — the go family package-scope contract (ZIG.D.2).

**Evidence tiers** (`#419-D`): `contains` → `structural`; `declared_type` →
`reference_qualified`; an import → `import_based`; calls/uses →
`usage_contextual`. Confidence: 1.0 for contains/declared-type/bare reads, 0.85
for a call, 0.75 for a field read, 0.9 for a declared type — every heuristic
edge carries a machine-readable `metadata.relationshipType` reason code.

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
- No `instantiates`: composition is expressed through struct fields and opaque
  vtables, and generics are monomorphized without a runtime dispatch to
  attribute. The `instantiates` branch in `classifyEvidenceTier` is therefore
  unreachable in this file and says so.
- No `calls`/`uses` edge for a type used in a value position with no annotation
  (`Point{ … }`) — the family alternative is `instantiates`, ruled above, so the
  gap is declared and counted (ZIG.GAP.3) rather than left silent.
- No declared-type reference for a type that names nothing (ZIG.GAP.3/4 above).

## Verification (re-run at HEAD, 2026-09-28)

| gate | instrument | result |
|---|---|---|
| F1 grammar audit | `audit-analyzer-grammar.ts` | **PASS** — 45 refs, 0 unknown node types, 0 unknown fields |
| relationship-type census | `zig-relationship-census.ts` | **15 / 15 engine types accounted for** — 7 emitted and gated, 4 ruled not applicable (`extends`, `implements`, `overrides`, `depends_on`), 4 above the analyzers (`similar_to`, `relates_to_pattern`, `part_of_feature`, `affected_by`) |
| F3 fixtures | the project's own `runLang("zig")` | **7 / 7 pass** — `bare-value-reads`, `calls-uses-complexity`, `callsite-lines-825`, `declaration-vs-definition-612`, `kinds-and-owners`, `declared-type-leaf`, `relationship-classes` |
| F4 mutations | `BB_MUTANT_ONLY="zig/" mutate-analyzer.ts` | **48 / 48 CAUGHT**, one per fixed class plus payload reverts. A mutant transforms the ANALYZER, so the count cannot reach an ORACLE defect — Z40 and Z41 were both mirror-side and neither had a mutant, which is the argument for the lane gates rather than a larger registry |
| F5 differential, its own rotation | `differential.ts --repo zig` | **22,189 truth rows, 100% covered, MISSING 0, unexplained 0** |
| `contains` gate | `zigw-contains.ts 200` | **PHANTOM 0, MISSING 0** (owner-keyed, bidirectional) |
| `imports` gate | `zigw-imports.ts 200` | **PHANTOM 0, MISSING 0** (site-keyed, bidirectional) |
| `instantiates` gate | `zigw-instantiation.ts 200` | **PHANTOM 0, MISSING 0** |
| `exports` gate | `zigw-exports.ts 200` | **PHANTOM 0, MISSING 0** |
| source-keyed `uses`/`calls` gate | `zigw-uses-calls.ts 200` | **PHANTOM 0, MISSING 0, 4,590 source agreements** — the axis F5 structurally discards, compared as source SETS per (label, target) |
| name-level gate | `zigw-unexplained.ts 1200` | **UNEXPLAINED 0, MISSING 0** in BOTH directions at (label, `normTarget(target)`) level — the axis the five site-level gates structurally cannot see, and the one that found Z40 |
| M60 line accuracy | `line-accuracy.ts zig zig,zls,ghostty 300` | **41,635 relationships, 0 wrong** — every edge carries a line, in range, and the line contains the name the edge names |
| evidence tiers | `zigw-evidence-tier.ts` | every class carries a tier the family rule allows (`import_based` for `imports`/`exports` and the import `references` twin, `structural` for a proven `instantiates`, `declared_type` for a type reference) |
| F5 wiring | `zigw-f5-wiring.ts` | the lane's audit is wired — and this gate has reported a real loss five times, including a commit that reverted `zig-truth.ts` from seven exports to four and dropped the whole of the Z37–Z39 work from HEAD |
| parse-error census | `zigw-parse-errors.ts` | **93 / 3,839 (2.4%)** files carry ERROR nodes, 811 ERROR nodes, 0 MISSING — bucketed: 43 intentionally invalid (`compile_errors` plus a langref page), 45 inline asm, 2 keyword-named fields, 3 labeled blocks in expression position. No analyzer defect in any of them (Z42) |
| ownership verifier | `zigw-ownership.ts` (3,000 files) | **PHANTOM_OWN 0, ORPHAN 0**, COLLISION 1,483 — all same-named containers, filed as #963. Needed because the differential's coverage match ignores the SOURCE, so it cannot see an ownership error at all |
| zero-regex | `script/m49/verify-r2-regex.ts` + `reviews/regex-policy.md` | **0 regexes** in this analyzer (was 1; see Z18) |

Claim level: **L5-SCOPED-VERIFIED** against `wasm/tree-sitter-zig.wasm` as
pinned by `validation/m14/grammar-pins.json`, corpus = the three zig
repositories above. Limitations are non-empty and declared: Z42 (93 of 3,839 files carry ERROR nodes —
43 of them intentionally, and the rest confined to three named syntaxes rather than
distributed invisibly), ZIG.GAP.3 (constructions),
ZIG.GAP.4 (three two-sided RHS forms), ZIG.GAP.5 (the labeled-TYPE form does not
parse in this grammar), Z10 (if/while else-arm capture scope), the nested-shadowing
and synthetic-shape rulings in `reviews/zig/master-review.md`, and grammar-version
drift exposure (the analyzer reads `type`, `body`, `name`, `ok` and `operator`
fields, so a grammar bump can change what it sees — which is why the grammar pin
is a gate and not a comment).
