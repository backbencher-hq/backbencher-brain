# real-haskell-analyzer.md

> **VERIFY_HS9 (2026-10-04) — independent re-derivation of the 10-type verdict.**
> This lane re-derived every type from scratch (no HASKELL lane summary read).
> Corpus: `$HOME/fixtures/repositories/haskell` = **GHC** at
> `54381079`, 14,039 `.hs` files (2,900 ≥ 1 KB). NOTE the corpus identity changed
> under this lane: the doc below registers against `cabal` + `hledger`, both
> absent from this box since 2026-09-29; what is here now is the GHC source tree,
> which is neither corpus. See `## VERIFY_HS9 — verdict table` at the foot.

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
| renders | ❌ RULED 2026-10-27 | no component model: **0** template-loader sites over 3,702 files, and the 4,201 quasiquote sites produce markup VALUES rather than rendering a declared component. Ladder R1/R2/R3 all unavailable — see `## renders and mixes_in — the two rulings (2026-10-27)` | — |
| mixes_in | ❌ RULED 2026-10-27 | no member-set composition: the conformance family is already published (extends 189 · implements 13,721 · overrides 1,274), and DerivingVia (493 sites) obtains an instance THROUGH a carrier type rather than attaching members to one. See the section below | — |

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

> **RESOLVED 2026-09-29 (M60-HK wave).** The two corpora this lane was registered
> against — `cabal` and `hledger` — are **absent from this machine**, and the lane
> could not run its differential at all. The primary corpus is now **`postgrest`**,
> the only checkout on this box with any Haskell (207 tracked `.hs` files), and the
> second corpus is **declared absent** rather than retargeted. The lane runs
> single-corpus and measures again.
>
> This is a **disclosed substitute, not a replacement**: `postgrest` is smaller than
> the 637 `cabal` files originally measured and its `.hs` surface is a vendored
> database library, so it exercises less dialect. Restoring `cabal` or `hledger`
> remains the better outcome and is the M12/M60 owner's call.
>
> Current measurement, 60-file sample: **2,120 truth edges, 2,120 covered (100 %),
> 0 MISSING, 1 unexplained (0.1 %)**. The `cabal`/shellcheck/hledger coverage figures
> further down predate their disappearance and cannot currently be reproduced.

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

## VERIFY_HS9 — measurement log (appended 2026-10-04)

### Step 0 — firing-check-v2, two file counts (before any analyzer change)

`script/m14/firing-check-v2.mjs` run unmodified from the main checkout. NOTE the
lane-name convention does not select this lane: the script's selector is
`only.toUpperCase() === k || only.toUpperCase().startsWith(k)` over its own LANES
keys, so `VERIFY_HS9` matches **no** lane and prints an empty table with
`unmeasured: none` — a silent no-op that reads like a pass. `HASKELL` is the
correct argument.

| NFILES | parsed | fired | silent | imports[] | relTally top |
| --- | --- | --- | --- | --- | --- |
| 200 | 200/200 | **9/10** | `brain_import` | 248 in 102 files | contains:1169 calls:411 **imports:248** instantiates:231 implements:144 exports:99 uses:78 overrides:60 |
| 40 | 40/40 | **9/10** | `brain_import` | 28 in 18 files | contains:180 **imports:28** calls:14 implements:13 uses:12 exports:7 instantiates:5 overrides:4 |

`references` fires (in the fired list, below the top-8 cutoff at both counts).

**The `brain_import` silence is a SPELLING artefact, not a construct gap**, and
the two programme instruments disagree on the spelling:

- `src/ast/engine.ts:454` `ASTEngine.RelationshipType.Imports = "imports"` — the
  value the analyzer writes, and the value `script/m14/ontology-coverage-gate.ts`
  names as canonical (`ALL_TYPES` there is
  `calls uses contains imports references exports extends implements overrides instantiates`).
- `src/ast/types.ts:69` `RelationshipType.Imports = "brain_import"` — the value
  `firing-check-v2.mjs` tallies against (`ALL = Object.values(RelationshipType)`).

So this analyzer emits the import relationship type under the name
`ontology-coverage-gate.ts` looks for, and `firing-check-v2.mjs` scores it
missing because it reads a different enum. Measured count of the Haskell import
relationship edges on the NFILES=200 draw: **248**, in 102 of 200 files, and the
`imports: ImportInfo[]` channel independently reports **248** in 102 files.

Not a Haskell-lane fix: `engine.ts` and `types.ts` are master-owned and 6+ other
lanes emit the same `"imports"` string. Reported to master in the VERIFY_HS9
report as an instrument inconsistency.

### Step 1 — the census instrument, and one bug in it worth recording

`script/m14/tmp/hs9-census.ts` walks the corpus in sorted order (so the draw does
not depend on `readdir` order, which `firing-check-v2` does depend on) through the
production path — `getParser` → `parse` → `RealHaskellAnalyzer.analyze` — and
records per type: count, files, `evidenceClass` distribution, confidence
distribution, and BOTH endpoints' resolution, where "resolves" is answered by an
AST check (the file's declared symbol names from the analyzer's own symbol list,
plus an independent tree walk for `local_binds`/`let`/`let_in` binders) rather
than by a string shape.

The tally maps in that instrument are `Object.create(null)`, and that is not
styling. `SymbolKind.Constructor` is the string `"constructor"`, which on a bare
object literal resolves to the **inherited** `Object.prototype.constructor`
function, so `b[k] || 0` reads that function and `fn + 1` stringifies it. Measured
before the fix: the constructor bucket read
`function Object() { [native code] }111…` (168 concatenations). A plain-object
tally map silently miscounts precisely one of the kinds under study. Any other
instrument in this repo that tallies by a bare key — including any that counts
`constructor`, `toString`, `valueOf` or `constructor` as an edge label — has the
same trap.

### Step 2 — construct probe, 60-file draw (`hs9-construct-probe.ts`)

| # | construct the language HAS | measurement on 60 files |
| --- | --- | --- |
| P1 | grammar node inventory | **116 distinct node types** emitted |
| P2 | an infix application whose operator is declared in the SAME file | **116 call sites / 11 distinct operators** |
| P3 | a declaration signature naming a type | **2,056 signatures, 448 distinct type names, 60/60 files** |
| P4 | a `header` with NO `exports` child (implicit export-everything) | **2 of 58 headers** (full-corpus figure pending) |
| P5 | an instance method whose class is NOT declared in the file | **473 of 477** instance method bodies |

**P2 is a live defect in an emitted type, not a new type.** The analyzer already
publishes operator DEFINITIONS as callable symbols — `processFunction` and
`collectDeclaredFunctions` both name `a +.+ b = …` as the callable `+.+` — but
`processInfix` only handles `infix_id` (backtick) and `$`, so a use of a
locally declared operator has no `calls` edge at all. The graph therefore
publishes `+.+` as a callable with zero callers in the file that defines it.
Measured operators on the 60-file draw: `<>` 11, `=:` 42, `==` 37, `<` 4, `<=` 2,
`>=` 2, `>` 2, `===` 4, `.+.` 2, `<*>` 6, `>>=` 4.

Resolution note for P2 (why name-based resolution is sound here, not a guess):
Haskell resolves an unqualified name lexically and a module's own top-level
declaration — or class method — SHADOWS the implicit `Prelude` import, so an
unqualified `x == y` in a module that declares `==` is that module's `==`. This
is the same rule `resolveCallableTarget` already applies to plain variables.

**P5 is the measured ceiling of `overrides` under single-file resolution**: the
class→methods pre-pass is file-local, so an instance of an IMPORTED class emits no
`overrides` edge. 473 of 477 instance method bodies on this draw are in that
state. Not fixable in this lane — resolving an imported class needs the module
graph, the subsystem that does not exist yet.

### Step 3 — the M12 per-analyzer differential is RED at HEAD, and its committed artifact says otherwise

`bun script/m12/verify-analyzer.ts haskell`, analyzer unmodified, live at
`25c9a43ed`:

```
expected=77 observedResolved=81 TP=70 FP=11 FN=7 unknown=0 unsupported=0
precision=0.864 recall=0.909  earliestFailingLayer=ast_extraction
```

The committed artifact `validation/m12/results/haskell-differential.json` records
`passed: true`, `truePositive: 75`, `falsePositive: 2`, `precision 0.974`. The
live run and the committed artifact disagree, and every one of the 18 live
disagreements has the same cause: **the M60-HK wave changed this analyzer's
emission contract and the M12 ground truth was not moved with it.**

| live verdict | edge | truth file says | analyzer emits | since |
| --- | --- | --- | --- | --- |
| FN ×4 | module import | `references` | `imports` | M60-HK relabel (2,119 of 2,126 `references` were module imports) |
| FP ×4 | module import | — | `imports` | same relabel |
| FP ×5 | `exports Service -> OrderBook/User/addBid/lookupUser/submitOrder` | not in truth | emitted | implicit export-everything |
| FP ×1 | `overrides User.serialize -> Serializable.serialize` | not in truth | emitted | M60-HK overrides |
| FN ×1 | `contains User -> serialize` | expected | not emitted | instance method re-parented to its CLASS (`Serializable`), so `User` no longer contains it |
| FN+FP | `symbol:Service.hs:24:User` | `class` | `instance` | `SymbolKind.Instance` (master-owned enum addition) |

Two of those are **factually right on the analyzer's side and wrong in the truth
file** (the `imports` relabel and the `SymbolKind.Instance` change), and one is a
real behaviour change the truth never learned (`contains User -> serialize` no
longer fires because an instance's methods are owned by the CLASS it instantiates
— that re-parenting is the M60-HK fix, and the truth still asserts the old shape).

`validation/m12/**` is master-owned, so nothing here was edited: the artifact was
restored with `git checkout` immediately after the run. The lane's own record of
the run is in the commit message. **Master's need:** re-pin
`validation/m12/ground-truth/haskell.json` against the M60-HK contract, or the
lane's L1/L2 differential evidence is stale in a way that reads as a pass.

### Step 4 — two gaps closed: operator application, infix/ticked constructor application

Both were measured as constructs the language HAS and the analyzer did not read.
Neither adds a relationship TYPE — both fill in a shape of a type already
emitted, which is why the type table below does not move.

**G1 — `calls`: a locally declared operator's application sites.** The analyzer
publishes operator DEFINITIONS as callable symbols (`processFunction` and
`collectDeclaredFunctions` both name `a +.+ b = …` as the callable `+.+`), and
`processInfix` read only `infix_id` (backtick) and `$`. So a file that defines an
operator published that operator with **zero callers in its own file**.

**G2 — `instantiates`: infix and ticked CONSTRUCTOR application.** `a :+: b` for
`data Expr = Lit :+: Expr` is construction; `x `Cons` y` is construction. Both
parse to node types the walk reached and nothing read (`constructor_operator` as
an `infix` operator, a `constructor` child of an `infix_id`), so both emitted
nothing.

Shapes, from `script/m14/tmp/hs9-opshape-probe.ts` (60-file draw, AST-side):

| shape | count | verdict |
| --- | --- | --- |
| `EXP/infix:operator` | 3,140 | of these **86** name an operator this file declares |
| `EXP/infix:constructor_operator` | **111** | construction → G2 |
| `EXP/infix_id:constructor` | **9** | ticked construction → G2 |
| `EXP/prefix_id:operator` | **22** | `(<+>) a b` → G1 |
| `EXP/prefix_id:constructor_operator` | **3** | `(:+:) a b` → G2 |
| `TYP/infix:operator` | **29** | TYPE level — must emit nothing |
| `PAT/infix:constructor_operator` | **98** | pattern — must emit nothing |

**The position test is load-bearing, not defensive.** `infix` is ONE node type for
THREE syntactic positions in the pinned grammar — `_exp_infix`
(`grammar/exp.js:353`), `_pat_infix` (`grammar/pat.js:99`) and `_type_infix`
(`grammar/type.js:116`) are all aliased to `infix`, and all three use the field
names `left_operand` / `operator` / `right_operand`. A type-level operator is a
bare `operator` node exactly like an expression's. Those 29 TYP rows are sites an
operator-only test would have turned into 29 fabricated calls.

**Resolution is sound by Haskell's own rule, not by assumption.** Haskell
resolves an unqualified name lexically and a module's own top-level declaration —
or class method — shadows the implicit `Prelude` import, so in a module that
declares `==`, `x == y` IS that module's `==` (the alternative would be an
ambiguous-occurrence error). This is `resolveCallableTarget`, the same function
plain-variable calls already use, applied to an operator name.

**Sections are deliberately not emitted.** `(x +)` is a PARTIAL application: it
builds a function value and performs no call. `(<+>) a b` is a full application
and is emitted. The line is full-vs-partial, stated here rather than left to a
reader of the code. Measured cost of that choice: 18 `right_section:operator` +
0 `left_section:operator` sites on the 60-file draw, of which none can be counted
without also counting the Prelude operators they mostly name.

**Before/after — one instrument, the same 200-file sorted draw**
(`hs9-census.ts`, `BB_ANALYZER` pointing the SAME census at the pre-change tree
at `25c9a43ed` and at the new one):

| type | before | after | delta | files before/after |
| --- | --- | --- | --- | --- |
| calls | 18,113 | 18,439 | **+326** | 183 / 183 |
| instantiates | 10,707 | 11,331 | **+624** | 175 / 180 |
| contains | 10,635 | 10,635 | 0 | 200 / 200 |
| imports | 3,872 | 3,872 | 0 | 200 / 200 |
| exports | 3,606 | 3,606 | 0 | 181 / 181 |
| implements | 693 | 693 | 0 | 99 / 99 |
| uses | 515 | 515 | 0 | 85 / 85 |
| overrides | 43 | 43 | 0 | 5 / 5 |
| extends | 7 | 7 | 0 | 5 / 5 |
| references | 1 | 1 | 0 | 1 / 1 |
| symbols | 11,793 | 11,793 | 0 | — |

Of the +624: **505** are infix-constructor applications, **119** are ticked
constructors. No other type moved and no symbol count moved, which is what a
fill-in of an existing type's shapes should look like.

**Every new edge read by hand** (`hs9-newedge-verify.ts`, prints the cited
source line beside each edge):

```
brokenTest  -> =:    gen_ci.hs:445   brokenTest test _why = "BROKEN_TESTS" =: test
partition_args -> :  GHC.hs:1009     partition_args args ((arg,Nothing):srcs) objs
blockCons   -> BCons Block.hs:105    BMiddle{} -> n `BCons` b
oneShotId.rhs -> App Ids.hs:308       Var body `App` Var x'
```

**Negative control** (`hs9-defhead-check.ts`): an operator DEFINITION head must
never emit. 89 definition heads inspected on the draw; 46 of them are the only
operator on their line (the other 43 share a line with a genuine call —
`op1 == op2 = primOpTag op1 == primOpTag op2` has the head and a real self-call
on one line, which the FIRST version of this control miscounted as 33 leaks);
**0 leaks**. Self-recursion is emitted, which is the lane's existing contract:
`op1 == op2 = … op1 == op2` yields `calls == -> ==`.

**Evidence class corrected in the same change.** The 624 new `instantiates` edges
first left as `structural`, because `classifyEvidenceTier` recognises usage-site
constructions by flag name and the two new flags were not in the list. That is
the same defect the lane already fixed once for qualified constructors (HSD16,
"all usage-site edges"). After the fix the distribution on the draw is
`usage_contextual` for all 11,331 — measured, not asserted.

### Step 5 — fixture + mutation proof for the new shapes

`validation/m14/fixtures/haskell/operator-application.hs` (116 lines) with a
hand-derived expectation file: **16 symbol pins, 14 relationship pins, 2 count
pins, 14 forbids, 1 complexity pin.** Every shape was read out of the pinned
grammar with `script/m14/tmp/hs9-ast-dump.ts` BEFORE the expectation file was
written, and the fixture parses with `hasError=false` — the shapes are

```
a :+: b        match → infix → operator: constructor_operator
a `Snoc` xs    match → infix → infix_id → constructor
(<+>) x 1      match → apply → prefix_id → operator
(.+.) :: ...   signature → name: prefix_id → operator
```

Pins: a locally declared operator's application is `calls` from FOUR positions
(plain RHS, guard, case branch, forward-referenced prefix application); an infix
constructor's application is `instantiates`; a ticked constructor's application is
`instantiates`. The two guard sites share source and target and differ only by
line, which is why there is a **count pin** (`calls combine -> .+. equals 2`): a
per-set dedupe-key regression collapses them silently.

Forbids — each is a failure the new rule could plausibly make: an operator
DEFINITION head is not a call (HSD19 applied to operator heads); a PATTERN-position
infix or ticked constructor constructs nothing (HSD14 applied to the new shapes); a
TYPE-position operator whose spelling is also a value operator in the same file
emits nothing; `++`, `intercalate`, `replicate`, `>` are not targets because this
file does not declare them; and no raw head text becomes a symbol.

**The harness caught two errors in my own fixture, which is the point of it:**
the export list named `sizeOf`, which I had not defined — the runner's export
invariant (`an exported name must resolve to a symbol`) failed the fixture, so
`sizeOf` now exists and carries a second ticked-constructor shape; and I had
pinned `instantiates uncons -> Nothing` from `uncons End = Nothing`, where the
analyzer is RIGHT and I was wrong — a bare constructor with no arguments is not an
`apply`, so there is no application to record. The pin was removed, not the
behaviour. `combine`'s complexity is pinned at the measured 3 after my assumed 1
was falsified.

**Mutation proof — 12 mutants, 12 caught**
(`script/m14/tmp/hs9-mutants.ts`, artifact
`validation/m14/results/haskell-verify-hs9-mutants.json`). One mutant per
behaviour, each description naming the pin that must kill it:

| mutant | what it breaks | problems |
| --- | --- | --- |
| drop-operator-calls | 4 calls pins + the count pin | 5 |
| drop-infix-constructor-instantiates | 2 pins + the count pin | 3 |
| drop-ticked-constructor-instantiates | the ticked pin | 1 |
| operator-call-mislabelled-as-instantiates | all 4 operator-call pins | 5 |
| type-position-operator-fabricates | the type-position forbid | 1 |
| pattern-infix-constructor-fabricates | the pattern forbid | 1 |
| pattern-ticked-constructor-fabricates | the ticked pattern forbid | 1 |
| operator-definition-head-self-calls | both definition-head forbids | 2 |
| undeclared-operator-resolves | all 4 Prelude forbids | 4 |
| operator-edge-line-absent | every pin in the group | 7 |
| operator-edge-per-set-dedupe | the count pin | 2 |
| operator-evidence-class-structural | the 2 evidenceClass pins | 2 |

The mechanism is the shared harness's: the real analyzer, wrapped by a result
transform, run through the real fixture runner via the exported `runLang`.
`script/m14/mutate-analyzer.ts` is master-owned, so these 12 are NOT in the
canonical `M14.0.F4` run — `script/m14/fsharp-mutants.ts` is the precedent for a
lane keeping its mutants beside it. **Master's need:** fold them into `MUTANTS`.

### Step 6 — an INDEPENDENT oracle for the new shapes, and what it cost the F5 row

`script/m14/tmp/hs9-oracle-operator.ts` derives the three new shapes from the
tree without calling the analyzer: it re-derives the file's declared operators,
its lexical operator binders, the position gates and the callable attribution
itself. Comparison is on **source AND target AND line**.

**Before/after on the F5 differential, the SAME 300 files** (isolated empty cold
pool per side so both draws are rotation 1 and the sample hash is identical,
`d4c2a7c97b5506f2`):

| | before (`25c9a43ed`) | after | delta |
| --- | --- | --- | --- |
| tree-truth | 502 | 502 | 0 |
| covered | 501 (99.8 %) | 501 (99.8 %) | 0 |
| MISSING | 1 | 1 | 0 |
| analyzer-edges | 380 | 395 | +15 |
| unexplained | 19 (5.0 %) | **33 (8.4 %)** | **+14** |
| unexplained `overrides` | 19 | 19 | 0 |
| unexplained `calls` | 0 | **7** | +7 |
| unexplained `instantiates` | 0 | **7** | +7 |

**This lane's F5 row is now 14 edges redder, and that is the honest state.**
`deriveHaskellEdges` in `script/m14/differential.ts` reads `apply`, `infix` and
`record` heads and handles `infix_id` and `$`; it derives neither an operator
application nor an infix/ticked constructor application, so the new edges land in
`unexplained` — which the harness counts as confident fabrication at confidence
0.9. It is NOT fixed by lowering confidence below 0.7: an edge measured to be a
real call, downgraded so a gate stays green, is exactly the dishonesty the M14
contract exists to prevent. **Master's need:** wire `hs9-oracle-operator.ts`'s
`deriveOperatorTruth` into `deriveHaskellEdges` (master-owned).

Note also what the same run prints, and that it is not new:
`haskell: COMPARED WITH NO TRUTH: overrides (19 comparable, 0 truth)` — the
harness's own words for the DERIVATION finding below.

**Oracle agreement, measured: precision 1.000, recall 1.000 on 1,069 edges**
(200-file draw, artifact `validation/m14/results/haskell-verify-hs9-oracle-200.json`).

Getting there took two corrections, and **both were defects in my oracle, not in
the analyzer** — which is the dual-lens lesson applied to my own instrument:

| version | precision | recall | what was wrong |
| --- | --- | --- | --- |
| 1 | 0.493 | 0.529 | no scoped-local identity: truth said `jobVariables`, the analyzer said `job.jobVariables`. Every sampled disagreement was that one rule. |
| 2 | 0.878 | 0.969 | two gaps: the oracle's pattern test lacked the `pattern_guard` clause, so it derived 34 constructions from `ns@(_:_) <- filter …` in a guard; and a ticked constructor's `infix_id` is the operator FIELD, not a sibling, so the oracle never derived those. |
| 3 | 0.878 | 0.969 | local operator binders were keyed by the BLOCK node, so a use site never consulted them: 8 edges lost in `AArch64/Instr.hs`, where `mkSpillInstr`'s `where a .&~. b = …` at 501 is in scope for its guards at 484 — the analyzer was right. |
| 4 | **1.000** | **1.000** | binders keyed by the enclosing CALLABLE frame, `pattern_guard` clause added. |

The shared-grammar caveat applies and is not papered over: the oracle reads the
same tree-sitter-haskell grammar, so a grammar bug common to both paths is
invisible to this comparison. It measures RULE agreement — position gates, name
resolution, attribution, label — and claims nothing about the grammar.

## renders and mixes_in — the two rulings (2026-10-27)

**Population for every number below:** the whole admitted population — **3,702**
`.hs`/`.lhs` files over **6** repositories, through the production path
(`engine.getParser` → `parse` → `RealHaskellAnalyzer.analyze`), **3,702 parsed
of 3,702**, 0 read failures, 0 parse or analyze throws. Construct evidence:
`script/m14/haskell-extended-census.ts` →
`validation/m14/measurements/haskell-extended-census.json`; grammar inventory:
`validation/m14/measurements/haskell-grammar-nodes.json` (served digest
`37a6b07b1a83`, **174 distinct named types** in 253 named slots of 552 ids).
Both types are recorded in `script/m14/spec/haskell-completeness.json`
(`coverage.excluded`), which is what the coverage gate reads: the lane now
reports **12 of 12 applicable**.

### `renders` — RULED, 0 sites

The vocabulary's `renders` needs three things: a declaration that denotes a
**component**, a **host renderer** that constructs the element, and a target that
is another component. Haskell has none of the three. No declaration denotes a
component; nothing constructs an element; and the element is not a node in the
language at all.

| family measured | sites | why it is not a render |
| --- | --- | --- |
| Template Haskell template **loaders** (nearest analogue) | **0** | would name a template FILE, and a file is not a component symbol — the vocabulary has nothing to bind |
| quasiquotes (`[hamlet\|…\|]`, `[blaze\|…\|]`, `[sql\|…\|]`) | **4,201** | an expression evaluating to markup; it **applies no component**, and 0 of them names a declared component |
| `{-# ANN #-}` pragmas | **30** (24 files) | passive metadata (21 target a module, 9 a declaration) — already the `decorates` question, and it is not an application |
| declaration-position TH splices | **420** | already the `decorates` population (177 rows); none names a component |

**Falsifier:** a corpus site where a declaration produces a component value a
host renderer constructs **and** whose target is a declared component — **0**
measured. **Ladder:** R1 unavailable (no published build carries such a node;
the served build is the newest release of a dormant grammar and its inventory
has none — the only render-family stem match is `view_pattern`, a GHC
view-pattern node carrying no relation). R2 unavailable because a patch would
have to **invent** a component model and a host renderer, i.e. syntax and
semantics the language does not have; a grammar change alters what a file can
SAY, never what the language MEANS. R3 unavailable because no existing node type
carries a component→component relation (`apply`, `quasiquote`, `top_splice` are
counted above and carry value production).

### `mixes_in` — RULED, 0 sites

`mixes_in` is the fleet's **member-set composition**: go's struct embedding, zig's
`usingnamespace`, dart's `with`, elixir's `use` — implementation attached to a
type with **no conformance declared**. Haskell's only route to an implementation
is to **declare conformance**, and that family is already published as three
canonical values:

| construct | sites | already published as |
| --- | --- | --- |
| class declarations | 360 | `contains` / `extends` (superclass constraint) |
| instance declarations | 12,451 | `implements` (+ `overrides` for its methods) |
| deriving clauses | 7,454 | `implements` |
| **DerivingVia** | **493** | `implements` with `metadata.derived` |
| standalone deriving instances | 596 | `implements` |

**DerivingVia is the one construct that looks like a mixin and is not**, which is
why the ruling is pinned in a fixture: `deriving (Semigroup, Monoid) via (Sum Int)`
obtains an implementation **through a carrier type**. The carrier supplies the
*instance*; the type must still **declare** the conformance; **no member set is
attached**; and the carrier is not a supertype. The analyzer reads it as
`implements`, which is the honest reading.

**Falsifier:** a corpus site where a declaration attaches a member set to a type
without declaring conformance — **0** measured over 3,702 files. **Ladder:** R1
unavailable (no published build carries the construct). R2 unavailable because a
patch would invent syntax and semantics the language does not have — GHC's own
answer to implementation reuse is a library plus `deriving`, a value-level and
conformance-level mechanism, not a declaration a grammar could expose. R3
unavailable because no node type carries a member-set composition; the two
candidates that could be **misread** as one are counted above.

### The fixture that gives both rulings teeth

`validation/m14/fixtures/haskell/ruled-extended-types.hs` (+ its expectation)
contains, in one file, the shapes a wrong rule would fire on:

- a **superclass constraint** → pinned as `extends` (exactly 1 row);
- an **instance** → `implements`; its method → `overrides`;
- **DerivingVia** → `implements` with `metadata.derived`, **forbidden** as
  `mixes_in`, including the specific wrong edge (`Gadget` → `Sum`);
- a function that **assembles a markup String** → the `calls` row it really is,
  **forbidden** as `renders`, including the specific wrong edge
  (`renderWidget` → `String`);
- `expectRelationshipCount` pins **0** `renders` and **0** `mixes_in`.

Suite: **8 pass / 0 fail** (`bun run script/m14/run-fixtures.ts --lang haskell`).
A relabel of the 493 deriving-via sites, or a value-shape render rule, would
fail on this file rather than pass on a corpus zero.

## HSA1 (append-only record, 2026-10-28) — a bare capitalised dependency is a CLAIM, not silence

**THE WALL WAS 60,898 AMBIGUOUS/UNRESOLVED OF 193,418 EDGES**, and its two largest classes were the
two dependencies Haskell spells as a BARE UPPER-CASE NAME:

| class | rows | what it names |
|---|---:|---|
| `implements` unresolved | **11,563** | the type class in an `instance` head: `Show` 2,459 · `Eq` 1,899 · `Generic` 1,404 · `Ord` 703 · `ToJSON` 662 · `FromJSON` 641 · `NFData` 530 · `Hashable` 327 · `Functor` 300 · `Binary` 270 · `Data` 258 · `Read` 172 · `Arbitrary` 163 … |
| `instantiates` unresolved | **10,978** | the constructor in an expression: `Just` 3,657 · `Right` 1,017 · `Left` 617 · … |

Not one of those names can be declared by a corpus file that does not already declare it. Every row was
a dependency published with **no reading at all** — indistinguishable at the gate from a broken edge.

### The rule, and why it cannot refute

`pushRel` — the analyzer's single relationship writer — now attaches the fleet's `externalTarget`
claim to an `implements`/`instantiates` row whose target is a bare capitalised name the module does not
declare. Because it rides the writer, a new emission site cannot forget it.

**THE CLAIM IS SAFE BY CONSTRUCTION, NOT BY CARE.** The arbiter consults a claim only where the name
model has NOTHING (`decls === 0`), so a name the project really declares keeps its resolved/ambiguous
answer, and a REFUTATION requires `decls > 0` on an unresolved row — a state this claim cannot reach.
That is why the movement below adds **zero** extFAIL.

Three refusals: a QUALIFIED target (`Csv.ToNamedRecord`, `T.unpack`) is a module path and belongs to the
arbiter's own `importPath` claim; a LOWER-CASE target is a parse artifact (Haskell types and constructors
are upper-case); a name THIS MODULE declares is a local dependency and must resolve.

**The guard needs CONSTRUCTORS, not just types.** The first cut checked `declaredTypes` only, so
`data Foo = MkFoo Int` did not protect `MkFoo` and the module's own constructor was claimed — a
VERIFIED FALSE claim, the worst of the three outcomes. The fixture caught it on the first run, and the
candidate set now carries `declaredConstructors` (collected generously — over-collecting can only
withhold a claim, which is the safe direction).

### The arm, same population (3,702 files / 6 repos), A/B by analyzer digest

| column | before HSA1 | after |
|---|---:|---:|
| edges | 193,418 | **193,418** |
| ambiguous | 9,326 | **9,326** |
| unresolved | 51,572 | **34,038** |
| extOK (verified) | 9,988 | **27,522** |
| ext? | 67 | **67** |
| **extFAIL / bindFAIL / causeFAIL** | **0 / 0 / 0** | **0 / 0 / 0** |

**Wall 60,898 → 43,364 (−17,534), every one a dependency that now says what it is.** No resolution moved,
no ambiguous row moved, and no claim was refuted — the movement is exactly the two classes above.

**PINS.** New fixture `bare-type-claims`: three positives (`instance Show Int`, `Just`, `Right`, `Left`)
and three twins (`instance Shape Bool` where `Shape` is declared here; `MkFoo` in the same expression;
`MkFoo` alone as the module's own constructor). Two new mutants — `bare-type-claim-dropped` and
`local-constructor-claimed` — both CAUGHT. Lane battery **19 of 19**, suite **9 pass / 0 fail**,
`tsc` 0.

**What is left, named:** `calls` 25,131 unresolved (qualified names like `T.unpack` — the import-alias
map is the next instrument), `instantiates` residue with dotted targets (`Schema.VInt`), `imports` 2,395,
`exports` 985.

## HSA2 (append-only record, 2026-10-28) — the alias/module claim for qualified calls: MEASURED, NOT TAKEN

`T.unpack` names `Data.Text.unpack`, and the file itself says so: `import qualified Data.Text as T`.
The import list already carries the alias, so publishing the fleet's `moduleNamespace` claim on an
alias-qualified `calls` row is a small change — and it was built and run before being judged.

**The arm said no.** Over the whole population: `unresolved` 34,038 → 9,231 (a 24,807-row movement) but
`ext?` 67 → **22,499**, and `extOK` 27,522 → 29,897. So 22,432 of the rows moved from "unresolved" to
"a claim no check can reach" — the lane's own definition of debt — for **2,375** real verifications.

**The cause is the claim's granularity, not the emission.** `verifyModuleNamespaceClaim` keys the
project's module space on the module's ROOT (`Data` for `Data.Text`), and `projectModuleNames` is built
from file basenames and DIRECTORY names, so any project that has a `Data/` or `Schema/`-like directory
demotes every claim under that root. Haskell modules are dotted paths; a root-only key cannot answer them.

Reverted: the analyzer is back to the HSA1 state byte for byte (wall 43,364 · verified 27,522 · ext? 67 ·
refuted 0). The change is a one-line re-enable **if** the module claim ever keys on the full module path —
that is a Lead instrument change, and this record is its price: **+24,807 claimed, 22,432 of them
unverifiable at root granularity.**

## HSA3 (append-only record, 2026-10-28) — single-segment module imports: MEASURED, NOT TAKEN

`import Prelude` (631 rows), `import Autocodecd` (157), `import Protolude` (120), `import Safe` (59) …
name a module with NO DOT. The arbiter's inferred `importPath` claim requires a dotted capitalised
leaf (`DOTTED_MODULE_TYPE`), so those rows carried NO reading at all — a small, safe-looking class.

It was built (the lane's own `moduleNamespace` claim, specifier = the module, fail-closed by the
verifier's module-space test) and the arm said no:

| column | before HSA3 | with |
|---|---:|---:|
| unresolved | 34,038 | **32,900** (−1,138) |
| extOK | 27,522 | **27,872** (+350) |
| **ext?** | **67** | **855** (+788) |
| extFAIL | 0 | 0 |

**350 verified for 788 claims the instrument refuses** — the wall's satisfied side moves by 350 while
its debt side moves by 788. Same shape as HSA2, same verdict: reverted, because a claim no check can
reach is the lane's own definition of debt, and the lane's bar counts it.

Cause of the demotions: `projectModuleNames` is built from file basenames and DIRECTORY names, so a
project that happens to carry `Prelude.hs` (or a `Safe/` directory) demotes every claim naming that
root. A module claim that cannot distinguish `Prelude` from a directory called `Prelude` is not a
question this project can answer — it needs the full-module-space key.

Reverted byte for byte (43,364 wall · 27,522 verified · ext? 67 · refuted 0). Two module-claim
experiments now sit in this file as records (HSA2, HSA3), both priced, both blocked on the same
instrument.
