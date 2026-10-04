# real-php-analyzer.md

## Language

- Analyzer: `src/ast/real-php-analyzer.ts`
- Parser: `tree-sitter-php` **0.24.2** (npm, upgraded in M12.29 from the stale
  pinned grammar; WASM at `wasm/tree-sitter-php.wasm`, loaded by `engine.ts`
  via `resolveWasm`)
- Detection: `.php` → `php` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.getAnalyzer("php")` → `RealPhpAnalyzer`

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `namespace A\B;` | `namespace` | `namespace_definition` → `namespace_name` |
| `class C extends B implements I` | `class` | `class_declaration` → `name`; `base_clause`/`class_interface_clause` for edges |
| `interface I extends J` | `interface` | `interface_declaration` → `name` |
| `trait T` | `trait` | `trait_declaration` → `name` |
| `enum E: string` + `case X` | `enum` + `enum_member` | `enum_declaration` → `name`; `enum_case` → `name` |
| `function f()` | `function` | `function_definition` → `name` |
| `function m()` in a class | `method` | `method_declaration` → `name` |
| `public string $prop` | `property` | `property_declaration` → `property_element` → `variable_name` |
| `public const C = 1` | `constant` | `const_declaration` → `const_element` → `name` |
| promoted constructor params | `property` | `property_promotion_parameter` → `variable_name` |

Locals, parameters, `$this->x` member access, and `global` declarations are
**never symbols**. The legacy phantom symbols (Laravel Eloquent
`getAttribute`/`setAttribute`, WordPress `wp_add_*` hooks) are removed — only
facts that exist in the AST are emitted. Anonymous classes/closures are
expressions, not named declarations, so they emit no symbol.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `extends` | class → superclass, and interface → extended interface. A qualified base whose leaf equals the declaring class keeps its qualification (PHPD10); an unresolvable same-leaf base emits **nothing** — a self-extends is always a fabrication |
| `implements` | class → interface, **and enum → interface** (M37.13 — enums use the same `class_interface_clause` shape) |
| `uses` | the lane's largest and most subdivided label. Trait `use` inside a class body; member reads (a static `name` field only — a braced `$o->{$x}` is a dynamic selection and emits nothing); static property reads; class-constant fetches (`::class` skipped); subscript bases; closure captures; interpolation; first-class tear-offs; bare `$var` reads through the frame chain → file functions → superglobals; bare `NAME` const reads from the file inventory. Eleven distinct read flags ride the label (`isLocalRead`, `isMemberRead`, `isConstRead`, `isSubscriptBase`, `isConstFetch`, `isStaticRead`, `isInterpolationRead`, `isClosureCapture`, `isGlobalRead`, `isTraitUse`, `isTearOff`) |
| `calls` | `function_call_expression`, `member_call_expression`, `nullsafe_member_call_expression`, `scoped_call_expression`; leaf target; source = enclosing function/method (PHP builtins filtered **after** leaf-flattening, so a `\is_file()` cannot escape the filter) |
| `instantiates` | `object_creation_expression` (`new Class(...)`, incl. `new self/static/parent`); `self`/`static` → the enclosing class, `parent` → its **declared** base, an unresolvable `parent` → nothing |
| `overrides` | a method the **declared** base actually declares — in this file, or via `AnalyzeContext.overrideCompanion`. Resolution is **per-link**: a class is compared only against the base it declares, never transitively. Emitted at 0.95 / `structural` |
| `imports` | module dependencies: `use` clauses (module = the FQN, alias carried in `metadata.aliased`, and a **grouped** `use C\{D, E}` records members *qualified*) and `require` / `require_once` / `include` / `include_once` paths. Owner is file scope — `use` is per-compilation-unit in PHP. A path is emitted only when **statically** known, and the operand **values** compose (never the source text of the concatenation) |
| `references` | **only** the R9 declared-type reference graph: property types, **typed class constant types** (PHP 8.3), parameter types, and return types. `metadata.relationshipType` is `declared_type` or `return_type`; `metadata.declaredOn` names the position. Wrappers descend (`?Dep`, `Dep\|Other`, `Dep&IShape` → each member is its own dependency); `primitive_type` is silent; `self`/`static` resolve to the enclosing class and `parent` to its declared base. NOT include paths (those are `imports`) and NOT constant fetches (those ride `uses` with `isConstFetch`) |
| `contains` | one edge for every owned symbol. **Two owner levels**: a member is owned by its class/interface/trait/enum, and since M60 a **top-level declaration is owned by its namespace** (`contains App\One -> A`), matching the csharp and typescript convention. See "Namespace containment" below — that sentence about being "audited by an independent oracle" was **false** in this tree and has been corrected |

| `exports` | **added this round, after the ruling that said it did not exist.** A name the file **publishes** and no declaration in it writes: a file-scope `define('NAME', …)`. Three grammar tests — the callee is exactly the bare name `define`; the first argument's value is a string literal read **through** the `argument` wrapper; no enclosing function/method/closure/class (a top-level `if` is not a scope). Emitted at 1.0 / `import_based`, with a `constant` symbol carrying **no** `ownerName` because `define()` publishes into the **global** scope even inside a namespace — hence no `contains` edge. **57** edges over 17 files, every target resolving. See "`exports` — the ruling that was falsified" |

Every value `RelationshipType` declares is accounted for: **ten emitted, none
ruled**. `exports` was previously PHPD33, RULED on a parse-tree count; that
count read 0 because the probe tested the `argument` wrapper node instead of the
string literal inside it, so it could not fire on any input and **no corpus could
falsify it**. A positive control corpus found it. The previous ruling paragraph
that stood here has been removed rather than amended, because leaving a withdrawn
verdict readable next to its replacement is how a reader ends up citing the wrong
one.

## Namespace containment (M60)

The lane emitted 4,442 `namespace` symbols and joined **none** of them to
anything. Every `contains` edge it produced came from a member's `ownerName`,
and a top-level declaration had no owner at all, so the fourth-largest label
carried the member level and stopped there.

It was an outlier against the project's own convention, not a judgement call:
the **csharp** analyzer sets `ownerName` / `ownerKind: Namespace` for a
top-level type, verified on `namespace App.Services { interface IRunner; class
Runner; }` → `contains App.Services -> IRunner`, `contains App.Services ->
Runner`, and **typescript** does the same through `ScopeKind.Namespace`.

**Why it survived a reading of the heritage code.** PHP has two namespace forms
and the grammar spells them differently:

| form | shape | declarations are |
| --- | --- | --- |
| `namespace A { … }` | `namespace_definition` owns a `compound_statement` | CHILDREN, so the walk reached them with `ns` set |
| `namespace A; …` | `namespace_definition` ends at the `;` | SIBLINGS at `program` level |

The semicolon form is the common one, so the branch that worked was the rare
one. `namespaceSegments()` now indexes the semicolon form by node `startIndex`
(web-tree-sitter re-creates the `Node` wrapper per call, so a child index would
not be a stable key), and a semicolon form's scope runs to the next `namespace`
declaration or end of file — which is PHP's own rule, so a declaration after a
semicolon form belongs to it, not to the global namespace.

### The second defect behind it: `qualifiedName`

`pool-worker.ts:870` derives `qualifiedName` from `metadata.fqn`, and the FQN is
built from the same `ns`. Because `ns` never resolved for the semicolon form,
every declaration under it carried the **leaf** as its qualified name. Measured
on the fixture: `A` before, `App\One\A` after, with `App\Two\B` already correct
(braced form). `qualifiedName` is a store column, so this changed indexed rows,
not only edge text.

### What it cost, in edges

An A/B over the **same 4,621 files at the same worker count** (`BB_WORKERS=2` on
both sides, whole corpus, no sampling — the count has to be matched because
`pool-worker` returns `fallback` for a handful of pathological files and which
ones trip it depends on concurrency):

| type | before | after | delta |
| --- | --- | --- | --- |
| `contains` | 25,592 | 30,315 | **+4,723** (+18.45% on that label) |
| `calls` | 94,227 | 94,227 | +0 |
| `uses` | 132,591 | 132,591 | +0 |
| `imports` | 25,900 | 25,900 | +0 |
| `references` | 8,636 | 8,636 | +0 |
| `extends` | 2,808 | 2,808 | +0 |
| `implements` | 1,000 | 1,000 | +0 |
| `overrides` | 2 | 2 | +0 |
| `instantiates` | 10,587 | 10,587 | +0 |
| **total, 9 types** | **301,343** | **306,066** | **+4,723 (+1.57%)** |

**Every other label is exactly unchanged**, which is the result that matters: the
namespace round touched containment and nothing else, so it introduced no new
call, use, import, reference, heritage, instantiation or override edge and it
did not move a single one of the 2 `overrides` edges.

Two residual differences in the symbol table are **not** caused by the round and
are reported so the table is not read as cleaner than it is: `namespace` 4,443 →
4,442, `enum` 42 → 41, `enum_member` 125 → 124 — one file returned `fallback`
in one run and parsed in the other. It emitted **0 relationships either way**
(every relationship delta is +0), so it moves no edge count.

### `imports` stays file-scoped, and a fixture caught the alternative

The first implementation left `emitInclude`'s owner as `ns || "global"`. That
had only ever been exercised one way — `ns` was `undefined` for essentially
every real file — so making the semicolon form resolve made the branch reachable
at scale, and it is **wrong**: `include`/`require` resolves a path against the
file's own directory, and the namespace in force has no part in it. Left alone,
one analyzer would have filed the same kind at two owners depending only on
which namespace syntax a file happened to use. `php/include-paths` failed on 6
edges, and the owner is now unconditionally `global`, which is what the
`imports` row above always claimed.

Pinned by `php/namespace-containment` (the namespaced case of the same rule) and
`php/include-paths` (the file-scope contract).

Member *access* (`$obj->prop`, no call) produces no edge; only member *calls*
(`$obj->method()`) do. Constructor expressions emit `instantiates`, not `calls`.

### `imports` is the kind the file-level reader needs

`src/lsp/graph_request.ts:256` is `relationship_type IN ('imports','exports')`.
This analyzer used to emit **zero** `imports` edges: a `use` clause was
recorded only as `ImportInfo` with no relationship, and an include path was
mislabeled `references` — a file-level module edge presented as an intra-file
symbol read. Every PHP module dependency was therefore invisible to that
reader, while the ontology above already promised otherwise. Fixed in
M12.PHP-IMPORTS: `use` and include paths now share the `imports` kind, with
`metadata.isImport` / `metadata.fileLevel` set.

### `overrides` — verified only, and now CROSS-FILE too (M60)

**CORRECTION to a disclosure this document used to carry.** It previously said cross-file overrides
were unmeasurable "because `AnalyzeContext.overrideCompanion` is never populated in production
(M37.10)". That was **true of production traffic and irrelevant to an audit**, which needs the index
built from the corpus under test. The mechanism was never missing: `src/ast/override-context.ts`
ships the builder, and `verify-analyzer.ts` already ran the two-pass shape over its fixtures.
**Nobody ran it over a corpus.** It is now run, and the label's audited sample size went from **1** to
**1,080** (phpunit 527, phpmyadmin 553), with exact analyzer-oracle agreement on every row.

The index is built from the **grammar**, not from the analyzer's symbols, so a bug in the analyzer's
method extraction cannot be fed back to it as ground truth. It is a shared *input* — a published fact
both sides read — not a shared rule.

**`private` methods are never overridden, and PHP is why.** A private base method is not inherited, so
a subclass method of the same name is a different method. The analyzer was publishing that edge at
0.95 / `structural`; it is now suppressed. phpunit ships
`tests/_files/CoveredClass.php` specifically to assert this rule, and the analyzer was failing
phpunit's own fixture. **2** of the 1,080 corpus edges named a private base method.

**The filter is SAME-FILE only, and that is a deliberate decision rather than a gap.** php keys every
edge on the **leaf** name, so a name-keyed cross-file index is ambiguous whenever two namespaces
declare the same class name — and phpunit does that four times (three `TestSuite` classes, two
`Assert` classes, one of them a vendored library). Two ambiguity rules were implemented and measured
and each **suppressed correct edges** (seven, then one). So a cross-file lookup keyed on a leaf is a
guess, and a rule acting on a guess defaults to the permissive reading, which never removes a true
edge. `AnalyzeContext.overrideCompanionVisibility` is still populated and is correct; a consumer with
*qualified* identity can act on it, and this analyzer cannot while `baseClass` is a leaf.

### `overrides` is emitted only when it is verified

An `overrides` edge requires the base's declaration to be **visible** — in this
file, or via `AnalyzeContext.overrideCompanion` — and is then emitted at 0.95.

This analyzer previously also emitted a 0.5 `first-parent-guess` edge for every
method of a class whose base lives in another file, without checking that the
base declares the method. The companion index that could verify it is never
populated in production (M37.10), so in production *every* cross-file PHP
override was that guess. `script/m12/php-override-audit.ts` measured it on
`phpunit@c8d6921f`; see Verification evidence for the numbers. The guess was
removed: it sat below the 0.7 threshold, so `pool-worker` already dropped it
and it never reached the graph — it bought no real cross-file override while
manufacturing a majority-false unverified bucket. Restoring cross-file
coverage honestly means populating the companion index, not guessing.

## Supported AST shapes

- Namespaces, classes (abstract/final/static), interfaces, traits, enums
- Methods and functions with typed parameters (simple, variadic, promoted)
  and return-type hints
- Properties (typed, static, multi-declaration) and class/global constants
- Trait `use`, namespace `use` (with aliases), require/include
- Function/member/scoped/nullsafe calls, object creation, anonymous functions
- Control-flow nodes for cyclomatic complexity (if/elseif/for/foreach/while/
  do/switch/match/try/catch/conditional/`&&`/`||`/`and`/`or`)

## Verification evidence

- Independent manual ground truth: `validation/m12/ground-truth/php.json` —
  **66 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
  (`bun script/m12/verify-analyzer.ts php`)
- Fixtures: `validation/m12/fixtures/php/{BaseService,Service,Negative}.php`,
  and `validation/m14/fixtures/php/` (**22 pass / 0 fail** as of the last run;
  this document previously said 19, which had drifted)
- Mutants: **50 registered for `php/`, all 50 caught** (0 survivors). Five were added by the
  M60 master-review round: `error-report-dropped` and `error-recovery-stops` (the two halves of
  the malformed-file contract), `typed-class-const-dropped` (a capability the corpora cannot
  exercise — see below), and `override-fires-without-base-method` /
  `override-chain-walked-transitively` (the two `overrides` fabrications, neither of which any
  differential could see)
- Completeness (#419): **179 named-type entries — 159 UNIQUE named types — sections A–H 8/8**;
  `script/m14/spec/php-completeness.json` records **66 handled + 93 unique silent** (106 rows: 7
  types are listed twice or more, `string_content` eight times), **0 declared gaps**, and
  **34 adjudicated decisions (19 FIXED, 15 RULED, none pending)**.
  The 179-vs-159 gap is not a discrepancy: the wasm reports 12 named types under more than one id
  (aliases and repeat rules), so an "every type classified" count that does not dedup overstates
  the universe by 20. Deduplicated, 66 + 93 = 159 and every unique type is classified, which is
  what the gate actually asserts.
- Regex census: the analyzer contributes **0** regex usages, confirmed by the
  AST-driven project census in `validation/m12/results/regex-census.json`
  (which walks for regex literal nodes and `RegExp` constructors, so a
  `String.replace` with a string argument and a regex inside a comment are both
  correctly not counted). A naive `grep` for `\.replace(` false-positives on
  both — use the census artifact, not grep.
- Corpora (both restored at their pins, both reproducible):
  - `phpunit@c8d6921fb601b6988854cd84a672f06c1e49f80e` — 3,231 tracked `.php`
  - `phpmyadmin@4061095a59e1769128776ad24154cc7058de51aa` — 1,232 tracked `.php`
- **Differential over the FULL corpus of both repos** — not the canonical
  60-file sample, because a sample can miss a whole edge class and a full sweep
  cannot:

  | corpus | files | tree-truth | covered | missing | unexplained | heuristic |
  |---|---|---|---|---|---|---|
  | phpunit@c8d6921f | 2,907 | 39,829 | 39,829 (100%) | 0 | 0 | 0 |
  | phpmyadmin@4061095a | 1,232 | 55,402 | 55,402 (100%) | 0 | 0 | 0 |
  | **combined** | **4,139** | **95,231** | **95,231 (100%)** | **0** | **0** | **0** |

- Line-number contract (M60), audited on a 150-file strided sample:
  - **relationships: 0 of 5,830 lack `line_number` (0.00%)** — every kind
    (`calls` 1501, `uses` 2162, `contains` 904, `imports` 664, `instantiates`
    325, `references` 158, `extends` 89, `implements` 27)
  - **symbols: 0 of 1,187 lack a start or end line (0.00%)**
  - complexity is carried by **666/666 callables (100% of methods)**, sum 1,086.
    Complexity is a per-callable metric, so the 521 non-callable symbols
    correctly carry none — that is the expected shape, not a gap.
- Grammar pin: registered in `script/m14/verify-grammar-pins.ts` as
  `unnamed-build-sha-only` — sha256 `d4df6a6ff08c…`, 1,058,041 B, 432 ids /
  157 named / 31 fields, **0 php drifts**. There is no vendored source and no
  `PIN.md`, so the source↔wasm proof does not apply and the grammar is not
  rebuildable offline; that limit is recorded in the entry rather than papered
  over.
- Parse census over all 3,231 phpunit files: **2 error files, 0 crashes**, and
  both errors are intentional test fixtures (`…/parse-error/src/CannotBeParsed.php`
  and a partial-function-application `?` placeholder).
- Grammar upgrade: npm `tree-sitter-php` 0.24.2 fixed **15/17** previously
  failing files with **0 regressions** (PHP 8.4 property hooks, pipe operator,
  `new Class()->method()` dereference, readonly anonymous classes, a vendor
  fluent chain); the 2 remaining are an intentional parse-error test fixture
  and a partial-function-application `?` test fixture.
- Corpus production extraction: **3,073 symbols / 4,276 relationships** on the
  400-file tracked phpunit sample; evidence in
  `validation/m12/results/php-corpus-complexity.json`
- Grammar shape safety: **33/33** dispatch references emitted by the grammar
  (2 remaining refs `and`/`or` are anonymous operator tokens, confirmed live)

### Override audit — how the guess was measured, not assumed

`bun script/m12/php-override-audit.ts` runs the analyzer *directly* (the
`pool-worker` 0.7 threshold hides the guess bucket), resolves each guessed
base class's declaring file across the whole corpus, and asks whether that
file declares the method. Only an unambiguous, non-builtin base yields TRUE or
FALSE, so the tool cannot inflate its own false rate; builtins and ambiguous
leaves are reported separately.

On a 60-file strided sample of phpunit: **99 guess edges, 18 decidable, 12
FALSE (66.7%)**. The undecidable remainder is itself mostly false — hand-checked
cases include `TestCase.testOne`, `Subscriber.notify`, and all 9
`VariousIterableDataProviderTest.as*Provider` edges (the parent declares only
the `*ProviderInParent` methods) — so **66.7% is a floor, not a midpoint**.

Removing the guess took heuristic edges **198 → 0** on phpunit and **171 → 0**
on phpmyadmin with tree-truth coverage unchanged at 100%, confirming it
contributed no real coverage.

## The ontology, verdict by verdict (M60, re-measured)

Every number below is measured through **`parseFile`** (`src/ast/pool-worker.ts`),
never `analyze()`, over the whole admitted corpus: **4,642 git-tracked `.php`
files ≤ 512 KB** across `phpunit` (3,231), `phpmyadmin` (1,232), `slim` (125),
`pb-grpc` (20), `cloogle.org` (17), `nvim-treesitter` (13), `caddy` (3),
`FSharp.Formatting` (1). Sampling: **none** — the census harness walks the
admitted set whole, so every denominator is the admitted set minus whatever the
run excluded, and this run excluded **1** file (see `filesAnalyzed` below).
Reproduce with
`BB_WORKERS=3 BB_ALLOW_FALLBACK=1 BB_JSON=1 npx tsx validation/m14/fixtures/php/census-harness.mts`;
the artifact is `validation/m60/php/ontology-census.json`.

### The denominator, and the one file that is not in it

`filesAdmitted` **4,642**, `filesAnalyzed` **4,641**. The difference is
`phpunit/tests/unit/Framework/Constraint/Math/IsNanTest.php`, where
`parser.parse()` threw a wasm *memory access out of bounds* and `pool-worker`'s
catch served the file from `extractFallback` — a **regex** extractor. The census
counts those files, names them, excludes them from every tally, and **exits 3**
rather than publishing (`BB_ALLOW_FALLBACK=1` is the only way to publish a
degraded run, and it records `filesAnalyzed` in the artifact). The first version
of this harness did `if (r?.fallback) continue` with no counter, which is a
silently smaller corpus reading as an untruncated one.

**The excluded file is not the same file on every run.** Across four runs of the
corpus walk the fallback set was `…/tomasvotruba/type-coverage/src/Formatter/TypeCoverageFormatter.php`
+ `…/Configuration/ScopeConfigurationResolver.php` (2 files), then
`tests/unit/Framework/Constraint/Math/IsNanTest.php` (1), then
`src/Event/Events/TestSuite/Loaded.php` (1). It is a heap- or timing-dependent
wasm fault, not a property of one file, and it moves the totals by a handful of
edges between runs: `uses` read 133,419 / 133,425 / 133,410 and `imports`
25,914 / 25,922 / 25,914 on three consecutive walks. Any cross-run edge-count
comparison for this lane is therefore noise below ~15 edges, and the gate's own
walk does not exclude fallback files at all, which is why its `imports` row reads
25,922 against this harness's 25,914.

### Verdicts

| type | verdict | count | files | note |
| --- | --- | --- | --- | --- |
| `uses` | EMITTED | 133,419 | 3,151 | largest label |
| `calls` | EMITTED | 94,492 | 3,436 | |
| `contains` | EMITTED | 30,454 | 4,000 | **DERIVATION** |
| `imports` | EMITTED | 25,914 | 3,975 | **DERIVATION** |
| `instantiates` | EMITTED | 10,612 | 1,568 | |
| `references` | EMITTED | 8,675 | 2,133 | truth derived from the analyzer — see §5c |
| `extends` | EMITTED | 2,819 | 2,803 | |
| `implements` | EMITTED | 1,000 | 972 | |
| `exports` | EMITTED | **57** | 17 | was RULED; **the ruling was falsified** — see below |
| `overrides` | EMITTED | **2** | 2 | the count is the finding — see below |

**Ten emitted, none ruled**, and the arbiter agrees. `script/m14/php-ruled.ts` is
the lane's ruling table and it is **empty**, because the one row it held was
withdrawn and a row for an emitted type is a false claim. Wiring it into
`ontology-coverage-gate.ts` is a two-line shared change (§8); the lane's own
`validation/m14/fixtures/php/ruled-gate.ts` applies those two lines to a **copy**
of the gate and runs the copy:

```
ontology coverage gate — php
type          status            detail
calls         EMITTED           94,523 edges in 4+ files, e.g. FSharp.Formatting/…, cloogle.org/frontend/api.php
uses          EMITTED           133,415 edges in 4+ files, …
contains      EMITTED           30,452 edges in 4+ files, …
imports       EMITTED           25,922 edges in 4+ files, …
references    EMITTED           8,675 edges in 4+ files, …
exports       EMITTED           57 edges in 4+ files, e.g. FSharp.Formatting/…, cloogle.org/frontend/api.php
extends       EMITTED           2,820 edges in 4+ files, …
implements    EMITTED           1,000 edges in 4+ files, …
overrides     EMITTED           2 edges in 2+ files, …
instantiates  EMITTED           10,620 edges in 4+ files, …
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
exit code 0   (623s)
```

The gate's own counts differ from this harness's by a few edges on five types
(`imports` 25,922 vs 25,914, `calls` 94,523 vs 94,492) because the gate does not
exclude fallback-served files. Both are reported rather than reconciled.

The corpus-wide symbol total is **35,148** (`method` 20,266 / `property` 5,168 /
`namespace` 4,455 / `class` 4,238 / `function` 316 / `constant` 315 /
`interface` 208 / `enum_member` 125 / `enum` 42 / `trait` 15), with **0** empty
names, **0** `SymbolKind` values outside the enum, and **26** relationship
endpoints equal to the literal `unknown` — all of them real phpunit symbols
*named* `unknown` (`TestSize::unknown`, `TestStatus::unknown`), which is why they
are counted here rather than fixed.

### `exports` — the ruling that was falsified, and what replaced it

This section replaces one that said `exports` was **RULED**. That ruling was
wrong, and the way it was wrong is the most transferable thing in this document.

The ruling rested on Instrument B, a parse-tree count, and it read:

| probe | construct | occurrences (as ruled) | occurrences (measured now) |
| --- | --- | --- | --- |
| P3 | `class_alias` / `function_alias` call | 0 | **0** |
| P4 | `define('NAME', …)` with a literal first argument | **0** | **60** in 20 files |
| P1a | `use function`/`use const`, **unqualified** target | 6,140 | 6,140 |
| P1b | `use function`/`use const`, **qualified** target | 12 | 12 |
| P2a | file-level `return`, no named value | 2 | 2 |
| P2b | file-level `return`, naming a value | 28 | 28 |

P4's zero was **vacuous**: the probe could not fire on any input. It read
`arguments.namedChild(0)` and tested that node for `string` / `encapsed_string`,
and tree-sitter-php puts an `argument` node in between:

```
function_call_expression
  name "define"
  arguments
    argument           <- what namedChild(0) returned
      encapsed_string  <- the node the test wanted
```

So the test compared an `argument` node against two string node types and never
matched. **No corpus could falsify that number, because no corpus makes it
non-zero** — which means the ruling's own stated overturn condition ("P3 > 0 or
P4 > 0 on any admitted corpus") was unreachable: falsifiable in form, unfalsifiable
in fact.

What found it was a **positive control**, not a bigger sample.
`validation/m14/fixtures/php/exports-probe-controls.mts` builds seven files, one
per construct, and asserts every probe fires. `define("X", 1);` read 0. The same
defect was in both copies of the probe, so the controls also assert the two agree
counter-for-counter — two copies of one falsifier drift, and a drift that makes
both read 0 looks like agreement. 21 controls, all passing, in seconds, with no
corpus. Artifact: `validation/m60/php/exports-probe.json`.

**What is implemented** (`emitDefineExports`, `src/ast/real-php-analyzer.ts`).
Three grammar tests, no text matching anywhere:

1. the callee is **exactly** the bare name `define` — a `Foo\define` or a variable
   callee is a different function;
2. the first argument's **value** node is a `string` / `encapsed_string`, read
   **through** the `argument` wrapper. `define($n, …)` publishes a name nobody can
   write down; measured **1** in the corpus and deliberately left unemitted rather
   than given an invented endpoint;
3. the call is at **file scope** — no enclosing function, method, closure or class.
   A `define()` in a body publishes the name only if that function runs, so an edge
   from the file would assert something the file does not guarantee. Measured **11**
   such calls, all excluded. A top-level `if` is deliberately **not** a scope: it
   executes when the file is included, so it does publish.

Measured population: **60** literal-name `define()` calls in 20 files, of which
**57** are at file scope — the `exports` edges — and **11** are inside a function
body. The 57 is cross-validated by a **second, independent implementation** of the
file-scope rule written directly against the wasm, which reads the same 57; the
8-edge gap against the old conservative count of 49 is exactly the defines inside
top-level `if` / `while` / `switch` blocks, listed by file and line in the probe
run. The excluded fallback file contains no `define(` at all, so the two
implementations were compared over the same effective population.

Each published name also gets a **`constant` symbol**, because an edge needs an
endpoint that resolves: `define('CLEANHOME', …)` writes no declaration anywhere, so
without a symbol the target would resolve to nothing. That symbol carries **no**
`ownerName` on purpose — PHP resolves the name it writes against the **global**
scope even inside a namespace — so it gets no `contains` edge, which is the
labelling line `php/define-exports` forbids crossing. Confidence **1.0**,
`evidenceClass` `import_based`: three grammar facts and no name matching, so there
is no heuristic here to be honest about. **`exports` heuristic (< 0.7) count: 0.**

**Resolution, measured:** 48 distinct targets, **48 exact-tier (100%)**, of which
43 resolve to exactly **one** published declaration and **5** resolve to more than
one — `ROOT_PATH` (5 declarations), `CLEANHOME` (3), `CACHE_DIR` (2),
`VERSION_SUFFIX` (2), `TESTSUITE` (2), which is 14 of the 57 edges. **Zero**
unresolvable. So every `exports` target the graph asserts is a declaration the
analyzer published.

**The source end does not resolve, and that is a lane-wide shape.** All 57 edges
read `global -> NAME`, the spelling PHP's other two file-scoped edge types already
use (`emitUseClause`, `emitInclude`), so `imports` and `exports` have one owner
convention for the file-level reader at `src/lsp/graph_request.ts:256`.
`global` is not a published symbol, so `from`-resolution is **0.00%** on both
types — 25,914 `imports` edges and 57 `exports` edges with no source a reverse walk
can attribute to a file. `metadata.file` carries the file identity for any consumer
that needs it. Changing the spelling for `exports` alone would have made the two
file-scoped types inconsistent inside one analyzer, so the cost is reported instead
(§8, item 2).

**P1b is still not an edge, and the reason is resolution.** 12 qualified
`use function` / `use const` occurrences, 4 distinct targets
(`FastRoute\simpleDispatcher`, `Foo\FOO`, `Foo\foo`,
`PHPUnit\TestFixture\Generator\f`); **all 4** are already published as `imports`
targets, and 3 of the 12 have the imported leaf declared by the same file — all in
one nvim-treesitter grammar **query fixture**, where the "re-export" is a
self-import of the file's own function. For the other 9 an `exports` edge would
have to point into a namespace that is not in the corpus, which is the
hopeless-target failure. Not emitted; counted here; overturned by a corpus where
the target namespace is present.

**P2b is a convention, not a construct.** 28 file-level returns naming a value:
19 are composer's own vendored autoload files (`return array(…)`), 9 are one
nvim-treesitter indent-test fixture with deliberately broken syntax. Every one
returns an **anonymous array**, so there is no name for an edge to point at. The
fixture's `return new Circle('mod', 1.0);` already produces
`instantiates global -> Circle`, so the construction is not lost.

### The six questions, per emitted type

**5. RESOLVED.** Two measurements, because they answer different questions. The
first resolves an endpoint against **the file's own** symbol set; the second
resolves a **distinct target** against every declaration in the corpus. PHP keys
every edge on the **leaf** name, so a cross-file label's per-file rate is the shape
of the language, not a defect — `contains` is the only label whose per-file rate
means anything, and it is 100.00%.

| type | `from` resolved | `to` resolved | both | distinct targets | distinct targets naming a corpus declaration |
| --- | --- | --- | --- | --- | --- |
| `contains` | 100.00% | 99.99% | **100.0%** | 16,835 | 16,833 (100.0%) |
| `overrides` | 100.00% | 100.00% | 100.0% | 2 | 2 (100.0%) |
| `exports` | **0.00%** | **100.00%** | 0.0% | 48 | **48 (100.0%)** |
| `calls` | 99.62% | 10.44% | 10.4% | 6,395 | 5,558 (86.9%) |
| `instantiates` | 99.64% | 2.81% | 2.8% | 1,506 | 1,289 (85.6%) |
| `extends` | 100.00% | 0.32% | 0.3% | 170 | 144 (84.7%) |
| `references` | 98.48% | 4.81% | 4.8% | 971 | 792 (81.6%) |
| `implements` | 100.00% | 0.00% | 0.0% | 128 | 100 (78.1%) |
| `imports` | **0.00%** | 0.19% | 0.0% | 2,936 | 2,011 (68.5%) |
| `uses` | 99.54% | 16.27% | 16.2% | 8,455 | 2,861 (33.8%) |

Two instrument defects were found by reading this table, and both are worth
naming because each would have read as a finding about the analyzer:

- **`import` / `export` symbols were counted as declarations.** The analyzer
  publishes a symbol per `use` clause, so every imported class scored one
  declaration per importing file. A reference is not a declaration.
- **Resolution took the max over the exact / first-segment / last-segment
  spellings, which manufactured ambiguity out of namespaces.** PHP publishes a
  `namespace` symbol in every file that declares one, so the `imports` target
  `PhpMyAdmin\Advisory\Advisor` matched **65** declarations of the name
  `PhpMyAdmin` and read as 65-way ambiguous; 1,845 of 2,936 distinct `imports`
  targets read ambiguous. Nothing was ambiguous — one class is declared, under the
  leaf name PHP gives it. Resolution is now reported by **tier** and only a
  declaration the target actually names counts: `imports` distinct-target
  ambiguity fell from 1,845 to **205** and its edge-resolution rose from 1,162 to
  **15,176**. An instrument that overstates a lane's ambiguity is as wrong as one
  that understates its resolution.

**`imports` at 0.00% per-file is a real finding, not a footnote.** Both endpoints
are file-scope identities, not symbol identities: the source is the literal
`"global"` and the target is an FQN (`Illuminate\Support\Facades\Route`) while
class symbols are spelled by leaf. The analyzer emits **no `module` or `file`
symbol for PHP at all** — the kind census has no `module` row — so there is
nothing for either endpoint to bind to *within its own file*.

**6. CONFIDENT.** Confidence is bimodal and **the heuristic (< 0.7) count is 0 for
all ten types**, so `pool-worker`'s 0.7 filter drops **0** PHP edges and no PHP edge
is a guess:

| type | confidence histogram | `< 0.7` |
| --- | --- | --- |
| `contains` | `1.0: 30,454` | 0 |
| `extends` | `1.0: 2,819` | 0 |
| `implements` | `1.0: 1,000` | 0 |
| `exports` | `1.0: 57` | 0 |
| `imports` | `1.0: 25,723`, `0.9: 191` | 0 |
| `overrides` | `0.95: 2` | 0 |
| `calls` | `0.9: 94,492` | 0 |
| `uses` | `0.9: 133,410`, `1.0: 9` | 0 |
| `references` | `0.9: 8,675` | 0 |
| `instantiates` | `0.9: 10,612` | 0 |

Per honesty-contract §4 the below-1.0 edges are countable by class: the 0.9s are
*usage-contextual* (`calls`, `uses`, `references` — a syntactic AST shape with
builtin filtering, not resolved dispatch) or *import-based* (the 191 `imports`
include paths, and `exports`), and the two 0.95 `overrides` are *structural*. The
9 `uses` edges at 1.0 are trait-`use` composition (`isTraitUse`), a declaration
fact.

**1–4. EXISTS / FIRES / CORRECT / LABELLED.**

*Exists* — derivable from source at the emission sites above. *Fires* — every one
of the ten types is non-zero on the whole admitted corpus, so no type is reachable
only from a branch the corpus never satisfies; this is the question a source count
cannot answer, and `exports` is the case in point: its type was constructible in
the source for the whole round before it was ever true on the corpus.

*Correct* — `npx tsx script/m14/differential.ts --lang php --sample 40`:

```
[phpunit]     php: files=40 tree-truth=426  covered=426 (100%)   MISSING=0 | analyzer-edges=408  unexplained=0 (0%) heuristic=0
[phpmyadmin]  php: files=40 tree-truth=1768 covered=1768 (100%) MISSING=0 | analyzer-edges=1747 unexplained=0 (0%) heuristic=0
```

> **The limitation, stated because it is larger than the usual one.** The oracle
> is a separate walker over the same pinned wasm, so a grammar-level defect shared
> by both paths is invisible to it. For PHP that is not the only sharing:
> `script/m14/differential.ts` imports `PHP_BUILTINS`, `phpDeclaredTypeRefs`,
> `phpStaticIncludePath` and `phpStaticCallableName` **from the analyzer itself**,
> and `derivePhpDeclaredTypeEdges` builds the entire `references` truth set by
> calling the analyzer's own `phpDeclaredTypeRefs`. So `references` correctness is
> **not independently testable at all** — the truth is the analyzer. `calls` and
> `uses` share the callee-name rule and the builtin set by design. Only `extends`,
> `implements`, `instantiates` and `overrides` are derived by a genuinely separate
> walker.

*Labelled* — the label confusions this codebase already knows about are carried by
metadata flags counted per edge rather than asserted: 11 distinct `uses` flags
(`isMemberRead`, `isLocalRead`, `isTraitUse`, `isConstFetch`, `isMemberWrite`, …),
`relationshipType` on every `imports`/`exports` edge (`use_clause`,
`include_path`, `define_call`), `isContained` on `contains`, and `isOverride` on
`overrides`. The confusion this round added a pin for is `exports` vs `contains`:
a `define()`d name is published, never contained, and `php/define-exports`
forbids the `contains` row with that note.

### DERIVATION: 3 types, 56,425 edges, 18.4% of the lane, compared against nothing

A DERIVATION finding is a type the analyzer emits that the differential never
audits — stored, and compared against no truth rows. Measured, not read off the
oracle's comment: `derivePhpEdges` was called directly over a **234-file** strided
draw (60/repo across all 8 repos, 0 unreadable) and its output tallied by label.

| type | truth rows from `derivePhpEdges` | verdict |
| --- | --- | --- |
| `uses` | 1,720 | audited |
| `calls` | 1,665 | audited |
| `instantiates` | 284 | audited |
| `extends` | 115 | audited |
| `implements` | 44 | audited |
| `references` | 5 | audited, but truth derived from the analyzer |
| `overrides` | 1 | audited |
| `contains` | **0** | **DERIVATION** — 30,454 edges |
| `imports` | **0** | **DERIVATION** — 25,914 edges |
| `exports` | **0** | **DERIVATION** — 57 edges |

This is corroborated from the other side: the differential's compared-label filter
(`differential.ts:23153`, `:23186`, `:23434`) admits `extends`, `implements`,
`instantiates`, `overrides`, `calls`, `uses`, `references` for `php` and nothing
else, so the three types above are not merely unaudited — they are excluded from
the `unexplained` count, which is why `unexplained 0` says nothing about them.
**56,425 of 307,444 edges (18.4%) are in that blind spot**, and `exports` — the
type this round added — is one of the three.

Paying them down needs an oracle, and the oracle lives in shared
`script/m14/differential.ts`, so it is a §8 item and not this lane's edit. The
lane-side half is done: `exports` correctness is checked by a **second independent
implementation** of the file-scope rule against the wasm, agreeing 57/57 with the
analyzer's emitted count over the same population, and by 3 injected mutants that
the fixture suite catches.

### INCOMING: what the graph can walk TO

`src/lsp/impact.ts` obtains reverse edges by **scanning outgoing edges and matching
targets** — no inbound edge is stored — so the reverse walk is exactly as good as
the target-matching, and these are properties of the edges, not of the traversal.
Resolution is reported by **tier**: `exact` (a declaration is named exactly this),
`leaf` (named by the target's last segment — how PHP actually names classes and
functions, so this is the *correct* match for a qualified name, not a weakening),
`rootOnly` (only the namespace root matches — **not** a resolution) and `none`.

| type | tier exact / leaf / rootOnly / none | distinct targets 1 / 2+ / 0 | **edges** 1 / 2+ / 0 | unresolved split (root / ns / leaf / path) |
| --- | --- | --- | --- | --- |
| `uses` | 2,861 / 0 / 0 / 5,594 | 1,777 / 1,084 / 5,594 | 16,486 / **75,724** / 41,209 | 0 / 0 / 5,594 / 0 |
| `calls` | 5,558 / 0 / 0 / 837 | 3,834 / 1,724 / 837 | 24,140 / **59,428** / 10,924 | 0 / 0 / 837 / 0 |
| `imports` | 1,711 / 196 / 104 / 925 | 1,702 / 205 / 1,029 | 15,176 / 2,870 / 7,868 | 104 / 247 / 676 / 2 |
| `contains` | 16,833 / 0 / 0 / 2 | 14,006 / 2,827 / 2 | 14,006 / 16,445 / 3 | 2 / 0 / 0 / 0 |
| `instantiates` | 1,289 / 0 / 0 / 217 | 1,060 / 229 / 217 | 6,060 / 3,375 / 1,177 | 0 / 0 / 217 / 0 |
| `references` | 792 / 0 / 0 / 179 | 635 / 157 / 179 | 5,461 / 1,868 / 1,346 | 0 / 0 / 179 / 0 |
| `extends` | 144 / 0 / 0 / 26 | 125 / 19 / 26 | 571 / 2,199 / 49 | 0 / 0 / 26 / 0 |
| `implements` | 100 / 0 / 0 / 28 | 70 / 30 / 28 | 432 / 325 / 243 | 0 / 0 / 28 / 0 |
| `exports` | **48 / 0 / 0 / 0** | 43 / 5 / **0** | 43 / 14 / **0** | 0 / 0 / 0 / 0 |
| `overrides` | 2 / 0 / 0 / 0 | 1 / 1 / 0 | 1 / 1 / 0 | 0 / 0 / 0 / 0 |

**Ambiguity is the headline, and it is per EDGE because `bb_impact` walks edges.**
`uses` sends **75,724 of 133,419** edges (56.8%) at a target matching more than one
published declaration, and `calls` **59,428 of 94,492** (62.9%). The worst
single-name cases are `__construct` (1,165 declarations), `getName` (90),
`execute` (35). PHP's own design produces this: an edge is keyed on the leaf name,
so `runTest` is a method on many classes at once, and the reverse walk must pick
one by a rule nobody chose. **Counting an ambiguous target as N is how a name
collision becomes wrong refactoring advice, so this round counts it separately
rather than inside "resolved".** Nothing in this lane's control can fix it: the
edge does not carry the owner. Where the owner is recoverable from the tree
(`$this->`, `self::`, `static::`, `parent::`) a qualified target would disambiguate,
and that is a §8-shaped question about how much `calls` volume to re-spell.

**External vs never-indexed — separated as far as the graph allows.** The two look
identical in a count and are opposite findings, so the unresolved population is
split by declared tests:

| type | unresolved | namespace-qualified, undeclared root | bare leaf, nothing declares it | …targeted from ≥2 repos | …targeted from 1 repo |
| --- | --- | --- | --- | --- | --- |
| `uses` | 5,594 | 0 | 5,594 | 258 | 5,336 |
| `calls` | 837 | 0 | 837 | 124 | 713 |
| `imports` | 1,029 | 247 | 676 (+ 104 rootOnly, 2 path) | 236 | 440 |
| `instantiates` | 217 | 0 | 217 | 18 | 199 |
| `references` | 179 | 0 | 179 | 22 | 157 |

The last two columns are the separation, and it is a **boundary, not a solution**:
a name called from ≥2 independent repos that neither declares is cross-repo
evidence of an external library or a builtin; a name called from exactly **one**
repo cannot be told apart from a declaration this analyzer failed to publish. The
first version of this split asked how many repos *declare* an unresolved name —
which is zero for every unresolved name, so the whole population fell in one bucket
and the split could not separate `isset` from a name of ours. Asking who *targets*
it can. The 713 one-repo `calls` leaves are where an indexing miss would live, and
they are not individually adjudicated: that is a limitation, not a clean bill.

Spot-checked on the `imports` rows, which name the file: `Google\Protobuf\Internal\GPBType`
← `pb-grpc/examples/php/Helloworld/HelloReply.php`, `Psr\Clock\ClockInterface` ←
`phpmyadmin/app/services_controllers.php`, `Baz` ←
`nvim-treesitter/tests/query/highlights/php/namespaces.php`. All three are external
to the declarations the analyzer published — a vendored protobuf runtime, a PSR
interface, a grammar fixture's own namespace.

### `overrides` — 2 edges is the finding, not a rounding error

Both are in **test fixtures**, not application code:
`nvim-treesitter/tests/query/highlights/php/keywords.php:61` (`B.foo -> A.foo`, a
tree-sitter highlight-query input) and
`phpunit/tools/.phpstan/vendor/tomasvotruba/type-coverage/…/SkipConstruct.php:9`
(`SkipConstruct.__construct -> ParentConstructorClass.__construct`, a vendored
phpstan fixture). The reason is a **shared-machinery** gap, not an analyzer one,
and it is a four-link chain, each link read from source:

1. `real-php-analyzer.ts:1777-1778` emits `overrides` when
   `inFileMethods?.has(name) || context?.overrideCompanion?.get(base)?.has(name)`
   — the construct **is** read, and the same-file half works
   (`php/namespace-containment` and `php/cross-file-override` both pin
   `Circle.__construct -> Base.__construct` at 0.95).
2. `pool-worker.ts:1212` `contextFor()` returns `{ projectIndex }` and **never**
   `overrideCompanion`, so the cross-file channel is empty.
3. `parallel-indexer.ts:1300` `PROJECT_INDEX_EXTENSIONS = { ".sol": "solidity" }`
   — `.php` is not in it, so no project index is built for PHP at all.
4. `parallel-indexer.ts:1094` calls `parseFile(file, projectPath)` with no context.

The corpus says the same from the other side:
`validation/m14/fixtures/php/overrides-probe.mts` over all 4,642 files: **2,807**
classes carry a declared base, **0** of them have that base in the same file (so
**S = 0** same-file opportunities corpus-wide — 2 is not achievable and 2 is what
fired), and against a companion built from the whole corpus **C = 0** opportunities,
so the false-rate is unmeasurable. No analyzer edit can close this; it needs steps
2–4.

### What is not settled, and what needs a shared file

**1. The php oracle still derives the pre-M12 label for include paths, which is
the whole of the differential's 16 MISSING edges.** `script/m14/differential.ts`,
function `derivePhpEdges`, the `require_once_expression` /
`include_expression` / `require_expression` branch at **:12141-12146**:

```ts
// Mirror the analyzer's emitInclude: references -> the include path
const p = extractPhpIncludePath(n)
if (p) push("references", p)
```

It must be `push("imports", p)`. `emitInclude` was changed in M12.PHP-IMPORTS
(`real-php-analyzer.ts`, `source: "global"` branch) to file the include path as
`imports` precisely because a file-level edge mislabelled `references` stayed
out of `src/lsp/graph_request.ts:256`'s
`relationship_type IN ('imports','exports')` reader. The oracle was not moved
with it. **Measured:** all 16 MISSING rows in a 600-file two-repo draw are
exactly this shape — `references (expr) -> __DIR__/../src/Covered.php`,
`references (expr) -> ROOT_PATHapp/constants.php`. This also falsifies **PHPD3**,
whose text claims "The differential oracle mirrors this split exactly."

The second half of the fix is the allowlist: `contains` and `imports` are not in
`php`'s compared-label set (`differential.ts:23153`, `:23186`, `:23434`), so
correcting the label alone would still filter both off. Both need adding.

**2. `derivePhpContainsEdges` does not exist**, though
`script/m14/completeness-inventory.ts:1022` and this document's own §M60 entry 1
both describe it as having fixed the `contains` audit. Writing it is a
`differential.ts` change: derive `owner|member` containment from PHP's own
declaration structure, sharing no rule with the analyzer, and add `"contains"`
(and `"imports"`) to php's compared-label set. Until then **`contains` — now the
third-largest label at 30,315 edges — is stored and compared against nothing**,
and `script/m14/oracles/` has no php oracle of any kind.

**3. `php/drop-external-override-guess` is a stale no-op mutant and it fails the
mutation gate.** `script/m14/mutate-analyzer.ts:18402-18413` filters an edge
`AuditService.handle -> ExternalBase.handle` that M12.PHP-OVERRIDE-AUDIT removed
from the analyzer, so the transform changes nothing and it always survives:
`BB_MUTANT_ONLY="php/" bun run script/m14/mutate-analyzer.ts` prints
`SURVIVED php/drop-external-override-guess (0 -> 0 failures)` and exits 2, i.e.
the gate reports "the suite cannot detect real defects" for a lane whose other 12
mutants are all caught. It needs `retired: true`, the treatment
`python/drop-external-override-guess` received — and the comment block at
`:10816-10826` explains that treatment in exactly these terms ("A mutant that
removes code which is not there is a no-op that always SURVIVES, and it survived
for a long time before anyone read why — which is the more expensive half of a
stale test"), which is why this one is worth retiring rather than tolerating.
The replacement already exists and **is** caught:
`php/re-add-external-override-guess` (`:10803`), which injects the guess rather
than removing it, so it can fail.

**4. `parseBomb` makes a whole-corpus sweep non-completable in one process.**
`src/ast/engine.ts:1408-1413` arms a 120 s timer around the synchronous
`parser.parse()` and calls `process.exit(1)`, because `setTimeout` cannot
interrupt blocked C/WASM. The comment says "the indexer is incremental", which is
true for the indexer and false for any lane instrument that sweeps the corpus
in-process. **Measured:** the first full-corpus run of this lane's own overrides
probe died; a retry loop then took **8 attempts and was killed on 8 different
files** — so the kill is a concurrency artifact of the sweep (8 workers over
4,621 files), not a property of any file. At `BB_WORKERS=2` the same sweep
completes. No change is strictly required, but `BB_FILE_TIMEOUT_MS` is honoured
for the worker pool and **not** here, so the two paths disagree about when a file
is too slow.

**A second, sharper defect in the same six lines, found this round, and it is not
about concurrency at all.** `src/ast/engine.ts:1446-1447` is

```ts
const tree = parser.parse(content)
clearTimeout(parseBomb)
```

— `clearTimeout` is **not** in a `finally`. So when `parser.parse()` **throws**,
the 120 s timer stays armed, and it fires 120 s later on a run that has long since
moved on to a different file. `pool-worker.ts:1136-1148` catches the throw and
serves that file from `extractFallback`, a **regex** extractor, so one wasm fault
both degrades a file's edges and arms a process-wide kill.

**Measured on this lane's corpus:** four walks, four different files —
`phpunit/tools/.phpstan/vendor/tomasvotruba/type-coverage/src/Formatter/TypeCoverageFormatter.php`,
`…/Configuration/ScopeConfigurationResolver.php`,
`phpunit/tests/unit/Framework/Constraint/Math/IsNanTest.php`,
`phpunit/src/Event/Events/TestSuite/Loaded.php` — each preceded by
`[BB-PARSE-ERR] php | <file> | memory access out of bounds`. The arbiter's own php
walk **died at 636 s** on the fourth of these with
`[BB-HANG] parser stuck 120s on …/TestSuite/Loaded.php — exiting`, after spending
the whole corpus walk and printing no verdict rows. It is heap- or
timing-dependent, so it is not one bad file, and **no corpus walk in this
repository is reliably completable in one process** while the timer is armed
outside a `finally`.

The fix is one line, and it is the same change this lane applied to a **copy** of
the arbiter to get a verdict out of it at all (written out in
`validation/m14/fixtures/php/ruled-gate.ts`):

```ts
let tree
try { tree = parser.parse(content) } finally { clearTimeout(parseBomb) }
```

It is reported rather than applied: `src/ast/engine.ts` is shared machinery (§8).
What this lane *did* do is make the failure visible rather than silent — the
census counts `parseFile`'s `fallback: true` per file, names the files, excludes
them, and **exits 3** instead of publishing a corpus that is quietly smaller.

**Settled and not a defect, recorded because it looked like one:** 26 edges have
an endpoint equal to the literal string `unknown`, which reads as a placeholder
breaching the "no `unknown` endpoints" rule. It is not. **24 of the 26** resolve
to a symbol declared in the same file, and the other 2 have the real symbol on
the *source* side. Every one is phpunit's own factory methods named `unknown` —
`PHPUnit\Framework\TestSize\TestSize::unknown()`,
`TestStatus::unknown()`, `Collation::buildDescription()` reading
`$this->description` — so `contains TestSize -> unknown` is a correct edge to a
method that genuinely exists, and `instantiates unknown -> Unknown` is a correct
`new Unknown` in `PHPUnit\Framework\TestSize\Unknown` declared in another file of
the same namespace. A "no literal `unknown` endpoint" rule is **wrong for PHP**
and would have to be name-aware to be usable.

**5. `ontology-coverage-gate.ts` needs two lines to stop refusing `php`,** and
until they land the arbiter cannot report this lane at all. The file is
supervisor-owned (§8), so this is the change, written out:

```ts
import { PHP_RULED } from "./php-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { php: PHP_RULED, bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED }
```

`PHP_RULED` is **empty** (`script/m14/php-ruled.ts`) — all ten types are EMITTED,
and a row for an emitted type is a false claim. Applied to a copy, the gate prints
`emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0` and
exits 0. Note the arbiter does **not** exclude `parseFile`-fallback files, so its
counts run a few edges above this lane's (its `imports` 25,922 vs 25,914); if the
supervisor wants the two comparable, the gate needs the same fallback accounting
the census harness now has.

**6. PHP's file-scoped edges carry the source `global`, so no reverse walk can
attribute them to a file.** All 25,914 `imports` and 57 `exports` edges read
`global -> NAME`; the analyzer publishes **no `module` or `file` symbol for PHP at
all**, so `from`-resolution is 0.00% on both types (the kind census has no
`module` row). This lane kept the spelling because `emitUseClause` and
`emitInclude` already use it and one analyzer should not file the same
file-level kind at two owners, and added `metadata.file` to the new `exports`
edges so a consumer has the identity. Whether `global` should become the file's
relative path — and what that costs a reader that filters on
`relationship_type IN ('imports','exports')` (`src/lsp/graph_request.ts:256`) — is
a shared decision, and it is the same decision for 25,914 edges that predate this
round.

**7. Three types need oracles this lane cannot add: `contains` (30,454 edges),
`imports` (25,914) and `exports` (57).** Measured in §DERIVATION above: 56,425
edges, 18.4% of the lane, produce no truth rows and are excluded from the
`unexplained` count, so a green differential says nothing about them. Writing the
oracles is a `script/m14/differential.ts` change (shared, §8). The lane-side half
is done — `exports` is cross-checked by a second independent implementation of the
file-scope rule (57/57 agreement) and by 3 injected mutants the fixture suite
catches — but a lane-owned cross-check is not the same instrument as a shared
differential that every draw runs.

**8. `script/m14/php-mutants.ts` needs one import and one spread to run.** The
lane's 3 `exports` mutants live in a registry nothing imports, which is the
"finished-but-unconnected" shape `script/m60/scss-mutants.ts` records in its own
header:

```ts
import { PHP_MUTANTS } from "./php-mutants"
// and `...PHP_MUTANTS` inside the MUTANTS array
```

Until then they run only through `npx tsx validation/m14/fixtures/php/mutant-check.mts`,
which imports the transforms and evaluates the fixtures with the production
`matchConstraints`: **3 of 3 caught, clean baseline 0 problems**.

### Payload

The namespace round adds **4,723** `contains` edges to a 25,592-edge label
(**+18.45%** on `contains`) and **+1.57%** to the corpus total (301,343 →
306,066), with **every other label at +0**. `contains` moves from 4th-largest to
3rd-largest and is still well under `uses` (132,591) and `calls` (94,227), so no
lane's *largest* label — the one an un-narrowed `bb_graph` walks first — changed.
The A/B is in the table under "Namespace containment". No shared budget file was
re-baselined, and no budgeted lane was measured as regressed, because this lane
does not own one; `bb_graph`'s default expansion was **not** re-measured, so the
+18.45% on `contains` is stated here as an edge count and not as a latency
figure — measuring that needs a budgeted lane's harness and a quiet machine, and
guessing it from an edge count would be the dishonest direction.

## Complexity and limitations

The extraction walk is iterative and linear in AST nodes; contains edges are a
single post-pass and overrides use maps/sets. There is no O(n²) symbol or
relationship lookup.

PHP is dynamically dispatched: ordinary calls are emitted by syntactic AST
shape and builtin filtering, not by pretending runtime call resolution is
knowable. Cross-file override precision requires the optional project companion
index; absent that context, the analyzer remains deterministic and uses
declarations available in the current file — and emits **no** `overrides` edge
rather than guessing one (see the audit above).

### Known gaps

**The lane declares 0 gaps** (`script/m14/spec/php-completeness.json`: `gap.gaps = []`).
The Verification-evidence block above used to say "2 declared gaps", which contradicted this
section of the same document; the two below are the constructs that were once filed as gaps and
are now adjudicated `RULED`, i.e. deliberate language boundaries rather than forgotten work:

1. **PHPD31/PHPD32 — HTML/text interpolation outside `<?php` blocks** — `php_tag`,
   `text_interpolation`, `encapsed_string`, `heredoc`, `nowdoc`. The interpolated HTML is not
   PHP and its `$var` slots are not PHP symbols, so they are outside this analyzer's contract.
   The in-PHP string-interpolation cases that matter for value flow (`"hello $name"`,
   `"{$o->p}"`) **are** handled and are adjudicated in the spec.
2. **ini directives and hash-bang lines** — `ini_section`, `ini_entry`, `preprocessor`,
   `shell_comment`, `hash_bang_line`. Configuration and shell, not PHP declarations.
3. **PHPD33 — an `exports` kind is ruled OUT.** The wording in the spec ("PHP has no export
   syntax") is **not** the basis and is not sufficient: the gate's own header records that ruling
   a convention on a grammar inventory is unsound, because a convention is not a node. The
   measurement that carries the ruling is Instrument B in
   §"`exports` is RULED, and what would overturn it" — **P3 = 0 and P4 = 0** over all 4,621
   admitted files, **P1b = 4 distinct** qualified re-export targets of which 3 the analyzer
   already publishes, and P2b = 28 file-level returns of which 19 are composer's vendored
   autoload convention and 9 are one grammar indent-test fixture. Overturn conditions are stated
   with it.
4. **Namespace-level dynamic dispatch is unresolved, and unresolvable from one file.** PHP
   resolves an unqualified class name against the current namespace first and falls back to
   global. The analyzer records `use` clauses as `imports` (the declared preference) and does not
   use them to rewrite call or instantiation targets, so `calls`/`instantiates` targets are leaf
   names that may name the wrong class when two namespaces declare the same leaf. That is
   deliberate — it is the same leaf-keyed ambiguity that makes cross-file `overrides`
   unresolvable — and it is the single largest source of the `to`-resolved rates in §"The six
   questions".
5. **`contains` and `imports` are unaudited.** Both are emitted in volume (30,315 and 25,900
   edges) and the differential compares neither, because the php oracle does not derive them and
   they are absent from php's compared-label allowlist. The fixture suite is the only thing
   standing behind them. This is a DERIVATION finding, not a known gap in the analyzer, and the
   change that would settle it is §"What this lane could not settle", item 2.

**A boundary written only in a source comment is not a ruling.** That sentence is the M60 round's
own lesson and it has a named victim: typed class constants sat on `phpDeclaredTypeRefs`'s
"BOUNDARIES, DISCLOSED" list for months while the spec claimed `const_declaration` was
`handled_verified` and carried **no** decision naming them anywhere in its 33. It is now handled
and adjudicated (**PHPD35**, FIXED) — see "Declared-type graph" below. The shape to watch for is
a disclosed boundary with no matching entry in the adjudication set: that is an unexamined claim
wearing a disclosure's clothes.

### Master review — what 100% coverage could not see

A differential proves the analyzer agrees with the oracle. It cannot prove either
is *right*: a construct both sides miss reads as an exact agreement on an
absence. So the review hunted correlated error, and found one.

**`use C\{D, E as F};` emitted nothing.** A `use` declaration has two AST
shapes — the plain form puts a `namespace_use_clause` directly under the
declaration, while the grouped form nests them in a `namespace_use_group` with the
prefix in a sibling `namespace_name`. Only the first was handled, so grouped use
produced no import, no `imports` edge and no framework detection. Fixed in
M12.PHP-GROUPED-USE (`script/m12/php-symbol-audit.ts`'s sibling work), with
members recorded *qualified* (`App\Models\Post`, not a bare `Post`, which would
collide across groups) and pinned by the `php/grouped-use` fixture.

The instructive part is why nothing caught it: `use X\{...};` occurs **zero
times in phpunit and zero times in phpmyadmin**. The corpora cannot detect a
construct they do not contain, and `derivePhpEdges` shared the blind spot, so the
full-corpus run reported 100% coverage over 4,139 files and 95,231 edges while
missing the construct entirely. **100% coverage is a statement about the corpus,
not about the language.**

**Grammar-driven construct census** —
`bun script/m12/php-construct-census.ts` →
`validation/m12/results/php-construct-census.json`. A hand-picked checklist only
finds the constructs you thought of, so the census walks the grammar's own 179
named node types against all **4,463** corpus files. It reports
**CLAIMED-BUT-NEVER-EXERCISED**: a type classified handled/verified, on which no
corpus file provides evidence, and which no design decision reasons about — an
assertion nobody has ever looked at. That set was 1 and is now **0**; the
remaining corpus-unexercised handled type (`dynamic_variable_name`, `$$n`) is
recorded as hand-probed in PHPD34 rather than conflated with the unexamined.

The census also exposed a data defect in the spec itself: **56 prose fragments
were sitting in `node_type` fields** ("per-site duplicate rows", "operators",
"mixed variadic calls"). They were not classifying anything — the inventory
counts them as type references while `node_type` is split on `,` — so they made
the classification look broader than it was. They are moved to `nodeTypeProse` /
`note`, and the spec's classified set fell from 187 entries to 159 real node
types. The inventory is unchanged at 179 types / A–H 8/8, which is the proof the
prose was never doing work.

**Hand-picked spot check (24 modern constructs).** 24 modern PHP constructs were counted across both corpora
to find which are untested by any corpus run. Present: first-class callables,
named arguments, readonly, `match`, attributes, constructor promotion, arrow
functions, heredoc, nullsafe, union and intersection types, enums (including 27
backed), abstract methods, `yield`, `never`, readonly classes. Absent from both:
grouped `use` (now fixed), `insteadof` trait-conflict resolution, PHP 8.4
asymmetric visibility, and `Fiber`. All of the 20 grammar-driven never-seen types
were then probed individually and adjudicated in PHPD34, including the one
construct that genuinely fails — `var_modifier` (`var $x;`), removed in PHP 7.0,
where a parse error is the correct outcome. Also probed directly:
asymmetric visibility (`public private(set) string $name`) loses **no symbol** —
all four properties are emitted — and `insteadof` keeps both trait `use` edges,
consistent with the model where a trait's methods belong to the trait and are not
re-declared on the composing class.

**Phantom symbols.** `bun script/m12/php-symbol-audit.ts` →
`validation/m12/results/php-symbol-audit.json`. A phantom is invisible to
precision/recall when the oracle is wrong the same way, so it needs its own
check; this one rejects names that are empty, dollar-prefixed, digit-prefixed,
contain quotes or an accessor fragment, or are degenerate placeholders. Over
**9,906 symbols in 1,200 files from both corpora: 0 suspicious.** The lane has had
phantoms removed before (Laravel Eloquent `getAttribute`/`setAttribute`,
WordPress `wp_add_*` hooks), so this is a standing check rather than a one-off.

### Performance

- Phase profile: `bun script/m12/php-perf-profile.ts` →
  `validation/m12/results/php-perf-profile.json` (200-file strided sample of
  phpunit). The split is measured with hrtime over a warmed run, not sampled,
  because a CPU profile attributes tree-sitter's WASM work to `(idle)`.
- **The fused main walk is ~90% of end-to-end time.** `parse` is ~8–11%,
  `collectPhpFileScope` (the one separate full-tree walk) ~2–5%, and the
  symbol-table post-passes ~0.1%. So the cost is in the single walk, and
  optimizing the grammar is not where a speedup lives.
- `msPerFile` from the profile is **not** comparable to the differential's
  6.3–9.5 ms/file: the profile includes parse, and its strided slice is
  file-equal rather than byte-equal, so it is dragged by the large vendored
  sources under `tools/.phpstan/`. The phase *ratios* are the robust result.
- A/B harness: `bun script/m12/php-perf-ab.mts [ref]` →
  `validation/m12/results/php-perf-ab.json`. It reports speed and output
  equality as **separate** claims, interleaves the two analyzers round by round,
  and compares results field-by-field on every file before timing anything.
- **The estimator is min-of-reps, not the median.** Under contention every run
  is inflated by whatever else the box is doing, and that inflation is
  one-sided — a run can only be slower than the uncontended truth, never faster.
  So the minimum is the best available lower bound on true cost, while a median
  inherits the contention. Both are reported, and the gap between them *is* the
  machine's noise. Switching estimators changed the answer materially: the same
  comparison reads 1.151x by min and 1.025x by median.
- **THE A/B NUMBER IS HISTORICAL EVIDENCE, NOT A STANDING CLAIM, and this
  document did not say so until now.** `validation/m12/results/php-perf-ab.json`
  records `"baseline": "HEAD"` — the literal string — because it was measured with
  the change still uncommitted, so `HEAD` meant its parent. That measurement was
  **valid**: the artifact's `generatedAt` is `2026-09-30T07:52:51Z` and commit
  `ce6a26185` landed 18 seconds later at `07:53:09Z`. But the change is now
  committed, so re-running the tool correctly refuses —
  `baseline HEAD~1 is byte-identical to the working src/ast/real-php-analyzer.ts
  — nothing to compare`. The "1.003x" and "output identical: YES across 150
  files" above are therefore facts about `ce6a26185`, not numbers that can be
  re-derived from this tree. Recorded explicitly because it is this lane's own
  `#933` failure class — *evidence older than the program* — in its youngest
  possible form: one commit old, correctly labelled, and still not re-derivable.
- **The phase ratios DO re-derive at HEAD** (200-file strided phpunit sample):
  `parse 253.3ms | collectPhpFileScope 73.3ms | mainWalk 3863ms | postPasses
  0.3ms` — main walk **92.2%**, parse **6.05%**, the one separate full-tree walk
  **1.75%**, symbol-table post-passes **0.007%**. The same shape as the ratios
  above, and the structural conclusion is the robust part: the cost is in the
  single fused walk, so optimizing the grammar is not where a speedup lives.
- Measured machine noise is larger than any available win: the profile moved
  19.21 → 22.31 ms/file between two consecutive runs of *identical* code, and
  early 5-rep A/B runs returned 1.883x and then 0.755x. At 15 reps with the
  min estimator the spread is still 30.5%. The harness therefore reports its
  speed verdict as `INDETERMINATE` above 25% spread rather than publishing a
  number it cannot support.
- One optimization was applied, chosen because half of it is provable: the
  grouped-`use` fix had introduced a `namespace_name` scan over every `use`
  declaration, including the plain `use App\X;` form that is the overwhelming
  majority in real code — wasted work, including a `.text` WASM crossing, on the
  common path. The scan is now conditional on a group actually being present.
  The A/B reports **output identical: YES** across all 150 files, which is the
  half of a performance claim that is decidable on any hardware, and
  **1.003x** — real but below the noise floor.
- **Conclusion: the analyzer is already at this box's noise floor.** The
  identified headroom (the fused main walk, ~90% of cost) is not reachable
  without a structural change to the walk, and no such change can be validated
  here. No performance claim is made for this lane. Closing this properly needs
  a quiet machine — pinned cores (`taskset`), a loaded/idle control, and tens of
  reps — not more work on the analyzer.

### M60 master review — the round's four substantive changes

Everything below was measured at HEAD over the **full git-tracked corpus of both pinned repos
(4,463 `.php` files)**, not a 60- or 400-file draw, because this lane has already proved twice
that a draw can be clean and wrong. Read `reviews/php/master-review.md` for the derivation; this
section records what a consumer of the analyzer needs to know.

**1. `contains` is audited, and was not.** The lane emitted 24,707 `contains` edges — its
4th-largest label — and **no oracle derived any of them**, so the label was in no per-language
allowlist entry, which means the differential filtered all 24,707 off the *analyzer* side before
comparing: the largest obviously-correct structural class in the lane was invisible in both
directions while the differential reported `unexplained 0`. `rel-type-coverage-gate` had it as a
**NEW** regression.

> **CORRECTION (M60 PHP ontology round). The "Fixed by" claim in this entry did not
> happen and this document asserted it anyway.** `derivePhpContainsEdges` **does not exist**.
> `grep -rn derivePhpContainsEdges` over the tree returns exactly one hit, and it is a
> *comment* in `script/m14/completeness-inventory.ts:1022` that describes the function as
> having fixed this — the same shape of claim, one file over. Measured against this tree:
>
> - `derivePhpEdges` + `derivePhpDeclaredTypeEdges` (`script/m14/differential.ts:11680-12900`)
>   push exactly seven labels — `calls`, `uses`, `extends`, `implements`, `instantiates`,
>   `overrides`, `references`. **No `contains`, no `imports`, no `exports`.**
> - the compared-label allowlist for `php` resolves to those same seven
>   (`differential.ts:23153` head `extends`/`implements`/`instantiates` + `overrides` +
>   `calls`; `:23186` adds `calls`,`uses`; `:23434` adds `references`), so `contains` is
>   filtered off the analyzer side and nothing derives it on the truth side either.
>
> **So `contains` and `imports` are DERIVATION findings in this lane — 2 of the 9 emitted
> types are stored and compared against nothing.** The differential's own output is
> consistent with this: `--lang php --sample 300` reports `unexplained 0` while comparing
> 12,601 edges, and `contains` is 30,315 of the corpus's 306,066 — none of them in that
> number. The prose above about a standalone measurement ("23,399 distinct owner|member
> pairs, 0 truth-only, 0 analyzer-only") describes a run whose code is not in the tree and
> cannot be reproduced; it is left in place only so the discrepancy is visible rather than
> quietly deleted. See §"What this lane could not settle" for the file-and-function change
> that would make the claim true.

**2. `requiredKinds` now describes the analyzer, and the check that proves it runs both ways.**
php's row omitted `imports` — a label the analyzer has emitted since M12.PHP-IMPORTS, 25,104 edges,
3rd-largest by volume, and the kind the file-level reader keys on. The row is what certifies the
relationship contract, so the contract was published at eight kinds while the analyzer published
nine. Two things were wrong, not one: the row, **and** the disclosure that explained the omission
(`reviews/php/m60-closure.md` #6, now corrected — it asserted the opposite of the truth in all
three of its clauses). The row omission was invisible because completeness section B was one-way:
it asked whether every kind in the row is pinned by a fixture, never whether the analyzer emits a
kind the row omits. Section B now runs the lane's analyzer over the lane's own fixtures and checks
the reverse direction too. **That check immediately found the same defect in eight more lanes** —
bash (`overrides`), c (`calls`, `contains`), cpp (`contains`), zig (`exports`, `instantiates`),
dart (`exports`), ruby (`overrides`, `references`), python (`overrides`), haskell (`exports`,
`imports`, `overrides`, `uses`). c's own fixtures emit `calls` 281 and `contains` 138 while its row
names neither. Those eight rows are those lanes' work; the instrument that finds them is now
correct.

**3. Typed class constants (PHP 8.3) are handled — and the corpora cannot see it.**
`const Dep X = 1;` carries a type on the constant, and the grammar exposes it as an ordinary
`type` field on `const_declaration` (probe-verified) — a sibling of the `property_declaration.type`
position the lane has always handled. It was on the "boundaries, disclosed" list instead, with no
ruling. It is now emitted, attributed to the enclosing **type** exactly like a property's, with
wrappers descending (`?Opt` → `Opt`; `First|Second` → **both** members), `primitive_type` silent,
`self` resolving to the enclosing class, and a file-scope typed constant attributed to `global`
rather than dropped. **Neither corpus can confirm it:** both were walked for `const_declaration`
nodes carrying a `type` field and measured **243 const declarations, 81 of them typed — and every
one of those 81 is a `primitive_type`** (`private const string PAGE_HEADER`, `public const int
VERSION`). Primitives are silent by design, so the position is genuinely exercised 81 times, but a
NAMED type — the only shape that produces an edge — occurs **zero** times. The absence of `const
Dep` references therefore read identically whether the rule worked or did not exist. Held by
`php/typed-class-const` and the reverting mutant `php/typed-class-const-dropped`, caught by that
fixture **alone**; the isolation is the evidence. Adjudicated as **PHPD35** (FIXED).

**4. `overrides` is correct, and its corpus evidence is one row.** Over both pinned corpora the
analyzer emits **1** `overrides` edge and the oracle derives **1** row — the same row,
`SkipConstruct.__construct -> ParentConstructorClass.__construct`, in a **vendored phpstan test
fixture** under `phpunit/tools/.phpstan/vendor/` that is in **neither** canonical 60-file draw. So
on both published draws the label compares 0 rows to 0 rows and reads PASS: the same shape the
differential's own haskell note names ("the analyzer emitted none and the oracle derived none, so
the audit compared nothing to nothing"). The rule is right — 2,631 classes carry a base, 26 have
it in the same file, and the nearest ones redeclare nothing, so 0 is correct for all of them. Two
halves of the contract had **no fixture** and now do: a subclass method the base does **not**
declare (a rule emitting it would fabricate a method nobody wrote), and transitivity (resolution is
per-link, so `LocalChain extends LocalMiddle extends LocalBase` must not publish
`LocalChain.handle -> LocalBase.handle`). Each has a reverting mutant;
`php/override-fires-without-base-method` is caught by two independent fixtures.

### The line contract, as a gate rather than a number

`line_number` is carried on **every** relationship: **0 unlined and 0 stamped `line 0` over
287,788 edges** on the full corpus, 0 of 33,656 symbols missing a start or end line, and 19,714 of
19,714 callables carrying complexity. The rule is `nodeLine(node)`: the line of the node that
**names** the edge, and `undefined` when there is no node to ask — absent is honest, `0` is the M59
fabrication.

**The differential can never re-catch a line gap.** It matches on `(label, from, target)` and
never on the line, and the oracle is line-blind the same way, so a gap present on *both* sides is
invisible by construction — that is exactly how `line_number` sat at one of 28 emit sites while the
`lines` cell read PASS. So the contract now has a **re-runnable gate** of its own:
`bun script/m60/php-line-contract.ts --full`, which measures per-label unlined/zeros, per-kind
range coverage, callable complexity coverage, **and volume drift against a baseline** — so an edit
that changes a label's edge count without changing anything else is visible in the same run. It is
the only instrument in the repo that can fail this, which is why it exists rather than a sentence
in this document.

### Oracle independence — a rule both sides call is a rule with one implementation

The differential used to import **three functions** from this analyzer:

| shared rule | governs | edges | had it ever been wrong? |
|---|---|---|---|
| `phpDeclaredTypeRefs` | the entire declared-type reference graph | 8,030 | not known |
| `phpStaticCallableName` | the callee-name rule | governs `calls`, 89,059 | **yes, twice** |
| `phpStaticIncludePath` | the include-path rule | the include half of `imports` | **yes, twice** |

The lane's own comment justified sharing: *"a hand-written copy cannot drift from the rule it claims
to state."* The drift half is true; the **blindness half was not priced**, and this lane had already
paid it. `phpStaticCallableName` published `calls -> $callable` — a target no php symbol can ever be
named — until R10 fixed it, and the oracle agreed because it called the same function, so no
differential at any sample size could see it; R10's target-spelling census found it, and that census
**reads the analyzer**. `phpStaticIncludePath` published `$this->baseDir.'revision-info.php'` as a
`references` target and then `__DIR__.'/src/DeprecatedClass.php'` on phpunit's autoloaders. Both
agreed, both times, for the same reason.

All three now have **independent** derivations in `script/m14/differential.ts`, written from the
pinned grammar's own shapes and sharing no code with the analyzer. Each was measured against the
shared version *before* being wired in, on the full git-tracked corpus of both pinned repos:

| rule | measured on 4,463 files | disagreement |
|---|---|---|
| declared-type graph | 5,349 distinct targets on both sides, 0 attribution differences | **0** |
| callee-name | 16,164 name-bearing call sites + 325 without, both sides | **0** |
| include-path | 208 include nodes: 189 accepted by both, 19 by neither | **0** |

**Attribution is measured separately because the harness cannot compare it.** The differential's
coverage match is `(label, target)` — it compares no `from` at all — so attribution drift stays
invisible to the harness even with independent truths in place.

**What writing a second implementation cost, recorded because it is the argument for doing it.** The
first draft of the independent callee rule computed the leaf as `lastIndexOf(sep, i)` after
advancing past the leading separators, which searches *backwards* and finds the **leading**
separator: `\Foo\Bar\baz` yielded `Foo\Bar\baz`. The differential still read **0 unexplained and
100% coverage**, because `normTarget` is the last segment and discards the qualifier. What caught it
was the truth **row count** moving (888 → 901) with coverage unchanged — a shape no coverage figure
reports. `BB_F5_STRICT=1` was then run to confirm the corrected rule (`strict-missing=0 hidden=0`,
"identities hold, and the published rule hid nothing"), which is a confirmation and not the
detection. **A bug in the truth side is structurally invisible to a coverage percentage.**

**Three declined constructs the corpora cannot exercise**, named rather than left to be found:
`relative_name` callees (`namespace\f()`, **0 sites**), `parenthesized_expression` operands
(`require (__DIR__ . '/x.php')`, **0 sites**) and `dynamic_variable_name` (`$$n`, 0 sites, PHPD34).
Each is a conservative decline — it publishes nothing, so it cannot fabricate — and each is a **miss**
the corpora can neither confirm nor refute. Two of the three are branches no run has ever executed.

`bun script/m60/php-oracle-independence.ts` (exit 1 on violation) makes this unrepeatable. It reads
the import statements off the **parsed tree**, so a name in a comment cannot register, and separates
**DATA** (`PHP_BUILTINS` — a set of names, correct to share, since a hand-copied builtin list drifts
in a way that would fabricate or hide call edges) from **RULE** (a function that decides something).
It asserts each replacement is defined *and* wired, is proven to fail by re-sharing
`phpStaticCallableName`, and permits one declared comparison-only exemption
(`phpDeclaredTypeRefs`, kept so the 0-disagreement measurement stays reproducible from the file that
carries the replacement) whose import is exempt but whose use on the truth path still fails.

### Not yet measured

- Cross-file `overrides` at project scale, because the companion index is not
  populated in production.
