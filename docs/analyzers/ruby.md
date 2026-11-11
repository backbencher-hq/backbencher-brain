# ruby.md

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
`rails` 3,468, `rubocop` 1,780, `mastodon` 3,266 under `<corpus-root>`) establishes:

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

## Relationship ontology

**This table is the claim.** The engine's canonical surface is 14 relationship types, and every
one of them has a row whether or not this analyzer publishes it — a type it does not publish is
**ruled**, not omitted. `script/m14/verify-doc-truth-emissions.ts` reads THIS table's `Emitted?`
column against `src/ast/real-ruby-analyzer.ts` (comments and string literals stripped first) and
`script/m14/verify-analyzer-docs.ts` reads it for unexplained cells, so the cells are checked by
two instruments and are written to be read, not admired.

Edge counts in the last column are the **whole-population arm** — `BB_CORPUS_ROOT=$PWD/.corpus
BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts ruby rb 0` over **989 admitted `.rb`
across 15 repositories, 0 parse failures, `index=no` (arm A)** — preserved at
`validation/m14/measurements/ruby-gate-postownerless-2026-10-22.txt`. They are edges **emitted**,
which is a different quantity from the same table's resolution classes: `resolved 29,518 +
amb(decl) 18,986 + unresolved 33,653 + causeOK 2,945 = 85,102` closes exactly over the arm, with
`amb(kind) 9,695` and `collRes 5,732` reported beside it and never added.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| `calls` | **yes** — relationship | A `call` node's own method name, published unless the name is in `RUBY_BUILTINS` (the analyzer's suppression list — see the note below the table) or the call is a load directive, which publishes `imports`/`references` instead. Bare identifiers in expression position that are not locally bound are also `calls`, marked `bareCall`. `alias new old` publishes a `calls` edge named by the NEW name whatever the old name's shape — setter and operator aliases included — with `aliasedTo` carrying the old one. Source is the enclosing method, including a nested definition with its own local bindings, else the owner, else the file unit. | `confidence: 0.9` at every `calls` site — the bare-identifier and alias forms are parse-scope inferences, not token facts. Measured **57,324** edges (resolved 14,450 · amb(decl) 18,133 · unresolved 24,741); resolve-through is low because a Ruby call names a framework DSL method no repository in the corpus declares. |
| `contains` | **yes** — relationship | One edge per owned symbol, `source = ownerName`, after the single post-pass that drops an `exports` pair which would duplicate a `contains` pair. | `confidence: 1.0` — both sides are declarations this file just produced. Measured **10,209** edges, all 10,209 resolved, of which **5,732** are tie-break picks (`collRes`): the target had more than one declaration and production's tie-break chose one. |
| `exports` | **yes** — relationship + `ExportInfo[]` | Ruby has no export keyword, so a FILE UNIT is the exporting surface: top-level constants and defs publish `exports` with `source` = the path-derived file unit and `resolvedTarget: file-unit`, beside the `ExportInfo[]` payload. Refusals: singleton-class members, `private_constant` deletions, reopens/duplicates collapse to ONE unit, and unnameable symbols. | `confidence: 1.0` — the surface is the file's own declarations. Measured **1,367** edges, 1,365 resolved (2 ambiguous). The payload channel is live too, so a consumer reading `ExportInfo[]` sees the same fact the edge carries. |
| `imports` | **yes** — relationship + `ImportInfo[]` | `require` / `require_relative` / `load` / `autoload` publish ONE `imports` edge per required path (source = the file unit, `fileLevel`, `requireMethod`, `resolution: file-relative` for `require_relative` and `load-path` for a bare `require`), beside the `references` row AND the `imports[]` payload record — **the same fact in three channels**, which is this family's convention for load directives (`pushLoadFacts`). | `confidence: 1.0` — a literal path in a `call` node. Measured **1,304** edges, 30 resolved (12 ambiguous, 1,262 unresolved): a require target is a PATH, not a symbol, so the graph channels cannot resolve most of them — see the reachability note further down, which is the same fact measured a second way. |
| `references` | **yes** — relationship | The same load directives as `imports`, in the reference channel: `require` / `require_relative` / `load` / `autoload` string paths with source `Global` (the file unit). | `confidence: 0.9` — the path is structural but the reference channel does not promise a symbol behind it. Measured **1,304** edges, 30 resolved — one-for-one with `imports`, which is the pairing the next section argues for. |
| `uses` | **yes** — relationship | Instance-variable **reads**, marked `memberRead`, including a read OUTSIDE any method body (attributed to the file-level owner — a class-body or DSL-scope `@x` is a real read). Writes stay silent, including compound-assignment LHS and multiple-assignment targets. ActiveRecord association macros publish `uses` marked `activerecordMacro`. | `confidence: 0.9` on a member read, **0.8** on an ActiveRecord macro — the macro names a class the string does not prove. Measured **4,760** edges, 14 resolved and 4,746 unresolved **by construction**: a variable is not a declaration, so this is the one type whose near-100% unresolved share is the correct class rather than a defect. |
| `overrides` | **yes** — relationship | A subclass method whose name is also declared by a locally identified base or by a project companion entry. An unresolved qualified superclass keeps its written path on the inferred edge. | `confidence: 0.95` for an in-file declaration, **0.65** for a name-only companion match, and **0.5** with `reasonCode: "first-parent-guess"` when the base is external and unverifiable — a declared guess rather than a dropped edge. Measured **3,117** edges: 172 unresolved in scope and **2,945 carrying a DECLARED cause** (`baseBeyondRunScope` — the base is declared in another file, which a per-file scope cannot reach and the arbiter answers with the project). |
| `extends` | **yes** — relationship | The Ruby superclass (`class Child < Parent`) when the base is a statically nameable constant path, plus the factory spelling `K = Class.new(Base)`. `extend` is NOT here (RUBY-D1): it composes a module into the singleton class and publishes `mixes_in`. | `confidence: 1.0` — the superclass field is a grammar field, and `isRubyStaticSuperclassName` is a character scan exported so the oracle shares it instead of keeping a drifting copy. Measured **1,895** edges = 1,886 nameable superclass clauses + 9 factory superclasses, exactly (see the probe reconciliation in the cell, `validation/m14/verification/RUBY-CELL-2026-10-21.md` §4C). |
| `implements` | **no** — ruled undecidable | **RULED UNDECIDABLE, rung R1+R2 named and measured.** R1 (bump the grammar package to a build whose inventory has the construct) is **measured unavailable**: npm's newest `tree-sitter-ruby` is 0.23.1 and a build of that source against the wired build has a named-type delta of added 0 / removed 0, so there is no newer inventory to bump to. R2 (clone, patch, `tree-sitter generate`, `tree-sitter build --wasm`) is mechanically available but its fire measurement is **0**: an AST-verified patched conformance rule fires on **0 of the 989 admitted files**, and narrowing to the 11 conformance-shaped node types turns the 69 files that merely contain the TOKEN `implements` into 0 files carrying a conformance NODE. The pinned build declares 0 of 9 candidate conformance node types, with the positive control firing 4/4 in other grammars. | No confidence is claimed, because no edge is emitted. What IS claimed is a **zero over the whole admitted population** (0 rows of 989 files) plus the ruling: Ruby's grammar has no interface/conformance production, duck typing is not declared conformance, and the value this lane used to publish here was a mixin wearing the wrong name — it now publishes `mixes_in`. The rung ladder and its citations are in `validation/m14/verification/RUBY-CELL-2026-10-21.md` §5. |
| `instantiates` | **yes** — relationship | `X.new` on a constant receiver. A receiverless `new` names the enclosing class and is marked `resolvedTarget: "enclosing-class"`. Expression and variable receivers emit nothing (`X.new(...).new` constructs an anonymous class, and the guard says so). | `confidence: 0.9` — the receiver is a constant path, but whether the class is the caller's enclosing class is an inference. Measured **3,426** edges, 1,831 resolved (235 ambiguous, 1,360 unresolved: the class is usually declared in another file). |
| `mixes_in` | **yes** — relationship | **Canonical mixin composition (RUBY-D1, 2026-10-19).** `include M` / `prepend M` compose M into the class's ancestor chain, `extend M` into its singleton class; source = the composing class/module, target = the mixin, `metadata.mixinType` keeps the keyword spelling. DECIDED BY THE STATIC SELF-TYPE, NOT BY THE NAME: `def self.x` is a `singleton_method` NODE and `def x` a `method` NODE, so whether `self` is the class or an instance is a node-type question. Refused, with the count: a receivered call (`cls.extend(X)`, `self.extend`), an instance `self`, a top-level `self`, a non-constant target (a lower-case identifier is a local, and in RSpec a `let`), a class-answering a name it defines itself, and a call whose enclosing scope names NO class (`Class.new { }` on a local's RHS — 20 rows). | `confidence: 1.0` — a constant-argument composition inside a class body is a token fact once the self-type is read off the node type. Measured **396** published rows: 322 resolved, 34 ambiguous, 40 unresolved. The count moved 543 (first emission surface) → 416 (after the four impostor classes) → **396** (after the named-owner refusal), each step a measured refusal. Located 396 of 396 in the trees by `script/m14/ruby-mixin-impostor-census.ts`, impostors A/B/C all **0**. |
| `part_of` (canonical) | **no** — ruled undecidable | **RULED UNDECIDABLE, rung R1+R2 named and measured.** Same grammar finding as `implements`, measured separately: R1 unavailable (no newer inventory), and an AST-verified `part_of` rule fires on **0 of 989 files** — the single file that contains a plausible textual marker carries no containment node, so the token census (1 file) and the AST census (0 files) disagree and the AST is the one that counts. The relations Ruby DOES have here are `contains` (a member is part of its owner) and `mixes_in` (a module joins an ancestor chain), and both are already published under their own labels — 0 new-information rows. | No confidence is claimed, because no edge is emitted. Claimed: **0 rows over the whole admitted population**, plus the near-miss census showing the relation is already published under `contains` and `mixes_in` rather than lost. Rung ladder: cell §5. |
| `renders` | **no** — ruled undecidable | **RULED UNDECIDABLE, rung R1+R2 named and measured.** Ruby has no template/render production in the grammar and no static binding from a render call to a template: `render :show` / `render json: x` name a SYMBOL or a computed value, so any rule would be a name/call filter, which is the impostor test this fleet has already refuted (a filter on the NAME cannot separate a construct from its impostor). Measured: R1 unavailable, and an AST-verified renders rule fires on **0 of 989 files** (36 files contain the token; 0 carry a render node). | No confidence is claimed, because no edge is emitted. Claimed: **0 rows over the whole admitted population**. A `render` call is still published as a `calls` edge to the method name, which is the fact the analyzer can stand behind — the template relation is the part that is not statically decidable. |
| `decorates` | **no** — ruled undecidable | **RULED UNDECIDABLE, rung R1+R2 named and measured.** Ruby has no decorator production: the popular decorator gems are `Class.new` wrappers, `SimpleDelegator` subclasses and `def_delegators` macros, which the grammar cannot distinguish from an ordinary class or an ordinary method call without executing the DSL. Measured: R1 unavailable, and an AST-verified decorates rule fires on **0 of 989 files** (0 files even contain the token). | No confidence is claimed, because no edge is emitted. Claimed: **0 rows over the whole admitted population**, and the wrapper classes and `def_delegators` macros are still published as `class` symbols and `calls` edges — the decoration RELATION is what is not statically decidable. |

**Two notes on how to read that table.**

- **`RUBY_BUILTINS` is a suppression list, not a judgement about the language** — adding a name
  that is not already in it is always wrong, and widening it is the one move this campaign
  forbids: **a row one does not want is a census entry, not a builtin.** A working-tree experiment
  that added `"new"` to it suppressed the whole instantiation convention and broke seven fixtures;
  the episode and its measurement are recorded in the cell §10.
- **`part_of` carries a `(canonical)` marker**: `verify-doc-truth-emissions`'s alias map keeps a
  ten-kind surface and maps the underscore-stripped `partof` onto `contains` (an adaptation other
  lanes legitimately use). Without the marker, this row's *no* would be graded against `contains`
  — which IS live — and the gate would report a FALSE_NEGATIVE on a true claim. The marker keeps
  the row's own name from being read as another kind's name; `renders`, `decorates` and `mixes_in`
  need none, because their stripped spellings name no engine kind. **The gate's ten-kind surface
  against the fleet's fourteen-kind ontology is a gap in the gate, not in this page** — reported,
  not worked around anywhere else.
- `Dependency` / `Related` are enum ALIASES of `uses` / `references`, not separate types, so they
  are not rows here.

### CORRECTION 2026-10-19 (ALL-OUT-OF-ALL phase 2) — which rows of the handover state below are STALE

The handover section that follows was written when this analyzer emitted 8 of the 10 labels; it says
`imports` and `exports` are never emitted. **That is no longer true and this wave re-measured it**: the
cap-50 arm (`incoming-gate ruby rb 50`, 50/50 parsed of 989 admitted `.rb` / 15 repos) reads
`imports` **64** and `exports` **59** edges, and the whole ten-label surface fires. The handover
paragraphs are kept below for provenance (their import-payload pairing argument is still the reason
BOTH the edge and the payload exist), but a reader must not take the "silent types" claim from them.
Also corrected above: `mixes_in` is the canonical mixin value (RUBY-D1 relabel), `implements` is ruled
not applicable, and `extends` no longer carries `extend`.

## Handover provenance, 2026-10-05 — re-measured, and still the record

### Handover baseline: production-path firing check

`NFILES=200 bun script/m14/firing-check-v2.mjs RUBY`, corpus
`<corpus-root>/ruby`, 200/200 parsed: **8/10 fired**, `imports[] 214 in 120 files`,
silent `imports exports`.

Two facts about that instrument that this lane's own numbers confirm, because they are
recorded here rather than taken on trust:

- **The silent `imports` is not a gap.** `ParseResult` (`src/ast/types.ts:206-216`) carries
  `imports: ImportInfo[]` on a channel separate from `relationships`, and
  `parallel-indexer.ts:2169` persists it to the `brain_import` TABLE. `firing-check.mjs`
  (v1) tallies only `res.relationships` and compares against the `types.ts` value
  `brain_import`, a string no emitter produces, so it is structurally unable to observe an
  import. This lane's 200-file corpus census re-measures the pairing directly: **118 import
  records and 118 `references` edges across the same 100 files**, one for one.
- **The score moves with `NFILES`, so it is re-run at more than one value.** The instrument's
  own header records Ruby scoring 1/10 at `NFILES=25` and 8/10 at `NFILES=200` on this
  corpus, because 25 drew only `enc/trans/*-tbl.rb` encoding data tables.

### `ruby` is NOT one of the 100 DERIVATION findings

`bun script/m60/rel-type-coverage-gate.ts --langs=ruby`: CHECK 1 DERIVATION **clean**, CHECK 2
REACHABILITY clean (traversal default is 10 of 10), CHECK 3 AGREEMENT clean, CHECK 4 ENUM clean,
`baseline: 104 recorded, 0 NEW, 104 repaid`. Every type this analyzer emits has an independent
oracle derivation, so nothing here is stored and compared against nothing.

### The ontology arbiter exits 2 for ruby, and the reason is narrower than it prints

`bun script/m14/ontology-coverage-gate.ts ruby` exits 2 with:

> `ontology coverage gate — no RULING SOURCE for ruby.` … `Neither RULED_BY_LANG.ruby nor
> script/m14/spec/ruby-completeness.json supplies one.`

`script/m14/spec/ruby-completeness.json` **does exist** and carries **25 `RULED` decisions**
(RUBD1-RUBD15, RB-A-RB-K, M3710-COMPANION) — so the message's second clause is misleading. The
gate's guard (`script/m14/ontology-coverage-gate.ts:409-417`) does not ask whether the spec file
exists; it asks whether `rulingFor()` finds a ruling for **any un-emitted type**, and
`rulingFor` (line 330-369) requires a `status: "RULED"` decision whose `resolution` both mentions
the type name and passes a `/ontology|emits|excluded|type/` keyword filter. Measured over the
spec:

| un-emitted type | decisions mentioning it | gate verdict |
|---|---|---|
| `exports` | **0** | `RULED-UNJUSTIFIED` |
| `imports` | **0** | `RULED-UNJUSTIFIED` |

The one decision whose text contains the string `export` is **RUBD13**, and it is about a
different thing entirely — `exported isRubyStaticSuperclassName`, a helper the analyzer and the
oracle share. So the arbiter is right for the wrong-stated reason: **the lane has never ruled
either of its two silent types.** That is the finding, and it is repairable in this lane's own
tree — `script/m14/spec/ruby-completeness.json` is per-language and the gate names it as the
lane-owned place for a ruling. The rulings are added below.

`RULED_BY_LANG` inside `ontology-coverage-gate.ts` is a shared file and was **not** edited; it
is master's to change.

### The two ruled types, and what the previous ruling for `exports` was missing

The `exports` row above carried a **prose** justification — "Ruby has no module-level export
construct" — and no measurement. That is the exact shape the ontology gate exists for: prose
alone is not a ruling. It is re-derived from the parse tree below rather than restated.

<!-- DERIV_EXPORTS_RUBY4 verdicts land here as each is measured -->

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
**A SECOND READING OF THE SAME QUESTION, KEPT BECAUSE IT WAS TAKEN WITH A DIFFERENT ORACLE BUILD.**
This block is the staged-oracle-mirrors reading (`reviews/ruby/patches/differential-ruby-oracle-mirrors-2.patch`,
8 audited labels, full 8,528-file corpus). It is NOT in contradiction with the reading above — the two
were taken against different mirror sets, and the numbers differ for that reason rather than because
either is wrong. **The current same-file reading for this campaign is the gap census below the second
table: 813 files of `rack` + `gql-ruby`, `MISSING 99` / `UNEXPLAINED 176`, in
`validation/m14/measurements/ruby-differential-gap-2026-10-22.json`.**

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

## Supported constructs

| construct | node type | what it produces |
| --- | --- | --- |
| method definition | `def` | `function` symbol |
| method call | `call` | `calls` edge |
| constant assignment | `const_op_declare` / `const_decl` | `constant` symbol |
| class definition | `class` | `class` symbol |
| module definition | `module` | `module` symbol |
| `require` | `call` to `require` | `imports` edge |

## Regex inventory

**Zero.** The analyzer contains no source-text regex doing syntax work; names come from grammar fields and node positions.

## Differential ground truth

- Result `validation/m12/results/ruby-differential.json`: `passed: true`, expected **37**, truePositive 37, falsePositive 0, falseNegative 0, unknown 0, precision 1, recall 1 — over three fixtures (`Service.rb`, `BaseService.rb`, `Negative.rb`), `kind: per_analyzer_differential:ruby`, `truthSource: manual_audit`. **Corrected 2026-10-22:** this line used to cite `r-differential.json`, which is `kind: per_analyzer_differential:r` — the **R language's** file (expected 46), not Ruby's. The section below had always cited the right one, so the page carried the same fact under two filenames and one of them was another language's.

## Corpus validation

- Corpus `validation/m12/results/ruby-corpus-errors.json`: corpus `rake`, extensions `*.rb`, 0 error files, 0 crash files.
- Differential: the same `ruby-differential.json` artifact, cited in full under **Differential ground truth** above rather than restated here — one artifact, one citation.

## Complexity envelope

No in-tree `ruby-complexity.json` artifact exists, so no wall-clock envelope is claimed; none is fabricated here.

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

- Fixtures: **13/13 pass, 0 fail** (`bun run script/m14/run-fixtures.ts --lang ruby`, re-run on committed HEAD 2026-10-22; the suite was 9 when this section was written — `mixin-discriminator` and three later pins are the additions). The suite is one of the completion gate's five DONE conditions, so this number is a gate input and not a courtesy.
- Mutation: **42 of 42 caught, 0 survivors** (`BB_MUTANT_ONLY="ruby/" bun run script/m14/mutate-analyzer.ts`,
  2026-10-22; the harness filtered 2,056 → 42). The four mutants this line used to call *staged, not
  committed* are committed now, in the lane's own `script/m14/ruby-mutants.ts` — including
  `ruby/mixes-in-accept-explicit-receiver` and `ruby/mixes-in-accept-ownerless-factory`, which pin the
  two `mixes_in` refusals. **A no-op mutant is not a pass**, so each one's defect signature is its own.
- M12 ground truth: **37 facts, precision 1.000, recall 1.000, 0 FP, 0 FN** (re-derived live; the
  committed sealed artifact is left untouched, because re-running the shared script drops its `bbSeal`
  and adds other lanes' rows — see the review §7.2)
- Differential on three corpora this lane had never been run against: rubocop **MISSING 0 / unexplained
  0**; mastodon **0 / 79**; rails **20 / 59**. Those figures predate the standalone oracle and are kept
  for continuity; the current whole-corpus reading is the table above.
- Repository-wide relationship-type gate: **ruby 8 emitted, 8 audited, 0 findings** — both of Ruby's
  recorded DERIVATION debts are repaid and removed from the shrink-only baseline. Gate self-test
  **17/17**. **Read the count against the current emission surface, which is 10:** the `mixes_in`
  relabel (RUBY-D1) added a type and moved `extend` out of `extends`, and the load-channel pair
  (`imports`, `exports`) is audited on its own payload channels rather than in that instrument's
  8. The 14-type truth this page now carries is the ontology table above; the 8 is the instrument's
  audited set at the time of that run.
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
- Stride census, 400 files per corpus: **zero analyzer-side fabrications after this round**; every
  remaining unexplained edge is an `uses` association the read oracle has no truth derivation for, and
  every remaining missing edge is an `overrides` edge the read oracle fabricated through a nested-class
  attribution leak.
- Grammar: F1 reports `ruby PASS unknown=0` — **read the vacuity note above before relying on it**.
- Regex census: **0** in this analyzer.
