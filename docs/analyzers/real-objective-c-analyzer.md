# real-objective-c-analyzer.md

## Language

- Analyzer file: `src/ast/real-objective-c-analyzer.ts`
- Parser: `tree-sitter-objc` (pinned `wasm/tree-sitter-objc.wasm`; npm 3.0.2
  verified behaviorally identical on the corpus — 0 vs 0 grammar errors — so
  no upgrade was warranted; `translation_unit` → `class_interface`/
  `class_implementation`/`protocol_declaration`/`method_declaration`/
  `method_definition`/`property_declaration`/`instance_variable`/
  `function_definition`/`declaration`/`message_expression`/`call_expression`/
  `preproc_include` tree; `message_expression` → receiver + selector +
  arguments; `class_interface` → class name + superclass + protocol list +
  members)
- Language detection: `.m`/`.mm` → `objective-c`; `.h` headers disambiguated
  by content markers (`@interface`/`@protocol`/`@implementation` → ObjC,
  C++ markers → cpp, else C) in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealObjectiveCAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | class/interface name = first identifier of `class_interface`/`class_implementation`/`category_*`; protocol name = identifier of `protocol_declaration`; method name = first `selector`/`identifier` child; property/ivar name = deepest identifier of the `struct_declaration → struct_declarator → (pointer/reference) → identifier` chain (never the type position); C function name = `function_declarator` identifier; file-scope variable name = `init_declarator` identifier |
| kind | ✅ | `@protocol` → `interface`; `@interface`/`@implementation` (plain class) → `class`; `@interface X (Cat)`/`@implementation X (Cat)` → `extension` (symbol name = CLASS name, never the category label — detected by the anonymous `(` token, exact not heuristic); methods → `method`; `@property`/ivars → `property` (ivars carry `isInstanceVariable`); C functions → `function`; file-scope statics → `variable` |
| class vs instance method | ✅ | `isClassMethod` from the anonymous `+`/`-` token child of the method node (pure AST — the grammar emits `method_declaration [-:"-"] [;:";"]`) |
| qualified/container name | ✅ | `ownerName` = enclosing class/protocol/extension for methods/properties/ivars |
| range (start/end line + column) | ✅ | the declaration/definition node |
| parameters | — | extracted from `method_parameter`/`method_type` structure available but not stored on symbols (ObjC selectors are fragmented by design) |
| returnType / type | — | available in `method_type`/`type_name` but not stored on symbols |
| documentation/comments | — | n/a (ObjC comments not extracted as doc) |
| complexity metrics | ✅ | `complexity` = symbol count; `linesOfCode` on file metadata |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `@property` attributes parsed but not surfaced per-symbol |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: class/protocol/extension → member (post-loop over `ownerName`). Never `global contains X`. | 1.0 |
| references | ✅ | import/include dependencies (`root → module` from `preproc_include` with `system_lib_string`/`string_literal` → `string_content` children, line number from the node position) | 1.0 |
| calls | ✅ | message expressions — source = enclosing METHOD name, target = the SELECTOR: the first identifier child AFTER the receiver (never the receiver itself: `[NSString stringWithFormat:]` → `stringWithFormat`, `[super init]` → `init`, `[message uppercaseString]` → `uppercaseString`); C function calls (`call_expression` → identifier) | 1.0 |
| instantiates | ✅ | `[[Foo alloc] init]` / `[Foo new]` → target = the class receiver (the identifier receiver of the alloc/new message, incl. nested `[[Foo alloc] init]` where the inner message receiver is the class) | 0.9 |
| extends | ✅ | `@interface Foo : Bar` → `Foo extends Bar`; `@protocol P <Q>` → `P extends Q` | 1.0 |
| implements | ✅ | `@interface Foo : Bar <P1, P2>` → `Foo implements P1/P2` (protocol list via `parameterized_arguments`/`protocol_*` children) | 1.0 |
| imports | ✅ | `preproc_include` → module name (pure-String unwrap of `system_lib_string` angle brackets / `string_content`) + framework detection (UIKit/Foundation/AppKit/Cocoa) | 1.0 |
| exports | ✅ | all symbols exported with `visibility: "public"` | — |
| overrides | — | n/a (ObjC message dispatch is dynamic; no override contract) | — |

**Relationship source identity:** message/call sources are the enclosing
METHOD/function name — never the receiver and never a block scope. File-scope
relationships use `root`. The dedup key includes the relationship TYPE
(`type|source→target`) so `calls` and `instantiates` for the same pair (e.g.
`[[Foo alloc] init]` inside one method) never collapse.

## Supported constructs

- Protocols: `@protocol Name <Adopted>` → interface symbol + extends edges to
  adopted protocols; methods → method symbols contained by the protocol
- Classes: `@interface Name : Super <P1, P2>` → class symbol + extends
  superclass + implements protocols; properties (`@property`), instance
  methods, class methods (`+`)
- Categories: `@interface Name (Label)` / `@implementation Name (Label)` →
  extension symbol named after the CLASS (the category label is metadata,
  never a symbol); members contained by the class
- Implementations: `@implementation Name { ivars }` → class symbol, ivars →
  property symbols (`isInstanceVariable`), method definitions → method symbols
- C functions: definitions AND prototypes → function symbols; file-scope
  static variables → variable symbols
- Imports: `#import`/`#include` with `<...>` or `"..."` → references edges +
  imports array with real line numbers
- Message sends: `[receiver selector:arg]` → calls selector (receiver is never
  the target); `[[Foo alloc] init]`/`[Foo new]` → instantiates Foo
- C function calls inside methods: `dispatch_once(...)` → calls
- Config headers (`.h` without class-declaration markers): routed to the
  shared C-family path (same as C++ `shape_config.h` precedent) — constants,
  enums + members, typedefs, static variables, function prototypes extracted
  by the C analyzer; the differential encodes exactly what the pipeline emits

## Noise rules (negative contract)

- Function-local variables (`NSString *prefix = ...` inside a method body) —
  NO symbol (execution artifacts)
- Blocks (`^{ ... }`) — NO symbol; block-parameter invocations emit the calls
  edge to the parameter name but no symbol is created for it
- `@selector(...)` expressions — NOT call targets
- Category labels (`(Formatting)`, `(UserError)`) — never symbols
- The receiver of a message is never a call target — only the selector
- `#define` include guards (`#ifndef X` + empty `#define X`) — no symbol
  (handled by the shared C-family path)
- `typedef NS_ENUM(NSInteger, X) {...}` — **genuine grammar gap**: the macro
  form produces ERROR nodes in the pinned grammar (NS_ENUM is a macro, not a
  keyword). Recorded honestly — see Limitations. The plain `typedef enum`
  form parses and extracts fully.

## Regex inventory

From `validation/m12/results/regex-census.json`: the Objective-C analyzer has
**0 regex usages** (the 2 baseline usages eliminated — the
`/#(?:import|include)\s+[<"]([^>"]+)[>"]/g` import-extraction regex replaced
by pure-AST `preproc_include` walking, and the `/["<>]/g` strip replaced by
pure-String slicing of the `system_lib_string` text — census 97 → 95 total
across all analyzers).

## Complexity envelope

Measured via `bun script/m12/measure-analyzer.ts objective-c <corpusDir>`
(`validation/m12/results/objective-c-complexity.json`):

- Fixtures: 4 files, 34 symbols, 39 relationships — 310 ms wall, 110 syms/s,
  126 rels/s, peak RSS 250 MB
- Corpus (entire Clyde@8fec41dd ObjC inventory, 7 files): 100 symbols, 333
  relationships — 208 ms wall, 480 syms/s, 1599 rels/s, peak RSS 317 MB

The analyzer is a single-pass iterative-stack walk (O(N) nodes) with O(1) map
deduplication for symbols and relationships — no O(n²) or per-symbol O(n)
scans. Imports are extracted during the same walk; no second pass over source.

## Corpus validation

`script/m12/objc-corpus-errors.ts` scans the entire pinned corpus
(Clyde@8fec41dd, `git ls-files '*.m' '*.h'`, 7 files):

- **7/7 parse clean — 0 grammar errors, 0 crashes, 0 timeouts**
- npm tree-sitter-objc 3.0.2 wasm verified identical (0 vs 0 errors, 0
  fixes, 0 regressions) — no grammar upgrade warranted
- Shape-safety: all 32 analyzer node-type references exist in the grammar
  except 8 dead defensive alternatives the grammar never emits
  (`category_interface`/`category_implementation` — the grammar emits
  `class_interface` with a `(` token; `protocol_list`/`protocol_qualifiers` —
  emits `parameterized_arguments`; `superclass_reference`/`selector`/
  `block_expression`/`property_identifier` — alternatives to
  `identifier`/`block_literal`/`struct_declarator`), same category as the
  C/C++/Rust pre-existing dead refs

## Limitations (honest gaps)

- `typedef NS_ENUM(NSInteger, X) {...}` / `NS_OPTIONS` macro forms: the
  pinned grammar emits ERROR nodes (NS_ENUM is a macro, not a keyword). The
  plain `typedef enum {...}` form extracts fully. Recorded in the manifest
  note; no upstream grammar parses these today.
- Cross-file type resolution (e.g. `UserService` declared in UserService.h
  used in UserService.m) is per-file by design in the differential — the
  production companion-index wiring is tracked separately (same note as
  Java/C/C++/Rust).
- Multi-part selectors (`setValue:forKey:`) surface the first selector
  identifier as the method/call name (matching the M11 contract which uses
  the first logical selector).

## Evidence

- Fixtures: `validation/m12/fixtures/objective-c/` (UserService.h,
  UserService.m, user_config.h, Negative.m)
- Ground truth: `validation/m12/ground-truth/objective-c.json` (73 facts:
  34 symbols + 39 relationships)
- Differential: `validation/m12/results/objective-c-differential.json` —
  **1.000/1.000 precision/recall, 0 FP, 0 FN, 0 unknown** on first run
- Corpus: 7/7 files clean, 100 symbols / 333 relationships measured
- M11 gate: `validation/m11/probe-systems.ts` — 1.000/1.000 (Logger.h/.m
  symbols intact, no regression)
