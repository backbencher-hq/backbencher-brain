# real-haskell-analyzer.md

## Language

- Analyzer file: `src/ast/real-haskell-analyzer.ts`
- Parser: `tree-sitter-haskell` (pinned `wasm/tree-sitter-haskell.wasm`; npm
  tree-sitter-haskell 0.23.1 downloaded and verified behaviorally identical on
  the corpus via the production `parseFile` path — 7 vs 7 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; tree:
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
| references | ✅ | module dependencies only: `import` → `references module -> dep` (the FP-family module-dep contract). Source is the MODULE (fixed — was self-source `references Data.List -> Data.List`) | 0.9 |
| uses | ❌ | record field access (`name u`, `bids book` — field selectors) is a field read — no edge (fields already have `contains` ownership) | — |

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

`validation/m12/results/haskell-differential.json` (via
`script/m12/verify-analyzer.ts haskell`):

- Fixtures: `Service.hs` (positive) + `Negative.hs` (negative)
- **75/75 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
- Corpus error scan (`script/m12/haskell-corpus-errors.ts`): all 637 .hs files
  ≥ 1KB — **7 grammar-error files (1.1%), 0 crashes, 0 timeouts**. All 7
  classified honestly as grammar limitations: 3 template files with
  `{{placeholder}}` syntax (not real Haskell), 2 TemplateHaskell quasiquote
  files (`[d| ... |]` brackets unparseable without TH), 1 CRLF multi-line
  string continuation file, 1 GADTs pattern file.
- Shape-safety (`script/m12/haskell-node-types-compare.ts`): 34/35 analyzer
  node-type refs live against the pinned grammar's actual emitted types (193
  distinct types from 2,151 corpus files); the 1 remaining (`MISSING`) is the
  defensive tree-sitter error-path check that only fires on syntax errors.

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

Corpus: cabal + shellcheck + hledger + postgrest all at **100% coverage,
0 missing, 0 unexplained** (samples 200). Grammar pin: tree-sitter-haskell
v0.23.1 stays (latest release; M12.25 behavioral identity on full corpus;
upstream main has an unreleased full rewrite — re-run F1 + wasm-compare when
it ships).
