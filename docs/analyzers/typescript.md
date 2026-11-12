# typescript.md

## Language

- Analyzer file: `src/ast/real-typescript-analyzer.ts`
- Parser: `tree-sitter-typescript` 0.23.2 (npm grammar source), and the **served WASM is the
  repository's own pinned build**, `wasm/tree-sitter-typescript.wasm`, whose sha256
  `b75fa34cfde954d15429b39062d217e6fa99b425a0c3f1aaedd082116dd20335` is recorded in
  `engine.ts`'s `PATCHED_GRAMMAR_SHA256` table. The resolver consults that table BEFORE it reaches
  the dependency tree and serves the repo copy **only when the digest matches** — a file whose digest
  does not match is NOT served and the refusal is logged, so the pin is enforced rather than asserted.
  The pinned build differs from the npm build in one rule: it exposes the triple-slash reference
  directive as a `reference_directive` NODE, which is what makes `part_of` readable at all
  (`script/m14/ts-partof-grammar-proof.ts` hashes both builds and exits 1 if either stops behaving).
  TSX uses `tree-sitter-tsx.wasm`.
- Language detection: extensions `.ts` / `.mts` / `.cts` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealTypeScriptAnalyzer`

## Current receiver-resolution checks

Array-element and explicit generic-argument evidence follows the declaring
lexical binding. Sibling functions, nested blocks, and unknown/destructured
shadowing bindings cannot borrow another binding's type facts. An uninstantiated
type parameter does not become a concrete receiver owner. When an established
local binding supplies no receiver type, calls carry
`typescriptUnresolvedReceiver`; storage withdraws name-only guesses for those
calls. This marker does not claim complete flow-sensitive inference.

`validation/m14/verify-typescript-receiver-scopes.mts` compares 20 source/site/
destination tuples with the installed TypeScript compiler, then checks stored
endpoints and bb_graph callers. Inferred generic constructor arguments remain
explicitly outside the supported syntax evidence. Factory return maps, class
field identity, and the broader `uses` oracle are still under review.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration`/`interface_declaration`/`enum_declaration`/`function_declaration` → `name` identifier; `type_alias_declaration` → `type_identifier`; `method_definition`/`property_signature` → `property_identifier`; `public_field_definition` → `property_identifier`; accessor (`get x`/`set x`) → `method_definition` with `get`/`set` token → normalized to `property`; `namespace`/`module` → identifier; `internal_module` → identifier; `generator_function_declaration` → `function` name; `new_expression` in constructor → `constructor` |
| kind | ✅ | class → Class; interface → Interface; enum → Enum (members → EnumMember); type alias → Type; function → Function; method → Method; accessor → Property (family contract, mirrors C# `property`); field → Property; namespace/module → Namespace; `const`/`let`/`var` at module scope → Constant/Variable; `new X()` constructor → Constructor; generator → Function |
| qualified/container name | ✅ | `id` = namespace chain + name (`Example.Domain.Customer`); `scope` = `buildQualifiedName("")` with trailing-dot stripped; `ownerName`/`ownerKind` from scope stack |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` (row + column) via `nodeRange` |
| parameters | ✅ | `formal_parameters` → each `required_parameter`/`optional_parameter` → name + type annotation (leading colon stripped) |
| returnType / type | ✅ | `return_type` child (colon stripped); `type_annotation` on fields/params; type alias → `type` child |
| documentation/comments | ✅ | `comment` nodes preceding the declaration (JSDoc `/** ... */` and `//` line comments), comment markers stripped via pure-String helpers; exported declarations (`export class X`) look past the `export` keyword wrapper to the preceding JSDoc (fixed in post-close review, exercised by `Domain.ts` JSDoc fixtures) |
| complexity metrics | ✅ | `complexity` metadata on methods (branching nodes counted iteratively) |
| syntax errors | ✅ | ERROR/missing nodes are surfaced by the engine pipeline; fixture parse errors reported as `parseErrors` in the differential |
| decorators/attributes | ✅ | `decorator` nodes → `@Name` and `@Name(args)` parsed via AST (call_expression children); stored in `decorators` metadata AND, since 2026-10-18, emitted as a `decorates` relationship (see the relationship table) — the ten stored values had no honest spelling for "applied TO this declaration", and `references` claimed the symbol mentions the decorator in its body |

## Relationship ontology

**Canonical claim table.** Fourteen rows in the register order of `src/ast/types.ts`, one per
relationship kind this analyzer can publish. `Emitted?` is the analyzer's own answer: all fourteen
are emitted, each from a named site in `src/ast/real-typescript-analyzer.ts`, and the `How resolved`
column names the construct and the rule in the code's terms. Confidence values are the literals the
emission sites carry; where a kind has several sites, every value is listed. These are capabilities of
the analyzer, NOT corpus counts — a population count appears only where the lane has a committed
measurement and is cited as such.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ yes | `call_expression` → the callee's LEAF name by `calleeLeafName()` (identifier; member → property; private `#` kept; `(foo)()` → `foo`; call-of-call / subscript / `super` / anonymous / `await`-wrapped member publish NO edge); source = the enclosing function/method leaf; builtins filtered (console output, Object leaf methods, `super`). A member call whose receiver type the SYNTAX proves carries `metadata.owner` = that class plus `metadata.ownerEvidence` naming which form stated it (`assignment`, `annotation`, `param`, `this`, and the D7 classes `destructured`, `element`, `generic`, `factory`, `cast`, `enum`, `class-static`) — the STORE channel `src/ast/member-owner-resolution.ts` binds the member inside THAT class instead of by bare name. Conflicts within a lexical binding suppress its receiver type; sibling bindings retain separate facts | 0.9 |
| extends | ✅ yes | `class_heritage` → `extends_clause` → the base name (a qualified base stays qualified; a missing type from error recovery is skipped rather than emitted as `""`). **A CALL-SHAPED heritage is a mixin application: its base name is the CALLEE** (`class Post extends Tagged(Timestamped)` → `Tagged`), so an `extends` edge never names a call expression, measured on the fixture `typescript/mixin-application` whose negative half forbids a target ending in `(` | 1.0 |
| implements | ✅ yes | `implements_clause` → each interface LEAF name (`heritageBaseName` strips `<...>` AND the qualifier) | 1.0 |
| uses | ✅ yes | Four syntactic arms, each labelled in metadata: a declared-type reference (`declaredTypeRole`), a type reference (`isTypeReference`), a template interpolation (`isTemplateInterpolation`), a value/member read in expression position (`isFieldAccess`). The duplicate-`references` arbitration is the `references` row's business | 0.85–0.9 |
| imports | ✅ yes | `import_statement` specifiers, `require` calls, side-effect imports and re-exports → `metadata.module` carries the specifier, `metadata.isRequire` / `isSideEffectImport` / `isTypeOnly` / `isReExport` / `localBinding` name the form. **Payload channel too: `ImportInfo[]` is published on the file's import-site** | 1.0 |
| exports | ✅ yes | `export` statements → source = the module leaf, target = the exported name; `metadata.isDefault` and `metadata.kind` name the form. **Payload channel too: `ExportInfo[]` is published on the export-site** | 1.0 |
| contains | ✅ yes | owner → member computed from `ownerName` on the symbol list in one pass (namespace/class/interface/enum/type-alias → member); `firstByName` makes repeated names first-wins, which is the contract and not an accident; the edge takes the MEMBER's declaration line | 1.0 |
| references | ✅ yes | Identifier references in expression position (0.8), and type-position mentions that carry `metadata.relationshipType` naming the position — `declared_type`, `return_type`, `type_alias`, `cast_target`, `type_argument`, `satisfies_target` (0.95); `type_parameter_constraint` and `type_predicate_target` are the two positions that keep both surfaces | 0.8 / 0.95 |
| overrides | ✅ yes | A member of a derived class whose name matches a base-class member, and a member that matches a base-INTERFACE member → `Derived.member → Base.member`. **It ABSTAINS unless the base declaration resolves IN FILE** (`if (!baseDecl) continue`), so the edge is derived from in-file structural truth | 0.95 (⇒ `evidenceClass: usage_contextual`; see limitation 2) |
| instantiates | ✅ yes | `new_expression` → the constructor's LEAF name (generics stripped, `ns.Thing` reduced to `Thing`, JS global constructors filtered because they construct the RUNTIME); the site line is the constructor's own node. **A JSX element that CREATES a component instance is also an `instantiates` row** (`metadata.isJsxComponent`, `metadata.jsxTag`) beside its `renders` row — the two facts are kept distinct | 1.0 (JSX-creation site 0.95) |
| decorates | ✅ yes | Since 2026-10-18 (was a `references{isDecorator}` row): source = the DECORATED declaration (class/method/field), target = the decorator's name leaf (`@module.Decorator` → `Decorator`), `line_number` = the decorator's OWN line, one row per decorator per decorated symbol; a decorator's ARGUMENT is not a row, and the call/reference walks skip decorator position so no duplicate is left behind; `metadata.isDecorator` + `metadata.decoratorLine` | 1.0 |
| renders | ✅ yes | A JSX element whose OPENING name is CAPITALIZED — the language's own component convention — one row per ELEMENT (`<Foo>…</Foo>` and `<Foo/>` are one row each: the opening node is read for the name but never matched as its own node), source = the enclosing declaration, target = the written tag, and `Foo.Bar` from a `nested_identifier` tag. What does NOT fire, each for its own reason: a lowercase intrinsic tag (`<div>`) is an HTML element, a fragment (`<>…</>`) has no identifier, and `React.createElement(Foo, …)` is a CALL, so it stays a `calls` row. Metadata `jsxElement` is the pre-relabel key, kept so an older consumer is not forced to learn a second spelling | 0.9 |
| mixes_in | ✅ yes | A class heritage whose extends-expression is a `call_expression` — `class X extends Mixin(Base) {}` — i.e. a mixin APPLICATION as opposed to inheritance. The discriminator is the SHAPE of the heritage expression, not the base's name; the target is the CALLEE, because that is the factory a reader follows. Metadata `mixinCalleeShape` and `mixinArgCount`. Measured on the population: **2 edges, both resolved** (`vault/ui`'s `class X extends baseResourceFactory<Mount>()`); the lane's first text census counted 0 and was wrong — it required `Name(` and missed a GENERIC callee | 0.9 |
| part_of | ✅ yes | The triple-slash reference directive — `/// <reference path="…" />`, `types="…"`, `lib="…"` — published from the grammar's `reference_directive` NODE, never from a comment's text. The site reads the node's role and target as fields when the build exposes them and otherwise unwraps the node's own fixed spelling by a character walk (the pinned build exposes it as ONE ATOMIC TOKEN). `metadata.partRole` is MANDATORY on every row: a `part_of` edge that does not say WHICH kind of part it is cannot be checked against the directive that produced it. Measured on the population: **50 directives in 34 files (types 47 · path 2 · lib 1) → 50 edges, 0 resolved, 12 ambiguous, 38 unresolved** — a directive's target is a package or lib name, so a per-file scope cannot resolve it, and those 38 edges exist only because this analyzer publishes them | 0.95 |

### Sweep measurements

- **Ten of ten EMITTED** at the time of that sweep (the register later admitted `renders`, `mixes_in`
  and `part_of`, so the committed spec now reads **14 of 14 implemented** — 0 pending, 0
  corpus-unexercised, 0 excluded); none RULED, none GAP — per-type counts and file counts
  over two derived populations (vuejs 400 files, element-plus 400 files).
- **`firing-check-v2` = 8/10** at NFILES 200 and 400 on element-plus; **7/10** at
  NFILES 25. The two silent types (`implements`, `overrides`) are silent because
  that corpus contains 0 of both constructs, which is measured, not assumed.
- **DERIVATION: this lane emits 8 audited types and 2 unaudited** — `exports`
  and `imports`. Measured by evaluating `differential.ts`'s own compared-label
  filter. Both were audited against the differential's own truth builders:
  `exports` 357/357 covered, `imports` 1125/1125 covered, **0 unexplained** each
  on element-plus @200 files. What is still missing is the WIRING: adding both
  labels to the compared-label allowlist in `script/m14/differential.ts` is
  master-owned and is reported as a need, not made here.
- **R7: 0 `unknown` endpoints, 0 empty endpoint names, 0 edges below confidence
  0.7** across both populations.
- **Two open defects, both measured, neither fixed here** — see
  [Known limitations of the edges this analyzer emits](#known-limitations-of-the-edges-this-analyzer-emits).

## Known limitations of the edges this analyzer emits

Two, both with numbers, both deliberately left unfixed because each crosses a
file this lane does not own:

1. **A module-level edge source is a file basename, which is not always an
   identifier.** `imports`, `exports` and `calls` fall back to `moduleLeafName()`
   (`path.basename(filePath, extname)`, `:5764`) when an emission site has no
   enclosing declaration. For `docs/.vitepress/build/crowdin-credentials.ts` that
   is `crowdin-credentials`, and a `-` cannot appear in a TypeScript identifier,
   so no declaration anywhere can carry that name. Measured on element-plus,
   400 files, 22,631 edges: **400 endpoints are not valid identifiers, 321 of
   them sources** (`imports`/source 210, `exports`/source 59, `calls`/source
   52), across 89 distinct values in 69 files. Over the 8 files probed by name,
   0 of 8 basenames is identifier-shaped and 0 of 8 is a published symbol, and
   97 of 288 edges have an unresolvable source.
   The edges themselves are true — that module does import that — so they are
   unattachable rather than fabricated, and the distinction matters for
   `bb_impact`. This is the JS/TS **family contract**, not a slip:
   `real-javascript-analyzer.ts:354` does the identical thing, and the comment
   at `:4491` records the choice as a deliberate earlier fix ("never a `(script)`
   placeholder no consumer can resolve — JS parity: moduleName"). Repairing it
   inside one lane would desynchronise the two analyzers.
2. **`overrides` reports the wrong `evidenceClass`.** It emits
   `usage_contextual` at 0.95 while every other structurally-derived type on this
   lane reports `structural`. Its arms abstain unless the base declaration
   resolves in-file (`if (!baseDecl) continue`, `:7564` and `:7676`), so the edge
   is derived from in-file structural truth and not from a contextual mention.

### Labels with no edge of their own

Four names appear in this lane's history that are **not** relationship kinds in `src/ast/types.ts`,
kept here so a reader who greps for them finds the answer rather than a missing section:

- **`depends`** — not emitted; module dependency is the `imports` kind (see the canonical row).
- **`field_access`** — not emitted as its own kind; folded into `uses` (`metadata.isFieldAccess`) and
  `references`, which is the JS/TS family contract.
- **`imports — type-only marker`** — not a kind: `metadata.isTypeOnly` is a MARKER on an `imports`
  row (`true` for `import type {…}` and for the inline TS 4.5+ `import { type A, B }` form), and it
  adds, removes and re-points no edge.
- **`JSX element usage`** — the label this lane used for JSX before 2026-10-18; it is now the
  `renders` kind (canonical row), and a JSX element that CREATES a component instance is additionally
  an `instantiates` row. The `renders` row's measured bound: a QUALIFIED tag in `.tsx` (`<Ns.Chart/>`)
  is a `member_expression` in this grammar and does NOT fire — a bound of the current name rule, not
  something the relabel expanded.


## Supported constructs

- Modules/namespaces (`namespace X { }`, `module X { }`) — `Domain.ts`, `Services.ts`
- Classes with fields, accessors (`get current()` → property), methods — `Features.ts`, `Negative.ts`
- Interfaces with method signatures and properties — `Services.ts`, `base.ts`
- Enums with members — `Domain.ts`, `Features.ts`
- Type aliases — `Domain.ts` (`UserId`), `Features.ts` (`User`)
- Generics: type parameters, defaults, `extends` constraints, generic args on classes and calls — `base.ts`, `Features.ts`
- Decorators (`@sealed`, `@Get('/path')`) — parsed AST-only, metadata — `Features.ts`
- Overloads: same-name methods in one class dedup to the first occurrence — `Features.ts`
- Inheritance: `extends` + `implements` — `Features.ts`, `Services.ts`
- Overrides: derived method resolving to base method — `Features.ts` (`UserService.format → BaseService.format`)
- Calls: leaf targets, member expressions, optional chaining (`?.`) — `Features.ts`, `Services.ts`
- Instantiation: `new X()` — `Features.ts` (`createService` → `UserService`, `Map`)
- Imports/exports: named, default, namespace, re-export — all fixtures
- JSDoc/comments: `/** */` and `//` extracted as documentation
- Template strings, destructuring, arrow functions: bodies not promoted to symbols (lambda params never symbols) — `Negative.ts`
- Type queries (`typeof X`), keyof, mapped types, conditional types, utility types — corpus-verified

## Unsupported / explicit-unknown constructs

- `import("mod").Type` **type expressions in return/var annotation positions**
  fail to parse with tree-sitter-typescript 0.23.2 (type-alias position parses
  fine; annotation position yields a small ERROR node). Genuine upstream
  grammar gap, not an analyzer defect. Recoverable: the 4 corpus files using
  this construct still extract full symbols (verified: `sys.ts` 208 symbols,
  `host.ts` 53 symbols). Documented in the corpus section.
- `in out` variance annotations on type parameters (TypeScript 4.7) — ERROR
  node; upstream issue tree-sitter/tree-sitter-typescript#364 (open, in
  progress). One corpus file (`transformers/utilities.ts`).
- Tuple element labels (`[symbol: Symbol, ...]`) — ERROR node; upstream
  grammar gap. Two corpus files (`types.ts`, `exportInfoMap.ts`).
- All are small, localized, recoverable ERROR nodes (7 total across 400
  sample files) — never silently dropped constructs.
- The three gaps above were measured against the STOCK parser. The pinned build differs from it in
  exactly one respect — it adds the `reference_directive` rule used by `part_of` and changes no other
  rule — so these gaps are unchanged by the pin; a stock-build re-measurement is what the numbers
  above remain, and a re-measurement on the pinned build is **not made here** rather than assumed
  equal.

## Regex inventory

**0 regex literals**, and the claim is now true rather than aspirational for the third time — each
time because a measurement disagreed with the page. From `validation/m12/results/regex-census.json`:
baseline **36** (the single largest regex user in the codebase), eliminated by the M12.09 regex-free
rewrite, completed for five stragglers on 2026-09-27 (three copies of a type-parameter constraint
strip, a rest-parameter `...` strip, an index-signature `:` strip). **Three more survived that sweep
and were removed on 2026-11-03, all in the `part_of` path**: the file-stem suffix strip
(`/\.[^.]*$/`), the reference-directive unwrap (a text match on the directive's source — replaced by
a character walk over the grammar node's own fixed spelling), and the quote trim (`/^"|"$/g`). Both
`npx tsx script/m12/regex-census.ts --head` and `script/m14/no-regex-gate.sh` read **0 for this
analyzer at HEAD**, and the rewrite was verified behaviour-preserving on the population: 50 `part_of`
edges across 34 files, split `path 2 · types 47 · lib 1`, identical to the pre-rewrite count. All text normalization uses pure-String helpers
(`startsWith`/`endsWith` + `slice`): `stripLeading`, `stripLeadingColon`,
`stripLeadingEquals`, `stripTrailingDot`, `stripTrailingQuestion`,
`stripPrivatePrefix`, `stripPrefix`, `stripLeadingKeyword`, `unquote`,
`stringContent`, `stripCommentMarkers`, `hasBraceEquals`, `stripWhitespace`.
`WHITESPACE_CHARS` spells out the set JS `\s` matches so `stripLeadingKeyword`
stays provably identical to the regex it replaced (an ASCII-only test diverges
on U+00A0), and the three copies of the generic-parameter extractor are now one
module-level `extractTypeParametersOf`.

## Complexity envelope

From `validation/m12/results/typescript-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 67 | 105 | 228.1 | 294 | 460 | 225.0 MB |
| corpus_subset | 399 | 26,513 | 100,594 | 32,206.1 | 823 | 3,123 | 753.1 MB |

Declared budgets: fixtures < 2 s (met: 0.23 s). The 399-file corpus subset is
dominated by the TypeScript compiler's own self-hosting sources (the top
sample files are 200–750 KB — `src/compiler/checker.ts` at 3.1 MB exceeds the
1 MB measurement cap and is excluded by design, matching the F#/Java corpus
methodology).

**The "parse-bound, not analyzer-bound" reading of that row is wrong, and the
M60 gate cannot correct it because it records this analyzer as `unscorable`**
(`validation/m60/results/analyzer-complexity.json`: no `loadRule`, no
`corpusManifest`, so #871 treats the row as not scored). Measured directly on a
real 108 KiB source in this repo (`src/ast/real-javascript-analyzer.ts`,
min-of-N, same process, both analyzer versions loaded side by side):

| | |
| --- | --- |
| `tree-sitter` parse only | 57 ms |
| `analyze()` | 1,863 ms — **97.0% of the cost is the analyzer** |

Scaling is also super-linear: halving the file repeatedly gave 2.00x, then
2.42x, then 2.28x time for each 2x of source. Wall-clock numbers on a shared
box are unstable (the M12 harness header records the same analyzer measuring
25.8 ms/file and 172.6 ms/file minutes apart), so the claims below are stated
as **node visits**, which are deterministic.

Hot-path audit — CORRECTED (2026-09-27). The previous text here claimed "no
O(n²) or per-symbol O(n) scans", "relationship extraction uses name-keyed maps
and the scope stack", and "call source resolution is O(1) leaf extraction".
Measured against the source, all three were false:

- `addContainmentRelationships` is O(n²): one `findItem` linear scan of the
  symbol array per symbol that has an owner.
- `resolveRelationshipSymbol` is a linear `findItem` scan per DECLARATION node
  (not per node), plus an ancestor walk per `method_definition`.
- The name-keyed map it referred to (`symbolsById`) was written on every symbol
  and never read — dead state, now deleted.
- The file walked the tree ~12 times per file (symbol extraction, dup-key
  collapse, imports, exports, three relationship passes, declared-type refs, two
  complexity walks, the file-signals scan, plus one subtree walk per symbol for
  complexity / qualified_calls / taint / comments). A V8 CPU profile attributes
  ~52% of samples to tree-sitter node access and JS↔wasm marshalling against
  ~7% in analyzer code, so walk COUNT is the cost, not the arithmetic.

What the corrected version removed (node visits, 4 real repo files, counted by
instrumenting both versions in one process):

| walk | before | after |
| --- | --- | --- |
| dup-key collapse (was called twice, first result discarded) | 80,514 | 40,257 |
| complexity (per-symbol double walk + a byte-identical second implementation) | 138,442 | 69,860 |
| calls + instantiations (two passes, now one) | 83,154 | 41,577 |

Still true after the correction, and worth keeping: the relationship SET is
unchanged by the fusion (verified per-file as a multiset over 2,457 files:
2,454 identical, the 3 differences being the intended override/export fixes,
1,255 of them order-only).

Since that correction the two quadratic scans are GONE, both replaced by a
name -> first-declared-symbol index built in one pass (first-wins preserved, so
repeated names resolve exactly as the array scan did), and both verified
behaviour-identical over the same 2,457 files:

| scan | before | after | removed |
| --- | --- | --- | --- |
| containment, per owned member | 360,230 comparisons | 24,025 | 93.3% (worst file: 108,755) |
| enclosing-symbol resolver, per declaration node | 41,966 | 9,032 | 78.5% |

The remaining honest cost is the WALK COUNT itself: the usage pass is still
separate because it carries per-function `locals`, and the per-file signal scan
(one walk, shared by the React gate and the taint sink rule) still runs on every
file. Neither is measured by a gate, because M60 still records this analyzer as
`unscorable`.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/typescript.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the C#/Java/F# family contract; 171 facts)
- Result: `validation/m12/results/typescript-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `typescript@b465fdbf`
  (microsoft/TypeScript, clean, 20,798 tracked `.ts` files)
- Sample: 400 tracked `*.ts` files (deterministic first-400 sorted, excluding
  `*.d.ts` and `tests/cases`; 399 measured — `src/compiler/checker.ts` at
  3.1 MB exceeds the 1 MB measurement cap)
- Symbols 26,513 / relationships 100,594 / wall 32.2 s / 0 crashes / 0 timeouts
- Parse quality (fresh parser per file, mirrors production pipeline): 5/400
  files with error nodes (1.3%, 7 ERROR nodes) — all genuine upstream
  tree-sitter-typescript 0.23.2 grammar gaps:
  1. `import("...").Type` type expressions in return/var annotation positions
     (4 nodes: `sys.ts` ×2, `testRunner/parallel/host.ts` ×2)
  2. `in out` variance annotations (1 node: `transformers/utilities.ts`;
     upstream issue #364 open)
  3. Tuple element labels (2 nodes: `compiler/types.ts`,
     `services/exportInfoMap.ts`)
  All 5 files still extract complete symbol sets (recoverable — e.g.
  `types.ts` 5,269 symbols, `sys.ts` 208 symbols), so the errors are small
  and localized, matching the F# precedent (documented honest counts).

## Evidence pointers

- Fixtures: `validation/m12/fixtures/typescript/`
- Ground truth: `validation/m12/ground-truth/typescript.json`
- Differential: `validation/m12/results/typescript-differential.json`
- Complexity: `validation/m12/results/typescript-complexity.json`
- Corpus sample: `validation/m12/results/typescript-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.09 (GitHub issue #148).

---

## 2026-10-17 — marking, callee shape, heritage leaf, constraint refs, and the React/TSX boundary

Measured on the 400-file stride (`bun run script/m14/incoming-gate.ts typescript ts 400`,
population 400 of 13,830 `.ts` files across 39 repos, 0 parse failures). Full evidence, per-revision
mtime and artifact list: `validation/m14/verification/TYPESCRIPT-STATE.md`.

### External marking now has a THIRD proof: the file's own import specifier

`markExternalTargets` already claimed a name was outside the corpus when the file neither declares
nor imports it and the name is in a pinned table (runtime globals, test-runner globals, lib types).
It now ALSO claims a name the file DOES bind when the binding's own `imports` edge names a pinned
test-framework package (`TS_TEST_FRAMEWORK_MODULES`: `@jest/globals`, `@jest/expect`, `jest`,
`vitest`, `@vitest/*`, `mocha`, `chai`, `ava`, `tap`, `uvu`, `jasmine`, `sinon`, `expect`,
`node:test`, `bun:test`, `cypress`, `@playwright/test`, `playwright`, `@testing-library/jest-dom`,
`supertest`; matched by WHOLE SEGMENT). The file's own import is the evidence, and a name the file
DECLARES is never marked; the incoming gate still refutes any claim the project publishes
(`extFAIL` 0). Measured: **+764 verified external claims, −795 unresolved**, every other column flat.

Directly-imported matchers work too: `expect(x).toEqual(y)` marks `toEqual` with
`externalReceiver: "expect"`. A matcher reached through a LONGER chain (`expect(x).to.equal(y)`)
does not mark yet — the receiver-head proof only handles a receiver that is itself a call.

### `calls` targets are callee LEAVES by an allowlist, not callee TEXT

`calleeLeafName()` reduces `(foo)()` → `foo`, an identifier to itself, and a member expression to
its property (private members keep `#`: `this.#step()` → `#step`). Every other callee shape
publishes NO edge: a call of a call (`f()(x)` — the inner call publishes its own), a subscript,
`super`, an anonymous function, and `await`/`!`/`as` wrappers around a member. The wrapper rule is
deliberately narrow and was MEASURED: reducing `await this.request<X>({...})` through `await` emits
the leaf `request`, which a project can (and one does) declare as an unrelated constant in another
file — 17 such edges moved into the gate's file-crossing class and the wide version was reverted.
Measured net effect: all 51 non-identifier `calls` targets are gone; resolved, collRes, ambiguous
and the file-crossing class are unchanged. `metadata.calleeShape` names the wrapper when one was
reduced through.

### Heritage leaf and type-parameter constraint references

* `implements Ns.Shape<number>` → `implements Shape` (leaf). A namespace-imported base's stored
  `qualified_name` is `<module>.<Type>`, never `<alias>.<Type>`, so the dotted spelling could not
  join; the leaf can. CLASS `extends` still publishes its base verbatim (no fixture pins it).
* `<T extends C>` publishes `references owner -> C` with
  `metadata.relationshipType: "type_parameter_constraint"`. The type parameter's OWN name is not a
  child of `constraint`, so it is never leaked as a type reference.
* `x is Foo` / `asserts x is Foo` publishes `references owner -> Foo` with
  `metadata.relationshipType: "type_predicate_target"` AND keeps the `uses` row for the same
  (source, target) — the predicate/constraint positions keep BOTH surfaces.
* **RULING (2026-10-17, commit `8def4a5d5`, Lead-authorised pin-change set):** the DERIV_TS
  one-label ruling was REVERSED. For every OTHER type position the `uses` row now survives and the
  duplicate `references` row is dropped. Four fixture pins moved with the ruling
  (`usage-references`, `parameter-shadows-file-symbol`, `type-alias-mentions-own-alias`,
  `unnamed-signature-members`). Measured effect on the 400-file gate: totals UNCHANGED
  (23,558 / 6,965 / 1,364 / 10,126 / 5,103) while `references` 3,346 → 2,888 and `uses`
  944 → 1,402 — a relabel of 458 edges, not a resolution change.
  See `validation/m14/verification/TYPESCRIPT-STATE.md` “RULING UPDATE (14:00)”.

### Fixtures: 99 pass / 3 fail (from 96/6 at the start of the iteration)

Fixed this iteration: `calls-callee-shape-reduction` (narrow reducer),
`heritage-parameterized-leaves` (leaf + constraint refs),
`type-predicate-and-constraint-refs` (the ruling keeps both surfaces for predicates/constraints).
The four re-pinned type-mention fixtures pass against the ruling. Remaining:
`re-export-empty-clause`, `re-export-module-dependency` (the re-export emitter is not written), and
`type-reference-uses-surfaces` (requires `uses` rows for declaration-owned type mentions — interface
property type, type-alias RHS, module-level variable annotation — with `meta.declaredTypeRole`; the
usage pass does not emit uses for those owners).

### The React / TSX boundary, measured

`.tsx` routes to language id `tsx`, uses `tree-sitter-tsx.wasm`, and runs THIS analyzer — but the
headline gate invocation is `typescript ts`, so `.tsx` is excluded from every number above.
Measured on the corpus: **3,377 tracked `.tsx` files** (= the gate's own `git ls-files` population;
the often-quoted 2,932 excludes the `repositories/proxicall -> ~/ProxiCall` symlink, 445 files),
17 repos, **none named `react`**. Textual: JSX 3,165 (93.7%), `react`/`react-dom` import 1,811
(53.6%), `className=` 1,804, `props`/`Props` 1,580, hook calls 618 (`useState` 303, `useEffect` 333).
Analyzer on a 374-file tsx stride: 374/374 parsed, **1,782 `uses` edges carrying `jsxElement` over
284 files, 613 distinct component targets, 508 hook calls over 130 files**. A separate `tsx` gate run
reads 17,083 edges with 0 extFAIL. The corpus is real React but 84% concentrated in 4 repos; the
proposal `validation/m14/proposals/typescript-react-corpus-widening.md` asks that the lane's gate
invocation become `typescript ts,tsx 400` so React is inside the measured population at all.

---

## 2026-10-18 — vocabulary extension, project-index imports pass, receiver evidence classes

**MEASUREMENT STATUS, stated first because the programme's rule is that a status is not
optional: the code below is landed, the FIXTURES are executed, and the cap-50 arm was
MEASURED on 2026-10-18 against the gate with its owner channel green (numbers in §5). The
WHOLE-PROJECT indexed arm (the one that decides the imports B-class and turns claims on) is
still QUEUED under the maintainer's resource hold — no whole-population number appears in this
section.**

### 1 · Two relabels into the extended vocabulary (owner-admitted, `src/ast/types.ts`)

| construct | was | now | direction |
| --- | --- | --- | --- |
| decorator | `references{isDecorator}` | **`decorates`** | source = decorated declaration · target = decorator name leaf · line = the decorator's own line · one row per decorator · an argument is NOT a row |
| JSX element | `uses{jsxElement}` | **`renders`** | source = enclosing declaration · target = written tag · one row per ELEMENT (paired element = 1 row) · lowercase intrinsic tags and fragments fire nothing · `React.createElement(Foo)` stays `calls` |

Both relabels are 1:1 by the owner's direction. Both now have a `classifyEvidenceTier`
branch (previously they fell through to `usage_contextual`): `decorates` is `structural`
unconditionally (read off the declaration's own decorator list); `renders` follows
`instantiates`'s rule (`conf >= 0.9 ? structural : usage_contextual`) because it is the same
kind of fact — a construction site written in the source.

Fixtures: `typescript/decorator-emission` (positive + five forbids: old label, argument,
class-scoped attribution, decorator invocation as a call) and `typescript/tsx-renders`
(three element rows + exact-count rows + forbids for lowercase tags/fragments/React/
`createElement`'s argument). The tsx fixture cannot be run by `script/m14/run-fixtures.ts`
(one extension per language, and `.tsx` needs the tsx grammar), so
`script/m14/ts-fixture-probe.ts` executes the SAME expectation file the runner would read and
carries a NEGATIVE CONTROL that swaps each new label back and requires the checks to go RED.
Last run: `bun run script/m14/ts-fixture-probe.ts` → decorator-emission 7/7 PASS,
tsx-renders 12/12 PASS, both controls FIRED, overall PASS.

```bash
# the relabel pair, once the box allows a measurement (cap-50 before/after):
export BB_CORPUS_ROOT=$PWD/.corpus
bun run script/m14/incoming-gate.ts typescript ts 50      # expect references to FALL, decorates to appear; uses unchanged on .ts
bun run script/m14/incoming-gate.ts typescript tsx 50     # renders appears; uses falls by the JSX rows
```

### 2 · `imports` B-class: the project index decides the spelling (fail-closed on `complete !== true`)

`applyProjectIndexClaims` rewritten. The previous version re-spelled `module:name` → bare
`name` whenever `index.symbolNames.has(name)`, with no locality test and no uniqueness test —
which is the measured false-binding class (432 ts external items bind to a project symbol that
merely shares the name) and cannot tell one declaration from two. It also attached an
`owner`-kind claim to `module:item` targets, which the arbiter reads as a URI and leaves
`extUnverified` (a claim no check can reach, which BLOCKS a pass), and claimed EVERY bare
`calls` target absent from the narrow `symbolNames` — including calls to local functions and
parameters, which are not external.

Now, only with `ProjectIndex.complete === true` and `symbolCounts`/`modules` present:

* **RESOLUTION** — an `imports` edge `module:name` is re-spelled to bare `name` only when the
  specifier is the project's own module space (relative/absolute by path algebra, or a package
  name the project's own `package.json` `workspaces` declare — read once per project root,
  cached, fail-closed on read failure) AND `symbolCounts` says the name is declared EXACTLY
  ONCE (production's own `_res_name.cnt = 1`). Two declarations → `projectIndexAmbiguous`,
  no re-spelling. Zero → `projectIndexItemNotDeclared`, **no claim**.
* **CLAIM** — an `imports` edge whose module is NOT project-local carries
  `externalReason: "module-namespace"` + `externalSpecifier`, which the arbiter verifies
  against the project's module space and can never REFUTE (it degrades to unverified); a module
  root the project publishes is refused here (`projectIndexModuleShadowed`) instead of claimed.
  The same claim attaches to any other edge whose target — or whose callee receiver ROOT — is a
  binding imported from that external module (`computed()` from `vue`, `path.join()` from
  `node:path`, a mention of `Ref` from `vue`). **A claim is not a resolution.**
* The blanket `calls` bare-name claim is REMOVED (see above).

**The measured bound this exposes:** `TYPESCRIPT_DECLARATION_SPEC` records declared TYPES and
their MEMBERS in `symbolNames`/`symbolCounts`; free functions and module-scope bindings are not
in it. So workspace-package imports of a `const`/`function` (e.g. `@element-plus/utils:isString`)
stay unresolved until the spec is widened with `nameOnlyNodes` (function/variable/namespace
declarations) AND the name-only branch increments `symbolCounts`. That is a shared-file change
(`src/ast/project-index.ts`, maintainer-owned) and is reported as a need, not made here.

### 3 · Receiver typing: four syntactic forms, one store channel, evidence per form

`metadata.owner` (the channel `src/ast/member-owner-resolution.ts` reads — it WITHDRAWS the name
binding and re-resolves inside the one class-like owner) now carries for four forms, each with
`metadata.ownerEvidence`:

| evidence | form | example |
| --- | --- | --- |
| `assignment` | initialiser is a constructor | `const c = new Widget()` |
| `annotation` | local type annotation | `const d: Widget = make()` |
| `param` | parameter type annotation (incl. a DESTRUCTURED binding typed from the member: `function f({ worker }: Settings)` -> `worker` is `Settings.worker`'s declared type) | `function f(w: Widget) { w.run() }` |
| `this` | one-hop annotated field access | `private inner: Widget; this.inner.m()` |

A name declared with two different types in one file is dropped whole (shadowing makes the
file-level answer ambiguous and the store DELETES a correct binding for an owner it then cannot
resolve). One hop is typed in each direction: `cfg.worker.m()` (a member of a typed parameter) and
`this.field.m()` (an annotated field). A DESTRUCTURED binding is typed from the member's own
declared type when the annotation names a type this file declares (`{ worker }: Settings`,
`Settings { worker: Widget }`) — the member's stated type only, never a guess. Deliberately not
included: post-declaration assignment, `as` casts, factory return types, destructured members whose
type is not stated in the file, and receiver chains deeper than one hop.

**Measured trap, recorded on the symbol (`bb_annotate receiverOwnerType`):** the `this`-field
class was DEAD on arrival because the field-name node in this grammar is a `property_identifier`
and the test accepted only `identifier`; the collector recorded the field, the lookup found it,
and the test rejected the name node — rows carried no owner and the evidence class silently
reported zero. `typescript/receiver-owner-from-new` now asserts one positive row per evidence
class plus two line-scoped forbids on receivers that state no type.

Coverage instrument: `script/m14/ts-owner-coverage.ts` (derives its population the way the fleet
gate does, prints the stride/repo count, counts `calls` rows carrying `owner` and breaks them
down by `ownerEvidence`; never reports an owner-carrying row as resolved).

```bash
export BB_CORPUS_ROOT=$PWD/.corpus
bun run script/m14/ts-owner-coverage.ts --max-files 50 --per-repo
# whole-project (honest unit for a receiver question — run one repo at a time):
bun run script/m14/ts-owner-coverage.ts --max-files 0 --repo=apollo-server --per-repo
```

### 3b · Binding spelling for names the family never publishes

A parameter, a type parameter, a catch binding and a nested-scope declaration are names no symbol
table can own; emitting them bare makes the resolver look them up by name. The classification
measured 69 such rows at cap-50 (type parameters alone were 53 of the `references` residual). They
now carry the family spelling `<caller>\u0000<binding>` + `metadata.localBinding` (src/ast/types.ts
`BINDING_SEP`; dart's calls emitter uses the same form), verified by the arbiter from the target's
own spelling. `metadata.resolvedBindingName` keeps the written name and `metadata.bindingKind` names
the kind (`parameter` / `type_parameter` / `catch_binding` / `local`), so no consumer parses a NUL
target to learn what it is.

THREE GUARDS, because re-spelling is only honest where it is true: the name must be declared in this
file as one of those bindings, must NOT be a published symbol of this file (a published nested
function is a resolution target — re-spelling it would MASK a resolution), and must NOT be an import
binding. Measured trap while building it: a type parameter's name node is a `type_identifier`, not an
`identifier`, so a test accepting only `identifier` made the whole type-parameter class invisible —
the same dead-class shape as the `this`-field trap above. Pinned by
`typescript/local-binding-spellings` (two binding-spelled positives per class + the published-name
guard asserted from both sides).

### 4 · The comprehensive cause table for every unresolved edge

`validation/m14/verification/TYPESCRIPT-RESOLUTION-CLASSIFICATION.md` — every non-resolved edge
at cap 50 (2,100 dump rows, 100% joined) classified by cause with counts and the disposition
each bucket must land in (resolution vs claim vs binding), plus the ranked lever table. It is
cap-50 TRIAGE; no bucket count there is a population claim.

### 5 · CAP-50 MEASURED, gate green with the owner channel modelled (2026-10-18)

Command: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts typescript ts 50`
(50 of 13,950 admitted `.ts` files, stride 279, 40 repos, 0 parse failures). Before column =
the same command captured before any of this round's code; after = HEAD of this round.

| label | before edges/resolved/unresolved | after edges/resolved/unresolved | note |
| --- | --- | --- | --- |
| calls | 1616 / 69 / 1148 | 1616 / **64** / **1153** | the gate's owner channel is now modelled; 5 rows whose NAME would have resolved are WITHDRAWN because the channel declines their owner in this stride (production holds those NULL) |
| references | 291 / 49 / 187 | **281** / 49 / **179** | −10 rows are the decorators, moved to `decorates`; the 2 ambiguous rows went with them |
| decorates | — (did not exist) | **10 / 0 / 8** (2 ambiguous) | the relabel, 1:1 by construction; 2 of the 10 are ambiguous member names in the stride |
| renders | — | 0 on `.ts` | JSX cannot appear in a `.ts` file; measured on the tsx arm below |
| imports / exports / extends / implements / instantiates / uses / contains / overrides | unchanged | unchanged | this round changed no emission for them at cap-50 |
| **TOTAL** | 2497 / 397 / 1624 | 2497 / **392** / **1629** | `extOK` 447 both sides, `bindOK` 16 both sides, `extFAIL` 0, `causeFAIL` 0; **`arbitraryTwin` TOTAL 47 before and 47 after** (calls 43, uses 2, 2 moved from references to decorates) |

The gate's own stderr block, quoted because it is the channel's measurement and not this
document's:

```
owner channel (production rule, modelled): 126 row(s) carried metadata.owner · resolved 0 · declined 126
  (ownerAbsent 125 · noMember 1)
owner channel vs name model: 0 row(s) the name count called ambiguous/unresolved and the channel
  resolves; 5 row(s) the channel DECLINED whose name would have resolved — production holds those
  NULL (withdrawn binding)
```

**CAP-50 IS A LOWER BOUND FOR THIS CHANNEL**, and saying so is required: the channel is
project-scoped and the stride samples ~1 file per repo, so an owner class declared in an
unsampled file reads `ownerAbsent` (125 of 126 here). The whole-repo arm is the honest unit.

**TSX ARM** (`incoming-gate typescript tsx 50`): `renders 222` rows (17 resolved, 205
unresolved) · `uses 63` · calls 718 · imports 394 · references 209 · instantiates 12 ·
decorates 0. No before-run exists for this exact 50-file tsx stride, so the relabel's
population effect is NOT reported as a delta; the 1:1 property is proven by construction (same
emission site, same target/line, one row per element) and by the fixture probe (12/12 rows,
control fired). Scale check only: the previous round measured 1,782 JSX rows over a 374-file
tsx stride (4.8/file); this arm reads 222 over 50 files (4.4/file).

**OWNER COVERAGE** (`script/m14/ts-owner-coverage.ts --max-files 50 --per-repo`, same
population as the gate): calls 1,616 · member calls 826 (51.1%) · owner-carrying 126 — **7.8% of
all calls, 15.3% of member calls** — by evidence: `this` 68 (54.0%), `assignment` 40 (31.7%),
`annotation` 11 (8.7%), `param` 7 (5.6%). Before the four-form extension the same population
carried 51 owner rows. Per-repo shares run from 0.0% (r-air, vue-core) to 17.8% (vault), so
the coverage is never pooled into one claim. **The four syntax-proven forms do not cross the
wall**: they reach about one member call in six; the remaining five need receiver types the
syntax does not state (unions/primitives, destructuring, factory returns, post-declaration
assignment) and are left unowned rather than guessed.

### Factory binding verification

Factory-return hints follow lexical callable bindings. An unknown shadowing
parameter/local, conflicting overload return, uninstantiated type parameter, or
write to the callable prevents borrowing another declaration's return annotation.
Calls preserve their source declaration offset through storage, including nested
functions sharing a source line. The 16-site TypeScript compiler-backed regression
and three source mutations are in
`validation/m14/verify-typescript-factory-bindings.mts` and its mutation runner.
Overload selection and flow-sensitive callable reassignment remain unsupported.

### Field binding verification

Field receiver evidence is local to a class declaration and its static or instance
side. Arrow functions retain lexical `this`; ordinary functions and object methods
do not borrow their enclosing class's fields. Unknown field chains remain
unresolved. Fifteen compiler-backed sites, worker edit/restoration, graph queries,
and three source mutations cover this pass. Inherited-field lookup and arbitrary
field writes are still outside this evidence boundary.

### Generic argument positions

Explicit generic arguments retain their positions even when a primitive, union,
array, or unknown argument cannot name a receiver owner. Visible type parameters
remain unknown until instantiated. The 12-site compiler-backed generic matrix
checks direct/worker storage, incremental edits, graph results and three source
mutations. Defaults and inferred generic arguments are still unsupported here.

### Signature parameter scopes

Parameters in ambient declarations, interface/abstract methods, callable types,
and constructor signatures belong to the signature, not its surrounding runtime
scope. The factory matrix includes seven signature forms and rejects removal of
each boundary independently. Adding an interface parameter named `make` must not
change a runtime factory call elsewhere in the file.

### Receiver writes

Writes to inferred lexical bindings withdraw initializer and collection evidence;
destructuring, logical assignments, loop targets and closure writes are included.
Explicit supported annotations remain static reference evidence, while `any` or
union annotations cannot silently inherit an initializer owner. One standalone
late initialization in the declaration block is available only after that site.
The 36-site compiler-backed write matrix, 22 executable dispatch scenarios, eight
source mutations and worker edit/restoration checks cover this repair. General
control flow, alias effects and field/collection content writes remain outside it.

### Same-line call identity

Each `calls` edge carries the call-expression start offset in
`metadata.callSiteStartIndex`. Storage and bb graph deduplication use it so
repeated calls on one line survive, including calls to different receiver
classes with the same method name. Duplicate delivery of the same site remains
idempotent. Twelve independently compiler-derived source/line/offset/owner tuples,
Unicode source, nested callers, worker source shifts/restoration, both graph
directions, six invalid metadata shapes and five source mutations verify this
path. Existing indexes need the changed TypeScript files reindexed to acquire
these offsets. Other edge kinds still use their existing identity rules.

### Loop receiver bindings

For-of receiver facts follow JavaScript binding scopes: `var` is function-scoped,
`let`/`const` are loop-scoped, and a target without a declaration writes its existing
binding. Repeated var declarations participate in conservative write invalidation.
Thirteen compiler-backed sites, three source mutations and worker edit/restoration
checks verify this behavior; loop execution and flow-sensitive narrowing are not
inferred.

### Inferred field writes

Writes to an inferred field remove its initializer evidence from both `this`
lookup and class member lookup. Known owners are distinguished by class and
static/instance side; patterns, computed access and lexical arrows participate.
Explicit field annotations remain static reference evidence. Twenty-three
compiler-backed call sites, 15 executable scenarios, five source mutations and
worker edit/restoration checks cover this path. Untyped aliases, cross-file
writes and arbitrary mutator calls are not resolved by this scan. The inherited
field extension below handles a bounded same-file hierarchy. A dynamic property key conservatively invalidates all inferred fields
on its known owner.

### Inherited fields

Concrete field facts follow unique top-level, same-file classes with bare-name
parents, through multiple inheritance levels. Unknown own declarations (including
constructor parameter properties), methods, accessors and computed members block
ancestor fallback. Static and instance fields remain separate. A known-owner
write through a subclass invalidates the inferred declaring field before any
inherited facts are propagated; a child's own field does not invalidate a
separate parent field. Supported annotations remain static evidence.

The gate `validation/m14/verify-typescript-inherited-fields.mts` checks 33 exact
source/line/offset/owner tuples and 15 executable scenarios. Seven implementation
mutants fail. Storage, bb graph caller sets and real worker parent changes,
source shifts and restoration are checked. Generic parameter substitution across
heritage, nested/namespace-qualified/dynamic parents, cross-file hierarchies and
external class-name static field chains remain unsupported by this extension.
Constructor parameter properties block inherited inference but are not newly
inferred themselves. Computed own names conservatively block inheritance when
identity is unavailable. This is not a runtime dispatch guarantee.

### Writes through aliases

For invalidation only, the field-write scan follows lexical identifier aliases
through declaration initializers and simple assignments. Possible origins survive
rebindings, including cycles, closure captures, new instances and static class
aliases. `this` origins respect arrow capture and ordinary-function rebinding;
parenthesized/cast/non-null wrappers retain the origin. A possible write removes
an inferred field owner for the whole declaration. Explicit supported field
annotations retain static reference evidence.

The alias gate checks 37 exact call sites, 19 executable scenarios, five source
mutations, storage and bb graph callers. Real workers verify write removal and
restoration as well as source-offset shifts. This bounded provenance scan does
not infer alias call targets or prove temporal alias identity. Destructured and
container-derived aliases, conditional/logical alias assignments, arbitrary call
effects, cross-file aliases and general interprocedural analysis remain open.

### Conditional alias origins

Field invalidation now follows both value branches of a ternary expression,
logical `&&`/`||`/`??` operands, logical-assignment right sides, assignment-expression
values and the final operand of comma expressions. Conditions and discarded
comma operands are excluded. Origins are conservatively combined without
claiming that a branch executes. The conditional-alias gate verifies 28 exact
call sites, 12 executions, five source mutants, fresh graph callers and real
worker edits/restoration. Destructured aliases, containers and arbitrary call
effects remain separate gaps.

### Destructured alias origins

Field invalidation projects literal-backed object keys and array positions
through destructuring declarations and assignments. Renamed/nested patterns,
defaults, shorthand and quoted/computed literal keys, container aliases, static
member/index reads and object spreads retain possible origins. Array holes count
as positions. Object/array rest bindings are copies and do not acquire the
source object's identity. Projecting a property from a typed object does not
mistake the container itself for that property's value. Recursive projections
are guarded by active lexical bindings as well as previously visited paths.

The destructured-alias gate checks 50 exact sites, 23 runtime scenarios, six
source mutants and real-worker write removal/restoration and offset shifts,
including storage and bb graph. Dynamic keys, array spreads of unknown length,
container-content mutations, arbitrary calls, parameter-pattern projections and
cross-file alias effects remain outside this extension. Defaults and spread
origins are conservative possibilities, not a claim about which branch wins.

### Repeated alias declarations

All declaration initializers contribute possible origins for a shared lexical
binding, including repeated `var` declarations inside blocks and destructured
`var` declarations. A declaration without an initializer does not erase an earlier
origin. Block-scoped shadows remain separate. The existing single-declaration
map still serves late-initialization checks; alias provenance has its own list.
Twenty exact call sites, six executable scenarios, two rejected source mutations
and real-worker origin changes/restoration verify this repair. Loop-produced
alias values and arbitrary content writes remain outside this declaration scan.

The inheritance and alias regression gates also have a dedicated static check:
`bunx tsc --noEmit -p validation/m14/tsconfig.alias-gates.json`. It includes all
ten `.mts` gate and mutation-runner entry points, which the older script ratchet
does not include. The dedicated check passes with zero diagnostics.
