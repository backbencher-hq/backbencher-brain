# real-c-analyzer.md

> **2026-09-28 wave (M14/M37/M60).** Every claim below was re-measured. Six
> claims in the previous version of this page were **false or stale** and each is
> named where it stood, with what replaced it: the regex inventory (claimed 0, the
> artifact it cited carried 2), the `instantiates` relationship (claimed emitted,
> the code had removed it three years of waves earlier), the "no O(n²)" hot-path
> claim (an O(n × functions) scan, measured at 18–24% of the analyzer's wall time
> on a 360 KB file), the crash guarantee (a real corpus file killed `analyze()`
> with a stack overflow), and the complexity table's corpus (a path under another
> user's home directory, not reproducible from this checkout). Findings and the
> evidence behind them: `reviews/c/third-review.md`, `reviews/c/master-review.md`.

## Language

- Analyzer file: `src/ast/real-c-analyzer.ts` (4,750 lines)
- Parser: `tree-sitter-c` **0.24.1** (npm, latest; `translation_unit` →
  `function_definition`/`declaration`/`type_definition`/`struct_specifier`/
  `union_specifier`/`enum_specifier`/`preproc_def`/`preproc_function_def`/
  `preproc_include` tree; `struct_specifier` → `name` field + `body` →
  `field_declaration`; `function_definition` → `declarator` + `body`;
  `call_expression` → `function` + `arguments`)
- Language detection: `.c`/`.h` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields, never
  source-text scanning. The string processing that does exist is on values already
  extracted from AST nodes (pure-String helpers, no regex), plus **one** narrow
  line-anchored directive scan added this wave and stated below under *Macro
  inventory*.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | function declarator identifier; struct/union/enum name field; typedef declarator identifier (anonymous structs/enums named by their typedef alias — ONE symbol); macro name; file-scope variable identifier |
| kind | ✅ | function definitions + prototypes → `function`; structs with bodies → `struct` (fields → `property` with `ownerName`); unions with bodies → `type` (fields → `property`); enums → `enum` (members → `enum_member`); typedefs (function pointers, aliases) → `type` when the alias differs from the specifier name; object-like macros → `constant`, function-like macros → `macro`; file-scope static vars → `variable` (private) |
| qualified/container name | ✅ | `ownerName` = enclosing struct/union/enum name for fields/members; `scope` = nearest enclosing scope (struct/union/function) |
| range (start/end line + column) | ✅ | the declaration/definition node; `recoverFunctionRange` for functions whose body contains ERROR nodes |
| parameters | ✅ | function declarator `parameter_list` → name/type pairs (skip `...`), stored on function symbols |
| returnType / type | ✅ | return type from `function_definition`'s type field; field/param types from their type nodes |
| documentation/comments | — | n/a (C comments not extracted as doc) |
| complexity metrics | ✅ | cyclomatic complexity (if/for/while/do/case/ternary/`&&`/`||`); per-function metadata: `usesMalloc`, security flags |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `static`/`inline`/`extern` storage-class metadata on functions/variables |

## Relationship ontology

The distinct types the analyzer **actually emits** over the 2,498-file corpus
(`validation/m12/results/c-corpus-census.json`, `relTypes` merged):

| type | emitted | count | metadata.relationshipType |
| --- | --- | --- | --- |
| `calls` | ✅ | 199,929 | `c_function_call` |
| `uses` | ✅ | 86,948 | `field_access` · `identifier_usage` (the pre-#960 split 53,995 / 20,334 predates the write-ruling and no longer sums to the total) |
| `contains` | ✅ | 17,396 | — (container → member) |
| `references` | ✅ | 10,538 | `type_reference` |
| `imports` | ✅ | 10,993 | `include_dependency` |
| `exports` | ✅ | 957 | `module_export` (kernel + userspace markers, #963) |
| `instantiates` | ✅ | 5 (#962) | `instantiates` → the allocated TYPE |
| `extends` / `implements` / `overrides` | ❌ **N/A — see below** | 0 | — |

**`instantiates` IS emitted (#962), and this section previously said it was not.**
The allocator branches count `malloc`/`calloc`/`realloc`/`kmalloc`/`vmalloc` and
`free`/`kfree`/`vfree`, set `metadata.usesMalloc` on the enclosing function, and
raise the `Dynamic Memory Management` pattern — and a comment in the code
recorded why the edge had been removed: "malloc allocates BYTES, not a named type
— an `Instantiates` edge to the literal 'malloc' could never resolve to a type
symbol and was pure noise (removed; allocation tracking lives in metadata +
patterns)." That reasoning was right about the target and wrong about the
consequence, exactly as #963's `exports` defect was: across all 25 M12 truths that
pin an `instantiates` edge the target is always a TYPE (`Point`, `HashMap`,
`List`, `User`, `MemoryStorage`, …), and C's `-> malloc` was the only non-type
target in the family. #962 restored the relation and reads the target from the
**cast** and from **`sizeof`**, which disagree in practice about which carries the
type. Only a type declared in the same file qualifies (C-D2), so the corpus
carries 5 such edges and the M12 truth row for `buffer_create` is recorded as
`rel:Module.c:instantiates:buffer_create:Buffer` with `unmetUnder: C-D2`.

**`exports` was ALSO dead for a target-shaped reason, and #963 fixed it the same
way.** See #963 below — the pre-#963 edge pointed at a synthesised constant
`KERNEL_EXPORT` written in no source file anywhere.

**`extends` / `implements` / `overrides` are N/A by ruling, not by omission** — C
has no class heritage. Recorded as spec decision `C-D1`.

The types the language's semantics ALLOW but the analyzer does not emit, and why:
a `uses` edge for a *computed* dispatch (`handlers[i]()` — `target` is
deliberately empty) and for a parenthesized callee (`(Unit)(x)` cast,
`(*fp)(x)` deref). Both rulings are in the code with their measured reasons, and
both are the family contract with cpp rather than an omission.

### Per-type notes

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: struct→field, union→field, enum→member (post-loop over `ownerName`). Never `global contains X` — top-level symbols carry the synthetic `global` scope but emit no contains (dangling edge, Java-family ontology). **A container is never its own member**: `contains X -> X` is gate property P12, added this wave after a shadowed local made every enum member self-owning. | 1.0 |
| references | ✅ | type usage — in-file declared type identifiers (`type_identifier`, `struct_specifier`/`union_specifier`/`enum_specifier` references, **including a function's return type, whether spelled with a tag or with a typedef name**). Never both references+uses for the same pair. | 0.8 |
| uses | ✅ | field access (`a->x` → `uses x`, with `accessedFrom`); value identifier usage (global var, enum member, local function reference). **One name occurrence, one edge** — the field's own `field_identifier` leaf is the SAME AST node read twice by the walk and is not an independent observation (this wave: the two branches keyed the shared dedup set `::uses::` against `::use::`, so every field read published two edges with two different confidences; measured 2,369 provable occurrences over 80 redis files). | 0.9 (field access) · 1.0 (value) |
| calls | ✅ | `call_expression` → callee name (incl. field-expression function pointers); source = enclosing function name via `getRelationshipSource()`. Per-SITE, not per-set: `f calls g` on three lines is three true edges. | 1.0 |
| imports | ✅ | `#include <path>` / `#include "path"` → module name (pure-String `stripIncludeChars` unwrap of the `path` field / `string_literal` / `system_lib_string`). A macro-composed include argument is a `call_expression` and is refused — C-D2. | 1.0 |
| exports | ✅ | a declaration introduced by an export marker. **Source = the declared NAME**; **target = the marker macro as written** (`EXPORT_SYMBOL`, `CURL_EXTERN`, `GIT_EXTERN`, `REDISMODULE_API`) — never the macro's argument, which in the prefixed forms is a return *type* (`GIT_EXTERN(int)`), and never the synthesised `KERNEL_EXPORT` the pre-#963 code emitted. All four surviving conventions: kernel call form, userspace prefix, paren form, and bare-token form. See #963 for the declared grammar limit (typedef return type). | 1.0 |

**Relationship source identity:** `getRelationshipSource()` returns the
enclosing FUNCTION name — never the block scope (`core_init.block_211` would be a
dangling identity that never resolves to a symbol). File-scope relationships use
`global`.

**Line contract (M59.A7):** every emitted relationship carries `line_number`,
1-based, on the **name-bearing node**, per-site. Measured over the corpus:
**0 of 312,636 edges lack a line.** (The lane formula's older note that C stood
at "0/422 relationships carry any line field" was true when written and is now
false; the line work landed with the M59 rounds and this row is the current
measurement.)

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
  STATUS_ERROR, STATUS_TIMEOUT } Status;` → `Status` contains `STATUS_OK` etc.)
- Typedefs → type symbols (`typedef int (*CompareFn)(...)` function-pointer
  alias → type; `typedef struct Point Point;` — the alias differs from the
  specifier name → type symbol)
- Macros → `#define MAX_BUFFER 256` → constant; `#define MIN(a, b) ...`
  function-like → macro. **This wave, in enumerator position:** a macro
  invocation there (`CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1)`) is
  parsed as ERROR fragments around bare `enumerator(identifier)` pieces and each
  piece used to be published as a member — the macro's ARGUMENTS (measured
  `CURLOPTTYPE_CBPOINT` 21× under `CURLoption` in curl.h). An enumerator whose
  name is an **object-like** macro defined at or before it is also refused, since
  the preprocessor replaces the identifier. Both are refusals, never guesses: a
  function-like macro name in enumerator position is REAL (an enumerator is never
  followed by `(`), and the fixture pins that control.
- **Members in field position, this wave's largest class.** Three rules, all
  refusals, all gated:
  1. a `field_declaration` with **no declarator** names no member — a
     macro-generated field (`BIT(closing);`) has only a `macro_type_specifier`,
     and the old fallback published a `property` named after the MACRO
     (`cf_h2_proxy_ctx.BIT` 5×, `tunnel_stream.BIT` 3× in curl);
  2. a `field_declaration` carrying a **MISSING `;`** whose declarator slot holds a
     name the file **declares as a type** or as a **macro** names no member — a
     bare macro token in field position shifts the parse by one declaration and the
     extractor then published the TYPE as a member. The MISSING token is required,
     because `struct S { struct T T; };` is **legal C** (the declarator is an
     ordinary identifier; the tag is in its own namespace) and only the token
     separates the two;
  3. the real member behind such a token is **not recovered**. It is one token away
     in the next declaration's type slot, and a two-token mend whose generality was
     not measured is exactly the fabrication recovery risks — so the loss is
     declared instead, on the record that a phantom member (a symbol that exists
     and is wrong) is worse than a member that is absent and recorded as absent.
- File-scope globals: `static int initialized` → private variable symbol
- Enum member usage resolves as use targets: `module_init uses STATUS_OK`
  (Java `Status uses ACTIVE` pattern, M12.01 ontology)
- Forward declarations (`struct ForwardOnly;`, `typedef struct Point Point;`)
  produce NO symbol and NO scope leak — a declared-type pre-pass makes
  type-identifier resolution order-independent (typedef-before-definition
  resolves; never-defined forward decls emit no dangling edge)
- Include guards (`#ifndef NEGATIVE_H` / `#define NEGATIVE_H` with no value
  body) → NO symbol
- `malloc`/`free` → counted, `metadata.usesMalloc`, the
  `Dynamic Memory Management` pattern. **No `instantiates` edge** — see above.
- Framework detection from `#include` patterns (POSIX/Win32/Linux kernel/
  embedded) — pure-String scans, no regex
- Negative fixture (Negative.c): function-local variables → NO symbols;
  `NULL`/`0`/`true`/`false` literals → no use edges; anonymous typedef'd
  structs/enums → ONE symbol named by the typedef; forward decls → no symbols
  or self-references; unused includes still resolve as include dependencies

## Unsupported / explicit-unknown constructs

- The external 400-file corpus probe recorded 122 files with Tree-sitter
  `ERROR` nodes (0 crashes, 0 timeouts). On this wave's own 2,498-file census the
  rate is **493 of 2,498 (19.7%)** — 144/900 curl, 153/900 libgit2, 196/698 redis
  — and **0 crashes**, against a documented crash guarantee of 0 that was
  **falsified** by this wave's own corpus until it was fixed (see below).
- **Extraction loss under grammar damage** is the standing class, not a fixed
  count: 30.5% on the historical pin, 19.7% on this census, and the per-file
  symbol/edge volume inside a damaged file is the honest measure of what survives.
- Cross-file resolution (`Buffer` declared in Module.h used in Module.c) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring tracked as M12.44, same as Java M12.01).
  Measured consequence: 74,129 `uses` edges whose target is not a symbol in its own
  file, and the top entries are all external or cross-file by nature
  (`assert` 2,480, `strcasecmp` 1,134, `printf` 955, `serverLog` 876).
- **Macro inventory has a measured hole (this wave).** The grammar drops or
  absorbs `preproc_def` nodes in several regions, so a `#define` the walk never
  reaches produces **no symbol**, its reads are unresolvable, and the member and
  enumerator rules that key on macro names are blind to it. Measured on
  `redis/deps/jemalloc/include/jemalloc/internal/tsd.h`: a long brace-enclosed
  macro body makes the region after it covered by an enclosing node's span with
  **no child representing it** (a whole-tree scan finds no node with a start row
  anywhere in 120–146), and the walk sees 24 `preproc_*` nodes for 29 `#define`
  lines. Two of the five gaps in that file are the lane's own fixtures, so this is
  not a vendored-code-only class. It is **not fixed**: minting a symbol from the
  raw text was considered and refused, because a `#define` line inside a `/* */`
  block reads identically and that false-positive class was not measured. What
  DID land is #934 — a supplementary line-anchored inventory over the file's own
  text, the one shape a C lexer defines unaided (a line whose first non-space
  character is `#` introduces a directive), which makes the macro NAMES available
  to the member and enumerator rules. It makes the inventory complete for the
  rules; it does not mint a symbol. The residual is a reported floor, gate
  property P13, scored per corpus slice in
  `script/m14/tmp/c-audit/p13-baseline.json`: 44 over a 200-file `curl/lib` slice,
  28 over `redis/deps/jemalloc`, reported every run and failing only on growth.
- **The layout payload was never verified against anything until this wave, and
  it was wrong.** `metadata.memorySize` / `metadata.alignment` are computed by a
  hand-rolled model, and the lane's own fixtures were written *from the analyzer's
  output* — a payload checked against itself is not checked. The first independent
  check, against `clang -Xclang -ast-dump=json`
  (`script/m14/tmp/c-audit/layout-vs-clang.ts`), measured **46.9%** agreement with
  clang on redis. The decisive part is what the same run measured: the member
  **SETS** the numbers were computed from were **97.1% identical** to clang's, so
  the defect was the *arithmetic*, not extraction. The arithmetic matched a
  member's type **spelling** against two hand-maintained whitelists that had
  already drifted apart from each other, so every legal C primitive not
  individually enumerated fell through to a 4/4 default — **1027 of 2056
  member-type spellings (50%)** across the redis corpus, led by `long long`
  (130x, 8 bytes, computed as 4) and `unsigned char` (45x, 1 byte, computed as 4).
  Fixed by `primitiveClass`, which reads the keyword sequence the grammar already
  parsed and is therefore **complete** for primitives rather than enumerable, and
  by four further defects the probe then exposed:

  | # | Defect | clang said | we said |
  |---|---|---|---|
  | #936 | `long long`, `unsigned char`, `short int` and every other unlisted spelling | 16/8, 2/1, 8/4 | 8/4, 8/4, 6/4 |
  | #937 | a **same-file** `typedef uint16_t fingerprint_t;` above its use | 4/2 | 8/1 |
  | #938 | the two passes disagreed on the unknown-type fallback (4/4 vs align 1) | — | self-contradictory |
  | #939 | an array dimension written as a macro or an enumerator | 7/1 | 4/1 (dimension defaulted to 1) |
  | #941 | a **flexible array member** `T x[]` charged one byte (C99 6.7.2.1p16: zero) | 4/4 | 8/4 |

  Result, measured on both corpora that clang can fully compile:

  | Corpus | Compared | Agreed (overall) | Agreed, **types the analyzer claims to model** |
  |---|---|---|---|
  | `redis/src` | 49 | 37 (75.5%) | **32/32 (100.0%)** |
  | `libgit2/include` | 69 | 40 (58.0%) | **20/20 (100.0%)** |

  after #945 (bitfield packing), #946 (union payloads) and #947 (the macro-member
  refusal) — the same two corpora, same instrument:

  | Corpus | Compared | Agreed (overall) | Agreed, **types the analyzer claims to model** |
  |---|---|---|---|
  | `redis/src` | 49 | 42 (**85.7%**) | **37/37 (100.0%)** |
  | `libgit2/include` | 69 | 40 (58.0%) | **20/20 (100.0%)** |

  after #950 (inline aggregate widths) and #951 (member-path ownership):

  | Corpus | Compared | Agreed (overall) | Agreed, **types the analyzer claims to model** |
  |---|---|---|---|
  | `redis/src` | 49 | 44 (**89.8%**) | **39/39 (100.0%)** |
  | `libgit2/include` | 69 | 40 (58.0%) | **20/20 (100.0%)** |

  The claimed-type count *rose* from 32 to 37 on redis, because five bitfield types
  stopped being guesses and became computations. Both corpora now report **no
  actionable misses at all**: every type the analyzer claims to model matches clang,
  and every remaining disagreement is a declared limit carrying its marker.

- **Bitfields are PACKED, not charged their declared type.** A bitfield occupies
  bits in a shared storage unit, so charging it its type's full width was wrong by
  construction: redis's `raxNode` declares three 1-bit flags and a 29-bit counter on
  `uint32_t`, which clang packs into **one** 4-byte unit where the model published
  **16**; `quicklist` published 56 against clang's 48. The implemented rules are the
  psABI ones — bits allocated from the low end of the unit, a field that would
  **straddle** a boundary of its declared type moved up to the next such boundary, a
  zero-width field consuming nothing but forcing that boundary, and the struct's
  alignment being the max of its members' declared-type alignments. The straddle test
  is why the cursor is kept in **bits**: `a:1, b:31, c:1` is 8 bytes because `b:31`
  exactly fills the unit so `c:1` must start a second, while `a:1, b:30, c:1` is 4.
  Both are fixtures, because a bit-sum implementation plus alignment padding gets the
  first right *by accident* and only the pair tells the two apart. A bitfield width
  written as a macro or an enumerator resolves; one that cannot (the macro is in a
  header) is charged its declared type and marked.

- **A UNION published no layout at all.** `{ isUnion, cSpecific, isConditional }` was
  the entire metadata object, so every fix from #936 onward landed on the struct path
  only — and the clang probe filters on `typeof memorySize === "number"`, so it
  **silently skipped every union in the corpus**. An unmeasured payload is not a
  payload. 13 union symbols in a 150-file redis sample now carry one. A union's
  members *overlap*, so its size is the largest member rounded up to its alignment;
  the first version of this fix summed them and reported `union { unsigned int u;
  double d; }` as 16 bytes where clang says 8.

- **A member named after a macro is no longer published.** libgit2 writes its
  function-pointer members as `int GIT_CALLBACK(read)(...)` with
  `#define GIT_CALLBACK(name) (*name)`. Tree-sitter resolves that to a single
  `field_identifier` reading `GIT_CALLBACK` — the real name is consumed by the macro
  and is **not a node in the parse** — so four members named `GIT_CALLBACK` were
  published in `git_odb_stream` and three in `git_odb_writepack`, where the real
  members are `read`, `write`, `finalize_write`, `free`, `append` and `commit`. The
  test is per-file and syntactic, and **C is what makes it sound**: a
  function-pointer declarator must be parenthesised and dereferenced, so a
  declarator chain holding a `function_declarator` and no `pointer_declarator`
  cannot be a function pointer written in C. That matters because `GIT_CALLBACK` is
  defined in `common.h`, a different file — the analyzer's own macro inventory cannot
  see it, which is why an earlier attempt keyed on a known macro name failed and was
  **withdrawn as unsound**. Silence over invention, the #928 answer. The struct is
  then one member short, so its size is marked as a lower bound rather than published
  as a wrong number.

- **An INLINE aggregate member had no computable width at all.** C11's
  `struct { int a; int b; } inner;` — and its union counterpart. A struct's fields
  are registered under its *name*, and an anonymous one has none, so the guard
  `if (structName !== "anonymous_struct")` dropped them and the member fell through
  to the 4-byte unknown fallback. Measured over the three declared corpora: **141
  such members across 59 files**, and `struct { struct { int a; int b; } inner;
  char c; }` published 8 bytes where clang says 12. Fixed by registering the nested
  fields under a synthetic key and letting the member carry it, which handles a
  nested inline struct and an inline *array* of one as well as the flat case.

- **Two anonymous aggregates are not one type, and they were being collapsed.** The
  members of every anonymous struct in a file were attributed to the placeholder
  owner `anonymous_struct`, so a consumer could not tell them apart and the corpus
  census reported `anonymous_struct.main x2` for curl's ftplistparser.c — where
  `main` appears once under `UNIX` and once under `NT`, two members of two *different*
  structs inside a union. Legal C that the counter could not classify. The owner is
  now the **member path** (`Outer.options`, `clar_counter.val`), derived from the
  parse and unique by construction, which also removes the phantom placeholder TYPE
  symbols from the graph: a consumer can now navigate `Outer` → `options` → `bits`,
  which was impossible before. `duplicateMemberNames` over the three corpora fell
  **73 → 31**, and the rows still sitting on a placeholder owner from many to **one**.

  This is a two-for-one fix from one root cause, and the lane's own **P8 property**
  is what found the second half: the new fixture grew five inline aggregates and P8
  reported `anonymous_struct.a emitted 5x and 5 of them are UNCONDITIONAL --
  mutually exclusive preprocessor arms are the only legal source of a repeated
  member name`. The property was right; these are not arms, and they were not one
  owner.

- **A macro-mediated function pointer is detected by C's parenthesis rule.** The
  refusal in the entry above looked for a `pointer_declarator` anywhere in the
  subtree, which is wrong for the commonest shape of all —
  `void * GIT_CALLBACK(gmalloc)(size_t n, ...)`. Tree-sitter puts that `*` in a
  `pointer_declarator` around the whole declarator, because it belongs to the
  **return type**, so the subtree search concluded the member was genuine and the
  analyzer published two more members named `GIT_CALLBACK` in libgit2's
  `git2/sys/alloc.h`. The rule is C's own and it is about parentheses: a
  function-pointer member must be written `(*name)(args)`, so at the first
  `function_declarator` in the declarator chain the `declarator` must be a
  `parenthesized_declarator` — and if it is not, the `*` is not in the source. The
  corpus is what found this, and the four genuine shapes
  (`int (*f)(int)`, `void *(*f)(size_t)`, `void (*fns[3])(int)`,
  `void (*(*cb)(int))(void)`) are all kept.

- **A `calls` edge must name a function, and a function name is not a macro** — the
  second half of that sentence turned out to be a **pinned contract, not a defect**,
  and the wrong turn is recorded because it was the obvious one.
  `script/m14/tmp/c-audit/call-edge-fidelity.ts` compares every `calls` edge against
  the **parse**, per (callee, line), in both directions. It exists to adjudicate the
  census's `sameSiteDuplicates` (1447 redis / 129 curl / 291 libgit2, all
  `calls/c_function_call`), which had never been classified.

  **The census number is correct.** A line is not a site: `x = f(1) + f(2)` is two
  real calls to one callee, and C-D14's ruling is one edge per **occurrence**. With
  like compared to like, that class went to zero unexplained rows on all three
  corpora. It was never a defect and never needed a ruling.

  **What the probe got wrong.** Its first run reported ~4,000 "phantom" call edges
  whose callee is a file-local macro, and the suppression looked obviously right: the
  lane already refuses macro-named members (#928) and macro-named enumerators (#931),
  so a macro-named callee looked like the same rule a third time. The fix was
  implemented and measured at removing 4,000 edges — and **reverted one run later**,
  because it contradicts a pinned fixture. #908's ruling, in
  `c/function-like-macro-not-a-binding-908` and derived from the M12 **truth**, is
  explicit: *"the truth counts a macro invocation as `calls (expr)` AND `uses (expr)`"*,
  and that fixture expects `calls c908_read -> YY_INITIAL_VALUE` by name. Deleting the
  edge would have removed a fact the oracle demands.

  The two pinned fixtures draw a sharp distinction, and it is not in the analyzer's
  favour everywhere: a **real function-like macro invocation** gets a `calls` edge
  (#908, truth-driven), while a `#define` **replacement list** that recovery reads as
  a call gets **neither**, because a definition site is not an invocation (#912). So
  the macro rule is about *definition sites*, not *callees* — and the analyzer was
  already right on both counts. The probe's model was the defect: it took the literal
  parse as ground truth, so a documented divergence read as a bug.

  **#954, which stands.** libgit2's `pcre2_dfa_match.c:3604` reads
  `while (check_subject > subject &&`, then `#if PCRE2_CODE_UNIT_WIDTH == 8`, then
  `(*check_subject & 0xc0) == 0x80)`. A directive **in the middle of an expression**
  costs the parser the expression's structure, and it glues the `8` ending the
  directive line to the `(` starting the next: `call(callee: number_literal "8")`. The
  analyzer faithfully reported the parse as `calls pcre2_dfa_match -> "8"`. A numeric
  literal is not callable, so the edge is noise whatever produced it — and refusing it
  is strictly better than publishing it, because a consumer cannot tell a damaged
  parse from a real call. Every earlier guard on that branch listed the shapes it
  **recognised** and let everything else fall through to the callee's text, so an
  unrecognised callee became a call target *by default*. The test is the node type,
  not a pattern on the text, because P11 holds this file to zero regex literals on its
  hottest path.

  After both changes, judged against the parse with macro invocations and casts
  classified rather than guessed: **redis 7 over / 0 under** of 37,676 judged call
  sites, libgit2 2 / 1, curl 30 / 6. The macro-callee class — 1,983 / 1,303 / 622
  sites — is reported as **required by #908**, not as an error.

- **`layoutUnknownMembers` — a number that was partly invented is now marked.**
  Every remaining disagreement with clang is a width the model **declines to
  guess**, and before this wave it was published as if it had been computed: one
  rate conflated "our arithmetic is wrong" with "we refused and guessed", and a
  consumer could not tell a measurement from an invention. Each struct now
  publishes `metadata.layoutUnknownMembers`, counting every member whose width
  **or array count** was not computed. It counts, deliberately:

  - a named type declared in **another file** (C-D2 — the model is per-file);
  - a width deliberately refused, `long double` above all, which is 8 bytes on
    some ABIs, 12 on i386 and 16 on x86-64 SysV, so a guess would be wrong twice
    out of three;
  - a **bitfield**. `uint32_t iskey:1;` is not a 4-byte member, and redis's
    `raxNode` declares three 1-bit flags plus a 29-bit counter that clang packs
    into ONE 4-byte unit where the model computed 16. Bitfield packing is a real
    algorithm this model does not implement, so the published size is a **lower
    bound** and the flag says so;
  - a member whose members sit inside a **`#ifdef`**, which the extractor skips
    entirely — redis's `eventNotifier` is `#ifdef HAVE_EVENT_FD int efd; #else int
    pipefd[2]; #endif`, so which branch is live depends on build configuration
    the per-file model does not have;
  - a by-value **cycle**, where no size exists.

  The counter **propagates through the recursive descent**, because a member of
  type `rax` is only as well known as `rax` itself. The first version of the flag
  did not, and flattered the analyzer: 8 redis types reported
  `layoutUnknownMembers == 0` while their own miss class read "a named type whose
  width the model cannot know" — the metric and the classification contradicting
  each other inside one report. A `layoutUnknownMembers == 0` type is now correct
  in **100% of comparable cases on both corpora**; that is the number worth
  trusting, and the overall rate is the number worth quoting honestly.

- **A by-value self-referential type has no computable size.** C forbids an object
  type containing itself, so `metadata.memorySize` for one is not a number anyone
  can justify; the layout descent is bounded and contributes 0. **The crash this
  replaced was not that case** — it was C's tag/ordinary namespace split letting
  one bare name be both an enum typedef and a struct tag, which the bare-name
  lookup resolved to the struct, recursing until the stack blew.

## Regex inventory

**`validation/m12/results/regex-census.json` carries 2 entries for
`real-c-analyzer.ts`.** This page previously claimed 0, citing that artifact, and
both were wrong: the artifact said 2 and the claim said 0. Both regexes did
*syntax* work, which is the metric the regex policy names ("Counts of regex
literals alone are not the metric — the metric is regexes doing *syntax* work"):

| was | did | replaced by |
| --- | --- | --- |
| `/^[0-9][0-9A-Za-z_]*$/` | classify an ERROR node's text as a name fragment | `isDigitLedNameFragment`, a character test beside the file's existing `isAllCapsIdentifier` / `hasIdentifierToken` |
| `/^([A-Za-z_][A-Za-z0-9_]*)\s*(=\|\()/` | parse an identifier **and** a delimiter out of a re-parsed sibling's text | `truncatedSiblingDeclarator`, a **structural** read of the sibling's own parse (`expression_statement > assignment_expression` with `left` an identifier and the operator exactly `=`, or `> call_expression` with `function` an identifier), parity-measured against the regex over the ten spellings it accepted or refused |

**The count is now 0**, and the lane enforces it rather than asserting it: gate
property **P11** scans the analyzer's own source (comments and string literals
stripped first) for a regex literal, so a new one cannot be introduced silently.

**Why the census never caught it, which is a finding about the census.** The
classifier maps any regex whose receiver ends in `.text` to `normalization`
("AST-derived text first — a receiver ending in .text is tree-sitter node text
regardless of what the base identifier is named"), and `normalization` needs no
register entry under the R2 gate. So a regex that *parses* node text is invisible
to it: NORMALIZATION and PARSING are different operations wearing one label. The
classifier lives in a shared file (`script/m12/regex-census-core.ts`) and is not
this lane's to change, so the lane states the rule it can enforce on itself and
leaves the shared blind spot recorded here.

## Complexity envelope

Measured by the lane's own instrument, `script/m14/tmp/c-audit/census.ts`, over
three independently cloned corpora — curl 1,048, libgit2 1,190, redis 788 C/H
files, `--ext .c,.h --min-bytes 1024`, 900-file cap per corpus. **This box is
shared and ran at `load1` 22–49 throughout the wave**, so the wall figures carry
that disclosure and the CPU figures are the ones to compare.

| corpus | files | nodes | symbols | relationships | error files | crashes | ms/file (wall) | ms/k-node (wall) | load1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| curl | 900 | 931,077 | 16,445 | 68,275 | 144 (16.0%) | **0** | 8.3 | 8.0 | 7.4 |
| libgit2 | 900 | 1,459,927 | 27,705 | 111,793 | 153 (17.0%) | **0** | 12.8 | 7.9 | 7.5 |
| redis | 698 | 1,654,679 | 29,733 | 132,633 | 196 (28.1%) | **0** | 19.6 | 8.3 | 8.5 |
| **total** | **2,498** | **4,045,683** | **73,883** | **312,701** | 493 (19.7%) | **0** | — | — | — |

Reproduce with the scope spelled out, because the count moves with it and a
census whose denominator depends on whatever else is checked out is not evidence:

```
bun run script/m14/tmp/c-audit/census.ts \
  --repos $HOME/ishaq/fixtures/repositories/{curl,libgit2,redis} \
  --ext .c,.h --limit 900
```

At **full** scope (no `--limit`, so 2,778 files) the same invariants hold —
0 crashes, 0 unknown kinds, 0 empty names, 0 members without an owner, 0
macro-named members, 0 edges without a line, 0 dangling `contains` — and two
classes appear that the 2,498-file scope does not reach, recorded here rather
than left to a later reader:

- **1 symbol-free file**, `libgit2/script/user_nodefs.h`, whose entire content is
  wrapped in `#nodef` — a deliberately invalid directive libgit2 uses to switch
  code off. A compiler skips it too, so the analyzer emitting nothing is correct
  and the census's "HAS CODE" verdict is a text heuristic disagreeing with the
  language. 4 more appear in `zig/`'s vendored libc, which is outside this lane's
  declared corpora: 2 are genuinely directive-only, and 2 are a bare prototype
  carrying a trailing macro attribute (`void _start(char *, ...) __dead2;`) and a
  file-scope macro invocation (`DEFINE_GUID(...)`). Neither is a crash and neither
  is in this wave's diff, which touches layout metadata, array dimensions and
  typedef aliasing — none of which mints or suppresses a function symbol.
- **`duplicateMemberNames` 73** at full scope (13 curl / 41 libgit2 / 19 redis).
  Every row inspected is a member of an **anonymous aggregate** or a
  macro-generated type — `anonymous_struct.type x4` in `redis/src/bio.c`,
  `once_s.begun x2` in zlib's `crc32.c` — where a repeated name is a property of
  the source and not a defect. The counter's definition does not yet match the
  property it is named for: it does not distinguish "two members with one name in
  the SAME struct" (real) from "one name in two DIFFERENT anonymous aggregates"
  (legal C). Stated as an open instrument defect, not as a clean zero.

Full artifact with the per-file rows, the size-band breakdown, the
scaling-by-quartile curve and the load1 reading of each run:
`validation/m12/results/c-corpus-census.json`.

**Line and symbol hygiene, the same run, all at zero:** `unknownKind` 0 ·
`emptyNames` 0 · `placeholderNames` 0 · `membersWithoutOwner` 0 ·
`danglingContains` 0 · `crashFiles` 0 · `edgesWithoutLine` 0 of 312,636 ·
`macroNamedMembers` 0 · `sameSiteDuplicates` 1,867, **all** of one class
(`calls`, same line) that is **not provable** from the payload and is ruled below.

**Hot-path audit, corrected.** This page previously claimed "No O(n²) or
per-symbol O(n) scans". That was false: `indexToLineColumn` walked the whole
content from 0 and its only caller is `recoverFunctionRange`, once per function —
O(n × functions) per file. Measured attribution
(`script/m14/tmp/c-audit/perf-attribution.ts`, three variants of the real
analyzer, median of 3, `redis/src/server.c`, 360,751 bytes / 39,321 nodes, load1
39.3 disclosed):

| variant | median | vs as-is |
| --- | --- | --- |
| as-is (whole-content walk) | 4,809 ms | — |
| line index built once per file | 3,930 ms | −18.3% |
| constant answer (upper bound) | 3,667 ms | −23.7% |

Now true: a line-start index (`Int32Array`, O(n) once per file) plus a binary
search per lookup, keyed on the content so a reused instance cannot answer for
the previous file. Parity was **measured, not asserted**
(`line-index-parity.ts`, every byte offset of every file plus out-of-range probes:
383,195 offsets on redis, 49,365 on libgit2). The first parity run found **36
disagreements, all out of range** — the old walk clamped with `Math.min` and a
negative index ran no iterations — and the clamp was restored until the probe
reported 0. A probe that cannot fail proves nothing; this one found a real
difference in its first attempt.

Two wall-clock perf attempts are on the record as **unscored** rather than
deleted: at `load1` 46–49 one wall series swung 3× *within itself* (3,362–17,039
ms for identical work), which is wider than the effect, and a wall row under that
load is not evidence. The gate therefore measures **CPU ms, minimum of 5 after a
discarded warm-up, interleaved** — the metric that survives contention. Observed
reverted/fixed ratio across scored runs: **1.39×, 1.44×, 1.53×, 1.56×, 1.84×**.

The remaining cost centres, all O(nodes) or better: the single unified DFS with a
pre-pass over the same shape for declared types; per-node lookups against
pre-allocated constant arrays; relationship source resolution in O(depth) via the
scope-manager stack; the layout descent bounded by an in-progress set (this wave —
it was unbounded and crashed).

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/c.json`
  (authority: `manual_audit`; 92 facts: 46 symbols + 46 relationships)
- Result: `validation/m12/results/c-differential.json`
- **That artifact is 13 rows stale, and the drift is measured.** The lane's
  truth-drift probe (`script/m14/tmp/c-audit/m12-truth-drift.ts` →
  `validation/m12/results/c-truth-drift.json`) compares every pinned fact against
  the live analyzer on the four M12 fixtures. Of 92: **80 still produced, 7
  produced under another type, 5 not produced.** Twelve of the thirteen are the
  ARTIFACT's fault — 6 include rows that became the first-class `imports` kind in
  M60/#910, 1 `instantiates` row the allocator branch deliberately removed, and 5
  assignment-LHS rows that the SCD1/CGD1 ruling says are writes rather than reads
  (there is no `writes` relationship type, so the fact is representable nowhere) —
  and a reviewed re-baseline is the owner's call, not this lane's. The
  thirteenth was a **real missing edge**: `rel:Negative.c:references:pick_color:Color`,
  a function's typedef-spelled return type, which CGD34's parent-only gate had
  been suppressing for every such function. Fixed (#935); the probe now reports 80.
- **CORRECTED #964: the differential WAS runnable; the recorded reason was wrong.**
  Three claims in the earlier version of this bullet were false, and running the
  lane is what proved it:
  - `CORPUS_ROOT` does default to another user's home
    (`$HOME/fixtures/repositories`), and it is overridable with
    `BB_CORPUS_ROOT`.
  - The C lane's **primary** corpus is `sqlite` (`LANG_REPOS.c = "sqlite"`), which
    is indeed absent here — but C is **absent from `LANG_REPOS_SECOND` entirely**.
    There is no `jq` second corpus registered for C; that claim was invented.
  - **`--repo` works.** `--repo zig` bypasses the registration check, and `zig` is
    C's own pinned M12 target (`validation/m12/corpus-manifest.json`,
    `analyzer: "c"` → `corpusTarget: "zig"`, 400 tracked `*.c` files over wasm2c,
    musl libc, glibc compat, mingw and freebsd libc). There was a runnable
    configuration the whole time.

  Running it immediately exposed a **real defect, in the ORACLE**. Six of 408
  truth rows were MISSING: `calls (expr) -> MAP_*` in zig's wasi libc `mman.c`.
  These were oracle **fabrications**, not analyzer misses — recovery splices a
  directive's identifier into a real `call_expression` and makes the next line's
  parenthesized expression its argument list:

  ```
  #ifdef MAP_HUGETLB
          (flags & MAP_HUGETLB) != 0 ||      <- no call exists here at all

  call_expression
    identifier    "MAP_HUGETLB"              <- the #ifdef's tested macro
    argument_list "(flags & MAP_HUGETLB)"    <- the NEXT line
  ```

  `#ifdef X` **tests** a macro, it does not invoke one — the analyzer's #956
  ruling, extended by #908/#912. The oracle's USES derivation already guarded
  this with `isDirectiveConditionText`; the CALLS branch did not, so the
  differential was convicting a correct analyzer for six rows. A superset oracle
  trades a fabrication for an unexplained edge, the trade this file already
  refuses in `deriveSvelteComponentUsages`. #964 mirrors the gate.

  **How to run it:**

```
BB_CORPUS_ROOT=$HOME/ishaq/fixtures/repositories \
  bun run script/m14/differential.ts --lang c --repo zig
```

The harness writes no artifact for a scoped `--lang c` run on purpose: `M14.0.F5`
belongs to the canonical 60-file, 40-language sweep, and a scoped run would
replace that claim with a smaller one. `--update-baseline` would pin the drawn
file set (`zig:c` is currently unpinned), but that is a shared-harness decision.

**#964 was wrong the first time, and measuring it is what showed that.** The
first version suppressed directive-spliced callees with the file's existing
`isDirectiveConditionText()`. Over the full corpus that predicate
**over-suppresses**: it holds for any identifier whose ancestor chain reaches a
`preproc_*` node without crossing a statement/declaration, which is equally true
of **real** calls and **real** macro invocations inside `#ifdef` blocks. It ate
15 true rows — `strcmp`, `S_ISREG`, `strerror_s`, `sasl_choose_krb5`,
`curlx_get_winapi_error` — turning them into unexplained edges and trading one
error class for its opposite. That predicate's own comment warns of exactly this:
"the exclusion must not eat CONDITIONAL CODE". The test is now the **physical
line**: a line whose first non-space character is `#`. Real code inside a
conditional is never on a `#` line, so the test is exact and cannot over-reach.

**`calls` is now exactly agreed, in both directions.** Per-file unique
`(label, target)` sets, analyzer against `deriveCCalls`, over **2,600 files**
(curl, libgit2, redis, zig):

| | MISSING (oracle says, analyzer silent) | UNEXPLAINED (analyzer emits, oracle blind) |
| --- | --- | --- |
| `isDirectiveConditionText` (first attempt) | 36 | 15 |
| physical-line test (shipped) | **0** | **0** |

The 36 were the same splicing as the original 6: `calls -> defined`,
`-> AF_INET6`, `-> CURL_DISABLE_PROXY`, `-> USE_SSL`, `-> RLIM_INFINITY`,
`-> HAVE_BORINGSSL_LIKE` and friends — every one an `#ifdef`-tested macro that
recovery fused to the next line's parenthesized expression.

This also **retires the two-file exclusion** `call-edge-fidelity` carried: it
could not account for `curl/lib/http.c` (5,115 lines) and `curl/lib/openldap.c`
(1,387). The tree oracle has no such blind spot, and both files now agree.

## C lane — measured status (authoritative)

Every number here is regenerated by the instruments named beside it, so this
block is the one place to read and the one place to update.

**Census** — `2,498` files / 4,045,683 AST nodes / 0 crashes
(`validation/m12/results/c-corpus-census.json`, `script/m14/tmp/c-audit/census.ts`):

| relationship | edges |
| --- | --- |
| `calls` | 199,929 |
| `uses` | 86,948 |
| `imports` | 10,993 |
| `contains` | 17,396 |
| `references` | 10,538 |
| `exports` | 957 |
| `instantiates` | 5 |

**Performance** — wall 117.3 s, CPU 146.3 s (ratio 1.25),
**46.96 ms/file**, **28.99 ms per 1,000 nodes**
(curl 28.9 · libgit2 42.8 · redis 75.5 ms/file). #977 fixed the census CPU metric,
which double-counted its own baseline and reported **negative** CPU; a perf
instrument that can go negative cannot support a claim, so this was fixed before
any timing was quoted.

**Line numbers** — **442,774/442,774 = 100.000%** of edges name a line containing the
target as a WHOLE TOKEN (#974, `script/m14/tmp/c-audit/line-audit.ts`,
`validation/m12/results/c-line-audit.json`). Whole-token rather than substring
because `uses` is dominated by single-character targets, where `line.includes("n")`
would pass a wholesale off-by-N offset.

**Unknown symbols** — **0** unknown kinds and **0** empty names across all
2,498 files; F1 reports 67 refs, unknown=0, unknownFields=0.

**P11 / no regex** — `src/ast/real-c-analyzer.ts` contains **no regex literals in
code** (#975 removed the last, `/^\d+[uUlL]*$/`, replaced by a character scan proved
equivalent over 4,394 exhaustive + 400,000 fuzz cases). The only remaining mentions
of regex syntax are in comments recording earlier replacements.

**Gates** — fixtures 35/35 · live mutants 41/41, 5 retired · 0 property violations ·
M12 truth drift 92 facts, 85 still-produced, 7 produced-under-another-type,
**0 not-produced**.

### #983: the analyzer references file scope ONLY — parameters and locals are invisible to `uses`

#982's surviving lead turned out to be much larger than one row. Measured:

    int G;
    int add(int a, int b)
    { int loc = a + b; if (loc > G) return loc; return b - a; }

    rels: uses:add->G
    syms: variable:G   function:add(params=2)

`uses:add->G` is emitted for the file-scope global. There is NO use for `a`, no use
for `b`, and no use for `loc` — the LOCAL either. Params are parsed and stored
(`params=2`, matching docs line 39) and then never surfaced. So `uses` resolves
against FILE SCOPE and nothing else: not parameters, not locals.

**Size, measured on 40 curl/lib files, 713 functions:**

    uses EMITTED (file-scope only):        2,844
    distinct parameters referenced:         1,989
    distinct locals referenced:             1,752
    would add:                              3,741   (+131%)

Extrapolated across the census this would roughly DOUBLE the C `uses` count, from
86,948 to something near 200,000. It moves every relationship total, the census,
the performance figures and the oracle comparison at once.

**Two sub-decisions, and the second is the interesting one.**

1. *Should* params and locals be referenced? Semantically yes — `uses:add->loc` has
   exactly the shape of the global case that already works. Low risk.
2. *What is the source name?* The oracle writes `(expr) -> s1`, i.e. it does not
   track the owning function and falls back to a generic bucket. The analyzer's
   existing convention is the FUNCTION NAME (`uses:add->G`), which is strictly more
   informative. If this is adopted, the analyzer should keep `add` as the source and
   the oracle's `(expr)` rows are the weaker claim — adopting them as written would
   move the payload toward a LESS precise form to gain agreement, which is the wrong
   direction.

**Not taken here.** A change that doubles a published relationship count is a ruling
for the lane owner, not a patch for an agent, and sub-decision 2 has a real tradeoff
either way. Recorded with numbers so the choice can be made deliberately.

### #982 CORRECTION: the inactive-code thesis was wrong in both directions

The first version of this section claimed the oracle has no notion of inactive
regions, that `wmemcmp.c` produced no analyzer uses because it is `#if 0`, and that
this set a MISSING FLOOR. Measured, both halves are wrong.

**The analyzer does not skip `#if 0`.** Same body, four different guards:

    plain          rels=3   contains, references, uses
    #if 0          rels=3   contains, references, uses
    #if 1          rels=3   contains, references, uses
    #ifdef NOPE    rels=3   contains, references, uses
    #if 0 / #else  rels=6   contains, references, uses

Identical edge counts either way. tree-sitter-c parses inside the guard and the
analyzer walks it, so "#if 0 is why wmemcmp.c is empty" was never true.

**And these rows were already adjudicated.** This section also re-derived, as a new
finding, a K&R gap that this same file records at line 962: "A local collector fix
for old-style `declaration_list` parameters is real and correct, but every K&R
definition measured in these corpora sits inside `#if 0`, so it moved nothing
(13/16 either way). It is recorded rather than shipped untested." Line 956 further
classifies `s1`/`s2`/`n` as **oracle fabrications** — old-style parameters with no
`function_definition` to attach them to — not analyzer misses.

So the `#if 0` regions are inert for the ANALYZER's count and the reason the oracle
rows persist is that a K&R definition yields no `function_definition` at all. The
oracle having no `#if 0` filter is real, but it is not the cause of these rows and no
MISSING floor was demonstrated.

**What actually survives is one row.** `TlsDtorNode` in
`zig/lib/libc/mingw/crt/tlssup.c` is LIVE (only an `#ifndef WIN32_LEAN_AND_MEAN`
above it), and it exposes something larger than itself: the analyzer models **no
function parameters at all**.

    int add(int a, int b){ return a + b; }   rels: (none)   syms: function:add
    int g; int h(void){ return g; }          rels: uses:h->g

A global reference yields `uses`; a parameter reference yields NOTHING — no `uses`,
and no parameter symbols, despite `docs` line 39 claiming `parameter_list` ->
name/type pairs "stored on function symbols". They are stored and never surfaced.
That is the undecided item, and it is a SCOPE decision rather than a patch, since
every function in the corpus would gain edges.

**The lesson, three times over.** `4e4d43d4` (#981 phantoms), `0c22b03b` (#981
contains) and now this were each written from one observation without first reading
what this file and the analyzer already concluded. Each was individually plausible and
each was wrong. The check that catches all three is the same and cheap: read the
section on the topic, and grep the code, BEFORE writing the mechanism.

### #981: `contains` independent reach reaches curl — and immediately finds two real defects

The clang contains oracle could not read curl or libgit2, so 852/852 was a
redis-only result and two thirds of the corpus had no independent `contains`
evidence. #981 fixed the reach (repeatable `--extra-include` / `--define`, fed by a
real `cmake` configure) and the first honest curl measurement is **not clean**.

At 120 offered files, 22 judged:

    MISSED members 30   PHANTOM members 16

An unstable verdict is not a verdict, so before attributing anything I read the
rows. Both directions turned out to be REAL and to share one root cause, in
`curl/lib/cf-h1-proxy.c`:

```c
struct h1_tunnel_state {
  ...
  enum keeponval {              /* an enum DEFINED INLINE, as a field's type */
    KEEPON_DONE,
    KEEPON_CONNECT,
    KEEPON_IGNORE
  } keepon;
  ...
  BIT(chunked_encoding);        /* a MACRO-WRAPPED field */
  BIT(close_connection);
```

### #981 ruling: a macro argument inside a field declaration is dropped entirely

Before patching, the four adjacent shapes were measured so the ruling rests on
what the analyzer already gets right:

    struct S { int nsent; BIT(chunked_encoding); };   contains:S->nsent
    struct S { int nsent; MYINT foo; };               contains:S->nsent  contains:S->foo
    struct S { int nsent; union { int a; float b; } u; };  contains:S->nsent
                                                            contains:S->u  contains:S.u->a
    void f(void){ BIT(chunked_encoding); }            calls:f->BIT

The tree-sitter shape for the first is
`field_declaration > macro_type_specifier > type_descriptor > type_identifier`,
so the field NAME sits inside a macro ARGUMENT. Consequences:

* `MYINT foo` already works, because there the macro is the type and `foo` is a
  sibling `field_identifier`. Only the "name nested in the macro argument" shape
  loses the name.
* An anonymous union field is handled correctly and mints `S.u`.
* The fourth line is the wider finding: a macro invocation in a BODY emits
  `calls:f->BIT` but no `uses` for its argument, so #908's "a real macro invocation
  pairs `calls` + `uses`" is only half-implemented today.

**This was already ruled, and the code says so.** Before writing this section I
should have grepped first. `fieldDeclarationHasDeclarator` at
`src/ast/real-c-analyzer.ts:654` already encodes the decision, with this exact
example in its comment:

    #define BIT(x) int x : 1
    struct flags { int a; BIT(closing); BIT(keepalive); int b; };

and already fixed a live corruption it caused — `curl/lib/cf-h2-proxy.c` emitted
`cf_h2_proxy_ctx.BIT` five times and `tunnel_stream.BIT` three times, publishing the
MACRO'S OWN NAME as the member, and computed the struct's `memorySize` from a field
that does not exist. The existing ruling is silence, for the same reason given
below: whether the macro's parameter lands in name position is a property of its
REPLACEMENT list, which is C-D2's ruled-out territory.

So the `contains` half below is not a new decision — it re-derives a settled one, and
the 30 oracle misses were ALREADY a declared limitation before this section existed.
Recorded as such rather than left looking like fresh work.

**Ruling.** Two claims with different warrant, resolved differently:

1. `uses:S->chunked_encoding` is the only genuinely NEW claim here. The identifier
   occurs in the declaration, and #908 treats macro arguments as real uses, so the
   `uses` edge is weaker than `contains` and survives even where ownership does not.
   It is NOT yet implemented, and it must be adjudicated against the existing choice
   of silence rather than assumed to be free — case 4 shows a macro invocation in a
   BODY also emits no `uses` for its argument, so a general rule would touch every
   macro call in the corpus and needs its own measurement.
2. `contains:S->chunked_encoding` is NOT provable. `contains` asserts the struct
   OWNS the member, which is only true if `BIT` expands to a bitfield whose name is
   its argument. That expansion is exactly what C-D2 forbids, and a macro that took
   two arguments or renamed its parameter would make the edge false.

So claim 1 ships, claim 2 does not. The oracle's 30 misses become a DECLARED LIMIT
in the same shape as #963's typedef-return marker loss: real, measured, named, and
deliberately unclaimed rather than fabricated to close the gap. Expanding `BIT` in
the payload would mean carrying macro definitions into every compile unit, which
C-D2 exists to prevent.

**Under-emission (the 30 misses).** `chunked_encoding`, `close_connection`,
`maybe_folded`, `leading_unfold`, `udp_tunnel` and the rest are `BIT(...)` fields.
`BIT` is a curl macro that expands to a bitfield declaration, so the field name sits
inside a macro argument and the analyzer publishes no `contains` member for it.
clang sees the expanded struct and does. Every macro-wrapped struct field is
invisible to the payload.

**Over-emission (the 16 phantoms) — and the first explanation of this was WRONG.**
I initially recorded these as "an inline `enum {...} field;` inside a struct
flattened onto the struct's owner". A minimal repro refuted that immediately: the
analyzer gets `enum keeponval { ... } keepon;` right, publishing
`contains keeponval -> KEEPON_DONE` with `owner=keeponval`. The real mechanism is
name collision, in `curl/lib/cf-h1-proxy.c`:

```c
typedef enum {                    /* an ANONYMOUS enum with a typedef alias */
  H1_TUNNEL_INIT,
  H1_TUNNEL_CONNECT,
  H1_TUNNEL_RECEIVE,
  ...
} h1_tunnel_state;                /* the alias is `h1_tunnel_state` */

struct h1_tunnel_state {          /* a STRUCT with the SAME NAME */
  ...
};
```

C keeps typedef names and struct tags in **separate namespaces**, so both
declarations are legal and both are called `h1_tunnel_state`. The analyzer mints the
anonymous enum's owner name from the alias, so it publishes
`contains h1_tunnel_state -> H1_TUNNEL_INIT` — an edge that is TRUE of the typedef
alias and FALSE of the struct that shares the name. A consumer resolving
`h1_tunnel_state` as a container gets a struct with six phantom members.

So this is not over-emission and not flattening. It is an **ambiguous owner**: the
`contains` target does not identify which of two same-named C declarations owns the
member. It is the same root problem #961's qualification solved for colliding type
NAMES (`lpRandomEntries.pick`), arriving through the typedef/tag namespaces instead
of the function-local scope. Recorded here because the wrong explanation was
committed first and a minimal repro is what caught it.

So the oracle is SOUND on curl — it found two genuine defect classes that no other
instrument could see, precisely because it is a different implementation reading
one tree. Both are recorded here rather than fixed in this pass, because each needs
its own fixture, mutant and ruling: the `BIT(...)` case is a macro-expansion
SEMANTIC decision, and the phantom case is a NAME-RESOLUTION decision about which of
two same-named C declarations owns a member. Neither is a mechanical patch.

**libgit2 remains blocked**: `src/git2_util.h` is generated at BUILD time, so it
needs `make`, not only `cmake`.

### #965–#970: the C `uses`/`references` oracle, and what remains in it

Six rounds, each one a case where the ORACLE was the stale side. Every fix was
found by measuring the residual and classifying it, never by reading the
analyzer and adjusting the oracle to agree.

| round | change | UNEXPLAINED | MISSING |
| --- | --- | --- | --- |
| start | — | 3,937 | — |
| #965 | oracle enforced the **withdrawn** SCD1 write-gate on field access | 230 | 15 |
| #966 | oracle gated enum members on file scope — stale since **#961** | 142 | 15 |
| #967 | oracle enforced the same withdrawn write-gate on the **identifier** path | **16** | 15 |
| #969 | keywords admitted as declared names (`uses void`, `references struct`) | 16 | **13** |
| #970 | **REJECTED on measurement** — see below | — | 1,048 |

All figures are over 2,600 files (curl, libgit2, redis, zig), all four labels the
C differential compares, per-file unique `(label, target)` in both directions.

**#967 was the big one and was found by tracing, not guessing.** Every admission
sub-condition was satisfied at the declaration (`curl/lib/easy.c:110`,
`translation_unit > declaration > init_declarator`), so the name *was* in
`declaredNames` — but the two assignment-LHS occurrences never reached the read
branch, because the branch itself was gated `n.type === "identifier" &&
!isAssignLhs(n)`. Since #960 a write to a declared name IS a `uses`, and in real
C most file-scope variable reads ARE assignments, so that clause was suppressing
the majority of the global-variable rows.

**#970 is recorded because it was WRONG, and measuring caught it.** The hypothesis
was #908's pairing (a real macro invocation yields both `calls` and `uses`).
Mirroring it for every function-like macro took MISSING from 13 to **1,048**, so
the analyzer does not pair generally. The real shape is much narrower:

```
redis/deps/lua/src/lua_bit.c:99   #define BIT_OP(func, opr) \
                                    static int func(lua_State *L) { ... }
redis/deps/lua/src/lua_bit.c:103  BIT_OP(bit_band, &=)      <- a macro
                                                                     INVOCATION
                                                                    that DEFINES a
                                                                    function
```

The macro name is a *use* because the invocation is the heading of a generated
function definition — not because macro invocations pair in general. Mirroring
that narrowly needs the replacement list, and it is a boundary question about
#908 rather than a mechanical gap. **Not done.**

**The 16 remaining UNEXPLAINED are five distinct families**, all classified:

| family | rows | example |
| --- | --- | --- |
| macro-invocation-as-definition heading | ~8 | `uses BIT_OP` (lua_bit.c:103) |
| parenthesised declarator name in a heading | 1 | `uses global -> luaL_register` (lauxlib.c:229, `void (luaL_register)(...)`) |
| gcc attribute token | 2 | `uses ctor -> constructor` (thread.c:92, `__attribute__((constructor))`) — **no symbol exists**, so this is a dangling edge |
| `references` to types in positions the oracle does not derive | 4 | `references ULONGLONG` (version_win32.c:48,127) |
| member name inside `offsetof(...)` | 1 | `uses ts` (ioctl.c:67) — a member named at TYPE level, arguably not a value read |

Three of these look like **analyzer** defects rather than oracle gaps: a `uses`
on a function heading's own name, a `uses` to a name with no symbol
(`constructor`), and a value `uses` for a member named inside `offsetof`. They
are unadjudicated.

**The 13 remaining MISSING are oracle fabrications**, in three groups: reads of
names declared inside `#if 0` (dead code — zig's mingw-w64 K&R runtime, where
`s1`/`s2`/`n` are old-style parameters with no `function_definition` to attach
them to), typedef aliases recovered as identifiers (`typedef struct md5_ctx
my_md5_ctx;`), and external types the file does not declare (C-D2).

**A K&R gap was found and deliberately left.** A local collector fix for
old-style `declaration_list` parameters is real and correct, but every K&R
definition measured in these corpora sits inside `#if 0`, so it moved nothing
(13/16 either way). It is recorded rather than shipped untested.

### Cross-lane reverts: a process finding, twice

`script/m14/differential.ts` is shared and has now silently reverted c-lane work
**twice**, both times by a commit in a different lane:

- `4f5df8fd` — *"m14(csharp): fsharp is EXHAUSTIVELY clean"* — deleted all of
  #966 (61 deletions).
- `f4758f59` — *"fix(rust): two label gaps the coverage census found"* — deleted
  `C_KEYWORDS`, all of #969.

Both were caused by staging the whole file from a base that predated the c-lane
commit. Neither commit shows the deletion in its subject. The `--commit-tree`
helper (`script/m14/stage-shared.sh`) commits exact blobs without touching the
shared index, which prevents an agent from *accidentally* clobbering others — but
it does not stop an agent who has a stale working tree from staging the whole
file. **This needs an owner decision, not another workaround**: either a per-lane
fork of the differential oracles, or a pre-commit check that a staged hunk does
not silently delete another lane's committed code.

### What is still open, and it is NOT an analyzer defect. The differential
compares four labels for C (`calls`, `uses`, `references`, `imports` —
`differential.ts` allowlist), and `deriveCCalls` derives all four. Over the same
2,600 files, `uses` alone leaves **3,937 analyzer edges unexplained**, heavily
weighted to curl (`uses tv_sec`, `uses sockfd`, `uses ptr`, `uses settings_id`
— ordinary field and value reads). `deriveCCalls` derives `uses` only for a
narrow subset of identifier positions, so this is the oracle being **blind**, not
the analyzer inventing edges — the distinction the harness itself draws at its
`unexplained` counter ("the signal that says the truth is blind, not that the
analyzer invented something"). The `zig:c` sample reports only 1 missing / 7
unexplained because the cold pool draws from zig, where the gap is far smaller.
**A complete C `uses` oracle is the next real piece of work**, and it is an
oracle task, not an analyzer one.

Measured on `zig:c`, 60 files (the cold pool rotates the sample, so counts move
between runs — the direction does not):

  | | truth | covered | MISSING | unexplained |
  | --- | --- | --- | --- | --- |
  | before #964 | 408 | 402 (98.5%) | 6 | 34 (7.8%) |
  | after #964 | 387 | **387 (100%)** | **0** | 8 (2%) |

  What remains: the **stale artifact**. `c-differential.json` still records **39
  of its 65 input hashes as stale** — including `src/ast/real-c-analyzer.ts`
  itself (recorded `091f9498bd`) and 30 other lanes' analyzers — so it describes
  a tree that no longer exists, and **no script in the tree writes it by that
  name**, so its producer is absent. Writing a fresh one under that name is an
  owner decision, not this lane's. **The M12
  differential is a FIXTURE differential, though** — `truthSource: manual_audit`
  over `validation/m12/fixtures/c/*.{c,h}` — which is why the drift above is
  measurable here at all, and that is the argument for keeping the fixture-based
  probe as the lane's standing check on its own pinned truth.
- **The truth is itself mis-pointed on `uses`, and that is a finding, not a
  cleanup.** Of the 5 unproduced facts, 3 are field accesses whose struct is
  declared in another file (`uses:buffer_create:capacity/length/data`) — **C-D2
  forbids resolving those**, so the analyzer is right and the truth asks for
  something the declared limit forbids. The same fixture's `point_distance` does
  `a->x` on an equally cross-file `Point` and the truth pins **no** row for it, so
  the truth is inconsistent with itself on identical constructs. The 2 remaining
  rows (`uses:module_init:initialized`, `uses:module_shutdown:initialized`) are
  assignment targets, i.e. the write-vs-read question below. **Fixing the analyzer
  to satisfy these 5 rows would have broken correct code.**
- **This wave's change is byte-identical on the M12 fixtures**: the previous
  commit's analyzer and this one produce identical relationship sets on
  `Module.c`, `Module.h`, `Negative.c` and `module_config.h`, so none of the
  drift above is attributable to it.

## Field-access `uses`: adjudicated against the parse

`script/m14/tmp/c-audit/field-access-uses.ts` compares every field-access `uses`
edge against the parse, per (field name, line), in both directions — the same
instrument shape as `call-edge-fidelity.ts`, applied to the second-largest
relationship class. Measured over 200 files per corpus:

| corpus | files | parse accesses | payload field `uses` | over-emitted |
|---|---|---|---|---|
| `redis/src` | 200 | 42,344 | 4,602 | **0** |
| `curl/lib` | 200 | 11,037 | 1,019 | **0** |
| `libgit2/include` | 93 | 0 | 2 | **0** |

**Zero over-emissions in the direction the probe can convict.** A `uses` edge to a
field with no field access on that line is wrong under any reading, and there are
none. `uses` is sound in that direction at corpus scale, which no fixture-scale
oracle could have told us.

### What the probe cannot convict, and why that is stated rather than counted

The probe does **not** claim a defect count for the miss direction, and the number
it prints for that bucket (14,802 on `redis/src`) is explicitly labelled as *not* a
defect count. The payload resolves a field only by typing the base expression —
reading the local's declared struct and walking the chain. The probe has no such
resolution, and its test ("a field of that name exists somewhere in this file") is
far weaker, so nearly every access through a pointer whose struct lives in another
file lands in that bucket as a false accusation. C-D2 forbids the payload from
resolving those. Measuring the miss direction honestly needs the payload's own
owner attribution, which is the thing under test. The first draft of this probe
called 14,637 of them defects; the number was meaningless and the probe now says
so in its own output.

### The write-target gap, measured and characterised

One construct is provably and consistently omitted, verified in isolation across
every form:

| form | `uses` published |
|---|---|
| `return p->f` | yes |
| `p->f++` | yes |
| `if (p->f)` | yes |
| `p->f + p->g` | yes |
| `p->f[0]` | yes |
| `(*p)->f` | yes |
| **`p->f = v`** | **no** |

Measured write targets with no edge: **4,125** (`redis/src`, 200 files), **826**
(`curl/lib`, 200 files). This is a **contract disagreement, not a defect**: the
M12 truth pins `uses:buffer_create:capacity` for `buf->capacity = clamp(...)`, a
write, so truth says a write is a `uses` and the analyzer says it is not. There is
no `writes` relationship type in the ontology, so the fact is currently
representable nowhere. **This is an open decision, and it is the owner's call** —
see the two open questions below. `c/field-access-offsetof-955` records the
analyzer's current behaviour in a `forbidRelationships` row without settling it, so
whichever way it is decided, the fixture changes rather than the code silently.

### Macro-argument field names: correct, and now pinned

`redis/src/cluster_legacy.h:268-284` is seventeen consecutive
`static_assert(offsetof(clusterMsg, <field>) == N, ...)` lines. There is no `->` and
no `.` — the field is a bare identifier in a macro argument, so the parse has no
`field_expression` for it, and the payload publishes the correct edge anyway:

```
uses global -> sig  @268  {"relationshipType":"identifier_usage","nodeType":"field_identifier"}
```

The probe's first run reported all of these (74 across `redis/src`) as phantom
over-emissions, and *"a field name at file scope is not a use of anything"* is a
plausible-looking fix that would have deleted the only record that those fields are
load-bearing. This is **#908's failure mode one relationship type over** — there
macro-named *callees* were nearly suppressed, here macro-argument *field names*
were — and the M12 truth cannot catch it, because the truth pins `uses` only for
`a->x` and says nothing about a field named in a macro argument. Hence
`c/field-access-offsetof-955` plus the `c/field-name-in-macro-argument` mutant:
a correct behaviour with no fixture is a behaviour one refactor away from being
removed as a bug.

The same fixture also pins the limit in the other direction: `HEADER_SIG(h)`
publishes `calls header_sig -> HEADER_SIG` and does **not** resolve the macro *body*
to the field. Expanding `((h)->sig)` to reach `sig` is macro-body resolution, which
this lane does not perform.

## Relationship oracle status

Correcting a claim made earlier in this lane's own history: `contains` is **not**
unaudited. The M12 truth carries 16 hand-audited `contains` facts, and they are
checked by `m12-truth-drift.ts`. What the relationship types lack is **corpus-scale**
verification, not any oracle at all:

| type | emitted | fixture oracle | corpus oracle |
|---|---|---|---|
| `calls` | yes | 4 facts | `call-edge-fidelity.ts` (measured) |
| `uses` | yes | 17 facts | `field-access-uses.ts` (this wave) |
| `contains` | yes | 16 facts | `contains-vs-clang.ts`, 852 members on redis (this wave) |
| `imports` | yes | 6 facts | none |
| `references` | yes | 8 facts | none |
| `exports` | yes | via `c-completeness` + `exports-marker-conventions-963` | none (typedef-return-type shape is a declared grammar limit, pinned as `forbidRelationships`) |
| `instantiates` | yes (#962) | 1 fact, `unmetUnder: C-D2` | n/a |

### `contains` against clang, and two real defects it found

`script/m14/tmp/c-audit/contains-vs-clang.ts` judges every `contains` edge against
**clang 14** — a different parser with a different recovery strategy, so agreement is
evidence rather than a tautology. This matters because the `calls` and `uses` probes
judge the payload against **tree-sitter, the same parser the analyzer uses**: they are
sound about emission and structurally blind about a member the grammar never produced.
A payload and the grammar that produced it always agree, and that agreement is not
evidence about the grammar.

Measured on `redis/src` (150 files offered): **144 judged**, 6 not measurable with a
named reason each. **144 records, 852 members, 94.95% agreement, 1 phantom, 43 missed.**

The single largest gain in the oracle's reach came from a **flag, not a fix**: under
strict `-std=c11` the POSIX declarations are hidden, so 53 of 150 sampled redis files
died on one line — `server.h:2808: field has incomplete type 'struct timeval'` — and the
oracle reported a 13% reach that was really a choice of `-std`. Under `-std=gnu11`,
which is what redis's own build uses, those 53 files parse. **A measurement of "how much
of this corpus can clang read" that is really a measurement of which `-std` was passed is
not a measurement of the corpus.** Reach went 20 files → 144, members 322 → 852.

**All 43 misses are the CGD20 class** — `listpack.c:1920 pick`, `module.c:4590
KeyMetaConfAllVersions`, and `module.c:7568 typemethods.v2`–`v5`. The wider oracle found
**no new defect class**, which is the useful result: a 2.6× wider instrument returned the
same answer. The 1 phantom is `eventNotifier -> pipefd`, published by this lane's own
#957 fix for the `#else` arm of a conditional the build did not take.

**curl and libgit2 remain at 0 records, and the reasons are structural rather than a
missing flag.** curl's headers are generated by `configure`, and each `-D` that fixes one
complaint exposes the next: without `SIZEOF_CURL_OFF_T` every file dies on
`curl_setup.h:537: "too small curl_off_t"`, and *with* it curl defines its own
`struct timeval` which then collides with glibc's at `curl_setup.h:850`. Reproducing
that means reproducing configure's ~200 probes, after which the number would be a
property of my flag set rather than of the corpus. libgit2 ships `git2_features.h` only
as a `#cmakedefine` template, so the probe synthesises it with every option **undefined**
— the no-optional-backends configuration — and says so in its output, because a template
is a configuration *choice* and pretending otherwise would measure a different program.
That clears 57 of 60 files; the rest stop at a cross-header typedef ordering a
single-file compile cannot satisfy. Neither is fixed by loosening a threshold. Reach is reported, never assumed, and every
unmeasurable file carries a named reason — the probe was built after a first version
returned a bare `null` and reported curl as "0 of 100 measurable, no diagnostic",
which reads exactly like a clean result.

**Two genuine defects, both invisible to every tree-sitter-based counter:**

1. **#957 — a member inside a preprocessor conditional was never published.**
   `struct eventNotifier { #ifdef HAVE_EVENT_FD int efd; #else int pipefd[2];
   #endif }` (redis/src/eventnotifier.h:19-25) parses with the `preproc_ifdef` as a
   DIRECT child of `field_declaration_list` and **no `field_declaration` at that
   level**, so iterating named children found nothing. The struct was published with
   a symbol and **zero** `contains` edges. The member extractor now descends into both
   arms. A conditional member is a real member — the project compiles with one arm and
   the struct is unusable without it — and since the preprocessor is textual (C-D2) the
   payload publishes **both** arms, the honest superset.
2. **#958 — a nested member of an anonymous aggregate got a placeholder owner.**
   `struct R { union { const char *str; struct { const char *str; const char
   *format; } verbatim_str; } val; }` (redis/src/call_reply.c:30-38) published
   `CallReply.val.verbatim_str.str` under the owner path **`anonymous_union.verbatim_str`**,
   because `inlineAggregateOwnerName` asked the *union* for its name and an anonymous
   union has only the placeholder. The correct path composes from the member that
   carries the outer aggregate: `R.val.verbatim_str`.

**The probe needed five corrections before it could convict anything, and in every
case the analyzer was right and the probe was not:**

- It compared clang's **whole translation unit** against a per-file payload, so it
  reported 7.40% agreement and 1,001 "missed" members in files that declare no type at
  all (`adlist.c` defines no record; `list` lives in `adlist.h`).
- It **flattened** nested anonymous aggregates into the parent, when the payload
  publishes them owner-qualified — 39 phantom misses on `bio_job.fd_args -> type` and
  its five siblings, every one of which the analyzer had published correctly.
- It then looked for the naming `FieldDecl` **inside** the anonymous record, when clang
  emits it as the **next sibling** — which turned those 39 into 37 *phantom* members.
- Its include roots were a fixed list from `DIR/..`, so `deps/lua/src/lua.h` was
  missing and 67 of 100 files were unparseable for a header that **exists**.
- The root scan was **unbounded**, walking out of `redis/` into the sibling
  `abseil-cpp` and putting an unrelated C++ tree on the include path.

That is ten confident wrong numbers across this lane's instrumentation, and the
containment check, the owner-path key, and the named-reason reporting are all
consequences of the pattern rather than of the individual rows.

`extends` / `implements` / `overrides` are absent by ruling (C-D1, no class
hierarchy). `instantiates` is the one C-specific type the truth asks for and the
analyzer does not emit, and that is the second open question below.

### #961: a function-local type is a compile-time type, and it is published

**Ruled, not open.** CGD20 (real-c-analyzer.ts:1512) read
`if (scopeManager.isInsideFunction()) break` as *"function-local struct definitions are
execution artifacts (C-D1) — no scope, no symbol, no field registration."* That reading
does not survive contact with C. **A struct definition emits no code.** The local
*variable* is the execution artifact; the type is a compile-time fact whose *visibility*
the block merely limits.

Measured: **20 function-local named types carrying 65 members across 15 files, none
published.** They are used, not decoration — `deps/jemalloc/test/unit/malloc_io.c:14`
`struct test_s` (6 members, 4 references), `src/ebuckets.c:2230` `struct TestParams` (the
benchmark's parameter table), `src/listpack.c:1920` `struct pick`,
`src/module.c:4590` `KeyMetaConfAllVersions`, `src/module.c:7568` `typemethods.v2`–`v5`.

**The decisive argument was in this lane's own output.** The payload already published
`uses local_type_in_use -> index` and `-> order` — uses of members of a type CGD20
declined to declare. Those edges were unresolvable: the only way to resolve `index` was
the declaration that had been suppressed. A lane that will not publish a type is not
consistent about declining uses **of** it.

**The name is qualified by the enclosing function, because the bare name does not
survive the corpus.** 3 of the 20 collide with a file-scope type — `transfer`
(`curl/lib/vssh/libssh2.c:3465`), `entry` (`curl/tests/libtest/lib1915.c:35`),
`clar_counter` (`libgit2/deps/clar/clar/counter.h:86`). So a local type publishes as
`lpRandomEntries.pick`. Every step of that path is a real symbol, so a `contains` edge
anchored on it resolves — which is what distinguishes it from the block-scope naming the
contract forbids (`block_1920` names nothing).

**CGD20's original concern was right, and the qualification fixes it at the cause.**
CGD20 cited member leakage (`BackupSubCommandEnum`, `MB_enum`). That happened because an
anonymous local enum published as the **placeholder** `anonymous_enum` with its members
owned by that placeholder — two symbols with one name in a file, and file-scope
EnumMembers. `c/macro-wrapped-heading-917` pinned the *symptom* (three forbids on
`BufSize`, `PlainSize`, `anonymous_enum`). Qualifying the type fixes the leak: the members
are now owned by `cmpp_stream` and `plain_stream`. Those forbids were replaced with
positive rows asserting the correct shape, and `anonymous_enum` **stays forbidden** — the
placeholder is still wrong, it simply is no longer needed.

**Result: `contains` against clang is 852/852 = 100.00%, 0 missed.** The oracle had to
be updated for the naming, and the update is itself the point: it keyed on clang's bare
tag and so reported all 31 newly-published local members as missing — a miss the oracle
invented by demanding the *less* precise name, which is the #958 defect mirrored. It now
matches a payload owner against clang's path by **suffix**.

`c/function-local-type-959` — written while this was open, deliberately asserting neither
way — now pins the settled behaviour.

### CGD20 as it stood (superseded by #961)

Adjudicating the last two `contains` misses from `contains-vs-clang.ts` —
`listpack.c:1920`'s `struct pick` — turned up a **class**, not an instance. CGD20
(real-c-analyzer.ts:1512) reads:

```
// CGD20: function-local struct definitions are execution artifacts
// (C-D1) — no scope, no symbol, no field registration.
if (scopeManager.isInsideFunction()) break
```

Measured over the three declared corpora: **20 function-local named types carrying
65 members, across 15 files, none published** — 7 in redis (41 members), 12 in curl
(23), 1 in libgit2 (1). The instances that make the ruling matter are **used, not
decoration**: `deps/jemalloc/test/unit/malloc_io.c:14` `struct test_s` (6 members, 4
references), `src/ebuckets.c:2230` `struct TestParams` (the parameter table for the
benchmark below it), `deps/jemalloc/src/ctl.c:990` `struct container_s`.

"Execution artifact" does not survive contact with C. A struct definition emits no
code. The **local variable** is the execution artifact; the struct is a compile-time
type definition whose *type* is fully determined, and the block merely limits its
*visibility*. Under the current rule a consumer cannot answer how large the type is or
who reads its members.

**The sharpest evidence is in this lane's own output.** The payload already publishes

```
uses local_type_in_use -> index
uses local_type_in_use -> order
```

— uses of members of a type it declines to declare. Either the type is a real type and
belongs in the graph, or those edges are dangling, and both cannot be right at once. A
lane that declines to publish a type is not consistent about declining to publish uses
**of** it. (A first pass counted two curl types as published; re-checked, that was a
member name coinciding with the type name — 0 of 20 are published.)

**Not fixed here, deliberately.** CGD20 is not a C-local slip. It is mirrored at three
sites in the shared `script/m14/differential.ts` (struct, enum and typedef branches)
and cited by name in the cpp lane's documentation, so un-mirroring it changes what the
oracle expects in every lane that has a function-local type. That is a contract change
with an owner, not a defect fix with a fixture.

`c/function-local-type-959` records the measurement, the evidence rows and the controls,
and deliberately puts `contains local_type_in_use -> index` in neither
`expectRelationships` nor `forbidRelationships`: asserting it either way would encode a
decision that has not been made. The controls pin what must not move — file-scope
structs, typedef'd anonymous structs, function-local **variables** (C-D1 is right about
those), and file-scope members read from inside a block that also declares a local type.

### The three open questions, all now ruled

**#960 — is a write to a field a `uses`? YES.** SCD1/CGD1 said no ("a WRITE, never a
read") and the exclusion is withdrawn, on two grounds. The analyzer was **already
inconsistent with itself**: `p->f++` published a `uses` while the semantically identical
`p->f += 1` did not, because the grammar folds compound-assign into `assignment_expression`
and `++` is an `update_expression`. And the pinned M12 truth demands the edge
(`uses:buffer_create:capacity` for `buf->capacity = clamp(...)`). All **five** facts the
truth reported as not produced were assignment targets; both branches fixed, the truth is
now **0 not produced**. Corpus `uses` 74,129 → 86,982.

The edge is not relabelled a read — the ontology has no `writes` kind, so before, the fact
was an *absence*; now it is represented once.

**#961 — is a function-local type an execution artifact? NO.** It emits no code; the local
*variable* is the artifact. 20 types / 65 members were unpublished. Published, qualified by
the enclosing function (`lpRandomEntries.pick`) because 3 of 20 collide with file-scope
names. CGD20's real concern — member leakage — was fixed at the cause: the members are now
owned by real symbols instead of the `anonymous_enum` placeholder. Result: `contains`
against clang is **852/852 = 100.00%**.

**#962 — does `instantiates` target `malloc`? NO, it targets the TYPE.** All 25 M12 truths
that pin an `instantiates` edge target a **type** (`Point`, `User`, `List`,
`MemoryStorage`); C's `-> malloc` was the only non-type target in the family and could never
resolve. The type is read from the cast and from `sizeof`, which disagree about which
carries it. An untyped `void *` allocation publishes nothing — there is no type to
instantiate. The truth row is retargeted `-> Buffer` and recorded `unmetUnder: C-D2`
(`Buffer` is in Module.H).

**#963 — what does `exports` point at, and which markers count? At the NAME and
the marker, and all of them.** The relation fired **zero times in 2,798 corpus
files** while the M12 truth family expects a populated `exports`, for three
independent defects — each one alone sufficient to make it wrong:

1. **The marker list held only kernel macros.** `EXPORT_SYMBOL` and friends were
   listed; three userspace codebases spell the same boundary as `CURL_EXTERN`
   (curl, 163 markers), `GIT_EXTERN` (libgit2, 955) and `REDISMODULE_API`
   (redis, 401). None was recognised, and none of the three kernel macros appears
   in any of them.
2. **Only the CALL spelling was handled.** `EXPORT_SYMBOL(my_fn, GPL);` is a
   `call_expression` and reached an export branch. The userspace spelling is a
   **prefix on an ordinary declaration** — `CURL_EXTERN int curl_strequal(...);`
   — which reaches no export branch at all.
3. **The target was fabricated.** The kernel edge pointed at a synthesised
   constant **`KERNEL_EXPORT`**, a name written in no source file anywhere, and
   `c-completeness` pinned it as if it were ground truth. This is the same
   fabrication class #962 removed from `instantiates` (`-> malloc`): the target
   must be something a consumer can resolve.

**The ruling.** The source is the **declared name** and the target is the
**marker macro as written**. Both halves are forced. The name cannot be the
macro's argument, because in every prefixed form the argument *is the return
type* — `GIT_EXTERN(int)` would publish `exports int -> GIT_EXTERN`, a **type as
an exported name**, which is precisely the defect #962 corrected. Only in the
kernel call form is the argument genuinely the name, so only there is it used.

**All four conventions that survive the parse now emit**, pinned by
`c/exports-marker-conventions-963`:

| convention | example | corpus |
| --- | --- | --- |
| kernel call form | `EXPORT_SYMBOL(kernel_exported_symbol, GPL);` | 0 in these corpora — the kernel macros appear in none of them |
| userspace prefix | `CURL_EXTERN int curl_strequal(const char*, const char*);` | curl 37 |
| paren form (argument = return type) | `GIT_EXTERN(int) git_libgit2_version(int *out);` | libgit2 907 |
| bare token (expands to nothing) | `REDISMODULE_API int RedisModule_Alloc(int);` | redis 14 |

Corpus total **958**, up from 0. Audited corpus-wide: **947/957 (98.96%)** of
the sources resolve to a symbol in the same payload.

**The marker is read from `macro_prefixed_type_specifier`, not from
`namedChild(0)`.** That node — added by the #743 grammar wave — is what carries
a macro prefix, and its **first child is a `macro_specifier`** holding the macro
name:

```
declaration
  macro_prefixed_type_specifier
    macro_specifier "CURL_EXTERN"
    primitive_type    "int"
  function_declarator "curl_strequal(...)"
```

Testing `namedChild(0).type === "identifier"` finds nothing and leaves the
relation at zero even with the macros listed; that was the second dead end here.

**Two traps, pinned under `forbidRelationships` so they cannot regress silently:**

- **The self-reference.** When recovery splits a multi-line declaration, the
  declarator walk reaches the marker itself and publishes
  `exports CURL_EXTERN -> CURL_EXTERN`. An exported name can never *be* the
  marker, so the walk rejects it. This cost exactly one phantom
  (958 → 957).
- **The recovered typedef.** In the broken declaration the walk's fallback node
  is the return type, so a rule stopping at the wrong node publishes
  `exports CURLcode -> CURL_EXTERN`.

**DECLARED GRAMMAR LIMIT — a typedef return type.** With a typedef after the
marker, `macro_prefixed_type_specifier` does not form and the declaration
degrades to two tokens:

```
CURL_EXTERN CURLcode curl_mime_type(char *mime);
declaration
  type_identifier "CURL_EXTERN"   <- the marker, absorbed as a type
  identifier      "CURLcode"      <- the return type, as a declarator
;
```

Marker and name are **both** destroyed; the exported name survives nowhere in
the tree. Recovering it would mean reading text rather than structure, so no
edge is published and none is claimed. Pinned as a `forbidRelationships` entry so
it stays visible. **This is a grammar reach limit, not an analyzer defect, and
it is the one shape `exports` cannot cover.**

**Gate.** `c/exports-name-is-the-macro-argument` reinstates all three defects at
once; live mutants **39/39**, 5 retired, 0 property violations, F1 67 refs with
0 unknown, fixtures **33/33**.

### The two measurements that remain limited

1. **Is a write to a field a `uses`?** The truth says yes, the analyzer says no,
   4,951 measured instances in 400 files. Either the analyzer grows the rule or
   the truth drops 3 rows. There is no `writes` type, so "neither" is also a
   defensible answer that needs recording.
2. **`instantiates`:** re-add the C allocation semantic the M12 truth defines
   ("allocator calls — C-specific"), or amend the truth and record the ruling.
   Right now the oracle wants a relationship the analyzer refuses, with no decision
   on the record.

## Call edges in preprocessor directive conditions (#956)

A `call_expression` on a preprocessor **directive line** is directive text, not
code. `#if !defined(A) && !defined(B)` never executes and `defined` is a
preprocessor *operator*, not a callable name, so `calls global -> defined` is a
fabricated edge.

`call-edge-fidelity.ts` measured **61 over-emitted call sites** over 200 files per
corpus, every one of them this shape — `curl_trc.c:554/575/590/598`,
`protocol.c:92/120/147`, `http.c:690-692/735-739/822`, `openldap.c:936-937`,
`cf-ip-happy.c:76/79`, `curl_sha512_256.c:303`, plus 7 in redis.

The class survived because **the `uses` path has refused it since CGD40 and the
`calls` path had neither guard**. The guard existed on the sibling branch and nobody
asked why the two differed.

### The guard, and the regression the first version caused

The fix is `this.isHashLineMention(node)` — a call whose physical line starts with
`#` is directive text whatever its ancestors say. Two things were wrong on the way
there and both are recorded because each is a way this lane's own instruments lie:

1. **The first guard used `isDirectiveConditionText(node) || isHashLineMention(node)`
   and suppressed 15 REAL calls.** `curl_sasl.c:531-545`, `cfilters.c`, `strerr.c`;
   agreement fell 99.97% → 99.89%. The reason is structural: a `preproc_ifdef` owns
   both its condition **and** its guarded body, so walking up from a call inside the
   body reaches the preproc node. Measured ancestor chain for
   `curl_sasl.c:534 sasl_choose_gsasl(data, &sctx)` — real code on a line that does
   not start with `#` — is `ERROR < preproc_ifdef`. The structural test answers "is
   any ancestor a directive" when the question is "is **this token** directive text".
   Caught only because the probe measures the under-emission direction; a
   before/after `git stash` diff of the two numbers is what made it undeniable.
2. **Folding the guard into `if (fnNode && !suppressCall)` made the #954 mutant
   SURVIVE**, because the wrapper short-circuits the whole callee-type ladder that
   #954's revert restores. One guard silently disarming another. It is now folded
   into the *emit* condition instead, and #954 is **retired as superseded** — its
   defect was a call from a directive line, which #956 now covers by the more
   general rule. The #954 guard is still present and still load-bearing for a
   directive-free non-name callee; its `fact` still runs on the clean analyzer.

### Measured after

| corpus | before | after |
|---|---|---|
| `redis/src` | 43,995 / 44,002 = 99.98% | **43,995 / 43,995 = 100.00%** |
| `libgit2/src` | 23,747 / 23,748 = 100.00% | 23,747 / 23,748 = 100.00% |
| `curl/lib` | 23,564 / 23,624 = 99.75% | **23,564 / 23,576 = 99.95%** |

Pinned by `c/call-in-directive-condition-956` (authored from the **damaged** shape —
a clean `#if defined(X)` emits no `call_expression` at all, so a tidy fixture would
pass the fix without testing it) and the `c/call-in-directive-condition` mutant.

### `calls` is now 100.00% on all three corpora — and the probe was wrong twice more to get there

| corpus | judged call sites | agreement |
|---|---|---|
| `redis/src` | 43,995 | **100.00%** |
| `libgit2/src` | 23,747 | **100.00%** |
| `curl/lib` | 22,487 | **100.00%** |

Two more probe defects had to be found to reach that, and **both pointed at correct
analyzer behaviour**:

1. **The probe's walk was not a complete census of the parse, and did not know it.**
   It reported 6 over-emissions — `Curl_checkProxyheaders@691/738`, `STRCONST@692/739`,
   `Curl_creds_has_user_or_pass@737`, `ssl_installed@937` — and the analyzer was right
   about every one. `http.c:686-704` sits inside a `preproc_ifdef` whose `if_statement`
   687-702 contains a `parenthesized_expression` 688-694 holding the calls, and the
   walk never reached them. Diagnosing it took a dozen instruments because the symptom
   was a *confident* number (`parse=0` for a call that plainly exists) rather than a
   missing one. The fix is a **containment check**: an independent unrestricted census
   of every `call_expression` in the tree, and any file where the walk cannot account
   for it is EXCLUDED and produces no verdict. An instrument that cannot see a region
   must not testify about it. The first version of that check was a ratio and was wrong
   in both directions — it flagged two files that legitimately contain no calls, and
   it would have passed a file missing a whole region as long as the region was small.
2. **A call through a function-pointer array is not a named call.** The probe followed
   a `subscript_expression` callee to its base identifier and reported 6 MISSING calls
   (`recv[sockindex](...)` cfilters.c:1011/1042, `state_enter[state](...)` multi.c:193,
   `parse[len-2](...)` protocol.c:623, `setopt_call[i](...)` setopt.c:1289/2532). The
   family contract filters computed/dynamic calls and the analyzer is right: the callee
   is chosen at runtime, so no static name exists, and recovering the array's base name
   would be a fabrication of the same class as a parenthesized-callee cast.

**Caveat, stated rather than hidden: 2 of 200 curl files are excluded** (`http.c`,
`openldap.c`) because the probe's walk cannot account for their parse. That is a
**known hole in the probe, not a clean bill for those files** — and closing it means
fixing the walk, not widening the threshold.

This is the **sixth and seventh** confident wrong number this instrument has produced.
The pattern is consistent enough to name: every one was a node-type or
traversal assumption, and in every case the analyzer was right and the probe was not.
The containment check exists because of that, not because of the two rows it fixed.

## Corpus validation

- The corpus is **three independently cloned repositories**, one of which is the
  M12 pinned target family: `curl` (1,048 C/H files), `libgit2` (1,190), `redis`
  (788). Cloned into `$HOME/ishaq/fixtures/repositories`; the census pins each
  set by a `setDigest` so a rerun is the same set.
- Per corpus: files, symbols, relationships, grammar-error files, **crash files
  = 0**, and the symbol/edge hygiene dimensions above all at zero.
- **The crash guarantee was falsified and restored in this wave.** The M37 review
  recorded "was 7/125 crashes on sqlite — now 0" as a family-wide lesson. This
  wave's own census found **1 crash in 900 curl files**:
  `curl/lib/cf-h1-proxy.c` killed `analyze()` with
  `RangeError: Maximum call stack size exceeded`. Root cause: the layout descent
  resolved a member's type by **bare name** against the struct map, and C's
  tag/ordinary namespace split let `h1_tunnel_state` be both an enum typedef and a
  struct tag, so the ENUM-typed member resolved to the STRUCT and the descent never
  terminated. Fixed with a namespace-aware type classification plus an
  in-progress set. With the reproducing fixture committed, the **shared F3 harness
  itself aborted** on it, so until this was fixed the C lane could not be run by
  the milestone's own fixture gate at all — a stronger statement about the lane's
  state than any number in a table.
- Pinned differential floors (`jq:c`, `sqlite:c`, `fmt:c` in
  `validation/m14/differential-baseline.json`) are unchanged by this wave.

## Gate state (measured at this commit)

| gate | result | how it was run |
| --- | --- | --- |
| M14.0.F3 fixtures | **32/32 pass** (18 pre-existing + 12 new) | `bun run script/m14/run-fixtures.ts --lang c` |
| M14.0.F1 grammar conformance | **PASS**, 65 refs, unknown 0, unknownFields 0 | `bun run script/m14/audit-analyzer-grammar.ts c` |
| M14.0.F4 mutation (shared registry) | **34 C mutants, 0 C survivors** | `bun run script/m14/mutate-analyzer.ts` (unscoped; the 12 global survivors are `sql` and `erlang`, not this lane) |
| C-lane gate (properties + mutants + cost) | **14 properties, 38/38 live mutants caught, 5 retired with stated reasons, measured-cost pass** | `bun run script/m14/tmp/c-audit/verify-c-lane.ts --corpus <dir>` |
| grammar pin (`c` in `validation/m14/grammar-pins.json`) | **PASS** — source↔wasm zero both ways, 135 declared names, 128 wasm-named all declared; patch proven live | `bun run script/m14/verify-grammar-pins.ts` (whole-file run is red on the **cpp** lane's in-flight `PIN.md`, not on `c`) |
| layout vs clang (independent reference) | **100.0% (39/39)** of redis types and **100.0% (20/20)** of libgit2 types the analyzer claims to model; 89.8% / 58.0% overall; **no actionable misses on either corpus** | `bun run script/m14/tmp/c-audit/layout-vs-clang.ts --dir <corpus dir>` |
| regex census | 2 entries removed; `ABSENT-IN-WORKTREE` for both | `bun run script/m12/verify-regex-census.ts` (the gate as a whole is red on other lanes' in-flight work — `sql`, `clojure`, `cpp`, `elixir`, `erlang`, `fsharp`, `go`, `zig`, and a pre-existing stale `makefile` row) |
| typecheck | clean for the analyzer and every probe in this lane | `npx tsc --noEmit -p tsconfig.json` |

**The C lane owns its own gate** (`script/m14/tmp/c-audit/verify-c-lane.ts`)
because the canonical harnesses are shared files and editing them from a language
lane is a merge hazard — the perl lane staged its mutants as a patch for that
reason. A defect class with no gate is the disease this repository keeps finding,
so the lane owns the gate rather than leaving the class ungated. The shared
registry's C mutants were **not** modified; the new C mutants live in the lane's
own file with the same faithful-revert discipline.

The six mutants this wave added (`936`, `937`, `938`, `940`, `941`, `944`) cover
the layout payload, and two of them exist because **the gate caught me** rather
than the code:

- `#936`'s first revert anchored on the branch head *plus* the assignment two
  lines below. A comment sits between them, so the revert never fired and the gate
  reported an anchor error rather than a result — the correct failure, and the
  reason the gate refuses to pass a mutant whose revert it could not apply.
- `#940`'s first revert swapped the *initial* guess count, which is equivalent to
  the original for every type in the fixture (none has a `#ifdef` body), so the
  mutant **SURVIVED while removing nothing**. A mutant that cannot fail is not a
  mutant; it was re-aimed at the accounting the fixture can actually see.

A third correction belongs to the probe rather than the gate: it initially
classified each miss from a 4000-character window after the type name and labelled
15 of 22 misses "array member" because a bracket appeared *somewhere in the file*.
The class is now computed from the type's own body, which is what moved the
diagnosis from "array padding looks wrong" to "the width table is incomplete".

**The measured-cost check was flaky, and it was found flaky by disagreeing with
itself.** Three consecutive invocations on unchanged code reported 1.25x, 0.70x and
1.45x for the same file, and it *failed* two of the three, with `/proc/loadavg`
reading 30–34 throughout because other agents share the host. The statistic was
`min(reverted) / min(fixed)` over five rounds, and with a 4x per-round spread
(744–3072 ms observed) the two minima are drawn from different points of the noise,
so the ratio measured the machine rather than the code. It is now the **median of
nine PAIRED per-round ratios**: each round runs Fixed and then Reverted back to back,
so a slow patch of host time inflates both members of the pair and cancels. The
min-of-minima is still printed beside it, because a reader who distrusts an estimator
should be able to see the spread rather than take one number on faith. A gate that
fails two runs in three for reasons unrelated to the code under test is worse than no
gate, because it teaches the reader to ignore red.

**#940 was retired, and the reason is worth the space.** Its guard — the general
unresolvable-type count — was reorganised out from under it by #949, which made the
unmeasured-member accounting an *exclusive partition* so that one member is counted
once rather than twice by two overlapping guards. The marking #940 introduced is
still live and still asserted: `c-lane/944` reverts the same count and `c-lane/948`
reverts the flag's initialiser. The fact still runs on the clean analyzer every
invocation, so a regression that un-marked a refused width would fail the suite
through those two even with this entry retired. Retired means *pinned elsewhere*, not
unverified.

**#944 needed three re-aims, and every one was reported by the gate rather than
absorbed.** Its fact asserted a bitfield carried 2 unmeasured members, true while
every bitfield was charged its declared type's width; #945 packs them, so the gate
reported a BAD-FACT — *the fact is wrong, not the analyzer*. Re-aiming it at "it is 0
now" made it SURVIVE, because a bitfield with a known declared type never reaches
that guard at all. The class was real and reachable; it just needed its own input, a
bitfield whose declared *type* is a cross-file typedef, which is a different failure
mode from #944b's unknown *width*. That distinction is now two fixtures and two
mutants rather than one of each.

### What the lane's own gate can and cannot see

Its 13 properties are invariants no expectation file can express: one truth per
fact (no two edges sharing `(source, type, target, line)` with different
`relationshipType`), a line on every edge, ontology conformance, a `contains`
source that is a symbol, a member with an owner, a known kind, a real name, a
member not named after a macro, a repeated member name only under conditional
compilation, no macro named after a type or a macro in a damaged declarator slot,
no self-containment, no crash, no regex literal in the analyzer's own source, and
the macro-inventory floor.

Two of those properties were **wrong on first statement and the corpus said so**,
which is the point of running a gate over a real corpus:

- **P8** was asserted three times — "no repeated member name" (broken 41×/41×/19×,
  all legitimate C), then "a repeat must differ in `isConditional`" (still wrong:
  `isConditional` records *inside some* conditional, not which arm, and
  curl's `xcharp_u.tchar_ptr` in mutually exclusive `#ifdef UNICODE`/`#else` arms
  is `true` on both copies), then the sound version: a repeat requires
  conditional compilation, because an unconditional duplicate is not legal C at
  all.
- **P7** had the same false class as the first version of the #931 rule — it
  flagged a member sharing a **function-like** macro's name, and redis's
  `double min, max;` declared 3,700 lines after its own `#define min(a, b)` is
  exactly that and is real. The gate caught it on the fixture control that was
  authored to catch it.

And **P12 exists because of a bug this wave introduced**: naming an enumerator's
local `enumName` shadowed the method's own `enumName`, so every enum member came
out with `ownerName: <its own name>` and a `contains X -> X` self-edge. P5 could
not see it (the ownerName was *present*, just wrong) and neither could the
fixtures (the member's *name* was right — only the edge's direction was not).
A member-name bug that keeps the name and corrupts the ownership needs an
**edge-direction** property to detect it.

## Grammar pin

**The C grammar is now pinned, and it was the load-bearing omission in every
number above.** `wasm/tree-sitter-c.wasm` (650,175 B, sha256 `f9a2d771…`) was
recorded in `validation/m14/results/wasm-provenance-census.json` with *no*
byte-identical local copy and the verdict "provenance cannot be re-derived
offline", and `grammars/tree-sitter-c/` carried only `grammar.js`, `LICENSE`,
`package.json` and `tree-sitter.json` — so the pin verifier's source↔wasm check
could not run either. Every C figure in this document is a measurement of a parse
produced by unpinned bytes: the F1 oracle, the 2,498-file census, the clang layout
probe, and all 28 mutants.

It could not be pinned as `byte-identical-to-npm-tarball`, the kind every other
lane uses, because **the vendored `grammar.js` is not pristine**: it differs from
npm `tree-sitter-c@0.24.1` by 75 diff lines and carries this repository's own
`#743` / `#743b` edits. So one question had to be answered before provenance could
even be stated:

> Is the wired wasm a build of the **patched** source, or a pristine build that
> predates the patch?

**It is the patched build**, and the measurement is the interesting part. A rebuild
of the committed patched source is *surface-identical to the wired bytes in both
directions* — 128 named types, zero difference either way — and *behaviourally
identical on all 10 constructs* of the battery. Pristine upstream 0.24.1, by
contrast, is short by exactly the three node types the patch adds
(`macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name`) and
parses all three `#743b` shapes as `ERROR` where the wired build parses them clean.

The consequence is the useful one: **the incumbent was already a verified build, so
no C measurement needed re-baselining.** Had the wired bytes matched pristine
upstream instead, the `#743b` fix would not have been live and the whole lane would
have needed re-measuring. Bytes are *not* expected to match and the pin does not
require it — a wasm build carries its emscripten version, compiler flags and
section order, so two builds of one grammar differ in sha256 while being the same
grammar. The claim is surface and behaviour identity.

The verifier's own offline proof now runs on every invocation:

```
c   f9a2d771d989   650175 B  ids= 366 named=128 anon= 202 fields= 39  vendored:6 files
     source↔wasm: all 135 declared names present (7 supertypes hidden by design),
     128 wasm-named types all declared, 0 built-in extra(s)
```

Zero in both directions — the statement that the committed bytes are a build of the
committed source. It could not run at all before this work, because the vendored
tree carried no `node-types.json`/`grammar.json` pair; both are now vendored,
regenerated from the patched `grammar.js`.

This also retires a live hazard **this wave's own review recorded**: the `#936`
defect was a node-type literal (`attributed_type_specifier`) written from memory of
a *different* tree-sitter-c release. F1 caught it only because the vocabulary
happened to be checked against the live grammar. The pin makes the release explicit
rather than remembered.

- decision, measurements and the rejected alternatives:
  `grammars/tree-sitter-c/PIN.md` and the `c` entry in
  `validation/m14/grammar-pins.json`
- re-runnable: `bun run script/m14/tmp/c-audit/c-grammar-pin.ts` →
  `validation/m14/results/c-grammar-pin.json`
- the pristine and rebuilt wasms are kept at `$HOME/ishaq/fixtures/c/grammar/`
  with a `SHA256SUMS.txt`, so the A/B survives the network copy disappearing

**One tool trap, recorded because it cost a run:** `--lane` is read *inside*
`if (write)`, so `verify-grammar-pins.ts --lane c` silently verifies and writes
nothing. The invocation is `--write --lane c`. A flag that documents itself as the
scoped-writer and then no-ops without a second flag will eventually launder a
lane's record or lose an hour, whichever comes first.

## Evidence pointers

- Lane fixtures: `validation/m14/fixtures/c/` (27 pairs, 9 added this wave)
- Lane gate: `script/m14/tmp/c-audit/verify-c-lane.ts` + `p13-baseline.json`
- Lane probes (all re-runnable): `script/m14/tmp/c-audit/` —
  `census.ts` (the 2,498-file census), **`layout-vs-clang.ts`** (the layout payload
  against an independent `clang -ast-dump=json` reference: size, alignment, member
  SETS, agreement split by `layoutUnknownMembers`, and every miss classed),
  `duplicate-classes.ts` (provable vs unprovable duplicate edges), `line-edges.ts`
  (every edge on one source line, with the metadata that identifies its branch),
  `truncation-shape.ts` (the parse shapes behind the removed regex),
  `c-grammar-pin.ts` (the grammar pin: is the local patch live in the wired bytes,
  and are those bytes a build of the committed source),
  `call-edge-fidelity.ts` (every `calls` edge against the parse, per (callee, line),
  in BOTH directions — the adjudicator for the census's `sameSiteDups`, and the
  instrument that adjudicated the `sameSiteDuplicates` class to zero unexplained),
  `macro-field-probe.ts`, `perf-attribution.ts`, `line-index-parity.ts`
- Corpus census artifact: `validation/m12/results/c-corpus-census.json`
- M12 ground truth: `validation/m12/ground-truth/c.json`
- M12 differential: `validation/m12/results/c-differential.json`
- Spec + rulings: `script/m14/spec/c-completeness.json` (`C-D12` macro-generated
  members, `C-D13` the layout descent, `C-D14` one edge per occurrence, added this
  wave; `C-D1`–`C-D11` pre-existing)
- Reviews: `reviews/c/master-review.md` (the wave record),
  `reviews/c/third-review.md` (this wave's findings, instruments, and the defects
  in this lane's own instrumentation), `reviews/c/deepest-review.md`,
  `reviews/c/holy-c-second-review.md`
- Shared differential floors: `validation/m14/differential-baseline.json`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer
  after this wave, from 2), policy `reviews/regex-policy.md`

## Issue

Closes M12.16 (GitHub issue #155). This wave's findings are recorded in
`reviews/c/` rather than closed here, because the contract requires an owner
spot-check before any issue closure (§5.6) and the owner has not run one on this
wave's numbers.
