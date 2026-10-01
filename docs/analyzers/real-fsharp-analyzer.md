# real-fsharp-analyzer.md

## Language

- Analyzer file: `src/ast/real-fsharp-analyzer.ts`
- Parser: `tree-sitter-fsharp` (patched grammar — see Grammar below; WASM in `wasm/tree-sitter-fsharp.wasm`; the `~/.bb/wasm` mirror is STALE — old 5MB build — refresh it or rely on the repo copy, which the engine loads first)
- Language detection: extension `.fs` / `.fsi` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealFsharpAnalyzer`

### Grammar (M12.08)

The vendored grammar (`grammars/tree-sitter-fsharp/`) carries two patches
over upstream tree-sitter-fsharp:

1. **`interface` probe discrimination in the external scanner**
   (`common/scanner.h`): upstream mis-dispatches the first `interface T`
   inside an implicit class body into a bogus `union_type_cases` node —
   losing an Implements relationship and inventing phantom enum members.
   The patched scanner classifies `interface` after `type X =` as either a
   same-line declaration (`interface end` / `interface inherit I0 end`) or
   an implementation (`interface I with ...`) using a pure token-type
   lookahead, and reserves the keyword in the grammar only where the
   scanner cannot discriminate. The `interface` keyword is NOT globally
   reserved (that GLR-state change regressed unrelated IL-inline `(# ... #)`
   patterns in prim-types.fs); the scanner probe alone is sufficient.
2. **First-element `interface` fix**: with the probe, every
   `interface_implementation` node in the implicit-body form is emitted
   correctly (corpus check: fsharp@22a8a5dc — 6,627 git-tracked
   `.fs`/`.fsi`/`.fsx` files, 1,156 with error nodes / 8,437 ERROR nodes,
   0 crashes, fresh parser per file; the previous wired build hid ~1,000
   more errors inside a single giant 1,900-line ERROR node — the current
   build surfaces small, recoverable errors instead).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `namespace`/`named_module`/`module_defn` → identifier; `type_definition` → `type_name` (generics stripped: `Repository<'T>` → `Repository`); `function_or_value_defn`/`value_declaration` → identifier / `function_declaration_left`; `member_defn` → `method_or_prop_defn` → `property_or_ident` (second identifier: `_.Log` → `Log`, `this.Greeting` → `Greeting`); `member_signature` → identifier; `additional_constr_defn` → normalized to `constructor`; `active_pattern` → full pattern text `(\|Even\|Odd\|)`; `exception_definition` → identifier under `long_identifier` |
| kind | ✅ | namespace → Namespace, module → Module, record/class/anon-with-members → Class, anon-type-with-only-member-signatures → Interface, DU / union → Enum (cases → EnumMember), abstract+default member → single Method, computed member without arguments → Property, member with argument list → Method, module-level let with arguments → Function, `new()` → Constructor, exception → Class, active pattern → Function, measure/abbrev/delegate → Type |
| qualified/container name | ✅ | `id` = owner chain + name; `parent` = enclosing symbol name (namespace → module → type → member) |
| ownerName / ownerKind | ✅ | enclosing type/module/namespace; top-level types owned by namespace or module |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as C#/Java family) |
| parameters | ✅ | `method_or_prop_defn` argument lists (`paren_pattern` / `argument_patterns`) on Method kinds |
| genericParameters | ✅ | `type_definition` raw name `'T` occurrences |
| documentation/comments | ❌ (not extracted) | non-goal for M12.08 (matching the family fixture contract) |
| complexity metrics | ✅ | `complexity` = symbol count; `linesOfCode` |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `attribute` nodes; TypeProvider attributes → Class symbols |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `app_expression`/`application_expression` → leaf callee name (`Map.tryFind` → `tryFind`, `store.Add` → `Add`, `first.Log` → `Log`, pipe `a \|> List.map` → `map`); source = **enclosing function/method/constructor** (never the module); single pass, deduped by identity in the harness | 0.8 |
| extends | ✅ | `class_inherits_decl` (`inherit Animal()`) → `Animal`; source = the type | 1.0 |
| implements | ✅ | `interface_implementation` (`interface ILogger with`) → `ILogger`; source = the type | 1.0 |
| instantiates | ✅ | constructor chaining `new() = Point(0, 0)` → `Point` (enclosing constructor body); source = `constructor` | 0.95 |
| overrides | ✅ | `override` keyword token (first child of `member_defn`) + `inherit` base → qualified `Owner.method -> Parent.method` (`Dog.Speak -> Animal.Speak`); base from the type's `class_inherits_decl` | 1.0 |
| uses | ❌ (not emitted) | F# member-access reads are covered at call level; the C# family emits no `uses` edges — the previous `_.X` / `this.X` phantom uses came from member *definition* headers (`property_or_ident`) and were pure noise | — |
| references | ✅ | `open_statement`/`open_decl` → full module path; source = enclosing namespace/module | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` (namespace → module/type, module → type/function, type → member) | 1.0 |
| depends | ✅ | imports → References | 0.9 |

## Supported constructs

- Interface declarations with abstract member signatures (`type ILogger = abstract member Log: string -> unit`) → Interface + Method — `Services.fs`
- Interface **implementations** in implicit class bodies (`interface ILogger with member _.Log(...)`) → Implements relationship + Method on the class — the core grammar fix — `Services.fs`
- Records (`type Customer = { Id: int; Name: string }`) → Class + Properties; computed members without arguments (`member this.Greeting = ...`, `member _.X = x`) → Property, NOT Method — `Domain.fs`, `Features.fs`
- Discriminated unions (`type Shape = Circle \| Rectangle`) → Enum + EnumMember; members on a DU (`member this.Area = ...`) → Property — `Features.fs`
- Generic interface (`type Repository<'T>`) with abstract members — `Domain.fs`
- Abstract member + `default` implementation (`abstract member Speak: unit -> string` + `default _.Speak() = "..."`) → ONE Method (dedup: the abstract signature is the canonical symbol; the default impl is skipped) — `Features.fs`
- Inheritance + override (`inherit Animal()` + `override _.Speak() = "Woof"`) → extends + qualified overrides `Dog.Speak -> Animal.Speak` — `Features.fs`
- Additional constructor (`new() = Point(0, 0)`) → Constructor named `constructor` + instantiates — `Features.fs`
- `exception NotFound of string` → Class symbol (name extracted from the `long_identifier`) — `Features.fs`
- Active patterns (`let (|Even|Odd|) n = ...`) → ONE Function named `(\|Even\|Odd\|)` — `Features.fs`
- Module-level functions with curried arguments; calls attribute to the enclosing function — `Domain.fs`
- Computation expressions (`async { return format customer }`) → the inner call attributes to the enclosing function — `Domain.fs`
- Negative fixture (`Negative.fs`): locals (`let localA = 1` inside a body) are NOT symbols; lambda params are NOT symbols; function params are NOT symbols; `Console.WriteLine` and `s.ToString`/`t.Equals`/`t.GetHashCode`/`t.GetType` are filtered builtins; pipeline `items |> List.map (fun x -> x * 2)` DOES emit a call (`map`) — positive control.

## Unsupported / explicit-unknown constructs

- **Property getters emit no calls** (C# family contract: `Display => Name.ToUpper()` emits no calls in C# either). F# computed properties are extracted as symbols; their bodies are not call sources.
- **`abstract` + `default` dedup**: only the abstract member signature line is kept as the symbol. The default implementation line is walked for relationships but does not produce a second symbol. Documented.
- **`uses`/`field_access` edges**: not materialized — documented non-goal, consistent with the C# family contract (zero uses in the C# ground truth).
- **Interface implementation members in the walk**: `member _.Log(...)` under `interface ILogger with` is a Method on the implementing class (correct); the abstract signature on the interface is a separate Method symbol (correct — different owners).
- **Object expressions** (`{ new IFoo with ... }`): emitted as `new <iface>` Class + Implements; not covered by fixtures (documented).

## Regex inventory

The analyzer is **fully regex-free** — the regex census (`validation/m12/results/regex-census.json`) reports **0 usages** for `real-fsharp-analyzer.ts`. Kind classification (record → class, DU → enum, anon member-signatures → interface), override detection (`firstTokenIs(node, "override")` reads the tree-sitter token), property-vs-method (argument-list presence in `method_or_prop_defn`), and generic-parameter extraction are all pure AST decisions:
- **Generic type names**: `type_name → long_identifier → identifier` gives the clean name; declared type parameters come from sibling `type_arguments → type_argument_defn → type_argument` nodes (e.g. `Repository<'T>` → name `Repository`, params `['T']`; `Pair<'a, 'b>` → `['a', 'b']`). No source-text regex needed.
- The only string operations are exact-set membership (`Set.has`) and `split(".")` for leaf names.

## Complexity envelope

From `validation/m12/results/fsharp-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 52 | 64 | 764.9 | 68 | 84 | 266.3 MB |
| corpus_subset | 376 | 36,901 | 128,401 | 219,074.0 | 168 | 586 | 1,305.6 MB |

Declared budgets: fixtures < 2 s (met: 0.76 s); 376-file corpus dominated by
giant self-hosting compiler files (top sample files are 290–755 KB —
`CheckExpressions.fs` 696 KB parses in ~8 s, `IlxGen.fs` 546 KB, etc.),
so the wall budget for the F# compiler corpus is declared as "large-file
bound" rather than a fixed seconds target. The analyzer's own `analyze()`
pass is faster than the previous implementation (854 ms vs 1,247 ms on
`CheckExpressions.fs` with identical tree) — the corpus wall time is
dominated by tree-sitter parse + the shared engine pipeline on 700 KB files.

Hot-path audit: single-pass iterative traversal (explicit stack, no
recursion depth risk); per-type member dedup via `Set` lookups
(`abstractMemberNames`, `baseTypes` Map); call leaf extraction is O(1)
string split. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/fsharp.json`
  (authority: `manual_audit`)
- Result: `validation/m12/results/fsharp-differential.json`
- Precision / recall / FP / FN / unknown rates:
  **1.000 / 1.000 / 0 / 0 / 0** — 121/121 facts across 4 fixtures (3
  positive + 1 negative), zero parse errors. (115 at close; the post-close
  extreme review added measure-type coverage — `[<Measure>] type kg`/`s` and
  the `speed` binding, 6 facts — closing a required-scope gap that had zero
  fixture coverage. The analyzer already handled `[<Measure>]` → Type.)

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `fsharp@22a8a5dc`
  (clean repo, 6,627 git-tracked `.fs`/`.fsi`/`.fsx` files)
- 400 tracked `*.fs` files (deterministic first-400 sorted; 376 unique
  basenames in the flat sample dir)
- Parse quality (fresh parser per file, 0 crashes): sample 108/400 files
  with error nodes (27.0%, 1,222 ERROR nodes); full corpus 1,156/6,627
  files (17.4%, 8,437 ERROR nodes). Errors are small and recoverable (the
  previous grammar build swallowed ~1,000 more errors inside one giant
  ERROR node).

### Corpus census, 2026-09-25 (full extent, sharded and merged)

`script/m14/tmp/fsharp-corpus-census.ts` (chunker: `fsharp-census-chunks.ts`),
rows in `validation/m14/results/fsharp-corpus-census.json` with the five shard
artifacts kept beside it in `fsharp-corpus-census.shards/`. Full extent, no
sample: **6,627 files**, 0 analyzer throws, 5,192 dangling sources / 189,824
dangling targets (the dangling targets are the **leaf-target contract** doing its
job — `sprintf` 9,314, `Line`/`Col` 6,481, `Next`, `AreEqual`, `Some`, `not`,
`map`; haskell refuses exactly these by contract, which is an identity policy
difference, not a defect), 135,990 symbols, 378,873 relationships
(calls 246,327 · contains 113,906 · references 11,611 · overrides 3,941 ·
implements 1,656 · extends 1,275 · instantiates 157).

**Parse health re-measured, now by bucket.** The M12.08 row above stands as the
baseline (1,156/6,627 = 17.4 %); this census re-reads 1,196/6,627 = 18.0 %, a
+40-file drift, and adds the split that was never broken out — `src` (the
compiler itself) **133/497 = 26.8 %**, `buildtools` 9/23, `vsintegration`
19/277 = 6.9 %, `docs` 1/25, `tests` 1,034/5,793 = 17.8 % (the
`resources/tests/Diagnostics` and Conformance negative cases are *intentionally*
invalid F#, so that bucket cannot be read as analyzer feed quality). The
compiler-tree rate is the honest headline: a quarter of the compiler's own files
arrive through error recovery, and no gate had reported it per-tree.

**The F10 gate's own row is not this lane.** `M14.0.F10.json`'s parse-success row
for fsharp reads `lane: "fsharp:csharp"`, `exts: { cs: 243 }` — it measured 243
`.cs` files in the fsharp repo through the C# lane, so the F# grammar's surface
has never been in that gate. The census above is the F#-grammar measurement.

**Override identity.** 3,923 edges carry a source that names no symbol of the
file, and that population is the `overrides` population to within 18 edges
(3,941 across the same shards). Cause is in the emission: a qualified override
emits `source: \`${owner}.${name}\``, `target: \`${base}.${name}\`` while the
member's symbol is emitted bare (`Interface 01.fs`: `overrides T.P1 -> P1`,
symbol `P1`). The truth pins "qualified overrides", so this is a deliberate
spelling — but a consumer joining by symbol name loses or mis-joins every
override in the corpus. Moving it needs truth + fixture + mutants in lockstep.

**Path-valued endpoints: 0.** The first cut of the probe reported 331 and all of
them were the instrument: F# quoted identifiers (`` ``text with / and (https://…)`` ``)
are legal names containing slashes, and `CompilerOptions.Fsi` ends in `.fsi` as a
string. Two probe bugs were found while producing the row (a plain-object
histogram whose `constructor` key inherited `Object.prototype.constructor` and
printed a function's source instead of a count — in the per-file path and again
in the merge; and an "ambiguous leaf" counter that was dead code) and are
recorded in the artifact's note.

### Parse-health triage, 2026-09-25 — the constructs the pinned grammar rejects

Instruments: `script/m14/tmp/fsharp-error-triage.ts` (rows in
`validation/m14/results/fsharp-error-triage.json`) and
`script/m14/tmp/fsharp-error-repro.ts` (rows in
`validation/m14/results/fsharp-error-repro.json` — 24 cases, 8 breaking, 16
controls). The triage walks every ERROR node in the compiler's `src` and clusters
it by parent node + first token; the minimizer reduces each suspect shape to a
minimal snippet, so **a cluster is never called a diagnosis on its own** — the
controls are what killed four plausible hypotheses (a UTF-8 BOM before the module
header, nested `(* … (* … *) … *)` comments, `#if` around match arms, and
`and`-joined constraint lists all parse).

**src, full extent:** 497 files, 133 (26.8 %) with `hasError`, 130 with ERROR
nodes, 1,387 ERROR nodes + 62 missing nodes, 24,867 error lines of 183,711
(13.5 %); per-file span median 4 lines, p90 115, max 14,035
(`prim-types-prelude.fs`, the array-type IL block). 66 distinct *root* shapes
(first ERROR per file).

| # | construct the grammar rejects | repro ids | root files | nodes |
|---|---|---|---|---|
| 1 | inline IL literal `(# "opcode …" args #)`, body and type-body position | `inline-il-let`, `inline-il-type-body` | 3 | 179 with its cascades (`namespace :: #)` 62, `application_expression :: ^` 32, `function_or_value_defn :: (#` 29, `:: #` 23, `namespace :: type` 33) |
| 2 | `not null` constraint: `type M<'T when 'T:not null> = …` | `not-null-constraint` | 18 (9 `type_arguments :: when` + 9 `:: and` — ONE gap: the control `and-joined-constraints-no-nullness` parses) | 18+ |
| 3 | `#if`/`#endif` inside a record field list | `preproc-in-record-fields` | 6 (+2 `field_initializers :: #`) | 8 |
| 4 | multi-line named-field pattern `SynBinding(kind = …\n Pat = …)` nested in a list/record pattern | `named-field-pattern-multiline` (single-line control parses) | 3 | 79 — the largest single cluster |
| 5 | `T \| null` in a value-declaration annotation (`let mutable x: string \| null`) | `nullable-annotation` (the parameter form parses) | 3 | 44 |
| 6 | bare `interface IY` type body (the `.fsi` shorthand) | `interface-in-signature-type` (`interface … end` parses) | 8 | 8 |

Named but **unreduced**, with starting points, rather than quietly dropped:
`(root) :: //` 6 files (CheckIncrementalClasses.fs:1; the BOM hypothesis was
tested and killed), `preproc_if :: |` 8 + `:: else` 2 (isolated directives parse,
so the failing shape needs one spanning constructs — NicePrint.fs:2276),
`namespace :: )` 4, `module_defn :: let` 3, `sequential_expression :: |` 2,
`curried_spec :: |` 2, plus a long tail of 66 distinct root shapes.

**Symbol loss: not observed. The loss is structural and lies in body content.**
Every declaration the triage found inside an error region carries a symbol at a
rate equal to or *higher* than outside: `union_type_defn` 36/38 = 94.7 % in vs
1,164/1,324 = 87.9 % out, `record_type_defn` 10/10 vs 566/640, `module_defn`
10/10 vs 665/665, `exception_definition` 47/48 vs 234/237, `member_defn` 60/232 =
25.9 % in vs 768/12,923 = 5.9 % out. `type_definition` and `value_declaration`
are wrappers carrying 0 % in both regions — consistent, therefore not a loss
signal. What IS lost is inside the malformed region: an inline-IL body is a single
ERROR node, so no expression node exists within it and that body emits no
`calls`/`instantiates`/`overrides` at all — the FSharp.Core primitives implemented
in IL (`array2.fs`, `nativeptr.fs`, the ``[,...]`` types) contribute declarations
whose bodies are invisible. Quantifying relationship loss per gap is owed.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/fsharp/`
- Ground truth: `validation/m12/ground-truth/fsharp.json`
- Differential: `validation/m12/results/fsharp-differential.json`
- Complexity: `validation/m12/results/fsharp-complexity.json`
- Corpus census (2026-09-25, full extent): `validation/m14/results/fsharp-corpus-census.json` (+ `fsharp-corpus-census.shards/`)
- Parse-health triage: `validation/m14/results/fsharp-error-triage.json`; grammar-gap reproducers: `validation/m14/results/fsharp-error-repro.json`
- Corpus sample: `validation/m12/results/fsharp-corpus-sample.txt`
- Grammar source: `grammars/tree-sitter-fsharp/` (patched scanner + grammar)
- Docs: this file

## Issue

Closes M12.08 (GitHub issue #147).
