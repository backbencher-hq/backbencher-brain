# real-cpp-analyzer.md

## Language

- Analyzer file: `src/ast/real-cpp-analyzer.ts`
- Parser: `tree-sitter-cpp` **0.23.4** (npm, latest — upgraded from the
  previously pinned grammar in this milestone; `translation_unit` →
  `namespace_definition`/`class_specifier`/`struct_specifier`/
  `enum_specifier`/`template_declaration`/`function_definition`/
  `field_declaration`/`declaration`/`alias_declaration`/`preproc_include` tree;
  `class_specifier` → `type_identifier` + `class_body`; `function_definition`
  → `declarator` (→ `qualified_identifier` with `namespace_identifier`/
  `type_identifier`/`template_type` scope chain) + `compound_statement`;
  `call_expression` → `function` (→ `field_expression`/`qualified_identifier`/
  `template_function`) + `arguments`)
- Language detection: `.cpp`/`.cc`/`.cxx`/`.hpp`/`.hxx` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCppAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) | 
| --- | --- | --- |
| name | ✅ | namespace `namespace_identifier`; class/struct/union `type_identifier`; function/method declarator identifier (last named child of `qualified_identifier` for out-of-line `Class::method`); constructor normalized to `constructor`; member `field_identifier`/`identifier`; `using` alias `name` field; macro name; enumerator identifier |
| kind | ✅ | namespaces → `namespace`; classes/structs with bodies → `class`; `enum class` → `enum` (members → `enum_member`); methods (declarations + out-of-line definitions, incl. template `Registry<T>::add`) → `method`; constructors → `constructor`; members → `property`; `using X = ...` aliases → `type`; object-like macros with value bodies → `constant`; file-scope static vars → `variable` (private, internal linkage) |
| qualified/container name | ✅ | `ownerName` = enclosing namespace/class via scope stack (out-of-line definitions use the explicit `Class::` scope; template `Registry<T>::add` resolves through the `template_type` scope node); visibility from access specifiers (`public:`/`private:`/`protected:`) |
| range (start/end line + column) | ✅ | the declaration/definition node |
| parameters | ✅ | function declarator `parameter_list` → name/type pairs on method/function symbols |
| returnType | ✅ | return type from the declarator's type node (`node.childForFieldName("type")`) |
| documentation/comments | — | n/a (C++ comments not extracted as doc) |
| complexity metrics | ✅ | memory-safety score (smart pointers `std::make_unique`/`std::make_shared` boost, raw `new`/`delete` penalize); patterns (`auto`, `lambda`, `constexpr`, RAII, smart pointers); framework detection (Qt/STL/Win32) from `#include` patterns — pure-String scans |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `virtual`/`override`/`const`/`constexpr`/`static` modifiers on method/field symbols; `isPureVirtual`/`isAbstract` flags; `isTemplate` |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: namespace→class/enum/alias, class→method/property/constructor, enum→member (post-loop over `ownerName`). Never `global contains X` — top-level symbols emit no contains. | 1.0 |
| references | ✅ | include dependencies (`global → header` from `#include <...>` / `#include "..."`, pure-String `stripIncludeChars` unwrap) | 1.0 |
| uses | ✅ | non-call field access only (`a.b` / `ptr->field` → `uses field`) — never paired with `references` (Java-family contract). Field expressions that are the function of a call (`obj.method()`) skip the uses walk — the `calls` edge is the fact. | 0.9 |
| calls | ✅ | `call_expression` → callee name (member-function calls `users_.push_back(...)`, qualified `std::sort(...)`, `template_function`); source = enclosing method/function; constructor-style stack construction (`User(-1, "unknown")`) → `calls User` (constructor invocation, documented) | 1.0 |
| instantiates | ✅ | `new_expression` → allocated type (`new Foo()` → `instantiates Foo`) | 0.9 |
| extends | ✅ | `base_class_clause` → base type name (access-specifier keyword stripped via pure-String `stripAccessSpecifier`); `Circle extends Shape` | 1.0 |
| imports | ✅ | `#include` → module name; `using_declaration` → imported name | 1.0 |
| exports | ✅ | public non-static file-scope symbols and class members | — |
| overrides / implements | — | override/implements detection tracks base-class virtuals in-memory; fixtures verify the symbol contract only (see Unsupported) | — |

**One edge per pair:** a callee emits exactly one of `calls`/`uses`/`references`
for any (source, target) pair — the legacy C++ analyzer emitted
`calls`+`uses`+`references` triples for every member call; the audit fixed
this to the Java M12.01 ontology.

## Supported constructs

- Namespaces: `namespace geometry { ... }` → namespace symbol; contains edges
  for every direct member (Shape.h: `geometry contains ShapeKind`, `Shape`,
  `Circle`, `Registry`, `Drawing`, `Point`)
- Classes/structs with bodies → class symbols; forward declarations
  (`class ForwardOnly;` — no `class_body`) produce NO symbol and NO scope push
  (C negative contract); destructors (`~Shape`) are compiler-managed and
  excluded
- `enum class` → enum symbol with enum_member children (`ShapeKind contains
  CIRCLE/RECTANGLE/TRIANGLE`)
- Inheritance: `class Circle : public Shape` → `extends Circle -> Shape`
  (access-specifier keyword stripped with pure-String `stripAccessSpecifier`)
- Template classes + out-of-line template method definitions:
  `template <typename T> class Registry` → class; `Registry<T>::add` → method
  owned by `Registry` (the `template_type` scope node resolves the owner —
  previously leaked to the namespace as a bare function)
- `using` aliases: `using Point = std::pair<double, double>;` →
  `alias_declaration` → type symbol (the modern C++ typedef)
- Out-of-line definitions: `Circle::Circle(double r) : radius_(r) {}`,
  `double Circle::area() const { ... }` → method symbols owned by the
  qualified class
- Member fields: `double radius_;` → property symbol with access-specifier
  visibility (`private:` section → private)
- Object-like macros with value bodies → constant (`MAX_SHAPES`, `SCALE_MIN`);
  include guards (`#define SHAPE_H` with no value) → NO symbol
- File-scope `static` variables → private variable (internal linkage),
  matching the C family contract
- Function-local variables (`double local = ...`), literals (`0.0`), and
  template parameters → NO symbols, NO edges (negative fixture)

## Unsupported / explicit-unknown constructs

- The 124 corpus `grammarErrorFiles` are genuine hard-system C++ that the
  newest available tree-sitter-cpp grammar (0.23.4) cannot parse — all valid
  C++, recorded honestly in the manifest (precedent: C 122, kotlin 51,
  fsharp 108, typescript 5): compiler attribute macros wrapping return types
  (`SANITIZER_WEAK_ATTRIBUTE`, `USED`, `NOEXCEPT`, `_THROW_BAD_ALLOC`),
  `PRIu64`/`PRIx64`/`PRIxPTR` printf format macros from inttypes.h, libtsan's
  internal typedefs (`uptr`, `a8`–`a128`) — the corpus's vendored LLVM
  runtimes (libc++/libtsan/libcxxabi/libunwind) are the most battle-tested
  C++ in existence but exercise grammar-edge syntax
- Override/implements relationships: the analyzer tracks base-class virtuals
  for Implements/Overrides edges, but the M12.17 fixture contract verifies
  the symbol + core relationship ontology (contains/references/uses/calls/
  extends); override-target resolution is exercised by the Java/C#/Kotlin
  milestones
- Cross-file resolution (`Shape` declared in Shape.h, used in Shape.cpp) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring of the cross-file context tracked by
  M12.44, same as Java/C)

## Regex inventory

From `validation/m12/results/regex-census.json`: the C++ analyzer has **0
regex usages** (the 3 baseline regexes eliminated — census 102 → 99 total
across all analyzers). Replaced with pure-String scans:
`stripIncludeChars` (filters `<`, `>`, `"`, `'` from the include-path node
text) and `stripAccessSpecifier` (leading `public`/`protected`/`private`
keyword strip from base-class node text), plus existing `stringIncludes`.

## Complexity envelope

From `validation/m12/results/cpp-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 40 | 47 | 203.4 | 197 | 231 | 229.8 MB |
| corpus_subset | 195 | 9765 | 31909 | 5222.8 | 1870 | 6110 | 488.8 MB |

Declared budgets: fixtures < 2 s (met: 0.20 s); 195-file corpus < 60 s
(met: 5.2 s).

Hot-path audit: single-pass DFS stack over AST children (O(nodes)); per-node
lookups use bounded child scans (`findChild`/`hasDirectModifier` iterate a
node's direct children only); relationship source resolution is the current
scope-stack top (O(1)); the contains post-loop is one pass over the symbol
list. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/cpp.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the M11 C++ contract (M11.10, symbols-only 1.000/1.000) extended with the
  Java-family relationship ontology; 87 facts: 40 symbols (17 method,
  4 constructor, 4 class, 3 property, 3 namespace, 3 enum_member, 2 constant,
  1 function, 1 variable, 1 enum, 1 type) + 47 relationships (35 contains,
  7 references, 4 calls, 1 extends))
- Result: `validation/m12/results/cpp-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0` — verified both before and
  after the grammar upgrade (node shapes unchanged for the contract)

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `zig@738d2be9`
  (clean; 218 tracked `.cpp`/`.hpp` files — vendored LLVM runtimes libc++/
  libtsan/libcxxabi/libunwind + zig's own tooling C++ (`zig_llvm.cpp`,
  `zig_clang_driver.cpp`): real language-representative C++ including the
  most battle-tested system C++ in existence)
- Sample: 195 tracked `.cpp` files (deterministic all-tracked slice ≥ 1KB,
  reproducible from `git ls-files`)
- Symbols 9765 / relationships 31909 / wall 5.2 s / **0 crashes / 0 timeouts
  / 124 error files** (63.6%) — down from 136/195 (69.7%) with the previous
  grammar; all 124 are genuine hard-system C++ gaps of the newest available
  grammar (see Unsupported). Scan script `script/m12/cpp-corpus-errors.ts`
- Grammar swap verified: 12 libtsan/zig-tooling files fixed, 0 regressions,
  node-types superset (+19 types incl. `pure_virtual_clause`, −4 internal
  `_`-types + `alignas_specifier`, all analyzer-referenced shapes present —
  `base_class` is dead in both grammars, referenced only in a defensive
  condition); differential unchanged at 1.000/1.000

## M14 external validation (2026-08-28, #260 / #419)

- **Differential corpus (issue-pinned): `fmtlib/fmt`** — 47 C++ files sampled
  (seeded 60/language, deterministic), 145 tree-truth edges, **145/145 covered
  (100%), 0 missing, 0 unexplained**, 113.6 ms/file. Floor recorded in
  `validation/m14/differential-baseline.json` (`fmt:cpp`), enforced by
  `audit:differential`; evidence `validation/m14/results/M14.0.F5.json`.
  Defects this exposed and fixed:
  - **Self-override fabrication**: `class format_facet : public
    fmt::format_facet<std::locale>` leaf-cleans the cross-file base to
    `format_facet`, identical to the class's own name, so the post-loop
    override resolver fabricated `format_facet.do_put -> format_facet.do_put`.
    A class cannot inherit from itself — such bases are now skipped.
  - **Oracle LIFO name extraction**: the second-opinion oracle popped the
    declarator subtree in LIFO order and grabbed *parameter* identifiers
    (`Send(const std::string& message)` -> `message`, `skip_count`, and
    constructor `matcher`), fabricating override truth; fixed to read only the
    `declarator` field and require `field_identifier` (macro bodies like
    `GTEST_DISALLOW_COPY_AND_ASSIGN_` parse as bare `identifier`).
- **Completeness contract (#419)**: all **256** tree-sitter-cpp public named
  node types classified A–H 8/8 (`script/m14/spec/cpp-completeness.json`);
  rulings CPP-D1/D2/D3: GNU asm + `extension_expression` parsed not modeled;
  MSVC SEH/declspec/based/call/pointer modifiers parsed not modeled;
  cross-file resolution + template instantiation across TUs are per-file by
  contract. Fixture pins calls, instantiates, references, imports,
  include_dependency, overrides, uses (`system-completeness`).
- **Mutation hardening**: 3 C++-specific mutants (drop-virtual-overrides,
  drop-extends-edges, drop-qualified-calls) all caught; suite 115/115.
- **Include metadata**: C++ include edges now carry the family contract
  `relationshipType: "include_dependency"` + `isImport` (previously only
  `isIncludeDependency`), matching the C analyzer.
- **Heuristic honesty**: sub-1.0 edges carry machine-readable reason codes
  (`relationshipType: "field_access"` on uses; `reasonCode:
  "signature-match"` on overrides). Heuristic ratio reported per corpus repo
  in the F5 report; fmt:cpp heuristic = 0.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/cpp/`
- Ground truth: `validation/m12/ground-truth/cpp.json`
- Differential: `validation/m12/results/cpp-differential.json`
- Complexity: `validation/m12/results/cpp-complexity.json`
- Corpus scan: `script/m12/cpp-corpus-errors.ts`
- Grammar compare: `script/m12/cpp-wasm-compare.ts` / `script/m12/cpp-node-types-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.17 (GitHub issue #156).
