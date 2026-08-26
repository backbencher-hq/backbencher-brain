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

## Cross-language verification wave T1–T7 (2026-08-24)

Seven open threads from the TS review dispositioned — nothing skipped;
each got probes, fixtures, a fix, or ratification-with-evidence.

- **T1 cyclomatic complexity family contract** (measured defect, all 5
  languages): identical logic (if/else + for + ternary + &&) measured
  TS 5/5 (accidental: else double-count canceled missing base), java
  4/3, kotlin 4/5, scala 4/3, groovy **2** + file metric MISSING.
  Contract now: `complexity = 1 + decisions`; decisions = branch
  constructs + short-circuit ops (`&&`, `||`, `??`, `?:`); an else NEVER
  adds. Groovy's calculator had DEAD node-type cases (`"&&"`, `"||"`,
  `"do_while"`, `"switch_statement"`, `"catch_block"`,
  `"elvis_expression"` — none produced by the pinned wasm; real shapes:
  binary_expression operator field, do_statement,
  switch_block_statement_group, catch_clause). Java missed operators
  entirely; scala counted neither operators nor base. Post-fix parity:
  **5/5/5/5/5** both metrics (probe: /tmp/opencode/cc-parity.ts).
  ALSO: per-symbol complexity must live at TOP-LEVEL `symbol.complexity`
  — parallel-indexer.ts reads `symbol.complexity || 1` for gravity
  scoring; metadata-only values left every TS/kotlin/scala symbol at
  complexity 1 in the index (search-ranking degradation).
- **T2 overload implementation bodies**: class-method overload groups
  kept the FIRST declaration = body-less signature (complexity 1, no
  qualified_calls) while the walker still emitted body-derived call
  edges sourced from it. Now LAST-declaration-wins (implementation
  carries full params + body data). Top-level function overloads
  already resolved to the implementation ✓ verified.
- **T3 JSX dual edges RATIFIED**: consumers audited — edit-engine
  callers count is a `>0` threshold (display may inflate by 1 for
  JSX-used components; cosmetic), graph-engine default excludes `uses`,
  orphan detection is existence-based. No behavioral double-count.
- **T4 namespace-member export boundary**: isNodeExported crossed
  container boundaries — `class Hidden {}` inside `export namespace NS`
  was marked exported/public. Named-container members now need their OWN
  export keyword (TS semantics); container itself unaffected.
- **T5 re-export attribution**: names were collected by rescanning the
  global exports array via LINE-RANGE overlap — two export statements on
  one line made ./m2 claim ./m1's items; `export * from` recorded
  nothing at all. Names now come from THIS statement's children; star
  re-exports record item "*".
- **T6 qualified_calls format parity** (measured): identical code
  measured TS/Groovy/Kotlin/Scala embedding ARGUMENT text in chained
  calls ("db.list(user).map") and kotlin emitting "service..save"
  (navigation_suffix raw text leaked its dot). Contract: dotted path,
  no arguments. Post-fix parity: ["service.save","db.list.map",
  "db.list"] in all five (java additionally captures lambda-body calls —
  coverage difference, recorded). 5 parity fixtures pin it.
- **T7 REINDEX IMPACT ENUMERATION** (for whoever runs the next reindex):
  1. brain_symbol.complexity becomes REAL for TS/Kotlin/Scala symbols
     (was silently 1) → gravity_score ranking will shift noticeably;
  2. qualified_calls entries lose embedded argument text → any exact-
     match consumer keyed on old arg-laden strings must re-match;
  3. kotlin "receiver..member" malformed paths disappear;
  4. TS api_contract_path values change format ('GET /x' -> '/x') —
     doc-engine exact-match now consistent with JVM languages;
  5. NEW edge types appear for TS (References/type-Uses) — graph
     queries filtered to specific types are unaffected; unfiltered
     edge counts grow;
  6. TS namespace members previously falsely exported become private →
     public-API counts shrink toward truth; gravity boost lost for them;
  7. declare-global / .d.ts augmentation symbols appear where files
     previously indexed ZERO symbols;
  8. complexity thresholds in quality scoring (>30/>50) see real values
     for the first time on JVM/TS alike.

## Second-pass audit of T1–T7 (2026-08-24, later)

Adversarial re-check of the T1–T7 fixes themselves. Two more defects
caught and fixed (fixtures proven failing pre-fix); two verified-clean;
one verified pre-existing gap recorded, one out-of-scope observation:

- **B (fixed): constructor overload duplicates** — the last-wins dedupe
  had excluded constructors by name, so ctor overload groups pushed a
  DUPLICATE constructor symbol per declaration (probed: params=0 AND
  params=1 both emitted). Constructors now included in the group map.
  Harness gained `expectSymbolCount` {name, equals} to pin dedupe.
- **E (fixed): empty re-export clause misfired as star** —
  `export {} from "./m"` exports NOTHING but was recorded as a "*" star
  re-export (the !foundNamed fallback). Star is now gated on an actual
  '*' token; additionally `export * as ns` now records alias "ns" via
  namespace_export handling (and registers it as an export) — the '*'
  token lives INSIDE namespace_export so a bare hasToken check misses
  it. That regression was caught during THIS audit before commit.
  Harness gained `forbidImports`.
- **A verified**: extended parity on while/do/switch-cases/catch/??:
  TS=Java=Groovy=7 on equivalent logic (kotlin 4 matches its own
  construct set). Contract holds beyond the original fixture shape.
- **C verified clean**: get/set accessor pairs still collapse to ONE
  property under last-wins overload rule.
- **D RECORDED (verified pre-existing gap, not fixed here)**: members of
  ambient modules (`declare module "x" { function old(): void; }`) are
  NOT extracted — module-level function_signature nodes have no
  extraction path. Declaration-file API surfaces are therefore
  under-reported (vue's jsx.d.ts interfaces ARE extracted via the
  declare-global fix; plain function signatures are not). Recommend a
  dedicated fixture + extraction path in a future wave.
- **F OBSERVED (out of scope)**: real-javascript-analyzer emits NO
  qualified_calls at all (field absent on symbols) — separate analyzer,
  outside this five-language review; recorded for whoever reviews JS.

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

## JavaScript review wave (2026-08-24)

Method: the universal analyzer-review prompt. Ground truth = official
tree-sitter/tree-sitter-javascript node-types.json + LIVE probes of the
pinned wasm (they agreed; no dead type-literals, all 13 field refs
exist). Sibling diff vs real-typescript-analyzer drove most findings —
every recent TS fix was missing from JS.

FIXED (9 fixtures proven failing pre-fix):
  - **Barrel re-exports invisible**: `export * from "./barrel"` recorded
    NO import and NO relationship — barrel files (index.js everywhere in
    JS) contributed zero module edges. Now synthetic import with
    metadata.reExport + Imports relationship.
  - **Qualified heritage dropped**: `class Sub extends Lib.Base` emitted
    NO extends edge (extraction matched only bare identifiers).
  - **Anonymous default exports lost**: `export default function () {}`
    / `export default class {}` produced no export record at all.
  - **Deep CJS exports dropped**: only direct `module.exports` /
    `exports.x` recognized; `module.exports.sub = ...` vanished.
  - **Import alias misattribution**: `import { alpha as beta }` recorded
    item "alpha"; the local binding is beta (alias||name convention).
  - **Decorators ignored entirely** (pinned wasm DOES produce decorator
    nodes — verified live): classes/methods now carry decorators.
    NOTE grammar difference vs TS: in JS, method decorators are OWN
    children of method_definition (TS: class_body siblings).
  - **qualified_calls absent**: JS was the ONLY family member without
    the #383 symbol payload. Ported dotted-path collector (no argument
    text), attached by enclosing function/method name.
  - **T1 complexity contract propagated**: counters missed do_statement,
    for_in_statement, and ALL short-circuit operators (&& || ??).
    File-level `complexity` was ALSO the synthetic fake
    symbols.length+relationships.length (groovy/scala disease) → now
    real cyclomatic value.
  - **Comment boundary theft** (X1 port): unbounded previousSibling walk
    stole trailing comments across blank lines.

HARNESS: added expectExports matcher (was silently absent — two early
fixtures were VACUOUS until caught: unknown expectation keys are
ignored, they don't fail) and forbidImports. LESSON: a new matcher must
land BEFORE or WITH the fixtures that use it; verify fixtures fail
pre-fix for the RIGHT reason.

RECORDED, NOT FIXED HERE:
  - Differential corpora for JS are thin (52 grails-core .js files → 2
    tree-truth edges; vue-core 31 files → 16). A real npm-library corpus
    (lodash/express-class codebase) is needed before JS differential
    coverage means what it means for JVM languages.
  - resolveCurrent misses calls inside object-literal methods and
    class static blocks — attributed to outer scope instead (minor,
    unmeasured impact).
  - require() relationship target format `${path}:*` differs from ESM
    `${path}:${item}` — pre-existing convention, unchanged.

GOTCHAS (per-language appendix):
  - **JavaScript**: decorators are OWN children of
    class_declaration/method_definition in this grammar (contrast TS:
    method decorators are class_body siblings). Pinned wasm produces
    them; older builds may not — probe before relying.

## JavaScript second-pass audit (2026-08-24, later)

Adversarial re-check of the JS wave itself. FIVE more defects, all
fixture-proven failing pre-fix — two of them Tier-1 misclassification:

- **TIER-1 accessor-name collision**: hasToken matched child.TEXT
  against any direct child INCLUDING the method's own name identifier.
  Plain `get() {}` / `set(v) {}` methods were classified as accessor
  Properties with isAccessor:true; `async() {}` carried isAsync:true.
  These method names are common in real APIs. Fix: match anonymous
  tokens only (keyword/operator token types equal their text; named
  identifiers excluded).
- **TIER-1 private methods**: `#secret()` kept the '#' in its symbol
  name AND was marked visibility public (field_definition already
  stripped #, methods did not). Now clean name + private.
- Barrel named clauses recorded EMPTY items (`export { a, b } from` lost
  the names); now alias||name per specifier.
- CJS export chains deeper than one level (`exports.group.item`,
  `module.exports.nested.deep`) entirely dropped; dotted subpath names
  now emitted.
- qualified_calls collector missed the X.prototype.m assignment rule
  that extractCallRelationships already had — prototype method bodies
  left the payload empty. Rule unified.

VERIFIED CLEAN: real accessors still Property under the token fix;
existing fixtures unaffected.

RECORDED (verified pre-existing, not fixed here):
- Class EXPRESSIONS (`const A = class extends B {}`) emit no Class
  symbol and no heritage — coverage gap.
- extractOverrideRelationships uses flat confidence 0.95 for both
  in-file-exact and companion-resolved overrides — JVM family uses
  evidence tiers (1.0 exact / 0.85 companion / 0.5 guess). Convention
  drift, low blast radius today (0.95 > 0.7 filter) but should align
  if thresholds tighten.

GOTCHA (appendix): hasToken-style helpers must NEVER match child.text —
anonymous-token TYPE matching only; identifier text collisions are the
trap (this bit get/set/async/static here; same helper shape exists in
the TS analyzer where class/method contexts differ — audited, TS's
uses are decorator/generator checks on nodes whose children cannot be
user identifiers of those names... recheck if reused elsewhere).

## JavaScript differential parity (2026-08-24, final)

The JS verification floor matched its siblings: **lodash pinned as the
standing JS differential corpus** (55 files, 264/264 tree-truth edges =
100%, 0 unexplained, 1,318 analyzer edges verified). Oracle refined:
new_expression construction candidates must be NAMEABLE leaves
(identifier / dotted member path) — anonymous constructor expressions
(`new (Backbone.Collection.extend({...}))()`) fabricated unmatchable
oracle targets; mirrors the ratified Scala identifier-leaf rule.

JS now carries the same real-code regression protection as TS/JVM.

## Vue review wave (2026-08-24)

Method: universal prompt. Grammar = tree-sitter-grammars/tree-sitter-vue
(45 node types — template skeleton only; script bodies are raw_text
pre-parsed by the engine per lang). Siblings: TS/JS.

FIXED (3 fixtures proven failing pre-fix):
  - **DUAL SCRIPT BLOCKS**: only sfcScriptTrees[0] was processed —
    `<script>` + `<script setup>` (THE standard Vue 3 layout) lost the
    entire setup block: imports, state, functions all vanished. All
    blocks now processed.
  - **LANG DISPATCH**: lang="ts" blocks were routed through the JS
    analyzer even though the engine pre-parses them with the TS grammar;
    interfaces/types silently dropped. Blocks now dispatch to the
    matching language analyzer.
  - **DUPLICATE COMPONENT SYMBOLS**: SFC skeleton Class + Options-API
    Class pushed TWICE when no `name:` option existed.
  - **findExportDefault fragile**: text.startsWith("export default")
    missed every script whose body began on a new line after <script>
    (raw_text starts with "\n") — structural trimStart check now.
  - **METRICS FAKES** (groovy/JS disease, third occurrence): file
    complexity was symbols+relationships synthetic; cyclomaticComplexity
    hardcoded 1. Now real: 1 + script-block decisions + template
    decision directives (v-if/v-else-if/v-for/v-show counted as
    rendering branches).

DIFFERENTIAL PARITY ACHIEVED:
  - vue added to the differential harness; element-plus pinned as the
    standing Vue corpus: **156/156 tree-truth (100%), 0 unexplained**
    across 60 real SFCs; vue-core full population also 10/10.
  - Oracle built INDEPENDENT of the analyzer: own HTML-core tag set +
    vue-builtin skip; template component usages derived from start_tag
    descent (tag_name is NOT a direct child of element — first oracle
    draft got this wrong and under-derived).
  - REAL NOISE FOUND BY THE CORPUS: `new Promise()` / `new Date()` /
    DOM event constructors emitted Instantiates edges to RUNTIME GLOBALS
    in BOTH the JS and TS analyzers (builtin filters covered calls,
    never constructions). Filtered on all three sides (analyzer x2 +
    oracle) with the same intrinsic/DOM list; grails-core regression
    this initially caused proved the asymmetry — fixed symmetrically.
    lodash JS differential re-measured: 178/178 (100%) post-filter.

RECORDED (verified pre-existing, not fixed here):
  - setup() key in Options API not extracted as a method; its returned
    bindings unlinked.
  - `components: { ... }` local registrations produce no relationship to
    the imported component symbol (template instantiates remain
    tag-name-only).
  - `<script setup>` bindings used in template are not linked to their
    template usages (needs template-expression scope analysis).

## Vue second-pass audit (2026-08-24, later)

Adversarial re-check of the Vue wave. TWO intra-Vue parity defects,
both fixture-proven failing pre-fix:

  - **Script-setup props/emits lost**: defineProps/defineEmits carry the
    component's public contract, but only the binding Constant survived
    (`const props = ...`) — script-setup components had NO Property/
    Event declarations while Options-API components did. Macro call
    arguments now extracted (array-of-strings AND object forms) into
    Prop/Event symbols owned by the component (metadata.isScriptSetup).
  - **watch misclassified as lifecycle hook** (isLifecycleHook metadata)
    and its handler members unextracted. watch is an option whose keys
    are watched reactive sources — now Method symbols (isWatcher),
    matching methods/computed handling. Note: v-else correctly NOT
    counted as a decision in metrics (else never adds — family
    contract); v-show counted as conditional render.

GOTCHA: engine pre-parses lang=tsx/jsx blocks with the JS grammar
(only "ts" maps to typescript) — SFCs using tsx script lang silently
lose TS-only shapes; same class as the lang-dispatch fix, rarer.

Still recorded open (verified): setup() option extraction;
components:{} registration edges; script-setup↔template binding links.

## Svelte review wave (2026-08-24)

Universal method. Grammar = sveltejs/tree-sitter-svelte (85 node types;
script bodies raw_text pre-parsed by the engine). Sibling diff vs Vue/JS.

FIXED (2 fixtures proven failing pre-fix + live-probe evidence):
  - **Evidence tiers absent** (#419-D violation): calls/instantiates/
    exports/contains all emitted with NO evidenceClass. Classifier
    ported from the Vue/JVM family.
  - **Metrics fakes — FOURTH occurrence**: complexity =
    symbols+relationships synthetic; cyclomaticComplexity hardcoded 1.
    Now: 1 + script decisions + template decision constructs ({#if},
    {:else if}, {#each}, {#await}).
  - **0-based columns**: nodeToRange lacked the family-wide +1.
  - **lang="ts" dispatch**: TS-only declarations (interfaces) dropped;
    blocks now dispatched per lang attribute (same fix as Vue).
  - **2 dead grammar literals**: expr_attribute_value / raw_text_expr
    don't exist in the pinned wasm (real shape: attribute > expression >
    svelte_raw_text). Audit unknowns 2→0.

DIFFERENTIAL PARITY:
  - svelte added to the harness; `svelte` repo pinned as standing corpus
    (4,462 .svelte files): 300-file probe **76/76 tree-truth (100%), 0
    unexplained**; default-sample floor baselined.
  - Oracle extended for SFC languages: embedded <script> bodies are
    re-derived as structural truth (per-lang js/ts parsing), so
    extends/implements/instantiates from scripts are gated too —
    previously invisible to the oracle inside raw_text.
  - Oracle overrides-truth now EXCLUDES constructors (not virtually
    dispatched; no family analyzer emits ctor-overrides).

GOTCHAS:
  - on:/event handler extraction relies on opaque-raw-text String
    scanning (grammar exposes template expressions as leaves); call-target
    heuristic documented in-code. If a future wasm upgrade structures
    template expressions, revisit.
  - engine maps only lang="ts" to the TS grammar; lang="tsx"/"jsx" blocks
    run as JS (rare; recorded).

FOLLOW-UP (same day): the svelte repo's own .ts corpus (.d.ts files)
exposed one more ORACLE over-derivation: class-heritage collection
descended into type_arguments, pushing TYPE PARAMETERS (Props, Events,
T...) as fake extends targets — 13 phantom missing edges. Same guard the
extends_type_clause path already had applied to class/implements
heritage. All svelte floors re-pinned at true 0/0 (javascript,
typescript, svelte languages). LESSON REINFORCED: pinning a non-zero
floor hides real signal — investigate before recording.

## Svelte #419 completeness wave (2026-08-24)

Judgment A INVENTORY (54 named grammar types mapped to behavior):

| Construct | Emission | Status |
|---|---|---|
| <script> instance / context=module / lang=ts | sub-parse dispatch; module exports are MODULE API (never props); ts -> TS analyzer | FIXED this wave (module-block ownership inverted by LIFO walk) |
| export let/const/function (instance) | Property/Constant/Function owned by component | GATED |
| $props() destructure (+defaults) | Prop symbols | GATED |
| $props() ...rest | opaque - plain variable only | SPEC: spread-rest props have no static names |
| $: reactive statements | Variable (isReactiveDeclaration) | GATED |
| Runes ($state/$derived.by/$effect.root/$props.id...) | bindings = symbols; rune CALLS filtered incl. DOTTED forms via callee-prefix rule | FIXED this wave ('by'/'root'/'id' leaked) |
| {#if}/{:else if}/{#each}/{#await} | template decision constructs -> cyclomatic | GATED |
| {#key} | control-flow block, no symbol | SPEC: no declarations |
| {#snippet name} / {@render name()} | Method (isSnippet) + Calls edge | FIXED this wave (render_tag content is OPAQUE TEXT - string scan; nested-in-each now reached) |
| {@const} | skipped | SPEC: template-scoped expression, not component surface |
| {@html}/{@debug} | skipped | SPEC: expressions/directives |
| on: handlers (incl |modifiers, member leaves like box.open) | Calls to callable leaf | EXTENDED this wave (member leaf previously dropped) |
| bind:/class:/style:/transition:/in:/out:/animate: | no relationships | SPEC: rendering concerns |
| <svelte:*> specials | filtered builtins | GATED |
| non-builtin tags | Instantiates (usage_contextual) | GATED |
| duplicate contains triples | deduped globally (sub-analyzer + owner pass double-emitted) | FIXED this wave |

Judgment B: relationship-kind-catalog fixture gates instantiates/calls/
imports/exports/contains/extends with evidence tiers. implements/
references flow via the TS/JS sub-analyzers (unpinned here); permits N/A.

Judgment C: payload-pins fixture gates JSDoc comments + complexity +
qualified-call survival through the SFC merge.

VERDICT: A/B/C satisfied at fixture level; differential floors true 0/0;
stations D/E/F/G closed; H aligned. Remaining for L5: owner spot-checks
+ full #419 spec rollout parity (Java-pilot format).

## Svelte second adversarial pass (2026-08-24, final)

Attack on the first wave's own fixes + a heavyweight real-world corpus:

- **shadcn-svelte pinned as second standing corpus** (1,681 real Svelte 5
  rune components): 60-file sample, **470/470 tree-truth (100%), 0
  unexplained** on first contact — the strongest real-code signal any
  analyzer in this review has received.
- **ONE latent defect found and fixed**: my own rune filter used a bare
  `$`-prefix rule, which would also swallow calls to USER-defined
  $functions (legal JS). Tightened to: full dotted name ∈ SVELTE_RUNES,
  or `$`-prefixed with a known RUNE LEAF segment. New fixture
  user-dollar-functions proves a user `$format()` call SURVIVES while
  `$derived.by` noise stays filtered (proven failing pre-fix).
- Corpus grep evidence: all 1,325 `$`-calls across shadcn-svelte are
  genuine runes ($props/$bindable/$state/$derived/$effect) — no user-$
  collisions exist in the wild corpora, but the filter is now precise by
  construction regardless.

VERDICT: second pass found exactly one defect (the over-filter), it is
fixed and gated; no further findings. Svelte stands at the same depth
as TS/JS/Vue: two adversarial passes, completeness inventory, dual
corpora at true 0/0.

## C++ review wave (2026-08-24)

Universal method. Grammar = tree-sitter/tree-sitter-cpp; ground truth
verified against the pinned wasm (base_class_clause children are FLAT:
access_specifier / type_identifier / template_type — NO base_class
wrappers). Siblings: C, Java.

FIXED (3 fixtures proven failing pre-fix):
  - **STATEFULNESS (Tier-1)**: uses-dedup set AND virtual registries
    stored on the analyzer INSTANCE. Under parallel indexing an identical
    later file LOST its Uses edges entirely (proven: file A emits
    setup->timeout, identical file B emitted nothing). All state is now
    per-analyze locals.
  - **VIRTUAL OVERRIDES WERE DEAD**: registration was gated on a prior
    base_class_clause - top-down walking meant base virtuals were never
    registered before Derived was processed. Zero override edges could
    emit for canonical shapes. Now: every class-scope Method registers;
    post-loop transitive resolution (A->B->C, depth-capped) emits
    Overrides @0.9. Keyword-less redefinitions included (C++ virtual
    dispatch needs no keywords); constructors never register.
  - **Payloads absent**: qualified_calls (#383 - dotted/qualified path,
    :: separators kept, no args, attributed to enclosing function) and
    per-symbol cyclomatic complexity + file-level metrics (T1 contract)
    did not exist. Ported.
  - **Dead literals**: 'base_class' fallback branches removed (audit
    unknowns 2 -> 0).
  - **Implements/Overrides twin emission** dropped: a virtual override is
    ONE Overrides edge (JVM-family convention), not Implements+Overrides.

DIFFERENTIAL PARITY:
  - cpp added to harness + oracle (class_specifier/struct_specifier/
    union_specifier heritage via flat base_class_clause; field_declaration
    member methods for overrides-truth; new_expression leaf-normalization
    incl. ::-qualified and template forms).
  - fmt pinned as standing cpp corpus (47 files): 147 truth edges,
    covered 134, missing=4 unexplained=5 RESIDUAL documented below.
    Baselines recorded at this investigated floor.

RESIDUAL (investigated, enumerated - not silently absorbed):
  - 4 MISSING = FIELD-shadowing pairs (skip_count/message/matcher): truth
    derives them from member variables; analyzers rightly do not treat
    field name-hiding as virtual overrides.
  - ~3-5 UNEXPLAINED in gtest unity-build files: macro-generated members
    (GTEST_DISALLOW_COPY_AND_ASSIGN_ expansions) where truth/analyzer
    disagree on synthetic member identity.

GOTCHAS:
  - hasDirectModifier-style text checks are safe here ONLY because C++
    keywords (`virtual`, `override`) are anonymous token children of
    declarations - the JS accessor-name trap does not apply to this shape.
  - out-of-line definitions (void X::f(){}) resolve their owner via the
    qualified_identifier scope walk; template bases strip to leaf names
    or the override registry keys mismatch.

## C++ second adversarial pass (2026-08-24, final)

Attack on the wave's own fixes. TWO defects found, both fixture-proven:

  - **SIGNATURE-BLIND overrides**: a same-name DIFFERENT-parameter method
    (C++ NAME-HIDING) was emitted as Overrides - virtual dispatch only
    matches exact signatures. Registry now stores normalized parameter
    text per name; resolution requires signature equality. Keyword-less
    same-signature redefinitions still resolve; transitive chains intact
    (C->B->A verified); multiple-inheritance diamond resolves through
    every path.
  - **Template args leaked into instantiation targets**: `new
    std::vector<int>()` emitted target 'vector<int>'. Stripped to the
    constructed type name.

VERIFIED CLEAN: out-of-line static member definitions keep their owner
(Repo::count -> Repo, private); cross-file override isolation holds;
complexity parity on the canonical shape (=5).

RECORDED (verified, dispositioned):
  - friend declarations: Scope.friends is a dead field and no edge is
    emitted. A References edge (A grants B access) is the natural shape -
    deferred until a consumer needs it.
  - memorySafetyScore: unmeasured heuristic (+make_unique/-new delete).
    Flagged; measure against a real corpus before trusting.

## C review wave (2026-08-24)

Universal method on real-c-analyzer.ts (1,636 lines - richest of the
family: security heuristics, kernel patterns, ABI inference all
pre-existing and kept). Grammar = tree-sitter/tree-sitter-c.

FIXED (2 fixtures proven failing pre-fix + corpus evidence):
  - **METRICS FAKES - FIFTH AND FINAL OCCURRENCE**: file 'complexity'
    was symbols+relationships synthetic while real cyclomatic ran beside
    it. Now complexity == cyclomaticComplexity (canonical shape = 5).
  - **Per-symbol complexity absent** on functions; added via in-place
    walk (T1 contract).
  - **qualified_calls absent** (#383): calls per enclosing function now
    attached.
  - **Evidence tiers absent** (#419-D): classifier ported; include-
    dependencies map to import_based, type references to
    reference_qualified.
  - **malloc Instantiates noise**: malloc allocates BYTES, not a named
    type - edge to literal 'malloc' removed (allocation tracking stays
    in metadata/patterns).
  - **CAST/CALL confusion** (corpus-found): `(Unit)(x)` vendor-macro
    casts through untracked typedef headers emitted Calls edges to the
    TYPE name. Parenthesized bare-identifier callees are treated as
    casts; dereference forms ((*fp)(x)) still resolve. 127 noise edges
    eliminated on jq.
  - **Malformed-target guard**: include-adjacent macros produced call
    targets containing quotes/newlines.
  - **Dead literal**: asm_expression removed (pinned wasm emits
    gnu_asm_expression only). Audit unknowns -> 0.
  - **goto/labels de-counted** from cyclomatic (T1: they are not
    decisions); maintainability tracking keeps them.

DIFFERENTIAL PARITY:
  - c added to harness/oracle with CALL-edge truth (identifier callees +
    member-pointer leaves). jq pinned as standing C corpus (45 files):
    **1692/1692 tree-truth (100%), 0 unexplained**, 9,411 analyzer
    edges verified.

GOTCHAS:
  - vendor-macro casts through untracked typedefs parse as
    call_expression > parenthesized > identifier - indistinguishable
    from paren-wrapped calls without whole-program typedef knowledge;
    heuristic documented above.
  - function_declarator NESTS the name (declarator > field_identifier) -
    one level deeper than cpp's shapes.

## C second adversarial pass (2026-08-24, final)

Attack on the wave's own fixes + untouched corners:

- **DISPATCH-TABLE NOISE**: `handlers[i]()` emitted the raw bracket text
  as a call target. Subscript callees now filtered (family contract with
  cpp - no static callee name exists). Fixture proven failing pre-fix.
- VERIFIED CLEAN: function-pointer-parameter calls resolve (`fp(5)`);
  recursive self-calls land in qualified_calls; static helpers stay
  private; multi-declarator statements split; typedef-anonymous-struct
  field uses resolve; enum member uses resolve; K&R definitions extract
  the function (params=[] - museum-grade syntax, SPEC disposition);
  cross-file registry isolation holds.
- STRESS TEST (sqlite repo, autosetup/jimsh0.c - 25,495-line generated
  TCL interpreter): parse 1.1s + analyze 5.7s, 2,133 symbols / 8,907
  relationships, zero crashes. The 182 reported parse errors are the
  documented tree-sitter limit (no macro expansion) - the file compiles
  cleanly with gcc. PERF CHARACTERISTIC recorded: macro-dense generated
  files cost ~5s each; typical hand-written C costs milliseconds (jq
  avg). Optimization of the walk is future work if such files matter.

## Rust review wave (2026-08-24)

Universal method. Grammar = tree-sitter/tree-sitter-rust; ground truth
against upstream node-types + pinned-wasm live probes (they agree on the
four audit dead literals). 933-line analyzer, full read.

FIXED (3 fixtures proven failing pre-fix + corpus evidence):
  - **4 DEAD LITERALS** (audit): type_alias_declaration, if_let_expression,
    while_let_expression ('if let' parses as a PLAIN if_expression -
    verified live), trait_bound (trait_bounds children are direct types).
  - **NO EVIDENCE TIERS** (#419-D) - classifier ported; where-clause
    bounds = reference_qualified.
  - **NO complexity fields**: per-symbol function complexity added (T1);
    file-level 'complexity' field did not exist at all - now = cyclomatic.
    match ARMS counted per-case (family granularity); counting
    match_expression TOO double-counted every dispatch - caught during
    fixture calibration.
  - **NO qualified_calls payload** (#383) - calls per enclosing function.
  - **0-BASED COLUMNS** in createSymbol (+1 applied family-wide).
  - **visibility never set** in createSymbol - Rust default-private now
    explicit instead of undefined.
  - **Instantiates target garbage**: Foo::new() emitted Instantiates to
    literal 'new' - now resolves the RECEIVER TYPE leaf (Foo).
  - **INSTANTIATION NOISE (measured, corpus-found)**: the PascalCase/
    ::new heuristic fired on every std/foreign type (Arc, Ok, foreign
    builders) - 90%+ of such edges could never resolve to a project
    symbol. Now DEFERRED and emitted only when the type is declared
    in-file. ripgrep unexplained dropped 2092 -> 30.
  - self_token phantom field reference removed (not serialized).

DIFFERENTIAL PARITY:
  - rust added to harness + oracle (call edges via identifier/member
    leaves, macro invocations as call sites, impl->implements, trait
    bounds->extends, struct literals + ctor shapes ->instantiates).
  - ripgrep pinned as standing Rust corpus (60 files): **1894/1901
    tree-truth (99.6%), unexplained 30 (0.4%)** - floors recorded at an
    INVESTIGATED residual of three enumerable classes:
      1. struct literals inside MACRO bodies (opaque to both sides)
      2. fully-qualified path literals (globset::Glob {...})
      3. tuple-VARIANT constructions where truth/analyzer disagree on
         the constructed name.

GOTCHAS:
  - 'if let'/'while let' have NO dedicated nodes - plain if_expression/
    while_expression (old grammar names are dead literals).
  - function_declarator-style nesting does not apply; Rust parameter
    names come from the 'pattern' field; self_parameter text IS '&self'.
  - impl blocks intentionally emit one Impl symbol per (type,trait) pair
    named after the type - duplicate names across traits are BY DESIGN
    (stable identity); consumers must key on owner metadata.
