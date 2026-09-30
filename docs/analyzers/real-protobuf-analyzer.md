# Protobuf Analyzer

Real tree-sitter extraction for `.proto` files, against a **vendored, patched,
pinned** grammar.

| | |
|---|---|
| Analyzer | `src/ast/real-protobuf-analyzer.ts` (852 lines) |
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
is a `union` reached from the message by one `contains` edge, and there is
deliberately **no** edge from the oneof to its own fields — membership and
grouping are different relations, and a second `contains` edge would make one
type mean both. Each member carries `metadata.oneof`, and the absence is asserted
as a negative control in the m14 fixture lane rather than left as a claim.

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

- **0 self-looping relationships**
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
| Robustness | 32 degenerate fixtures, **5,000-level nest**, no throw, no self-loop, no duplicate id, every run idempotent, and **counted** work is linear in depth: 3,509 / 7,009 / 14,009 / 28,009 nodes visited at depths 500 / 1,000 / 2,000 / 4,000 — exactly 2× per doubling, against a 2.2× bound |
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
