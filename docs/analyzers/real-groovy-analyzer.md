# real-groovy-analyzer.md

## Language

- Analyzer file: `src/ast/real-groovy-analyzer.ts`
- Parser: patched `tree-sitter-groovy` (WASM in `wasm/tree-sitter-groovy.wasm`; grammar source vendored at `grammars/tree-sitter-groovy/`; also mirrored to `~/.bb/wasm`)
- Build toolchain (verified, replaces an earlier unverified claim): **`tree-sitter-cli` 0.25.1 + `tree-sitter-java` 0.23.5**, then `tree-sitter generate && tree-sitter build --wasm`. No emscripten: the CLI's bundled WASI toolchain is sufficient. `grammar.js` does `require("tree-sitter-java/grammar.js")`, so the grammar **cannot be generated at all** without that package installed.
- **Reproducibility check.** `tree-sitter build --wasm` is *not* byte-reproducible — two builds of identical source differ, and the same offset separates a rebuild from the shipped artifact — so the artifact is verified by **behaviour**, not by hash. `script/m59/groovy-grammar-ab.mts` parses every corpus file with both wasms and compares the ERROR/MISSING count and a hash of the node-type sequence. Current result: **7,114 files, 7,114 identical parse trees, 0 differences, 1,232 ERROR/MISSING on both sides.** Run it before trusting any grammar change:
  ```
  npx tsx script/m59/groovy-grammar-ab.mts /tmp/rebuild.wasm
  ```
- Parse-error triage: `script/m59/groovy-parse-triage.mts` groups the 218 corpus failures by normalised first-error signature, separating templates from real source. Current split: 56 template / 162 real-source files, 437 / 795 ERROR/MISSING nodes, 100 distinct signatures.
- Language detection: extension `.groovy` / `.gradle` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealGroovyAnalyzer`

### Grammar patch (M12.06)

Both upstream Groovy grammars are incomplete — on *different* constructs:

| Construct | amaanq v0.1.2 (previously wired) | murtaza64 v0.0.1 (alternative) |
| --- | --- | --- |
| Untyped params `def dyn(arg)` | ❌ | ✅ |
| Safe-nav `?.`, spread `*.`, elvis `?:` | ❌ | ✅ |
| Trait | ❌ | ✅ |
| Constructor `Foo(String a)` | ✅ | ❌ (catastrophic) |
| Enum, generics, static-init, Spock names | ❌ | ❌ |
| Newline-terminated fields/members | ❌ (silent missing-`;`) | ❌ |

amaanq fails the most common Groovy idioms; murtaza fails the constructor
itself. Neither reaches the M12 bar of zero parse errors + zero missing
tokens on a real corpus. The wired grammar was therefore patched in-repo
(grammar source vendored for reproducibility): untyped/optional-type
`formal_parameter`, `trait_declaration`, safe-nav `?.`, spread `*.`,
elvis `?:`, `as` casts, Spock string method names, `[:]` empty maps,
newline-terminated `field_declaration`/`constant_declaration` (Groovy's
DELIMITER instead of Java's required `;`), newline-separated enum members,
single-expression closure bodies, command chains, and the ~15 genuine
Groovy ambiguities resolved via tree-sitter `conflicts` (parenthesized
expression / untyped param list / lambda params / reserved identifiers).
The patch is surgical: the grammar is a fork of tree-sitter-java
(v0.23.4 pinned), so the Groovy surface is layered onto a proven Java base.

Result as written in M12.06: "33/33 construct matrix clean" and "0/400 grails-core
sample files with grammar errors or missing tokens". **The 0/400 figure was
false and is corrected below (2026-09-14, M49 W17).** The patch is real and it
did move the needle — the pinned grammar parses untyped params, safe-nav `?.`,
spread `*.`, elvis `?:`, traits, `[:]` maps, GString nested quoting, Spock string
method names and single-arg command chains, all of which the stock amaanq build
rejects — but it does not deliver the four cells below, and it never delivered a
clean corpus.

> **Correction (M49 W17, issue #742).** Measured over all **6,564** tracked
> `*.groovy` files through the production `parseFile` pipeline:
> **3,874 error files (59.0%)** — 3,172 with a true `ERROR` node (48.3%) and
> 2,014 with a `MISSING` token (30.7%). The **same 400 files this section names
> measure 250/400 (62.5%)**. A 15-cell construct probe against the committed
> wasm (`wasm/tree-sitter-groovy.wasm`, `93fb188ab031`) passes 11 and **fails
> four the patch claims to fix**, each named in the patch list above: `as` casts,
> newline-terminated field declarations, an unbraced body followed by another
> statement, and enum constructor arguments. `MISSING ;` is the single largest
> derived failure class (2,698 nodes corpus-wide) — i.e. the newline-terminator
> work is the largest remaining gap, not a solved one.
>
> Why it survived from M12 to now: the claim had **no executable evidence**.
> `script/m12/` carries a `*-corpus-errors.ts` for 35 languages and none for
> java, kotlin, scala or groovy, and `script/verify-m12-final-audit.ts` passes
> regardless. The measurement now exists —
> `script/m12/jvm-corpus-errors.ts` writes
> `validation/m12/results/groovy-corpus-errors.json` — and its failure classes
> are derived from the parse tree rather than hard-coded, so the number in this
> document cannot drift from the measurement again.
>
> **Rebuild (M49 W18, issue #742 — closes the last environment claim).** W17
> registered the grammar fix as *blocked on a wasm rebuild needing emscripten*.
> That was wrong: the grammar source is vendored in-repo
> (`grammars/tree-sitter-groovy/`) and the local `tree-sitter` CLI builds wasm
> with its bundled WASI toolchain (`tree-sitter generate && tree-sitter build
> --wasm`). Rebuilt, the pinned grammar now passes the **full 15/15 construct
> matrix** (all four cells above now pass), `MISSING ;` corpus-wide is **340
> nodes** (from 2,698), and the measured corpus failure falls from **58.5% to
> 24.5%** (tree walk) / **59.0% to 25.0%** (production pipeline); the recorded
> 400-file sample falls from **250/400 (62.5%) to 115/400 (28.7%)**. Constructs
> added by the rebuild: `as` coercion, `=~`/`==~`, closure parameter lists
> (including typed), untyped modifier fields, newline-terminated `throw` /
> `super(…)` / annotation members, spread call arguments, and the **empty
> single-quoted string** `''` (Java's inherited `character_literal` is
> `repeat1`). Pins: fixture `groovy/grammar-rebuild-constructs`, groovy fixtures
> 46/46, and all 550 mutants caught (`groovy/as-cast-drop` had been silently
> surviving on a dead mis-parse marker and was re-keyed). Residual class —
> slashy strings `/…/`, spread-map `f(*:map)`, GString nested quoting — is
> registered separately; see `reviews/m49-w18-groovy-grammar-rebuild.md`.
>
> The corpus is therefore **not clean** at 21.9% error files; what changed is
> that the largest classes named here are fixed and measured, and the remaining
> work is ordinary grammar work rather than an environment claim.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration`/`interface_declaration`/`trait_declaration`/`enum_declaration`/`method_declaration`/`constructor_declaration`/`field_declaration` → `name` field; enum members → `enum_body` constant names; constructors normalized to `constructor` |
| kind | ✅ | class → Class, trait/interface → Interface, enum → Enum, enum member → EnumMember, method → Method, constructor → Constructor, `static final` field → Constant, plain field → Property |
| qualified/container name | ✅ | `id` = parent chain + name; `parent` = enclosing symbol name |
| ownerName / ownerKind | ✅ | enclosing type symbol (class/trait/interface/enum); top-level declarations have no owner |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as Java/Kotlin) |
| parameters | ✅ | `formal_parameters` → `formal_parameter` (name + optional type); constructor params likewise |
| returnType / type | ✅ | `type` field on method/field/param; `void`/inferred handled |
| documentation/comments | ❌ (not extracted) | non-goal for M12.06 (matching the Java-family fixture contract) |
| complexity metrics | ✅ | cyclomatic on `if`/`while`/`for`/`switch`/`try`/`catch`; `complexity` = symbols × 1.5 |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `annotation` nodes → pattern flags (`@Override`, `@Test`, `@Transactional`, etc.) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `method_invocation` → `name` field; command-chain `juxt` invocations; source = enclosing method; **single pass** (no duplicate edges — the old analyzer emitted every call twice) | 0.9 |
| extends | ✅ | `extends_clause`/`superclass` → type child (class → class) | 1.0 |
| implements | ✅ | `implements_clause`/`type_list` → type children (class → interface/trait) | 1.0 |
| instantiates | ✅ | `object_creation_expression` (`new Type(...)`) → Instantiates | 0.9 |
| overrides | ✅ | `@Override` annotation + enclosing class supertypes → owner-qualified source, declaring-parent target via companion index (`override-context.ts`, shared with Java/Kotlin); without context → first hierarchy parent (deterministic per-file default) | 0.9 |
| uses | ✅ | `field_access` → leaf identifier (`this.field`, `obj.field` → the field); resolved against declared symbols | 0.7 |
| references | ✅ | imports → source `root`, target = dotted module path | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` only (top-level declarations never self-contain) | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| field_access | ✅ | `field_access` → leaf identifier (property reads/writes materialized as `uses`) | 0.7 |

## Supported constructs

- Classes with typed/untyped fields (`String name` or `def name`) — class + Property/Constant — `BaseService.groovy`
- Traits (`trait Audited`) + interface implementation (`implements Audited`) — `BaseService.groovy`
- Abstract + concrete methods in base types — `BaseService.groovy`, `Repository.groovy`
- Cross-file inheritance + override resolution: `class UserService extends BaseService<User> implements Repository<User>` → clean extends/implements; `@Override User save` → `BaseService.save` via companion index — `UserService.groovy`
- Enums with members + constructor (`enum Color(String hex) { RED("#f00") }`) — enum + EnumMember + constructor — `Features.groovy`
- Spock specs (`class MathSpec extends Specification { def "addition works"() { ... } }`) — string method names — `Features.groovy`
- Safe-nav `?.`, spread `*.`, elvis `?:`, `as` casts, `[:]` maps, closures with params — `Features.groovy`
- `@Override` on interface implementations, `static` methods, top-level methods, class fields, constructors — `UserService.groovy`
- Negative fixture (`Negative.groovy`): `println`/`print`/`printf` are language builtins — never symbols or call targets; `assert`/`sleep`/`synchronized` and JVM `Object` methods (`toString`/`hashCode`/`equals`/`wait`/`clone`) are filtered; closure params (`it`, `x`) are not symbols; local variables inside method bodies are suppressed (Kotlin contract); field access to undeclared names is not a `uses` edge; `def` untyped locals are not symbols; `new Foo()` IS Instantiates (positive control).

## Unsupported / explicit-unknown constructs

- **Compiler-generated members**: Groovy auto-properties (`getName`/`setName` for `String name`) are NOT materialized as synthetic symbols — pure AST contract (the old analyzer emitted synthetic getters/setters plus a phantom closure `it`; all removed).
- **Cross-file override targets**: resolved with the optional `AnalyzeContext.overrideCompanion` (shared `override-context.ts`); without context the analyzer deterministically emits the first hierarchy parent — the honest per-file default (production wiring tracked by M12.44, same as Java/Kotlin).
- **Multi-arg space-separated command chains** (`foo a b` beyond single-arg): the grammar's command-chain support covers single-arg and parenthesized forms; multi-arg space-separated chains are a documented grammar limitation (comma-juxt is unambiguous).
- **Assignment-RHS command chains** (`def x = foo "bar"`): rare; the juxt call is not reachable from every expression context — documented grammar limitation, not in the fixture corpus.
- **Destructuring multi-assignment** (`def (a, b) = pair`): dropped to keep the grammar's ambiguity surface minimal — documented grammar limitation.
- **field_access edges** beyond declared fields: only materialized when the target resolves to a declared symbol.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

**0 usages** — the Groovy analyzer is fully regex-free. The census gate
confirms zero regex literal or `RegExp` nodes in the source. The rewritten
analyzer uses pure char-code checks (PascalCase via `first >= 65 && first
<= 90`) and string operations (`startsWith`/`endsWith`) throughout.

Rule: **zero unclassified regex** — trivially satisfied (no regex remains).

## Complexity envelope

From `validation/m12/results/groovy-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 51 | 79 | 346.2 | 147 | 228 | 190.9 MB |
| corpus_subset | 400 | 2,953 | 14,053 | 3,635.8 | 812 | 3,865 | 271.5 MB |

Declared budget: fixtures < 2 s; 400-file corpus < 60 s.

Hot-path audit: single-pass iterative traversal (explicit stack, no
recursion depth risk); `symbolMap` (Map) gives O(1) owner/name lookups;
override resolution uses the shared `findDeclaringParent` BFS over the
(tiny) hierarchy. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/groovy.json`
  (authority: `manual_audit`)
- Result: `validation/m12/results/groovy-differential.json`
- Precision / recall / FP / FN / unknown rates:
  **1.000 / 1.000 / 0 / 0 / 0** — 130/130 facts across 5 fixtures (4
  positive + 1 negative), zero parse errors.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `grails_core@a83f8748`
  (registered in `validation/m11/corpus-manifest.json`; clean repo, 6,564
  committed `.groovy` files — the previous target `intellij_community` is
  dirty and not evidence-eligible)
- 400 tracked `*.groovy` files (deterministic first-400 sorted, pinned
  revision, clean repo)
- Files / symbols / relationships / errors: **400 / 2,953 / 14,053 / 0
  grammar errors** as recorded in M12 — **superseded**, see the correction
  above. Re-measured on the identical 400 paths with the committed wasm:
  **250/400 files with parse errors** (51.0% `ERROR`, 36.8% `MISSING`).
- Full corpus, all 6,564 tracked `*.groovy` files: **3,874 error files (59.0%)**,
  0 crashes, 34 files where the tree walk and the production pipeline disagree
  (a zero-width `ERROR` node leaves `rootNode.hasError` false — see issue filed
  from `script/m14/tmp/groovy-pipeline-mismatch.ts`).
- Evidence: `validation/m12/results/groovy-corpus-errors.json`,
  reproducible with `bun script/m12/jvm-corpus-errors.ts groovy [--full]`.
- **Sampling caveat (why the old 400-file figure was never representative):**
  "deterministic first-400 sorted" sorts paths alphabetically, so the sample
  covers only the lexicographically-first top-level modules and **excludes 60+
  modules entirely** — including `grails-test-examples` (2,024 files),
  `grails-data-hibernate7` (520) and `grails-spring-security` (390). The sample
  measured 62.5% while covering 6% of the corpus; the corpus measures 59.0%.
  See `script/m14/tmp/groovy-sample-bias.ts`.

## Differential status

`npx tsx script/m12/verify-analyzer.ts groovy`, against the 130 hand-audited facts in
`validation/m12/ground-truth/groovy.json` (5 fixtures):

| | TP | FP | FN | precision | recall |
|---|---|---|---|---|---|
| before | 111 | 46 | 19 | 0.707 | 0.854 |
| now | **130** | **3** | **0** | **0.977** | **1.000** |

All 130 expected facts are matched. The 3 residual false positives are **not** defects, and
each is recorded at its emission site in the analyzer rather than deleted:

- `Features.groovy:uses:describe:name` and `Negative.groovy:uses:bump:count` — reads of
  `${name}` / `${count}` inside a GString. The G7 contract is that an interpolated name **is**
  a read; measured over 300 grails-core files, 123 of 2,275 `uses` edges (5.4%, across 41
  files) are interpolation reads, and removing them is how 2,115 files once contributed zero
  reads. The fixture's rule 6 ("String interpolation identifiers ($name) are NOT symbols/uses")
  and this truth disagree. Note the disagreement is narrow: `describe -> toUpperCase`,
  `describe -> collect` and `bump -> info` are all matched, so it is about the interpolated
  *identifier*, not about calls made in the same method.
- `Features.groovy:overrides:Robot.walk:Walkable.walk` — `class Robot implements Walkable`
  really does supply `walk()`. All four `overrides` rows truth expects cite `@Override`; the
  implicit tier (an un-annotated method with a *verified* exact in-file signature match) is
  deliberate java JAO1 parity and stops a missing annotation from erasing a real edge.

Resolving either would trade real corpus coverage for 1–2 fixture rows, which is a lane-owner
decision, not a bug fix.

### Corpus pin and declared exclusions

The corpus is pinned by absolute path to a real checkout,
`$HOME/fixtures/xml/repos/grails-core` (7,114 tracked `.groovy` files). The earlier
pin named a directory that did not exist, so the lane audited **0 files** and reported a clean
result over an empty measurement; the audit now fails on a zero-file universe.

`excludeDirs` in `script/m14/differential.ts` declares the non-source population — Grails
scaffolding templates and every `skeleton/` root (all seven profile skeletons plus the
`grails-spring-security` test-app skeletons). The excluded count is reported beside the lane's
numbers so a quietly-emptied universe stays visible. `geb` was named as this lane's second
corpus and has no checkout anywhere on this machine; the pin was removed, so **the groovy lane
is single-corpus and its two-corpus gate is not running.**

## Evidence pointers

- Fixtures: `validation/m12/fixtures/groovy/`
- Ground truth: `validation/m12/ground-truth/groovy.json`
- Differential: `validation/m12/results/groovy-differential.json`
- Complexity: `validation/m12/results/groovy-complexity.json`
- Corpus sample: `validation/m12/results/groovy-corpus-sample.txt`
- Grammar source: `grammars/tree-sitter-groovy/`
- Docs: this file

## Issue

Closes M12.06 (GitHub issue #145).
