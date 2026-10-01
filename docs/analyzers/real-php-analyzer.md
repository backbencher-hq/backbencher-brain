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
| `contains` | one edge for every owned symbol. Now **audited** by an independent oracle (see below) |

`exports` is **ruled out** (PHPD33): PHP has no export syntax and a semantic version would be
unverifiable from one file. Every value `RelationshipType` declares is therefore accounted for:
**nine emitted, one ruled out**.

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
  and `validation/m14/fixtures/php/` (**19 pass / 0 fail** as of the last run)
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
3. **PHPD33 — an `exports` kind is ruled OUT**: make and python emit it syntactically (`export`,
   `__all__`), PHP has no export syntax, and a semantic version would be unverifiable from one file.

**A boundary written only in a source comment is not a ruling.** That sentence is the M60 round's
own lesson and it has a named victim: typed class constants sat on `phpDeclaredTypeRefs`'s
"BOUNDARIES, DISCLOSED" list for months while the spec claimed `const_declaration` was
`handled_verified` and carried **no** decision naming them anywhere in its 33. It is now handled
and adjudicated (**PHPD35**, FIXED) — see "Declared-type graph" below. The shape to watch for is
a disclosed boundary with no matching entry in the adjudication set: that is an unexamined claim
wearing a disclosure's clothes.

### Master review — what 100% coverage could not see

A differential proves the analyzer agrees with the oracle. It cannot prove either
is *right*: a construct both sides miss reads as a perfect agreement on an
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
**NEW** regression. Fixed by `derivePhpContainsEdges` (script/m14/differential.ts), written from
PHP's own containment semantics and sharing **no** rule with the analyzer — not a name helper, not
a bind-site test, not the analyzer's `pushMembers`. Anonymous classes fall out naturally because
the grammar's `anonymous_class` has no `name` child, so the "no nameable identity" rule arrives
from the tree rather than from a shared decision. Measured standalone **before** the allowlist was
touched: 23,399 distinct owner|member pairs, **0 truth-only, 0 analyzer-only**. After: the
canonical draws' truth grew 668 → 888 (phpunit) and 2,393 → 2,864 (phpmyadmin), 100% covered, and
a 2,000-file-per-lane draw reads 35,876 / 35,876, 0 unexplained.

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
