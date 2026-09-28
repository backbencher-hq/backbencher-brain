# real-c-analyzer.md

## Language

- Analyzer file: `src/ast/real-c-analyzer.ts`
- Parser: `tree-sitter-c` **0.24.1** (npm, latest — upgraded from the
  previously pinned grammar in this milestone; `translation_unit` →
  `function_definition`/`declaration`/`type_definition`/`struct_specifier`/
  `union_specifier`/`enum_specifier`/`preproc_def`/`preproc_function_def`/
  `preproc_include` tree; `struct_specifier` → `name` field + `body` →
  `field_declaration`; `function_definition` → `declarator` +
  `body`; `call_expression` → `function` + `arguments`)
- Language detection: `.c`/`.h` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | function declarator identifier; struct/union/enum name field; typedef declarator identifier (anonymous structs/enums named by their typedef alias — ONE symbol); macro name; file-scope variable identifier |
| kind | ✅ | function definitions + prototypes → `function`; structs with bodies → `struct` (fields → `property` with `ownerName`); unions with bodies → `type` (fields → `property`); enums → `enum` (members → `enum_member`); typedefs (function pointers, aliases) → `type` when the alias differs from the specifier name; object-like macros with value bodies → `constant`, function-like macros → `macro`; file-scope static vars → `variable` (private) |
| qualified/container name | ✅ | `ownerName` = enclosing struct/union/enum name for fields/members; `scope` = nearest enclosing scope (struct/union/function) |
| range (start/end line + column) | ✅ | the declaration/definition node; `recoverFunctionRange` for functions whose body contains ERROR nodes |
| parameters | ✅ | function declarator `parameter_list` → name/type pairs (skip `...`), stored on function symbols |
| returnType / type | ✅ | return type from `function_declarator` type field; field/param types from their type nodes |
| documentation/comments | — | n/a (C comments not extracted as doc) |
| complexity metrics | ✅ | cyclomatic complexity (if/for/while/do/case/ternary/`&&`/`||`/goto/labels); per-function metadata: `usesMalloc`, security flags |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `static`/`inline`/`extern` storage-class metadata on functions/variables |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: struct→field, union→field, enum→member (post-loop over `ownerName`). Never `global contains X` — top-level symbols carry the synthetic `global` scope but emit no contains (dangling edge, Java-family ontology). | 1.0 |
| references | ✅ | include dependencies (`global → header` from `#include`); type usage — in-file declared type identifiers (`type_identifier`, `struct_specifier`/`union_specifier`/`enum_specifier` references, incl. bare return types). Never both references+uses for the same pair. | 0.8 (type) / 1.0 (include) |
| uses | ✅ | field access (`a->x` → `uses x`); value identifier usage (global var, enum member, local function reference) — never both uses+references for the same pair; call-target identifiers skip the uses walk (the `calls` edge is the fact). | 0.9–1.0 |
| calls | ✅ | `call_expression` → callee name (incl. field-expression function pointers); source = enclosing function name via `getRelationshipSource()` | 1.0 |
| instantiates | ✅ | allocator calls (`malloc`/`calloc`/`realloc`/`kmalloc`/`vmalloc` emit a `calls` + `instantiates` pair intentionally — call-graph fact + allocation semantic, documented) | 0.9 |
| imports | ✅ | `#include <path>` / `#include "path"` → module name (pure-String `stripIncludeChars` unwrap of the `path` field / `string_literal` / `system_lib_string`) | 1.0 |
| exports | ✅ | public (non-static) function/variable symbols; Linux `EXPORT_SYMBOL*` → `X exports KERNEL_EXPORT` | — |
| extends / overrides | — | n/a (C has no class heritage) | — |

**Relationship source identity:** `getRelationshipSource()` returns the
enclosing FUNCTION name — never the block scope (`core_init.block_211` would
be a dangling identity that never resolves to a symbol). File-scope
relationships use `global`.

## Supported constructs

- Functions: definitions AND prototypes → function symbols with parameters,
  return type, and `static`/`inline` visibility (Module.h: `module_init`,
  `buffer_create`, `point_distance` prototypes + Module.c definitions —
  definition-site identity by name)
- Structs/unions with bodies → struct/type symbols; fields → property symbols
  with `ownerName` (Module.h: `struct Point { int x; int y; }` → `Point`
  contains `x`/`y`; `Buffer`/`Value` anonymous typedef'd struct/union named by
  their typedef alias — ONE symbol each, not two)
- Enums → enum symbols with enum_member children (`typedef enum { STATUS_OK,
  STATUS_ERROR, STATUS_TIMEOUT } Status` → `Status` contains `STATUS_OK` etc.)
- Typedefs → type symbols (`typedef int (*CompareFn)(...)` function-pointer
  alias → type; `typedef struct Point Point2D;` — the alias differs from the
  specifier name → type symbol)
- Macros → `#define MAX_BUFFER 256` → constant; `#define MIN(a, b) ...`
  function-like → macro
- File-scope globals: `static int initialized` → private variable symbol
- Enum member usage resolves as use targets: `module_init uses STATUS_OK`
  (Java `Status uses ACTIVE` pattern, M12.01 ontology)
- Forward declarations (`struct ForwardOnly;`, `typedef struct Point Point;`)
  produce NO symbol and NO scope leak — a declared-type pre-pass makes
  type-identifier resolution order-independent (typedef-before-definition
  resolves; never-defined forward decls emit no dangling edge)
- Include guards (`#ifndef NEGATIVE_H` / `#define NEGATIVE_H` with no value
  body) → NO symbol
- `malloc`/`free` → `calls` + `instantiates`/`uses` allocation tracking
- Framework detection from `#include` patterns (POSIX/Win32/Linux kernel/
  embedded) — pure-String scans, no regex
- Negative fixture (Negative.c): function-local variables → NO symbols;
  `NULL`/`0`/`true`/`false` literals → no use edges; anonymous typedef'd
  structs/enums → ONE symbol named by the typedef; forward decls → no symbols
  or self-references; unused includes still resolve as include dependencies

## Unsupported / explicit-unknown constructs

- The external 400-file corpus probe recorded 122 files with Tree-sitter
  `ERROR` nodes (0 crashes, 0 timeouts). These are compiler/platform-specific
  parse-recovery cases, including GNU attributes, conditional preprocessing,
  and libc/compiler intrinsics; they remain explicit limitations rather than
  being silently treated as fully parsed C.
- Cross-file resolution (`Buffer` declared in Module.h used in Module.c) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring of the cross-file context tracked by
  M12.44, same as Java M12.01)

## Regex inventory

From `validation/m12/results/regex-census.json`: the C analyzer has **0 regex
usages** (the 2 baseline `/[<>"']/g` include-path strip regexes eliminated —
census 104 → 102 total across all analyzers). Replaced with a pure-String
scan `stripIncludeChars` (filters `<`, `>`, `"`, `'` characters from the
include-path node text) plus existing pure-String helpers `stringIncludes`/
`inArray`.

## Complexity envelope

From `validation/m12/results/c-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 46 | 49 | 573.5 | 80 | 85 | 192.3 MB |
| corpus_subset | 400 | 3692 | 14593 | 58278.9 | 63 | 250 | 952.6 MB |

Declared budgets: fixtures < 2 s (met: 0.48 s); 400-file corpus < 120 s
(met: 6.5 s, attributed re-measure below).

**#909 — the two rows above are historical, and neither was attributable.** The
2026-09-19 `corpus_subset` run recorded `corpusDir: "/tmp/c-corpus-copy"`, a temp path
that no longer exists, with no manifest, no size distribution and no machine-load
context — so 58.3 s describes an unknown file set on an unknown box and cannot be
compared against any other number (this page's own "met: 58.3 s" and the audit's
"~10x inflated" reading both compared it against different sets; see `#909`).

The harness now records what a run measured, and the attributed re-measure at HEAD is:

| Run | files | avg size | set digest | wall | user CPU | per file | peak RSS | load1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | — | — | 481 ms | 0.40 s | 100 ms | 241.8 MB | 3.98 |
| corpus_subset | 400 | 5,032 B | `07cb4b7f997b820c` | 6.5 s | 10.8 s | 16.3 ms wall / 26.9 ms CPU | 307.6 MB | 3.90 |

Command: `bun script/m12/measure-analyzer.ts c $HOME/fixtures/repositories/zig
--ext=.c --min-bytes=1024 --limit=400`. On this shared box wall time is the unstable
half of the pair (the same rule measured 6.5 s, 11.5 s and 86.1 s minutes apart while
other agents' load moved), so **compare `userCpuMsPerFile` or the per-1k-node ratio** —
C runs 25.9 ms/1k nodes vs cpp's 23.8 in the same 8-40 KB band (1.09x). Without
`--ext`, the walker measures EVERY file in the directory under the language's name,
which is how a "c" number can silently describe other languages.

Hot-path audit: single-pass DFS stack over AST children with a pre-pass over
the same stack for declared-type collection (both O(nodes)); per-node lookups
use pre-allocated constant arrays; relationship source resolution is O(depth)
via the scope-manager stack (`getRelationshipSource` walks at most the
function/struct nesting depth, never the symbol list). No O(n²) or per-symbol
O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/c.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the M11 C contract (M11.10, symbols-only 1.000/1.000) extended with the
  Java-family relationship ontology; 92 facts: 46 symbols (17 function,
  10 property, 6 enum_member, 3 struct, 3 type, 2 variable, 2 constant,
  2 enum, 1 macro) + 46 relationships (17 uses, 16 contains, 8 references,
  4 calls, 1 instantiates))
- Result: `validation/m12/results/c-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0` — verified both before and
  after the grammar upgrade (node shapes unchanged for the contract)

## Corpus validation

- External validation: pinned `jq` (45 C files) and `sqlite` (60 C files)
  achieved 100% tree-truth coverage with no missing edges; SQLite retained two
  documented opaque indirect-call residuals. Both floors are enforced in
  `validation/m14/differential-baseline.json` (`jq:c` 0/0, `sqlite:c` 0 missing
  / 2 unexplained) so any regression in either corpus fails `audit:differential`.
  `fmt`'s single C file (16/16, 0/0) is pinned as `fmt:c`. The broader
  historical 400-file probe had 122 parse-recovery files, 0 crashes, and
  0 timeouts. `Clyde` had no `.c` files and was not counted as C evidence.
- Symbols 3692 / relationships 14593 / wall 58.3 s (historical, unattributable — see
  `#909` above) / **0 crashes / 0 timeouts
  / 122 error files** (30.5%) — down from 139/400 (34.8%) with the previous
  grammar; all 122 are genuine hard-system C gaps of the newest available
  grammar (see Unsupported). Scan script `script/m12/c-corpus-errors.ts`
- Grammar swap verified: 17 mingw files fixed, 0 regressions, node-types
  superset (+15 `_`-internal types, −3 internal, all analyzer-referenced
  shapes present — `asm_expression` is dead in both grammars, `gnu_asm_expression`
  present in both); differential unchanged at 1.000/1.000

## Evidence pointers

- Fixtures: `validation/m12/fixtures/c/`
- Ground truth: `validation/m12/ground-truth/c.json`
- Differential: `validation/m12/results/c-differential.json`
- Complexity: `validation/m12/results/c-complexity.json`
- Corpus scan: `script/m12/c-corpus-errors.ts`
- Grammar compare: `script/m12/c-wasm-compare.ts` / `script/m12/c-node-types-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.16 (GitHub issue #155).
