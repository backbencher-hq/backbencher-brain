# real-objective-c-analyzer.md

## Language

- Analyzer file: `src/ast/real-objective-c-analyzer.ts`
- Parser: `tree-sitter-objc` — **vendored and patched** in `grammars/tree-sitter-objc/`
  (upstream npm 3.0.2 plus the M60 `macro_prefixed_objc_declaration` rule), built to
  `wasm/tree-sitter-objc.wasm` with `tree-sitter build --wasm` (CLI 0.26.9, bundled
  WASI — no emcc, no network). It inherits **upstream** `tree-sitter-c` 0.24.1, not
  this repo's patched copy: generating against the latter fails outright
  (`Unresolved conflict: '^' identifier identifier • '<'`, objc's `generic_specifier`
  vs the C rule's `identifier type_specifier`). See
  `reviews/m60-743-objc-grammar-macro-specifier.md`; `translation_unit` →
  `class_interface`/
  `class_implementation`/`protocol_declaration`/`method_declaration`/
  `method_definition`/`property_declaration`/`instance_variable`/
  `function_definition`/`declaration`/`message_expression`/`call_expression`/
  `preproc_include` tree; `message_expression` → receiver + selector +
  arguments; `class_interface` → class name + superclass + protocol list +
  members)
- **The M60 rule's own two node types are classified in the census spec.**
  `macro_prefixed_objc_declaration` and its `macro_specifier` child are listed under
  `internal_silent` in `script/m14/spec/objc-completeness.json`, because the corpus
  census (60 sdwebimage files, repo pin `c3ad5e1a9bf5`) sees exactly one occurrence of
  each and the wrapper is traversal-transparent — measured rather than assumed:
  indexing the one file that carries them (`SDWebImage/include/SDWebImage/SDAnimatedImage.h`,
  the macro on 71 above the `@interface` on 72) publishes `class SDAnimatedImage` at
  72-136 with its members and publishes NO symbol for the macro name itself, so the
  analyzer never has to name either node type and nothing is lost by it not doing so.
- Language detection: `.m`/`.mm` → `objective-c`; `.h` headers disambiguated
  by content markers (`@interface`/`@protocol`/`@implementation` → ObjC,
  C++ markers → cpp, else C) in `language-detection.ts`
- **Sampling universe: the ROUTER's, not an extension list.** The lane reads `.m`
  plus the headers `language-detection.ts` hands to objective-c (`ext: "m,h"` behind a
  content guard in `script/m14/differential.ts`). Before the M60 wave it was `"m"`, so
  **169 headers production already analysed were outside every number this lane had
  ever reported** — 52% of the language's files on the two pinned corpora.
- Wired in: `engine.ts getAnalyzer` → `RealObjectiveCAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | class/interface name = first identifier of `class_interface`/`class_implementation`/`category_*`; protocol name = identifier of `protocol_declaration`; method name = the FULL SELECTOR (`saveUser:`, `setValue:forKey:`) — OBJCD7, the method's identity in ObjC: keyword identifiers alternate with `method_parameter` nodes at the method node's top level and a keyword takes ':' when the next sibling is a parameter (leaf naming merged DISTINCT overloads — `initWithNamespace` / `initWithNamespace:diskCacheDirectory:` / `initWithNamespace:diskCacheDirectory:config:`, measured 225 colliding occurrences across 35 corpus owners); property/ivar name = deepest identifier of the `struct_declaration → struct_declarator → (pointer/reference) → identifier` chain (never the type position); C function name = `function_declarator` identifier; file-scope variable name = `init_declarator` identifier |
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

### A declaration and its implementation are TWO symbols — a NAME is not an IDENTITY

`@interface A` and `@implementation A`, and the method declared in the first and
implemented in the second, publish **two symbols per unit** — `A.h:4(method)` and
`A.m:4(method)`, both named `refTargetObjc:` (the full selector), each owned by its own
file's class symbol. Measured on the fixture shape this lane is gated with (`A.h`
declares `+ (int)refTargetObjc:(int)x;`, `A.m` implements it, `B.m` sends
`[A refTargetObjc:1]`): **2 symbols** under the selector, and a message send from ANOTHER
file binds to the **declaration** (`A.h`) in **6 of 6** fresh indexes — deterministically,
not by luck.

The duplication is the FLEET's shape, not this lane's quirk. The same measurement gives
**c** 2 symbols (`a.h` declares, `a.c` defines) binding to the **definition** (`a.c`, 6/6),
**cpp** 2 (`a.hpp` declares, `a.cpp` defines) binding to the **definition** (`a.cpp`, 6/6),
while the single-file lanes publish one (**java** 1, **csharp** 1). The rule a consumer
has to follow:

> **A published name is not an identity.** Where a lane splits a declaration from its
definition, a name-based lookup can match more than one symbol, and *which* sibling an
edge lands on is the LANE's declared preference — the **definition** for c and cpp, the
**declaration** for objective-c — never a uniqueness assumption. Consumers must scope by
name and report the multiplicity.
>
> This is not hypothetical: `script/m65/verify-refresh-resolution.ts` asked
`WHERE name = ? LIMIT 1` (no `ORDER BY`), got the `A.m` sibling in 5 of 8 indexes, and
reported this lane as having *"lost its reach"* while the call had bound cross-file in
8 of 8. The gate now scopes the reach predicate by name and publishes
`symbolsWithTargetName` and `boundSiblingFiles`, so a future split is visible in the
sealed evidence instead of being averaged away.

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: class/protocol/extension → member (post-loop over `ownerName`). Never `global contains X`. | 1.0 |
| references | ✅ | import/include dependencies on the objc-native path (`root → module` from `preproc_include` with `system_lib_string`/`string_literal` → `string_content` children, line number from the node position). Config headers without class markers go through the shared C-family path, which names its file-scope source `global` (c/cpp precedent: 7 such rows each) | 1.0 |
| uses | ✅ | value reads (OC-E): parameters in argument position, body locals incl. bare declarators, same-file ivars/properties, file globals, for-in variables, and bare receivers inside sends and C calls. Source = the enclosing METHOD. A call CALLEE is never also a read (the calls edge owns it, CGD17 parity), and neither is a DECLARATION name — including a block-pointer parameter's (`void (^handler)(NSString *)` publishes nothing at the declaration; the name binds, and its only edge is the call where it is invoked) | 0.9 |
| calls | ✅ | message expressions — source = enclosing METHOD name, target = the FULL SELECTOR: every keyword identifier that takes ':', never the receiver itself and never a first-keyword truncation that cannot name an overload: `[NSString stringWithFormat:]` → `stringWithFormat`, `[super init]` → `init`, `[message uppercaseString]` → `uppercaseString`); C function calls (`call_expression` → identifier); FIELD invocations (`call_expression` whose grammar `function` field is a `field_expression`, e.g. `self.downloadProgressBlock(x)` → the innermost FIELD name, `isFieldInvocation`). Three producers, three reason codes — message send `dynamic-dispatch-selector`, field callee `field-callee-kind-not-determined`, C callee `callee-not-resolved-in-unit` (only where this unit does not define the name) | 0.95 |
| instantiates | ✅ | `[[Foo alloc] init]` / `[Foo new]` → target = the class receiver (the identifier receiver of the alloc/new message, incl. nested `[[Foo alloc] init]` where the inner message receiver is the class). `self` resolves to the ENCLOSING CLASS and `super` to the same-file `extends` clause's superclass — the two receiver KEYS are never published as targets, and where the superclass is not in this translation unit the row is refused rather than named | 0.9 |
| extends | ✅ | `@interface Foo : Bar` → `Foo extends Bar`; `@protocol P <Q>` → `P extends Q` | 1.0 |
| implements | ✅ | `@interface Foo : Bar <P1, P2>` → `Foo implements P1/P2` (protocol list via `parameterized_arguments`/`protocol_*` children). **The adoption list is selected by POSITION, not by shape** — see OC-ONT-6 below | 1.0 |
| imports | ✅ | `preproc_include` → module name (pure-String unwrap of `system_lib_string` angle brackets / `string_content`) + framework detection (UIKit/Foundation/AppKit/Cocoa) | 1.0 |
| exports | ✅ | a file-scope declaration with EXTERNAL linkage (C99 6.2.2p5): `root → <name>` with `relationshipType: "module_export"`, `isExport`, `fileLevel`, `evidenceClass: "structural"`. A class, a protocol, a `typedef`, a function, a variable and a marker-bearing declaration (`FOUNDATION_EXPORT`, `extern` → `metadata.exportMarker`) all publish the same way. `static` is internal linkage and is NOT an export (its symbol keeps `visibility: "private"`); a member rides `contains`; a category label is never a unit (OC-B); an imported module is a dependency | 1.0 |
| overrides | ✅ | a subclass method whose FULL SELECTOR matches a superclass method's: verified (`verified-base-declared-in-file`, 0.95) when the superclass is declared in this file, otherwise a deterministic below-threshold first-parent guess (`first-parent-guess`, 0.5). `NSObject`/`NSProxy` are excluded as the universal root | 0.95 / 0.5 |

### Honesty §4.1: one reason code per family, and what each one says

The contract asks every relationship below confidence 1.0 to carry a machine-readable
reason code, and in this lane each FAMILY has its own word — a row below 1.0 with no code
was the pre-fix state (18,794 rows over the admitted universe: 8,077 `calls`, 9,307 `uses`,
902 `references`, 508 `instantiates`), and collapsing two families onto one word would call
two different doubts the same fact:

| producer | code | what is not determined |
|---|---|---|
| message send | `dynamic-dispatch-selector` | the selector is exact; which class implements it is decided at runtime |
| field-invoked callee | `field-callee-kind-not-determined` | the field is exact; whether it holds a block, a function pointer or (in a `.mm`) a C++ member is not |
| C call to a name this unit does not define | `callee-not-resolved-in-unit` | the identifier is exact; the callee is defined elsewhere and the grammar cannot tell a function from a macro |
| `uses` (bare or member read, incl. message arguments) | `value-read-by-scope-inference` | the read is exact; which binding the name denotes is inferred from scope |
| `instantiates` | `allocator-receiver-not-cross-file-checked` | the allocator receiver is exact; that it denotes an allocatable class is not checked across files |
| include (`references`) | `include-target-not-resolved` | the directive is exact; whether the header resolves in this repository is not (a system framework's never can) |
| clang module import (`references`) | `clang-module-name-not-resolved` | same, for `@import`/module spelling |
| `overrides` | `verified-base-declared-in-file` / `first-parent-guess` | verification, or a deterministic first-parent guess below the 0.7 floor |

A row at confidence 1.0 carries NO code: a code there would claim a doubt that does not
exist. `contains`/`extends`/`implements`/`exports`/`imports` are all 1.0 and all silent.

### OC-ONT-6: `<...>` is three different lists, separated by position

`@interface Cache <KeyType, ObjectType> : Store <KeyType, ObjectType> <CacheProtocol>`
carries three `parameterized_arguments` children and the pinned grammar names all three
identically: the class's own lightweight-generic TYPE PARAMETERS, its superclass's TYPE
ARGUMENTS, and its ADOPTED PROTOCOLS. Reading every list as an adoption list published
`implements Cache -> KeyType` — a name no file declares, because it is this class's own type
parameter. The partition is positional, and exact, because the grammar keeps the `:` and `(`
as direct children: a list BEFORE the `:` is the declaration's own type parameters; the first
list AFTER the `:` is the superclass's type ARGUMENTS exactly when every name in it is one of
those parameters (the ordinary `@interface Plain : NSObject <NSCopying>` declares none, so
its single list adopts); every later list adopts. A class EXTENSION re-declares the enclosing
class's parameters in front of its `()` and adopts nothing; a CATEGORY's genuine list sits
AFTER its `(` — mirror images, which is why the rule cannot be "a list before the paren".
Measured with the F5 oracle over the two production corpora (322 files): the oracle derives
exactly 7 such type-parameter rows and the lane publishes none of them, and the independent
re-derivation in `script/m60/objc-construct-site-probe.ts` finds all 119 genuine adoption
sites emitted with 0 unmatched.

### OC-ONT-8: `exports` is external linkage, and that is what settled the family

The family was first scoped to MARKER-bearing declarations (OBJCD9). The external-linkage
scope above supersedes that, on a measured conflict: the same `extern` declaration cannot be
both `import_based` and `structural`, and a class cannot be both a required export and a
forbidden one, so this was put to the owner on 2026-10-15 and the external-linkage scope was
ruled. The evidence for the ruling is the oracle's own export-site derivation, which counts
file-scope declarations by linkage rather than by marker (`script/m60/objc-construct-site-probe.ts`:
338 construct sites against 98 edges emitted by the marker-only rule), and the fleet's
tiering, which c/cpp/powershell apply to `exports` as `structural`.

**Relationship source identity:** message/call sources are the enclosing
METHOD/function name — never the receiver and never a block scope. File-scope
relationships use `root`. The dedup key includes the relationship TYPE
(`type|source→target`) so `calls` and `instantiates` for the same pair (e.g.
`[[Foo alloc] init]` inside one method) never collapse.

### `extends` carries two facts, and the flag is what separates them

Measured over the router's 329-file universe, the 255 `extends` edges split:

| shape | count | example | metadata |
|---|---|---|---|
| class → superclass | 200 | `DetailViewController → UIViewController` | none |
| protocol → protocol | 55 | `SDImageCache → NSObject` | `isProtocolInheritance: true` |

Both are real inheritance relations, and `@protocol P <Q>` genuinely is one — the
question a consumer has to answer is whether its source node is a class or a
protocol. A consumer filtering on `type === "extends"` alone will mix the two
populations and should read `metadata.isProtocolInheritance` to separate them.
This is not a defect and it is not unique to this lane: swift, kotlin and csharp
all emit `Extends` and `Implements` from the same two concepts. It is recorded
here because it is the one place in this lane's ontology where a type name is not
sufficient to know what kind of relation it is.

`implements` and `extends` are, by contrast, distinguishable **without** metadata
— different type names, and the two shapes never share a target on one source
(`SDImageCacheToken implements SDWebImageOperation` and `SDImageCacheToken extends
NSObject` in the same interface). Verified by reading both off a real file rather
than inferred from the table.

### Measured truth and completeness (24,114 edges)

`script/m60/objc-edge-audit.ts`, over all 329 routed files, no sampling:

| property | measurement |
|---|---|
| edges with a `line_number` | **24,114 / 24,114 (100%)** |
| edges with a `metadata.evidenceClass` | **24,114 / 24,114 (100%)** |
| **fabricated** targets — a name the emitting file does not contain | **0** |
| import → `references` edges per `#import`/`#include` | 0.998 (918 imports, 916 edges) |
| `[[Foo alloc] init]`/`[Foo new]` → `instantiates` per `alloc]` | 1.018 (510 → 519) |
| protocol conformances → `implements` | 1.156 (109 → 126) |
| `calls` per source-side message send | 1.307 (6,358 → 8,309; `calls` also covers 141 C functions, so it exceeds the send count by design) |

"Fabricated" is scoped honestly: it means the edge's target name occurs nowhere
in the file that emitted it — not a symbol, not a token, not a path. That catches
a consumer being handed a name with nothing behind it. It does **not** judge
whether an edge means what a reader would want it to mean. Three target shapes
cannot be resolved by a name lookup and are counted as resolved by construction
rather than treated as failures: selector targets (`alloc`), qualified superclass
members (`UITableViewCell.initWithStyle:reuseIdentifier:` — absent from the
subclass file *because* it is an override), and path targets
(`Foundation/Foundation.h`).

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
- Message sends: `[receiver selector:arg]` → calls the FULL selector
  (`errorWithDomain:code:userInfo:`, receiver is never the target);
  `[[Foo alloc] init]`/`[Foo new]` → instantiates Foo
- Value reads (OC-E): `uses` for parameters, locals, ivars/properties, globals
  and bare receivers — with the declaration, callee, selector-name and
  assignment-LHS gates above
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
- Block-POINTER parameter declarations (`void (^handler)(NSString *)`) — the
  declared name is a DECLARATION, never a read (C parity: the C analyzer given
  `void h(void (*cb)(int))` emits nothing), even though it binds as a value and
  is therefore callable later
- `#define` include guards (`#ifndef X` + empty `#define X`) — the shared
  C-family path mints the name by ruling (#901: a `#define` DECLARES a name
  whatever its body; the old body-based skip lost real reads, measured on
  sqlite). One symbol per guarded file, no edge
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

- Fixtures: 4 files, 35 symbols, 54 relationships (89 observed facts) — 43 ms
  wall, peak RSS 296 MB
- Corpus (entire Clyde@8fec41dd ObjC inventory, 7 files): 100 symbols, 333
  relationships — 208 ms wall, 480 syms/s, 1599 rels/s, peak RSS 317 MB

The analyzer is a single-pass iterative-stack walk (O(N) nodes) with O(1) map
deduplication for symbols and relationships — no O(n²) or per-symbol O(n)
scans. Imports are extracted during the same walk; no second pass over source.

## Differential ground truth

**Two differentials exist, and they are not equally strong. That asymmetry is the honest
content of this section.**

- **M12, `validation/m12/results/objective-c-differential.json`** — ground truth
  `validation/m12/fixtures/objective-c/*.{h,m}`, authority **`manual_audit`**: an independent
  hand audit against Objective-C semantics and the M11 contract.
  **89 expected / 89 resolved, 0 FP, 0 FN, 0 unknown, precision 1.000, recall 1.000.**
  The caveat is the authority field itself. A truth file authored by the same hand as the
  analyzer is a **mirror**, not a differential — the shared M14 sweep rejected eleven lanes'
  hand-authored truth files on exactly that ground — so this number establishes that the
  analyzer agrees with a careful reading of the language on 89 facts, and does **not** establish
  that the reading was complete or free of the analyzer's own assumptions. It is a consistency
  check with high value and a known ceiling.
- **M14 F5, `deriveObjcEdges`** in `script/m14/differential.ts` — the tree-truth oracle, over
  `sdwebimage` and `afnetworking`. **Currently unrunnable, for every language in the
  repository**: the hcl wave added its `LANGS` entry at line 20025, inside a function body,
  instead of into the `LANGS` map at line 604, so the harness fails to parse. That is the
  shared lane's defect, not this one's, and it is not worked around here.

  Even once it runs, it **cannot referee a grammar change**, which is the job this round most
  needed. The oracle derives its edges from the same tree the grammar produced, so a change
  that removes a phantom and a change that loses an edge are indistinguishable to it. That is
  why the M60 grammar wave was verified by diffing **the analyzer's own output** edge by edge
  across two builds over all 329 routed files (`script/m60/objc-wasm-ab.ts`) instead — a
  different question, asked of a different arbiter.

- **What replaced it for grammar truth:** `script/m60/objc-error-dump.ts` (per-node ERROR
  shapes), `script/m60/objc-enum-loss.ts` (member recovery against source-side counts),
  `script/m60/objc-grammar-provenance.ts` (three builds, surface and behaviour), and
  `script/m60/objc-edge-audit.ts` (edge truth and completeness). Each has a different arbiter,
  which is the property that makes the set worth more than any one of them.

## Corpus validation

The lane's corpora are pinned clones, read at **full extent** (no draw), over the universe
`src/ast/language-detection.ts` actually admits — extensions `m`/`mm` by name, plus `.h`
content-sniffed for `@interface|@protocol|@implementation`:

| repo | rev | admitted | of tracked | `.h` admitted |
|---|---|---|---|---|
| `sdwebimage` | `c3ad5e1a` | 247 | 263 | 143 / 159 |
| `afnetworking` | `d9f589cc` | 75 | 80 | 26 / 31 |
| `clyde` | `8fec41dd` | 7 | 7 | 3 / 3 |

**329 files — 5,095 symbols, 24,114 relationships, 918 imports** (all `type: "include"`,
918/918 with a line), 36 files carrying an ERROR node, 0 crashes, 0 duplicate ids, 0 unknown
sentinels, and **100% line + `evidenceClass` coverage on every relationship**.

Before the M60 wave the header half did not exist in these claims, and that is where the
wave's defect lived: **11 headers lost 122 real symbols**, `AFHTTPSessionManager.h` analysing
to 0 of its 37 declared symbols.

**The corpus claim itself was wrong twice over, and both are recorded rather than quietly
replaced.** The manifest published Clyde's 7 files — **2.1% of the admitted universe** — as
the lane's corpus measurement. And the artifact the gate actually read reported
`errorFiles: 0` while recording `crashFiles: 49`, every file erroring *"Language objc parser
not yet implemented"*: **the instrument counted a crash as a clean parse**, so the lane has
been "grammar-clean" on the strength of a run in which nothing parsed at all. That artifact is
preserved at `validation/m12/results/objective-c-corpus-errors-CRASHED-2026-09-26.json`.

M12 differential: 89 facts, TP 89 / FP 0 / FN 0, precision 1.000 / recall 1.000,
`unknown 0`, digest `a776415bbaac`. Line contract over the same widened set: 23,379
edges, 0 unlined, 23,379 token-checked, 0 INCONSISTENT.

`script/m12/objc-corpus-errors.ts` also scans the M11-era pinned corpus
(Clyde@8fec41dd, `git ls-files '*.m' '*.h'`, 7 files):

- **7/7 parse clean — 0 grammar errors, 0 crashes, 0 timeouts**
- npm tree-sitter-objc 3.0.2 wasm verified identical on THAT corpus (0 vs 0 errors,
  0 fixes, 0 regressions) — which is why no upgrade was warranted then: a 7-file
  all-Clyde corpus contains neither the idiom nor the volume that exposed the defect
- Shape-safety: all 32 analyzer node-type references exist in the grammar
  except 8 dead defensive alternatives the grammar never emits
  (`category_interface`/`category_implementation` — the grammar emits
  `class_interface` with a `(` token; `protocol_list`/`protocol_qualifiers` —
  emits `parameterized_arguments`; `superclass_reference`/`selector`/
  `block_expression`/`property_identifier` — alternatives to
  `identifier`/`block_literal`/`struct_declarator`), same category as the
  C/C++/Rust pre-existing dead refs

## Limitations (honest gaps)

- **objc does not inherit the C grammar's `#743` patch** (measured impossible to
  build, see Language above). A bare macro decorating a *C* declaration inside a header
  (`EXPORT NSInteger const kX;` stacked under another macro) is outside the M60 rule,
  which only decorates `@`-declarations. Its own wave.
- **A bare macro line at file scope with nothing after it still parses as a
  `declaration` closed by a MISSING `;`**, and such a declaration publishes nothing
  (`isUnterminatedDeclaration`) because it has no declarator. Stacked macro lines were
  the shape this caught (`variable PROTOCOL_MACRO`); the grammar cannot distinguish
  them from a declaration because tree-sitter has no newline sensitivity.
- **42 of the 63 error-bearing corpus files still contain ERROR nodes**, outside the
  nullability class this wave fixed (observed remainder includes macro-invocation
  typedefs under a prologue macro). Extractable loss in that tail was NOT measured —
  one verified class, not a claim about the rest.
- `typedef NS_ENUM(NSInteger, X) {...}` / `NS_OPTIONS` macro forms: the
  grammar emits ERROR nodes (NS_ENUM is a macro, not a keyword). The
  plain `typedef enum {...}` form extracts fully. Recorded in the manifest
  note; no upstream grammar parses these today.
- Cross-file type resolution (e.g. `UserService` declared in UserService.h
  used in UserService.m) is per-file by design in the differential — the
  production companion-index wiring is tracked separately (same note as
  Java/C/C++/Rust).
- Multi-part selectors surface the FULL selector (`setValue:forKey:`) — the
  M11-era note that they "surface the first selector identifier" described the
  analyzer as it was before OBJCD7, and is the reason the M12 ground truth
  carried leaf names until the 2026-09-25 adjudication.

## Evidence

- Fixtures: `validation/m12/fixtures/objective-c/` (UserService.h,
  UserService.m, user_config.h, Negative.m)
- Ground truth: `validation/m12/ground-truth/objective-c.json` (89 facts:
  35 symbols + 54 relationships)
- Differential: `validation/m12/results/objective-c-differential.json` —
  **1.000/1.000 precision/recall, 89 TP, 0 FP, 0 FN, 0 unknown**, re-derived
  2026-09-25 when the audit was adjudicated against the fixture source (see
  below); it was 1.000/1.000 on first run too, over a truth that described
  leaf-named methods the analyzer had stopped publishing and omitted the whole
  `uses` relationship
- **M12 adjudication 2026-09-25 (M60 objc lane).** The audit had drifted from
  the analyzer in four ways, each fixed on evidence rather than by moving a
  number: 29 facts carried LEAF method names where the analyzer publishes full
  selectors (OBJCD7); the 12 `uses` rows the family contract requires were
  missing entirely; four correct rows were missing as facts (protocol adoption
  `@protocol UserStore <NSObject>` → extends, the two shared-C-path
  type_reference rows, the value-less `#define USER_CONFIG_H`); and ONE row was
  refused as a defect rather than added — `uses register_block -> handler`
  fired from the block-parameter declaration alone, fixed in the analyzer and in
  the F5 oracle (`isParameterDeclaredName` / `objcIsParameterDeclaredName`). The
  same adjudication found a PRODUCTION defect: `pool-worker.ts
  filterNoiseRelationships` took a target's leaf as the last `:`-separated
  segment, so every selector (which ENDS in ':' — the colon is its arity) looked
  empty and was dropped as noise. 17 of the differential's 30 false negatives
  were rows the analyzer had emitted and that filter had eaten, and at corpus
  scale it was **3,641 of 17,696 relationships on sdwebimage** and **1,724 of
  8,333 on afnetworking** — ~20% of the graph. Both defects have standing pins:
  F9 probes `F9-PROBE-OBJC-PARAM-DECL` (analyzer + oracle, oracleForbid) and
  `F9-PROBE-OBJC-PRODUCTION-SELECTOR` (the production entry over a real .m file),
  the fixture/mutant pair in `objc/bare-value-reads`
  (`objc/emit-param-decl-as-bare-read`), and this differential itself
- Corpus: 7/7 files clean, 100 symbols / 333 relationships measured
- M11 gate: `validation/m11/probe-systems.ts` — 1.000/1.000 (Logger.h/.m
  symbols intact, no regression)
- **M60 grammar wave 2026-09-25 (#743's class, objc half).** `NS_ASSUME_NONNULL_BEGIN`
  immediately above an `@interface` — the idiom every Apple header is written in — was
  read as the first specifier of a declaration that then swallowed the `@interface` line
  into an ERROR *inside that declaration*, costing the whole decorated surface and
  minting phantoms from the wreckage (`variable NSObject`, `variable void`, `variable
  provider` for a parameter name). Landed as `macro_prefixed_objc_declaration` in the
  vendored grammar (no conflict entry demanded; `prec(-1)` load-bearing, and dropping it
  was built and refused — `Add a conflict for these rules: type_specifier,
  macro_prefixed_objc_declaration`). Full-corpus A/B, every file: 0 files worsened, 0
  clean files perturbed, ERROR/MISSING nodes 795 → 582. The analyzer's own output was
  diffed edge by edge because the F5 oracle walks the SAME tree and cannot tell a
  removed phantom from a lost edge: 0 real symbol losses, 0 relationship losses, against
  +113 symbols and +158 relationships. Pins: `objc/macro-prefixed-declaration` (fails on
  the committed wasm, passes on this one) and mutant
  `objc/publish-unterminated-declaration`; record
  `reviews/m60-743-objc-grammar-macro-specifier.md`.

---

# Ontology census — DERIV_EXPORTS_OBJC3, 2026-10-05

Branch `analyzer/DERIV_EXPORTS_OBJC3`. Handover state: **MEASURED 8/10, silent
on imports and exports**. Every number below is a count from a named instrument
over a named corpus, produced on this branch. Source reading answers only whether
a type is constructible; it never answers whether it fires.

## 0. Baseline, measured before any change

**`firing-check-v2` at NFILES=200 — 8/10, and both silent types need a channel
answer before they need a verdict.**

```
$ cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs OBJC
selected lane(s): OBJ_C  (from OBJC)
OBJ_C         8/10  153/153 parsed · imports[] 517 in 153 files
   fired:  calls extends implements uses contains references overrides instantiates
   silent: imports exports
   counts: uses:9295  calls:8033  contains:2196  overrides:603  references:515
           instantiates:507  extends:52  implements:20
```

Read against the instrument's own DEFECT 3 correction: `imports` travels on
`ParseResult.imports` (`src/ast/types.ts:206-216`), a separate channel from
`res.relationships`, and **517 across 153 of 153 sampled files** is non-zero. So
`imports` is not measured-silent; it is measured on the other channel.
`exports` has no such excuse yet — that is what this lane has to settle.

**The instrument cannot be invoked with this lane's own name.** Measured:

```
$ NFILES=200 bun script/m14/firing-check-v2.mjs DERIV_EXPORTS_OBJC3
FIRING-CHECK v2: no lane matches "DERIV_EXPORTS_OBJC3".
exit 2
```

`resolveLane` (`script/m14/firing-check-v2.mjs:180`) has no rule for a digit
suffix: `DERIV_EXPORTS_OBJC3` uppercases to `OBJC3` for the ALIAS lookup (step 2,
tokens include `OBJC3` not `OBJC`), `OBJC3` is not a key, and no key starts with
`OBJC3`. Worse, `OBJC` alone is ALSO ambiguous by a different route —
`resolveLane("OBJ_C")` returned the **C** lane:

```
$ NFILES=200 bun script/m14/firing-check-v2.mjs OBJ_C
selected lane(s): C  (from OBJ_C)      <-- wrong lane, and it reported 6/10
```

Step 4 of `resolveLane` matches `want.startsWith(n)` over normalized keys;
`OBJ_C` normalizes to `OBJC`, which is a prefix of nothing, but the alias table's
`C` entry plus `ALIAS.C = "C"` is consulted at step 2 over the token split on
`_`, and `_` is a delimiter — so `OBJ_C` splits into tokens `OBJ` and `C`, and
`C` resolves. The exit-2 guard caught the unambiguous failure and the *score*
from the wrong lane (`6/10`, silent `extends implements exports overrides`) is a
plausible-looking number about the wrong analyzer. Both defects are in
`script/m14/**`, which this lane does not own; they are reported, not fixed.

**This lane's sampling population is 153 files and cannot grow.** The instrument's
lane row for this analyzer is `exts: [".m"]`, and `$HOME/fixtures/repositories/objc`
holds exactly 153 `.m` files (sdwebimage + afnetworking). So NFILES=200 samples
the whole `.m` population. The brief's warning that file count moves the score is
real in general (Ruby 1/10 at 25 vs 8/10 at 200) but cannot bite this lane
through the `.m` channel: at 200 there is nothing left to draw. What the
instrument cannot see is the **207 `.h`** files in the same corpus — headers are
52% of what production admits, and they are outside the instrument's extension
list entirely. Every number in this section that claims to describe "the lane"
below is measured over the ROUTER's admitted universe instead, through production
`parseFile`.

**objective-c IS among the 100 DERIVATION findings, on four types.**
`validation/m60/rel-type-coverage-baseline.json` lines 68-71:

```
DERIVATION|objective-c|emits `calls`      but the differential audits ["extends","implements","instantiates","overrides"]
DERIVATION|objective-c|emits `contains`   but the differential audits ["extends","implements","instantiates","overrides"]
DERIVATION|objective-c|emits `references` but the differential audits ["extends","implements","instantiates","overrides"]
DERIVATION|objective-c|emits `uses`       but the differential audits ["extends","implements","instantiates","overrides"]
```

Four types whose edges are stored and compared against nothing. That is the
first-class half of this lane's job and it is settled in §3 below.

**These edges are OUTGOING only.** Every analyzer emits edges FROM the file being
analyzed. Nothing here resolves who points AT an Objective-C symbol; reverse
resolution is a separate subsystem that does not exist yet, so every "unresolved
target" count in §2 is unresolved in the FORWARD direction (the name is not
declared in the emitting file or anywhere in the corpus) and says nothing about
incoming edges.
