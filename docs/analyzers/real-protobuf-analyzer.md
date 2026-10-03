# Protobuf Analyzer

Real tree-sitter extraction for `.proto` files, against a **vendored, patched,
pinned** grammar.

| | |
|---|---|
| Analyzer | `src/ast/real-protobuf-analyzer.ts` (996 lines) |
| Grammar | `grammars/tree-sitter-proto/` — `amaanq/tree-sitter-proto` @ `e9f6b43f`, 8 patches |
| Wired WASM | `wasm/tree-sitter-protobuf.wasm` — 81,735 B, sha256 `4624eb6d4b7830dd…` |
| Replaced WASM | `fixtures/graphql/baseline/tree-sitter-proto-UPSTREAM.wasm` — 72,342 B, sha256 `dbbde8a8f047b6b6…` |
| Probes | `script/m14/tmp/protobuf/` — `run-all.sh` runs every gate |
| Review | `reviews/protobuf/master-review.md` |

## Why this grammar is unusual

**No protobuf grammar is published on npm.** `tree-sitter-protobuf`,
`tree-sitter-proto` and `tree-sitter-protocolbuffers` are all absent from the
registry, and neither `ProtocolBuffers/tree-sitter-proto` nor
`tree-sitter-grammars/tree-sitter-protobuf` exists. Nine of the sixteen
grammars vendored in this repository are registry packages; this one is a local
build because it had to be. Two consequences are load-bearing:

- `tree-sitter.json` had to be **written**, because upstream has none, and
  without it the CLI silently falls back to ABI 14 and `tree-sitter build
  --wasm` refuses outright.
- The source is 0 stars, 0 forks, created and last pushed on the same day. Its
  README says *"The grammar should be complete. I've tested the grammar against
  some really large and nasty proto files and it passes."* Measured against
  protobuf's own 108-file reference corpus, upstream carried **62 files with 527
  error nodes** — including 70 error nodes in `descriptor.proto`, the file every
  protobuf tool reads.

## The eight patches

Each is anchored in `grammars/tree-sitter-proto/grammar.js`, each has its own
case in the gaps battery, and **each is proven necessary** — the pre-patch
grammar fails its case.

| # | Construct | Why it was missing |
|---|---|---|
| 1 | `edition = "2023"` | The editions file option *replaces* `syntax`; upstream's root accepted only `optional(syntax)`. **52 of the reference corpus's 108 files declare an edition.** |
| 2 | Negative field numbers | `field_number` was a bare `int_lit`. The number space is signed 32-bit, with 19000–19999 reserved and negatives legal. |
| 3 | `import option "…"` | Editions' option-import, the mechanism behind `features`. Most of `descriptor.proto`'s damage. |
| 4 | Option list on `extensions` | Upstream ended at `;`, so `extensions 536000000 [declaration = {…}];` — how `descriptor.proto` declares its own range — was an ERROR, and the aggregate inside it failed too. |
| 5 | proto2 `group` | Absent entirely. A field whose type is the keyword `group` and whose body is a nested message. **12 of 108 reference files use it.** |
| 6 | Parenthesised `(fullIdent)` as a *later* dotted option segment | Upstream allowed it only in first position, so `features.(pb.cpp).repeated_type` was an ERROR. |
| 7 | Leading dot on an `extend` target | Upstream's `extend` used `full_ident` while `message_or_enum_type` had the dot, so `extend .google.protobuf.FieldOptions` was an ERROR. |
| 8 | `local` declaration modifier | An editions top-level modifier, used by the reference implementation's own `cpp_file_options.proto`. |

Patches 1, 3, 4, 5 and 6 also **added grammar fields** this analyzer depends on:
`name` on a group, `path` on an import, `value` on an edition.

### One ruled construct

**`any { … }` — the proto2 MessageSet form — is ruled out**, with its
consequence measured rather than asserted: **9 error nodes in 1 file of 293**
(`unittest_custom_options.proto`, the reference implementation's deliberate
parser-breaking torture test). MessageSet is deprecated by the specification.
Every other construct in that file parses correctly in isolation, so the errors
tree-sitter reports on nearby lines are *recovery* misattributing damage from
the `any { }` further down, not separate defects. A file using MessageSet loses
that construct's fields — not the file, and not its neighbours.

## Symbol contract

Declaration nodes become symbols; usages become relationships.

| Protobuf construct | Kind | Owner |
|---|---|---|
| `message` | `class` | enclosing message, or the package at top level |
| `enum` | `enum` | enclosing message |
| `service` | `interface` | package |
| `rpc` | `method` | service; request is its single `parameter`, response its `returnType` |
| `field`, `map_field`, `oneof_field` | `property` | enclosing message |
| `oneof` | `union` | enclosing message |
| `enum_field` | `enum_member` | enum |
| `package` | `namespace` | — |
| `syntax`, `edition` | file metadata | — |
| `option`, `reserved`, `extensions` | metadata | the file, or the owning message |

Ids are dotted and package-qualified: `demo.v1.User.Address`.

### Relationship ontology

- **`contains`** — declaration → member: message→field, message→nested type,
  message→oneof, oneof→field, enum→enum_value, service→rpc, extended
  type→extension field.
- **`uses`** — declaration → referenced type: a field's declared type, a map
  *value* type, a `oneof_field` type, and **both** of an rpc's request and
  response. A **scalar type produces no edge** — `string` and `int32` are
  keywords, not references.
- **`extends` is deliberately unused.** `extend Foo { … }` does not make the
  block a subclass of `Foo`; it adds *fields* to `Foo`. The honest edge is
  `Foo -contains-> field` with `metadata.member = "field"` and
  `metadata.viaExtension = true`, and the field's `ownerName` is the extended
  type. Protobuf has no inheritance and none is invented.

### Three rulings worth stating

**An extension's members belong to the extended type, and the block emits no
symbol of its own.** A type already has a declaration in the file that owns it;
a second one here would be a phantom.

**A `oneof` is a symbol; its fields still belong to the message.** A field
number lives in the *message's* space and `msg.field` is how every protobuf tool
refers to them, so reassigning ownership to the oneof would be wrong. The oneof
is a `union` with a `contains` edge to each member, and each member carries
`metadata.oneof`.

**A proto2 `group` declares both a type and a field, and they need two ids.**
`optional group G = 4 { … }` declares a nested type `G` *and* a field `G` of
that type. Emitting either alone misrepresents the language; emitting both on one
id produced a self-loop. The type takes `pkg.M.G` and the field is
disambiguated to `pkg.M.G#property` — `#` cannot occur in a protobuf identifier
(`[A-Za-z_][A-Za-z0-9_]*`), so no real name can forge it. On the reference
corpus this is not a theoretical fix: it accounts for all 39 ownership changes
the A/B below reports.

## Measured results

Four pinned corpora, 293 files. Revisions in
`script/m14/tmp/protobuf/corpus-manifest.json`.

| Corpus | rev | Files | Clean | Lines | Symbols | Rels | Imports |
|---|---|---|---|---|---|---|---|
| `pb-reference` (protocolbuffers/protobuf) | `1eafbdec` | 108 | 107 | 17,213 | 7,744 | 9,073 | 90 |
| `pb-googleapis` (googleapis/googleapis) | `9c085b2e` | 128 | 128 | 27,413 | 3,598 | 4,629 | 368 |
| `pb-grpc` (grpc/grpc) | `9702cf94` | 45 | 45 | 3,126 | 880 | 1,214 | 28 |
| `pb-etcd` (etcd-io/etcd) | `7583cc6e` | 12 | 12 | 1,952 | 581 | 804 | 17 |
| **TOTAL** | | **293** | **292** | **49,704** | **12,803** | **15,720** | **503** |

Integrity, all four corpora:

- **0 self-looping relationships** across these four staged corpora. This is
  scoped to them: the wider 627-file corpus sweep in the section below found 9,
  all of one shape, and they are fixed there. The narrower corpus was never
  evidence that the analyzer could not produce one.
- **0 duplicate symbol ids**
- **1 phantom symbol** — a symbol overlapping an ERROR node, and it is the ruled
  MessageSet construct
- **3 unresolved relationship endpoints of 17,411** (0.017%), each naming a type
  declared outside the staged corpora: `xds.data.orca.v3.OrcaLoadReport` twice
  (lives in envoy/xds) and `raftpb.ConfState` (lives in etcd's raft repo). The
  other 16,892 resolve same-file and 516 cross-file.

### Against the grammar it replaced

Same analyzer, both WASMs, same 293 files. This is the number that matters: a
parser that is more complete is worth nothing if the extractor does not read the
new nodes.

| | upstream | wired | |
|---|---|---|---|
| ERROR nodes | 254 | 9 | **−96.5%** |
| **Phantom symbols** | **82** | **1** | **−98.8%** |
| Symbols | 12,568 | 12,803 | +235, **−0** |
| Relationships | 15,441 | 15,720 | +322, −43 |
| Files with fewer errors | — | 62 | |
| Files with **more** errors | — | **0** | |

The direction is uniform, and **every** delta is adjudicated rather than
averaged:

- **0 symbols lost.** Losses are keyed on *declaration identity* (kind, name,
  line), not on the resolved id.
- **0 relationships genuinely lost** — all 43 had an endpoint moved.
- **39 owner changes, all correct.** A field inside a `group` body is attributed
  by upstream to the enclosing message (it cannot see the `group` wrapper) and by
  this build to the group type, which is what `protoc` does:
  `…TestAllTypesProto2.group_int32` → `…TestAllTypesProto2.Data.group_int32`.

An earlier version of this comparison keyed on the id and reported 39
"regressions" that were not regressions; it is recorded in the review because
that is the more useful number to see.

### The rest of the gates

| Gate | Result |
|---|---|
| Grammar battery | 34 cases — **26/26 valid accepted, 7/7 invalid rejected**, 10/10 patch cases proven necessary, 1 semantic rule documented |
| Grammar census | 117 declared node types, 93 observed, **all 50 classified** and consistent with the analyzer |
| Contract battery | 6 hand-derived cases — 47 symbols, 58 relationships, 4 imports; **8/8 mutations caught** |
| Production path | `ASTEngine.detectLanguage(".proto")` returns `protobuf`; `ASTEngine.parseFile` on 293 files: **293/293 byte-identical** to a direct analyzer call; 2,605/2,605 ranges span their own name; 657 doc-comment anchors verified not stolen |
| Robustness | 32 degenerate fixtures, **5,000-level nest**, no throw, no self-loop, no duplicate id, every run idempotent, linearity ratio 0.94× |
| No regex / no text scan | **0 regular expressions**; 35 `.text` reads, all classified as leaf values; 0 structural whole-node reads |

## Two properties that are easy to get wrong

**The walk is iterative, and that is load-bearing.** It was recursive at first,
under a comment that already claimed otherwise; the robustness gate caught it
because a 5,000-level message nest overflowed Node's stack and took the process
down. Nesting depth is not theoretical for a schema language, and an indexer
that dies on a deeply nested file is a denial of service on any repository
containing one.

**Name resolution is order-independent, via a declaration pre-pass.** The walk
runs twice over one code path: once to collect declarations, once to publish
facts. This is not belt-and-braces — protobuf permits a **forward reference**
(a field may name a message declared further down the file), and the LIFO
worklist makes visit order neither document order nor anything a reader could
reason about. When the walk was converted from recursion to a stack, resolution
silently regressed: `n.Outer.i → n.Outer.Inner` became `n.Outer.i → n.Inner`,
because `Inner` was popped after `i`. The contract battery caught it against its
hand-derived truth.

## Boundaries, stated rather than hidden

- **Reference resolution is per-file.** The specification's rule is implemented
  — a leading dot is absolute, anything else resolves from the innermost scope
  outward — but against the symbols *this file* declares. A dotted reference whose
  owner lives in another file falls back to the name as written, which is correct
  for fully qualified names (how real schemas write them) and is the 3 unresolved
  endpoints above.
- **Option values are read positionally**, not by dispatching on `constant`.
  Per-field and per-enum-value options are *not* extracted; the grammar census
  records that as `grammarOnly` rather than pretending otherwise.
- **One semantic rule is unenforced by design**: proto3's "first enum value must
  be zero" is a semantic constraint no surface grammar can reject. It is counted
  and documented, not failed, because a gate that can never pass is a gate that
  gets switched off.
- **`reserved` / `extensions` ranges and names** are captured as metadata on the
  owning message (and on the file at file scope), including the `4 to max` and
  `reserved "name"` forms.
- **Ranges span the symbol, they do not start at the name.** `message Any`
  correctly starts at the `message` keyword. A declaration may span lines —
  protobuf's own corpus has `proto2_unittest_import.PublicImportMessage` on one
  line and `optional_public_import_message = 26;` on the next. The invariant
  enforced is that a range is never *stolen by a leading doc comment*.

## Reproducing

```bash
# stage the four corpora (see corpus-manifest.json for the sparse paths)
# then:
script/m14/tmp/protobuf/run-all.sh
```

Artifacts land in `fixtures/protobuf/out/`: `grammar-census.json`,
`grammar-gaps.json`, `corpus.json`, `extraction-ab.json`, `contract-battery.json`,
`production-path.json`, `robustness.json`, `no-text-scan.json`.

---

# M14 ONTOLOGY WORKSTREAM — the ten relationship types

Measured on **627 `.proto` files in 14 repositories**, the whole corpus walked
rather than sampled (`$HOME/fixtures/repositories`, walked as a working
tree, not `git ls-files` — three of these corpora are sparse checkouts, where
`git ls-files` lists tracked paths that are not on disk). Revisions in
`script/m14/tmp/protobuf/corpus-manifest.json`.

Every count is off the **production entry point**, `parseFile` from
`src/ast/pool-worker.ts`. `analyze()` is a per-file unit that skips the pipeline
stages pool-worker owns, so a count taken from it measures a path the product does
not run. `metadata.id` does not survive pool-worker's symbol projection, so
endpoint resolution is additionally measured against the analyzer's own id set;
both numbers are given.

Corpus composition: `kubernetes` 135, `pb-googleapis` 128, `pb-reference` 108,
`docker` 109, `pb-grpc` 45, `kong` 39, `waypoint` 21, `dart-sdk` 18, `terraform`
17, `pb-etcd` and others 7, `gh-cli` 3, and 4 single-file repositories.

| | count |
|---|---|
| files parsed | 627 ok / 0 fail |
| symbols | 34,491 analyzer-direct / 34,461 through `parseFile` |
| relationships | 45,979 analyzer-direct / 44,959 through `parseFile` |
| symbols with an empty name | **0** |
| unknown `SymbolKind` values | **0** |
| relationship endpoints equal to the literal `unknown` | **0** |
| self-looping relationships | **0** (was 9 before this round — see below) |
| `imports[]` entries recorded | 1,130 in 401 files |

1,020 edges are produced by the analyzer and not kept by production. All 1,020 are
in **two** files — `pb-reference/src/google/protobuf/test_protos/tctable_long_name_test.proto`
and `pb-reference/src/google/protobuf/unittest_enormous_descriptor.proto` — and
all carry identifiers of 112 to 1,000 characters. They are dropped by a shared
pipeline stage on name length, not by this analyzer, and 1,001 of the 1,020 are
field `contains` edges. The analyzer's own count is unchanged by this.

## Verdict per type

The row order is not semantic, and the reason is a shared-harness bug worth
stating rather than working around silently: `parseClaimTable` in
`script/m14/verify-doc-truth-emissions.ts` skips the **first body row** of any
claim table (the `if (!started) { started = true; continue }` at the end of its
row loop), so for this table the first row below is not machine-read. A ruled row
is placed there deliberately, because a dropped `no` claim costs nothing while a
dropped `yes` claim would leave an emitted kind unchecked — which is the
`FALSE_NEGATIVE` class that gate exists to catch. Reproduction and the fix are in
the lane report.

| Relationship type | Emitted? | Count | Both-end resolution | Ruling, or the measurement behind the count |
|---|---|---|---|---|
| `references` | no | 0 | — | **RULED as a separate label.** The construct occurs (10,006 `message_or_enum_type` nodes) and is emitted, as `uses`. Placed first only because the row above it is the one the shared gate drops. |
| `contains` | yes | 32,814 | 99.08% | declaration → member; 99.08% of edges bind at both ends |
| `uses` | yes | 11,015 | 75.80% | declaration → referenced type; per-file resolution, denominator stated under question 5 |
| `imports` | yes | 1,127 | 0% by design | **new this round** — was 0 while the construct occurred 1,131 times in 402 files |
| `exports` | yes | 4 | 0% by design | **new this round** — was 0 while `import public` occurred 4 times in 4 files |
| `calls` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `extends` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `implements` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `instantiates` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `overrides` | no | 0 | — | **RULED**, instrument **B** (parse-tree count). Construct count is **1**, not 0 — see below |

The `imports` and `exports` resolution figures are 0% by design rather than by
defect: both endpoints of a cross-file module edge are module paths, not symbols
of the file, which is the convention in `real-css-analyzer.ts` and
`real-dart-analyzer.ts`. Stated here because a reader comparing `0%` against CSS's
66.8% `references` figure would otherwise be comparing two different things.

### The four EMITTED types, in this language

**`contains` — declaration → member.** message→field, message→nested type,
message→oneof, enum→enum_value, service→rpc, and extended-type→extension field
(the last carries `metadata.viaExtension`, and the field's `ownerName` is the
*extended* type, because a field number lives in that type's space). A `oneof` is
reached **from** the message and there is deliberately no edge from the oneof to
its fields: membership and grouping are different relations, and overloading
`contains` to mean both would make one edge mean two things. The grouping travels
as `metadata.oneof` on each field.

**`uses` — declaration → referenced type.** A field's declared type, a map
*value* type, a `oneof_field` type, and **both** of an rpc's request and response.
A **scalar produces no edge**: `string` and `int32` are keywords, and there is no
declaration of them to point at. This is decided structurally — a `type` node
holding a `message_or_enum_type` child is a reference, one with no named children
is a keyword — so an unrecognised scalar is safe by construction rather than by
being absent from a hardcoded list. A map's key type is a scalar by specification
and is never a reference.

**`imports` — this file → a file it depends on.** 1,131 `import` nodes across 402
files, of which 4 are `import public`; the remaining 1,127 are emitted as
`imports`. The **source** is the importing file's own module name and the
**target** is the path as written, which is the family's convention rather than a
protobuf invention: `real-css-analyzer.ts` imports from `importerName` onto the
imported stylesheet's name and `real-dart-analyzer.ts` from the library name, and
the store records a non-symbol endpoint as external. `protoc` resolves an import
against `-I` include roots the analyzer is never told, so the path as written is
the most faithful name available; the full path is kept in
`metadata.filePath` so a consumer that knows the include root can do better. The
editions feature import (`import option`) is an `imports` edge and not an
`exports` edge — it resolves an option's definition rather than a message.

**`exports` — this file → a file it re-exports.** `import public` is a re-export:
this file's *own* importers reach the imported declarations **through** it. That
is a fact about the module graph and is not derivable from the path, because two
files can import the same path and only the public one republishes it. Measured
at 4 occurrences in 4 files, all in `pb-reference`: `cpp_options.proto:15`,
`json_options.proto:14`, `unittest_import.proto`, `unittest_import_lite.proto`.
Small, and emitted because the count is not zero.

### The ruled types: instrument, probe, and what would overturn each

The gate's header explains why this section is not optional: the `overrides`
defect survived a differential that was green throughout, because the analyzer and
the oracle are two walkers over *one* grammar and a type absent from both agrees
with itself perfectly. Only measuring the language finds it.

**Instrument A — grammar inventory.** The declared vocabulary is read from the
wasm's own node-type table (117 node types) and the **observed** vocabulary is
walked off the corpus (94 distinct node types across 627 files, 13 ERROR and 2
MISSING nodes in 1 file). Both instruments read the *same* tree in one streaming
pass, so a construct cannot be counted on one parse and the inventory taken on
another.

| Type | Probe | Overturned by |
|---|---|---|
| `calls` | No node type in the 117-declared vocabulary expresses a function definition or a call expression, and no such node was observed. A `.proto` file has no executable body. | any observed node type matching `call*`, `function_definition` or `method_invocation`, or any corpus file containing an invocation |
| `extends` | No node type expresses class heritage. The vocabulary's `extend` is the proto2 field-extension BLOCK (420 observed) which adds members — read as `contains` with `viaExtension`. | any observed node type expressing heritage or a superclass |
| `implements` | No node type expresses interface satisfaction, separately or as part of a heritage clause. | any observed node type expressing an implements clause |
| `instantiates` | No construction expression exists in the vocabulary: no `new`, no call node. The 8,574 message-typed declarations the probe counts are **references** — a field whose type is a message holds one, and declaring the field does not create a value — and the analyzer emits all 8,574 as `uses`. The 1,133 `block_lit` aggregate literals all sit under a `constant` node, i.e. they are option and field-option values, not constructed messages. | any observed node type that constructs a value, or an aggregate literal outside an option value |
| `references` | **Not a missing construct.** Protobuf's only references are *type* references; there is no separate node for a value reference. The construct occurs — 10,006 `message_or_enum_type` nodes — and is emitted, under the label `uses`, which is the family's convention for a type reference. The separate `references` label stays unused because no second kind of reference exists to label. | any observed construct that references a name other than a type — a value read, a symbol use in an expression |

**`overrides` — instrument B, and the one ruling that is *not* a zero.** The probe
counts a second declaration of a name already declared in the same scope, with
proto2 `group` excluded because a group legitimately declares a nested type and a
field of the same name. Count: **1**, in
`nvim-treesitter/tests/query/highlights/proto/test.proto`, inside
`message LogContent`:

```proto2
required string Value = 2;
required CustomType Value = 2;   // same name AND same field number
```

`protoc` rejects this file: the duplicate is a duplicate *name* and a duplicate
*field number* in one message, so there is no prior declaration being replaced and
nothing to override. It is a syntax-highlighting test fixture, not a schema
anything compiles. So the honest verdict is not "the construct does not occur" —
it occurs once, and that once is invalid input.

**Overturn condition:** a second declaration of the same name in the same scope
carrying a **different** field number, in a file `protoc` accepts, would make this
ruling false and would require an `overrides` edge.

## The six questions, per emitted type

**1 — Exists.** Derivable from source for all four. `contains` from the
`addFieldLike`/`addSymbol` containment path, `uses` from the four call sites that
pass `resolveRef`, `imports` and `exports` from the `import` branch of `drain`.

**2 — Fires.** Measured above: 32,814 / 11,015 / 1,127 / 4 across 627 files. None
is reachable only from a branch that never matches.

**3 — Correct.** **There is no oracle for this lane, and this is the largest
limitation in this document.** `protobuf` does not appear in `differential.ts`'s
`LANGS`, and `script/m14/oracles/` contains no protobuf oracle (19 oracles for
other languages). No independent implementation exists to disagree with this one.
The limitation is structural and worth stating plainly: even where an oracle
existed it would be a second walker over the *same* patched grammar, so a bug in
the grammar would be invisible to it. What the lane has instead is
(a) expectations derived by hand from the specification, not captured from a run —
`script/m14/tmp/protobuf/contract-battery.mts` states this rule and the fixtures
in `validation/m14/fixtures/protobuf/` follow it; (b) a mutant battery, below.

**4 — Labelled.** The confusable pairs in this language, each pinned by a fixture
row rather than left to be believed: `uses` vs `references` (a type reference is
`uses`; there is no second kind of reference — see the `references` row above);
`contains` vs `extends` (`extend Foo` adds members, so it is `contains` with
`viaExtension`, and `extend-and-group` forbids an `extends` edge on that shape);
`imports` vs `exports` (`imports-and-editions` pins an `exports` row **and**
forbids the `imports` row for the same target, so relabelling cannot satisfy it);
`calls` vs `uses` (an rpc names a message, nothing is invoked — forbidden
explicitly in `streaming-and-forward-refs`).

**5 — Resolved.** Both-end resolution rates, per type, against the analyzer's own
id set and against the ids production redraws:

| Type | both ends, analyzer ids | both ends, production ids |
|---|---|---|
| `contains` | **99.08%** | 98.95% |
| `uses` | **75.80%** | 75.60% |
| `imports` | 0% | 0% |
| `exports` | 0% | 0% |

The `imports` and `exports` zeros are **by design, not a defect**, and they are
stated here rather than left for a reader to assume: both endpoints of a cross-file
module edge are module paths, which are not symbols of the file, exactly as in
CSS and Dart. A consumer resolves them against the project's include roots.

The `uses` figure is per-file resolution and needs its denominator stated, because
a reader could compare it against CSS's 66.8% `references` figure and conclude the
lane is worse. It is not the same measurement. Per-file, 24.2% of `uses` edges
name a type this file does not declare — an imported type, which is most of them.
When the four staged corpora are placed in one symbol table, so cross-file
resolution is possible, the same probe measured **3 unresolved endpoints of
17,411** (0.017%), the rest resolving same-file (16,892) or cross-file (516). Both
numbers are true; the first is per-file and the second is corpus-wide.

**6 — Confident.** **0 of 45,979 edges fall below 0.7 confidence** — the heuristic
ratio is 0, and that is a structural claim rather than a tuning result: every edge
is read off the parse tree (a declaration node, a named child, an anonymous
sibling token, a position), so there is no name-match guess to be uncertain about.

`evidenceClass` was **absent on 40,562 of 40,562 production edges** before this
round, which left the honesty contract's requirement that a heuristic be
*countable* with nothing to count and forced the graph panel to infer a tier from
the confidence value. Every edge now carries one: `structural` on `contains`,
`uses` and `exports` (32,814 + 11,015 + 4), `import_based` on `imports` (1,127).
Both tiers are pinned by fixture rows, so an analyzer stamping one constant on
everything would fail the suite.

## DERIVATION findings: 4

Four, one per emitted type — `contains`, `uses`, `imports`, `exports`. Each is
stored by the analyzer and compared against nothing: there is no protobuf entry in
`differential.ts` and no protobuf oracle in `script/m14/oracles/`. All 45,979
edges in this lane are unaudited by an independent implementation.

Paying this down needs an oracle, and an oracle for `contains`/`uses` would be a
second walker over the same patched grammar — which is why it is a report item and
not a lane edit. What the lane can own, and did, is the mutant battery.

## The mutant battery, and why the fixture suite was rebuilt first

Measured before this round: `bun run script/m14/mutate-analyzer.ts` across 1,481
mutants contained **zero** with `language: "protobuf"`, while both protobuf
fixtures passed. A suite with no mutants cannot fail, so that green asserted
nothing about whether these fixtures see a defect. The six survivors a global run
reported were groovy (2), java, scala, make and php — none of them this lane.

The lane's own battery is `script/m14/protobuf-mutants.ts`, shaped like
`script/m14/fsharp-mutants.ts` so registering it is a two-line change to the
shared harness, driven by `script/m14/tmp/protobuf/probe/mutant-sweep.mts` against
the shared `runLang` and the shared catch rule.

| | before | after |
|---|---|---|
| protobuf mutants | 14 | 19 |
| caught | 6 | **19** |
| **survived** | **8** | **0** |
| fixtures | 2 | 6 |

The eight survivors named eight constructs no fixture exercised: the scope walk,
`extend`, the proto2 `group`, import modifiers, streaming, `reserved`/`extensions`,
the published `metadata.id`, and the confidence value. Four fixture files were
written to close them, each verified to parse with **0 ERROR/MISSING nodes** first
— an expectation written on a damaged parse states something about tree-sitter's
error recovery rather than about protobuf.

Two of the fourteen were themselves defective as first written: the scope-walk and
extend-phantom transforms could not fire on correct output at all, so they were
reporting a hole that did not exist while missing the one that did. And one mutant
was caught by the *wrong assertion* — its predicate matched a field in an
unrelated owner, so it tripped a different fixture row. All three are corrected,
because a mutant caught for the wrong reason is coverage that reads as coverage.

## Defects found and fixed this round

**A field whose name equals the type it names resolved to itself — 9 fabricated
self-edges.** Protobuf resolves a type name through nested scopes, and only
*types* are in that namespace; a field declares no type. The resolver accepted
every declaration, so:

```proto3
message Extra { repeated IPAMStatus IPAMStatus = 1; }
```

published the field as `pkg.Extra.IPAMStatus` moments before emitting its own edge,
the innermost scope candidate matched the field, and the edge became
`pkg.Extra.IPAMStatus -> pkg.Extra.IPAMStatus`. Measured **9 self-edges over 627
files**: `docker/daemon/cluster/convert/netextra/extra.proto:12`, and 8 under
`docker/vendor/github.com/moby/buildkit` (`api/types/worker.proto:13-14`,
`frontend/gateway/pb/gateway.proto:173/193/197`,
`solver/pb/ops.proto:117/120/317`). Resolution now walks `declaredTypeIds` — a
narrower set than `declaredIds` — and self-loops are **0**, with the edge count
unchanged at 45,979, so edges were retargeted rather than dropped. A regression
mutant and a fixture row (plus a no-collision control row) pin it.

**`imports` and `exports` were absent while their constructs were everywhere.**
1,131 `import` nodes in 402 files, 4 of them re-exports, recorded into
`result.imports` and emitted as **no relationship at all**. A schema language whose
graph cannot answer "which file does this type come from" is missing the edge a
consumer needs most, and the absence is invisible to a differential because the
oracle was written after the same ruling.

**A first draft of that fix made every file import itself.** The source was taken
from the basename of the *imported* path, so `import public
"common/v1/types.proto"` became `types.proto -> common/v1/types.proto` — an edge
whose two endpoints name the same module, which `bb_graph` reads as a
self-dependency and `bb_impact` as a cycle. Caught by the suite before commit, and
pinned by a `forbidRelationships` row naming the shape.

## Declared limitations

- **No independent oracle.** Stated in full under question 3. Every correctness
  claim in this document rests on hand-derived expectations, a mutant battery, and
  the specification — not on a second implementation.
- **Reference resolution is per-file**, by the declared boundary in the analyzer
  header. Cross-file resolution needs a project index; this lane does not build
  one, and `bb_graph` consumers reading a `uses` edge must know that 24.2% of them
  name a type outside the file.
- **`imports` and `exports` endpoints do not resolve to symbols**, by design and
  by family convention. Reported as 0% rather than omitted.
- **Custom options are not read, and that is a measured decision rather than an
  oversight.** A custom option's name is parenthesised, which makes it a reference
  to an extension type: `option (gogoproto.marshaler_all) = true;` names
  `gogoproto.marshaler_all`. There are **1,129** such sites (1,028
  declaration-scoped, 101 file-scoped), and `option (foo) = …` on a message, enum,
  rpc, service or oneof is the editions/custom-option idiom the corpus uses
  heavily — 582 of the 1,129 sit on an `rpc`.
  **0 of the 1,129 resolve to a symbol declared in the same file — 0.00%**, because
  every one names an extension defined in an *imported* option-definition file
  (`gogoproto.*` from `gogo.proto`, `dart_options.*` from `dart_options.proto`).
  Emitting a `uses` edge for each would therefore add 1,129 edges with a 0%
  resolution rate and no endpoint that binds: the fabrication risk the workstream
  calls its most expensive mistake, bought for no gain. Resolving them needs a
  cross-file project index over imported `.proto` files, which this lane does not
  build. Measured by `script/m14/tmp/protobuf/probe/_customopt.mts`.
- **Option values are read positionally.** Per-field and per-enum-value options are
  not extracted; the grammar census records that as `grammarOnly`. **1,093**
  declaration-level options and 1,516 file-level options are counted and none is
  read.
- **An intermittent wasm fault in the shared pool.** Two runs reported
  `[BB-PARSE-ERR] … memory access out of bounds` and a `[BB-HANG]` at 120s on
  `pb-reference/src/google/protobuf/internal_options.proto`. Not reproducible in
  isolation: the file parses with 0 ERROR nodes, yields 14 symbols and 18
  relationships, and `parseFile` returns it cleanly 3 of 3 runs at 34–869 ms. It
  appears only under concurrency, so it is a shared-pipeline finding and not this
  analyzer's — but it is the reason one census run reported 1,126 `imports` edges
  where a clean run reports 1,127, and that one-edge difference is the faulted
  file rather than a counting rule.
- **The `imports` source is a basename.** Two files with the same basename in
  different directories are indistinguishable as edge sources. The full path is in
  `metadata.filePath`; a consumer needing exactness must read it there. protoc's
  include-root-relative module name is not derivable from the file alone.
