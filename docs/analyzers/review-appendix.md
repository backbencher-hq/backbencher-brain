# Analyzer Review — Per-Language Gotchas Appendix

Appended after each `real-{{LANGUAGE}}-analyzer.ts` review. Each entry records
language-specific facts worth remembering next time, so the next review starts
smarter instead of rediscovering the same thing.

---

- **Kotlin**: confirm whether the pinned WASM actually serializes named grammar
  fields (`childForFieldName`) before relying on them without a fallback — this
  project's pinned build has been found to expose fields inconsistently with
  current upstream `grammar.js`.
- **Groovy**: this project uses a patched fork of `amaanq/tree-sitter-groovy`
  (see `grammars/tree-sitter-groovy/`) — diff against the upstream base to see
  what's inherited vs. custom before assuming grammar.js on GitHub reflects the
  pinned parser.
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
