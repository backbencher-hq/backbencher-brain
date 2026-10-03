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
| uses | ✅ (**M60, 2026-10-02** — was ❌) | **An attribute application**: `[<Struct>]`, `[<Obsolete("gone")]`, `[<assembly: TypeProviderAssembly(…)>]`. This is the only F# construct a `uses` edge is FOR: it names a type, applies it as a marker, and never invokes it — so it is not a `calls` (no application), not an `implements` (no interface declaration), not an `extends` (no base), not an `instantiates` (no construction), and not a `references` (nothing here is a signature; the declared-type pass reads type WRITERS and an attribute's type is the type of an object construction). Source = the decorated declaration, read from the scope stack the walk already maintains. Measured: **1,666 edges in 157 of a 400-file corpus draw, all at confidence 1.0, all `metadata.relationshipType = "attribute_application"`**; 29,441 `attribute` nodes in 2,492 corpus files. Pinned by `validation/m14/fixtures/fsharp/import-and-use.fs`. **The old ❌ is not still true** — its stated reason (C#-family parity; member *reads* are covered at call level) never addressed attributes, which are not member reads. What is still not emitted: `base.X` member access, measured at **0 occurrences across all 6,619 corpus files** (see §M60 below) | 1.0 |
| references | ✅ | Two classes. (a) `open_statement`/`open_decl` → full module path; source = enclosing namespace/module; a module path is legitimately dotted and is **not** subject to the R10 leaf rule. (b) **R9 `declared_type`** — every type WRITTEN in a declaration: `class_field`, `parameter`, `return_type`, `record_field`, `union_case_payload`, `type_abbreviation`, `local_annotation`. Absent from this lane until FS-D4 (the m60 census measured `absent` with the control present). Two positions are **refused**: a type *parameter* and a *predefined* type (`int`, `string`) name no declaration, and a **type query** (`typeof<T>`, `unbox<T>`) is an expression carrying a type argument rather than a written type — `typeof<Foo>.Assembly.Location` depends on a runtime value. The grammar spells a query as a `typed_expression` whose `long_identifier_or_op` child reads `typeof` — a **sibling** of the type, not its parent, which cost two attempts at the discriminator that each measured nothing (FS-D11). A local's written type belongs to the enclosing **callable**, not to the class. | 0.9 (opens) / 1.0 (declared_type) |
| contains | ✅ | owner → owned members via `ownerName` (namespace → module/type, module → type/function, type → member). **`contains X -> X` is refused at composition**, not by suppressing the label: a DU case named after its own type really is contained by its union (`type P = P of string`), so suppressing the label would lose a real fact — 368 such self-edges per 400 corpus files (FS-D3). A `type X with` extension publishes no symbol at all (FS-D2), and a forward declaration in a signature file merges with its definition rather than shadowing it (FS-D2 regression guard). | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| imports | ✅ (**M60, 2026-10-02** — was ❌) | F#'s THREE import forms, all measured on the wired grammar over the whole corpus: (a) `import_decl` — `open X` and `open type X` are the SAME node (`seq("open", optional("type"), $.long_identifier)`), distinguished by the token and recorded as `metadata.opensTypes`; (b) `module_abbrev` — `module IO = System.IO`, F#'s only alias whose target lies outside the compilation, read as the direct `identifier` (the alias) plus the direct `long_identifier` (the path), so the edge names `System.IO` and not the file's own alias; (c) `fsi_directive_decl` for `#r` / `#load` / `#I` only — the node covers six keywords and `#time` / `#help` / `#quit` import NOTHING, so the keyword is read off the tree and the other three are refused. **BOTH labels stay on an `open`**: `imports` is the dependency `src/intelligence/analysis/dependencies.ts` reads (19 analyzers emit it; ER-D41 is this lane's exact shape), `references` is the mention — the confidences are asymmetric because the derivations are: 1.0 on `imports` because the directive NAMES the path, 0.9 on `references` because that is what it was already measured at. Measured: **705 edges in 158 of a 400-file draw — 689 `open_directive` + 16 `resource_directive`**; whole corpus 11,371 `import_decl` nodes in 2,540 files, 193 `fsi_directive_decl` in 135, 5 `module_abbrev` in 5 | 1.0 |
| exports | ✅ **payload channel only** — the parse result's `ExportInfo[]` is populated (the FS-D8 surface rules); the graph EDGE is **RULED** (M60, 2026-10-02) | F# has no export DECLARATION.

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
- **`uses`/field-access edges: PARTIALLY SUPERSEDED (M60, 2026-10-02).** This row said the
  label is not materialized at all, as a documented non-goal consistent with the C#
  family. It is no longer true as written. `uses` now IS emitted, for attribute
  applications — 1,666 edges on a 400-file draw — and the reasoning above did not
  reach attributes, which are not member reads. What remains true is narrower and is
  the part worth keeping: the `_.X` / `this.X` PHANTOM uses, read off member
  *definition* headers (`property_or_ident`), were pure noise and stay unemitted;
  F# member *reads* are covered at call level; and `base.X` member access is measured
  at **0 occurrences across all 6,619 corpus files**, so there is no `base.X` shape for
  this label to cover here. See §M60.
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
| canonical harness, F# per-language line | 99.9% covered, 10 MISSING / 10 UNEXPLAINED (0.3%) on one rotation; 100% covered, 0 / 1 on the next |
| F1 dead-literal / unknown-symbol | `PASS refs=62 unknown=0 unknownFields=0` |
| F3 fixtures | 6/6 PASS |
| F4 mutants | 14/14 CAUGHT — and the registration itself was a defect |
| oracle vs analyzer, fixtures | 106 truth, 0 MISSING, 0 UNEXPLAINED |
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
| MISSING (truth derives, analyzer does not) | 5 | 2 `calls`/source-other, 2 `declared_type(parameter)`, 1 `overrides`/named-type |
| UNEXPLAINED (analyzer emits, truth does not) | 19 | 7 `calls`/source-other, 5 `declared_type(local_annotation)`, 3 `overrides`/object-expression, 2 `declared_type(return)`, 1 `overrides`/named-type, 1 `instantiates` |

Two rules account for 65 of the 123 unexplained rows, and neither is about F# — they are both
about **who is allowed to own an edge**. A depth-bounded ancestor search (`findAncestor(decl,
isCallable, 8)`) could not distinguish "no callable above this" from "the callable is further
than 8 levels up", treated both as the first, and fell through to publishing a LOCAL's name —
which is not a symbol, so the edge had no other end. And a `fun (sb: StringBuilder) -> …`
lambda parameter was attributed to the `let` that *holds* the lambda, a name that IS
published, so the edge resolved and nothing downstream could tell it was about the wrong
thing. Both are recorded in `reviews/fsharp/closure.md` §7f.
| MISSING (truth derives, analyzer does not) | 62 | 19 `declared_type(parameter)`, 14 `calls`/source-other, 10 `implements`, 10 `declared_type(local_annotation)`, 6 `declared_type(return)` |
| UNEXPLAINED (analyzer emits, truth does not) | 174 | 58 `declared_type(parameter)`, 27 `declared_type(local_annotation)`, 26 `declared_type(return)`, 18 `overrides`, 14 `instantiates` |

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

## M60 ontology workstream — per-type verdicts (2026-10-02)

The M60 workstream asks for one of three verdicts per relationship type — EMITTED,
RULED, GAP — where RULED needs a corpus MEASUREMENT and GAP means the language has the
construct and the analyzer was not reading it. This section is the record. Two
instruments, both in `validation/m14/fixtures/fsharp/`, both driving the wired grammar:

- `ontology-census.ts` — the production entry point `parseFile` from `src/ast/pool-worker.ts`,
  NOT `analyze()`, over a bounded draw.
- `ontology-probe.ts` — instrument A (grammar inventory) and instrument B (parse-tree
  semantic count) over the WHOLE 6,619-file corpus, not the draw.

### The arbiter does not run for this lane, and that is measured, not assumed

`script/m14/ontology-coverage-gate.ts fsharp` walks all 6,619 corpus files through
production `parseFile`, then exits **2** with:

```
ontology coverage gate — no RULING TABLE for fsharp.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

`RULED_BY_LANG` (line 192) carries `bash` and `json` only, so the gate yields **zero
measured counts for fsharp**, which is why this lane carries its own census. Recorded two
ways, because one of them is a crash:

- **Full corpus (`npx tsx script/m14/ontology-coverage-gate.ts fsharp`).** Admits all 6,619
  files and then dies inside the `parseFile` walk with **4 `[BB-PARSE-ERR] … memory access
  out of bounds`** rows and one `[BB-HANG] parser stuck 120s` on
  `tests/FSharp.Compiler.ComponentTests/Conformance/TypeForwarding/NegativeCases/Delegate_NG_TurnToClass.fs`.
  No verdict is printed. The WASM errors are the parser's own allocator on a box running
  four lanes at once; they are a parser-robustness finding, recorded here and not treated
  as this lane's result.
- **Bounded corpus (`BB_CORPUS_ROOT` = a 2-file git repo), which is how the refusal itself
  is recorded.** The refusal is unconditional on the corpus — it is a property of the
  language key — so a bounded run prints it verbatim and **exits 2**:

```
ontology coverage gate — fsharp
corpus: 2 admitted files

ontology coverage gate — no RULING TABLE for fsharp.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

Two further facts about that gate, both read from source and both for the supervisor
rather than edited here:

1. The refusal happens **after** the corpus walk and **before** the EMITTED table is
   printed (line 289 vs line 298), so the run's cost is paid and nothing is reported.
2. `rulingFor()` (line 277) tests `dec.status !== "RULED"` — exact string equality — and
   this lane's spec writes `"RULED (carried over, M12-verified)"`, `"RULED (sharpened)"`
   and 2 more. **4 of 12** fsharp decisions carry the bare `"RULED"`; all four are FSD1,
   FSD4, FSD6 and FSD8, and **none of them mentions `imports`, `uses` or `exports`**. So
   even with a ruling table, `rulingFor` would answer null for all three and the gate
   would report `RULED-UNJUSTIFIED` — correctly, because nothing was written down.

### The draw

| | |
|---|---|
| corpus | `$HOME/fixtures/repositories` → one repo, `fsharp` |
| admitted | 6,619 git-tracked `.fs`/`.fsi`/`.fsx` files ≤ 512 KB (the arbiter's own ceiling) |
| sampled | 400 (6.0%), seeded shuffle, seed `0x5f5a1`, `slice(0, 400)` — a pure function of the corpus contents, no clock, no unseeded RNG |
| parsed | 400/400, 0 failures, 5,750 symbols |
| probe | the whole 6,619, 0 skipped |

### Per-type verdict

Counts are from `parseFile` on the 400-file draw; the "construct on the corpus" column is
the probe over all 6,619.

| type | verdict | edges | files | construct on the corpus |
|---|---|---|---|---|
| `calls` | EMITTED | 12,604 | 176 | — |
| `contains` | EMITTED | 4,258 | 260 | — |
| `references` | EMITTED | 2,358 | 195 | — |
| `uses` | **GAP → implemented** | 1,666 | 157 | `attribute` 29,441 nodes in 2,492 files |
| `imports` | **GAP → implemented** | 705 | 158 | `import_decl` 11,371 in 2,540; `fsi_directive_decl` 193 in 135; `module_abbrev` 5 in 5 |
| `extends` | EMITTED | 62 | 30 | — |
| `implements` | EMITTED | 72 | 20 | — |
| `overrides` | EMITTED | 42 | 19 | — |
| `instantiates` | EMITTED | 47 | 22 | — |
| `exports` | **RULED** | 0 | 0 | **no export node exists — see below** |

`imports` splits 689 `open_directive` + 16 `resource_directive` on the draw, and
`module_abbrev` contributes 0 there while contributing 5 files over the corpus. The
branch is live; the draw simply missed those five.

### `exports` — RULED, with the overturn condition

**Instrument: A (grammar inventory).** The probe enumerated every node type the wired
grammar actually produces across the whole corpus: **353 distinct node types**. The
candidates that would express an export declaration:

```
export_list          ABSENT      export_declaration  ABSENT
module_export        ABSENT      export_stmt         ABSENT
export_spec          ABSENT      exported_item       ABSENT
```

None appears, not once, in 6,619 files. F# has no `module M (a, b)` export list — that is
the Haskell shape — and no `export` keyword. The export surface is IMPLICIT.

**The adjacency number, because "no export declaration" is not "no exports".** The probe
also counted namespaces/modules that declare at least one member: **7,818 occurrences in
3,630 files**.
That is the number an `exports` edge would enumerate, and it is exactly what `contains`
already carries: `contains` emitted 4,258 edges on the draw at **100.0% resolution at both
ends**. An `exports` edge over the same scopes would be a second label for one fact.

**What would overturn this ruling.** A non-zero count of any of those six node types in
the grammar inventory. Second, and independently: if the wired grammar were given a
surface-restriction construct beyond `access_modifier` (`internal`/`private`, 4,850 nodes
in 1,016 files — a modifier ON a declaration, not an export OF one), the ruling would need
re-deriving, because an explicit export list would then be readable.

**Two candidates considered and rejected, with reasons.**
- `.fsi` signature files restrict the public surface to what the signature declares. It is
  still not an export declaration: the signature's members ride `contains`, and the
  surface/definition merge the lane already applies (FS-D8) is the right treatment.
- `[<CompiledName("X")>]` renames a member for other languages and is the closest thing F#
  has to a declared export name. It is an ATTRIBUTE, so it is now a `uses` edge, and reading
  it as an export would make one construct two labels.

### `uses` — GAP, implemented, and what is still not emitted

The construct chosen is the attribute application, and the two candidates that were
measured and dropped are recorded here rather than dropped in silence:

| candidate | instrument B, whole corpus | verdict |
|---|---|---|
| attribute application `[<…>]` | **29,441 occurrences in 2,492 files** | **GAP — implemented** |
| `base.X` member access | **0 occurrences, 6,619 files** | not emitted, and nothing to emit: F#'s corpus never writes one |
| operator definition `let (+) a b` | **249 in 104 files** — after two wrong readings; see below | not a `uses`, and not a symbol gap |
| `member _ : IFoo with …` inline interface | 1,339 raw → 1,105 with property accessors excluded → 7 per 1,200 files on the tightest discriminator, and every printed example is an object expression | an `implements` question, not `uses`, and NOT SETTLED — see §Unresolved |

Two of those numbers were WRONG on the first pass and the probe was corrected, which is
worth stating because the corrections are the measurements:

- **The operator probe was wrong twice, and both numbers were published.** The first
  version looked for a `long_identifier_or_op` under the declaration's left, reasoning
  that the grammar spells an operator name there. It does not — `long_identifier_or_op`
  is the node for a dotted NAME — so the probe caught every ordinary binding and reported
  **84,148 "operator declarations"** whose printed examples were `fsprojPath`, `args`,
  `items`. The second version refused backtick-quoted names by looking for a backtick in
  the text, which caught ``` ``type`` ``` correctly but removed the filter that was doing
  the work and the count rose again. The grammar has a node for exactly this and it was
  the third reading: an operator binding's name is an **`op_identifier`** child of the
  declaration's left, confirmed by reading the tree for all four spellings (`let (+) a b`,
  `let f x`, `let ``type`` x`, `let (|Even|Odd|) n`). A rule keyed on the node type rather
  than on the spelling is the one that would not have produced either number. This is
  recorded because a probe that publishes 84,148 of something is worse than no probe: it
  looks like a measurement.
- **The `member _ : T with …` probe conflated two constructs.** `member _.P : int with
  get, set` (a property with an explicit accessor list) and `member _ : IFoo with member …`
  (an inline interface implementation) have the same shape, and the first pass's own
  examples were `string`, `seq<ArgInfo>`, `LexBuffer<'char>` — plain types, i.e. mostly
  properties. Separated on `property_accessor` nodes.
- **The file-count column counted distinct SPELLINGS, not files.** `import_decl` read
  "in 702 files" where the same node type is in 2,540 files by `nodeFileCounts`. Both
  numbers are real and they answer different questions; the file count is now taken from a
  per-key Set of file labels and the two are printed side by side.

The `member _ : IFoo with …` question is NOT settled here and is stated as such: an inline
interface implementation that the analyzer does not read would be an `implements` gap on an
already-EMITTED type, and separating it from a property accessor list needs a measurement
this round did not finish. It is in §Unresolved below.

### The six questions, per already-emitted type

Measured on the 400-file draw, production `parseFile`.

| type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (both ends) | 6 Confident |
|---|---|---|---|---|---|---|
| `calls` | ✅ derived | ✅ 12,604 / 176 files | ✅ 100% covered, 0 MISSING vs the oracle | ✅ no neighbour-label bleed; 12,604 rows carry no `metadata.relationshipType` | **22.2% in-file / 33.1% project** | ✅ all at 0.8; **0 below 0.7** |
| `contains` | ✅ | ✅ 4,258 / 260 files | ✅ | ✅ | **100.0% / 100.0%** | ✅ all 1.0; 0 below 0.7 |
| `references` | ✅ | ✅ 2,358 / 195 files | ✅ | ✅ two classes kept apart by `metadata`: `declared_type` 1,669, `isImport` 689 | **20.1% / 34.1%** | ✅ mean 0.971; 0 below 0.7 |
| `extends` | ✅ | ✅ 62 / 30 files | ✅ | ✅ | **58.1% / 66.1%** | ✅ all 1.0; 0 below 0.7 |
| `implements` | ✅ | ✅ 72 / 20 files | ✅ | ✅ | **20.8% / 43.1%** | ✅ all 1.0; 0 below 0.7 |
| `overrides` | ✅ | ✅ 42 / 19 files | ✅ | ✅ qualified `Owner.m -> Base.m`, resolving at both ends | **100.0% / 100.0%** | ✅ all 1.0; 0 below 0.7 |
| `instantiates` | ✅ | ✅ 47 / 22 files | ✅ 1 UNEXPLAINED row on the A/B draw | ✅ | **31.9% / 34.0%** | ✅ all 0.95; 0 below 0.7 |
| `uses` (new) | ✅ | ✅ 1,666 / 157 files | ❌ **no oracle** — DERIVATION finding 1 | ✅ every row `attribute_application` | **1.9% / 4.0%** | ✅ all 1.0; 0 below 0.7 |
| `imports` (new) | ✅ | ✅ 705 / 158 files | ❌ **no oracle** — DERIVATION finding 2 | ✅ every row `open_directive` / `resource_directive` / `module_alias` | **2.4% / 22.3%** | ✅ all 1.0; 0 below 0.7 |

**Resolution is the finding, and the two rates answer different questions.** The workstream's
reference point is CSS `references` at 66.8% of its edges resolving at both ends. This
lane's in-file rates are `contains` 100.0%, `overrides` 100.0%, `extends` 58.1%,
`instantiates` 31.9%, `calls` 22.2%, `references` 20.1%, `implements` 20.8%. The workstream's
number is not stated as in-file, so the two are not comparable without saying which; both
are reported here rather than picking the flattering one.

The in-file rate is low for a REASON, and it is a language fact rather than a defect: F#
files declare what they use far more often than they define it. `System`,
`FSharp.Compiler.Diagnostic`, `ChangeEqualsInFieldTypeToColonCodeFixProvider` and every
base type come from a sibling `.fs` file. Project-scope resolution — every name published
ANYWHERE in the draw — is the rate a consumer actually experiences, and it is 2 to 1.5×
higher on every type with a low in-file rate. The two new types are the honest extremes:
**`uses` resolves at 1.9% in-file and 4.0% project-scope, because an attribute dependency is
external by nature** — `Theory`, `Directory`, `Fact`, `InlineData` are xUnit and
`Microsoft.VisualBasic` attribute classes declared in assemblies this corpus does not
contain. That is a true statement about F# code, not a broken edge, and it is why the rate
is reported next to what the targets actually are.

**Q3's limitation, stated rather than implied.** `script/m14/fsharp-truth-oracle.ts` is a
second implementation reading ONE tree, not a re-read of the analyzer's walk. It therefore
sees a grammar bug that both paths share, and it cannot see a construct NEITHER path reads —
which is precisely how `imports`, `uses` and `exports` stayed invisible for this long. The
oracle agrees on what both implementations already agreed to look at. Nothing here should be
read as the oracle clearing the two new labels.

**Q4, the label audit.** `metadata.relationshipType` distribution per type, on the draw:

```
calls:      —                              (12,604)
contains:   —                              (4,258)
references: declared_type=1669, isImport=689   (2,358)
extends:    —                              (62)
implements: —                              (72)
overrides:  —                              (42)
instantiates: —                            (47)
uses:       attribute_application=1666     (1,666)
imports:    open_directive=689, resource_directive=16  (705)
```

Every new row carries the class that produced it, so a consumer can tell an `open` from a
`#r` and an attribute application from anything else. The `uses`/`references` boundary is the
one this lane could most plausibly have got wrong — an attribute names a type, and a
declared type also names a type — and it is separated by the node the name came from: a
type WRAPPER in a declaration (`references`) versus the type of an attribute's object
construction (`uses`).

**Q6.** Every edge this lane emits is at or above 0.8. **0 edges below 0.7** across 21,814
relationships on the draw, so the heuristic class is empty and countable. Nothing was given
a made-up confidence: `1.0` on the three new rules is a parse fact (the directive names the
path; the attribute names the type), `0.8` on `calls` and `0.95` on `instantiates` are the
lane's pre-existing measurements and were NOT touched.

### DERIVATION findings — 2, and they are new

A DERIVATION finding is a type the analyzer emits that the differential never audits:
stored, and compared against nothing.

| # | label | edges on the draw | truth rows | allowlist |
|---|---|---|---|---|
| 1 | `uses` | 1,666 | **0** — no oracle derives it | not admitted for fsharp |
| 2 | `imports` | 705 | **0** — no oracle derives it | not admitted for fsharp |

**Measured, not asserted.** The A/B was run on ONE pinned file draw — the cold-pool
rotation counter and the lane's seen-set were pinned before each run, so both analyzer
versions saw the identical 60 files:

```
AFTER  [fsharp] files=60 tree-truth=4956 covered=4956 (100%) MISSING=0 | analyzer-edges=2710 unexplained=0 heuristic=0 hash=ba9b92ccb4ec47cc
BEFORE [fsharp] files=60 tree-truth=4956 covered=4956 (100%) MISSING=0 | analyzer-edges=2710 unexplained=0 heuristic=0 hash=ba9b92ccb4ec47cc
```

Every number is identical while the analyzer gained 2,371 edges on the 400-file draw
(19,443 → 21,814). That is the mechanism: the harness filters the ANALYZER side by its
label allowlist (`script/m14/differential.ts:23153`), and `imports`/`uses` are not in
fsharp's entry, so the new edges are dropped before the comparison — neither credited nor
accused. Adding them needs three edits, all in shared machinery and none made here:

1. `script/m14/fsharp-truth-oracle.ts` — add an `imports` rule (`import_decl` +
   `fsi_directive_decl` resource keywords + `module_abbrev`) and a `uses` rule
   (`attribute`). Precedent for both: `erlang-truth-oracle.ts:550` emits `imports`.
2. `script/m14/differential.ts:23153` — admit `"imports"` and `"uses"` for `lang === "fsharp"`
   in the analyzer-side allowlist.
3. `validation/m14/differential-baseline.json` — re-pin `fsharp:csharp` (currently
   `missing: 0, unexplained: 0, heuristic: 0, avgMsPerFile: 72.1`).

Until (1) and (2) land together the lane must NOT get (3): the harness filters the analyzer
side and not the truth side, so an oracle that derives a label the allowlist omits turns
every true row into a false MISSING.

### Regression mutants

`script/m14/fsharp-mutants.ts` — 18 mutants, **all 18 CAUGHT** (`BB_MUTANT_ONLY="fsharp/"`).
Three are new and each is caught by `fsharp/import-and-use`:

| mutant | what it injects | caught by |
|---|---|---|
| `open-recorded-only-as-a-mention` | drops every `imports` edge — ER-D41's pre-fix state for F# | 1 failure |
| `repl-control-directive-imports-a-resource` | emits an `imports` edge for `#time "on"`, which imports nothing | 1 failure |
| `attribute-variance-target-read-as-the-dependency` | `[<return: Struct>]`'s variance keyword becomes the dependency | 1 failure |

The third is a REGRESSION guard: that was a real bug in this lane's own first attempt, and
without a mutant a rule that was wrong once is free to be wrong again.

### Payload and latency

More edges means bigger graphs, so the addition was measured rather than assumed. Same
120 files (`.fs`/`.fsi`/`.fsx` ≤ 200 KB), same process, 10-file warm-up, A/B by stashing
only the analyzer:

| | wall | avg ms/file |
|---|---|---|
| BEFORE | 43,225 ms | 360.2 |
| AFTER (2,371 more edges) | 41,677 ms | 347.3 |

The AFTER is marginally FASTER, i.e. the delta is inside the noise of a box running four
lanes at once — and the honest reading is exactly that: **no measurable latency cost**, and
no claim finer than the noise. All three new rules run inside the EXISTING single-pass
walk (`attribute`, `import_decl`, `module_abbrev` and `fsi_directive_decl` are nodes that
walk already visited or already skipped), so no second traversal was added. The pinned
`differential-baseline.json` row for this lane reads `avgMsPerFile: 72.1`; that is a
different sample on a different harness and is **not** comparable to the numbers above, so
it was not re-baselined.

### Three wrong answers this round produced, and what caught them

Recorded because the fixture and the mutant are the only reason these are known.

1. **`return` as a dependency.** `[<return: Struct>]` on a `val` carries an attribute
   `target` field. The rule skipped it by object identity — `c === attrTarget` — which does
   not hold, because web-tree-sitter rebuilds the `Node` wrapper on each accessor call.
   Measured cost: **11 `uses` edges in a 200-file draw targeting the literal string
   `return`**. Fixed by skipping on `fieldNameForChild(i)`, which is the question that is
   actually well defined.
2. **Quotes inside the path.** `(fsi_directive_decl (string))` gives the content NO node —
   the two children of `string` are the two `"` tokens. Reading `node.text` emitted
   `imports -> "nuget: FSharp.Core"`: a target that binds to nothing. The delimiters are now
   read off the tree and the span between them is the value.
3. **The alias as its own dependency.** `module IO = System.IO` produced
   `imports -> IO`, because the rule took the last `identifier`/`long_identifier`
   DESCENDANT, which is the local name. The alias and the path are direct children and the
   path's identifiers are grandchildren. An import of the file's own alias resolves — which
   is exactly why it would have been invisible downstream.

### Declared limitations

For a Turing-complete language this list is not optional, and a blank one would be a claim
rather than an achievement.

- **Two of ten labels have no oracle.** `uses` and `imports` are stored and compared against
  nothing (above, measured). Until the oracle and the allowlist land, a defect in either
  rule is invisible to the differential — and a defect in a rule nobody audits is the class
  this workstream exists to find.
- **`exports` is ruled on the ABSENCE of SYNTAX, not on the absence of exports.** F# exports
  7,818 member-declaring scopes. The claim is that the language has no export DECLARATION,
  and that `contains` already carries the fact.
- **Resolution rates are reported at two scopes and neither is the whole story.** Project
  scope here means "anywhere in a 400-file draw", which is not "anywhere in the F# compiler"
  and is not "in FSharp.Core". A real dependency graph would resolve better and a different
  draw would resolve differently.
- **Resolution is by NAME, not by symbol identity.** A dotted endpoint is tested on its
  whole spelling and on its leaf, because a consumer binds by name. Two same-named symbols
  in different scopes are indistinguishable to this measurement.
- **The `member _ : IFoo with …` question is open** (below).
- **`base.X` is 0 occurrences on this corpus.** That is a fact about ionide/tree-sitter-fsharp
  6,619 files, not about F# — a corpus using `base.X` would find the construct unread.
- **The corpus is ONE repository.** Every number here is FSharp.Compiler plus its tests, a
  self-hosting compiler written in a narrow style. `module_abbrev` occurs 5 times in 6,619
  files; a corpus of F# SCRIPTS would weight `open`, `#r` and `module X = Y` very
  differently, and the relative weight of the three import forms in this section would move.
- **`#time`'s verbatim-string unescaping is not implemented.** `stringLiteralValue` slices
  between the delimiter tokens the tree reports; F# escapes a quote inside `@"…"` by
  doubling it and this does not un-double it. No corpus specifier does (measured over the
  193 `fsi_directive_decl` nodes), and a visibly wrong path beats a silently truncated one.

### Unresolved

- **`member _ : IFoo with …` — an inline interface implementation may be unread, and this
  round did NOT settle it.** Three measurements, and none of them is a clean count, so no
  number is asserted:
  1. **1,339** raw hits for "a `member` with a `with` clause and a type under it" over the
     corpus, dropping to **1,105 in 251 files** once members carrying `property_accessor`
     nodes are excluded — and the probe's printed examples are still `string`,
     `seq<ArgInfo>`, `LexBuffer<'char>`: plain types, i.e. the property spelling.
  2. Separating on `property_accessor` nodes drops it to **7 hits in 1,200 files** — and
     every printed example is an OBJECT EXPRESSION (`{ new IFoo with member _.M … }`),
     which is FS-D7's anonymous class and is already read.
  3. Over the whole corpus with the tight discriminator plus an ancestor walk, **121 hits:
     16 inside an `object_expression` and 105 "on a type"** — and the 105 are again mostly
     object expressions, because the ancestor walk reaches the enclosing `type_definition`
     before it reaches the `object_expression` in these shapes.

  So the honest statement is a bound, not a count: the population is small (7 per 1,200
  files with the tightest discriminator), most of what a loose discriminator catches is
  object expressions the analyzer already handles, and separating F#'s inline interface
  implementation from its property accessor list at the shape level needs something this
  round did not use — most likely name resolution, or a parse that puts the two in
  different nodes. If the inline form turns out to be unread, `implements` is
  UNDER-REPORTED on real F#, and that is a defect on an already-EMITTED label rather than a
  gap. This is the first thing the next round should settle.
- **`#r`-family edge count on a wider draw.** 16 resource directives on a 400-file draw is
  a small number to characterise; **185 occurrences across the whole corpus** is the
  firmer figure, and a script-heavy corpus would move it. The FILE count for that probe is deliberately
  absent: instrument B's file column was counting distinct SPELLINGS rather than files when this was measured,
  and the corrected column now lives in `ontology-probe.ts` rather than being guessed at from the old one.

## Issue

Closes M12.08 (GitHub issue #147). The 2026-09-28 M14 round above does not close it.
