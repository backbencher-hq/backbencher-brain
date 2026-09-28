# real-ruby-analyzer.md

## Language

- Analyzer: `src/ast/real-ruby-analyzer.ts`
- Parser: pinned `tree-sitter-ruby` WASM at `wasm/tree-sitter-ruby.wasm`
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
2. **M14.0.F1's `unknown=0` audits 40 of this file's 60 node-type comparisons — and which 40 is decided by
   spelling.** The audit recognises `x.type === "lit"`, and this file dispatches on a destructured local
   `type` for its main walk, so 20 comparisons are unread. **Do not cite F1 as proof that a node-type
   literal in this file is live.** Proof comes from the grammar enumeration and the corpus sweep. Measured
   by `script/m14/tmp/rb-f1-vacuity-probe.ts`, which reproduces F1's predicate and reports both sets.

**No regular expressions.** The analyzer contains **0** regex literals and **0** `new RegExp`; the one
expression it once had (the superclass-marker strip) is a character scan, and the superclass-name predicate
`isRubyStaticSuperclassName` is a character scan **exported** so the differential oracle can share it
rather than keep a second copy that can drift.

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `class Name < Base` | `class` | `class` name field, reopen-normalised to leaf + `A::B` owner (`fqn` in metadata) |
| `module Name` | `module` | `module` name field, same reopen normalisation |
| `def method(...)` | `method` (top-level: `function`) | `method` name field |
| `def self.method(...)` | `method`, `isStatic` | `singleton_method` name field |
| `class << self` methods | `method`, `isStatic` | `singleton_class` > `method` |
| `attr_reader` / `attr_writer` / `attr_accessor` | `property` | `simple_symbol` **or `string`** arguments |
| class-body `CONSTANT = value` | `constant` | `assignment` > `constant` |
| `K = Class.new` / `Struct.new` / `Data.define` | `class` (`definedBy: classFactory`) | factory RHS |
| `M = Module.new` | `module` (`definedBy: Module.new`) | factory RHS |
| `define_method(:name)` | `method` (`isDynamicMethod`) | `simple_symbol` argument |
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
| `imports` | **never emitted as a relationship.** `require` / `autoload` push to the `imports: ImportInfo[]` array. This is the family norm (11 of 13 analyzers). |
| `exports` | **never emitted.** Ruby has no module-level export construct. Also the family norm (10 of 13; of the OO lanes only java emits it, at one site). |
| `Dependency` / `Related` | enum aliases of `uses` / `references`, not separate types. |

**Which of those the differential actually audits for ruby:** `extends`, `implements`, `instantiates`,
`overrides`, `calls`, `uses`. **`contains` and `references` are NOT audited** — they are emitted correctly
and no gate compares them, and together they are ~40% of the rails edge count. A percentage computed over
the audited set is a statement about the remainder, not about the file.

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
- **A bare write target in a multiple assignment is published as a read.** `@a, @b = 1, 2` parses with the
  ivars under a `left_assignment_list`, so the write-guard's `parent is assignment` test is false and each
  target emits a `uses` read. Compound assignment (`@n ||= v`) *is* handled under SCD1, so the gap is the
  multiple form only. **66 edges in 23 files across 1,200 sampled.** Deliberately unfixed: the read
  oracle derives the same reads as truth, and fixing the analyzer alone would turn two of them into F5
  `MISSING` for a strictly-more-correct change — see the review, §3.5.
- **`element_reference` targets spell as `[]`.** `params[:tag]` emits `calls:[]`, a target that names no
  resolvable method. Flagged, not ruled.
- **`module_function` copies are not modelled.** Instance-to-module copies are beyond static scope.
- **`Class.new(Base)` superclass edges are not emitted.** The *symbol* is the core fix; the extends edge
  for a factory base is still owed.
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
  0**; mastodon **0 / 79**; rails **20 / 59**. **All** of the residual is oracle-side and is adjudicated in
  the review §4.2.
- Stride census, 400 files per corpus: **zero analyzer-side fabrications after this round**; every
  remaining unexplained edge is an `uses` association the read oracle has no truth derivation for, and
  every remaining missing edge is an `overrides` edge the read oracle fabricated through a nested-class
  attribution leak.
- Grammar: F1 reports `ruby PASS unknown=0` — **read the vacuity note above before relying on it**.
- Regex census: **0** in this analyzer.