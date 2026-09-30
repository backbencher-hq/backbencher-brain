# real-haskell-analyzer.md

## Language

- Analyzer file: `src/ast/real-haskell-analyzer.ts`
- Parser: `tree-sitter-haskell` **v0.23.1** (pinned `wasm/tree-sitter-haskell.wasm`,
  sha256 `37a6b07b…`; the wired bytes are **byte-identical** to the wasm published
  in npm tree-sitter-haskell 0.23.1 — the newest release of a dormant grammar — and
  that tarball's source is vendored in `grammars/tree-sitter-haskell/`; the M12.26
  A/B on the corpus agreed: 7 vs 7 grammar-error files, 0 fixed, 0 regressed.
  Registry: `validation/m14/grammar-pins.json`; round:
  `reviews/functional-family/m60-grammar-pins.md`. Tree:
  `header` → `module`/`module_id` (dotted names assemble from chained
  `module_id` children) + `exports`; imports are `import` nodes with `module`
  + `import_list` (+ `qualified`/`hiding`/`as` tokens); `data_type` wraps
  `data_constructors` → `data_constructor` → `prefix` (→ `constructor`) or
  `record` (→ `constructor` + `fields` → `field` → `field_name`); `newtype`
  has `newtype_constructor`; `deriving` → `tuple` → `name`; `class` →
  `context` (superclasses) + `name` + `class_declarations`; `instance` →
  `name` (class) + `type_patterns` → `parens` → `apply` (target type) +
  `instance_declarations`; top-level declarations are `function`/`bind` nodes
  (first child `variable` = name, then `patterns` + `match` body); calls are
  `apply` nodes whose head is `variable` (local) or `qualified` (→ `module`
  with trailing dot + `variable`); constructor application heads are
  `constructor`; where/let locals live under `local_binds`; do-notation binds
  are `bind` nodes with a `<-` child; guards are `guards` nodes; if is
  `conditional`; case branches are `alternative` under `case`.)
- Language detection: `.hs` → `haskell` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealHaskellAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (paren strip, `as` strip, arrow-split — pure char
  scans, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `header` → module (dotted `module_id` assembly); `data_type`/`newtype` → first `name` child (type) + `data_constructor` → `prefix`/`record` → `constructor` (constructor) + `record` → `field_name` (property); `class` → `name` child; `instance` → class named by the TARGET type (Rust `impl User`/Elixir `defimpl` contract); `function`/`bind` → first `variable` child; class method signatures → `signature` → `variable` |
| kind | ✅ | module; data/newtype → `type`; constructors → `constructor`; record fields → `property`; class → `interface`; instance → `class`; signatures inside class/instance bodies → `method`; top-level functions → `function` |
| qualified/container name | ✅ | `ownerName` = enclosing module for all module-level symbols (tracked via `ctx.currentModule`, since the header subtree ends before the body); constructors/fields owned by their type; class/instance methods owned by their interface/class |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | `patterns` node children |
| visibility | ✅ | always `public` (Haskell has no visibility keyword; exports list governs exposure) |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | post-loop over `ownerName`: module → every module-level symbol (`contains Service -> User`), type → its constructors (`contains Side -> Bid`), type → record fields (`contains User -> name`), interface/class → methods (`contains Serializable -> serialize`). Self-named edges skipped (`data User = User {...}` would collapse into a self-loop in symbol-ID space) | 1.0 |
| implements | ✅ | `instance` → `implements targetType -> className` (from `name` + `type_patterns`); `deriving (Show, Eq)` → `implements type -> Show`/`Eq` (names from `deriving` → `tuple` → `name`) | 1.0 |
| extends | ✅ | class superclasses: `class Semigroup s => Mergeable s` → `extends Mergeable -> Semigroup` (from `context` → `apply` → first `name` child; parens-wrapped multi-superclasses handled) | 1.0 |
| calls | ✅ | `apply` heads with function sources (source = the containing function/method via `currentFunction`). Local calls emit LEAF targets only when the callee is a module-level declared function (pre-pass collects all `function`/`bind`/`signature` names → forward references resolve, e.g. `submitOrder -> describe` declared later). Self-recursion and mutual recursion ARE emitted (`countDown -> countDown`, `mutualA -> mutualB`). Qualified calls emit FULL targets (`M.lookup`, `Data.Map.size` — the Erlang `gen_server:cast` precedent). Exclusions: Prelude/imported functions (`map`, `foldl'`, `fromMaybe`), type variables, pattern vars, record-field selectors, operator/infix syntax, where/let-local functions (their bodies are scoped noise) | 1.0 |
| instantiates | ✅ | constructor application in BODY position → `instantiates fn -> Constructor` (Erlang `record_expr` analog). Pattern-position constructor applications (function heads, `patterns` nodes) never emit. `record_update_expr`-analog record updates (`book { bids = ... }`) are not constructions | 0.9 |
| imports | ✅ | `import` → `imports module -> importedModule` (**M60-HK**: was `references`; 2,119 of 2,126 `references` edges were module imports) |
| exports | ✅ | the `header → exports` list → `exports module -> name`; only `export` nodes count, because the list interleaves Haddock comments (**M60-HK**) |
| overrides | ✅ | `instance C T where m ...` → `overrides T.m -> C.m`, matched against a class→methods pre-pass (**M60-HK**) |
| uses | ✅ | a type synonym → the `name`/`constructor` leaves of its right-hand side; a `variable` there is a type PARAMETER and is excluded (**M60-HK**) |
| references | ✅ | FFI entity edges only — an `imports` edge now carries the module dependency (**M60-HK**; 7 edges corpus-wide) |

## Noise-elimination contract (what produces NO edges)

- Imported/Prelude functions (`map`, `foldl'`, `fromMaybe`, `length`, `print`,
  `pure`, `max`) — not declared in-file → no call edges.
- Type variables (`a`, `b`) and pattern variables (`f`, `io`, `step`) — no
  call edges.
- Operator/infix syntax (`a < b`, `x || y`, `io1 >> io2`) — pattern marking
  only (Monads/Functors/Applicatives), never call edges.
- where/let-local functions (`where lookup ...`) — no symbols, no calls from
  their bodies (scoped noise, M11.11 closure boundary).
- do-notation binds (`z <- fetch x`) — expression-level, never symbols; their
  applies execute in the enclosing function and attribute to it.
- Pattern-position constructor applications (`matchOn (OrderBook bs _)`) — no
  instantiates.
- Record updates (`book { bids = ... }`) — copy/update, not construction.
- The old post-loop identifier walker that flooded `calls Global -> a` /
  `calls classify -> n == 0` / operator-as-call edges is REMOVED entirely.
- Params/locals never become symbols.

## Complexity model (live, verified against emitted shapes)

Cyclomatic complexity counts decision points from the pinned grammar's actual
emitted node types:

- `case` (each `alternative` branch under a case is a decision).
- `conditional` (the if/then/else node — `if` is not a node type).
- `guards` (each guard set; `guard_equation` is not emitted).

The dead baseline entries (`if`, `guard_equation`, `case_expression`,
`pattern_match`) were removed — those node types are never emitted.

## Regex census

Baseline at M12.01: **9 usages**. After M12.25 (pure-AST rewrite): **0
usages** — all nine eliminated:

| Line | Old regex | Replacement |
| --- | --- | --- |
| 177 | `/^[A-Z][a-zA-Z0-9_]*/` (data-constructor name fallback) | `prefix` → `constructor` / `record` → `constructor` AST nodes |
| 249 | `/^[A-Z]/` (capital check in call walker) | walker REMOVED (pure apply-head extraction) |
| 409 | `/^as\s+/` (import alias strip) | `startsWithWord`/`stripLeadingWord` char scans |
| 418 | `/^[()]/g` + `/[()]$/g` (import item paren strip) | `stripOuterParens` char scan |
| 534 | `/\(.*\b->\b.*\)/` (HOF detection) | `hasArrowInParens` paren/arrow char scan |
| 670 | `/[()]/g` + `/\s+/` (instance type split) | `type_patterns` → `parens` → `apply` AST descent |
| 675 | `/\s+/` (instance single-type fallback) | AST child collection |

Census total 78 → **69**. The census gate passes (0 missing, 0 stale, 0
unclassified).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/haskell-complexity.json`):

- Fixtures: 2 files, 33 symbols, 42 relationships, ~296 ms
- Corpus subset: 637 files (cabal@670955a4 — the Haskell build tool itself),
  17,828 symbols, 34,755 relationships, ~16.0 s
- All loops single-pass over per-file structures; symbol dedup is O(1) via
  `functionSymbolIndex` (the per-signature `.find()` scan eliminated); zero
  `.find`/`.filter`/`.some` over symbols; loop-structure scan shows no nested
  symbol loops.

## Corpus validation

> **REPRODUCIBILITY WARNING (2026-09-29 master review).** The two corpora this
> lane is registered against — `cabal` and `hledger` — **do not exist on this
> machine**, so the corpus differential cannot run and every corpus coverage
> figure below is currently **unreproducible**. This is not a claim that has been
> disproved; it is a claim nothing can check, which is a different and worse
> state. `bun run script/m14/differential.ts --lang haskell --repo cabal` fails
> with `corpus repo missing: $HOME/fixtures/repositories/cabal`.
> Restoring a registered corpus is the highest-value action available to this
> lane. The one corpus figure that *is* still checkable is `postgrest` (the 208
> `.hs` files reachable on this box, not a registered corpus) — see
> `reviews/haskell/master-review.md` §0 and §1.
>
> Two further corrections from that review, both about claims below being weaker
> than they read:
> - The **"34/35 node-type refs"** shape-safety result has **no committed
>   artifact** (`validation/m12/results/haskell-node-types-compare.json` does not
>   exist) and the script that produced it is **unrunnable** — it hardcodes a
>   checkout path absent from this machine. It is also a *typo check* (do the
>   types the analyzer references exist in the grammar?), not a coverage check
>   (does the analyzer handle every type the grammar emits?). The second question
>   is the one that found three real recall holes, and it had never been asked.
> - The **"75/75 facts, precision 1.000, recall 1.000"** figure is a **two-file
>   fixture** differential (`Service.hs` + `Negative.hs`). It is not corpus
>   coverage, and under the warning above no corpus coverage number here is
>   currently verifiable.

`validation/m12/results/haskell-differential.json` (via
`script/m12/verify-analyzer.ts haskell`):

- Fixtures: `Service.hs` (positive) + `Negative.hs` (negative)
- **75/75 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
  (two files — see the warning above)
- Corpus error scan (`script/m12/haskell-corpus-errors.ts`): all 637 .hs files
  ≥ 1KB — **7 grammar-error files (1.1%), 0 crashes, 0 timeouts**. All 7
  classified honestly as grammar limitations: 3 template files with
  `{{placeholder}}` syntax (not real Haskell), 2 TemplateHaskell quasiquote
  files (`[d| ... |]` brackets unparseable without TH), 1 CRLF multi-line
  string continuation file, 1 GADTs pattern file.
  *Re-measured 2026-09-29 over the 208 `.hs` files on this box: **0 files with a
  parse error, 0 ERROR/MISSING nodes** — a strictly better profile, on a
  different and smaller file set.*

## Supported / unsupported constructs

Supported: modules (dotted names), data/newtype declarations, ADT
constructors (prefix + record), record fields, typeclasses (with superclasses),
instances (named by target type), deriving, module-level functions, forward
references, qualified module calls, do-notation, where/let scoping, guards,
case/if, self and mutual recursion, pattern marking (Monads/Functors/
Applicatives/List Comprehensions/HOFs).

Not modeled (deliberately): TemplateHaskell quasiquotes (grammar limitation),
imported/Prelude function call sites (unresolvable without a module graph —
the FP-family rule), where/let-local function bodies (scoped noise), operator
uses (syntax, not calls), record-field selector calls (field reads).

## 2026-09-03 re-review wave (HSD11–HSD19, corpus-expanded)

Re-review beyond the gates' original coverage, on 3 new corpora (shellcheck
2,4k LOC parser core; hledger; postgrest — 392 files, 0.5% parse-error rate).
Key honest lesson: the differential oracle **mirrors** the analyzer's contract,
so shared holes stay green (shellcheck read 100%/0/0 while 4 defect classes
were live). Only parse-shape probes on real files exposed them.

Defects found and fixed (each probe-verified on real corpus code, both sides
of the oracle mirrored):

- **HSD12**: standalone `deriving instance Show Foo` emitted nothing →
  implements (bare/qualified/parens class heads).
- **HSD14**: pattern-position constructors fabricated `instantiates` via three
  ungated paths — case `alternative` patterns, `pattern_guard` bind forms, and
  record/function-head patterns. Pattern territory = `patterns` nodes +
  alternative/guard bind heads + function/bind head subtrees.
- **HSD16**: body-position qualified constructor application (`M.Just 1`,
  985 corpus occurrences) emitted nothing → instantiates with
  `isQualifiedConstructorApplication`.
- **HSD17**: expression-position signature annotations (`(e :: T)`) — the walk
  skipped `signature` subtrees, dropping every call beneath them. Declaration
  signatures remain type-trees (no descent).
- **HSD18**: deriving entries extracted element-wise — bare name, qualified
  full text, class-application head; argument leaves no longer mis-collected.
- **HSD19**: unnameable bind/function heads (constructor patterns, tuple
  patterns, backtick infix heads) left `currentFunction` stale or wiped →
  fabrications and dropped calls; heads now resolve exactly and
  definition-head backticks never self-call.
- **Regression caught by fixture** (same day): the element-wise rewrite
  dropped the `parens` recursion, so `deriving newtype (Show)` emitted
  nothing — the new `UserId -> Show` fixture pin caught it immediately.
- **Evidence-class defect**: qualified-constructor `instantiates` edges were
  classified `structural`; now `usage_contextual` (all usage-site edges).

Gate hardening: fixture extended with pins + forbids for every fixed class
(28 expect / 9 forbid relationships); 4 new mutants (185 total, all caught);
`comment` keys on expectation entries are documentation, not match
constraints (harness bug found when new forbids silently never fired).

> **UNREPRODUCIBLE (2026-09-29).** `cabal` and `hledger` — the two corpora this
> lane is registered against — are absent from this machine, so this row cannot
> currently be regenerated. The figures are what was measured when the corpora
> were present; nothing here can confirm or refute them today. See the
> reproducibility warning under `## Corpus validation` above.
>
> Corpus: cabal + shellcheck + hledger + postgrest all at **100% coverage,
> 0 missing, 0 unexplained** (samples 200). Grammar pin: tree-sitter-haskell
v0.23.1 stays (latest release; M12.25 behavioral identity on full corpus;
upstream main has an unreleased full rewrite — re-run F1 + wasm-compare when
it ships).

## Where/let locals — the rule, the 2026-09-25 adjudication, scoped identity

**The rule** (pinned by code and by the lane's own fixture): a where/let-bound
callable is **not a symbol** — locals are not module entities — but it *is* a
declared callable, so a call made inside its body attributes to the **local
itself**, never to the enclosing function, and a local resolves as a call
target. `Negative.hs`'s where-clause therefore emits `helper → go` and
`go → go`.

**Why it needed adjudicating.** The rule landed in the 2026-09-03 HSD6/HSD19
wave and was pinned by `validation/m14/fixtures/haskell/payload-and-complexity`
("where-local resolution", authored before the run, mutants 12/12). The **M12
truth did not move with it**: the artifact in the tree dated to 2026-08-20 and
carried no `inputs` block, so nothing re-ran it. The 2026-09-25 re-pin read
precision **0.974** (2 FP — exactly these two edges) against a committed claim
of 1.000. Verdict: analyzer rule stands, truth extended 75 → 77, precision
1.000, because the two calls exist in the source text and the alternative
(attributing `go`'s recursion to `helper`) asserts a call `helper` never makes —
the fabrication the wave removed. The fixture comment that still described the
pre-wave behaviour was corrected in the same act.

**Scoped identity — the caveat closed (2026-09-26).** Local endpoints are no
longer bare. A local's **edge identity** is its lexical owner chain,
`owner.local` (nested: `owner.inner.local`), and target resolution is
**lexical**: a local is a candidate target only from inside its own scope, and
a shadowing binder wins for the whole RHS of its callable. `Negative.hs`
therefore emits `helper → helper.go` and `helper.go → helper.go`. Locals still
publish **no symbol** — the chain is an edge identity, exactly the elixir #17
`scope-arity` split (the symbol keeps its bare name + owner; the scope identity
is what gets qualified). Module-qualified targets are untouched (`M.lookup`),
and a chain can never be confused with one: Haskell capitalises module aliases
while a local's owner is a lowercase function/method name.

**Instrument correction, recorded rather than quietly fixed.** The pre-round
caveat cited "282 of 2,356 files (12 %) carry a shadowing binder" from
`script/m14/tmp/haskell-local-calls-collision.ts`, whose regex
`(where|let)` + whitespace + NAME also matched INSTANCE/CLASS `where` clauses
(their first member: `instance Show Account where showsPrec …`), not only local
binders. Re-measured with the tree (`local_binds`/`let`/`let_in` direct
children) by `script/m14/tmp/hs-local-identity.ts`: **16 files / 67 binder
names** carry a shadowing binder, over **708 files / 11,487 local binder
names**. The ambiguity was latent, not exercised by an emitted edge — no
endpoint in either run was a bare name that a module symbol and a binder
share (`bareShadowed = 0`).

**Before/after, one instrument, the same draw** (full hledger 186 + cabal
2,150 `.hs`, **2,356 files, 0 parse failures**; artifact
`validation/m14/results/haskell-local-identity.json`, machine-composed
`before` + `after` blocks over one basis):

| Side | Before (analyzer @35e80314) | After |
| --- | --- | --- |
| sources | 20,002 symbol / **12,309 bare local** / 0 chain | 19,043 symbol / **11,832 scoped chain** / **0 bare local** |
| targets | 12,059 symbol / **6,314 bare local** / 7,540 other bare | 12,034 symbol / **4,907 scoped chain** / 7,536 other bare |
| qualified dotted targets (untouched) | 6,398 | 6,398 |
| `calls` / `instantiates` edges | 22,483 / 9,828 | 21,047 / 9,828 |

Every bucket reconciles exactly: before, sources = 20,002 + 12,309 = the edge
count (32,311); after, 19,043 + 11,832 the same. The 1,436 `calls` edges that
disappeared are the flat set's cross-scope attributions (the fixture's
`outOfScope n = hop n` case): −959 sourced from module functions, −477 from
locals, against −1,407 binder targets and −25 symbol targets. `instantiates`
did not move. The local-chain test is kind-aware (a *function/method* symbol
can own a local; single-uppercase CONSTRUCTOR symbols like `data Side = L | R`
must not masquerade as owners), which is why the qualified-target universe
reconciles to the same 6,398 on both sides.

**Gates.** Fixture `payload-and-complexity` gained the collision section
(module-level `go` vs a where-binder `go`, sibling `hop` locals, the
out-of-scope negative, the do-let bind case) with **6 scoped pins + 8 bare-form
forbids**; mutants `haskell/local-identity-flat` and
`haskell/local-scope-blind` are both caught (16/16 haskell mutants), and
`validation/m14/results/haskell-local-mutant-pins.json` records WHICH pin
breaks under each (identity-flat: 8 pins missing + 7 forbids tripped;
scope-blind: the `calls outOfScope -> hop` forbid). M12 truth moved in lockstep
(`rel:Negative.hs:calls:helper:helper.go`, `…:helper.go:helper.go`; 77/77,
precision/recall 1.000), and the F5 oracle `deriveHaskellEdges` mirrors the
rule — full-extent draw, 0 MISSING / 0 unexplained on both hledger and cabal.

## The site line — dimension 8 / M59.A7 (2026-09-26)

Every relationship now carries `line_number` — the line of the node that
**names** the target (the callee head for `calls`, the constructed name for
`instantiates`, the class name for `implements`/`extends`, the imported module
name for `references`, and for `contains` the **child's own** naming line).
Two contract halves, clean/erlang's verbatim:

- **The line is part of the dedupe key** (`source|type|target|line`): a call
  from three lines is three edges. Anchoring on the name-bearing node is not
  pedantry — the fixture's own file holds two same-named children
  (`UserId` the newtype @29, `UserId` the Mergeable impl @61, since an instance
  publishes its impl symbol named after its target type, the universal
  impl-naming contract), and only the child's own line distinguishes them.
- **A non-positive line is recorded as absent, never 0** (M59.O2) —
  `pushRel`'s `hasLine` guard; `lineOf()` returns `undefined` for a node with
  no position.

**Before/after, same ruler.** `script/m60/lane-surface-audit.ts` (the
instrument that recorded the pre-round state) over its cabal+hledger 60-file
draw: **5,240 of 5,240 edges unlined → 0 of 6,235** (`no line: 0 (none)`).
The delta 5,240 → 6,235 is the per-site expansion: edges that the pre-round
`source|type|target` key swallowed.

**Full extents** (`script/m14/tmp/hs-line-coverage.ts`, artifacts
`validation/m14/results/haskell-line-coverage.json` and
`haskell-line-coverage-cabal.json`):

| Corpus | Files | Edges now | Pre-change (same draw) | Expansion | Worst multi-site group |
| --- | --- | --- | --- | --- | --- |
| hledger | 186 (full) | **15,151 lined / 0 unlined** | 12,526 | 2,625 | 40 (`calls`) |
| cabal | 2,134 (full) | **55,974 lined / 0 unlined** | 46,753 | 9,221 | 186 (`calls`) |

The pre-change column is exact, not an estimate: the old key WAS the collapse
key, so the pre-round edge count on a fixed draw equals the distinct
`source|type|target` group count. Both artifacts carry a `beforeAfter` block
recording this basis, including the live pre-round draw (5,240/5,240) from the
family sweep.

**Gates.** Fixture `payload-and-complexity`: **12 `line_number` pins + 2
count pins**, one per anchor shape (import name, child own-line, deriving
class node, instance class node, superclass head, qualified head, backtick
infix, record constructor, qualified ctor, guard pair @197/198) — the pair
pins are pairs precisely because a single-line pin survives a per-set
regression. `expectRelationshipCount` covers every multi-site group in the
fixture (`recount→signed` = 2, `Data.User→UserId` = 2), so no group can
collapse unnoticed. Mutants `haskell/edge-line-absent` (strips every
`line_number`) and `haskell/edge-line-per-set` (reverts the key to the pre-fix
`source|type|target`) — **14/14 caught**; per-pin catch evidence in
`validation/m14/results/haskell-line-mutant-pins.json` (absent fails 12/12
line pins; per-set fails exactly the two second-site pins + both count pins).
M12 identity unaffected: **77/77, precision/recall 1.000, earliest failing
layer `none`** (the line is payload, not identity —
`validation/m12/results/haskell-differential.json` re-pinned fresh).
