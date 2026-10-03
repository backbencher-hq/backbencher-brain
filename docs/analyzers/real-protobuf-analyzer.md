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
parser that understands more of the language is worth nothing if the extractor does
not read the new nodes.

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

**PASS 2 (adversarial re-verification).** Pass 1's numbers were taken on 627 `.proto`
files in 14 repositories. The shared corpus grew — four repositories were cloned at
07:02 on 2026-10-03, minutes after pass 1 committed — so **every count below is
restated at 821 files in 18 repositories**, and where a number moved because the
corpus grew rather than because the analyzer changed, that is said. Pass 1's verdicts
were re-probed; one of them did not survive.

Measured on **821 `.proto` files in 18 repositories**, the whole corpus walked rather
than sampled (`$HOME/fixtures/repositories`, walked as a working tree, not
`git ls-files` — three of these corpora are sparse checkouts, where `git ls-files`
lists tracked paths that are not on disk). Revisions in
`script/m14/tmp/protobuf/corpus-manifest.json`.

Every count is off the **production entry point**, `parseFile` from
`src/ast/pool-worker.ts`. `analyze()` is a per-file unit that skips the pipeline
stages pool-worker owns, so a count taken from it measures a path the product does
not run. `metadata.id` does not survive pool-worker's symbol projection, so endpoint
resolution is additionally measured against the analyzer's own id set; both numbers
are given.

Corpus composition: `kubernetes` 135, `pb-googleapis` 128, `docker` 109,
`pb-reference` 108, `pb-grpc` 45, `kong` 39, `consul` 33, `vault` 24, `waypoint` 21,
`dart-sdk` 18, `terraform` 17, `nomad` 10, `gh-cli` 3, and 5 single-file
repositories. The four added since pass 1 are `boundary` 127, `consul` 33, `vault`
24 and `nomad` 10 — **+194 files** — and `pb-grpc` and `terraform` were themselves
updated, **−5**, for a net **+189** over pass 1's 632... which is 821 against the 627
pass 1 recorded. The two figures do not reconcile to the file and the reason is worth
naming rather than rounding away: **pass 1's 627 is not reproducible from the corpus
as it stands now**, because the corpus changed under it. Every pass-1 number below is
therefore restated, and the pass-1 value is given beside it so a reader can see which
movement is corpus and which is code.

| | count | pass 1 (627 files) |
|---|---|---|
| files parsed | **821 ok / 0 fail** | 627 ok / 0 fail |
| symbols | **41,956** analyzer-direct / 41,938 through `parseFile` | 34,491 / 34,461 |
| relationships | **55,941** analyzer-direct / 54,939 through `parseFile` | 45,979 / 44,959 |
| symbols with an empty name | **0** | 0 |
| unknown `SymbolKind` values | **0** | 0 |
| relationship endpoints equal to the literal `unknown` | **0** | 0 |
| self-looping relationships | **0** | 0 (was 9 before pass 1) |
| duplicate analyzer symbol ids | **0** | 0 |
| `imports[]` entries recorded | **1,561 in 557 files** | 1,130 in 401 files |

1,002 edges are produced by the analyzer and not kept by production, in the same two
`pb-reference` files as before — `test_protos/tctable_long_name_test.proto` and
`unittest_enormous_descriptor.proto` — all carrying identifiers of 112 to 1,000
characters. They are dropped by a shared pipeline stage on name length, not by this
analyzer, and 1,001 of them are field `contains` edges. The analyzer's own count is
unchanged by this.

## Verdict per type

**Checked by the arbiter.** `script/m14/ontology-coverage-gate.ts` is the workstream's
arbiter and it is the supervisor's file, so this lane writes its table to
`script/m14/protobuf-ruled.ts` and the wiring is reported rather than made. With the
wiring applied, the gate reports:

```
type          status            detail
--------------------------------------------------------------------------------------
calls         RULED-SOUND       NOT EMITTED; the grammar produced 94 distinct node types
                                 across the corpus and NONE expresses it.
                                 Written ruling: script/m14/spec/protobuf-completeness.json#PB-REL-1
uses          EMITTED           13,275 edges in 4+ files
contains      EMITTED           40,098 edges in 4+ files
imports       EMITTED           1,561 edges in 4+ files
references    RULED-SOUND       NOT EMITTED; 94 distinct node types, NONE expresses it.
                                 Written ruling: …#PB-REL-5
exports       EMITTED           4 edges in 4+ files
extends       RULED-SOUND       NOT EMITTED; 94 distinct node types, NONE expresses it.
                                 Written ruling: …#PB-REL-2
implements    RULED-SOUND       NOT EMITTED; 94 distinct node types, NONE expresses it.
                                 Written ruling: …#PB-REL-3
overrides     EMITTED           1 edges in 1+ files,
                                 e.g. nvim-treesitter/tests/query/highlights/proto/test.proto
instantiates  RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree.
                                 Written ruling: …#PB-REL-4
--------------------------------------------------------------------------------------
emitted 5/10   ruled-sound 5   FALSIFIED 0   ruled-without-justification 0
```

Gate exit code 0. Reproduce with `npx tsx script/m14/protobuf-ruling-table-proof.mts`
— it derives a wired copy of the shared gate mechanically, runs it, and deletes the
copy, because a hand-written second implementation of an arbiter is a second opinion
nobody arbitrates between.

**The first row of the verdict table below is a ruled row on purpose.**
`parseClaimTable` in `script/m14/verify-doc-truth-emissions.ts` skips the **first body
row** of any claim table (the `if (!started) { started = true; continue }` at the end
of its row loop). A dropped `no` claim costs nothing; a dropped `yes` claim leaves an
emitted relationship type unchecked, which is the `FALSE_NEGATIVE` class that gate
exists to catch. Measured during this pass: with `contains` first, the gate reports
`UNDOCUMENTED [protobuf] contains (relationship)` — and it is the gate, not the doc,
that is wrong. The fix belongs in the shared file and is a report item.

| Relationship type | Emitted? | Count (production) | Both-end resolution | What the number is |
|---|---|---|---|---|
| `references` | no | 0 | — | **RULED**, instrument **A**. The construct occurs (10,166 message-typed declarations) and is emitted, as `uses`. FIRST ROW DELIBERATELY: see the note under the gate output above |
| `contains` | yes | 40,098 | 99.22% per-file, 100% corpus-wide | declaration → member |
| `uses` | yes | 13,275 | 72.84% per-file, 96.72% corpus-wide | declaration → referenced type |
| `imports` | yes | 1,561 | 0% by design | file → a file it depends on |
| `exports` | yes | 4 | 0% by design | file → a file it re-exports |
| `overrides` | yes | 1 | 100% analyzer ids | **new in pass 2** — pass 1 ruled this absent at a measured construct count of 1 |
| `calls` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `extends` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `implements` | no | 0 | — | **RULED**, instrument **A** (grammar inventory) |
| `instantiates` | no | 0 | — | **RULED**, instrument **B** (parse-tree count) — see why not A |

The `imports`, `exports` and `overrides` resolution figures need their denominators
stated, or a reader compares two different measurements:

- `imports` and `exports` are **0% by design**, not by defect: both endpoints of a
  cross-file module edge are module paths, not symbols of the file, which is the
  convention in `real-css-analyzer.ts` and `real-dart-analyzer.ts`. CSS's 66.8%
  `references` figure is a different measurement of a different thing.
- `overrides` resolves at both ends against the analyzer's published ids (100% of 1)
  and at **0%** against ids a consumer re-derives as `ownerName + "." + name`, because
  the later declaration's id carries `uniqueId`'s `#property` suffix. That is the same
  projection limit the proto2 `group` has always had, and it is measured rather than
  argued: **30** re-derived ids collide across the corpus against **0** published ids.

### The five EMITTED types, in this language

**`contains` — declaration → member.** message→field, message→nested type,
message→oneof, enum→enum_value, service→rpc, and extended-type→extension field. A
`oneof` is reached **from** the message and there is deliberately no edge from the
oneof to its fields: membership and grouping are different relations, and overloading
`contains` to mean both would make one edge mean two things. The grouping travels as
`metadata.oneof` on each field. A top-level declaration is contained by the file's
`package`, published as a `namespace` symbol — **7,166** such edges.

**`uses` — declaration → referenced type.** A field's declared type, a map *value*
type, a `oneof_field` type, and **both** of an rpc's request and response. A **scalar
produces no edge**: `string` and `int32` are keywords and there is no declaration of
them to point at. This is decided structurally — a `type` node holding a
`message_or_enum_type` child is a reference, one with no named children is a keyword —
so an unrecognised scalar is safe by construction rather than by being absent from a
hardcoded list. A map's key type is a scalar by specification and is never a
reference.

**`imports` — this file → a file it depends on.** 1,561 `import` nodes across 557
files. The **source** is the importing file's own module name (its basename) and the
**target** is the path as written, which is the family's convention rather than a
protobuf invention: `real-css-analyzer.ts` imports from `importerName` onto the
imported stylesheet's name and `real-dart-analyzer.ts` from the library name, and the
store records a non-symbol endpoint as external. `protoc` resolves an import against
`-I` include roots the analyzer is never told, so the path as written is the most
faithful name available; the full path is kept in `metadata.filePath` so a consumer
that knows the include root can do better. The editions feature import
(`import option`) is an `imports` edge and not an `exports` edge — it resolves an
option's definition rather than a message.

**`exports` — this file → a file it re-exports.** `import public` is a re-export:
this file's *own* importers reach the imported declarations **through** it. That is a
fact about the module graph and is not derivable from the path, because two files can
import the same path and only the public one republishes it. Measured at 4 occurrences
in 4 files, all in `pb-reference`: `cpp_options.proto:15`, `json_options.proto:14`,
`unittest_import.proto`, `unittest_import_lite.proto`.

**`overrides` — the later declaration of a field SLOT.** Protobuf has no inheritance
and no method to replace, so the only sense of `overrides` the language reaches is a
second declaration of a field slot: two declarations in one message claiming the same
field number, where the later one states what that slot means. Measured: **1 edge in
821 files**, `nvim-treesitter/tests/query/highlights/proto/test.proto`, message
`LogContent`:

```proto2
required string Value = 2;
required CustomType Value = 2;   // same name AND same field number
```

`protoc` rejects that file, so the edge states a fact about the text rather than about
a schema that compiles, and both endpoints are real published symbols —
`sls.asfd.asfd.LogContent.Value -> sls.asfd.asfd.LogContent.Value#property` — so it is
not a fabricated edge. **Its entire corpus support is that one syntax-highlighting
fixture**, and that is stated at every place the count appears rather than left for a
reader to assume otherwise.

### The ruled types: instrument, probe, and what would overturn each

The gate's header explains why this section is not optional: the `overrides` defect
survived a differential that reported agreement throughout, because the analyzer and
the oracle are two walkers over *one* grammar and a type absent from both agrees with
itself without a single counterexample. Only measuring the language finds it. This lane found it — on
itself, in pass 2.

**Instrument A — grammar inventory.** The declared vocabulary is read from the wasm's
own node-type table (**117** node types) and the **observed** vocabulary is walked off
the corpus (**94** distinct node types across 821 files, **13 ERROR and 2 MISSING** in
1 file, `pb-reference/src/google/protobuf/unittest_custom_options.proto`). Both
instruments read the *same* tree in one streaming pass, so a construct cannot be
counted on one parse and the inventory taken on another. The probe is a node-type
intersection over the corpus's own parse trees, never a text search.

| Type | Probe | Intersection | Overturned by |
|---|---|---|---|
| `calls` | No node type expresses a function definition or a call expression. The nearest construct is `rpc Foo(Req) returns (Res)`, which names two message types rather than invoking anything. | **0 of 10** | any observed node type in the list, or any corpus file containing an invocation |
| `extends` | No node type expresses class heritage. The vocabulary's `extend` is the proto2 field-extension BLOCK — **214** nodes in **64** files — which adds members and is read as `contains` with `viaExtension`. | **0 of 8** | any observed node type expressing heritage or a superclass |
| `implements` | No node type expresses interface satisfaction. `service` maps to `SymbolKind.Interface` — a symbol-KIND mapping, not an edge: a service declares `rpc`s and names no supertype. **259** service nodes in **221** files were counted so the size of the surface is on the record. | **0 of 6** | any observed node type expressing an implements clause, or any `service` naming a supertype |
| `references` | Not a missing construct. Protobuf's only references are *type* references; there is no expression and therefore no value read. The construct occurs (**10,166** `message_or_enum_type` nodes) and is emitted, as `uses`. The separate label stays unused because no second kind of reference exists to label. | **0 of 7** | any observed construct that references a name other than a type |

**`instantiates` — instrument B, and why A would be the lazy answer.** A grammar
inventory for this type has to guess at *names*: `new_expression`,
`constructor_invocation`, and so on. Protobuf's own aggregate literal is spelled
`block_lit`, which is in none of those lists, so an A ruling here would be a name list
failing to recognise the one construct that could have matched it — the same shape as
the gate's own JSON entry, where a first probe matched a SHAPE (any string in a JSON
document, 2,651 occurrences of something that was not a `$ref`) rather than a ROLE.

So B counts the construct. `block_lit` is protobuf's aggregate literal `{ … }` and the
only place a `.proto` file writes a **value** of a message type; it is a construction
only when it is not an option's payload. The probe counts `block_lit` nodes whose
ancestor chain reaches no `option`, `constant`, `field_option` or `enum_value_option`.
**MEASURED: 1,909 `block_lit` nodes, and the by-parent histogram is
`{ constant: 1909 }` — one key. Construct occurrences: 0.** The 10,166
message-TYPED **declarations** the same walk counts are references, not constructions:
a field whose type is a message holds one, and declaring the field creates nothing.
All 10,166 are emitted as `uses`. **Overturned by** a `block_lit` outside an option
value, or any node type that constructs a value.

## The six questions, per emitted type, asked adversarially

Pass 1 answered these from the source and from a census. Pass 2 asks each one for a
case where it is **wrong**, and measures. `script/m14/protobuf-adversarial.mts` is the
harness; every probe below reads the same tree as the census.

**1 — Exists.** Derivable from source for all five: `contains` from the
`addFieldLike`/`addSymbol` containment path and the four nested-type/oneof/rpc sites;
`uses` from the four call sites that pass `resolveRef`; `imports` and `exports` from
the `import` branch of `drain`; `overrides` from the `slotClaims` map consulted in
`addSymbol`.

**2 — Fires.** 40,098 / 13,275 / 1,561 / 4 / 1 across 821 files. None is reachable
only from a branch that never matches.

**3 — Correct.** **There is no oracle for this lane, and this is the largest
limitation in this document.** `protobuf` does not appear in `differential.ts`'s
`LANGS` (0 occurrences), and `script/m14/oracles/` holds 19 oracles for other
languages and none for protobuf. No independent implementation exists to disagree
with this one. The limitation is structural and worth stating plainly: even where an
oracle existed it would be a second walker over the *same* patched grammar, so a
grammar bug shared by both paths would be invisible to it. What the lane has instead
is (a) expectations derived by hand from the specification rather than captured from a
run — `script/m14/tmp/protobuf/probe/contract-battery.mts` states the rule and the
seven fixtures in `validation/m14/fixtures/protobuf/` follow it; (b) a 24-mutant
battery, below; (c) the probes in this document, each of which is written to be able
to come back non-zero.

**4 — Labelled.** The confusable pairs in this language, each pinned by a fixture row
rather than left to be believed, and each with the STRONGEST argument that the label
is wrong:

| Pair | The argument that the label is wrong | What the corpus says |
|---|---|---|
| `uses` vs `references` | a type reference might deserve its own label | there is no second kind of reference in the language; the 10,166 occurrences are emitted as `uses` and the separate label has nothing to name |
| `contains` vs `extends` | `extend Foo { … }` looks like inheritance | it adds *fields* to `Foo`; it is `contains` with `viaExtension`, and `extend-and-group` forbids an `extends` edge on that shape |
| `imports` vs `exports` on a public import | they are one construct, so one of the two labels is redundant | **pass 1 said exports-only and pass 2 overturned it.** Both are emitted: the dependency and the republication are two facts. `imports-and-editions` now *requires* both, so neither reading satisfies it |
| `calls` vs `uses` | an rpc names a message, which is a call in every other IDL | nothing is invoked; `streaming-and-forward-refs` forbids it explicitly |
| `overrides` vs `contains` | a slot restated is also a second member | it is *both*, and the discriminator is the field number: same slot = `overrides`, different slot = no edge. `slot-and-grouping` holds all three shapes so a rule stated as "a repeated name is an override" fails |
| `contains` vs `overrides` on a oneof | a field inside a oneof is contained by the oneof | the field number lives in the MESSAGE's space, so ownership and grouping differ; there is no edge from the oneof to its fields |

**5 — Resolved.** Both-end resolution, per type, against the analyzer's published ids
and against the ids production redraws:

| Type | both ends, analyzer ids | both ends, production ids | corpus-wide, analyzer ids |
|---|---|---|---|
| `contains` | **99.22%** (40,098) | 99.11% | **100%** (41,100 of 41,100) |
| `uses` | **72.84%** (13,275) | 72.68% | **96.72%** (12,840 of 13,275) |
| `imports` | 0% | 0% | 0% — module-path endpoints by design |
| `exports` | 0% | 0% | 0% — module-path endpoints by design |
| `overrides` | **100%** (1) | 0% | 100% (1) |

Three different denominators, and conflating them is how a lane talks itself into a
false comparison with CSS's 66.8% `references` figure.

- The `uses` per-file figure needs its denominator because it is not the same
  measurement. **Per file, 3,605 of 13,275 (27.16%) `uses` edges name a type this file
  does not declare** — an imported type, which is most of them. Placing all 821 files'
  published ids in one table, so cross-file resolution is possible, the same edges
  resolve at **96.72%**, the remainder naming a type from a repository outside this
  corpus. Both numbers are true.
- **`imports` and `exports` at 0% is by design and is reported rather than omitted.** A
  consumer resolves them against the project's include roots.
- `overrides` at 0% on production ids is the `uniqueId` projection limit, not a
  dangling edge: 30 re-derived ids collide across the corpus, every one a proto2
  `group` field or a repeated name, against **0** published-id collisions.

**6 — Confident.** **0 of 54,939 production edges fall below 0.7** — the heuristic
ratio is 0, and it is countable rather than merely true: `evidenceClass` is
`structural` on 53,378 edges and `import_based` on 1,561, both pinned by fixture rows
so an analyzer stamping one constant on everything fails. Pass 1 measured this
attribute as **absent on 40,562 of 40,562** production edges, which left the honesty
contract's "a heuristic must be countable" with nothing to count.

The adversarial reading of "structural" is stated rather than defended away. Of the
13,275 `uses` edges, **9,670 (72.84%) have a target that is a parse fact** — the file
declares that type. The other **3,605 (27.16%)** are a *derived* target: the parse tree
says `Foo`, the edge says `<package>.Foo`, by protobuf's own resolution rule applied
without the import graph. That is the rule `protoc` applies, so it is not a name-match
guess and `structural` stands; but a consumer reading a `uses` edge has to know that
27.16% of them were qualified rather than read, and the number is here rather than in
a reader's head. `metadata` also carries the count of `type` nodes read as a scalar
whose text is a type the file declares: **39 raw, 0 of them a non-keyword name** — all
39 are `int32` and `bool` messages inside protobuf's own
`test_bad_identifiers_{proto2,editions}.proto`, which `protoc` rejects. So no
reference was dropped.

## DERIVATION findings: 5

**Five**, one per emitted type — `contains`, `uses`, `imports`, `exports`,
`overrides`. Each is stored by the analyzer and compared against nothing: no protobuf
entry in `differential.ts`'s `LANGS` and no protobuf oracle in `script/m14/oracles/`.
All 54,939 edges in this lane are unaudited by an independent implementation. The
count was 4 at pass 1 handover and rose to 5 because `overrides` became emitted.

Paying this down needs an oracle, and an oracle for `contains`/`uses` would be a
second walker over the same patched grammar — which is why it is a report item and not
a lane edit. What the lane can own, and did, is the mutant battery.

## Adversarial review of pass 1 — what changed and what did not

**`overrides` — pass 1's ruling is OVERTURNED, and the type is now emitted.** Pass 1
ruled it on instrument B and *measured its construct at 1, not 0*, then called the type
absent. The gate's own rule is that a ruled type whose construct probe finds a non-zero
count is FALSIFIED. A ruling cannot be "the construct occurs once, but that once does
not count", so the lane either emits the type or holds a ruling the arbiter has already
rejected. It emits it. What protobuf can express is not a method replacing a base but a
field **slot** being restated, and the discriminator is the field number:

- same number, either name → both claim slot N; the later one says what slot N holds.
  **1 occurrence.**
- same name, **different** number → two distinct slots sharing a label; the second
  replaces nothing. **0 occurrences.**

Pass 1's probe used the *name*, which counts a name collision that replaces nothing —
which is why its single hit was a coincidence of one fixture rather than a measurement
of the construct. Direction is **document** order read off the range, not visit order
(the walk is a LIFO stack and reaches siblings in reverse), and the edge's
`line_number` is the **source's** line because `line_number` is what `bb_graph` and the
store's `relId` key on. Both were wrong in the first version and both are measured: the
first version reported the override of slot 7 at line 26, which is the declaration
being *overridden*.

**`imports` on a public import — pass 1's ruling is OVERTURNED.** Pass 1 emitted
`exports` alone and pinned the absence of `imports` with a fixture forbid whose stated
reason was that emitting both "would double the module's inbound dependency and lose
the re-export fact entirely". Neither half survives measurement: nothing is doubled,
because the pair went from **zero** `imports` edges to one, and the re-export fact is
what the `exports` edge carries. What emitting `exports` alone lost is the
**dependency**: a consumer asking which files it must read to compile this one got an
incomplete answer, and `bb_impact` on the imported file could not see a file that
reaches it through a public import. `protoc` agrees — a public import is a
`FileDescriptorProto` dependency like any other, with `public_dependency` naming its
index. **4 sites, 4 `exports` edges and 4 `imports` edges**, and both are now required
by the fixture so neither reading satisfies it alone.

**`metadata.viaExtension` — the documentation was false and is now true.** The header
claimed the extension edge carries `metadata.viaExtension = true`. It did not: the flag
was set on the member's SYMBOL and the `addRel` call passed only `member`, so **0 of
the extension-derived `contains` edges** carried it and a consumer reading
`google.protobuf.MessageOptions -contains-> audit_ticket` could not tell an extension
field from a declared one. **839** edges carry it now, across every `contains` site
derived under an `extend` block — field, group type, group field, enum value, nested
type, oneof and rpc. 527 of those 839 (62.81%) have a source the file declares; the
other 312 name an extended type declared elsewhere, which is the case the flag exists
for.

**`metadata.oneof` — a bare name could not address a oneof.** It carried the oneof's
bare name, so two messages in one file that each declare `oneof body` produced fields
with the same grouping key and a consumer grouping by it merged two unrelated
discriminated unions. **423 of 1,121 oneof fields (37.73%)** sat under a bare name
declared by more than one owner — `oneof attrs` alone appears in 7 different messages
of boundary's `session_recording.proto`. It is the resolved id now: **0 of 1,121
ambiguous**. A side effect on the battery is recorded because it is the failure mode
this battery exists to catch: `protobuf/oneof-field-reowned-by-the-oneof`, a pass-1
mutant, stopped being able to fire the moment the key was qualified, because it looked
the oneof up as `<message id>.<bare name>`. A mutant that can no longer fire reports a
hole that does not exist while missing the one that does; it now tries both spellings.

**What pass 1 got right and pass 2 confirms.** The four instrument-A rulings, at 94
observed node types instead of 94 on a 30% larger corpus. `calls` and `extends` and
`implements` and `references` all still read 0. The self-edge fix holds: **0**
self-loops, with `declaredTypeIds` still the resolution namespace. The scalar rule
holds: 0 non-keyword cases. The `import public` self-import shape holds: **0**
module self-edges. The `oneof` ownership ruling holds. The iteration requirement holds
— 628,758 nodes read with **0** lacking the `.id` the `typeCache` keys on, which is
the measurement that would expose a broken binding.

## The mutant battery

| | pass 1 | pass 2 |
|---|---|---|
| protobuf mutants | 19 | **24** |
| caught | 19 | **24** |
| **survived** | 0 | **0** |
| fixtures | 6 | **7** |

Five mutants were added, one per rule this pass changed, and each reverts the exact
rule rather than a shape near it:

| Mutant | What it reverts | Caught by |
|---|---|---|
| `same-slot-override-collapsed-into-a-duplicate-name` | the slot rule back to "a name declared twice", dropping the slot shape | `slot-and-grouping`'s `Slot` row |
| `override-edge-line-taken-from-the-declaration-being-added` | the edge's line to the lower of its two endpoints | `slot-and-grouping`'s two `overrides` rows |
| `oneof-grouping-key-downgraded-to-the-bare-name` | the resolved id back to the bare name | `slot-and-grouping`'s two `metadata.oneof` rows |
| `extension-edge-loses-viaextension` | the flag off the edge, leaving the symbol's copy — the pre-fix shape, in which the two are not derived from each other | `extend-and-group`'s two edge rows |
| `public-import-loses-its-dependency-edge` | both labels back to `exports` only | `imports-and-editions`' public-import rows |

Two of the five were wrong as first written and are corrected here rather than
counted: the override mutant's first transform keyed on `metadata.fieldNumber`, which
**cannot** discriminate the two shapes — every name collision also repeats the number,
so the transform could not fire and reported a hole that did not exist. And the
oneof mutant has to check that a *different* oneof in the file really does own the bare
name, or the two spellings are the same string and it silently does nothing.

## Gates re-run, with results

| Command | Result |
|---|---|
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **7 pass / 0 fail** (`validation/m14/fixtures/protobuf/`) |
| `npx tsx script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **24 caught / 0 survived** |
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 2 — "no RULING TABLE for protobuf"**. The arbiter cannot rule for this lane until the wiring below is applied; nothing about the lane is wrong here |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | with the wiring applied: **emitted 5/10, ruled-sound 5, FALSIFIED 0, ruled-without-justification 0, exit 0** |
| `npx tsx script/m14/protobuf-census.ts` | 821/821 parsed, 0 empty names, 0 unknown kinds, 0 `unknown` endpoints, 0 self-loops, 0 duplicate published ids |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; the numbers in this document |
| `npx tsx script/m14/protobuf-construct-probes.mts` | 94 observed node types, 117 declared; every pass-1 ruling re-probed at the larger corpus and still reading 0 |
| `npx tsx script/m14/tmp/protobuf/probe/_wasm-fallback.mts` | the wasm-fallback measurement below |
| fixture sources parse | 7 of 7 at **0 ERROR / 0 MISSING** nodes |

## The shared gate would have passed this lane on the wrong grammar

`ontology-coverage-gate.ts` selects its wasm with
`(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`, and `LANGS` is
`differential.ts`'s. `protobuf` is not in it. Measured by
`script/m14/tmp/protobuf/probe/_wasm-fallback.mts`, parsing the same 821 `.proto`
files under each wasm:

| | `tree-sitter-protobuf.wasm` | `tree-sitter-bash.wasm` (the fallback) |
|---|---|---|
| distinct node types | **94** | 81 |
| ERROR nodes | 13 | **2,975** |
| root node type | `source_file` | `program` |
| `calls` instrument-A intersection | **0 of 10** | `function_definition` |

And the consequence, from `protobuf-ruling-table-proof.mts` run B — ruling table wired,
`LANGS` untouched:

```
calls         FALSIFIED   the grammar DOES produce function_definition — the construct exists
instantiates  FALSIFIED   the construct occurs 821x across 795 file(s) — "WRONG GRAMMAR: this
                          probe was handed a tree whose root node is `program`, not `source_file`"
references    RULED-SOUND the grammar produced 81 distinct node types across the corpus
extends       RULED-SOUND the grammar produced 81 distinct node types across the corpus
implements    RULED-SOUND the grammar produced 81 distinct node types across the corpus
```

Three RULED-SOUND verdicts reached while measuring bash, and `81` in the detail line
where protobuf's own count is `94` is the tell. Every `countOnTree` in
`script/m14/protobuf-ruled.ts` therefore checks that the tree it was handed is a
protobuf tree — `rootNode.type === "source_file"`, which no other grammar in `wasm/`
declares — and records a hit rather than a zero when it is not, which is what turns
`instantiates` from a silent false pass into the FALSIFIED above. **Instrument A
cannot defend itself the same way**, because the gate intersects the observed node
types with the `nodeTypesThatWouldMeanIt` array itself and no value in an array of
strings can carry a guard. That is why the three instrument-A rows above are the
residual risk, and why the fix is one line in a shared file rather than something this
lane can solve locally.

The fix, in full:

```ts
// script/m14/ontology-coverage-gate.ts
import { PROTOBUF_RULED } from "./protobuf-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, protobuf: PROTOBUF_RULED }

// script/m14/differential.ts — LANGS, which is also what selects the gate's wasm
protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },
```

Those four `LANGS` fields are a copy of what `run-fixtures.ts:91` already carries for
this lane, not a new claim. Adding a `protobuf` entry to `LANGS` also enrolls the lane
in `differential.ts`'s own sweep, which needs a truth file this lane does not have —
so the two changes may want to land separately.

## A construct found and deliberately not emitted, with the reason measured

1,525 **custom option** sites — `option (gogoproto.marshaler_all) = true;` names an
extension type, which is a type reference protobuf expresses and this analyzer reads
nowhere. 117 at file scope, 928 on an `rpc`, 338 in a message body, 80 on a service,
60 in an enum body, 2 in a oneof.

**0 of 1,525 resolve to a symbol published in the same file, and 0 of 1,525 resolve
against the published id set of all 821 files.** Pass 1 measured only the first number;
the second is the one that settles it, and the reason is structural rather than
incidental: protobuf names an extension by the package that **declared** the extend
block, while this analyzer publishes an extension member under the **extended** type —
`google.protobuf.MessageOptions.audit_ticket` — because that is where the field number
lives and what `protoc` reports. The two names can never coincide, so a cross-file
index would not fix it. Emitting the edge would add 1,525 edges with a 0% resolution
rate and no endpoint that binds.

That is decided by the same standard applied to `imports` and `exports`, and the
contrast is the point: those are emitted at 0% symbol resolution because a module-path
endpoint is a **convention a consumer can resolve** against the project's include
roots. A custom option's extension name has no such convention, so there is nothing for
a consumer to do with the edge. Measured by
`script/m14/tmp/protobuf/probe/_customopt.mts`.

## Declared limitations

- **No independent oracle.** Stated in full under question 3. Every correctness claim
  in this document rests on hand-derived expectations, a 24-mutant battery, and the
  specification — not on a second implementation. **5 DERIVATION findings**, all 54,939
  edges unaudited.
- **Reference resolution is per-file**, by the declared boundary in the analyzer
  header. Cross-file resolution needs a project index; this lane does not build one.
  **27.16%** of `uses` edges name a type outside the file, and their target is derived
  from protobuf's own resolution rule rather than read. Corpus-wide, against all 821
  files' ids at once, those edges resolve at **96.72%**.
- **`imports` and `exports` endpoints do not resolve to symbols**, by design and by
  family convention. Reported as 0% rather than omitted.
- **The `imports` source is a basename.** Two files with the same basename in
  different directories are indistinguishable as edge sources. The full path is in
  `metadata.filePath`; a consumer needing exactness must read it there. `protoc`'s
  include-root-relative module name is not derivable from the file alone.
- **`overrides` has a corpus count of 1, in a file `protoc` rejects.** The edge is
  emitted because a non-zero construct count falsifies a ruling, and the count is
  printed beside the verdict everywhere it appears so no reader can mistake it for a
  populated relationship type.
- **39 identical (source, target, type, line) edge groups** collapse in the store,
  because `relId` keys on exactly those four: **38** are an rpc whose request and
  response name the same message (`rpc Watch(ReplicationMessage) returns
  (ReplicationMessage)`), and **1** is a file that imports the same path twice. A
  graph cannot show multiplicity without weights, so nothing is lost that a consumer
  could have read, but the file states two sites and the index holds one edge.
- **11 of 821 files declare no `package`**, and their **46** top-level declarations get
  `ownerName: undefined` and **no** containment edge, because `root.owner` is
  `pkg || null` and there is no namespace to own them. That is a real difference
  between two otherwise equivalent files, left as-is rather than fixed by minting a
  per-file namespace symbol the language does not declare.
- **For a name declared twice in one scope, the plain dotted id goes to the LAST
  declaration in the file** and `#property` marks the earlier one, because the walk
  reaches siblings in reverse document order. Nothing depends on which one gets which
  id, but a reader assuming document order will guess wrong.
- **Custom options are not read**, with the measurement and the reason under its own
  heading above.
- **Option values are read positionally.** Per-field and per-enum-value options are not
  extracted; the grammar census records that as `grammarOnly`. **1,694** file-level
  options and **1,489** declaration-level options are counted and none is read.
- **An intermittent wasm fault in the shared pool.** Runs during this pass reported
  `[BB-PARSE-ERR] … memory access out of bounds` on
  `pb-googleapis/google/api/expr/v1beta1/expr.proto` and on `…/decl.proto`, and a
  `[BB-HANG]` at 120s in pass 1. Not reproducible in isolation: the files parse with 0
  ERROR nodes and `parseFile` returns them cleanly in repeated runs. It appears only
  under concurrency, so it is a shared-pipeline finding and not this analyzer's — and
  it is why two runs of the census above differ by up to 22 `uses` edges while the
  analyzer-direct counts are identical.
- **Grammar-version drift.** This lane's grammar is **vendored, patched and pinned**,
  not a registry package, and 8 patches are load-bearing; the analyzer reads node names
  (`message_or_enum_type`, `block_lit`, `field_number`) that a future upstream release
  could rename. `script/m14/tmp/protobuf/probe/grammar-census.mts` re-derives the
  vocabulary from the wasm's own node-type table on every run.
