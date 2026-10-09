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

| `exports` | **added this round, after the ruling that said it did not exist.** A name the file **publishes** and no declaration in it writes: a file-scope `define('NAME', …)`. Three grammar tests — the callee **resolves to the global `define`** (the bare name, or the **fully qualified** `\define`; a qualified `Other\define`, a relative `namespace\define` and a variable callee are refused, each with a measured count behind it since 2026-10-08); the first argument's value is a string literal read **through** the `argument` wrapper; no enclosing function/method/closure/class (a top-level `if` is not a scope). Emitted at 1.0 / `import_based` with `metadata.calleeShape`, with a `constant` symbol carrying **no** `ownerName` because `define()` publishes into the **global** scope even inside a namespace — hence no `contains` edge. **58** edges over 18 files, every target resolving. See "`exports` — the ruling that was falsified" and the 2026-10-08 audit below it |

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

- Independent manual ground truth: `validation/m12/ground-truth/php.json` — **precision 1.000,
  recall 1.000, 73 facts, 0 FP, 0 FN, `earliestFailingLayer=none`**
  (`bun script/m12/verify-analyzer.ts php`, measured 2026-10-07). This line read `0.930, 5 FP`
  earlier the same day, and the SAME 1.000 was claimed before that — the difference is what the
  number rests on. The 5 false positives were the M60 NAMESPACE-CONTAINMENT edges
  (`contains App\Base:BaseService` and `App\Service:{Auditable,Loggable,Status,UserService}`),
  and the cause was the truth file, not the analyzer: it was last touched 2026-09-29 (`3c8128c1e`)
  and its 66 facts covered NINE of the ten kinds — no namespace row shape at all — so the analyzer
  emitted a relationship the audit could not adjudicate. Five rows were added with their source
  citations (`namespace App\Base;` @ line 2, `class BaseService` @ line 4) and the rule they
  encode is the M60 one already pinned by `validation/m14/fixtures/php/namespace-containment`.
  The TENTH kind was covered the same way: a file-scope `define('BASE_PREFIX', 'base')` appended
  to `BaseService.php` (`exports` was the one type with no truth row — and the one whose ruling
  this lane FALSIFIED, PHPD33), which added its `constant` symbol fact and its
  `exports global -> BASE_PREFIX` fact. Nothing was removed to make the number move: the truth
  file is 71 → 73 facts and the analyzer emitted every one of them.
- Fixtures: `validation/m12/fixtures/php/{BaseService,Service,Negative}.php`,
  and `validation/m14/fixtures/php/` — **27 pass / 0 fail** (`bun run script/m14/run-fixtures.ts
  --lang php`, measured 2026-10-07). The counts in this line and in the lane's own harness header
  had drifted (`22` here, `23/23` there, `19` before that), which is why the number is now stated
  with its command. The +1 is `php/nested-named-functions`, authored before its fix.
- Every endpoint of every edge classified by reason: **`unexplained = 0`, 350,367 endpoints**
  (`bun validation/m14/fixtures/php/reason-census.mts`, measured 2026-10-07) — the committed
  authority for the lane's central claim, with its artifact at
  `validation/m60/php/reason-census.json`. Before this round the same claim rested on a
  gitignored scratch file, i.e. on one session in one checkout.
- Mutants: **67 registered for `php/`, all 67 caught, 0 survivors**
  (`BB_MUTANT_ONLY=php/ bun script/m14/mutate-analyzer.ts`, measured 2026-10-07). This line said
  `50`, and the count is not the interesting part of the correction: until 2026-10-07 the php
  registry itself was ORPHANED — `script/m14/verify-orphaned-mutants.ts` read
  `PHP_MUTANTS 6 ORPHANED` and failed with "Those mutants have never run", so ZERO of the shared
  registry's mutants were php's and the F4 gate could not fail for this lane. The eleven mutants
  this round added (keyword-named members, the recovery-escape and its rejected readings) are
  caught; the count is stated with the command for the same reason as the fixtures above. Five
  were added by the
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
| `exports` | EMITTED | **58** | 18 | was RULED; **the ruling was falsified** — see below |
| `overrides` | EMITTED | **2** | 2 | the count is the finding — see below |

**Ten emitted, none ruled**, and the arbiter agrees. `script/m14/php-ruled.ts` is
the lane's ruling table and it is **empty**, because the one row it held was
withdrawn and a row for an emitted type is a false claim. Wiring it into
`ontology-coverage-gate.ts` is a two-line shared change (§8); the lane's own
`validation/m14/fixtures/php/ruled-gate.ts` applies those two lines to a **copy**
of the gate and runs the copy. The block below is that run's OUTPUT, pasted as
printed — its per-type counts are that run's, not today's (the current `exports` count
is **58**: the 2026-10-08 audit below found a fully qualified `\define` this rule was
refusing for its spelling):

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
| P1b | `use function`/`use const`, **qualified** target | 12 | 37 in 29 files |
| P2a | file-level `return`, no named value | 2 | 2 |
| P2b | file-level `return`, naming a value | 28 | 33 in 25 files |

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
per construct, and asserts every probe fires. `define("X", 1);` read 0. At the
time there were **two** copies of the probe (one in the ruling table, one in the
corpus harness) and the controls asserted they agreed counter-for-counter; the
ruling-table copy was withdrawn when the ruling fell, and control (C) is now
withdrawn **in writing** rather than silently deleted — a control for a copy that
no longer exists is a comment, not a control. Controls pass in seconds, with no
corpus. Artifact: `validation/m60/php/exports-probe.json`.

**What is implemented** (`emitDefineExports`, `src/ast/real-php-analyzer.ts`).
Three grammar tests, no text matching anywhere:

1. the callee **resolves to the global `define`**. Two spellings do, and only two:
   the bare name `define` (PHP's unqualified-name **fallback**) and the **fully
   qualified** `\define` ("Fully qualified names always resolve to the name without
   leading namespace separator" — unconditional). A **qualified** `Other\define`
   resolves against the current namespace, a **relative** `namespace\define`
   resolves to the current namespace and does **not** fall back (the fallback is a
   rule for unqualified names only), and a variable callee resolves to nothing;
2. the first argument's **value** node is a `string` / `encapsed_string`, read
   **through** the `argument` wrapper. `define($n, …)` publishes a name nobody can
   write down; measured **1** in the corpus and deliberately left unemitted rather
   than given an invented endpoint;
3. the call is at **file scope** — no enclosing function, method, closure or class.
   A `define()` in a body publishes the name only if that function runs, so an edge
   from the file would assert something the file does not guarantee. A top-level `if`
   is deliberately **not** a scope: it executes when the file is included, so it
   does publish.

### The 2026-10-08 whole-population define-audit, and the edge it found

Rule 1 above used to be a **spelling** test — "the callee is exactly the bare name
`define`" — and a spelling test cannot be complete, because two spellings name the
same function. So the probe grew a **denominator**: every `define`-family call in
the admitted population, split by callee **resolution** | scope | name-literalness,
with every shape key **pre-seeded at 0** (a key that appears only once it fires
cannot be told apart from a classifier that can never produce it — the `argument`
wrapper defect, one paragraph up). Over **5,094 files**, the audit reads:

| callee shape | file-level, literal name | nested | total |
| --- | --- | --- | --- |
| `define` (bare) | **57** | 3 literal, 1 dynamic | 60 + 1 |
| `\define` (fully qualified) | **1** | 0 | 1 |
| `Other\define` (qualified) | 0 | 0 | 0 |
| `namespace\define` (relative) | 0 | 0 | 0 |
| `use function define as pub` (aliased) | 0 | 0 | 0 |
| `$f(...)` (dynamic callee) | 0 | 8 literal, 527 dynamic | 536 |
| `$o->define(...)` / `Foo::define(...)` | 0 | 0 | 0 |
| `class_alias` / `function_alias` | **0** | 0 | 0 |

**58 tree-implied publications against 57 emitted edges.** The missing one is
phpunit's `tests/end-to-end/generic/_files/auto_prepend_file.php` — one file-scope
`\define('AUTO_PREPEND_FILE_LOADED', true);`, in a file whose entire purpose is that
PHP's `auto_prepend_file` publishes a constant every later script can read, refused
for its **spelling** alone. The callee now has to resolve, not spell, and the census
moved **57 → 58 exports edges** with no other field in it changing except the ones
that follow from that edge (see the round section below). The three refused shapes
are priced rather than assumed: qualified and relative callees are **0** occurrences,
the aliased shape is **0** (it *does* publish in PHP — an unqualified name is
translated through the file's function import table — so it is recorded as a priced
boundary, not half-implemented), and **no file in the population declares its own
`define`**, which is the only way the bare-name test could have been unsound.

Rule 3's 11 nested calls are now 4 on this population (3 literal + 1 dynamic): the
old count came from a 4,642-file round, and the numbers above are the 5,094-file
ones. All of them are excluded with the reason attached, per call, in the artifact.

Each published name also gets a **`constant` symbol**, because an edge needs an
endpoint that resolves: `define('CLEANHOME', …)` writes no declaration anywhere, so
without a symbol the target would resolve to nothing. That symbol carries **no**
`ownerName` on purpose — PHP resolves the name it writes against the **global**
scope even inside a namespace — so it gets no `contains` edge, which is the
labelling line `php/define-exports` forbids crossing. Confidence **1.0**,
`evidenceClass` `import_based`: three grammar facts and no name matching, so there
is no heuristic here to be honest about. **`exports` heuristic (< 0.7) count: 0.**

**Resolution, measured:** 49 distinct targets, **49 exact-tier (100%)**, of which
44 resolve to exactly **one** published declaration and **5** resolve to more than
one — `ROOT_PATH` (5 declarations), `CLEANHOME` (3), `CACHE_DIR` (2),
`VERSION_SUFFIX` (2), `TESTSUITE` (2), which is 14 of the 58 edges. **Zero**
unresolvable. So every `exports` target the graph asserts is a declaration the
analyzer published, and (since the audit) 58 is also the number the TREE implies.

**The source end does not resolve, and that is a lane-wide shape.** All 58 edges
read `global -> NAME`, the spelling PHP's other two file-scoped edge types already
use (`emitUseClause`, `emitInclude`), so `imports` and `exports` have one owner
convention for the file-level reader at `src/lsp/graph_request.ts:256`.
`global` is not a published symbol, so `from`-resolution is **0.00%** on both
types — 25,914 `imports` edges and 58 `exports` edges with no source a reverse walk
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
| `exports` | `1.0: 58` | 0 |
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
| `exports` | **0** | **DERIVATION** — 58 edges |

**Two of those three were paid down on 2026-10-08, and this paragraph is the
correction.** The differential's compared-label filter now admits **nine** labels
for `php` — `extends`, `implements`, `instantiates`, `overrides`, `calls`, `uses`,
`contains`, `imports`, `references` — because the include-path truth rows were
relabelled to `imports` (where the analyzer files them by design) and the matching
`namespace_use_declaration` oracle was written beside it. So `contains` (30,454)
and `imports` (25,914) are no longer a blind spot, and **the 56,425-edge / 18.4%
figure above is superseded**: what remains excluded from the `unexplained` count is
`exports` alone, **58 edges — and 2026-10-08 closed it.** The lane-owned oracle
`script/m14/oracles/php-exports.ts` was written from PHP's resolution rules (sharing no
code with the analyzer, which is what `php-oracle-independence.ts` checks for this lane's
declarations), imported and registered in the differential, and `exports` was added to
php's compared-label set. `rel-type-coverage-gate` consequently reads **php in NO
un-audited row at all** — `emitted` and `audited` are the same ten labels and php's
DERIVATION list is **empty**, from three labels on 10-07 to one when this round started
to none. The proof is not a wave: `exports` is 58 edges over 18 files in 5,094, so a
60-file draw can contain **zero rows** of it and a label admitted with 0/0 prints nothing
and passes. `validation/m14/fixtures/php/exports-truth-crosscheck.mts` therefore compares
the oracle against the ANALYZER on every file the audit says carries the label, using the
harness's own `normTarget` — **18 files, 58 truth edges, 58 analyzer edges, 0 MISSING,
0 unexplained**, with the comparator itself run on pairs one edge apart as positive
controls.

`overrides` was the other half of the same day's work, and it failed in the OPPOSITE
direction: php is in the base `overrides` disjunct, so the label was already COMPARED
while no php oracle derived it — every analyzer row entered the comparison with no truth
to meet and was counted as an unexplained FABRICATION. That state was **DECLARED**, not
discovered late (`label_coverage.declared_no_truth`, with the reason and the
`closes_when`), and it is now **discharged**: `script/m14/oracles/php-overrides.ts`
derives a method that re-declares a name its base class declares — bounded, on purpose, to
a base **in the same file**, because php keys every edge on the LEAF name and three
`TestSuite` classes plus two `Assert` classes (one vendored) live in one repo, which is
why a cross-file lookup is a guess the analyzer's own history records getting wrong in
both directions. The fixtures `php/cross-file-override` and `php/external-override` pin
that a cross-file base emits nothing on EITHER side. Proof, over the whole population:
`overrides-truth-crosscheck.mts` sweeps 5,094 files with the local parser, finds the
3,100 candidate files (a named type declares a base — the analyzer's own precondition),
and compares `parseFile` against the oracle row by row — **2 truth edges, 2 analyzer
edges, 0 MISSING, 0 unexplained**, the analyzer's total asserted equal to
`perType.overrides.edges` in the census, and the comparator run on pairs one edge apart.
The declaration is **withdrawn** (spec `label_coverage.declared_no_truth` is now empty,
the closure is recorded at `_closed`) because a declaration that outlives its defect hides
the next one. The label axis has no holes left.

### ROUND 2026-10-08 — the `exports` audit, the edge it found, and what it cost

**The finding.** The `exports` contract had never had a denominator: 57 edges, no
statement of what the tree implies. The audit built one (`exports-probe.mts`,
`defineAudit`) and read **58**. The missing publication is phpunit's
`tests/end-to-end/generic/_files/auto_prepend_file.php` — `\define('AUTO_PREPEND_FILE_LOADED', true);`
at file scope, the exact construct PHP's `auto_prepend_file` exists for. Real
files, real construct, refused for its spelling.

**The fix** (`emitDefineExports`): rule 1 became a **resolution** test (`define` or
`\define`), `metadata.calleeShape` records which of the two, and the doc header now
cites the manual's resolution rules by name. Nothing else changed — the argument
rule, the scope rule, the symbol, the confidence and the `global` source spelling
are byte-identical.

**The evidence, in the order it was produced** — because the order is what makes
it evidence rather than description:

1. the fixture (`php/define-exports`) and its expectation were extended FIRST, with
   the four new negative shapes (`Other\define`, `namespace\define`, a nested
   `\define`, and the aliased `use function define as pub`); the suite read
   `FAIL php/define-exports` on the missing symbol, the missing export and all four
   relationships, including the three pre-existing ones (the new `meta.calleeShape`
   pin had to be satisfied too);
2. the analyzer fix made the suite read **27/27 pass**;
3. a revert mutant (`php/drop-absolute-fq-define-publication`) filters `exports`
   edges by `metadata.calleeShape === "absolute-fq"` — GENERICALLY, no hardcoded
   target, so it cannot silently stop matching — and is **caught** by
   `php/define-exports`; `mutant-check.mts` reads **16 mutants caught, 0 survived,
   clean baseline 0 problems**;
4. the whole population, before/after, same instrument: **10 content fields changed
   and every one of them follows from the one edge** (the run's own `elapsedSec` is
   the 11th) — `edgesSeen` 350,367 → 350,368;
   `symbolsPublished` 40,266 → 40,267; `exports` 57 → 58 (`resolved:unique` 43 →
   44); `targetClasses/resolved:unique` 115,660 → 115,661;
   `sourceClasses/source:global` 29,891 → 29,892; `incoming/declarations`
   40,266 → 40,267; `reachedByAtLeastOneResolvingEdge` 21,144 → 21,145;
   `reachedAndNamedByNothing` 17,350 → 17,351. **`namedButReachedByNone` did not
   move** (14,371) — the incoming hole did not grow by adding this edge — and
   `defectRows`/`unexplainedTotal` stayed **0**. Artifact:
   `validation/m60/php/reason-census.json` (re-run, `sampled: false`).

**Two things the audit priced that are NOT defects, and are recorded because a
zero nobody wrote down becomes a mystery later:**

- `method-named-define` (`$this->define('X')`, `Foo::define('X')`) is **0** across
the population. It is a separate shape because a member call named `define` is not
the function and PHP never routes it there — and the shape had to be made
*reachable* before it could be reported as zero: `member_call_expression` leaves the
`function` field **NULL** and carries the member name in a `name` field, so a test
on the callee field's type can never see it — measured with
`validation/m14/fixtures/php/callee-shapes.mts`, which prints every callee spelling
side by side **and asserts their field shapes**, so a grammar change fails loudly
instead of silently reclassifying calls. Written the other way, the key was a
pre-seeded zero no input could populate — the `argument` wrapper defect again, in the
instrument built to catch it.
- the declared-type oracle's `parent` branch (`derivePhpDeclaredTypeEdgesIndependent`,
reading `s.metadata.baseClass`) is **corpus-dormant, not dead**: the differential
calls `analyzer.analyze()` directly, so symbol `metadata` IS present there, and a
scan of all 5,094 admitted files finds **0** type positions written as `parent`
(the 7 text matches in phpmyadmin are inside OpenDocument style strings). Worth
knowing for the *store* path instead: the pool-worker projection drops the whole
`metadata` object, so `baseClass` never crosses the worker boundary — a consumer
that needs it must read the analyzer, not `parseFile`.

Also regenerated and committed this round: `validation/m60/php/exports-probe.json`
(the full **5,094/5,094** cross-check, 0 failures).

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
attribute them to a file.** All 25,914 `imports` and 58 `exports` edges read
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

**7. ZERO types need an oracle this lane cannot add — all ten are compared, and this
item is what closed it.** `contains` and `imports` joined the compared set on
2026-10-08 (the include-path relabel plus the namespace-use oracle; 35,112 + 28,630
edges), and `exports` joined the same day through
`script/m14/oracles/php-exports.ts` (58 edges). The blind spot that was 56,425 edges /
18.4% of the lane is now **zero in the DERIVATION sense**: `rel-type-coverage-gate`
lists php in no un-audited row, `emitted` == `audited` == the same ten labels.
`overrides` closed the same day through `script/m14/oracles/php-overrides.ts` (2 edges,
bounded to a same-file base and proved row by row: 2 vs 2, 0 MISSING, 0 unexplained over
3,100 candidate files), which also WITHDREW the spec's `declared_no_truth` entry — a
declaration that outlives its defect hides the next one.
WHAT REMAINS, stated as the different thing it is (and it is no longer about oracles):
the overrides label is complete over its SUBSET, not over PHP — a cross-file, qualified
index would widen it, and that is the gap recorded in
`script/m14/spec/php-completeness.json` with a `closes_when`. Writing that oracle is a
`script/m14/differential.ts` change (shared, §8).

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

---

## Round: the incoming side, measured (2026-10-06)

**No analyzer change this round.** Coverage was adjudicated by the previous round
(10 of 10 types EMITTED, `PHP_RULED` empty because nothing is left to rule), so this
round spent its budget on the incoming side — what the graph can walk *to* — and on
three defects in the instruments that measure it. Every number below is over the
**whole admitted corpus**, not a draw: 199 repos, **5,094** git-tracked files that
`detectLanguageFromPath` admits as `php`, production `parseFile` from
`src/ast/pool-worker.ts`. Commands and artifacts are named beside each figure, per
§"a number and the command that produced it".

### 1. The coverage arbiter reports a verdict from the files it happened to walk

`script/m14/ontology-coverage-gate.ts` checkpoints its walk to
`validation/m14/measurements/walk-php.txt` so a WASM hang cannot cost a corpus walk.
The checkpoint records *that* a file was walked. It does not record what that file
emitted, and `resumableWalk` does not call the walk callback for an index it has
already done — so `observed`, the map the verdict is computed from, is populated
**only by files walked in the current invocation**.

Measured, same tree, same corpus, two invocations:

| invocation | gate prints | `exports` | `overrides` | verdict |
| --- | --- | --- | --- | --- |
| resumed | `newly walked 53, resumed 5041` | RULED-UNJUSTIFIED | RULED-UNJUSTIFIED | **8/10**, exit 1 |
| `--fresh` | `newly walked 5094, resumed 0` | **EMITTED, 57 edges** | **EMITTED, 2 edges** | **10/10**, FALSIFIED 0 |

(That table is the gate's OUTPUT on that run and is left as printed. `exports` reads 57
there because it predates the 2026-10-08 audit; the current count is **58**, see below.)

The resumed run also printed `walk: 5094/5094 files (100.0%)` while holding 53
files' worth of edges in `observed`. A coverage gate that reports 100% of a
population it counted 1% of is a vacuous pass, and it is the failure this project
exists to catch: it read two real types as absent from the language.

This lane cannot fix it — the gate is shared machinery. The report is in §"Broken
outside your language" with the file, the function and the shape of the change.

**What `--fresh` costs, so the supervisor can weigh it:** the fresh walk is ~20
minutes on this corpus and it reported 6 files failing with
`[BB-PARSE-ERR] … memory access out of bounds` plus one `[BB-HANG]` that exits 1.
Those exclusions are why the gate's fresh counts sit slightly below
`ambiguity-split.json`'s, which parses the same files sequentially and loses none:
`calls` 103,015 vs 103,190, `uses` 154,513 vs 155,016, `contains` 35,032 vs 35,087,
`imports` 28,558 vs 28,630, `references` 10,291 vs 10,296, `extends` 3,104 vs 3,110,
`instantiates` 13,796 vs 13,848 — and they agree **exactly** on `exports` 57 (at the
time; **58** since the 2026-10-08 audit), `implements` 1,106 and `overrides` 2, which
are the three a resumed run gets wrong.

### 2. `uses` is not one rule, and 65% of it cannot resolve under any implementation

`uses` is the lane's largest label (155,016 edges, 44.2% of 350,342). Each emission
carries its own `metadata.phpSpecific` flag, and the flags have **different
resolvability properties**, so a single resolution rate for `uses` is a number about
no particular thing.

`validation/m14/fixtures/php/uses-resolution-shape.mts --files 300` groups every
`uses` edge of 300 files (9,024 edges, 2,369 symbols published, 0 parse failures,
0 degraded) by the flag the analyzer wrote on it and by whether the bare target
matches something published. A target is classified **variableInFile** without
reading its text: the walk re-parses the same file and collects every
`variable_name` leaf the grammar produced, then asks set membership — a parse-tree
fact, not a pattern.

| class | edges | share | what it means |
| --- | --- | --- | --- |
| `resolvesBare` | 2,562 | 28.39% | the target matches a published name somewhere in the walk |
| `variableInFile` | 5,872 | **65.07%** | the target is a `$variable` in its own file |
| `internalSymbol` | 107 | 1.19% | php-src declares it — cause C, already labelled |
| `UNCLASSIFIED` | 483 | 5.35% | the only bucket that can hide a real defect |

**The 65.07% is a structural limit, not a defect.** A PHP local variable has no
declaration site: `$foo = 1;` produces no symbol, so no correct implementation can
ever publish one, and no spelling change makes those 5,872 edges resolve. The remedy
is a label or a declared limitation — never a new edge, which would be a fabricated
node. Broken out by emitting rule, the shape is unambiguous:

| flag | edges | variableInFile | UNCLASSIFIED |
| --- | --- | --- | --- |
| `isLocalRead` | 5,967 | 4,744 | 0 |
| `isMemberRead` | 1,741 | 252 | **356** |
| `isSubscriptBase` | 749 | 681 | 0 |
| `isConstFetch+isMemberRead` | 199 | 0 | **123** |
| `isMemberRead+isStaticRead` | 183 | 92 | 0 |
| `isInterpolationRead` | 79 | 78 | 0 |
| `isConstRead` | 77 | 0 | 2 |
| `isClosureCapture` | 23 | 21 | 0 |
| `isGlobalRead` | 4 | 4 | 0 |
| `isTraitUse` | 2 | 0 | 2 |

**479 of the 483 UNCLASSIFIED are member-name or const-fetch targets** (356 + 123).
That is cause A proper, priced: a member is published as (bare `name`, `ownerName`)
in two fields, so the edge's bare target collides with every other declaration of
that method name in the corpus. The multi-declaration counts are in
`validation/m60/php/ambiguity-split.json`: of `uses`' 106,317 distinct targets,
**86,829** are published 2+ times, while the fleet's multi-KIND instrument — the one
behind `script/m14/incoming-check.ts` — counts **54,281** on the same edges. So the
fleet's `amb` column understates this lane's ambiguity by **1.60x**, and the two
numbers are not comparable across lanes. (Both are reported as distinct targets; on
this lane the multi-symbol and multi-kind EDGE counts happen to equal their
distinct-target counts, 86,829 and 54,281 respectively.)

**A control that changed how the table reads.** `ownerScoped` — "the target does not
resolve bare, but PHP's own `(owner, member)` key does" — printed **0**, which reads
as *no member read is owner-resolvable*. The control says something narrower and
truer: 276 symbols **are** published under a joined name and **all 276 are kind
`namespace`**, so the bucket could fire and did not. PHP publishes a member as
(bare name, `ownerName`) and never as the `Owner\member` name its own resolver
builds. The 0 is a real measurement of a real absence: a consumer cannot
disambiguate a member read by owner today without joining a field the store does not
index. The remedy is a **publisher** change — visible to every downstream consumer,
which is why this round does not make it unasked.

### 3. `calls` deletes 14,541 real call sites instead of labelling them

Cause C's stated mechanism is "mark them external so they stop polluting
`unresolved`", and `labelExternalTargets()` does exactly that for `imports`,
`instantiates` and `references`. For `calls` the same names never reach labelling:
`real-php-analyzer.ts:1669` reads `if (PHP_BUILTINS.has(callName)) return` and
**deletes** them.

`validation/m14/fixtures/php/builtin-calls-probe.mts --files 5094`, output in
`validation/m60/php/builtin-calls-probe.txt`:

| quantity | value |
| --- | --- |
| `function_call_expression` nodes | 18,910 |
| named by the analyzer's own `phpStaticCallableName` | 18,217 |
| variable/member callees with no static name | 693 |
| **sites the filter deletes** | **14,541** |
| — of which FUNCTIONS (real php-src symbols) | 12,217 across 475 names |
| — of which CONSTRUCTS (language syntax) | 2,324 across 3 names |
| `PHP_INTERNAL_FUNCTIONS` / `PHP_LANGUAGE_CONSTRUCTS` / union | 2,389 / 92 / 2,480 |

**14,541 of 18,217 statically-named calls — 79.8% — are absent from the graph**, and
the top of the FUNCTION half is `sprintf` 1,176, `assert` 725, `count` 559,
`htmlspecialchars` 387, `in_array` 370. Those are real functions with declaration
sites and signatures, declared by php-src at commit `91b93bcc`. The CONSTRUCT half
(`isset` 1,943, `empty` 378, `eval` 3) is correctly dropped: no such symbol exists,
so an edge onto one would point at nothing.

The contrast that sizes the asymmetry: the same corpus holds **14,065**
`object_creation_expression` nodes, **13,849** of them naming an internal class, and
**all** of those are emitted and then labelled `metadata.external`. So a `new
Exception()` call site is in the graph with an externality label while an
`Exception->getMessage()`-shaped `calls` edge is deleted outright. `exit` is in both
derived sets (2,389 + 92 − 1 = 2,480), so the two buckets partition by rule rather
than by luck.

**The 14,541 and the round's edge delta are populations of different sizes**, and the
probe reconciles them instead of leaving the arithmetic to the reader.
`PHP_BUILTINS` was 217 distinct hand-written names until the previous round, so the
ambiguity-split `calls` move (107,611 → 103,190) is the **increment**:

| | sites |
| --- | --- |
| the prefix filter already took | 10,104 across 187 names |
| the derived table added (FUNCTIONS) | 2,113 across 288 names |
| CONSTRUCT sites absent from the prefix list (`isset`, `empty`) | 2,321 |
| **= sites the derived table newly filters** | **4,434** |
| measured `calls` edge delta | 4,421 |
| residual | **−13, 0.29% of the delta** |

The residual is stated, not explained away. The probe counts call **sites**; the
analyzer pushes one relationship per surviving site and has no dedup key of its own,
so the two populations are the same set up to whatever the pipeline after the
analyzer does. This lane did not measure that collapse separately, so the
reconciliation is agreement to within the residual, not exact. Both sides are read
from committed artifacts (`php-builtins-pre-m60.json`, `calls-edges-pre-m60.json`)
and the probe exits 3 if the two ambiguity-split runs are over different file
populations.

### 4. The literal `unknown` endpoint check: 26 hits, 0 defects

§2b of the lane brief requires tallying endpoints equal to the string `unknown`.
`ambiguity-split.json` records 26 of 350,342 (0.0074%): `calls:target` 13,
`uses:target` 7, `instantiates:source` 2, `contains:target` 2, `references:source` 2.
A count does not say what to do about it, because the two readings have opposite
consequences: the **sentinel** would be an endpoint naming nothing, and a **declaration
in the corpus spelled `unknown`** would be a true edge that a "fix" would destroy.

`validation/m14/fixtures/php/unknown-endpoints.mts --files 5094` decides it by
measurement from two signals per hit — is `unknown` published as a symbol by any file
in the walk, and by the hit's own file — both set membership over what `parseFile`
published, no regex and no source-text reading. Result: **26 of 26 have a published
`unknown` somewhere in the walk; 0 are sentinel-shaped.** The two published symbols
are `public static function unknown()` in `phpunit/src/Framework/TestSize/TestSize.php:21`
and `phpunit/src/Framework/TestStatus/TestStatus.php:39`, and reading the sources
settles the rest: `phpmyadmin/src/Charsets/Collation.php:124` and
`slim/tests/Handlers/Strategies/RequestResponseNamedArgsTest.php:137` target a local
`$unknown` variable, which is the structural limit of §2 above, not a sentinel.

**An ordering bug this instrument shipped and then fixed.** The first whole-corpus
run reported 5 "sentinel-shaped" hits. `walkPublishesUnknown` was evaluated *inside*
the walk, so a hit in a file sorting before `TestSize.php` read false — the answer
depended on file order, which makes it not a discriminator. Resolved after the walk
it is 0. The corrected numbers are what the committed JSON carries, so artifact and
command still agree.

### 5. One differential MISSING row is a stale oracle label, not a missing edge

`bun run script/m14/differential.ts --lang php` exits 0 and reports one MISSING row
in 120 files across two repos: phpunit `files=60 tree-truth=1180 covered=1179
(99.9%) MISSING=1 | analyzer-edges=1124 unexplained=0 heuristic=0`;
phpmyadmin `files=60 tree-truth=1906 covered=1906 (100%) MISSING=0 | analyzer-edges=1856
unexplained=0 heuristic=0`.

The row is `references (expr) -> __DIR__/MyExtensionBootstrap.php` in
`phpunit/tests/end-to-end/extension-cli/_files/class-does-not-implement-interface/src/autoload.php`,
which is `require __DIR__ . '/MyExtensionBootstrap.php';`. The edge **is emitted**,
as `imports`, at 0.9 with `metadata.relationshipType: "include_path"`,
`includeType: "require"`, `evidenceClass: "import_based"`. The oracle pushes
`references` for the same node at `script/m14/differential.ts:12148`, under a
comment reading "Mirror the analyzer's emitInclude: references -> the include path".

The analyzer's label is the deliberate one. `emitInclude` carries the reasoning
inline (`src/ast/real-php-analyzer.ts:2300`): "`require`/`include` is a module
dependency, not a symbol reference. It was filed as `references`, which mislabels a
file-level edge as an intra-file symbol read and kept it out of the file-level
reader's `('imports','exports')` filter." Since that change `references` in this lane
means one thing — a declared-type reference (`real-php-analyzer.ts:2890`) — so the
oracle is stale by one label and the row can never match. `script/m14/differential.ts`
is shared machinery: reported, not edited. **Sample size is one row in one repo.**

### 6. DERIVATION, restated against this round's numbers

**CORRECTED 2026-10-08 — most of this finding has been paid down, and the paragraph
below is kept only because it is what the round measured at the time.** Then:
`derivePhpEdges` pushed seven labels — `calls`, `uses`, `extends`, `implements`,
`instantiates`, `overrides`, `references` — and three emitted types derived nothing:
`contains` (35,087 edges), `imports` (28,630), `exports` (57), i.e. 63,774 of 350,342
edges (18.2%) stored and compared against nothing. NOW: the include-path truth rows
were relabelled to `imports` and a `namespace_use_declaration` oracle was written
alongside them, so the compared set for php became nine labels (`+ contains + imports`),
with `exports` (58 edges) and `overrides` (2 edges, which had been compared with NO truth
and are now derived by `script/m14/oracles/php-overrides.ts`) closing the same day. As of
2026-10-08 the compared set is **all ten**, php is in no un-audited row, and the only
remaining bound is not a label but a SUBSET: overrides speaks only where the base is
declared in the same file, because a cross-file base is a guess on a leaf-keyed graph.

**ALL THREE ARE NOW PAID DOWN, and this paragraph is kept for the sequence.** The
`exports` half went further on 2026-10-08: a **whole-population audit of the publication
rule** against the wasm reads 58 implied publications against 58 emitted edges — it read
**57/58** before, and the missing edge was a fully qualified `\define` the rule refused
for its spelling (see the round section above). Four injected mutants pin it, and the
fixture suite catches all four. The label is no longer an L1/L3-only argument either: the
oracle `script/m14/oracles/php-exports.ts` is registered in the differential, `exports`
is in php's compared-label set, and `exports-truth-crosscheck.mts` compares the two sides
row by row on all 18 files that carry the label (58 vs 58, 0 MISSING, 0 unexplained).
§"Broken outside your language" states what an `overrides` oracle would have to derive.

### 7. Gates re-run

| gate | command | result |
| --- | --- | --- |
| coverage arbiter | `npx tsx script/m14/ontology-coverage-gate.ts php --fresh` | `emitted 10/10 ruled-sound 0 FALSIFIED 0 ruled-without-justification 0`, then exit 1 on `[BB-HANG]` (`phpmyadmin/tests/unit/Engines/Innodb/BufferPoolTest.php`, 120 s) and 6 `[BB-PARSE-ERR] memory access out of bounds` |
| fixtures | `bun run script/m14/run-fixtures.ts --lang php` | **23 pass / 0 fail**, "all fixtures pass", exit 0 |
| differential | `bun run script/m14/differential.ts --lang php` | exit 0; 2 lanes measured; the 1 MISSING row of §5; scoped run correctly declined to write M14.0.F5 |
| types | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| mutation | `bun run script/m14/mutate-analyzer.ts` (no scoped invocation exists; it sweeps every lane) | **53 php mutants, 52 CAUGHT, 1 SURVIVED** |
| honesty | `npx tsx script/m14/verify-honesty.ts` | exit 6; **33 banned-vocabulary failures, none in a php file** — every one is in another lane's artifact (c, clean, csharp, html, zig ×8, julia, nim ×2, fsharp, M14.0.F5) and every one is present at the base commit `80836570d`. Plus one php-adjacent failure, see below. |

**The one surviving php mutant is dead, and predates this round.**
`php/drop-external-override-guess` (`script/m14/mutate-analyzer.ts:18447`) filters
`overrides` edges whose source is `AuditService.handle` and whose target is
`ExternalBase.handle`. That edge **has not existed since M12.PHP-OVERRIDE-AUDIT
removed the first-parent guess**, and `php/external-override` now pins its ABSENCE
in three `forbidRelationships` rows. A mutant that deletes an absent edge is a no-op,
so it cannot fail and its survival proves nothing. The same file's
`php/re-add-external-override-guess` mutant exists for this exact reason and says so
in its own description: "once the guess was removed from the analyzer, a mutant that
filtered the edge became a no-op and survived, proving nothing … the mutant must
inject it." Both mutants are present; the inverted one is caught, the original is
vestigial. Already on record before this round — `validation/m14/measurements/nim/
session16-mutants.txt:1743` carries `SURVIVED php/drop-external-override-guess`, and
that file is in the base commit. Deleting the vestigial entry is a
`script/m14/mutate-analyzer.ts` edit and therefore a §8 report item.

**`M14.0.F4` is stale and this lane does not regenerate it.**
`verify-honesty.ts` reports `M14.0.F4: 13 declared input(s) changed since
7faf956b1e — regenerate (src/ast/php-internal-symbols.ts, src/ast/real-php-analyzer.ts,
validation/m14/fixtures/php/ambiguity-split.mts, validation/m14/fixtures/php/
builtin-calls-probe.mts, …)`. All 13 are this lane's. Regenerating means writing
`validation/m14/results/M14.0.F4.json`, which §8 assigns to the supervisor, and the
only invocation sweeps all 46 lanes rather than php. The figures quoted above come
from a worktree-local regeneration at `7faf956b1`, uncommitted for that reason.

The `--lang php` differential is scoped by **space-separated** `--lang php`.
`--lang=php` is not recognised and runs all 66 lanes; under `npx tsx` it dies first
on an extensionless import (`src/ast/js-builtin-prototypes`) that only `bun`
resolves. Both are recorded because the failure looks like a missing module and is not.

### 8. Broken outside this language — measured, reported, not edited

Each item names the file, the function, what it must do and why, so it can be applied
without re-deriving it.

**(a) `script/m14/ontology-coverage-gate.ts` — the coverage arbiter's resume path
produces a verdict from the wrong population.** `resumableWalk(CHECKPOINT, …)` at
`:305` skips the walk callback for indices the checkpoint already holds, and `observed`
— the map the entire verdict is computed from — is written **only** inside that
callback (`:312-322`). The checkpoint at `validation/m14/measurements/walk-php.txt`
stores a path per file and nothing about what the file emitted. So on a resumed run
`observed` holds the newly-walked files alone while the header prints
`walk: 5094/5094 files (100.0%)`. Measured: resumed → **8/10** with `exports` (57 real
edges) and `overrides` (2 real edges) both reported `RULED-UNJUSTIFIED`; `--fresh` →
**10/10**, `FALSIFIED 0`. Two ways to fix it, both in that file: have the walk
callback persist per-file per-type counts so a resumed run can replay them into
`observed`, or refuse to print a coverage verdict unless
`walkStats.alreadyDone === 0`. The second is a smaller change and turns a silently
wrong verdict into a loud refusal; the first is what makes `--fresh`'s 20 minutes
optional. Either way the header's `(100.0%)` should print the population `observed`
actually covers, since that percentage is the claim and it is currently false.

**(b) `script/m14/differential.ts:12148` — the php include oracle pushes a label the
analyzer stopped emitting.** `push("references", p)` inside the
`require_once_expression` / `include_expression` branch, under a comment reading
"Mirror the analyzer's emitInclude: references -> the include path". `emitInclude`
emits `RelationshipType.Imports` and has since M12.PHP-IMPORTS, for the stated reason
that a file-level edge labelled `references` is invisible to the file-level reader's
`('imports','exports')` filter. Change the push to `push("imports", p)` — then the
`php/include-paths` rule is compared rather than asserted, and the 1 MISSING row on
both published draws goes to 0. Sample size of the discrepancy: **one row, one repo**.

**(c) `script/m14/differential.ts` — no oracle derives `contains`, `imports` or
`exports` for php.** `derivePhpEdges` (`:11696-12387`) pushes exactly seven labels.
An oracle for `contains` must derive, for each declaration node the analyzer
symbolises, one `owner -> member` row with the member's **leaf** name and the owner's
**bare** name — the analyzer publishes a `namespace` symbol per file, so a truth
function that matched on any segment would read 65-way ambiguous where exactly one
declaration exists, which is the instrument defect already documented for `imports`.
For `imports`/`exports` the rule is one per file-scope `use` clause and one per
`define("X", …)` call whose first argument is a string literal. Until those exist,
**63,774 of 350,342 php edges (18.2%) are compared against nothing** and the
`unexplained 0` in the differential output does not speak to them.

**(d) `script/m14/mutate-analyzer.ts:18447` — a vestigial php mutant.**
`php/drop-external-override-guess` filters an edge the analyzer has not emitted since
M12.PHP-OVERRIDE-AUDIT, so it is a no-op that survives forever and dilutes the
survival count. Its own replacement, `php/re-add-external-override-guess` at `:10842`,
is caught and is the one that proves anything. Delete the `drop-` entry. Predates
this round; on record at `validation/m14/measurements/nim/session16-mutants.txt:1743`.

**(e) `src/ast/types.ts` vs `src/ast/engine.ts` disagree on the value of
`RelationshipType.Imports`** (`brain_import` vs `imports`). Not load-bearing for php
this round — the analyzer imports the enum from `engine.ts` and this round cited no
blocker drawn from either — but it remains live for any lane that rules on it.

**(f) Six corpus files fail php parsing with `memory access out of bounds` and one
hangs past 120 s** (`phpmyadmin/tests/unit/Engines/Innodb/BufferPoolTest.php`,
`tests/unit/EncodingTest.php`, `tests/unit/Display/ResultsTest.php`,
`phpunit/src/Metadata/WithoutErrorHandler.php`, `phpunit/tests/end-to-end/repeat/_files/
RepeatAttributeOnDependentTest.php`, `…/RepeatAttributeOnNonVoidReturnTest.php`). The
hang makes `ontology-coverage-gate.ts` exit 1 even at 10/10, so a lane whose walk is
otherwise sound cannot exit 0 on this corpus. Parser robustness, not an analyzer
defect; recorded because it changes the exit code a supervisor reads.

### 9. What this round could not settle

- **Cause A for members is not closed.** The 479 UNCLASSIFIED member/const-fetch
  targets need a publisher change to become resolvable, and a publisher change
  changes what every consumer sees. Measured and named, not attempted.
- **The 13-edge reconciliation residual** is not explained, only bounded.
- **`exports` and `overrides` corpus evidence is 58 and 2 edges** (58 since the
  2026-10-08 audit found the fully qualified `\define` it was refusing). `overrides` is
  2 rows in a vendored phpstan fixture under `phpunit/tools/.phpstan/vendor/` that is
  in neither canonical 60-file draw, so on the published draws that label compares 0
  rows to 0 rows and reads PASS. The rule is correct and the corpus contains almost
  no genuine same-file method overrides (2,631 classes carry a base, 26 have it in
  the same file, and the nearest ones redeclare nothing). The fixture and its mutants
  are the evidence here, not the differential.
- **The gate's resume semantics** are a shared-file defect this lane can measure but
  not repair; until they change, any lane's coverage verdict from a resumed run is a
  statement about the newly-walked files only.
- **Cross-file `overrides` at project scale**, because
  `AnalyzeContext.overrideCompanion` is still never populated in production.
---

## Round: the reason census as an artifact, and nested named functions (2026-10-07)

### 1. `unexplained = 0` stopped being a session result

The lane's central claim — every endpoint of every edge either resolves to exactly one published
declaration or names a reason the language makes unavoidable — was measured in a **gitignored
scratch file**. That makes it a statement about one session on one checkout. It is now an
instrument:

```
bun validation/m14/fixtures/php/reason-census.mts --out validation/m60/php/reason-census.json
```

Whole admitted population, production `parseFile`, 3m20s. Result on 2026-10-07, all 5,094 files:
**350,367 endpoints, 0 in a class this census cannot name**, from BOTH sides.

| target class | edges | share |
|---|---|---|
| `ambiguous:multiple-declarations` | 169,156 | 48.28% |
| `resolved:unique` | 115,660 | 33.01% |
| `variable-in-this-file` | 44,641 | 12.74% |
| `external:bare-name-outside-population` | 10,644 | 3.04% |
| `external:php-internal-function` | 4,498 | 1.28% |
| `external:php-internal-constant` | 2,085 | 0.60% |
| `external:php-internal-class` | 1,861 | 0.53% |
| `external:namespace-outside-population` | 1,536 | 0.44% |
| `no-declaration:file-path` | 204 | 0.06% |
| `placeholder:language-keyword` | 45 | 0.01% |
| `no-declaration:dynamic-callee` | 19 | 0.01% |
| `external:php-language-construct` | 13 | 0.00% |
| `declared-on-anonymous-class` (M37.13) | 5 | 0.00% |
| **`declared-in-tree-not-published`** | **0** | **0%** |

Source side: `source:published:{unique,ambiguous}` 320,473 · `source:global` 29,891 ·
`source:declared-on-anonymous-class` 3 · **`source:unexplained` 0** ·
**`source:declared-in-tree-not-published` 0**.

Three things about that table are the round's actual content.

**The defect class is reachable, and that is checked before the corpus is walked.** The
instrument runs a self-test over synthetic inputs first — 15 target probes and 10 source probes,
driven through the SAME functions the walk calls — including one probe that MUST land in
`unexplained`. A classifier that cannot produce its own defect class would report `unexplained = 0`
for everything, which is why the probe exists and why a failed probe exits 3 rather than printing a
table.

**Two of the four classes the census reported were the instrument's own bugs, and both were caught
by running it rather than by reading it.** (a) The source ladder asked "does this file's tree
declare the name?" BEFORE asking "did anything publish it?" — and every source of an edge inside a
declaration is by construction a name the file declares, so the first whole-population run filed
**3,568 of 3,689** edges of `markdown.php` as `source:declared-in-tree-not-published` while the
store held every one of those symbols. Resolution is now asked first, on both sides, and the
both-declared-AND-published case is a probe. (b) The anonymous-class detector looked for an
`object_creation_expression` with a `class` child, which the pinned grammar never produces — the
node is `anonymous_class` — so every member of every anonymous class was being filed as a defect.
Measured on phpunit's `ExporterTest.php` alone: `export`, `handles`, `__construct`,
`$representation`. A walk that cannot see anonymous classes makes M37.13 look like a bug.

**The census costs 3m20s and says where the minutes go** (`parseFile` 149.7s · tree walk 15.1s ·
classify 1.3s · population scan 9.5s). The population scan was 64.9s of a 91.7s run until it was
fixed: it read EVERY candidate file to hand `detectLanguageFromPath` its optional `content`
argument, which is consulted only for a file with no extension or a `.h` header. Path-only routing
took the census from "too slow to re-measure" to a run that fits in a coffee break.

### 2. The last shape of `DECLARED_IN_TREE_NOT_PUBLISHED`: a function declared inside a callable

`php/recovery-swallowed-members` closed the damaged-tree half of this bucket (PHPD36). The
**undamaged** half is a named `function` written inside another callable — PHPUnit's and Slim's
test-helper idiom — which the symbol walk cannot reach because callable bodies belong to
`walkBody`, whose job is call/read edges and scope frames and which publishes no symbols. The
store then holds edges SOURCED AT a declaration it does not hold: two `references` from
`testProcessRequest` in `slim/tests/MiddlewareDispatcherTest.php`.

Whole-population tree walk: **25** such declarations in **4** files. Twenty-two are `markdown.php`'s
recovery casualties (members, not nested functions — PHPD36); the remaining three are the shape:

| file | declaration | enclosed by |
|---|---|---|
| `slim/tests/AppTest.php:1563` | `function handle(...)` | `testInvokeFunctionName` |
| `slim/tests/CallableResolverTest.php:30` | `function testAdvancedCallable(...)` | `setUpBeforeClass` |
| `slim/tests/MiddlewareDispatcherTest.php:32` | `function testProcessRequest(...)` | `setUpBeforeClass` |

**The first probe was wrong, and correcting it was most of the work.** It asked only "is the
declaration's parent a `compound_statement`?" and read 280 hits — **250 of them in one file**,
phpunit's `src/Framework/Assert/Functions.php`, whose 251 assert helpers are guarded by
`if (!function_exists('assertSame')) { function assertSame(...) {...} }` at FILE level. A top-level
`if` is not a scope, and the ordinary walk publishes all 251 (measured: 252 symbols, 251 of them
functions). The rule is a CALLABLE node between the declaration and the program root, and the
damage predicate that separates the two populations is the declaration's body parent carrying
`hasError` (`true` for all 22 markdown declarations, `false` for all 3 Slim ones).

The fix publishes them as KIND `function` owned by the file's NAMESPACE — exactly as a top-level
function — from a pass that does **not** re-walk the nested body, because that body has already
been walked by the enclosing callable's `walkBody` and re-walking it would emit every call and read
inside it a second time under the nested name. Full reasoning, the two rejected readings and the
family check (javascript/typescript publish a nested `function innerHelper() {}`; python/ruby do
not, and PHP's global-function semantics are the javascript ones) are in PHPD37.

Measured delta, all 5,094 files, production path, before/after with the same instrument:

| quantity | before | after |
|---|---|---|
| `edgesTotal` | 350,364 | **350,367** (+3, all `contains`) |
| `RESOLVED_UNIQUE` | 129,061 | **129,064** (+3) |
| `perType.contains` | 35,109 | **35,112** |
| published names | 21,222 | **21,224** |
| member (owner, name) pairs | 32,552 | **32,555** (+3) |
| `DECLARED_IN_TREE_NOT_PUBLISHED` | 12 | **10** |

and **zero delta in every other bucket and every other edge type** — no new ambiguity, no changed
source attribution, `calls` and `uses` identical to the digit. That last line is the difference
between resolving edges and inventing them.

Evidence: `validation/m14/fixtures/php/nested-named-functions.php` + `.expectation.json` (authored
before the fix; pre-fix state measured at 6 symbols / 10 edges against 8 / 12 after, with two
`expectRelationshipCount` rows that fail if the body is ever walked twice) and four mutants, all
caught — `php/drop-nested-function-symbols` (the pre-fix state), `php/publish-nested-functions-as-methods`
and `php/publish-nested-functions-as-bare-globals` (the rejected readings),
`php/publish-damaged-body-declarations-as-nested-functions` (the damage guard removed).

**Known and NOT changed, recorded with its count rather than blessed:** call/read edges inside a
nested function's body are attributed to the ENCLOSING callable — `calls registerHelper -> decorate`
on the fixture, where the call is written in `nestedHelper`'s body. It is an attribution decision,
not an unexplained endpoint (the enclosing callable is published, so the census is silent about it),
and the fixture records the behaviour without pinning it as correct.
### 3. The ambiguity ceiling, priced before anything was implemented

`ambiguous:multiple-declarations` is the largest class the census reports — **126,342 endpoints,
36.06%** — and it is the one the lane has never been able to size. Counting it is not the same as
knowing whether it can be closed, so the same run now asks, for every ambiguous endpoint, WHICH
STAGE would leave exactly one candidate, under a stated order: the SOUND filters first (the
`metadata.owner` channel, then the type's callable/type-kind rule), then the PREFERENCES (same file,
then the file's own namespace).

| stage | endpoints | share of ambiguous |
|---|---|---|
| **still ambiguous after every lever** | **107,313** | **63.44%** |
| **resolved by the owner channel via the class's ANCESTORS** | **24,223** | **14.32%** |
| resolved by `+ same-file preference` | 20,368 | 12.04% |
| resolved by `+ namespace preference` | 10,188 | 6.02% |
| emptied by the KIND filter | 3,129 | 1.85% |
| resolved by `filters (owner + kind)` | 2,756 | 1.63% |
| emptied by the OWNER filter | 1,179 | 0.70% |


**The largest lever is the only one that is not a preference.** 24,223 endpoints (14.32%) would
resolve by walking the enclosing class's ANCESTORS — `$this->persist($record)` written in a subclass
whose parent declares `persist` is not a guess about which of N candidates was meant, it is PHP's own
method resolution, and the ancestors come from the store's own `extends`/`implements` edges, so
nothing is inferred about a class the graph does not connect. It also nearly EMPTIES the class it
acts on: 25,402 endpoints were emptied by the owner filter and only **1,179** remain emptied after
the ancestor walk, i.e. **95.4% of the members whose owner publishes nothing are inherited members
whose parent the store already holds**, and the residue is the genuine external boundary — a parent
outside the population.

Trait use is deliberately NOT in the map, which makes 24,223 a LOWER bound: `uses` is also how every
ordinary value read is spelled (`save -> record`), so a heritage map that accepted it would be
mostly noise, and the two edges that are real trait flattens cannot be told apart at this level.

Everything else in the table is smaller AND riskier. The same-file preference (20,368) and the
namespace preference (10,188) each REPLACE a resolution rather than narrow one, and the sound
filters cover 2,756 — four times less than the inheritance rule, which is why the inheritance rule
is the next change worth making and the preferences are not.

Three sentences are the finding.

**No lever reaches most of it.** 63.75% of the lane's ambiguity survives the owner channel, the
kind rule, same-file preference and namespace preference applied together — `uses` 48,839,
`calls` 21,052, `imports` 4,509, `contains` 2,783 — and the top names say why: `metadata` (6,477),
`value`, `result`, `config`, `message`, `name`, `response`, `configuration`. These are generic
member names read off a receiver whose TYPE is not known (`$response->metadata`), and no
resolution rule over a name index can decide them. It is a type-inference wall, not a naming one,
and it is now a number instead of an intuition.

**`emptied-by-*` is not a resolution, and 17,964 endpoints are in it.** 15,791 of them are emptied
by the OWNER filter — the edge carries `metadata.owner` and NO candidate carries that owner, which
makes them inherited or foreign members, the same family as the lane's existing *cause A* — and
2,173 are emptied by the KIND filter, i.e. the name is published but not as anything the type can
legally point at (`calls` to a name published only as a `property`). Folding either into "closed"
would have been the easy, wrong reading: the first turns an ambiguity into an unresolved endpoint
and the second is a defect-adjacent signal about the edge, not about the store.

**A preference changes a resolution; a filter narrows one.** Only 3,172 endpoints are resolved by
sound narrowing. The 24,667 that the two preferences would resolve are the risky half — each one
replaces today's N-way ambiguity with one named declaration, and this lane has already measured what
that looks like when it goes wrong: a bare-name fix that resolved +225 edges and was, on inspection,
a cross-repo collision. So the preferences stay unpriced-as-features until each has its own
fixture, mutant and before/after, and the artifact carries that caveat in the data rather than in
this paragraph.

The lever section costs 88 s of the run (4m48 vs 3m20) and every stage it reports is driven by the
same self-test the classifier is: six lever probes, so a stage that never fires and a stage that
always fires cannot look alike in the table.

### 4. The census's third self-found bug: it classified each file against a partial store

Found while adding the incoming direction, and it changed the table above — so it is stated rather
than patched over. The walk classified each file's edges against the publication index **as it stood
when that file was reached**, so a declaration published by a LATER file was invisible to an EARLIER
one. A single pass cannot see that: every class it printed was internally consistent. What exposed
it was asking a DIFFERENT question of the same data (does any edge REACH a declaration?), where the
contradiction showed up as 119 `variable-in-this-file` and 56 `external:bare-name-outside-population`
edges counted as naming declarations they could not have named at the time.

The fix is two passes — PASS 1 parses every file, indexes its symbols and keeps every edge in minimal
form; PASS 2 walks the trees and classifies against the COMPLETE index — and its effect on the table
is exactly the direction you would expect from a store that was too small: **29,181 endpoints left
`external:bare-name-outside-population`, 5,142 left `external:namespace-outside-population`, and
`resolved`/`ambiguous` grew by 6,107 and 42,814.** The class that shrank is the one that reads as a
boundary of the CORPUS rather than as work, which is why the bias flattered the lane.

The corrected numbers are also the ones that agree with the lane's **independent** whole-population
audit: 10,644 bare-name and 1,536 namespace-outside are audit4's numbers to the digit, and its
internals (8,444) match 8,457 across the four internal classes. The biased run was the outlier, and
the two-pass run costs nothing extra — the tree phase is 11.6s because it was never the expensive
half (parseFile 193.9s of the 3m52 run).

### 5. The incoming direction, measured over the whole population for the first time

The lane's incoming row came from a 30-file and a 600-file SAMPLER, and the programme's ledger
records "incoming resolves in 0 of 23 lanes". The same run now answers it from the declarations, over
every edge, with four buckets that exhaust the population (a control asserts their sum):

| bucket | declarations | share |
|---|---|---|
| reached by ≥1 resolving edge | 21,144 | 52.51% |
| — of them, reached AND named by an unresolved edge | 3,794 | 9.42% |
| — of them, reached with no competing writer | 17,350 | 43.09% |
| **NAMED BUT REACHED BY NONE — the incoming hole** | **14,371** | **35.69%** |
| neither reached nor named | 4,751 | 11.80% |

**The hole has exactly ONE cause**: all 14,371 declarations are named by edges whose class is
`ambiguous:multiple-declarations`, and by nothing else — no `mixed` bucket, no external, no keyword.
That is the finding the direction needed: php's incoming side is not a missing reverse walk and not a
second defect; **it is the outgoing ambiguity seen from the other end**. Which means the 63.44% of
the lever table above is not only the outgoing ceiling — it is, to the endpoint, the incoming one.

Two smaller facts the section pins. 17,350 declarations are reached without any competing writer —
public symbols with a single caller, which is what a healthy graph looks like at its edges. And 542
edges resolve with no single identity: `overrides` is the one resolver that accepts a (owner, name)
key with one OR MORE publishers (`keyed >= 1`) while every other resolver asks for exactly one, so
the number is that looseness surfacing rather than a store defect — a consistency metric this
instrument prints instead of hiding.

## Round: the harness had lost php's independent truth (2026-10-08)

### 1. Two gates that had never once run, and the verdict the first one gave

`script/m60/php-oracle-independence.ts` and `script/m60/php-line-contract.ts` both pinned
`ROOT = "$HOME/backbencher-brain"`. This lane's checkout is `…/mcp/backbencher-brain`,
so both died on their first `import` — `Cannot find module …/src/ast/engine.ts` — and BOTH readings
the lane had of them ("the gate is proven to fail", "the line contract holds") were readings of
nothing. A gate that cannot start is indistinguishable from a gate that passes, which is why the
first thing this round changed is a path: ROOT is now `path.resolve(path.dirname(
fileURLToPath(import.meta.url)), "../..")`, the same derivation `ruled-gate.ts` uses.

The independence gate's first real output:

```
  independent replacements (must be defined AND wired):
    MISS phpDeclaredTypeRefs    -> derivePhpDeclaredTypeEdgesIndependent    defined=0 refs=0
    MISS phpStaticCallableName  -> phpIndependentCallableName               defined=0 refs=0
    MISS phpStaticIncludePath   -> phpIndependentStaticIncludePath          defined=0 refs=0
  truth loop calls the SHARED declared-type derivation: YES (violation)
php oracle independence: FAIL        (6 violations)
```

### 2. What the merge took, and why nothing could notice

The pickaxe with merges (`git log -m --full-history -S`) names the drop: `dc7b8b494` — "merge:
origin/main into main — 607 remote commits united with 502 local". The same merge's syntax splice in
`differential.ts` was repaired twice afterwards (`d4c4bba34`, `db077c5a6`, both "a duplicated '}'
after the zig truth block closed the per-file lane loop early") and the CONTENT loss rode through
both repairs unmentioned, because the only instrument that could have named it was the one that
could not start. `reviews/php/master-review.md` kept the claim it was written with: "**oracle
independence** | **0 shared rules.** … each measured at **0 disagreements** against the version it
replaced, on 4,463 files. Gated by `script/m60/php-oracle-independence.ts` (exit 1 on violation;
proven to fail)." A claim is only as good as the instrument that can still read it.

Both commit states are checkable and were checked, not inferred: each name is present at
`93d5b5e65` (and `abae80c43` for the fifth) and absent at HEAD; `git merge-base --is-ancestor`
confirms both are ancestors, so this is a LOSS rather than work that never landed.

### 3. The restore, and the property it was held to

Restoring a rule from history is a provenance operation, not a rewrite: the body that lands must be
the body that was measured, or the measurement in its header describes a different function. So
each restored block was verified with `diff` against the authoring commit:

```bash
git show 93d5b5e65:script/m14/differential.ts | sed -n '10396,10745p' > /tmp/expect-block.ts
# extract the same block from the working file, then
diff /tmp/expect-block.ts /tmp/got-block.ts      # empty => byte-exact
```

| restored | where it lives now | verification |
|---|---|---|
| `phpIndependentStaticIncludePath` (`imports`) | `script/m14/differential.ts` | byte-exact, 350-line block |
| `phpIndependentCallableName` (`calls`) | `script/m14/differential.ts` | byte-exact, same block |
| `derivePhpDeclaredTypeEdgesIndependent` (`references`) | `script/m14/differential.ts` | byte-exact, same block |
| `derivePhpContainsEdges` (`contains`) | `script/m14/oracles/php-contains.ts` (lane-owned: the `dart-contains.ts` precedent) | byte-exact, 151 lines |

The three in `differential.ts` must be defined THERE — the gate's `definedCount` reads that file's
text, so a module plus a re-export would read `defined=0`, and the definition IS the assertion. The
`contains` oracle has no such constraint, so it went to `script/m14/oracles/` where a lane's lines
cannot conflict with another lane's.

Registration is not optional and not one edit: `contains` needed the import, the truth loop
(`for (const e of derivePhpContainsEdges(root))`), and php's entry in the compared-labels list.
Without the third, the truth rows are computed and then ignored by the comparison — the exact
failure the oracle's own header names ("the type is stored and compared against nothing").

### 4. What the restore immediately found, and it is the point of restoring it

The `contains` label went from unaudited to compared, and the comparison reads:

```
[phpunit]    files=60 tree-truth=1776 covered=1773 (99.8%) MISSING=3 | analyzer-edges=1774
             unexplained=55 (3.1%) | unexplained-by-label: contains=55
[phpmyadmin] files=60 tree-truth=2459 covered=2459 (100%)  MISSING=0 | analyzer-edges=2457
             unexplained=56 (2.3%) | unexplained-by-label: contains=56
```

Reproduce: `BB_F5_SHOW_SAMPLES=1 bun script/m14/differential.ts --lang php --force-fresh`
(`--force-fresh` matters: without it the journal answers with the PREVIOUS draw's rows, and the
samples are not printed at all). All 80 printed samples are the same shape — `contains
PHPUnit\TextUI -> TestRunner`, `contains PhpMyAdmin\Controllers\Export -> …` — and 80 of 80 sources
carry a namespace separator, 0 are class-form. So the analyzer is not wrong here: the ORACLE is
incomplete by exactly one deliberately adjudicated feature (M60's namespace containment), because
its shape map lists only `class_declaration` / `interface_declaration` / `trait_declaration` /
`enum_declaration` bodies as containers and it was authored before that feature existed.

The honest reading of the number: it is NOT 111 missing edges and NOT a regression. It is one
known gap in a rule that shares no code with the analyzer, which is the only reason the gap is
visible at all — the shared version of this rule could not have produced the row.

### 4b. The gap, closed — and both directions checked, because one direction proves nothing

The oracle gained one marked section (`M60 NAMESPACE CONTAINMENT`), re-derived from the tree
rather than read from the analyzer: a NAMESPACE owns the declarations at FILE SCOPE under it
(a top-level `if` is not a scope, which is why phpunit's 251 `if (!function_exists(…)) { function
assertSame(…) {…} }` helpers are file-scope and are contained by their namespace), while a
declaration inside a NAMED TYPE stays its class's member and a declaration inside a CALLABLE is
the separate shape the oracle declares it does not model. The two namespace spellings are handled
separately because the tree keeps them apart — braced (`namespace A { … }`, the block is the
scope) and semicolon (`namespace A; …`, the scope runs to the next definition or to end of file).

```
                          truth rows   covered        MISSING   analyzer-edges  UNEXPLAINED
phpunit      rot 4          1,003      1,002 (99.9%)     1            963        0  (0%)
phpunit      rot 5          1,094      1,093 (99.9%)     1          1,065        0  (0%)
phpmyadmin   rot 4          2,542      2,541 (100%)      1          2,522        0  (0%)
phpmyadmin   rot 5          2,419      2,417 (99.9%)     2          2,383        0  (0%)
```

Reproduce: `BB_F5_SHOW_SAMPLES=1 bun script/m14/differential.ts --lang php --force-fresh`.
Two draws, because the 60-file draw ROTATES (`rot 4`, `rot 5` — the corpus is 2,907 and 1,232
files, so totals are not comparable across runs and a single draw is not a measurement).

BOTH DIRECTIONS MATTER and only one of them was the question. `unexplained = 0` says the analyzer
emits nothing the oracle cannot derive — that is the 111 closed. It would ALSO read 0 if the oracle
had grown to emit the analyzer's own output, so the check that costs nothing and proves the most is
the other column: `MISSING` stayed at the pre-existing include-path rows
(`references (expr) -> __DIR__/../../_files/BankAccountTest.php`,
`references (expr) -> ROOT_PATHapp/vendor_config.php`) — the differential's known stale-label item,
NOT `contains`. A truth that had over-generated would have shown up here as `contains` rows.

NO MUTANT PINS THIS SECTION, and that is stated rather than glossed: the mutant registry
(`script/m14/php-mutants.ts` → `mutate-analyzer.ts`) transforms the ANALYZER's result, so it cannot
reach a truth derivation at all. The pin is the differential reading above; the revert is deleting
the marked section and the observable is `unexplained = 111` (55 phpunit + 56 phpmyadmin on that
draw) coming back with every sample a namespace-shaped `contains`.

DECLARED RESIDUAL, with its count, in the population rather than in these two corpora: the oracle
still does not model a named function declared inside a CALLABLE (PHPD37 — 3 declarations,
all in Slim, none in phpunit/phpmyadmin) nor the recovery-escaped members of `markdown.php`
(PHPD36 — 22 declarations, in FSharp.Formatting). Both are analyzer-published `contains` edges
outside the pinned corpora, so neither can appear in this differential; they remain counted here
rather than implied absent.

### 4c. The stale include-path label — and with it `imports`, the second of php's three missing oracles

The lane had already adjudicated this and had not fixed it, because the file is shared machinery
("One differential MISSING row is a stale oracle label, not a missing edge", §5 of the previous
round). The truth's include leg pushed `references` under a comment reading "Mirror the analyzer's
emitInclude: references -> the include path" — and the analyzer stopped filing it that way in
M12.PHP-IMPORTS (`emitInclude`: a `require` is "a module dependency, not a symbol reference. It was
filed as `references`, which mislabels a file-level edge as an intra-file symbol read"). The PATH
rule was never wrong, only the label, so the row could never match.

**Relabelling it alone would have fixed nothing, and that is the part worth writing down.** The
comparison filters the ANALYZER side by a per-language allowlist; php's entry had no `imports`, so
the analyzer's include edges were dropped from the comparison entirely — and php's `imports` had NO
truth derivation at all, which is why `rel-type-coverage-gate` counted the label as DERIVATION
("emits `imports` but the differential audits [...]"). Either edit alone is a trap this file records
twice: an oracle with no allowlist entry compares nothing, and an allowlist entry with no oracle
reads every truth row MISSING.

So both halves were built from the TREE, not from the analyzer's helpers:

```
  `namespace_use_declaration`   direct `namespace_use_clause` children (plain), or a
                                `namespace_name` PREFIX beside a `namespace_use_group` whose
                                children are the clauses (grouped)  -> `imports`, FQN AS WRITTEN,
                                prefix-joined for a grouped member, and the `as` alias deliberately
                                NOT part of the target: the alias names the BINDING, the dependency
                                is the name imported.
  include / require             the path rule the oracle already carried, now labelled `imports`.
```

```
BB_LABEL_DUMP=php bun script/m14/differential.ts --lang php --force-fresh

rot 7  lane        calls  contains  implements  imports  uses   verdict
       phpunit      284      320        13        280    230   100% · MISSING=0 · unexplained=0
       phpmyadmin   668      506        13        596    845   100% · MISSING=0 · unexplained=0
rot 6  both lanes   -        -          -         -      -     100% · MISSING=0 · unexplained=0
```

The `imports` column is the evidence, and the reason it is printed as a PAIR: **280 truth rows and
280 comparable analyzer rows on phpunit, 596 and 596 on phpmyadmin** — equal counts, on both
sides, on a label that had zero truth the day before. Equal is the point: a label whose truth is
absent reads as unexplained on the analyzer side, and a label whose allowlist entry is absent reads
as MISSING on the truth side, so a single-sided number cannot tell a working comparison from a
vacuous one. Two draws, because the 60-file draw rotates.

`script/m60/rel-type-coverage-gate.ts`, the gate that counted the gap, now reads:```
  php          1 un-audited: ["exports"]                        (was ["contains","imports","exports"])
```

and one round later that line is **gone**: after `script/m14/oracles/php-exports.ts` was imported,
registered and admitted to php's compared-label set, the same gate prints **no php row at all**
(`emitted` == `audited` == the same ten labels, DERIVATION list empty) and `baseline: 104 recorded,
79 NEW, 61 repaid`. php appears in NO regression row. The gate still exits 1 on those `79 NEW` rows
that belong to OTHER lanes — a shared debt baseline that predates this session's merges — and that is
reported here rather than edited: the baseline is a supervisor artifact covering 48 lanes, and this
lane's rows in it went down, not up.

### 5. What the same merge still holds: `buildPhpOverrideCompanionWithVisibility`

`php-line-contract.ts` imports `buildPhpOverrideCompanionWithVisibility` from `differential.ts`.
That name existed at `abae80c43` (definition at 10784 plus two call sites, one of them in the
differential's own override path) and does not exist at HEAD. With ROOT fixed the gate now fails at
that import (`TypeError: … is not a function`), which is recorded here rather than papered over —
this is why php has no line-contract artifact, and it is a DIFFERENT defect from the path bug that
hid it. Restoring it is not a body copy: its two call sites have to be read against today's file
(the differential's php override plumbing has moved on), so it is the next item, not a patch.

### 6. What this round did NOT change

No analyzer source, no fixture, no expectation file, no census number. The population readings in
`sections above are unchanged by construction: `script/m14/differential.ts` is the HARNESS, and the
only edits to it are the three restored rules, the restored oracle registration and the php entry
in the compared-labels list. `validation/m60/php/reason-census.json` is untouched and still reads
350,367 edges / unexplained 0.

## Round: php had no project-wide hierarchy in the store (2026-10-08)

The ambiguity census priced php's one **sound** lever at **24,223 endpoints** (`owner+inherited`: a
member read through the enclosing class's ancestors — `$this->persist()` in a subclass whose parent
declares `persist`). This round did not implement that lever, and the reason is the finding: it
could not have been implemented, because the column an ancestor walk has to read was empty for php.

### 1. The lever's precondition, and it was false

An ancestor walk needs the class hierarchy **in the store**, and there is exactly one seam that puts
it there: `src/ast/parallel-indexer.ts:3590` binds `symbol.metadata.superTypes` into
`brain_symbol.super_types`. `src/ast/override-retarget.ts` consumes it and opens with

```ts
if (supertypes.size === 0) return out // no hierarchy persisted: nothing to do
```

php published heritage as EDGES and never on the symbol — the class metadata carried `baseClass`,
`interfaces`, `extendedInterfaces` and `implementedInterfaces`, and the one key the seam reads was
never set (`grep` for `superTypes` in `real-php-analyzer.ts` returns nothing; the only heritage key
is `baseClass`). So `super_types` was NULL on every php row, the pass above returned before its
first query, and php's inheritance was, to a consumer holding the store, **absent rather than
thin**. This is the same defect class the lane has hit repeatedly — a fact the analyzer produces
and a later layer drops — with the difference that here nothing was wrong with the fact; there was
no fact.

### 2. The payload, and the rule it is held to

`metadata.superTypes` is published on all three declaration shapes that can have heritage — class
(extends base + `class_interface_clause`), interface (`base_clause` parents), enum
(`class_interface_clause`, the PHP 8.1 shape) — and it is held to a MIRROR: **the payload carries
the same spellings and the same omissions as the heritage edges the same declaration emits, and
derives nothing of its own.** Every part of that is a decision the analyzer had already made for the
edge, reused rather than re-decided:

- the class payload is assembled from `baseUnresolvable`/`baseName`/`interfaces`, so a base
  `heritageTarget` could not separate from the class's own name (PHPD10: `class
  InvalidArgumentException extends \InvalidArgumentException`) is absent from the payload for the
  same reason it emits no `extends` edge — a self-loop is always fabrication, and writing one into
  the column that exists to be WALKED is worse than omitting it;
- a same-leaf QUALIFIED base keeps its qualification (`Forms\User\FeaturesForm`), because the leaf
  is the class's own name and a consumer holding the column cannot re-leaf it;
- the enum branch's duplicated `heritageTarget` derivation — once for the edges, once inside the
  metadata expression — is now ONE list feeding both, which is how a payload and its edges drift
  apart;
- the key is **omitted** when the list is empty, because the store's own test is
  `Array.isArray(...) && length > 0`; the two are one fact downstream, so the omission is a spelling
  choice and the fixture pins it so it cannot drift without a decision.

**TRAITS ARE ABSENT, deliberately.** `use SomeTrait` is not a heritage clause: this column is walked
as a nearest-declaring-ANCESTOR chain, and a trait is a flattened mixin rather than an ancestor, so
admitting it would change what "nearest" means for every class that mixes one in. A declared
boundary, not an oversight. This makes 24,223 a LOWER bound on the lever, as the census already said.

### 3. The evidence, in the order that makes it evidence

`validation/m14/fixtures/php/heritage-published.{php,expectation.json}` was authored **before** the
analyzer change and read **FAIL** on six payload rows plus one edge row (the edge row was the
fixture's own error — `Base implements First`, not `extends` — and was corrected rather than
"fixed" in the analyzer). It pins the mirror in both directions: base+interfaces, interfaces-only,
an interface's parents, an enum's implements list, the qualified same-leaf base, and the
`meta.superTypes: null` rows on `NoHeritage`, `PlainIface` and `InvalidArgumentException`, plus a
`forbidRelationships` row stating that no `extends` edge may leave the unresolvable class at all.

```
php fixtures                28/28 PASS   (was 27)
php mutant-check            19 caught / 0 survived / clean baseline   (was 16)
shared mutant registry      71 caught   (was 68), BB_MUTANT_ONLY=php/
```

The three new mutants are the three ways the payload fails, and they are not interchangeable: the
payload **vanishes** (nothing else in the ontology moves, which is why it stayed invisible for so
long), the payload keeps the **base only** (the accidental half — `baseClass` already existed, so
mirroring just that costs nothing and leaves a column that looks populated and is half the
hierarchy), and the payload **names a heritage the declaration does not have** (the naive
re-derivation from node text, which writes the PHPD10 self-loop into the walked column). All three
are caught by that one fixture.

`validation/m14/fixtures/php/store-heritage-roundtrip.mts` is new, and it exists because the
fixture next door cannot see the seam this round is about: it stores four committed fixtures through
the real `storeResults`, reads the database back with SQL, and asserts

```
  the store holds a php hierarchy at all                    9/58 symbols non-NULL
  base AND interfaces / interfaces-only / interface parents / enum implements   all exact
  a same-leaf QUALIFIED base keeps its qualification        Forms\User\FeaturesForm
  no heritage, no parents, unresolvable same-leaf base      NULL (not [])
  MIRROR: every stored hierarchy == its stored extends+implements targets   9 symbols, 12 edge rows
  a subclass whose base is in ANOTHER file                  SubContract -> ["BaseContract"]
  negative controls (an undeclared name yields no rows; the comparator rejects a one-member
    difference and ignores order)
  CONTROL: the same files with `metadata.superTypes` stripped store NULL on EVERY symbol  0/58
```

The last row is the one that makes the others mean something: the payload is removed from the
analyzer's OWN result in memory and stored into a cold project, which reproduces the pre-change
state from the result rather than from a description of it. Without it, a `super_types` column
filled by some other path would satisfy every row above.

### 4. What that gate found on its way in, and it is not this round's defect

Re-storing the SAME project loses a relationship row, and the row is a cross-file heritage edge:
**70 -> 69 relationships, 12 -> 11 of them `extends`/`implements`, the lost row being `extends
SubContract -> BaseContract`**. The mechanism is `src/ast/parallel-indexer.ts:2928-2929`, which runs
before every file's inserts:

```sql
DELETE FROM brain_relationship WHERE target_symbol_id IN
  (SELECT id FROM brain_symbol WHERE file_id = ?)
```

— every relationship **from any file** that targets this file's symbols. On a COLD store that delete
finds nothing for a cross-file row, because its `target_symbol_id` is still NULL and only the
post-index resolution pass fills it. On the SECOND store it finds them: the previous run's
resolution already filled the column, so the target file's own turn deletes the inbound edge, and
the source file — stored EARLIER — is never asked to re-emit it. **The order is the proof, and it
was run rather than argued**:

```
  defining file stored LAST    1st store 12 heritage rows · 2nd 11 · 3rd 11   (never returns)
  defining file stored FIRST   1st store 12 heritage rows · 2nd 12 · 3rd 12   (no loss)
```

Nothing is lost when the target is stored before the source, which is why this has gone unnoticed:
it only bites the direction the file walk happens to order late, and it bites **permanently**. It is
shared store machinery (`parallel-indexer.ts` is workstream §8), so it is REPORTED here with the
exact row and the experiment and **not edited**. The gate keeps it visible without letting it turn
this round's green rows red: the loss is printed with the row, the re-index probe's own operation is
asserted (a zero-row read would otherwise report "no loss"), and the exit code carries only the
claim. If the store is fixed, that section prints OK and stops describing a defect, so it cannot
decay into a stale sentence.

### 5. What this round does NOT claim

- **Not that the walk is sound.** The existing consumer keys its `supertypes` map on the symbol's
  bare `name`, and this fixture set alone declares `FeaturesForm` in two files — a name-keyed
  consumer merges them. That is the leaf collision the `overrides` oracle bounded itself around, it
  is a consumer decision, and it is not measured here.
- **Not that the lever moved.** Zero edges and zero symbols changed; the payload is metadata. The
  census still prices `owner+inherited` at 24,223, and its ancestor map is built from the analyzer's
  `extends`/`implements` EDGES, which this round did not touch.
- **Not that php's hierarchy is complete.** Only the shapes above publish it, and nothing here
  measures what share of php's 40,267 declarations now has a walkable ancestor in the store.

### 6. One asymmetry found and not fixed

The class and interface branches SKIP a same-leaf parent that qualification cannot separate from the
declaration's own name, and **the enum branch has never had that guard**: `enum Foo implements
\Foo` would emit a self-implements edge (and now a self-referencing payload entry). Removing an edge
is a differential-visible change — the oracle's side would have to move with it — and needs its own
before/after count over the population, so it is recorded as an open, unpriced shape rather than
folded into an additive payload change.

### 7. What the same merge still holds: `buildPhpOverrideCompanionWithVisibility`

Unchanged from the round above: `php-line-contract.ts` still imports it, it still does not exist at
HEAD, and restoring it still requires reading its two call sites against today's differential.

### 8. Gates re-run

```
  npx tsc --noEmit -p tsconfig.json                  clean
  bun script/m14/run-fixtures.ts --lang php          28/28 PASS
  bun validation/m14/fixtures/php/mutant-check.mts   19 caught / 0 survived / clean baseline
  BB_MUTANT_ONLY=php/ bun script/m14/mutate-analyzer.ts   71 caught
  bun validation/m14/fixtures/php/orphan-endpoint-gate.mts PASS (0 strict orphaned contains targets)
  bun script/m60/php-oracle-independence.ts          PASS
  bun validation/m14/fixtures/php/store-heritage-roundtrip.mts  16 checks PASS + 1 report
  npx tsx script/m14/differential.ts --lang php --sample 60
      phpunit     files=60 tree-truth=1065 covered=1065 (100%) MISSING=0 | analyzer-edges=1045 unexplained=0
      phpmyadmin  files=60 tree-truth=2682 covered=2682 (100%) MISSING=0 | analyzer-edges=2646 unexplained=0
```

## Round: the member channel — the store was answering member reads with the alphabetically first declaration (2026-10-08)

Round 5 ended with the ambiguity census's one **sound** lever priced at **24,223 endpoints**
(`owner+inherited`) and named as the next piece of work. This round went to implement it and found
the thing standing in front of it, which is worse than the ambiguity the census measures: **for a
member read, the store was not leaving the row ambiguous. It was resolving it, confidently, to the
alphabetically first declaration of that name in the project.**

### 1. Two halves of one defect, and neither is visible from the analyzer

**(a) php published no qualified name for a member, so the store's FIRST strategy was a name
strategy.** `src/ast/parallel-indexer.ts` resolves a relationship target by EXACT `qualified_name`
match before any post-index pass runs, through an index built
`SELECT qualified_name, MIN(id) ... GROUP BY qualified_name` — a deterministic winner per qualified
name, which is the RIGHT rule when a qualified name identifies one thing. php set neither
`qualifiedName` nor `metadata.fqn` on a member, so `qualified_name` was the BARE member name and the
tie-break `MIN(id)` was doing the identifying. `render`, `persist`, `handle` are method names on
hundreds of classes.

**(b) The insert-time resolver answers member targets before any of those passes run.**
`resolveTargetStmt` (`src/ast/parallel-indexer.ts:2726`) resolves a target by bare name at insert
time:

```sql
WHERE s.project_id = ? AND s.name = ?
ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
LIMIT 1
```

— same file first, then lexicographic `s.id`, which is `${fileId}:${name}:${line}` compared as TEXT.
So within a file that declares several members of one name, the winner is the alphabetically first
line, and the row is stored RESOLVED.

Both halves produce the same outcome: **a wrong answer in the expensive direction.** A reverse walk
from `AlphaStore::persist` reports callers in files that never mentioned it. And the lane's own
census could not see it, by construction: the census measures the ANALYZER's endpoint resolvability
against the analyzer's own symbol set — 169,156 endpoints read "ambiguous, 48.3%" — and never asks
what the store then BOUND the row to. An instrument cannot find a defect in a layer it does not read.

### 2. What was changed, and the two stages it implements

**Member identity.** `publishMemberIdentity` (`real-php-analyzer.ts`) sets `qualifiedName` to
`Owner.member` on every symbol whose owner is class-like — class, interface, trait, enum — which
covers methods, properties, class constants and enum cases. This restores the index's contract:
a BARE member target no longer matches a member's qualified name, so an unprovable member read is
left UNRESOLVED (NULL, the honest state) instead of being attached to whichever declaration sorts
first, and a target that IS spelled `Owner.member` — which is how `overrides` has always spelled its
targets — now matches exactly (which is also the first time `retargetCrossFileOverrides`'s
`methodsByOwner` index, keyed on `qualified_name` ending in `.${name}`, has found anything for php,
however populated `super_types` was).

*Deliberately not set when the owner is a NAMESPACE*: a namespaced function's `metadata.fqn` is
already php's own `Fixture\MemberId\helperFn`, and minting a dotted second spelling for the same
declaration would create a symbol two of whose names match nothing — the aliasing this rule exists to
remove. The fixture pins both halves, including the absence.

**The owner channel** — `src/ast/member-owner-resolution.ts`, wired into `storeResults` after the
override retarget. It implements exactly the two stages the census calls SOUND, and refuses the rest:

```
  stage 1  ownerResolved      the receiver's OWN class declares the member        (census: 2,756)
  stage 2  inheritedResolved  no ancestor… one ancestor's chain declares it       (census: 24,223)
```

The receiver's class is read from `metadata.owner` — the analyzer's own signal, published for
`$this->`, `self::`, `static::` and `parent::` receivers, and NEVER for a read off a local variable,
because that receiver's type is not knowable from one file. The walk reads
`brain_symbol.super_types`, the column round 5 filled for php. It **only ever fills a NULL
`target_symbol_id`** and never re-points a resolved row, so it cannot invent an edge; when the
receiver's name is carried by two declarations it resolves by IDENTITY (the enclosing declaration's
own store id) rather than by name; and it declines — leaving the row NULL with a counted reason — on
`ambiguousOwner`, `notDeclared`, `ambiguousInChain`, `ownerNotInPopulation`.

**NOT implemented, and this is a decision rather than an omission:** the census's preference stages —
`same-file` (20,368), `namespace` (10,188), `emptied-by-kind` (3,129), `filters` (2,756),
`emptied-by-owner` (1,179). Each REPLACES a resolution rather than narrowing one, so each would move
the number without a rule that says the replacement is right; the census records them as priced but
not sound, and no part of this round adopts one.

### 3. Evidence, and the order it came in

**The gate** — `validation/m14/fixtures/php/owner-resolution-gate.mts` — indexes four committed
files built so that EVERY name-keyed strategy must decline: the member names collide project-wide
(`persist` ×3, `solo` ×2, `dup` ×2), so `_res_name_unique` (`HAVING COUNT(*)=1`) cannot fire and the
dotted fallback has no dot to split. It keeps the pass's claim and the store defect apart, and the
defect half is PINNED BY NAME, because the day the store stops mislanding those rows this gate must
go red and the change must be acknowledged rather than absorbed:

```
  PINNED  $this->persist() written in GammaStore is stored RESOLVED against AlphaStore::persist
  PINNED  goPlain -> persist (a LOCAL VARIABLE: the type is unknowable) is stored RESOLVED against AlphaStore
  PINNED  goTwoAncestors -> dup (two ancestors declare it) is stored RESOLVED against DupIface
  PINNED  goAmbiguousParent/Ancestor -> solo is stored RESOLVED against one of the two Twins
  PASS    goExternalBase -> getMessage: the one row the store gets right, by finding nothing
```

The claim half runs the pass against the input it DECLARES (rows with NULL targets, which it clears
in the store first, because a resolver whose caller gets there first has no other way to be
measured):

```
  DIRECT      $this->persist() -> the class that DECLARES it            GammaStore
  INHERITED   written where nothing declares it -> ONE ancestor         BetaStore
  COLLIDING   $this->solo() in one of two `Twin` classes -> by IDENTITY Twin@gamma.php
  NEGATIVE ×5 goPlain, goTwoAncestors, goExternalBase, goAmbiguousParent, goAmbiguousAncestor
              all stay NULL, each with the rule that declined it named in the fixture source
  counters    ownerResolved=2 inheritedResolved=1 ambiguousOwner=1 notDeclared=2 — read back off
              the rows, so the pass's own counters are checked against the database
```

**Three stores, because one cannot separate the two signals.** The same four files are stored three
times, one signal removed from the analyzer's OWN result each time, and the same rows cleared and
re-resolved in each:

```
  B  `metadata.owner` stripped        NOTHING resolves (0) — the resolutions above are CAUSED by it
  C  `super_types` stripped           the DIRECT row still resolves, the INHERITED one does not:
                                      the ancestor walk is load-bearing, not a second reading of the owner
```

Without B, a pass that resolved everything by name would light up the direct row and be wrong about
the inherited one; without C, a pass that resolved by owner alone and never walked would do the
reverse. Plus `IDEMPOTENT` (re-running resolves nothing more) and `dangling=0` (no resolved member
row names an owner that does not exist).

**The pin at the analyzer layer**, since the gate cannot reach a projection or a mutant:
`validation/m14/fixtures/php/member-identity.php` + expectation pin the qualified spelling across all
four class-like owner kinds, the same member name under four owners as FOUR declarations
(`expectSymbolCount`), and — the half that makes the rule falsifiable — the ABSENCES:
`forbidSymbols` rows stating that `AlphaStore.persist` with no qualified name must not exist, and
that a namespace-owned declaration must not acquire one. Two mutants revert it in the two directions
it can fail (`php/member-identity-dropped`: the field absent for every member — the exact pre-fix
state; `php/member-identity-on-namespace-scope`: the rule extended one level too far, one declaration
with two qualified spellings). Both are caught by that fixture alone.

```
  php fixtures                29/29 PASS   (was 28)
  php mutant-check            21 caught / 0 survived / clean baseline   (was 19)
  shared registry (php/)      73 caught   (was 71) · verify-orphaned-mutants: PHP_MUTANTS 21 WIRED
  npx tsc --noEmit            clean
  differential --lang php     phpunit    covered 100% MISSING=0 | unexplained=0
                              phpmyadmin covered 100% MISSING=0 | unexplained=0
  php-oracle-independence     PASS
  rel-type-coverage-gate      php appears in NO row — emitted == audited == the same ten labels
```

One shared-harness line was needed for the fixture and is additive: `qualifiedName` is added to
`CONSTRAINT_KEY_ALLOWLIST` in `run-fixtures.ts`. That list exists to catch constraint keys which can
NEVER match (a row that reads as coverage and asserts nothing); `qualifiedName` is a real field on
`UniversalSymbol` and reaches the generic `actual[k] !== v` branch, so leaving it off reported a
working row as inert. No lane used the key before, and the check is a report rather than an
exception, so no other lane's verdict moves.

### 4. What this round does NOT claim

- **NOT that the lever moved.** The census's 24,223 counts ANALYZER endpoints — a property of the
  analyzer's output and its symbol set — and this round changed no edge the analyzer emits. What it
  changed is the STORE's behaviour, and how many stored rows move is **not measured here**: the gate
  is four files, and the population effect needs a full-project store comparison this round did not
  run. The honest statement of the pass's reach TODAY is that the insert-time resolver in §1(b)
  claims those rows first, so the pass sees only the rows it left NULL — the fix that would give the
  pass its real population is a change to that shared ranking, not to this pass.
- **NOT that everything landable now lands.** The pass reads `metadata.owner`, so its reach is
  exactly the receivers php can name (`$this->`, `self::`, `static::`, `parent::`). A member read off
  a local variable, a parameter, a return value or a property is outside it by construction — that is
  the type-inference wall the census calls still-ambiguous, and it is 107,313 endpoints.
- **NOT that php's hierarchy is safe to walk by name.** The existing consumer keys its `supertypes`
  map on the symbol's bare `name` (round 5, §5), which is why the identity work in §2 is a
  precondition for the walk rather than an adjacent nicety.

### 5. One defect reported, not edited

The insert-time ranking in §1(b) is shared store machinery (workstream §8) and is unchanged here: it
still resolves those rows before the pass can, which is why the gate PINS its landing spots instead of
asserting they are absent. The round-5 finding stands beside it — re-storing the same project loses a
cross-file relationship row permanently (`parallel-indexer.ts:2928-2929`). Both are reported with the
exact rows and the experiments that reproduce them; neither is edited here, and the pass added in this
round is written so that fixing either one needs no change to it: it fills NULL and nothing else.

## Round: the hierarchy never crossed the worker boundary — PHPD41 (2026-10-09)

The round above ends with `brain_symbol.super_types` as the pass's ancestor channel and with the walk
"load-bearing". It was load-bearing and it was EMPTY, and this round is that measurement.

### 1. The measurement that started it

A store built through the **production** path (5,094 files, 350,368 edges, whole admitted php
population — `bun validation/m14/fixtures/php/store-resolution-census.mts --files 0`) reported:

```
hierarchy in store  0 of 4,940 class-like symbol(s) carry super_types
                    0 of 0 distinct parent name(s) resolve to exactly one class-like symbol
```

Zero, and not because the analyzer declined to publish. `heritage-published.php` pins the payload on 8
symbols and `store-heritage-roundtrip.mts` proves the COLUMN is writable — the two facts were true and
the column was still NULL, which means the two instruments agreed about a layer neither of them reads.

### 2. Where the fact died, and why no gate in this lane could see it

`real-php-analyzer.ts` publishes `metadata.superTypes`; `parallel-indexer.ts` reads
`symbol.metadata?.superTypes` and writes the column. Between them sits `src/ast/pool-worker.ts`'s
per-symbol projection, whose `metadata` is a **narrow per-language allowlist** — CSS keys, markdown
keys, four bash keys, `isDeclaration` — maintained under the file's own stated rule: *only keys a
READER CONSUMES belong here*. `superTypes` was not on it, so the key was dropped for every symbol in
every language and the reader read `undefined`.

Every other instrument in this lane calls `ASTEngine.parseFile` (or `run-fixtures.ts`, which does),
which returns the ANALYZER's object and never crosses the worker boundary. So the payload was pinned
in one place and the column was proven writable in another, while the seam between them was covered by
neither. `store-heritage-roundtrip.mts` did not drop the ball by oversight: it hand-builds its symbols
and calls `storeResults`, which is already the far side. This is MD-5's shape exactly — the markdown
lane recorded the same hole as *unpinnable* rather than *unpinned*, because the one instrument that
CAN see the worker had no case for that language.

Two consequences were measured, not assumed. `override-retarget.ts` opens with
`if (supertypes.size === 0) return out`, so php's project-wide override retarget never ran — it could
not, in any store, for any project. And `member-owner-resolution.ts`'s ancestor stage could not walk.

### 3. The fix, and the gate written first

`script/m60/php-store-pipeline-seam.ts` is the case that was missing: it indexes a php project through
`indexProjectParallel` — the REAL pipeline, worker pool included — then reads brain.db and asserts,
per fact, BOTH halves.

- **A** — what the analyzer published (`ASTEngine.parseFile`, projection bypassed) against what the
  store kept. `ANALYZER CARRIES / STORE DROPS` is the failure, named as a seam defect. Plus
  exactness (the stored array is byte-identical to the analyzer's) and named absolute pins, so an
  all-empty payload cannot pass.
- **B** — every stored member named `persist` carries `Owner.persist` and no stored row carries the
  bare name (the round-above identity fix, now pinned on the far side of the seam).
- **C** — the `extends`/`implements` edges are present, so a zero in A can never be read as "the
  analyzer emitted nothing".

It was run BEFORE the fix and read `analyzer carries 8 · store carries 0` — the defect reproduced as a
FAIL row rather than asserted from the source. The fix is one line plus the comment that earns it:
`if (Array.isArray(m.superTypes) && m.superTypes.length > 0) out.superTypes = m.superTypes`, carried
only when non-empty because `[]` and absent are one fact downstream (the store writes NULL for both).
Deliberately NOT language-scoped: the reader is enumerable and there is exactly one of it, and kotlin,
scala, go and the rest publish the same key under the same name, so a per-language switch would only
move the drop somewhere nobody looks.

**Falsifiability, run rather than claimed**: with that one line replaced by a comment the gate returns
`store carries 0` and FAIL; restored, `8/8` and PASS.

### 4. The population effect, and the method that separated it from someone else's

The full-population census re-run is an A/B on one variable, and it needs a third run to be read
honestly. `resolved:owner` fell by 537 while `null:receiver-name` rose by 537, which is the direction
that means "rows the store had bound are no longer bound" — a regression shape, and not one this
change can produce: nothing in the projection or the store NULLs a `target_symbol_id`, and
`retargetCrossFileOverrides` only rewrites `overrides.target_external`. So the seam line was removed
and the whole population re-run a third time:

| key | committed (2026-10-08) | OFF-full (line removed) | ON-full (HEAD) |
|---|---|---|---|
| `classLikeWithSuperTypes` | 0 / 4940 | 0 / 4940 | **3805 / 4940** |
| distinct parent names resolving | 0 of 0 | 0 of 0 | **221 of 332** |
| `resolved:ancestor` | 0 | 0 | **2,176** |
| `resolved:MISLANDED` | 4,813 | 4,813 | **6,114** |
| `resolved:not-a-member` | 21,528 | 21,528 | **18,051** |
| `resolved:owner` | 39,060 | **38,523** | 38,523 |
| `null:receiver-name` | 79 | **616** | 616 |
| `inheritedResolved` | 0 | 0 | **3,506** |
| `putOnAncestor` | 0 | 0 | **3,506** |
| `notDeclared` | 31,669 | 31,669 | **28,122** |
| `ambiguousInChain` | 2,095 | 2,095 | **2,136** |
| `mislandings repaired` | 4,698 | 4,698 | **5,964** |

OFF-full and ON-full agree on `resolved:owner` and `null:receiver-name` to the digit, so those 537
rows are NOT this change — the committed artifact predates ~3.5 hours of **indexer-side commits**
(`4c072d50b`, `028be23b7`, `886bfb069`) and the baseline had drifted. That is a finding in its own
right and it is recorded below rather than absorbed into this round's numbers: the census artifact's
`resolved:owner`/`null:*` split is not comparable across that boundary, while every key this round
claims IS comparable, because OFF and ON share a commit and a frame.

The claim this round makes is therefore bounded and reproducible: on one frame, one corpus and one
commit, the seam line is the only difference, and it moves the hierarchy from absent to present and
the ancestor stage from structurally-zero to **3,506 rows**. `notDeclared` falls by 3,547 = the 3,506
inherited plus the 41 `ambiguousInChain`, and the phase-A re-bucketing balances exactly
(+2,176 ancestor + 1,301 MISLANDED = −3,477 not-a-member), which is what a coherent mechanism looks
like rather than a number that moved.

### 5. What this round does NOT claim

- **NOT that the 3,506 rows are a resolution quality win in the store's own binding — AT THE TIME.**
  Phase B is the owner channel *given its whole input* — the census clears every owner-carrying row to
  NULL and lets the pass run. At this commit the insert-time ranking still claimed those rows first, so
  the production effect of the ancestor stage was limited to the NULLs the ranking left. **SUPERSEDED
  THE NEXT DAY (PHPD42)**: the ranking no longer claims them, which is why this bullet is left standing
  rather than deleted — the measurement below it is what justified taking that decision, and a reader
  should see the two in the order they happened.
- **NOT that 3,805 of 4,940 is a shortfall.** The other 1,135 class-like symbols either declare no
  heritage or declare one the analyzer cannot resolve, and `heritage-published.php` pins ABSENT (not
  `[]`) for exactly that case — `class InvalidArgumentException extends \InvalidArgumentException`
  whose base is the class's own name. The column's NULL is its honest "declares no supertypes".
- **NOT that the walk is sound on its own.** The ancestor stage keys on the bare `name` (round above,
  §5), and 111 of 332 distinct parent names still resolve to more than one class-like symbol — the
  pass declines those rather than picking, which is why 3,506 < the 24,223 the census priced.
- **NOT that this was php-only.** The allowlist is one file shared by every language that publishes
  `metadata.superTypes`; this round measured the php consequence because that is the lane with an
  instrument pointed at the store.

### 6. Gates re-run after the change

`tsc` clean · **29/29 php fixtures** · **21/21 php mutants caught, 0 survived, clean baseline 0
problems** (`bun validation/m14/fixtures/php/mutant-check.mts`) · differential `covered 100%
MISSING=0 | unexplained=0 heuristic=0` on both pinned draws, hashes unchanged (`b1cc09a5008f9885`,
`08ee2a6e64090e61` — the analyzer's output did not move, which is the point of a store-side fix) ·
`php-oracle-independence` PASS · rel-type-coverage-gate: php in no un-audited row · orphan-endpoint
PASS · `PHP_MUTANTS 21 WIRED` · the new seam gate PASS.

## Round: the owner channel is AUTHORITATIVE for the rows that state their receiver — PHPD42 (2026-10-09)

The round above put the hierarchy in the store and measured what the owner channel *would* resolve. This
round lets it resolve.

### 1. The defect this closes, stated as the lie it told

`resolveTargetStmt` attaches a bare member name to the nearest same-named symbol and otherwise to the
LEXICOGRAPHICALLY SMALLEST id — `${projectId}:${relativePath}:${name}:${line}`, compared as TEXT. A
member name is not identifying: `act` is a method on many classes at once. So for a member read whose
own file does not declare the name, the winner is whichever declaration sorts first, and the row is
stored **RESOLVED** with nothing recording that the choice was a tie-break.

That is the shape that makes an agent hallucinate instead of abstaining. `SubWidget::run` calling
`$this->act()` with the graph answering `ZetaStore::act` is not an unresolved edge — it is a confident
false statement about which method the call reaches, and the answers are both available: PHP's own
lookup says the declared ancestor, and where nothing declares it the answer is "not known".

### 2. What was changed

`claimOwnerCarryingTargets` (`src/ast/member-owner-resolution.ts`) withdraws every row carrying a
relation-level `metadata.owner` from whatever bound it and hands it to `resolveMemberTargetsByOwner`,
which is authoritative for those rows — a row it declines is left NULL rather than handed back to the
ranking. Both halves are in one function deliberately: a withdrawal that failed to re-resolve would
silently delete every owner-carrying binding in the project. It is called at BOTH resolution sites
(`storeResults`' inline strategies and `resolveRelationships`' linear plan), each time immediately
before the cross-language pass so that pass sees the final target, and it is idempotent — which matters
precisely because a real run reaches both sites.

### 3. Where it is scoped, and by what

By the DATA, not by a language switch: a relation carrying `metadata.owner` is one whose receiver the
analyzer could NAME (`$this->`, `self::`, `static::`, `parent::`, `C::`). php is the only lane publishing
that key today (`withMemberOwner` in `real-php-analyzer.ts` — grepping every analyzer for a relation-level
`owner` finds no other, and Solidity's `metadata.ownerKind` is a symbol field rather than a receiver), so
the blast radius is php today and widens automatically for any lane that later publishes the same fact.
A project with no owner-carrying rows costs one indexed prefilter query.

### 4. Evidence, in the order it came in

The gate was extended FIRST, and it was red before the change (`script/m60/php-store-pipeline-seam.ts`,
CHECK D — the first check in this lane that asserts where a member read was BOUND rather than whether a
fact arrived):

- `D1` `SubWidget::run` -> `$this->act()` landed on **UpsilonStore.act** — a class that neither declares
  it nor is an ancestor. FAIL.
- `D3` `Broken::go` -> `$this->act()` behind an unresolvable base landed on **UpsilonStore.act** as well.
  FAIL.

Three declarations of `act` are placed so both wrong ones sort before the right one, so the mislanding is
deterministic rather than occasional. After the change: D1 lands on `WidgetBase.act`, D2 (`$this->own()`)
on the receiver's own declaration, D3 stays **NULL**, and `D4` asserts the symbols the wrong answer would
have come from exist — so a NULL is a refusal and not an absence.

The population measurement is the census, on a **1,500-file stride frame** (29% of the 5,094 admitted
files; `validation/m60/php/store-resolution-census.owner-channel.json`), because the whole-population run
needs ~7 minutes and did not complete on a loaded box — twice. What it shows:

```
PHASE A — the store's own binding, untouched
  resolved:owner      9155
  resolved:ancestor    557
  MISSING ENTIRELY: resolved:MISLANDED, resolved:not-a-member, resolved:receiver-unknown
  null               10457   (receiver-identity 6628, receiver-absent 3063, receiver-name 490, ambiguous 276)

PHASE B — every owner-carrying row reset to NULL, pass re-run
  ownerResolved  9155      inheritedResolved  557      resolved  9712
  putOnReceiver  9155      putOnAncestor      557
  mislandings repaired  0 of 0
```

**Phase A equals phase B to the digit and there are ZERO mislandings left to repair.** The
confident-wrong-edge class is not reduced, it is empty: every owner-carrying row is now on the receiver,
on a real ancestor, or honestly NULL.

NO PRE-CHANGE RUN OF THIS FRAME EXISTS, and saying which number this replaces would be a claim about a
run nobody made. What the whole-population pre-change run held for the two keys that are now absent is
4,813 `resolved:MISLANDED` and 21,528 `resolved:not-a-member` of 350,368 edges; the frame-level
comparison that IS like-for-like is phase A against phase B inside this one artifact, where the two agree
row for row.

Caveats, stated because the frame is a frame. A stride sample puts a class's parent outside the frame
(54 of 191 distinct parent names resolve here, against 221 of 332 on the whole population), so the
ancestor half is UNDERSTATED and 557 is a lower bound — the whole-population phase-B measurement from
the round above is 3,506. And the trade is real and is not hidden behind the win: **10,457 rows that the
rank had bound, some rightly, are now NULL**, because a receiver that is outside the admitted files
(3,063) or a name no ancestor declares (6,420) is exactly the type-inference wall, and the honest answer
there is "not known" rather than a declaration that sorts first.

### 5. One gate went RED on purpose, and was changed on purpose

`owner-resolution-gate.mts` §2 existed to PIN the defect by name — its own header said "the day it
changes this gate goes red and the change is acknowledged rather than absorbed". It went red on exactly
four rows, and the four are now pins recording answers a rule can defend. The FIFTH row was kept pinned
to the old defective answer: `goPlain -> persist`, whose receiver is a local variable, so the analyzer
publishes no `owner`, no rule can reach it, and the rank still decides. That row is the scope of the
change visible in the gate rather than in a paragraph — if it ever starts resolving correctly, some other
mechanism did it and this gate says so instead of taking the credit. `IDEMPOTENT` still passes, which is
the property that makes a two-site call safe.

### 6. What this round does NOT claim

- **NOT that owner-less member reads are resolved.** They are outside the pass by construction and keep
  the rank's behaviour — the type-inference wall, 107,313 endpoints on the whole population, and now the
  population's largest single honest-unknown class.
- **NOT that the count of resolved edges went up.** It went up on the whole population (40,699 -> 45,166
  in the round above) but the FIX's headline is subtraction: 6,114 rows stopped asserting a receiver they
  do not have. On this frame the store resolves 9,712 owner rows and refuses 10,457.
- **NOT that the whole-population artifact was regenerated.** The committed
  `store-resolution-census.json` is still the PRE-claim measurement, and the new file is the 1,500-file
  post-claim one. Regenerating the whole-population artifact under the new store is outstanding work, and
  it is outstanding because the machine would not run it — not because the question is open.

### 7. Gates re-run

`tsc` clean · **29/29 php fixtures** · **21/21 php mutants caught, 0 survived, clean baseline 0 problems**
· differential `covered 100% MISSING=0 | unexplained=0 heuristic=0` on both pinned draws (the run rotated
to `rot 16`, so the draw and its hashes differ from the previous round's `rot 15` — both are green, and
comparing the hashes across different draws would be comparing two different 60-file samples) ·
`php-oracle-independence` PASS · rel-type-coverage-gate: php in no un-audited row · orphan-endpoint PASS ·
`verify-label-coverage` php `217 | 217` · the seam gate PASS including CHECK D · the owner-resolution gate
PASS with §2 rewritten. NOT re-run: `verify-truth-existence.ts`, which drives the differential across
every lane and is a claim about the ORACLE REGISTRY — this round adds no label and no oracle, so it cannot
move it.

### 8. Cost, measured because the claim lives in a hot path

The claim runs inside `storeResults` and `resolveRelationships`, so it was A/B'd on one fixed frame rather
than assumed cheap: **600 files, the same stride frame, store 16.7 s before and 17.1 s after (+2.4 %)**, with
parse 61.9 s -> 64.3 s. The withdrawal's row walk is bounded by the rows that already have a receiver, and
the pass's per-row update is the one this lane's census has been running all along, so nothing new is
unbounded. This also settles an open question honestly: the whole-population census did NOT finish three
times during this round, and this measurement is what rules the change out as the cause — per-file parse is
roughly 3x slower under the load than it was when the earlier whole-population run succeeded.

---

# PHP — DECLARED DONE (2026-10-09)

This is a declaration, so it is written as exit criteria with the command that shows each one, not as a
summary. A reader who disagrees with the verdict has something to run.

## The criteria, and where each one stands

| # | criterion | state | evidence (re-runnable) |
|---|---|---|---|
| 1 | every emitted relationship type is compared against truth | **met** | `verify-label-coverage.ts` -> php `217 / 217`, no undeclared and no declared gap; `rel-type-coverage-gate.ts` -> php in no un-audited row, no DERIVATION row; the ten types account for the population exactly (103,190 + 155,016 + 35,112 + 28,630 + 13,848 + 10,296 + 3,110 + 1,106 + 58 + 2 = 350,368) |
| 2 | the differential agrees on both pinned corpora | **met** | `differential.ts --lang php` -> `covered 100% MISSING=0`, `unexplained=0 heuristic=0` on phpunit and phpmyadmin |
| 3 | no oracle is derived from the implementation it checks | **met** | `php-oracle-independence.ts` -> PASS |
| 4 | the pins can FAIL | **met** | `mutant-check.mts` -> 21/21 caught, 0 survived, clean baseline 0 problems |
| 5 | every `contains` target is published by its own file | **met** | `orphan-endpoint-gate.mts` -> STRICT orphaned contains targets 0 |
| 6 | an analyzer fact survives the WORKER and the STORE | **met** | `php-store-pipeline-seam.ts` -> A 8/8 carried byte-identical, B member identity, C the edges are present, D where a member read is bound. Falsified the way it is claimed: remove the one widened line and A returns to 0 and FAIL |
| 7 | a member read is bound by a RULE wherever a rule exists | **met, with a stated ceiling** | `owner-resolution-gate.mts` incl. its two signal controls and IDEMPOTENT; the census's phase A now equals phase B with `resolved:MISLANDED` absent |
| 8 | what is NOT resolved is enumerated and bounded, not hidden | **met** | `reason-census.mts` -> every unexplained endpoint classified (see below) |
| 9 | the lane asserts nothing it cannot support | **met for php's own edges** | no `contains` orphan, no unexplained edge, no MISLANDED row on the owner-carrying population |

## What "done" does NOT mean

- **NOT that every edge resolves.** It means every edge has an honest answer, and the ones that are not
  resolved are unresolved ON PURPOSE with the reason recorded. The remaining population is the
  type-inference wall: a member read off a local variable, a parameter, a return value or a property has no
  receiver the analyzer can name from one file, which is 107,313 endpoints of 169,156 ambiguous ones. No
  rule reaches them, and inventing one would trade an honest unknown for a confident guess — the exact
  failure mode the lane spent this arc removing.
- **NOT that the graph is complete.** 44,641 endpoints are file-local variables and 10,644 name a bare name
  no admitted file declares; those are properties of the corpus and the language, not defects.
- **NOT that the shared store is sound.** Two defects are reported and unfixed, both **store-wide and not
  php's to fix** (workstream §8): the insert-time ranking still decides the rows with NO published receiver
  (pinned by name in `owner-resolution-gate.mts` §2 so it cannot change silently), and re-storing a project
  can permanently LOSE a cross-file relationship row (`parallel-indexer.ts:2928-2929`; measured 70 -> 69,
  order-dependent). The second is the one to fix next, and it is worth being precise about why it does not
  block this declaration: a lost edge is ABSENT, which an agent reads as "no evidence", whereas the defect
  this arc removed made the graph ASSERT a receiver the code does not have. Absence is survivable; a false
  claim is not.

## What changed to get here, in one line each

The label axis closed first (10/10 emitted and audited). Then six defects on the far side of the boundary:
heritage published on the symbol, member identity qualified as `Owner.member`, the worker carrying
`metadata.superTypes` (which no consumer had ever received), the store's `brain_symbol.super_types` column
filled (which made `override-retarget` run for the first time in php's life), the owner channel made
authoritative for member reads that name their receiver, and a store seam GATE so the next such fact cannot
die in transit unobserved.

## The one carried-over item

The committed `validation/m60/php/store-resolution-census.json` is the PRE-claim whole-population
measurement, and `store-resolution-census.owner-channel.json` is the post-claim 1,500-file frame. A
post-claim WHOLE-population artifact is outstanding, and it is outstanding because the machine would not run
it — three attempts, each killed at ~10 minutes while per-file parse ran 3x slower than during the run that
succeeded. It is a re-measurement, not an open question: the property it would confirm (no owner-carrying
row bound to a non-receiver, non-ancestor) is already asserted by the fixture gate where the wrong answer is
reachable, and observed on two frames. The command is
`bun validation/m14/fixtures/php/store-resolution-census.mts --files 0`.
