# Analyzer Review — Per-Language Gotchas Appendix

Appended after each `real-{{LANGUAGE}}-analyzer.ts` review. Each entry records
language-specific facts worth remembering next time, so the next review starts
smarter instead of rediscovering the same thing.

---

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
    (current detector is import-only); no pinned Kotlin corpus besides
    Exposed for future measurements.

*(existing entries retained below)*

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
