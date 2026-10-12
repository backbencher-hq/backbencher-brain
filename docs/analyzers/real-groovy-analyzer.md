# real-groovy-analyzer.md

## Language

- Analyzer file: `src/ast/real-groovy-analyzer.ts`
- Parser: patched `tree-sitter-groovy` (WASM in `wasm/tree-sitter-groovy.wasm`; grammar source vendored at `grammars/tree-sitter-groovy/`; also mirrored to `~/.bb/wasm`)
- Build toolchain (verified, replaces an earlier unverified claim): **`tree-sitter-cli` 0.25.1 + `tree-sitter-java` 0.23.5**, then `tree-sitter generate && tree-sitter build --wasm`. No emscripten: the CLI's bundled WASI toolchain is sufficient. `grammar.js` does `require("tree-sitter-java/grammar.js")`, so the grammar **cannot be generated at all** without that package installed.
- Shipped wasm sha256: `f1e68cb398e63f3498c63b1675bb65496a33bd194efb65ec461bb3f589cece04`.
  Current corpus baseline: **215 of 7,114 files** fail to parse, 1,205 ERROR/MISSING nodes.
- **Reproducibility check — CORRECTED.** This doc previously repeated the lane's older claim that `tree-sitter build --wasm` is *not* byte-reproducible (two builds of identical source differ). That was measured with the historical emscripten toolchain. With the pinned toolchain above it **is** byte-reproducible: two independent builds and the committed artifact all produce sha256 `f1e68cb398e63f3498c63b1675bb65496a33bd194efb65ec461bb3f589cece04`. So a hash comparison is now a valid first check.
  Behaviour is still the check that matters, because it is the one that survives a toolchain change: `script/m59/groovy-grammar-ab.mts` parses every corpus file with both wasms and compares the ERROR/MISSING count and a hash of the node-type sequence. Current result: **7,114 files, 7,114 identical parse trees, 0 differences, 1,205 ERROR/MISSING on both sides.** Run it before trusting any grammar change:
  ```
  npx tsx script/m59/groovy-grammar-ab.mts /tmp/rebuild.wasm
  ```
- Parse-error triage: `script/m59/groovy-parse-triage.mts` groups the 218 corpus failures by normalised first-error signature, separating templates from real source. Current split: 56 template / 159 real-source files, 437 / 768 ERROR/MISSING nodes, 100 distinct signatures.
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
| name | ✅ | `class_declaration`/`interface_declaration`/`trait_declaration`/`enum_declaration`/`method_declaration`/`constructor_declaration`/`field_declaration` → `name` field; enum members → `enum_body` constant names; constructors carry their CLASS's name (§15.2) |
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

## Relationship ontology — measured verdicts (M60, analyzer/GROOVY)

Every row below is a MEASUREMENT through the production entry
(`src/ast/pool-worker.ts` `parseFile`, which is what `parallel-indexer` stores),
over **all 2,825 tracked `*.groovy`/`*.gradle` files** of the pinned corpus
`$HOME/fixtures/repositories/groovy`, in **15 shards of 200 with none
lost** (`script/m60/groovy-ontology-census.ts --from N --max 200`). The shard flag
exists because the engine's per-file watchdog kills the whole process on a
wall-clock timeout, which on a shared box truncates a single-pass corpus run
silently.

The `project-resolved` column is question 5 with the right denominator: both
endpoints resolved against the WHOLE PROJECT's 24,640 distinct symbol names rather
than the same file's (`script/m60/groovy-project-resolution-census.ts`, which
reports both figures and states in its own header why the per-file number is the
wrong denominator for most of this graph — an `extends` target is usually declared
in another file, and an `imports` target is a dotted module path by construction).

| Relationship type | Emitted? | Corpus edges | Files | project-resolved | Confidence (measured) |
| --- | --- | --- | --- | --- | --- |
| calls | ✅ | 82,994 | 2,515 | 55.7% | 0.70 ×82,878 · 1.00 ×116 |
| uses | ✅ | 19,764 | 1,565 | 49.2% | 0.60 ×18,830 · 0.90 ×668 · 1.00 ×266 |
| contains | ✅ | 27,267 | 2,490 | 100.0% | 1.00 |
| imports | ✅ | 10,596 | 2,373 | 99.2% | 0.90 |
| references | ✅ | 10,858 | 2,377 | 98.8% | 0.90 ×10,617 · 0.95 ×241 |
| exports | ✅ | 4,350 | 2,505 | 82.9% | 1.00 |
| extends | ✅ | 1,123 | 871 | 72.0% | 1.00 |
| implements | ✅ | 379 | 202 | 61.2% | 1.00 |
| overrides | ✅ | 872 | 288 | 100.0% | 0.50 ×805 · 1.00 ×67 |
| instantiates | ✅ | 12,054 | 1,250 | 27.2% | 0.95 |

Run-to-run variance, disclosed because the numbers above are compared against a
before-run: the pool's per-file `analyzer timeout` fallback returns a degraded
result under load, so a second pass over the same 2,825 files at the same commit
moved `contains` by 36 of 27,267 (0.13%), `overrides` by 14 of 872 (1.6%) and
`imports` by 25 of 10,596 (0.24%). The only delta this change can cause is in
`uses` (−115 edges on the same file set, and +1.4 points of project-wide
resolution), because `collectFieldAccessUses` emits nothing but `uses`.

**All ten types are EMITTED.** None is RULED and none is outstanding: the two that
were missing at handover (`imports`, `exports`) are real Groovy constructs, were
implemented, and are measured above.

| Relationship type | How resolved |
| --- | --- |
| calls | `method_invocation` → `name` field; command-chain `juxt_function_call`; `leading_dot_call`; `explicit_constructor_invocation` (`super`/`this`, honest literal target). Source = the enclosing method, or the `(script)` sentinel at script level. **Single pass** — no duplicate edges. |
| extends | `superclass` → type child (class/trait → class); `extends_interfaces` → type children (interface → interface). |
| implements | `super_interfaces` → type children (class/trait → interface/trait). |
| instantiates | `object_creation_expression` (`new Type(...)`), with `type_identifier`, `generic_type` or `scoped_type_identifier` receivers. |
| overrides | `@Override`, or an un-annotated instance method; three resolution tiers recorded in `metadata.reasonCode` — `exact-in-file` (1.0), `companion-index` (0.85), `first-parent-guess` (0.5). |
| uses | `field_access` → leaf identifier; `array_access` reads; `leading_dot_call` member reads; GString interpolation reads. A receiver that is not a plain name yields **no** source and the read is attributed to the enclosing method (see the receiver section below). |
| references | import MENTIONS (target = the dotted module path, at 0.9) plus declared-type references — bare AND qualified names, each attributed to the member that writes it (§15.1); the pre-fold qualified-only rule is retired. |
| imports | one dependency per `import_declaration`, in all five Groovy forms, named in `metadata.relationshipType`: `single_type_import`, `type_on_demand_import`, `static_member_import` — sourced at the PACKAGE with `fileLevel: true`, at 1.0 (§15.3). The pre-fold 0.9 type-sourced MENTION label (`single_type`/`on_demand_type`/`static_member`/`static_on_demand`) is RETIRED; the mention still rides `references`. The `as` alias stays metadata and is never the target. |
| exports | the importable units a file publishes — top-level types AND top-level script methods, which the M49 JVM-closure ruling settled (§15.5) — **sourced at the PACKAGE**, so `exports.source + "." + exports.target` reconstructs exactly the dotted name an `imports` edge targets. `metadata.relationshipType` names the unit (`exported_type` with `metadata.kind`, or `exported_function`) and `metadata.dottedName` is the name an importer writes. Two language-rule gates, each measured: a named package (a default-package type has no importable name; 270 of the 2,825 corpus files declare no package) and `visibility === "public"` (measured: 3,689 top-level types with no modifier written — Groovy's default is public — 39 written `public`, 5 `private`, 1 `protected`). A non-public top-level type publishes NO edge (§15.5 — the pre-fold 0.6 row asserted the name was an export). |
| contains | owner → owned symbol via `ownerName`; top-level declarations never self-contain. |

### The two rules narrower than the family, and what each costs

Both are deliberate. Both are counted here rather than left in a comment, because a
narrowing that is not counted reads as coverage.

1. ~~**`references` declared types are QUALIFIED-ONLY.**~~ **REVERSED by the fold —
   the rule now publishes every written type and attributes it to its member; see
   §15.1.** The history is kept because the reasoning is the interesting part: the
   rule was measured at 158 qualified names written against 24,049 bare names
   refused over all 2,825 files, and it was justified by the lane's hand-audited
   truth (79 rows, no bare target anywhere). The truth file was an audit of
   IMPORT-resolved rows — every one of those 79 is a dotted module path, which is
   what an import writes — so it could not see the declared-type graph at all, and
   the fixtures that pin that graph (type-usage-graph, scoped-type-references,
   multicatch-and-varargs, as-cast, cast-types, pattern-refs, lines-825,
   lambda-expression, attribution-visibility, class-body-dot-continuation-841,
   grammar-rebuild-constructs) were all failing on it, each with a qualified
   CHANNEL pin beside the bare row it could not satisfy. The java analyzer's bare
   names were never the counter-example they were presented as, either: java
   publishes `String`/`Integer` for the same shapes and its own fixtures pin them.

2. **A `uses` read at script level is sourced at the receiver variable.** A read
   with no enclosing class or method takes the receiver's own name as its source,
   and this lane does not publish locals as symbols. That is why `uses` resolves at
   47.8% project-wide while `contains` resolves at 100%, and it produces 166
   `uses X -> X` self-edges corpus-wide (`args -> args`, `__parts -> __parts`) where
   the receiver and the leaf share a name. Named for the record; not changed, because
   the alternative (`(script)`) is a family-wide vocabulary decision (GAD2/M14.1).

### `overrides` is mostly a guess on this corpus, and the number says so

Corpus-wide **805 of 872 `overrides` edges (92.3%) are `first-parent-guess` at
confidence 0.50** — the tier-3 fallback that fires when an `@Override` method's
parent lives in another file and no companion index is supplied. Only 67 edges
(7.7%) reach `exact-in-file` at 1.0. That is the honest shape of the construct on a
large codebase (Groovy scripts and Gradle build logic inherit from types this corpus
does not contain), and the tier exists so these never contaminate thresholded
analysis — `patterns.ts` filters at ≥ 0.7. Reported rather than presented as
verified override resolution.

### A name recovered from source text instead of from the node (M60)

`collectFieldAccessUses` took both endpoints of a `uses` edge out of
`node.text.split(".")`: the receiver from the first segment and the member from the
last. That is correct only while both are bare identifiers, and three ordinary
Groovy shapes are not — for the receiver:

| written | receiver node | pre-fix SOURCE |
| --- | --- | --- |
| `new File(dir).canonicalFile` | `object_creation_expression` | `new File(dir)` |
| `verdicts[0].rev` | `array_access` | `verdicts[0]` |
| `(m).label` | `parenthesized_expression` | `(m)` |

— and one for the member. A member can be written as a **string literal**, which is
the Gradle DSL's spelling of a dotted property key:

| written | `field` node | pre-fix TARGET |
| --- | --- | --- |
| `buildModel.properties.'maven.compiler.release'` | `character_literal` | `release'` |

Measured over all 2,825 files by `script/m60/groovy-r7-census.ts`, whose endpoint
classes are counted in five buckets rather than two (see its header for why a single
"does it look like a name?" test is wrong in three directions at once). Before the
fix, the `punctuated` bucket — an endpoint carrying a character that appears in no
name this lane or the language writes — held **32 rows in the first 60 files** of
`uses` alone; the count is deliberately held apart from the `(script)` sentinel count
so the two populations are never added into one reassuring total.

The receiver is now read from the node's `object` field and the member from its
`field` field. A receiver that is not a name yields **no** source, the read being
attributed to the enclosing method — the rule the walk already applied to a receiver
it could not resolve. This is the defect the `calls` walk was already fixed for
(`buildGroovyQualifiedCall`'s comment records `db.list(user).collect` being stored
whole); the read walk kept the raw split, so the two walks disagreed about what a
receiver is in the same file.

Pinned by `groovy/receiver-not-a-name` (8 expectations, 5 forbids) and guarded by
three mutants, all caught: `groovy/receiver-text-fragment` restores the split and its
failure output names `new File(dir)`, `verdicts[0]` and `(m)`;
`groovy/leaf-text-slice` restores the text-sliced member;
`groovy/receiver-as-source` is the plausible wrong fix — source the read at the
receiver — which leaves every expected row in place and is invisible to an
expect-only matcher.

### A quoted CALLEE is left alone, on purpose, and here is the count

The same defect has a third member, and it is **measured, implemented, and reverted**
because two committed pins state the opposite on purpose. A callee can be a string
literal and the Gradle and Spock DSLs write one constantly:
`'Foo.groovy'('println "Hello"')` (src/spec/test/builder/FileTreeBuilderTest.groovy),
`"$name"(value)` (src/main/groovy/groovy/cli/internal/CliBuilderInternal.groovy),
`'/500'(to: …)` and `'*'(to: …)` (Grails UrlMappings). The pinned grammar puts the
literal straight in the `name` field, so the published `calls` target carries its
quotes.

`groovy/quoted-callee-paren-call-841` expects `calls MappingCfg -> "'/500'"`,
`-> "'in'"`, `-> "'*'"`, `-> "'user-type'"` and `-> '"double"'`, and its own rationale
gives the reason: *"a quoted callee that is not an identifier at all — the reason
this is a grammar rule and not a name normalization"*. `groovy/grammar-round3-841`
expects `calls dispatch -> "\"$entry.key\""`. `*` is not a name any normalisation
could produce, so the pin's argument stands on its own terms, and re-authoring
either expectation to match new output is what `docs/M14-HONESTY-CONTRACT.md` §5.2
forbids. So the endpoint keeps the written form,
`metadata.groovyCallExpression` carries it as well, and the count is reported
instead: **1,045 `calls` targets in the `punctuated` class over all 2,825 files**.
Recorded at the emission site and here as an open question for the owner.

### Honesty contract §4.1 is unmet on this lane, and on every JVM lane

§4.1 requires every relationship emitted at `confidence < 1.0` to carry a
machine-readable reason code, not just a number. Measured over all 2,825 files, this
lane's sub-1.0 population is:

| type | sub-1.0 edges | of those, carrying a `reasonCode` |
| --- | --- | --- |
| calls | 82,878 | **0** |
| uses | 19,498 | **0** |
| imports | 10,596 | **0** |
| references | 10,858 | **0** |
| instantiates | 12,054 | **0** |
| overrides | 805 | **805** (`first-parent-guess`) |

So `overrides` complies and the other five do not — **142,884 sub-1.0 edges with no
reason code**, which is why "how much of this graph is guesswork" is not a queryable
number for groovy today. This is NOT lane-specific and NOT fixed here: `grep` shows
`reasonCode` appears 4 times in `src/ast/real-groovy-analyzer.ts` and 5 times in each
of `real-java-analyzer.ts`, `real-kotlin-analyzer.ts`, `real-scala-analyzer.ts` and
`real-python-analyzer.ts`, and in every one of those files it is used **only** on the
`overrides` path. Emitting codes on `calls`/`uses`/`imports`/`references`/
`instantiates` would make groovy an outlier with five extra metadata keys per edge and
no family agreement behind it, which is a repository decision, not a lane fix. Reported
with the count so the decision has a number in it.

### R7 census — what is clean and what is deliberate

The before/after on the identical file set, from `script/m60/groovy-r7-census.ts`
run against the same 600 files both times:

| endpoint class `punctuated` | before | after |
| --- | --- | --- |
| `uses` (any endpoint) | **66** | **0** |
| `calls` (target) | 22 | 22 |

`calls` is unchanged because the quoted-callee change was reverted — see the section
above. The 30 `punctuated` `uses` endpoints that remain over all 2,825 files are
**GPath operator names**, written literally in Groovy source as `*`, `**`, `@attr`,
`@id`, `@url` (src/spec/test/UserGuideXmlSlurperTest.groovy,
src/test/groovy/groovy/xml/GpathSyntaxTestSupport.groovy, gradle/idea.gradle). They
are names in the DSL Groovy embeds, not defects, and they are counted in their own
bucket rather than hidden.

What the same census reports over all 2,825 files:

- **Empty-named symbols: 0.** The analyzer refuses and counts them instead
  (`metadata.emptyNameRefusals` = 11 corpus-wide, every one the `@Unparsed`
  annotation shape the pinned grammar reads as `name: (MISSING identifier)`).
- **`unknown` as a target: exactly 1**, and it is a true positive —
  `src/spec/test/SyntaxTest.groovy:806`, `assert colors.unknown == null`. A Groovy
  property genuinely named `unknown`. The census's `target === "unknown"` heuristic
  is wrong in this one case and the source line settles it.
- **Punctuated endpoints that are the written form, kept deliberately:** 206 `calls`
  targets (the quoted/GString callees of the Gradle, Spock, Grails and markup DSLs —
  `'Foo.groovy'(…)`, `"$name"(…)`, `'/500'(to: …)`, `'(Box)'`, `'static'`), 9 `contains`
  and 12 `instantiates` endpoints that are Spock feature-method names containing `#`
  or a backslash in their string (`should handle \\r\\n line feeds correctly`), and the
  30 GPath operators above. A handful of the 206 are grammar misparses rather than DSL
  callees — `calls testArgWith -> "[0]"`, `calls testZeroArgMethodCallInTheMiddleOfTheChain -> "check()"`,
  `calls start -> "doStart()"` — and are left for the same reason the quoted callee is:
  the shape is pinned by `groovy/grammar-round3-841` and `groovy/quoted-callee-paren-call-841`.
- **Documented sentinel endpoints.** `calls` 8,353 `(script)` sources, plus 92
  `super` and 25 `this` TARGETS which are the deliberate honest literal of
  `explicit_constructor_invocation` (pinned by `groovy/ctor-delegation`, which also
  forbids resolving them to a parent type). `instantiates` 1,016 `(script)` sources,
  `references` 117, `imports` 73, `uses` 18.
- **Residual, reported rather than hidden:** 33 `calls` + 11 `uses` + 3 `contains`
  edges whose TARGET is the literal `root`; 1 `calls` + 4 `uses` + 1 `contains`
  whose target is `self`; 28 `uses` rows whose SOURCE is `this`. These are the
  GAD2 pre-unification sentinels surviving on real sites and are R7 findings the
  owner should see.

## M14 fold: the six laws this lane was failing (2026-10-10)

The lane entered this pass at **61 of 81 fixtures green**, with 20 failures and 60
distinct problems. It leaves at **81 of 81**, with the six laws below changed. Two of
them were laws written into the analyzer's own comments as deliberate rulings; four
were silence (a producer that emitted nothing for a whole channel). Each is stated with
the measurement or the arbitration that decided it, because the two rulings were made
against an artifact that is still in the tree and a reader will meet it.

### 15.1 The declared-type graph publishes every written type, attributed to its member

Two filters, both retired.

* **The qualified-only filter.** `emit` dropped every name without a dot. Measured
  consequence: `List<String> f`, `public String greet()`, `catch (IOException |
  SQLException e)`, `o as String`, `(String) o`, `o instanceof Point p`, `Path
  scriptDir` and a typed lambda parameter — every bare type in every declaration
  position — reached no graph at all. The eleven fixtures that pin this graph now do.
* **Class-only attribution.** `resolveSource` sourced every declared-type reference at
  the enclosing type, on the recorded argument that the lane's hand audit had 79 rows
  and not one of them was method-scoped. That audit was of IMPORT-resolved rows (all 79
  are dotted module paths), so it could not see member attribution either way; the
  fixtures state the opposite and do it row by row — `type-usage-graph` pins
  `from: m2` for `Map` as a `return_type` (its own note calls the class-sourced form
  the KAD6 defect), `scoped-type-references` pins four `source: make` rows, `pattern-refs`
  `from: describe` / `from: pick`, `method-refs` and `lambda-expression` `from: run`.
  The law now in force: a type written in a FIELD's clause belongs to the declaring
  type, a type written inside a member belongs to that member, and a file with no
  enclosing TYPE (an interpolated class name that the grammar cannot read) keeps the
  `(script)` sentinel — `scoped-type-recovery-refusal` pins exactly that, and its
  parse was probe-verified to contain no class declaration at all.

Measured at HEAD through the fixture lane: the `references` graph gained the bare half
in every one of the eleven positions, and `groovy/declared-type-class-attribution` (a
new mutant that re-sources member refs at the primary type) is CAUGHT by nine fixtures.

### 15.2 Constructors are named after their class

The lane published the literal `"constructor"` and documented it as the family
convention. That claim was stale in both halves:

* **The family moved.** kotlin's fixtures pin `{ "name": "Derived", "kind":
  "constructor", "equals": 3 }` with the note "one primary + two secondary constructors
  share the class name **by the java C3 family convention**", and java's own fixtures
  (ctor-delegation, ctor-value-injection, record-varargs-compact-ctor) name constructors
  `CtorDelegation`, `PriceConfig`, `Point`. This lane's fixtures agree: ctor-identity,
  ctor-field-split-lines, duplicate-parse-field and parameters-payload (`symbol Holder
  in Holder` — a constructor addressed BY its class name and owned by it), while
  `empty-name-refusal` FORBIDS the literal (`{type: uses, source: "constructor"}`).
* **The hand audit still says otherwise, and it is not a re-running gate.**
  `validation/m12/ground-truth/groovy.json` records `symbol:Features.groovy:9:constructor:constructor`
  and `script/verify-m12-final-audit.ts` reads the ground-truth files only for
  EXISTENCE — it consumes the committed `validation/m12/results/*-differential.json`
  and never re-runs an analyzer. So the literal survives in a record and nowhere in a
  gate; the fixtures are the gate. The collision argument the old comment answered with
  `ownerName` is now answered twice: the `contains` source is the class, `ownerName` is
  the class, and overloads are distinct by their parameter payload — which is exactly
  what kotlin's `equals: 3` pin says.

The same fold changed the two places the calls/uses walk derived the name
independently (a constructor body's read-owner, and a constructor delegation's `calls`
source), which is why `grammar-rebuild-constructs`' `calls[Rebuilt -> super]` and
`empty-name-refusal`'s forbid are both satisfied. `groovy/ctor-name-revert` is CAUGHT by
four fixtures.

### 15.3 The file-level import dependency keeps the package as its source

`imports` carries two facts and the lane emitted two edges for them: a 0.9 MENTION
sourced at the file's primary type, and a 1.0 DEPENDENCY sourced at the package with
`fileLevel: true`. A post-pass then rewrote BOTH to the primary type. That rewrite is
what `bb_graph`'s per-file dependency query cannot survive: its SQL is
`source_symbol_id IS NULL AND target_symbol_id IS NULL AND source_external = <file>`,
and a source that resolves to a symbol makes `source_symbol_id` non-NULL. Two fixtures
made the contradiction explicit — `imports-dependency-edge` pins the package source
with `single_type_import`/`type_on_demand_import`/`static_member_import` and FORBIDS
`imports, source: Dep`, while `imports-dependency` pinned the primary-type source with
the older `single_type`/`on_demand_type`/`static_member`/`static_on_demand` vocabulary.
They cannot both hold (the forbid matches any row from the type), so:

* the file-level edge is EXEMPT from the rewrite and is the surviving `imports` label,
  at 1.0, carrying `hasAlias` (the alias is a fact about the declaration and would
  otherwise have been dropped with the retired label);
* the retired mention label is gone from the analyzer — the mention still rides the
  `references` edge at 0.9 with `isGroovyImport: true`, which is the edge the reference
  surface joins against — and `groovy/imports-dependency` was re-pinned to the surviving
  label with its six rows moved and its reason written into its own rationale;
* one collapse is stated rather than hidden: `import static java.util.Collections.*` is
  a STATIC ON-DEMAND import and the converged vocabulary has no separate spelling, so
  it publishes as `static_member_import` with `isStatic: true` AND `isWildcard: true`
  (java's twin does the same).

### 15.4 Line attribution: the declaration's own line, not its annotation's

`declarationLineNode` anchored every symbol at its FIRST ANNOTATION, with a comment
citing the M12 hand audit (`Negative.groovy` L18 is `@Slf4j`, L19 is `class Counter`;
the truth records 18). The fixtures pin the opposite, in the words of the #825 law
itself: "the line a relationship carries is the line its NAME is written on — not the
line of the enclosing construct, and not the line of a modifier", because "a tool
navigating to a java symbol landed on the annotation". `lines-825` pins
`expectSymbolRanges` (`Wrapped` at 19, not its `@Deprecated` at 18; `label` at 23, not
22) and `contains`/`overrides` at 26 rather than 25; `anonymous-body-overrides` pins its
two override rows at the method line rather than the `@Override` above them. Both are
satisfied now, and java is failing its twin (`java/declaration-lines-825`) the same way
— this is the family's leading edge, not a groovy-only reading. The M12 rows that cite
the annotation line are stale in exactly the way §15.2 describes.

### 15.5 Exports: the converged family contract, and one pin moved

The lane published `exports` with a lane-local vocabulary (`groovy_exportable_unit` +
`exportForm`) and published non-public top-level types at 0.6. Two fixtures disagreed
about the SET as well, and here the arbiter is a written ruling rather than a fixture:

> **RESOLVED (M49 exports convergence, 2026-09-10):** the fork is closed the OTHER way
> — java/groovy were converted to the kotlin/scala contract. Owner ruling
> (user-approved): **exports = importable units only (top-level types + top-level
> functions)**; membership is carried by Contains, which all four analyzers already
> emit. … The auditor's reason 1 was probe-corrected first: kotlin/scala also export
> top-level functions, so the contract is "importable units", not "types only".
> — `reviews/jvm-closure-audit.md`

`groovy/exports-publication` (authored an hour after `exports-publication-edge`, in the
same import commit, beside `java/exported-types`) pins that contract and names it; the
older fixture pins "THE SET IS TYPES ONLY", which the ruling withdrew. Both cannot hold,
so the losing pins were moved with their reason recorded in the fixture itself:
`exports-publication-edge`'s three type rows now carry `exported_type` + `meta.kind` +
`dottedName`, its line-18 top-level `def` is pinned as `exported_function` instead of
forbidden, and what it uniquely pins is unchanged and still asserted (the package is the
exporter; a nested type and a member are not exports; nothing may be sourced at
`(script)` in a packaged file). In the analyzer, the vocabulary became
`exported_type`/`exported_function` + `kind` + `dottedName` at 1.0, `exports[]` regained
the top-level-function half the pre-ruling reading had taken with it, and a non-public
top-level type now publishes NO edge at all rather than a 0.6 one — an edge at any
confidence still asserts the name IS an export, and the export surface is what
import-resolution joins on.

### 15.6 What the fold did NOT do, and what is owed

* **The corpus tables above are PRE-FOLD numbers.** They were measured on 2026-09-29
  over all 2,825 files in 15 shards. This fold changes the `imports` row count (two
  label edges per declaration become one, at a different confidence), the `references`
  target distribution (the bare half is published), the `exports` vocabulary and the
  constructor `name`. A re-measurement with `script/m60/groovy-ontology-census.ts` is
  owed before any row above is quoted as current; the row-level deltas are recorded in
  this section rather than folded into a table nobody re-ran.
* **The `imports[]` `ImportInfo` channel is untouched**, so `brain_import` is unchanged.
* **The lane's second corpus is still missing** (`geb` has no checkout), so the
  two-corpus gate is still not running.
* **The M12 ground truth still records the pre-fold names and lines.** It is a
  historical record read only for existence; §15.2 and §15.4 say so rather than
  quietly rewriting an audit.

### 15.7 Verification at this commit

```
bun run script/m14/run-fixtures.ts --lang groovy   -> all fixtures pass   (81 pass / 0 fail; was 61 / 20)
bun run script/m14/run-fixtures.ts                 -> groovy 81/0, elixir 82/0, cpp 51/0 (no new lane regressions;
                                                      the vue 5->7 / svelte 9->10 / html 1->4 drift is pre-existing
                                                      and lives in lanes this diff does not touch)
BB_MUTANT_ONLY="groovy/" bun run script/m14/mutate-analyzer.ts -> all 59 mutants caught (56 pre-existing + 3 added:
                                                      groovy/declared-type-qualified-only,
                                                      groovy/declared-type-class-attribution,
                                                      groovy/filelevel-import-rewrite)
bun run script/m60/groovy-mutant-run.ts            -> 14 lane mutants, 0 surviving
npx tsc --noEmit                                   -> exit 0
bun run audit:fixture-provenance                   -> no fixture introduced or edited by this change fails
bun run audit:doc-truth-emissions                  -> no groovy finding (gate summary FALSE_NEGATIVE=5 /
                                                      UNDOCUMENTED=9 / MISSING_DOC=1 / NO_CLAIM_TABLE=18,
                                                      unchanged: all in other lanes; 0 findings named `groovy`)
```

Neighbours this fold leaves open, in the order they are cheapest to take: java's
`ctor-delegation`, `ctor-value-injection`, `declaration-lines-825`, `exported-types` and
`import-dependency-edges` fail for the same four reasons (constructor identity,
annotation-line anchoring, the exports vocabulary, the file-level import source), with
the fixtures already written and the java analyzer carrying the same stale rulings; then
kotlin (6 failures) and scala (5), whose constructor rules are already the ones this
fold converged on.

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
