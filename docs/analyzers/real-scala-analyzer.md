# real-scala-analyzer.md

## Language

- Analyzer file: `src/ast/real-scala-analyzer.ts`
- Parser: `tree-sitter-scala` **v0.26.2** (WASM in `wasm/tree-sitter-scala.wasm`, rebuilt with `tree-sitter-cli 0.22.6` for the web-tree-sitter `env`-import ABI; also mirrored to `~/.bb/wasm`)
- Language detection: extension `.scala` / `.sbt` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealScalaAnalyzer`

### Grammar upgrade (M12.05)

The previously wired tree-sitter-scala grammar failed on **90.7%** of the
scala3 compiler corpus (272/300 files): it cannot parse core Scala 2
constructs — `match` expressions, `for` comprehensions, `sealed trait`,
`private val` constructor params — nor any Scala 3 construct (`enum`,
`extension`, `given`, `opaque type`, `import x as y`, `import a.b.*`,
`derives`). tree-sitter-scala **v0.26.2** (released 2026-08-11) parses the
full construct matrix with zero errors and is a strict superset of the old
grammar's surface: the analyzer's output on the M11 `ScalaService.scala`
fixture is byte-identical on both. Corpus impact: 0/400 sample files with
grammar errors (was 90.7%). Built with `tree-sitter-cli 0.22.6` because
newer CLI versions emit WASI imports that web-tree-sitter cannot satisfy;
the 0.22.6 build imports only `env` functions (like every other wired
grammar) and loads through the engine's real `getParser` path.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_definition`/`trait_definition`/`object_definition`/`enum_definition`/`function_definition`/`function_declaration`/`val_definition`/`var_definition`/`type_definition` → `name` field (identifier / type_identifier); enum cases → `simple_enum_case`/`full_enum_case` identifier; given → explicit name or `given_<line>` (anonymous) |
| kind | ✅ | class → Class, trait → Interface, object → Module, enum → Enum, enum case → EnumMember, def in type → Method, top-level/extension def → Function, `val` → Constant, `var` → Variable, val/var constructor param → Property, primary constructor → Constructor, `type` → Type, given → Constant (`isGiven`) |
| qualified/container name | ✅ | `id` = parent chain + name; `parent` = enclosing symbol name |
| ownerName / ownerKind | ✅ | enclosing type symbol (class/trait/object/enum/given); top-level declarations have no owner (never self-contained) |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as Java/Kotlin) |
| parameters | ✅ | `parameters` → `parameter` → `name` field + `type` field; class params → `class_parameters` → `class_parameter` (name + type); implicit flag from `implicit` child |
| returnType / type | ✅ | `return_type`/`type` field on function/val/var; class param `type` field |
| documentation/comments | ❌ (not extracted) | non-goal for M12.05 (matching Java/Kotlin fixture contract) |
| complexity metrics | ✅ | cyclomatic on `if`/`while`/`do_while`/`match`/`for`/`try`; `complexity` = symbols × 1.5 |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `annotation` nodes → pattern flags + detected frameworks (Play/Akka/Spark from imports) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → `function` field; `field_expression` → leaf identifier (`obj.method` → method); source = enclosing function/method; **exactly one pass** (the old analyzer invoked `handleCall` twice, emitting every call edge duplicated) | 0.9 |
| extends | ✅ | `extends_clause` → first type child (type_identifier / generic_type) — v0.26.2 has direct children (no `compound_type` wrapper) | 1.0 |
| implements | ✅ | `extends_clause` → type children after the first (`with` list) | 1.0 |
| instantiates | ✅ | `instance_expression` (`new Type(...)` — v0.26.2 models constructors as `type_identifier` + `arguments`, NOT a wrapped `call_expression`) and capitalized companion-apply calls (`Point(...)`, `Map(...)`) → Instantiates instead of Calls (Kotlin contract) | 0.7–0.9 |
| uses | ❌ (not emitted) | param names and signature types are not materialized as `uses` edges (the old analyzer leaked parameter names as Uses targets — removed) | — |
| imports | ✅ | `import_declaration` → identifier chain + `namespace_selectors` / `namespace_wildcard` / `as_renamed_identifier` → module path + specifiers | — |
| exports | ✅ | non-private top-level classes/traits/objects/enums/functions | — |
| overrides | ✅ | `override` modifier + enclosing class supertypes → owner-qualified source, declaring-parent target via companion index (`override-context.ts`, shared with Java/Kotlin); without context → first hierarchy parent (deterministic per-file default) | 0.9 |
| references | ✅ | imports → source `(script)` sentinel, target = dotted module path. **An import whose module path cannot be resolved publishes no edge** (SDJ-11) — see invariants below | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` only (top-level declarations never self-contain) | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| field_access | ❌ (not emitted) | property accesses covered at call level; not materialized as separate edges in M12.05 | — |

## Invariants (measured, not asserted)

These are corpus-level properties this analyzer is held to. Each has a script under
`script/m14/tmp/` that measures it; the numbers are from the corpora, not from fixtures.

| invariant | measurement | result |
|---|---|---|
| **no relationship has an empty target** | `scala-empty-target.ts` over both corpora | scala3 **0**, cats-effect **0**. An unnameable edge cannot be resolved, hovered or followed, so an import whose module path is empty publishes no edge (SDJ-11). |
| **anonymous class names are unique per file** | `scala-anon-collision.ts` | 3,330 anonymous symbols over 1,503 files; files with a duplicate name **402 → 0**. Collisions take `#2`, `#3`, … and the first occurrence keeps the bare name (SDJ-8). |
| **an anonymous class's members are attributed to it, not merged** | `scala-anon-consequence.ts` | `CheckCaptures.scala` declares 4 `TypeTraverser` classes; 7 of 8 member edges were previously misattributed to a single node. Now 8/8. |
| **every damaged file is reported** | `scala-damage-census.ts` | 513 of 18,446 scala3 files are damaged (2.8%); **513/513 reported**, 483 naming a node and 30 using the file-level fallback. Zero silent. |
| **analysis is linear in definitions, not quadratic** | `scala-perf-shape.ts`, `scala-perf-corpus.ts` | shape exponent **1.53 → 0.98**; full-corpus **425.6s → 147.4s**; worst single file **135,382ms → 2,971ms**. The cause was `extractScalaDoc` re-scanning all preceding siblings per doc comment. |
| **output is unchanged by the perf fix** | `scala-output-equivalence.ts` | 226,635 nodes, 38,601 relationships, 6,730 symbols — **zero differences** against the committed pre-fix output. |

### Known identity limits

**Extension methods are pinned (SDJ-9, shipped).** A Scala 3 extension method is in scope
only for its receiver type, so the receiver is part of its identity. A colliding name is
published as `name@ReceiverLeaf`; the receiver is also recorded on the symbol
(`metadata.extensionReceiver`), which it previously was not — that omission is why two
`isPackage` methods for `AbstractFile` and `JFile` were byte-identical. Three rules, each
forced by a measurement:

- **Collision-only.** A call's target is the callee as written, so renaming all 3,203
  extension methods would stop the ~3,026 unambiguous ones resolving.
- **Every colliding member is decorated**, not first-bare/second-`#2` — otherwise a
  method's identity would depend on source order.
- **The criterion is 2+ distinct receivers, not 2+ declarations.** PPrint.scala declares two
  `substring` overloads in one block; a count-based rule renamed both to the same
  `substring@SourceFile` and produced a false MISSING against the oracle.

Measured: indistinguishable duplicates **1,148 → 1,123** (25 true merges closed). Pinned by
`scala/m60-extension-identity`, which fails if the rule is reverted.

**Same-named members are still first-wins (SDJ-12, open).** Symbols are not lost — the id is
`${fileId}:${name}:${startLine}` — but the name index is first-wins, so the *second* declaration
of a same-named member in a file is unreachable by name. 1,123 duplicates remain. The dominant
cause is the class + companion object family: both owners share a NAME, their members share a
KIND, and `(using Context)` is not in `parameters`, so `TypeComparer.isSameType` at :2478 and
:3503 are identical on every field the graph reads. The analyzer already stamps `ownerKind`;
the identity does not use it.

## Supported constructs

- Case classes (`case class Point(x: Int, y: Int)`) — class + constructor + implicit-val properties — `Models.scala`
- Sealed traits (`sealed trait Shape`) + case class inheritance (`case class Circle extends Shape`) — `Models.scala`
- Scala 3 enums (`enum Color(val hex: Int) { case Red extends Color(0xff0000) }`) — enum + EnumMember cases — `Models.scala`
- Classes with `val`/`var` constructor params → Property symbols; class-level `var`/`val` → Variable/Constant — `Models.scala`, `UserService.scala`
- Abstract trait methods (`def save(item: T): T` in a trait — `function_declaration`) — `BaseService.scala`, `Repository.scala` (the old analyzer dropped these entirely)
- Cross-file inheritance + override resolution: `class UserService(...) extends BaseService[User] with Repository[User]` → clean extends/implements; `override def save` → `BaseService.save` via companion index — `UserService.scala`
- Companion objects (`object UserService { val instance; def apply }`) with constructor instantiates — `UserService.scala`
- Scala 3 extensions (`extension (s: String) { def shout... }`) — inner defs as top-level functions (no bogus extension symbol) — `Extensions.scala`
- Anonymous givens (`given Ordering[Int] with { def compare... }`) — `constant:given_<line>` + contained methods — `Extensions.scala`
- Type aliases (`type Id = String`), top-level functions, top-level imports — `Extensions.scala`
- Negative fixture (`Negative.scala`): `+`/`*`/`+=`/`-` are infix_expression — never Calls; string interpolation identifiers (`$name`) are not symbols; lambda params and type params are not symbols; plain (non-val/var) constructor params produce no Property symbols; locals inside function bodies are suppressed (Kotlin contract — `val store` inside a method is not a symbol); `new PlainParams(...)` IS Instantiates (positive control).

## Unsupported / explicit-unknown constructs

- **Anonymous given names**: `given Ordering[Int] with { ... }` gets the deterministic name `given_<line>` (anonymous instances have no source name; the synthesized identity keeps the symbol contract total). Named givens (`given intOrd: Ordering[Int] = ...`) use their explicit name.
- **Cross-file override targets**: resolved with the optional `AnalyzeContext.overrideCompanion` (shared `override-context.ts`); without context the analyzer deterministically emits the first hierarchy parent — the honest per-file default (production wiring tracked by M12.44, same as Java/Kotlin).
- **`instance ... of ...` (Scala 3.6 alt-given syntax)**: the v0.26.2 grammar does not parse this experimental form (ERROR node reported as warning); not in the fixture corpus.
- **Compiler-generated members** (case class `copy`/`productElement`, enum ordinal, `equals`/`hashCode`/`toString`): not materialized as symbols; the declared class + constructor + properties are extracted. Documented non-goal for M12.05.
- **field_access edges**: property-access relationships are not emitted as separate edges (covered at call level); documented non-goal.
- **`derives` clause**: parsed cleanly (pattern flag) but the derived instances are not materialized as symbols.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

**0 usages** — the Scala analyzer is fully regex-free. The census gate
confirms zero regex literal or `RegExp` nodes in the source (`scala
entries: NONE`). The rewritten analyzer uses pure char-code checks for
PascalCase detection (`first >= 65 && first <= 90`) and AST node/field
access throughout.

Rule: **zero unclassified regex** — trivially satisfied (no regex remains).

## Complexity envelope

From `validation/m12/results/scala-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 6 | 54 | 57 | 236.0 | 229 | 242 | 206.8 MB |
| corpus_subset | 400 | 25,008 | 79,260 | 14,951.7 | 1,673 | 5,301 | 427.9 MB |

Declared budget: fixtures < 2 s; 400-file corpus < 60 s.

Hot-path audit: single-pass traversal (no per-symbol full-array scans);
`typeIndex` (Map) gives O(1) owner lookups during the relationship
post-pass; override resolution uses the shared `findDeclaringParent` BFS
over the (tiny) hierarchy. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/scala.json`
  (authority: `manual_audit`)
- Result: `validation/m12/results/scala-differential.json`
- Precision / recall / FP / FN / unknown rates:
  **1.000 / 1.000 / 0 / 0 / 0** — 124/124 facts across 7 fixtures (6
  positive + 1 negative), zero parse errors. Edge-case verification added
  `EdgeCases.scala` covering curried calls (`self.add(1)(2)` → one `add`
  edge, no `self.add(1)` noise), function-type parameters
  (`def process(f: Int => Int)` — previously dropped by a cross-language
  denylist bug in the pool-worker), and renamed imports
  (`import x.y.Z as W` keeps the full `x.y.Z` module path; `D => Renamed`
  selectors captured).

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `scala3@18df09c0`
- 400 tracked `compiler/**/*.scala` files (deterministic first-400 sorted,
  pinned revision, clean repo)
- Files / symbols / relationships / errors: **400 / 25,008 / 79,260 / 0
  grammar errors** (0.0% — tree-sitter-scala v0.26.2; the wired grammar
  errored on 90.7% of the same sample)

## Evidence pointers

- Fixtures: `validation/m12/fixtures/scala/`
- Ground truth: `validation/m12/ground-truth/scala.json`
- Differential: `validation/m12/results/scala-differential.json`
- Complexity: `validation/m12/results/scala-complexity.json`
- Corpus sample: `validation/m12/results/scala-corpus-sample.txt`
- Docs: this file

## Issue

Closes M12.05 (GitHub issue #144).
