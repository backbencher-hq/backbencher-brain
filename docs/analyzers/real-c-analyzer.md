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

## Relationship ontology — C_FIX2 wave, measured 2026-10-05

> **This section replaces two tables that contradicted each other.** The previous version
> carried the per-type table TWICE — once saying `instantiates` ✅ 5 and once saying ❌ 0,
> once saying `exports` ✅ 957 and once saying "0 on this corpus" — and both cited
> `validation/m12/results/c-corpus-census.json`, which is a curl/libgit2/redis corpus.
> Neither table was a measurement of the corpus this lane is registered against. Every
> number below is over **sqlite**, which is `LANG_REPOS.c = "sqlite"`
> (`script/m14/differential.ts:444`), re-measured this wave.

### The population, because a count that does not name one is not a number

**348 of sqlite's 359 derived `.c`/`.h` files.** The other 11 never reach the C analyzer:
`language-detection.ts:200-215` treats `.h` as ambiguous and decides it by matching NINE
C++ markers against the file's first 64 KiB **of text**, one of which is
`\b(?:virtual|override|constexpr|explicit)\b`. `src/vdbe.h:14` reads *"This header defines
the interface to the virtual database engine"* — in a `/** … */` block — and the file is
analyzed by `RealCppAnalyzer`. Measured and bisected in
`script/m14/tmp/c-audit/c-header-routing.ts`, with the analyzer's presence **patched**
rather than inferred: 11 of 42 headers routed to `cpp`, and 2,976 of their relationships
carry none of the C lane's `metadata.relationshipType` discriminators.

Two consequences, both of which invalidate numbers this file previously quoted:

- `contains` is **6,147** over the C-routed files and **8,577** over all 359. The
  2,430-edge difference is the C++ analyzer's. Every `contains` figure this lane printed
  through `census.ts` and `c-ontology-verdicts.ts` is over the 8,577 population.
- The `contains global -> X` rows the shared ontology gate's P4 property would convict
  are **1,058 and every one of them is from a cpp-routed file**. On the C-routed
  population the count is **0**, and the analyzer's own rule ("never `global contains X`")
  holds. The 1,058 are a **C++ lane** finding, not this lane's.

> **2026-10-17 — the header boundary is now MEASURED, and the two routes disagree.**
> `validation/m14/proposals/c-h-boundary.md` (instrument
> `validation/m14/fixtures/c/probe-h-boundary.ts`) walks all **17,709 tracked `.h`** in the
> corpus: **15,098** are measurable, of which **2,936 (19.45%) carry genuine C++ evidence**
> (2,668 C++-only, 268 dual-language) and **12,162 are plain C**. **Production indexes all
> 15,098 with this analyzer** — `pool-worker.ts:1079` calls `detectLanguageFromPath(filePath)`
> with **no content**, so the content sniff at `language-detection.ts:402` never runs there —
> while `engine.ts:1772` (the gate path) passes content and sends **3,095 to cpp + 259 to
> objective-c**. That is a **3,354-file (22.21%) divergence between what the gates measure and
> what production indexes**; any number in this page that says "C/H files" is a statement
> about the population the cited instrument used, and the proposal carries both. Fixing it
> needs `pool-worker.ts` / `language-detection.ts` (outside this lane): an extension-table
> flip would hand cpp 12,162 plain-C headers (80.5% of that feed).

### Per-type verdict

Verdict vocabulary is the workstream's: **EMITTED** (production `parseFile` produced it
on real corpus, with a count and the files), **RULED** (written reason AND a corpus
measurement), **GAP** (the language has the construct — implemented this wave where real).

| type | verdict | edges | files | `metadata.relationshipType` |
|---|---|---|---|---|
| `calls` | **EMITTED** | 76,422 | 318 | `c_function_call` (76,416) · none (6) |
| `uses` | **EMITTED** | 46,706 | 296 | `field_access` 36,578 · `identifier_usage` 10,128 |
| `imports` | **EMITTED** | 1,459 | 332 | `include_dependency` |
| `references` | **EMITTED** | 8,799 | 212 | `type_reference` 8,753 · `include_dependency` 46 |
| `contains` | **EMITTED** | 6,147 | 227 | — (container → member) |
| `exports` | **EMITTED** | 273 | 2 | `module_export` |
| `overrides` | **EMITTED** | 102 | 33 | `c_redefinition` (`shape`: `conditional-redefinition` 50, `undef-redefine` 52) |
| `instantiates` | **EMITTED** | 2 | 2 | `c_allocation` |
| `extends` | **RULED** | 0 | 0 | — |
| `implements` | **RULED** | 0 | 0 | — |

> **2026-10-17, `instantiates` re-measured and MOVED.** On the lane's standing
> `incoming-gate.ts c c 400` stride the type read **0 edges** (a type that fires on its
> fixtures and nowhere on the population is not covered), and the authored fixture
> `c/instantiates-allocator-register-989` was failing. The register was widened and the
> `sizeof(typedef)` operand path repaired (§"`instantiates` is thin" → *LANDED*); the same
> stride now reads **19 edges, 19 resolved, 0 collRes, 0 arbitraryTwin**, and every target
> is a type declared in the SAME FILE (`fixtures/c/probe-c-instantiates.ts`, 19/19). The
> table above is the historical sqlite measurement and is kept for its provenance; the
> CURRENT count is in `script/m14/spec/c-completeness.json` `_implemented_measured`
> (2026-10-17 entry) and `validation/m14/fixtures/c/measurements/gate-c-after-instantiates-400.txt`.

**Arbiter:** `bun script/m14/ontology-coverage-gate.ts c --fresh` → **emitted 8/10,
ruled-sound 2, FALSIFIED 0, ruled-without-justification 0, exit 0** over 4,421 admitted
C/H files across the whole corpus. Its note reads *"c has no ruling TABLE; 2/10
un-emitted types are ruled from its SPEC"*, and one caveat belongs beside that: with no
table entry, the gate's own `basis` string defaults to *"the construct occurs 0x on the
parse tree"* **whether or not a probe ran** (`treeHits` is empty for `c`). The RULED-SOUND
verdict for `extends`/`implements` is therefore carried by this lane's own measurement
below, not by the gate's reason text.

### The two RULED types, with the measurement that rules them

Instrument **A — grammar inventory** (`c-gap-probes.ts`, every node including anonymous
tokens, `n.child(i)` exactly as the shared gate walks it, so the count is comparable with
its bash 164 and json 26):

    203 distinct node types over the 348 C-routed files
    inheritance node types present: NONE of 15 probed
      (base_clause, base_class, superclass, superclasses, class_heritage,
       inheritance_specifier, extends_clause, implements_clause, interface_declaration,
       interface_specifier, class_specifier, class_declaration, trait_declaration,
       protocol_declaration, mixin_specifier)
    object-creation node types present: NONE of 4 probed

Instrument **B — parse-tree semantic counts**, for the constructs C *can* express:

    extendsByValueMember                        788 in  95 files
    extendsByValueAnonAggregate                  68 in  17 files
    extendsPointerToLocalTag                     10 in  10 files
    implementsObjectOfLocalFnPtrStruct            4 in   1 file
    implementsObjectOfCrossFileFnPtrStruct      363 in 166 files
    implementsFunctionAssignedIntoFnPtrMember     0 in   0 files

**`extends` — RULED.** C has no supertype clause and cannot grow one. What it has is
composition, and the language already represents composition as `contains`
(container → member) — publishing it under a second label is the "two labels for one
fact" the lane's own P1-one-truth-per-fact property exists to prevent. The third shape is
refused for a **different** reason and the distinction is the substance: 10 members are
POINTERS to a locally declared tag, and `struct A *` is a *reference*, not a subtype, so
an `extends` edge there would assert `A is-a B` about source that says no such thing.

**`implements` — RULED.** Same Instrument A result. C's nearest shape is a struct whose
every member is a function pointer plus a brace-initialised object of it: 367 objects, of
which **4** in 1 file have the type declared in the same file (`autosetup/jimsh0.c:8395,
8420, 10859, 10906`, all of `Jim_HashTableType`) and **363** in 166 files are cross-file,
which C-D2 forbids. The refusal is not the count — it is that the shape is a **convention
and not a language interface**: nothing in C declares it, nothing checks it, and a struct
with one non-function-pointer member would satisfy no interface at all. An `implements`
edge over a duck-typed test asserts a relationship the language does not have.

### `instantiates` is thin, and the thinness has a number

2 edges in 2 files (`src/test_mutex.c`, `src/test_wsd.c`). `c-gap-probes.ts` finds **54**
allocator calls whose value is cast to a type the file declares, so 52 rows are missing
and the reason is one list: `MALLOC_FUNCTIONS` (`real-c-analyzer.ts:82`) is
`["malloc","calloc","realloc","kmalloc","vmalloc"]` and 52 of the 54 are `sqlite3_malloc`
(24) and `sqlite3_malloc64` (28) — sqlite's own wrappers. **RULED for widening**, and the
number is recorded so the decision can be made on evidence: the M12 truth defines the C
semantic as *"allocator calls, malloc/calloc/realloc family — C-specific allocation
semantic"*, and widening the list to cover one codebase is precisely the defect #989
removed from `exports` — a name list is right about the codebases it was written from and
silent about the next.

The wider readings are measured rather than asserted, because each is plausible enough
that someone will propose it:

| reading | count | verdict |
|---|---|---|
| any cast to a locally declared type, allocation or not | 610 in 84 files | **refused** — a cast is a conversion; `(char *)strdup(x)` produces no `char` object |
| a local variable of a locally declared type with a brace initializer | 152 in 31 files | **refused** — construction by assignment, and each is already a `contains`/`references` fact |
| a compound literal `(Type){…}` of a locally declared type | **0 in 0 files** | the construct C offers instead, and it does **not occur in this corpus** — so there is no compound-literal GAP to close here |
| `sizeof(<locally declared type>)` anywhere | **0 in 0 files** | sizeof *names* a type without creating one; a rule counting it would be wrong in principle and is measured at zero besides |

#### LANDED 2026-10-17 — the register widened, the `sizeof` operand repaired, and the numbers

The section above is kept because its reasoning was right about the *class* and its count was
right about the *sqlite cast spelling*. What changed is that the authored fixture
(`validation/m14/fixtures/c/instantiates-allocator-register-989`, pinned before the analyzer
run) measures the construct from the other side and outranks prose that predates it:

* **The register.** `MALLOC_FUNCTIONS` held the five standard names. On sqlite's 359 files,
  **680** allocation sites carry a type recoverable from the parse and **152** name a type
  the FILE declares — `sqlite3_malloc64` 82, `sqlite3_malloc` 45, `sqlite3_realloc64` 23,
  `malloc` 2. The three project wrappers are added, and the fixture names the limit: it is a
  REGISTER, so the next project's wrapper still needs its name (C-D2, no whole-program typing).
* **The `sizeof` operand.** `sizeof(Seg)` parses with a `parenthesized_expression` around a
  plain **`identifier`** when it sits in an expression position, while `sizeof(struct Opaque)`
  keeps a `type_descriptor`. `typeNameOf` read only `type_identifier`/`struct_specifier`, so
  the sizeof-only spelling worked for the `struct` form and failed for the typedef form — the
  exact row `c989_wrapped_sizeof_only` pins. The identifier is now read, and every call site
  still passes through `declared()`, so it can only name a type the FILE declares.
* **The measurement, both axes.** Same `c c 400` stride: `instantiates` **0 → 19** edges,
  **19 resolved**, collRes 0, amb 0, **arbitraryTwin 0** (all 19 are same-file declarations:
  intent class `sameFileUnproven`, the file-crossing class did not move — TOTAL arbitraryTwin
  2943 before and after). TOTAL edges 49,021 → 49,040; `resolved` 17,680 → 17,699; every other
  column byte-identical; unresolved unchanged at 25,710.
* **Every edge hand-read.** `fixtures/c/probe-c-instantiates.ts` reproduces the gate's stride
  exactly and prints each edge with the target type's own declaration line; 19/19 are
  `struct` declarations in the same file, e.g. `sqlite/src/wal.c:1973` `(WalIterator *)sqlite3_malloc64(…)`
  → `WalIterator struct@591`, and `sqlite/test/tt3_stress.c:313` `Stress2Ctx *pCtx = sqlite3_malloc(sizeof(Stress2Ctx))`
  (sizeof-only, the repaired path) → `Stress2Ctx struct@279`. Artifact:
  `measurements/probe-c-instantiates.txt`.
* **Fixtures:** 43 pass / 4 fail → **44 pass / 3 fail**; the three remaining are the export
  marker class (`export-linkage-marker-989`, `export-marker-class-965`, `exports-attribute-989`),
  untouched by this change and stated in `C-STATE.md` §3.

### `exports` is narrow on purpose, and the wide reading is measured

273 edges in 2 files. The other obvious rule — a macro whose replacement list is **EMPTY**
— is refused with the corpus as the reason: `c-gap-probes.ts` counts **57** declarations
prefixed by such a marker and **52 of them are `CMPP_PRIVATE`, which expands to
`static`** — the *opposite* marker. An empty macro contributes no tokens, so structure
cannot distinguish an export marker from `ALIGN128` (an alignment attribute) or
`SQLITE_WSD` (thread-local); only its NAME can, and the name is the fixed list this
change removed.

The widest reading — every file-scope symbol with external linkage, derivable from the
language with no name list at all, which is exactly why it is tempting — is measured and
refused **with its size**: **1,983** in 110 files (1,043 functions, 940 variables). It
multiplies the type 7.3×, it would make `exports` indistinguishable from "is a function",
and no oracle can check it because there is nothing to disagree with. A narrow graph that
is true beats a wide graph that is not.

### `overrides`: emitted, with both refused classes measured

102 edges in 33 files. The rule is structural and needs no preprocessor evaluator (C-D2):
C 6.9p5 makes an unconditional second definition of an external identifier a **constraint
violation**, so a legal redefinition exists only across preprocessor arms — the two
definitions must share an enclosing `#if`/`#ifdef` and sit in **different arms** of it.
The second shape needs no arm test because C 6.10.3p2 makes an unconditional macro
redefinition a constraint violation unless the replacement lists are identical, so
`#undef X` then `#define X <other>` is the sanctioned form.

    overridesMutuallyExclusiveArms      50 in  23 files   PUBLISHED
    overridesUndefThenDefine            51 in  11 files   PUBLISHED
    overridesRefusedNoSharedConditional 25 in   7 files   REFUSED
    overridesUnconditionalRedefine     275 in  68 files   REFUSED (constraint violation)

The 275 are the reason the `#undef` guard is load-bearing: they are config-header re-arms
(`src/os_setup.h:45-87` alone carries several per macro) and nothing replaced anything —
the preprocessor rejects the second definition. `c-lane/989-overrides-undef-guard` convicts
any mutant that drops the guard. The 25 are parse damage (`src/printf.c:76-90` is a Tcl
script inside `#if 0` that recovery reads as a function named `c`) or logically exclusive
conditions under two SEPARATE conditionals, which needs a preprocessor evaluator.

### The two DERIVATION findings, and what paid them

`validation/m60/rel-type-coverage-baseline.json` carries two open findings for this lane:
`contains` and `exports` are **emitted and compared against nothing**, and `overrides`
became a third the moment #989 made it fire. The shared differential's own run says so
in its output — `sqlite:c: COMPARED A LABEL WITH NO TRUTH: overrides (19 comparable,
0 truth)` — and exits 6 for exactly that reason.

- **`contains`** is covered by a better instrument than a second walker: `contains-vs-clang.ts`
  judges it against **clang 14**, a different parser with a different recovery strategy,
  so agreement is evidence rather than a tautology. Re-measured this wave:
  **421/421 = 100.00%** members agreed over 33 records and 421 members
  (was 414/421 = 98.34% before #990). 1 phantom remains —
  `test_quota.c quota_FILE -> zMbcsName`, a member inside `#ifdef _WIN32` that a Linux
  clang does not see; that is this lane's declared #957 superset, not a defect.
- **`exports` and `overrides`** are now covered by a lane oracle,
  `script/m14/tmp/c-audit/c-oracle.ts`, a second walker with pre-order traversal, its own
  name read and its own node-type set. **Its limitation is stated in its own output: it is
  a second walker over the SAME grammar, so it convicts a disagreement between two
  implementations of a rule and cannot see a defect in the grammar.** Measured over the
  348 C-routed files, both directions on (source, target, line):

      exports    oracle 273  payload 273   MISSING 0   UNEXPLAINED 0
      overrides  oracle  83  payload  83   MISSING 0   UNEXPLAINED 0

  with a **reach caveat that is counted rather than absorbed**: 120 of 348 files have `#`
  lines the walk cannot account for (1,591 lines in total, led by `src/main.c` 123 of
  412), which is this lane's own recorded macro-inventory hole (gate property P13). Those
  files are excluded from the `overrides` comparison on BOTH sides, with the excluded
  payload rows counted (13 files, 19 edges). The honest scope of the `overrides` verdict
  is therefore **83 of 83 edges on the 228 files the walk can fully account for**, plus 19
  further edges in 13 files the oracle is blind to.

### The six questions, answered per already-emitted type

`ONTOLOGY-WORKSTREAM.md` Part 1 asks six questions of every type the analyzer already
emits and says explicitly that **source derivation answers only the first**. All six are
measured by `script/m14/tmp/c-audit/c-six-questions.ts` over the 348 C-routed files
through `pool-worker.parseFile`, with the population printed by the instrument.

| type | 1 exists | 2 fires | 3 correct | 4 labelled | 5 resolved | 6 confident |
|---|---|---|---|---|---|---|
| `calls` | 1 site | 76,422 / 318 files | 100.00% vs the parse (`call-edge-fidelity`), 0 unexplained on 2,600 files | clean: 0 untyped, 355 same-line same-callee repeats all C-D14-legal | **31.9% both ends** | 1.00 on 76,416 · absent on 6 |
| `uses` | 2 sites | 46,706 / 296 | 0 over-emitted over 42,344 redis + 11,037 curl parse accesses | **16 pairs where `uses` AND `references` share one (source,target)** — the documented rule says never both | **61.7% both ends** | 1.00 value · 0.90 field |
| `imports` | 1 site | 1,459 / 332 | 0 fabricated over 10,941 edges (`imports-audit`) | clean | **0% both ends** — by construction: the target is an include path and the source is `global`, neither is a symbol | 1.00 |
| `references` | 1 site | 8,799 / 212 | audited by `deriveCCalls` | 46 rows carry `include_dependency` rather than `type_reference` | **89.3% both ends** | 1.00 · 0.80 type |
| `contains` | 1 site | 6,147 / 227 | **100.00% vs clang 14** (421/421 members) | **2 self-edges and 160 placeholder-owner edges, all on C-routed files** — see below | **87.7% both ends** | 1.00 |
| `exports` | 2 sites | 273 / 2 | **273/273**, 0 unexplained, `c-oracle.ts` | clean: 0 self-references | **93.4% both ends** (the 18 are declared names with no symbol of their own) | 1.00 |
| `overrides` | 2 sites | 102 / 33 | **83/83**, 0 unexplained, `c-oracle.ts`, on the 228 files the oracle can see | clean by construction: both endpoints are the same name and `metadata.overridesLine` carries the earlier line | **100%** | 1.00 |
| `instantiates` | 1 site | 2 / 2 | the one M12 truth row is `unmetUnder: C-D2` | clean | **100%** | 1.00 |

Notes that belong beside the table rather than inside it:

1. **Exists** is the *source-derivation* answer and is a lower bound by construction. The
   `overrides` and `exports` rows say "2 sites" because #989 added two call sites each; a
   branch reachable from a predicate that never matches is invisible to this count, which
   is why questions 2–6 exist.
2. **`imports` resolving at 0% is not a defect and must not be read as one.** An
   `imports` target is a module path (`string.h`, `sqliteInt.h`) and its source is the
   file-scope identity `global`; neither is a symbol, by construction of the type. The
   same reasoning applies in part to `calls` (31.9%): the top unresolved targets are
   `assert` 286, `sqlite3_free` 190, `memset` 65, `strlen` 62 — external symbols, which is
   C-D2, not a resolution failure. What is worth watching is the *direction*: `calls`
   resolves its SOURCE on every edge and fails only on cross-file targets, whereas
   `uses` fails on **16,458** targets, led by `pMethods` 139, `pVtab` 120, `n` 63 — struct
   members whose type lives in another file. That is #983's measured class, unchanged.
3. **Labelled, the two open rows are real.** `contains` has **160** edges whose owner is a
   placeholder: 4 of them are `Jim_Interp -> unknown`, which is a **true** member
   (`Jim_Obj *unknown;`, `autosetup/jimsh0.c:663`) and therefore an R7 false positive on
   this corpus; the other **156** are `anonymous_enum -> REG_*` in the same file, where
   **four distinct anonymous enums** (jimsh0.c:1344, 13788, 14421, 15202) are all published
   under the single name `anonymous_enum`. That is #987's ambiguous-owner class reached
   through a file-scope anonymous enum, and it is left open with the count rather than
   fixed — see *Open, with numbers*.
4. **Confident: nothing is under 0.7**, so no C edge is a heuristic by the contract's
   threshold. 45,380 edges carry a confidence below 1.0 (0.90 field access, 0.80 type
   reference) and **none carries a key whose name contains a reason code**; what they do
   carry is `metadata.relationshipType` (`field_access` / `identifier_usage`) and
   `metadata.nodeType`, which are machine-readable and say *why*. Whether that satisfies
   honesty-contract §4's "a machine-readable reason code (not just a number)" is the
   owner's call; the measurement is that the keys are there under other names.
5. **Two defects found by asking question 4** and fixed this wave — a macro published as a
   member and a member published as a macro. Both are below under **#990** and **#991**.

### Shared-harness defects found while measuring any of the above

Named, not fixed, because `script/m14/**`, `src/ast/engine.ts` and
`src/ast/language-detection.ts` belong to the master:

| # | defect | measured |
|---|---|---|
| S1 | **`firing-check-v2.mjs:36` hard-codes `REPO = "$HOME/backbencher-brain"`**, so in a worktree it grades the MAIN checkout's analyzer | main `502a4cd4` vs this worktree `161d15f1`; the shared instrument reported C at 6/10 for a lane whose own worktree is 8/10 |
| S2 | `engine.ts:1418-1434` blanks `__attribute__((…))`, `__declspec(…)` and seven MSVC tokens out of the CONTENT before `parser.parse()`, for c and cpp | `firing-check-v2`'s `getParser → parse → analyze` skips that step. Over the same 359 files the two entries disagree: `contains` 8,577 vs 7,501, `references` 8,845 vs 8,980, `overrides` 102 vs 111, `imports` 1,459 vs 1,505. The fired/silent SET agrees; the edge COUNTS are not production numbers |
| S3 | **`language-detection.ts:210` matches `\b(?:virtual\|override\|constexpr\|explicit)\b` against comment TEXT** | 11 of sqlite's 42 headers routed to `RealCppAnalyzer`; 9 of the 11 flip to `c` when the literal `virtual ` is removed from the text |
| S4 | **`ontology-coverage-gate.ts`'s resumable checkpoint makes a resumed walk report 0/10** | the tally lives in memory; the checkpoint records "already done", so a second run skips every file and reports `emitted 0/10 ruled-sound 4 … exit 1`. `--fresh` returns 8/10, exit 0. **A resumed run must not be quoted** |
| S5 | `ontology-coverage-gate.ts` prints *"the construct occurs 0x on the parse tree"* as the basis for a type with no ruling-table entry **whether or not a probe ran** (`treeHits` is empty for `c`) | the verdict is right for C and the *reason text* is a template default, so the RULED-SOUND rows for `extends`/`implements` are carried by this lane's own Instrument A, not by the gate |
| S6 | `run-fixtures.ts` and `audit-analyzer-grammar.ts` initialise web-tree-sitter from `node_modules/web-tree-sitter/tree-sitter.wasm`, a file absent from every checkout on this box | both abort with `ENOENT`. Worked around locally (`wasm/tree-sitter.wasm` copied into the shared `node_modules`, an environment fix and not a repository change) so the gates could run at all |

### #990: a calling-convention MACRO was published as a struct member, and the real member beside it was MISSED

`char *(SQLITE_CDECL*mprintf)(const char*,…)` — a function-pointer member whose calling
convention is a macro — is not legal C without expansion, so tree-sitter recovers
sqlite's `src/sqlite3ext.h:112` as

    parenthesized_declarator
      ERROR(field_identifier)                             <- SQLITE_CDECL, the MACRO
      pointer_declarator declarator: (field_identifier)   <- mprintf,     the MEMBER

`parenthesized_declarator` carries no `declarator` **field**, so both the struct and the
union member-name walks fell to `namedChild(0)` — the ERROR — and returned the macro.

Judged against clang 14 (`contains-vs-clang.ts --dir <sqlite>/src --max-files 120`):

| | records | members | agreement | MISSED | PHANTOM |
|---|---|---|---|---|---|
| before | 33 | 421 | 414/421 = **98.34%** | 7 | 8 |
| after | 33 | 421 | **421/421 = 100.00%** | **0** | 1 |

**Both halves of the defect were in one struct**, which is why the phantom count alone
would have understated it by half: 7 phantom members named `SQLITE_CDECL` and the 7 real
members missing (`mprintf`, `xsnprintf`, `test_control`, `db_config`, `log`,
`vtab_config`, `str_appendf`). The remaining 1 phantom is `test_quota.c quota_FILE ->
zMbcsName`, a member inside `#ifdef _WIN32` that a Linux clang does not see — the
declared #957 superset.

`getIdentifierFromDeclarator` has guarded against exactly this since #916-C. **#990 is
that guard in the two INLINE copies of the same walk**, extracted as
`firstCleanNamedChild`. Nothing is recovered: the ERROR subtree is simply not a place a
declared name can be read from.

**The aggregate count did not move** — `contains` is 6,147 over the C-routed files before
and after, because one phantom removed and one real member added cancel exactly. A
count-based differential could not have found this class. That is the argument for keeping
an independent-parser oracle.

Pinned by `validation/m14/fixtures/c/macro-cdecl-member-990` (40th C fixture) with mutant
`c-lane/990-member-name-skips-error`, which reverts **both** call sites at once and whose
fact asserts the positive edges, the negative edges, **and the union edge** — so a
half-revert fails. Proven failing end to end: with the fix reverted the fixture gate
reports 39 pass / 1 FAIL with two expected symbols missing, three expected edges missing
and two forbidden edges present.

### #991: a macro symbol whose NAME is a name no `#define` declares — and it RESOLVED

sqlite `ext/wasm/libcmpp.c:5520`

    #define CmppLvl_empty_m {  .flags=0U, .lineNo=0U  }

loses its macro name to the same brace-and-comment damage, and the `name:` field binds to
`.flags`. The analyzer published a macro named `flags`, and **`flags` is a real struct
member 900 lines earlier** (`cmpp_flag32_t flags;`, :448) — so a consumer resolving the
macro table landed on a member. The lane gate's own `P7-no-macro-named-member` convicted
it with 9 rows in that one file (`cmpp_ctor_opt.flags@L448 is named after an object-like
macro, not a declarator`), and the analyzer was right about the member and wrong about the
macro.

Measured by `script/m14/tmp/c-audit/c-macro-name.ts` over 348 C-routed files and **4,472
`#define` nodes**: the `name` field matches what the line actually spells in **4,466** and
is fabricated in **6** — `flags` (:5520, the line spells `CmppLvl_empty_m`),
`cmpp_size_t` (:5362), `cmpp__ListType_decl` (:5823), and `c` three times
(`ext/rtree/rtree.c:1224, :1230, :1250`, the `#if 0` Tcl-script shape this lane has
recorded before). **In all six an ERROR child of the same node sits BEFORE the name field**,
so the structural test and the fabrication coincide exactly on this corpus, and the test
needs no text.

This is the fabrication class #963 removed from `exports` and #962 removed from
`instantiates`: the published name has to be a name the source declares. The rule is a
**refusal, not a rename** — the macro's name is in the source TEXT but not in the PARSE,
and reading it back out of text is #934's line-anchored inventory and a different
question. No symbol is minted, the read that needed it stays unresolved, and that is the
direction this lane ranks acceptable over publishing a name that resolves to something
else (#983).

**The gate caught my own fixture and it was right.** The control "a member may share a
macro's name" was first written with an OBJECT-like macro and `P7` flagged it on the
fixture:

    c991_member_named_after_macro.C991_flags_misnomer_m@L57 is named after an
    object-like macro, not a declarator

An object-like macro is replaced wherever its identifier appears, so `unsigned X;` after
`#define X 0` expands to `unsigned 0;` and is not valid C. The control is now a
FUNCTION-LIKE macro, which is replaced only where `(` follows the name and therefore
survives a member declarator — which is exactly why #931's rule is restricted to
object-like macros.

Pinned by `validation/m14/fixtures/c/fabricated-macro-name-991` (41st) with mutant
`c-lane/991-macro-name-not-after-an-error`. Effects on the corpus: **6 fabricated symbols
removed**, 0 relationships changed, 0 crashes. The lane gate's `P7` violations on sqlite
go from 9 to **0**; total property violations 15 → 6.

### Open, with numbers — not re-baselined

| # | what | measured | why not taken |
|---|---|---|---|
| O1 | **three `enum ops` in one file, one owner** | `ext/wasm/libcmpp.c` declares `enum ops { op_none, op_set, op_push, op_pop, op_heredoc }` at :13878, `enum ops { op_invalid, op_set, op_push, op_pop }` inside `cmpp_f_undef_policy` at :14127, and `enum ops { op_none, op_set, op_push, op_pop }` inside `cmpp_f_delimiter` at :14303. Three distinct enum types published under the one owner `ops`: `op_none` ×2, `op_set` ×3, `op_push` ×3, `op_pop` ×3 — 12 `contains` edges | This is #987's ambiguous-owner class reached through enum TAGS, and #961's answer — qualify a local type by its enclosing function, `lpRandomEntries.pick` — extends to TAGGED function-local types and would name these `cmpp_f_undef_policy.ops` and `cmpp_f_delimiter.ops`. It renames every local-type owner in the corpus and needs its own fixtures and mutants; that is a wave, not a patch at the end of a session. The lane gate reports it as 5 `P8` rows and they stay red |
| O2 | **`#define` names the walk cannot account for** | 120 of 348 C-routed files have `#` lines with no `preproc_*` node; 1,591 lines in total, led by `src/main.c` 123 of 412, `src/os_win.c` 111 of 538, `src/vdbe.c` 88 of 313 | This is the recorded macro-inventory hole (gate property P13, #934). The payload covers those regions through its line-anchored inventory; an AST-only oracle does not, which is why `c-oracle.ts` excludes those 120 files from the `overrides` comparison and counts the exclusion (13 files, 19 edges) rather than absorbing it |
| O3 | **16 `uses`/`references` pairs on the same (source,target)** | `ext/wasm/libcmpp.c`: `global -> cmpp_size_t` and five function sources to `cmpp_size_t`; `tool/lemon.c`: 13 sources to `rule`, 2 to `action` | The documented rule is "never both references and uses for the same pair", so 16 rows violate it. Not taken: the adjudicated direction (a type-position identifier is `references`, CGD12) and the payload's answer are individually pinned by fixtures, and re-deciding them is a wave. Measured, reported, red in the table above |
| O4 | **`imports` emits BOTH a relationship row and an `imports[]` entry** | 1,459 in the relationship tally and 1,505 in the `ParseResult.imports` channel over the same files | `ParseResult.imports` (`src/ast/types.ts:206-216`) is the channel `parallel-indexer` writes to the `brain_import` TABLE. Whether a lane may emit both is a shared-layer decision, and `firing-check-v2` is built on the assumption that `imports` lives on one of them |


| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: struct→field, union→field, enum→member (post-loop over `ownerName`). Never `global contains X` — top-level symbols carry the synthetic `global` scope but emit no contains (dangling edge, Java-family ontology). **A container is never its own member**: `contains X -> X` is gate property P12, added this wave after a shadowed local made every enum member self-owning. **A macro in TYPE position names a type, not a member** (#985): `git_array_t(size_t) line_index;` publishes `line_index` alone; the macro's own name is a `macro_type_specifier`'s first identifier, not a declarator, and publishing it invented a member beside the real one. **An anonymous inline enum is owned by the MEMBER PATH** (#986), like an anonymous inline struct or union: `enum { A_ONE } first;` inside `U` gives `contains U.first -> A_ONE`, while the tagged spelling keeps its own tag. | 1.0 |
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

---

## Relationship ontology — VERIFY_C8 independent re-derivation, 2026-10-05

> **This section is an INDEPENDENT verification pass, not a restatement of the section
> above.** The handover for this lane was *"analyzer/C_FIX2 claims 8/10 on the
> population the C analyzer actually owns — establish what that population is,
> re-derive, and say whether the silent types are RULED with corpus proof."* Every
> number below was produced by an instrument written for this pass
> (`script/m14/tmp/c-audit/v8-*.ts`, none of which existed before it), and where this
> section disagrees with the section above it says so.
>
> **One provenance finding first, because it bears on every table above.**
> `docs/analyzers/real-c-analyzer.md:245` attributed the C six-questions table to
> `script/m14/tmp/c-audit/c-six-questions.ts`. That path exists in **no branch of this
> repository** — `git log --all --diff-filter=D` for it is empty and
> `git ls-tree -r <branch> | grep six-questions` is 0 across 7,972 commits. The table
> had no re-runnable instrument behind it. That is now
> `script/m14/tmp/c-audit/v8-six-questions.ts`, written fresh rather than restored.

### The population, re-derived

**348 of sqlite's 359 derived `.c`/`.h` files**, 0 parse failures. Derived by `readdir`;
filtered by **calling** `detectLanguageFromPath` with each file's own text rather than by
reimplementing it, so the population cannot drift from what the router does.

This number is the first thing that has to be right, because a verdict over the wrong
population is a correct number about nothing: over all 359 files `contains` reads 8,577
and over the 348 it reads 6,147, and the 2,430-edge difference is the **C++** analyzer's.

### Verdict per type, on the 348, through `pool-worker.parseFile`

| type | verdict | edges | files |
|---|---|---|---|
| `calls` | **EMITTED** | 76,422 | 318 |
| `uses` | **EMITTED** | 46,706 | 296 |
| `references` | **EMITTED** | 8,799 | 212 |
| `contains` | **EMITTED** | 6,147 | 227 |
| `imports` | **EMITTED** | 1,459 | 332 |
| `exports` | **EMITTED** | 273 | 2 |
| `overrides` | **EMITTED** | 102 | 33 |
| `instantiates` | **EMITTED** | 2 | 2 |
| `extends` | **RULED** | 0 | 0 |
| `implements` | **RULED** | 0 | 0 |

**8/10 on the relationship channel, and it is not a sample** — every derived file was
analyzed, so no file-count knob can move it. `imports[]` reported separately: 1,459
edges in 332 files on `ParseResult.imports`, which `parallel-indexer` writes to
`brain_import` and never to `brain_relationship`.

### The score DOES move with the file count, and here is the series

| `--nfiles` | files | score |
|---|---|---|
| 25 | 25 | **5/10** |
| 100 | 100 | **6/10** |
| 200 | 200 | **6/10** |
| 0 (full) | 359 | **8/10** |

The walk is alphabetical, so at N ≤ 200 it never reaches `src/test_mutex.c` or
`src/test_wsd.c`, which are 2 of the 2 files `instantiates` fires in. `exports` needs 2
files of the whole corpus and `overrides` 33. **A 200-file sample of this corpus cannot
see two of the four thin types and reports both as zero.** The 8/10 is a claim about
348 files, not about a draw.

### The shared instrument cannot measure a worktree, and this is re-measured

`script/m14/firing-check-v2.mjs:36` pins `const REPO = "$HOME/backbencher-brain"`
and imports the analyzer from there. Run from this worktree it graded **main** and
reported:

    C  6/10  200/200 parsed  imports[] 634  silent: extends implements exports overrides

Two of those four "silent" types were firing the whole time on the branch being graded
(`exports` 273, `overrides` 102). Same command, same corpus, same `NFILES`, and the two
numbers disagree because the instrument names a path instead of deriving one. The number
to quote for a worktree branch is the one from a ROOT-derived instrument
(`c-firing.ts` / `v8-*.ts`), and the defect is reported for the master rather than
patched here — `script/m14/**` is not this lane's file.

### The two RULED types, with the measurement that rules them

C's prose ruling was C-D1, "no class hierarchy", which is the same *shape* of claim that
was wrong for bash's `overrides` for a whole wave. Re-derived with
`v8-inheritance-probe.ts`, whose own first version was too loose twice and was corrected
(a `*` matched anywhere below a declarator reported 547 "pointers to a local tag" where
the strict class has 121; a duck-typed-implementation probe accepted `{ NULL }`, taking 46
rows down to 24).

**Instrument A — grammar inventory**, every node including anonymous tokens, `child(i)`
exactly as the shared gate walks it so the figure is comparable with its bash 164:

    203 distinct node types across the 348 files
    inheritance node types present: NONE of 20 probed
    object-creation node types present: NONE of 4 probed

This is positive evidence of absence rather than a search that found nothing: the parse
tree contains 203 node types and not one expresses a supertype clause. C cannot grow one,
because the construct *is* the grammar.

**Instrument B — the shapes C CAN express**, counted on the tree where a string literal
cannot fake them:

| shape | count | files |
|---|---|---|
| by-value member of a local TYPEDEF ALIAS | 388 | 57 |
| by-value member of a local TAG | 18 | 11 |
| inline anonymous aggregate member | 67 | 17 |
| POINTER to a local TAG | 121 | 16 |
| pointer to a local TYPEDEF ALIAS | 547 | 81 |
| brace-initialised all-function-pointer object of a local struct | 24 | 4 |

- **`extends` — RULED.** C has no supertype clause. What it has is composition, and the
  language already represents composition as `contains`, so a second label for one fact is
  what this lane's one-truth-per-fact property exists to prevent. The pointer shapes are
  refused for a *different* reason and the distinction is the substance: 121 + 547 = 668
  members are POINTERS to a local type, and `struct A *` is a *reference*, not a subtype.
- **`implements` — RULED.** Same Instrument A result. C's nearest shape is a struct whose
  every member is a function pointer plus a brace-initialised object of it: 24 objects in
  4 files, all `Jim_HashTableType` / `JimAioFopsType` in `autosetup/jimsh0.c`. The
  refusal is not the count. The shape is a **convention and not a language interface** —
  nothing in C declares it, nothing checks it, and a struct with one non-function-pointer
  member would satisfy no interface at all.

**Falsifiable, as a ruling must be:** a non-zero count for any Instrument-B class, or any
of the 20 inheritance node types appearing in the inventory, overturns it.

### The six questions, answered per already-emitted type

Source derivation answers **question 1 only**, and the `q1` column is the proof: `overrides`
reads 2 construction sites on this branch and **0 on main**, because a generation landed.
A construction site is not a firing branch.

| type | 1 exists | 2 fires | 4 labelled | 5 both ends resolve | 6 conf < 0.7 |
|---|---|---|---|---|---|
| `calls` | 1 site | 76,422 / 318 files | 286 self-edges (`f calls f`, recursion) | **31.86%** | 0 |
| `uses` | 2 sites | 46,706 / 296 | 4 self-edges | **61.73%** | 0 |
| `imports` | 1 site | 1,459 / 332 | clean | **0.00%** — by construction, see below | 0 |
| `references` | 1 site | 8,799 / 212 | clean | **89.68%** | 0 |
| `contains` | 1 site | 6,147 / 227 | 0 self-edges | **100.00%** | 0 |
| `exports` | 2 sites | 273 / 2 | 0 self-edges | **93.41%** (18 sources name no symbol) | 0 |
| `overrides` | 2 sites | 102 / 33 | **102 of 102 are `X overrides X`** | **100.00%** | 0 |
| `instantiates` | 1 site | 2 / 2 | clean | **100.00%** | 0 |

- **Question 3 (correct), and its declared limit.** Every oracle reachable from inside
  this repository is a **second walker over the same wasm grammar**, so it convicts a
  disagreement between two implementations of a rule and is structurally blind to a
  defect in the grammar. Only `contains` has a genuinely independent reference (clang 14);
  that figure is quoted above, not reproduced here. `v8-edge-adjudication.ts` is no
  exception and says so in its own output.
- **`imports` resolving at 0.00% is not a defect.** The target is a module path and the
  source is the file-scope identity `global`; neither is a symbol, by construction of the
  type. Reporting it as a failure rate would be a false finding.
- **Question 6: nothing is under 0.7**, so no C edge is a heuristic by the contract's
  threshold. 0 edges are missing a `line_number` out of 141,455 measured.

**`overrides` is 102 self-edges out of 102 edges — adjudicated, because it is the one
number a reader should not take on trust.** The edge runs from the LATER definition to the
EARLIER one and both endpoints are the same name, so every edge is `X overrides X`: a fact
about one symbol rather than a relation between two. Whether that is the right *use* of
`overrides` for a language with no superclass is a question of family policy, not a C
defect, and it is stated here rather than left to be discovered by a consumer. What IS
measurable is that each edge's own claim holds: see the adjudication below.

### The two DERIVATION debts, and the label the shared differential fails on

`validation/m60/rel-type-coverage-baseline.json` records two open DERIVATION findings for
this lane — `contains` and `exports`, "emitted and compared against nothing".
`overrides` is a **third in substance and not in the register's reckoning**, and the
differential's own G20 check says so directly:

    [label-dump] c: overrides  truth=0  comparable=11  <-- COMPARED WITH NO TRUTH
    1 lane(s) COMPARED A LABEL WITH NO TRUTH ... exit 6

so every `overrides` edge on the sampled corpus is counted `unexplained` and **the
milestone's gate fails on the C lane**. That is the truth being blind, not the analyzer
inventing edges — but "the oracle is blind" is not a coverage claim.

`v8-edge-adjudication.ts` is the independent second opinion, and it adjudicates each
edge's **own claim** against the parse **at the line the edge names** — which is
narrower and, for these two labels, stronger than re-deriving the rule:

| label | edges | confirmed | REFUTED | unadjudicable |
|---|---|---|---|---|
| `overrides` | 102 | **85** | **0** | 17 |
| `exports` | 273 | **273** | **0** | 0 |

Every one of the 273 `exports` targets resolves to a `#define` in the same file whose
replacement list's first word is `extern` — 273 of 273. All 17 unadjudicable `overrides`
edges are in `ext/wasm/libcmpp.c`, where the grammar produces **no `preproc_def` node**
for those lines: this lane's recorded gate property **P13** macro-inventory hole.
Reading the source settles them in the analyzer's favour — macro `E` is defined at 6141,
`#undef`ed at 6143, redefined at 7027, `#undef`ed at 7032, redefined at 7436 — and an
instrument that cannot see a region must not testify about it.

**The probe was wrong six times before it was right, and every one of the six was a
false refutation of correct analyzer behaviour.** `shares a conditional` compared a string
that contained the arm; the arm was labelled by the conditional's first containing
*direct* child, and in this grammar the `#else` body of an `#elif` chain is a
`preproc_else` **nested inside** the `preproc_elif`; `preproc_elif` and `preproc_else`
were not in the recognised node set; the `exports` source was required to be a
`function_definition` when it is a `declaration` (a prototype, or a function-pointer
**variable**) and the declarator walk then hit the `parenthesized_declarator`-has-no-
`declarator`-**field** trap this lane already documented as #990; the `exports` name was
keyed by the declaration's start row rather than the name's; and the `#undef` directive
token reads `#  undef`, not `undef`. **An adjudication probe that refutes 100% of a class
is telling you about itself**, and the only reason these were caught is that each was
checked against the source text *before* being reported as an analyzer defect.

### `exports`/`overrides`: a `line-audit` row that is not a defect

`line-audit.ts` reports `exports 272/273 = 99.63%` with every other type at 100.00%
whole-token. The single row is **not** an analyzer defect: line-audit asks whether the
named line contains the edge's **target**, and an `exports` target is the **marker macro**,
which in the multi-line prefix form sits on its own line above the declaration it prefixes:

    764  CMPP_EXPORT
    765  void cmpp_outputer_set(cmpp *pp, cmpp_outputer const *out, char const *zName);

`line_number` 765 is the name-bearing node's row and is correct. **The test is
mis-specified for this one label**, and it will report one false off-line row per
multi-line prefix form forever. The other 272 pass because marker and declaration share a
line there.

### R7: 159 `contains` edges name a type that is written in no source file

Question 6 asked for it and the answer is not zero. Measured on the 348 files, **uncapped**
(my first version printed the 40-row SAMPLE cap as the count, which is the dart-census
shape of defect):

| placeholder literal | count | which end | which type |
|---|---|---|---|
| `anonymous_enum` | 90 | SOURCE | `contains` |
| `anonymous_struct` | 67 | SOURCE | `contains` |
| `unknown` | 4 | TARGET | 3 `uses` + 1 `contains` |
| `anonymous_union` | 2 | SOURCE | `contains` |

**The four `unknown` rows are TRUE and are R7 false positives on this corpus.**
`autosetup/jimsh0.c:663` reads `Jim_Obj *unknown;` — jimsh names a member `unknown` — and
the four edges are correct facts about it (`i->unknown = Jim_NewStringObj(...)`,
`Jim_DecrRefCount(i, i->unknown)`, `Jim_GetCommand(interp, interp->unknown, ...)`).
Recorded so the next sweep starts from 4 known-benign rows.

**The 159 `contains` rows are real.** `anonymous_struct` / `anonymous_union` /
`anonymous_enum` are the analyzer's own fallbacks from `specifierOwnName` and
`extractEnum`, reached whenever an aggregate has no tag and no typedef alias — legal C,
and the shape sqlite uses constantly:

    src/date.c:676          static const struct { u8 nName; char zName[7];
                               float rLimit; float rXform; } aXformType[] = {...};
    src/util.c:1000         static const union { char a[201];
                               short int forceAlignment; } sqlite3DigitPairs = {...};
    autosetup/jimsh0.c:1344 enum { REG_NOERROR, REG_NOMATCH, ... };

18 symbols carry those names. In `jimsh0.c` alone, **89 `contains` edges** name
`anonymous_enum` as their source, where **four distinct anonymous enums** (:1344, :13788,
:14421, :15202) are all published under the single string `anonymous_enum`. So one edge
source denotes four different C types. `bb_graph` on `anonymous_enum` returns a type with
89 members that belong to four types.

**Two of this lane's own fixtures pin OPPOSITE contracts for this, and both pass today
(41/41).** `c/layout-widths-from-ast-936` (a **file-scope** `enum { SLOTS = 4 };`)
*expects* a symbol named `anonymous_enum` and calls it "the documented contract";
`c/macro-wrapped-heading-917` (a **function-local** `enum { BufSize = ... };`) *forbids*
the same name. So #961 removed the placeholder for a function-local anonymous enum and
left it for a file-scope one, and 936 records the residue as intended behaviour. #961's own
reasoning — a type definition emits no code; visibility is a separate fact — applies at
file scope *a fortiori*.

**Not fixed, and the reason is a decision rather than a patch.** Three rulings already
close the alternatives: #952 refused to name a file-scope anonymous struct after its
variable ("naming the type after the variable would publish a type that does not exist"),
and #987 ruled option (d) — minting a qualifier such as `anonymous_enum.0` — out as "a
name written in no source file, which is the fabrication class #962 removed from
`instantiates` and #963 removed from `exports`". That leaves refusal, and its measured
cost is **159 edges and 18 symbols across 12 files**. It also changes a behaviour a
fixture calls "the documented contract", and it moves `contains-vs-clang`'s 421/421
because `date.c` and `util.c` are inside that corpus's `src` slice. Both belong in one
commit with the fixture change and the **re-measured** clang number, not folded into a
measurement.

### The lane's own gate, run on sqlite for the first time

`verify-c-lane.ts` had never been pointed at `sqlite`, which is `LANG_REPOS.c`. Run
there: **properties 6 VIOLATIONS**, mutants 48/48 caught, measured cost CAUGHT.
**The lane gate FAILS** and is reported as it came out.

| # | rows | adjudication |
|---|---|---|
| P6-named-symbol | 1 | **A PROPERTY FALSE POSITIVE, not an analyzer defect.** The member is `Jim_Obj *unknown;` at `jimsh0.c:663`. P6 tests a name against a list of placeholder literals and cannot tell an analyzer fallback from a name the SOURCE chose, so it will report this on every future run over jimsh. |
| P8-conditional-member-redeclaration | 5 | **TWO REAL DEFECTS**, both #987's ambiguous-owner class through doors #961 and #958 did not close. P8's own wording is the argument: an UNCONDITIONAL repeated member name is not legal C, so a repeat means two different declarations collapsed onto one owner. |

**P8 defect 1 — `ext/wasm/libcmpp.c`, 12 `contains` edges under one owner `ops`:**

    13878  enum ops { op_none, op_set, op_push, op_pop, op_heredoc };
    14127  enum ops { op_invalid, op_set, op_push, op_pop };
    14303  enum ops { op_none, op_set, op_push, op_pop };

Three **function-local** enums, three different C types, one published name; `op_set`,
`op_push` and `op_pop` are emitted 3× each. #961 qualifies an *anonymous* local type by
its enclosing function, but this enum carries a **tag**, so `enumName` is `ops` and the
qualification never fires. The tag is the collision, and C keeps a block-scope tag
invisible outside its block — which is why three functions may each write `enum ops` and
all three be correct.

**P8 defect 2 — `ext/rtree/geopoly.c:1803,1821`,** two `contains` edges under
`sqlite3_geopoly_init.anonymous_struct -> zName`, from two DIFFERENT anonymous structs in
one function. #958 fixed this for an aggregate that is a *member* of a named type; here
the aggregate is the type of a function-local `static`, so the only handle is the
variable name, and #952 already refused that. The path that results puts the
**placeholder literal in the middle of it** — #958's defect verbatim and the same R7
class measured above.

**Not fixed.** Each needs its own fixture and its own decision, both of #987's shape, and
option (d) is already ruled out. Left open with the count, which is more useful than a
guess.

### Gates re-run at this commit

| gate | result |
|---|---|
| `run-fixtures.ts --lang c` | **41/41 pass, 0 fail** |
| `verify-c-lane.ts --corpus sqlite` | **48/48 live mutants caught, 5 retired with stated reasons · 6 property violations · LANE GATE FAILS** |
| `verify-c-lane.ts` measured cost | **CAUGHT — reverted/fixed 1.22× median-of-paired**, on `sqlite/src/btree.c` (407,753 B), metric CPU ms min-of-9 after a discarded warm-up, **load1 15.79 disclosed** (the box is shared; the wall figures carry that) |
| `audit-analyzer-grammar.ts c` | **PASS — refs 68, unknown 0, unknownFields 0** |
| `differential.ts --lang c --repo sqlite` | **`calls`/`uses`/`references`/`imports`/`instantiates` exactly agreed, MISSING 0; `overrides` COMPARED WITH NO TRUTH → exit 6** |
| `rel-type-coverage-gate.ts --langs=c` | **2 findings, `contains` and `exports`**; reachability, agreement and enum checks clean |
| P13 floor for the sqlite slice | **UNRECORDED — 119 `#define` directives carry no macro symbol; reported, not scored** |

**The measured-cost check's default path is broken**: `verify-c-lane.ts:1527` defaults
`C_LANE_PERF_FILE` to `$HOME/ishaq/fixtures/repositories/redis/src/server.c` —
another user's home directory — so it **SKIPS and reports nothing** on this box. The row
above was produced by pointing the env var at a real file this corpus owns.

**Not measured, and not claimed:** the `bb_graph` payload budget (un-narrowed
`relationshipTypes` at 2.5–4.8× a filtered answer) is not measurable from this lane. No
edge was added this pass, so no payload regression is attributable to it — and saying
"no regression" without measuring the payload would be the wrong kind of claim.

### Outgoing only

Analyzers emit edges **from the file being analyzed**. Resolving who points **at** a
symbol is reverse-edge resolution, a subsystem that does not exist in this repository.
Nothing in this section measures incoming edges, and the 31.86% `calls` and 61.73% `uses`
resolution rates above are per-file by construction (C-D2), not a statement about the
graph as a whole.

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

| relationship | edges | #985 |
| --- | --- | --- |
| `calls` | 199,929 | — |
| `uses` | 86,948 | — |
| `imports` | 10,993 | — |
| `contains` | **17,343** | **−53** (was 17,396) |
| `references` | 10,538 | — |
| `exports` | 957 | — |
| `instantiates` | 5 | — |

The `contains` movement is the whole of #985's effect on this corpus, and only `contains`
moves. Reproduce with the scope spelled out, because the count moves with it and a census
whose denominator depends on whatever else is checked out is not evidence:

```
bun run script/m14/tmp/c-audit/census.ts \
  --repos $HOME/ishaq/fixtures/repositories/{curl,libgit2,redis} \
  --ext .c,.h --limit 900
```

`script/m14/tmp/c983/delta.ts` is the instrument for the change itself: it builds both
analyzer versions from one source and measures one fixed 3,997-file set (all four
corpora), so the −112 `contains` there and the −53 here are two scopes of one
measurement, and the per-relationship identity of every other type is the stronger claim
— `calls` 239,405, `uses` 93,759, `references` 10,985, `imports` 20,105, `exports` 957,
`instantiates` 9, all byte-identical before and after.

**Performance** — wall 88.5 s, CPU 115.3 s (ratio 1.30), **35.4 ms/file** wall,
**46.1 ms/file** CPU, **21.7 ms per 1,000 nodes**
(curl 22.1 · libgit2 33.3 · redis 55.4 ms/file wall; 36.7 · 43.3 · 62.1 CPU).
#977 fixed the census CPU metric, which double-counted its own baseline and reported
**negative** CPU; a perf instrument that can go negative cannot support a claim, so
this was fixed before any timing was quoted. **These figures are NOT comparable to the
46.96 ms/file previously recorded here** — that run was measured at `load1` 22–49 and
this one at `load1` 2.85–6.11, and this file's own note above the complexity table says
the box is shared and the wall figures carry that disclosure. The CPU column is the one
to compare across runs.

**Neither #985 nor #986 is a hot-path change, and that is measured rather than argued.**
#985 is a constant spread into a list literal inside a loop that already iterates the
same children; #986 is one `inlineAggregateOwnerName` call per anonymous enum, which is
the pre-#986 branch's cheaper path. Re-measured across the two changes, CPU per file moved
36.1 → 36.2 (curl), 41.1 → 41.1 (libgit2), 54.9 → 58.8 (redis) — the redis figure is the
only one that moved and it is inside the run-to-run spread this file's own disclosure
covers. The per-band and per-quartile breakdown in `c-corpus-census.json` is the
measurement that would show a real hot-path change; the top-level average is not, and
quoting it as though it were is how a perf number stops meaning anything.

**Line numbers** — **442,710/442,710 = 100.000%** of edges name a line containing the
target as a WHOLE TOKEN, over the four corpora (curl 71,543 · libgit2 188,694 · redis
326,757 · zig 442,710), 0 substring-only (#974, `script/m14/tmp/c-audit/line-audit.ts`,
`validation/m12/results/c-line-audit.json`). Whole-token rather than substring
because `uses` is dominated by single-character targets, where `line.includes("n")`
would pass a wholesale off-by-N offset. The total moved from 442,774 to 442,710 for
the same reason `contains` did — a phantom member's line was on a line, so removing it
removes a passing row. Per type: `calls` 285,234 · `uses` 97,090 · `contains` 25,551 ·
`references` 20,672 · `imports` 13,201 · `exports` 957 · `instantiates` 5.

**Unknown symbols** — **0** unknown kinds and **0** empty names across all
2,498 files; F1 reports 67 refs, unknown=0, unknownFields=0.

**P11 / no regex** — `src/ast/real-c-analyzer.ts` contains **no regex literals in
code** (#975 removed the last, `/^\d+[uUlL]*$/`, replaced by a character scan proved
equivalent over 4,394 exhaustive + 400,000 fuzz cases). The only remaining mentions
of regex syntax are in comments recording earlier replacements.

**Gates** — fixtures **37/37** (was 35/35; `c/macro-type-member-985` and
`c/inline-enum-member-path-986` are the new ones, and both FAIL without their fix) · live
mutants **43/43** caught, 5 retired · 0 property violations · M12 truth drift 92 facts,
85 still-produced, 7 produced-under-another-type, **0 not-produced** · imports audit 0
fabricated over 10,941 edges · differential **0 unexplained** in the C lane on curl,
libgit2 and redis.

**`validation/m12/results/c-differential.json` is regenerated, and its `passed: false` is
the TRUTH being stale rather than the analyzer.** It was previously treated as not this
lane's artifact — the handoff recorded it as "stale, 39/65 input hashes" and attributed
it to the canonical 40-language sweep. It is per-analyzer, keyed on one language, and
`bun run script/m12/verify-analyzer.ts c` regenerates it in seconds. Refreshing it moved
every number the right way: true positives **79 → 85**, false negatives **13 → 7**,
recall **0.859 → 0.924**, and the input set from 65 files to **26** — the generator now
pins the inputs that reach the C lane rather than every analyzer in the tree, so 39 of the
"stale" hashes were never this artifact's to hold. An artifact that pins 39 files it does
not read reports itself stale every time an unrelated lane lands, which is what happened.

All **7** remaining false negatives are rows where the truth is behind, and each says so in
its own evidence text:

| row | why the analyzer is right |
| --- | --- |
| `references:global:Module.h` and 5 siblings | the edge is emitted under the first-class `imports` kind (M60/#910); the truth spells it `references` |
| `instantiates:buffer_create:Buffer` | `Buffer` is declared in `Module.h`, so from `Module.c` it is cross-file, and the truth's own note reads `RE-TARGETED UNDER C-D2 … the row is therefore RETARGETED` |

> **C_FIX2 addendum, 2026-10-05.** The rows above are the fixture-based M12 differential
> and are unchanged. The **corpus** differential is a different measurement and it now
> exits **6**: `BB_CORPUS_ROOT=… bun run script/m14/differential.ts --lang c --repo sqlite`
> reports covered **8,283/8,284 (100%)**, **MISSING 1**, **21 unexplained (0.3%)**,
> heuristic 0, `unexplained-by-label: overrides=19, uses=2`. The 19 `overrides` rows are
> the DERIVATION finding — the shared oracle derives no `overrides` truth for C, so every
> one of those edges lands in `unexplained`, which the harness says in its own output is
> *"not coverage"*. They are audited by `c-audit/c-oracle.ts` instead (83/83, 0/0 on the
> 228 files that oracle can see). The 2 `uses` rows and the 1 MISSING
> (`uses (expr) -> cmpp_tt__last`, `ext/wasm/libcmpp.c:13778` — a read inside a `printf`
> macro argument, which **#988 already ruled on**: measured, 83.7% of macro arguments name
> nothing the file declares) are left as reported rows.

The 17 false positives are the three classes this file already records: an `imports` edge
the truth spells `references`, a `references` edge for a typedef declaration site the truth
does not mention, and a value-less `#define` include guard the truth lists as NOISE and the
analyzer mints deliberately (#901 — dropping it lost two real edges). `c-truth-drift.json`
carries the per-row adjudication and is the instrument to read, because it compares row by
row where this artifact compares by aggregate.

The mutant count moved 41 → 43, for `c-lane/macro-type-member-name` (#985) and
`c-lane/inline-enum-member-path` (#986). The count of SURVIVORS moved 0 → 0 only after
`c-lane/macro-generated-field-name`'s revert was widened to remove both guards — see the
#985 section. A gate that reported 43/43 while one of them survived would have been the
worse outcome.

### #983 MEASURED: 99.95% of those edges would be dangling, so sub-decision 1 is not a tradeoff

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

**Two sub-decisions, and the second was framed as the interesting one.**

1. *Should* params and locals be referenced?
2. *What is the source name?* The oracle writes `(expr) -> s1`, i.e. it does not
   track the owning function and falls back to a generic bucket. The analyzer's
   existing convention is the FUNCTION NAME (`uses:add->G`), which is strictly more
   informative.

**Sub-decision 1 is now MEASURED rather than open, and the answer is no — not as
taste, but because the target does not exist.** A relationship target must name
something a consumer can resolve: that is the ruling that removed
`exports -> KERNEL_EXPORT` (#963) and `instantiates -> malloc` (#962), and it is
stated in this file at line 1410. So the question is not "should we add an edge" but
"what would the edge point at". Measured over 300 corpus files / 1,472 functions
(`script/m14/tmp/c983/local-read-resolvability.ts`):

    distinct param/local names READ inside a body:  7,552  (3,468 params, 4,084 locals)
      93.51%  no symbol of that name exists anywhere in the file
       6.18%  the name also belongs to a `property` — a struct member of some
              OTHER type, so naming it would be a MIS-ATTRIBUTION
       0.23%  a `struct`, likewise unrelated
       0.03%  a `property` and a `type`
       0.05%  RESOLVABLE — 4 names, and all 4 are worse than useless:
              3 shadow a same-named file-scope binding (exactly the
              mis-attribution CGD15 exists to prevent) and 1 is a `variable`
              symbol that should not have been published at all

So the residue is not a feature waiting to be switched on. It is 99.95% the
dangling-edge class this ontology already refuses, plus the shadowing class the
family already gates. Publishing it would trade a missing edge — which the family
ranks as the acceptable direction — for a false edge, which `real-java-analyzer.ts:2320`
names as "the false-edge class the ruling ranks worse than a missing edge".

**The 4 resolvable names, individually**, because they are what a decision on this
would actually ship: `multi` (multi-event.c:152, a parameter shadowing the
file-scope `static CURLM *multi` at :36), `j` (smooth-gtk-thread.c:75, same shape),
`certinfo` (tool_writeout.c:168, a local shadowing a function of that name), and
`retcode` (netrc.c:651, discussed below). Every one is a case where the edge would
be FALSE, which is the strongest form of the answer.

**Sub-decision 2 is therefore moot**, and it was the weaker half anyway: the
comparison is site-agnostic on label+target (`differential.ts:21090`), so `from` is
attribution only and the oracle's `(expr)` could never have matched the analyzer's
function name or not. Nothing is gained by moving the payload toward the less precise
form. The one thing the measurement settles FOR the future is that if a lane ever
publishes a local or parameter symbol, `uses` must resolve against THAT symbol, and
Clean's `qualifiedName` shape (`real-clean-analyzer.md:184-190`) is the family
precedent for making such an edge resolvable.

**Two probes were wrong first, in the same direction, and both inflated the
resolvable set.** A FILE-WIDE set of body-bound names made `uses global ->
writeOffset` (tool_writeout.c:428, a function name used as a value in a static
table initializer) count as a read of a local of that name, because an unrelated
function in the same file binds it — 21 spurious rows. And within that, walking the
whole `declarator` rather than the `parameter_list` picks up the function's OWN name,
which made `DEBUGASSERT(wovar->writefunc == writeTime)` (tool_writeout.c:53) inside
`writeTime` look like a read of a parameter called `writeTime`. That is the same trap
`real-c-analyzer.ts:2941` records. The bound set must be per function, because that
is the scope CGD15 applies at.

**A real defect fell out of the fourth case, and it is separate from the ruling.**
`retcode` resolves because a file-scope `variable retcode` was published for a name
declared only at netrc.c:586, inside `Curl_netrc_scan`. That function's body is
truncated by parse recovery at L657, so L659's `retcode = netrc_scan_file(` sits
outside every `function_definition` range and is read as file scope. Measured with a
brace counter (the PHYSICAL nesting, immune to the parse damage that caused it), over
400 files: **2** file-scope `variable` symbols published on a line at brace depth > 0,
of which `netrc.c:659 retcode` is the real one — `tool_doswin.c:670` is a struct
declaration's closing line, a false positive of the counter. Small, and the truncated-
body class is already recorded (#916/#928 recovery), so it is noted rather than
claimed as a new ruling.

**Not taken.** A change that doubles a published relationship count is a ruling for
the lane owner, not a patch for an agent. The measurement is recorded so the choice
can be made deliberately — and so that if it is ever revisited, the reason not to is
a number rather than a preference.

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
(curl's reach was later measured to be a genuine corpus limit and left closed as
one — see the oracle section. libgit2's 0 turned out to be two harness faults and is
now 74 records / 454 members; see #985.)

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

The first is the `h1_tunnel_state` typedef/tag collision (an AMBIGUOUS OWNER, recorded
below). The second, `BIT(...)`, was already ruled and is the documented limitation.

**A THIRD defect class surfaced once the oracle could read libgit2 at all**, and it is
neither of those: a macro in TYPE position was published as a member name beside the
real one. That is #985, immediately below.

### #985: a macro in TYPE position was published as a member name, BESIDE the real one

The class #928's ruling could not see, and it was live on 60 `contains` edges.

    #define git_array_t(type) struct { type *ptr; size_t size, asize; }
    struct git_blame {
      ...
      git_array_t(size_t) line_index;      /* libgit2/src/libgit2/blame.h:78 */
    };

parses as

    field_declaration
      macro_type_specifier        <- the TYPE. Its first identifier is the MACRO's
                                     OWN NAME (`git_array_t`).
      field_identifier            <- the real member (`line_index`)

**#928 already refused the adjacent shape, and its test cannot see this one.** For
`BIT(closing);` the macro owns the name and the declaration carries NO declarator at
all, so `fieldDeclarationHasDeclarator` (`real-c-analyzer.ts:654`) refuses the whole
field and the honest result is silence. Here a declarator IS present — the macro is
the type and a separate declarator names the member — so that refusal does not fire.
The extractor's per-child loop then treats every child that is not a type node as a
DECLARATOR, and `macro_type_specifier` was in neither the type list nor the skip list,
so it was descended for its identifier and published beside the real one:

    contains git_blame -> git_array_t   <- phantom; clang reports it PHANTOM
    contains git_blame -> line_index    <- correct, and unaffected

The published result was `contains git_blame -> git_array_t` NEXT TO
`contains git_blame -> line_index`, and a `property` symbol for the macro that a
reader can navigate to and that resolves to no declaration. This is the #928 defect
verbatim: a member whose name is a name no C declaration in the file gives to any
member.

**It is NOT C-D2.** Whether the macro *expands* to a whole aggregate is unrecoverable,
and no member is invented for one — but the real member is right there in the parse
and was already published. Only the duplicate goes. That distinction is what separates
this from the `contains` half of #981's ruling, which was correctly refused on C-D2
grounds: there the member name itself was unrecoverable, here it was never missing.

Measured over the four declared corpora (3,997 files,
`script/m14/tmp/c983/macro-type-phantom.ts`): **60** phantom `contains` edges, **48**
of them sitting beside the correct member, across **19** macro names —

| macro | rows | where |
| --- | --- | --- |
| `git_array_t` | 13 | libgit2 `git_blame`, `git_tree`, `git_commit`, `git_patch`, `git_rebase`, `git_repository`, `git_filter_list`, `git_pathspec_match_list`, `config_file`, `diff_driver`, `mempack_db` |
| `ql_elm` | 11 | jemalloc `mpsc_queue`, `emitter_col_s`, `witness_s`, `tsd_init_block_s` |
| `ql_head` | 5 | jemalloc `emitter_row_s`, `tsd_init_head_s` |
| `rb_node` | 5 | jemalloc `hpa`, `rb` |
| `STACK_OF` | 1 | curl `openssl.c:4655` |
| `HRESULT` / `ULONG` | 4 | libgit2 `deps/winhttp/urlmon.h` |
| `GIT_ALIGN` | 1 | libgit2 `src/util/pool.c:19` |
| C++-header debris | 16 | `noexcept`, `decltype`, `operator`, `_LIBCPP_CONSTEXPR*` — tree-sitter-c parsing libstdc++/libc++ as C |

The detector is **structural**, not lexical, and that distinction is load-bearing: a
first version tested whether the member name is a file-scope macro and reported **0**
of a class clang sees as 6 phantoms, because libgit2's `git_array_t` is defined in
`src/util/array.h` while the field is declared in `include/git2/blame.h` — within one
file the name is not a macro at all. The test is whether the name came out of a
`macro_type_specifier` / `macro_prefixed_type_specifier` node.

**The fix names both node types**, because `macro_prefixed_type_specifier` is a
different node for the same idea (libgit2's `GIT_ALIGN(char data[N], 8);`) and a
fix that covered only the first would have left that one publishing
`contains git_pool_page -> GIT_ALIGN`. It is a spread into the existing skip list, so
both the struct and the union loop — which share the list — are covered by one
constant, `MACRO_TYPE_NODES` at `real-c-analyzer.ts:625`.

Measured `contains` delta attributable to this change alone, on one fixed 3,997-file
set with both analyzer versions built from the same source
(`script/m14/tmp/c983/delta.ts`): **20,794 → 20,682 (-112)**. Every other relationship
type is byte-identical: `calls` 239,405, `uses` 93,759, `references` 10,985,
`imports` 20,105, `exports` 957, `instantiates` 9. The delta exceeds the phantom count
because the phantom also carried a `property` symbol, and a struct's published width is
computed from its member list.

Pinned by `validation/m14/fixtures/c/macro-type-member-985` (36th C fixture), which
FAILS without the fix and whose controls are the rows a `continue` would have cost:
the real members beside the phantoms (`payload`, `entries`, `index`, `counts`,
`slot`), the object-like-macro type that was always correct (`MYINT plain`), and
#928's own shape, which must stay silent.

**#928's predicate became unobservable, and the mutant had to be widened to say so.**
With this skip list in place, reverting `fieldDeclarationHasDeclarator` alone changes
NOTHING: measured over the same 3,997 files, **0 symbols and 0 relationships differ**
(`script/m14/tmp/c983/928-residual-corpus.ts`). The two guards overlap on `BIT(closing);`
and each covers the other, so `c-lane/macro-generated-field-name` **survived its own
fixture** and the gate reported it honestly rather than a false CAUGHT. Its revert now
removes both guards.

The predicate is not dead — instrumented over 1,499 files it is called **12,461** times
and refuses **540** of them (`script/m14/tmp/c983/928-is-it-dead.ts`) — it has simply
become unobservable on this corpus, because every field it refuses is one the skip list
also refuses. Both guards are kept; the redundancy is recorded rather than resolved by
deleting a rule that is still correct on shapes this corpus does not contain. A sixth
retired mutant would have been the wrong trade: the class is still convicted, by
`c-lane/macro-type-member-name` on the #985 half.

### #981 ruling: a macro argument inside a field declaration is dropped entirely

Before patching, the four adjacent shapes were measured so the ruling rests on
what the analyzer already gets right:

    struct S { int nsent; BIT(chunked_encoding); };   contains:S->nsent
    struct S { int nsent; MYINT foo; };               contains:S->nsent  contains:S->foo
    struct S { int nsent; union { int a; float b; } u; };  contains:S->nsent
                                                            contains:S->u  contains:S.u->a
    void f(void){ BIT(chunked_encoding); }            calls:f->BIT

The second of those four is now load-bearing in a way it was not when written: `MYINT foo`
was correct because an object-like macro parses as a plain `type_identifier`, never a
macro node. `git_array_t(x) lines;` is the function-like spelling and it was NOT correct
— that is #985, above.

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

1. `uses:S->chunked_encoding` was the only genuinely NEW claim here, and it is now
   **REJECTED on measurement** — see the #988 section. The claim was that a `uses` edge
   is weaker than `contains` and so survives where ownership does not; measured over 600
   files, **83.7%** of macro arguments name something with no symbol to point at (31.5% are
   the enclosing function's own locals, 52.2% are declared nowhere), so the edges are the
   dangling-edge class #983 is refused on, reached from the opposite direction. The
   reasoning was sound about the relationship and silent about the target.
2. `contains:S->chunked_encoding` is NOT provable. `contains` asserts the struct
   OWNS the member, which is only true if `BIT` expands to a bitfield whose name is
   its argument. That expansion is exactly what C-D2 forbids, and a macro that took
   two arguments or renamed its parameter would make the edge false.

So claim 2 does not ship and, as #988 later measured, neither does claim 1 — for a
different reason, set out in its own section. The oracle's 30 misses become a DECLARED
LIMIT in the same shape as #963's typedef-return marker loss: real, measured, named, and
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

**curl's reach is still 0, and the reason is structural rather than a missing flag.**
curl's headers are generated by `configure`, and each `-D` that fixes one
complaint exposes the next: without `SIZEOF_CURL_OFF_T` every file dies on
`curl_setup.h:537: "too small curl_off_t"`, and *with* it curl defines its own
`struct timeval` which then collides with glibc's at `curl_setup.h:850`. Reproducing
that means reproducing configure's ~200 probes, after which the number would be a
property of my flag set rather than of the corpus. That is a corpus fact and it stands.

**libgit2's 0 is now CLOSED, and it was two HARNESS faults wearing a corpus fact's
clothes** — the diagnostic each one produced named a file outside the corpus under
test, which is the signature the file already records for the unbounded-scan fault
above. #981 got libgit2 to 22 judged files; #985 finished the job at **74 records /
454 members / 96.04%**, and the split between the two sides is the whole story of that
number:

| cause | what it looked like | why it was the harness |
| --- | --- | --- |
| `libgit2/include/git2/stdint.h` is an MSVC-ONLY shim (whole body inside `#ifdef _MSC_VER`) and it SHADOWS the C library's `<stdint.h>` | 119 of 120 files died on `/usr/include/inttypes.h:290:8: error: unknown type name 'intmax_t'` | naming the forced includes absolutely does **not** fix it — `#include_next` from clang's own `stdint.h` still finds the shim. A root that ships a C-standard-named header is now refused outright. |
| the synthesised `git2_features.h` undefines every `#cmakedefine`, including `GIT_SHA1_BUILTIN` | 79 of 120 files died on `src/util/hash.h:30: field has incomplete type 'git_hash_sha1_ctx'` | "no optional backends" is not a real configuration: the SHA1 backend is not optional, it is the default. A real `cmake`-configured build's `gen_headers/git2_features.h` (which is what `--extra-include` supplies) resolves all 79. |

The first row is the more interesting one, because the probe's forced-include mechanism
(`-include stdint.h`, added so `uint8_t` would be available in a file compiled in
isolation) is exactly what made the shim reachable: `-include` resolves through the
`-I` path, so `-I include/git2` won over `/usr/include`. The bound that keeps a sibling
corpus off the include path is what delivered a header that shadows the standard
library. The 4 remaining unmeasurable files carry their reasons: two C++-in-C
(`cli/opt_usage.h: unknown type name 'FILE'`), one win32 (`windows.h`, genuinely
absent on this host), one hashmap_oid.h.

**The 18 misses are one class and it is the C-D2 limit, already ruled.** All 18 are
`ptr` / `size` / `asize` of a `git_array_t(...)` member — six members × three fields
(`blame.h:74` and `:78`, `commit.h:22`, `config_file.c:34`, `diff_driver.c:41`,
`filter.c:39`). clang sees the macro's *replacement list* and so sees the anonymous
struct it expands to; the payload sees the macro and publishes the member it was given
(`lines`, `line_index`, `parent_ids`). Whether the parameter lands in name position is a
property of the replacement list, which is exactly the reasoning `c/macro-generated-field`
(#928) and the `contains` half of #981's ruling already rest on. Silence, not invention.
**The 6 phantoms are gone at 0**, and they were all #985's `git_array_t` — the fix is
what moved that number, and the same probe run before the fix reported 6 phantom and
after it reports 0.

Reach is reported, never assumed, and every unmeasurable file carries a named reason —
the probe was built after a first version returned a bare `null` and reported curl as
"0 of 100 measurable, no diagnostic", which reads exactly like a clean result.

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

### #986: an anonymous inline enum is a member PATH, and it was collapsing onto the container

The last shape `inlineAggregateOwnerName` did not cover. `typedef union { enum { A_ONE,
A_TWO } first; int n; } U;` published

    contains U -> first
    contains U -> A_ONE        <- a member of `first`, published as a member of U
    contains U -> A_TWO

so a consumer reading `U` sees `A_ONE` beside `first` and `n` and cannot learn that `first`
is a type of its own with two enumerators. **The two adjacent shapes were already correct,
which is what makes this a defect and not a design choice:**

| shape | published | status |
| --- | --- | --- |
| `enum E { B_ONE } first;` — a **tagged** inline enum | `contains E -> B_ONE` | correct, the tag names the type |
| `struct { int x; } pt;` — an inline **struct** | `contains W.pt -> x` | correct, #950/#951 |
| `enum { A_ONE } first;` — an **anonymous** inline enum | `contains U -> A_ONE` | **#986** |

The mechanism is #961's rule firing on the same placeholder:

```ts
if (scope && scope !== "global" && enumName === "anonymous_enum") enumName = scope
```

`extractEnum` had no `inlineAggregateOwnerName` call, so an anonymous inline enum fell to
that rule — and for this shape `scope` **is** the container's name (`U`), which is exactly
the name the member path is trying to refine. #961's own case, a *function-local* enum, has
no member path, so the fix is one call to `inlineAggregateOwnerName` placed **before** the
scope rule and gated on it returning non-null. Two levels compose correctly
(`Nested.mid.inner -> deep`).

Measured over the four declared corpora (3,997 files,
`script/m14/tmp/c983/inline-enum-owner.ts`): **17** members across **6** files, 17 → **0**
after the fix. curl's `pl_unix_substate` carries **seven** inline enums in one union, so
that one file accounts for 35 `contains` edges published under the wrong owner; also
`pl_winNT_substate` (3) and `ftp_parselist_data` (1) in ftplistparser.c,
`stub_gss_ctx_id_t_desc` in curl_gssapi.c, `OperationConfig` in tool_cfgable.h, and
libgit2's `reftable_ref_record`, `reftable_log_record` and `refdb_reftable_stack_iterator`.

**This is #958's defect class reached from a different direction.** There the owner was a
placeholder that resolved to nothing, which looked broken. Here the owner is a REAL name,
just the wrong one, so nothing looks broken, nothing crashes, and no property gate fires.

**The `contains` COUNT is unchanged by #986** (17,343 before and after) — only the owner
changed — which is why the census alone could not have found it and why the structural
probe was needed. The `contains-vs-clang.ts` verdict is unchanged at 436/454 with 0 phantom.

Pinned by `validation/m14/fixtures/c/inline-enum-member-path-986` (37th C fixture, fails
without the fix) with a mutant, `c-lane/inline-enum-member-path`, whose controls each fail
differently if the fix is over-applied: the tagged enum must keep its tag, the inline struct
must keep #950/#958's path, the function-local enum must keep #961's scope (a fix that fired
before the member path existed would publish `f.first`, which resolves to nothing), and a
two-level path must not flatten.

### #987: the typedef/tag collision is ADJUDICATED as real, and the remaining choice is a loss either way

`typedef enum { H1_TUNNEL_INIT, ... } h1_tunnel_state;` beside `struct h1_tunnel_state { ... };`
is legal C — typedef names and tags live in separate namespaces — and the analyzer mints
the anonymous enum's owner from the typedef ALIAS, so it publishes both member sets under
one name:

    contains h1_tunnel_state -> H1_TUNNEL_INIT ... H1_TUNNEL_FAILED   (the alias)
    contains h1_tunnel_state -> dest, rcvbuf, request_data, ...      (the struct)

The doc recorded this as an AMBIGUOUS OWNER and left it unadjudicated, on the grounds that
"neither is a mechanical patch". **The part that was decidable is now decided**
(`script/m14/tmp/c983/namespace-collision.ts`), and it needed neither the corpus nor a build
configuration — six lines and clang's AST:

    TypedefDecl ns_probe_name   underlying type: `enum ns_probe_name`
    RecordDecl  ns_probe_name   tagUsed: struct, completeDefinition: true
    payload: symbols named ns_probe_name: enum, struct
    payload: contains ns_probe_name -> NS_ALPHA, NS_BETA, NS_GAMMA, field_one, field_two, field_three

So the distinction is real C, not a parse artifact, and the payload's owner attribution is
wrong about it. Corpus size, from the structural probe
(`script/m14/tmp/c983/ambiguous-owner.ts`): **9 files, 253 `contains` edges** under an
ambiguous owner — `cf-h1-proxy.c` (16), `curl_gssapi.c` (9), `ftplistparser.c` (35 + 10 + 10),
`tool_cfgable.h` (150), libgit2's `reftable-record.h` (9 + 7) and `refdb_reftable.c` (7).

**What is left is not a defect hunt, it is a choice between losses, and none of the options
is free:**

| option | what is preserved | what is lost |
| --- | --- | --- |
| (a) keep both under `V` — **current** | every member, nothing dropped | the OWNER of half of them is false; a consumer reading the struct gets enumerators it does not have |
| (b) `V` is the struct; the alias's members go | the struct's fields stay resolvable | the enumerators become unreachable — a NAMED loss |
| (c) `V` is the alias; the struct's members go | the enumerators stay resolvable | the fields become unreachable — a named loss |
| (d) mint a qualifier for the alias (`V.alias`, `V.0`) | everything | a name written in **no source file**, which is the fabrication class #962 removed from `instantiates` and #963 removed from `exports` |

(d) is ruled out by rulings this lane already made twice, and (a) is the status quo the
oracle reported as a phantom. Between (b) and (c) there is no evidence to prefer one — the
question is which loss a consumer can better absorb, and that is the owner's call, not an
agent's. **Not taken**, and now for a stated reason rather than a shrug: the class is
proven, the size is measured, and the only remaining input is a preference.

### #988: the macro-argument `uses` claim, measured and REJECTED

`e306ab09` argues the macro-argument `uses` is **provable** where `contains` is not: a
`uses` edge only says the enclosing function read the name, and a macro argument is
plainly a name that was written, so the claim should survive C-D2 even though ownership
does not. The reasoning is sound. It had never been measured, because a general rule
touches every macro call in every file.

Measured over 600 corpus files (`script/m14/tmp/c983/macro-arg-uses.ts`) — 1,585 macro
invocations carrying an argument list, **3,662** bare-identifier arguments:

| | count | share |
| --- | --- | --- |
| the name IS a declared symbol in the file | 597 | **16.3%** |
| the name is bound in a function body — a **local** | 1,153 | 31.5% |
| the name is declared **nowhere** in the file | 1,912 | 52.2% |
| already emitted as a `uses` today | **0** | — |

**83.7% of macro arguments name something with no symbol to point at.** The corpus
examples are not edge cases, they are the ordinary shape of a macro call:
`CPOOL_UNLOCK(cpool)`, `altsvc_free(as)`, `tcplocalhost(cf)` — in every case the argument
is the enclosing function's own local. So the proposed edges are the **same dangling-edge
class #983 is refused on, reached from the opposite direction**: #983 asks about reading a
local, #988 asks about passing one, and the answer to both is the same — the target does
not exist.

That is the whole adjudication, and it is worth being explicit about why it is a
**rejection** rather than a **deferral**. The claim was that a `uses` is weaker than a
`contains` and therefore survives where ownership does not. That is true about the
*relationship*, and irrelevant to the *target*: the `contains` half was refused because
ownership is not derivable, and the `uses` half is refused because the target is not
resolvable. Two different reasons, and the second one the claim never addressed — a
`uses` edge whose target names nothing is a dangling edge whatever the semantics of
`uses` are. #962 removed `instantiates -> malloc` and #963 removed `exports ->
KERNEL_EXPORT` for exactly this, and those were relations whose targets were otherwise
meaningful.

The 16.3% that DO resolve are the genuinely defensible subset, and the shape is already
ruled and pinned: `offsetof(struct header, sig)` — a field named inside a macro argument,
where the field is a real member and the use is real. That is `c/field-access-offsetof-955`
(#955), which exists, is correct, and is **not** what this ruling touches. A narrower rule
keyed on "the argument resolves to a field symbol" would be defensible; the general rule
proposed is not, and the difference between the two is the 83.7%.

**The narrow shape #970 identified is still C-D2 and is not revived here.** A macro
invocation that is the heading of a *generated function definition*
(`BIT_OP(bit_band, &=)`) — `lua_bit.c:103` — needs the replacement list to tell from an
ordinary call, and that remains ruled out. #970's measurement stands too: mirroring #908
for every function-like macro took MISSING from 13 to **1,048**, so the analyzer does not
pair generally, and this ruling explains why that is the right answer rather than a gap.

The measurement also settles a question the doc had open in three places, consistently:
"a macro invocation in a BODY emits `calls:f->BIT` but no `uses` for its argument" is not
an oversight and not half an implementation. It is the correct result, for the same reason
`#928`'s silence is correct — not because the answer is C-D2, but because the answer would
not resolve.

### The two `uses`-side limits, stated rather than counted

The `contains` verdict on libgit2 is **18 missed / 0 phantom** after #985. The phantoms
were all one class — a member named after a macro in TYPE position, published beside the
real one — and the 18 misses are the C-D2 macro-replacement-list limit, described above.
Nothing else in that run is a defect, and the probe is explicit that the reach number
(35 of 120 files judged) is a harness property, not a corpus property.

The `uses` side has no equivalent independent oracle, and the two gaps below are stated
rather than counted for that reason. The `field-access-uses.ts` oracle judges every `uses`
edge whose **target is a FIELD symbol** (`field-access-uses.ts:44`), so it is structurally
blind to a read whose target is not a field — in either direction. A class of `uses` rows
could be systematically wrong and this instrument would report nothing.

| construct | status | why |
| --- | --- | --- |
| a macro invocation in a BODY: `BIT(chunked_encoding);` emits `calls:f->BIT` but no `uses` for the argument | **REJECTED on measurement** | see the #988 section below. The claim (e306ab09) is that a use is weaker than containment and so survives where ownership does not; measured, 83.7% of the arguments name nothing the file declares, so the edges would be the same dangling class #983 is refused on. |
| a type-position `uses`: `T *v;` emits `references` for `T` and no `uses` | emitted as `references`, deliberately | CGD12 re-routes a type-position identifier to `references` with one contract for type usage regardless of grammar accident. Verified across five shapes including plain `T *v`. The oracle wants `uses T` for `T *v`; the analyzer's answer is the more precise kind, and the comparison is site-agnostic on label+target, so the two cannot be compared on that row. |
| `uses` against file scope only (#983) | ruled, not taken | see the #983 section above: 99.95% of the edges would be dangling |

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

## D7 K1 — call-target refusals, CORRECTED after arm A (#996, 2026-10-19)

The call-emission gate refuses a target that is a C KEYWORD — and nothing else. A keyword is structurally
impossible to declare (declaration extraction has refused keywords since CGD22; the D7 corpus-wide check found
0 `#define <keyword>`), so this half cannot withdraw a resolution. `isKeywordCallee()` is the whole rule.

**The first K1 also refused NON-IDENTIFIER spellings; arm A proved that half WRONG and it is reverted.** The
arm (5,022 `.c` · 39 repos · self-test PASS) withdrew 43 calls rows where the prediction said 35, and
**`resolved` fell by 3**. The named causes: (a) five `_Static_assert` rows were a class-boundary error —
§15's family table was derived with a keyword copy that omitted `_Static_assert` (and the other
underscore keywords), so they had been counted `name-not-in-run-key-space`; with the analyzer's own
`C_KEYWORDS` the corrected class is keyword 34/1 and name-not-in-run calls 84,922/18,301 (TABLE 1 and the
closure were never affected); (b) the three resolved withdrawals were `$`-spelling calls in generated Cython
templates — `Cython/Utility/ImportExport.c` defines AND calls `__Pyx_ImportType_$cyversion`,
`__Pyx_ImportFromPxd_$cyversion`, … so those calls were name-model RESOLUTIONS to declarations this analyzer
publishes. Removing real resolutions to enforce a spelling rule is the wrong trade: a `$`-spelling is not
disqualified the way a keyword is. The non-identifier class is therefore RULED UNDECIDABLE in the D7
disposition and its 5 rows stay emitted.

Fixture `validation/m14/fixtures/c/call-target-refusals-996` pins BOTH directions of the corrected boundary:
the keyword row is forbidden, the `$`-spelling call is a POSITIVE control that must keep publishing, plus an
ordinary call, a file-local function-like macro call (#908 keeps), and the three inner calls inside the
recovered statement. Probe `script/m14/c-call-target-probe.ts` reproduces either state; forensic probe
`script/m14/c-k1-loss-probe.ts` names the refused-spelling symbols. Fixtures: 48 pass / 3 recorded pre-existing
failures, `no regressions`. Corrected prediction for the re-run, the measured-vs-predicted table and the run
falsifier live in `validation/m14/verification/C-D7-DISPOSITION.md` D-IMPLEMENTABLE-1.

## D7 CLAIMED — ISO-C citation emission (#997, 2026-10-19)

The `iso-c-stdlib-name` class (4,708 ambiguous + 2 unresolved calls rows at arm A) is now CLAIMED through the
Lead-landed citation mechanism: an edge whose target is an ISO-C standard-library name carries
`metadata.languageNamespace: [target]`, verified by the arbiter's namespace claim kind
(`incoming-rule.ts`, root checked against the declared LIST; a non-listed root is `externalRefuted` and counts
`extFAIL`). The roots are a copied SUBSET of the committed vocabulary `ISO_C_STDLIB` (id "iso-c-stdlib",
`script/m14/citations.ts`, source ISO/IEC 9899); a C standard-library name is a bare symbol, so the claim cites
exactly its target — a valid subset, reviewable on the edge. Emission is gated on the analyzer's existing
condition that the target is NOT declared in the file, so a project-declared name can never be excused.

Fixtures pin BOTH directions (`validation/m14/fixtures/c/iso-c-citation-997`): three positives cite exactly
(`strlen`, `malloc`, `memcpy`), and three negatives stay uncited — a LISTED name DECLARED in the file (`free`),
an unlisted BSD name (`strlcpy`), and a third-party name (`PyObject_Call`). Evidence probe:
`bun run script/m14/c-citation-probe.ts` (CITATION CONTRACT PASSED). Fixtures: 49 pass / 3 recorded pre-existing
failures, `no regressions`. The arm-A movement (expected `extOK` +~4,708, `ext?` 0, `resolved` UNCHANGED,
arbitraryTwin not risen) is measured and reported BEFORE it is claimed — the claim counts only after the
reproduced arm.

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

Every row below was run at this commit on 2026-10-05 and the number is what it printed.
Rows that fail are left failing and named; nothing here is re-baselined.

| gate | result | how it was run |
| --- | --- | --- |
| M14.0.F3 fixtures | **41/41 pass** (39 at handover + `c/macro-cdecl-member-990` + `c/fabricated-macro-name-991`) | `bun run script/m14/run-fixtures.ts --lang c` |
| broken-version proof | **39 pass / 1 FAIL** with #990's two call sites reverted — 2 expected symbols missing, 3 expected edges missing, 2 forbidden edges present | reverts applied to the analyzer, fixture gate re-run, analyzer restored |
| M14.0.F1 grammar conformance | **PASS**, 68 refs, unknown 0, unknownFields 0 (was 67 refs) | `bun run script/m14/audit-analyzer-grammar.ts c` |
| M14.0.F1 as a whole | **RED on other lanes** — cpp 2 unknown, rust 2, sql 1; reported, not touched | same |
| C-lane gate, fixtures only | **all properties hold · 48/48 live mutants caught · 5 retired with a stated reason** | `bun run script/m14/tmp/c-audit/verify-c-lane.ts` |
| C-lane gate + sqlite corpus | **RED: 6 property violations**, mutants 48/48 | `… --corpus $HOME/fixtures/repositories/sqlite --max-files 200`. At handover the same command reported **15**: #991 removed all 9 `P7` rows. The 6 remaining are `P6` 1 (a `property` literally named `unknown`, which is a REAL field — an R7 false positive) and `P8` 5 (three `enum ops` in `ext/wasm/libcmpp.c` under one owner — O1 above). Left red |
| ontology coverage gate (the ARBITER) | **emitted 8/10 · ruled-sound 2 · FALSIFIED 0 · ruled-without-justification 0 · exit 0** over 4,421 admitted C/H files | `bun run script/m14/ontology-coverage-gate.ts c **--fresh**`. WITHOUT `--fresh` it reports **0/10, exit 1** — the resumable checkpoint makes the walk skip every file while the tallies live only in memory (defect S4) |
| differential, C lane | **MISSING 1 / 8,304 analyzer edges, 21 unexplained (0.3%), heuristic 0, covered 8,283/8,284 (100%)** · **exit 6** | `BB_CORPUS_ROOT=… bun run script/m14/differential.ts --lang c --repo sqlite`. Exit 6 is the harness's own *"COMPARED A LABEL WITH NO TRUTH"* for `overrides` (19 comparable, 0 truth) — the DERIVATION finding, not a fabrication. The one MISSING is `uses (expr) -> cmpp_tt__last` (`ext/wasm/libcmpp.c:13778`), a read inside a `printf` macro argument, which **#988 already ruled on** (measured: 83.7% of macro arguments name nothing the file declares) and which the shared oracle does not carry. An unscoped run aborts on a corpus repo absent from this box (`grails-core`) |
| `contains` vs clang 14 (independent parser) | **421/421 = 100.00%** members over 33 records; 0 missed, 1 phantom (the declared #957 `#ifdef _WIN32` superset) | `bun run script/m14/tmp/c-audit/contains-vs-clang.ts --dir <sqlite>/src --max-files 120` |
| `exports` / `overrides` oracle | **273/273 and 83/83, MISSING 0, UNEXPLAINED 0**; `overrides` scope is the 228 of 348 files the walk can fully account for (13 files / 19 edges excluded and counted) | `bun run script/m14/tmp/c-audit/c-oracle.ts` |
| payload + latency | **symbols −6, relationships 0, every per-type delta 0 · CPU −3.26% · 0 crashes in all three variants** | `bun run script/m14/tmp/c-audit/c-payload-cost.ts`. The first run of that instrument reported **+40.53%** — a fixed measurement order let host warm-up land on the first variant every round; the order now rotates and the per-round table is in the artifact |
| grammar pin (`c` in `validation/m14/grammar-pins.json`) | **PASS** on the pin, but **which bytes are WIRED is now measured** and the doc's mechanism was wrong | `bun run script/m14/tmp/c-audit/c-grammar-source.ts`: `wasm/tree-sitter-c.wasm` 650,175 B `f9a2d771` **128 named types** (has `macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name`) vs the bun cache `tree-sitter-c@0.24.1` 625,918 B `c852c2a8` **125 named types** (missing all three). The LIVE parser produces `macro_prefixed_type_specifier` on `autosetup/jimsh0.c:727`, which only the 128-type build can, so the committed pin IS what the analyzer receives — but not through the path the log line names: `engine.ts:821` resolves a PATH, `hasWasmInRegistry()` then keys on the **basename** and returns `<repo>/wasm/<basename>`, so `language parser loaded { wasmPath: <bun cache> }` names a file that is never read |
| layout vs clang (independent reference) | **100.0% (39/39)** of redis types and **100.0% (20/20)** of libgit2 types the analyzer claims to model; 89.8% / 58.0% overall; **no actionable misses on either corpus** | `bun run script/m14/tmp/c-audit/layout-vs-clang.ts --dir <corpus dir>` — NOT re-run this wave (its corpora are not on this box); the row is the handover measurement and is labelled as such |
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

## ALL-OUT-OF-ALL wave — 2026-10-18 (charter `ALL-OUT-OF-ALL-PROGRAMME.md` §9.1 D1–D6)

The lane was onboarded to the programme's six-clause bar. Everything below was measured by the commands
named beside it; the lane's claim page is `validation/m14/verification/C-DONE-CHECKLIST.md`.

### D1 — applicable set (grammar-derived, fixtures RED-proven)

`script/m14/c-applicable-set.ts` enumerates the pinned grammar (`wasm/tree-sitter-c.wasm`, sha256
`f9a2d771…`: 366 slots = **128 named types + 202 anonymous tokens**) and decides the vocabulary from
the constructs, not from the matrix. **APPLICABLE 8**: `calls` (:2867-era site), `uses`, `contains`,
`imports`, `references`, `exports`, `overrides`, `instantiates` — each with its construct productions
present, an emission site in this file, and a fixture that went RED when the value's edges were removed
through the real fixture runner (16/17/15/3/6/5/1/2 fixtures respectively). **NOT APPLICABLE 6**, each
with the productions it would need proven ABSENT: `extends`, `implements` (C has no IS-A/conformance
grammar), `decorates` (C's `attribute_specifier`/`attribute_declaration` carry no callable target —
the java-annotation ruling), `renders` (no JSX), `mixes_in` (no mixin), `part_of` (an include is
`imports`; there is no shared-scope part directive). Closure: 8 + 6 = 14 canonical, 0 unclassified.
`overrides` is APPLICABLE WITH ADAPTED SEMANTICS, declared: redefinition, never inheritance
(C 6.9p5 mutually-exclusive preprocessor arms / C 6.10.3p2 `#undef`+redefine), every edge carrying
`metadata.relationshipType = c_redefinition`; the 26 no-shared-conditional pairs stay REFUSED.

### Three FALSE-EDGE classes found by the whole-population instruments, fixed and mutation-pinned

- **#992 `exports` — a marker CALL's exported name must be a bare identifier.** redis defines
  `#define static_assert(expr, lit) extern char __static_assert_failure[(expr) ? 1:-1]`; the
  replacement opens with `extern`, so the #989 agreement rule correctly made it a linkage marker, and
  the call branch then published the first ARGUMENT as the exported name. Seven edges on the whole
  admitted population were `exports <condition-expression> -> static_assert`. Fixture
  `c/exports-assertion-macro-992` (2 positives + 3 forbids + count); measured 45/4 with the guard
  removed, 47/3 restored.
- **#993 `contains` — an ERROR node is not a declarator.** `MAYBE_CONST sqlite3_vfs * pVfs;` parses as
  `[type_identifier MAYBE_CONST, ERROR(sqlite3_vfs), pointer_declarator pVfs]`; the struct field walk
  treated every non-type child as a declarator, descended the ERROR and published the displaced TYPE
  as a member (`sqlite3_kvvfs_methods -> sqlite3_vfs`, `-> sqlite3_io_methods` ×2, beside the real
  pVfs/pIoDb/pIoJrnl at sqlite `src/os_kv.c:341-343`). Fixture
  `c/contains-error-beside-declarator-993`; measured 45/4 mutated, 46/3 restored.
- **#994 `contains`/`uses` — an enumerator inside a preprocessor ARM of an enum body IS a member.** The
  enum loop read only DIRECT children of `enumerator_list`, so jq `src/jv_dtoa.c:1630-1643`
  (`enum { #ifdef IEEE_Arith emax = …; emin = … #else … }` inside a function) published NO member and
  the jq differential read 2 MISSING rows. Fixture `c/contains-guarded-enumerators-994`; measured
  46/4 mutated, 47/3 restored.

Evidence: `validation/m14/fixtures/c/measurements/fix-993-994-mutation.md` (and the #992 fixture's own
forbid rows), `C-APPLICABLE-SET.md` §4.

### D2 — whole-population emission (the census instrument is `script/m14/c-emission-census.ts`)

`BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/c-emission-census.ts --cap=0 --json` →
**5,022/5,022 admitted `.c` files parsed, 39 repos, 0 failures**, per-type rows + files + repos in
`validation/m14/verification/C-WHOLE-POPULATION-EMISSION.md`. Six non-applicable values: **0 edges at
whole population** (the D1 grammar rulings confirmed on the population, not just on fixtures).

### D4 — differential audit (`C-AUDIT-D4.md`)

After the wiring (`e8800ec66`) plus the named oracle fixes (`4ad9c09f2`, `690519c46`, `858db8e1b`),
both canonical draws are clean: `--repo sqlite --lang c --sample 60` → 9,283/9,283 covered (100%),
MISSING 0, 9,159 analyzer edges, **unexplained 0**, exit 0; `--repo jq --lang c --sample 60` →
3,398/3,398 (100%), MISSING 0, **unexplained 0**, exit 0. The lane's own oracle is
`script/m14/oracles/c-truth.ts` (`contains`/`exports`/`overrides`), contract-checked by
`script/m14/c-oracle-verify.ts --selftest` (5 synthetic cases asserting derivation AND refusal).

### Correction to the stale claim in this page's own evidence list

The list above said *"Regex census: … (0 for this analyzer after this wave, from 2)"*. At HEAD
**before** this ALL-OUT-OF-ALL wave the fresh census found **2** regex literals in
`real-c-analyzer.ts` (the Form C guard tests `/^\s*#\s*endif\b/` and `/^\s*#\s*(if|ifdef|ifndef)\b/`),
so that claim was STALE — the wave made it true by replacing both with character scans
(`isPreprocEndifLine` / `isPreprocIfLine`, M49.R2). The replacement's own first version had a
prefix-order bug (`if` matching before `ifdef`), caught by the cap-50 AFTER arm reading `exports 1 -> 0`
and fixed; final state is byte-identical on that population to the pre-change arm (TABLE 1 TOTAL
5,181 / resolved 2,135 / unresolved 2,411 / extOK 495 / extFAIL 0) and the fixtures stay 47/3.
