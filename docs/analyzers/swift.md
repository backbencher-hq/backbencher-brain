# swift.md

## Language

- Analyzer file: `src/ast/real-swift-analyzer.ts`
- Parser: `tree-sitter-swift` (pinned `wasm/tree-sitter-swift.wasm`; npm
  tree-sitter-swift 0.7.1 built and verified behaviorally identical on the
  corpus via the production `parseFile` path — 101 vs 101 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; `source_file` →
  `protocol_declaration`/`class_declaration` (with anonymous keyword tokens
  `class`/`struct`/`enum`/`extension`/`actor`)/`function_declaration`/
  `init_declaration`/`property_declaration`/`enum_entry`/
  `typealias_declaration`/`associatedtype_declaration`/
  `navigation_expression` tree; kind is decided by the grammar's anonymous
  keyword token, never source-text scanning)
- Language detection: `.swift` → `swift` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealSwiftAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (leaf-name extraction, no regex — 0 baseline regex
  usages, census unchanged at 95, and a direct scan of the file after the
  ontology wave finds 0 regex literals).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `protocol_declaration`/`class_declaration` `type_identifier`; extension name = the EXTENDED type's `type_identifier` (inside `user_type`); `function_declaration` `simple_identifier`; `init_declaration` → `constructor` (Java/C# naming); `property_declaration` binding `pattern` → `simple_identifier`; `enum_entry` first identifier; `typealias_declaration`/`associatedtype_declaration` `type_identifier` |
| kind | ✅ | `protocol_declaration` → `interface`; `class_declaration` → `class`/`struct`/`enum`/`extension`/`actor` via the anonymous keyword token; `init_declaration` → `constructor`; `deinit_declaration`/`subscript_declaration` → NOT symbols (ObjC dealloc / C# indexer precedent); function → `method` when owned by a type, `function` at file scope; type-scope vars → `property`, file-scope → `variable`; `enum_entry` (in enum bodies only) → `enum_member`; `typealias`/`associatedtype` → `type` |
| qualified/container name | ✅ | `ownerName` = enclosing type symbol for members; extensions own their members (no self-owner — the extension symbol itself has NO owner) |
| range (start/end line + column) | ✅ | the declaration node. For a `typealias`, the `type_identifier` |
| parameters | ❌ (not symbols) | function params are NOT symbols (C# M12.07 negative contract: `ParamsAreNotSymbols`) |
| visibility | ✅ | `modifiers` → `visibility_modifier` tokens (`public`/`private`/`fileprivate`/`internal`/`open`/`package`), default `internal`. **ONTOLOGY wave:** `typealias_declaration` used to create its symbol with NO visibility argument, so every typealias published as `internal` — including the 326 file-scope `public typealias` declarations measured in the 3,656-file construct draw. Fixed; `getVisibility` is now read for typealiases as it is for every other declaration kind |

## Relationship ontology

The ontology wave (docs/analyzers/ONTOLOGY-WORKSTREAM.md) requires a verdict
for all ten types with a **number** behind it. Every count below is measured by
`bun script/m14/swift-ontology-census.ts`, which goes through the PRODUCTION
entry point (`src/ast/pool-worker.ts parseFile`) over **1,256 admitted
`.swift` files** — swift-nio @ `d09ffc8ad6437bc278897279e33150d8e39ee3d5`
(555 tracked), alamofire @ `bda9ed57d72988a3a2ada33d824583541f86eac6` (101),
and the first 600 of apple/swift @ `b5ec977b66deb5444d5acc0e0e1cdcb35f18d22c`
(23,713 tracked). Artifacts:
`validation/m14/tmp/swift-ontology-census.json`,
`.before.log`, `.after.log`.

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only (type → member): `contains Repository -> find`, `contains UserService -> countUsers` (extension member), `contains User -> constructor`. Locals carry no owner so nothing to emit. Never `global contains X`. | 1.0 |
| extends | ✅ | `class_declaration` first `inheritance_specifier` base (`class UserService: BaseService, ...` → `extends UserService -> BaseService`) plus protocol → inherited protocol. Enum raw types are metadata only — never an edge. | 1.0 |
| implements | ✅ | remaining `inheritance_specifier` bases (adopted protocols), every extension base, every enum base except a stdlib raw-value type in first slot | 0.9 |
| calls | ✅ | `call_expression` — member calls resolve to the LEAF target (`users.first {...}` → `first`, `users.append(...)` → `append`, `[1,2].map {...}` → `map`); source = enclosing method; bare stdlib calls (print/String/Int/...) filtered (C# `BuiltinsAreFiltered` precedent) | 1.0 |
| instantiates | ✅ | bare CAPITALIZED call `User(...)` → `instantiates` ONLY (Swift construction syntax — Java `new Foo()` analog; never also a calls edge) | 0.7 |
| uses | ✅ | `self.` member reads, non-self member reads, key-path members and bare reads of DECLARED members of the enclosing type. Type references (String/Int/[User]) emit NOTHING. | 0.7 |
| overrides | ✅ | `override` keyword (`modifiers > member_modifier [override]`) → qualified `Owner.method -> Parent.method` resolved via class-hierarchy BFS + shared companion index. Confidence is 1.0 for a unique in-file match on written labels, parameter types, return type, and async modifier. It is 0.65 for a matching local overload whose stored endpoint is shared or a companion name match, and 0.5 for a first-parent guess. | 1.0 / 0.65 / 0.5 |
| references | ✅ | file-scope imports → `references root -> module` (`import Foundation` → `references root -> Foundation`, ObjC M12.19 pattern). Target is the **spelled path**, so a scoped `import let WinSDK.IPPROTO_IP` names `WinSDK.IPPROTO_IP`. UNCHANGED by the ontology wave — see "The `references` label" below | 0.9 |
| imports | ✅ **NEW** | the same import statement as a **module dependency**: one edge per MODULE, target = the first dotted path segment (Swift's own import grammar — a submodule or a scoped declaration hangs off the module). `import let WinSDK.IPPROTO_IP` → `imports root -> WinSDK`, with `scopedKind: let`, `scopedItem: IPPROTO_IP`, `submodulePath: WinSDK.IPPROTO_IP` in metadata. `metadata.isImport` (the marker completeness section B reads) and `metadata.fileLevel` (the M60/#910 contract, so the parallel-indexer stores the importing FILE in `source_external` instead of the placeholder string `root`) | 0.9 |
| exports | ✅ **NEW** | Swift's API surface: a FILE-SCOPE declaration (`ownerName` unset) whose access level is `public`/`open`/`package`. Membership, not indentation — a member's export is reached through its type's export, so emitting one would restate a `contains` edge under a second label (go GO7 / clean's `ownerName` exclusion). Extensions are EXCLUDED (see below). First occurrence of a name wins (go GO7's export-uniqueness invariant) | 1.0 |
| renders | ✅ | SwiftUI's rendering entry point: inside a type whose bases include `View`, a `property_declaration` named `body` whose `type_annotation` text is exactly `: some View`, whose `computed_property > statements` FIRST child is a `call_expression` naming the COMPONENT — one edge, source = the enclosing class (the view), target = the component NAME, line = the callee node's line, `metadata {isRenderHost: true, renderHost: "body", renderTarget}` (`real-swift-analyzer.ts:1382`). A component name is a TYPE NAME: the test is a CHARACTER test on the target's first ASCII code unit (A..Z, `:1378`), and `View` and `Self` are excluded BY NAME because they are view-protocol vocabulary rather than components (`some View` itself names no component). Both halves of the trigger are structural and measured over the whole admitted population: 85 `var body: some View` over 38 files, 72 `View` conformances over 38 files, and 15 edges over 13 files through the production path (`validation/m14/measurements/swift-renders-arm-2026-10-25.txt`). The refusals are pinned by fixture `swift/renders-view-body`: an argument-position or deeper construction (an ordinary `instantiates` row — only the body's top-level expression is the render), a `body` on a type that does not conform to `View`, a non-`body` member, a member whose declared type is not `some View`, a FUNCTION returning `some View`, and a generic container that is not a View | 0.9 |

### `exports` — what Swift's export construct is, measured

Swift has no `export` keyword. What it has is an **access level**: a
declaration marked `public` (or `open`, or `package`) is part of its module's
interface. Measured by `bun script/m14/swift-import-export-probe.ts` over
**3,656 files** (swift-nio + alamofire + 3,000 of apple/swift), with
**52,113 file-scope declarations** as the denominator:

| access level | file-scope declarations | breakdown |
| --- | --- | --- |
| (no modifier → `internal`) | 43,368 | property 19,461 · function 10,140 · extension 5,545 · struct 3,150 · class 2,417 · protocol 1,263 · actor 482 · enum 461 · typealias 391 · init 44 · associatedtype 14 |
| **public** | **5,708** | function 2,329 · struct 921 · property 683 · class 629 · protocol 492 · typealias 326 · enum 194 · init 62 · extension 54 · actor 18 |
| private | 1,470 | function 604 · property 314 · class 152 · struct 140 · extension 170 · protocol 18 · enum 38 · typealias 29 |
| internal (explicit) | 1,325 | function 754 · property 173 · struct 116 · class 90 · typealias 60 · enum 47 · protocol 40 · init 30 · extension 14 · actor 1 |
| fileprivate | 195 | function 108 · property 40 · struct 20 · extension 14 · enum 2 · class 8 · protocol 3 |
| **open** | **43** | class 43 (Swift allows `open` only on classes and class members) |
| `fileprivate(set)` / `internal(set)` / `public package(set)` | 2 / 1 / 1 | property — a setter-scoped modifier, which `getVisibility` does not match, so these publish as `internal` |

**Export-level total: 5,751 of 52,113 = 11.04%**, 3,999 distinct names.

Three exclusions, each with its measured cost:

1. **Extensions** (54 file-scope `public extension` sites in the draw). An
   extension symbol is named after the **EXTENDED** type, so
   `exports root -> ByteBufferInches` names a type declared in another file,
   and `public extension Int` would export a stdlib symbol this file never
   declares. The same reasoning excludes the module re-export below.
2. **Members.** `public struct PublicType { public var visibleField }` exports
   `PublicType`, not `visibleField`. A member is reached through its owner, and
   emitting both would put one fact in the graph under two labels.
3. **The module re-export `@_exported import M`** (58 occurrences in the same
   draw — swift-nio's `Sources/NIO/Exports.swift` and `Sources/NIOFS/Exports.swift`
   are umbrella files built entirely from it). The construct is real and this
   lane does NOT rule it; it produces no `exports` **edge** because a MODULE is
   not a symbol, and the family's export invariant requires an export name to
   resolve to a top-level symbol. `run-fixtures.ts` rejected this lane's first
   implementation on exactly that rule
   (`export(s) … do not resolve to a top-level symbol`) — the measurement, not
   an argument. The fact ships as an `imports` edge carrying
   `metadata.isModuleReExport: true` and on the `ImportInfo` row.

### `package` (Swift 5.9) — a grammar boundary, declared not claimed

`package` is in `SWIFT_EXPORT_LEVELS` and `getVisibility` recognises it, so a
future grammar version is covered. **It cannot fire on this corpus, and this
lane does not claim it does.** The pinned tree-sitter-swift 0.7.1 cannot reduce
it: all six synthetic shapes (`package func`, `package struct`, `package var`,
`package typealias`, `package enum`, `package class`) parse to an `ERROR` while
`public func` reduces cleanly (`script/m14/swift-grammar-shape-probe.ts`), and
the corpus probe finds **0** `package` `visibility_modifier` nodes in 3,656
files. `package func p() {}` recovers as `(ERROR (simple_identifier))` +
`(function_declaration)`, so the declaration still reduces but loses its
modifier and publishes as `internal`.

### The `references` label — why `imports` was ADDED and not substituted

The census measures `references` at **98.11% unresolved targets**: of 3,070
edges, 3,012 name a module (`Foundation`, `NIOCore`, `WinSDK`) that resolves to
no symbol anywhere in the 1,256-file draw. A `references` edge claims a
reference to something in the graph, and for this label that something is
usually not in the graph. The family's answer for a module dependency is the
`imports` kind — c `#include` (src/ast/real-c-analyzer.ts:1895), go's import
path, php `use`/`require`, haskell's FFI entity — and it is also the kind
`bb_graph` groups on: `src/lsp/graph_request.ts` reads rows typed `imports`
with both endpoints NULL and `source_external = <file>` into the file-level
`dependencies` section, which is the answer to "what does this file import".

`references` is nevertheless **left in place and unchanged**. Two lanes argue
one fact deserves one edge (go's R10 note, ruby's "a third time under a second
label") and they are right; collapsing the two labels for Swift requires the
master-owned swift oracle (`deriveSwiftEdges` derives
`references: root -> <spelled path>`, differential.ts:10811) **and**
`validation/m14/differential-baseline.json` changed together. That is reported
to master, not done here. Emitting both is the bash BD9 precedent (bash emits
`imports` AND `references` from one `source`/`.` construct with different
markers), and the two edges carry distinct metadata (`isModuleDependency` +
`module` + `submodulePath` + `isScopedImport` versus `importModule`), so a
consumer can tell them apart.

## Supported constructs

Swift's supported constructs map to the ontology in `## Per-type verdict table — all ten, with the number behind each`: calls, contains, exports, imports, references and uses are emitted; extends/implements/overrides/instantiates are ruled absent on measurement. No separate constructs table exists; the verdict table is the contract.

## Regex inventory

The analyzer contains no source-text regex doing syntax work; names come from grammar fields and node positions.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/swift.json` — manual audit of Swift fixtures.
- Result `validation/m12/results/swift-differential.json`: `passed: true`, expected 85, truePositive 82, falsePositive 0, falseNegative 0, unknown 3, precision 1, recall 1 — 3 unknown are the lane's open defect class.

## Corpus validation

- Corpus `validation/m12/results/swift-corpus-errors.json`: corpus `alamofire`, extensions `*.swift`, 10 error files, 0 crash files.
- Complexity `validation/m12/results/swift-complexity.json`: fixtures 2 files / 37 symbols / 43 relationships / 320.2 ms; corpus subset 400 files / 13,464 symbols / 31,189 relationships / 28,414.1 ms / peak 374.3 MiB.

## Per-type verdict table — all ten, with the number behind each

`bun script/m14/swift-ontology-census.ts`, production `parseFile`, 1,256 files,
40,921 symbols, 128,506 relationships (123,062 before the ontology wave). The
`files` column is capped at 400 distinct files per type in the census, so a
value of 400 means "400 or more".

**Every count in this table was re-measured in this round** over the same corpus
pins, with this round's analyzer changes in place, and not carried forward. The
final run reproduces the committed census artifact exactly on all ten types
(128,506 relationships, 40,921 symbols, 244 grammar-error files, 0 crashes). An
intermediate run of the same sweep differed by one edge on two types —
`contains` 27,330 and `exports` 2,609 — which is the ±1 reproducibility band
recorded under **Determinism** below; the figures in this table are the final
run's, and the band is stated rather than averaged away.

| type | verdict | edges | files | target resolves | confidence | evidenceClass | m14 oracle | lane's own oracle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calls | EMITTED | 42,493 | 400+ | 89.69% | 0.95 (all) | usage_contextual | audited | — |
| uses | EMITTED | 34,822 | 400+ | 94.43% | 0.90 ×25,015 · 0.95 ×6,454 · **0.60 ×3,353** | usage_contextual 31,469 · inferred 3,353 | audited | — |
| contains | EMITTED | **27,329** | 400+ | **99.86%** | 1.0 (all) | structural | **none — DERIVATION debt** | **yes** |
| references | EMITTED | 3,070 | 400+ | **3.81%** | 1.0 (all) | import_based | audited | — |
| imports | EMITTED (was GAP) | **2,834** | 400+ | 2.05% (by design — see below) | 1.0 (all) | import_based | **none — DERIVATION debt** | **yes** |
| exports | EMITTED (was GAP) | **2,610** | 400+ | **100.00%** | 1.0 (all) | structural | **none — DERIVATION debt** | **yes** |
| extends | EMITTED | 1,336 | 400+ | 77.84% | 1.0 (all) | structural | audited | **yes** (split check) |
| implements | EMITTED | 2,977 | 400+ | 47.50% | 1.0 (all) | structural | audited | **yes** (split check) |
| overrides | EMITTED | 281 | 61 | **100.00%** | 0.50 ×210 · 1.0 ×71 | inferred 210 · structural 71 | **none — DERIVATION debt** | **premise probe** |
| instantiates | EMITTED | 10,754 | 400+ | 88.13% | 1.0 ×10,504 · 0.95 ×250 | structural | audited | — |

The last column is this round's answer to the DERIVATION debt the m14
differential structurally cannot see: an independent tree walker for `contains`,
`imports` and `exports`, a corpus-wide declaration index for the `overrides`
premise, and a corpus-wide type-kind index for the `extends`/`implements` split.
Each is named, scoped and measured in its own section below.

The resolution column uses the **parallel-indexer's own endpoint rule** (bare
name, leaf of a dotted name, qualified suffix), not a stricter one. The first
version of this census tested only the whole endpoint string, which reported
`overrides` at 0% — a fact about the probe, not about the graph, because every
`overrides` edge is spelled `Owner.method -> Parent.method`. Corrected and
re-measured; the corrected numbers are the ones above.

**`imports` at 2.05% resolution is not a defect.** A module is not a symbol and
the family's `imports` kind is deliberately not symbol-bound — its consumer is
the file-dependency engine, keyed on `source_external`, not a symbol JOIN. The
98% is the same fact as `references`' 98.11%, and it is the reason `imports`
exists as a separate label. `exports` at 100% is the opposite property and is
the check that matters for that type: every export names a top-level symbol.

**No type is RULED.** Swift expresses all ten constructs. The two that were
missing at handover were GAPs, not exclusions, and both are now implemented.

## The six questions, per already-emitted type

Source derivation answers only the first. Each answer below carries its
measurement. **The shared limit of the oracle question applies to every row:**
the m14 differential's swift oracle is a second walker over the **same pinned
grammar**, so a grammar bug present in both paths is invisible to it. Agreement
means the two derivations match; it does not mean the grammar read the
construct correctly.

### contains — 27,329 edges
1. **Exists** — `analyze()` post-loop, `s.ownerName || s.scope`, deduped per
   (owner, name), extensions excluded from being a container. (`s.scope` is
   never set by `createSymbol`, so the fallback is inert — noted in the
   line-by-line read, not changed.)
2. **Fires** — 27,329 edges over 1,256 files, present in every one of the three
   corpora (swift-nio 14,040 · swift-corpus 10,382 · alamofire 2,907).
3. **Oracle** — **no m14 oracle**: the differential's compared-label allowlist for
   swift is `["extends","implements","instantiates","calls","uses","references"]`
   (differential.ts:23151/23186), so `contains` is dropped from the ANALYZER
   side before comparison — stored and compared against nothing.
   **This round adds one** (`script/m14/swift-uncovered-oracle.ts`): an
   independent tree walker that derives the expected ownership edges from the
   grammar and compares them, in BOTH directions, against the production
   `parseFile`. See "The lane's own oracle" below for the agreement figure and
   for what it cannot see.
4. **Labelled** — right. Ownership is the filter; `contains` asserts enclosure
   and the edge's line is the member's declaration line, which is what the
   indexer's `resolveContainsTargetStmt` anchors on.
5. **Resolved** — **27,290 of 27,329 targets resolve to a symbol in the same
   file (99.86%)**. **All 39 that do not are accounted for**: they are the
   symbols the production `keepSymbol` filter deletes (`unknown` ×27, `root` ×9,
   `self` ×2, `destructor` ×1). The dangling-endpoint probe counts the same 39
   independently — two instruments, written separately, agreeing on the number.
6. **Confident** — 27,329 of 27,329 at confidence 1.0, `evidenceClass:
   structural`. Nothing below the 0.7 heuristic line. **0 edges without a
   `line_number`.**

### uses — 34,822 edges
1. **Exists** — four handlers: `handleSelfUse` (`self.x`), `handleMemberUses`
   (non-self navigation reads), `handleKeyPathUses` (`\.x`), `handleBareUses`
   (bare reads of a DECLARED member of the enclosing type).
2. **Fires** — 34,822 edges; **every branch is live**: confidence 0.90
   (`isMemberRead`/`isKeyPath`, 25,015), 0.95 (`isFieldAccess`, 6,454), 0.60
   (`isBareRead`, 3,353). All three tiers non-zero means no branch is dead.
3. **Oracle** — audited (swift is in the `uses`-audited set). Across every
   differential run this lane made, MISSING=0 and unexplained=0.
4. **Labelled** — right, with one honest edge: a bare read of a declared member
   is labelled `uses` at **0.60**, below the 0.7 line, and correctly tiered
   `inferred`. That is 9.63% of the type's edges. The rule requires the name to
   resolve to a declared member of the enclosing type and to not be locally
   bound (CGD15), which is why it is a heuristic and why it says so.
5. **Resolved** — 32,882 of 34,822 targets resolve anywhere in the draw
   (94.43%).
6. **Confident** — as in (4). See also the honesty-contract §4 census below:
   the 0.60 edges carry `isBareRead`, which is a marker rather than a
   `reasonCode` field.

### calls — 42,493 edges
1. **Exists** — `handleCall`/`emitCall`, with the SW-D21 case-pattern recovery
   gate, the SW-D23 nominal-recovery gate, the subscript-read gate, the
   `defer` gate, the builtin filter and the `XCT*` filter.
2. **Fires** — 42,493 edges, every corpus (swift-nio 24,024 · swift-corpus
   13,548 · alamofire 4,921). 6,484 distinct targets.
3. **Oracle** — audited. 0 missing / 0 unexplained on every draw.
4. **Labelled** — right. Leaf targets, builtins filtered, no `calls -> init`,
   no call edge for a pattern match.
5. **Resolved** — 38,113 of 42,493 resolve in the same file (89.72%).
6. **Confident** — 42,493 of 42,493 at exactly 0.95, `usage_contextual`. One
   uniform value means the type carries no confidence discrimination at all:
   a stdlib call and a same-file call are indistinguishable. Declared as a
   limitation, not fixed here — it would change every `calls` edge's stored
   number.

### references — 3,070 edges
1. **Exists** — post-loop over the `imports: ImportInfo[]` array.
2. **Fires** — 3,070 edges in 1,107 files, one per import statement, 461
   distinct targets.
3. **Oracle** — audited. The oracle's rule is the first
   `simple_identifier`/`identifier` child of the `import_declaration`, i.e. the
   spelled path — the same spelling.
4. **Labelled** — **NO, and this is the lane's clearest labelling finding.**
   96.19% of targets resolve to nothing. This is a module dependency wearing
   the label the family uses for a reference to something in the graph. The
   `imports` edge added beside it carries the same fact under the family's
   module-dependency label.
5. **Resolved** — 117 of 3,070 (3.81%).
6. **Confident** — 3,070 of 3,070 at 1.0, `import_based`, all with a
   `line_number` at the module name's site.

### extends — 1,336 edges / implements — 2,977 edges
1. **Exists** — `handleProtocol` (protocol → inherited protocol) and
   `handleDeclaration` (first-base superclass for a class; every base of a
   struct, actor, extension or enum is an adoption; stdlib raw-value type in an
   enum's first slot is metadata).
2. **Fires** — extends 1,336, implements 2,977, across all three corpora.
3. **Oracle** — both audited by the m14 differential (0 missing / 0
   unexplained on both corpora). **This round adds a check the differential
   cannot make** — see (4): the differential's oracle reads the same file, so it
   can see the inheritance clause but not what the base NAME is in another file.
4. **Labelled** — **the split is wrong for 452 of 1,336 `extends` edges
   (33.8%), and this round measured it.** `script/m14/swift-extends-split-probe.ts`
   builds a corpus-wide type-kind index (2,995 declared type names — 231
   protocol, 1,187 class) and asks what each edge's target actually is:

   | | extends | implements |
   | --- | --- | --- |
   | edges | 1,336 | 2,977 |
   | target is a type the corpus declares | 960 | 1,292 |
   | of those, declared as a **PROTOCOL** | **452** | 1,081 |
   | **mislabelled** (an adoption wearing the superclass label, or the reverse) | **452** | **0** |
   | not checkable — the corpus declares no such type (stdlib / third-party) | 376 | 1,685 |

   The `implements` side is clean: **0** adoptions land on a declared class. All
   452 are one direction. The cause is the same wiring gap as `overrides`:
   `handleDeclaration` decides with
   `inFileKinds.get(base) ?? crossFileKinds?.get(base) ?? "class"`, and
   `crossFileKinds` comes from `context.typeKinds`, which no Swift caller
   supplies — so a first base declared in another file defaults to "class" and
   becomes `extends`. swift-nio is dense with it: `ChannelInboundHandler`,
   `NIOScheduledCallbackHandler` and `ChannelOutboundHandler` are protocols, and
   every handler in `Benchmarks/Benchmarks/**` and `IntegrationTests/**` adopts
   one, e.g. `extends ByteBufferEnvelopeForwardingHandler ->
   ChannelInboundHandler` (Benchmarks.swift:21).

   **This round's `projectIndex` consumption fixes it, verified on the cited
   file**: parsing `Benchmarks.swift` with an index that declares
   `ChannelInboundHandler` an interface turns all three of those edges from
   `extends` into `implements`. Inert without an index, so the fixture suite and
   the differential are unchanged. The two shared-file entries that would supply
   it in production are **reported, not made**.
5. **Resolved** — extends 1,040 of 1,336 (77.84%); implements 1,414 of 2,977
   (47.50%). The `implements` figure is the honest one: most adopted protocols
   are stdlib (`Codable`, `Sendable`, `Equatable`, `Hashable`) and no Swift file
   declares them, so they resolve in no repository graph that does not also
   index the standard library. This is a property of the language, not a
   labelling error.
6. **Confident** — 1.0 on all of both types, `structural`. **That 1.0 is
   overstated for the 452 mislabelled edges**: the tree states the inheritance
   clause outright, but the superclass-vs-adoption decision is a cross-file
   judgement the analyzer could not make, and it is published at full
   confidence. Recorded rather than silently lowered — lowering it would change
   every stored row of both types.

### overrides — 281 edges, the lane's weakest type
1. **Exists** — `override` keyword → `OverrideTask`; three-tier resolution
   (exact in-file BFS → companion index → first-parent guess).
2. **Fires** — 281 edges in 61 files only (swift-nio 158 · swift-corpus 90 ·
   alamofire 33). The smallest type by an order of magnitude.
3. **Oracle** — **no m14 oracle.** `overrides` is excluded from swift's compared
   labels (differential.ts:23151 drops it for csharp, dart, **swift**, cpp and
   go). **This round measures the premise instead**
   (`script/m14/swift-overrides-premise-probe.ts`): a corpus-wide declaration
   index built from the tree — 3,236 distinct types, 20,074 (type, member)
   declarations — asks per edge whether the named target actually declares the
   method, and whether the owner inherits it at all.
4. **Labelled** — the label is right; the **target** is not, and this round
   measured how wrong. Of the 210 Pass-3 first-parent guesses at confidence 0.5
   with `reasonCode: first-parent-guess`, **only 87 (41.4%) name a parent that
   declares the method** anywhere in the corpus-wide index — the guess's premise
   fails for **123 of 210 (58.6%)**. A further 93 name a parent the draw does
   not declare at all (framework types such as `XCTestCase.setUpWithError`),
   which is uncheckable here rather than wrong. swift-nio shows the mechanism
   concretely: `final class PipeChannel: BaseStreamSocketChannel<PipePair>`
   (Sources/NIOPosix/PipeChannel.swift:19) overrides `connectSocket`, which is
   declared two levels up on `BaseSocketChannel`
   (Sources/NIOPosix/BaseSocketChannel.swift:479) — the guess names the DIRECT
   base, which does not declare it.
5. **Resolved** — **281 of 281 (100.0%)** under the indexer's endpoint rule. The
   first version of this census reported 0% for this type, which was the PROBE's
   error and not the analyzer's: every `overrides` edge is spelled
   `Owner.method -> Parent.method`, and the probe was testing the whole string
   against a table of bare names. Re-measured with the leaf and
   qualified-suffix forms the indexer accepts, every target joins. Both figures
   are recorded here because the first one was published in a census artifact
   and a correction that does not name what it corrects is indistinguishable
   from a changed opinion. Note that "resolves" here means the NAME resolves —
   question 4 shows the declaration behind 123 of them does not.
6. **Confident** — 71 at 1.0 (`structural`), 210 at 0.5 (`inferred`). The tier
   split is correct and the 0.5 tier is honestly labelled. **The 1.0 tier is
   verified: all 71 of 71 name a parent that declares the method, in the same
   file, which the owner actually inherits from.** The 0.5 tier's own reason code
   is the honest label for a guess this round measured to be wrong 58.6% of the
   time.

## The `overrides` first-parent guess, and what a project index does to it

`bun script/m14/swift-overrides-premise-probe.ts [--with-project-index]` — the
same index, the same measurement code, two modes. Artifact:
`validation/m14/tmp/swift-overrides-premise.json` and
`…-with-project-index.json`.

| tier | edges | parent is a declared type | parent **declares** the method | owner inherits it | same file |
| --- | --- | --- | --- | --- | --- |
| **production today** (no caller supplies an index) | | | | | |
| pass1 in-file (1.0) | 71 | 71 | **71 (100.0%)** | 71 | 71 |
| pass3 first-parent guess (0.5) | 210 | 117 | **87 (41.4%)** | 205 | 2 |
| **with `AnalyzeContext.projectIndex`** | | | | | |
| pass1 in-file (1.0) | 71 | 71 | **71 (100.0%)** | 71 | 71 |
| pass2 companion-index (0.9) | **117** | 117 | 87 (74.4%) | 112 | 2 |
| pass3 first-parent guess (0.5) | **93** | 0 | 0 | 93 | 0 |

Read the two halves together:

- **The 1.0 tier is sound.** All 71 edges name a parent in the same file that
  declares the method, and the owner inherits it. Nothing to fix.
- **The 0.5 tier's premise fails 58.6% of the time today** (123 of 210 name a
  parent that does not declare the method), and the failures are systematic
  rather than random: the guess takes the DIRECT base, while Swift's `override`
  frequently overrides something an ancestor further up declares.
- **A project index converts 117 of the 210 guesses into companion-verified
  edges at 0.9**, at the cost of none (the type still totals 281 edges). The
  remaining 93 guesses all name a parent the draw does not declare at all
  (`parentIsAType` 0) — framework types such as `XCTestCase` — so they were
  uncheckable rather than wrong, both before and after.
- Of the 117 companion-verified targets, 87 **declare** the method outright and
  30 reach it through their own ancestor. That is the intended semantics, not a
  defect: the companion is closed transitively over the base graph (the Dart
  lane's `dartCompanionFor` does the same), so `findDeclaringParent` returns the
  nearest ancestor that **exposes** the method, and in Swift `override` overrides
  what the parent exposes.

**What this lane did and did not do.** The lane side is done: `crossFileTables()`
reads `projectIndex` exactly as the Dart lane reads it, and it is inert when no
index is supplied (18/18 fixtures unchanged; the default probe mode still
measures the table above). What is missing is two entries in shared files — a
Swift `DeclarationSpec` in `src/ast/project-index.ts` and `".swift"` in
`PROJECT_INDEX_EXTENSIONS` in `src/ast/parallel-indexer.ts`. **Reported to
master, not made.** Until they land, `overrides` in production is the top row.

### instantiates — 10,754 edges
1. **Exists** — bare capitalized call, `super`/`self`/`Self.init` delegation,
   and the post-walk enum-case conversion (SW-B/SW-H).
2. **Fires** — 10,754 edges, 2,024 distinct targets.
3. **Oracle** — audited. 0 missing / 0 unexplained.
4. **Labelled** — right. Construction is `instantiates` only, never also a
   `calls` edge; XCTest assertion functions and stdlib numerics are filtered.
5. **Resolved** — 9,478 of 10,754 (88.13%).
6. **Confident** — 10,504 at 1.0 (bare construction) and 250 at 0.95
   (init delegation and the enum-case conversion), all `structural`.

### imports — 2,834 edges (new)
1. **Exists** — post-loop over `ImportInfo[]`; `importScopeKind` reads the
   grammar's own scope token, `importAttributes` reads the import's attributes.
2. **Fires** — 2,834 edges from 3,070 import declarations (the difference is
   per-module dedupe: 5 import statements in the fixture, 4 modules).
   318 distinct module targets.
3. **Oracle** — none in the m14 differential, and it cannot get one without a
   master-owned change: `imports` is not in swift's compared labels. **This
   round adds the lane's own** (`swift-uncovered-oracle.ts`), and it is the one
   type the two agree on without a single exception — see "The lane's own
   oracle".
4. **Labelled** — right, and the measurement that shows it: the target is the
   first dotted path segment, so no `imports` target contains a `.` (R10, the
   failure go documents for `net/http`).
5. **Resolved** — 2.0%, and that is the label's contract, not a defect: a
   module is not a symbol. What resolves is the IMPORTER —
   `metadata.fileLevel: true` makes the parallel-indexer write this file's
   relative path into `source_external`, which is the key
   `bb_graph`'s file-level `dependencies` section reads.
6. **Confident** — 2,834 of 2,834 at 1.0, `import_based`, every edge with the
   module name's `line_number`.

### exports — 2,610 edges (new)
1. **Exists** — post-loop over the symbol table: no `ownerName`, kind not
   `Extension`, `visibility ∈ {public, open, package}`, first name wins.
2. **Fires** — 2,610 edges, 2,325 distinct names (swift-corpus 2,115 · swift-nio
   395 · alamofire 100). The corpus skew is real: apple/swift's test corpus is
   heavily `public`-surface while app libraries are `internal` by default.
3. **Oracle** — none in the m14 differential (not in swift's compared labels).
   **This round adds the lane's own** (`swift-uncovered-oracle.ts`) — see "The
   lane's own oracle".
4. **Labelled** — right: an access-level export is `evidenceClass: structural`
   (the tree states interface membership outright), matching c, clean and go.
5. **Resolved** — **2,610 of 2,610 (100.0%)**, same file. The only type in the
   lane at 100%, and the check that matters here.
6. **Confident** — 2,610 of 2,610 at 1.0. No inference in the rule, so no
   reason code.

## DERIVATION debt — this lane is on the list, and it grew

`validation/m60/rel-type-coverage-baseline.json` records types an analyzer
emits that the differential never audits: "stored and compared against nothing".
At handover swift carried **2**: `contains` and `overrides`. After the ontology
wave it carries **4**:

| type | edges now emitted | m14 oracle | this round's lane-owned oracle |
| --- | --- | --- | --- |
| contains | 27,329 | none — the compared-label allowlist drops it from the analyzer side | independent tree walker, both directions |
| overrides | 281 | none — excluded from swift's compared labels | corpus-wide declaration index; premise measured |
| imports | 2,834 | none — added in the ontology wave | independent tree walker, both directions |
| exports | 2,610 | none — added in the ontology wave | independent tree walker, both directions |

**SWIFT IS ONE OF THE 100 DERIVATION FINDINGS, and this round treats that as
part of the job rather than a note.** The register still reads `4 un-audited`
for this lane and it is master-owned and shrink-only, so the four findings stay
recorded there. What changed is that three of the four now have an independent
second derivation that runs over the same corpus draw, and the fourth has its
premise measured rather than asserted. See **The lane's own oracle**.

Clearing them in the shared harness still needs `script/m14/differential.ts`
(master-owned): add the label to swift's compared-label list and add a
derivation for it. The two that are cheap to wire are `contains` (the analyzer's
rule is `s.ownerName || s.scope`, and the truth side can read the same from the
tree) and `exports` (a file-scope `visibility_modifier ∈ {public, open, package}`,
which the truth side reads with the same token walk). `imports` needs the
module-vs-scoped-path rule mirrored. `overrides` needs the companion plumbing
the oracle does not have. **Reported, not done.**

## Rule R7 hygiene — measured per endpoint, and what the measurement found

**This section previously reported "0 unknown endpoints, 0 placeholder-literal
endpoints". That sentence contradicted the artifact it cited.** The census's own
counters are not zero — `unknownTargetEdges: 34`, `unknownSourceEdges: 2`,
`placeholderTargetEdges: 6` — and a reader checking the JSON would have found the
claim false. The corrected answer, from
`script/m14/swift-r7-endpoint-probe.ts` over the same 1,256-file draw
(`validation/m14/tmp/swift-r7-endpoints.json`), which names every flagged
endpoint, its file, its line and the source text at that line:

| | count |
| --- | --- |
| empty source endpoints | **0** |
| empty target endpoints | **0** |
| symbols with an empty name | **0** |
| endpoints in the R7 LITERAL set (not names at all: `<unknown>`, `TODO`, `???`, …) | **6** |
| endpoints whose text merely LOOKS like a placeholder | **44** |
| flagged endpoints whose name is **not** a declared symbol of their own file | **40** |

Every flagged endpoint is an ordinary Swift identifier, and each was checked
against the source line the analyzer names:

| spelling | endpoints | files | what it is |
| --- | --- | --- | --- |
| `unknown` | 36 | 22 | `case unknown(host: String, port: Int)` (swift-nio `Sources/NIOCore/SocketAddresses.swift:65`), `case unknown` (swift-nio `Sources/NIOFS/FileSystemError.swift:136`) |
| `undefined` | 6 | 1 | `case undefined` — the Swift compiler's own `GlobalInitValue` enum case (`SwiftCompilerSources/Sources/Optimizer/FunctionPasses/InitializeStaticGlobals.swift:74`, plus `GlobalInitValue.undefined` at 106/162/221/251/422) |
| `None` | 4 | 3 | `case None` (`benchmark/single-source/ArrayOfRef.swift:74`), `BridgedValue.Ownership.None` |
| `self` | 3 | 3 | `case \`self\`` (swift-corpus `lib/Macros/Sources/PublicCorePortal/SwiftifyImport.swift:4`) |
| `null` | 1 | 1 | `public static let null = NilEncoding { "null" }` (alamofire `Source/Features/URLEncodedFormEncoder.swift:323`) |

Swift's reserved words include `nil` and not one of these five, and the analyzer
takes every name from an identifier node's own text, so an endpoint spelled
`unknown` can only have come from an identifier spelled `unknown`.

**But the 40 in the last row are not clean, and that is a defect — not in this
analyzer.** Those endpoints name a symbol the production entry point DELETES.
See "Dangling endpoints" below: `keepSymbol` in `src/ast/pool-worker.ts` (a
master-owned file) drops every symbol whose name is in a universal denylist
containing `unknown`, `self`, `destructor` and `root`, under the comment "never
legitimate declarations in any language". For Swift that clause is measurably
false, so the symbol is dropped and the edge that names it survives.


## The lane's own oracle — what this round added for the DERIVATION debt

Four types ship unverified: `contains`, `imports`, `exports`, `overrides`. The
m14 differential cannot see them (`imports` and `exports` are new; `contains`
and `overrides` are dropped from swift's compared labels), and clearing that
needs `script/m14/differential.ts` plus the pinned baseline — master-owned. So
this lane built its own instruments, in the same spirit as the differential's
oracle and with the same limit stated up front: **every one of them is a second
reader of the same pinned grammar, so a construct the grammar mis-parses is
invisible to all of them.** Agreement means two derivations match; it does not
mean the grammar read the construct correctly.

### `swift-uncovered-oracle.ts` — `contains`, `imports`, `exports`

A second tree walker that imports no analyzer module and calls none of its
helpers, derives the expected edge set from the grammar, and compares it against
the production `parseFile` **in both directions**: MISSING (the tree says the
edge exists and the analyzer did not emit it) and EXTRA (the analyzer emitted an
edge the tree does not support — the fabrication direction the workstream names
as the thing that poisons `bb_graph`).

Files whose tree carries an ERROR node are counted **separately**, because the
analyzer models error recovery (`isNominalRecovery`) and this oracle does not —
on those files the two sides are not reading the same tree, so a disagreement
says nothing about either rule. 244 of the 1,256 files are in that population;
the agreement figure below is over the **1,012 files both readers saw
identically**.

Artifact: `validation/m14/tmp/swift-uncovered-oracle.json`. Over the **1,012
files both readers saw identically** (244 carry an ERROR node and are counted
separately):

| type | truth edges | analyzer edges | agreed | MISSING | EXTRA |
| --- | --- | --- | --- | --- | --- |
| **imports** | 2,108 | 2,108 | **2,108 (100.00%)** | **0** | **0** |
| contains | 18,112 | 17,867 | 17,800 (98.28%) | 312 | 67 |
| exports | 1,861 | 2,132 | 1,857 (99.78%) | 4 | 275 |

**`imports` agrees exactly, in both directions, edge for edge.** That is the
strongest single result in this section: 2,108 module dependencies derived twice
by two independent walkers with zero omissions and zero fabrications.

For `contains` and `exports` the residual is real and is **not claimed as an
analyzer defect**. Every disagreement examined was traced to a convention in the
ORACLE, and three concrete causes are identified:

1. **One-sided backtick normalisation.** The analyzer strips backticks from a
   quoted identifier (`stripNameQuoting`); the oracle reads node text verbatim.
   The comparison normalises the analyzer's side only, so `case \`default\`` still
   compares as `` `default` `` vs `default` — which is most of the `contains`
   EXTRA column (`Flags -> default`, `ProtocolSubtype -> default`,
   `HTTPHeaders -> default`) and the keyword-named members beside it
   (`Sequence -> write`, `FileDescriptor -> open`, `InputClosedAction ->
   continue`, `IPv4Header -> protocol`, all backtick-quoted in Swift).
2. **An incomplete operator list in the oracle.** `anonOperatorName` knows `==`,
   `<`, `+`, `-` and a dozen others but not `===` or `,`, so the oracle derives
   no name for those declarations and the analyzer's `operator ===` /
   `operator ,` become EXTRA exports edges.
3. **The oracle does not treat accessor blocks or closures as scopes.** Verified
   on swift-nio: `String -> formatted` is a MISSING edge whose "declaration" is
   the local `let formatted = String(value, radix: radix)` at
   `Sources/NIOCore/ByteBuffer-conversions.swift:55`, inside a function body. The
   analyzer correctly emits nothing for a local; the oracle attributed it to the
   enclosing extension.

**What this oracle does and does not establish.** It establishes that the
analyzer's post-loop edge construction for these three types agrees, edge for
edge, with an independent reading of the tree over 1,012 real files — and for
`imports`, without a single exception. It does **not** establish that either
reader read the Swift construct correctly: both read the same pinned grammar, so
a construct the grammar mis-parses is invisible to the comparison, and 244 of the
1,256 files are in that population. **The residue on `contains` (312/67) and
`exports` (4/275) is not fully attributed**, and is reported as an open item
rather than dismissed.

One further property the oracle measures because nothing else does: **`exports`
and the analyzer's own `ExportInfo[]` rows agree on every file** — every export
edge target has a row and every row has an edge. Both are read by consumers
(`bb_graph` reads the edges; `run-fixtures`' top-level-symbol invariant reads the
rows), so a divergence between them would be consumer-visible and invisible to
the differential.

### `swift-overrides-premise-probe.ts` — `overrides`

A corpus-wide declaration index (3,236 types, 20,074 type-member pairs) asking
per edge whether the named target declares the method and whether the owner
inherits it. Results in **The `overrides` first-parent guess** section above.

### `swift-extends-split-probe.ts` — `extends` / `implements`

A corpus-wide type-KIND index (2,995 declared type names: 231 protocol, 1,187
class) asking whether an `extends` edge names something the corpus declares as a
PROTOCOL — an adoption wearing the superclass label — and the mirror case.

### `swift-dangling-endpoint-probe.ts` and `swift-r7-endpoint-probe.ts`

Endpoints that resolve to no symbol, and endpoints spelled like placeholders.
Both in their own sections above.

### `swift-determinism-probe.ts`

Two passes of the same bytes through `parseFile`, compared in order. Its own
section above.



## Dangling endpoints — 111 edges name a symbol production deletes

Not this lane's file, and not fixed here. Named with the number that establishes
it, per the workstream's rule for shared-harness findings.

`src/ast/pool-worker.ts` filters every analyzer's symbols through `keepSymbol`
before they reach the index, and its `UNIVERSAL` denylist is

```
this, super, self, Self, me, My, destructor, root, program, source_file,
module_declaration, package_manifest, GlobalScope, SCSS_FILE_SCOPE, unknown
```

under the comment "language keywords / conventions and synthetic tree-sitter
artifact names — **never legitimate declarations in any language**". For Swift
the last clause is false, and the analyzer's edge is built before the filter
runs, so the symbol disappears and the edge that names it stays.

`script/m14/swift-dangling-endpoint-probe.ts` imports the production
`keepSymbol`, applies it to the symbols the analyzer produced, and then counts
the edges naming a deleted declaration
(`validation/m14/tmp/swift-dangling-endpoints.json`):

| | count |
| --- | --- |
| symbols the analyzer produced | **40,961** |
| symbols production keeps | **40,921** |
| symbols deleted by `keepSymbol` | **40**, in 28 files |
| file-scope placeholder edges, excluded (see below) | 21 |
| **edges naming a deleted declaration** | **111** |

The 40,961 − 40 = **40,921** cross-checks exactly against the census's symbol
count, so the filter is the only thing standing between the analyzer and the
index.

| deleted name | symbols | files | dangling edges | kinds |
| --- | --- | --- | --- | --- |
| `unknown` | 27 | 20 | **33** | contains 27 · uses 6 |
| `root` | 10 | 6 | **75** | uses 42 · calls 20 · instantiates 10 · contains 9 |
| `self` | 2 | 2 | **2** | contains 2 |
| `destructor` | 1 | 1 | **1** | contains 1 |

The 21 excluded edges are `root` as the SOURCE of a `references` (9), `imports`
(8) or `exports` (4) row: `root` is this analyzer's declared file-scope
placeholder, so that spelling is the convention rather than a deleted symbol.
`root` as a TARGET of `contains`, or as the source of `calls`/`uses`/
`instantiates`, is a real declaration named `root` and is counted above.

**The `contains` figure reconciles to the census exactly.** This probe counts
**39** dangling `contains` edges (27 `unknown` + 9 `root` + 2 `self` + 1
`destructor`), and the census independently counts **39** `contains` targets
that resolve to no symbol (27,329 emitted − 27,290 resolving). Two instruments,
written separately, landing on the same number is the evidence that the census's
99.86% resolution figure is not a rounding artefact but this filter.

**What it costs a consumer.** `bb_search` for `unknown` in swift-nio returns
nothing while `bb_graph` shows `SocketAddressError → unknown`; `bb_impact` on
that edge resolves nothing. The workstream's warning applies — a fabricated
endpoint poisons the graph consumers — except the edge is *true about the
source* and false only about the index, which is why nothing in the analyzer's
own output reveals it.

**What would fix it, and why it is not this lane's call.** `unknown`, `self` and
`destructor` are ordinary Swift declaration names (`case unknown`,
`case \`self\``, and a `destructor` property in the Swift compiler's own AST at
`SwiftCompilerSources/Sources/AST/Declarations.swift:172`). The denylist is
already language-scoped for the JS globals (`JS_FAMILY`), so the same treatment
— exempting languages where the name is a legal declaration — is the shape of
the fix. `pool-worker.ts` is master-owned. **Reported.**

## Determinism — the same bytes give the same graph

`script/m14/swift-determinism-probe.ts`
(`validation/m14/tmp/swift-determinism.json`): the same admitted list parsed
**twice** through the production `parseFile`, comparing each file's symbol,
relationship, import and export arrays as JSON **in order** — a reordering is a
difference too, because the stored graph keeps the order it was handed.

| | |
| --- | --- |
| corpus | swift-corpus @ `b5ec977b`, working tree clean |
| admitted list | 600 files, sha256 `be12ab2cf2f607fb3651239ab85afd13f7ee7d793b7f9b4daeae16631601994b` |
| files whose two parses differed | **0** |

This was worth measuring because of a discrepancy it explains rather than
resolves: a re-run of this lane's census over the same corpus pins and the same
analyzer blob (`7fa6c355e1a6e2302376e3ff9fc637bb7c7c3c17`) moved `contains` by
+1 (27,329 → 27,330) and `exports` by −1 (2,610 → 2,609), both in the
swift-corpus portion. Per-file output is deterministic and the corpus working
tree is clean at the pinned SHA with every admitted file present, so the ±1 is
in the SWEEP, not in the analyzer: the census runs 8 concurrent `parseFile`
callers, and `ASTEngine.getParser` deletes and reloads the cached parser every
500 parses (`src/ast/engine.ts`), so a parse can race a reload. Recorded here as
a ±1 reproducibility band on census totals rather than as a silent correction —
the numbers in this doc are the ones this lane measured, and they differ from the
committed census artifact by exactly those two edges.



§4 requires every relationship below confidence 1.0 to carry a
**machine-readable reason code**, and requires the heuristic/deterministic ratio
to be countable. Measured over the 1,256-file draw
(`honestySection4` in `validation/m14/tmp/swift-ontology-census.json`):

## Honesty contract §4 — reason-code coverage

`script/m14/swift-ontology-census.ts`, `honestySection4` in
`validation/m14/tmp/swift-ontology-census.json`, over the same 1,256-file draw.

| | count |
| --- | --- |
| edges below confidence 1.0 | **77,775** |
| of those, carrying NO reason marker at all | **42,493 (54.64%)** |
| carrying a descriptive metadata key set | 35,072 (45.36%) |

Grouped by the reason each sub-1.0 edge carries:

| reason | edges | type |
| --- | --- | --- |
| *(none)* | 42,493 | `calls` at 0.95 |
| `isMemberRead` | 25,015 | `uses` at 0.90 |
| `isFieldAccess` | 6,454 | `uses` at 0.95 |
| `isBareRead` | 3,353 | `uses` at 0.60 |
| `first-parent-guess` | 210 | `overrides` at 0.50 — a literal `reasonCode` field |
| `isSelfInit`+`isSuperInit` | 156 | `instantiates` at 0.95 |
| `isEnumConstruction` | 94 | `instantiates` at 0.95 |

So: **one type (`overrides`) writes the literal `reasonCode` field §4 names,
and the entire `calls` type (42,493 edges, 54.64% of all sub-1.0 edges) carries
no reason of any kind** — its confidence is a flat 0.95 that says nothing about
which of two very different situations produced the edge. That is a §4
shortfall in this lane, measured rather than asserted. Fixing it means writing
a reason code on the majority of the lane's edges, which changes every stored
`calls` row and is not this wave's work; it is declared in Known limitations
instead.

## Complexity envelope

- Complexity `validation/m12/results/swift-complexity.json`: fixtures 2 files / 37 symbols / 43 relationships / 320.2 ms; corpus subset 400 files / 13,464 symbols / 31,189 relationships / 28,414.1 ms / peak 374.3 MiB.

## Corpus validation

- Corpus `validation/m12/results/swift-corpus-errors.json`: corpus `alamofire`, extensions `*.swift`, 10 error files, 0 crash files.
- Differential `validation/m12/results/swift-differential.json`: `passed: true`, expected 85, truePositive 82, falsePositive 0, falseNegative 0, unknown 3, precision 1, recall 1 — 3 unknown are the lane's open defect class.
- Complexity `validation/m12/results/swift-complexity.json`: fixtures 2 files / 37 symbols / 43 relationships / 320.2 ms; corpus subset 400 files / 13,464 symbols / 31,189 relationships / 28,414.1 ms / peak 374.3 MiB.

## Payload and latency

`bun script/m14/swift-payload-latency.ts <label>` runs through the PRODUCTION
entry over the two differential corpora at FULL extent (**656 files** — swift-nio
555 + alamofire 101, not a sample) and reports edges per file per type, the
serialized byte size of one file's relationship array, the busiest symbols'
incident-edge counts with the un-narrowed type set and once per type removed,
and parse latency. Artifacts: `validation/m14/tmp/swift-payload-before.json`
and `-after.json`.

**The instrument is identified by content.** `git hash-object` of the analyzer
on disk is printed and recorded, so the two runs of this pair provably measured
different code: before `b1d38ce6853269ff7cd398a6a41ba52381d25053` (2,351
lines), after `7fa6c355e1a6e2302376e3ff9fc637bb7c7c3c17` (2,638 lines). The
first version of this script took the analyzer source as an argument and
compiled it, then measured through `parseFile` — which resolves the analyzer the
ENGINE registered, not the one just compiled — and reported byte-identical
numbers for both. That is how the flaw surfaced: a payload measurement whose
two halves are exactly equal is either a language that changed nothing or a
measurement that measured nothing.

| | before | after | delta |
| --- | --- | --- | --- |
| relationships | 78,862 | 81,067 | **+2,205 (+2.80%)** |
| relationships per file | 120.22 | 123.58 | +2.79% |
| serialized relationship bytes per file (mean) | 24,067 | 24,979.3 | **+3.79%** |
| bytes per file, p50 | 9,346 | 10,043 | **+7.46%** |
| bytes per file, p95 | 99,579 | 103,337 | +3.77% |
| bytes per file, max | 426,636 | 428,457 | +0.43% |

On the wider census draw (1,256 files, apple/swift's 23,713-file holding
included) the same addition measures **+5,444 edges on a 123,062-edge baseline
= +4.42%**. The two figures differ because the corpora differ: swift-nio and
alamofire are application libraries where `public` is rarer, so they carry 495
`exports` and 1,710 `imports` where the apple/swift draw carries 2,610 and
2,834.

### Re-run for this round: cost of the three changes in "What changed" below

`bun script/m14/swift-payload-latency.ts verify`, subject
`src/ast/real-swift-analyzer.ts @ blob 65b5fac7b3a54bc1432820a33d7fcafa87a2696f`
(2,784 lines — a different blob from the ontology wave's `7fa6c355`, so the two
runs provably measured different code). Artifact:
`validation/m14/tmp/swift-payload-verify.json`.

| | ontology wave "after" | this round | delta |
| --- | --- | --- | --- |
| relationships | 81,067 | **81,067** | **0** |
| relationships per file | 123.58 | **123.58** | **0** |
| serialized relationship bytes per file (mean) | 24,979.3 | **24,979.1** | −0.2 (−0.0008%) |
| bytes per file, p50 | 10,043 | **10,043** | 0 |
| bytes per file, p95 | 103,337 | **103,337** | 0 |
| bytes per file, max | 428,457 | **428,457** | 0 |
| busiest symbols | constructor 1,947 · write 944 · run 922 · wait 824 · channelRead 822 | **identical** | 0 |

Per-type edge counts are identical too (`calls` 28,945 · `uses` 20,531 ·
`contains` 16,947 · `instantiates` 7,745 · `references` 1,940 · `implements`
1,681 · `imports` 1,710 · `extends` 882 · `exports` 495 · `overrides` 191).

**No green budget regressed and nothing was re-baselined.** The three changes
cost zero edges, which is the expected result and worth stating as such rather
than as a claim: the evidence-tier change removes a dead arm (no output), the
`scopedItem` rule moves one metadata key for the other on the 25 (file, module)
pairs this corpus holds (net ≈ 0 bytes), and `crossFileTables` is inert without a
`projectIndex`, which no production caller supplies for `.swift`.

**Latency is not attributable on this box, and the reason is stated rather than
a number offered.** This run measured 2,537.7 ms/file against the ontology
wave's 1,116.9 ms/file for the SAME 656 files — while `uptime` reported a load
average of 17–19 from other lanes' sweeps, and the payload script's own header
records that two runs of identical analyzer code taken 20 minutes apart on this
machine differed by 10%. The structural cost of this round's changes is two
single passes over arrays the walk already built (the scoped-import count and the
per-module dedupe), which is the same shape of cost the ontology wave added. The
differential's own `perf` gate for both swift rows is separately unscored — the
pinned baseline rows record no `loadAvg1`, which the harness reports as
`perfUnscored` rather than guessing.

**Where the addition lands in an un-narrowed `bb_graph` answer.** The busiest
symbols, before → after, with the type that dominates each (so the 2.5-4.8x
un-narrowed-vs-filtered ratio has a per-lane composition, not just a number):

| hub | edges | declared in | composition | largest single removal |
| --- | --- | --- | --- | --- |
| `constructor` | 1,945 → **1,947** (+2, +0.10%) | 1,105 files | contains 841 · uses 437 · calls 351 · instantiates 316 · exports 2 | remove `contains` → 1,106 (−43.2%) |
| `write` | 944 → 944 (0%) | 176 files | calls 634 · uses 175 · contains 103 · instantiates 28 · overrides 4 | remove `calls` → 310 (−67.2%) |
| `run` | 922 → 922 (0%) | 88 files | calls 567 · uses 175… instantiates 110 · contains 50 | remove `calls` → 355 (−61.5%) |
| `wait` | 824 → 824 (0%) | 4 files | calls 812 · uses 8 · contains 4 | remove `calls` → 12 (−98.5%) |
| `channelRead` | 822 → 822 (0%) | 170 files | calls 383 · uses 279 · contains 143 · instantiates 17 | remove `calls` → 439 (−46.6%) |

**Four of the five busiest symbols are byte-identical before and after.** The
only hub that moves is `constructor`, by 2 edges in 1,947, because `constructor`
is the name Swift's initializer carries and a `public init` in one of those 1,105
files is an export. The new kinds are file-level by construction
(`source: "root"`, `metadata.fileLevel: true`) and therefore attach to a FILE,
not to a symbol — which is why a symbol-level hub barely moves while the
per-file payload grows 3.79%. **No green budget in this lane regressed, and
nothing was re-baselined.**

**Latency is not attributable on this box, and the reason is stated rather than
a number offered.** The two runs measured 955.5 ms/file (before) and 1,116.9
ms/file (after), a +16.9% difference — while six OTHER ontology lanes (JAVA,
PERL, KOTLIN, SCALA, GROOVY, CSHARP) were sweeping corpora on the same 8-core
machine. Two runs of IDENTICAL analyzer code taken 20 minutes apart on this box
differed by 10% before either of these runs. The script's own header records
the limit and the evidence for it. The honest statement is: **the wave's
structural cost is two single passes over arrays the walk already built, and
the latency effect is below this machine's noise floor.** The differential's own
`perf` gate for both swift rows is separately unscored anyway — the pinned
baseline rows record no `loadAvg1`, which the harness reports as
`perfUnscored` rather than guessing.

## Shared-harness defects found from this lane (named, not fixed)

Each of these is in a file this lane does not own. Each was found by a
measurement in this lane's own work, each is stated with the number that
establishes it, and none was changed.

### 0. `keepSymbol`'s universal denylist deletes legitimate Swift declarations

`src/ast/pool-worker.ts` — `keepSymbol`. **40 symbols deleted across 28 corpus
files; 111 relationship edges name a deleted declaration.** The denylist's own
comment says its entries are "never legitimate declarations in any language", and
for Swift that is false: `case unknown`, `case \`self\`` and a `destructor`
property are ordinary declarations, and the symbol is dropped while the edge that
names it survives. Full measurement, per-name breakdown and the reconciliation
against the census's own unresolved-`contains` figure are in **Dangling
endpoints** above. The JS-global list in the same function is already
language-scoped, so a language exemption is the shape of the fix. **Highest
consumer impact of anything in this list**: `bb_search` and `bb_impact` disagree
with `bb_graph` on the same 111 edges.

### 0b. No Swift project index is ever built, so cross-file resolution is unreachable

`src/ast/parallel-indexer.ts` — `PROJECT_INDEX_EXTENSIONS` is
`{ ".sol": "solidity" }`, and `src/ast/pool-worker.ts`'s `parse_batch` therefore
supplies `context.projectIndex` for Solidity only. Two Swift code paths depend on
a cross-file index and can never see one:

- `resolveOverrides` Pass 2 reads `context.overrideCompanion`, which no
  production caller populates for any language (the engine's own comment on the
  field says so). So every cross-file `overrides` edge falls to Pass 3, the
  first-parent guess at confidence 0.5 — measured, **123 of 210 (58.6%) of those
  name a target that does not declare the method**.
- `handleDeclaration`'s superclass-vs-adoption decision reads
  `context.typeKinds` for the same reason and gets `undefined`, so an unknown
  base defaults to `"class"` and a first-base protocol becomes an `extends` edge.

**The lane side is already done and inert**: `crossFileTables()` reads
`projectIndex` exactly as the Dart lane's `dartCompanionFor` does, so the wiring
master needs is a Swift entry in a `DeclarationSpec` registry plus
`.swift` in `PROJECT_INDEX_EXTENSIONS` — no further analyzer change. The gain is
measured in the `overrides` section below.

### 1. `parseClaimTable` silently drops the first body row of every claim table

`script/m14/verify-doc-truth-emissions.ts:439`. The row loop sets
`started = true; continue` on the first non-rule body row, which CONSUMES that
row instead of recording it. Minimal reproduction:

```
| Relationship | Supported? | Notes |
| --- | --- | --- |
| alpha | ✅ | first body row |
| beta  | ✅ | second body row |
| gamma | ❌ | third |
=> rows captured: 2 — 'alpha' is DROPPED
```

**24 of the 47 analyzer docs in `docs/analyzers/` are affected**, and in every
one of them the dropped row is the analyzer's first-listed relationship:

| dropped row | docs |
| --- | --- |
| `calls` | fsharp, yaml, javascript, dart, c, kotlin, typescript, vue, groovy, java, svelte, python, clojure, csharp, scala, scss |
| `contains` | rust, objc, elixir, erlang, css, haskell, cpp, **swift** |

Consequences: (a) a type the analyzer emits is reported `UNDOCUMENTED` — "the
ontology table makes no checkable claim about it" — when the table does claim
it, which is a measurement that is wrong about the document; (b) the
`UNDOCUMENTED` population the gate's own header puts at "43 analyzers publish a
live channel their table makes no checkable claim about" is inflated by up to
one type per doc. **This is why this doc still reports one swift
`UNDOCUMENTED`: `contains`, at the table header line — the row is present and
parsed by every markdown renderer; the gate does not read it.**

The fix is to stop consuming that row (fall through instead of `continue`).
Verified here by simulation against a copy in `/tmp`, not by editing the gate.

### 2. `rel-type-coverage-gate` prints 20 of the regressions it counted

`script/m60/rel-type-coverage-gate.ts:604` prints `regressions.slice(0, 20)`
directly beneath a line that reads
`baseline: 104 recorded, 47 NEW, 56 repaid`. **27 of the 47 are invisible in the
console output**, and the slice is alphabetical, so the lanes that are cut are
whatever sorts after `makefile`. This lane's two findings from the ontology wave —
`DERIVATION|swift|emits \`exports\` …` and `DERIVATION|swift|emits \`imports\` …` —
are in `regressionsDetail` in
`validation/m60/results/rel-type-coverage.json` and in **neither** appears in the
printed list. The per-lane summary line above it lists every one
(`swift 4 un-audited: ["contains","exports","imports","overrides"]`), which is
how this lane's two additions were confirmed rather than assumed.

### 3. The differential's corpus-existence precheck is not language-scoped

`script/m14/differential.ts:21418`. `activeRepos` is every lane's primary and
second corpus, and the loop above it throws
`corpus repo missing: …/element-plus` for a run scoped with `--lang swift`. A
lane-scoped invocation therefore needs `--repo <name>` on any machine that does
not hold all 40+ corpora. The per-language work below was all done with
`--repo swift-nio` and `--repo alamofire` for that reason.

## Regex census

Baseline at M12.01: **0 usages** — the Swift analyzer was already regex-free.
After M12.21 (pure-AST rewrite): **0 usages**. After the ontology wave: **0
usages**, unchanged. A direct scan of the file finds no regex literal and no
`RegExp`. Note that `bun run script/m12/verify-regex-census.ts` currently
reports **0 swift lines** and nevertheless exits non-zero, on `MISSING` rows for
css and julia and `STALE` rows for clean, fsharp, javascript, python, svelte
and typescript — pre-existing findings in other lanes, identical on the shared
base. Not this lane's to fix.

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/swift-complexity.json`):

- Fixtures: 2 files, 37 symbols, 43 relationships, 320 ms (predates the ontology
  wave; the wave's fixture is `validation/m14/fixtures/swift/imports-exports.swift`)
- Corpus subset: 400 files (swift-nio @ ec51fff0, deterministic first-400 of
  520 tracked `.swift` files ≥ 1KB), **13,464 symbols, 31,189 relationships,
  28.4 s** — 474 symbols/s, 1,098 relationships/s
- All hot paths are single-pass or bounded-BFS (error scan, main iterative
  walk, per-task override BFS, tree helpers) — no O(n²). The ontology wave adds
  two single passes over arrays the walk already built (`symbols`, `imports`)
  and no new traversal.

## Differential verification

`bun script/m14/differential.ts --lang swift --repo swift-nio` and the same with
`--repo alamofire`. **Note that the differential's own corpus-existence precheck
is not language-scoped**: it requires every OTHER lane's corpus repo to be
present and throws `corpus repo missing: …/element-plus` otherwise, so a
lane-scoped invocation needs `--repo <name>` on a machine that does not hold all
40+ corpora.

Each run draws 60 files from the corpus through the cold-pool rotation
(M49 #760 — "prefer never-sampled files each wave"), so the drawn set differs
per run and `sampleSetHash` records it; the harness then classifies the lane as
`resampled` and declines to score its counts against the pinned baseline. That
is why this lane reports the invariant rather than a delta:

| corpus | files | tree-truth | covered | MISSING | analyzer edges | unexplained | heuristic | sampleSetHash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| swift-nio (this round) | 60 | 2,042 | **100%** | **0** | 2,027 | **0** | **0** | `ca3779a2344ec124` |
| alamofire (this round) | 60 | 1,992 | **100%** | **0** | 1,960 | **0** | **0** | `d8ba48a740bd1058` |
| swift-nio (ontology wave, 12 draws) | 60 | 2,028–2,707 | 100% | **0** | 2,015–2,687 | **0** | **0** | — |
| alamofire (ontology wave, 3 draws) | 60 | 1,992–2,228 | 100% | **0** | 1,960–2,185 | **0** | **0** | — |

The pass/fail properties — 100% truth coverage, 0 missing, 0 unexplained, 0
heuristic — held on every run of both corpora in both states, and they cannot
move, because `imports`, `exports`, `contains` and `overrides` are all filtered
out of swift's compared-label set before the comparison. That is the
measurement, and it is also the DERIVATION debt stated above: for four of this
lane's ten types the differential is structurally incapable of noticing a
change.

**This round's analyzer changes cannot move these numbers**, and the reason is
worth stating rather than leaving as a claim: both changes are either inert
without a project index (`crossFileTables`, which no differential caller
supplies) or confined to edge *metadata* (`scopedItem`/`scopedItemCount`, and
the evidence tier, which the compared labels do not read). The runs above were
made with the changes in place.

The pinned baseline rows (`swift-nio:swift` `missing 0 / unexplained 0 /
heuristic 0`, `alamofire:swift` the same) were recorded against corpus checkouts
this lane did not have; swift-nio and alamofire were re-cloned shallow at
`d09ffc8a` and `bda9ed57`, so no run here reproduces a pinned `sampleSetHash`.
`perf.avgMsPerFile` for both rows is also unscored: the baseline row records no
`loadAvg1`, which the harness reports as `perfUnscored` rather than guessing.

Historical: `bun script/m12/verify-analyzer.ts swift` — 1.000 precision / 1.000
recall, 0 FP / 0 FN / 0 unknown on 80 facts (28 symbols + 23 relationships in
the positive fixture, 9 symbols + 11 relationships in the negative fixture),
against the independently hand-audited ground truth in
`validation/m12/ground-truth/swift.json`.

Defects fixed during the M12.21 audit (all verified by the negative fixture):

1. **Blanket type-reference uses noise** — every `simple_type_identifier`/
   `user_type`/`type_identifier` emitted a `uses` edge (`uses Repository ->
   Repository`, `uses find -> String` twice, etc.). Removed; `uses` is now
   ONLY `self.` member reads.
2. **Params / locals / closures as symbols** — function params, `let`/`var`
   bindings inside bodies, and synthetic `closure_<line>_<col>` symbols are
   gone (C# `ParamsAreNotSymbols`/`LocalsAreNotSymbols`/
   `LambdaParamsAreNotSymbols`).
3. **Extension self-owner** — `extension UserService` previously created a
   `namespace` symbol owned by ITSELF. Now `extension` kind, named after the
   extended type, NO owner; members attach via contains (ObjC category
   precedent).
4. **Switch cases as enum_member** — `case` patterns in `switch` statements
   are no longer symbols (enum_entry gated to enum bodies).
5. **Constructor naming** — `init_declaration` is now named `constructor`
   (was the literal `init` token; Java/C# family).
6. **Capitalized calls double-edge** — `User(...)` emitted both `calls` and
   `instantiates`; now instantiates ONLY (Swift construction syntax).
7. **Member-call targets** — `users.first` → `first`, `users.append` →
   `append` (was the full navigation text, which never resolves).
8. **Override identity** — `overrides describe -> describe` (self-reference)
   is now the qualified, hierarchy-resolved
   `UserService.describe -> BaseService.describe`.
9. **Enum raw type** — `enum Status: String` previously emitted
   `implements Status -> String`; the raw type is now metadata only.
10. **Builtins** — bare `print`/`String(...)`/`Int(...)` calls are filtered
     (C# `BuiltinsAreFiltered` precedent).

## Real-corpus validation

`script/m12/swift-corpus-errors.ts` on swift-nio @ ec51fff0 (400-file sample):
**101/400 files carry grammar errors, 0 crashes, 0 timeouts.** All 101 are
genuine modern-Swift grammar gaps the newest available grammar (npm 0.7.1,
built and verified behaviorally identical) cannot parse, recorded honestly:
`@inlinable package` declarations, `isolated`/`borrowing` parameters, typed
`throws(ErrorType)`, `#isolation` macro expansion, `@_lifetime(borrow self)`
attributes, and Swift Testing macros (`#expect`/`#require`).

The ontology wave's corpus census re-measured this at a larger draw: **244 of
1,256 files carry grammar errors, 0 crashes**, 40,921 symbols and 128,506
relationships still produced. `swift/audit-analyzer-grammar` — `swift PASS
refs=108 unknown=0 unknownFields=0`.

Grammar shape-safety: `script/m12/swift-node-types-compare.ts` — 54/88
analyzer node refs are emitted by the pinned grammar; the 34 absent refs are
dead defensive alternatives the grammar never emits (e.g. `actor_declaration`
— the grammar emits `class_declaration [actor]`; `variable_declaration` —
emits `property_declaration`; `public_keyword` — emits `visibility_modifier`
tokens), the same category as C/C++/Rust/ObjC pre-existing dead refs.

## What changed in the analyzer in this round

Three changes, each with the measurement that motivated it. Two change output;
the third cannot, and says so.

### 1. `exports` no longer carries an unreachable second evidence tier

`classifyEvidenceTier` read

```ts
md.evidenceClass = md.viaModuleReExport === true ? "import_based" : "structural"
```

and the comment above it claimed "Both tiers are therefore reachable in one
lane, which is what M14 section D asks for". **The `import_based` arm was dead.**
Nothing in the file ever writes `viaModuleReExport` — the module re-export is
published on the `imports` edge as `isModuleReExport`, deliberately, because a
module is not a symbol — so the arm could not be entered, and the census
measures `exports` at **2,610 of 2,610 `structural`**. An arm nothing can enter
is not a tier, and a comment asserting a tier nothing emits is a claim the
census contradicts. It is now unconditional `structural`, and the fixture pins
the surviving rule with a **target-agnostic** `exports` + `import_based` forbid
that replaces an inert one (see §Fixtures below).

No mutant was added for the removed arm, deliberately: a mutant on a dead branch
cannot produce the defect, so it could not prove the suite would notice
anything. The property that matters — that the tier classifier does not lump
`exports` in with `imports` — is already covered by the live mutant
`swift/ontology-exports-tier-import-based`, which relabels every `exports` edge
`import_based` and is caught.

### 2. `imports` no longer publishes a partial `scopedItem`

The edge is **one per module** (pinned: `import Foundation` plus
`import struct Foundation.URLSession` is one `imports Foundation`), and
`scopedItem` was copied from the first statement mentioning that module. When a
module is scoped-imported N>1 times, that single-valued field names one of N and
reads as all of them. Measured over the three swift corpora: **25 (file, module)
pairs scope-import one module 2+ times**, the largest being swift-nio's
`Sources/NIOCore/BSDSocketAPI.swift` with **37** scoped `WinSDK` imports.

`scopedItem` is now published only when the module has exactly one scoped import
in the file; above that it is dropped and `scopedItemCount: N` is published
instead. Nothing is lost — every statement keeps its own `ImportInfo` row with
its own `scopedItem`, which is the per-statement record and is unchanged.

### 3. Cross-file resolution now reads `AnalyzeContext.projectIndex`

`overrides` resolves in three passes and Pass 2 needs a companion **and** a way
to walk bases the file cannot see. Neither was reachable: Pass 2 reads
`context.overrideCompanion`, and `src/ast/parallel-indexer.ts` builds the batch
companion only for the extensions its `PROJECT_INDEX_EXTENSIONS` map lists —
today `{ ".sol": "solidity" }` — so **no Swift caller has ever supplied one**.
`src/ast/pool-worker.ts`'s `parse_batch` supplies `context.projectIndex` instead,
and the Dart lane already reads that channel (`dartCompanionFor`).

`crossFileTables()` is the Swift equivalent: it reads `projectIndex.typeMembers`
/ `typeBases` / `typeKinds`, closes the member map transitively over the base
graph, and hands `resolveOverrides` both a companion and a base lookup. **Additive
and inert when absent** — with no `projectIndex` (a single-file parse, every
fixture, the differential) `companion` is undefined, `kinds` is
`context.typeKinds` exactly as before, and the base lookup returns the per-file
hierarchy, so output is byte-identical. Verified: 18/18 fixtures unchanged, and
the premise probe's default mode still measures the same tiers.

The gain is measured, and the wiring that would deliver it in production is
**reported, not made** — see the `overrides` section and Known limitations.

## Fixtures and mutants for the ontology wave

`validation/m14/fixtures/swift/imports-exports.swift` +
`.expectation.json` — 14 expect rows, 6 exact-count rows, **14** forbid rows
(was 16), 6 forbid-export rows. Authored from the measured grammar shapes
(`script/m14/swift-grammar-shape-probe.ts`) and re-probed emission, per M34
requirement 4.

Two forbid rows were **removed and one rewritten** in this round, because two of
them could never fire and their comments asserted something false:

- `exports → Reexported` + `meta.evidenceClass: structural` was already
  subsumed by the unconditional `exports → Reexported` forbid directly above it.
- `exports → Reexported` + `meta.evidenceClass: import_based` could never fire
  for the same reason, and its comment claimed "a module RE-EXPORT is
  import_based" — a tier that does not exist. It is replaced by a
  **target-agnostic** `{"type":"exports","meta.evidenceClass":"import_based"}`
  forbid, which fires on ANY export edge under that tier and so is a live pin:
  the classifier change it guards is exactly what
  `swift/ontology-exports-tier-import-based` performs.

The fixture's own header comment carried the same false claim ("Both tiers must
be present"); it is corrected. Note that the fixture's line numbers are
load-bearing — every `line_number` pin is read off the file — so the comment was
rewritten to the **same line count** rather than re-pinned.

`validation/m14/fixtures/swift/scoped-import-metadata.swift` +
`.expectation.json` — **new**, for change 2: 9 expect rows, 5 forbid rows,
6 exact-count rows over a file with three scoped imports of one module, two of
another and one plain import.

`script/m14/swift-mutants.ts` + `script/m14/tmp/swift-mutant-run.ts` — **16
lane-owned mutants, 16 CAUGHT** (run: `bun script/m14/tmp/swift-mutant-run.ts`;
exit 0). The two new ones are `swift/ontology-imports-scoped-item-partial`
(republishes the partial `scopedItem`) and
`swift/ontology-imports-count-on-unscoped` (stamps `scopedItemCount` on a
plainly-imported module). `mutate-analyzer.ts` is master-owned and holds the one
`MUTANTS` array the F4 gate reads; the wiring this lane needs is
`import { SWIFT_ONTOLOGY_MUTANTS } from "./swift-mutants"` beside the existing
`fsharp-mutants` import plus `...SWIFT_ONTOLOGY_MUTANTS` in the spread, and is
**reported, not made**. The runner reuses the master runner's comparison rule
verbatim (caught = more failing fixtures OR more distinct problems inside
already-failing fixtures).

**The new fixture was proved non-trivial, not assumed to be.** With change 2
reverted (`if (false && scopedHere > 1)`), `swift/scoped-import-metadata` fails
with **4 distinct problems in 2 directions** — 2 `expect` rows ("expected
relationship not found") and 2 `forbid` rows ("forbidden relationship present") —
and the suite returns 17/18. With the change restored, 18/18.

Three of the original fourteen survived the first fixture and were fixed by
strengthening the fixture, never by weakening the mutant: an
`expectRelationshipCount` block (one module → exactly one `imports` edge;
exactly 5 `exports`), `meta.fileLevel` assertions, and `forbidExports` on the
analyzer's own export array. Two of those three mutants were themselves no-ops
as first written — a mutant that cannot produce the defect cannot prove the
suite would notice it — and were rewritten as faithful reverts.

## Gate results — re-run for this round

Every gate below was re-run on this lane's branch **with this round's changes in
place**. **No gate number is quoted here that was not produced by one of these
runs.** "Pre-existing" means the finding names a file or lane this lane does not
own; the counts are what the run printed.

| gate | command | result |
| --- | --- | --- |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| fixtures | `bun script/m14/run-fixtures.ts --lang swift` | **18/18 pass, 0 fail** (16 pre-existing + `imports-exports` + the new `scoped-import-metadata`), "fixture baseline gate: no regressions" |
| fixtures, deliberately broken | same, with change 2 reverted | **17/18** — `swift/scoped-import-metadata` fails with 4 problems in 2 directions (2 expect, 2 forbid) |
| mutation | `bun script/m14/tmp/swift-mutant-run.ts` | **16/16 CAUGHT**, exit 0 |
| differential, swift-nio | `bun script/m14/differential.ts --lang swift --repo swift-nio` | 100% truth coverage (2,042/2,042) · **MISSING 0** · **unexplained 0** · **heuristic 0** |
| differential, alamofire | same, `--repo alamofire` | 100% truth coverage (1,992/1,992) · **MISSING 0** · **unexplained 0** · **heuristic 0** |
| grammar audit | `bun run script/m14/audit-analyzer-grammar.ts` | `swift PASS refs=108 unknown=0 unknownFields=0` |
| regex census | `bun run script/m12/verify-regex-census.ts` | **0 swift lines**; `RegExp` occurrences in the analyzer: **0**; regex-literal assignments: **0**. Gate exits non-zero on `MISSING` (css, julia) and `STALE` rows in other lanes. It now also prints `working-tree drift (disclosed, not fatal): 1 analyzer(s): real-swift-analyzer.ts` — that is this round's own edit, disclosed rather than fatal |
| analyzer hygiene | `bun run script/m14/verify-analyzer-hygiene.ts` | **0 swift findings**; 3 findings in cpp/haskell/elixir |
| standing rules R3/R4/R7/R8/R10 | `bun run script/m60/verify-standing-rules.ts` | **0 swift findings**; `G1: 152 passed, 6 failed` — the 6 are the declared-surface matrix, `m60-script-surface-typecheck.md` (R3), R4's stale closure commit, `real-sql-analyzer.ts:62` (R7), hcl/nim (R8), cpp (R10) |
| DERIVATION register | `bun run script/m60/rel-type-coverage-gate.ts` | swift row **`4 un-audited: ["contains","exports","imports","overrides"]`** — unchanged from the ontology wave. The register is master-owned and shrink-only, so these findings stay **reported, not recorded** |
| doc-truth-emissions | `bun run script/m14/verify-doc-truth-emissions.ts` | swift `UNDOCUMENTED` **1** (`contains`, caused by the parser defect below, not by the doc); gate line `48 analyzers, FALSE_NEGATIVE=8 FALSE_POSITIVE=0 UNDOCUMENTED=41 MISSING_DOC=2 NO_CLAIM_TABLE=21 -> FAIL` |
| honesty gate | `bun run script/m14/verify-honesty.ts` | **23 failures**, all evidence-freshness findings in other lanes; **0 swift-attributable**, **0 banned terms in any swift file**. It **caught one during this round** — a banned term in the new fixture's own text — which was rephrased, and the count returned to 23 |
| payload / latency | `bun script/m14/swift-payload-latency.ts <label>` | see the payload section; the runs are identified by analyzer blob hash |
| determinism | `bun script/m14/swift-determinism-probe.ts --repo swift-corpus --cap 600` | **0 of 600** files differ between two passes of the same bytes |
| build | `npx tsc --noEmit` | 0 errors |

**Nothing was re-baselined.** Five master-owned artifacts were rewritten by
running the gates — `docs/DOC-TRUTH-EMISSIONS.md`,
`validation/m14/results/M14.0.F1.json`, `M14.0.F7.json`,
`validation/m60/results/G1.json` and
`validation/m60/results/rel-type-coverage.json` — and all five were restored
with `git checkout` so this branch carries no master-owned artifact edit. The
F7 rewrite in particular had begun recording another lane's hygiene failure,
which would have imported another lane's state into this branch.

## Known limitations

1. **Macro expansion boundaries.** `#expect`/`#require`/`#isolation` and other
   Swift Testing macros error-recover in the pinned grammar; both this lane and
   the differential oracle are blind there. 244 of 1,256 corpus files carry
   grammar errors for this family of reasons.
2. **`package` access level.** Declared above: a grammar-version boundary, not a
   measured capability. Re-confirmed this round: **0** `package`
   `visibility_modifier` nodes in the 1,256-file draw.
3. **Unresolved module targets are by design.** `imports` at 2.05% and
   `references` at 3.81% resolution. A module is not a symbol.
4. **`overrides` targets are unaudited in production, and three-quarters of them
   are wrong.** Measured, not asserted: of 210 Pass-3 first-parent guesses,
   **123 (58.6%) name a parent that does not declare the method**. The lane side
   of the fix is in (`crossFileTables()` reads `projectIndex`, inert when absent,
   and converts 117 of the 210 to companion-verified 0.9 edges when supplied);
   the two shared-file entries that would supply it in production are
   **reported, not made**. The `overrides` oracle itself remains a master-owned
   change.
5. **`calls` carries no confidence discrimination.** One uniform 0.95 for
   42,493 edges.
6. **§4 reason codes are markers, not `reasonCode` fields**, for every
   sub-1.0 type except `overrides`.
7. **Setter-scoped modifiers** (`public package(set)`) publish as `internal`;
   3 corpus sites in the 3,656-file draw.
8. **Shared-grammar blindness.** Every oracle in this lane — the differential's,
   this lane's uncovered-type oracle, the premise probe's index — is a second
   reader of the same pinned grammar, so a construct the grammar mis-parses is
   invisible to all of them. That is the limit the workstream names for question
   3, and it is why the 244 grammar-error files are counted separately by the
   lane's oracle rather than silently averaged in.
9. **`extends` is mislabelled for 452 of 1,336 edges in a single-file parse.**
   A first base declared in another file defaults to "class" because no Swift
   caller supplies `context.typeKinds`, so an adoption becomes a superclass edge.
   The lane-side fix (`crossFileTables`) is in and verified on a cited file; the
   production wiring is **reported**.
10. **Four of ten types are unaudited by the m14 differential** (`contains`,
   `overrides`, `imports`, `exports`), so the differential is structurally
   incapable of noticing a change to them. Three of the four now have a
   lane-owned oracle (see "The lane's own oracle"); clearing them in the shared
   harness still needs `script/m14/differential.ts` and the pinned baseline.
11. **111 edges name a symbol production deletes** — `keepSymbol`'s universal
    denylist drops 40 legitimate Swift declarations across 28 corpus files, and
    the edges survive. Not this lane's file; **reported**.
12. **Two `createSymbol` sites do not read the access level** —
    `associatedtype_declaration` and `enum_entry` both take `createSymbol`'s
    `internal` default. Measured: **2** corpus sites for `associatedtype` with a
    visibility modifier across all three repos, and both are in the Swift
    compiler's own NEGATIVE test files — `test/attr/accessibility.swift:139` is
    annotated `// expected-error {{'private' modifier cannot be applied to this
    declaration}}`, i.e. illegal Swift kept as a compiler test — and **0** for a
    modifier on an enum `case`. So the language does not express the construct
    and the gap is unreachable; recorded rather than changed, because changing
    it would be an unmotivated edit.
13. **The census has a ±1 reproducibility band.** Per-file output is
    deterministic (0 of 600 files differ across two passes), but the census's
    8-way concurrent sweep moves `contains` and `exports` by one edge between
    runs — see **Determinism**.
14. **`contains` is emitted for functions nested inside functions.** A nested
    `func` becomes a symbol owned by the enclosing function and gets a `contains`
    edge, while a local `let`/`var` in the same body emits nothing. Both are
    locals; only one produces an edge. Measured by the lane's oracle as
    `localFunctionContains`; the asymmetry is stated rather than resolved,
    because which convention is right is a family decision, not a lane one.

Closes M12.21 (GitHub issue #160).
