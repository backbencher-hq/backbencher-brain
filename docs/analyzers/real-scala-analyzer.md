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
| uses | ✅ | value/field READS (name reads and extension-method receiver types), on the line the NAME is written; the write side of an assignment is gated out. Parameter names and signature types are still NOT materialized (the old analyzer leaked parameter names as Uses targets — removed) | 0.9–0.95 |
| imports | ✅ | `import_declaration` → identifier chain + `namespace_selectors` / `namespace_wildcard` / `as_renamed_identifier`; the DEPENDENCY is the depended-on name's module path (selector names expanded), source is the FILE sentinel `(file)` — a separate label from the audited import `references` rows | 1.0 |
| exports | ✅ | the public top-level surface (classes/traits/objects/enums/givens/defs/val/var/type aliases), published under BOTH the package-path and `(file)` identities from one predicate; Scala 3 `export` clauses publish the names they INTRODUCE (leaf/alias/given head), sourced at the enclosing declaration or the module identity; a wildcard clause publishes a 0.7 scope row only when its qualifier is one NAME | 1.0 (0.7 wildcard) |
| overrides | ✅ | `override` modifier + enclosing class supertypes → owner-qualified source, declaring-parent target via companion index (`override-context.ts`, shared with Java/Kotlin); without context → first hierarchy parent (deterministic per-file default) | 0.9 |
| references | ✅ | declared-type positions → source = enclosing function/type, `(script)` at file level; import references → source `root`, target = dotted module path. **An import whose module path cannot be resolved publishes no edge** (SDJ-11) — see invariants below | 0.9–0.95 |
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

---

# Ontology workstream — DERIV_EXPORTS_SCALA (addendum, 2026-10-05)

Verdicts here are per ONTOLOGY-WORKSTREAM.md: EMITTED needs a production-path
count and the files; RULED needs a reason **and** a corpus measurement; GAP needs
the language's construct and then an implementation.

## Baseline — firing-check-v2, production path, NFILES=200

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs DERIV_EXPORTS_SCALA

    SCALA  8/10  200/200 parsed   silent: imports exports
    imports[] 649 in 148 files
    counts: calls:7222 references:4181 contains:2544 uses:1696
            instantiates:1178 extends:234 overrides:131 implements:20

Sample: code-bearing `.scala` from `fixtures/repositories/scala` (dotty, 18,965
`.scala` files on disk). First two sampled: `project/VersionUtil.scala`,
`project/Versions.scala`.

`imports` absent from the relationship tally while `imports[]` is 649 is **not** a
defect — `ParseResult` carries imports on a separate channel (`types.ts:206-216`)
and `parallel-indexer` writes them to the `brain_import` TABLE, never to
`brain_relationship` rows (REVIEW-2026-10-04.md §1). `imports` is judged on that
channel. `exports` is a relationship-channel type and IS silent — that is the gap.

## scala IS among the DERIVATION findings — three of the 104

`validation/m60/rel-type-coverage-baseline.json` (at 2026-10-01) holds 104
DERIVATION findings across 38 lanes. `scala` holds **3** of them:

    DERIVATION|scala|emits `contains`   but the differential audits ["calls","extends","implements","instantiates","overrides"]
    DERIVATION|scala|emits `references` but the differential audits ["calls","extends","implements","instantiates","overrides"]
    DERIVATION|scala|emits `uses`       but the differential audits ["calls","extends","implements","instantiates","overrides"]

So 3 of the 8 relationship-channel types this analyzer emits are stored and
compared against nothing. At the NFILES=200 baseline those three classes are
**references 4181 + uses 1696 + contains 2544 = 8,421 of 17,406 edges = 48.4%**
of everything the analyzer publishes. This is a first-class part of the job,
because an unverified edge ships a bug invisibly.

Confirmed the wiring problem before touching anything: `readOwnOracleLabels()`
in `script/m60/rel-type-coverage-gate.ts:186` prefers `script/m14/<lang>-truth.ts`
over the shared filter, but `script/m14/differential.ts` consumes lane oracles by
PER-LANE hardcoded import (`:23040` fsharp, `:738` zig, `:48` clojure). Creating
`script/m14/scala-truth.ts` without a `differential.ts` adapter would make the gate
delete all three findings while nothing audits them — a repayment in name only.
Not done; reported to master instead.

## Whole-population census — 18,965/18,965 files, production path

    bun script/m14/tmp/scala3-ontology-census-v2.mts plan
    # 64 shards, 8 at a time:
    bun script/m14/tmp/scala3-ontology-census-v2.mts shard <i> 64      # x64
    bun script/m14/tmp/scala3-ontology-census-v2.mts merge 64

Corpus: `fixtures/repositories/scala` (dotty), 18,965 `.scala`/`.sbt` files
discovered by directory walk. **Covered 18,965 — missed 0, read/parse fail 0,
analyze threw 0, size-capped 0.** 513 files carry a tree-sitter ERROR/MISSING node
(2,380 nodes) and **513 of the 513 published a diagnostic**.

Population note, because it decides what a 200-file draw can see: **15,701 of the
18,965 files (82.8%) are under `tests/`** — dotty's own negative/positive test
sources. `compiler/` is 722 and `library/` is 894. A draw that starts in
`project/` (which is what NFILES=200 does) is 35 files of build definition.

### The per-type table, whole population

| type | verdict | edges | files | distinct (src,tgt) | target resolves (corpus name set) | conf | R7 placeholder endpoints |
|---|---|---|---|---|---|---|---|
| calls | EMITTED | 219,550 | 11,451 | 107,534 | 212,686 (96.9%) | 0.9 | 21 |
| references | EMITTED | 292,174 | 17,250 | 230,459 | 254,251 (87.0%) | 0.9 | 894 |
| contains | EMITTED | 181,373 | 16,127 | 161,939 | 181,373 (100.0%) | 1.0 | 283 |
| uses | EMITTED | 59,799 | 7,370 | 58,603 | 51,400 (86.0%) | 0.9 | 9 |
| instantiates | EMITTED | 59,148 | 8,753 | 35,615 | 55,611 (94.0%) | 0.9 | 14 |
| extends | EMITTED | 21,753 | 7,965 | 18,438 | 19,519 (89.7%) | 1.0 | 0 |
| overrides | EMITTED | 14,231 | 2,565 | 13,526 | 0 (0.0%) — see below | 0.9 / unset | 0 |
| implements | EMITTED | 4,453 | 818 | 4,392 | 4,289 (96.3%) | 1.0 | 0 |
| imports | GAP (carrier note) | 0 on relationships | 0 | 0 | — | — | — |
| exports | **GAP** | 0 on relationships | 0 | 0 | — | — | — |

Total: **852,481 relationship edges, 233,490 symbols, 73,072 distinct symbol
names.** Off-vocabulary relationship types emitted: **0** — every edge the analyzer
publishes carries one of the ten production values (`engine.ts:445-466`).

### `overrides` resolves at 0.0% against symbol NAMES, and that is a shape not a defect

`overrides` targets are **owner-qualified**: `AutoPlugin.requires` (190),
`Iterator.hasNext` (157), `Foo___.f` (120). The corpus symbol names are BARE
(`requires`, `hasNext`, `f`), so a name-set lookup returns 0 for every one of the
14,231. The leaf of each target is a real declaration — the shape is
`DeclaringParent.member`, which is the shape `override-context.ts` produces
deliberately. The honest reading is that the number in this column measures "does the
target equal a published bare name", which is the wrong question for `overrides`; the
right one is measured separately below.

### R7: 1,221 edges carry a placeholder-LITERAL-shaped endpoint, and the set needs adjudicating

Blanket-`Set` count (spelling list `_ * ? unknown n/a null nil TODO - -- ???`):
`references '?'` 876, `contains '*'` 121, `contains '-'` 113, `contains '--'` 16,
`contains '?'` 12, `instantiates '_'` 10, `calls '--'` 10, `references '*'` 8,
`uses '_'` 8, `calls 'unknown'` 7, and 60 more across 22 spellings.

**This number is an upper bound and I will not report it as 1,221 defects.** `*`,
`-` and `--` are LEGAL Scala method names (`def *(x: T)`, `def unary_-`), so a
`contains` edge `Foo -> *` can name a real symbol, and `?` is legal in Scala 3. Rule
R7 forbids a placeholder that NAMES NOTHING; it does not forbid a legal operator
identifier. Each spelling is adjudicated by locating the declaration it claims to
name — see the adjudication section below.

### `imports` — 23,776 on its own channel, 0 on the relationship channel, and this is NOT a gap

`imports[]` = **23,776 `ImportInfo` in 8,252 files**, against **23,776
`import_declaration` nodes in 8,252 files** measured by the grammar probe: exactly
1.000 per declaration, no sample. 23,769 carry a non-empty module path and **7 carry
an empty one**. 27,457 items across them; `alias` is populated on 0 and
`isNamespace` on 0.

`imports` is absent from the relationship channel because
`parallel-indexer.ts:2169` writes it to the `brain_import` TABLE. Two independent
consumers confirm the channel is the real one: `import-resolution.ts:381` selects
`import_path` from `brain_import`, and `graph-engine.ts:45` lists `imports` in
`DEFAULT_REL_TYPES` where a traversal reads the union of both. **Verdict on the
imports carrier: EMITTED, 1.000 per declaration.**

### `exports` — a GAP, and the analyzer already computes the data and then throws it away

Three separate measurements converge:

1. **The construct exists.** `export_declaration` = **277 nodes in 158 files**;
   the `export` token = 277 in 158. `namespace_selectors` 2,610/1,563,
   `as_renamed_identifier` 289/184, `arrow_renamed_identifier` 697/446,
   `namespace_wildcard` 10,974/5,021.
2. **The analyzer produces an export surface — on a channel nobody persists.**
   `exports[]` = **47,350 `ExportInfo` in 18,737 files**, 0 empty names, 8
   placeholder-shaped names. Grepped every writer: **no code path inserts
   `ExportInfo` anywhere.** `pool-worker.ts:1110` and `engine.ts:1801` only forward
   it.
3. **Consumers ask for `exports` as a RELATIONSHIP.** `graph-engine.ts:45` lists it
   in `DEFAULT_REL_TYPES`; `parallel-indexer.ts:3451` and `:3463` carry a
   dedicated defensive filter `if (relType === "exports")`; and
   `import-resolution.ts:404` selects
   `brain_relationship ... WHERE relationship_type = 'exports' AND target_external IS NOT NULL`
   to build the export surface. That query returns **nothing** for a Scala project,
   because 0 rows of that type are ever written.

So Scala HAS the construct (277 measured declarations), the analyzer reads it well
enough to name 47,350 exports, and the export surface is dropped at the persistence
boundary. That is a GAP, and it is the same shape as the 15-of-20-lanes `exports`
finding in REVIEW-2026-10-04.md §4.

## Two MEASURED dead branches in the main walk

The single-pass walk pushes only `namedChild(i)`
(`real-scala-analyzer.ts:572-577`), so a branch keyed on an **anonymous token** can
never match. Probing over ALL children rather than named children is what separates
these two from the live ones:

| branch | line | token in corpus | pattern flag it sets | files with the flag |
|---|---|---|---|---|
| `node.type === "override"` | :496 | `override` token: **10,897 nodes / 2,245 files** | `Override/Polymorphism` | **0 — never published** |
| `node.type === "using"` | :473 | `using` token: **15,236 nodes / 3,789 files** | `Using Clauses (Scala 3)` | **0 — never published** |

Neither flag appears in the 29 `metadata.patterns` the analyzer actually published
over the whole corpus. The constructs are NOT missing — `overrides` publishes 14,231
relationships through `collectModifiers` (:1099-1112), which reads `childCount`, not
`namedChildCount`, so it sees the token. Only the two **pattern flags** are dead.
This is exactly the shape source-derivation cannot see: both branches are
constructible, both are reachable in the source, and neither can ever fire.

Sibling live flags for contrast, same census: `opaque_modifier` 458/323 ->
`Opaque Types (Scala 3)` 323 files; `derives_clause` 298/88 -> `Derives` 88;
`inline_modifier` 6,456/2,145 -> `Inline Methods (Scala 3)` 2,190 (also set by
`transparent_modifier` 663/361); `export_declaration` 277/158 -> `Exports (Scala 3)`
158. Flag count and construct file count agree, which is what a live branch looks like.

---

# M60 scala FOLD (2026-10-10) — the two JVM rulings, and four fixtures that were ratifying a defect

`npx tsx script/m14/run-fixtures.ts scala` went **71 pass / 5 fail → 72 pass / 5 fail**: one NEW
fixture (`scala/declaration-name-anchoring`), four RE-PINNED fixtures that had been pinning the
retired spelling, and the same five pre-existing failures the lane carried into this work. Two
rulings were folded, and the lane was measured BEFORE the code was touched, because the claim
that kotlin and scala "share the ctor-identity and line-anchoring rulings" came from the *shape of
their declared failures* (`BRANCH-INVENTORY-2026-10-07.md` §14/§15), which turned out to be the
wrong axis for both lanes.

## Ruling 1 — constructor identity (M37.21 C3): the lane was the last one recording the literal

A constructor symbol carries its CLASS name. `java`, `kotlin` and `groovy` all landed there in
their folds; this lane published the literal `"constructor"` at both emission sites
(`handleClass`:3117, `handleEnum`:3406) and **four fixtures pinned it**, so the defect was
ratified rather than reported:

| fixture | what it pinned |
| --- | --- |
| `aux-ctor-is-not-a-symbol` | `{name: "constructor", kind: "constructor", ownerName: "Service"}`, plus `contains Service -> constructor` |
| `enum-params` | `{name: "constructor", ownerName: "Planet"}` |
| `m60-contains-owner-model` | three ctor symbols, three `contains` rows — and three FORBID rows asserting the literal (a trait publishes no ctor, a parenless class publishes no ctor) |
| `m60-val-pattern-is-a-name` | `contains Node -> constructor` as the positive control |

**Measured, 1,500-file lexicographic slice of the 18,965-file corpus, both analyzers on the same
engine in the same run** (`script/m14/lanes/jvm-rulings-ab.mts`):

| | PRE (HEAD blob) | POST (folded) |
| --- | --- | --- |
| constructor symbols | 2,442 | 2,442 |
| distinct constructor NAMES | **1** | 2,180 |
| named literally `constructor` | **2,442** | **0** |
| symbols / relationships / zero-symbol files | 59,285 / 333,194 / 3 | 59,285 / 333,194 / 3 |

The rename moved no count at all: identity multiset entries 4,360 and relationship rows 4,878,
every one of them a spelling change (`contains X -> constructor` → `contains X -> X`), with all ten
relationship types identical to the digit and the owner-less control unchanged at 350. The
top-class names after the fold read like the corpus they come from — `WithFilter:12`,
`SerializationProxy:10`, `Delegate:8`, `Unrecognized:7`, `Id:7`.

Three implementation notes, all load-bearing:

1. **The lookup that folded the auxiliary constructor keyed on the literal.** `handleFunction`'s
   auxiliary-constructor branch found the class's ctor with
   `s.name === "constructor"`; after the rename that search returns nothing and every auxiliary
   constructor's parameter payload is silently dropped. It now matches KIND + OWNER (the class
   publishes exactly one ctor, so that is exact). Verified on `aux-ctor-is-not-a-symbol`:
   `Service`'s ctor carries `["name:String", "retries:Int"]`, one primary and one auxiliary.
2. **Push order is part of the contract.** The ctor was pushed BEFORE the class symbol, so
   `expectTypeParameters: {symbol: "Store"}` and `expectSymbols: [{name: "<ClassName>"}]` — both
   bare-name lookups in the harness — were answered by the CONSTRUCTOR once it shared the class's
   name. kotlin/java/groovy all push the class first for exactly this reason (kotlin's
   `class Box<T>(val item: T)` passes the same bare-name pin its ctor shares a name with). The
   members are now collected and pushed after the class symbol. This was found by
   `scala/generic-parameters-payload` FAILING after the rename — a false pass that the rename
   turned into a visible failure, which is the useful direction for a defect to move.
3. **The `kind` filters were added where the name alone stopped being an identifier.**
   `enum-params` pins `{name: "Planet", kind: "constructor", ownerName: "Planet"}` because the enum
   symbol is named `Planet` too; `aux-ctor-is-not-a-symbol` keeps `kind` + `ownerName`.

## Ruling 2 — declaration-name anchoring (M59/#825): the LINE was right, the NODE was not

The contract (M59 #825, settled here first and pinned in `scala/declaration-lines-825`) is that a
declaration's anchor is where its NAME is written. This lane implemented it as *the first named
child that is not an annotation, modifiers wrapper or comment*, which is exact for `class Foo` and
wrong for a **modifier-prefixed** declaration: tree-sitter-scala models `opaque` and `inline` as
their own named child NODES, so

```scala
opaque type Size = Int          // `Size` anchored on `opaque`: column 1, not 13
final opaque type Guarded = ... // and here on `opaque` again: column 7, not 19
```

**Measured over the same 600-file lexicographic sample, 50,425 declaration name-field nodes: 141
disagreements — 22 `type_definition` and 119 `parameter` — every one of them a modifier node and
every one of them on the SAME LINE as the name.** That last clause is why nothing else moved: the
corpus A/B reports **0 line moves and 27 column-only moves** over 1,500 files, so no
`contains`/`extends` row changed line and only the symbol RANGE did — which is what a tool
navigates to. The A/B examples are the dotty compiler's own source, where the construct is real:
`Flag|type|opaques: [18:5] → [18:17]`, `Size|type|BTypesStack: [95:5] → [95:17]`,
`Version|type|Header: [30:5] → [30:17]`.

The fix reads the grammar's own `childForFieldName("name")` first — the same answer java's fold
reads and kotlin's `findNameNode` is — restricted to `identifier`/`type_identifier`/
`operator_identifier` so an unrecognised shape keeps the positional walk, plus the two modifier
node types added to the fallback's skip list.

**Those are two independent halves, and the equivalence is measured rather than assumed.** The
mutant suite (`S3`, `S4`, `S5` below) shows that removing EITHER half alone changes no output on
any input the corpus or the fixtures contain, and that removing BOTH — the faithful pre-fold
state — is caught by `scala/declaration-name-anchoring`. That is the honest decomposition: the
name read is the family's stated rule and the skip is what the corpus can see, and neither is
redundant as documentation of the contract.

`scala/declaration-name-anchoring` is the pin for the half nothing pinned: `declaration-lines-825`
pinned LINES, and this defect moves columns. It pins `Size` at line 15 column 13 and `Guarded` at
17/19 against measured pre-fix columns of 1 and 7, and it states in its own `note` that it carries
NO forbidden relationship row, because the pre-fold analyzer was run on that file and emitted every
row on the same line — a line-level forbid there would have asserted something no behaviour ever
produced.

## The four re-pins, each with its authority written into the fixture

Every re-pin is a move AWAY from a spelling the analyzer no longer emits, which is what makes it
weaker rather than stronger — and in `m60-contains-owner-model` three of the moved rows were
**forbids**, where leaving the literal would have been the dangerous direction: a trait's
fabricated ctor would have been named `TraitWithParams` and slipped past a row asserting
`constructor`.

- [scala/aux-ctor-is-not-a-symbol](validation/m14/fixtures/scala/aux-ctor-is-not-a-symbol.expectation.json) — symbol `name` and the `contains` target → `Service`; a `rePinnedNote` records that the CONTRACT (one ctor, the auxiliary folded in, no `this`, no `uses Probe -> null`) is untouched and that the old spelling now FAILS, which is the point.
- [scala/enum-params](validation/m14/fixtures/scala/enum-params.expectation.json) — ctor row → `{name: "Planet", kind: "constructor", ownerName: "Planet"}`, `kind` added so the enum symbol beside it cannot satisfy the row.
- [scala/m60-contains-owner-model](validation/m14/fixtures/scala/m60-contains-owner-model.expectation.json) — three ctor symbols, three `contains` rows and three forbid rows → the class names, each forbid noting that the retired literal would have gone inert.
- [scala/m60-val-pattern-is-a-name](validation/m14/fixtures/scala/m60-val-pattern-is-a-name.expectation.json) — the `Node` control row → `contains Node -> Node`.

## What this fold does NOT claim

- **The five declared failures are a different axis and were untouched by this fold.**
  `exports-default-package`, `exports-surface`, `incoming-scala-export-surface`,
  `incoming-scala-import-clauses` and `qmark-declared-is-a-name` were red at the time this section
  was written, and they are the lane's own recorded defects (`exports`/`imports` vocabulary and the
  wildcard-type false-positive rule) — NOT the two rulings. §14/§15 of the branch inventory
  predicted kotlin's and scala's failures were "on the same axis" as java's; measured, they are
  not, and that sentence is corrected there. **RESOLVED 2026-10-11** — see the exports/imports
  section at the end of this document; the lane is 77 / 0.
- **The `parameter` half of the 141 node disagreements is latent, not user-visible.** Parameters are
  not symbols in this lane, so the 119 disagreements only matter if `declarationLineNode` is ever
  called on a parameter to publish something. The 22 `type_definition` disagreements ARE visible
  (a `type` symbol) and are what the new fixture pins.
- **No corpus-wide re-measurement of the other scala tables in this file.** The counts above come
  from a 1,500-file sample of 18,965; the older tables in this document were produced by other
  instruments on other samples and are not comparable to them.

---

# Exports/imports vocabulary + `qmark`, ruled and closed (2026-10-11) — the lane is GREEN

The lane entered at **72 pass / 5 fail** and leaves at **77 / 0**. The five failures were one axis:
the `exports`/`imports` vocabulary (`(file)` vs `(script)`, the clause's path vs its names) and the
`?` wildcard/name decision — plus the symbol count one of the pins had recorded before the M60 ctor
rename.

**The ruling.** A scala COMPILATION UNIT publishes its surface under TWO spellings, written from
ONE predicate so they cannot drift: the **package path** it is visible under (the join partner of
an import site: `import com.example.exports.Widget`) and the **FILE sentinel `(file)`** (the
family's unit spelling, zig/dart's, and what the module-surface fixture pins). A file with no
`package` clause collapses the two, and exactly one row is emitted. An `export` CLAUSE's row is
sourced at the nearest enclosing declaration when it has one, and at the module identity when it
has not — `(script)` is the lane's statement-attribution sentinel and is NOT a module identity
(scala/exports-default-package carries that reasoning in its own forbid). A clause's TARGET is the
name it INTRODUCES (leaf, alias, given head) — never the written path; a wildcard clause publishes
a 0.7 scope row only when its qualifier is ONE NAME (`Inner`), because a dotted qualifier
(`other.module`) is a path that resolves to no symbol. `imports` keeps its shipped vocabulary:
source `(file)`, one target per depended-on module path (selector names expanded), which two green
fixtures already pinned.

**The three defects, each with the measurement that found it.**

1. TWO OLD EMITTERS were publishing the same facts in three vocabularies: a legacy loop emitted
   `(file) -> name` per ExportInfo with no dedupe and no `exportForm` (so `Loose` had TWO rows in
   a no-package file, breaking `exports-default-package`'s `equals: 1`), and
   `collectScalaReExports` emitted the clause's dotted PATH (`other.module.Gamma`,
   `Inner.cancel.isCancelled`). Both are RETIRED, not fixed: the surface emitter owns the `(file)`
   twin, and the clause reader (renamed `scalaExportClauseExportees`, a pure reader now) feeds ONE
   emitter that shares the surface's `(source, name)` dedupe — which is what makes
   `export other.module.Widget` + `class Widget` one row instead of two.
2. `type Alias = Int` fell out of the structural surface check when the legacy emitter was retired
   (`type_definition` was missing from `SURFACE_DECLS`): `ontology-imports-exports` went red on
   exactly that row, which is the fixture doing its job. Fixed by adding the node type, with the
   fixture's own sentence quoted at the site.
3. `?` was refused by a LITERAL ban in `push` while the per-file rule sat in the `type_identifier`
   case below it — so `?[Int]` in a file that declares ``type `?`[A]`` was dropped on the first
   route and never reached the second. The per-file test now lives at the route both spellings
   share; `qmark-wildcard-is-not-a-name` (green before and after) and `qmark-declared-is-a-name`
   (red before, green after) are the two halves.

**The re-pins, each with its authority written into the fixture.**

- [scala/export-clause](validation/m14/fixtures/scala/export-clause.expectation.json) — the two
  top-level rows move `(script)` → `p` (module identity), with a `rePinnedNote`.
- [scala/exports-surface](validation/m14/fixtures/scala/exports-surface.expectation.json) —
  `expectSymbolCount Widget` is split by `kind` (class/module/constructor) because the M60 ctor
  identity renamed the constructor to its class name; the count is now three rows with filters, not
  one bare-name count that the class and its constructor could satisfy together.
- [scala/incoming-scala-export-surface](validation/m14/fixtures/scala/incoming-scala-export-surface.expectation.json)
  and [scala/incoming-scala-import-clauses](validation/m14/fixtures/scala/incoming-scala-import-clauses.expectation.json)
  — re-pinned from the third vocabulary they were authored against (sources at `(script)`, clause
  targets carrying paths, `imports` at `root`) onto the shipped one. `docs/LOST-ANALYZER-CENSUS.md`
  records that no branch's analyzer ever satisfied them. What they pin that the lane did not have is
  kept: the type alias on the surface, the backtick-stripped `strip margin`, the exclusions — and
  the two old FORBIDS that asserted the unshipped design (`scala.collection.immutable.Set`,
  `java.io.FileInputStream`) become expectations, while its bare-package spellings
  (`scala.collection.immutable`, `java.io`) and the dotted wildcard become forbids: the ruling is
  now falsifiable from both sides.

**Verification at this commit.**

```
bun run script/m14/run-fixtures.ts --lang scala   -> all fixtures pass (77 / 0; was 72 / 5)
bun run script/m14/run-fixtures.ts --lang kotlin  -> all fixtures pass (64 / 0)
npx tsc --noEmit                                  -> exit 0
bun run script/m14/lanes/jvm-rulings-mutants.mts  -> all mutants dead/equivalent (see below)
```

**The mutants that prove the pins can fail** (`script/m14/lanes/jvm-rulings-mutants.mts`; each is an
exact-string revert, run against this tree's own baseline in-process):

| mutant | reverts | catch |
| --- | --- | --- |
| `S6` | the `(file)` twin of the module surface | `incoming-scala-export-surface`, `ontology-imports-exports` |
| `S7` | a top-level clause's source → `(script)` | `export-clause`, `exports-default-package`, `exports-surface` |
| `S8` | the dotted-wildcard guard | `exports-surface`, `incoming-scala-export-surface` |
| `S9` | the per-file `?`/`_` rule → the literal ban | `qmark-declared-is-a-name` |
| `S10` | the `imports` source → `root` | `incoming-scala-import-clauses`, `ontology-imports-exports` |
| `S11` | the clause target → the written qualifier path | `export-clause`, `exports-default-package`, `exports-surface`, `incoming-scala-export-surface` |

**What this round does NOT claim.**

- **No corpus re-measurement.** The two-spelling surface adds one row per published name per file
  (payload +1 edge per export). The counts cited here are fixture-level; the corpus tables in this
  document were produced by other instruments and are not re-run by this round.
- **The `imports` expansion policy is unchanged** and stays pinned by the two fixtures that already
  covered it (`ontology-imports-exports`, `import-rename-clause`); this round only re-homed the two
  `incoming-*` fixtures onto it.
