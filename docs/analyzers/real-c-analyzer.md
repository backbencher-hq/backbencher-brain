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
| `calls` | ✅ | 200,105 | `c_function_call` |
| `uses` | ✅ | 74,129 | `field_access` 53,995 · `identifier_usage` 20,334 |
| `contains` | ✅ | 16,938 | — (container → member) |
| `references` | ✅ | 10,471 | `type_reference` |
| `imports` | ✅ | 10,993 | `include_dependency` |
| `exports` | ✅ | 0 on this corpus | `linux_kernel_export` (Linux `EXPORT_SYMBOL*`) |
| `instantiates` | ❌ **N/A — see below** | 0 | — |
| `extends` / `implements` / `overrides` | ❌ **N/A — see below** | 0 | — |

**`instantiates` is not emitted, and this page previously said it was.** The
allocator branches count `malloc`/`calloc`/`realloc`/`kmalloc`/`vmalloc` and
`free`/`kfree`/`vfree`, set `metadata.usesMalloc` on the enclosing function, and
raise the `Dynamic Memory Management` pattern — and a comment in the code records
why the edge is gone: "malloc allocates BYTES, not a named type — an
`Instantiates` edge to the literal 'malloc' could never resolve to a type symbol
and was pure noise (removed; allocation tracking lives in metadata + patterns)."
The row above is the truth; the earlier ontology table contradicted the code it
documented.

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
| exports | ✅ | public (non-static) function/variable symbols; Linux `EXPORT_SYMBOL*` → `X exports KERNEL_EXPORT` | — |

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
- **The artifact cannot be regenerated in this checkout.** The F5 harness reads
  `CORPUS_ROOT = $HOME/fixtures/repositories` (overridable with
  `BB_CORPUS_ROOT`), that path does not exist here, and the run aborts on the first
  pinned repo. No script in the tree writes `c-differential.json` by that name, so
  the artifact's producer is not present either. **The M12 differential is a
  FIXTURE differential, though**, which is why the drift is measurable here at all
  — and that is the argument for keeping the fixture-based probe as the lane's
  standing check on its own pinned truth.
- **This wave's change is byte-identical on the M12 fixtures**: the previous
  commit's analyzer and this one produce identical relationship sets on
  `Module.c`, `Module.h`, `Negative.c` and `module_config.h`, so none of the
  drift above is attributable to it.

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
| M14.0.F3 fixtures | **26/26 pass** (18 pre-existing + 8 new) | `bun run script/m14/run-fixtures.ts --lang c` |
| M14.0.F1 grammar conformance | **PASS**, 61 refs, unknown 0, unknownFields 0 | `bun run script/m14/audit-analyzer-grammar.ts c` |
| M14.0.F4 mutation (shared registry) | **34 C mutants, 0 C survivors** | `bun run script/m14/mutate-analyzer.ts` (unscoped; the 12 global survivors are `sql` and `erlang`, not this lane) |
| C-lane gate (properties + mutants + cost) | **14 properties, 33/33 live mutants caught, 3 retired with stated reasons, measured-cost pass** | `bun run script/m14/tmp/c-audit/verify-c-lane.ts --corpus <dir>` |
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

- Lane fixtures: `validation/m14/fixtures/c/` (26 pairs, 8 added this wave)
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
