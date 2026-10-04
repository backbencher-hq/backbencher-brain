# Protobuf Analyzer

Real tree-sitter extraction for `.proto` files, against a **vendored, patched,
pinned** grammar.

| | |
|---|---|
| Analyzer | `src/ast/real-protobuf-analyzer.ts` (1,274 lines) |
| Grammar | `grammars/tree-sitter-proto/` — `amaanq/tree-sitter-proto` @ `e9f6b43f`, 8 patches |
| Wired WASM | `wasm/tree-sitter-protobuf.wasm` — 81,735 B, sha256 `4624eb6d4b7830dd…` |
| Replaced WASM | `fixtures/graphql/baseline/tree-sitter-proto-UPSTREAM.wasm` — 72,342 B, sha256 `dbbde8a8f047b6b6…` |
| Probes | `script/m14/tmp/protobuf/` — `run-all.sh` runs every gate. `probe/store-binding.mts` indexes a scratch project through the real store (pass 5). `probe/protoc-oracle.py` adjudicates every `uses` target against `protoc` (pass 8) |
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
| `uses` | yes | 13,275 | 72.84% per-file, 99.58% corpus-wide, 88.57% corpus-wide to exactly ONE declaration | declaration → referenced type |
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

**3 — Correct.** > **SUPERSEDED BY PASS 8 for `uses`.** `protoc` 36.2 now adjudicates
> every `uses` target: **11,250 edges judged, 11,208 agree, 99.627%**, with all 42
> disagreements named and all 42 found to be one defect. The other four emitted types
> remain unaudited by an independent implementation, and for them what follows is
> still true.

**There is no oracle for this lane, and this is the largest
limitation in this document.** `protobuf` does not appear in `differential.ts`'s
`LANGS` (0 occurrences), and `script/m14/oracles/` holds 19 oracles for other
languages and none for protobuf. No independent implementation exists to disagree
with this one. The limitation is structural and worth stating plainly: even where an
oracle existed it would be a second walker over the *same* patched grammar, so a
grammar bug shared by both paths would be invisible to it. What the lane has instead
is (a) expectations derived by hand from the specification rather than captured from a
run — `script/m14/tmp/protobuf/probe/contract-battery.mts` states the rule and the
eight fixtures in `validation/m14/fixtures/protobuf/` follow it; (b) a **27**-mutant
battery, below — pass 2 ran 26 and passes 5 and 6 run 27, the twenty-seventh being
`protobuf/qualified-id-stopped-being-published`; (c) the probes in this document, each of
which is written to be able to come back non-zero.

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
| `contains` | **99.22%** (40,098) | **99.22%** | **100%** (41,100 of 41,100) |
| `uses` | **72.84%** (13,275) | **72.84%** | **99.58%** (13,219 of 13,275) binds somewhere; **88.57%** (11,758) binds to exactly one declaration |
| `imports` | 0% | 0% | 0% — module-path endpoints by design |
| `exports` | 0% | 0% | 0% — module-path endpoints by design |
| `overrides` | **100%** (1) | **100%** (1) | 100% (1) |

**The two production-id figures in this table are pass-5 numbers and supersede the
pass-2 values in the same three cells.** Pass 2 recorded `contains` 99.11% and
`overrides` **0%** on production ids; pass 5 found the projection was publishing no
qualified id at all, and after the fix every `overrides` end and every `contains` end
resolves through the production path, so both now equal the analyzer-id figure. The
pass-2 reading of `overrides` at 0% — and the "re-derived ids collide" explanation under
this table — are both retired by that fix; see the pass-5 section for what it did and did
not move. The re-derived-id collisions were real and remain real **for a consumer that
re-derives ids instead of reading the published one**, which is a different measurement
and is kept below for that reason only.

Three different denominators, and conflating them is how a lane talks itself into a
false comparison with CSS's 66.8% `references` figure.

- The `uses` per-file figure needs its denominator because it is not the same
  measurement. **Per file, 3,605 of 13,275 (27.16%) `uses` edges name a type this file
  does not declare** — an imported type, which is most of them. Placing all 821 files'
  published ids in one table, so cross-file resolution is possible, the same edges
  resolve at **99.58%** — and that figure was **96.72% before pass 3**, which is the
  ancestor-scope walk below. "Resolves" and "resolves to exactly ONE declaration" are
  different questions: at **88.57%** the target names an id exactly one file publishes,
  and the remaining 11.43% is 1,461 edges whose id **2,702 ids share with other files**
  plus 52 naming a type no file in the corpus publishes. All four numbers are true and
  they answer four different questions.
- **`imports` and `exports` at 0% is by design and is reported rather than omitted.** A
  consumer resolves them against the project's include roots.
- `overrides` resolves at **both** ends through the production path, **100% of 1**. Pass 2
  read 0% here and attributed it to the `uniqueId` `#property` suffix; that attribution
  was wrong and pass 5 measured it — the limit was the missing qualified id, not the
  suffix. The 30 re-derived-id collisions pass 2 counted are unaffected, because they
  collide only for a consumer that rebuilds ids from `ownerName + "." + name` instead of
  reading the published one, and **0** published ids collide.

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

> **SUPERSEDED BY PASS 8 — this count is now 4.** `uses` is adjudicated by `protoc`
> over 11,250 edges at 99.627% agreement, and the 42 disagreements are named. The
> section is left as pass 1 wrote it because the reasoning is the record of why the
> lane believed an oracle was impossible here; what changed is that the oracle turned
> out to be a compiler that was simply not installed. See **DERIVATION findings: 5 → 4**
> in pass 8.

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
| protobuf mutants | 19 | **26** |
| caught | 19 | **26** |
| **survived** | 0 | **0** |
| fixtures | 6 | **8** |

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
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail** (`validation/m14/fixtures/protobuf/`) |
| `npx tsx script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **26 caught / 0 survived** |
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 2 — "no RULING TABLE for protobuf"**. The arbiter cannot rule for this lane until the wiring below is applied; nothing about the lane is wrong here | <br>**SUPERSEDED, pass 9:** the supervisor applied that wiring; the gate now rules and exits **1** with `ruled-sound 3 FALSIFIED 2`, both rows the missing `LANGS` entry. See PASS 9 |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | with the wiring applied: **emitted 5/10, ruled-sound 5, FALSIFIED 0, ruled-without-justification 0, exit 0** |
| `npx tsx script/m14/protobuf-census.ts` | 821/821 parsed, 0 empty names, 0 unknown kinds, 0 `unknown` endpoints, 0 self-loops, 0 duplicate published ids |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; the numbers in this document |
| `npx tsx script/m14/protobuf-construct-probes.mts` | 94 observed node types, 117 declared; every pass-1 ruling re-probed at the larger corpus and still reading 0 |
| `npx tsx script/m14/tmp/protobuf/probe/_wasm-fallback.mts` | the wasm-fallback measurement below |
| fixture sources parse | 8 of 8 at **0 ERROR / 0 MISSING** nodes |

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
  in this document rests on hand-derived expectations, a **27**-mutant battery, and the
  specification — not on a second implementation. **5 DERIVATION findings**, all 54,939
  edges unaudited.
- **Reference resolution is per-file**, by the declared boundary in the analyzer
  header. Cross-file resolution needs a project index; this lane does not build one.
  **27.16%** of `uses` edges name a type outside the file, and their target is derived
  from protobuf's own resolution rule rather than read. Corpus-wide, against all 821
  files' ids at once, those edges resolve at **99.58%**, and **88.57%** of all `uses`
  edges name an id exactly one file publishes.
- **52 `uses` targets still name an id no file in the corpus publishes**, and the
  reason is the same shifted-`-I`-root fact as the guard: consul declares
  `package hashicorp.consul.internal.common;` in `proto/private/pbcommon/common.proto`
  and imports it as `private/pbcommon/common.proto`, so the directory agrees with
  neither the package nor any ancestor of it. `protoc` binds these against include
  roots this analyzer is never told. The 56 ends that publish nothing at all are in
  files `protoc` rejects — `grpc/testing/duplicate/echo_duplicate.proto` names
  `EchoRequest` unqualified inside `package grpc.testing.duplicate` and declares
  nothing there.
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

---

# PASS 3 — the arbiter's 10/120, and what REACHES a declaration

Pass 2 reported 821 of 821 files parsed and 5 of 10 types emitted. The supervisor then
ran `script/m14/firing-check.ts` over production `parseFile` and got, for this lane,
**3/10 fired, 2,069 edges, 10 of 120 files**. Both numbers were produced by an
instrument reading `parseFile`, and they disagree by a factor of 25 in edge count.
That is not a rounding difference to be averaged: one of them is a statement about this
analyzer and the other is a statement about the sampler, and the sampler is the one
that is wrong. This section settles it with counts, then answers the question the
arbiter was built to ask, which pass 2 did not: **what walks TO a declaration.**

## 10 of 120 — measured, and it is the sampler

`script/m14/protobuf-incoming-audit.mts` part 1 re-derives the arbiter's own sample —
same corpus walk, same `git ls-files`, same stride — and then asks of every path it
offered a question that has nothing to do with parsing.

| | |
|---|---|
| `git ls-files` offered | **8,524** `.proto` paths |
| of those, on disk | **821** |
| of those, **NOT** on disk | **7,703** |
| stride (8,524 / 120) | 71 |
| sampled paths | 120 |
| **present on disk** | **10** |
| **absent from disk** | **110** |

The 110 are 103 `pb-googleapis`, 6 `pb-reference`, 1 `pb-grpc` — the three repositories
checked out with `--filter=blob:none`, where `git ls-files` lists every tracked path
whether or not the blob was ever fetched. Per repository, tracked-versus-present:

| repository | tracked `.proto` | on disk |
|---|---|---|
| `pb-googleapis` | 7,341 | 128 |
| `pb-reference` | 477 | 108 |
| `pb-grpc` | 166 | 45 |
| the other 15 | 540 | 540 |

**7,703 of the 8,524 paths `firing-check.ts` offers this language are not on disk** —
**90.4%**. Pass 3 printed `8,703` here, which is larger than the 8,524 it was a fraction
of; the measured figure is 7,703, and it is the one the arithmetic supports
(821 + 7,703 = 8,524). The tables above were right in pass 3 and the summary sentence was
a transposition of one of them — corrected in pass 9, and recorded rather than quietly
fixed because a transposed digit in a measurement sentence is indistinguishable, to a
reader, from a fabricated one.

The arbiter hands each entry to `parseFile`, a path that was never fetched raises
`ENOENT`, and the
catch increments `parseFailures++` — the same counter a grammar failure increments. The
arbiter's `10/120` is 10 real files and 110 absent paths.

This lane's own census walks the **working tree**, which is why it read 821/821. Both
numbers are reproducible; only one of them is about the analyzer. The one-line repair
is in §Unresolved below, and it is a shared file.

Two consequences for how the arbiter's number should be read, stated because the table
in the handoff does not say either:

- **The 3/10 is a firing fact about 10 files, not about the language.** The three types
  it saw fire on 10 files — `uses`, `contains`, `imports` — are the three that fire on
  almost any `.proto` file. `exports` has a corpus count of **4** and `overrides` **1**,
  and no 10-file sample drawn from kubernetes, docker and boundary was ever going to
  contain either. The gate over the full corpus, with the ruling table wired, reads
  **emitted 5/10, ruled-sound 5, FALSIFIED 0** — the same 5 the supervisor's table would
  have shown had it parsed the files it drew.
- **The lane's degraded-parse risk is 0.** Every full-corpus run quoted in this
  document that carried a `degradedFallbacks` count is stated with it. The runs the
  headline numbers come from: **821 parsed / 0 failed / 0 degraded**.

## What reaches a declaration — the five classes, kept apart

`src/lsp/impact.ts` obtains reverse edges by scanning outgoing edges and matching
targets; no inbound edge is stored. So the reverse walk is exactly as good as the
target-matching, and **"resolves" and "resolves to exactly one declaration" are two
different questions.** Collapsing them is how a lane reports a flattering rate, so every
end below is placed in exactly one of five disjoint classes, counted over all 821 files'
published ids at once:

- **in-file** — the declaring file publishes it
- **cross-file-unique** — exactly one file in the corpus publishes it
- **cross-file-ambiguous** — **more than one** file publishes it; `bb_impact` picks a
  winner by a rule nobody chose
- **name-exists-unbound** — no file publishes the id, but some declaration in the corpus
  carries that name: a binding defect
- **hopeless** — no file publishes it and no declaration in the corpus carries the name:
  an external dependency or a path

| type | edges | in-file | cross-file-unique | **cross-file-AMBIGUOUS** | unbound | hopeless | binds both ends |
|---|---|---|---|---|---|---|---|
| `contains` | 40,098 | 79,884 | 9 | **303** | 0 | 0 | **99.24%** |
| `uses` | 13,275 | 22,945 | 2,088 | **1,461** | 52 | 4 | **88.57%** |
| `overrides` | 1 | 2 | 0 | 0 | 0 | 0 | 100% |
| `imports` | 1,561 | 0 | 0 | 0 | 3,122 | 0 | 0% — module paths by design |
| `exports` | 4 | 0 | 0 | 0 | 8 | 0 | 0% — module paths by design |

The `in-file` column counts **ends**, not edges: an edge contributes two, which is why
`contains` has 79,884 in-file ends on 40,098 edges. Declared once, at 821 parsed files /
0 degraded: **38,551 distinct published ids, of which 2,702 are published by more than
one file** — so the ambiguity is not a handful of targets, it is **7.0% of every id in
the language**. Of 38,551 declarations, **37,113 (96.27%)** are named by at least one
edge and 1,438 are named by none; a declaration nobody names is correct in a language
of independent schema files and is reported rather than treated as a defect.

**The ambiguity has one shape and it is protobuf's own.** `descriptor.proto` — which
declares `google.protobuf.FileOptions`, `FieldOptions`, `Timestamp`, `Struct` and the
rest — is **vendored into four repositories in this corpus**: `pb-reference`,
`kubernetes/third_party/protobuf`, `dart-sdk/.../protobuf_handler/protos` and
`kong/spec/fixtures/grpc`. `google.protobuf.FileOptions` is therefore published by **4
files** and `google.protobuf.Timestamp` by **3**, so every `extend google.protobuf.X`
block and every well-known-type reference is an ambiguous target. 1,764 edges
(1,461 `uses` + 303 `contains`) are in that state. Each is **one edge attributed to one
declaration**; counting it as four is how a name collision becomes a wrong refactor.

**What would close it, and why this lane cannot.** `protoc` disambiguates by include
root, which it is told on the command line and this analyzer never sees. The one
per-file signal that exists — *did this file import the declaring one?* — resolves it
for **1,956 of the 3,605** cross-file targets (54.2%) and provably cannot for the rest:
consul sets **two** include roots (`proto-private` and `proto-public`) and neither
agrees with the package it holds, which is why **1,593** cross-file targets are
correctly named and still not vouched. Closing the remaining 1,764 needs the
include-root map, which is a project-level fact. **Counted and stated here rather than
papered over.**

## The one defect pass 3 found, and the fix that survived its own falsification test

Pass 2's declared boundary was "reference resolution is per-file". Measuring the
incoming side turned that from a boundary into a **defect with a cause**.

`resolveRef` walked only the scopes **inside the package subtree**. That is complete
for in-file resolution — a file has one package, so it declares nothing above itself —
but protobuf's rule is **C++ name lookup**, which walks every enclosing scope, and the
package's own ancestors are enclosing scopes. So `resolveRef`'s dotted-name fallback,
"the name as written", produced ids that exist in no repository:

```proto
// boundary/internal/proto/controller/api/resources/accounts/v1/account.proto
package controller.api.resources.accounts.v1;
import "controller/api/resources/scopes/v1/scope.proto";   // ← the file that declares it
message Account {
  resources.scopes.v1.ScopeInfo scope = 20;   // protoc: controller.api.resources.scopes.v1.ScopeInfo
}
```

The emitted edge was `Account.scope -> resources.scopes.v1.ScopeInfo`. **431 `uses`
targets were in that state.** The fix walks the full chain — enclosing scopes, then the
package's ancestors, then the root — and accepts a candidate only when the directory
its package maps to is among the directories **this file** imports, because `protoc`
searches the imported descriptors and this file knows which descriptors it imported.

| `uses` target ends | before | after |
|---|---|---|
| in-file | 22,945 | 22,945 |
| cross-file-unique | 1,709 | **2,088** |
| cross-file-ambiguous | 1,461 | 1,461 |
| **names no file in the corpus** | **431** | **52** |
| hopeless | 4 | 4 |

**379 edges moved from naming an id that exists nowhere to binding exactly one file.**
Nothing else moved: 54,939 production edges, 41,955 symbols, 0 self-loops, 0 empty
names, 0 unknown kinds — all unchanged. `script/m14/protobuf-adversarial.mts` P3, a
pre-existing probe computed by a different code path, independently reports `uses`
corpus-wide resolution rising **96.72% → 99.58%**; `12,840 → 13,219` is **+379**, the
same number the new instrument measures.

**The fix was falsified once before it was accepted, and the falsifying test is in the
instrument rather than in this sentence.** The first version keyed its evidence on *one*
module path per directory. A directory holds several imported modules — boundary's
`account.proto` imports both `google/protobuf/struct.proto` and
`google/protobuf/timestamp.proto`, and `google.protobuf.Timestamp` is declared in the
second — so the recorded provenance named a file that does not declare the target at
**785 of 2,061** derived edges. The ids were right in all 785 and the *evidence* was
wrong, which is the same defect in a different place. Recording a **directory** fixed
that and left **7** wrong ids: docker vendors containerd, whose
`api/types/platform.proto` declares `package containerd.types;` and is imported as
`types/platform.proto`, so the directory `types` is imported while the declaration is
`containerd.types.Platform`. The shipped walk now **declines** whenever the matched
directory is a proper suffix of a more specific candidate's directory, which is exactly
what a `-I` root above the package looks like. Declining costs those 7 edges and buys
379 correct ones; the remaining 52 are consul's, where no per-file test can decide.

Both halves are pinned by `protobuf/ancestor-scope-resolution`, and each by a mutant
that fires on **exactly its own rows** — 26 mutants, 26 caught, 0 survived. Both
mutants were wrong as first written and are recorded rather than counted: they broke
the same two rows, so neither isolated its rule.

## Coverage, reported as applicable

**5 of 5 applicable types emitted, 5 of 5 ruled with a corpus measurement. Complete at
5/5 — not 5/10.** The denominator shrank by RULED verdicts, each carrying an
instrument, a probe and an overturn condition, and the numerator comes from the
arbiter's own firing measurement while the denominator comes from the lane's construct
probes. Numerator and denominator are therefore from different instruments, which is
the condition that makes the fraction mean something.

| type | verdict | count | where |
|---|---|---|---|
| `uses` | **EMITTED** | 13,275 | **675 files** — pass 9 corrected `609` here; e.g. `boundary/.../accounts/v1/account.proto` |
| `contains` | **EMITTED** | 40,098 | 7,166 of them package→top-level; e.g. `boundary/.../accounts/v1/account.proto` |
| `imports` | **EMITTED** | 1,561 | 557 files; 3 of them `weak` |
| `exports` | **EMITTED** | 4 | `pb-reference/src/google/protobuf/{cpp_options,json_options,unittest_import,unittest_import_lite}.proto` |
| `overrides` | **EMITTED** | **1** | `nvim-treesitter/tests/query/highlights/proto/test.proto`, in a file `protoc` rejects |
| `calls` | **RULED** | 0 | instrument **A**, 0 of 10 candidate node types among **94** observed |
| `extends` | **RULED** | 0 | instrument **A**, 0 of 8; the `extend` block occurs **214** times in **64** files and is read as `contains` with `viaExtension` |
| `implements` | **RULED** | 0 | instrument **A**, 0 of 6; **259** `service` nodes in **221** files counted so the surface is on the record |
| `references` | **RULED** | 0 | instrument **A**, 0 of 7; the construct occurs (**10,166** `message_or_enum_type` nodes) and is emitted, as `uses` |
| `instantiates` | **RULED** | 0 | instrument **B**: **1,909** `block_lit` nodes, by-parent histogram `{constant: 1909}` — one key, so **0** constructions |

**The gate over the full corpus, ruling table wired: `emitted 5/10  ruled-sound 5
FALSIFIED 0  ruled-without-justification 0`, exit 0.** Reproduce with
`npx tsx script/m14/protobuf-ruling-table-proof.mts`.

## Pass 3 gates

| Command | Result |
|---|---|
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, 0 degraded** — and part 1 above is the diagnosis |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / 0 failed / 0 degraded; part 1: 110 of 120 sampled paths absent from disk; part 2: the five classes above |
| `npx tsx script/m14/protobuf-census.ts` | **821/821 parsed**, 41,956 symbols analyzer-direct / 41,955 through `parseFile`, 54,939 edges, **0** empty names, **0** unknown kinds, **0** `unknown` endpoints, **0** self-loops, **0** duplicate published ids |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail** |
| `npx tsx script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **26 caught / 0 survived** |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; 628,758 nodes read, **0** lacking `.id`; `uses` corpus-wide **99.58%**; heuristic ratio **0** |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types, 117 declared; **13 ERROR + 2 MISSING in 1 file**; every ruling re-probed at the current corpus and still reading 0 |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0. run **b** (ruling table wired, `LANGS` untouched, so both instruments read the **bash** grammar): **FALSIFIED 2** — `calls` reads `function_definition`, `instantiates` reports `WRONG GRAMMAR: this probe was handed a tree whose root node is \`program\`, not \`source_file\`` |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 2 — "no RULING TABLE for protobuf"**. The arbiter refuses to rule for a lane with no table; nothing about the lane is wrong | <br>**SUPERSEDED, pass 9:** it rules now, exit **1**, `FALSIFIED 2` — both from the missing `LANGS` entry. See PASS 9 |
| `npx tsc --noEmit` | no diagnostics |
| fixture sources parse | 8 of 8 at **0 ERROR / 0 MISSING** |

## A file this lane could not review, and why that mattered

`src/ast/real-protobuf-analyzer.ts` contained a **raw U+0000 byte** inside a template
literal — the `<owner>\0<fieldNumber>` slot key. The runtime string is unchanged by
writing it as an escape, but the raw byte made `file` report the analyzer as `data`,
`grep` report `binary file matches` for every query against it, and `git diff` print
`Binary files differ` instead of a hunk. **The lane's analyzer was therefore
undiffable and ungreppable**, which is the state in which a whole file of relationship
emissions is invisible to the source-derivation pass that the correction in this
workstream exists to distrust. Escaped; `tsc` clean.

## Declared limitations, pass 3

- **No independent oracle. Unchanged and still the largest.** No protobuf entry in
  `differential.ts`'s `LANGS`, no protobuf oracle in `script/m14/oracles/`. **5
  DERIVATION findings**, one per emitted type, all 54,939 edges unaudited by a second
  implementation. Every correctness claim here rests on hand-derived expectations, 26
  mutants, the specification, and the probes in this document.
- **1,764 edges carry an ambiguous endpoint** and `bb_impact` will attribute each to one
  of several real declarations. One shape: `descriptor.proto` is vendored into four
  repositories, so the well-known types have 2–4 publishers each. Closing it needs the
  include-root map, which is a project-level fact this lane is not given.
- **1,593 cross-file targets are correct but not vouched**, because consul's two include
  roots agree with neither the package they hold nor any ancestor of it. The
  vouching test is a *sufficient* condition, not a necessary one, and is reported as
  such rather than folded into a resolution rate.
- **52 `uses` targets still name an id no file publishes**, for the same
  shifted-include-root reason; 56 ends are in files `protoc` rejects.
- **`imports` and `exports` endpoints are module paths**, 0% by symbol resolution by
  design and family convention. A consumer resolves them against include roots.
- **`overrides` has a corpus count of 1, in a file `protoc` rejects.** Stated beside the
  verdict everywhere it appears.
- **Runs under concurrency intermittently report `[BB-HANG]`** on
  `pb-googleapis/google/api/expr/v1beta1/expr.proto` and report a degraded file rather
  than failing. Not reproducible in isolation and not this analyzer's — it is why runs
  differ by up to 22 `uses` edges while the analyzer-direct counts are identical. Every
  headline number above is from a run reporting **0 degraded**.
- **Grammar-version drift.** This lane's grammar is vendored, patched and pinned with 8
  load-bearing patches; the analyzer reads node names a future upstream release could
  rename. `script/m14/protobuf-construct-probes.mts` re-derives the vocabulary from the
  wasm's own node-type table on every run.

---

# PASS 4 — the whole battery re-run at the current HEAD, and the lane's last regexes

Pass 3 established the verdicts. Pass 4 changed no verdict: it re-ran every instrument
this lane owns against the same corpus, recorded the numbers a second time from a
separate process, and removed the two remaining regular expressions from this lane's own
instruments. Where a number moved, the movement is stated rather than reconciled.

## Every number reproduced, and the two that moved

| instrument | pass 3 | pass 4 | moved |
|---|---|---|---|
| `protobuf-census.ts` files ok / fail | 821 / 0 | **821 / 0** | no |
| symbols through `parseFile` | 41,955 | **41,955** | no |
| edges through `parseFile` | 54,939 | **54,939** | no |
| `uses` / `contains` / `imports` / `exports` / `overrides` | 13,275 / 40,098 / 1,561 / 4 / 1 | **13,275 / 40,098 / 1,561 / 4 / 1** | no |
| symbols with empty name | 0 | **0** | no |
| unknown `SymbolKind` | 0 | **0** | no |
| endpoints equal to `unknown` | 0 | **0** | no |
| self-loops | 0 | **0** | no |
| edges with confidence < 0.7 | 0 | **0** | no |
| `uses` corpus-wide, both ends | 99.58% | **99.58%** | no |
| `contains` corpus-wide, both ends | 100% | **100%** | no |
| distinct node types observed | 94 | **94** | no |
| rulings reading 0 after re-probe | 5 | **5** | no |
| mutants caught / survived | 26 / 0 | **26 / 0** | no |
| fixtures pass / fail | 8 / 0 | **8 / 0** | no |
| incoming audit: declarations | 38,551 | **38,551** | no |
| incoming audit: ambiguous endpoints | 1,764 | **1,763** | −1 |
| incoming audit: `uses` edges seen | 13,275 | **13,267** | −8 |
| incoming audit: files degraded | 0 | **2** | +2 |

The three movements share one cause and it is the one already declared: this run drew
**2 degraded files** where the pass-3 run drew 0 —
`pb-googleapis/google/api/expr/v1beta1/{eval,source}.proto`, which the parser reports as
`memory access out of bounds` and which `[BB-HANG]` reports as stuck at 120 s. Losing
those two files costs 8 `uses` edges and promotes exactly one previously-unambiguous
target to ambiguous. The `contains` count is unaffected.

The audit's **process exit is 1** on this run and 0 on the pass-3 run, for the same
reason: the hang is raised after the audit has already written its JSON. The audit's
findings are unaffected; its exit status is not, and it is quoted here as measured.

`script/m14/protobuf-ruling-table-proof.mts` run (b) reported `contains 40,089` against
run (c)'s `40,098` in the same invocation — a 9-edge spread between two runs of the same
corpus minutes apart, which is the same degraded-file effect seen from the other side.
Runs (b) and (c) differ only in which grammar the two instruments are handed.

## The lane's last two regular expressions

The analyzer was already regex-free. Two of this lane's **own instruments** were not:

- `protobuf-adversarial.mts:375` — `/^(uses|contains|imports|exports)$/.test(ty)`
- `protobuf-ruling-table-proof.mts:118` — `/^\[INFO]/` and `/BB-PARSE-ERR|BB-HANG/`

Neither matched `.proto` source: the first tested a relationship-type name against a
closed four-value set, the second filtered the harness's own log lines. So neither could
mis-read a declaration, and neither is the failure mode the ban describes. They are
removed anyway, because the ban covers census scripts and oracles, and a pattern over
text is a surface that breaks silently on the next change to the text it reads.

Replaced with a `Set` membership test and with `startsWith` / `includes`.

```
npx tsx script/m12/verify-regex-census.ts | grep -c protobuf     ->  0 rows
```

The census gate itself still exits 1, on **10 other lanes**: `vue` 12, `css` 7,
`typescript` 6, `fsharp` 6, `svelte` 4, `clean` 2, `scss` 2, `javascript` 2, `python` 1,
`sql` 1, `xml` 1. None of those files is this lane's to edit.

## Pass 4 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail**, no baseline regressions |
| `npx tsx script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **26 caught / 0 survived** |
| `npx tsx script/m14/protobuf-census.ts` | **821 ok / 0 fail**; 54,939 edges; 0 empty names; 0 bad kinds; 0 `unknown` endpoints; 0 self-loops |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types; all 5 rulings re-probed and still reading **0**; 13 ERROR + 2 MISSING in 1 file |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; 628,758 nodes, **0** without `.id`; `uses` corpus-wide **99.58%**; edges under 0.7: **0** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0. run **b**: **FALSIFIED 2** — both instruments handed the bash grammar. run **a**: exit 2, no RULING TABLE <br>**pass 9 re-measure:** run (a) is now `emitted 5/10 ruled-sound 3 FALSIFIED 2`, **exit 1** — the ruling table is wired, so (a) and (b) now agree and only (c) passes. See PASS 9 |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | part 1: 120 sampled, **10 present / 110 absent**. part 2: **1,763** ambiguous, 52 unbound, 4 hopeless; exit 1 on the 2 degraded files |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, 0 degraded** — fired types `uses`, `contains`, `imports` |
| `npx tsx script/m12/verify-regex-census.ts` | exits 1; **0 protobuf rows** |
| `npx tsx script/m14/verify-honesty.ts` | exits 6 on **22 failures, 0 naming a protobuf path** |

## Two items in files this lane does not own, restated so they can be applied

Both are one-line additions, and the second is not cosmetic: without it both of the
arbiter's instruments are handed the **bash** grammar, which is what run (b) above
demonstrates — `calls` comes back FALSIFIED because `function_definition` is a real bash
node type, and `instantiates` refuses to report 0 from a language whose construct cannot
occur.

1. `script/m14/ontology-coverage-gate.ts`
   - add `import { PROTOBUF_RULED } from "./protobuf-ruled"` beside the `LANGS` import
   - add `protobuf: PROTOBUF_RULED` to the `RULED_BY_LANG` literal at line 195
   - why: the gate exits 2 today, so this lane's 5 rulings have never been checked by the
     arbiter. `script/m14/protobuf-ruled.ts` is written and shaped correctly.

2. `script/m14/differential.ts` — add to `LANGS`:
   `protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },`
   - why: the gate selects its wasm with `(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`,
     so with no entry every protobuf instrument reads bash's grammar. All four fields are
     already carried at `script/m14/run-fixtures.ts:91`, so this copies an existing value.

Both are proven by `script/m14/protobuf-ruling-table-proof.mts`, which splices them into
derived copies of the two shared files, runs the real gate three ways, and deletes the
copies — refusing to splice if any anchor has moved.

## Still not settled

- **No oracle, so 5 DERIVATION findings stand.** > **PASS 8 PAID ONE OF THE FIVE DOWN.**
  > `uses` is now adjudicated by `protoc` 36.2 — 11,250 edges judged, 99.627% agreement,
  > 42 named disagreements — so **4** remain: `contains`, `imports`, `exports`,
  > `overrides`. The first three are readable from the `FileDescriptorProto` the oracle
  > already parses and are simply not written yet; `overrides` has no `protoc` analogue
  > because protobuf has no slots. What still stands is that there is no `protobuf`
  > entry in `differential.ts`'s `LANGS` and no `script/m14/oracles/protobuf-*.ts` — the
  > oracles directory holds 19 files for 8 languages and none for this one, so the
  > shared gate still audits nothing here. Every correctness claim in this document rests on
  > hand-derived expectations, **28** mutants (pass 4 wrote 26; the battery has grown since),
  > the protobuf specification, and the probes here.
  > An oracle would live in `script/m14/oracles/`, which is shared machinery.
  > **PASS 9: the first half of that is now stale too.** The supervisor wired
  > `protobuf-ruled.ts` into `ontology-coverage-gate.ts`, so the arbiter **does** now rule
  > for this lane — it exits **1** with `ruled-sound 3 FALSIFIED 2` rather than exiting 2
  > with `no RULING TABLE`. Both FALSIFIED rows are the missing `LANGS` entry, so what
  > still stands is **one** shared line, not two.
- **1,763 ambiguous endpoints** and **52 targets no file publishes**, from
  `descriptor.proto` being vendored into 4 repositories and from consul's two include
  roots. Closing either needs the include-root map, a project-level fact.
- **1,525 custom-option sites** name an extension by its **declaring** package while this
  analyzer publishes an extension member under the **extended** type, so those names can
  never coincide. Not emitted, with the measurement in the section above.

---

# PASS 5 — the store half: 0 of 3,075 edges bound to the declaration they named

Passes 1–4 measured this lane from the analyzer outward: `parseFile` output, the
analyzer's own id set, a node-type census, a mutant battery. Every one of those
questions is answered before the pipeline projects a symbol or the store binds an
edge. Pass 5 asks the last question, and it is the one `bb_impact`, `bb_graph` and
`bb_analyze callers/callees` actually answer: **when the graph stores an edge and
then walks back along it, does it arrive at the declaration the edge named?**

The answer was no, for every edge, and the cause was one missing assignment.

## What was measured, and how

`script/m14/tmp/protobuf/probe/store-binding.mts` — new in this pass — indexes 40 real
reference `.proto` files through `indexProjectParallel` into a scratch database and reads
`brain_symbol` and `brain_relationship` back. Nothing is simulated: the numbers are a
real indexer, a real store and a real `resolveRelationships` pass over real corpus files.
The probe deletes the database and the corpus is read-only to it.

**Three columns, because "bound" is not the question either.**

| column | meaning |
|---|---|
| `BOUND` | `target_symbol_id IS NOT NULL` — a reverse walk can follow the row |
| `BOUND==exact` | the bound symbol's `qualified_name` **equals** the edge's `target_external`. The only form of "bound to the right declaration" the store can prove |
| store-generated | rows `src/ast/parallel-indexer.ts:3137` synthesises per `(owner, owned)` symbol pair from `ownerName`, with the target bound by construction and `target_external` set to the bare name. **Not this lane's edges.** They are counted separately and excluded from every rate below |

The store-generated rows are separated by reading `metadata.evidenceClass` off the row,
which every analyzer edge this lane emits carries and no synthesised row does. They are
**2,557** on this corpus and **2,557** of them bound. Averaging them in would have made
this lane's `contains` figure read as a defect that belongs to the store.

| | before | after |
|---|---|---|
| `brain_symbol.qualified_name == name` | **2,603 of 2,603** | **40 of 2,603** |
| `contains` — edges / bound / exact | 2,565 / 2,551 / **0** | 2,565 / 2,563 / **2,563** |
| `uses` — edges / bound / exact | 489 / 449–451 / **0** | 489 / 452–470 / **414** |
| `imports` — bound | 0 of 19 | 0 of 19 |
| `exports` — bound | 0 of 2 | 0 of 2 |
| **all analyzer edges — provably named** | 3,075 / **0 (0.00%)** | 3,075 / **2,977 (96.81%)** |

Two runs of each arm. `exact` did not move between runs of the same arm: **2,563** and
**414** both times. `BOUND` for `uses` did: **446–470**. So the edges the fix made exact
are deterministic, and the edges it did not reach are not — which is the finding, not a
detail of the harness.

## The cause, and why BOUND was the wrong number to trust

Every endpoint this analyzer emits is dotted and package-qualified:
`google.protobuf.Mixin.root`. `pool-worker`'s symbol projection left `qualifiedName`
equal to the bare name (`root`), so all three of `resolveRelationships`' name strategies
miss:

1. strategy 1 compares `target_external` to `brain_symbol.qualified_name` — `root` ≠
   `google.protobuf.Mixin.root`;
2. strategy 2 compares the whole `target_external` to a bare `name` — a dotted string is
   never a bare name;
3. strategy 3 matches `SUBSTR(target_external, INSTR(target_external, '.') + 1)` — the
   text after the **first** dot, which for a protobuf target is `protobuf.Mixin.root`, a
   name the language cannot declare.

What bound instead is the insert-time leaf-name fallback at
`src/ast/parallel-indexer.ts:3494-3498`, **first-wins**. So the edge bound, and bound to
whichever same-named declaration happened to be stored first. Measured on the pre-fix
arm: `uses` edges bound to a symbol in **another file** numbered **2 to 26 across two
identical runs**, and the number of targets whose leaf name more than one file declares
is **89** on this corpus. `bb_impact` reading such a row cannot tell a correct binding
from a wrong one — the row says a declaration id, and the id is a real declaration that
never mentioned this edge. That is the shape the workstream calls a name collision
becoming a wrong refactor, and here it was not a rare shape: it was **every edge in the
language**.

## The fix

One assignment per symbol, in `addSymbol`: `s.qualifiedName = real`, where `real` is the
id the analyzer already resolved and already used for every relationship endpoint. It
carries the `#property` suffix too, which is the disambiguator a proto2 group's two
same-named declarations need — `#` cannot occur in a protobuf identifier.

The same value is also published as `metadata.qualifiedName`. That copy exists because
`run-fixtures.ts`'s `CONSTRAINT_KEY_ALLOWLIST` carries no `qualifiedName` key, so a
fixture cannot assert the channel that decides whether an edge binds, and an assertion
nobody can write is an assertion no regression can be caught by. Both values are pinned,
by four rows in `protobuf/absolute-and-scope-resolution`.

## What the fix moved outside the store, measured on the whole corpus

The corpus-wide instruments re-ran at 821 files, 0 degraded. **No edge count moved** —
13,275 / 40,098 / 1,561 / 4 / 1, 54,939 through `parseFile`. What moved is how many of
them resolve against the ids a consumer actually receives:

| | before | after |
|---|---|---|
| `uses` both-ends, production ids | 72.71% | **72.84%** — equal to the analyzer-id figure |
| `contains` both-ends, production ids | 99.15% | **99.22%** — equal to the analyzer-id figure |
| `overrides` both-ends, production ids | **0%** | **100%** |

The `overrides` row closes a limitation passes 2 and 3 declared twice: "at **0%** against
ids a consumer re-derives as `ownerName + "." + name`, because the later declaration's id
carries `uniqueId`'s `#property` suffix. That is the same projection limit the proto2
`group` has always had". The limit was the missing `qualifiedName`, not the `#property`
suffix, and both ends of that one edge now resolve through the production path. The 30
re-derived id collisions the earlier passes measured are unaffected — they were real,
and they are still real for a consumer that re-derives instead of reading the published id.

## What it did NOT fix, and the numbers that say so

- **1,764 edges still carry an ambiguous endpoint** (1,461 `uses` + 303 `contains`),
  unchanged. `descriptor.proto` is vendored into four repositories of this corpus, so
  `google.protobuf.Timestamp` has 3 publishers and `google.protobuf.FileOptions` has 4.
  A published qualified id does not make two identical ids distinguishable — the two
  declarations really do share a name, and `protoc` separates them by include root, which
  this analyzer is never told. Measured on a 0-degraded run: **38,551** distinct
  published ids, **2,702** published by more than one file.
- **52 `uses` targets name an id no file in the corpus publishes**, and **4** are
  hopeless — no declaration in the corpus carries the name. Both unchanged.
- **1,593 cross-file targets are correct but not vouched**, consul's two include roots
  agreeing with neither the package they hold nor any ancestor of it. Unchanged.
- **`imports` and `exports` remain 0% by symbol resolution.** Module-path endpoints by
  design and family convention; unchanged and reported rather than omitted.
- **75 `uses` edges of 489 still do not resolve exactly** on the 40-file store probe.
  They are the ones whose target is not declared in that 40-file slice, plus 41 whose
  target no file in the slice publishes. **26 of them are cross-file** and those bind by
  the same nondeterministic leaf fallback.

## A blocker in a file this lane does not own, and how the probe got past it

`storeResults` **cannot store anything, for any language, at HEAD**. Its `insertSymbol`
prepared statement carries two `VALUES` clauses — 31 placeholders then 30 — and SQLite
rejects the statement:

```
SqliteError: near "VALUES": syntax error
    at storeResults (src/ast/parallel-indexer.ts:2153)
```

Measured by calling `storeResults` directly with a two-file batch: **typescript, python
and java all throw the same error**, so it is not this lane's and not this language's.
`git log -L` puts it at merge `687999ba` ("reconcile the local line with the consolidated
origin/main", 2026-10-02), which is an ancestor of every analyzer branch. The comment
immediately above the statement says VALUES "must carry 31 placeholders"; there are two
VALUES lines, the second carrying 30. The consequence is that `bb index` currently stores
no symbols and no relationships for **any** language, which is why the store-level
question above was unanswerable when this pass started.

`src/ast/parallel-indexer.ts` is shared machinery, so the probe **derives** a copy with
that one line removed, indexes through the derived copy, and deletes the copy — the same
technique `script/m14/protobuf-ruling-table-proof.mts` uses for the arbiter. The splice
**refuses to run if its anchor is not found exactly once**, so a silently-unrepaired copy
reports as a loud failure instead of as a measurement. `--no-derive` runs against the
shared file as shipped, which fails.

## Pass 5 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail**, no baseline regressions |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **27 caught / 0 survived** (26 before this pass) |
| `npx tsx script/m14/tmp/protobuf/probe/store-binding.mts --files 40` | before 0/3,075 provably named → **after 2,977/3,075 (96.81%)**; refuses to splice if the shared anchor moved |
| `npx tsx script/m14/protobuf-census.ts` | **821 ok / 0 fail**; 54,939 edges; 0 empty names; 0 bad kinds; 0 `unknown` endpoints; 0 self-loops; **0** edges under 0.7 |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; 628,758 nodes, **0** without `.id`; `uses` corpus-wide **99.58%**; heuristic ratio **0** |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types; all 5 rulings re-probed and still reading **0** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0. run **b**: **FALSIFIED 2**. run **a**: exit 2, no RULING TABLE <br>**pass 9 re-measure:** run (a) is now `emitted 5/10 ruled-sound 3 FALSIFIED 2`, **exit 1** — the ruling table is wired, so (a) and (b) now agree and only (c) passes. See PASS 9 |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / **0 failed / 0 degraded**; 1,764 ambiguous, 52 unbound, 4 hopeless; 38,551 declarations, 37,113 (96.27%) with an inbound edge |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, 0 degraded** — unchanged, and pass 3's part 1 is its diagnosis |
| `npx tsx script/m14/incoming-check.ts protobuf <40 files>` | `contains` unresolved **2,879 → 0**, distinct 0 → 2,876. `uses` unresolved **635 → 55**, distinct 0 → 243 |
| `npx tsx script/m12/verify-regex-census.ts` | exits 1; **0 protobuf rows** |
| `npx tsx script/m14/verify-honesty.ts` | exits 6 on **22 failures, 0 naming a protobuf path** |
| `bun run script/m14/verify-doc-truth-emissions.ts --no-write` | **FALSE_NEGATIVE=7 FALSE_POSITIVE=0**, none in this lane's rows |

## Coverage, restated after pass 5 — unchanged, and said again with its sources

**5 of 5 applicable types emitted; 5 of 5 ruled with a corpus measurement. 5/5.** No
verdict moved in this pass and no type was added: `calls`, `extends`, `implements`,
`references` and `instantiates` are still RULED with the same instruments and the same
counts, and the emitted five are still 13,275 / 40,098 / 1,561 / 4 / 1. The numerator is
the arbiter's own firing measurement over the full corpus and the denominator is the
lane's construct probes, so they come from different instruments.

What pass 5 changed is not the count and not the verdict. It is that **96.81%** of the
edges behind those counts are now attached to the declaration they name, against **0%**
before, and the ones that are not are counted, classified and named rather than rounded
into a rate.

## Four items in files this lane does not own, restated so they can be applied

1. **`src/ast/parallel-indexer.ts:2163-2165`** — delete the second `VALUES (...)` clause
   in the `insertSymbol` prepared statement (the 30-placeholder line). *Why:* with both
   present every `storeResults` call throws `near "VALUES": syntax error` and no language
   stores anything. Measured for typescript, python and java; introduced by merge
   `687999ba`. **This is the highest-severity item in this report** — it is not a
   protobuf finding and it blocks every lane's store-level measurement.
2. **`script/m14/run-fixtures.ts`** — add `"qualifiedName"` to `CONSTRAINT_KEY_ALLOWLIST`
   (the symbol-rows block, beside `"qualified_calls"`). *Why:* the runner's inert-assertion
   guard correctly refused `qualifiedName` as an unknown constraint key, which left the
   field that decides whether an edge binds in the store unassertable by any fixture. The
   lane worked around it with `meta.qualifiedName`, which is the runner's own documented
   route, so the workaround is not load-bearing — but the allowlist omission is real.
3. **`script/m14/incoming-check.ts`** — `orphans` is computed as
   `declaredNames.filter(n => !named.has(n))`, where `declaredNames` holds `s.name` (bare)
   and `named` is keyed by `rel.target` (qualified). *Why:* after item 4 below the two key
   spaces stop coinciding, so the tool now reports "3,918 of 3,918 orphans" in the same
   run where it reports 2,876 distinct declarations named by an edge. Before this pass
   both sides were effectively bare names and the line was merely uninformative; now it
   is self-contradictory. Either index `declaredNames` by `qualifiedName` or count orphans
   against the same key space `named` uses.
4. **`script/m14/ontology-coverage-gate.ts` and `script/m14/differential.ts`** — the two
   one-line wirings from pass 2, still unwired. Without them the gate exits 2 and hands
   both instruments the **bash** grammar, which run (b) above demonstrates: `calls` reads
   FALSIFIED because `function_definition` is a real bash node type, and `instantiates`
   refuses to report 0 from a language whose construct cannot occur.

## Declared limitations, pass 5

- **No independent oracle. Unchanged, and still the largest.** No `protobuf` entry in
  `differential.ts`'s `LANGS`; no `script/m14/oracles/protobuf-*.ts`. **5 DERIVATION
  findings**, one per emitted type. Every correctness claim here rests on hand-derived
  expectations, 27 mutants, the protobuf specification, and the probes in this document.
- **The store-level measurement is 40 files, not 821.** The probe stages a scratch project
  because a full-corpus index does not fit the probe's budget; 40 reference files is the
  densest cross-file reference set available and it is where the well-known types are
  declared once and named from everywhere else. The 821-file figures in this document are
  from the analyzer-side instruments, which do not need a store.
- **2,557 of the 5,632 stored rows on that probe are the store's own synthesised
  containment, not this lane's**, and they are excluded from every rate above. A reader
  comparing the row totals against the analyzer's own count should expect the difference.
- **75 `uses` edges of 489 still bind by the nondeterministic leaf fallback**, and 26 of
  them land in another file. Publishing the id fixed the 414 whose target the store can
  match exactly; it cannot fix a target the store cannot see.
- **`imports` and `exports` endpoints are module paths**, 0% by symbol resolution by
  design and family convention. A consumer resolves them against include roots.
- **`overrides` has a corpus count of 1, in a file `protoc` rejects.** Stated beside the
  verdict everywhere it appears. Both its ends now resolve through production.
- **Runs under concurrency intermittently report `[BB-HANG]`** on
  `pb-googleapis/google/api/expr/v1beta1/expr.proto`. Every headline number in this
  document is from a run reporting **0 degraded**.
- **Grammar-version drift.** The grammar is vendored, patched and pinned with 8
  load-bearing patches; the analyzer reads node names a future upstream release could
  rename.

---

# PASS 6 — the last 56, priced: one missing map is worth 38 of them, and the local fix costs 75

Passes 1–5 verified this lane's outgoing edges, its incoming edges, and what the store
binds. One number was left standing without a measurement behind it. Passes 3 and 5 both
report that **52** `uses` targets name an id no corpus file publishes and **4** name
nothing at all, and both explain it as "closing either needs the include-root map, a
project-level fact". That is true. It is also not a measurement: it does not say how many
of the 56 one map would close, so a reader cannot tell whether the shortfall is one edge
or five hundred.

Pass 6 measures it, and then measures the one fix that is available inside this lane.

## The 56, in four disjoint classes that sum to 56

`script/m14/protobuf-package-map-probe.mts` — new in this pass. 821 files in 18
repositories, production `parseFile`, **13,275** `uses` edges, **13,219** bind somewhere,
**56** bind nowhere. For each of the 56 it asks the question a project-level pass could
answer, using only facts such a pass would have: is a candidate on the specification's own
scope chain a published id, and does the file that publishes it appear in this file's
imports?

| class | edges | share | what it needs |
|---|---|---|---|
| `CLOSABLE-BY-PACKAGE-MAP` | **38** | 67.86% | a map from import path to declared package |
| `CLOSABLE-BY-ANCESTOR-SCOPE` | **4** | 7.14% | closable by the instrument the analyzer already has — see below, and see why it is not taken |
| `NOT-CLOSABLE-BY-PACKAGE-MAP` | **4** | 7.14% | a strictly stronger fact: a vendor-rewrite map |
| `NOT-CLOSABLE` | **14** | 25.00% | nothing. External or fixture-only |
| | **56** | | |

By repository: consul 31, docker 10, pb-reference 6, pb-grpc 4, kubernetes 2,
nvim-treesitter 2, vault 1.

## The mechanism, and it is about directory layout, not about protobuf

`resolveViaImports` answers *"is `S.A.B.C` declared in a file this one imports?"* by
testing whether the **candidate package's dotted path equals an imported module's
directory**:

```
consul/proto/private/pbconfigentry/config_entry.proto
  line 12   import "private/pbcommon/common.proto"   ->  importDirs = { "private/pbcommon" }
  line 40   common.EnterpriseMeta EnterpriseMeta = 2;
  candidate package hashicorp.consul.internal.common
                                        ->  dir = "hashicorp/consul/internal/common"
```

Those two strings are unrelated. consul's private protos put package
`hashicorp.consul.internal.common` in a directory called `pbcommon`, so the test can never
fire and the reference is emitted exactly as written — `common.EnterpriseMeta`, a name no
file publishes. The declaration is 40 lines away in the file consul imports:

```
consul/proto/private/pbcommon/common.proto:171   message EnterpriseMeta {
```

`protoc` resolves the same reference correctly because it builds a descriptor pool from
the `-I` include roots and never looks at a directory name. In the repositories whose
layout *does* mirror the package — docker's `api/types/`, kubernetes, boundary,
pb-googleapis — the analyzer's test is right and it works. That is why **31 of the 38 are
consul, 6 docker, 1 kubernetes**, and why this reads as a layout property rather than a
resolution defect.

## The local fix, priced instead of proposed

There is a real defect here, and it is worth naming before pricing it. `qualify(pkg,
text)` prefixes the package to an **unqualified** reference unconditionally, while
protobuf's rule is C++ name lookup and falls through to the enclosing scopes.
`pb-reference/src/google/protobuf/compiler/plugin.proto:71` writes

```
repeated FileDescriptorProto proto_file = 15;      // in package google.protobuf.compiler
```

`protoc` resolves that to `google.protobuf.FileDescriptorProto`, declared in
`descriptor.proto`. The analyzer emits `google.protobuf.compiler.FileDescriptorProto`,
which **no file declares**. So the analyzer does name a declaration that does not exist,
and the correction is to run the ancestor walk with the directory test already in the
analyzer.

Priced over **all 10,289** unqualified cross-file `uses` targets, because in the analyzer
the walk cannot know whether `pkg.text` exists and would therefore run over the working
edges too:

| outcome | edges |
|---|---|
| walk finds no supported candidate — the emitted name stands | **9,670** |
| walk reproduces the emitted name (no-op) | **540** |
| walk moves the name to a **published** id; the edge bound nothing | **4** ← the gain |
| walk moves the name to a **non-binding** name; the edge **binds today** | **75** ← the loss |

Reconciles to 10,289. **The walk trades 4 gained for 75 destroyed, and is not
implemented.**

The 75 are one shape. `pb-googleapis/google/api/apikeys/v2/resources.proto` declares
`package google.api.apikeys.v2` and a field of unqualified type `AndroidApplication`, so
the emitted target `google.api.apikeys.v2.AndroidApplication` **binds today**. The walk
tests `google/api/apikeys/v2` — not in the import list, because a file does not import its
own package directory — then `google/api`, which **is** in the import list
(`google/api/annotations.proto`), and lands on `google.api.AndroidApplication`, which has
**0** publishers.

The guard that prevents exactly this exists in `resolveViaImports` and did not fire,
because its shape is the other way round. It declines when a *more specific* candidate's
directory **ends with** the matched one (`types` vs `api/types`) — the docker/containerd
case measured at 7 wrong edges before the guard existed. Here the matched directory is the
**shorter** one (`google/api`), so `endsWith` is the wrong test and the guard is silent.
Correcting it means changing a guard that another lane's measurements rest on, to recover
**4** edges while risking the 10,278 that bind. Not a trade worth making inside this lane,
and the number is the reason rather than the argument.

## What is left, with a number on each item

| # | item | edges | owner |
|---|---|---|---|
| 1 | **a map from import path to declared package**, per project | **38** | shared — a project-level fact no per-file analyzer is told |
| 2 | a **vendor-rewrite map** on top of item 1 | **4** | shared. `import "github.com/docker/swarmkit/api/specs.proto"` against a file vendored at `github.com/moby/swarmkit/v2/api/specs.proto` |
| 3 | ~~a corrected ancestor-walk decline guard~~ | 4 gained / 75 at risk | **CLOSED BY PASS 7 — item 3 IS ITEM 1.** The walk was implemented and measured: net **−82** (4 gained, 86 lost). See the pass-7 section |
| 4 | the **14** | 0 | not closeable. See below |

The 14, named rather than counted:

- **10** are the ancestor-fall-through shape where the *emitted* name is already
  `pkg.name` and the real declaration sits at an ancestor scope, in repositories whose
  include root also does not mirror the package — `pb-grpc`'s root is `src/proto/`, so
  `echo_duplicate.proto` imports `src/proto/grpc/testing/echo_messages.proto` (directory
  `src/proto/grpc/testing`) while the candidate `grpc.testing.EchoRequest` has directory
  `grpc/testing`. Item 1 closes these too; the local instrument cannot see them.
- **2** are envoy types absent from this corpus: `xds.data.orca.v3.OrcaLoadReport` in
  `pb-grpc/src/proto/grpc/testing/echo_messages.proto:56` and `.../xds/v3/orca_service.proto`.
- **2** are a grammar test fixture that references types it never declares —
  `nvim-treesitter/tests/query/highlights/proto/test.proto:40` writes
  `required CustomType Value = 2;` in `package sls.asfd.asfd` and declares neither
  `CustomType` nor `JsonFormat`.
- **1** is a non-compiling fixture: `vault/vault/seal/multi_wrap_value.proto:18` writes
  `repeated github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo slots = 2;` — a Go
  import path in a type position. `protoc` rejects the file. The analyzer reads the edge
  because the grammar accepts it, which is a parse fact, and the target is genuinely
  unresolvable, which is also a fact.

## Pass 6 gate table

Every gate re-run at this pass's HEAD. Nothing moved.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail**, no baseline regressions |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **27 caught / 0 survived** |
| `npx tsx script/m14/protobuf-census.ts` | **821 ok / 0 fail**; 13,275 / 40,098 / 1,561 / 4 / 1; 54,939 through `parseFile`; 0 empty names; 0 bad kinds; 0 `unknown` endpoints; 0 self-loops; **0** edges under 0.7 |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** node types; all 5 rulings re-probed and still reading **0** |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; 628,758 nodes, **0** without a published id; `uses` corpus-wide **99.58%**; heuristic ratio **0** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0. run **b**: **FALSIFIED 2** |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / **0 failed / 0 degraded**; 1,764 ambiguous, 52 unbound, 4 hopeless; 38,551 declarations, 37,113 (96.27%) with an inbound edge |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, 0 degraded** |
| `npx tsx script/m14/incoming-check.ts protobuf <40 files>` | `contains` unresolved **2,879 → 0**; `uses` unresolved **635 → 55** |
| `npx tsx script/m14/tmp/protobuf/probe/store-binding.mts --files 40` | **2,977 of 3,075 provably named (96.81%)**; 40 of 2,603 symbols carry a qualified id |
| `npx tsx script/m14/protobuf-package-map-probe.mts` | **56** = 38 + 4 + 4 + 14; the walk prices at **4 gained / 75 destroyed**, reconciling to 10,289 |
| `npx tsx script/m12/verify-regex-census.ts` | **0** rows naming this lane |
| `npx tsx script/m14/verify-honesty.ts` | exits 6 on **22 failures, 0 naming a protobuf path** |
| `bun run script/m14/verify-doc-truth-emissions.ts --no-write` | `FALSE_NEGATIVE=7 FALSE_POSITIVE=0`, none in this lane's rows |

## One number that moved, and it is not this lane's

The pass-2 table records symbols through `parseFile` as **41,938**. Passes 3, 4 and 5
record **41,955**, and this pass re-measured **41,955**. The **+17** is commit
`198151c9b` — *"keepSymbol's denylist deleted real declarations in six languages"*,
another lane's fix, merged into this lane's base. It split `keepSymbol`'s conflated
denylist into a universal set and a per-language reserved set, and 17 protobuf
declarations that the old list was deleting now survive the projection. The analyzer's own
count is unchanged at **41,956**, and no edge count moved. The pass-2 table is left as it
was written rather than edited, because the movement is corpus-and-machinery history and
the passes that measured it are the record.

## Declared limitations, pass 6

- **The 38 are not closed, and this lane cannot close them.** One map from import path to
  declared package is the whole of it, and it is a project-level fact: `parseFile` is
  handed one file and is told nothing about include roots. The count is 38 of 13,275
  `uses` edges, **0.29%**.
- **The ancestor-walk defect is real and is left in place.** The analyzer emits
  `pkg.name` for an unqualified cross-file reference where `protoc` would fall through to
  an ancestor scope. Measured at **4** edges where that leaves the edge naming nothing.
  The correction is priced at **4 gained against 75 destroyed** and is not applied; all
  75 are the one shape described above, and `script/m14/protobuf-package-map-probe.mts`
  prints ten of them with their publisher counts so a reader can check the ratio rather
  than trust it.
- **The probe re-implements the specification's scope chain** rather than importing the
  analyzer's `specScopeChain`, because the probe must be able to report what the analyzer
  *did not* emit and so cannot use the analyzer's own resolution to find out. The two are
  the same order by construction; if one is edited the probe's chain must be edited with
  it, and nothing in the probe detects that drift.
- **The probe prices the walk with the decline guard in the shape that exists**, because
  that is the shape the analyzer has. The measurement that matters — 75 destroyed — is a
  consequence of that guard not firing, so a reader who believes a corrected guard would
  make the walk safe should re-run the probe with the corrected guard rather than take
  this row as the last word. The **gain** of 4 does not depend on the guard and is
  unaffected.

---

# PASS 7 — item 3 settled by implementing it, and a census that could not see a lost parse

No verdict moved. 5 emitted, 5 ruled-sound, 0 FALSIFIED; 13,275 / 40,098 / 1,561 / 4 / 1
and 54,939 through `parseFile` unchanged; 821 ok / 0 fail; 94 node types; 27/27 mutants;
8/8 fixtures. Two things are new: one instrument defect that made a number move between
runs, and one open item closed by writing the code rather than pricing it.

## The census reported `821 ok / 0 fail` on a run that lost a whole file

Four runs of `script/m14/protobuf-census.ts` on ONE commit, ONE corpus and ONE pinned wasm
(`wasm/tree-sitter-protobuf.wasm`, sha256 `4624eb6d`, checked against
`script/m14/tmp/protobuf/pin.json`) disagreed:

| | symbols through `parseFile` | edges through `parseFile` | analyzer-only |
|---|---|---|---|
| 3 of 4 runs | **41,955** | **54,939** | 1,002 |
| 1 of 4 runs | **41,945** | **54,930** | 1,011 |

The ANALYZER's totals were **41,956 / 55,941** in all four, so the divergence is on the
production side of the boundary and not in this lane's extractor. The bad run logged two
lines the good runs did not:

```
[BB-PARSE-ERR] protobuf | pb-googleapis/google/api/expr/v1beta1/source.proto | memory access out of bounds
[BB-HANG]     parser stuck 120s on .../source.proto — exiting
```

`-10 symbols / -9 edges` is that file WHOLE. `source.proto` is 62 lines and 2,154 bytes:
two messages, seven fields, all `contains`, no `uses` — so losing the whole file moves
exactly those two totals and nothing else, which is what makes the arithmetic identify it
rather than merely suggest it. The analyzer's own reading of those same bytes is 10 symbols
/ 9 `contains` edges, so the parse was fine and the PROJECTION published nothing.

`parseFile` catches the wasm fault internally and RETURNS, so `filesOk++` still runs and all
four runs printed `821 ok / 0 fail`. **A file-level ok/fail counter cannot see this class of
loss**, so the number moved between runs instead of being reported. New counter in the
census, `filesAnalyzerReadProductionPublishedNothing` — the analyzer found symbols in bytes
whose production result published none:

```
files the analyzer read and production published NOTHING for  0        <- a good run
files the analyzer read and production published NOTHING for  1        <- a bad run
    e.g. pb-googleapis/google/api/expr/v1beta1/source.proto:
        analyzer 10 symbols / 9 edges, production 0 / 0
```

Re-run until it was caught: **2 of 7** corpus-scale runs today were bad. So every
production-side count in this document carries a **±10 symbol / ±9 edge** band from this,
and the analyzer-direct figures carry none. That band is stated here rather than left for a
reader to discover by re-running.

`script/m14/tmp/protobuf/probe/parse-variance.mts` isolates the file: **40 sequential + 40
concurrent** attempts at the census's own width of 8 produced **ONE** outcome (10 symbols /
9 edges, 80/80). The fault does not reproduce without whole-corpus load, so it is a report
item for `parseFile`'s wasm handling — it catches the fault, returns an empty result, and
the caller cannot tell an empty file from a lost one.

## Item 3 was priced, and this pass wrote it: the walk is NET NEGATIVE

Pass 6 left item 3 open at *"4 gained / 75 destroyed, not a trade worth making"*, which is
a measurement of the probe's own simulation rather than of any implementation. This pass
implemented it, twice, and measured both against the corpus.

**Why the 75 was not the real cost.** protobuf's rule is C++ name lookup — take the first
scope that has a match — so a walk must not move an edge whose innermost scope already
publishes the name. The obvious implementation breaks **75** such edges, and the probe
priced it there. But **75 of 75** are published **by the referencing file itself**
(`protobuf-package-map-probe.mts`, new column `declineDecidablePerFile`), and the analyzer's
existing in-file pre-pass declines those before the walk is ever reached. The 75 measures a
walk that skipped the in-file step, not a property of the language.

**Implementation A — the message-inclusive scope chain**, which is what the pass-6 probe
simulated. It moved **95** edges. Its distinct failure: a field inside
`extend google.protobuf.FieldOptions { … }` carries scope `google.protobuf.FieldOptions`, so
a directory test over a MESSAGE scope matched `google/protobuf` and rewrote

```
grpc.gateway.protoc_gen_openapiv2.options.EnumSchema  ->  google.protobuf.EnumSchema
```

in `docker/vendor/github.com/grpc-ecosystem/grpc-gateway/v2/…/annotations.proto`. The first
name is declared in the referrer's own package. Directories mirror **packages**; a message
has no directory, so a directory test over a message scope is evidence of nothing.

**Implementation B — package scopes only**, `pkg`'s own ancestors, the package itself and the
root skipped. This is the correct restriction and it is still net negative:

| | `uses` targets binding nowhere, corpus-wide |
|---|---|
| at HEAD | **56** of 13,275 |
| with the walk | **138** of 13,275 |

86 edges lost a declaration they had; 4 gained one. `CLOSABLE-BY-ANCESTOR-SCOPE` went 4 → 0
and `NOT-CLOSABLE` went 10 → 96, which is the same arithmetic from the other end.

**The mechanism, and it is the reason no per-file guard can fix it.** A directory in the
import list cannot distinguish *"the ancestor package declares this type"* from *"my own
package declares this type, in a file whose directory I never imported"*. 3,605 of 13,275
`uses` targets name a type their own file does not declare, and the overwhelming majority are
same-package references into a sibling file — `apikeys.proto` names `Key`, which
`resources.proto` declares in the same package `google.api.apikeys.v2`. The walk cannot see
that publisher, so it fires on the wrong side of the trade for nearly every one of them.

**Settled: the walk is not taken, and the reason is a net −82 rather than a risk.** The
correct decline condition is publisher availability, which is the same project-level fact as
item 1, so items 1 and 3 are one item. The 4 edges stay unresolved and are named in the
table above rather than papered over.

`script/m14/tmp/protobuf/probe/dump-uses-targets.mts` is the instrument that found the
mechanism, and it carries a defect worth recording because it produced a wrong number first:
it keyed the dump on `(file, source)`, and an rpc emits **two** `uses` edges — request and
response — under one source id, so 1,552 rpcs collided and a diff over that key reports "the
target moved" when one of two edges did. It now numbers occurrences per source. The
authoritative figures in this section are the probe's corpus-wide binding counts, which are
computed over distinct target ids and do not depend on that key.

## Pass 7 gate table

Every gate re-run at this pass's HEAD. Nothing moved except the census, which gained a row.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **8 pass / 0 fail**, no baseline regressions |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **27 caught / 0 survived** |
| `npx tsx script/m14/protobuf-census.ts` | **821 ok / 0 fail**; 13,275 / 40,098 / 1,561 / 4 / 1; 54,939 through `parseFile`; 0 empty names; 0 bad kinds; 0 `unknown` endpoints; 0 self-loops; **0** edges under 0.7; **2 of 7 runs** lost one file's parse silently, now counted |
| `npx tsx script/m14/tmp/protobuf/probe/parse-variance.mts --n=40` | **1** distinct outcome in **80** attempts (10 symbols / 9 edges) — the fault needs corpus load |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** node types; all 5 rulings re-probed and still reading **0** |
| `npx tsx script/m14/protobuf-adversarial.mts` | 14 probes; 628,758 nodes, **0** without a published id; `uses` corpus-wide **99.58%**; heuristic ratio **0** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0. run **b**: **FALSIFIED 2** |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / **0 failed / 0 degraded**; 1,764 ambiguous, 52 unbound, 4 hopeless; 38,551 declarations, 37,113 (96.27%) with an inbound edge |
| `npx tsx script/m14/protobuf-package-map-probe.mts` | **56** = 38 + 4 + 4 + 10; the walk is **4 gained / 86 lost**, net **+82** unresolvable |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, 0 degraded** |
| `npx tsx script/m14/incoming-check.ts protobuf <40 files>` | `contains` unresolved **2,879 → 0**; `uses` unresolved **635 → 55** |
| `npx tsx script/m12/verify-regex-census.ts` | exits 1 on 18 MISSING / 25 STALE, **0** rows naming this lane |
| `npx tsx script/m14/verify-honesty.ts` | exits 6 on **22 failures, 0 naming a protobuf path** |
| `bun run script/m14/verify-doc-truth-emissions.ts --no-write` | `FALSE_NEGATIVE=7 FALSE_POSITIVE=0`, none in this lane's rows |

## Declared limitations, pass 7

- **Every production-side count in this document has a ±10 symbol / ±9 edge run-to-run
  band**, measured at 2 of 7 corpus-scale runs, and the band is silent: the run reports
  `821 ok / 0 fail`. The analyzer-direct counts do not carry it. `parseFile` returns an
  empty result for a file whose wasm parse threw and the caller cannot distinguish that
  from an empty file; fixing it means `parseFile` reporting the fault, which is
  `src/ast/pool-worker.ts` and therefore not this lane's to edit.
- **No verdict in this document is backed by an independent implementation.** > **PASS 8:
  > `uses` now is.** `protoc` 36.2 judges 11,250 of its edges at 99.627% agreement.
  > Four DERIVATION findings remain — `contains`, `imports`, `exports`, `overrides`.
  > This bullet is pass 7's and is kept as written; the limitation it states is now
  > true of four types rather than five. The mutant battery and the hand-derived expectations
  are what stand in for an oracle, and both share this lane's reading of one patched grammar.
- **The `uses` resolution figures are population-dependent and three of them are quoted with
  different denominators on purpose** — per-file 72.84%, corpus-wide 99.58%, and 88.57% to
  exactly one declaration. Comparing any of them to another lane's single figure compares
  two different questions.
- **The 38 and the 4 stay open**, and the reason is now measured rather than asserted: both
  need to know which package a file declares, and `parseFile` is handed one file.
- **The corpus is 18 repositories and it is not the language.** `descriptor.proto` is vendored
  into four of them, which is what makes 2,702 ids ambiguous corpus-wide; a corpus with one
  copy would report 0 ambiguity and would be less informative, not more correct.

---

# PASS 8 — an independent implementation at last, and one real defect it found

No verdict moved. 5 emitted, 5 ruled-sound, 0 FALSIFIED; 13,275 / 40,098 / 1,561 / 4 / 1
and 54,939 through `parseFile` unchanged; 821 ok / 0 fail; 94 node types; 28/28 mutants;
9/9 fixtures. What is new is that **one of the five DERIVATION findings is now paid
down by something that is not this lane**, and that it found a defect six earlier
passes measured the symptoms of without being able to name the cause.

## The oracle: protoc, adjudicating every `uses` target

Passes 1–7 each declared the same limitation in the same words: *"No verdict in this
document is backed by an independent implementation."* Every resolution figure quoted
for this lane — 72.87% per-file, 99.58% corpus-wide, 88.57% to exactly one declaration
— was computed by resolving an emitted name against **the analyzer's own id set**. A
grammar bug shared by the extractor and the checker is invisible to both, and this
lane had no other checker.

`protoc` is the reference implementation and is not that. Handed a file it emits a
`FileDescriptorProto` in which **every message-typed field's `type_name` is an
absolute, fully qualified, resolved name** — `protoc` has already run the C++ name
lookup, and it is the same value it reads when it links a descriptor. Agreement is
exact string equality after the leading dot. The two sides share no code: one is a
vendored patched tree-sitter grammar, the other is the C++ compiler.

`script/m14/tmp/protobuf/probe/protoc-oracle.py`. `libprotoc 36.2`, run over the
821-file corpus:

| | |
|---|---|
| files carrying `uses` edges | **675** |
| compiled by protoc | **640** |
| protoc REJECTED | **35**, every cause named below |
| **edges judged** | **11,250** |
| **AGREE** | **11,208 — 99.627%** |
| **WRONG-NAME** | **42** |
| of which map fields | 351, compared on the entry's VALUE type |
| of which rpc request/response | 2,682, compared as an unordered pair |
| NOT-A-TYPE, excluded | 909 |
| INDISTINCTUISHABLE, excluded | 17 |
| UNRESOLVED, file did not compile | 1,099 |

**All 42 disagreements are one shape**: the emitted name is `protoc`'s with a package
prefix missing. 31 in consul, 6 in containerd, 4 in `plugin.proto`, 1 in
kubernetes. That is the ancestor-package walk — a defect this lane has measured four
times and declined to fix per-file because the correction prices at net −82. What
changed is its standing: it was an inference from directory layout, and it is now
**confirmed by the reference compiler, edge by edge, with the 42 named in
`oracle36-AFTER.json`**.

The 35 rejections are named rather than dropped: 16 `Edition 2026 is later than the
maximum supported edition 2024`, 13 an import path no directory in this corpus
provides (`github.com/docker/swarmkit/api/types.proto`, `xds/data/orca/v3/…` — real
vendor gaps in the corpus, not analyzer failures), 3 `Expected ";"` in fixtures that
do not compile, 2 `opaqueany.Any is not defined`, 1 an unknown option.

## The defect: a nested `extend` resolved against the type it extends

**The oracle found this, and the analyzer's own instruments had not.** The A/B probe
`script/m14/tmp/protobuf/probe/scope-fix-ab.mts` was written to price a candidate fix
and instead located the defect; the oracle is what proved the fix right.

`extend Foo { … }` adds the block's members to `Foo`. It does **not** open a scope: a
type written inside the block is looked up from where the block is **written**. The
analyzer carried one value for both questions, so the resolver was handed the extended
type as the scope of every member of the block — a type the language never made a
scope of.

The shape is the reference implementation's own.
`pb-reference/src/google/protobuf/unittest_custom_options.proto:295-300`:

```proto
message ComplexOptionType2 {
  message ComplexOptionType4 {
    extend google.protobuf.MessageOptions {
      optional ComplexOptionType4 complex_opt4 = 7633546;
```

The analyzer emitted `proto2_unittest.ComplexOptionType4`. `protoc` reports that
field's type as `proto2_unittest.ComplexOptionType2.ComplexOptionType4`. The emitted
id is published by **no file in any repository in the corpus** — it is one of the 23
targets pass 6 priced and called unclosable per-file, and the reason it read that way
is that the cause is not a missing map at all.

`Ctx` now carries `scope` — the lexical position — separately from `owner` — the
extended type. The two are equal everywhere else: a message, enum, service, group body
and oneof each set both to the declaration they open. **`extend` is the only site that
separates them, and it is the only site that changed.**

| | before | after |
|---|---|---|
| `uses` targets moved (A/B, 821 files, 13,275 edges each arm) | — | **6** |
| edges added or removed | — | **0** |
| edge counts (uses / contains / imports / exports / overrides) | 13,275 / 40,098 / 1,561 / 4 / 1 | **unchanged** |
| symbols, analyzer-direct / through `parseFile` | 41,956 / 41,955 | **unchanged** |
| `uses` both-ends, production ids | 72.84% | **72.87%** |
| self-loops / empty names / bad kinds / `unknown` endpoints | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** |
| **oracle WRONG-NAME** | **47** | **42** |
| **oracle AGREE** | **11,203 — 99.582%** | **11,208 — 99.627%** |
| oracle verdict flips | — | **5, all WRONG-NAME → AGREE, 0 new** |

The 5 flips, each a case where `protoc` names a nested declaration the pre-fix
analyzer could not see:

```
proto2_unittest.ComplexOptionType2.ComplexOptionType4
proto2_unittest.TestExtensionOrderings2.TestExtensionOrderings3
edition_unittest.TestExtensionOrderings2.TestExtensionOrderings3
proto2_unittest.TestNestedExtension.OptionalGroup_extension
edition_unittest.TestNestedExtension.OptionalGroup_extension
```

### The sixth moved edge, and why the fixture needs two rows

The 6th is in `unittest_delimited.proto`, where `protoc` reports **two declarations
under one owner-qualified name** and the oracle records INDISTINCTUISHABLE rather than
guessing. Read by hand from `protoc`'s descriptor, it answers
`editions_unittest.LengthPrefixed` — the post-fix emitted name. That file is the
reference implementation's own test of exactly this question:

```proto
message LengthPrefixed { … }              // editions_unittest.LengthPrefixed
message TestDelimited {
  message LengthPrefixed { … }            // …TestDelimited.LengthPrefixed
  LengthPrefixed lengthprefixed = 1;
}
extend TestDelimited {
  LengthPrefixed lengthprefixed = 1004;   // protoc: editions_unittest.LengthPrefixed
}
```

The `extend` block is at **file scope**, so C++ lookup from `editions_unittest` finds
the file-scope declaration and stops; `TestDelimited` is not an enclosing scope of a
file-scope extend block. The pre-fix analyzer, handed the extended type as the scope,
answered the nested one.

**This is why the fix is not "prefer the innermost declaration."** That rule passes
the `ComplexOptionType4` case and fails this one. `validation/m14/fixtures/protobuf/nested-extend-scope`
asserts both directions, forbids the pre-fix answer for each, and adds an
ordinary-field control so neither direction may break in-file resolution for nested
types. Both rows are adjudicated by `protoc` on the fixture file itself:

```
FILE-SCOPE extensions:
   which_twin: extendee=.nse.demo.Dual  type_name=.nse.demo.Twin
NESTED extensions of nse.demo.Nest.Leaf:
   leaf_ref:   extendee=.google.protobuf.FieldOptions  type_name=.nse.demo.Nest.Leaf
```

### Why the unresolved-edge count UNDERSTATES this fix by 2

`protobuf-incoming-audit.mts` reports `uses` unbound **52 -> 49**. The oracle found
**5** flips. Both are right, and the gap between them is the most useful thing in this
pass.

Three of the five pre-fix names were published by **no** file
(`proto2_unittest.ComplexOptionType4`, `proto2_unittest.TestExtensionOrderings3`,
`edition_unittest.TestExtensionOrderings3`), so they appear as dangling and the count
moves. The other two were **published ids naming a real declaration that is not the
one written** — `unittest.proto` declares `OptionalGroup_extension` twice, at file
scope (line 520) and nested in `TestNestedExtension` (line 580), and the extension at
line 573 writes the bare name from inside `TestNestedExtension`. `protoc` takes the
nested one; the pre-fix analyzer took the file-scope one. So those edges **resolved,
and resolved wrong**: they never appear in an unresolved count at all, and the only
instrument that can see them is one that asks `protoc` what the declaration was.

This is the workstream's own warning — *"a name collision becomes a wrong refactor"* —
found inside this lane, and it is the concrete argument for judging emitted names
rather than counting unresolved ones. An unresolved-target rate is a floor on
correctness, never a measure of it: **2 of the 5 real defects here were invisible to
it, and a lane that reported only that rate would have shown this fix as worth 3.**

Ownership is unchanged and asserted on both extension members — still the **extended**
type with `metadata.viaExtension` — so a one-sided fix that moved the resolution scope
by also moving ownership fails on a `contains` row rather than passing. The new
fixture **FAILS on the pre-fix analyzer** (verified by stashing the fix and re-running),
so it discriminates rather than merely passing.

## Four instrument defects, each of which produced a wrong number first

The oracle is only worth its verdict if the oracle is right, and it was wrong four
times before it was right. Each defect is recorded because each one had already
produced a number this lane would otherwise have reported.

**1 — Extensions are not fields.** `protoc` keeps an `extend` block's members in the
FILE's `extension` list, and a **nested** extend block's members in the **enclosing
message's** list. Reading only `message_type[].field` skipped every extension field in
the corpus — 3,635 edges into NOT-A-TYPE — and since a nested-extend reference can
only occur inside an `extend` block, the oracle reported the pre-fix and post-fix
analyzers as **identically correct** while they differ on 6 edges. The read that
exposes it: `protoc` on `unittest_custom_options.proto` lists 48 top-level extensions
and `complex_opt4` is not among them, and it appears instead under
`proto2_unittest.ComplexOptionType2.ComplexOptionType4`.

**2 — A key collision is not a verdict.** Two declarations share one owner-qualified
name on *both* sides whenever a message declares `T x = 1` and an `extend` of that
message declares `T x = 1004`. `unittest_delimited.proto` has three such pairs —
`lengthprefixed`, `grouplike`, `messageimport`. The analyzer disambiguates them with a
`#property` suffix; `protoc` has no such suffix and keys both to `owner.name`.
Comparing them pairwise by dict order produced a WRONG-NAME against whichever row
landed last. An edge is now judged **only when the pairing is 1:1**; otherwise every
edge on that key is INDISTINCTUISHABLE and excluded from the rate. Seventeen edges are
excluded this way and **reported**, because an unjudged edge named is information and
a wrongly judged one is not. `probe/extend-member-id-collision.mts` confirms the
analyzer side independently: **0 of 821** files publish any id twice.

**3 — An rpc's request and response are not fields.** `protoc` stores them on the
METHOD as `input_type`/`output_type`. They are judged as an **unordered pair**
deliberately: the analyzer writes request before response and `protoc` stores input
before output, so matching by position would make the oracle agree with the analyzer
by agreeing about emission order rather than by evidence. 2,682 edges.

**4 — A map field's declared type is its synthesized entry message.** For
`map<string, ListValue> api_tags = 1;` `protoc` reports `api_tags`'s `type_name` as
`Owner.ApiTagsEntry`, a type nobody wrote and this analyzer does not publish.
Comparing against that reported **all 351 map fields wrong**, which was wrong about
which: the analyzer deliberately emits the map's **value** type, because
`map<string, ListValue>` means the field holds ListValues. Map fields are therefore
compared against the map entry's own `value` field `type_name`, which tests the
analyzer's convention against `protoc`'s instead of against a type neither chose.

Two instrument limits, stated rather than worked around:

- **Include roots are discovered as a fixpoint from `protoc`'s own diagnostics.** When
  `protoc` says `<import>: File not found`, that import is resolved to the directory
  that provides it and the compile is retried; the file's own ancestors come first, so
  a repository's own copy of a vendored file wins. Handing `protoc` all **611**
  corpus directories holding a schema was tried first and made the result **worse** —
  **542** files compiled against **570** with repository roots alone — because `protoc`
  takes the first root providing a path and `descriptor.proto` is vendored into four
  repositories here. 32 include-root choices were genuinely ambiguous; the first
  candidate is taken and **each is recorded** in `ambiguousRootChoices`.
- **The `grpc_tools` bundled build is `libprotoc 35.1`, which rejects edition 2026.**
  "Edition 2026 is later than the maximum supported edition 2024" — and **16** corpus
  files declare that edition, **including every file carrying a nested-extend
  reference**. A 35.1 oracle silently cannot adjudicate the case this fix exists for:
  at 35.1 the pre-fix and post-fix arms were identical at 42 WRONG-NAME, and the fix
  looked like it had changed nothing. `--protoc` selects the binary.

## The band on every production-side count was understated by 5×

Pass 7 measured the silent parse loss as *"2 of 7 corpus-scale runs, one 62-line file
whole"* and left a **±10 symbol / ±9 edge** band. Both numbers were wrong.

Six losses were observed in `pb-googleapis/google/api/expr/`, which is a locality
hypothesis, and `probe/lost-parse-locality.mts` was built to test it — with a control,
because a locality claim with no complement is a coincidence of sample size. **The
control falsified it**: `docker/vendor/github.com/containerd/containerd/api/events/task.proto`
lost its parse under the same load. The same 11 `expr/` files parsed **deterministically
6 rounds of 6 in isolation** (367 symbols / 518 edges every time), so the fault needs
corpus-scale load and is not a property of any one file.

| | pass 7 said | measured |
|---|---|---|
| corpus-scale rounds with a loss | 2 of 7 (29%) | **9 of 19 (47%)** |
| distinct files ever lost | 1 | **7, across 5 repositories** |
| files lost in one round | 1 | **up to 2** |
| worst single round | −10 symbols / −9 edges | **−69 symbols / −100 edges** |
| spread on the symbol total | ±10 | **69** (41,886 – 41,955) |
| spread on the edge total | ±9 | **100** (54,839 – 54,939) |
| localized to one directory | — | **NO — falsified by its own control** |

Every production-side count in this document therefore carries a **−69 symbol / −100
edge** band, not ±10/±9, and the analyzer-direct figures carry none. The clean-run
totals this document quotes are the reproducible ones: **41,955 symbols / 54,939
edges** through `parseFile`, reached on 10 of 19 rounds.

## All 23 unresolved targets, every one, with their candidates

Passes 5 and 6 reported **52** unbound and **4** hopeless `uses` targets. The audit
stored 5 examples of each — enough to show a shape, not enough to settle whether the
52 share one cause or fifty-two. `probe/unpublished-uses-targets.mts` prints all of
them: **23 distinct targets carrying 55 edges**, 20 name-exists-unbound (**51
edges**) and 3 hopeless (**4**).

Classified by what the corpus says the reference should have been, this is where the
number stops being one number:

| class | targets | edges | what closes it |
|---|---|---|---|
| **ancestor-package prefix missing** — `common.EnterpriseMeta` → `hashicorp.consul.internal.common.EnterpriseMeta` | 12 | **33** | the include-root map (item 1). **Now oracle-confirmed**, not inferred from directory layout |
| **vendor-rewrite** — `NodeSpec.Membership` → `docker.swarmkit.v1.NodeSpec.Membership`, referenced from a file vendored at `moby/swarmkit/v2` | 2 | **4** | the vendor map (item 2) |
| **nested declaration, lexical scope** — the shape pass 8 fixed | 3 | **3** | **CLOSED** |
| **fixture that references what it never declares** — `sls.asfd.asfd.CustomType`, `sls.asfd.asfd.JsonFormat`, `github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo` | 3 | **3** | nothing; `protoc` rejects or does not define them |

Candidates per target, which is what tells the classes apart: **4 targets have exactly
one** candidate (a rename from binding), 5 have two, 2 have three, 3 have four, and
the largest is `status.Status` with **34** — a name so common in this corpus that no
per-file rule could pick a winner. `common.EnterpriseMeta` alone accounts for **16
edges** and has **18** candidates.

**This is the honest answer to "what reaches a declaration": 33 of the 55 edges are one
defect, oracle-confirmed, and all 33 are closed by the same project-level map. The lane
cannot supply it — `parseFile` is handed one file and told nothing about include roots —
and that is why it is reported as an item rather than fixed.**

## DERIVATION findings: 5 → 4

`uses` is no longer one. 11,250 of its edges are now adjudicated by an implementation
that shares no code with this one, and the 42 it rejects are named. The remaining
**four** are `contains`, `imports`, `exports` and `overrides`:

| type | edges | what an oracle would have to be |
|---|---|---|
| `contains` | 40,098 | read `FileDescriptorProto`'s `nested_type` / `field` / `extension` nesting — available from the same descriptor the oracle already parses, and not yet written |
| `imports` | 1,561 | compare `dependency` against the `imports` edge set — likewise available, not yet written |
| `exports` | 4 | compare against `public_dependency` — likewise |
| `overrides` | 1 | the slot-restatement rule; `protoc` has no concept of it, since protobuf does not override |

The first three are **cheap and the descriptor is already in hand** — the oracle writes
a `FileDescriptorProto` today and reads only fields and methods out of it. That they are
not written is a statement about this session, not a structural obstacle, and it is the
first work item for whoever picks this lane up. `overrides` is different in kind: the
construct is a field **slot** being restated and `protoc` has no opinion about slots at
all, so its oracle would have to be written from the specification rather than read off
a descriptor.

`imports` and `exports` endpoints are module paths by design and resolve 0% against
symbols; that is unchanged and remains correct rather than a defect.

## Pass 8 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no diagnostics |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **9 pass / 0 fail**; the new fixture FAILS on the pre-fix analyzer |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **28 caught / 0 survived** |
| `npx tsx script/m14/tmp/protobuf/probe/scope-fix-ab.mts` | 821 files, 13,275 edges each arm, **6 moved, 0 added, 0 removed** |
| `npx tsx script/m14/tmp/protobuf/probe/nested-extend-scope.mts` | **PASS** — 3 shapes, ownership asserted unchanged |
| `npx tsx script/m14/tmp/protobuf/probe/protoc-oracle.py --protoc …/protoc` | **11,250 judged, 11,208 AGREE (99.627%), 42 WRONG-NAME**; before-arm 47 |
| `npx tsx script/m14/tmp/protobuf/probe/lost-parse-locality.mts --scope=rest` | **LOCALITY FALSIFIED** — control lost `docker/…/events/task.proto` |
| `npx tsx script/m14/tmp/protobuf/probe/lost-parse-locality.mts --scope=expr` | **0 of 6 rounds**, deterministic — the fault needs corpus load |
| `npx tsx script/m14/tmp/protobuf/probe/lost-parse-locality.mts --scope=all` | 7 rounds, **5 with a loss, 2 files in one round, 5 repositories** |
| `npx tsx script/m14/tmp/protobuf/probe/unpublished-uses-targets.mts` | **23 targets / 55 edges**, every one named: 20 + 3 |
| `npx tsx script/m14/tmp/protobuf/probe/extend-member-id-collision.mts` | **0 of 821** files publish any id twice |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; 13,275 / 40,098 / 1,561 / 4 / 1; 54,939; 0 empty names; 0 bad kinds; 0 `unknown`; 0 self-loops; **0** under 0.7 |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** node types; all 5 rulings re-probed and still reading **0** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run **c**: `emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0 |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files** — unchanged, and pass 3's part 1 is its diagnosis |

## Declared limitations, pass 8

- **One of five types is oracle-checked and four are not.** `uses` is adjudicated by
  `protoc` at 99.627% over 11,250 edges. `contains` (40,098), `imports` (1,561),
  `exports` (4) and `overrides` (1) are compared against nothing but hand-derived
  expectations and the mutant battery. The first three are readable from the
  descriptor the oracle already parses and **are simply not written yet**; saying so
  is more useful than implying the work is hard.
- **The oracle's 1,099 UNRESOLVED edges are edges nobody has checked.** They sit in 35
  files `protoc` rejects, 16 of them for declaring edition 2026. A larger `protoc` may
  reject them for a different reason, or compile them and disagree; neither is known.
- **The oracle judges names, not graph shape.** It cannot see an edge that is missing,
  only one that is misnamed. A reference the analyzer never emits is invisible to it,
  and the construct probes remain the only instrument for that.
- **The 42 remaining disagreements are left in place.** They are one defect, oracle-
  confirmed, closed only by a project-level include-root map that `parseFile` is never
  told. Pass 7 measured the per-file correction at net −82 and pass 8 has nothing that
  changes that number — it only establishes that the defect is real, which the four
  earlier passes had inferred.
- **`include_roots` is `protoc`-driven, so the oracle's verdicts depend on include
  roots it discovered rather than roots the projects declare.** 32 choices were
  ambiguous and each is recorded, but a corpus whose vendored copies disagree could
  adjudicate a file against a schema it never read. This is the same project-level
  fact as the analyzer's own open item, approached from the other side.
- **Every production-side count carries a −69 symbol / −100 edge band**, measured at 9
  of 19 corpus-scale rounds, and the band is silent: the run reports `821 ok / 0 fail`.

---

# PASS 9 — the whole battery at merged HEAD, and a pass-8 headline that does not reproduce

Passes 1–8 measured on a branch 90 commits behind `analyzers/ontology-laptop-b`, and two
of those commits change the instruments rather than the lane. So this pass merged the
base branch (`f8f1f87ac`, clean, no conflict in any file this lane owns) and re-ran
every gate rather than re-publishing pass 8's numbers.

**What the merge changed underneath the measurements.**

| shared file | delta | effect on this lane's numbers |
|---|---|---|
| `src/ast/pool-worker.ts` | **+26** | four bash metadata keys (`isExported`, `isImplicitBinding`, `bindingSite`, `isArray`). **No protobuf key is involved**, and the census below is byte-identical to pass 8's |
| `script/m14/firing-check.ts` | **+74** | now hashes the analyzer before and after the walk (`analyzerDigest`, `analyzerStableDuringRun`) and **names** each degraded file. It reported `stable` for this lane |
| `script/m14/incoming-check.ts` | **+49** | not run: this lane's own `protobuf-incoming-audit.mts` answers the same question with the corpus partition attached |
| `script/m14/ontology-coverage-gate.ts` | **+6** | **`script/m14/protobuf-ruled.ts` is now wired in.** See below — this is the §8 item pass 4 asked for, applied by the supervisor |

## §8 item 1 is closed; one line in a shared file is what remains

Passes 4 and 5 each reported two shared-file items. Item 1 was *"wire
`PROTOBUF_RULED` into `ontology-coverage-gate.ts`"*, on the evidence that the gate
exited **2** with the message `no RULING TABLE for protobuf`, so this lane's five
rulings had never been read by the arbiter.

**That is no longer the state.** At merged HEAD the untouched gate runs, prints all ten
rows with `Written ruling: script/m14/protobuf-ruled.ts (RULED_BY_LANG.protobuf)` on
every RULED row, and exits **1** rather than 2:

```
$ npx tsx script/m14/ontology-coverage-gate.ts protobuf
calls         FALSIFIED    NOT EMITTED, but the grammar DOES produce function_definition
instantiates  FALSIFIED    the construct occurs 1x … WRONG GRAMMAR: this probe was handed
                          a tree whose root node is `program`, not `source_file`
emitted 5/10   ruled-sound 3   FALSIFIED 2   ruled-without-justification 0
```

Both FALSIFIED rows are the **same single cause** and it is item 2: `protobuf` is still
absent from `LANGS` in `script/m14/differential.ts`, so the gate selects its wasm with
`(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"` and hands both instruments the
**bash** grammar. `function_definition` is a real bash node type, and a `program` root is
not `source_file`. `grep -c protobuf script/m14/differential.ts` → **0** occurrences.

`script/m14/protobuf-ruling-table-proof.mts` proves the distinction mechanically rather
than by assertion: it splices the entry into a **derived copy** of the shared file, runs
the real gate, and deletes the copy.

| run | wiring | result |
|---|---|---|
| **(a)** | gate as shipped (ruling table now wired) | `emitted 5/10 ruled-sound 3 FALSIFIED 2`, **exit 1** |
| **(b)** | + `protobuf-ruled`, `LANGS` untouched | `emitted 5/10 ruled-sound 3 FALSIFIED 2`, **exit 1** |
| **(c)** | + `protobuf` added to `LANGS` | `emitted 5/10 ruled-sound 5 FALSIFIED 0`, **exit 0** |

So the lane's own §8 list is now **one line**, not two:

> `script/m14/differential.ts` — add to `LANGS`:
> `protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },`
> Why: until this exists, both of the arbiter's instruments read bash's grammar and
> report two of this lane's five rulings as FALSIFIED. All four values are already
> carried at `script/m14/run-fixtures.ts:91`, so this copies an existing value rather
> than inventing one. Proof it is sufficient and necessary: runs (b) and (c) above.

## The pass-8 headline that does not reproduce: 23 targets / 55 edges → 20 / 53

Pass 8's section *"All 23 unresolved targets, every one, with their candidates"* opens
with **23 distinct targets carrying 55 edges**, 20 name-exists-unbound (51 edges) and 3
hopeless (4). Re-run at merged HEAD, `probe/unpublished-uses-targets.mts` reads:

| | pass 8 recorded | measured at merged HEAD |
|---|---|---|
| distinct unpublished `uses` targets | 23 | **20** |
| name-exists-unbound | 20 targets / 51 edges | **17 targets / 49 edges** |
| hopeless | 3 targets / 4 edges | **3 targets / 4 edges** |
| total | 23 / 55 | **20 / 53** |

**The corpus did not move, and that is measured rather than assumed.** `find … -name
'*.proto' -newermt '-30 hours'` returns 215 files, which looks alarming until the mtimes
are read: all five repositories carrying them (`boundary` 127, `consul` 33, `nomad` 10,
`vault` 24, `waypoint` 21) were written at **2026-10-03 07:02–07:03**, which is the clone
pass 2 recorded, `git status --porcelain` is empty in all five, and every HEAD predates
it (`pb-grpc` Sep 28, `consul` Oct 1, `boundary` Sep 28). 821 files in 18 repositories,
as in every pass since 2.

**So the cause is inside this lane, and it is the same class of defect pass 6 and pass 7
each found in an earlier pass's own prose: a headline measured before a fix, with the
prose beside it already describing the post-fix state.** Pass 8's own class table lists
the third row as `nested declaration, lexical scope — 3 targets / 3 edges — **CLOSED**`.
The table was written post-fix; the sentence above it, carrying the totals, was not
restated. 23 − 3 = 20 and 55 − 2 = 53, and the two arithmetic results agree with the
measurement only if the third class carried 2 edges rather than the 3 the table claims.
**The table's per-class edge count is the wrong one**, and the honest form is the measured
one.

One classification was wrong as well, in the opposite direction — a target moved *into*
the resolvable set:

| target | pass 8 called it | measured | candidates |
|---|---|---|---|
| `sls.asfd.asfd.JsonFormat` | hopeless — *"a fixture that references what it never declares"* | **name-exists-unbound** | **2** — `google.protobuf.FeatureSet.JsonFormat`, in `pb-reference/src/google/protobuf/descriptor.proto` and in `dart-sdk/…/protobuf_handler/protos/google/protobuf/descriptor.proto` |
| `xds.data.orca.v3.OrcaLoadReport` | **not listed** | **hopeless, 2 edges** | 0 — `pb-grpc/src/proto/grpc/testing/{xds/v3/orca_service,echo_messages}.proto` reference an xDS type that pb-grpc does not declare |

`JsonFormat` was never hopeless: a declaration carrying that leaf name exists in the
corpus twice over, so naming it as a fixture that declares nothing was a claim about the
corpus made without reading it. That is the failure the empty-`candidates` column should
have caught, and the column exists.

Every one of the 20 targets, with its edge count and candidate count:

| edges | candidates | target |
|---|---|---|
| **16** | 18 | `common.EnterpriseMeta` |
| 6 | 7 | `common.RaftIndex` |
| 4 | 5 | `common.Locality` |
| 4 | 9 | `types.Platform` |
| 3 | 1 | `NodeSpec.Membership` |
| 3 | 4 | `types.Metric` |
| 3 | 4 | `google.protobuf.compiler.FileDescriptorProto` |
| 1 | 1 | `connect.IssuedCert` |
| 1 | 1 | `NodeSpec.Availability` |
| 1 | 2 | `connect.CARoots` |
| 1 | 2 | `common.QueryMeta` |
| 1 | 2 | `sls.asfd.asfd.JsonFormat` |
| 1 | 3 | `grpc.testing.duplicate.EchoResponse` |
| 1 | 3 | `google.protobuf.compiler.GeneratedCodeInfo` |
| 1 | 4 | `grpc.testing.duplicate.EchoRequest` |
| 1 | 12 | `config.Config` |
| 1 | 34 | `status.Status` |
| **1** | 0 | **hopeless** `sls.asfd.asfd.CustomType` |
| **2** | 0 | **hopeless** `xds.data.orca.v3.OrcaLoadReport` |
| **1** | 0 | **hopeless** `github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo` |

`status.Status` still has **34** candidates, so no per-file rule can pick a winner for it
— which is why the fix for these 33 edges is a project-level include-root map and not a
line in this analyzer. **49 edges unbound + 4 hopeless = 53**, and that is the figure
`script/m14/protobuf-incoming-audit.mts` reports independently in its own partition
(`uses … unbound 49  hopeless 4`), from a different code path. Two instruments, one
number.

## The band, re-measured, and caught inside a single session

`probe/lost-parse-locality.mts --scope=all --rounds=8` at merged HEAD:

| | pass 8 (19 rounds) | this pass (8 rounds) |
|---|---|---|
| rounds with ≥1 lost file | 9 of 19 (47%) | **3 of 8 (38%)** |
| symbol spread | 69 (41,886–41,955) | **53 (41,902–41,955)** |
| edge spread | 100 (54,839–54,939) | **76 (54,863–54,939)** |
| distinct files ever lost | 7, across 5 repositories | **5** |
| losses outside `pb-googleapis/google/api/expr/` | — | **4 of 5 — locality still falsified** |
| worst round | −69 symbols / −100 edges | **−53 / −76** |

The clean-run totals reproduce exactly: **41,955 symbols / 54,939 edges**, and the
census below read those numbers on its first attempt. The pass-8 band of −69 / −100
still bounds this observation, and a smaller sample cannot be expected to reach the
maximum a larger one found.

**The band was also caught red-handed inside this one session, which is the reason it is
worth a table rather than a footnote.** Two gate invocations, minutes apart, at the same
commit, on the same 821 files:

| invocation | `uses` | `contains` | `imports` | sum | reading |
|---|---|---|---|---|---|
| `protobuf-ruling-table-proof.mts` run (c) | **13,267** | **40,072** | **1,559** | 54,898 | a round that lost files: **−8 / −26 / −2 = −36 edges** |
| `ontology-coverage-gate.ts protobuf` | **13,275** | **40,098** | **1,561** | 54,934 | a clean round |

Both report `821 admitted files` and neither reports a fault, because the loss is a wasm
`memory access out of bounds` that the pipeline turns into an empty parse rather than an
error. **The verdict counts quoted anywhere in this document are the clean ones, and a
reader who re-runs a gate and gets 13,267 instead of 13,275 has found this, not a
regression.** `exports` (4) and `overrides` (1) were identical in both, which is what one
would expect of a loss that costs whole files rather than whole types.

## Every pass-8 number, re-measured at merged HEAD

| measurement | pass 8 | merged HEAD | moved? |
|---|---|---|---|
| census | 821 ok / 0 fail | **821 ok / 0 fail** | no |
| symbols / edges through `parseFile` | 41,955 / 54,939 | **41,955 / 54,939** | no |
| `uses` / `contains` / `imports` / `exports` / `overrides` | 13,275 / 40,098 / 1,561 / 4 / 1 | **13,275 / 40,098 / 1,561 / 4 / 1** | no |
| both-end resolution, `uses` | 72.87% | **72.87%** (9,673 / 13,275) | no |
| both-end resolution, `contains` | 99.22% | **99.22%** (39,786 / 40,098) | no |
| edges under 0.7 confidence | **0** | **0** | no |
| empty names / bad kinds / `unknown` endpoints / self-loops | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** | no |
| node types observed / declared | 94 / 117 | **94 / 117** | no |
| `block_lit` by-parent histogram | `{constant: 1909}` | **`{constant: 1909}`** | no |
| `instantiates` construct occurrences | 0 | **0** | no |
| `firing-check --files 120` | 3/10, 2,069 edges, 10/120 files | **3/10, 2,069 edges, 10/120 files**, `analyzerDigest stable` | no |
| arbiter's sample absent from disk | 110 of 120 | **110 of 120** | no |
| incoming: ambiguous / unbound / hopeless on `uses` | 1,461 / 49 / 4 | **1,461 / 49 / 4** | no |
| `protoc` oracle | 11,250 judged, 11,208 agree, 42 wrong | **11,250 judged, 11,208 agree (99.6267%), 42 wrong** | no |
| store binding (40 files) | 3,075 edges, 3,012 walkable, 2,977 provable | **3,075 / 3,012 (97.95%) / 2,977 (96.81%)** | no |
| scope-fix A/B | 6 moved, 0 added, 0 removed | **6 moved, 0 added, 0 removed** | no |
| duplicate published ids | 0 of 821 | **0 of 821** | no |
| mutants | 28 caught / 0 survived | **28 caught / 0 survived** | no |
| fixtures | 9 pass / 0 fail | **9 pass / 0 fail** | no |
| m12 regex census, protobuf rows | 0 | **0**, and the gate now reports `regex census gate PASSED` | no |
| **unpublished `uses` targets** | **23 / 55** | **20 / 53** | **YES — see above** |

Twenty-four of twenty-five reproduced. The one that moved moved because the earlier
number was stale, not because the corpus or the analyzer changed, and both facts are
measured above rather than argued.

**Two stale counts remain in earlier sections of this document and are corrected by this
one**, since a reader meets them first:

- **§Pass 2 / §Pass 3 / §Pass 4 gate tables** record the raw arbiter as *exit 2 — "no
  RULING TABLE for protobuf"*. It now exits **1** and rules; see the table above.
- **§Still not settled** says *"26 mutants"*. The battery runs **28** — commit
  `20644c25a` corrected one instance of this and left this one.

## A fifth stale number, and it was arithmetic

Pass 3 wrote *"8,703 of the 8,524 paths `firing-check.ts` offers this language are not on
disk"* — a count larger than the population it was a fraction of, in a sentence whose
whole purpose was to be checked. `protobuf-incoming-audit.mts` part 1 re-measures the
arbiter's sampler at merged HEAD:

| | |
|---|---|
| `git ls-files` offered | **8,524** `.proto` paths |
| of those, on disk | **821** |
| of those, **NOT** on disk | **7,703** (**90.4%**) |
| stride (8,524 / 120) | 71 |
| sampled paths | **120** — 10 present, **110 absent** |
| absent, by repository | `pb-googleapis` 103, `pb-reference` 6, `pb-grpc` 1 |

821 + 7,703 = 8,524, so the three numbers are consistent and the sentence was not. The
measurement underneath it was always right — pass 3 diagnosed the arbiter's `10/120`
correctly, and today's run reproduces the diagnosis exactly — but the number written down
was a transposition. It is recorded here rather than quietly fixed because **a
transposed digit in a measurement sentence is indistinguishable, to a reader, from a
fabricated one**, and the only defence is that both are visible.

## Fires-in-how-many-files, measured — and a fourth stale number

A count of edges does not say how widely a type fires, and this document had been
carrying the `uses` **file** count from the wrong instrument. `609` was the number of
files containing a `message_or_enum_type` node, which is the construct probe's
population — a *different* set from the files `uses` edges actually fire in. A file that
declares a message with no field of message type emits no `uses` edge while still holding
the node, so the construct count is not a firing count.

Measured per type over all 821 files on the analyzer-direct path:

| type | edges | files |
|---|---|---|
| `contains` | **41,100** | **814** |
| `uses` | **13,275** | **675** |
| `imports` | 1,561 | 557 |
| `exports` | 4 | 4 |
| `overrides` | 1 | 1 |

`contains` reads 41,100 here against **40,098** through production, and the 1,002
difference is the same name-length drop this document has recorded since pass 2 — 1,001
of them field `contains` edges in two `pb-reference` files. `uses` reads the same 13,275
on both paths.

**675 is corroborated by a second instrument that shares no code with the one that
produced it**: the `protoc` oracle's own header field `corpusFilesWithUsesEdges` reads
**675**, from the TSV dump rather than from a tree walk. So this is two instruments
agreeing against one stale sentence in this document, which is the same shape as the
`unpublished-uses-targets` correction above and the reason both are written down rather
than quietly edited.

## DERIVATION findings: 4, unchanged

No oracle was added and none was removed, so the count is the same four, with the same
counts: `contains` 40,098, `imports` 1,561, `exports` 4, `overrides` 1. `uses` remains
adjudicated by `protoc` 36.2 at **99.6267% over 11,250 edges**, re-measured here. The
three descriptor-readable ones are still not written; that is a statement about this
lane's remaining session, not about the difficulty.

What changed is one precondition of the claim: **`uses` is the only type in this lane
whose correctness rests on an implementation that shares no code with this one.** The
other four rest on hand-derived expectations and a 28-mutant battery, and this pass
re-ran that battery at HEAD rather than citing it.

## Pass 9 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; 13,275 / 40,098 / 1,561 / 4 / 1; 54,939; 0 empty names; 0 bad kinds; 0 `unknown`; 0 self-loops; **0** under 0.7 |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, `analyzerStableDuringRun`** |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / 0 failed / 0 degraded; `uses` 1,461 ambiguous + 49 unbound + 4 hopeless; 38,551 ids, 2,702 published by >1 file |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types; all 5 rulings re-probed, still **0**; `block_lit` histogram `{constant: 1909}` |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run (c) `emitted 5/10 ruled-sound 5 FALSIFIED 0` **exit 0**; runs (a)/(b) `FALSIFIED 2`, **exit 1** |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 1** — `ruled-sound 3 FALSIFIED 2`, both rows the missing `LANGS` entry |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **9 pass / 0 fail** |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **28 caught / 0 survived** |
| `npx tsx script/m14/tmp/protobuf/probe/scope-fix-ab.mts` | 821 files, 13,275 edges both arms, **6 moved, 0 added, 0 removed** |
| `npx tsx script/m14/tmp/protobuf/probe/nested-extend-scope.mts` | **PASS** — 3 shapes, ownership unchanged |
| `npx tsx script/m14/tmp/protobuf/probe/extend-member-id-collision.mts` | **0 of 821** files publish any id twice |
| `npx tsx script/m14/tmp/protobuf/probe/unpublished-uses-targets.mts` | **20 targets / 53 edges** — 17 + 3, every one listed above |
| `npx tsx script/m14/tmp/protobuf/probe/store-binding.mts` | 3,075 edges, **3,012 walkable back (97.95%)**, 2,977 provably the one named (96.81%) |
| `npx tsx script/m14/tmp/protobuf/probe/lost-parse-locality.mts --scope=all --rounds=8` | **3 of 8 rounds** lossy; spread **53 symbols / 76 edges**; **4 of 5 losses outside `expr/`** |
| `protoc-oracle.py --protoc /tmp/opencode/protoc-36/bin/protoc` | **libprotoc 36.2**; 11,250 judged, **11,208 AGREE (99.6267%)**, 42 WRONG-NAME; 35 files rejected, 1,099 edges unadjudicated |
| `npx tsx script/m12/verify-regex-census.ts` | **regex census gate PASSED** — 0 protobuf rows |
| `npx tsx script/m14/verify-honesty.ts` | exit 6 — **0 findings in any protobuf file**; every finding is another lane's fixture or a milestone baseline whose declared inputs moved under the merge |

## One probe in this lane was not reproducible from a clean checkout

`probe/scope-fix-ab.mts` prices the nested-`extend` scope fix by running two arms of the
analyzer side by side, so it needs the **pre-fix** analyzer as a second import. That blob
was a file a human had to remember to create first. Pass 9 deleted it, ran the probe, and
got:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/…/src/ast/_ab-before-protobuf-analyzer'
  imported from …/probe/scope-fix-ab.mts
```

The named module appears in no source file in the repository, so the error reads as a
broken probe rather than a missing step — and the probe had been quoted in three gate
tables across three passes as a reproduction command. The count it produced was never in
doubt; the ability to produce it again was.

The probe now materialises the arm itself from git, pinned to `dd6b42bc6^`, and defers
the import until the file exists — a static import cannot do this, because it is resolved
before any statement in the module runs. Verified by deleting the blob and running it
cold:

```
$ rm -f src/ast/_ab-before-protobuf-analyzer.ts
$ npx tsx script/m14/tmp/protobuf/probe/scope-fix-ab.mts
files            821
before arm       dd6b42bc6^ (written from dd6b42bc6^)
uses edges       before 13275   after 13275   delta 0
targets MOVED    6
edges added/removed 0
```

**This is the same failure shape twice**: a measurement that cannot be re-run reads as a
measurement that was never taken, and the only symptom is an error message about a path.
Pass 8 found the same thing in the census, which reported a lost parse as `ok`. The
generalisation this lane keeps arriving at is that **an instrument has to fail loudly on
its own missing input**, and "missing" includes its own prerequisites.

## Declared limitations, pass 9

- **The band is the reason two of this lane's own gate rows disagree.** Two runs at one
  commit read 13,275 and 13,267 `uses` edges, and nothing in either output says why. A
  consumer that diffs two protobuf runs needs the parse-loss rate, not just the totals.
- **`overrides` rests on one syntax-highlighting fixture in a file `protoc` rejects.** 1
  edge, 1 file, out of 821. It is a true statement about the text and there is no
  corroborating instance anywhere in the corpus.
- **`exports` rests on 4 occurrences in 4 files**, all in `pb-reference`, and `imports`
  and `exports` resolve 0% against symbols by design because their endpoints are module
  paths. Their correctness claims are weaker than `contains` by construction.
- **4 of 5 types are compared against nothing but this lane's own expectations.** The
  `protoc` oracle reads a descriptor it already parses and `contains` / `imports` /
  `exports` are readable from it; those three checks are **not written**. Until they are,
  a defect in them would be invisible to every instrument this lane owns — which is
  exactly the failure mode `overrides` had in pass 2.
- **One shared line stands between this lane and a passing arbiter**, and it is in a
  file this lane does not own. The lane's own numbers do not depend on it: runs (b) and
  (c) above differ only in whether the arbiter reads bash's grammar.

---

# PASS 10 — three of the four DERIVATION findings paid down, and the oracle found a phantom type

Pass 9 ended with this lane's sharpest outstanding weakness stated in its own
limitations: *"4 of 5 types are compared against nothing but this lane's own
expectations… a defect in them would be invisible to every instrument this lane owns —
which is exactly the failure mode `overrides` had in pass 2."* This pass built the
missing instrument, and it found a defect on its first reading of the corpus.

## The instrument, and what each of the three types costs to read from it

`protoc` is already this lane's oracle for `uses`. The same `FileDescriptorProto`
answers the other three emitted types by **direct field read, with no interpretation**:

| type | descriptor field | what the descriptor states |
|---|---|---|
| `contains` | the containment tree itself | `message_type[].nested_type`, `.field`, `.oneof_decl`, `enum_type[].value`, `service[].method`, and `extendee` for an extension |
| `imports` | `FileDescriptorProto.dependency` | the import paths **as written**, in order |
| `exports` | `FileDescriptorProto.public_dependency` | repeated int32 **indices into** `dependency` |

`exports` reading a *different field* from `imports` is the point, not an
implementation detail: an `import public` is one dependency **plus** one index, so
the dependency and the republication are two facts. That is why this lane emits both
edges for a public import, and it is now read from `protoc` rather than argued.

The instrument is `script/m14/tmp/protobuf/probe/protoc-descriptor-oracle.py`, and
its input is `probe/dump-contains-io.mts`, which dumps the three types off production
`parseFile`. It shares **no code** with the analyzer: one side is a string helper over
a vendored patched tree-sitter grammar, the other is the C++ reference compiler's own
data structure. It **imports** `protoc-oracle.py`'s include-root discovery rather than
copying it, for the reason that file's `load_shared` docstring gives — the delicate
part of running `protoc` over 18 real repositories is deciding which `-I` roots to
hand it, and two include-root policies would make a disagreement between them
indistinguishable from a disagreement about protobuf.

### Five conventions the oracle adopts, each a place a disagreement would be invisible

An oracle that quietly adopts the analyzer's conventions agrees by construction. Each
is named in the file's header and each is a shared assumption:

1. **Top-level ownership is the package.** `protoc` has no notion of "a top-level
   declaration is contained by the file"; the descriptor's containment starts at the
   package. A file with **no** package therefore contributes no top-level `contains`
   edge on either side — and the corpus contains such files, so this is load-bearing.
2. **A group's type is the message a `TYPE_GROUP` field names**, read from
   `field.type` and never from a name.
3. **`options.map_entry` messages are excluded** — `protoc` synthesizes one per
   `map<K,V>` field and nobody wrote it. **840** of them in this corpus, counted.
4. **An extension member belongs to its extendee**, from `extendee`.
5. **The `#<kind>` id suffix is stripped on a `field` row only**, and the stripped rows
   are reported. See "a stripping collision" below for why that qualifier is load-bearing.

## What it measured, with the denominator stated

821 `.proto` files in 18 repositories, walked as a working tree, uncapped. **781
compiled** by libprotoc 36.2; **37 rejected**, each reported with its first stderr line
and excluded from every rate rather than skipped quietly. 16 rejection reasons; the
largest classes are 5 × `no directory in the corpus provides
github.com/planetscale/vtprotobuf/…`, 5 × `…/docker/swarmkit/api/types/…` and 4 ×
`etcd/api/mvccpb/kv.proto` — vendored dependencies this corpus does not carry.

| type | edges in the dump | **judged** | agree | disagree | in a rejected file |
|---|---|---|---|---|---|
| `contains` | 40,098 | **37,042** (92.4%) | **36,022** | 1,020 | 2,390 |
| `imports` | 1,561 | **1,442** (92.4%) | **1,442** | **0** | 110 |
| `exports` | 4 | **4** (100%) | **4** | **0** | 0 |
| total | 41,663 | **38,488** (92.4%) | **37,468** | 1,020 | 2,500 |

`imports` and `exports` are **exact**: 1,442 of 1,442 and 4 of 4, no disagreement, no
label question. `contains` agreement is **36,022 / 37,042 = 97.24%**, and the 1,020
disagreements are not findings — see the four named classes below, one of which
contains **0**.

## `unexplained` is the number that has to be zero, and it was 7

The oracle partitions the residual by rules stated in the file, retains every row, and
reports an `unexplained` bucket for whatever those rules cannot account for. Both
directions are partitioned, so a disagreement cannot be hidden by being on the side
with fewer rows.

| class | before the fix | after | the rule |
|---|---|---|---|
| `DROPPED-BY-PIPELINE-NAME-LENGTH` | 1,002 | 1,002 | target leaf > 80 chars, `src/ast/pool-worker.ts:653`, or target > 200, `:643` |
| `GROUP-FIELD-SPELLING` | 16 | 18 | `protoc` records a group's field name lowercased; this analyzer spells it with the group's **declared** name |
| `GROUP-TYPE-SCOPE` | 0 | 0 | — |
| **`unexplained`** | **7** | **0** | — |

The 1,002 is worth pausing on: this document has carried "1,002 edges are produced by
the analyzer and not kept by production" since pass 2, arrived at by differencing an
analyzer-direct run against a `parseFile` run. The oracle arrives at the same 1,002
from the opposite direction — the descriptor's idea of what should exist, minus what
the pipeline's cited length rule keeps. Two routes, one number.

## The defect: a group's type was owned by the extendee

The 7 unexplained rows were one bug.

```proto2
// pb-reference/src/google/protobuf/test_messages_proto2.proto, package protobuf_test_messages.proto2
extend TestAllTypesProto2 {
  optional group GroupField = 121 {
    optional int32  group_int32  = 122;
    optional uint32 group_uint32 = 123;
  }
}
```

| | answer |
|---|---|
| `protoc` | the group's **type** is `protobuf_test_messages.proto2.GroupField`, a **top-level message**; the extension `groupfield` carries `extendee = .…TestAllTypesProto2` and `type_name = .…protobuf_test_messages.proto2.GroupField` |
| analyzer, before | a nested type `protobuf_test_messages.proto2.TestAllTypesProto2.GroupField`, its two members under it, and the extension field naming it |

The extendee owns the block's **fields**. It does not own the **types those fields
declare**, and `extend` opens no scope — the group's type belongs where the block is
*written*. The pre-fix analyzer published a nested type that no compiler defines and
put four edges into it. `unittest_custom_options.proto` has the same construction
(`optional group ComplexOpt6 = 7595468` in a file-scope
`extend google.protobuf.MessageOptions`) and contributed 3 more.

Same defect class as pass 8's nested-`extend` scope fix, one level out: `Ctx.owner`
(the extendee) and `Ctx.scope` (the lexical position) are equal everywhere except
inside an `extend`, and pass 8 found them differing for a *reference*; this pass found
the group's own **declaration** using the wrong one.

**The fix, measured on both arms with one instrument:**

| | before | after |
|---|---|---|
| `contains` agree | 36,017 | **36,022** |
| `unexplained` | **7** | **0** |
| corpus `contains` edges moved | — | **7**, in 2 files |
| edges added / removed | — | **0 / 0** |
| rows carrying the `#property` id suffix | 30 | **28** |
| `contains` both-end resolution | 39,786 | **39,787** |

The 7 rows, every one:

```
test_messages_proto2.proto     protobuf_test_messages.proto2 -> …TestAllTypesProto2.GroupField   [groupType]
test_messages_proto2.proto     …GroupField -> …GroupField.group_int32                             [field]
test_messages_proto2.proto     …GroupField -> …GroupField.group_uint32                            [field]
test_messages_proto2.proto     …TestAllTypesProto2 -> …TestAllTypesProto2.groupfield              [field]
unittest_custom_options.proto  proto2_unittest -> proto2_unittest.ComplexOpt6                     [groupType]
unittest_custom_options.proto  ComplexOpt6 -> ComplexOpt6.xyzzy                                   [field]
unittest_custom_options.proto  google.protobuf.MessageOptions -> …MessageOptions.complexopt6      [field]
```

The `#property` suffix drops from 30 to 28 because hoisting the type **separated** the
two colliding ids — the suffix existed only to keep a group's field and its type apart
in the same owner, and in these 2 rows they are no longer in the same owner.

**One number moved by 1 and it understates the fix.** Both-end resolution rose by a
single edge out of 40,098, because the phantom type *was* a published id: it resolved
before and it resolves now, to a different declaration. A resolution count cannot see
"resolves to the wrong declaration" — only the oracle could, and it did.

## A second, independent confirmation, through code that shares nothing

The defect was also visible to the **existing** `uses` oracle — once that oracle was
able to see a group's field at all. It could not, and admitting `TYPE_GROUP` alone was
**necessary and not sufficient**, which is the more useful half of this measurement:

| change to `protoc-oracle.py` | judged | notAType | wrongName |
|---|---|---|---|
| as pass 9 shipped it | 11,250 | 909 | 42 |
| + admit `TYPE_GROUP` | **11,250** | **909** | **42** |
| + key a group row on its declared name | **11,260** | **899** | **42** |

The middle row is the finding. `protoc` keys a group's row by its own `name`
(`optional group Item = 1` → `name = "item"`) while this analyzer spells it `Item`, so
every group edge missed a key it was never compared on and landed in `notAType` — the
class the oracle **excludes from its rate**. All 10 group `uses` edges in the corpus
were silently unjudged. The declared name is in the leaf of `type_name`, which
`protoc` needed in order to resolve the type, so `row_name` reads it there.

With the rows finally judged, the `uses` oracle reads the same defect from
`type_name`, a field the containment-tree oracle never looks at:

| metric | pre-fix | post-fix |
|---|---|---|
| judged | 11,260 | 11,260 |
| agree | 11,216 | **11,218** |
| **wrongName** | **44** | **42** |

Exactly **2 verdict flips and 0 new ones**, both shape `same-leaf-different-package` —
the signature of a phantom nested type:

```
google.protobuf.MessageOptions.ComplexOpt6        <- protoc: proto2_unittest.ComplexOpt6
protobuf_test_messages.proto2.TestAllTypesProto2.GroupField  <- protoc: protobuf_test_messages.proto2.GroupField
```

Two oracles, two different descriptor fields, zero shared code, one finding.

## Three defects in the oracle itself, each caught because the number was absurd

An instrument that reports a wrong number confidently is worse than no instrument, so
these are recorded with the symptom that exposed each. **All three were found by the
oracle disagreeing with itself across runs, not by argument.**

1. **Member targets were the bare leaf.** The descriptor stores a member's own name
   and its owner separately; the oracle emitted `request_type` where the analyzer
   publishes `UnknownRequest.request_type`. It reported **29,391 ORACLE-ONLY rows**.
   The number is the defense: a convention error that large cannot be mistaken for a
   finding.
2. **`protoc`'s synthetic oneofs were emitted as real ones.** A `oneof_decl` whose
   member carries `proto3_optional` is created by `protoc` per proto3 `optional` field
   and named `_` + the field name. `_MaxRequestHeadersKB` appears in this corpus only
   inside a generated `.pb.go`, never in a `.proto`. Read from the descriptor rather
   than from the `_` prefix: **103** excluded, which is also why the analyzer's 299
   `oneof` edges and `protoc`'s 278 declared oneofs reconcile to 278 + 103 + 18
   spelling rows.
3. **Hoisted groups were labelled `nestedType`.** The only evidence that a top-level
   message is a group is the `TYPE_GROUP` **extension** pointing at it — not that
   message's own `field` list — so reading only `m.field` reported the analyzer's
   correct `groupType` as a mislabel on exactly the 2 hoisted groups. `LABEL` went
   2 → 0.

And one defect in the **comparison**, which is the same shape as (1) in a different
place: the `#property` suffix was stripped on every row, so a group's field row's base
(`…Item`) collided with its type row's base (`…Item`) and the two merged into one key
carrying two labels. It reported **8 `analyzer 2, protoc 1` rows on a corpus where
every one of the 8 is a correct edge.** Stripping is now confined to `field` rows,
where the suffix is a disambiguator for a known collision, and a suffix on any other
row is reported rather than resolved.

## What the corpus cannot see, and why the fixture is not redundant

The corpus contains **10** `groupType` edges: **2** in a file-scope `extend` block
(their type's owner is the package), **8** directly in a message body (their type's
owner is that message), and **0** in an `extend` block nested inside a message.

So the mutant *"always hoist a group's type to the package"* scores **the same 36,022
of 37,042 and the same `unexplained` 0** as the correct analyzer on every file in the
corpus, while being wrong on every group written in an in-message `extend` block. A
corpus measurement cannot see it and no amount of corpus would. That is the measured
reason a fixture exists alongside a corpus oracle, and it is stated here because
quoting the corpus number as though it covered this would be the same mistake in a
different place.

`protobuf/group-in-extend-scope` therefore pins the rule in **three** directions,
because any two can be satisfied by a rule that is wrong in the third:

| row | shape | pre-fix answer |
|---|---|---|
| 1 | group in a **file-scope** `extend` — the corpus defect | `gie.demo.Target.Hoisted` |
| 2 | group in an `extend` **nested inside a message** | `gie.demo.Outer.Holder.Inner` |
| 3 | group **already inside its owner** — the control | correct, and unchanged |

Every row is adjudicated by `protoc` 36.2 **on the fixture file itself**: a top-level
message `gie.demo.Hoisted`, a nested message `gie.demo.Outer.Inner`, a nested message
`gie.demo.Plain.Innermost`, and three extensions with the `(extendee, type_name)`
pairs the fixture asserts. ROW 2 also rules out "always the package"
(`gie.demo -> gie.demo.Outer.Inner` is an explicitly forbidden row) and ROW 3 rules out
"hoist on every `group` node". Measured falsification: the pre-fix analyzer differs
from the post-fix one on **exactly 7 of the fixture's 19 edges**, all in ROWS 1 and 2,
and ROW 3's 4 edges are byte-identical in both arms.

## DERIVATION findings: 4 → 1

| type | before | now | adjudicated by |
|---|---|---|---|
| `contains` | 40,098 | adjudicated | `protoc` descriptor, 36,022/37,042 agree, `unexplained` 0 |
| `imports` | 1,561 | adjudicated | `protoc` `dependency`, **1,442/1,442** |
| `exports` | 4 | adjudicated | `protoc` `public_dependency`, **4/4** |
| `overrides` | 1 | **still a finding** | — |
| `uses` | adjudicated | adjudicated | `protoc` `type_name`, 11,218/11,260 |

`overrides` cannot be adjudicated this way and the reason is structural: **no
descriptor field records that a field number was declared twice**, and `protoc`
**rejects** the construct — its one corpus instance is
`nvim-treesitter/tests/query/highlights/proto/test.proto`, a syntax-highlighting
fixture in a file `protoc` refuses. There is no descriptor to read. It remains this
lane's **one** DERIVATION finding, resting on 1 edge in 1 file out of 821, and that
is stated at every place the count appears.

## Mutants: 28 → 30, 30 caught, 0 survived

| mutant | caught by | corpus-visible? |
|---|---|---|
| `protobuf/group-type-owned-by-the-extendee` | `protobuf/group-in-extend-scope` **only** | yes — `unexplained` 7 vs 0 |
| `protobuf/group-type-hoisted-to-the-package` | `group-in-extend-scope`, `extend-and-group` | **no** — identical corpus score |

The first mutant is caught by exactly one fixture and by nothing else, which is the
measure of that fixture's load. The second is caught by two fixtures and by **0** of
821 corpus files, which is the measure of the gap the corpus leaves.

## Pass 10 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; 41,955 symbols / 54,939 edges through `parseFile`; 13,275 / 40,098 / 1,561 / 4 / 1; 0 empty names; 0 bad kinds; 0 `unknown`; 0 self-loops; **0** under 0.7 |
| `npx tsx script/m14/tmp/protobuf/probe/dump-contains-io.mts` | 40,098 / 1,561 / 4, reproducing the census from a separate walk; member labels `field` 26,647, `nestedType` 8,623, `oneof` 299, `enumValue` 2,967, `rpc` 1,552, `groupType` 10 |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 821 parsed / 0 failed / 0 degraded; `uses` 1,461 ambiguous + 49 unbound + 4 hopeless; 38,551 ids, 2,702 published by >1 file; `contains` in-file-both 39,787 |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types; all 5 rulings re-probed, still **0**; `block_lit` histogram `{constant: 1909}` |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files, `analyzerStableDuringRun`** |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run (c) `emitted 5/10 ruled-sound 5 FALSIFIED 0` **exit 0**; runs (a)/(b) `FALSIFIED 2`, **exit 1** |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 1** — `ruled-sound 3 FALSIFIED 2`, both rows the missing `LANGS` entry, unchanged |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **10 pass / 0 fail** |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **30 caught / 0 survived** |
| `npx tsx script/m12/verify-regex-census.ts` | **regex census gate PASSED** — 0 protobuf rows |
| `protoc-descriptor-oracle.py` | **unexplained 0**; `contains` 36,022/37,042, `imports` 1,442/1,442, `exports` 4/4; 781 compiled, 37 rejected |
| `protoc-oracle.py --protoc /tmp/opencode/protoc-36/bin/protoc` | **libprotoc 36.2**; 11,260 judged, **11,218 agree**, 42 wrong-name; 899 not-a-type; 35 files rejected, 1,099 unadjudicated |
| `npx tsx script/m14/verify-honesty.ts` | 26 failures, **0 in any protobuf file** — every one another lane's fixture, a milestone artifact whose declared inputs moved under the merge, or the shared freshness rule that flags all 9 artifacts |

### One gate row that is a loss, not a pass

`firing-check.ts` still reports **3/10 fired, 10/120 files**, unchanged across nine
passes, and this pass did not move it. The arbiter's sampler offers 120 `git
ls-files` paths of which **110 are not on disk** (8,524 offered, 821 on disk,
7,703 not), so it reads 10 files and draws a verdict from them. That is the
supervisor's instrument and its sample; the lane's own census walks all 821. Stating
it as 3/10 without that sentence would misrepresent a sampler artifact as a property
of protobuf.

### One run of this pass's own census was lossy, and is not quoted

The first `protobuf-census.ts` invocation in this pass reported `contains` 40,089 and
41,945 symbols, with `files the analyzer read and production published NOTHING for: 1
— pb-googleapis/google/api/expr/v1beta1/source.proto: analyzer 10 symbols / 9 edges,
production 0 / 0` and a `[BB-HANG]` line. **Analyzer-direct was unchanged at 41,956 /
55,941**, so the loss is in production, not in the analyzer: 10 symbols and 9 edges,
exactly the shortfall. The second invocation read the clean figures in the table
above. This is the band pass 9 measured, in the locality pass 9 recorded.

## Files this pass owns

| file | lines | what |
|---|---|---|
| `src/ast/real-protobuf-analyzer.ts` | +53 / −6 | a group's type takes `Ctx.scope`, its field keeps `Ctx.owner` |
| `script/m14/tmp/protobuf/probe/protoc-descriptor-oracle.py` | 617 | new: `contains` / `imports` / `exports` against `protoc`'s descriptor |
| `script/m14/tmp/protobuf/probe/dump-contains-io.mts` | 108 | new: dumps the three types off `parseFile`, with the `member` label |
| `script/m14/tmp/protobuf/probe/protoc-oracle.py` | +32 | `TYPE_GROUP` admitted; `row_name` reads a group's declared name off `type_name` |
| `script/m14/protobuf-mutants.ts` | +160 | 2 mutants for the new rule |
| `validation/m14/fixtures/protobuf/group-in-extend-scope.proto` | 99 | new: 3 rows, adjudicated by `protoc` |
| `validation/m14/fixtures/protobuf/group-in-extend-scope.expectation.json` | 55 | new |

## §8 items, restated so they can be applied without re-deriving them

Unchanged from pass 9, and still **one line**:

> `script/m14/differential.ts` — add to `LANGS`:
> `protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },`
> Why: until this exists, both of the arbiter's instruments read bash's grammar and
> report two of this lane's five rulings as FALSIFIED. Proof it is sufficient and
> necessary: runs (b) and (c) above. All four values are already carried at
> `script/m14/run-fixtures.ts:91`.

**One new item, and it is an observation rather than a request.** Other lanes register
lane-owned oracles in `script/m14/oracles/` (`julia-overrides.ts`,
`css-overrides.ts`). This lane's two oracles live in
`script/m14/tmp/protobuf/probe/`, beside the census and the fixtures' probes, because
`protobuf` is absent from `differential.ts`'s `LANGS` and so no discovery mechanism
would find them there either. If the `LANGS` line above is applied, moving
`protoc-descriptor-oracle.py` and `protoc-oracle.py` into `script/m14/oracles/` is
what would let the shared harness invoke them. **This lane has not made that move**,
because the path is the supervisor's to choose and a half-moved oracle is an oracle
nobody runs.

One item for the corpus, not for code: **16 rejection reasons name a vendored
dependency this corpus does not carry** (`vtprotobuf`, `docker/swarmkit`,
`etcd/api/*`, `xds/data/orca/v3/orca_load_report.proto`), which is why 37 files and
2,500 edges are outside the descriptor oracle's reach. Cloning those four upstreams
would take `contains` coverage from 92.4% to ~98% and would put
`xds.data.orca.v3.OrcaLoadReport` — one of this lane's 4 hopeless `uses` targets — inside
the judge's reach. Disk is tight and the task caps the corpus at ~8 GB, so this is
reported rather than done.

## Declared limitations, pass 10

- **The oracle judges 92.4% of the three types' edges, not 100%.** 2,500 edges in 37
  files sit in files `protoc` refuses, 16 reasons, dominated by vendored dependencies
  this corpus does not carry. They are excluded from every rate and listed, not
  dropped. A defect confined to those 37 files would be invisible here — and 4 of the
  5 EMITTED types would be unadjudicated on 6.2% of their edges.
- **`contains`'s 1,020 residual disagreements are all in two named classes, and one of
  the four classes is empty.** A reader who wants only "what is wrong" should read
  `unexplained`: it is 0. The 1,002 name-length rows are a **shared pipeline** rule
  (`src/ast/pool-worker.ts:653`), not this analyzer's, and are a §8 item for whoever
  owns that threshold — 1,001 of them are field `contains` edges in 2 `pb-reference`
  files whose identifiers are 112–1,000 characters.
- **`GROUP-FIELD-SPELLING` is a declared convention difference, not a fix.** This
  analyzer publishes a group's field under the group's **declared** name (`Item`);
  `protoc` records `item`. 9 groups, 18 rows. The analyzer's spelling is what the
  source says and what its `uses` edge pairs against, so changing it would break the
  pairing and the 28 remaining `#property` rows. Both spellings resolve; they differ.
- **The 18 group `uses` edges are newly judged and newly all agree, and that is a
  change to the ORACLE, not a change in what was previously known.** Pass 9's
  "11,250 judged, 99.6267%" was correct **for the rows it could see** and silent about
  10 edges it could not. The rate moved 99.6267% → 99.6270% and the wrong-name count
  is what carries the finding (44 → 42).
- **`overrides` is still unadjudicated**, for the structural reason above, and its
  entire corpus support remains 1 edge in 1 file that `protoc` rejects.
- **`firing-check.ts` still reports 10/120 files**, and this pass did not move it.
- **The corpus cannot see a group's in-message `extend` scope, and no re-run of this
  corpus will.** That is a property of the corpus, measured above, and it is why
  ROW 2 of the new fixture exists.

# PASS 11 — the band finally has a cause, and it is not this analyzer

Nine passes have quoted a band on every production-side count and none of them could
say what caused it. Pass 7 named a suspect directory. Pass 8 measured the band at 19
rounds. Pass 9 falsified the locality. Every one of those instruments asked **where**
the loss landed and none asked **what produces it**. This pass built the instrument that
asks the second question, and the answer is that the loss is not a property of any
protobuf file.

## The question, stated so that it can be answered no

The fault is `[BB-PARSE-ERR] protobuf | <file> | memory access out of bounds`. Two
causes fit every observation in nine passes of documentation, and they call for
opposite repairs:

| | cause | what it implies | whose file |
|---|---|---|---|
| **A** | the file's CONTENT trips a wasm fault | the vendored grammar has a defect; bump it | a grammar wasm, not this lane's |
| **B** | the loss is content-INDEPENDENT and LOAD-dependent | a shared runtime arena under 8-way concurrency; the file is a victim | the pool's parser lifetime, not this lane's |

`explain.proto` is **1,725 bytes** and 52 lines of ordinary proto3 — no `group`, no
`oneof`, no editions, no aggregate literal. Whatever the cause, it is not a construct
this corpus does not otherwise contain, and size is excluded by the file being tiny.

The instrument is `script/m14/tmp/protobuf/probe/parse-loss-isolation.mts`. It parses
the seven files nine passes have each named as lost under three regimes that differ
only in load — `--mode=alone-fresh` (one file, a new parser per repetition, width 1),
`--mode=alone-shared` (one file, one parser reused), `--mode=census` (the file inside
the census's own width-8 population of all 821).

## What it measured: 0 alone, 3 in 8,210 under load

| regime | file-parses | losses | rate |
|---|---|---|---|
| `alone-fresh`, width 1, fresh parser | **280** (7 files × 40) | **0** | 0% |
| `alone-fresh`, width 1 (sanity re-run) | 35 | **0** | 0% |
| `census`, width 8, whole corpus | **8,210** (10 rounds × 821) | **3** | **0.0365%** |

Every one of the 3, with the analyzer's own symbol count for the file, which is what
makes it a loss rather than an empty file:

| file | rounds lost | analyzer symbols |
|---|---|---|
| `docker/extpoints/servicenamegenerator/v0/service_name_generator.proto` | 1 of 10 | 8 |
| `docker/vendor/github.com/containerd/cgroups/v3/cgroup1/stats/metrics.proto` | 1 of 10 | 115 |
| `pb-reference/src/google/protobuf/source_context.proto` | 1 of 10 | 3 |

**Verdict: cause B, and cause A is excluded by the alone arm rather than argued
away.** The files that fail under load were parsed **315 times each-batch at width 1
without a single failure**. If the fault were a property of those bytes it would fire
alone. It does not fire alone, ever, and it fires at ~0.04% under concurrency — which
is the signature of a random per-parse event in shared runtime state.

## The locality hypothesis does not reproduce, on a 23× larger sample

Pass 7 proposed `pb-googleapis/google/api/expr/` as the suspect directory, from six
losses observed there. **In this pass's 8,210 census file-parses, 0 of the 3 losses
are in that directory.** Counting every loss observed in this session, across five
separate runs and two instruments:

| repository | losses observed | how observed |
|---|---|---|
| `docker` | 4 | journal (2) + a killed run's stderr (1) + the 8-round run (1) |
| `boundary` | 5 | the 8-round run, 5 distinct `services/v1` files, 1 each |
| `pb-reference` | 3 | journal (1) + a killed run's stderr (2) |
| `kubernetes` | 3 | a killed run's stderr, 3 distinct `staging/…/generated.proto` |
| `terraform` | 1 | the 8-round run, `tfplugin6.proto`, 504 symbols |
| **`pb-googleapis/google/api/expr/`** | **0** | in 8,210 file-parses this pass |

Five repositories, eleven losses, one fault string. The directory pass 7 named is not
where the loss is; it is where pass 7 happened to look first, and 11 of 821 files is
0.85% of the corpus, which is not distinguishable from a uniform rate at these counts.

## The rate is not stable either, and that is the same finding

Two runs of the same instrument over the same 821 files, same commit:

| run | file-parses | losses | rate |
|---|---|---|---|
| 8-round run | 6,568 | 7 | **0.107%** |
| journal run | 8,210 | 3 | **0.0365%** |

A 2.9× spread between two runs of one instrument on one corpus, on a machine twenty-three
agents are sharing. A defect in the grammar would not vary with the weather; an arena
under contention would. **This is the observation that makes the band un-shrinkable by
adding corpus**: the quantity that moves is not a property of the protobuf files, so no
corpus size retires it.

## Two defects in the instrument that produced those numbers

Recorded with the symptom that exposed each, because both produced a confident wrong
number first.

1. **A `syms > 0` criterion scored an empty file as 8 failures in 8 rounds.**
   `pb-reference/src/google/protobuf/unittest_empty.proto` is 593 bytes of licence
   header and `syntax = "proto2";` with **nothing declared**, so zero symbols is the
   correct answer for it and `production.symbols.length > 0` counted the correctness as
   a fault. The symptom was the shape: one file failing **8 of 8** when every genuine
   loss in the corpus failed 1 in 10. Corrected to the comparison this lane already
   established in `lost-parse-locality.mts` — a loss is *the analyzer finding symbols in
   bytes production published nothing for* — and the independent
   `dump-contains-io.mts` probe names the same file as the corpus's one file with no
   production symbols, which is the corroboration.
2. **`appendFileSync` returns an fd, not a stream.** The first journal implementation
   wrote rows with `journal.write(...)` on that fd, which silently wrote **nothing**: 1,642
   file-parses were measured and the journal held 1 byte. Fixed to `openSync` +
   `writeSync`, which is one open for the run and puts every row on disk at the moment it
   is measured. The property that matters is not tidiness — it is that **the probe is
   killed by the fault it measures** (`parseFile`'s 120s watchdog prints `[BB-HANG] …
   — exiting` and calls `process.exit`, which no `finally` survives), so without a
   durable journal a long run's totals die with it. Two full runs were lost this way
   before the journal existed; after it, a run killed at exit 1 still left all 1,642 rows.

## A probe in this lane was aimed at the `node` binary

`script/m14/tmp/protobuf/probe/dump-contains-io.mts:48` read its output path as

```ts
const at = (f: string): string => process.argv[process.argv.indexOf(f) + 1]
```

`indexOf` is `-1` for an absent flag, so this evaluated `process.argv[0]` — **the path
to the `node` executable** — and returned it. Truthy, so the `??` default never fired,
and `writeFileSync(OUT, …)` aimed a 41,663-line dump at the running interpreter. It
surfaced only as `ETXTBSY: text file is busy`, and only because `node` happened to be
executing; a run where it was not would have truncated the interpreter.

**The consequence for this lane's own record: the pass-10 gate-table row that quotes
this probe as `npx tsx script/m14/tmp/protobuf/probe/dump-contains-io.mts` — no
`--out`, exactly as printed there — does not run as written.** It crashes. The 40,098 /
1,561 / 4 figures attributed to it were produced with `--out` supplied. Fixed to guard
on `i > 0` rather than on the truthiness of the result, and the documented command now
works and reproduces those three numbers and the member-label histogram from a clean
invocation.

Seven other sites in this lane use the same `indexOf(…) + 1` idiom. All seven guard it
with `.includes(…)` first, which makes the index non-negative, so all seven are sound;
this one was the only unguarded copy.

## The corpus question, priced rather than proposed

`firing-check.ts` reports **10 of 120** files for this lane, and pass 10 attributed that
to its sampler: `filesForLanguage` builds paths from `git ls-files` and never checks the
working tree, and **110 of the 120 offered paths are not on disk**. The cause is in the
corpus, and the corpus is mine to change, so this pass measured the change instead of
restating the artifact for an eleventh time.

| measurement | value |
|---|---|
| corpus repos that are sparse checkouts | **4 of ~180** — `pb-googleapis`, `pb-grpc`, `pb-reference`, `julia` |
| `.proto` files those three TRACK | **7,984** (7,341 + 166 + 477) |
| `.proto` files those three HOLD on disk | **281** |
| mean on-disk `.proto` size | **6.6 KB** |
| so the missing working tree is worth | **≈51 MB of text** |

Trialled on the smallest repo, `git -C pb-grpc sparse-checkout disable`: 45 → **166**
on-disk `.proto` in **9.5 s**, `.git` 3.0 M → 22 M, worktree 110 M — and the corpus went
**7.9 G → 8.1 G**, over the ~8 GB cap this workstream sets, on a root filesystem that
reached **100%** during this session while other lanes cloned.

**Reverted, and the revert was verified rather than assumed**: `core.sparseCheckout` is
`true` again, the sparse-checkout file is byte-identical to the pre-trial backup
(`diff` clean), and 45 `.proto` are on disk again. The materialization is real, it is
one command per repo, and it is **reported rather than done** because it is a
corpus-size decision taken on a shared disk, not a lane's to make unilaterally.

## Everything else reproduces at HEAD, bit for bit

| measurement | pass 10 | this pass |
|---|---|---|
| analyzer-direct symbols / edges | 41,956 / 55,941 | **41,956 / 55,941** |
| `uses` / `contains` / `imports` / `exports` / `overrides` | 13,275 / 40,098 / 1,561 / 4 / 1 | **13,275 / 40,098 / 1,561 / 4 / 1** |
| `contains` member labels | field 26,647, nestedType 8,623, oneof 299, enumValue 2,967, rpc 1,552, groupType 10 | **identical** |
| descriptor oracle `contains` | 36,022 / 37,042, `unexplained` 0 | **36,022 / 37,042, `unexplained` 0** |
| descriptor oracle `imports` / `exports` | 1,442 / 1,442 and 4 / 4 | **identical** |
| `uses` oracle | 11,260 judged, 11,218 agree, 42 wrongName, 99.627% | **identical** |
| node types observed / declared | 94 / 117 | **94 / 117** |
| all 5 construct rulings re-probed | 0 | **0** |
| mutants | 30 caught / 0 survived | **30 caught / 0 survived** |
| fixtures | 10 pass / 0 fail | **10 pass / 0 fail** |
| `firing-check --files 120` | 3/10, 2,069 edges, 10/120 | **3/10, 2,069 edges, 10/120** |
| `ontology-coverage-gate protobuf` | `ruled-sound 3 FALSIFIED 2`, exit 1 | **identical**, exit 1 |
| regex census | 0 protobuf rows | **0 protobuf rows** |
| `npx tsc --noEmit` | no diagnostics | **no diagnostics** |

Two production-side numbers did move, both inside the band this pass explains, and both
on instruments that walk production:

| instrument | pass 10 | this pass | moved |
|---|---|---|---|
| `protobuf-census.ts` symbols / edges through `parseFile` | 41,955 / 54,939 | **41,948 / 54,930** | −7 / −9, one file lost to `memory access out of bounds` |
| incoming audit `contains` in-file-both | 39,787 | **39,735** | −52 |
| incoming audit `uses` cross-file-ambiguous | 1,461 | **1,460** | −1 |

The analyzer-direct totals did not move at all, which places every one of those three
deltas in the production path and in neither the analyzer nor the corpus.

## Pass 11 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; analyzer-direct **41,956 / 55,941**; through `parseFile` 41,948 / 54,930 (band); 13,273 / 40,092 / 1,560 / 4 / 1; 0 empty names; 0 bad kinds; 0 `unknown`; 0 self-loops; **0** under 0.7 |
| `npx tsx script/m14/tmp/protobuf/probe/parse-loss-isolation.mts --mode=alone-fresh --reps=40` | **0 / 280** |
| `… --mode=census --rounds=2` × 5, journaled | **3 / 8,210**, 0.0365%, 3 files, 2 repos, 3 of 3 outside the suspect dir |
| `npx tsx script/m14/tmp/protobuf/probe/dump-contains-io.mts` | 40,098 / 1,561 / 4; member labels identical to pass 10 — **and the documented no-`--out` command now runs** |
| `protoc-descriptor-oracle.py --protoc …/protoc-36/bin/protoc` | **unexplained 0**; `contains` 36,022/37,042, `imports` 1,442/1,442, `exports` 4/4; 781 compiled, 37 rejected |
| `protoc-oracle.py --protoc …/protoc-36/bin/protoc` | **libprotoc 36.2**; 11,260 judged, **11,218 agree**, 42 wrongName; 899 not-a-type; 35 files rejected, 1,099 unadjudicated |
| `npx tsx script/m14/protobuf-construct-probes.mts` | **94** observed node types; all 5 rulings still **0**; `block_lit` histogram `{constant: 1909}` |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | `uses` 1,460 ambiguous + 49 unbound + 4 hopeless; `contains` in-file-both 39,735 (band) |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **10 pass / 0 fail** |
| `bun run script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **30 caught / 0 survived** |
| `npx tsx script/m12/verify-regex-census.ts` | **PASSED** — 0 protobuf rows |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files**, analyzer digest stable |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 1** — `emitted 5/10 ruled-sound 3 FALSIFIED 2`, both rows the missing `differential.ts` `LANGS` entry |

## Files this pass owns

| file | lines | what |
|---|---|---|
| `script/m14/tmp/protobuf/probe/parse-loss-isolation.mts` | 337 | new: alone-vs-load, with a durable journal |
| `script/m14/tmp/protobuf/probe/dump-contains-io.mts` | +14 / −2 | the `indexOf` landmine, guarded |

## §8 items

Unchanged from pass 10, and the supervisor has since applied the first one:

> **APPLIED** — `script/m14/ontology-coverage-gate.ts` now imports `PROTOBUF_RULED`
> (`f20be135f`), so the arbiter reads this lane's written rulings instead of bash's.

> **OPEN, one line** — `script/m14/differential.ts`, add to `LANGS`:
> `protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },`
> Why: the gate resolves its grammar at `ontology-coverage-gate.ts:247` as
> `(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`, so with `protobuf` absent both
> grammar-inventory rulings are adjudicated against **bash's** node-type table and the
> gate reports them FALSIFIED. The gate's own detail string says so:
> `WRONG GRAMMAR — this probe was handed a tree whose root node is 'program', not
> 'source_file'`. All four values are already carried at `script/m14/run-fixtures.ts:91`.

**NEW, and it is a pool item rather than a lane item.** The parse loss measured above is
in the shared runtime, not in protobuf: ~0.04–0.11% of file-parses at width 8 return
nothing and print `memory access out of bounds`, the rate varies 2.9× between runs of one
instrument on one corpus, and the files affected are arbitrary across five
repositories. Any lane whose corpus is walked at concurrency will show the same band and
may misread it as its own. Two facts a maintainer needs, both measured here:
`parseFile`'s wasm fault is swallowed into an **empty successful parse**, so a lost file
is counted `ok` and moves no counter except a total; and the 120s `[BB-HANG]` watchdog
calls `process.exit`, which discards any in-memory tally.

**NEW, for the corpus rather than for code.** The four vendored-dependency upstreams
named in pass 10 (`vtprotobuf`, `docker/swarmkit`, `etcd/api/*`, `orca_load_report`)
would take descriptor-oracle coverage on `contains` from 92.4% toward ~98%. Pass 11 adds
the other half: the three protobuf corpus repos are **sparse checkouts holding 281 of
7,984** tracked `.proto` files, which is why the shared arbiter can only offer this lane
10 readable files in 120. Both are disk decisions against a root filesystem that reached
100% during this pass, and both are reported rather than taken.

## Declared limitations, pass 11

- **The alone arm cannot see an order-dependent fault.** `--mode=alone` fixes the
  population at one file, so a fault that needs a specific sequence of prior parses
  reads 0 there. The alone arm excludes cause A as *the file's own content*; it does not
  exclude a fault that needs a particular predecessor. Cause B is supported by the alone
  result plus the load-dependent rate, not by the alone result alone.
- **The rate is a range, not a value**, and it is quoted as one: **0.0365% – 0.107%**
  across two runs of one instrument on one corpus. Quoting either endpoint alone would
  overstate the precision, and the spread is itself the finding.
- **Ten rounds is a small sample for a 0.04% rate.** The journal makes more rounds
  cheap and they were not run here: the probe is killed by the fault it measures, and
  every extra round is another chance to be killed. 8,210 file-parses bounds the rate
  loosely; it does not pin it.
- **`unittest_empty.proto` is a declared 0-symbol file, not a coverage gap.** It is
  named here so a reader who finds it in the `dump-contains-io` "files with no
  production symbols" line knows it is the corpus testing an empty file rather than this
  lane failing to read one.
- **`overrides` remains this lane's one DERIVATION finding** and remains unadjudicable:
  no `protoc` descriptor field records a doubled field number, and `protoc` rejects the
  one corpus instance. 1 edge, 1 file, 821 files, unchanged by this pass.
- **Nothing in this pass changed the analyzer.** `src/ast/real-protobuf-analyzer.ts` is
  untouched at HEAD and every emitted-type count reproduces pass 10 exactly. The two
  findings here are an instrument and a probe, and the standing band is now attributed
  rather than merely bounded.

# PASS 12 — the 3/10 is settled: it is 10 readable files, not 3 firing types

Passes 7, 10 and 11 each recorded that `firing-check.ts --files 120 protobuf` reports
**10 of 120 files** and attributed it to the sparse checkouts without ever putting the two
numbers side by side. The workstream's standing instruction says a high score on few files
is a warning and that "the number is about the parse failures and those need their own count
before it means anything." **Those parse failures are zero.** The 10 files are the only 10
that exist.

## The two numbers, side by side, from the same production entry point

| instrument | population | files read | types fired |
|---|---|---|---|
| `firing-check.ts --files 120 protobuf` | its stride sample | **10 / 120** | **3** — `uses`, `contains`, `imports` |
| `protobuf-census.ts` | whole on-disk corpus | **821** | **5** — `uses`, `contains`, `imports`, `exports`, `overrides` |

Both drive `parseFile` from `src/ast/pool-worker.ts`. The difference is entirely the
population, and the instrument below closes the question by re-running the arbiter's own
sampler against its own readable subset.

## What the sampler actually offers

`firing-check.ts:172` `filesForLanguage` builds its path list from `git ls-files` and
never consults the working tree. Measured:

| measurement | value |
|---|---|
| `.proto` paths the corpus TRACKS, corpus-wide | **8,524** |
| paths the stride sampler OFFERS at `--files 120` | **120** |
| of those, present **on disk** | **10** |
| of those, **absent** | **110** |
| `.proto` files on disk corpus-wide | **821** (9.6% of tracked) |

The 110 absent are not spread across the corpus. They are three sparse checkouts:

| repo | tracked `.proto` | on disk | of the 110 absent |
|---|---|---|---|
| `pb-googleapis` | 7,341 | 128 | **103** |
| `pb-reference` | 477 | 108 | 6 |
| `pb-grpc` | 166 | 42 | 1 |
| `kubernetes` | 135 | 135 | 0 |
| `boundary` | 127 | 127 | 0 |
| `docker` | 109 | 109 | 0 |

Every fully-checked-out repo has **zero** absent paths. The shortfall is 100% attributable
to three repos that are partial clones.

## The arbiter's own 3/10 reproduces exactly from its own 10 files

`script/m14/tmp/protobuf/probe/firing-gap-attribution.mts` re-implements
`filesForLanguage` — same corpus walk, same `git ls-files`, same stride — then runs
production `parseFile` over the on-disk subset:

```
files parsed 10 / offered-on-disk 10, production-published-nothing 0
uses 381   contains 1671   imports 17          => 3/10 fired over 10 files
```

That is the arbiter's own verdict, reproduced from the arbiter's own readable population,
with **0 lost parses**. The `parseFile` path is not dropping files; `existsSync` is.

## The three unfired types' carrier files are all OUTSIDE the 120-path sample

The census names the files its extra types come from. None is in the sample:

| type | file | in the offered 120? | on disk? |
|---|---|---|---|
| `exports` | `pb-reference/src/google/protobuf/cpp_options.proto` | **NO** | YES |
| `exports` | `pb-reference/src/google/protobuf/json_options.proto` | **NO** | YES |
| `overrides` | `nvim-treesitter/tests/query/highlights/proto/test.proto` | **NO** | YES |

All three exist and all three fire; the stride simply never lands on them. `nvim-treesitter`
contributes **1** tracked `.proto` to the whole corpus, so a stride over 8,524 paths lands
on it with probability ~1/8,524, and the one file that carries this lane's only `overrides`
edge is that file.

**Verdict: the arbiter's 3/10 is a corpus-availability artifact, measured and reproduced,
not a firing defect.** The analyzer fires 5 types through production `parseFile` on the
821 files that exist. No round count changes this, because the missing 110 paths are not
slow — they are absent.

## The corpus price cannot be determined without paying it

Pass 11 priced the missing working tree at "≈51 MB of text" by extrapolation and reverted
the trial because the corpus crossed its ~8 GB cap. This pass tried to price it **exactly**
instead, from the sizes git already records in its tree objects:

```
git -C pb-googleapis ls-tree -r -l HEAD
```

On a `--filter=blob:none` partial clone **that command fetches every blob it prints a size
for.** It is the one git command that turns a partial clone into a full one, and it is why
the size cannot be read for free. The attempt was aborted; the three repos are
`git fsck --connectivity-only` clean and the corpus is unchanged at 8.0 G.

What IS knowable without fetching, from the 128 `pb-googleapis` files already on disk:

| measurement | value |
|---|---|
| on-disk `.proto` bytes in those 128 files | 1,049,013 (mean **8,195 B**) |
| so 7,213 missing files of the same mean, as working-tree text | **≈59 MB** |
| `.git` cost of those blobs | **unknown, and empirically not zero** |

The `.git` figure is the one that decides it, and it is the one that cannot be had. The
worktree cost is ~59 MB; the object cost requires fetching, which is exactly the
expenditure under evaluation. Root filesystem free space at the time of writing: **694 MB**,
on a volume at 100% with eight lanes cloning into it.

**Not done, and the reason is now a number rather than a caution.** Materializing all three
checkouts would add ~59 MB of text plus an unmeasured object cost to a filesystem with
694 MB free that eight other agents are also writing to, for a corpus already at its 8.0 GB
cap. That is a shared-resource decision and it is reported, not taken.

## Everything reproduces at HEAD, bit for bit

Pass 11's table re-run in this pass, unchanged:

| measurement | value |
|---|---|
| analyzer-direct symbols / edges | **41,956 / 55,941** |
| through `parseFile` (band) | 41,955 / 54,939 |
| `uses` / `contains` / `imports` / `exports` / `overrides` | **13,275 / 40,098 / 1,561 / 4 / 1** |
| both-ends resolution | `uses` **9,673 (72.87%)**, `contains` **39,787 (99.22%)**, `overrides` 1 (100%), `imports` 0, `exports` 0 |
| empty names / bad kinds / `unknown` endpoints / self-loops | **0 / 0 / 0 / 0** |
| edges under 0.7 confidence | **0** |
| fixtures | **10 pass / 0 fail** |
| `npx tsc --noEmit` | **no diagnostics** |
| `firing-check --files 120` | **3/10, 2,069 edges, 10/120 files**, analyzer digest stable |
| `ontology-coverage-gate protobuf` | **exit 1** — `emitted 5/10 ruled-sound 3 FALSIFIED 2` |

The gate run in this pass also produced, on one file, both a `[BB-PARSE-ERR] … memory
access out of bounds` and then a `[BB-HANG] parser stuck 120s` on
`pb-googleapis/google/api/expr/v1beta1/expr.proto` — the same file pass 7 named as the
suspect directory and pass 11 measured 0 losses for in 8,210 file-parses. Two different
symptoms on one file, in the directory the hypothesis pointed at, on a run that printed its
complete table before the watchdog fired. This is consistent with pass 11's finding that
the fault is a per-parse event in shared runtime state rather than a property of any
protobuf file; it is not new evidence for the locality hypothesis.

## Pass 12 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; analyzer-direct **41,956 / 55,941**; through `parseFile` 41,955 / 54,939 (band); 0 empty names / 0 bad kinds / 0 `unknown` / 0 self-loops; **0** under 0.7 |
| `npx tsx script/m14/tmp/protobuf/probe/firing-gap-attribution.mts` | 8,524 tracked / 120 offered / **10 on disk**; reproduces the arbiter's 3/10 with 0 lost parses; all 3 carrier files outside the sample |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 1** — `emitted 5/10 ruled-sound 3 FALSIFIED 2`, both rows the missing `differential.ts` `LANGS` entry |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files**, analyzer digest stable |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **10 pass / 0 fail** |

## Files this pass owns

| file | lines | what |
|---|---|---|
| `script/m14/tmp/protobuf/probe/firing-gap-attribution.mts` | 190 | new: replicates the arbiter's sampler, prices the on-disk shortfall, re-runs production `parseFile` on the readable subset |

## Declared limitations, pass 12

- **The probe replicates `filesForLanguage`, it does not import it.** `firing-check.ts` is
  shared machinery this lane does not own, so the sampler is re-implemented from its
  source. It agrees with the arbiter on all three of population, readable count and fired
  types — but agreement is evidence, not identity, and a future change to the shared
  sampler would silently diverge from this probe.
- **The `.proto` extension test is a substitute for `detectLanguageFromPath`.** The probe
  must not perturb the process the arbiter hashes, and for `.proto` the extension test is
  language-detection's whole answer. If detection ever keys on anything but the extension,
  this probe's population would differ from the arbiter's.
- **8,524 vs 8,694 tracked `.proto`.** The 8,524 is this pass's count and the 8,694 is the
  figure passes 7–11 quote. The difference is not explained and is probably a
  `ls-files`/on-disk distinction or a corpus change between passes. Neither number is
  load-bearing for any verdict here; the denominator that matters for the arbiter is the
  120 offered and the 10 readable.
- **"Not done" on the corpus is a disk decision, and disk is a shared resource.** 694 MB
  free, eight lanes writing, corpus at its 8.0 GB cap. If the supervisor clears either
  constraint the materialization is one command per repo and the arbiter's readable
  population goes from 10 to 8,524.
- **Nothing in this pass changed the analyzer.** `src/ast/real-protobuf-analyzer.ts` is
  untouched, and every emitted-type count reproduces the two previous passes exactly.

# PASS 13 — a claim inside a ruling that nobody had measured, and a 50 GB /tmp leak

Two findings. The first is in this lane's own record: an assertion carried unmeasured
across twelve passes, and the two rows it was hiding. The second is in shared machinery and
it is the largest single defect found by any lane in this workstream.

## A ruling asserted a coverage claim instead of measuring it

`script/m14/protobuf-ruled.ts`'s `instantiates` entry argues correctly that protobuf
declares rather than constructs, and then adds a second sentence:

> "The 10,166 message-TYPED DECLARATIONS the same walk counts are REFERENCES, not
> constructions … and **every one of them is already emitted as `uses`**."

The first half is an argument and reads correctly. The second half is a coverage claim, and
it had never been measured. An unmeasured coverage claim inside a ruling is the same defect
as an unmeasured count anywhere else: it is the shape that makes a settled ruling look
settled.

`script/m14/tmp/protobuf/probe/message-typed-coverage.mts` measures it, by a
correspondence rather than a name match. It takes each message-typed `type` node's row from
the parse tree and each `uses` edge's `line_number` from the analyzer — two sides that
share no code — and asks whether a declaration at row R has a `uses` edge at row R.

| measurement | value |
|---|---|
| `.proto` files on disk corpus-wide | **1,666** |
| message-typed declarations | **16,207** in 1,199 files |
| scalar-typed declarations | 27,582 |
| message-typed declaration rows | 16,204 (3 rows carry 2 declarations) |
| carrying a `uses` edge at that row | **16,202 — 99.99%** |
| carrying none | **2 — 0.01%** |

So the claim was true to four decimal places and still needed saying, because the 2 rows it
missed are the whole of the next finding.

## Both exceptions are the same construct: a custom option naming an extension type

```
pb-reference/src/google/protobuf/unittest_custom_options.proto:338  option (.proto2_unittest.complex_opt1).foo = 42;
pb-reference/src/google/protobuf/unittest_custom_options.proto:340  option (.proto2_unittest.complex_opt1).(proto2_unittest.corge).moo = 876;
```

The parenthesized name in a custom option is an **extension type** the option's value is
interpreted by, so the file references it. The analyzer reads `option` as metadata and emits
no edge naming that type. Measured corpus-wide by
`script/m14/tmp/protobuf/probe/custom-option-refs.mts`:

| measurement | value |
|---|---|
| `option` nodes | 17,822 |
| options naming an extension type | **3,081** (17.29%) |
| declaration-level (an enclosing symbol exists) | **1,408** — rpc 928, message_body 338, service 80, enum_body 60, oneof 2 |
| file-level (no enclosing symbol) | 117 |
| names inside them | 3,088 |

This is a major protobuf construct read nowhere, so it was a GAP and the task is to
implement it.

## It was implemented, measured, and REVERTED — 0 of 1,531 resolved

The implementation reads the `(` anonymous token among an `option` node's children with the
node API, takes the dotted name inside it, and emits
`addRel(enclosingDeclaration, resolveRef(ext, scope), uses, line, { role: "optionType" })`.
`emitRpc` was also enqueuing its own `option` children, without which the largest bucket
(rpc, 928 of 1,525) would never have been visited. Resolution went through the analyzer's
existing `resolveRef`, not a new rule.

The census, same instrument as every other number in this document:

| | before | after |
|---|---|---|
| `uses` edges | 13,275 | **14,806** (+1,531) |
| `uses` resolving at BOTH ends | 9,673 | **9,673** |
| both-ends rate | 72.87% | **65.33%** |

**All 1,531 new edges resolved at 0%.** They are the exact failure the honesty contract
names: "an edge the graph cannot walk is a thing the graph asserts that is not there."
Reverted; `src/ast/real-protobuf-analyzer.ts` is unchanged at HEAD.

### Why they resolve at 0% — a real semantic mismatch, not a bug in the new code

Protobuf addresses an extension field by **its own** fully-qualified name — the package of
the file declaring it, plus the field name. Verified directly against the corpus:

```
pb-googleapis/google/api/annotations.proto:28   extend google.protobuf.MethodOptions {
pb-googleapis/google/api/annotations.proto:30     HttpRule http = 72295728;
```

`option (google.api.http).get = …` is correct: the file's package is `google.api` and the
field is `http`. This analyzer publishes that field as **`google.protobuf.MethodOptions.http`**
— under the EXTENDED TYPE's scope — so the reference misses it by construction. An option
reference is not an ordinary scoped type reference and cannot be resolved by `resolveRef`.

### What the fix would be worth, measured before proposing it

`script/m14/tmp/protobuf/probe/extension-name-fix-price.mts` asks the parse tree, per file,
whether a package-qualified extension name is declared inside an `extend` block — the
declaration protoc would resolve to.

| measurement | value |
|---|---|
| `extend` blocks in the corpus | **724** |
| fields inside them | **996** |
| distinct `package.field` extension names | **486** |
| option extension references | 3,088 |
| would bind if extensions were published as `package.field` | **90 — 2.91%** |
| would still not bind | **2,998 — 97.09%** |

The 2,998 name extensions this corpus does not hold: `google.api.http`,
`grpc.gateway.protoc_gen_openapiv2.options.openapiv2_tag`,
`custom_options.v1.domain`, and 2,995 more. The corpus declares 486 extension names and the
options reference 3,088 names, so the overlap is small — **the missing files are the sparse
checkouts again**, the same cause as pass 12.

**Verdict: not emitted, and the reason is a number.** Republishing extension fields under
their protobuf name is a real improvement, but it would make 2.91% of option references
walkable and move the published id of every extension field — an endpoint of `contains`
edges, and therefore of `bb_impact` and every reverse walk — for a 2.91% return. It is
reported as a priced GAP for the supervisor to schedule against a corpus that holds the
grpc-gateway and googleapis extensions, not taken.

## The harness row that made this readable as a failure — fixed

`script/m14/protobuf-construct-probes.mts` printed its `instantiates` row with
`count: 10166`, message-typed DECLARATIONS, and an overturn sentence reading "message-typed
declarations > 0 while the analyzer emits no `instantiates` relationship". Against a row
reporting the type as ruled, that reads as **"the construct occurs 10,166 times"** — which
is false, and which contradicts the ruling's own (correct) probe. This pass fell for it
before checking.

The row now counts the construct the ruling turns on — a `block_lit` whose ancestor chain
reaches no option/constant — and reads **0 in 0 files**. The 10,166 is retained under the
key `messageTypedDeclarations_are_references_not_constructions`, and the arithmetic is now
self-checking: `aggregateLiterals_all_scopes 1909` = `aggregateLiterals_as_option_or_constant_value 1909` + construct `0`.

## 50 GB of leaked grammar copies in /tmp, from 8 lanes

Running these probes filled the root filesystem to **100%** and every write failed with
`ENOSPC`. The cause is in shared machinery:

```ts
// src/ast/engine.ts:700-711
const procTag = `${process.pid}_${(process.hrtime?.bigint?.() ?? BigInt(0)).toString(36)}`
const base = "bb-wasm_" + relativePath.replace(/\//g, "_").replace(/\\/g, "_")
const tmp = path.join(os.tmpdir(), `${base}_${procTag}.partial`)
const final = path.join(os.tmpdir(), `${base}_${procTag}`)
fs.writeFileSync(tmp, data)
fs.renameSync(tmp, final)
// Best-effort cleanup. Another process may still be reading it, so this
// deliberately does NOT unlink: the per-process tag already makes an
// unbounded tmpdir growth the only cost, and deleting a file another
// process is mid-load on would recreate the original bug.
return final
```

Every parser initialization writes a fresh uniquely-named copy of the grammar and never
removes it. The comment prices the cost as "unbounded tmpdir growth the only cost". **Here
is that cost:**

| measurement | value |
|---|---|
| leaked files | **22,083** |
| total size | **50 GB** |
| of which this lane's grammar (protobuf) | 1,704 files |
| bash 7,051 / zig 3,226 / xml 2,264 / nim 2,116 / sql 1,832 / json 1,701 / css 635 / julia 545 / vue 217 | the rest |
| root filesystem | **100% full**, 0 bytes available |

This is the accepted cost of the zig lane's truncation fix, which was correct: sharing one
`/tmp` path let a concurrent reader observe a half-written grammar, and the failure was a
silently degraded parse. The fix traded a correctness bug for unbounded growth and nobody
counted the growth.

**A safe fix exists and is not the original bug.** The hazard was *truncating a shared path*,
not *unlinking a file*. On Linux an unlinked file that a reader already has open keeps
working — the inode survives until the last close — so a process can unlink its OWN copy
(`procTag` contains its pid) as soon as `Language.load` has resolved, or on exit. That bounds
the directory per-process with no cross-process window at all. Even a delayed unlink
(`setTimeout(..., 60_000)`) is safe for the same reason. `src/ast/engine.ts` is shared and
this lane does not edit it; **§8.**

`find /tmp -maxdepth 1 -name 'bb-wasm_*' -type f -mmin +10 -delete` recovered **50 GB**
(100% → 89%), leaving 89 in-flight files alone. Unlinking only files older than 10 minutes
means no parser was mid-initialization when its own copy went.

## Pass 13 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **10 pass / 0 fail** |
| `npx tsx script/m12/verify-regex-census.ts` | **PASSED** — 0 protobuf rows |
| `npx tsx script/m14/tmp/protobuf/probe/message-typed-coverage.mts` | **16,202 / 16,204 rows covered (99.99%)**, 2 named |
| `npx tsx script/m14/tmp/protobuf/probe/custom-option-refs.mts` | 3,081 custom options naming a type, 17.29% of options |
| `npx tsx script/m14/tmp/protobuf/probe/extension-name-fix-price.mts` | 486 extension names / 3,088 references; fix would bind **90 (2.91%)** |
| `npx tsx script/m14/protobuf-construct-probes.mts` | `instantiates` row now **0 / 0**; all 5 rulings still **0** |
| `protobuf-census.ts` with the edge implemented, then reverted | `uses` +1,531, both-ends **9,673 → 9,673**; reverted, census back to 13,275 |

## Files this pass owns

| file | lines | what |
|---|---|---|
| `script/m14/tmp/protobuf/probe/message-typed-coverage.mts` | 190 | new: measures the `instantiates` ruling's unmeasured cover claim |
| `script/m14/tmp/protobuf/probe/custom-option-refs.mts` | 232 | new: prices the custom-option construct and its name resolution |
| `script/m14/tmp/protobuf/probe/extension-name-fix-price.mts` | 253 | new: prices the id fix before proposing it |
| `script/m14/protobuf-construct-probes.mts` | +38 / −5 | the `instantiates` row counts the construct, not the references |
| `script/m14/protobuf-ruled.ts` | +1 / −1 | "every one" → the measured 16,202 / 16,204 |

## Declared limitations, pass 13

- **The row correspondence assumes a `type` node's row equals its field's row.** Verified
  by an agreement rate rather than trusted: 99.99% of `uses` edges land on a `type` row, so
  a systematic off-by-one would have shown as a low rate, not as plausible coverage. It is
  still a positional argument, not an identity.
- **The corpus for these probes is 1,666 files; the census walks 821.** The census admits
  18 repositories; the on-disk corpus holds protobuf in more. Every cover number in this
  pass is over 1,666 files and is therefore not comparable to the census's counts without
  dividing by roughly two. Pass 13 reports both and names which is which.
- **The 2.91% fix price depends on the sparse corpus.** With the three checkouts
  materialized the corpus would declare far more of the 3,088 names, and the return would
  rise. The number is a floor for this corpus, not for the language.
- **A partial emission is possible and was not taken.** Emitting the option edge only where
  it resolves would add 90 walkable edges and leave 2,998 references as a measured
  non-edge. That is defensible; it was not done because a 90-edge addition is inside the
  parse-loss band this lane cannot currently distinguish from noise (§ pass 11), so its
  effect could not be verified as a real change.
- **The 50 GB cleanup was mine to run; the fix is not.** I deleted only files older than
  10 minutes and only the `bb-wasm_*` pattern, so no other lane's in-flight parser was
  touched. I did not change `src/ast/engine.ts`, which is shared.

# PASS 14 — the whole battery re-verified, one probe that measured one file, and the last DERIVATION finding given an oracle

Nothing in `src/ast/real-protobuf-analyzer.ts` changed in this pass. Every emitted-type
count reproduces pass 13 to the unit. What this pass found is in the lane's
**instruments**: one that measured a single hand-written path and reported a whole
language from it, and one that had no oracle at all where an independent
implementation was sitting on disk unused.

## Every number from passes 1–13 reproduces at HEAD, and one moved mid-session

| measurement | value |
|---|---|
| analyzer-direct symbols / edges | **41,956 / 55,941** |
| through `parseFile` (the band) | 41,955 / 54,939 |
| `uses` / `contains` / `imports` / `exports` / `overrides` | **13,275 / 40,098 / 1,561 / 4 / 1** |
| both-ends resolution | `uses` **9,673 (72.87%)**, `contains` **39,787 (99.22%)**, `overrides` 1 (100%), `imports` 0, `exports` 0 |
| empty names / bad kinds / `unknown` endpoints / self-loops | **0 / 0 / 0 / 0** |
| edges under 0.7 confidence | **0** |
| fixtures | **10 pass / 0 fail** |
| `npx tsc --noEmit` | **no diagnostics** |
| mutants | **30 caught, 0 survived** |
| `verify-regex-census.ts` | **PASSED**, 0 protobuf rows |
| all 5 rulings | **0 construct occurrences** |
| `firing-check --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files** |
| `ontology-coverage-gate protobuf` | **exit 1** — `emitted 5/10 ruled-sound 3 FALSIFIED 2` |
| the same gate with the two wirings applied | **exit 0** — `emitted 5/10 ruled-sound 5 FALSIFIED 0` |
| `store-binding.mts --files 40` | 3,075 analyzer edges, **3,015 walkable (98.05%)**, 2,977 provably exact (96.81%) |
| `store-binding.mts --files 40 --no-derive` | **exit 1** — 0 symbols stored, `near "VALUES": syntax error` on every batch |
| incoming audit, 821 files | 38,551 published ids, **37,113 declarations with ≥1 inbound edge (96.27%)**, 1,438 with none |

### The one number that moved, and it moved inside a single session

`protobuf-ruling-table-proof.mts` runs the arbiter three times over the same 821-file
corpus in one process. Runs (a) and (b) printed `uses 13,275 / contains 40,098 /
imports 1,561`. Run (c) printed **13,267 / 40,072 / 1,559**. Same worktree, same
commit, same corpus, one process.

That is the pass-11 band, now measured **at the arbiter**, and it has a consequence
the earlier passes did not draw: **the arbiter's own `EMITTED` edge counts are not
reproducible to the unit.** A lane quoting an arbiter edge count as an exact number
is quoting a value with a run-to-run spread, and the arbiter prints no band beside it.
This lane's census numbers are quoted from a single named run for that reason.

## `parse-variance.mts` measured ONE file, and said so as if it were the language

```
// parse-variance.mts:50
const TARGET = "$HOME/fixtures/repositories/pb-googleapis/google/api/expr/v1beta1/source.proto"
```

That path is the victim one run happened to print. The probe can only ever re-measure
the file it was told about, and it would report `deterministic: yes` for every other
file in protobuf while the corpus lost one per run. This is the honesty contract's
population rule failing inside this lane's own file — the same rule that made the dart
census's documented command and its printed count disagree by half.

`lost-file-discovery.mts` replaces it with a derived population: the same working-tree
walk `protobuf-census.ts` performs, 4 production passes at the census's own width of
8, and a fixed analyzer reference computed **outside** the concurrent phase.

| measurement | value |
|---|---|
| population | **821 files**, 4 passes × 821 = **3,284 file-parses** |
| analyzer reference (sequential, outside the concurrent phase) | 41,956 symbols / 55,941 edges |
| production symbols, per pass | **41,882 / 41,902 / 41,952 / 41,955 — all four differ** |
| production edges, per pass | 54,833 / 54,863 / 54,937 / 54,939 |
| `uses` spread | 13,246 – 13,275 (**0.2185%**) |
| `contains` spread | 40,026 – 40,098 (0.1796%) |
| `imports` spread | 1,556 – 1,561 (0.3203%) |
| whole files lost | **3 of 3,284 file-parses (0.0914%)** — a DIFFERENT file each time |
| lost, run 1 | `pb-googleapis/google/api/expr/v1beta1/expr.proto` |
| lost, run 2 | `pb-reference/src/google/protobuf/source_context.proto` |
| lost, run 4 | `boundary/internal/proto/controller/api/services/v1/user_service.proto` |
| `parse-variance.mts`'s hardcoded target | in the population, **NOT discovered here** |

Each lost file printed `[BB-PARSE-ERR] protobuf | … | memory access out of bounds`.
So three findings, in order:

1. **The band is confirmed at 0.0914%**, inside pass 11's 0.0365–0.107%.
2. **It is present on 3 of 4 passes, not 1 of 4.** Passes 7 and 11 saw it once and
   recorded a rate; it is more frequent than one run suggests.
3. **There is no majority outcome.** All four passes produced a different total, and
   the analyzer reference 41,956 was reached by exactly one. "The bad run" is not a
   category here — there is no good run to compare against.

## One file is short on EVERY pass, and that is a different finding

```
boundary/internal/proto/controller/custom_options/v1/options.proto
controller.custom_options.v1.MaskMapping.this   kind=property   absent on 5 of 5 attempts
```

Deterministic is not the random fault. `partial-loss-detail.mts` names it, and
`universal-denylist-cost.mts` attributes it and prices the whole list.

## The shared denylist's comment is now false, with a counterexample attached

`src/ast/pool-worker.ts` `keepSymbol`'s `UNIVERSAL` set justifies two of its entries:

```
// Reserved in essentially every language parsed here. Kept unconditionally
// because no lane produced a legitimate declaration of any of them.
"this",
"super",
```

**This lane has now produced one.** `boundary/internal/proto/controller/
custom_options/v1/options.proto` declares a protobuf field named `this`. Protobuf has
no `this` keyword and no `this` expression, so the name has no construct to be noise
in. The denylist is **read** from the production source, not copied, and the read
refuses to run if it cannot delimit exactly one `const UNIVERSAL = new Set([` block —
which it did, on this probe's own first run, against an extraction bug. A loud failure
instead of a confident zero is the whole point of deriving it.

| measurement | value |
|---|---|
| denylist entries, read from `src/ast/pool-worker.ts` | **6** — `GlobalScope` `SCSS_FILE_SCOPE` `module_declaration` `package_manifest` `super` `this` |
| analyzer symbols / production symbols | 41,956 / 41,955 |
| declarations dropped | **1 of 41,956 (0.0024%)** |
| dropped, and on the denylist | `this` — `controller.custom_options.v1.MaskMapping.this`, kind `property` |
| dropped, and **NOT** on the denylist | **0** |
| denylist entries with a protobuf counterexample | **1 of 6** |
| denylist entries with none in this corpus | `GlobalScope` `SCSS_FILE_SCOPE` `module_declaration` `package_manifest` `super` |
| **STORED edges naming the dropped declaration** | **1** — `contains target=controller.custom_options.v1.MaskMapping.this` |

Two things that are findings rather than notes. The `NOT on the denylist` bucket being
**0** means that for protobuf the name denylist is the **only** thing standing between
this analyzer and the store — no prefix rule, no size fallback, no
`filterNoiseRelationships` loss is measurable on this corpus. And the stored
`contains` edge naming a symbol the store never published is the same class the
pool-worker comment itself attributes to the sql lane ("1 of 11,786 `contains` edges
left naming nothing"): one edge the graph asserts and cannot walk back from.

`super` has **no** protobuf counterexample in this corpus. That is a measurement of
this corpus, not a clearance: nothing here says `super` is safe.

## `overrides` has an oracle now — the DERIVATION finding is narrowed, not closed

Passes 8 and 10 recorded why `overrides` could not be adjudicated: *"protoc REJECTS
the construct"*. That is half right. `protoc` rejects the **file**, so there is no
descriptor — and it still **reports** the doubling as a diagnostic, from C++ code that
shares nothing with a tree-sitter grammar:

```
test.proto:40:25: "Value" is already defined in "sls.asfd.asfd.LogContent".
```

Same field, same scope, same line as the analyzer's edge. Agreement on all three is
checked programmatically, not read off. That is the **NAME** half. `protoc` says
nothing about whether the two declarations also share a field **number**, so a second
witness supplies it: an independent walk whose population is defined by the **node
type** — every `field` carrying a `field_number` — rather than by a descent path.

| witness | scope | shares the analyzer's grammar? |
|---|---|---|
| 1 — `protoc` 36.2 | a second declaration of field `Value` in `sls.asfd.asfd.LogContent` at line 40 | **no** |
| 2 — independent tree walk | a field number declared twice in one slot space | yes |

| measurement | value |
|---|---|
| `field` nodes seen | **25,631** |
| of those, with no `field_number` | **0** — a walk that saw nothing would read 0 and be caught here |
| messages / oneofs / extends / groups | 7,849 / 299 / 214 / 10 |
| `messages` and `extends` cross-check | **7,849 and 214 — identical to `protobuf-construct-probes.mts`, from code sharing nothing with it** |
| slots, distinct by (file, scope, number) | 25,631 / **25,630** |
| **slots declared more than once** | **1** |
| the one | `nvim-treesitter/…/test.proto:40` `sls.asfd.asfd.LogContent` number 2, declared as `Value` |
| analyzer `overrides` edges corpus-wide, through `parseFile` | **1** |
| every doubled slot carries an edge | **true** |

So "1 edge in 821 files" is no longer an assertion: the construct's corpus-wide count
is **1** by an independent walk, the analyzer emits **1**, and the name half is
confirmed by an implementation that shares no grammar. What remains unadjudicated is
the edge **DIRECTION** — later declaration to earlier — which is asserted by a fixture
and by nothing else. The file prints that in its own output rather than in a comment,
so a reader of the number sees the limit next to it.

### Four defects in that instrument, each of which produced a confident wrong number first

| # | the bug | the wrong number it printed |
|---|---|---|
| 1 | `childForFieldName("field_number")` — `field` carries **no field names** in this grammar | **0 declarations, 0 doubled slots**, against an analyzer emitting 1 edge: reads as a fabricated edge |
| 2 | `childForFieldName("extendee")` — the extendee is an unnamed `full_ident` | every file-level `extend` collapsed into one slot space |
| 3 | slot key omitted the FILE | every `Worker` in the corpus merged into one slot: **6,203 phantom doublings** |
| 4 | extendee resolved once at file scope instead of innermost-first | two different `MessageSetCorrect` types merged: **4 phantom extension collisions** |

Defect 4 is the one worth keeping. `test_messages_proto2.proto` declares
`MessageSetCorrect` inside **both** `TestAllTypesProto2` and
`TestAllRequiredTypesProto2`, and each `extend MessageSetCorrect` binds to its own.
Resolving the name once at file scope invents a conflict between two unrelated
extension numbers. **`protoc` accepts that file with exit 0**, which is what says so,
and the fix is protobuf's own rule: try the name innermost-first against the names the
file declares.

Defect 3 is the one that should worry the programme. It is the exact failure
`incoming-check.ts` exists to catch — *a name collision resolves* — committed by the
instrument written to catch it, and the only reason it was caught is that 6,203 was
absurd against a corpus where 1 was expected.

## Pass 14 gate table

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **no diagnostics** |
| `npx tsx script/m14/protobuf-census.ts` | 821 ok / 0 fail; **41,956 / 55,941** analyzer-direct; 41,955 / 54,939 through `parseFile`; **0** empty names / bad kinds / `unknown` / self-loops; **0** under 0.7 |
| `npx tsx script/m14/protobuf-construct-probes.mts` | all 5 rulings **0**; `instantiates` row **0/0**; 94 observed node types |
| `npx tsx script/m14/run-fixtures.ts --lang protobuf` | **10 pass / 0 fail** |
| `npx tsx script/m12/verify-regex-census.ts` | **PASSED**, 0 protobuf rows |
| `npx tsx script/m14/tmp/protobuf/probe/mutant-sweep.mts` | **30 caught, 0 survived** |
| `npx tsx script/m14/firing-check.ts --files 120 protobuf` | **3/10 fired, 2,069 edges, 10/120 files**, 0 degraded |
| `npx tsx script/m14/ontology-coverage-gate.ts protobuf` | **exit 1** — `emitted 5/10 ruled-sound 3 FALSIFIED 2`, both rows the missing `differential.ts` `LANGS` entry |
| `npx tsx script/m14/protobuf-ruling-table-proof.mts` | run (c) **exit 0** — `emitted 5/10 ruled-sound 5 FALSIFIED 0` |
| `npx tsx script/m14/protobuf-incoming-audit.mts` | 8,524 tracked / 120 offered / **10 on disk**; 38,551 ids; **96.27%** with an inbound edge |
| `npx tsx script/m14/tmp/protobuf/probe/store-binding.mts --files 40` | **3,075 / 3,015 (98.05%) / 2,977 exact (96.81%)** |
| `… --no-derive` | **exit 1**, 0 stored, `near "VALUES": syntax error` |
| `npx tsx script/m14/tmp/protobuf/probe/lost-file-discovery.mts --runs 4` | 3,284 file-parses, **3 whole files lost (0.0914%)**, 4 different totals |
| `npx tsx script/m14/tmp/protobuf/probe/partial-loss-detail.mts` | `…MaskMapping.this` absent **5/5** |
| `npx tsx script/m14/tmp/protobuf/probe/universal-denylist-cost.mts` | **1 of 41,956** dropped, `this`, denylist bucket **1**, other bucket **0**, **1 stored edge** left naming it |
| `npx tsx script/m14/tmp/protobuf/probe/overrides-oracle.mts` | witness 1: `protoc` exit 1, **1** redefinition, agrees on field/scope/line. witness 2: **25,630 slots, 1 doubled, 1 edge, every one covered** |

## §8 items — one is new, four are unchanged, and all four are re-confirmed at HEAD

**NEW, and it is the highest-severity item in this report.**

> `src/ast/pool-worker.ts`, `keepSymbol`, the `UNIVERSAL` set — remove `"this"`.
> *Why, measured:* `boundary/internal/proto/controller/custom_options/v1/options.proto`
> declares the protobuf field `controller.custom_options.v1.MaskMapping.this`.
> Protobuf reserves nothing named `this`. The comment justifying the entry reads
> "no lane produced a legitimate declaration of any of them"; this lane has now
> produced one, deterministically, on 5 of 5 attempts. Cost of the entry on this
> corpus: **1 symbol of 41,956 (0.0024%)** and **1 stored `contains` edge left naming
> a declaration that does not exist in the store**.
> *Shape of the fix:* the file already has the right structure — a per-language
> `RESERVED` map consulted only for languages that reserve a name, which is how
> `self`, `me`, `root`, `program` and `unknown` were each removed with a lane and a
> count. `this` belongs out of `UNIVERSAL` and into that map for the languages that
> actually reserve it. `"super"` has **no** protobuf counterexample in this corpus,
> which is a measurement of this corpus and not a clearance; it should move with
> `this` or stay with a stated reason.
> *Not edited here:* `src/ast/pool-worker.ts` is shared machinery.

**UNCHANGED and re-confirmed at HEAD, with the symptom reproduced today:**

> **`src/ast/parallel-indexer.ts:2164-2165`** — `insertSymbol` still carries TWO
> `VALUES` clauses (31 placeholders then 30). Re-measured this pass with
> `store-binding.mts --files 40 --no-derive`: **every batch throws
> `near "VALUES": syntax error`, 0 symbols are stored, and the probe exits 1** with
> `no index for project … — post-processing derives from indexed symbols`. For
> protobuf the corpus is `pb-reference/src/google/protobuf`, the densest cross-file
> reference set available, and **not one symbol reaches the store**. Every lane's
> store-level measurement is blocked by this one line.

> **`script/m14/differential.ts`** — add to `LANGS`:
> `protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },`
> *Why:* the gate resolves its grammar as `(LANGS as any)[LANG]?.wasm ??
> "tree-sitter-bash.wasm"`, so with `protobuf` absent both grammar-inventory rulings
> are adjudicated against **bash's** node-type table and the arbiter reports
> `calls FALSIFIED — the grammar DOES produce function_definition` and
> `instantiates FALSIFIED`, and exits 1. The gate's own detail string says
> `WRONG GRAMMAR — this probe was handed a tree whose root node is 'program', not
> 'source_file'`. All four values are already carried at
> `script/m14/run-fixtures.ts:91`. With the line added, this lane's arbiter reports
> **`emitted 5/10 ruled-sound 5 FALSIFIED 0`, exit 0** — measured, run (c) of
> `protobuf-ruling-table-proof.mts`.

> **`script/m14/incoming-check.ts`** — `orphans` is computed as
> `declaredNames.filter(n => !named.has(n))`, where `declaredNames` holds `s.name`
> (bare) and `named` is keyed by `rel.target` (qualified). Re-confirmed today on 9
> fixture files: the same run prints **122 symbols, `contains` 113 edges into 113
> distinct declarations — and `declarations nothing names (orphans): 122 of 122`**.
> A line that says every declaration is unnamed by any edge, in the same run that
> says 113 declarations are named by an edge. Either index `declaredNames` by
> `qualifiedName` or count orphans against the key space `named` uses.

> **`src/ast/engine.ts:700-711`** — every parser initialization writes a fresh
> uniquely-named copy of the grammar to the OS temp dir and never removes it. Re-measured
> today: **332 leaked files / 1.3 GB** had re-accumulated, 167 of them older than 10
> minutes. I deleted only those 167 (`-mmin +10`, so no parser was mid-initialization)
> and recovered the space; I did not edit the shared file. Pass 13's analysis stands: an
> unlinked file that a reader already has open keeps working on Linux, so a process can
> unlink its OWN copy (`procTag` contains its pid) and bound the directory per-process
> with no cross-process window.

**NEW, and it is a report item about an instrument rather than about a language.**

> **`script/m14/ontology-coverage-gate.ts` prints an `EMITTED` edge count with no
> band.** Measured today: three runs of the arbiter over one corpus in one process gave
> `uses` 13,275 / 13,275 / **13,267** and `contains` 40,098 / 40,098 / **40,072** — a
> spread of 0.06%–0.07% from a fault that lives in shared runtime state, not in any
> lane's analyzer. A count printed without its population and its spread reads as
> exact. This is the honesty contract's population rule applied to the arbiter itself.

## Declared limitations, pass 14

- **`overrides` is still one DERIVATION finding.** It is now *narrowed*: the construct's
  corpus count is measured at 1 by an independent walk and the name half is confirmed by
  `protoc`, which shares no grammar with this lane. The edge **direction** is asserted by
  a fixture and by nothing else, and witness 2 shares the tree-sitter grammar with the
  analyzer, so a grammar bug inventing a `field` node would be invisible to it.
- **Witness 2 measures doubling WITHIN a file**, which is the unit `protoc` compiles.
  **125 of 214** `extend` blocks in this corpus target a type the file does not declare
  (89 resolved against names the file does declare), so a cross-file extension-number
  conflict is outside its reach. Declared, not claimed.
- **The four instrument defects in `overrides-oracle.mts` were each caught by an
  absurdity check, not by construction.** 0 declarations and 6,203 doublings were both
  wrong and both printed without an error. The instrument's self-checks are the
  `field_nodes_seen` / `without_a_field_number` pair and the agreement with
  `protobuf-construct-probes.mts` on `messages` and `extends`; a future change that
  breaks the walk has to break one of those to be noticed.
- **The parse band is a range and this pass did not narrow it.** 0.0914% on 3,284
  file-parses is one measurement of a rate pass 11 gave as 0.0365–0.107% over 8,210.
  Ten passes would be cheap here and were not run: the probe can be killed by the fault
  it measures, and every extra pass is another chance to be killed.
- **`this` cost 1 symbol of 41,956 and this corpus is 9.6% of the tracked `.proto`
  files** (281 of 7,984 on disk across the three sparse checkouts). The 0.0024% is a
  floor for this corpus. `super` has no counterexample here at all, which says nothing
  about a corpus that declares one.
- **`src/ast/real-protobuf-analyzer.ts` is untouched at HEAD** and every emitted-type
  count reproduces pass 13 exactly. This pass's four findings are all in instruments,
  and three of the four were found by a number being absurd rather than by a check.

## Nine shared gates cannot start at all — found while trying to run one of them

This lane's verdict table has a hand-written "Emitted?" column, and the gate that
machine-checks that column is `script/m14/verify-doc-truth-emissions.ts` — the gate
commissioned after **eight** FALSE_NEGATIVE cells were found in analyzer docs by hand.
Pass 2 recorded a defect *inside* that gate (it skips the first body row of any claim
table, so a `yes` row in first position goes unchecked). It turns out the gate does not
run at all, so that defect and every other lane's column are currently unchecked.

`package.json` declares `"type": "module"`, and these nine files use a top-level
`__dirname`, which does not exist in an ES module. Verified under **both** runners:

```
$ npx tsx script/m14/verify-doc-truth-emissions.ts
/home/…/script/m14/verify-doc-truth-emissions.ts:131
const REPO_ROOT = path.resolve(__dirname, "..", "..")
                               ^
ReferenceError: __dirname is not defined in ES module scope

$ node --import tsx script/m14/verify-doc-truth-emissions.ts     # identical
```

| file | line | what it gates |
|---|---|---|
| `script/m14/verify-doc-truth-emissions.ts` | 131 | the "Emitted?" column of **every** analyzer doc — this lane's included |
| `script/m14/verify-analyzer-hygiene.ts` | 27 | analyzer hygiene |
| `script/m14/verify-corpus-census.ts` | 31 | corpus census |
| `script/m14/verify-fixture-coverage.ts` | 38 | fixture coverage |
| `script/m14/verify-attr-line-base-920.ts` | 48 | attribute-line baseline |
| `script/m14/verify-parse-success.ts` | 75 | parse success |
| `script/m14/verify-probe-battery.ts` | 24 | the probe battery |
| `script/m14/owner-spot-check.ts` | 15 | honesty contract §5.6, the human spot-check ritual |
| `script/m14/tmp/svelte-heritage-corpus.ts` | 16 | (a lane's own scratch script) |

Measured scope, not an estimate: **24** files under `script/` use `__dirname`; **9** of
them fail to start, and the other 15 run. The failure is therefore not universal — it is
these nine.

**§8, one line each, no re-derivation needed:** replace
`path.resolve(__dirname, "..", "..")` with the ESM equivalent
`path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")`,
adding `import { fileURLToPath } from "node:url"`. `verify-js-census.ts` and
`verify-orphaned-mutants.ts` in the same directory already do this and run, so the
working form is in the tree.

**Why it is in this lane's report rather than only in a shared-file list:** a gate that
cannot run cannot report a defect, and this lane's own verdict table is exactly the
artifact it checks. Until it runs, the "Emitted?" column in §"Verdict per type" above is
**hand-verified and not machine-checked**, and the first-body-row defect pass 2 found in
it is still live behind a crash.
