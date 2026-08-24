# Analyzer Review — Per-Language Gotchas Appendix

Appended after each `real-{{LANGUAGE}}-analyzer.ts` review. Each entry records
language-specific facts worth remembering next time, so the next review starts
smarter instead of rediscovering the same thing.

---

## Groovy (reviewed 2026-08-23, vendored patched fork in `grammars/tree-sitter-groovy/` = upstream amaanq 0.1.2 + M12.06 patches; pinned `wasm/tree-sitter-groovy.wasm` matches the fork — verified via trait_declaration parsing)

- **GRAMMAR VERDICT (measured, not assumed): the patched fork IS the best
  available option.** Head-to-head on 300 grails-core .groovy files:
  fork = 34.0% clean vs community murtaza64 grammar (the nvim-treesitter
  standard) = 29.0% clean; AND murtaza64 has NO trait support (traits —
  core Groovy — shred into identifiers+closure) and models class bodies
  as closures. Vanilla amaanq is a strict subset of the fork. The ~66%
  dirty rate is a Groovy-grammar-maturity ceiling shared by ALL options;
  switching grammars would be a regression. No rebuild needed.
- Unlike Kotlin, the pinned groovy wasm DOES serialize named fields
  (`method_invocation.childForFieldName('name'/'object')` works) — but
  never assume: probe per language.
- Annotation shape: annotation/marker_annotation name can be identifier
  OR scoped_identifier (FQ). First-identifier extraction drops FQ names
  — same JVM-family defect as Java F2/K2.
- Spock test methods use string_literal names (`def "addition works"()`)
  — name extraction must accept string literals.
- Script files (Jenkins pipelines): no enclosing class/method; calls
  attributed to a "(script)" sentinel by design (M14.1).
- juxt_function_call exists in the wasm with working 'name' field
  (`echo "msg"` = Calls edge) despite confusing grammar diffs around
  `_juxt_function_name`.

## Groovy fix wave (2026-08-23)

Fixes: FQ annotation short names (JVM-family defect #3), class/trait/
enum decorators (previously methods only), evidence-tiered override
confidence (pass1 1.0 / pass2 0.85 / pass3 0.5 — consumer rule from
c04d4ff propagated to the last JVM sibling). Fixtures:
`fq-annotations`, `class-decorators`, `override-fallback-confidence`.
Harness gained `expectDecorators`.

  - **Groovy declares interface supertypes with `extends`**
    (`class X extends Base` where Base is an interface) — analyzer
    emits Extends, correctly. Fixture authoring gotcha: don't expect
    "implements" for interface supertypes.
  - **Pass-3 confidence fixtures need a non-declaring parent**: an
    in-file interface+impl resolves via Pass 1 at 1.0 legitimately.
    To exercise the guess tier, extend a parent that does NOT declare
    the method anywhere in the file.
  - Deliberately untouched (documented scope boundary): no framework
    detection/patterns metadata (the "pure AST contract" header claims
    it is deliberate, but Java/Kotlin emit them — cross-language
    consistency DECISION still owed); isGroovyBuiltin root-segment
    filter is narrower than Java's any-segment by construction;
    field-access Uses noise @0.6 cosmetic.

## Groovy final review (2026-08-23) — self-audit caught its own gap

Re-reviewing the wave adversarially found a hole IN the wave: the class/
method decorator fixes missed FIELDS — `@Column(name = "x") String name`
(the canonical GORM/JPA pattern) still yielded no decorators because the
field_declaration branch never called extractAnnotations. Fixed under
protocol (`field-decorators` fixture, proven failing pre-fix).
Lesson: when a fix adds annotation extraction to SOME declaration kinds,
enumerate ALL declaration kinds and ask why each was excluded.

Verified-by-differential: script/m14/differential.ts on 60 grails-core
files post-fix → tree-truth coverage 100%, unexplained analyzer edges 0%.
Run the differential after every analyzer change; it is the only check
that exercises real-world code rather than fixtures.

Recorded decisions / open questions (not fixed, by design):
  - Field-initializer calls (`def f = helper()` in a class body)
    attribute to the enclosing CLASS scope — defensible (initializers
    run in constructor context), documented here so it reads as a
    decision not an accident.
  - Modifier-less Groovy fields (`String name`) are properties with
    private backing + public accessors, but this analyzer marks them
    public and exports them. OPEN QUESTION: needs a Groovy visibility-
    semantics decision before changing (affects exports downstream).

## Kotlin (reviewed 2026-08-23, upstream fwcd/tree-sitter-kotlin @ 1852ea1, 2026-08-02; pinned `wasm/tree-sitter-kotlin.wasm`, no version metadata)

- **CONFIRMED: the pinned Kotlin WASM exposes ZERO named fields**
  (`Language.fieldCount === undefined`). Every `childForFieldName` call
  returns undefined. Any new analyzer code for Kotlin must use positional
  child access with fallbacks — never trust a field lookup alone.
- Annotation name shape (verified live): bare `@Foo` → annotation has direct
  name child resolvable by first `simple_identifier`/`type_identifier`.
  Fully-qualified `@org.x.Service` → annotation > user_type whose children
  are MULTIPLE type_identifiers (`org`, `x`, `Service`) — "first identifier"
  extraction yields `@org`, the WRONG short name. Last dotted segment is the
  rule (same as Java's scoped_identifier lesson).
- Wildcard imports: `import_header`'s `identifier` child text is
  `"kotlinx.coroutines"` WITHOUT the `.*` — the asterisk is a separate
  sibling `wildcard_import` node. `path.endsWith(".*")` can never match;
  detect via child node.
- Qualified calls (`obj.method()`) parse as call_expression >
  navigation_expression + call_suffix with NO direct simple_identifier
  child. Any `findChildByType(call, ["simple_identifier"])` only works for
  receiver-less calls; the text fallback (`n.text.split("(")[0]`) returns
  garbage for qualified calls (can span the whole lambda body).
- property_declaration is FLAT: [binding_pattern_kind, variable_declaration,
  initializer...]; the name is simple_identifier INSIDE variable_declaration.
  Extension receivers appear as user_type BEFORE variable_declaration.
- class supertype extends-vs-implements: constructor_invocation inside
  delegation_specifier = class (extends); bare user_type = interface
  (implements). BUT explicit delegation (`X by Y()`) wraps a call_expression,
  NOT constructor_invocation — kind detection sees bare user_type → labels
  implements (correct outcome, accidental mechanism; don't "fix" blindly).
- package_header / import_header carry the full dotted path as ONE
  `identifier` node (aliasing via separate import_alias node).
- primary_constructor params are `class_parameter` children (binding_pattern_kind
  + simple_identifier + user_type); secondary_constructor uses
  function_value_parameters like functions.

## Kotlin fix wave (2026-08-23) — what the K1–K5 fixes taught

Fixes for wildcard imports, FQ annotation names, qualified coroutine
dispatch, data-class phantoms, error-range base, override confidence
tiers, and a MEASURED PascalCase restriction. Fixtures under
`validation/m14/fixtures/kotlin/` (`wildcard-imports`,
`fq-annotations`, `coroutine-dispatch`, `data-class-phantoms`,
`override-fallback-confidence`). Harness extended with `expectImports`
and `expectErrors` matchers.

  - **Dead code can hide dead DATA paths**: `getKotlinFrameworkPatterns`
    read `s.metadata.annotations`, which NO extractor ever wrote — the
    whole Spring/Room/Compose pattern layer silently emitted `[]`
    forever. When reviewing consumers, verify the field they read is
    actually populated somewhere.
  - **Never wire a stored-but-never-written field blindly**: fixing means
    (a) populate it with normalized short names AND (b) keep raw text in
    decorators. Two representations, two purposes.
  - **Prefix matching on raw annotation text is the JVM-family plague**:
    Kotlin's route matcher (`text.startsWith("@GetMapping")`) had the
    same FQ blindness Java did. Rule: annotation-name comparison ALWAYS
    goes through a short-name normalizer (strip @, cut at "(", last
    dotted segment).
  - **Fixture authoring discipline bites**: first draft of the coroutine
    fixture passed pre-fix because the bare-launch form satisfied it —
    a fixture that passes before the fix proves nothing about the bug.
    Every fixture MUST fail pre-fix; re-check after any edit to the
    fixture source.
  - **MEASURED — PascalCase qualified calls**: Exposed corpus (791 kt
    files): 158 obj.Method() occurrences, sampled ones all enum/member
    accesses (MySQL.ForShare(, case().When() =) = ~6.5% fabricated
    Instantiates edges vs 2268 legitimate bare constructions. Heuristic
    restricted to receiver-less calls. Do not revert without a fresh
    measurement.
  - **Shared working tree hazard**: typecheck transiently failed in a
    file another agent was editing concurrently. Before diagnosing "my"
    typecheck errors, check `git diff HEAD -- <file>` — the file may not
    be yours.
  - Still open (needs decisions/corpora, NOT in this wave): apiContractPath
    format unification ("GET /path" vs Java's "/path") — cross-language
    contract decision required; annotation-based framework DETECTION
    (current detector is import-only); no second pinned Kotlin corpus for
    future measurements.

## Kotlin follow-up wave (2026-08-23) — contract decision + detection gap closed

  - **apiContractPath CONTRACT DECIDED: bare path only.** Evidence:
    doc-engine.ts:171 queries `s.api_contract_path = ?` (exact match) and
    the column is documented "Exact Route URL" — a method-prefixed string
    broke every cross-language route join. HTTP method moved to
    symbol.metadata.apiMethod. Java/Groovy already stored bare paths;
    this change brings Kotlin into the single format.
  - **Annotation-driven framework detection added**: files using FQ
    annotations WITHOUT imports were invisible to import-only detection;
    detector now also consults metadata.annotations short names
    (Service/RestController/... → Spring, Entity → JPA, Dao → Room,
    Composable → Jetpack Compose, Test/ExtendWith → JUnit).

## Kotlin wasm wave (2026-08-23) — pinned grammar rebuilt from upstream

  - **PINNED WASM REBUILT from upstream (1852ea1, tree-sitter CLI
    0.26.9) and swapped in** — the Kotlin pinned version is now KNOWN,
    resolving the "no version metadata" caveat for this language.
    Rebuild recipe that worked:
    `cd <clone> && tree-sitter generate && tree-sitter build --wasm`
    (CLI auto-downloads wasi-sdk on first build; ~40s).
    Old binary preserved at the wave's commit parent if ever needed.
  - **The prefix_expression shred misparse is FIXED by the rebuild**:
    `@org.c.GetMapping("/o") fun o() ...` followed by another annotated
    declaration now parses as function_declaration,class_declaration.
    The e2e file that previously lost both classes now indexes
    completely (both classes + method + all frameworks).
  - **Upstream grammar change to absorb**: extension receivers moved
    into a dedicated `receiver_type` wrapper node (properties AND
    functions); `getter` became a named node. Analyzer receiver scans
    accept both shapes (receiver_type OR bare user_type) so they work
    against either wasm generation. When reviewing OTHER grammars after
    a wasm refresh, expect exactly this class of change: named wrappers
    around previously-flat children.
  - Verification protocol for a wasm swap (reuse it):
    1. parse the known-defect repro + analyzer-critical shapes with the
       candidate BEFORE swapping
    2. swap, run full fixture suite (all languages)
    3. grammar audit validates every node-type/field literal against the
       new binary (kotlin: refs=53 unknown=0)
    4. typecheck + e2e through the real analyzer on a previously-broken
       input

## Groovy decisions wave (2026-08-23) — D1/D2 resolved, decorator consistency closed

  - **D1 RESOLVED — framework detection added (unify won)**: research
    found a live consumer: result.framework → brain_file.framework_type
    (parallel-indexer.ts) → patterns/rules.ts ranks project frameworks
    on it. Groovy files got NULL, hiding Grails projects from pattern
    analysis. Mapping MEASURED from corpus top-imports (grails family,
    spock.lang, org.springframework dominate). Primary selection by
    fixed priority: grails > spring > hibernate > jpa > spock > junit.
    Annotation-driven detection deliberately LIMITED to the unambiguous
    spring family — bare "@Entity" would mislabel GORM entities as JPA
    (caught in e2e before commit; entity detection stays import-based).
  - **D2 RESOLVED — bare-field visibility ratified**: no consumer today
    filters property visibility; changing it risks exports regressions
    for zero measured benefit. Current public behavior stands, recorded
    here so it reads as a decision.
  - **Decorator consistency (CC1 observation) closed**: groovy methods
    now emit decorators[] like classes/fields do and like every Java/
    Kotlin symbol kind does. expectDecorators matcher tightened to read
    ONLY s.decorators (no metadata fallback) so per-kind emission stays
    pinned.
  - Harness gained expectPrimaryFramework.

## Scala review + fix wave (2026-08-23)

Grammar verdict: official tree-sitter/tree-sitter-scala IS correct; pinned
wasm compatible with current upstream on every probed shape — NO rebuild.
The grammar-audit baseline of 8 "unknown" literals turned out to be DEAD
ANALYZER CODE referencing a vocabulary from some other grammar
(applied_type, anonymous_function, string_interpolation, using_clause,
scoped_identifier, source_file) — absent from BOTH pinned wasm and
current upstream. Removed; scala audit now unknown=0.

Fixes (fixtures proven failing 13/18 pre-fix, passing 18/18 post-fix):
  - Renamed imports `{immutable => im}` preserved the full module path
    (the `as`-form path fix existed but was never mirrored to the arrow
    syntax — intra-file propagation gap).
  - Top-level calls attributed to "(script)" sentinel (handleCall required
    parent; handleInstantiation already handled null — asymmetry).
  - Decorators on ALL symbols (annotations were pattern-flag substrings
    only). GOTCHA: scala annotations are DIRECT children of definitions
    OR inside modifiers depending on construct — scan both.
  - Override confidence evidence-tiered (guess 0.5 / companion 0.9).
  - MEASURED: qualified PascalCase obj.Method() restricted to Calls —
    1156 occurrences in a 300-file scala3 sample, all enum/module member
    accesses fabricating Instantiates; bare Type(...) constructions stay
    Instantiates (4,533 legitimate).

Verification gaps stated honestly: the pinned differential corpus
(grails-core) contains no .scala files, so scala differential coverage
is 0 — fixtures + grammar audit are the only automated layers for this
language until a scala corpus is pinned.

## Scala final review (2026-08-23) — differential gap CLOSED, oracle aligned with measured reality

The recorded verification gap (scala differential = 0 files) is closed:
`bun run script/m14/differential.ts --repo scala3` now runs 60 real
dotty/scala3 files → **173/173 tree-truth edges covered (100%),
unexplained 0%, fabricated 0%.**

Getting there surfaced three layers, each instructive:

  - **The initial regression was the ORACLE, not the analyzer**: after
    the qualified-PascalCase restriction, "missing" rose 4→10 because
    deriveTreeEdges derived instantiates truth from ANY PascalCase-leaf
    call — baking in exactly the companion-apply assumption the corpus
    measurement refuted. The oracle's own comments show it has been
    refined before; it now derives construction candidates from
    receiver-less leaves only, and skips curried wrappers (mirroring the
    analyzers' documented curried-application rule). LESSON: when a
    measured heuristic change makes the differential worse, A/B the
    oracle against the pre-change analyzer before assuming your fix
    broke something.
  - **Bracket-arg hygiene on both sides**: scala type args use SQUARE
    brackets and multi-line constructs leave unbalanced tails
    (`List[` as an oracle target). Analyzer instantiation targets now
    strip []/<...> iteratively; oracle leaf extraction does the same;
    normTarget tolerates bracket tails like it already tolerated <>.
  - `let(new Foo) { ... }`: instance_expression nests inside arguments of
    a curried wrapper — an early-return guard in oracle traversal killed
    recursion and silently skipped such subtrees. Skip derivation only,
    never descent.

Fixture-authoring gotchas added this wave: `dest.Jump.check()` is a
field chain (only the last segment is called) — qualified-CALL fixtures
need real arguments (`h.Jump(1)`); scala annotations are direct children
OR in modifiers depending on construct.

Fixture-authoring gotchas: `dest.Jump.check()` is a field chain (only the
LAST segment is called) — a qualified-CALL fixture needs real arguments
(`h.Jump(1)`); scala annotations are direct children OR in modifiers.

## Scala dual-corpus closure (2026-08-23)

The single-corpus caveat is RESOLVED. Second corpus pinned:
**cats-effect** (typelevel, idiomatic FP — deliberately opposite idiom
from the dotty compiler). Results: 60 files, **408/408 tree-truth edges
covered (100%), 0 unexplained, 0 fabricated** — the analyzer generalizes
across radically different Scala styles. Both baselines refreshed to the
true floor (scala3:scala was still allowing missing=4 from its M14.1-era
entry; now 0/0, so any future regression from perfect is caught).
Corpus location: $HOME/fixtures/repositories/cats-effect.
Scala verification is now dual-corpus differential + 18 fixtures +
grammar audit (unknowns 0) + typecheck. Nothing known remains.

---

## Legacy gotchas (original appendix entries)

- **TypeScript** (reviewed 2026-08-23, official tree-sitter/typescript
  monorepo @ 75b3874; pinned ts + tsx + js wasms probed live):
  - Constructors, getters and setters are ALL `method_definition` nodes
    (ctor name = "constructor"; accessors lead with anonymous get/set
    tokens). There are NO `constructor_definition` or `getter`/`setter`
    node types. Comments are ONE generic `comment` node — no
    line_comment/block_comment. Rest params are `rest_pattern`
    (`rest_parameter` does not exist).
  - **DECORATOR PLACEMENT IS ASYMMETRIC** (verified against pinned wasm
    AND upstream node-types.json): field decorators attach INSIDE
    `public_field_definition` (field `decorator`), but CLASS decorators
    attach to the `export_statement`/`class_declaration` and METHOD
    decorators are SIBLINGS in `class_body` preceding the
    `method_definition`. Any analyzer reading decorators from the
    definition node's own children only sees FIELD decorators. No wasm
    rebuild fixes this — it is the current upstream shape.
  - Heritage: `class_heritage > extends_clause/implements_clause`; the
    extends_clause named children include BOTH the base type AND its
    type_arguments node for generic heritage (Base + "<string>") —
    pushing all children wholesale fabricates phantom extends targets.
  - Root is `program`; error ranges need the usual +1.
  - JSX requires the tsx wasm (.ts files parse JSX as errors).

## TypeScript fix wave (2026-08-23)

Fixes (6 fixtures proven failing 14/20 pre-fix, passing 20/20 post-fix):
  - **T1 generic heritage**: extends_clause children include the
    type_arguments sibling — wholesale push fabricated Extends edges to
    "<string>". Argument nodes now skipped.
  - **T2 apiContractPath contract**: bare path stored, method moved to
    metadata.apiMethod (Kotlin-wave decision applied to TS).
  - **T3/T5 decorator capture**: class decorators read from the wrapping
    export_statement; METHOD decorators collected as class_body SIBLINGS
    preceding the definition and passed down to extractMethod/
    extractConstructor/extractApiContract. NestJS/TypeORM/http-route
    patterns and decorator References edges live again.
  - **T4 usage pass revived**: extractUsageRelationships read a
    symbolNames map that was NEVER populated — zero References/type-Uses
    edges on every file since inception. Map now fed from extracted
    symbols.
  - Error ranges +1 (collectErrors + React-hook linter); "(script)"
    sentinel for top-level calls/instantiations; param-property
    modifiers carried on param.modifiers instead of substring-matching
    defaultValue text (a string default "private" fabricated a phantom
    private property); dead code removed (phantom-injection family ~125
    lines, relContainer, extractAccessor, 5 dead literals → audit
    unknowns 5→0).
- **web-tree-sitter IDENTITY TRAP** (cost a debug cycle): node wrapper
  objects are recreated per access — `namedChild(i) === member` NEVER
  matches. Compare startIndex (+type) instead. Applies everywhere.
- Differential: vue-core pinned as the standing TS corpus (60 files,
  46/46 tree-truth, 100%, 0 unexplained) — baseline recorded.

## TypeScript final self-audit wave (2026-08-24)

Post-commit adversarial re-review of b84cea5 found three more defects
(3 fixtures proven failing pre-fix, 23/23 post-fix):

- **X3 (biggest): `declare global { ... }` dropped its ENTIRE subtree.**
  ambient_declaration has no name FIELD at all, so `extractNamespace`'s
  `if (!nameNode) return false` bail fired; combined with the container
  no-descent list, nothing inside was ever visited — vue's jsx.d.ts
  extracted **0 symbols** (every global-augmentation interface vanished:
  JSX namespace, Window, module augmentations). Fix: nameless wrappers
  descend into body without pushing a scope. Named `declare module "x"`
  unchanged.
  - LESSON: my first X3 fix handled empty-name text AFTER the
    `!nameNode` bail — unreachable code that "looked" fixed. The live
    probe (0 symbols still) caught it. Always verify fixes against the
    original failing probe, not by reading the patch.
- **X2 interface heritage dead**: interfaces parse heritage as
  `extends_type_clause` (extends_clause is the CLASS node) and
  interface_declaration has no "extends" field — old lookup missed both;
  every interface-inheritance edge silently vanished. Generic bases skip
  type_arguments (same rule as T1).
- **X1 comment misattribution**: leading-comment walk had NO boundary —
  a trailing remark about declaration A (after a blank line) was stolen
  into B's comments. Walk now stops when a blank-line gap separates the
  comment run from its anchor.
- Harness gained `expectComments` matcher ({symbol, contains?,
  notContains?}) — pins comment capture AND misattribution guards.
- Edge-shape probes verified post-fix: type aliases, decorated
  arrow-function properties, export-default decorated classes, enums +
  members, named ambient modules, get/set pair → single property.
- Differential after wave: oracle extended for extends_type_clause (and
  taught to skip type_arguments there too — mirroring T1); vue-core now
  derives 58 tree-truth edges, analyzer covers 58/58 (100%), 0
  unexplained. Baseline refreshed.

Design note (recorded, NOT a defect): JSX elements emit BOTH Uses and
Instantiates edges (layered confidence claims). Consistent with family
behavior; revisit only if a downstream consumer double-counts.

*(existing entries retained below)*

- **Scala** (reviewed 2026-08-23, official tree-sitter/tree-sitter-scala;
  pinned wasm probed live): root node is **`compilation_unit`**, NOT
  `source_file`. Lambdas are `lambda_expression`; interpolations are
  `interpolated_string_expression`/`interpolated_string`. There are NO
  `applied_type`, `anonymous_function`, `string_interpolation`,
  `using_clause`, or `scoped_identifier` nodes — in EITHER the pinned
  wasm or current upstream (verified against node-types.json). Any
  analyzer branch referencing them is dead code, not a wasm drift issue.
- Unlike Kotlin, the pinned scala wasm DOES serialize named fields
  (~34; `childForFieldName("name"/"type"/"return_type"/"pattern")`
  verified working). `Language.fieldCount` returning undefined in
  web-tree-sitter is NOT proof of zero fields — use the grammar audit's
  oracleFieldCount or a live fixture probe instead.
- Supertypes live in `extends_clause` > generic_type/type_identifier/
  stable_type_identifier. `instance_expression` confirmed present
  (constructor modeling).
- Import renames come in TWO syntaxes with different AST shapes:
  Scala 3 `x.y.Z as W` → `as_renamed_identifier` child;
  Scala 2 `{immutable => im}` → `namespace_selectors` >
  `arrow_renamed_identifier`. A path-preservation fix applied to one
  syntax does not automatically cover the other.

- **Groovy**: this project uses a patched fork of `amaanq/tree-sitter-groovy`
  (see `grammars/tree-sitter-groovy/`) — diff against the upstream base to see
  what's inherited vs. custom before assuming grammar.js on GitHub reflects
  the pinned parser.
- **Scala**: `new Foo(...)` is modeled as `instance_expression`, not a
  `call_expression` wrapper, in the pinned grammar version — don't assume
  constructor calls show up in `call_expression` handling.
- **Java** (reviewed 2026-08-23, upstream tree-sitter-java @ e10607b, 2025-09-14;
  pinned WASM has no version metadata — treat exact commit as unknown):
  - Hidden rules (`_name`, `_constructor_declarator`, `_simple_type`) are
    **flattened in the concrete tree**: `constructor_declaration` DOES have a
    direct named `identifier` child even though grammar.js nests it inside
    `_constructor_declarator`. Verified against the pinned WASM. Don't "fix"
    this into a `constructor_declarator` lookup — there is no such node.
  - The project's own oracle for node-type/field literals is
    `bun run script/m14/audit-analyzer-grammar.ts --prove-java`
    (baseline: `validation/m14/grammar-audit-baseline.json`, java = 0 unknown).
    Run it before hand-verifying individual literals.
  - The language WASMs need the WASI shim from `src/util/wasm.ts`
    (`loadWebTreeSitter()`); plain `web-tree-sitter` init fails with
    `wasi_snapshot_preview1:clock_time_get must be callable`. Fixture pattern:
    `loadWebTreeSitter()` + `Parser.init({ locateFile: () => <node_modules core wasm> })`.
  - Annotation name is `$._name = choice(identifier, _reserved_identifier,
    scoped_identifier)` — fully-qualified annotations produce a
    `scoped_identifier` child, NOT an `identifier`. Any analyzer code that does
    `findChildByType(ann, "identifier")` silently misses FQ annotations.
  - `object_creation_expression` type shapes verified on the pinned WASM:
    plain → `type_identifier`; diamond/generic → `generic_type` (whose first
    child may itself be `scoped_type_identifier`); qualified/inner →
    `scoped_type_identifier`. All three occur and must be handled.
  - Varargs are `spread_parameter` (child of `formal_parameters`), not
    `formal_parameter` — parameter loops that filter on `formal_parameter`
    drop varargs. Record components share this shape.
  - Records use `compact_constructor_declaration` for `E { ... }` bodies — a
    distinct node type from `constructor_declaration`; unhandled = silent drop.
  - Sealed classes: `permits` clause is its own node sibling to `superclass`;
    not part of `super_interfaces`/`type_list` walking unless handled.

## Java fix wave (2026-08-23) — what the F1–F3 fixes taught

Fixes committed for the three verified bugs; fixtures added under
`validation/m14/fixtures/java/` (`fq-api-endpoint`, `fq-jpa-entity`,
`ctor-value-injection`). Lessons for the next review:

  - **Annotation decisions must never be raw-text prefix matches.** The F2
    family had spread to six call sites (`@Table(`, `@Service`/`@Repository`/
    `@RestController` pattern flags, `@FeignClient`, field/param `@Value(`
    gates, `hasJavaAnnotation` prefix test). All now resolve names via
    `getJavaAnnotationShortName()` (AST last-dotted-segment). When reviewing
    ANY analyzer, grep both `startsWith("@` AND exact-name-vs-prefix
    semantics — prefix matching also silently over-matched
    (`@ServiceRegistry` matched `@Service`) before this wave.
  - **Variable shadowing inside a big if-block** caused `apiContractPath`
    to be persisted as `""` into `brain_symbol.api_contract_path` while the
    sibling relationship carried the correct route. When a symbol field and
    its metadata twin disagree, suspect shadowing.
  - **Value lookups must target the same node the annotation sits on** (F3:
    param annotation, method-node lookup → zero edges). General rule: after
    detecting an annotation on node X, read its arguments from X, not X's
    parent.
  - Fixture workflow used: author expectations encoding CORRECT semantics →
    confirm they FAIL pre-fix → fix → confirm 16/16 + sibling languages
    unchanged + grammar audit baseline stable. Reuse this shape.

## Java gap wave (2026-08-23) — coverage gaps closed + measurements recorded

Second wave: mechanical coverage gaps (no corpus stats needed to justify)
plus one consumer-driven fix and two recorded MEASUREMENTS.

  - **Varargs (`spread_parameter`)**: no named fields in the pinned grammar;
    name lives inside trailing `variable_declarator`, type is the remaining
    child. Modeled as `T[]` (matches ERROR-recovery convention + JVM
    erasure). Handled for method params AND record components.
  - **Compact record constructors** (`compact_constructor_declaration`,
    fields name+body): now emit Constructor symbols whose implicit
    parameter list = the parent record's components (read from
    parentContext.node).
  - **`permits` clauses**: emitted as directional sealed-class→subtype
    References edges (`meta.relationshipType="permits"`); deliberately NOT
    in classHierarchy.parents — permitted subtypes are children.
  - **Override Pass-3 confidence demoted 1.0 → 0.5** (pass 2 → 0.85): this
    is NOT a judgment call — `src/ast/patterns.ts:137` filters
    relationships at `confidence >= 0.7`, so file-local guesses were
    contaminating thresholded analysis identically to verified overrides.
    Rule for all analyzers: check whether relationship.confidence has
    consumers before assigning it reflexively.
  - **MEASURED — isJavaBuiltin any-segment filter**: on grails-core (1942
    java files) only 6 files (0.31%) declare a type colliding with
    STDLIB_ROOTS (`Class`, `Collection`, `Test`, `Properties`, `com`).
    Below the repo's own 0.5% bar (Scala precedent). Filter KEPT with
    evidence; do not "fix" without a fresh measurement.
  - Still open (cosmetic, skip unless something consumes them): field-access
    Uses edges on stdlib receivers (`System→out`); `*Factory`/`*Builder`
    identifier pattern flags.
