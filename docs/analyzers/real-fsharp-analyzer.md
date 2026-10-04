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
| calls | ✅ | `app_expression`/`application_expression` → leaf callee name (`Map.tryFind` → `tryFind`, `store.Add` → `Add`, `first.Log` → `Log`), **plus a BARE pipeline** (`infix_expression` whose `infix_op` token is a pipe) since FS-A6 (M60 pass 2) — single pass, deduped by identity in the harness. **FS-A6, and the doc's own pipe claim was half true until it was measured:** the pipe `a \|> List.map` → `map` was read only when the pipeline sat in CALLEE position (`f (x \|> g)`), because only the `application_expression` branch had an `infix_expression` arm. The shape F# is actually written in — a `let` whose BODY is the pipeline — produced nothing: **1,043 bare `\|>` nodes with a NAME on the right, against 580 read in callee position, on a 300-file corpus draw**, i.e. ~11% of the corpus's calls were absent from the label. The operator's TOKEN decides which side carries the callee (`\|>` `\|>>` `>>=` apply the right operand, `<\|` `<<` the left) and `>>` `>>>` `>=>` `<<<` are deliberately absent because they COMPOSE two functions and call neither. **FS-A4, in the same round:** the label was also gated on `fnName.length > 1`, which no property of the program justifies and which dropped every call to a one-letter function — **5,313 occurrences over 6,619 files in 735 files** (2.2% of the label's 246,327 full-extent edges), and the dropped population resolves BETTER than the emitted one (32.4% in-file on a 120-file draw against 22.2%). **Source (owner) is the enclosing callable**, and which callables count is the substance of FS-D10/D12/D13: a top-level `let` owns its initialiser's calls *whatever its kind* (a `let` with no arguments is a Variable, and a script top level has no enclosing callable, so keying on kind dropped 2,520 rows per 200 files); a `default` implementation owns its body's calls (it publishes no symbol — the abstract signature is canonical — but the body belongs to it); an explicit `with get, set` property owns its **setter**'s calls. A recursive `calls f -> f` is emitted: a self-CALL is a fact about the program, while a self-`contains` is not, and the refusal is per-label. | 0.8 |
| extends | ✅ | `class_inherits_decl` (`inherit Animal()`) → `Animal`; source = the type. **R10 spelling:** a qualified target is published under the LEAF, with the qualified form kept in `metadata.qualifiedType` — the name this lane would publish for that type as a symbol, which is what a consumer joins on (FS-D9; 13 dotted `implements` + 3 dotted `extends` per 400 files) | 1.0 |
| implements | ✅ | `interface_implementation` (`interface ILogger with`) → `ILogger`; source = the type. R10 leaf spelling as for `extends`. | 1.0 |
| instantiates | ✅ | constructor chaining `new() = Point(0, 0)` → `Point` (enclosing constructor body); source = `constructor` | 0.95 |
| overrides | ✅ | `override` keyword token (first child of `member_defn`), and **FS-A2 (M60 pass 2) the target is resolved from the INTERFACE the member implements when there is one**, because `override` is not a statement about a base class: F# has no separate keyword for an interface member, so `interface I with override this.M() = …` implements `I.M`. Base-class form: `inherit Animal()` → `Dog.Speak -> Animal.Speak`. Interface form: `interface System.IDisposable with` → `Resource.Dispose -> IDisposable.Dispose`, carrying `metadata.relationshipType = "interface_member_implementation"` (the csharp lane's C923 shape, measured the same in java, kotlin, typescript, dart and python). The interface wins over the base list, and an OBJECT EXPRESSION is the same rule through a different node — `{ new IFoo with override x.M() }` has no `interface_implementation` node at all, the interface sits directly on the `object_expression`. **With neither an interface nor a base there is NO target and NOTHING is emitted**: pre-fix that case published `overrides Owner.M -> M`, a member overriding itself. Measured: 126 interface-implementation `override` members in 37 corpus files, 700 `override` members in types with no base at all across 179 files | 1.0 |
| uses | ✅ (**M60, 2026-10-02** — was ❌) | **An attribute application**: `[<Struct>]`, `[<Obsolete("gone")]`, `[<assembly: TypeProviderAssembly(…)>]`. This is the only F# construct a `uses` edge is FOR: it names a type, applies it as a marker, and never invokes it — so it is not a `calls` (no application), not an `implements` (no interface declaration), not an `extends` (no base), not an `instantiates` (no construction), and not a `references` (nothing here is a signature; the declared-type pass reads type WRITERS and an attribute's type is the type of an object construction). Source = the decorated declaration, read from the scope stack the walk already maintains. Measured: **1,666 edges in 157 of a 400-file corpus draw, all at confidence 1.0, all `metadata.relationshipType = "attribute_application"`**; 29,441 `attribute` nodes in 2,492 corpus files. Pinned by `validation/m14/fixtures/fsharp/import-and-use.fs`. **The old ❌ is not still true** — its stated reason (C#-family parity; member *reads* are covered at call level) never addressed attributes, which are not member reads. What is still not emitted: `base.X` member access, measured at **0 occurrences across all 6,619 corpus files** (see §M60 below) | 1.0 |
| references | ✅ | Two classes. (a) `open_statement`/`open_decl` → full module path; source = enclosing namespace/module; a module path is legitimately dotted and is **not** subject to the R10 leaf rule. (b) **R9 `declared_type`** — every type WRITTEN in a declaration: `class_field`, `parameter`, `return_type`, `record_field`, `union_case_payload`, `type_abbreviation`, `local_annotation`. Absent from this lane until FS-D4 (the m60 census measured `absent` with the control present). Two positions are **refused**: a type *parameter* and a *predefined* type (`int`, `string`) name no declaration, and a **type query** (`typeof<T>`, `unbox<T>`) is an expression carrying a type argument rather than a written type — `typeof<Foo>.Assembly.Location` depends on a runtime value. The grammar spells a query as a `typed_expression` whose `long_identifier_or_op` child reads `typeof` — a **sibling** of the type, not its parent, which cost two attempts at the discriminator that each measured nothing (FS-D11). A local's written type belongs to the enclosing **callable**, not to the class. | 0.9 (opens) / 1.0 (declared_type) |
| contains | ✅ | owner → owned members via `ownerName` (namespace → module/type, module → type/function, type → member). **`contains X -> X` is refused at composition**, not by suppressing the label: a DU case named after its own type really is contained by its union (`type P = P of string`), so suppressing the label would lose a real fact — 368 such self-edges per 400 corpus files (FS-D3). A `type X with` extension publishes no symbol at all (FS-D2), and a forward declaration in a signature file merges with its definition rather than shadowing it (FS-D2 regression guard). | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| imports | ✅ (**M60, 2026-10-02** — was ❌) | F#'s THREE import forms, all measured on the wired grammar over the whole corpus: (a) `import_decl` — `open X` and `open type X` are the SAME node (`seq("open", optional("type"), $.long_identifier)`), distinguished by the token and recorded as `metadata.opensTypes`; (b) `module_abbrev` — `module IO = System.IO`, F#'s only alias whose target lies outside the compilation, read as the direct `identifier` (the alias) plus the direct `long_identifier` (the path), so the edge names `System.IO` and not the file's own alias; (c) `fsi_directive_decl` for `#r` / `#load` / `#I` only — the node covers six keywords and `#time` / `#help` / `#quit` import NOTHING, so the keyword is read off the tree and the other three are refused. **BOTH labels stay on an `open`**: `imports` is the dependency `src/intelligence/analysis/dependencies.ts` reads (19 analyzers emit it; ER-D41 is this lane's exact shape), `references` is the mention — the confidences are asymmetric because the derivations are: 1.0 on `imports` because the directive NAMES the path, 0.9 on `references` because that is what it was already measured at. Measured: **705 edges in 158 of a 400-file draw — 689 `open_directive` + 16 `resource_directive`**; whole corpus 11,371 `import_decl` nodes in 2,540 files, 193 `fsi_directive_decl` in 135, 5 `module_abbrev` in 5 | 1.0 |
| exports | ✅ **payload channel only** — the parse result's `ExportInfo[]` is populated (the FS-D8 surface rules); the graph EDGE is **RULED** (M60, 2026-10-02, re-derived 2026-10-03) | F# has no export DECLARATION: the grammar produces no node type containing `export` in 353, and the adjacency count (7,818 member-declaring scopes in 3,630 files) is what `contains` already carries | — (no edge is emitted, so there is no confidence) |

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

## M60 ontology lane, PASS 2 — the six questions, adversarially (2026-10-03)

Pass 1 shipped `imports` and `uses`, ruled `exports`, and left one question open. This pass
asks the six questions the other way round: for every type the lane emits, find a case where
the label is WRONG. Three were found, all on labels pass 1 called done, and all three are
fixed here. Every number is from production `parseFile` (src/ast/pool-worker.ts) or from the
wired grammar, and the two instruments that produce them are committed:
`validation/m14/fixtures/fsharp/ontology-probe.ts` (whole corpus, 6,619 files),
`validation/m14/fixtures/fsharp/ontology-census.ts` (400-file draw, seed 0x5f5a1) and
`validation/m14/fixtures/fsharp/one-char-calls.ts` (120-file draw, 120 of the census's own).

### What pass 1's numbers do now

The pass-1 census was re-run before anything was changed and it reproduced **byte for
byte**: 400/400 files, 0 failures, 5,750 symbols, 21,814 relationships, `calls` 12,604 /
`contains` 4,258 / `references` 2,358 / `uses` 1,666 / `imports` 705 / `implements` 72 /
`extends` 62 / `overrides` 42 / `instantiates` 47. So pass 1's evidence is sound and its
verdicts stand; what changed is the analyzer underneath three of them.

| type | pass 1 | pass 2 | why |
|---|---|---|---|
| `calls` | 12,604 / 176 files | **15,238 / 183** | FS-A4 (one-character callees) + FS-A6 (bare pipelines) |
| `overrides` | 42 / 19 files | **33 / 14** | FS-A2 (interface targets; 9 self-targeted edges removed) |
| `instantiates` | 47 / 22 files | **48 / 23** | FS-A4 — the length gate also stood in front of constructor chaining |
| `contains`, `uses`, `imports`, `references`, `extends`, `implements` | 4,258 / 1,666 / 705 / 2,358 / 62 / 72 | identical | untouched |
| symbols | 5,750 | 5,750 | no symbol rule was touched |
| relationships (all ten types) | 21,814 | 24,440 | +2,626 |

`exports` is re-derived below and still reads 0.

### FS-A2 — `overrides`: the label was right and the TARGET was a fabrication

**The strongest argument that the label is wrong, and the corpus supports it.** `override` is
F#'s keyword for implementing an ABSTRACT MEMBER, of a base class or of an interface — F# has
no second keyword, exactly as in C#. The lane read the `override` **token** and nothing else,
so it published:

```
overrides  Disposable.Dispose  ->  Dispose              // no `inherit` anywhere: overrides ITSELF
overrides  Disposable.Dispose  ->  Base.Dispose         // `inherit Base()` also present
```

Both are wrong, and the first is the shape of a fabricated edge — a target that names no other
declaration. Populations, whole corpus, instrument B:

| probe | population | what it is |
|---|---|---|
| A1 `override` under an `interface_implementation` | **126 in 37 files** | implements an interface member |
| A1-control `override` with no interface ancestor | **1,861 in 331 files** | a real base-class override, untouched |
| A2 `override` in a type with NO `class_inherits_decl` | **700 in 179 files** | the population that could resolve to nothing |
| A3-control `interface_implementation` in a class body | 905 in 363 files | already read as `implements` |
| A3-control-2 bare `type I = interface … end` | 230 in 110 files | already read |

**The case that makes it a defect rather than a style question** is corpus file
`vsintegration/tests/Salsa/VsMocks.fs`, where `Animal`-shaped accidents do not exist but
mock objects do: `{ new IVsThreadedWaitDialog2 with override x.StartWaitDialog(…) = 0 }` —
six members across two object expressions, all published pre-fix as
`overrides new IVsThreadedWaitDialog2.StartWaitDialog -> StartWaitDialog`.

**The fix follows the family rather than inventing a rule.** csharp's
`resolveInterfaceImplementations` (C923) emits `overrides M -> I.m` with
`metadata.relationshipType = "interface_member_implementation"`, measured the same in java,
kotlin, typescript, dart and python. So the label stays `overrides`, the target is read from
the interface clause the tree writes, that clause wins over the base list, and an object
expression is the same rule read through its own node (it has no `interface_implementation`
node at all — the interface sits directly on the `object_expression`). **With neither an
interface nor a base there is no target and nothing is emitted.**

Effect on the 400-file draw: `overrides` 42 → 33 (28 base-class + 5
`interface_member_implementation`), still **100.0% in-file and 100.0% project-scope**
resolution at both ends. Pinned by `validation/m14/fixtures/fsharp/override-target.fs`, whose
forbid rows are the three wrong answers including `Guarded.Speak -> Animal.Speak`, where the
wrong target names a member that REALLY EXISTS — a fabricated edge that resolves, which is
why no census caught it.

**What is now under-reported, and why it is not emitted.** A2's population minus A1 is 574
`override` members in a type with no base. The real case is `[<CustomEquality>]` on a union —
`src/Compiler/Utilities/TypeHashing.fs:428`:

```fsharp
[<CustomEquality; NoComparison>]
type TypeStructure =
    | Stable of hash: int * tokens: TypeToken[]
    | Unstable of hash: int * tokens: TypeToken[]
    | PossiblyInfinite

    override this.GetHashCode() = …      // overrides System.Object.GetHashCode
    override this.Equals(other) = …      // ditto
```

F# compiles that because every type derives from `System.Object`, so the base list is empty
but the declaration is real. Reading it as `System.Object.M` would be an inference from F#'s
type system rather than from the declaration, at a confidence below 1.0, with a target that
binds to nothing in any corpus that does not contain .NET's own source — and the workstream's
rule is that a narrow graph which is true beats a wide graph which is not. So the edge is not
emitted and the population is reported: **574**. Overturn condition: a measurement showing the
target resolves, or a decision that this lane may infer `System.Object` as an implicit base.

### FS-A4 — `calls`: 5,313 real calls dropped by a length test

`calls` was gated on `fnName.length > 1`. By the time the branch runs the grammar has already
said the callee is a NAME node, so the gate removed exactly one thing: every call to a
one-letter function, which is idiomatic F# (`let f x = …` composed into `f getLines`).

* **5,313** one-character applications over the 6,619-file corpus, in **735** files — 2.2% of
  the label against its 246,327 full-extent edges.
* The dropped population is **better connected than the emitted one**: on a 120-file draw of
  the census's own sample, **32.4%** of one-character callees name a symbol the same file
  publishes, against **22.2%** for emitted `calls` in-file. That is the number that decided
  it — a gate that removes the better-resolving edges is not a noise filter, it is an
  unexamined rule.
* The gate also stood in front of the constructor-chaining `instantiates`, which is why that
  label gained one edge on the draw (47 → 48).

### FS-A6 — `calls`: the pipeline the lane's own doc claimed to read

This lane's doc has said since M12 that pipe `a |> List.map` reads as `map`. It was true only
by accident: the `application_expression` branch has an `infix_expression` arm, so a pipeline
was read when it sat in **callee position** (`f (x |> g)`), and the shape F# is actually
written in — a `let` whose BODY is the pipeline — produced nothing at all.

```
let relevant (diags: FSharpDiagnostic array) =      // src/FSharp.Compiler.Service/…
    diags
    |> Array.filter (fun d -> …)                     // no `calls relevant -> filter`
```

* Sized BEFORE the rule was written, on a 300-file draw with a ≤200 KB size ceiling:
  **1,043** bare `|>` infix nodes, **1,037** of them with a NAME on the right, against **580**
  read in callee position — a 63/37 split, so the label was missing roughly a tenth of the
  calls the corpus writes, in the most idiomatic construct the language has.
* Whole corpus, whole population: **48,414** pipe infix nodes across **1,801** files, bare and
  in-callee-position together, plus **1,261** composition-operator infix nodes in **186** files
  which are excluded and counted so the exclusion is visible rather than assumed (probes A6
  and A6-control).
* The rule as shipped, on the census's own 400-file draw (≤512 KB ceiling, so a DIFFERENT
  population from the 300-file sizing run and not a prediction of it): **2,558 pipeline
  edges** — `|>` 2,489, `<|` 63, `<<` 6 — plus **76** one-character-callee edges. Those two
  are the whole of `calls`' +2,634.
* The operator's TOKEN decides which side carries the callee: `|>` `|>>` `>>=` apply the right
  operand, `<|` `<<` the left. `>>` `>>>` `>=>` `<<<` are **deliberately excluded** — they
  COMPOSE two functions and call neither (`let h = f >> g` builds a closure), and an edge from
  them would be a fabrication. Measured: 1,261 such nodes in 186 corpus files (13 bare
  `>>` in the sizing draw), excluded on that ground.
* The rule asks for NAME siblings rather than the last child, which is what makes
  `x |> List.map (fun y -> y)` read the pipeline instead of its lambda.

**Why the differential never reported either calls defect, stated with a number.**
`script/m14/fsharp-truth-oracle.ts` reads `application_expression` and `prefixed_expression`
and has no `infix_expression` branch, and its `name.length > 1` test is the analyzer's retired
gate verbatim. Both sides said nothing, so nothing disagreed — the workstream's central
failure mode ("when a type is absent from BOTH … both say nothing") reproduced INSIDE a single
label rather than across the ten. The same holds for FS-A2: the oracle derives `overrides`
from the same `override` token and falls back to the member's own name the same way.

### The six questions, per emitted type, after this pass

400-file draw, seed 0x5f5a1, production `parseFile`. Resolution is given at both scopes
because the workstream's 66.8% CSS reference point does not say which it means.

| type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (in-file / project) | 6 Confident |
|---|---|---|---|---|---|---|
| `calls` | derived | 15,238 / 183 files | ❌ **oracle shares 2 defects** — 65 unexplained vs it | ✅ 4 classes by `metadata`: `-` 12,680, `pipeline:\|>` 2,489, `pipeline:<\|` 63, `pipeline:<<` 6; no neighbour-label bleed | **20.6% / 30.9%** | all 0.8; **0 below 0.7** |
| `contains` | derived | 4,258 / 260 | ✅ | ✅ | **100.0% / 100.0%** | all 1.0; 0 below 0.7 |
| `references` | derived | 2,358 / 195 | ✅ | ✅ `declared_type` 1,669 + `isImport` 689 | **20.1% / 34.1%** | mean 0.971; 0 below 0.7 |
| `uses` | derived | 1,666 / 157 | ❌ **no oracle** — DERIVATION 1 | ✅ all `attribute_application` | **1.9% / 4.0%** | all 1.0; 0 below 0.7 |
| `imports` | derived | 705 / 158 | ❌ **no oracle** — DERIVATION 2 | ✅ `open_directive` 689 + `resource_directive` 16 | **2.4% / 22.3%** | all 1.0; 0 below 0.7 |
| `extends` | derived | 62 / 30 | ✅ | ✅ | **58.1% / 66.1%** | all 1.0; 0 below 0.7 |
| `implements` | derived | 72 / 20 | ✅ | ✅ | **20.8% / 43.1%** | all 1.0; 0 below 0.7 |
| `overrides` | derived | 33 / 14 | ❌ **9 MISSING, all truth-side** (see the A/B) | ✅ 28 base + 5 `interface_member_implementation`, distinguishable by metadata | **100.0% / 100.0%** | all 1.0; 0 below 0.7 |
| `instantiates` | derived | 48 / 23 | ✅ | ✅ 48 `construction` | **33.3% / 35.4%** | all 0.95; 0 below 0.7 |
| `exports` | — | **0** | — | — | — | — |

Standing rules re-measured on this draw: **0** empty-or-unknown `SymbolKind` rows, **0**
empty symbol names, **0** endpoints equal to `unknown`, **0** edges below 0.7 across 24,440
relationships. The heuristic class is empty and countable.

**Q5's honest reading, including the regression.** `calls` in-file resolution moved 22.2% →
20.6% and project-scope 33.1% → 30.9%. That is the cost of FS-A4 and FS-A6 and it is stated
rather than buried: the 2,626 added edges are on average LESS connected than the edges that
were already there, because a bare pipeline's right operand is usually a library function
(`filter`, `map`, `concat`) that lives in an assembly this corpus does not contain. The gain
is that they are true; the cost is a lower ratio on a bigger denominator.

### The differential A/B, on one pinned draw — and what it costs

Both runs, `bun run script/m14/differential.ts --lang fsharp`, with `BB_M14_WORK` pointed at a
private work root so the cold-pool rotation counter and the lane's seen-set started from the
same empty state. The draw is identical — `tree-truth=4984` and `hash=2143f8bdc90fe3f1` in
both rows — so the comparison is like for like.

```
BEFORE  files=60 tree-truth=4984 covered=4984 (100%)  MISSING=0  | analyzer-edges=2721 unexplained=0  (0%)
AFTER   files=60 tree-truth=4984 covered=4975 (99.8%)  MISSING=9  | analyzer-edges=2793 unexplained=65 (2.3%)  unexplained-by-label: calls=65
```

* **MISSING 0 → 9, and every one is a truth-side defect.** The samples are
  `overrides TypeStructure.GetHashCode -> GetHashCode`,
  `overrides TypeStructure.Equals -> Equals` and
  `overrides AssemblySymbol.ToString -> ToString`: the oracle deriving the pre-fix self-target
  spelling, because it reads the same `override` token and falls back to the member's own name
  the same way. The analyzer no longer agrees with it, which is the point.
* **unexplained 0 → 65, all `calls`,** and they are the FS-A4/FS-A6 edges the oracle does not
  derive. The harness calls a truth-side gap a fabrication; the number is reported rather than
  argued with.
* Net analyzer edges on this draw: 2,721 → 2,793.

**This makes the lane's pinned differential row stale and needs three shared edits, none made
here** (§8). Applied together, not separately:

1. `script/m14/fsharp-truth-oracle.ts` — (a) add an `infix_expression` rule reading the
   `infix_op` token and taking the name on the pipe's callee side, mirroring
   `PIPELINE_CALLEE_SIDE` in `src/ast/real-fsharp-analyzer.ts`; (b) drop the `name.length > 1`
   gate at lines 649 and 715; (c) resolve an `overrides` target from the enclosing
   `interface_implementation` (or `object_expression`) before falling back to the base list,
   and refuse when neither exists.
2. `script/m14/differential.ts:23153` — admit `"imports"` and `"uses"` for `lang === "fsharp"`
   in the analyzer-side allowlist (unchanged from pass 1; still required before the oracle can
   derive them without every true row reading as MISSING).
3. `validation/m14/differential-baseline.json` — re-pin the `fsharp:csharp` row, currently
   `missing: 0, unexplained: 0, heuristic: 0, avgMsPerFile: 72.1`.

### DERIVATION findings — 2, unchanged, and now with the mechanism named

| # | label | edges on the draw | truth rows | allowlist |
|---|---|---|---|---|
| 1 | `uses` | 1,666 | **0** — `deriveFsharpEdges` emits no `uses` | not admitted for fsharp |
| 2 | `imports` | 705 | **0** — no `imports` rule in the oracle | not admitted for fsharp |

The oracle emits exactly seven labels — `calls`, `contains`, `extends`, `implements`,
`instantiates`, `overrides`, `references` (counted from its own `emit(` call sites) — and the
harness's compared set for fsharp is those seven, so **2 of this lane's 9 emitted types are
stored and compared against nothing.** Pass 2 adds no new DERIVATION finding and retires none:
FS-A2, FS-A4 and FS-A6 are all inside labels the differential DOES audit, and the finding they
produce is of the opposite kind — audited against an oracle that shares the defect.

### The `exports` ruling, re-derived as a search rather than a list

Pass 1's ruling named six candidate node types and found all six absent. That is only as strong
as the six, so this pass asks the inventory the open question instead: which node types the
grammar produces at all whose name mentions an export surface? Over the same 6,619 files and
the same 353 distinct node types:

```
node types matching an export-surface word: 5
  open                 11,467 in 2,544 files   (matched "open")
  member_signature      6,742 in   533 files   (matched "signature")
  access_modifier       4,850 in 1,016 files   (matched "access")
  property_accessor     1,529 in   211 files   (matched "access")
  delegate_signature      143 in    71 files   (matched "signature")
of those, an export DECLARATION: 0
every node type the grammar can produce whose name contains "export": (none)
```

The adjacency number is unchanged and re-measured: **7,818** namespaces/modules declaring at
least one member, in **3,630** files, which is what `contains` already carries at 100.0%
resolution. **The ruling stands.** Overturn condition, restated as a search: any node type
whose name contains `export` appearing at a non-zero count over the corpus, or any of the six
named types.

### Two instrument disagreements, both small and both explained

* `import_decl` reads **11,371 in 2,540 files** under instrument A (which walks every child)
  and **11,370 in 2,539** under instrument B (which walks named children only). One node in one
  file, and the cause is the two traversal rules: exactly one `import_decl` in the corpus hangs
  off an anonymous node. Both numbers are reproducible; they answer different questions, and
  pass 1 quoted instrument A's.
* Every other probe population reproduced pass 1 exactly: `attribute` 29,441 / 2,492;
  `fsi_directive_decl` 193 / 135; `module_abbrev` 5 / 5; resource directives 185 / 134;
  `base.X` **0**; operator definitions 249 / 104.

### The `member _ : IFoo with …` question from pass 1 — SETTLED, and it is a grammar gap

Pass 1 left open whether F#'s inline interface implementation was unread. It is not the shape
it looked like. The probe separates the two constructs that share it — a property accessor list
(`member _.P : int with get, set`) from an interface implementation — and finds:

| probe | population | verdict |
|---|---|---|
| `member` with a `with` clause carrying `property_accessor` nodes | the property spelling | already read (property + setter calls) |
| the same with accessors excluded | **7 per 1,200 files** | every printed example is an `{ new IFoo with … }` OBJECT EXPRESSION, which FS-D7 already reads |
| `type I = interface J with … end` — the NAMED interface declaration | **32 in 24 files** | **NOT READ, and not readable from this tree** |

The last row is the real answer. F#'s ordinary way to declare an interface that extends another
is `type IFoo = interface IBar with … end`, and the pinned grammar does not parse it: the
`interface` keyword lands in an ERROR node, `IBar` is taken as a `union_type_case` OF the
interface itself, and the rest of the body becomes a second ERROR. Three consequences, all
structural and none fixable in the analyzer:

* the type is classified from `union_type_defn`, so it is published as an **Enum**;
* the base interface name is published as an **EnumMember** of the interface;
* **no `implements` edge exists for it**, and the members inside the ERROR are not walked at
  all — the walk discloses a recovery region and does not descend (FS-D15/D16).

So `implements` is under-reported by **32 declarations in 24 of 6,619 files** (2.7% of the
1,167 interface-declaration shapes the corpus contains: 905 in class bodies + 230 bare + 32
named). It is a **grammar** gap, not an analyzer one, and the fix belongs in
`grammars/tree-sitter-fsharp/` (the same external-scanner probe that already discriminates
`interface` in an implicit class body), which is shared and not this lane's. No edge was
invented to cover it. Pass 1's parse-health table already carried this construct as item 6
("bare `interface IY` type body", 8 nodes) measured by a narrower discriminator; this pass
counts 32 by counting `union_type_defn`s carrying an `interface` ERROR, and both numbers are
real.

### Gates re-run at this pass's HEAD

| gate | command | result |
|---|---|---|
| F3 fixtures | `bun run script/m14/run-fixtures.ts --lang fsharp` | **10/10 PASS** (8 pre-existing + `override-target` + `one-char-calls`) |
| F4 mutants | `BB_MUTANT_ONLY="fsharp/" bun run script/m14/mutate-analyzer.ts` | **21/21 CAUGHT** (18 pre-existing + 3 new) |
| tsc | `npx tsc --noEmit -p tsconfig.json` | clean |
| census | `npx tsx validation/m14/fixtures/fsharp/ontology-census.ts` | 400/400 parsed, 0 failures — §"What pass 1's numbers do now" |
| probe | `npx tsx validation/m14/fixtures/fsharp/ontology-probe.ts` | 6,619/6,619 walked, 353 node types, 0 skipped |
| F5 differential | `bun run script/m14/differential.ts --lang fsharp` | see the A/B above; the pinned row needs re-pinning (§8) |
| M60 arbiter | `npx tsx script/m14/ontology-coverage-gate.ts fsharp` | still refuses: `no RULING TABLE for fsharp`, exit 2 — unchanged from pass 1 and for the same reason (`RULED_BY_LANG` carries `bash` and `json`) |

### Declared limitations

For a Turing-complete language this list is not optional, and a blank one would be a claim
rather than an achievement.

### Declared limitations, pass 1 (2026-10-02)

**Pass 1 (2026-10-02) — this list still stands; pass 2's is below it.**

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

### Declared limitations, pass 2 (2026-10-03)

Each of these is a number or a named construct rather than a mood:

- **Three of this lane's labels are audited by an oracle that shares their defects.** The
  measured consequence is on the table above: 65 unexplained `calls` rows and 9 `overrides`
  MISSING rows on one pinned 60-file draw, every one of them traceable to a rule the oracle
  and the analyzer share rather than to either being wrong on its own. A differential over one
  grammar cannot see a bug both walkers share; the six questions' Q3 is therefore bounded for
  this lane in a way the numbers in the table do not suggest.
- **`overrides` is under-reported by a measured 574 members** — an `override` in a type with
  no base and no interface, which F# allows because every type derives from `System.Object`
  (`[<CustomEquality>]` on a union). Reading `System.Object.X` would be an inference at
  confidence < 1.0 with a target that binds to nothing in any corpus that does not contain
  .NET's own source, so nothing is emitted. A corpus that DOES contain such a target, or a
  decision that this lane may infer the implicit base, would overturn that.
- **`implements` is under-reported by 32 declarations in 24 of 6,619 files** — the named
  interface form `type I = interface J with … end`, which the pinned grammar mis-parses into
  an ERROR plus a one-case union. A GRAMMAR gap: the analyzer publishes the type as an `Enum`
  and the base interface as an `EnumMember`, publishes no `implements` edge, and does not walk
  the members inside the recovery region at all. No edge was invented to cover it.
- **`calls` resolution fell, and that is the price of the fix.** In-file 22.2% → 20.6%,
  project-scope 33.1% → 30.9%, on a 12.6% larger label. A pipeline's right operand is usually
  a library function that lives in an assembly this corpus does not contain, so the added
  edges are on average less connected than the ones already there.
- **The `new`-prefix gate was NOT measured.** `calls`' one-character gate was removed with a
  population and a resolution rate behind it; the identical gate on the `prefixed_expression`
  branch (`new X()` with a one-letter type name) was left in place because no measurement
  exists for it. Same shape, same absence of a reason, different evidence — and the difference
  is recorded in the source rather than smoothed over.
- **Pipe operators the lane does not read.** `>>` `>>>` `>=>` `<<<` compose two functions and
  call neither, so they emit nothing — 1,261 such nodes in 186 corpus files. If a consumer
  wants composition edges that is a different relationship type, not a gap in this one.
- **`Global` is a source that names nothing.** 2,021 file-level `import_decl`/`attribute`
  nodes over the corpus have no enclosing scope, and the `imports`/`references`/`uses` rules
  source them to the literal string `Global`, which no file declares — which is why `imports`
  resolves at 90.6% at the source end against 100.0% for every other label. It is not the
  literal `unknown`, so ledger R7 does not catch it, and a name-keyed consumer sees an
  unresolvable source. Removing the edges would lose real dependencies; inventing a module
  symbol would be a fabrication. Left, measured, declared.
- **Both draws are FSharp.Compiler plus its tests.** One repository, 6,619 files, a
  self-hosting compiler in a narrow style. The pipeline and one-character populations are
  style-sensitive: a corpus of F# scripts would weight them very differently, and a
  functional codebase would weight `|>` higher still.
- **Two draws, two size ceilings.** The 300-file sizing run for FS-A6 admitted ≤200 KB and the
  census admits ≤512 KB, so they are different populations drawn from the same seeded shuffle.
  Their counts are each reproducible and neither predicts the other; both are quoted with the
  ceiling that produced them.


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

### Broken outside this language — found, not fixed (§8)

- **`script/m14/verify-doc-truth-emissions.ts` drops the FIRST BODY ROW of every claim table.**
  `parseClaimTable` walks the table and, on the first non-rule row after the header, executes
  `if (!started) { started = true; continue }` — which advances past that row without reading
  it. Minimal reproducer, three rows, run against the module directly:

  ```
  | Relationship type | Emitted? | How resolved | Confidence |
  | --- | --- | --- | --- |
  | calls | ✅ | a | 0.8 |
  | contains | ✅ | b | 1.0 |
  | uses | ❌ | c | — |

  parseClaimTable -> rows: 2   contains=YES uses=NO        // `calls` is absent
  ```

  The visible symptom in this lane is `UNDOCUMENTED [fsharp] calls`, which is **pre-existing**
  and identical before and after this pass (verified by running the gate against `HEAD`'s doc).
  Project-wide it is `UNDOCUMENTED=40` of 48 analyzers, and it is the benign direction: a claim
  that is silently ignored, not a wrong verdict. The direction that matters is the other one —
  a lane whose FIRST row says "not emitted" for a label the analyzer does emit gets its
  FALSE_NEGATIVE skipped, and `FALSE_NEGATIVE=7` project-wide should be read as a floor until
  this is fixed. One-line fix in the shared file, not made here.
- **`ontology-coverage-gate.ts` still refuses to report for this lane**, unchanged: exit 2 and
  `no RULING TABLE for fsharp`, verified again on a 2-file bounded corpus root
  (`BB_CORPUS_ROOT=/tmp/…/mini-root`, `corpus: 2 admitted files`). `RULED_BY_LANG` carries
  `bash` and `json`. The lane therefore carries its own census, and its per-type verdicts have
  never been produced by the arbiter.
- **`script/m14/fsharp-truth-oracle.ts` shares three defects with the analyzer it audits**
  (`infix_expression` unread, the `length > 1` gate, and the `override`-token target
  resolution). Measured consequence on one pinned 60-file draw: 65 unexplained `calls` rows and
  9 `overrides` MISSING rows, all attributable to the shared rules. This is the harness's
  declared limitation made numeric rather than rhetorical, and it is why this pass's three fixes
  move the F5 row the wrong way on purpose.
- **`docs/DOC-TRUTH-EMISSIONS.md` was regenerated by running the gate and then NOT committed.**
  Its delta at this HEAD is dominated by other lanes' analyzer changes (FALSE_NEGATIVE 8 → 7,
  NO_CLAIM_TABLE 20 → 22), so committing it would import other branches' state into this one.
  Left for the supervisor's own regeneration.

## M60 pass 2 — Unresolved


Stated as unresolved rather than rounded off. Nothing here is claimed as settled.

- **574 `override` members with no readable base** (FS-A2's remainder) emit nothing. The
  language fact is that F#'s implicit base is `System.Object`; the decision not to infer it is
  a judgement about confidence and resolution, and it is reversible with a measurement.
- **32 named interface declarations are unread** because the pinned grammar mis-parses
  `type I = interface J with … end`. The fix belongs in `grammars/tree-sitter-fsharp/`'s
  external scanner — the same probe that already discriminates `interface` in an implicit
  class body — and in a wasm rebuild. Neither is this lane's file, so it is a report and not
  a patch.
- **The lane's pinned differential row is stale** and three shared edits are listed in §8 of
  this section's A/B. Until they land together the F5 row under-reports what is audited (2
  DERIVATION labels) and over-reports what is wrong (9 MISSING rows that are the oracle's
  defect, 65 unexplained rows that are the oracle's gap).
- **The `new`-prefix one-character gate is unmeasured**, so `instantiates` may be
  under-reporting by an unquantified amount. It was left rather than guessed.
- **Composition operators (`>>` `>>>` `>=>` `<<<`) emit nothing** — correctly, on this lane's
  reading, but the reading is a decision about what `calls` means rather than a measurement,
  and no consumer requirement has been checked against it.
- **Latency: measured, and the first measurement was wrong.** Two rules were added inside the
  existing single-pass walk, plus one unbounded parent walk per `override` member (33 members
  on the 400-file draw; the corpus's densest file, VsMocks.fs, has 6). A first A/B over a
  120-file sample of the census's own draw read **54.5 ms/file before against 63.2 after**,
  +16% with non-overlapping ranges, which reads as a real cost for +8.4% more relationships.
  Re-measured **interleaved** on the same files, because four lanes share the box:

  ```
  round 1   BEFORE 65.3 ms/file (7,470 relationships)   AFTER 77.8 ms/file (8,096)
  round 2   BEFORE 76.1 ms/file (7,470 relationships)   AFTER 67.9 ms/file (8,096)
  ```

  The ranges overlap almost completely, so the +16% was the machine's load and **no claim
  finer than "inside the run-to-run spread of a shared box" is supported**. Reporting the first
number would have been a fabricated measurement of someone else's CPU time. Pass 1's own
   latency row is neither re-baselined nor re-asserted here.

## M60 ONTOLOGY LANE, PASS 3 — the arbiter's verdict, and one unresolvable endpoint (2026-10-03)

Three passes in, this lane still had no adjudicated verdict on any of its ten types. Pass 1
and pass 2 both recorded that `script/m14/ontology-coverage-gate.ts fsharp` exits 2 with "no
RULING TABLE for fsharp", and neither wired one. That is now settled, and it settled itself
against the arbiter rather than against this lane's own note.

### The population GREW, so the pass-1 and pass-2 figures are not comparable to these

| | pass 1 / 2 | pass 3 |
|---|---|---|
| fsharp files admitted | 6,619 | **11,799** (the gate's own count; 11,809 tracked, the gate caps at 512 KB/file) |
| repos contributing | 1 (`fsharp`) | 22 |

Nothing in this lane changed the corpus; other lanes cloned F# repositories. Pass 1's
"6,619-file corpus" and the probe's "7,818 namespaces in 3,630 files" describe a
**different population** from this pass's, so they are neither confirmed nor contradicted by
anything below. Pass 2's seeded draw (`0x5f5a1`, `slice(0,400)`) was drawn from the 6,619
population and its per-type counts are on that population, not this one.

### What fires, through production `parseFile`

`npx tsx script/m14/firing-check.ts --files 120 fsharp` — 120/120 files parsed, **0 degraded
fallbacks**, 12,517 relationships, **9 of 10 types fired**:

```
calls, uses, contains, imports, references, extends, implements, overrides, instantiates
```

`exports` is the only zero, and a zero here is a FIRING FACT, not a ruling.

**One defect in that instrument, found while reading its output, and not this lane's to fix.**
Its `files` column is assigned rather than accumulated:

```ts
// script/m14/firing-check.ts:339 — inside the per-file loop, `filesByType` is fresh…
for (const [type, set] of filesByType) res.types[type].files = set.size   // …so this OVERWRITES
```

so every type reads `files: 1` on the 400-file run regardless of how many files carried it.
The `edges` column is correct (`row.edges++` accumulates). The per-type **file** counts in
this section come from `edge-resolution-probe.ts`, which accumulates into a `Set` outside the
loop. Report-to-supervisor, with the line number.

### The arbiter's verdict, on the arbiter's own counts

`validation/m14/fixtures/fsharp/ruled-gate.ts` applies the supervisor's two-line change to a
**copy** of the gate under `/tmp` and runs the copy; the shared file is untouched. It first
compares the gate's own `type Ruled` block against this lane's restatement field by field and
exits 2 on any divergence — 5 fields, identical.

```
ontology coverage gate — fsharp          (975 admitted files, 2 workers)
exports       RULED-SOUND   NOT EMITTED; the grammar produced 321 distinct node types across
                             the corpus and NONE expresses it.
                             Written ruling: script/m14/fsharp-ruled.ts (RULED_BY_LANG.fsharp)
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
exit code 0
```

The other nine, with the **arbiter's** counts (975 files, not this lane's 400-file draw):

| type | status | edges | example file |
|---|---|---|---|
| `calls` | EMITTED | 85,653 | `FSharp.Data/docs/library/CsvFile.fsx` |
| `references` | EMITTED | 14,689 | `FSharp.Data/docs/library/CsvFile.fsx` |
| `contains` | EMITTED | 20,417 | `FSharp.Data/docs/tutorials/JsonAnonymizer.fsx` |
| `imports` | EMITTED | 4,902 | `FSharp.Data/docs/library/CsvFile.fsx` |
| `uses` | EMITTED | 8,122 | `FSharp.Data/docs/library/CsvProvider.fsx` |
| `instantiates` | EMITTED | 624 | `FSharp.Data/docs/library/Http.fsx` |
| `implements` | EMITTED | 375 | `FSharp.Data/src/FSharp.Data.Csv.Core/CsvRuntime.fs` |
| `overrides` | EMITTED | 247 | `FSharp.Data/src/FSharp.Data.DesignTime/CommonProviderImplementation/Helpers.fs` |
| `extends` | EMITTED | 112 | `FSharp.Data/src/FSharp.Data.DesignTime/Html/HtmlProvider.fs` |

The verdict is stable across three populations — 1,024 files / 322 node types, 975 / 321,
and the same `9 EMITTED · 1 RULED-SOUND · 0 FALSIFIED · 0 UNJUSTIFIED` each time. The
`exports` ruling is instrument **A** and is falsifiable: the gate re-measures the grammar's own
node-type inventory across every admitted file and prints FALSIFIED if any of the six named
node types appears. It did not, and neither did any node type whose name contains `export`.

**Coverage is reported as applicable, not as a flat 10: 9 EMITTED + 1 measured-absent = 9/9
applicable, decided.** The denominator shrank by exactly one, by the RULED verdict and its
measurement. Numerator (firing) and denominator (measured non-applicability) came from two
different instruments — `firing-check.ts` through production `parseFile`, and the gate's
instrument A over the grammar's node inventory — which is the separation the workstream
requires.

### The arbiter still cannot finish on the full corpus, and that is now a second file

`npx tsx script/m14/ontology-coverage-gate.ts fsharp` over all 11,799 files died twice, on two
**different** files, both with the same signature:

```
[BB-PARSE-ERR] fsharp | …/Fake/src/legacy/FakeLib/DynamicsNavFile.fs       | memory access out of bounds
[BB-HANG]      parser stuck 120s on …/Fake/src/legacy/FakeLib/DynamicsNavFile.fs — exiting

[BB-PARSE-ERR] fsharp | …/Grace/src/Grace.Cache.Storage/CacheArtifactStore.fs | memory access out of bounds
[BB-HANG]      parser stuck 120s on …/Grace/src/Grace.Cache.Storage/CacheArtifactStore.fs — exiting
```

Pass 1 recorded the first of these and called it "a known parser-robustness finding". It is
not one file, it is a class, and the reason the gate cannot report is structural rather than
incidental: `parseFile` recovers from a WASM crash (it prints `[BB-PARSE-ERR]`, substitutes,
continues), but the gate's **instrument A** then re-parses every admitted file with a RAW
`web-tree-sitter` parser that has no timeout and no recovery, so the first file that crashes
the WASM allocator ends the run before a verdict prints. The bounded population above excludes
`Fake`, `Grace` and `giraffe` for exactly that reason, and says so rather than quietly
presenting a smaller corpus as the whole one.

### FS-P3-1 — `overrides` wrote an endpoint this lane never published

**This is the pass's one code change, and it is a real defect rather than a style one.**

`overrides` is the only relationship this analyzer emits whose **source** it qualifies on
purpose, because a bare member name is ambiguous and the analyzer knows it:

```fsharp
type Resource() =
    interface System.IDisposable with
        override this.Dispose() = ()
```

emits `overrides Resource.Dispose -> IDisposable.Dispose`. That qualified spelling was a
spelling the lane never **published**. Measured directly, on
`Grace/src/Grace.Actors/AccessControl.Actor.fs`:

```
stored symbol : name="OnActivateAsync"  qualifiedName="OnActivateAsync"  ownerName="AccessControlActor"
emitted edge  : source="AccessControlActor.OnActivateAsync"          → 0 exact matches
```

`pool-worker.ts:870` derives the stored value as
`s.qualifiedName || s.metadata?.fqn || (s.scope ? … : name)`, and this analyzer set **none of
the three**, so `brain_symbol.qualified_name` held a bare name for every owned symbol in the
language while `brain_relationship.source_external` held a dotted one. Those are the two
columns `src/ast/parallel-indexer.ts` joins — it documents its own strategies as "a bare
`name`, a `qualified_name` (`Owner.member`), or — for a dotted target — everything after the
first `.`". So an F# member that overrides something had **no reachable incoming edge**:
`bb_impact` could not walk to it and `src/lsp/impact.ts`, which derives reverse edges by
scanning outgoing edges and matching targets, inherited the miss with no way to report it.

The fix mints `metadata.fqn` in `publish` — the single funnel all 15 symbol-mint sites pass
through, so the edge spelling and the published spelling cannot drift apart again. 51 lines
added, 49 of them the reason.

**Measured both sides, on the same 400-file stride sample, production `parseFile`:**

| | before | after |
|---|---|---|
| `overrides` source binds at the store's key (`src%STORE`) | **0.0%** | **100.0%** |
| dotted `overrides` sources that bind (`dotSrcStore`) | **0 / 63** | **63 / 63** |
| same column for all eight other types | unchanged | unchanged |

Unchanged is the load-bearing part: `calls` 195/195, `uses` 329/329, `contains` 1665/1665,
`imports` 1041/1041, `references` 1016/1016, `implements` 9/9, `extends` 0/0,
`instantiates` 0/0 before and after. Those types' dotted sources already equalled their
published bare name, so the fix is surgical rather than a broad re-spelling.

And at the store's own key, over a 300-file sample (`store-seam-check.ts`):

| | before | after |
|---|---|---|
| owned symbols publishing `owner.name` | 0 / 5,586 | **5,586 / 5,586** |
| dotted relationship sources binding to a published key | 2,683 / 2,739 | **2,739 / 2,739** |

### The six questions, after this pass

400-file stride sample of 11,809, production `parseFile`, 42,706 relationships, 8,998 symbols,
0 empty names, 0 empty/unknown kinds, 0 `unknown` endpoints, 0 degraded fallbacks.

1. **Exists** — 10 of 10 are constructible; the arbiter's own EMITTED rows are the evidence
   for 9, and the tenth is construct-absence rather than a code path.
2. **Fires** — 9 of 10, measured at 120 files and again at 400. `exports` fires 0.
3. **Correct** — unchanged from pass 2 and still carrying pass 2's declared limitation:
   `script/m14/fsharp-truth-oracle.ts` is a second walker over the same grammar, so a grammar
   bug shared by both paths is invisible to it. No claim here exceeds that.
4. **Labelled** — unchanged; pass 2's FS-A2 fix (an interface member is not a base-class
   override) stands and this pass adds no label.
5. **Resolved** — the table below. **This is the question that moved.**
6. **Confident** — **0 edges below 0.7 confidence, on all ten types, across 42,706
   relationships.** The heuristic ratio is not merely small, it is zero, so nothing in this
   lane's output needs the honesty contract §4 reason code on the strength of its number
   alone. Stated with its denominator because a bare "no heuristics" is the kind of claim
   §1 exists to catch.

| type | edges | files | src binds | tgt binds | both ends | dotted srcs bound |
|---|---|---|---|---|---|---|
| `calls` | 26,167 | 260 | 99.9% | 21.8% | 21.8% | 195/195 |
| `contains` | 7,537 | 309 | 100.0% | 99.9% | 99.9% | 1665/1665 |
| `references` | 4,909 | 260 | 98.6% | 22.0% | 21.9% | 1016/1016 |
| `uses` | 2,351 | 205 | 96.9% | 4.1% | 3.9% | 329/329 |
| `imports` | 1,353 | 242 | 92.9% | 2.8% | 2.6% | 1041/1041 |
| `instantiates` | 111 | 38 | 100.0% | 20.7% | 20.7% | 0/0 |
| `implements` | 125 | 42 | 100.0% | 22.4% | 22.4% | 9/9 |
| `extends` | 90 | 38 | 100.0% | 20.0% | 20.0% | 0/0 |
| `overrides` | 63 | 20 | **100.0%** (was 0.0%) | 22.2% | 22.2% | **63/63** (was 0/63) |
| `exports` | 0 | 0 | — | — | — | — |

**Reading the low target rates honestly, which is the external/never-indexed split.** A low
`tgt binds` is not by itself a defect, and for two of these types it is arithmetically
impossible to be otherwise:

- `imports` at 2.8% is the instrument's **ceiling**, not the analyzer's quality. A per-file
  symbol set can never bind a cross-file edge, and an import names a scope in another file by
  construction. 402 of the 1,353 import targets are names the sample publishes **elsewhere**,
  so a population-wide walk reaches them and a per-file walk cannot. The rest name
  `FSharp.Core`/`Microsoft.*` — external, and absent from the corpus because FSharp.Core is a
  NuGet package, not a checked-out repository.
- `calls` at 21.8% and `references` at 22.0% are dominated by the same thing: `String`,
  `List`, `printfn`, `sprintf` are FSharp.Core, and an F# corpus without a FSharp.Core
  checkout cannot bind them. 4,207 of the unresolved `calls` targets and 902 of the
  `references` targets are names the sample publishes in another file, so those are
  resolvable by a cross-file walk and are counted as such rather than as losses.

This lane cannot close that gap by indexing more repositories: the missing targets are
**standard-library declarations**, which is a different defect class from a declaration this
lane failed to publish, and the two look identical in a count.

### Ambiguity: 146 of 8,473, and the shape is the language's

At the store's own key, on the 400-file sample: 8,473 distinct `qualified_name` values, of
which **146 (1.7%) are carried by more than one published symbol.** By kind pair:

| kind pair | collisions |
|---|---|
| `function` + `variable` | 25 |
| `namespace` alone | 15 |
| `class` alone | 14 |
| `variable` alone | 13 |
| `method` alone | 10 |
| `function` alone | 9 |
| `enum_member` alone | 8 |
| `module` alone | 7 |
| `class` + `module` | 7 |
| `enum` + `module` | 5 |
| `module` + `type` | 4 |

(An entry reading `class` alone means several symbols of one kind share the qualified name —
duplicate declarations, which `bb_search`'s containment match is built for. The `X` + `module`
pairs are F#'s **companion pair**: `type Foo = …` beside `module Foo = …` is an ordinary
idiom and yields two real declarations under one name. Measured on
`Grace/src/Grace.Actors/AccessControl.Actor.fs`, a `class` at line 23 and a `module_defn` at
line 27 both publishing `AccessControl.AccessControlState`.)

`script/m14/incoming-check.ts` over 5 Grace files (228 symbols) reports the same thing from
the other end: 6 ambiguous targets, every one of them the module/variable or class/module
shape, and **0 ambiguous `overrides` targets**.

**The companion pair cannot be disambiguated per file, and this lane says so instead of
inventing a spelling.** A type and its companion module genuinely share a name; the language
provides no third token to separate them, and a qualified name that encoded the kind
(`AccessControl.AccessControlState:class`) would be a spelling no store consumer expects.
Closing it needs the kind or the file as a **resolution input**, which is Laptop C's
incoming-resolution layer, not an analyzer change. Stated with the count rather than left to
be rediscovered.

### DERIVATION findings — 2, unchanged

`script/m14/fsharp-truth-oracle.ts` audits 8 of the 10 types. The 2 unaudited are the same 2
pass 2 recorded, and neither is settled by this pass: they need an oracle branch in shared
machinery, which is §8 and not this lane's file.

### Regression nets

- `validation/m14/fixtures/fsharp/qualified-name-seam.fs` + `.expectation.json` — 8 symbol
  rows pinning `metadata.fqn` on owned members, 2 forbidding its absence, 4 relationship rows
  pinning the `overrides` endpoints in the **same file** so the edge spelling and the symbol
  spelling cannot diverge without a row failing.
- **Proven able to fail**: with the mint disabled the suite goes red on that one fixture and
  **the other ten stay green** —
  `FAIL fsharp/qualified-name-seam … summary: {"fsharp":{"pass":10,"fail":1}}` — which is the
  property that matters, since two passes of fixtures were green over a store that could not
  resolve the edge.
- `script/m14/fsharp-mutants.ts` gains `fsharp/drop-owner-qualified-name` (written off the
  result's own symbol table, so it cannot silently stop matching when a fixture is renamed):
  `CAUGHT fsharp/drop-owner-qualified-name (0 -> 1 failures; new failures:
  fsharp/qualified-name-seam)`.
- `store-seam-check.ts --self-test` exists because a verifier never seen to fail is
  decoration. **It immediately caught a bug in its own first version**, which incremented one
  counter for both "correct" and "absent" and so reported a clean pass over a corpus where no
  symbol carried a qualified name at all. Stripping a field did not move the number being
  compared, which is the signature of a check counting the wrong thing. The three cases are
  counted separately now and the self-test requires the bound count to **move**.

### Gates re-run at this pass's HEAD

| command | result |
|---|---|
| `bun run script/m14/run-fixtures.ts --lang fsharp` | 11/11 pass (was 10/10) |
| `BB_MUTANT_ONLY=fsharp/drop-owner-qualified-name bun run script/m14/mutate-analyzer.ts` | `CAUGHT … 0 -> 1 failures` |
| `npx tsx script/m14/firing-check.ts --files 120 fsharp` | 9/10 fired, 12,517 edges, 0 degraded |
| `npx tsx script/m14/ontology-coverage-gate.ts fsharp` (full corpus) | **no verdict** — dies in the parser on `DynamicsNavFile.fs` / `CacheArtifactStore.fs` |
| `ruled-gate.ts` on a bounded 975-file root | `9 EMITTED · 1 RULED-SOUND · 0 FALSIFIED · 0 UNJUSTIFIED`, **exit 0** |
| `npx tsx validation/m14/fixtures/fsharp/store-seam-check.ts --files 300 --self-test` | `SEAM HOLDS 5586/5586`, self-test OK |
| `npx tsc --noEmit -p tsconfig.json` | clean |

### The regex census: this lane's rows are stale, and the claim above them is not

`npx tsx script/m12/verify-regex-census.ts` **FAILS**, and 6 of its 25 STALE rows are this
lane's — `real-fsharp-analyzer.ts:1050:/[()<]/`, `:1050:/\s:/`,
`:1050:/^[A-Za-z_][A-Za-z0-9_']*$/`, `:1288:/^['^]/`, `:1290:/^['^]/`,
`:1292:/^[A-Za-z_][A-Za-z0-9_']*$/`.

Those six literals **are not in the file**. Pass 1 (`a48701034`) removed all six and left the
census artifact uncommitted because it is regenerated by its owner. Verified now against the
committed blobs through the shared scanner:

```
total usages across all analyzers: 28
real-fsharp-analyzer.ts usages at HEAD: 0
```

So this section's "regex-free" claim is **true and measured at 0 usages against the committed
blobs**, and the artifact that would corroborate it is stale — which is the same shape pass 1
wrote this section about, one level up. The fix is one command and belongs to the supervisor:
`bun script/m12/regex-census.ts --head`, then commit
`validation/m12/results/regex-census.json`. The other 19 STALE and all 26 MISSING rows belong
to `css`, `julia`, `clean`, `javascript`, `python`, `svelte` and `typescript`; found, not
touched.

### Pass 3 — Unresolved

- **The arbiter cannot produce a verdict on the full 11,799-file corpus.** Two named files
  crash the fsharp WASM parser and instrument A has no timeout or recovery. A per-file
  timeout in the gate's instrument A, or admitting the `[BB-PARSE-ERR]` files it already
  recovered from, would make the full-corpus verdict reachable. Supervisor-owned (§8), not
  patched here.
- **`script/m14/firing-check.ts`'s `files` column is wrong** (assigned, not accumulated;
  `script/m14/firing-check.ts:339`). It reads 1 for every type on a 400-file run. Its `edges`
  column is correct. Not this lane's file.
- **`script/m14/firing-check.ts` is untracked in the main checkout** and was copied into this
  worktree to run, uncommitted. If it is superseded before this branch merges, the numbers
  above are reproducible from `edge-resolution-probe.ts`, which is committed.
- **The 2 DERIVATION findings** are unchanged and need an oracle branch in shared machinery.
- **`exports` is RULED on instrument A over a 975-file population**, not the full 11,799. The
  probe that carries the full-population version is
  `validation/m14/fixtures/fsharp/ontology-probe.ts`; it was not re-run this pass, so its
  6,619-file figures describe the older, smaller corpus and are not restated here as current.
- **The 146 qualified-name collisions** are measured and named, and closing them needs a
  resolution input this lane does not own.
- **`imports` and `calls` targets that name FSharp.Core cannot resolve** from any corpus that
  lacks a FSharp.Core checkout. Distinct from a declaration this lane failed to publish, and
  indistinguishable from it in a count.

### Two things this pass got wrong, recorded because both were caught by instruments rather than by reading

1. `store-seam-check.ts`'s first version read `metadata.fqn` off the **mapped** symbol, which
   `pool-worker.ts` does not re-expose — so it measured a field that is consumed into
   `qualifiedName` and never published. It reported "SEAM HOLDS" over a corpus where **zero**
   symbols carried a qualified name. The `--self-test` caught it; the counter bug above was
   found in the same run. Both are why the file now reads `qualifiedName` and counts three
   cases separately.
2. `edge-resolution-probe.ts`'s first version reported `both%any` only — a union over four
   schemes including `ownerDot`, which `ownerName` made computable **before** the fix. The
   union could not move, so the probe would have shown no change at all for the defect it was
   written to detect. The `src%STORE` and `dotSrcStore` columns exist because of that, and the
   before/after table above is measured on both sides rather than inferred from one.

## Issue


Closes M12.08 (GitHub issue #147). The 2026-09-28 M14 round above does not close it.
