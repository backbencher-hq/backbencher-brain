# real-fsharp-analyzer.md

## Language

- Analyzer file: `src/ast/real-fsharp-analyzer.ts`
- Parser: `tree-sitter-fsharp` (patched grammar — see Grammar below; WASM in `wasm/tree-sitter-fsharp.wasm`; the `~/.bb/wasm` mirror is STALE — old 5MB build — refresh it or rely on the repo copy, which the engine loads first)
- Language detection: extension `.fs` / `.fsi` / `.fsx` → `language-detection.ts`. `.fsx` matters: an F# script's top level is the program, with no enclosing namespace or module, so it is where the top-level-binding and object-expression rules are load-bearing (see FS-D10, FS-D7).
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
| name | ✅ | **never from a whole left-hand side** — an `identifier_pattern` in this grammar spans the ENTIRE `let` left side, so `let f (a: string) : string = …` used to publish `f (a: string) : string` (60 such symbols per 400 corpus files, none joinable; FS-D6, pinned by `name-surface`). `namespace`/`named_module`/`module_defn` → identifier; `type_definition` → `type_name` (generics stripped: `Repository<'T>` → `Repository`); `function_or_value_defn`/`value_declaration` → identifier / `function_declaration_left`; `member_defn` → `method_or_prop_defn` → `property_or_ident` (second identifier: `_.Log` → `Log`, `this.Greeting` → `Greeting`); `member_signature` → identifier; `additional_constr_defn` → normalized to `constructor`; `active_pattern` → full pattern text `(\|Even\|Odd\|)`; `exception_definition` → identifier under `long_identifier` |
| kind | ✅ | namespace → Namespace, module → Module, record/class/anon-with-members → Class, anon-type-with-only-member-signatures → Interface, DU / union → Enum (cases → EnumMember), abstract+default member → single Method, computed member without arguments → Property, member with argument list → Method, module-level let with arguments → Function, `new()` → Constructor, exception → Class, active pattern → Function, measure/abbrev/delegate → Type |
| qualified/container name | ✅ | `id` = owner chain + name; `parent` = enclosing symbol name (namespace → module → type → member) |
| ownerName / ownerKind | ✅ | enclosing type/module/namespace; top-level types owned by namespace or module |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as C#/Java family) |
| parameters | ✅ | `method_or_prop_defn` argument lists (`paren_pattern` / `argument_patterns`) on Method kinds |
| genericParameters | ✅ | `type_definition` raw name `'T` occurrences |
| documentation/comments | ❌ (not extracted) | non-goal for M12.08 (matching the family fixture contract) |
| complexity metrics | ✅ | `complexity` = symbol count; `linesOfCode` |
| visibility | ✅ | `accessibility` tokens → `public`/`internal`/`private`; applied to the export surface (FS-D8) |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `attribute` nodes; TypeProvider attributes → Class symbols |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `app_expression`/`application_expression` → leaf callee name (`Map.tryFind` → `tryFind`, `store.Add` → `Add`, `first.Log` → `Log`, pipe `a \|> List.map` → `map`); single pass, deduped by identity in the harness. **Source (owner) is the enclosing callable**, and which callables count is the substance of FS-D10/D12/D13: a top-level `let` owns its initialiser's calls *whatever its kind* (a `let` with no arguments is a Variable, and a script top level has no enclosing callable, so keying on kind dropped 2,520 rows per 200 files); a `default` implementation owns its body's calls (it publishes no symbol — the abstract signature is canonical — but the body belongs to it); an explicit `with get, set` property owns its **setter**'s calls. A recursive `calls f -> f` is emitted: a self-CALL is a fact about the program, while a self-`contains` is not, and the refusal is per-label. | 0.8 |
| extends | ✅ | `class_inherits_decl` (`inherit Animal()`) → `Animal`; source = the type. **R10 spelling:** a qualified target is published under the LEAF, with the qualified form kept in `metadata.qualifiedType` — the name this lane would publish for that type as a symbol, which is what a consumer joins on (FS-D9; 13 dotted `implements` + 3 dotted `extends` per 400 files) | 1.0 |
| implements | ✅ | `interface_implementation` (`interface ILogger with`) → `ILogger`; source = the type. R10 leaf spelling as for `extends`. | 1.0 |
| instantiates | ✅ | constructor chaining `new() = Point(0, 0)` → `Point` (enclosing constructor body); source = `constructor` | 0.95 |
| overrides | ✅ | `override` keyword token (first child of `member_defn`) + `inherit` base → qualified `Owner.method -> Parent.method` (`Dog.Speak -> Animal.Speak`); base from the type's `class_inherits_decl` | 1.0 |
| uses | ❌ (not emitted) | F# member-access reads are covered at call level; the C# family emits no `uses` edges — the previous `_.X` / `this.X` phantom uses came from member *definition* headers (`property_or_ident`) and were pure noise | — |
| references | ✅ | Two classes. (a) `open_statement`/`open_decl` → full module path; source = enclosing namespace/module; a module path is legitimately dotted and is **not** subject to the R10 leaf rule. (b) **R9 `declared_type`** — every type WRITTEN in a declaration: `class_field`, `parameter`, `return_type`, `record_field`, `union_case_payload`, `type_abbreviation`, `local_annotation`. Absent from this lane until FS-D4 (the m60 census measured `absent` with the control present). Two positions are **refused**: a type *parameter* and a *predefined* type (`int`, `string`) name no declaration, and a **type query** (`typeof<T>`, `unbox<T>`) is an expression carrying a type argument rather than a written type — `typeof<Foo>.Assembly.Location` depends on a runtime value. The grammar spells a query as a `typed_expression` whose `long_identifier_or_op` child reads `typeof` — a **sibling** of the type, not its parent, which cost two attempts at the discriminator that each measured nothing (FS-D11). A local's written type belongs to the enclosing **callable**, not to the class. | 0.9 (opens) / 1.0 (declared_type) |
| contains | ✅ | owner → owned members via `ownerName` (namespace → module/type, module → type/function, type → member). **`contains X -> X` is refused at composition**, not by suppressing the label: a DU case named after its own type really is contained by its union (`type P = P of string`), so suppressing the label would lose a real fact — 368 such self-edges per 400 corpus files (FS-D3). A `type X with` extension publishes no symbol at all (FS-D2), and a forward declaration in a signature file merges with its definition rather than shadowing it (FS-D2 regression guard). | 1.0 |
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

- **Property getters emit no calls** (C# family contract: `Display => Name.ToUpper()` emits no calls in C# either). Precisely: an **expression-bodied** property emits no calls. F#'s `with get, set` does have a second body for code to live in, and its **setter does emit calls** (FS-D13). The rule is about the shape, not the kind — stated this narrowly because the wider reading is what the fix had to correct.
- **`abstract` + `default` dedup**: only the abstract member signature line is kept as the symbol. The default implementation line is walked for relationships but does not produce a second symbol. Documented.
- **`uses`/`field_access` edges**: not materialized — documented non-goal, consistent with the C# family contract (zero uses in the C# ground truth).
- **Interface implementation members in the walk**: `member _.Log(...)` under `interface ILogger with` is a Method on the implementing class (correct); the abstract signature on the interface is a separate Method symbol (correct — different owners).
- **Object expressions** (`{ new IFoo with ... }`): emitted as `new <iface>` Class + Implements, and their members are owned by it (FS-D7 — they were ownerless, which is only visible in a script, where there is no enclosing scope to fall back on). The published name `new <iface>` is **not a name a consumer can join**; this is pinned as the behaviour it is, not as a success.
- **`member val`**: ~890 corpus sites produce **no symbol at all**. This is a grammar gap, not an analyzer choice — the grammar does not emit a node the analyzer could read. FS-D5 removed the dead `val_property_defn` branch that was written for it, which tested for a node type the grammar never produces; F1 had been reporting that branch as live coverage of 41 literals while 91 of the analyzer's own comparisons went unaudited.
- **`isMeasure` is a text test.** `n.text.includes("Measure")` reads source text rather than the tree. Measured 1 true positive in 400 corpus files and 0 false positives across four corpora, so it is not currently *wrong* — but it is a text sniff in an AST analyzer and is listed as debt. It is not a regex and does not affect the regex census.
- **Alias vs one-case DU is resolution-bound.** A bare alias, a builtin alias and a one-case DU all have the same `union_type_defn` shape, and a leading `|` separates most one-case DUs from aliases but not the inline one-case form. 114 ambiguous shapes per 400 files; 33 RHS types are resolvable in-file, 81 are not separable without name resolution. **No silent heuristic was added** and `union_type_defn → enum` is the M12-pinned mapping: reclassifying it would invalidate the 121 pinned facts in `validation/m12/ground-truth/fsharp.json`.
- **`not null` / `and`-constraints**: a signature using them can collapse to a whole-file root `ERROR` — 6/400 files, costing 1 namespace and 25 ownerless members. Grammar-bound; see `reviews/m60-fsharp-grammar-0312-refused.md`.

## Regex inventory

The analyzer is **fully regex-free**, and it now is because it was measured and corrected —
it was not for most of this lane's life. The doc previously asserted zero here, citing the
census, and the census at the time said six:

| line | literal | what it decided | now |
| --- | --- | --- | --- |
| `publishedName` | `/^['^]/` ×2 | is this a type binder, or a named type? | a leading `'` TOKEN in the tree |
| `publishedName` | `/^[A-Za-z_][A-Za-z0-9_']*$/` | does this string look like a name? | is the node an `identifier`, or a `long_identifier` ending at that leaf? |
| `declaredBindingName` | `/[()<]/`, `/\s:/`, `/^[A-Za-z_][A-Za-z0-9_']*$/` | is a pattern's text nothing but a name? | does the pattern have exactly one name child and no argument list? |

Every one of those is a decision about a STRING that the grammar already makes about a NODE. A
type binder is an apostrophe token plus an identifier; a name is an `identifier` node; a bare
binding pattern has no `argument_patterns` child. Each replacement asks the tree, which is a
stronger question than asking whether the text looks right — and the pattern-name replacement
in particular now reads the name OFF the single child that is the name, instead of validating
a string and then returning it.

**Why the census did not catch it, which is the part worth keeping.** The claim here cited
`validation/m12/results/regex-census.json` as its evidence, and a reader reasonably treats a
cited artifact as checked. The file existed, the claim was in the canonical doc, and neither
was wrong about anything except the number — the doc was asserting a property that the artifact
it cited would have contradicted, and nobody ran the two against each other. Running the
census is not the same as reading its output for THIS analyzer: the per-file section has one
entry among forty-six, and nothing in the doc pointed at it.

The census also has a `justification` field, empty on all six, which is the shape a finding
takes when the scan is right and nobody has adjudicated the row yet.

- **Generic type names**: `type_name → long_identifier → identifier` gives the clean name; declared type parameters come from sibling `type_arguments → type_argument_defn → type_argument` nodes (e.g. `Repository<'T>` → name `Repository`, params `['T']`; `Pair<'a, 'b>` → `['a', 'b']`). No source-text regex needed.
- The remaining string operations are exact-set membership (`Set.has`), `split(".")` to take a leaf, and equality against a node's own `text` where that node IS a name. None of them decides a KIND from arbitrary subtree text; the last such test — `n.text.includes("Measure")` — was removed in FS-D27, and it was a real defect rather than a style one, because `[<MeasureAnnotatedAbbreviation>]` contains the substring "Measure" and is a different attribute. See `validation/m14/fixtures/fsharp/measure-attribute.fs`.

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

## Status 2026-09-28 — M14 lane round

Eleven defect classes fixed (FS-D2 … FS-D13) and eleven mutants, all caught. Full record,
with the measurement that found each one, in `reviews/fsharp/closure.md`.

| Gate | Result |
| --- | --- |
| F1 dead-literal / unknown-symbol | `PASS refs=64 unknown=0 unknownFields=0` |
| F3 fixtures | 7/7 PASS |
| F4 mutants | 15/15 CAUGHT — and the registration itself was a defect |
| oracle vs analyzer, fixtures | 114 truth, 0 MISSING, 0 UNEXPLAINED |
| F5 differential, 3 audited labels | 100% covered, MISSING 0–1, UNEXPLAINED 3–5 (0.1%) — measured at an earlier state, see above |
| all-label probe, 120 files | MISSING 205 / UNEXPLAINED 200 — the honest current number |

**Two differential numbers exist and they measure DIFFERENT THINGS. Quoting either alone
would mislead, so both are here.**

The canonical harness (`bun script/m14/differential.ts --lang fsharp`) filters the ANALYZER
side of a comparison by an allowlist of labels and does **not** filter the TRUTH side, so a
truth row with no allowance is counted MISSING forever. With this lane's oracle deriving six
labels and only `contains` allowed, the lane charged itself for the other five and reported
21–42% covered and 3,270–3,979 MISSING — which reads exactly like a containment defect and
was almost entirely that asymmetry. After making the three labels this lane's truth can
adjudicate symmetric (`contains` + `calls` + `references`), the same corpora measured:

| Corpus | tree-truth | covered | MISSING | analyzer edges | UNEXPLAINED |
|---|---|---|---|---|---|
| `fsharp` (compiler) | 4,106 | 4,105 (**100%**) | 1 | 2,751 | 3 (0.1%) |
| `fsharp-data` | 8,810 | 8,810 (**100%**) | 0 | 3,359 | 5 (0.1%) |

**"100% covered" here means 100% of the rows whose label is allowed — three of six.** It is
not a claim about the other three labels, and it is not a claim about the current state of
the analyzer: it was measured before FS-D14/D15/D16 and before the oracle gained its
`open`-path and file-scope arms. The all-label number is the lane-owned probe
(`script/m14/tmp/fs028-residual-shapes.ts`, 120 files of `dotnet/fsharp`, every label):

| | count | dominant classes |
|---|---|---|
| MISSING (truth derives, analyzer does not) | 8 | 3 `implements`, 2 `calls`/source-other, 2 `declared_type(parameter)`, 1 `overrides` |
| UNEXPLAINED (analyzer emits, truth does not) | 66 | 14 `declared_type(local_annotation)`, 14 `declared_type(parameter)`, 9 `declared_type(record_field)`, 7 `implements`, 7 `calls`/source-other, 7 `declared_type(return)` |

Two rules account for 65 of the 123 unexplained rows, and neither is about F# — they are both
about **who is allowed to own an edge**. A depth-bounded ancestor search (`findAncestor(decl,
isCallable, 8)`) could not distinguish "no callable above this" from "the callable is further
than 8 levels up", treated both as the first, and fell through to publishing a LOCAL's name —
which is not a symbol, so the edge had no other end. And a `fun (sb: StringBuilder) -> …`
lambda parameter was attributed to the `let` that *holds* the lambda, a name that IS
published, so the edge resolved and nothing downstream could tell it was about the wrong
thing. Both are recorded in `reviews/fsharp/closure.md` §7f.

The MISSING side fell 205 → 147 → **62** across this round, and 113 of the last 85 came from
one rule. The property-getter contract — an EXPRESSION-bodied property publishes no calls —
was implemented in the truth oracle by leaving `owner` unset on the property and moving on.
That also left `inBody` false for everything inside, and `inBody` is what tells a walk it is
inside a body. So the contract did not suppress the calls: it made them real *and*
mis-sourced. `let xmlsig = …` inside `member _.XmlDocSig = checkIsResolved()` looked
top-level, was promoted to a call source, and its body attributed to itself. The tell was a
source name — `xmlsig`, `m`, `ty`, `res` — that is a LOCAL in the source and an owner in the
truth. A suppressed body is still a body: `inBody` now travels, and the suppression travels
with it. MISSING `calls` rows went 130 → 19, of which 17 are the undecided
`calls`/`instantiates` boundary and 2 are a single name.

Two of the three biggest numbers in this table were the PROBE's fault, and both were found
by a second probe disagreeing with the first. `fs028` classified an unexplained `references`
row as an "open path" without reading the analyzer's `declaredOn` marker, so 127 declared-type
rows were filed under a class that had already been fixed twice against two files which both
agreed afterwards. And an `and`-clause bug in the truth oracle named a whole `let rec … and …`
group after its *second* function, putting 24 rows in a file that was not where the class was
being fixed. A single-probe residual is a number; it is not yet a finding.

The single largest class on both sides is the **undecided `calls`/`instantiates` boundary** on
a bare application (§6.1 of the closure review): 116 against 14. The second is the
`open`-path `references` class, where the two implementations disagree on the SCOPE an
`import_decl` is attributed to — 123 rows. That one is understood and partly fixed: an `open`
at file scope belongs to the file's declared module, and `FscMain.fs` now agrees 12/12 after
the oracle gained a file-scope fallback; the rest of the class is not yet adjudicated.

Two harness-level facts belong here because both produced numbers that were wrong while
looking right. This lane's allowlist entry was deleted by another lane's edit of the shared
physical line, and the differential did not fail — it reported **1.9% coverage and 4,696
MISSING on an analyzer emitting 2,751 edges**, because with the allowlist emptied the harness
was comparing almost nothing. The entry is now on a line of its own, and the clojure lane's
RESTORED note documents the same mechanism losing 17 lanes' `calls` at once. A green that
measures the harness is worse than a red.

Still open, and not things a differential can settle: the `calls`/`instantiates` boundary,
alias-versus-one-case-DU classification (resolution-bound), the grammar gaps in §5, and the
`isMeasure` text test.

## Issue

Closes M12.08 (GitHub issue #147). The 2026-09-28 M14 round above does not close it.
