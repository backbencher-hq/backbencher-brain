# real-ruby-analyzer.md

## Language

- Analyzer: `src/ast/real-ruby-analyzer.ts`
- Parser: pinned `tree-sitter-ruby` WASM at `wasm/tree-sitter-ruby.wasm`
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: a **REDISTRIBUTOR BUILD**, not a build of this lane's own
  npm package. `wasm/tree-sitter-ruby.wasm` is
  byte-identical to `tree-sitter-wasms@0.1.11`'s `out/` wasm (sha256 `93a5022855314cdb…`).

  **That collection publishes no source** — 0 `grammar.js`, 0 `parser.c`, only prebuilt wasms —
  so these bytes cannot be regenerated from it, and the underlying GRAMMAR version is recorded
  nowhere in this repository and must not be inferred from the collection's version.

  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`. This matters for the
  web-tree-sitter 0.27.0 migration: this is one of the lanes whose wasm cannot simply be
  rebuilt from what we have, only re-sourced and re-admitted.
- Detection: `.rb` → `ruby` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.getAnalyzer("ruby")` → `RealRubyAnalyzer`

## Grammar surface, measured rather than assumed

The pinned grammar enumerates **353 node-type ids, 284 distinct node-type names**
(`nodeTypeCount` / `nodeTypeForId`) and **32 fields**. A corpus sweep of
**8,514 `.rb` files / 4,024,840 named nodes** (`script/m14/tmp/rb-node-coverage.ts`; corpora
`rails` 3,468, `rubocop` 1,780, `mastodon` 3,266 under `fixtures/repositories`) establishes:

- **62** node types are referenced by the analyzer's dispatch;
- **57** node types the analyzer never names **do occur** in real Ruby, and each is ruled with a reason in
  `reviews/ruby/m60-deep-round.md` §2 — the large majority are pure literals (`string_content` 257,398,
  `comment` 119,691, `integer` 51,314) and flow keywords whose children the walks already recurse into
  (`then` 12,808, `else` 4,548, `when` 2,360, `ensure` 1,792);
- **162** unreferenced types **never occur**, and are non-findings by construction.

Two consequences worth keeping in this file rather than only in the review:

1. **The grammar has exactly one call node type.** Every call shape — `foo(1)`, `foo 1`, `foo 1 do … end`
   — is a `call`. `command` and `command_call` are **not** node types the pinned grammar can produce;
   branches on them were dead and have been removed.
2. **M14.0.F1 now audits ALL 60 of this file's node-type comparisons, and it used to audit 40.** The audit
   recognised only `x.type === "lit"`, and this file dispatches on a destructured local `type` for its main
   walk, so 20 comparisons went unread — which is how two dead branches here could cite the audit as proof.
   Fixed at the oracle: ruby **42 → 60, unknown=0**, with cpp +14 and csharp +14 and **zero new findings
   across all 32 lanes**. The rule that survives the fix: **proof for a node-type literal in this file comes
   from the grammar enumeration and the corpus sweep, not from the audit's summary line** — see
   `script/m14/tmp/rb-f1-vacuity-probe.ts`, which reports both sets.

**No regular expressions.** The analyzer contains **0** regex literals and **0** `new RegExp`; the one
expression it once had (the superclass-marker strip) is a character scan, and the superclass-name predicate
`isRubyStaticSuperclassName` is a character scan **exported** so the differential oracle can share it
rather than keep a second copy that can drift.

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `class Name < Base` | `class` | `class` name field, reopen-normalised to **leaf** with the prefix resolved **relative to the enclosing owner** (`fqn` in metadata) |
| `module Name` | `module` | `module` name field, same reopen normalisation |
| `K = Class.new` / `Struct.new` / `Data.define` | `class` (`definedBy: classFactory`) | factory RHS |
| `K = Module.new` | `module` (`definedBy: Module.new`) | factory RHS |
| `def method(...)` | `method` (top-level: `function`) | `method` name field |
| `def self.method(...)` | `method`, `isStatic` | `singleton_method` name field |
| `class << self` methods | `method`, `isStatic` | `singleton_class` > `method` |
| `attr_reader` / `attr_writer` / `attr_accessor` | `property` | `simple_symbol` **or `string`** arguments |
| class-body `CONSTANT = value` | `constant` | `assignment` > `constant` |
| `define_method(:name)` | `method` (`isDynamicMethod`) | `simple_symbol` or `string` argument; a name containing `#{}` is a **template, not a name**, and is skipped |
| `has_many` / `belongs_to` / `has_one` / `has_and_belongs_to_many` | `property` (`associationType`) | `simple_symbol`, `string` or `identifier` argument |
| `scope` / `default_scope` | `method` (`scopeType`) | first `simple_symbol` argument |

Ranges come from the Tree-sitter node and include the complete construct. Parameters come from
`method_parameters`; parameters and locals are **never** symbols. `ownerName` is the enclosing class or
module. Visibility is lexical (`public` / `protected` / `private`) and captured on traversal frames, so a
nested class cannot leak its visibility state into a sibling declaration. Per-symbol cyclomatic complexity
mirrors the file-level node set, including the postfix `*_modifier` forms.

## Relationship ontology — all 11 enum values

The enum has 11 distinct values. This is what the analyzer does with **each** of them.

| Relationship | Rule |
| --- | --- |
| `calls` | non-builtin `call` nodes, plus bare identifiers in expression position that are not locals (marked `bareCall: true`). Source = enclosing method, else owner, else `Global`. Receiver calls keep the leaf target; constructor expressions keep the class target. |
| `uses` | instance-variable **reads** (marked `memberRead`), and ActiveRecord association macros (marked `activerecordMacro`). Writes — including compound-assignment LHS — stay silent. |
| `extends` | Ruby superclass (`class Child < Parent`) when the base is a **statically nameable constant path**, and `extend` for singleton mixins. |
| `implements` | `include` / `prepend`, constant targets only. A lowercase or computed arg is a dynamic mixin and correctly emits nothing. |
| `instantiates` | `X.new` on a constant receiver. A receiverless `new` names the enclosing class and is marked `resolvedTarget: "enclosing-class"`. Expression receivers and variable receivers correctly emit nothing (RB-A). |
| `overrides` | 0.95 when the base's method is verifiable from local declarations or the project companion index; 0.5 with `reasonCode: "first-parent-guess"` when the base is external and unverifiable. |
| `references` | `require` / `require_relative` / `load` / `autoload` string paths, source `Global`. |
| `contains` | one edge per owned symbol, from `ownerName`. |
| `imports` | **never emitted as a relationship — but COVERED, by measurement.** `require` / `autoload` push to the `imports: ImportInfo[]` array, which parallel-indexer writes to the import table the file-dependency engine reads. Measured on the **production path** (`ASTEngine.parseFile`) at `route_set.rb`: **7 requires → 7 `references` edges and 7 import records, one for one.** Emitting an `imports` edge too would put the same facts in the graph a third time under a second label. The `imports` *kind* is a minority construct: 2 of 14 OO-family analyzers. |
| `exports` | **never emitted, and correctly so.** Ruby has no module-level export construct — every constant and method in a module is public unless `private_constant` / `private` says otherwise — so there is nothing for an `exports` edge to name. Minority construct: 3 of 14, and of the OO lanes only java emits it, at one site. |
| `Dependency` / `Related` | enum aliases of `uses` / `references`, not separate types. |

**So all 11 are accounted for: 8 constructed, `imports` carried through the ImportInfo family with a
measurement, `exports` correctly empty by language law. No type is missing.** The family matrix and the
production-path measurement are in `script/m14/tmp/rb-rel-type-census.ts` and the review §12.

### What a consumer actually receives

Emitting a type is not the same as a graph query returning it. Over 1,200 real files and 101,017 emitted
relationships, two silent filters sat between them:

| | before | after |
|---|---|---|
| reachable with **no** `relationshipTypes` argument | **57.4%** | **73.7%** |
| reachable with an explicit filter | 73.7% | 73.7% |

(Corpus-wide denominator: 101,017 edges over 1,200 parsed files of 8,528, with declared
names indexed from **all** of them. An earlier version of this section reported 34.3% → 50.5% —
both figures came from a probe that indexed only the files it parsed, so any edge into an
unsampled file read as unresolved. Same defect and same fix; the magnitude was a sample
statistic. Review §30.)

`graph-engine.ts` defaulted the traversal to four of the eleven types, so **22.2% of every emitted
relationship was excluded before the query ran** — including `contains`, the parent-to-member edge, which
left a traversal unable to descend from a class to that class's own methods. It was also undeclared: the
function reports every cap and budget through `truncated` / `truncationReason` and said nothing about this.
The default is now every type, and a caller's filter is declared. That also removed a three-way
disagreement between the repo's graph paths, two of which already returned everything.

The remaining **26.3%** is not a type problem: it is edges whose target resolves to no symbol, which every
graph query excludes — and all 26,578 are accounted for. **76.3%** of the gap is `calls` to external
framework DSL that no repository in the corpus declares (RSpec's `it`/`let`/`assert_equal`, Minitest,
`I18n.t`); **18.1%** is `uses` where an ivar read targets a *value*, not a symbol; **4.2%** is
`references` where `require` names a gem outside the project. Every cause is a fact about Ruby or about
the dependency set — **not one is a fabricated edge**. Review §27–§30. The structure is a language fact — `contains` and `overrides` resolve at 100% because
both sides are declared symbols, `references` at 2.9% (a require target is a *path*) and `uses` at 5.0% (an
ivar read targets `@foo`). `references` is the sharpest case: **1,194 edges emitted, stored, and invisible to graph traversal.**
The reachability figures are a **lower bound** on production resolution, which
`parallel-indexer.ts resolveRelationships` does more thoroughly than this measurement — review §25.

**Measured, and it changes the fix.** Splitting those `references` edges by require method over three
corpora (rails, rubocop, mastodon) inverts the picture:

| require method | share of edges | names a file in the project |
|---|---|---|
| `require_relative` | 8.9% | **100.0%** |
| `require` (bare) | 89.4% | **0.0%** |
| `autoload` / `load` | 1.8% | 0.0% |

So most of the 2.9% is **correct**: `require "active_support"` names a gem that is not in the
repository, and no join can turn it into an in-project symbol without fabricating one. The genuinely
actionable slice is `require_relative`, and it is 100% actionable — every one of those targets is a real
file. The blocker is that both resolvers (`storeResults:2931`, `resolveRelationships:3078`) are
name-based only, and `brain_relationship` has no `target_file_id` for a file-level fact. Correcting the
earlier proposal: the facts are not unreachable —
`intelligence/analysis/dependencies.ts:85` already joins `brain_relationship + brain_import`; they are
invisible to *graph traversal* specifically. Review §27.

**All 8 of the emitted types now have an independent oracle derivation.** `contains` and `references`
were in no audited set and had no derivation at all — ~34% of the payload, correct as emitted and verified
by nothing. Both are now derived in the standalone oracle and audited, which is what made the two identity
defects below findable at all: both are *containment* facts.

**Full corpus, 8,528 `.rb` files, all 8 emitted labels** (`rb-corpus-census.ts` + the standalone
oracle `script/m14/ruby-truth.ts`, selected with `BB_RB_ORACLE`):

| reading | value |
|---|---|
| outside the audited set | **0%** — every emitted type has an independent derivation |
| MISSING | **281 (0.043%)** — `calls` 278, `instantiates` 1, `contains` 1, `uses` 1 |
| UNEXPLAINED | **317 (0.111%)** — `calls` 298, `instantiates` 19 |
| — of which cross-file (out of scope) | 3,740 |

**The oracle is single-file by construction, and that is accounted for separately.** It reads one file's
tree, so an analyzer edge whose target is *defined in another file* cannot be matched by it — not because
either side is wrong, but because the question is unanswerable from one tree. Those 3,740 edges
(`calls` 2,852, `uses` 568, `contains` 321) are reported as cross-file rather than folded into
"unexplained". Conflating them overstated the gap roughly sevenfold in an earlier measurement.

**The 317 that remain are the same-file, different-class case.** A helper defined in one class and called
from a sibling's method — `next_page` defined in an outbox controller and called from a contexts
presenter — is resolvable only by following an inheritance or `include` chain, which a single-file oracle
that reads one tree at a time does not build. Each has a named, reproducible example; none is an
unexplained disagreement about semantics.

### What the oracle is, and where it lives

`script/m14/ruby-truth.ts`, standalone by design. It used to be `deriveRubyEdges` inside the shared
`script/m14/differential.ts`, a file six language lanes rewrite; it was replaced wholesale six times
during this work, once by a PHP-derived generic keyed on node types (`method_declaration`,
`class_declaration`) that do not exist in the Ruby grammar, at which point the unexplained count measured
**80,761 (28.3%)**. The oracle contains **no regular expressions** — pure structural rules plus
character scans, so "no regex" is a property of the construction rather than a lint that can be
forgotten.

`script/m14/tmp/rb-oracle-agreement.ts` is a permanent **99-case** suite (74 positive, 25 negative) that
computes the analyzer's edges live, so it fails if either side moves. The negative half is the
load-bearing half: each case is a shape where the answer is *nothing*, because most of the large defects
here were rules that asserted more than the contract, and each was found by asking what the analyzer
does when it emits no edge at all.

### Four things that are easy to get wrong here, and cost real time to get wrong

- **`extends` carries its source under `source`, not `from`.** A probe reading `r.from` prints
  `undefined` and looks like proof the edge has no source — which is how one "correction" to this lane's
  oracle made things worse for two rounds.
- **`RUBY_BUILTINS` is the analyzer's *suppression list*, not a judgement about the language.** Adding
  an entry that is not in that list is always wrong, even for a name that looks obviously like a
  framework helper (`flash`, `redirect_to`, `params` are all emitted).
- **A mixin target must be a *constant*, and a member needs a *namable* owner.** `include local_account`
  publishes nothing (a lowercase identifier is a local, and in RSpec a `let`), and `attr_reader :site`
  inside `Class.new do … end` publishes no member because nothing names the class.
- **This grammar wraps the node you want.** `superclass`, `splat_parameter`, `destructured_parameter` and
  `exception_variable` all wrap the interesting child, and reading the field expecting a leaf returns
  nothing — silently, for the entire corpus.
by nothing. Both are now derived (`reviews/ruby/patches/differential-ruby-oracle-mirrors-2.patch`) and
audited, which is what made the two identity defects below findable at all: both are *containment* facts.

**Full corpus, 8,528 `.rb` files, 8 audited labels** (`rb-corpus-census.ts` + the staged oracle mirrors):

| reading | value |
|---|---|
| outside the audited set | **0%** (was 34%) |
| MISSING | **3 (0.001%)** — `instantiates` 2, `calls` 1 |
| UNEXPLAINED | **507 (0.178%)** — `contains` 451, `calls` 31, `uses` 18, `overrides` 5, `instantiates` 2 |

The first number in this lane's history taken over the whole corpus rather than a stride. The 507 are
dominated by `contains` on symbols created inside a dynamic or `class_eval` block — the SIG-B class, where
the graph cannot say which class owns the member.

## Line numbers

Measured on **3,000 real files** with `script/m59/oracle-callsite.ts`, which re-derives every edge from the
tree and requires the target token to be present on the claimed line:

| | relationships | with a line | no line | **inconsistent** |
|---|---|---|---|---|
| before | 252,674 | 252,674 | 0 | **118** |
| after | 252,292 | 252,292 | 0 | **0** |

No edge lacks a line, and every remaining claim is either verified against the tree or explicitly declared
structurally uncheckable. The 118 were one bug: an expression receiver (`X.new(...).new`) constructs an
**anonymous** class, and the guard saying so sat *below* the emit, so the edge claimed the enclosing class
constructs itself on a line that does not name it.

## Unknown symbols

`script/m14/tmp/rb-payload-hygiene.ts` sweeps the whole published payload for names that name nothing —
empty strings, sentinels, interpolation templates, non-leaf paths, unstripped quotes or colons, whitespace,
and call syntax — each scoped to the labels where that shape is actually wrong. Over **8,528 files /
81,869 symbols / 702,948 relationships**: **13 occurrences in 2 classes**, and both are named in the
review. A name that reaches a consumer of the graph and resolves to nothing is the failure this exists to
catch, and before this sweep nothing had ever looked.

## Known cross-cutting issue, not fixed here

`SYMBOL_NAME_DENYLIST` contains `"unknown"` for every language, and `parallel-indexer.ts:2181` silently
drops a symbol with that name. `Logger#unknown` — one of Ruby's five standard log severities, mixed into
ActiveSupport's `ColorizeLogging` — therefore never reaches the graph. Shared-file finding; recorded rather
than patched from this lane.

## Scope rules that are easy to get wrong

- **A name a parameter default ASSIGNS is a local of the method.** Ruby evaluates a default in the
  method's own scope, so `def all(all_queries: (seen = true))` makes `seen` a local and `return nil if
  seen` is a local read. A default that *calls* something is a real call site. Both are handled
  (`extractParamDefaultBindings` + `walkParamDefaults`).
- **A bare identifier is a local read if it is a parameter, a block/lambda parameter (including splat and
  destructured forms), an assignment target anywhere in the enclosing body, a pattern-matching binding, or
  an `exception_variable`; otherwise it is a method call** — which is how Ruby resolves it, at
  parse-of-scope time.
- **`private` / `protected` / `public` are declarations in every form** — bare keyword, symbol-list, and
  the call node alike. None is a call edge.
- **An anonymous dynamic class's members are declared, not reparented.** `anon = Class.new(Base) do … end`
  binds a *local*, so its members belong to a class with no name. The owner is left alone (a local has no
  symbol, so reparenting would trade a false edge for a dangling one) and the binding is **declared** in
  `metadata.anonymousScopeBinding` on the member symbol and on the `uses` edge. The marker resolves to the
  **innermost** enclosing anonymous class and works for both the class-body form and the method-body form,
  which is the one real code writes.

## Supported AST shapes

- Root `program` and nested module/class `body_statement` containers; `singleton_class` (`class << self`)
- `method` and `singleton_method`, including keyword, splat, hash-splat, block, destructured and
  forwarding parameters, and **endless** bodies (`def f = expr`, which have no `body_statement`)
- `call`, `argument_list`, `scope_resolution`, `simple_symbol`, `string`, class-body `assignment`
- `if`, `unless`, `while`, `until`, `for`, `case`, `rescue`, `elsif` and their postfix `*_modifier` forms
- Ruby 3 pattern matching: `in_clause`, `array_pattern`, `find_pattern`, `as_pattern`, `keyword_pattern`

The extraction walk is iterative and linear in AST nodes; overrides use maps and sets; contains edges are a
single post-pass. No nested symbol/relationship scan is used for ordinary extraction.

## Known limitations, stated rather than implied

- **Class variables (`@@x`) and globals (`$x`) produce no `uses` edges** (RUBD3). They are file-global by
  nature; per-file emission would fabricate cross-file semantics. The count is reported in
  `metadata.classAndGlobalVarsSkipped`.
- **`def` inside a method body declares no symbol.** `walkBody` walks nested defs' bodies for calls but
  does not declare them, because Ruby defines them when the outer method runs.
- **A bare write target in a multiple assignment was published as a read — FIXED.** `@a, @b = 1, 2` parses
  with the ivars under a `left_assignment_list`, so the old guard's `parent is assignment` test was false and
  each target emitted a `uses` read. **66 edges in 23 files across 1,200 sampled → 0.** Compound assignment
  (`@n ||= v`) was already handled under SCD1, so the gap was the multiple form only. The rule now lives in
  one exported predicate, `isRubyInstanceVariableWrite`, which the read oracle **imports** rather than
  re-deriving. The oracle mirror is staged as a patch (review §14), and until it lands the differential
  scores this strictly-more-correct analyzer as a regression — disclosed, with the affected files enumerated.
- **`element_reference` targets spell as `[]`.** `params[:tag]` emits `calls:[]`, a target that names no
  resolvable method. Flagged, not ruled.
- **`module_function` copies are not modelled.** Instance-to-module copies are beyond static scope.
- **`Class.new(Base)` superclass edges are not emitted.** The *symbol* is the core fix; the extends edge
  for a factory base is still owed.
- **A symbol is created inside a dynamic or `class_eval` block** — `Class.new do … def m; end end` and
  `class_eval { def m }` — and the graph has no way to say which class owns it. This is the bulk of the
  `contains` share of the full-corpus residual.
- **Cross-file override precision requires the optional project companion index.** Absent that context the
  analyzer stays deterministic and uses in-file declarations, downgrading to a declared 0.5
  first-parent guess rather than dropping the edge.

## Verification evidence

Re-derived at the commit of `reviews/ruby/m60-deep-round.md`:

- Fixtures: **9/9 pass** (`script/m14/run-fixtures.ts --lang ruby`; 8 pre-existing plus `m60-deep-round`)
- Mutation: **38/38 caught, 0 survivors** (`BB_MUTANT_ONLY="ruby/"`); four further catalog mutants are
  **staged, not committed**, in the review §7.1 — the F4 count is 38 and not 42 by decision, because the
  catalog is a shared file.
- M12 ground truth: **37 facts, precision 1.000, recall 1.000, 0 FP, 0 FN** (re-derived live; the
  committed sealed artifact is left untouched, because re-running the shared script drops its `bbSeal`
  and adds other lanes' rows — see the review §7.2)
- Differential on three corpora this lane had never been run against: rubocop **MISSING 0 / unexplained
  0**; mastodon **0 / 79**; rails **20 / 59**. Those figures predate the standalone oracle and are kept
  for continuity; the current whole-corpus reading is the table above.
- Repository-wide relationship-type gate: **ruby 8 emitted, 8 audited, 0 findings** — both of Ruby's
  recorded DERIVATION debts are repaid and removed from the shrink-only baseline. Gate self-test
  **17/17**.
- **Symbol coverage** (`rb-node-coverage.ts`, full corpus): the analyzer names 67 of the 284 grammar node
  types and the unreferenced ones are overwhelmingly literal or lexical nodes (`string_content`,
  `comment`, `pair`, `integer`, heredoc parts) that require no declaration rule. The remaining
  declaration-relevant unreferenced types are pinned in the tool's own ranked output. This is **not** a
  claim of 100% symbol coverage and the document does not make one.
- **Performance** (`rb-benchmark.ts`, full 8,528-file corpus, parse isolated, warm, best-of-3):
  **181 files/s and ~14,900 relationships/s single-threaded; p95 19.9 ms, p99 68.4 ms, max 613 ms** over
  702,932 relationships and 81,861 symbols. A CPU profile attributes the remaining time to WASM-to-JS
  node marshalling (`setValue`, `marshalNode`, `get type`, `namedChild`) rather than to analyzer logic,
  so the binding is the ceiling, not the traversal. Budgets are pinned at p95 <= 40 ms, max <= 4 s and
  >= 150 files/s — set from the measurement with ~15% headroom rather than from an aspiration, because a
  budget pinned at the measurement fails on any slower machine and trains its reader to ignore it.
  0**; mastodon **0 / 79**; rails **20 / 59**. **All** of the residual is oracle-side and is adjudicated in
  the review §4.2.
- Stride census, 400 files per corpus: **zero analyzer-side fabrications after this round**; every
  remaining unexplained edge is an `uses` association the read oracle has no truth derivation for, and
  every remaining missing edge is an `overrides` edge the read oracle fabricated through a nested-class
  attribution leak.
- Grammar: F1 reports `ruby PASS unknown=0` — **read the vacuity note above before relying on it**.
- Regex census: **0** in this analyzer.