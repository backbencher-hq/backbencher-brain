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
| references | ✅ | type usage — in-file declared type identifiers (`type_identifier`, `struct_specifier`/`union_specifier`/`enum_specifier` references, incl. bare return types). Never both references+uses for the same pair. | 0.8 |
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
| curl | 900 | 931,077 | 16,445 | 68,273 | 144 (16.0%) | **0** | 16.7 | 16.1 | 28.7 |
| libgit2 | 900 | 1,459,927 | 27,705 | 111,787 | 153 (17.0%) | **0** | 42.0 | 25.9 | 31.6 |
| redis | 698 | 1,654,679 | 29,735 | 132,576 | 196 (28.1%) | **0** | 77.6 | 32.8 | 35.4 |
| **total** | **2,498** | **4,045,683** | **73,885** | **312,636** | 493 (19.7%) | **0** | — | — | — |

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
- The M12 differential pins the four `validation/m12/fixtures/c/` files. **This
  wave did not re-baseline it**, because the field-leaf dedup change (one edge per
  occurrence instead of two) is expected to move those counts and the re-baseline
  has to be a reviewed diff rather than a regeneration. See
  `reviews/c/master-review.md` for the open item.

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
| M14.0.F3 fixtures | **23/23 pass** (18 pre-existing + 5 new) | `bun run script/m14/run-fixtures.ts --lang c` |
| M14.0.F1 grammar conformance | **PASS**, 57 refs, unknown 0, unknownFields 0 | `bun run script/m14/audit-analyzer-grammar.ts c` |
| M14.0.F4 mutation (shared registry) | **34 C mutants, 0 C survivors** | `bun run script/m14/mutate-analyzer.ts` (unscoped; the 12 global survivors are `sql` and `erlang`, not this lane) |
| C-lane gate (properties + mutants + cost) | **13 properties, 21/21 live mutants caught, 2 retired with stated reasons, measured-cost pass** | `bun run script/m14/tmp/c-audit/verify-c-lane.ts --corpus <dir>` |
| regex census | 2 entries removed; `ABSENT-IN-WORKTREE` for both | `bun run script/m12/verify-regex-census.ts` (the gate as a whole is red on other lanes' in-flight work — `sql`, `clojure`, `cpp`, `elixir`, `erlang`, `fsharp`, `go`, `zig`, and a pre-existing stale `makefile` row) |
| typecheck | clean for the analyzer and every probe in this lane | `npx tsc --noEmit -p tsconfig.json` |

**The C lane owns its own gate** (`script/m14/tmp/c-audit/verify-c-lane.ts`)
because the canonical harnesses are shared files and editing them from a language
lane is a merge hazard — the perl lane staged its mutants as a patch for that
reason. A defect class with no gate is the disease this repository keeps finding,
so the lane owns the gate rather than leaving the class ungated. The shared
registry's C mutants were **not** modified; the new C mutants live in the lane's
own file with the same faithful-revert discipline.

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

## Evidence pointers

- Lane fixtures: `validation/m14/fixtures/c/` (23 pairs, 5 added this wave)
- Lane gate: `script/m14/tmp/c-audit/verify-c-lane.ts` + `p13-baseline.json`
- Lane probes (all re-runnable): `script/m14/tmp/c-audit/` —
  `census.ts` (the 2,498-file census), `duplicate-classes.ts` (provable vs
  unprovable duplicate edges), `line-edges.ts` (every edge on one source line,
  with the metadata that identifies its branch), `truncation-shape.ts` (the parse
  shapes behind the removed regex), `macro-field-probe.ts`,
  `perf-attribution.ts`, `line-index-parity.ts`
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
