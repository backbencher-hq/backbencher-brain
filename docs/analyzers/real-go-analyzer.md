# real-go-analyzer.md

## Language

- Analyzer file: `src/ast/real-go-analyzer.ts`
- Parser: `tree-sitter-go`. The engine's grammar-name map (`src/ast/engine.ts`) carries
  `go: "tree-sitter-go"`, and `parseFile` resolves it through `resolveWasm`, which takes the
  **basename** `tree-sitter-go.wasm` and finds it in this repo's `wasm/` directory
  (`bbWasmCandidates` puts `<repo>/wasm` first, ahead of the `~/.bb/wasm` cache).
- Wired bytes, measured 2026-10-02: `wasm/tree-sitter-go.wasm`,
  sha256 `9963ca89b616eaf04b08a43bc1fb0f07b85395bec313330851f1f1ead2f755b6`, 235,957 B.
- **Pin-contract status: NOT registered.** `validation/m14/grammar-pins.json` has lanes for 26
  grammars; `go` is not one of them. An earlier revision of this file called the wasm
  "pinned", which was true only in the loose sense of "a file in `wasm/`". It is not pinned by
  the contract's rule (wired sha256 + enumerable surface + provenance), so a replacement of the
  wasm would be silent. What would close this: an entry for `go` in
  `validation/m14/grammar-pins.json`, re-runnable with `bun run audit:grammar-pins`.
- Earlier claim, **UNVERIFIED 2026-10-02**: that npm `tree-sitter-go` 0.25.0 was
  "verified behaviorally identical on the corpus via the production `parseFile` path — 5 vs 5
  grammar-error files, 0 fixed, 0 regressed". No artifact in `validation/` records that A/B and
  `script/m12/go-wasm-compare.ts` was not run here (it needs the npm tarball unpacked under
  `/tmp`). The claim is neither confirmed nor contradicted by this document; it is recorded as
  unverified rather than repeated as fact.
- Language detection: `.go` → `go` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `case "go"` → `RealGoAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields, never
  source-text scanning. The only string processing is on values already extracted from AST
  nodes (leaf-name extraction, quote stripping, struct-tag key/value parsing, signature
  normalization).
- Main shapes read: `source_file` → `package_clause` / `import_declaration` /
  `function_declaration` / `method_declaration` / `type_declaration` / `var_declaration` /
  `const_declaration`; fields via `field_declaration_list` → `field_declaration` with
  `name` / `type` / `tag`; qualified types via `qualified_type`.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `package_clause` `package_identifier` → module; `type_spec` `name` → struct/interface; `field_declaration` `name` (repeated names share the field type); `function_declaration`/`method_declaration` `name`; `var_spec`/`const_spec` `identifier`s at package scope only |
| kind | ✅ | `interface_type` → `interface`; `struct_type` → `struct`; `method_declaration` → `method` (owner = receiver type, ownerKind `struct`); bare `function_declaration` → `function`; struct fields → `property`; package-scope `var_spec` → `variable`, `const_spec` → `constant`; other `type_spec` bodies → `type` |
| qualified/container name | ✅ | `ownerName` = receiver type for methods, declaring struct/interface for fields and interface methods, `parentStruct` for the generic walk |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ | `parameter_list` → `parameter_declaration` (`name` + `type`); interface `method_spec` params via `extractGoMethodSpecParameters`; function-local params are NOT symbols (C# M12.07 negative contract: `ParamsAreNotSymbols`) |
| returnType | ✅ | `result` field / trailing type node (interface method specs too) |
| visibility | ✅ | `isGoExported` (capitalized first letter — pure char check, no regex) → `public`/`private` |

The analyzer constructs these ten `SymbolKind` values and no others (grep over
`src/ast/real-go-analyzer.ts`, re-measured 2026-10-02): `Class`, `Constant`, `Function`,
`Interface`, `Method`, `Module`, `Property`, `Struct`, `Type`, `Variable`.

## Relationship ontology

Emitted kinds, re-derived 2026-10-02 from every `ASTEngine.RelationshipType.*` reference in
`src/ast/real-go-analyzer.ts`. `RelationshipType.Imports` serialises to `"brain_import"`
(`src/ast/types.ts`), which is why it reads as `imports` in prose and as `brain_import` on the
wire.

| Relationship | Emitted? | How resolved | Confidence |
| --- | --- | --- | --- |
| contains | ✅ | ownerName pass: every symbol with an owner gets ONE `contains owner -> member` — struct fields (`contains User -> ID`), interface methods (`contains Repository -> Find`), methods (`contains UserService -> Save`). Never `contains package -> X` (package-contains noise removed) | 1.0 |
| extends | ✅ | struct embedding — anonymous `field_declaration` with no name (`type UserService struct { BaseService; ... }` → `extends UserService -> BaseService`, method promotion). ONE extends edge, no contains twin (Java/C++/Swift/ObjC inheritance contract) | 0.8 |
| implements | ✅ | implicit interface satisfaction (Go duck typing): `checkGoInterfaceImplementation` matches interface method signatures against the implementor's value/pointer receiver method sets (own + promoted), and a method matches only on the SAME name AND the SAME canonical signature — parameters by TYPE only (a parameter name is not part of a Go method signature), grouped declarations (`a, b int`) expanded one parameter per name, a VARIADIC parameter rendered `...T` (`...T`, `T` and `[]T` are three different types), named results reduced to their types, no result = `void`. Implementor CANDIDATES are the declared non-interface types PLUS every method-receiver type name with no same-file `type` declaration (Go method sets are package-level: gopls declares `clientDispatcher` in `protocol.go` and all of `Client`'s methods in `tsclient.go`), and interface method sets fold embedded interfaces through alias (`type A = interface{…}`) and diamond (`A { B; C }`, `B { D }`, `C { D }`) embeddings with a PATH mark, not a global visited set. Source = the implementor name as written (was `*UserService`) | confidence is **not** a literal at the push site — it is `valueImpl.confidence` / `pointerImpl.confidence`, computed by the matcher. **UNVERIFIED 2026-10-02**: the value is not a constant, so no single number is claimable from the source; what would verify it is a printed census of that field over the corpus |
| calls | ✅ | `call_expression` from `qualified_calls` — LEAF targets incl. stdlib (`s.repo.Save(user)` → `calls Save -> Save` like Rust's `self.repository.find` → `calls find -> find`; `strings.ToUpper(v)` → `calls transform -> ToUpper` like Rust's `calls normalize -> println`). Goroutine (`go f()`) and defer (`defer g()`) spawns are calls edges, deduped against `qualified_calls` — one edge per (source, target). Go builtins (`append`/`len`/`make`/`new`/…) filtered (`BuiltinsAreFiltered`) | 0.8 and 0.9 (two push sites) |
| instantiates | ✅ | PascalCase top-level FUNCTION calls only (`NewUser(...)` → `instantiates Find -> NewUser` — Go constructor convention). Methods and unresolved stdlib leaves never instantiate | 0.6 (two sites) and 0.8 |
| uses | ✅ | selector field access — source = containing function/method, target = field LEAF (`b.name` in `Describe` → `uses Describe -> name`, `s.repo` in `Save` → `uses Save -> repo`). Selectors that are the callee of a `call_expression` are skipped (the calls edge handles them) | 0.7, 0.8, 0.9, 1.0 and one computed `0` — see note below |
| **imports** | ✅ | **This row was missing from earlier revisions of this file and that was wrong.** Each entry of the `imports` table emits `imports <package-or-file> -> <module>` at confidence 0.9, carrying `metadata.isImport: true`, `metadata.isGoImportDep: true` and (M59.A7 #825) `line_number` from the `import_spec`. The edge is deliberately labelled `imports` and NOT `references`: an import names a MODULE, and a module specifier is a path string (`net/http`, `github.com/google/go-cmp/cmp`) whose separators no Go declaration may contain | 0.9 |
| references | ✅ | **Not imports.** `references` is emitted for `qualified_type` references — `parentStruct`/`typeNode`/field type nodes written `pkg.Name` resolve to the LEAF after the final `.` (`t.text` when unqualified), deduped per `source|target|type`, at confidence 0.95 with `metadata.relationshipType` and `metadata.qualifiedType`. The R10 census measures separators in a lane's targets against the characters its own symbols use, and no Go declaration may contain `.` | 0.95 |
| exports | ❌ not emitted | `RelationshipType.Exports` is never referenced by this analyzer. Go has no export declaration syntax; visibility is the capitalized first letter, carried on the symbol (`visibility: public`), not on an edge | — |
| implements / instantiates / contains / extends / uses / overrides / depends / field_access | ❌ n/a | `overrides` is never emitted (Go has no override keyword; promotion is modelled as `extends` on the embedding). `depends` and `field_access` are not `RelationshipType` members in `src/ast/types.ts` — the family's spellings are `references` and `uses` | — |

The `uses` confidence spread is real and is not normalised: the analyzer pushes `uses` at 0.7,
0.8, 0.9 and 1.0 depending on the shape, plus one site whose confidence is the literal `0`.
Under contract §4 a sub-1.0 edge must carry a machine-readable reason code; **whether every
one of these sites does is UNVERIFIED 2026-10-02** — what would verify it is a census of
`uses` edges by `metadata` over the corpus, printed.

## Supported constructs

- Fixtures: `validation/m12/fixtures/go/` — `service.go` (positive) and `Negative.go`
  (negative). Both exist and both are read by `script/m12/verify-analyzer.ts`.
- Covered: package/module declaration; `type` declarations of every body kind (struct,
  interface, alias, named basic type); struct fields including anonymous/embedded fields and
  tags; functions and methods with parameter lists and result lists; package-scope `var` and
  `const` specs; import declarations single and grouped; selector calls, goroutine spawns and
  deferred calls; constructor-shaped instantiation; qualified-type references.
- Negative contract the fixture pins: function-local `var`/`const` and their specs are NOT
  symbols, and function parameters are NOT symbols.

## Unsupported / explicit-unknown constructs

- Function-local declarations are out of scope by contract (see above), so a symbol census
  over a Go file will not include locals.
- Methods declared in a *different* file of the same package are visible to the
  interface-satisfaction check (receiver-type names with no same-file `type` declaration become
  implementor candidates) but a method declared in a *different package* is not. That is a
  per-file analyser's boundary, not a bug, and it is stated rather than approximated.
- `//go:generate`, `//go:linkname`, cgo, and assembly are not interpreted.
- Dynamic dispatch through `interface{}` values is not resolved: Go's method set is known
  statically per type, so there is no dynamic edge to invent here, but a value stored in an
  `interface{}` and called through a variable name of that type resolves only if the variable's
  declared type is visible in the same file.

## Regex inventory

Measured with the repository's own scanner (`script/m12/regex-census-core.ts`, driven through
`script/m12/census-truth.ts scanHeadAnalyzers()`, which scans the **committed** analyzer
blobs), re-run 2026-10-02:

| File | HEAD regex usages | Census entries |
| --- | --- | --- |
| `real-go-analyzer.ts` | **0** | 0 |

Baseline at M12.01 was **9 usages** in this file (struct-tag parsing, `@Router` comment
scanning, import-path quote stripping, pointer/slice marker stripping, signature
normalization). The M12.22 audit replaced all 9 with pure char scans / AST token children.
The "census 95 → 86" figure this document used to carry is **not reproducible from the
committed artifact**: `validation/m12/results/regex-census.json` (generated 2026-09-28) records
`totalRegexUsages: 26` across 43 analyzers, and carries no per-file total for the pre-M12.22
state. Treat the 9 → 0 reduction as the documented history and the 95 → 86 totals as
UNVERIFIED.

The census gate itself is currently red **tree-wide** (`bun run script/m12/verify-regex-census.ts`:
`missing from census: 24, stale in census: 25`). None of those 49 findings are in this lane —
the stale rows are fsharp/vue/typescript/svelte/clean/javascript/python and the missing rows
are css/julia — but the gate does not pass, so "zero regex for go" is a per-file measurement
and not a claim that the policy gate is green.

## Complexity envelope

`validation/m12/results/go-complexity.json`, sealed 2026-09-14. Quoted verbatim:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 30 | 34 | 1112.66 | 26.96 | 30.56 | 188,014,592 |
| corpus_subset | 400 | 7157 | 28187 | 25066.99 | 285.51 | 1124.47 | 373,858,304 |

Declared budget: **none recorded for this lane.** `script/m12/measure-analyzer.ts` writes the
note "Budgets are declared per analyzer in docs/analyzers/", and this document does not carry
one — that is a declared gap, not an omitted figure. What would close it: a per-lane budget row
plus a gate that fails when the measured symbols/s falls below it.

Hot-path audit: all hot paths are single-pass over per-file symbol sets; the interface
implementation check is a bounded interfaces × structs pairwise match (Rust-family pattern);
no O(n²). **Structural claim only — this was reasoned from the source, not profiled.**
What would verify it: a per-phase timing breakdown on the 400-file sample.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/go.json` — hand-audited, authority
  `manual_audit` (the artifact records `truthSource: "manual_audit"`,
  `truthReference: "validation/m12/fixtures/go"`).
- Result: `validation/m12/results/go-differential.json`, sealed **2026-09-28T02:54:45Z**.

**The claim this section used to make — "1.000 precision / 1.000 recall, 0 FP / 0 FN /
0 unknown on 64 facts" — is false against the committed artifact.** What the artifact records:

| Field | Value |
| --- | --- |
| `passed` | **false** |
| expected facts | 64 |
| true positives | 60 |
| **false positives** | **20** |
| **false negatives** | **4** |
| unknown | 1 |
| unsupported | 0 |
| **precision** | **0.750** |
| **recall** | **0.9375** |
| `earliestFailingLayer` | `ast_extraction` |

The 64-fact denominator is right; the ratios were not. The recorded false positives include
`rel:service.go:imports:service:fmt` and `rel:service.go:imports:service:strings`, and the
recorded false negatives are the matching `references:…` rows — which is the `imports` relabel
described in the ontology table above, seen from the oracle's side. The artifact predates that
relabel, so its rows describe a state the analyzer has since left.

**Evidence level: L0 — STALE, and it cannot be quoted as a current number.** The artifact
records the input hashes of 62 files, and 47 of them no longer match the working tree,
including the analyzer itself: `src/ast/real-go-analyzer.ts` was 169,638 B when sealed and is
202,799 B now. Under `docs/M14-HONESTY-CONTRACT.md` §2, evidence whose inputs have drifted is
L0 and may not be documented as working. What would verify a current figure: re-run
`bun script/m12/verify-analyzer.ts go`, which regenerates the artifact from the current tree.

Defects the M12.22 audit fixed, all pinned by the negative fixture. These are the doc's
substantive content and they still match the source:

1. **9 regexes** — struct tags, `@Router` comment, import quotes, pointer/slice markers,
   signature normalization → pure char scans.
2. **Locals as symbols** — function-local `var`/`const` (and their specs) no longer become
   symbols (C# `LocalsAreNotSymbols`).
3. **Struct kind** — `struct_type` → `struct` (was `class`).
4. **Embedding double-edge** — embedded types emitted BOTH `contains` and `extends`; now one
   `extends` edge only; field-type `uses` dropped (Rust contract — no dangling type-text targets
   like `uses UserService -> []*User`).
5. **Pointer-receiver implements** — `implements *UserService -> Repository` →
   `implements UserService -> Repository` (plain source name).
6. **Call targets** — `s.repo.Save(user)` → `calls Save -> Save` (leaf), and stdlib
   `strings.ToUpper(v)` → `calls transform -> ToUpper`; the old `targetFunction !== func.name`
   guard removed (Rust emits self-named leaf calls like `calls find -> find`).
7. **Instantiates** — PascalCase top-level functions only; methods and unresolved stdlib
   leaves never instantiate.
8. **Selector uses source** — `uses s -> name` / `uses s.repo -> Save` → `uses Describe -> name`
   / `uses Save -> repo` (source = containing function, target = field leaf; call-callee
   selectors skipped).
9. **Package contains noise** — `contains service -> X` for every exported symbol removed
   (Rust GT has no module contains).
10. **Goroutine/defer dedup** — `go process()` / `defer cleanup()` emitted duplicate `calls`
    edges (once from `qualified_calls`, once from the pattern walk); now deduped to one edge
    per (source, target).
11. **OwnerName contains pass** — struct fields, interface methods, and methods all get ONE
    `contains` edge via the ownerName pass (was receiver-only + package exports, missing
    `contains Repository -> Find` and `contains User -> ID`).

## Corpus validation

- Corpus: `go-tools` @ `bf54bcd2f14a330f0dcffa4cf631235de771bde2`, external clone root
  `$HOME/fixtures/repositories/go-tools`.
- Sample: 400 tracked `*.go` files, `deterministic-first-400-sorted`, 0 sample paths absent
  from the corpus.
- Measured (`validation/m12/results/go-corpus-errors.json`): **5/400 files carry grammar
  errors** (1.3 %), 395 clean, 2 with missing nodes, **0 crash files**, 0 pipeline mismatches,
  20,149 ms wall. Missing tokens: `]` ×21, `identifier` ×2.
- All 5 are `testdata/` files for `go vet` analysis passes — generic type aliases with
  constraints, parenthesized builtin calls, a 2025-copyright modernize test. Valid Go the
  pinned grammar cannot parse; recorded rather than hidden.
- **Two different tracked-file totals exist and both are correct about different things.**
  The artifact records `trackedFilesInCorpus: 1931`. `validation/m12/corpus-manifest.json`
  describes the sample as "the first-400 sorted slice of 1327 files ≥ 1KB". 1931 is every
  tracked `.go` file in the clone; 1327 is the ≥1 KB subset the sample was drawn from. This
  document previously cited 1327 as "1,327 tracked `.go` files", which conflated the two; both
  numbers are now attributed.
- Manifest `measured` block for go records `precision: 1, recall: 1`. **That row is stale and
  contradicts the differential artifact above**; this document does not repeat it as truth.
  What would close it: regenerate `validation/m12/corpus-manifest.json` from the same run that
  regenerates the differential.

## Node-type conformance

- Gate script: `script/m12/go-node-types-compare.ts`. (This file previously named it
  `script/m12/go-node-types-dump.ts`, which does not exist — a stale path.)
- Earlier claim: "29/29 analyzer node refs are emitted by the pinned grammar, 0 dead".
  **UNVERIFIED 2026-10-02.** The script could not be run here: it looks for
  `src/node-types.json` in `/tmp/ts-go-npm/package/` or `wasm/tree-sitter-go/`, and falls back
  to reading a grammar it also expects in `/tmp/ts-go-npm/package/grammar.js`; none of those
  paths exist in this tree and the `go` grammar is not vendored under `grammars/`. What would
  verify it: unpack the npm tarball to the expected path (or vendor `tree-sitter-go` under
  `grammars/`) and re-run the script.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/go/` (`service.go`, `Negative.go`)
- Ground truth: `validation/m12/ground-truth/go.json`
- Differential: `validation/m12/results/go-differential.json` — **sealed 2026-09-28, stale**
- Complexity: `validation/m12/results/go-complexity.json` — sealed 2026-09-14
- Corpus errors: `validation/m12/results/go-corpus-errors.json`
- Regex census: `validation/m12/results/regex-census.json` (no go entries)
- Corpus manifest: `validation/m12/corpus-manifest.json` → analyzer `go`
- Gate scripts: `script/m12/verify-analyzer.ts`, `script/m12/measure-analyzer.ts`,
  `script/m12/go-corpus-errors.ts`, `script/m12/go-node-types-compare.ts`,
  `script/m12/go-wasm-compare.ts`, `script/m12/verify-regex-census.ts`

## Issue

Closes M12.22 (GitHub issue #161).