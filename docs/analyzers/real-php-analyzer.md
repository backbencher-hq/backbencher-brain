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

`exports` is **ruled out** (PHPD33). The ruling is not a grammar argument: PHP's
grammar having no `export` node proves nothing, because a convention is not a
node. It rests on a parse-tree count of the construct, over all 4,621 admitted
files — see "`exports` is RULED, and what would overturn it". Every value
`RelationshipType` declares is accounted for: **nine emitted, one ruled**.

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

## The ontology, verdict by verdict (M60)

Every number below is measured through **`parseFile`** (`src/ast/pool-worker.ts`),
never `analyze()`, over the whole admitted corpus: **4,621 git-tracked `.php`
files ≤ 512 KB** across `phpunit` (3,231), `phpmyadmin` (1,232), `slim` (125),
`cloogle.org` (17), `nvim-treesitter` (13), `caddy` (3). Sampling: **none** —
the census harness walks the admitted set whole, so every denominator is 4,621
files. Reproduce with
`BB_JSON=1 BB_WORKERS=4 npx tsx validation/m14/fixtures/php/census-harness.mts`.

### Verdicts

| type | verdict | count | files | note |
| --- | --- | --- | --- | --- |
| `calls` | EMITTED | 94,227 | 3,416 | |
| `uses` | EMITTED | 132,591 | 3,131 | largest label |
| `contains` | EMITTED | 30,315 | 4,000 | + namespace level this round; **DERIVATION** |
| `imports` | EMITTED | 25,900 | 3,968 | **DERIVATION** |
| `references` | EMITTED | 8,636 | 2,126 | |
| `extends` | EMITTED | 2,808 | 2,792 | |
| `implements` | EMITTED | 1,000 | 972 | |
| `instantiates` | EMITTED | 10,587 | 1,560 | |
| `overrides` | EMITTED | **2** | 2 | see below — the count is the finding |
| `exports` | **RULED** | 0 | 0 | Instrument B, §"`exports` is RULED" |

**Nine emitted, one ruled.** The corpus-wide symbol total is **34,914**
(`method` 20,178 / `property` 5,131 / `namespace` 4,442 / `class` 4,221 /
`function` 296 / `constant` 258 / `interface` 208 / `enum_member` 124 /
`enum` 41 / `trait` 15), with **0** empty names, **0** `SymbolKind` values
outside the enum, and **0** parse failures surfacing as exceptions.

### The six questions, per emitted type

**5. RESOLVED — both endpoints against the file's own symbol set.** This is the
number the CSS `references` row (66.8%) is the reference point for, and it is
the one with the most to say:

| type | `from` resolved | `to` resolved | both | distinct targets | distinct targets naming a symbol declared in the corpus |
| --- | --- | --- | --- | --- | --- |
| `contains` | 100.00% | 99.99% | **99.99%** | 16,734 | 16,732 (**100.0%**) |
| `uses` | 99.56% | 16.28% | 16.28% | 8,325 | 2,802 (33.7%) |
| `calls` | 99.66% | 10.39% | 10.35% | 6,317 | 5,513 (87.3%) |
| `instantiates` | 99.74% | 2.80% | 2.78% | 1,492 | 1,280 (85.8%) |
| `references` | 98.47% | 4.83% | 4.81% | 963 | 787 (81.7%) |
| `extends` | 100.00% | 0.32% | 0.32% | 166 | 141 (84.9%) |
| `implements` | 100.00% | 0.00% | 0.00% | 128 | 100 (78.1%) |
| `imports` | **0.00%** | 0.19% | 0.00% | 2,932 | 1,999 (68.2%) |
| `overrides` | 100.00% | 100.00% | 100.00% | 2 | 2 (100.0%) |

Read the last column before the `to`-resolved column, because the two answer
different questions and the first is the one that holds for a leaf-spelled
index. PHP keys every edge on the **leaf** name, so `extends B -> A` names a
class this file does not declare and names a real one all the same — **84.9%**
of `extends` targets and **78.1%** of `implements` targets name a type declared
somewhere in the corpus. The per-file `to`-resolved rate cannot rise much for any
cross-file label, and a low number there is the shape of the language rather than
a defect; `contains` is the one label whose per-file rate *is* meaningful, and
it is 99.99%.

> The last column was **wrong in the instrument's first version** and the fix is
> recorded because it moved the answer by 26× on one row. The harness reduced a
> target to a segment on `.`/`:`/`>` only, and **PHP's namespace separator is a
> backslash** — so no FQN was ever reduced, and `imports` read **2.5%** where it
> is **68.2%**. A measurement bug that understated a lane's own resolution rate
> is the kind of error that survives review, because the number it produces looks
> like a finding about the analyzer.

**`imports` resolves at 0.00% at the per-file level and that is a real finding,
not a footnote.** Both endpoints are file-scope identities rather than symbol
identities: the source is the literal string `"global"`
(`real-php-analyzer.ts:1988`, file scope, matching
`src/lsp/graph_request.ts:256`'s `('imports','exports')` file-level reader) and
the target is an FQN (`Illuminate\Support\Facades\Route`) while class symbols are
spelled by leaf. The analyzer emits **no `module` or `file` symbol for PHP at
all** — the corpus kind census has no `module` row — so there is nothing for
either endpoint to bind to *within its own file*. Project-wide the story is much
better (**68.2%** of distinct targets name a symbol declared somewhere in the
4,621-file corpus), which is exactly the split the two columns are reporting. It
is deliberate, it is documented, and it is recorded here because a consumer
reading "25,900 edges" would otherwise assume they resolve.

**6. CONFIDENT — the heuristic ratio.** Confidence is bimodal and
**`heuristic (< 0.7)` is 0 for every one of the nine emitted types**:

| type | confidence histogram | `< 0.7` |
| --- | --- | --- |
| `contains` | `1.0: 30,315` | 0 (0.00%) |
| `extends` | `1.0: 2,808` | 0 (0.00%) |
| `implements` | `1.0: 1,000` | 0 (0.00%) |
| `imports` | `1.0: 25,710`, `0.9: 190` | 0 (0.00%) |
| `overrides` | `0.95: 2` | 0 (0.00%) |
| `calls` | `0.9: 94,227` | 0 (0.00%) |
| `uses` | `0.9: 132,582`, `1.0: 9` | 0 (0.00%) |
| `references` | `0.9: 8,636` | 0 (0.00%) |
| `instantiates` | `0.9: 10,587` | 0 (0.00%) |

Per honesty-contract §4 the below-1.0 edges need to be countable rather than
merely numbered, so: the 0.9s are *usage-contextual* (`calls`, `uses`,
`references` — a syntactic AST shape with builtin filtering, not resolved
dispatch) or *import-based* (`references`, and the 190 `imports` include paths),
and the two 0.95 `overrides` are *structural*. **Nothing in the lane is below
0.7**, so `pool-worker`'s 0.7 filter drops **0** php edges and no php edge is a
guess. The 9 `uses` edges at 1.0 are trait-`use` composition (`isTraitUse`), which
is a declaration fact.

**1–4. EXISTS / FIRES / CORRECT / LABELLED.** Exists: derivable from source at
the emission sites above. Fires: every emitted type is non-zero on the corpus, so
no type is reachable only from a branch that never matches. Correct:
`npx tsx script/m14/differential.ts --lang php --sample 300` over both pinned
repos reads (this round's draw) **tree-truth 2,644 / covered 2,620 (99.1%),
MISSING 24** (phpunit) and **10,371 / 10,368 (100%), MISSING 3** (phpmyadmin),
with **`analyzer-edges` 2,449 and 10,152, `unexplained` 0 (0%)** and
**`heuristic` 0** on both. `unexplained 0` is the number that says the namespace
round fabricated nothing — 12,601 compared edges, none of them analyzer-only.

> **Stated limitation on that number, as §2c requires.** The oracle is a separate
> walker over the same pinned wasm, so a grammar-level defect shared by both
> paths is invisible to it, and it shares the analyzer's `PHP_BUILTINS` set and
> its `isPhpBindSite` shape by design (a deliberate single source of truth, and
> the cost is that those two rules are not independently checked). It also covers
> **7 of the 9** emitted types — `contains` and `imports` are not in its compared
> set at all. So "0 unexplained" is a statement about 12,601 of 306,066 edges,
> and about none of the 30,315 `contains` or 25,900 `imports`. The sample also
> **rotates** between runs (`m14-f5-cold-pool.json` prefers never-sampled files, so
> this round's draw is not the previous round's); the two draws above and the
> earlier one all read `unexplained 0`, and no cross-run count comparison is
> made here for that reason.

Labelled: the 27 MISSING edges are **all** `references` to an `include`/`require`
path, and they are one stale oracle rather than 27 defects — see §"What this
lane could not settle", item 1. The known confusions (`uses` vs `references` vs
`calls`, `extends` vs `implements`) are carried by 11 distinct `uses` metadata
flags (`isMemberRead`, `isLocalRead`, `isTraitUse`, `isConstFetch`, …) measured
per edge, so a mislabelling is countable rather than a matter of trust.

**`overrides` — 2 edges is the finding, not a rounding error.** Both are in
**test fixtures**, not application code:
`nvim-treesitter/tests/query/highlights/php/keywords.php:61`
(`B.foo -> A.foo`, a tree-sitter highlight-query input) and
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

The corpus says the same thing from the other side.
`validation/m14/fixtures/php/overrides-probe.mts` over all 4,621 files:
**2,807** classes carry a declared base, **0** of them have that base in the same
file (so **S = 0** same-file opportunities corpus-wide — 2 is not achievable and
2 is what fired), and against a companion built from the whole corpus,
**C = 0** opportunities with a false-rate that is therefore unmeasurable. No
analyzer edit can close this; it needs steps 2–4.

### `exports` is RULED, and what would overturn it

Not a grammar argument. `script/m14/ontology-coverage-gate.ts`'s own header
records why that is unsound — it removed a json `exports` ruling for exactly this
reason — and a grammar cannot see a convention. So the ruling rests on
**Instrument B, a parse-tree count** over all 4,621 files
(`validation/m14/fixtures/php/exports-probe.mts`). Every probe is a **role test
on a node or token the grammar produced**, never a text match, so no string
literal or comment can produce a hit. Instrument A is reported alongside it and
is *not* the basis: the pinned wasm produced **270 distinct node types** and
**zero** containing `export` or `alias`.

| probe | construct | occurrences | files |
| --- | --- | --- | --- |
| **P3** | `class_alias` / `function_alias` call | **0** | **0** |
| **P4** | `define('NAME', …)` with a literal first argument | **0** | **0** |
| **P1a** | `use function`/`use const`, **unqualified** target | 6,140 | 1,506 |
| **P1b** | `use function`/`use const`, **qualified** target | **12** | **8** |
| **P2a** | file-level `return`, no named value | 2 | 2 |
| **P2b** | file-level `return`, naming a value | 28 | 20 |

The split inside P1 is the whole verdict, and an earlier version of this probe
reported P1 as one number — which read as "6,152 re-exports exist". The corpus
does not say that. **P1a is 6,140 of the 6,152**, and every one of them is
`use function array_merge;`-shaped: an unqualified target resolves against the
**global** namespace, so it imports a builtin the current namespace could
already call. Nothing is added to the namespace's surface. The not-published
sample from the first run was `preg_replace_callback, asort, ceil, mkdir,
shell_exec, PHP_OS, CACHE_DIR, TEMP_DIR` — every one a global.

**P1b is the only true syntactic re-export, and it is 4 distinct targets
corpus-wide**, of which **3 the analyzer already publishes as `imports` targets**
(P1b cross-checked against `parseFile` over 758 files: 1,260 distinct `imports`
targets published). The one unpublished target is
`PHPUnit\TestFixture\Generator\f`, in a phpunit **unit test**. The 12
occurrences are 6 in nvim-treesitter tree-sitter **query** test files and 5 more
of that same phpunit fixture target; the 12th is `use function
FastRoute\simpleDispatcher` in a slim test.

**P2b is a convention, not a construct, and its composition is visible**: 19 of
the 28 are composer's own vendored autoload files (`autoload_classmap.php`,
`autoload_psr4.php`, `autoload_namespaces.php`, `installed.php`,
`autoload_files.php` — the `return array(…)` autoloader convention), 9 are one
nvim-treesitter grammar **indent-test fixture** with deliberately broken syntax
(`return function () { };`), and 5 are phpmyadmin's Symfony-DI-style config
(`app/services.php`, `app/services_controllers.php`, `app/services_loader.php`,
`app/vendor_config.php`, `tests/doctum-config.php`). The value those files
return is an **anonymous array** — there is no name for it, so an edge would have
to invent one. What it *names* (`Advisor`, `BrowseForeignersController`) is
already a symbol, and the analyzer already records the construction itself:
the fixture's own file-level `return new Circle('mod', 1.0);` produces
`instantiates global -> Circle`.

**Overturn condition.** This ruling is **RULED-UNJUSTIFIED → GAP** if any of:

- **P3 > 0** or **P4 > 0** on any admitted corpus. Measured 0 over 4,621 files,
  so this is a corpus-zero shape, not a language impossibility — a corpus that
  used `class_alias` would flip it, and the flip needs no analyzer change
  because `class_alias('A', 'B')` names both ends on the tree.
- **P1b distinct unpublished targets** reaches a scale worth a new edge kind.
  Currently **1** distinct target (`PHPUnit\TestFixture\Generator\f`), in a
  unit test. Above roughly a handful of distinct targets in application code,
  one per re-exported name is justified; at 1 it is not.
- P2b grows a **nameable** return. Composer's convention returns an anonymous
  array and always will; a file returning a *named* symbol would give an edge
  something real to point at.

**Report-to-supervisor, not editable here.** `ontology-coverage-gate.ts:192`
holds `RULED_BY_LANG = { bash: BASH_RULED, json: JSON_RULED }`, and `:289`
refuses to report for any language absent from it — so for `php` the arbiter
**exits 2 and prints no table at all** after spending ~3 minutes walking 4,621
files and the grammar inventory first (the refusal is at the *end* of the run,
so it burns the full cost before declining). Every number in this section was
therefore produced by this lane's own instruments, built to the same admission
rule so the counts are comparable: git-tracked files, `detectLanguageFromPath ===
"php"`, ≤ 512 KB — byte-for-byte `ontology-coverage-gate.ts:196-209`. Adding
`php: PHP_RULED` to that table with the `exports` entry above is the change that
would let the arbiter rule rather than refuse.

## What this lane could not settle, and what needs a shared file

All four are outside the lane's ownership (§8 of the work order). Each is stated
as file + function + what it must do + why, so none of it needs re-deriving.

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
for the worker pool and **not** here, so the two paths disagree about when a
file is too slow.

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
