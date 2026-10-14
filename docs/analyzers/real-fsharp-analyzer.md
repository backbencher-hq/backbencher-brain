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
| calls | ✅ | `app_expression`/`application_expression` → the callee name, **plus a BARE pipeline** (`infix_expression` whose `infix_op` token is a pipe) since FS-A6 (M60 pass 2) — single pass, deduped by identity in the harness. **FS-A6, and the doc's own pipe claim was half true until it was measured:** the pipe `a \|> List.map` → `map` was read only when the pipeline sat in CALLEE position (`f (x \|> g)`), because only the `application_expression` branch had an `infix_expression` arm. The shape F# is actually written in — a `let` whose BODY is the pipeline — produced nothing: **1,043 bare `\|>` nodes with a NAME on the right, against 580 read in callee position, on a 300-file corpus draw**, i.e. ~11% of the corpus's calls were absent from the label. The operator's TOKEN decides which side carries the callee (`\|>` `\|>>` `>>=` apply the right operand, `<\|` `<<` the left) and `>>` `>>>` `>=>` `<<<` are deliberately absent because they COMPOSE two functions and call neither. **FS-A4, in the same round:** the label was also gated on `fnName.length > 1`, which no property of the program justifies and which dropped every call to a one-letter function — **5,313 occurrences over 6,619 files in 735 files** (2.2% of the label's 246,327 full-extent edges), and the dropped population resolves BETTER than the emitted one (32.4% in-file on a 120-file draw against 22.2%). **Source (owner) is the enclosing callable**, and which callables count is the substance of FS-D10/D12/D13: a top-level `let` owns its initialiser's calls *whatever its kind* (a `let` with no arguments is a Variable, and a script top level has no enclosing callable, so keying on kind dropped 2,520 rows per 200 files); a `default` implementation owns its body's calls (it publishes no symbol — the abstract signature is canonical — but the body belongs to it); an explicit `with get, set` property owns its **setter**'s calls. A recursive `calls f -> f` is emitted: a self-CALL is a fact about the program, while a self-`contains` is not, and the refusal is per-label. **THE TARGET IS NOT ALWAYS THE LEAF, and the pass-4 sentence that said it was is superseded by passes 5 and 6 below.** A `calls` target is spelled by one rule with three outcomes: the identity this file PUBLISHED when the written path (or, for a 3+-segment path, its last two segments) is one of them (`Message.SetInput`, `Seq.map`, `Widget.RenderTo`); `${qualifierLeaf}.${leaf}` when the qualifier the source wrote is module-LIKE and the identity is not provable in-file (`Microsoft.FSharp.Collections.Seq.map` → `Seq.map`, `Array.fold` → `Array.fold` — provably never worse than the leaf, because strategy 3's tail of a two-segment string IS the leaf; **but neutral to the store's own attachment, which resolves by the LEAF at insert time before any strategy runs — PASS 11 measures it: 274 of 274 dotted `calls` attached by leaf, 0 by exact qname**); and the LEAF otherwise, always with `metadata.targetResolution` naming the class (`local-binding`, `bare-external`, `receiver-value`, `call-chain-receiver`, `base-member-external`, `in-file-declaration`, `in-file-qualified`, `self-member`, `module-member`, `opened-module`, `external-type-or-module`) and `metadata.targetQualifier` carrying the discarded qualifier. Measured: `calls` target-determinacy 19.1% → 29.1%, all labels 22.4% → 34.2% on the 3,000-file draw — **the pool-uniqueness proxy, which asks whether the written endpoint is an unambiguous identity in the corpus (the question a name-joining consumer asks), not what the store's own insert-time LEAF lookup does; PASS 11 measures that separately.** Pinned by `fsharp/call-target-spelling` (11 classes, 4 forbids). | 0.8 |
| extends | ✅ | `class_inherits_decl` (`inherit Animal()`) → `Animal`; source = the type. **R10 spelling:** a qualified target is published under the LEAF, with the qualified form kept in `metadata.qualifiedType` — the name this lane would publish for that type as a symbol, which is what a consumer joins on (FS-D9; 13 dotted `implements` + 3 dotted `extends` per 400 files) | 1.0 |
| implements | ✅ | `interface_implementation` (`interface ILogger with`) → `ILogger`; source = the type. R10 leaf spelling as for `extends`. | 1.0 |
| instantiates | ✅ | constructor chaining `new() = Point(0, 0)` → `Point` (enclosing constructor body); source = `constructor` | 0.95 |
| overrides | ✅ | `override` keyword token (first child of `member_defn`), and **FS-A2 (M60 pass 2) the target is resolved from the INTERFACE the member implements when there is one**, because `override` is not a statement about a base class: F# has no separate keyword for an interface member, so `interface I with override this.M() = …` implements `I.M`. Base-class form: `inherit Animal()` → `Dog.Speak -> Animal.Speak`. Interface form: `interface System.IDisposable with` → `Resource.Dispose -> IDisposable.Dispose`, carrying `metadata.relationshipType = "interface_member_implementation"` (the csharp lane's C923 shape, measured the same in java, kotlin, typescript, dart and python). The interface wins over the base list, and an OBJECT EXPRESSION is the same rule through a different node — `{ new IFoo with override x.M() }` has no `interface_implementation` node at all, the interface sits directly on the `object_expression`. **With neither an interface nor a base there is NO target and NOTHING is emitted**: pre-fix that case published `overrides Owner.M -> M`, a member overriding itself. Measured: 126 interface-implementation `override` members in 37 corpus files, 700 `override` members in types with no base at all across 179 files | 1.0 |
| uses | ✅ (**M60, 2026-10-02** — was ❌) | **An attribute application**: `[<Struct>]`, `[<Obsolete("gone")]`, `[<assembly: TypeProviderAssembly(…)>]`. This is the only F# construct a `uses` edge is FOR: it names a type, applies it as a marker, and never invokes it — so it is not a `calls` (no application), not an `implements` (no interface declaration), not an `extends` (no base), not an `instantiates` (no construction), and not a `references` (nothing here is a signature; the declared-type pass reads type WRITERS and an attribute's type is the type of an object construction). Source = the decorated declaration, read from the scope stack the walk already maintains. Measured: **1,666 edges in 157 of a 400-file corpus draw, all at confidence 1.0, all `metadata.relationshipType = "attribute_application"`**; 29,441 `attribute` nodes in 2,492 corpus files. Pinned by `validation/m14/fixtures/fsharp/import-and-use.fs`. **The old ❌ is not still true** — its stated reason (C#-family parity; member *reads* are covered at call level) never addressed attributes, which are not member reads. What is still not emitted: `base.X` member access, measured at **0 occurrences across all 6,619 corpus files** (see §M60 below) | 1.0 |
| references | ✅ | Two classes. (a) `open_statement`/`open_decl` → full module path; source = enclosing namespace/module; a module path is legitimately dotted and is **not** subject to the R10 leaf rule. (b) **R9 `declared_type`** — every type WRITTEN in a declaration: `class_field`, `parameter`, `return_type`, `record_field`, `union_case_payload`, `type_abbreviation`, `local_annotation`. Absent from this lane until FS-D4 (the m60 census measured `absent` with the control present). Two positions are **refused**: a type *parameter* and a *predefined* type (`int`, `string`) name no declaration, and a **type query** (`typeof<T>`, `unbox<T>`) is an expression carrying a type argument rather than a written type — `typeof<Foo>.Assembly.Location` depends on a runtime value. The grammar spells a query as a `typed_expression` whose `long_identifier_or_op` child reads `typeof` — a **sibling** of the type, not its parent, which cost two attempts at the discriminator that each measured nothing (FS-D11). A local's written type belongs to the enclosing **callable**, not to the class. **FS-P7-2: the target of a `declared_type` row is the IDENTITY this file published when the file declared the type (`Fixture.Types.Dep`), and the LEAF otherwise (`Stream` for a written `System.IO.Stream`)** — priced at +2,252 determinate edges against zero, and the identity is only ever taken from a symbol whose kind a written type can name, because the unfiltered draft built 2,467 determinate edges onto a module's, a member's or a namespace's identity (see PASS 7). Every row carries `metadata.targetResolution` (`in-file-declaration` / `external-type`) and `metadata.targetWritten` when a path was reduced. | 0.9 (opens) / 1.0 (declared_type) |
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

## M60 ONTOLOGY LANE, PASS 4 — the endpoint spelling, and the production filter that was eating the result (2026-10-07)

### The defect pass 3 left standing

FS-P3-1 (above) qualified the `overrides` SOURCE to `Owner.member` and measured 0.0% → 100.0%
binding at the store seam. Every OTHER label kept spelling its endpoints as BARE names, and
the store's own code says why that is not a cosmetic difference:

* `parallel-indexer.ts:3236-3250` registers each symbol in `nameToSymbol` under **both** its
  `name` and `${scope}.${name}`;
* an edge source is resolved with `nameToSymbol.get(sourceName)` — the exact-spelling map —
  **before** any of the leaf/`endsWith` fallbacks run (line 3920);
* the map is built first-wins (`if (!nameToSymbol.has(nm))`), so a bare owner name resolves to
  whichever same-named declaration the walk happened to emit first, while a qualified one is a
  direct hit.

So the lane was handing the store a spelling that cannot be determinate whenever two
declarations in the project share a leaf. This pass moves that spelling for the two labels
whose endpoints are the file's OWN symbols, and fixes one production filter that was deleting
the result.

### FS-P4-1 — `calls` / `instantiates` sources carry the published fqn

The walk now carries `callOwnerQualified` beside `callOwner` (the fqn `publish` already mints
into `metadata.fqn`, which `pool-worker.ts:1026` already turns into `qualified_name`) and the
four source sites use it. `callOwner` itself is untouched, because it is ALSO the semantic key
for constructor chaining and for `baseTypes`; only the edge's spelling moves.

**Strictly additive**, and that is a property of the store rather than a hope: when the
qualified spelling is absent, the leaf fallback returns exactly what the bare spelling gives
today (strategy 3's `SUBSTR(…, INSTR(…, '.') + 1)`). So the change can only move an edge from
arbitrary-attachment to determinate resolution.

### FS-P4-2 — `contains` names both endpoints by the identity it published

A containment edge names two symbols the file published — the parent by `ownerName`, the child
by `name` — and both were written bare while `publish` had already minted their fqns. The
composition now reads the parent back out of the symbol set (`fqnByName`) and writes both
endpoints as published identities. Where the parent's name is **ambiguous within the file** the
map holds `null` and the bare spelling is kept, because a wrong qualified spelling is worse than
an ambiguous bare one — the same discipline the store's line-based enclosure lookup applies.

### FS-P4-3 — the production noise filter was eating the edges it exists to protect (cross-lane)

`filterNoiseRelationships` (`pool-worker.ts`) tests the noise list on the target's **LEAF** and
tested the declaration exemption on the target **AS WRITTEN**. For a bare endpoint those are the
same string; for a qualified one they are not, so the exemption silently stopped applying.

Measured on one file, both paths, same revision — `FsCheck/src/FsCheck/StateMachine.fs`:

```
engine path    115 contains
production     114 contains      the missing one is
                                contains FsCheck.Experimental.StateMachine -> StateMachine.tearDown@209
```

the only difference between the two paths on that file. Scoped over the 3,000-file A/B draw:
edges whose target leaf is in `NOISE_TARGETS` and whose name the file DECLARES — **12 of 12
exempted before, 0 of 11 after**. `setUp`/`tearDown`/`beforeEach`/`afterEach` are in that list
universally, so every `contains` into a test-lifecycle member was being deleted as framework
noise. The fix tests both spellings (`declaredNames.has(target) || declaredNames.has(leaf)`),
which keeps the block's power — a name the file does not declare is still dropped — and restores
the exemption for **every lane that spells an endpoint qualified**, not just this one.

### The A/B — 3,000 files, identical draw, both arms scored against the full-corpus pool

The draw is the first 3,000 files of the deterministic corpus walk; both arms went through the
production `parseFile`, and both were scored with the store's own strategy 1/2/3 model.

| label | edges A→B | source determinate | target determinate |
|---|---|---|---|
| `calls` | 210,532 → 210,532 | 60.2% → **86.0%** (+25.9p) | 19.1% → 19.1% |
| `contains` | 58,298 → 58,298 | 42.4% → **64.8%** (+22.4p) | 34.2% → **70.3%** (+36.2p) |
| `instantiates` | 1,508 → 1,508 | 49.0% → **87.0%** (+38.0p) | 37.3% → 37.3% |
| `references` / `imports` / `uses` / `extends` / `implements` / `overrides` | unchanged | unchanged | unchanged |
| **TOTAL** | 356,783 → 356,783 | **52.5% → 71.6%** (+19.1p) | **22.4% → 28.3%** (+5.9p) |

**+68,045 source-determinate edges and +21,090 target-determinate**, on this draw. The
full-population static model (`.tmp-probe/fs-spelling-effect.py`, which reads the store's SQL
off the 11,799-file row set) predicts +214,367 source-determinate edges
(612,083 → 826,450, 52.7% → 71.1%) — the same effect at corpus scale, and the two agree.

### Neutrality, proved rather than asserted

The A/B also settles what the change cannot do. Leaf-normalized edge multisets
(`type`, `sourceLeaf`, `targetLeaf`) over the same 3,000 files:

```
arm A 356,783   arm B 356,783   keys only in A: 0   keys only in B: 0
```

No leaf anywhere moved. That is the rigorous version of "this is a spelling change": the F5
differential's whole match is `label + normTarget(target)` with `normTarget` = the LAST segment
(`differential.ts:1019-1043`) and it never compares sources, so no leaf-based matcher in the
product — differential included — can see a different graph.

### What this pass did NOT do, and the reason for each

* **`calls`/`uses`/`references`/`imports`/`extends`/`implements` TARGETS are still bare leaves** —
  *(SUPERSEDED by passes 5 and 6 below: this is the state at pass 4's HEAD, and the target side is
  exactly what the next two passes moved — `calls` target-determinacy 19.1% → 29.1% overall on the
  same draw, `contains` 34.2% → 70.3%. The paragraph is kept because its measurement — the witness
  count — is what justified the Phase-2 joiner, and because a pass's limits should stay readable at
  the HEAD they were true at.)* —
  1,100,719 of 1,162,163 endpoints on the full corpus. They name declarations the file does not
  own (callees, opened modules, written types), so spelling them qualified is a JOIN problem,
  not a spelling problem: it needs the open-aware cross-project symbol pool measured in this
  pass's own witness count (11,809 corpus files scanned; **94.1% of external callee sites have
  an in-corpus declaration**, including `fsharp/src/FSharp.Core/*.fs`, `expecto` and `Deedle`).
  That is Phase 2 and it is not claimed here.
* **Unattached endpoints rose 33,002 → 34,471 (+1,469)**, and the population is named: they are
  3+ segment fqn targets whose spelling is not unique in the pool (`contains … -> new
  System.IDisposable.Dispose`, 23 of them; `FsAutoComplete.LspHelpers.FcsPos`, 6; …), where the
  store's strategy 3 takes everything after the **FIRST** dot — `IDisposable.Dispose` — and no
  symbol carries that name. In the baseline arm those same edges were classified `ambiguous`,
  i.e. strategy 3 attached them to an arbitrary same-named symbol. So this is **-22,559
  arbitrary attachments** traded for +1,469 honest unattachments, which is the direction the
  programme wants, and the store-side fix (strategy 3 should use the LAST segment, matching what
  strategy 2 means by a name) is a measured recommendation for the indexer's owner, not a change
  this lane made.
* **The fixture `forbidRelationships` rows keep the OLD (bare) spelling**, and that is deliberate
  rather than stale: a forbid row exists to catch a REGRESSION, so it must be spelled the way the
  reverted code would spell the edge — and the lane's mutants revert by transforming RESULTS,
  which reproduces the pre-fix bare spelling exactly (`fsharp/self-containing-edge` emits
  `source: s.ownerName, target: s.name`). Two drafts of the expectation updater guessed
  otherwise and both were wrong (below). The limitation this leaves is stated: a FUTURE
  regression that emits a self-containment in the NEW spelling would not trip those exact-string
  rows. The spelling-independent guard is a leaf-equality invariant in the fixture runner
  (`no contains edge whose source leaf equals its target leaf`), which is recorded here as the
  follow-up rather than implemented, because it belongs to the shared runner and affects all 46
  lanes.
* **The F5 differential's draw ROTATES per sweep state**, so no MISSING/unexplained delta is
  claimed. Three runs inside this pass read 2,410 / 2,878 / 1,863 analyzer edges and 58 / 65 / 75
  unexplained rows, all on DIFFERENT 60-file samples; at this HEAD it is 60 files, tree-truth
  4,350, covered 99.8%, MISSING 7, unexplained 75 (4%), unexplained-by-label `calls=75`. The
  neutrality proof above is what settles the question the rotating draw cannot.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | **11 / 11 PASS** (62 endpoint values re-spelled across 8 expectation files, mechanically from the analyzer's own output) |
| `mutate-analyzer.ts --lang fsharp` | **24 / 24 CAUGHT** (two new: `edge-source-spelled-bare`, `containment-endpoints-spelled-bare`) |
| `tsc --noEmit` | clean |
| corpus A/B | table above, plus the neutrality proof |

### Three things this pass got wrong, recorded because instruments caught them and not reading

1. The expectation updater's **first** draft found each array with
   `text.indexOf("\"expectRelationships\"")` — which matches the array's NAME inside the
   fixture's prose `rationale` — then scanned forward into whichever array it reached first. Four
   `forbidRelationships` rows were read as expect rows that way and re-spelled to the analyzer's
   spelling, **inverting** them: a forbid that exists to catch a regression was rewritten into the
   exact row the regression would emit, so it fired on correct output.
2. The **second** draft anchored the array correctly and still ran the expect-row MATCH for
   forbid rows. `fsharp/qualified-name-seam`'s row forbidding the bare-source `overrides Speak`
   found exactly one edge (`Dog.Speak -> Animal.Speak`, the correct emission) and adopted it —
   the same inversion by a different route. The lesson is in the code now: a forbid row is never
   re-spelled from a match, and the two rows that COULD be settled were settled by simulating the
   regression (remove the rule, observe the emission, restore the rule).
3. `ta = tb = collections.Counter()` — a chained assignment to ONE object — made the first A/B
   **totals** print +0.0p while every per-label row moved. It was caught only because the
   per-label numbers summed to exactly twice the total, which is the arithmetic signature of the
   aliasing. The per-label table was right; the headline was not, and a headline is what gets
   quoted.

## M60 ONTOLOGY LANE, PASS 5 — the target side, and a reason on every residual (2026-10-07)

### The defect pass 4 left standing

Pass 4 moved edge SOURCES to the identity the file published and left the TARGET side exactly
where it was. That is the side a consumer resolves against, and it was spelled as a bare leaf:
the qualifier the source code WROTE was read and discarded at the emission site, so a call to
`Seq.map` was published as `map` — a name 349 symbols in the corpus answer to. Six labels whose
SOURCES are scopes the file published (`references`, `imports`, `uses`, the object-expression
`implements` and `contains`) were still bare for the same reason pass 4 fixed `calls`.

### FS-P5-1 — every scope-sourced edge names its scope the way the file published it

`publish` now fills `fqnOfName` (name → the fqn it minted) beside `publishedNames`, first-wins,
which mirrors the store's own construction at `parallel-indexer.ts:3238`. `qualifyScope(n)` =
`fqnOfName.get(n) ?? n` is applied to the six labels above, and the lookup is first-wins for the
same reason the store is: two same-named declarations in one file must resolve the same way in
both places. A name with no entry returns itself, so the change is additive in the same sense
FS-P4-1 is.

The first-wins choice is worth stating as a choice. The alternative — "qualify only when the name
is unambiguous IN THE FILE" — makes the spelling depend on a property of the whole file at a
point in the walk where only a prefix has been seen. Determinism beats a sharper rule that cannot
be evaluated where it is needed, and the store applies the same first-wins rule to the same name.

### FS-P5-2/3/4 — the target: exact when the file can PROVE it, and a reason when it cannot

Two halves, and the split between them is the point.

1. When the file can prove the identity, the target IS that identity. A name the file published
   resolves through `fqnOfName`, whose spelling is what the store registers as `qualified_name`
   (`pool-worker.ts:1055` reads `metadata.fqn`, minted in `publish`). `this.M` is provable for the
   same reason — the enclosing type is a symbol this file published — and `base.M` is provable
   when the base type is.
2. When the file cannot prove it, the edge keeps its leaf AND carries `metadata.targetResolution`
   plus `metadata.targetQualifier` (the discarded qualifier). That is what makes the residual
   auditable instead of unexplained, and it is the input a resolution layer needs: `Seq.map`
   cannot be recovered from `map` by any amount of guessing downstream, which is why preserving
   the qualifier is the analyzer's half of the join rather than the joiner's.

The identity is `${IMMEDIATE OWNER NAME}.${NAME}` and not the parent's full path, because that is
the store's own definition rather than a simplification: `publish` mints `metadata.fqn` from
`ownerName`, which is the innermost scope segment, so a member of `Full.Name.Space.Shape` is
published as `Shape.Describe`. Verified on the corpus rather than assumed: in
`Bolero/tests/Client/Main.fs` the module symbol's own NAME is the dotted header
(`Bolero.Test.Client.Main`, one scope segment) while its enum `Page` is stored as
`Bolero.Test.Client.Main.Page` and `Page`'s case `EndPoint` as `Page.EndPoint`.

### The A/B at pass 5 — src 71.6% → 76.8%, tgt 28.3% → 31.3%

Same 3,000-file draw, both arms through production `parseFile`, both scored against the
full-corpus pool with the store's own strategy 1/2/3 model. Cumulative from the pre-pass-4
baseline: source-determinate 187,370 → 274,190 (+86,820), target-determinate 79,911 → 111,755
(+31,844), S3-arbitrary 243,870 → 207,625, unattached 33,002 → 37,549.

Two facts about the target side, measured rather than asserted (`.tmp-probe/fs-target-audit.py`,
which keys on the file's own published `qualifiedName` set — the exact string the store keys the
symbol under, so it is a proof and not a similarity):

```
dotted targets 117,215   determinate as written 69,082   as the bare leaf 37,606
  contains   58,298 dotted targets, ALL 58,298 provable in-file   <- what FS-P4-2 bought
  calls      35,081 dotted: own-qname 25,266  own-last-qualifier 163  leaf-only 524  foreign 9,128
```

and the 9,128 `foreign` `calls` targets are the honest ones — `BenchmarkDotNet.Attributes`,
`Fake.Core.TargetOperators`, `System.Text` — namespaces the corpus does not define at all.

### The residual, named: +4,547 unattached, and why that is the direction the programme wants

Every one of the newly unattached targets is a 3+-segment path, and the store's strategy 3 takes
everything after the **FIRST** dot:

```
calls        3 seg   0 -> 2,920        contains   3 seg    12 ->   924
calls        2 seg   0 ->   385        contains   4 seg    12 ->   322
calls        5 seg   0 ->    97        contains   5 seg     0 ->   235
```

For 2,687 of the 2,920 the leaf spelling would have been `ambiguous` — attached to an ARBITRARY
same-named symbol by strategy 3 — and for the rest (`imports`/`references` 3-segment, 317 each) it
would have been determinate by name uniqueness. So the trade is **−22,559 arbitrary attachments for
+4,547 honest unattachments**, and the store-side fix (strategy 3's tail should be the LAST
segment, which is what strategy 2 means by a name) is a measured recommendation for the indexer's
owner, not a change this lane made. Priced: under a last-segment strategy 3 the same arm's dotted
targets read determinate 70,034 instead of 69,082 and the "looser than the leaf" class falls from
4,900 to 3,948. The residual that does NOT go away under that fix is named too: 895 `contains`
target names are cases where strategy 1 matches TWO symbols while the LEAF would have been
determinate: this lane publishes a symbol whose NAME is a dotted module header
(`Bolero.Test.Client.Main`), and such a name collides in the store's key space with the qualified
name of a member of it (`Bolero.Test.Client.Main.Page`). Those 895 are a fact about the qname space
that no spelling on this side can fix — the same name is a legitimate qname of two different symbols.

### FS-P5 residual 2 — `calls` emitted 146 MORE edges, and it is the dedup key

`pushRel` dedups on `source|type|target|line`. Two same-line calls that the bare spelling merged
into ONE fact are two facts once the endpoints are spelled — which is the correct direction, and
the whole count is an increase (on the final arm: 168 files grew, 0 shrank, +440). Witnesses, both
from the same instrument:

```
Grace/src/Grace.CLI/Command/Repository.CLI.fs   leafkey (initHandler, Create)  6 -> 7
  arm A only ever wrote  initHandler -> Create
  arm B               Repository.initHandler -> Create | GraceError.Create
                                              | GraceReturnValue.Create | ExceptionResponse.Create
FSharpPlus/src/FSharpPlus/Control/Collection.fs  leafkey (Filter, Invoke)  1 -> 2
  arm B               Filter.Filter -> OfSeq.Invoke  and  -> ToSeq.Invoke
```

### Gates at pass 5

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | 11 / 11 PASS |
| `mutate-analyzer.ts` scoped | 24 / 24 CAUGHT |
| `tsc --noEmit` | clean |

## M60 ONTOLOGY LANE, PASS 6 — the qualifier the source wrote, priced before it was used (2026-10-07)

### FS-P6-1 — a call chain is not a path

F# writes a fluent call as ONE `dot_get` whose TEXT is the whole chain. The walk read that text as
a callee path, split it on `.`, and because the chain's first segment happened to be a name the
file published, the identity branch returned THE ENTIRE CHAIN as an edge target. Measured on the
draw: 514 `calls` targets are not names at all —
`ArgumentParser.Create<'Template'>().ToParseResults`, `parser.PrintUsage().Contains`,
`router.GetRoute(model).TrimStart`, `Existential.FromType(t).Accept`. A target carrying a parameter
list can never be a store identity, so every one of those edges was unresolvable BY CONSTRUCTION
while looking like a resolved name in the graph.

A path is now a path only if every segment is a name, and a chain's target is the last NAME in it,
with the chain text kept as `targetQualifier` and the reason `call-chain-receiver`.

### FS-P6-2 — `in-file-qualified` now means the path is an identity this file published

Pass 5 asked whether the path's FIRST SEGMENT was a name the file knew, which is a different
question from "is this path an identity I published". The two differ exactly where the defect is:
`Foo.member` where only `Foo` is local, and a chain whose head is local (FS-P6-1). The rule is now
a membership test against `publishedQnames`, the values `publish` mints, so the two halves of the
claim cannot drift.

### FS-P6-3 — the discarded qualifier, and the theorem that makes it safe

The store resolves `target_external` with three strategies, in order (`parallel-indexer.ts`
4282/4305/4357, read from the source rather than assumed):

| | strategy | determinate when |
|---|---|---|
| S1 | `target_external == qualified_name` | the identity is unique in the project |
| S2 | `target_external == name AND name unique` | requires NO dot |
| S3 | dotted → `name ==` everything after the **first** dot, `MIN(id)` | never: it is the arbitrary pick, made deterministic |

so for a TWO-segment target S3's tail IS the leaf and the candidate set is IDENTICAL to the bare
leaf's — while S1 becomes reachable. **`${qualifierLeaf}.${leaf}` is therefore provably never worse
than the leaf.** That is a statement about the store, not a hope about the corpus, and it is why
this is a spelling change rather than a guess.

*(PASS 11 CORRECTS THE SHAPE OF THIS ARGUMENT, and strengthens the conclusion while emptying the
price: the store has a stage BEFORE these three — insert time resolves the target by its **leaf** —
so for a two-segment respelling the two arms are identical by construction, exactly rather than
"never worse". The `+11,709 / −1,810` priced below is a proxy price for an S1 path a dotted target
almost never reaches. See PASS 11 for the pipeline and the measurement.)*

PRICED BEFORE IT WAS IMPLEMENTED (`.tmp-probe/fs-p6-price.py`, on the pass-5 arm, which carries the
qualifier the old code discarded, so the counterfactual is exact rather than modelled):

| class | edges with a qualifier | → determinate | → non-determinate |
|---|---|---|---|
| `calls` / `external-type-or-module` | 68,453 | **+11,511** | −1,781 |
| `calls` / `opened-module` | 1,260 | **+198** | −29 |
| `calls` / `receiver-value` (lowercase) | 21,993 | +109 | **−510** |
| `instantiates` (both classes) | 147 | 0 | −11 |
| **the two module-like classes** | 69,713 | **+11,709** | −1,810 |

EVERY one of the 11,709 is a `q_cnt == 1` hit — an identity exactly one symbol in the corpus holds
(`build` → `StringExpr.build`, `fold` → `Array.fold`, `exec` → `DotNet.exec`, `compare` →
`Unchecked.compare`, `find` → `Array.find`). The 1,810 the other way are NOT a loss and the reason
matters: they are cases where the BARE name coincides with some symbol's `qualified_name` (a
module-less script binding literally named `choose`) while `${last}.${leaf}` names a real identity
held by TWO symbols — `seq.fs` and `seq.fsi` both declare `Seq.choose`, which is what a `.fsi` file
IS — and the store attaches those through S1 to the identity the source wrote.

The lowercase class is the negative half and it is measured, not stylistic: a lowercase qualifier is
a VALUE, no symbol is ever stored as `value.member`, and applying the same respelling there loses 4.7
edges for every one it gains. Those keep the leaf and their `targetQualifier`.

### FS-P6-4 — the position: a callee and a written type are stored differently

A member is stored as `${ownerName}.${name}` where `ownerName` is the innermost scope segment, so a
CALLEE keeps the LAST TWO segments (`Fabulous.Imaging.Image.Map` → `Image.Map`,
`Microsoft.FSharp.Collections.Seq.map` → `Seq.map`). A TYPE is stored with its whole namespace as
ONE owner (`Bolero.Test.Client.Main.Page`), so a written type keeps the FULL path. `instantiates`
asks for the type position even though it is emitted from the same expression shape as `calls`:
`new X()` names a TYPE, and the price table agrees (0 bought, 11 lost).

The FULL written path was also priced against the two-segment form and lost: +10,599 / −2,781
against +11,511 / −1,781, because a 3+-segment target whose tail is not its leaf falls through S3 to
NOTHING where the two-segment form's tail IS the leaf.

### The A/B at pass 6 — the canonical table, 3,000 files, both arms on the store's own model

| label | edges A → B | source determinate | target determinate |
|---|---|---|---|
| `calls` | 210,532 → **210,972** | 60.2% → **86.0%** (+26.0p) | 19.1% → **29.1%** (+10.0p) |
| `contains` | 58,298 → 58,298 | 42.4% → **64.8%** (+22.4p) | 34.2% → **70.3%** (+36.2p) |
| `references` | 49,919 → 49,919 | 35.8% → **63.5%** (+27.7p) | 25.8% → 25.8% |
| `imports` | 15,339 → 15,339 | 26.3% → **30.4%** (+4.1p) | 17.0% → 17.0% |
| `uses` | 18,157 → 18,157 | 64.5% → **85.0%** (+20.4p) | 14.0% → **14.7%** (+0.7p) |
| `instantiates` | 1,508 → 1,527 | 49.0% → **87.1%** (+39.2p) | 37.3% → **40.5%** (+3.7p) |
| `extends` | 1,187 → 1,187 | 49.7% → **78.3%** (+28.6p) | 39.2% → 39.2% |
| `implements` | 891 → 891 | 51.2% → **72.7%** (+21.5p) | 49.9% → 49.9% |
| `overrides` | 952 → 952 | 56.9% → 56.9% | 30.0% → 30.0% |
| **TOTAL** | 356,783 → **357,242** | **52.5% → 76.8%** (+24.4p) | **22.4% → 34.2%** (+11.9p) |

+87,042 source-determinate edges, +42,333 target-determinate, −43,794 arbitrary attachments, and
unattached **33,002 → 34,922** — i.e. FS-P6 bought back 2,627 of the 4,547 pass 5 spent.

The `calls` edge count moves (+440 over the whole two passes: +146 is pass 5's, +294 is pass 6's)
and the mechanism is the one pass 5 named: `pushRel` dedups on `source|type|target|line`, and two
same-line calls the bare spelling merged into one fact are two facts once the endpoints are
spelled. Every file-level change on the draw is an INCREASE (168 files grew, 0 shrank).

### The target residual, by class, with the reason each one carries

This is the table that answers "what is left, and why" — every `calls` target on the draw, sorted by
population, from `.tmp-probe/fs-p6-price.py` on the final arm:

| class | edges | determinate | what it means |
|---|---|---|---|
| `bare-external` | 65,299 | 8,707 | written unqualified, declared nowhere in this file. No spelling can fix it: the name is not an identity and the source wrote no qualifier. |
| `external-type-or-module` | 65,152 | **21,651** | written qualified, kept as written. The corpus has no such declaration in 43,501 cases (BCL / not in the draw). |
| `in-file-declaration` | 21,461 | **18,901** | the bare name of a binding this file published, spelled exactly. 88% determinate — the one class where an unqualified call is still an identity. |
| `receiver-value` | 18,035 | 1,925 | a VALUE's member (`parser.PrintUsage`). Unknowable without type inference; the receiver is preserved as `targetQualifier`. |
| `local-binding` | 17,761 | 3,874 | a `let` in a BODY, which this lane does not publish, so no symbol exists to attach to. |
| `module-member` | 8,662 | 2,180 | 3+ segments with a module-like segment before the leaf, respelled to the store's shape. |
| `call-chain-receiver` | 8,357 | 1,106 | a chain's last NAME, on an unknown receiver. |
| `in-file-qualified` | 3,269 | **2,236** | the path as written IS an identity this file published. |
| `self-member` | 2,738 | 664 | `${enclosingType}.${M}` — provable because the type is published here. |
| others (`opened-module` 167, `base-member-external` 69, `base-member` 2) | 238 | 59 | each with its own reason. |
| **`not-a-name`** | **0** | — | the class exists for a target no store can hold, and after the operator arm below it is EMPTY. |

### Two things this pass got wrong, and how each was caught

1. **The class census caught a rule bug within an hour of the rule shipping.** `not-a-name` held 393
   edges whose targets were `(=)`, `(+)`, `(-)`: F# names an operator FUNCTION by writing it in
   parentheses, its grammar hands exactly that to this branch (`long_identifier_or_op`), and the
   name test did not accept it. The class that exists for "a target no store can hold" was holding
   393 real names. Fixed by adding an operator arm to the name test — `(ctr CancellationToken.None)`
   still fails it on purpose, because that is an APPLICATION used as a receiver and not a name —
   and `not-a-name` measures 0. A census of the classes is what found it; no fixture could, because
   no fixture had ever written `(+) f x`.
2. **A partial read of a running artifact printed a smaller total than the sum of its own rows.**
   The first look at the final arm read 2,990 of 3,000 rows and reported 355,765 edges against
   per-label rows summing to 357,242 — a 1,477 gap that looks exactly like a rule deleting edges.
   It was the instrument: `open()` on a file another process is still appending to. The lesson is
   the same one this lane already paid for with `M14.0.F4.json` — a measurement taken while the
   producer is still writing is not a measurement — and the check that catches it is arithmetic:
   per-label rows must sum to the total.

### What this pass did NOT do, and the reason for each

* **`references` (25.8%) and `imports` (17.0%) targets did not move.** Their non-determinate mass is
  38,968 bare and 10,951 dotted TYPE/namespace names, most of which are BCL or framework namespaces
  the draw does not contain (`System`, `System.IO`, `Microsoft.FSharp.Core`). Respelling those is the
  cross-file join, not a spelling rule: the analyzer cannot see another file's declarations, and the
  one position where the store's shape differs (a type carries its whole namespace) is exactly the
  position where inventing a qualifier would be a fabrication.
* **`overrides` targets did not move** (30.0% before and after, 624 arbitrary, 42 unattached). They
  are already spelled `${base}.${member}` by FS-P3-1, and the remaining non-determinacy is the base
  class being external — a fact about the corpus, not about the spelling.
* **`exports` remains RULED** (pass 1): the analysis is unchanged and this pass did not revisit it.
* **The `new IFoo` object-expression symbols are left alone on purpose.** 1,901 `contains` targets and
  ~6,700 `calls` sources carry a `new `-prefixed name (`new IFunc.Invoke`). It is not a spelling
  defect: the file PUBLISHES the synthetic class symbol under that name, so the qname is internally
  consistent and resolvable, and the name is pinned by two fixtures (`override-target`,
  `name-surface`) which is where the convention's rationale lives.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | **12 / 12 PASS** — one new fixture, `fsharp/call-target-spelling`, whose 11 expect rows pin one `targetResolution` class each and whose 4 forbid rows pin the revert shapes |
| `mutate-analyzer.ts` (`BB_MUTANT_ONLY="fsharp/"`, dev-scoped: prints, writes no canonical artifact) | **28 / 28 CAUGHT**, 0 survived — four new: `qualified-callee-reduced-to-leaf`, `call-chain-spelled-as-a-path`, `target-resolution-reason-dropped`, `derived-endpoint-spelled-bare` |
| `tsc --noEmit` | clean |
| corpus A/B | the canonical table above |

Why the new fixture exists at all: the audit that produced `.tmp-probe/fs-target-audit.py` grepped
the lane's 11 expectation files for `targetResolution` and matched **zero rows**. Every reason this
pass emits — the entire justification for "determinate or explained" — could have been deleted in a
one-line edit with the whole suite staying green. That is the gap `fsharp/call-target-spelling`
closes, and the four new mutants are each read off the result's own metadata so they cannot go
vacuous when a fixture is renamed.

## M60 ONTOLOGY LANE, PASS 7 — every label's residual has a name, and a written type is spelled as an identity (2026-10-08)

### FS-P7-1 — the six labels whose residual had no reason at all

Pass 6 gave `calls`, `uses` and `instantiates` a `targetResolution` class and the class census
turned 234,998 loose target edges into a table. The other six labels kept theirs unexplained, and
that is the one thing this lane's standard forbids — not a smaller number, but a number with no
reason recorded next to it:

| label | loose targets, pass 6 | classes, pass 6 |
|---|---:|---|
| `contains` | 17,297 | none |
| `references` | 37,064 | none |
| `imports` | 12,730 | none |
| `extends` | 722 | none |
| `implements` | 446 | none |
| `overrides` | 666 | none |

Every one of those six now carries a class, decided from the analyzer's own result:

| label | reason class | edges | determinate | what the class is |
|---|---|---:|---:|---|
| `contains` | `published-identity` | 58,298 | 41,001 (70.3%) | the child IS a symbol this file minted |
| `contains` (source) | `in-file-declaration` | 40,632 | 31,306 (77.0%) | the parent's identity is known |
| `contains` (source) | `ownerless-unit` | 12,526 | 5,954 (47.5%) | the parent is a top-level unit, so its name IS its identity |
| `contains` (source) | `ambiguous-owner-name` | 5,140 | 511 (9.9%) | two parents, one name, two identities |
| `references` | `external-type` | 28,026 | 7,637 (27.2%) | a type name declared nowhere in this file |
| `references` | `external-namespace` | 14,537 | 2,582 (17.8%) | an `open` of a path this file does not declare |
| `references` | `in-file-declaration` | 7,356 | 4,888 (66.4%) | a type this file declared, spelled as its identity |
| `imports` | `external-namespace` | 14,537 | 2,582 (17.8%) | the same `open`, under the label the dependency pass reads |
| `imports` | `resource-path` | 521 | 4 (0.8%) | a `#r`/`#load`/`#I` literal |
| `imports` | `in-file-declaration` | 280 | 23 (8.2%) | an `open` of a path this file published |
| `imports` | `module-alias-path` | 1 | 0 | `module IO = System.IO` |
| `extends` | `external-type` | 1,051 | 385 (36.6%) | the base is not declared here |
| `extends` | `in-file-declaration` | 136 | 80 (58.8%) | the base IS a type this file declared |
| `implements` | `external-type` | 672 | 298 (44.3%) | |
| `implements` | `in-file-declaration` | 219 | 147 (67.1%) | |
| `overrides` | `base-member-external` | 542 | 41 (7.6%) | an inherited member of a base declared elsewhere |
| `overrides` | `interface-member-external` | 224 | 158 (70.5%) | an interface member, interface not declared here |
| `overrides` | `base-member` | 114 | 22 (19.3%) | the base IS this file's |
| `overrides` | `interface-member` | 72 | 65 (90.3%) | the interface IS this file's |

**`contains`'s residual is a CORPUS fact and it is now PROVED, not described.** 58,298 targets,
41,001 with exactly one holder in the pool, **17,297 with two or more, and 0 absent from it** —
so every loose containment target is an identity the corpus itself declares more than once.
Nothing about the spelling can move those, and no other class exists.

**The CAUSE of that collision was asserted in this paragraph's first draft, and the assertion was
WRONG.** It read "which is what a `.fs`/`.fsi` pair IS" — a plausible sentence with nothing behind
it. Pass 8 measured it (`.tmp-probe/logs/fs-p8-contains.txt`, arm `rows-pass12-meta.ndjson`, the
`.fs`-only key space so a signature file cannot be the explanation): of the 11,739 ambiguous
containment edges, **7,456 are two or more `.fs` files of one checkout declaring the same
qualified name** (Fabulous' samples alone declare `Program.main` in 92 separate files, and
`App.view`, `Msg.Increment`, `Model.Count`, `AppDelegate.CreateMauiApp` recur the same way);
**3,798 are ONE file declaring the name more than once** — F# member OVERLOADING, verified on the
largest witness with a line-numbered dump (`Bolero/src/Bolero.Html/Builders.fs`: 63 `Yield`
overloads of `ConcatBuilder`, each at a distinct line, **0** symbols sharing a line — so it is the
language, not duplicate publishing); and only **485 are a `.fs`/`.fsi` pair**. The number that
mattered (17,297 with two or more holders) was right and the sentence explaining it was 4% right,
which is exactly the failure mode this record exists to catch.

### The marker design, and the two bugs it caught in itself

The two halves of the reason question are answered at DIFFERENT TIMES: the KIND of name is known
when the edge is emitted, whether THIS FILE declares it is not — a type declared further down the
file is still this file's declaration, and a mid-walk membership test would call it external. So
the walk records a marker (`unresolved-type-name`, `unresolved-namespace`, `unresolved-base-name`,
`unresolved-interface-name`) and one final pass rewrites it from the COMPLETE published set. A
marker surviving to a consumer would be a defect by definition, and one of this pass's mutants
ships exactly that.

Two defects were found by probing rather than by any gate, and both are recorded because neither
would have failed anything:

1. **The finalizer's guard listed two markers of four.** The other two fell through it and the
   fixture probe printed `res=unresolved-base-name` on every `overrides` row in `override-target`
   within a minute of the code existing. A gate could not have caught it: nothing pinned these
   classes yet.
2. **The source class was a LIE THAT LOOKED LIKE ONE.** `publish` mints `metadata.fqn` only for an
   OWNED symbol, so a top-level module has no fqn, `fqnByName` held null for it, and
   `sourceResolution` was `ambiguous-owner-name` on every module-scoped containment edge — a claim
   that two declarations share the name, which is false. On the draw that class would have
   swallowed the 30% of `contains` that is ordinary module scoping. It is three classes now:
   `in-file-declaration`, `ownerless-unit` (a unit with no owner IS its own name), and
   `ambiguous-owner-name` for the real case, pinned by `First.Same`/`Second.Same`.

### A grammar observation, found by appending a line

The `declared-type-graph` fixture pinned `groupFirst`/`groupSecond` as `kind: variable` and passed
that way for the lane's entire life. Appending a `type` declaration after the mutual group flipped
them to `function` — and by this lane's own rule (`let rec f (a) = …` has an argument list, so it
is a Function) the second answer is the correct one. Both parses report **0 errors**; the EOF form
has 25 symbols, the form with a declaration after it 28, and the first clause's
`function_declaration_left` exists only in the second. The row is re-pinned to `function` with the
finding written into it, because an editor who deletes the appended block sees it flip back.

### FS-P7-2 — a type THIS FILE declares is spelled as its identity, not as its leaf

The declared-type arm published the bare leaf (`Dep`) even when the file was the one that declared
`Dep`, while `calls`, `instantiates` and `uses` have spelled a name this file published as its
identity since FS-P5 — the same file, two rules for one question. The leaf is not wrong so much as
ambiguous: the store resolves it through strategy 2 only while the NAME is unique in the corpus.

**The first price was wrong in two ways, and both were defects of the instrument.** It read
+4,205 / −110 on 9,555 rows (`.tmp-probe/fs-p7-fqn.py`, rows-pass7-meta.ndjson). The population
POOLED the `open` rows, which this rule never touches — a `references` row is an `open`, an
`open type` or a written type, and only the third is a declared type — and the candidate used the
identity of whatever symbol the file published FIRST under that name, ANY KIND.

That second defect was not academic. The unfiltered draft shipped to a 3,000-file arm measured
35.3% and built these edges on real code:

```
references  VirtualParquetSource.createFrame     -> ParquetColumnKind.DateTimeOffset   (the union's CASE,
references  ParquetColumnSource.createDateTime   -> ParquetColumnKind.DateTime           for a written TYPE)
references  Argu.UnionCaseArgInfo.UnionCaseArgInfo -> FieldParserInfo.Type
```

A DETERMINATE edge naming a declaration that is definitively NOT the type the source wrote is
worse than the ambiguous leaf it replaced, because the wrongness is asserted rather than left
type-hanging. The fix is a second map filled in the same funnel as `fqnOfName` (so the two cannot
drift) that only a `class`/`interface`/`enum`/`type`/`struct`/`delegate` may fill, and a matching
question on the reason side (`publishedTypeNames`, so "this name is mine" no longer answers yes for
a DU case).

**The shipped rule, on the population that runs it** (`.tmp-probe/fs-p7-price.py` keyed on the
arm's own `relationshipType`, rows-pass10-meta.ndjson):

| | rows | determinate |
|---|---:|---:|
| `references` / `declared_type` | 35,102 | 12,502 (35.6%) |
| of those, `in-file-declaration` | 7,076 | 4,865 (68.7%) |
| ... of those, respelled to the identity | 6,907 | 4,865 |
| of those, `external-type` (untouched) | 28,026 | 7,637 (27.2%) |

**+2,252 determinate edges and ZERO the other way**, `references` target-determinacy 25.8% → 30.3%,
and the whole draw 34.2% → 34.8%. The 7,076 − 6,907 = 169 rows that stay leaves are rows whose
name no TYPE-kind symbol carries.

**What the kind gate cost, counted against the unfiltered draft it replaced:** 1,536 determinate
edges (whole-draw target determinacy 35.3% → 34.8%). **What it bought**
(`.tmp-probe/fs-p7-pop.py <shipped arm> <pre-change arm>`, whose output is kept as
`logs/fs-p7-pop.txt`): of the 9,403 dotted in-file rows the unfiltered draft produced, 1,430 named
an identity held only by a MODULE, 816 only by a MEMBER (`FieldParserInfo.Type`,
`Existential.Type`, `ParquetColumnKind.DateTimeOffset`), 221 only by a NAMESPACE and 106 named an
identity present nowhere in the file at all. The audit that found them is also the acceptance test,
and it runs on the shipped arm: **6,907 of 6,907** dotted declared-type targets are held by a
type-kind symbol.

The dotted written path itself was priced and DECLINED: of the 1,155 `references` rows that carry
one, respelling to the path as written moves **+85 and −158** — a dotted target that misses
strategy 1 falls to strategy 3, whose tail is everything after the FIRST dot (`IO.Stream`, a name
no symbol has), while the leaf's own name is still reachable through strategy 2. The leaf stands
for the external half, and the row that pins that (`Dotted -> Stream`) sits one field away from
the row that pins the identity (`Dotted -> Fixture.Types.Dep`) in the same file.

### The A/B at pass 7 — the canonical table, 3,000 files, both arms on the store's own model

| label | edges A → B | source determinate | target determinate |
|---|---|---|---|
| `calls` | 210,532 → 210,972 | 60.2% → **86.0%** | 19.1% → **29.1%** |
| `contains` | 58,298 → 58,298 | 42.4% → **64.8%** | 34.2% → **70.3%** |
| `references` | 49,919 → 49,919 | 35.8% → **63.5%** | 25.8% → **30.3%** (+4.5p) |
| `imports` | 15,339 → 15,339 | 26.3% → **30.4%** | 17.0% → 17.0% |
| `uses` | 18,157 → 18,157 | 64.5% → **85.0%** | 14.0% → **14.7%** |
| `instantiates` | 1,508 → 1,527 | 49.0% → **87.1%** | 37.3% → **40.5%** |
| `extends` | 1,187 → 1,187 | 49.7% → **78.3%** | 39.2% → 39.2% |
| `implements` | 891 → 891 | 51.2% → **72.7%** | 49.9% → 49.9% |
| `overrides` | 952 → 952 | 56.9% → 56.9% | 30.0% → 30.0% |
| **TOTAL** | 356,783 → **357,242** | **52.5% → 76.8%** | **22.4% → 34.8%** (+12.5p) |

+87,042 source-determinate edges, +44,585 target-determinate, arbitrary attachments
243,870 → **196,513**, unattached 33,002 → 36,233. The 1,536-edge cost of the kind gate is inside
those totals: the unfiltered draft read 35.3%.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | **12 / 12 PASS** — 64 rows now pin a reason class (`meta.targetResolution` / `meta.sourceResolution` / `meta.targetWritten`) across SEVEN of the twelve fixtures: `override-target` 18, `call-target-spelling` 12, `declared-type-graph` 12, `import-and-use` 12, `call-ownership` 4, `type-extension-and-containment` 4, `name-surface` 2. Every class this pass introduced now has at least one row that fails if the class is renamed, dropped or INVERTED |
| `mutate-analyzer.ts` (`BB_MUTANT_ONLY="fsharp/"`) | **32 / 32 CAUGHT**, 0 survived — four new: `in-file-type-spelled-as-its-leaf`, `unresolved-marker-shipped`, `containment-source-reason-dropped`, `override-reason-ignores-whether-the-base-is-local` |
| `tsc --noEmit` | clean |
| corpus A/B | the canonical table above — re-walked AFTER the last source edit (`.tmp-probe/fs-verdict-state/rows-pass11-meta.ndjson`, `BB_META_OUT=… npx tsx .tmp-probe/fs-ab-meta.mts walk --cap 3000`) and **byte-identical** (`cmp`) to the arm the table was computed from (`rows-pass10-meta.ndjson`). The table therefore belongs to the code on disk, not to an earlier draft of it — which is the failure mode this lane has been bitten by. **SCOPED AT PASS 11: that sentence was true at THIS pass's HEAD and is not true of the shipped arm.** The mutual-type-group fix moved the source again, so the arm the shipped code produces is `rows-pass15-meta.ndjson`: 3,000 files, **357,591** edges against the table's 357,242 — `contains` +351, `calls` −8, `instantiates` +4, `implements` +2 — and the 351 are the types the group fix stopped swallowing, every one of them resolved `published-identity` or `in-file-declaration`. Every table in passes 6-8 is therefore the pass-6/7 HEAD's numbers, with the shipped arm's totals named here so no reader has to guess which code a number belongs to. PASS 11 re-scores the shipped arm against the pre-pass-4 baseline. |
| F5, lane-scoped (`bun script/m14/differential.ts --lang fsharp --emit`) | 60 files, truth 4,984, covered 4,974 (99.8%), analyzer edges 2,913, residual **79 rows, enumerated rather than totalled**: 69 unexplained = `calls` 68 (the oracle does not derive the pipeline arm and the one-character arm) + `instantiates` 1; 10 MISSING = `overrides` 9 (the oracle still derives the pre-fix self-target spelling) + the same `instantiates` row. **Not one of the 69 sits on a label this pass respelled** — that is what leaf-normalized matching means, and here it is checked rather than assumed. The single `instantiates` row (`StructuralUtilities.context -> Threading`, `src/Compiler/Utilities/TypeHashing.fs`) is new to this lane's record and is stated rather than buried: a target read as a type where the oracle reads a namespace — FS-P6-4's position rule, not this pass's. The run wrote `validation/m14/results/M14.0.F5.fsharp.json`, which records its OWN dirt (`laneDirt: src/ast/real-fsharp-analyzer.ts`, `sharedDirt: script/m14/differential.ts`) instead of stamping a clean commit over uncommitted code. |

### What this pass did NOT do, and the price of each

* **`references` opens (14,817 rows, 17.6%) and `imports` (14,817 external-namespace) did not
  move.** Their mass is BCL and framework namespaces the draw does not declare (`System`,
  `System.IO`, `Microsoft.FSharp.Core`). Respelling those is the cross-file join, not a spelling
  rule; the analyzer cannot see another file's declarations.
* **The same in-file identity lever on `extends`/`implements` was measured and DECLINED**: +59
  determinate edges (extends +29/−0, implements +30/−0) against diverging from R10, the family
  rule applied to ten lanes that publishes a qualified type USE under the leaf. The number is here
  so a later pass can take it with its eyes open.
* **`overrides` did not move** (30.0% before and after). The remaining non-determinacy is the base
  or interface being external — a fact about the corpus, and all 952 edges now carry which one.

  The one spelling inside those edges that was still flagged as unwritten-down is now written down.
  The declaration form stores its base AS WRITTEN (`inherit System.IO.MemoryStream()` →
  `Buffer.Flush -> System.IO.MemoryStream.Flush`, three segments, strategy 3's tail
  `IO.MemoryStream.Flush`, unattached), and the tempting fix is the leaf the `base.` CALL arm uses.
  Priced on the shipped arm (`.tmp-probe/fs-p7-base.py`): 542 `base-member-external` rows, and
  **only 6 of them carry a dotted base** — `inherit Base()` with a bare name already spells the
  leaf — so respelling buys **+3 determinate / −0** while turning 3 unattached edges into ARBITRARY
  attachments (`none -> ambiguous`: the store picks MIN(id) among several symbols named `Invoke`).
  An arbitrary attachment is not a gain under this lane's accounting, so the as-written base stands,
  the number is in the source at the emission site, and no TODO was left behind.

  Two of the four `overrides` classes were the other half of that flag: `base-member-external` and
  `interface-member` had no fixture row at all, so the pair of questions the finalizer asks
  (`publishedTypeNames.has(base)`) could have been deleted — keeping the `-external` arm of each
  pair — and all 12 fixtures would still have passed. `override-target` now writes each pair one
  field apart (`Dog.Speak -> Animal.Speak` is `base-member`, `Buffer.Flush ->
  System.IO.MemoryStream.Flush` is `base-member-external`; `Tagged.Tag -> ITagged.Tag` is
  `interface-member`, `Resource.Dispose -> IDisposable.Dispose` is `interface-member-external`),
  and the mutant `override-reason-ignores-whether-the-base-is-local` is that deletion — 188 rows on
  the draw, caught by exactly the two fixtures that should catch it.
* **`exports` remains RULED** (pass 1), unchanged.
* **The `new IFoo` object-expression symbols are left alone on purpose**, as recorded in pass 6.

## M60 ONTOLOGY LANE, PASS 8 — the incoming side, asked for the first time (2026-10-08)

Every pass before this one asked how the analyzer SPELLS an endpoint. `incoming-gate.ts` asks a
different question — does every edge resolve to exactly ONE declaration in the file's own PROJECT,
with the exceptions that are legitimate and DECLARED as such — and the lane had never been put
to it:

```
npx tsx script/m14/incoming-gate.ts fsharp fs 400      # exit 1
```

| | edges | resolved | amb(decl) | unresolved | extOK | ext? | extFAIL |
|---|---:|---:|---:|---:|---:|---:|---:|
| `calls` | 26,485 | 5,277 | 346 | 20,862 | 0 | 0 | 0 |
| `uses` | 2,677 | 18 | 125 | 2,534 | 0 | 0 | 0 |
| `contains` | 6,249 | 5,885 | 363 | **1** | 0 | 0 | 0 |
| `imports` | 1,382 | 75 | 48 | 1,259 | 0 | 0 | 0 |
| `references` | 4,853 | 863 | 153 | 3,837 | 0 | 0 | 0 |
| `extends` / `implements` / `overrides` / `instantiates` | 470 | 90 | 11 | 369 | 0 | 0 | 0 |
| **TOTAL** | **42,116** | **12,208** | **1,046** | **28,862** | **0** | **0** | **0** |

**The finding is the three zeros on the right.** 28,862 edges name nothing the project publishes
and NOT ONE carries a declared external marker, so on this lane a genuinely-external target and a
broken edge are indistinguishable — which is the one thing this workstream's standard forbids. The
gate's own worklist says it in one line: *"A lane that marks nothing and reports a large unresolved
should ask whether those targets are external before it asks why they do not resolve."*

### The classes, in production's own scope

The gate prints a worklist of target STRINGS. A worklist is not an explanation, so the same
population was re-counted per reason class, with the key space built from the FULL corpus (11,799
files — no sample bias) and the scope set to the file's project, which is production's
(`.tmp-probe/fs-incoming.py`, arm `rows-pass12-meta.ndjson`):

| label | reason | edges | resolved | amb | unres | res% |
|---|---|---:|---:|---:|---:|---:|
| `calls` | `bare-external` | 65,299 | 11,851 | 16,370 | 37,078 | 18.1% |
| `calls` | `external-type-or-module` | 65,152 | 19,703 | 6,424 | 39,025 | 30.2% |
| `contains` | `published-identity` | 58,298 | 42,657 | 15,641 | **0** | 73.2% |
| `references` | `external-type` | 28,026 | 6,787 | 8,302 | 12,937 | 24.2% |
| `calls` | `in-file-declaration` | 21,461 | 19,394 | 2,067 | **0** | 90.4% |
| `calls` | `receiver-value` | 18,035 | 3,340 | 7,352 | 7,343 | 18.5% |
| `uses` | `bare-external` | 17,912 | 1,571 | 1,567 | 14,774 | 8.8% |
| `calls` | `local-binding` | 17,761 | 4,036 | 5,456 | 8,269 | 22.7% |
| `references` / `imports` | `external-namespace` | 14,537 each | 2,397 | 4,091 | 8,049 | 16.5% |
| `calls` | `module-member` | 8,662 | 1,898 | 189 | 6,575 | 21.9% |
| `calls` | `call-chain-receiver` | 8,357 | 1,202 | 4,231 | 2,924 | 14.4% |
| `references` | `in-file-declaration` | 7,356 | 4,937 | 2,419 | **0** | 67.1% |
| `calls` | `in-file-qualified` | 3,269 | 2,454 | 815 | **0** | 75.1% |
| **TOTAL** | | **357,242** | **126,812 (35.5%)** | 80,316 | 150,114 | |

The project scope resolves MORE than the pooled one (35.5% against 31.0%) and is the one
production uses. Two rows are already closed in the sense this record cares about: every class
whose target is an identity THIS FILE minted (`in-file-declaration`, `in-file-qualified`,
`published-identity`) has **zero** unresolved edges, and `contains` has zero as well — a
containment target that the file published is either unique in its project or collides with a
sibling declaration, and the collision is now a named corpus fact (see the pass-7 correction
above: 7,456 sibling-file collisions, 3,798 overloads, 485 signature pairs).

### Why each unresolved target is unresolved

`.tmp-probe/fs-p8-why.py` splits the non-resolving population by WHERE the name lives, which is
the difference between four different pieces of work:

220,255 edges on the draw do not resolve under production's scope, and every one of them now
carries a cause:

| | edges | what it is |
|---|---:|---|
| `OTHER` | **93,204** | declared in ANOTHER project of the corpus — production's scope is the project, so no spelling and no analyzer change can reach it |
| `AMBIG-in-.fs` | **65,215** | more than one declaration shares the name in this project's `.fs` files: 7,456-weights of sibling-project collisions (`Program.main` × 92) and 3,798 of F# overloading |
| `NOWHERE` | **56,910** | nothing in the 11,799-file corpus declares it: FSharp.Core, the BCL, a framework, or a typo |
| `SIG` | **3,689** | declared in this project's `.fsi`/`.fsx`, which the gate's `.fs` population cannot see (this is the only cause that is a fact about the INSTRUMENT's population rather than about the code) |
| `AMBIG-in-this-project (sig files)` | 1,237 | the same collision through the signature files |

and the `NOWHERE` mass splits into the two shapes that decide whether a claim can be VERIFIED at
all: **38,882 DOTTED** (an owner the gate can look up) and **18,028 BARE** (no owner —
`incoming-rule.ts`'s `targetOwner` returns null, so a claim on one reads `externalUnverified` and
buys an explanation while still blocking a pass).

### The external claim, priced three ways before a line of it was written

The marker is `metadata.isExternalTarget`, a key the gate already recognises, and its value is
exactly the lookup that follows it (owner = everything before the last dot; an owner holding `:`,
`/` or whitespace is unverifiable; an owner the PROJECT publishes REFUTES the claim and counts
against the lane). So it was priced as a rule, not as an intention
(`.tmp-probe/fs-p8-mark.py`, `fs-p8-rule.py`, `fs-p8-rule2.py`):

| rule | population | verified | REFUTED | verify-rate |
|---|---:|---:|---:|---:|
| any dotted target | 62,634 | 26,795 | 35,839 | 42.8% |
| owner with ≥2 segments | 7,140 | 6,318 | 822 | 88.5% |
| ... and a root this FILE does not declare | **6,893** | **6,409** | **484** | **93.0%** |

The first row is why a blanket marker is not shipped: `List.map`, `Seq.map`, `Array.map` are
two-segment targets and a project very often declares a `List` of its own — the top refuting owners
are `Seq(4,447)`, `List(4,035)`, `Expect(2,540)`, `System(2,118)`, `Array(1,943)`, `String(1,604)`,
which is to say FSharp.Core-shaped names a project redeclares. The third row is the shipped rule,
and the root test is the one thing the analyzer can check that the gate cannot: whether the path's
ROOT is a segment THIS FILE already declares — that is what separates `System.Runtime.InteropServices`
from `FSharp.Compiler.Syntax`, `Grace.CLI.Common` and `Fake.Core`, three of the file's OWN project's
namespaces (338 of the 822 refutations, 41%, removed for 170 verified edges). The 484 refuted claims
that remain are the cross-file case by construction: the declaration IS in the project and the
analyzer cannot see another file. They are not hidden — the gate's `extFAIL` column counts them.

The root test is checked on a file that writes both shapes, because a rule whose only witness is the
good case is the failure this record keeps repeating — `.tmp-probe/p8-roots.fs`:

```fsharp
namespace Acme.App.Core
open Acme.Shared.Validation      // owner `Acme.Shared`, root `Acme` IS this file's  -> NOT claimed
open System.Collections.Generic  // owner `System.Collections`, root `System` is not -> claimed
```

and the dump agrees row for row (`imports -> Acme.Shared.Validation` carries no claim,
`imports -> System.Collections.Generic` carries `isExternalTarget: true`).

The override classes carry the claim on a different rule because their class already asserts it:
`base-member-external` / `interface-member-external` mean the base is not a type this file declares,
and their owner is a base type's leaf (`Exception.ToString`, `MemoryStream.Flush`) — measured 454
verified against 60 refuted, so they are claimed on the class rather than on the segment count.
NOT claimed, deliberately: `bare-external`, `local-binding`, `receiver-value`, `call-chain-receiver`
and `self-member` (they name a VALUE or this file's own member, so "external" would be false), and
`resource-path` (`#r`/`#load`/`#I` literals — a path or a URI, whose owners carry `:` or `/`).

### What the claim did

| reading | edges | resolved | amb | unresolved | extOK | extFAIL |
|---|---:|---:|---:|---:|---:|---:|
| before (400-file stride) | 42,116 | 12,208 | 1,046 | 28,862 | 0 | 0 |
| after (same 400 files) | 42,116 | 12,208 | 1,046 | **28,151** | **705** | **6** |

711 edges moved out of `unresolved`: 705 into claims the project CONFIRMS and 6 into claims it
refutes (0.84%). The gate's own accounting prints the split — *"of those 705 verified: 705 by owner
lookup in the key space"* — and the 6 refutations are the cross-file shape above, visible in the
`extFAIL` column rather than buried.

### 604 files publish NOTHING, and the ruling behind it is right

Measured over the whole admitted corpus: **604 of 11,799 files (5.1%) yield zero symbols** — 402
`.fs`, 200 `.fsx`, 2 `.fsi`. They are the files whose ENTIRE tree is one parse-recovery region, which
is a deliberate behaviour (FS-D15/DS-D16: a recovery region is DISCLOSED and not MINED, because
mining it published `calls … -> abstract`, `-> member` and `-> Sealed` — language keywords called by
a real symbol). The paragraph that records the ruling quotes a probe-sized rate of 6/400 files
(1.5%); the corpus rate is 5.1%, and the difference is the number anyone deciding whether to fix the
grammar gaps needs. Mainstream sources are in the list — `fsharp/src/FSharp.Core/seqcore.fs`,
`FSharp.Data/src/FSharp.Data.Html.Core/HtmlNode.fs`,
`FSharp.Formatting/src/FSharp.Formatting.Markdown/MarkdownParser.fs` — every one of them reporting a
`parse recovery region` warning on its own root, so the fact is disclosed on the result, not hidden.
**What it costs the incoming side is measured and small: 123 of 150,114 unresolved edges (0.1%)**
(`.tmp-probe/logs/fs-p8-zerosymbol.txt` — the top-level declarations those files carry, matched
against the unresolved targets of the same project). It is a COVERAGE gap (their declarations are
absent from the graph) and not a cause of the residual, and those are different findings that a
count of "0 symbols" cannot tell apart.

### What this pass did NOT do, and the price of each

* **The 18,028 BARE unresolved targets stay unclaimed and cannot be claimed.** A bare name has no
owner, so the gate's lookup cannot confirm or deny it; marking one reads `externalUnverified`, which
blocks a pass anyway. `printfn`, `sprintf`, `unbox` and the rest of FSharp.Core are in this set.
* **The `OTHER` mass (declared in another project) is not an analyzer defect and not fixable by
  spelling**: production resolves within the project, the corpus has the declaration in a different
  checkout, and no spelling changes what the store can see.
* **F# has no project-index spec, so the gate cannot run `--index` for this lane** —
  `src/ast/project-index.ts` defines specs for solidity, python and dart, and the gate says in its own
  header that an `--index`-less run is NOT the population production parses. **That milestone was
  priced before it was built, and the price is negative** (`.tmp-probe/fs-p9-project.py`,
  `fs-p9-collapse.py`, `logs/fs-p9-project.txt`, `logs/fs-p9-collapse.txt`):

  * The first cut asked the obvious question — how many edges name a declaration the project has in
    ANOTHER file — and read **146,822 of 357,242 (41.1%)**. That number is NOT headroom, and saying so
    is the point of the second cut: most of those edges already RESOLVE (the store's per-project name
    lookup finds them) or are ambiguous for a reason an index cannot touch. Worked example, checked
    against the classes: `references`/`external-type`'s 28,026 edges are 15,089 whose target IS a
    project key (6,787 resolving + 8,302 ambiguous) and 12,937 whose target is declared in no file of
    the project at all — zero of the latter are reachable by any index.
  * The second cut asked the narrower question that decides it: of the unresolved targets whose LEAF
    is shared by 2+ project declarations, how many does F#'s own resolution order (`open A` makes
    `A.Foo` the meaning of a written `Foo`) reduce to EXACTLY ONE candidate? Across all classes:
    **1,298 edges**, out of 16,074 candidates-examined. And the witness for that collapse is a
    MIS-JOIN — `Seq.map` in `Deedle/src/Deedle.ExcelWriter/ExcelWriter.fs`, 7 declarations sharing
    the leaf, "survivor" `Frame.map` — because a rule that matches the file's own root segment
    against a candidate path cannot tell `Seq` (FSharp.Core) from a project module. Shipping that
    mechanism would have converted an honest unresolved edge into a determinate edge naming the wrong
    declaration, which this record calls worse than the ambiguity it replaced.
  * What the spec WOULD buy is real but small: the ~1,068 refuted claims become honest non-claims, and
    `extends`/`implements`/`overrides` get a `project-declaration` class instead of `external-type`
    (2,928 unresolved edges corpus-wide), plus the methodological point that the gate would finally
    measure production's population. It is a methodology win, not a numbers win — and the analyzer's
    member targets would still be owner-only, because `publish` mints `${ownerName}.${name}` and no
    spelling can distinguish two types that share an owner name.
  * **DECLINED for now, with the number recorded**: 1,298 candidate edges at a rule whose own best
    witness is wrong is not a milestone, it is a way to move determinacy upward and truthfulness
    downward at the same time.
* **`resource-path` (`#r`/`#load`/`#I`) cannot be verified by this rule** — its owners carry `:` or
  `/`, which `verifyExternalClaim` refuses for a reason that has nothing to do with the claim.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | **12 / 12 PASS** — 8 new rows in two fixtures: the claim on BOTH labels of one `open` (`import-and-use`'s `System.Collections.Generic`, 2 expects) and six forbids — the one-segment opens (`System`, `System.Math`) and the four shapes a blanket marker would grab (`Array.fold`, `Seq.map`, `FSharpPlus.map`, `StringBuilder`) |
| `mutate-analyzer.ts` (`BB_MUTANT_ONLY="fsharp/"`) | **34 / 34 CAUGHT**, 0 survived — two new: `external-claim-dropped` (the claim deleted) and `external-claim-blanket` (the claim applied to every dotted target, i.e. the ±42.8% rule), the second caught by TWO fixtures |
| `tsc --noEmit` | clean |
| `incoming-gate.ts fsharp fs 400` | before 0 claims / 28,862 unresolved → after 705 verified / 6 refuted / 28,151 unresolved |
| `incoming-gate.ts fsharp fs 0` | **the whole population: 10,138 of 10,138 `.fs` files, 26 repos, 0 parse failures, 0 degraded, 1,121,081 edges — 393,397 resolved (35.1%), 161,959 ambiguous, 548,600 unresolved, 16,057 claims VERIFIED and 1,068 REFUTED** (`logs/inc-fs-full-after.txt`) |

### The same rule at corpus scale

| label | edges | resolved | amb(decl) | unresolved | extOK | extFAIL |
|---|---:|---:|---:|---:|---:|---:|
| `calls` | 707,590 | 204,144 | 91,117 | 412,329 | 0 | 0 |
| `contains` | 173,560 | 145,756 | 27,795 | **9** | 0 | 0 |
| `references` | 130,228 | 31,593 | 25,695 | 65,408 | 7,251 | 281 |
| `uses` | 61,077 | 4,102 | 10,353 | 46,622 | 0 | 0 |
| `imports` | 35,356 | 4,412 | 5,191 | 18,221 | 7,251 | 281 |
| `instantiates` | 4,793 | 1,220 | 490 | 3,083 | 0 | 0 |
| `overrides` | 3,018 | 552 | 99 | 306 | 1,555 | 506 |
| `extends` | 2,883 | 798 | 814 | 1,271 | 0 | 0 |
| `implements` | 2,576 | 820 | 405 | 1,351 | 0 | 0 |
| **TOTAL** | **1,121,081** | **393,397 (35.1%)** | 161,959 | 548,600 | **16,057** | **1,068 (6.2%)** |

Two numbers here are worth more than the verdict, which is still FAIL and will stay FAIL while
FSharp.Core names are written bare:

* **`contains` has NINE unresolved edges in the whole corpus**, out of 173,560. Every containment
target the file minted is an identity production can find, and the 27,795 ambiguous ones are the
sibling-file and overload collisions whose CAUSE pass 8 measured (7,456 sibling-file, 3,798
overload, 485 signature pair — the pass-7 sentence that attributed them all to a `.fs`/`.fsi` pair
was 4% right and is corrected above). The FS-P7-1 reason work
is what made that visible — before it, this label carried 17,297 "loose" targets with no reason.
* **The claim's refutation rate is NOT uniform, and the difference is the finding.** The opens
  (one `open` emits a `references` row and an `imports` row, so each column's 7,251 claims cover the
  same population) refute 281 of 7,251 (3.7%); the override classes refute **506 of 2,061
  (24.5%)** against 1,555 verified. Both are the same shape — the declaration lives in ANOTHER file
  of the same project — but a base type is far more likely than a framework namespace to be declared
  beside the file that inherits it (`Animal`, `Component`, `Base` are common; `System.Runtime.InteropServices`
  is not). Keeping the branch is still right by the gate's own arithmetic: dropping it removes 506
  refutations and 1,555 verifications, i.e. it makes `bad` worse by 1,049. It is reported rather than
  tuned away, and it is the second measurement in this pass that points at the same next step —
  F# has no `project-index` spec, so the cross-file population cannot be resolved and can only be
  claimed or left unexplained.

## M60 ONTOLOGY LANE, PASS 11 — the store's own attachment rule, measured on a real index (2026-10-09)

Every endpoint table above scores a spelling with the same proxy: *does the written name occur
exactly once in the corpus symbol pool?* That proxy is a faithful reading of the strategy block in
`src/ast/parallel-indexer.ts` and an **incomplete reading of the store**: two stages decide real
edges and neither is in it — one BEFORE the strategies (insert time) and one AFTER (the linear
name-resolution plan). This pass measures the store instead of modelling it, then re-derives the
A/B under the rule that actually runs.

### The pipeline at HEAD, stage by stage (read from the source, then verified against a real index)

| # | stage | rule | decides |
|---|---|---|---|
| 0 | insert, `storeResults` (~4119) | `resolveTargetStmt.get(projectId, **targetLeaf**, fileId, fileLang)` — `WHERE s.name = targetLeaf ORDER BY COALESCE(is_declaration,0), (file_id = self) DESC, (language = self) DESC, id LIMIT 1`. `target_external` keeps the FULL written spelling (~4287) | every non-`contains` edge whose leaf names a symbol in the project |
| 1 | S1 | `target_external == qualified_name`, `MIN(id)` per qname | only rows stage 0 left NULL |
| 2 | S2 | `target_external == name AND name unique` | only rows 0–1 left NULL |
| 3 | S3 | dotted → `name == SUBSTR(target_external, INSTR(target_external,'.')+1)`, `MIN(id)` | only rows 0–2 left NULL |
| 4 | S4 | the `<module>:<item>` import form | only rows 0–3 left NULL |
| 5 | I13 linear plan (~4740) | every row whose `target_external` has **no `.` and no `:`** is re-resolved to the tier-ranked winner (definition → same file → same language → lowest id). Its `UPDATE` has **no `target_symbol_id IS NULL` guard**, so it overwrites an S1/S2 hit on a dot-free target | the final target of every dot-free, colon-free edge except `contains` |
| — | `contains` | exempt from 0–5: `resolveContainsTargetStmt` matches `s.name = targetLeaf`, same file first, then the candidate whose `line_start` IS the edge's own line (#612) | every containment edge |

(THE REVISION THIS DESCRIBES: the resolution statements are committed at `1442bde08` and unmodified
in the working tree — `git diff -- src/ast/parallel-indexer.ts` there touches no `_i13_*`, `_res_*`,
`resolveTargetStmt`, `resolveContainsTargetStmt`, `target_external`, `INSTR` or `SUBSTR` line — so a
reader can check the pipeline above against the file without knowing which branch state it is.)

Two properties of that pipeline are invisible to a pool-uniqueness proxy, and both decide edges:

1. **A dotted target is looked up by its LEAF.** The qualifier is not one of stage 0's keys.
2. **`contains` is not a name question at all.** It is the pin *(leaf, own file, edge's line)*.

The second one means the `contains` rows in every table above are a name-key-space statistic, not
the store's containment outcome — the store's outcome is the one pass 8 already measured at corpus
scale: **nine unresolved containment edges out of 173,560**, against a proxy reading of 70.3%.

### The measurement

Instrument: a copy of `Argu` (28 `.fs`) indexed at this HEAD with `BB_DATA_DIR` pointed inside the
probe directory, so the store is local and disposable — 45 files, 1,407 symbols, 5,414
relationships, `plan=linear`. Then all **5,082** rows whose source file is `.fs`/`.fsi`/`.fsx`, read
straight out of `brain_relationship` joined to the `brain_symbol` it stores (`rels.tsv`, the query
beside it). "Attached by leaf" means the stored symbol's `name` equals the target's last segment;
"by exact qname" means its `qualified_name` equals the whole written spelling.

| label | dotted targets | attached | by **LEAF** | by exact qname (S1) | bare targets | unattached |
|---|---:|---:|---:|---:|---:|---:|
| `calls` | 563 | 274 | **274** | 0 | 734 (all) | 731 |
| `references` | 153 | 121 | 117 | **4** | 233 (all) | 177 |
| `uses` | 150 | 150 | **150** | 0 | 58 (all) | 290 |
| `imports` | 37 | 5 | 1 | **4** | 13 (all) | 52 |
| `instantiates` | 0 | 0 | — | — | 6 (all) | 0 |
| `extends` / `implements` | 0 | 0 | — | — | 12 / 81 (all) | 30 / 5 |
| `contains` | — | 2,109 | *line-pinned: 2,109 of 2,110* | — | — | 1 |

Read the first row as a rule rather than a coincidence: **every dotted F# call the store attached,
it attached by the leaf.** The eight S1 hits in the whole table are one shape — a target that is a
module HEADER, whose own `name` IS the dotted string (`Argu.Parser`), so its name is not its leaf.

And the leaf has to be *chosen among*: Argu's 1,407 symbols carry 940 distinct names, and the
collisions are the ordinary ones (`Usage` ×60, `AltCommandLine` ×46, `Invoke` ×14). Of the 542
dotted, non-containment targets attached by leaf:

| attachment | edges |
|---|---:|
| landed in the edge's own file | 431 |
| … to a name unique in the project | 224 |
| … to a COLLIDING name (a ranked pick inside the file) | 207 |
| landed in a different file | 111 |

Per label, the leaf's uniqueness is where the label's residual goes: dotted `calls` 197 unique / 77
colliding, `references` 74 / 43, and **`uses` 6 unique against 144 colliding** — the attribute-type
label is the one where a qualified spelling has the least purchase, because the store's first and
only usable key for it is a name that 96% of the time belongs to more than one symbol.

### What this says about the tables above, and what it does not

The proxy asks a **name-join** question — "is the written endpoint an unambiguous identity in the
corpus?" — which is the right question for a consumer that joins on `target_external` (the incoming
gate, hover, cross-file analysis). It is not the store's attachment question. Both are true about
the same edges; they are not the same number. Scoring the shipped arm and the pre-pass-4 baseline
under the store's own rules (`.tmp-probe/fs-ab-faithful.py`, arms `rows.ndjson[:3000]` and
`rows-pass15-meta.ndjson`):

| arm | src, pool proxy | src, file-local (store's rule) | tgt, pool proxy | tgt, store-faithful | tgt attached-by-rank | tgt unattached |
|---|---:|---:|---:|---:|---:|---:|
| baseline (pre-pass-4) | 52.5% | **99.4%** | 22.4% | 28.3% | 227,392 | 28,428 |
| shipped | 76.5% | **99.5%** | 34.8% | 28.3% | 227,823 | 28,430 |

Three consequences, each of which corrects a claim above rather than restating one:

* **The source side was already ~99.4% attachable at baseline by the store's own rule.** The store's
  source lookup (`nameToSymbol.get(sourceName) ?? nameToSymbol.get(sourceLeaf)`, then `endsWith`
  fallbacks over the file's OWN symbols) is generous, and a spelling is tested here against that
  file's own table only — a lower bound, because the store also accepts a bare name and any suffix
  match. So the proxy's `52.5% → 76.5%` measures a stricter question than attachability. What pass 5
  changed is WHICH symbol the file-local lookup lands on (a qualified key hits the entry the source
  named, instead of whichever same-named symbol the file published first) — a **correctness** gain,
  which an attachment rate cannot express and the incoming gate is the instrument for.
* **The target side's `+12.4p` does not survive the store's rule**: forced determinacy is **28.3% in
  both arms**, because stage 0 keys on the leaf and the respelling does not change the leaf. The
  `FS-P6-3` theorem reaches its (correct) conclusion for a reason it did not name: for a two-segment
  respelling the candidate set is IDENTICAL by construction, so the change is *neutral in the store*,
  and the table's `+11,709 / −1,810` is a proxy price for an S1 path a dotted target almost never
  reaches (eight S1 hits in 5,082 F# edges here).
* **What the target-side work did buy in store terms is real and is not those numbers**: targets that
  are not names at all — the 8,357 chain-shaped ones (`factory.Build().Render()`) and the arity/paren
  spellings (`(=)`, `add/2`) — now carry the last NAME, which is the only thing stage 0 can look up.
  Those become attachable (to a ranked same-named candidate) where no rule could place them before.
  The pool proxy called that class `not-a-name`; the store called it unattachable.

### A store-side recommendation, measured rather than asserted

Stage 0 looks up the leaf, and every later strategy runs only where `target_symbol_id IS NULL`. So
for a dotted target the store can never prefer the identity the analyzer wrote over a same-named
symbol elsewhere in the project — the analyzer's qualification is invisible at exactly the point a
project-scale joiner needs it. Two cheap changes fix that on the store side, in this order: try the
full spelling (S1) **before** the leaf when the target HAS a dot, and add
`AND target_symbol_id IS NULL` to stage 5 so the ranked plan cannot overwrite an exact-qname match.
Neither change is made here — both are the indexer's, and both are reported with the measurement
above rather than assumed.

### Reproducing it

```
cp -r <corpus>/Argu .tmp-probe/p11-store/src
BB_DATA_DIR=$PWD/.tmp-probe/p11-store/data npx tsx src/cli/index.ts index .tmp-probe/p11-store/src --no-setup
# 45 files, 1,407 symbols, 5,414 relationships, plan=linear, ~23 s
sqlite3 .tmp-probe/p11-store/data/projects/<hash>/brain.db  # rels.tsv: brain_relationship JOIN brain_symbol
python3 .tmp-probe/fs-ab-faithful.py <arm.ndjson> 3000      # both arms, both models
```

The store is inside the probe directory on purpose (`BB_DATA_DIR`), so nothing outside the
workspace is written and the index is disposable. `.tmp-probe/p11-store/rels.tsv` is the raw
reading the tables above are computed from; `symnames.txt` is the project's name histogram.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `run-fixtures.ts --lang fsharp` | **13 / 13 PASS** |
| `mutate-analyzer.ts` (`BB_MUTANT_ONLY="fsharp/"`) | **35 / 35 CAUGHT**, 0 survived (`fsharp/` of 1,873) |
| `tsc --noEmit` | clean |
| the store reading | not a gate — a probe, and it asserts nothing; the numbers above are printed, and the store it reads is a disposable one built from a corpus copy |

## M60 ONTOLOGY LANE, PASS 12 — the incoming gate re-read at this HEAD: the three zeros are gone, and the verdict changed its reason (2026-10-09)

Same command as pass 8, on the shipped tree, so the two readings are comparable row for row
(`.tmp-probe/logs/inc-fs-2026-10-09.txt`, exit 1):

| | edges | resolved | amb(decl) | unresolved | extOK | ext? | extFAIL |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass 8 (this pass's predecessor measurement) | 42,116 | 12,208 | 1,046 | 28,862 | **0** | 0 | 0 |
| now | 42,281 | **13,462 (31.8%)** | 1,436 | **26,672** | **631** | 0 | **80** |

**The three zeros pass 8 called the finding are gone.** The lane now makes 631 verifiable external
claims on this stride and refutes 80 of them (11.3%), and `resolved` rose 12,208 → 13,462 (+3.0p)
while `unresolved` fell 28,862 → 26,672. The external-claim rule that did it is the one pass 8
priced three ways before writing it (93.0% verified), so the prediction and the reading agree.

**The verdict is still FAIL, and the reason is now a different and much smaller one:** the gate's
separator tripwire fires — **100 published key(s) contain the binding separator `#`** of 42,281
edges, with the examples `` ``Regression #11`` ``, `` ``#1387 update package in v3`` `` (Bolero's
test names). The family contract spells a call to a local binding as `<callable>#<binding>`
(`BINDING_SEP`, `src/ast/types.ts:182`) and the gate asserts that spelling is **unspeakable as a
declaration name** — an assertion F# breaks, because a backtick-quoted identifier may contain `#`.
The tripwire therefore voids the binding claims for the whole population rather than for the 100
keys, which is the conservative direction and is correct as written.

This is a CONTRACT question, not a resolution property of the lane, and it is worth saying what the
two answers cost before either is taken:

* **Scope the separator per language** — the contract's premise ("no published name can carry it")
  is a fact about each language's identifier grammar, and F#'s permits it. Cost: the family
  constant becomes a per-language fact, which touches every lane's arbiter.
* **Refuse to publish a name containing the separator** — wrong on its face: `` `Regression #11` ``
  is a real declaration in 22 repositories' test suites, and dropping it would shrink the key space
  to make a gate green.

The first is the one the measurement supports. Neither is taken here — the tripwire belongs to the
incoming arbiter, and this lane reports it rather than tuning around it.

## M60 ONTOLOGY LANE, PASS 13 — the claims `calls` and `uses` cannot carry, priced and declined (2026-10-09)

The pass-12 reading has an asymmetry that the columns make plain: `imports` and `references` carry 261
verified claims each and `overrides` 109, while **`calls` (19,933 unresolved) and `uses` (2,310)
carry ZERO**. The mechanism is not missing — `md.isExternalTarget` is set by the pass-8 finalizer —
but its rule is keyed on `targetResolution` classes AND requires an owner with a DOT
(`pathClass && !owner.includes(".")` → skip), and F# call targets are overwhelmingly one-segment
owners: on the 3,000-file arm, **96,621 of 100,761 dotted `calls` targets have a one-segment owner**
(`Seq.map`, `List.map`, `Option.defaultValue`), against 4,140 with more.

Pass 8 already priced the blanket version of this: one owner segment verified **42.8%**, which is why
the rule requires a dot. The idea worth pricing before giving up is narrower and, in F#, *derivable*
rather than guessed: those names are the CORE LIBRARY, which F# auto-opens, and the corpus CONTAINS
its source — `fsharp/src/FSharp.Core/*.fs`, 94 files, **2,418** one-segment published names. So the
allowlist can be built from evidence instead of taste, and the claim's own test stays the gate's
(the owner must not be a declaration the project publishes).

PRICED on the shipped arm against the FULL corpus key space (`.tmp-probe/fs-p13-core-claim.py`):

| shape | edges | target resolves in project | file declares the owner | owner not in core | **claimable** | verified | refuted |
|---|---:|---:|---:|---:|---:|---:|---:|
| `calls`, one-segment owner | 96,621 | 48,855 | 7,073 | 18,236 | **22,457** | 6,298 | **16,159** |
| `calls`, multi-segment owner | 4,140 | 4,123 | 17 | 0 | 0 | 0 | 0 |

**28.0% verified — worse than the blanket rule it was meant to improve on, and the reason is F#
itself:** a project routinely declares its own `Seq`/`List`/`Array` (type extensions are the idiom),
so the claim "this owner is not in the project" is refuted by a SIBLING file's body — something no
analyzer reading one file can see. The rule is **declined with its number recorded**, and the
multi-segment row shows why there is nothing else to take there: of 4,140, 4,123 resolve in-project
already.

### One instrument fact this found, which changes how the stride tables should be read

The gate builds its key space from the files IN THE RUN — `for (const f of files)`
(`incoming-gate.ts:536`) counts keys from `r.symbols` per parsed file, and the project index is
passed to `parseFile` as analyzer CONTEXT, not counted. So a 400-file stride samples the KEY SPACE as
well as the edges: ~15 files per repository against the whole project. The full-corpus run (10,138
files) is the authoritative reading — **35.1% resolved** — and the 400-file stride (31.8%) is a
sample. The direction is measured: the same 3,000-file arm scored against the full-corpus key space
resolves **53,468 of 101,259 `calls` targets** where the stride reads 22.9%.

### What this leaves as the two missing capabilities, named

1. **A cross-file joiner for the in-project population.** The unresolved classes pass 8 named —
   65,215 project-internal collisions, 3,689 `.fsi`/`.fsx`-only, and the sibling-file collisions the
   pass-7/8 work measured — are all resolvable in principle and resolved by nothing: the analyzer sees
   one file, and the store resolves by leaf. This is the one that moves `calls`, `uses`, `references`
   and `imports` at once.
2. **A standard-library claim KIND, not another owner rule.** `printfn`, `failwith` and `Some` have no
   owner at all, so the gate's owner lookup cannot verify them (`targetOwner` returns null for a
   dot-free target → the `ext?` bucket, which is deliberately not merged with verified and not in
   `bad`). Claiming them under an owner key would be the laundering the arbiter refuses; the honest
   instrument is a derived core-member list — the 2,418 names above are already that evidence — with
   its own verification, which is a shared-contract decision and not this lane's to take alone.

## M60 ONTOLOGY LANE, PASS 14 — the project index F# never had, and the two bugs its first validation caught (2026-10-09)

Every cross-file question this lane has is answered per file, because the F# lane had **no
`DeclarationSpec`**: `buildProjectIndex*` could not read a single F# declaration, so `AnalyzeContext`
carried no `projectIndex` for `.fs`, and the classes pass 8 named had no instrument — 65,215 edges
whose name more than one `.fs` in the project declares, 3,689 declared in the project's `.fsi` files
only, and the in-project half of the 150,114-edge out-of-project population. This pass builds the
prerequisite, not the joiner: **the index, with the hook the shared file needed to read F# at all.**

### What was added, and why each piece is where it is

* **`DeclarationSpec.nameResolver`** (one optional hook, `src/ast/project-index.ts`). The generic
  extractor reads a declaration's name from `childForFieldName("name")` — true of Solidity, python
  and dart, false of F# three times over: a clause carries `type_name` as an **unnamed child** (the
  field is one level deeper, on that node's own `identifier`), a member is named
  `member_defn > method_or_prop_defn.name.method` (the part after the instance dot, so
  `member this.Speak()` names itself `Speak`), and an abstract member's name is the first `identifier`
  of its `member_signature`. Absent the hook, every previous language reads the same name it always
  did, byte for byte.
* **`FSHARP_DECLARATION_SPEC`**. The clause types are the declarations — `type X() = …` is ONE
  `type_definition` holding a clause per type, so F#'s mutual group is several types in one node and
  each clause carries its own `type_name` (the shape FS-P9 measured 157 unnamed members in). Members
  are `member_defn` only, which is exactly the callable surface `overrides` reads; fields cannot be
  overridden and are not listed, the same reasoning PY-21 and DARTD16 record. `object_expression` is
  a scope, so `{ new System.IDisposable with member this.Dispose() = () }` does not publish `Dispose`
  as a member of whatever type encloses the `let`.
* **Two deliberate omissions, each because including it would make the index WRONG rather than
  larger.** `type_declaration` (a bodyless forward declaration) and `type_extension` are not
  declaration nodes: an F# signature pair states `Surface` in the `.fsi` and defines it in the `.fs`,
  and `indexTree`'s duplicate-kind rule would then downgrade a real `class`/`interface` to `unknown`
  for **every** signature pair — the kind being the one field the downstream question ("is this base
  an interface?") reads.

### The two bugs the first validation caught, in this pass's own code

The spec is data about a grammar, and data about a grammar looks right while reading nothing. Both
were caught by building the index and printing it, not by reading the spec:

| what the first cut did | what the tree says | why it mattered |
|---|---|---|
| asked the clause for a `type_name` FIELD (`childForFieldName`) | `type_name` is an **unnamed child** of the clause; the field is on its `identifier` | `typeKinds.size === 0` for all 12 fixtures — an index of the right shape holding nothing, which is indistinguishable from "no declarations here" |
| collected `identifier`s in POP order for a base's name | the written path is a `long_identifier`, source order | `inherit System.IO.MemoryStream()` was filed as **`System`**, and `interface System.IDisposable with` likewise — the FIRST segment, the wrong name, on 8 of 8 based types |

The second is also a shape in the SHARED `baseNodes` path of `indexTree` (a LIFO stack taking the
last identifier popped), which is reported here rather than changed: it is the other lanes' code
and this pass does not reach into it. The F# resolver scopes its read to the `long_identifier`, which
also keeps a generic argument (`Dictionary<string, Foo>`) from becoming the base.

### The fixture, and the proof that it can fail

`validation/m14/fixtures/fsharp/project-index-spec.ts` asserts, over the lane's 12 fixtures:
kind, own members and direct bases for 8 named types; that the **control** (the Solidity spec over
the same F# files) reads **0** types and 0 names, so the assertions are proving something about the
F# spec rather than about the pipeline; that `Shape` stays `unknown` (two fixtures declare it with
different clause kinds — `indexTree`'s rule working, pinned so a later edit cannot "fix" it by
letting the last writer win); and that the object expression's members are not attributed to the
enclosing scope. Measured: **42 types, 22 with members, 8 with bases, 67 names; control 0.**

It can fail, verified rather than assumed: the same file with one expectation inverted
(`Buffer`'s base expected to be `System`) exits **1** and names the assertion
(`bases(Buffer): got ["MemoryStream"], expected ["System"]`).

### What this does NOT yet do, and the unit that follows

The analyzer still does not READ the index — `real-fsharp-analyzer.ts` contains no reference to
`projectIndex` — so this pass changes no edge, and the fixture cannot gate an analyzer that does not
read the index. The next unit is therefore two steps, and both are needed before any number moves:
(1) register `FSHARP_DECLARATION_SPEC` in the index path that builds per-language indexes for the
worker (`parallel-indexer.ts`, a file with another thread's uncommitted work in it, so it lands as
its own hunk); (2) have the analyzer read `ctx.projectIndex` for the two questions it can answer
across files — is this written identity a declaration this project publishes, and does this base
declare this member — which is the F# form of the `overrideCompanion` tier that python and dart
landed, and the instrument the 65,215-edge collision class has been waiting for.

### Gates at this pass's HEAD

| gate | result |
|---|---|
| `project-index-spec.ts` (new) | **PASS** — 42 declarations read, control 0, every kind/member/base matched; failure path proven at exit 1 |
| `run-fixtures.ts --lang fsharp` | **13 / 13 PASS** (the shared-file change is additive; the analyzer path is untouched) |
| `script/audit-index-modules/verify-import-fingerprint-index.ts` | **50 / 50 checks green** — the other lanes' index behaviour is unchanged |
| `tsc --noEmit` | clean |

## M60 ONTOLOGY LANE, PASS 15 — what the project index can actually reach, priced before it was wired (2026-10-09)

The spec exists (pass 14); before the analyzer reads it, the reachable population is measured, on the
same 3,000-file draw and the same frozen pool the pass-6/11/13 prices used
(`.tmp-probe/fs-p15-index-price.py`). The question is per target: where is the name it spells
actually declared?

| label | edges | declared in THIS file | the project publishes the identity AS WRITTEN | declared elsewhere under a DIFFERENT owner | declared NOWHERE in the project |
|---|---:|---:|---:|---:|---:|
| `calls` | 210,964 | 36,477 | 72,836 | **18,294** | 83,357 |
| `references` | 49,919 | 10,420 | 18,944 | 1,356 | 19,199 |
| `imports` | 15,339 | 771 | 6,050 | 1,360 | 7,158 |
| `uses` | 18,157 | 288 | 3,095 | 0 | 14,774 |
| `instantiates` | 1,531 | 269 | 310 | 0 | 952 |
| `extends` / `implements` | 2,080 | 395 | 796 | 0 | 889 |
| `contains` | 58,649 | 58,649 | 0 | 0 | 0 |
| `overrides` | 952 | 952 | 0 | 0 | 0 |
| **TOTAL** | **357,591** | **108,221** | **102,031** | **21,010 (5.9%)** | **126,329 (35.3%)** |

**102,031 edges are already spelled the way the project publishes them** — a name-joining consumer
resolves those today, and the index adds nothing to them. The interesting column is the fourth.

### The fourth column, and why a unique owner is NOT a licence to re-spell

Of the 21,010: **5,963 have exactly one owner** in the project for that leaf, 14,972 have several,
and 75 have none (the leaf is a member of a type only). The tempting rule — "the project has one
`map`, so spell `Seq.map`" — is **unsound**, and this corpus says why: a source that writes
`String.map` (FSharp.Core's `String` module) would be re-spelled to `Seq.map` because `Seq` is the
only owner of `map` this project publishes. That is a fabricated edge, not a resolution.

The sound condition is that the project's owner **ends with** the written owner, segment by segment
— F# writes the innermost module and the project publishes the full path (`Main.Program` written,
`Bolero.Test.Client.Main.Program` published). Measured under that rule:

| | edges |
|---|---:|
| exactly ONE suffix match — **fixable, proven** | **929** |
| several suffix matches (ambiguous, left as written) | 0 |
| the written owner is no suffix of any project owner | 20,080 |

**So the index's re-spelling prize is 929 edges (0.26% of the draw), not 21,010.** The remaining
20,080 name something this index cannot place — an external owner (`String`, `System`) or a name the
file's `open` list would have to explain — which is the open-aware joiner, a different capability
from a symbol table.

### What this means for the unit that follows, stated as a decision

Wiring the index is still worth doing, and NOT for the re-spelling: the case is (1) the 929 proven
identities, (2) a sharper `targetResolution` reason — `bare-external` and `external-type-or-module`
currently conflate "declared in another file of this project" with "external to the project", and
those are the 21,010 + 102,031 rows above, and (3) the `overrides`/`implements` half: with
`typeKinds` and `typeMembers` the analyzer can ask whether the base is a project interface and
whether it really declares the member, which is the `overrideCompanion` tier python and dart landed
— the difference between a base that is external because nothing declares it and one that is
external because the analyzer could not look.

That last one is quality rather than count, and it is the reason to do it: an override edge
asserted against a base that does not declare the member is exactly the fabricated-edge defect the
python and dart lanes each measured before this tier existed.

## M60 ONTOLOGY LANE, PASS 16 — the index is WIRED, and the classes that said "not this file" now say which (2026-10-09)

Passes 14 and 15 built the instrument and priced it. This pass connects it, in two places, and the
classes that every earlier pass could only call "external" are now split by what the PROJECT knows.

### What was wired, and where each half is pinned

| half | change | pin |
|---|---|---|
| the index is BUILT for F# | `parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS` gains `.fs`, `wasmByLang` gains `fsharp`, and the spec is selected per language (`specByLang`) | the STORE reading below — no fixture can fail when this line is missing |
| the index reaches the fixture runner | `run-fixtures.ts` selects `FSHARP_DECLARATION_SPEC` for a sub-directory F# fixture | `fsharp/fs-p10-project/*` (2 fixtures) |
| the analyzer READS it | one post-pass in `real-fsharp-analyzer.ts`, keyed on the class, run only when `context.projectIndex` is present | the same fixture's positive rows, and its forbids |

### The rule, and what it deliberately is not

A post-pass (not an emit-time change) rewrites five classes, one class at a time:

    bare-external            -> in-project-name             the project declares a symbol with this NAME
    external-type            -> in-project-type             the project declares this TYPE
    external-type-or-module  -> in-project-type-or-module   the project declares the OWNER type
    base-member-external     -> base-member-in-project      and the base's member set is then CHECKED
    interface-member-external-> interface-member-in-project

Three properties are load-bearing and each is stated in the code:

1. **Keyed on the CLASS, never on the name.** `k.Best()` keeps `receiver-value` even though `Best`
   is a name the project declares: the class describes the SPELLING, and re-labelling it would claim
   an index can bind a value receiver. Pinned by a forbid row that a name-keyed refinement fails.
2. **`in-project-name` is not called `in-project-declaration`.** The index records that a
   declaration EXISTS, not that this edge binds to it. The weaker claim is the true one.
3. **An override against an in-project base is CHECKED for its member.** `baseInProjectLacksMember`
   is written only when the base is indexed, declares at least one member, and does not declare the
   member the edge names — the fabricated-override defect python and dart each measured before their
   companion tiers existed. An empty member set writes nothing: "unknown" is silence here, because
   asserting `lacks` from an empty set would invent the defect it reports.

NOT done, and this is the decision rather than an omission: **no re-spelling.** Pass 15 priced the
sound re-spelling population at 929 edges of 357,591 (0.26%); 929 edges do not justify changing what
the analyzer WRITES, and a consumer that joins on identity can read the project's symbol table
directly. Also not done: `.fsi` files are not in the index (the signature/definition identity rule is
undecided), and `external-namespace` is not refined because the SHARED index carries declared types
and members and no module or namespace names — the 24,215-edge channel priced below, left visible as
a failing row in the fixture rather than approximated.

### The price, run before the code (`.tmp-probe/fs-p16-index-refine.py`)

3,000-file draw, the same arm and pool as passes 6/8/11/13/15. The five classes that mean "not this
file" hold **179,481 edges**, and the shipped index settles:

| class | refinable | shipped index (types+members) | + a binding channel | + a scope channel |
|---|---:|---:|---:|---:|
| `bare-external` | 84,192 | 10,584 | +15,637 | +220 |
| `external-type-or-module` | 65,196 | 21,664 | +819 | **+23,995** |
| `external-type` | 29,259 | 340 | — | — |
| `base-member-external` | 611 | 29 | — | — |
| `interface-member-external` | 223 | 161 | — | — |
| **TOTAL** | **179,481** | **32,778 (18.3%)** | **+16,456** | **+24,215** |

So the refinement is worth shipping and the INDEX'S WIDTH is what binds it: **106,032 edges are
still unanswered under the widest index**, and two named channels close 40,671 of them. The F# spec
indexes declared types (`anon_type_defn` and friends) and `member_defn` members; `let f x = …` is a
BINDING and `module M` is a SCOPE, and neither is in `symbolNames`.

### The store reading, which is the only check that the WIRING works

`Argu` copied into a `BB_DATA_DIR`-scoped store and indexed at this HEAD (45 files, 5,414
relationships, `plan=linear`), then read back from `brain_relationship.metadata`
(`.tmp-probe/p16-store/README.md`, `relations-by-class.tsv`):

| class | pre-index | with index |
|---|---:|---:|
| `external-type` | 444 | **184** |
| `external-type-or-module` | 322 | **283** |
| `bare-external` | 946 | **926** |
| `in-project-type` | — | **260** |
| `in-project-type-or-module` | — | **39** |
| `in-project-name` | — | **20** |
| `external-namespace` | 170 | 170 (the scope gap, visible in the store) |
| every other class | unchanged | unchanged |

319 edges refined; **313 of the 319 the store then attached to a symbol.** And `bare-external` falls
by only 20, which is the price table's `+BINDINGS`/`+SCOPES` finding measured on real output: the
bulk of that class is calls to module-level `let` functions, which the index does not hold.

**This reading is the gate, not a curiosity.** The wiring in `parallel-indexer.ts` was written,
verified, and then SILENTLY REVERTED by a stale write from another session editing the same file —
and nothing failed: the fixture runner builds its own index, so all 15 fixtures stayed green, `tsc`
stayed clean, and the mutants stayed caught, while every production run fell back to the pre-index
classes. A missing index is a SUPPORTED state (the pre-SOL-21 behaviour), so it has no error path.
The detector is the store count: `REFINED (in-project-*) STORED = 0` means the registration is gone.

### Two defects found while building the pin, both in code this lane wrote

**1. Every F# interface was indexed as a CLASS.** The grammar spells `type I = abstract member M : T`
and `type C() = member …` with the SAME node (`anon_type_defn`), so the static `typeNodes` map filed
the interface as a class — a confident wrong answer to the one question `typeKinds` exists for ("is
this base an interface?"). Found by building the index for the new fixture and reading `kind=class`
off a type whose own source says `abstract member`. The fix is an additive `kindResolver?` hook on
`DeclarationSpec` (returning `undefined` keeps the static kind, so every other language reads exactly
what it read) plus `fsharpKindResolver`: class evidence first — a `primary_constr_args` constructor, a
`member_defn` with no `member_signature` (a `val` field or a member with a body), `[<AbstractClass>]`
read off the clause's PARENT because the attribute is a sibling — and an interface otherwise.
**This lane's own pass-14 spec fixture had ENCODED the defect**: it asserted `["ITagged", "class"]`
with a comment explaining the node type, which was true of the node and false of the kind, while the
`interface end` spelling was pinned and passing. An unpinned SPELLING that looks like coverage — the
same shape of defect this lane keeps finding in other lanes.

**2. `let k = Kennel()` registered the CALLEE as a local binding.** The local-name read used
`nameOfDeclarationLeft(node) ?? findChild(identifier)`, and for F#'s most common local shape both
answer the callee: the LHS `k` is not an `identifier` (the grammar carries the binding name as a
pattern), so the descendant search fell through to the first identifier of the RHS — and its
`startIndex < left.endIndex` bound excludes nothing, because `left` is the WHOLE declaration and the
RHS is inside it. Measured on the minimal shapes: `let k = Kennel()`, `let zzz = Kennel()`, and
`let k = Other()` all classified the target `local-binding`, i.e. the class was the last name in the
declaration regardless of the local's name. Effects: a project type's constructor was asserted to be
a call to a local binding (false reason), and every such edge was invisible to the index refinement,
because `local-binding` claims to be this file. Fixed by reading the name with `declaredBindingName`
(left-first, the correction its own header records for a `let rec … and …` group); the fixture's
forbid row and two positive rows are the pin, and reverting the one line makes all three fire.

### Gates at this HEAD

- `tsc --noEmit` clean.
- `fsharp` fixtures **15/15** (13 before this pass; the two new files are the multi-file project).
- The mutant battery: **36/36 caught** (`BB_MUTANT_ONLY="fsharp/"`, 35 before). The new mutant is
  `fsharp/project-index-refinement-ignored`, which reverts the five classes AND deletes the markers
  the refinement writes (so it is a faithful pre-fix state) and is caught by exactly the new fixture.
- `validation/m14/fixtures/fsharp/project-index-spec.ts` now asserts the corrected kinds, the
  class-evidence boundaries (`Dep` = `class end` has zero members and is not an interface; `Bad`'s
  `val` fields; every constructor-bearing clause stays `class`), and FAILS when the `kindResolver`
  hook is removed — proven by removing it.
- Both directions of the fixture claim are gated: the with-index direction by the fixture, the
  without-index direction by the mutant.

### What the next unit is, now measured rather than argued

The **scope channel** (24,215 edges on the draw) is the single largest reachable block, and the
fixture already has a red row for it: `references`/`imports` to a SIBLING MODULE stay
`external-namespace` because the shared index has no module names. After that, the **binding channel**
(16,456) for module-level `let` functions, and the 604 zero-symbol files (measured at 123 of 150,114
unresolved edges — 0.1%, honest coverage debt, poor resolution value).

## M60 ONTOLOGY LANE, PASS 17 — the index learns modules, namespaces and bindings, and the width stops binding (2026-10-09)

Pass 16 wired the index and measured what its WIDTH could reach: **18.3%** of the 179,481 edges whose
class said "not this file". The binding constraint was never the rule — it was that the F# spec
indexed declared types and `member_defn` members, and F#'s two most common declarations are neither.
This pass adds the name channel and moves the width to **40.9%**.

### The channel: names without kinds

`DeclarationSpec` gains one optional field, `nameOnlyNodes`, and `indexTree` records those nodes in
`symbolNames` while claiming no `DeclarationKind`. It is separate from `typeNodes` for the reason pass
14 recorded for `.fsi` pairs: putting a binding there means giving it a kind, and a name that is both
a function and a type would then DOWNGRADE the type to `unknown` — the one field the downstream
question ("is this base an interface?") reads. Names only, and no `typeMembers` attribution either:
a module's members are not a TYPE's members, and `buildResolutionTables` would otherwise answer "does
this base declare this member" from a module.

The F# spec lists four node types, and getting them right took three tree dumps rather than a reading
of the grammar's docs:

| node | what it is | why it matters |
|---|---|---|
| `function_or_value_defn` | `let f x = …`, `let value = 3` | F#'s most common declaration; owned 16,456 edges |
| `named_module` | the FILE-HEADER form `module Alpha.Beta.Gamma` | **a different node from `module_defn` entirely**, and the most important entry in the list: it is how most F# files declare their module, and its name is what other files write targets against |
| `module_defn` | `module M = …`, nested | the owner of every `M.member` target |
| `namespace` | `namespace A.B` | the path an `open` writes |

Two further facts the dumps settled, each of which the first cut got wrong:

- **A nested module is written QUALIFIED.** `module Helpers = …` inside `module Fixture.Project.Domain`
  is `Fixture.Project.Domain.Helpers` to every other file, and the first cut recorded `Helpers` alone —
  so a sibling file's `open Fixture.Project.Domain.Helpers` stayed external for no reason a reader
  could see. The reader now climbs the PARENT pointers through `module_defn` / `named_module` /
  `namespace` ancestors and joins the chain, and a dotted name also records its LAST SEGMENT (both
  spellings are names a source writes, and the claim is existence either way).
- **A local must not be recorded.** `function_or_value_defn` is ALSO the node of a `let` inside a
  function body, and the first cut recorded `local` (`call-ownership.fs:67`) and `built`
  (`call-target-spelling.fs:63`) as project declarations — a local in the project's NAME SET, which
  would refine any bare call that happens to match it. Measured, not reasoned: `/tmp/fs-names.mts`
  prints the name-only additions, and those two were in the list. The fix is `scopeNodes` gaining
  `function_or_value_defn` **and `member_defn`** — and the second one is the whole fix: a scope node
  suppresses its CHILDREN, and a `let` directly inside a member body has no binding ABOVE it, because
  the binding IS the node being visited. `member_defn` is where a body begins. Member attribution is
  untouched (`scopes` is tested before the increment) and the spec fixture confirms it: 42 types, 22
  with members and the same member sets before and after, while `names` went 67 → 132.
- **They are names, not kinds.** The spec fixture asserts that none of them appears in `typeKinds`,
  because a name in `typeKinds` is the one field the downstream question ("is this base an
  interface?") reads — and it asserts the ABSENCE of the two locals the first cut recorded, which is
  the whole point of the channel having a scope rule at all.

### The price, re-read (`fs-p16-index-refine.py`, the three width columns are disjoint additions)

| class | refinable | types+members | + bindings | + scopes | **shipped now** |
|---|---:|---:|---:|---:|---:|
| `bare-external` | 84,192 | 10,584 | 15,637 | 220 | **26,441** |
| `external-type-or-module` | 65,196 | 21,664 | 819 | 23,995 | **46,478** |
| `external-type` | 29,259 | 340 | — | — | 340 |
| `base-member-external` | 611 | 29 | — | — | 29 |
| `interface-member-external` | 223 | 161 | — | — | 161 |
| **TOTAL** | **179,481** | 32,778 (18.3%) | +16,456 | +24,215 | **73,449 (40.9%)** |

106,032 edges of these five classes are still unanswered under this width, and `external-namespace`
(the `open` population behind `in-project-namespace`) is NOT in this table because the table predates
the rule — its population is measured in the store instead, below.

### The store reading (`Argu`, 45 files, 5,414 relationships, `plan=linear`)

| class | pass-16 run | pass-17 run |
|---|---:|---:|
| `bare-external` | 926 | **820** |
| `external-type-or-module` | 283 | **144** |
| `external-namespace` | 170 | **134** |
| `in-project-name` | 20 | **126** |
| `in-project-type-or-module` | 39 | **178** |
| `in-project-namespace` | — | **36** |
| `in-project-type` | 260 | 260 |
| every other class | unchanged | unchanged |
| **refined total** | **319** | **600** |

The refinement nearly DOUBLED on the same corpus, and the attachment rates are the honest reading of
its value — `in-project-type` **260/260**, `in-project-name` **126/126**, `in-project-namespace`
**36/36**, `in-project-type-or-module` **49/178**.

That last number is the finding, and it is not a defect of the rule: the unattached examples are
`String.replicate`, `String.concat`, `Seq.isEmpty`, `Seq.toArray` — and `src/Argu/Utils.fs:26,37`
declares `module Seq` and `module String`. F# projects redeclare FSharp.Core's module names, exactly
the shadowing pass 8 measured for owner claims (42.8% refuted) and pass 13 for a stdlib allowlist
(72% refuted). The class is therefore stated PRECISELY in the code: it claims the project declares a
declaration whose name EQUALS the written owner — in F# a dotted member path's owner can only be a
type or a module, so the ordinary reading is right, and the index's name set also holds bindings and
members, so a binding sharing the owner's name would satisfy the test without the owner being
material. Measured where it matters: 0 of 178 refinements on this corpus come from that shape (both
shadowing owners are real modules). It is recorded rather than fixed because fixing it means a THIRD
schema channel for module names — a new `ProjectIndex` field, its serialiser and its version — for a
shape this corpus does not have.

### Gates at this HEAD

- `tsc --noEmit` clean.
- The spec fixture: 42 types, 22 with-members, 8 with-bases, **names 132** (67 before this pass), and
  the control (Solidity's spec over F# files) still reads 0 types and 0 names.
- `fsharp` fixtures **15/15**, including the six new rows (two `in-project-namespace` paths, the
  module-owner call, the binding call) and their forbids.
- Mutants **36/36 caught**. `fsharp/project-index-refinement-ignored` now reverts SEVEN classes
  including the two this pass added, and is still caught by exactly `fs-p10-project/fs-p10-client`.
- The store reading above, which is the only check that the wiring exists at all (pass 16).
- Neutrality for the other lanes: `nameOnlyNodes` is optional and unset everywhere else, the two
  scope additions are F#-only, and the index verifier is 50/50 green.

### What is left, measured

106,032 of the 179,481 (59.1%) are outside everything the index can name even now: a target whose
lede is a **dotted external path** (`FSharp.Core.Seq.map`), an owner that is a type the project does
not declare, or a bare name nothing in the project declares. Those need a CLAIM, not a wider index —
pass 13 priced the one candidate rule and declined it at 72% refuted. The F#-specific work that
remains in the analyzer is the `.fsi` decision (3,689 edges) and the 604 zero-symbol files
(measured at 123 of 150,114 unresolved edges).

## M60 ONTOLOGY LANE, PASS 18 — the gate re-read, and a corpus that moved underneath the old numbers (2026-10-09)

The verdict instrument was re-run at the same 400-file stride pass 12 used, and two things had to be
separated before either could be believed.

### The fresh reading

```
incoming gate — fsharp .fs, 400 parsed of 400 sampled
  corpus: 10,138 .fs files across 26 repos          <- pass 12's record says 11,809
  TABLE 1 (PER PROJECT, the verdict's scope)
  TOTAL  42,281 edges   resolved 13,455   amb(decl) 1,443   unresolved 26,672
                        extOK 631   ext? 0   extFAIL 80
  VERDICT: FAIL — 100 published key(s) contain the binding separator `#`
```

The verdict's REASON is unchanged from pass 12 and is not a resolution failure: F# backtick
identifiers may contain `#` (`` ``Regression #11`` ``, `` ``#1387 update package in v3`` ``), and the
family's binding contract asserts `#` is unspeakable as a declaration name. That is a contract fact
about a shared convention, and it is recorded rather than tuned around.

### The 7-edge delta, and why it is not this lane's

`resolved` reads 13,455 where pass 12 read 13,462. That delta was chased to the bottom rather than
attributed by intuition, in two steps:

1. **An A/B on the only change since, the local-binding fix.** 300 files, the same `parseFile` and
the same order, one line reverted (`/tmp/fsa-withfix.ts` restored it afterwards). Edge totals were
IDENTICAL (56,123 → 56,123), no target spelling moved anywhere, and **1,216 edges were reclassified**:

   | movement | edges |
   |---|---:|
   | `calls`: `local-binding` → `bare-external` (the false class removed) | 1,064 |
   | `calls`: `local-binding` → `in-file-declaration` (now the file's own identity) | 81 |
   | `calls`: `bare-external` → `local-binding` (genuine locals now recorded) | 67 |
   | `instantiates`: `local-binding` → `bare-external` | 3 |
   | `calls`: `in-file-declaration` → `local-binding` | 1 |

2. **The gate's OWN resolution rule, applied to both arms** (per project, exact qualified-name match
or a bare name whose count in that project is exactly 1 — same files, same key space): `calls`
**12,930 → 12,992 (+62)**, and every other label IDENTICAL. So the fix IMPROVES the gate's number,
and the −7 cannot be attributed to it.

The remaining explanation is the header itself: the corpus the gate samples now holds 10,138 `.fs`
files across 26 repos, and pass 12's record was written against 11,809. **The two readings are not
comparable, and pass 12's absolute numbers should be re-baselined rather than quoted** — which is a
correction to this lane's own record, found by insisting that a 0.05% move be explained instead of
waved at. The instrument now prints its own corpus size for exactly this reason; the reading above
names it.

## M60 ONTOLOGY LANE, PASS 19 — the last two labels compared, and the audit made falsifiable (2026-10-09)

The lane published two relationship types that were compared against nothing: `imports` (265 edges on
the coverage gate's 25-file frame) and `uses` (188). Neither was a rule question. Both were real
analyzer facts whose truth oracle had never been written, and the absence was invisible from every
other direction — the differential's compared-label allowlist drops a label on the ANALYZER side, so a
label with no oracle reads from the outside exactly like a label with nothing wrong, and
`rel-type-coverage-gate` CHECK 1 listed fsharp as `["imports","uses"] un-audited`.

### What landed

Two arms in `script/m14/fsharp-truth-oracle.ts`, derived from the language rather than from the
analyzer's walk, and both labels admitted to `differential.ts`'s compared set. The stale reason that
had kept them out — "`uses` is deliberately absent: the lane does not derive it, and admitting it would
charge every real call edge as unexplained" — was REWRITTEN rather than left beside the change: it was
a true statement about a missing oracle, and as written it was a trap for the next reader.

- **`imports`** has three forms and each answers "what does the source NAME" differently.
  `import_decl` (`open X` / `open type X` — one node for both spellings) names the written module path
  VERBATIM: the R10 leaf rule that governs every other label in this file does not apply, because a
  module's leaf is not the module. `module_abbrev` (`module X = Y`) names the RIGHT-hand path — the
  left-hand name is the alias this very file introduces, and a first draft of the analyzer's own arm
  read the last descendant and emitted the alias as the dependency. `fsi_directive_decl` carries six
  keywords and only three (`#r`, `#load`, `#I`) name a resource; `#time`, `#help` and `#quit` are REPL
  controls that touch nothing outside the file, so the keyword is read off the tree instead of the node
  type being trusted, and the target is the specifier's string CONTENT rather than its spelling.
- **`uses`** is an attribute application — the one F# construct a `uses` edge is actually for: it NAMES
  a type, applies it as a marker, and never invokes it, which is why it is not a call, a reference, a
  base, an implementation or a construction. The target is the attribute type's LEAST segment
  (`[<Xunit.Fact>]` names `Fact`, the spelling a consumer binds by) except where this file declares a
  symbol under that name — then the target is that declaration's qualified name, because the written
  name is provably the file's own identity. Two refusals are stated as rules: the `target` FIELD is
  skipped (`[<return: Struct>]` attaches the attribute to the return, and reading the keyword as the
  dependency cost 11 edges in a 200-file draw), and an attribute's ARGUMENT is never read
  (`[<Obsolete("x")>]` names `Obsolete` and nothing inside `"x"`).

### The reading

| instrument | before | after |
|---|---|---|
| `verify-label-coverage.ts`, fsharp row | `4933 \| 4933`, un-audited `imports (265), uses (188)` | **`5386 \| 5386`, un-audited column EMPTY** |
| `rel-type-coverage-gate.ts` CHECK 1 | `fsharp 2 un-audited: ["imports","uses"]` | **no fsharp row, and no `DERIVATION\|fsharp\|` line** |
| `verify-truth-existence.ts` | — | fsharp absent from its un-declared list (c and vue are on it for their own labels) |
| `verify-oracle-coverage.ts` | fsharp baseline `calls,references` | **PASS**; fsharp's compared set recorded as `calls,contains,imports,references,uses` |
| differential, 60 files | the labels were not compared | 99.9% covered, MISSING 3, unexplained 66 — `calls=65 references=1` |
| differential, 200 files | the labels were not compared | 99.9% covered, MISSING 15, unexplained 234 — `calls=231 references=3` |

5386 − 4933 = **453 = 265 + 188 exactly**, so the coverage movement is these two labels and nothing
else. On both draws every residual row is in ANOTHER label, and both of the two largest are pre-existing
and declared in the lane's spec: `calls` (no calls oracle exists for this language) and `overrides` (the
oracle's bare-target spelling where the base is not declared in the same file).

### The part worth keeping: the audit is FALSIFIABLE

A coverage claim that cannot fail is decoration, so the arms were disabled and the harness re-run. The
guard that fired is the harness's own, and it fired on exactly the two labels:

```
[fsharp] fsharp: COMPARED WITH NO TRUTH: imports (115 comparable, 0 truth), uses (44 comparable, 0 truth)
[fsharp] ... unexplained=214 (7.4%) | unexplained-by-label: imports=115,calls=53,uses=44,instantiates=1,implements=1
```

Two facts come out of it. **The population is real** — 115 `imports` and 44 `uses` edges are comparable
on a 60-file draw, so "neither label in `unexplained-by-label`" is an audit of 159 real edges rather
than a vacuous zero. And **the arms are what make the claim true**: with no truth behind a label, every
comparable edge of it is counted as a fabrication — 159 of that draw's 214 `unexplained` rows — which is
exactly the accusation the two `declared_no_truth` entries existed to prevent.

**And the guard is a HARD FAILURE, not a note.** A second mutated draw (60 files, rotation 7) reads
`imports (190 comparable, 0 truth), uses (74 comparable, 0 truth)` with `unexplained=335 (6.5%)`, of which
264 are the two labels' ENTIRE comparable population (190 + 74) — and the harness **exits 6**, where the
clean run of the same command exits 0. So a later session that drops the arms, or the allowlist entry in
the other direction, cannot do it quietly: the differential gate fails by construction on exactly this
criterion. `.tmp-probe/fs-p19-falsify.txt` is the run.

No before/after DELTA on one draw is claimed, and the reason is recorded rather than glossed: the cold
pool advances between runs, so the mutated and the clean readings are different file sets BY
CONSTRUCTION. The evidence is the population and the guard, not a difference — a distinction this lane
paid for in pass 18, where a 7-edge move was chased to the corpus rather than attributed to the code.

### Not claimed

That the two arms agree on constructs the draws did not contain: a nested `module A.B = C` path, and a
verbatim specifier containing a doubled quote — of which no corpus specifier has one, measured over all
193 directive nodes this lane's census found. The arms are exact mirrors of the analyzer's READS on the
same grammar, which is what makes them cheap; it is also their limit, and it is why they are a coverage
instrument rather than an independent model of F#'s resolution.

## Issue


Closes M12.08 (GitHub issue #147). The 2026-09-28 M14 round above does not close it.

---

# F# — DECLARED DONE (2026-10-09)

This is a declaration, so it is written as exit criteria with the command that shows each one, not as a
summary. A reader who disagrees with the verdict has something to run.

## The criteria, and where each one stands

| # | criterion | state | evidence (re-runnable) |
|---|---|---|---|
| 1 | every emitted relationship type is compared against truth | **met** | `verify-label-coverage.ts` -> fsharp `5386 / 5386`, un-audited column empty; `script/m60/rel-type-coverage-gate.ts` -> no fsharp row in CHECK 1 and no `DERIVATION\|fsharp\|` line; `verify-truth-existence.ts` -> fsharp absent from its un-declared list; `verify-oracle-coverage.ts` -> PASS with fsharp's compared set recorded in `validation/m14/oracle-coverage-baseline.json` |
| 2 | the differential agrees on the lane's corpus draws | **met, with two DECLARED residue classes** | `differential.ts --lang fsharp --sample 200` -> 99.9% covered, MISSING 15, unexplained 234, `heuristic=0`; every residual row is `calls` (no calls oracle exists — `declared_no_truth`) or `overrides` (the bare-target spelling where the base is not in the same file). This is NOT `MISSING=0`: two classes are declared rather than closed, and they are declared rather than tuned out of the allowlist |
| 3 | no oracle is derived from the implementation it checks | **met** | `script/m14/fsharp-truth-oracle.ts` has **zero imports** — it takes the tree and the symbol list as arguments, and the two arms of pass 19 are written from the grammar's nodes and fields (the shape census `validation/m14/results/fsharp-shape-census.json`), not from the analyzer's walk |
| 4 | the pins can FAIL | **met** | `mutate-analyzer.ts` (fsharp's 36 mutants, spread from `script/m14/fsharp-mutants.ts`) -> 36 caught; and for pass 19's own claim, disabling the arms makes the harness's own guard fire: `COMPARED WITH NO TRUTH: imports (115 comparable, 0 truth), uses (44 comparable, 0 truth)` |
| 5 | the lane's fixtures pass and nothing else regresses | **met** | `script/m14/run-fixtures.ts fsharp` -> `{"fsharp":{"pass":15,"fail":0}}` and `fixture baseline gate: no regressions`; `npx tsc --noEmit` clean |
| 6 | in-project identity and containment are wired to the project index | **met at the level measured** | the index is registered for `.fs` in `parallel-indexer.ts` (pass 16) and read by the analyzer; a multi-file F# fixture pins all seven refinement classes and their forbids; the store reading on `Argu` shows 600 refined edges (319 before the scope/binding channels), of which **471 attach to a symbol** — `in-project-type` 260/260, `in-project-name` 126/126, `in-project-namespace` 36/36, and `in-project-type-or-module` 49/178, the one class whose owner is a name the store may hold under a module rather than a type |
| 7 | what is NOT resolved is enumerated and bounded, not hidden | **met** | `label_coverage.declared_no_truth` carries eight labels with a reason and a `closes_when` each; the edge classes are named by cause in passes 12-17 |
| 8 | the lane asserts nothing it cannot support | **met for fsharp's own edges** | no un-audited label, no unexplained class without a declaration, and the two candidate rules that would have raised the number were PRICED AND DECLINED with the measurement recorded (pass 13: 72% refuted; pass 15: the index's re-spelling prize is 929 edges, 0.26%) |

## What "done" does NOT mean

- **NOT that every edge resolves.** 59.1% of the non-file classes (106,032 of 179,481 edges) need a CLAIM
  rather than a wider index — a dotted external path the project does not declare, an owner that is a
  type the project does not declare, or a bare name nothing declares. The one candidate rule that would
  have reached them was priced at 72% refuted and refused.
- **NOT that the graph is complete.** `.fsi`/`.fsx` are excluded from the incoming key space by decision
  (3,689 edges), and 604 files yield no symbols — measured at **123 of 150,114** unresolved edges (0.1%).
  That is honest coverage debt and poor resolution value, and both are recorded as such.
- **NOT that the shared store is sound.** Two defects are reported and unfixed, both store-wide and not
  this lane's to fix: the insert-time leaf lookup (274 of 274 dotted `calls` attached by leaf, 0 by exact
  qualified name — which makes every lane's qualification work invisible at insert time, including this
  one's), and re-storing a project can permanently lose a cross-file relationship row
  (`parallel-indexer.ts:2928-2929`). Absence is survivable; a false claim is not, and this arc removed the
  false claims.
- **NOT that the incoming gate PASSES.** Its FAIL reason is the shared binding-separator contract: 100
  published keys contain `#`, which F# hits only because its backtick identifiers legally contain it
  (`` ``Regression #11`` ``). That is a fleet decision about a shared convention, not an F# defect, and it
  is the one criterion this lane does not meet alone.

## Overturn conditions

- **The corpus can move under the numbers.** Pass 18 found the gate's own sample had changed (10,138 `.fs`
  files across 26 repos where pass 12 recorded 11,809) and re-baselined rather than quoting the old
  absolutes. The instrument now prints its corpus size for exactly this reason.
- **The differential's allowlist is a shared physical line.** This lane's entry has been lost four times
  (`contains`, once to a merge and three times to a rewrite). The canary is criterion 1's fsharp row: if it
  reports an un-audited label again, the entry was deleted, not the oracle.
- **If the store stops matching by leaf**, every target class in passes 16 and 17 must be re-read: those
  classes were measured against INSERT-TIME leaf matching (`extractLeaf`, `parallel-indexer.ts:3867`), and a
  store that binds by exact qualified name would move them.
- **If a `calls` oracle is written**, the largest declared residue class changes meaning — the 231
  `calls` rows the differential currently counts as fabrications become a real check with real answers.

## M60 ONTOLOGY LANE, PASS 19 — `exports` is EMITTED (the ruling is overturned by instrument B), and the store's rule is re-measured (2026-10-09)

Two verdicts and one correction. The correction came first because it changed the premise of the
first: the store no longer resolves a dotted target by its leaf before anything else, so the
sentence every pass from 5 to 18 rested on ("274 of 274 dotted `calls` attached by leaf, 0 by exact
qname") is a reading of a rule that is gone.

### 19.1 The store's attachment rule at this HEAD, re-measured (PASS 11's claim, corrected)

The pass-11 store is a build product and its database was deliberately deleted; what was kept is
`rels.tsv`, the reading. Rebuilt at this HEAD from the same source with the same command the pass-11
README gives:

```
cp -r <corpus>/Argu .tmp-probe/p11-store/src
BB_DATA_DIR=$PWD/.tmp-probe/p11-store/data npx tsx src/cli/index.ts index .tmp-probe/p11-store/src --no-setup
# 45 files, 1,407 symbols, 5,414 relationships, plan=linear — identical totals to pass 11
python3 .tmp-probe/fsharp-lane/p11-remeasure.py .tmp-probe/p11-store/rels-head.tsv
```

The old artifact is re-read through the SAME script so the definitions are the doc's own, and the
doc's `by exact qname (S1)` column is recovered exactly: it counts a stored symbol whose **name**
equals the whole written spelling (a module header), which is why pass 11 could report 0 for `calls`
while 177 of its 274 attachments already carried a `qualified_name` equal to the target.

| label | store | dotted | attached | by LEAF (name == leaf) | by**NAME**-exact (pass 11's column) | by QNAME (qname == target) | bare | unattached (all) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `calls` | pass 11 (1442bde08) | 563 | 274 | **274** | 0 | 177 | 1,176 | 1,465 |
| `calls` | **HEAD** | 581 | 304 | **303** | 0 | **203** | 1,158 | 1,435 |
| `references` | pass 11 | 153 | 121 | 117 | 4 | 116 | 378 | 410 |
| `references` | **HEAD** | 153 | 121 | 116 | 5 | **121** | 378 | 410 |
| `uses` | pass 11 | 150 | 150 | 150 | 0 | 143 | 348 | 348 |
| `uses` | **HEAD** | 150 | 150 | 150 | 0 | **150** | 348 | 348 |
| `imports` | pass 11 | 37 | 5 | 1 | 4 | 4 | 33 | 65 |
| `imports` | **HEAD** | 37 | 5 | 0 | 5 | **5** | 33 | 65 |
| `contains` | pass 11 | 992 | 991 | 984 | 6 | 985 | 1,118 | 1,119 |
| `contains` | **HEAD** | 988 | 987 | 980 | 6 | **981** | 1,114 | 1,115 |

**What the doc's sentence was about, and what it is now.** "Attached by leaf" was TRUE as a
statement about the stored symbol's *name* (303 of 304 at HEAD, 274 of 274 at pass 11) and it is not
the store's lookup order. The order at HEAD, read from `src/ast/parallel-indexer.ts` and then
checked against the store, is: **S1 `target_external = qualified_name`, first, for every row**
(~4946) → S2 unique bare name → **S3 the dotted target as a dot-boundary SUFFIX of
`qualified_name`** (~5016, the recursive CTE added by `b21f8d8ad`) → S3b the leaf when unique →
**S3c the leaf RANKED over the complete symbol set** (~5071, `4403697ef`). Pass 11's stage table
describes the eager resolve that `b21f8d8ad` REMOVED ("stage 0 looks up the leaf, and every later
strategy runs only where `target_symbol_id IS NULL`"), so the conclusion built on it — "the store
can never prefer the identity the analyzer wrote over a same-named symbol elsewhere" — does not
hold at HEAD, and the lane's own overturn condition ("if the store stops matching by leaf, every
target class in passes 16 and 17 must be re-read") has fired.

The decisive measurement (`python3 .tmp-probe/fsharp-lane/p11-identity-vs-leaf.py <db> <rels>`):
of the 304 attached dotted `calls` at HEAD, **203 (66.8%) store the symbol whose `qualified_name`
IS the written target** (177 of 274 = 64.6% at pass 11), and for **all 101 of the rest the store
holds NO symbol carrying that qname at all** — so S1 had nothing to prefer, the leaf was the only
candidate, and the residue is not a preference the store made. The class is exactly what pass 11
named: `Array.filter`/`Seq.filter` (F# Core's modules, which the project does not declare) landing
on `ParseResults.filter`, 16+14+8… occurrences.

The rule A/B, because "the rule changed" should be a count and not an assertion
(`python3 .tmp-probe/fsharp-lane/p11-rule-ab.py <db> <rels-head.tsv>`): the LEGACY rule the doc's
model describes (`name = SUBSTR(target, INSTR(target,'.')+1)`, `MIN(id)`) has a candidate for 216 of
the 581 dotted `calls`; the store at HEAD attaches the same symbol in **200**, a DIFFERENT symbol in
**16** (`StringExpr.build` → HEAD `StringExpr.build`, legacy `build`; `AppSettingsConfigurationFileReader.Create`
→ HEAD itself, legacy `SchemaBuild.Create`), and attaches **nothing where the legacy would have
attached in 0**. Coverage is not lost and 16 answers moved to the identity written.

NOT claimed: that the two readings are a controlled A/B of the store change alone. The analyzer also
moved between the two HEADs (dotted `calls` 563 → 581), and the pass-11 database no longer exists,
so Q3 replays the legacy rule against the HEAD symbol table instead of re-running the old store.

### 19.2 `exports`: instrument A was the wrong instrument, so the ruling is overturned and the edge is emitted

The old ruling (`script/m14/fsharp-ruled.ts`, repeated in the doc and in `fsharp/import-and-use`'s
forbid row) rests on **instrument A**: the grammar produces no export-declaration node type. That is
still true and it settles nothing here — the same error `script/m14/lua-ruled.ts` records as json's
`exports` ruling: "Instrument A is the correct instrument here and the choice is not a default. It is
correct because the construct needs a NODE TYPE THAT DOES NOT EXIST." An export SURFACE need not be
an export DECLARATION: F# expresses it with ordinary declarations plus visibility, and CSS's own
ruling in this programme says so in as many words ("`exports` is NOT ruled on the grammar inventory
alone"). So instrument B was run over the corpus:

```
bun .tmp-probe/fsharp-lane/fs-exports-census.mts 300     # a deterministic 288-file draw
```

| measured on the tree | count |
|---|---|
| population | 6,619 `.fs`/`.fsi`/`.fsx` ≤ 512 KB; 288 measured (every 22nd) |
| distinct node types | 177 |
| `export_list`/`export_declaration`/`module_export`/`export_stmt`/`export_spec`/`exported_item` | **0 / 0 / 0 / 0 / 0 / 0** |
| any node type whose NAME contains `export` | **none** |
| `access_modifier` | `internal` 120, `private` 70, `public` 10 |
| importable names (the FS-D8 surface, `res.exports`) | **2,535 entries in 245 of 288 files (85.1%)** |
| … by kind | function 1,692 · class 323 · module 242 · enum 140 · namespace 59 · type 46 · interface 27 · property 6 |
| `[<CompiledName>]` attribute sites | 0 in the 288-file draw (a 12% sample; not claimed for the corpus) |

**The overlap, priced rather than argued** (`bun .tmp-probe/fsharp-lane/fs-exports-overlap.mts 300`),
because "`exports` would be a second label for `contains`" was the old ruling's second half:

| | entries |
|---|---:|
| surface entries | 2,535 |
| entries whose symbol has an owner — pair = `ownerFqn -> symbolFqn` | 2,143 |
| of those, pairs `contains` ALREADY carries | **2,143 (100.00%)** |
| ownerless entries (a file's own `module`/`namespace` header) — `contains` has no such edge at all | 392 (15.47%) |

That overlap does not make the label a duplicate, and the programme's own contract says why: `contains`
is MEMBERSHIP (type members, record fields, DU cases, `private`/`internal` lets) while `exports` is
the IMPORTABLE-UNIT SET, and the M49 exports-family invariant in `script/m14/run-fixtures.ts:1471`
states the asymmetry in exactly those words — "haskell/ocaml-style MODULE-owned symbols (`import
Data.User (mkUser)` binds mkUser directly — the module is the namespace, members are importable by
name)" are exports, "NOT type-owned members … membership rides Contains". F# is that shape.

**What was implemented** (`src/ast/real-fsharp-analyzer.ts`, rule FS-D13 = FSD13 in the lane spec),
inside the FS-D8 loop so the payload and the graph cannot disagree:

* one `exports` edge per payload entry — no second filter, no re-read of visibility, kinds or the
  `.fsi` merge;
* TARGET = the symbol's published identity (`metadata.fqn`, or its bare name) — the same spelling
  `contains` and the store's `qualified_name` use;
* SOURCE = the publishing scope's published identity, or `Global` when the file's own top-level unit
  has no owner (FS-D10's file-scope spelling; no module name is invented from the filename);
* metadata: `exportForm: module-surface`, `declaredKind`, `visibility`, `publishedBy`,
  `sourceResolution` (the same three-valued class `contains` writes), `targetResolution:
  published-identity`.

**Both instruments, before and after.** The firing instrument was re-baselined against a detached
worktree of this HEAD with my analyzer change absent (`.tmp-probe/fs-base`), carrying the same
(corrected, even-stride) instrument file:

```
git worktree add --detach .tmp-probe/fs-base HEAD      # analyzer at HEAD: no FS-D13
bun script/m14/firing-check.mjs FSHARP_B               # in the worktree, then in this tree
```

| arm | line |
|---|---|
| HEAD, no FS-D13 | `FSHARP_B 9 types fired 120/120 parsed (sample of the corpus, even stride)` — `calls:7519 contains:2105 extends:20 implements:13 imports:261 instantiates:25 overrides:35 references:883 uses:542` — **SILENT: exports** |
| this tree, FS-D13 | `FSHARP_B 10 types fired 120/120 parsed (sample of the corpus, even stride)` — the same counts plus **`exports:1109`** |

So this lane's 9/10 is not a sampling artifact: the pre-change HEAD worktree is silent under the
corrected sampler too.

| incoming gate | edges | resolved | amb(decl) | unresolved | extOK | extFAIL |
|---|---:|---:|---:|---:|---:|---:|
| before FS-D13 | 8,336 | 2,961 | 380 | 4,871 | 120 | 4 |
| after FS-D13 | **9,183** | **3,781** | 407 | 4,871 | 120 | 4 |
| the `exports` rows alone | 847 | **820 (96.8%)** | 27 | **0** | — | — |

`npx tsx script/m14/incoming-gate.ts fsharp fs 60`. Two caveats stated rather than smoothed over:
the separator tripwire in the two runs is not comparable — the "before" run read 4 published keys
containing `#` and the "after" run reads 0, because `BINDING_SEP` changed from `#` to `U+0000` in
`c95c8485f` between them (the fleet fix for exactly F#'s problem); and the edge columns are exactly
additive, because the only analyzer change is the exports emission (`8,336 + 847 = 9,183`,
`2,961 + 820 = 3,781`, `380 + 27 = 407`, unresolved unchanged).

`run-fixtures.ts --lang fsharp` went 14/1 → **15/15**: the one failure was the fixture's own forbid
row, which pinned the old ruling (`forbidden relationship present: {"type":"exports", …}`). It is now
replaced by five positive pins (the module header via `Global`, and the four module-owned units) plus
one forbid row pinning that `let Origin` — a VALUE — is NOT exported (FS-D12).

### 19.3 The label's population at corpus scale, and the incoming side split by class

The 288-file draw above is a 12% sample; the whole admitted population was walked with the same
analyzer (11,807 git-tracked `.fs`/`.fsi`/`.fsx` ≤ 1 MB across 26 repos — the incoming gate's own
discovery rule), and the payload it produced is the label's true population:

```
bun .tmp-probe/fsharp-lane/fs-corpus-dump.mts      # 11,807 files, failed 0, 440s
```

| | |
|---|---:|
| export entries (the `exports` label's population) | **115,461** |
| files that publish at least one | **10,707 of 11,807 (90.7%)** |
| distinct published names | 74,899 |
| by kind | function 72,720 · class 14,093 · module 13,587 · enum 5,305 · namespace 4,200 · type 1,962 · method 1,613 · property 1,003 · interface 961 · constructor 17 |

The FS-D8 filter was checked for soundness on that whole population rather than trusted: every
entry was joined to its symbol by (name, line) — **0 of 115,461 failed to join** — and the owner of
each owned entry was classified from the file's own symbol table. **97,599 are owned by a
module/namespace, 17,862 are ownerless units, and 0 are owned by anything else.** So the surface the
edges are emitted from is the importable-unit set FS-D8 claims, at corpus scale, with no type-member
leak. (A name-level rather than identity-level owner test remains *possible* in the rule; it is not
measured as firing anywhere in this population, and that is the distinction being drawn.)

**The incoming side, split by class — because the arbiter's worklist is capped at a few names per
type.** A census that prints the population must first count the way the arbiter counts, so the
replica imports `classifyEdge`/`externalClaimOf`/`tally` and reproduces the arbiter's columns before
it says anything:

```
bun .tmp-probe/fsharp-lane/fs-unresolved-split.mts 60
REPLICA: edges 9183, resolved 3781, amb(decl) 407, unresolved 4871, extOK 120, extFAIL 4
```

— identical to the arbiter's line to the edge, so the split below is measured with the arbiter's own
rule, not a second opinion about it.

| class (per-project scope, the verdict's) | targets | what it is |
|---|---:|---|
| **in-corpus-exact** — the target string IS declared in the project, just not among the 60 sampled files | **3,922 (80.5%)** | the stride samples the KEY SPACE as well as the edges (pass 13's own finding) |
| in-corpus-owner — the target's OWNER is a project declaration | 459 (9.4%) | a member spelling with no top-level symbol behind it |
| **nowhere-in-corpus** — declared in no admitted file of the repository | **438 (9.0%)** | the only class an external claim could be about |
| in-corpus-leaf-only — only the leaf is declared somewhere | 52 (1.1%) | same family as in-corpus-owner |

Per label: `calls` 2,812 exact + 406 owner + 343 nowhere + 27 leaf · `uses` 294 + 56 · `imports`
128 + 27 + 13 + 6 · `references` 662 + 26 + 32 + 12 · `extends` 6 + 1 · `implements` 15 ·
`instantiates` 5.

**THE 438, FURTHER SPLIT BY THE ANALYZER'S OWN CLASS** — because "external" has to be evidence and
not a guess:

| analyzer class | targets | is it markable external? |
|---|---:|---|
| bare, `local-binding` | **207** | NO — these name a LOCAL (`Use.Go#k` is the family's spelling for exactly this, and this lane does not use it). Nothing external to mark; the honest fix is the binding claim, priced below |
| bare, `receiver-value` | 93 | NO — a member read off a VALUE receiver; no declaration exists to name |
| bare, `bare-external` | 89 | partly — a bare callee this file does not declare, and which the whole project does not either |
| bare, `external-type` | 31 | yes — a written type the corpus does not declare (`JsonElement`, xunit attributes) |
| bare, `call-chain-receiver` | 5 | NO — a chain's last name |
| dotted, `resource-path` | 4 | yes, and by its own claim: `#r`/`#load` paths (`../../bin/netstandard2.0`, `Deedle.fsx`) name a file, not a declaration |
| bare, `external-namespace` | 4 | yes |
| dotted, `external-type-or-module` / `module-member` | 3 / 2 | yes, and these are the only shapes the gate's owner lookup can even check |

So at most **133 of 4,871 (2.7%)** are classed external at all, the rest of the nowhere class is
locals and receiver values the analyzer is right to leave unnamed, and **80.5% of the whole
unresolved population is in-corpus** — a property of the 60-file key space, not of the edges. The
last claim is measurable on the same edges, so it was measured: re-classified against a key space
built from **every admitted file of each repository** (121,369 names, 181,553 qualified names):

| scope | resolved | amb(decl) | unresolved | extOK | extFAIL |
|---|---:|---:|---:|---:|---:|
| 60-file stride (the verdict's) | 3,781 | 407 | 4,871 | 120 | 4 |
| **full corpus, same 9,183 edges** | **3,945** | **3,042** | **2,106** | 88 | 2 |

The stride's `unresolved` is 57% larger than the full-corpus reading of the same edges, and the
movement goes into `amb(decl)` — a bare leaf that is unique among 60 files is one of many
declarations project-wide. This is pass 13's finding re-derived at this HEAD, and it is the reason
no external marker is proposed for the in-corpus classes: `incoming-rule.ts` REFUTES a claim whose
owner the key space publishes, and these targets are published by their own project.

**What is NOT done, and the price of each.** No external marker is emitted by this pass. The one
class with a cheap claim (`resource-path`, 4 targets on this stride) is small; the big external-ish
class (`bare-external` 89 + `external-type` 31) is one-segment, so the gate's owner lookup cannot
verify it (`targetOwner` returns null → the `ext?` bucket, which blocks a PASS without reducing
`bad`) and pass 13 already priced the blanket version at **28.0% verified / 72% refuted**. The
binding claim for the 207 `local-binding` targets is the largest single actionable class and is NOT
taken here: it changes the TARGET SPELLING of `calls` edges to `<callable>#<binding>`, which the
differential's oracle does not derive, so it would convert 207 unexplained rows into 207
MISSING-plus-fabrication rows until `script/m14/fsharp-truth-oracle.ts` teaches the same spelling.
That is a two-file change and neither file is this pass's.

### 19.4 Two claims in this lane's own spec are refuted at this HEAD (declared, not hidden)

`npx tsx script/m14/verify-label-coverage.ts` and `npx tsx script/m60/rel-type-coverage-gate.ts
--langs=fsharp` both contradict the `_closed` blocks a previous round wrote for `imports` and
`uses`:

```
verify-label-coverage          fsharp  5471 | 4933  UNDECLARED: exports (85), imports (265), uses (188)
                                        now  5471 | 5471  declared gaps: the same three
rel-type-coverage-gate         CHECK 1  fsharp 3 un-audited: ["exports","imports","uses"]
git log --all -S'"imports", "uses"' -- script/m14/differential.ts    → (empty)
```

The `_closed` text says `imports` "was admitted to this lane's compared set in
`script/m14/differential.ts`, on its own physical line". **No such line exists** — not at this HEAD,
not in the `f-sharp` worktree at `d712fa260`, not in any commit on any branch. The oracle half of
that claim is true (`script/m14/fsharp-truth-oracle.ts` is a real second implementation); the
allowlist half is not, so both labels are EMITTED-but-UNAUDITED and are declared as such in
`declared_gaps` now. This is the same failure mode the doc records four times for the shared
allowlist line — a claim about a shared physical line outliving the line — with one difference worth
naming: this time the claim was written about a change that never landed, which no instrument can
see, because a `_closed` block is invisible to both gates. `contains`'s own entry is untouched and
still correct (its oracle exists and is deliberately unwired).

### 19.4b Reproducing this pass

The instruments this section's numbers come from are committed beside the lane's other probes, in
`validation/m14/fixtures/fsharp/` (the `.tmp-probe/fsharp-lane/` copies named above are the
originals they were run from; the copies are byte-identical and take the same arguments):

| instrument | command | what it answers |
|---|---|---|
| `fs-exports-census.mts` | `bun validation/m14/fixtures/fsharp/fs-exports-census.mts 300` | the grammar inventory (node types, `access_modifier`, `[<CompiledName>]`) and the FS-D8 surface, over a deterministic draw of the admitted population |
| `fs-exports-overlap.mts` | `bun validation/m14/fixtures/fsharp/fs-exports-overlap.mts 300` | whether the surface's adjacency is a second name for `contains` — the pair overlap, measured |
| `fs-corpus-dump.mts` | `bun validation/m14/fixtures/fsharp/fs-corpus-dump.mts` | the whole admitted population: per-file symbols (name, qualified name, kind, owner, line) and export entries, JSONL |
| `fs-unresolved-split.mts` | `bun validation/m14/fixtures/fsharp/fs-unresolved-split.mts 60` | the arbiter's columns reproduced, then the unresolved population split by class against the corpus dump |
| `p11-remeasure.py` | `python3 validation/m14/fixtures/fsharp/p11-remeasure.py <rels.tsv>` | the pass-11 table, re-derived from a store's reading |
| `p11-identity-vs-leaf.py` | `python3 validation/m14/fixtures/fsharp/p11-identity-vs-leaf.py <brain.db> <rels.tsv>` | does the store attach the identity written, or a leaf candidate |
| `p11-rule-ab.py` | `python3 validation/m14/fixtures/fsharp/p11-rule-ab.py <brain.db> <rels.tsv>` | the legacy leaf rule replayed against the same edges |

MEASURED, per instrument: each was run from BOTH locations during this pass and agreed (the census
smoke run from the fixtures copy reads 773 entries in 97 of 119 files on a 120-file draw). NOTE for
a reader re-running `fs-corpus-dump.mts`: the first version of it leaked its trees and recorded
`failed 7760 of 11,807` — a failure curve that reads like a corpus property. `tree.delete()` is in
the committed version, and the committed run reads `failed 0`.

### 19.5 Gates at this pass's HEAD

| gate | result |
|---|---|
| `bun script/m14/firing-check.mjs FSHARP_B` | **10 / 10 fired**, 120/120 parsed, even-stride sample; `exports:1109` (HEAD worktree without FS-D13: 9/10, silent) |
| `npx tsx script/m14/incoming-gate.ts fsharp fs 60` | FAIL — 407 ambiguous + 4,871 unresolved of 9,183, and 4 external claims REFUTED; separator tripwire 0 (the `#` bottleneck is gone via `c95c8485f`); instrument self-test PASS |
| `npx tsx script/m14/run-fixtures.ts --lang fsharp` | **15 / 15 PASS** (was 14/1 — the failing fixture pinned the overturned ruling) |
| `npx tsx script/m14/verify-label-coverage.ts` | fsharp `5471 \| 5471`, gaps declared: `exports`, `imports`, `uses` |
| `npx tsx script/m14/verify-truth-existence.ts` | exit 0 |
| `npx tsx script/m60/rel-type-coverage-gate.ts --langs=fsharp` | exit 1 — CHECK 1 reports the 3 un-audited labels (2 pre-existing + `exports`); the fix is the differential's allowlist plus an `exports` oracle, both outside this pass |
| `npx tsc --noEmit` | clean |
| `bash script/m14/no-regex-gate.sh` | **FAIL, pre-existing and not this lane's**: the delegated census artifact reports 0 in-scope usages (a false PASS) while `verify-regex-census.ts` prints `MISSING real-fsharp-analyzer.ts:324` and `:404` — two regexes that are present at HEAD and were present before this pass. Reproduced identically in a pristine HEAD worktree, so the state is unchanged by this pass; `script/m12/**` is not this lane's to edit |

**One commit-hygiene fact, recorded because it affects what the commit contains.**
`src/ast/real-fsharp-analyzer.ts` carried ~200 lines of a PREVIOUS round's uncommitted work in the
same file (rule `FS-P16`, `declaredBindingName`), and a path-scoped commit cannot separate hunks
inside one file. The FS-D13 commit therefore contains both, and this pass did not author or verify
FS-P16. The before/after above is still attributable to FS-D13 and not to chance: the pre-change arm
is a detached worktree of HEAD (neither change present) and every NON-`exports` count is identical
between the two arms on the same sample (`calls:7519 contains:2105 imports:261 uses:542 …`), so
FS-P16 moved no edge count on the firing sample; the incoming before/after was taken in this tree
with FS-P16 present in BOTH arms.

### 19.6 What this pass did NOT determine

- **The `method`/`property`/`constructor` entries in the corpus-scale payload** (1,613 + 1,003 + 17
  of 115,461; the 288-file draw carried 6 properties and no methods). The corpus-scale join says 0
  entries are owned by a non-module/non-namespace owner *by name*, so the FS-D8 filter holds as
  written; whether a name-level owner test could pass a type member whose owner shares a module's
  name is NOT measured, and the export edges inherit whatever the payload does.
- **`module_abbrev` aliases are not published.** `module IO = System.IO` produces one `imports` edge
  and **no symbol and no export entry** (measured on the lane's own fixture: 10 symbols, none named
  `IO`), so an alias a consumer could `open` is absent from the surface. The corpus population of that
  node is 5 occurrences in 5 files (pass 1's probe), so the prize is small — and it is a gap, not a
  disagreement with FSD10, which rules the alias an import.
- **F# attribute-name elision is a real spelling gap, measured at 27 targets.** `[<CLIMutable>]`,
  `[<RequireSubcommand>]`, `[<CustomEquality>]` are written WITHOUT the `Attribute` suffix and the
  corpus declares `CLIMutableAttribute`, `RequireSubcommandAttribute`, `CustomEqualityAttribute`. Of
  the 438 nowhere-in-corpus targets, **27 (6.2%) are `uses` targets whose `XAttribute` IS declared in
  the corpus** — i.e. the written name is elided, and an identity-aware `uses` target (the FS-P7-2
  treatment already applied to declared TYPES) would bind them. Not fixed here.
- **The firing and incoming numbers are this population at this commit.** The corpus grew under pass
  18's numbers too; both instruments now print their population, and a re-run against a grown corpus
  is a different measurement.

## M60 ONTOLOGY LANE, PASS 20 — the external claim is RETIRED (extFAIL 4 → 0), and the lane's last two regex literals are gone (2026-10-09)

Two defects this lane carried out of pass 19, both closed, and one of them closes by REMOVING a
mechanism rather than by fixing an edge.

### 20.1 The four refuted claims, named, and why the fix is the whole class

`npx tsx script/m14/incoming-gate.ts fsharp fs 60` printed, in pass 19:

```
EXTERNAL CLAIMS THE POPULATION REFUTES (counted AGAINST the lane — the owner these name IS published):
  imports        Fabulous.Avalonia.View          references     Fabulous.Avalonia.View
  imports        Fabulous.Maui.View              references     Fabulous.Maui.View
```

They are two files, each contributing one `open type` on both labels
(`bun .tmp-probe/fsharp-lane/fs-unresolved-split.mts 60`, refuted rows):

| file | target | what answers it |
|---|---|---|
| `Fabulous/samples/avalonia/Gallery/Pages/DrawLineAnimationPage.fs` | `Fabulous.Avalonia.View` | **`type View = class end`** at `Fabulous/src/avalonia/Fabulous.Avalonia/_Element.fs:9`, under `namespace Fabulous.Avalonia` — 324 files in that project declare the namespace |
| `Fabulous/samples/maui/Calculator/App.fs` | `Fabulous.Maui.View` | **`type View =`** at `Fabulous/src/maui/Fabulous.MauiControls/Widgets.fs:13`, under `namespace Fabulous.Maui` — 123 files declare it; the sample opens `Fabulous.Maui` two lines above the claimed target |

So the TARGET is a declaration in the project — not merely its owner — and the marker IS a false
claim. (Both files write `open type`, which is why each contributes the target on two labels.) The mechanism was FS-P8's final pass,
which marks an edge external when its `targetResolution` is a PATH class (`external-namespace`,
`external-type-or-module`, `module-member`, `opened-module`) or a BASE class
(`base-member-external`, `interface-member-external`) and the owner has two or more segments whose
ROOT this file does not declare. **Every one of those classes is a statement about THIS FILE** —
the `external-namespace` assignment is literally `publishedQnames.has(target) ? "in-file-declaration"
: "external-namespace"` — and the marker turned it into a statement about the PROJECT, which is
exactly the escalation `incoming-rule.ts` exists to check and the gate is entitled to refute.

**The class was priced at the scope production resolves in**, one line per claim, joined against
every admitted file of that claim's own repository (`bun .tmp-probe/fsharp-lane/fs-extclaim-probe.mts 200`,
key space from the 11,807-file corpus dump):

| class | true (owner nowhere in the corpus) | false (owner DECLARED in the corpus) | true rate |
|---|---:|---:|---:|
| `external-namespace` | 238 | **100** | **70.4%** |
| `base-member-external` | 15 | **69** | **17.9%** |
| `interface-member-external` | 1 | 0 | — |

423 claims on that draw. The false ones are the ordinary shape of a multi-file F# project, not an
exotic case, and they are named rather than counted: `Internal.Utilities` (10), `FSharp.Test` (6),
`FSharp.Compiler` (6), `Microsoft.FSharp` (4), `Fabulous.Avalonia` (2), `Fabulous.Maui` (2),
`LibExecution.Builtin` (2), `Internal.Utilities.Library` (2). The gate's own 60-file stride verified
120 of 124 claims **because its key space IS 60 files**, so an owner absent from the SAMPLE reads as
absent from the PROJECT — the laundering the rule file warns about in as many words.

**No per-file discriminator rescues them, and that was measured before the class was dropped.** The
best candidate — refuse the claim when the file itself names the owner as a dependency — leaves the
gate's columns like this (`fs-extclaim-probe.mts 60`):

| claims on the stride | outcome |
|---|---|
| owner not named by the file | 64 verified, 0 refuted |
| owner named by the file | 50 verified + 4 REFUTED (depth 2), 4 verified (depth 3), 2 verified (depth 1) |

so the rule would remove 4 false claims and 56 TRUE ones. This lane's bar for a claim rule is the one
pass 13 applied to `calls` (28.0% verified was DECLINED with its number recorded); at project scope
neither class here clears it. The claim pass is therefore RETIRED, the `targetResolution` reason codes
stay (they are file-local and true as written), and the analyzer no longer writes `isExternalTarget`
anywhere. What would bring a claim back is evidence that is not the file: `ctx.projectIndex` can
answer "does this project declare this owner" POSITIVELY (pass 14 built the F# DeclarationSpec, pass
15 priced the joiner), and a claim made only where the index says no is provable rather than shaped.

**After:** `npx tsx script/m14/incoming-gate.ts fsharp fs 60`

| | edges | resolved | amb(decl) | unresolved | extOK | extFAIL |
|---|---:|---:|---:|---:|---:|---:|
| before | 9,183 | 3,781 | 407 | 4,871 | 120 | **4** |
| after | 9,183 | 3,781 | 407 | **4,995** | **0** | **0** |

`VERDICT: FAIL — 407 ambiguous + 4,995 unresolved of 9,183 edges` (the refuted-claim clause is gone;
it will never read PASS on this population, and the 124 edges moved into `unresolved` are the honest
column for them). Instrument self-test PASS. The fixture `fsharp/import-and-use` asserted
`meta.isExternalTarget: true` on the `System.Collections.Generic` pair; both rows now pin the edge
WITHOUT the marker and two forbid rows pin the retirement — the direction that can fail.

### 20.2 The last two regex literals in this lane are gone

`bash script/m14/no-regex-gate.sh` was failing with two entries from this file
(`real-fsharp-analyzer.ts:329` and `:409`); a third (`/[:/\s]/`) sat in the retired claim pass and
went with it.

* `IS_NAME = /^(`{2}[^`]*`{2}|`[^`]*`|[A-Za-z_][A-Za-z0-9_']*|\([^()\s]+\))$/` is now a character
  walk over the four written-name forms — double-backtick-quoted, single-backtick-quoted, plain
  identifier, and a parenthesised operator NAME — with `isIdentStart`/`isIdentPart`/`isSpaceChar`
  helpers. The operator arm is the measured one (`(=)`, `(+)`: 393 edges moved from `not-a-name`
  to `bare-external` when it was added) and the whitespace/parenthesis refusals are its own,
  because `(ctr CancellationToken.None).AsTask` is a chain and not an operator name.
* `written.replace(/\.$/, "")` is `prefix.endsWith(".") ? prefix.slice(0, -1) : prefix`.
* **No node-type literal was added to replace them.** The predicate answers a question about a
  STRING the source wrote; expressing it as a node-type test would add a branch per form, would
  still fall back to text for the quoted forms, and a node type the grammar does not emit is
  exactly the dead branch this lane's `handled_verified` census exists to catch. Behaviour is pinned
  by `fsharp/call-target-spelling` and `fsharp/name-surface`, both green.

**After**, measured: `npx tsx script/m12/verify-regex-census.ts` lists **0 `real-fsharp-analyzer.ts`
entries** (it listed 3). The fleet gate still reports FAILED, and the residual is neither this lane's
nor this lane's to fix, stated with its numbers:

| residual | count | evidence |
|---|---:|---|
| `real-dart-analyzer.ts` literals at HEAD | **8** | `:2233 :2322 :2323 :3803 :3804 :3827 :3849 :3850` |
| `real-yaml-analyzer.ts` literals at HEAD | **4** | `:2283`–`:2284` |
| the pinned census artifact | **0 entries** | `validation/m12/results/regex-census.json`, 588 B, `generatedAt 2026-10-07T08:14:41Z`, `describes "HEAD blobs"` |

The artifact is the reason the SHELL gate still exits 0 while the verifier exits 1: the shell
script's status comes from the python step, which counts the artifact's in-scope rows (0), and the
last line is the verifier's own verdict, whose exit code the script does not propagate. Regenerating
the artifact and fixing the two other lanes are `script/m12/**` and their owners' files.

### 20.3 Corrections to PASS 19, and one thing PASS 19 got right

* PASS 19's gate table recorded `... and 4 external claim(s) REFUTED by the project` as the lane's
  state. That is superseded: the four are gone because the CLASS is gone, not because the refutation
  was wrong. The refutation was right.
* PASS 19's §19.3 said "at most **133 of 4,871 (2.7%)** are classed external at all" and left the
  marker question open for them. That classification stands and is now the REASON nothing is marked:
  every class in it is assigned by a file-local test, and the project-scope truth rate of the two
  biggest is in the table above.
* PASS 19's claim that the lane's fixtures pass 15/15 still holds after both changes.

### 20.4 Gates at this pass's HEAD

| gate | result |
|---|---|
| `bun script/m14/firing-check.mjs FSHARP_B` | **10 / 10 fired**, 120/120 parsed, `exports:1109` — unchanged by either change in this pass |
| `npx tsx script/m14/incoming-gate.ts fsharp fs 60` | FAIL — **407 ambiguous + 4,995 unresolved of 9,183**, `extOK 0`, **`extFAIL 0`**; self-test PASS; tripwire 0 |
| `npx tsx script/m14/run-fixtures.ts --lang fsharp` | **15 / 15 PASS**, no regressions (also re-run after landing the FS-P16/P17 pair) |
| `npx tsx script/m12/verify-regex-census.ts` | exit 1 on **12** missing literals, **0 of them this file's** (dart 8, yaml 4) |
| `bash script/m14/no-regex-gate.sh` | shell exit 0; prints the verifier's FAILED above — unchanged by this pass except that this lane is gone from it |
| `npx tsc --noEmit` | clean |
| full fixture suite | **zig 0 → 2 and dart 0 → 7 regressions, REPORTED BY THE LEAD'S RUN AND NOT RE-RUN BY THIS PASS** — not this lane's (the lead re-ran both and assigned owners); this lane's own `--lang fsharp` run is green, and neither analyzer is touched by the two changes above |
