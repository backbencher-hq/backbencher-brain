# real-clojure-analyzer.md

## Language

- Analyzer file: `src/ast/real-clojure-analyzer.ts` (1,845 lines)
- Parser: `@yogthos/tree-sitter-clojure` 0.0.14 (WASM, via project pipeline `engine.ts resolveWasm`; `wasm/tree-sitter-clojure.wasm` + `~/.bb/wasm` cache)
- Language detection: extensions `.clj` / `.cljc` / `.cljs` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealClojureAnalyzer`
- Review record: `reviews/clojure/deep-review-2026-09-28.md` · rulings: `script/m14/spec/clojure-completeness.json` (CLJ-D1…D29)

**Grammar provenance (M12.04):** the previously wired `tree-sitter-clojure` 0.4.0 failed on
128/141 corpus files because it could not parse `^Type` type hints and `^{:meta}` metadata maps.
Upgraded to `@yogthos/tree-sitter-clojure` 0.0.14, which parses the whole corpus with zero
errors. Its vocabulary is field-rich: every parenthesized form is `list_lit` with `value:`
children; a symbol is `sym_lit` carrying structured `name:` (`sym_name`) and optional
`namespace:` (`sym_ns`) fields; metadata is `meta_lit`; vectors/maps/keywords are
`vec_lit`/`map_lit`/`kwd_lit`; `#(...)` is `anon_fn_lit`. There are **no interop or
qualified_symbol nodes** — dotted names (`com.example.foo`) and constructor idioms (`Date.`,
`->ClojureService`) are single `sym_lit` nodes. **The analyzer is zero-regex** (see below).

## The two derived facts (M60 deep round)

Two things in this analyzer used to be a human's memory and are now derivations. Both are
recorded here because a constant nobody can re-derive is a constant nobody can audit.

### `CLOJURE_CORE_BUILTINS` — the clojure.core surface (CLJ-D17)

The set of bare heads that are *Clojure itself*, so a call to one is a call to the language
rather than to a symbol in the indexed program, and no `calls` edge is emitted. The contract is
unchanged; the SET was rebuilt.

It was 437 hand-typed names, and the F5 oracle **imports the object by reference**:

```ts
import { CLOJURE_CORE_BUILTINS, isAnonArgShorthand } from "../../src/ast/real-clojure-analyzer"
```

so every name the list omitted was a **mirrored fabrication** — the analyzer emitted
`calls -> mapcat` and the truth side derived `calls -> mapcat`, and the differential reported
0 unexplained. Measured: **2,525** such edges in the clojure corpus (30% of all 8,391 call
edges), **999** in clj-kondo, **151** in core.async.

**This is a gate, not a script.** `script/m49/verify-clj-core-list.ts` re-derives on every
run and fails in both directions — `MISSING` (a real core var the constant does not know, the
fabrication class returning), `UNDECLARED` (a suppressed name that is neither derived nor a
declared extra), and `STALE-EXTRA` (the declared list drifting from the code). It is chained
into `bun run verify` after `verify-r2-regex.ts`, and its `--selftest` mode proves it can fail
(4/4 negatives, including the literal 2026-09-20 condition). It holds no committed artifact,
so there is nothing to go stale; a missing corpus is a disclosed `SKIP`, never a pass.
`script/m14/tmp/clj-core-derive.ts` is a thin printer over the same `deriveFromCorpus`.

The derivation itself, using the pinned wasm: parse `clojure/clojure/src/clj/clojure/*.clj`, keep only the files whose
`ns`/`in-ns` is `clojure.core` / `clojure.core.protocols` / `clojure.core.reducers`, keep only
**top-level** def-family forms (an internal helper inside a `defn` body is not public API), and
drop whatever the analyzer's own privacy rule calls private (`defn-`, `^:private`,
`^{:private true}`). That yields **654 public vars**; the shipped constant is **723** — the 654
plus 69 deliberate extras (special forms, the uncurried interop statics a Clojure program writes
bare such as `Math/abs` and `String/join`, and the `clojure.string` / `clojure.test` spellings
`join`, `split`, `trim`, `lower-case`, `is`, `testing`). The gap the derivation closes was **286
names**.

The list stays a constant so the analyzer remains a function of ONE file; the derivation is the
evidence, re-runnable, and prints the gap.

### `isAnonArgShorthand` — the anonymous-argument shorthands (CLJ-D20)

`%`, `%1`…`%N`, `%&` are parameter references, never callees. This was `/^%(\d+|&)?$/` — the
lane's last regex and the only row `reviews/regex-policy.md` carried for clojure. It is a char
scan now, and `script/m14/tmp/clj-regex-equiv.ts` **proves** the equivalence: both forms over
every `sym_lit` name in three corpora (**633 files, 187,678 symbol nodes, 13,363 distinct
names**) plus a 42-case adversarial battery (`%%`, `%&x`, `%0`, `%00`, the Arabic-Indic digit
one, `% 1`, `%1a`, a twenty-digit `%…`) → **0 mismatches**.

**Regex usage: none.** The policy doc's clojure table and the debt register's clojure row were
removed with the literal, so neither can become a ghost.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `list_lit` head `sym_lit` → `name:`; `ns` name child; protocol/interface signatures and record fields from their own heads; anonymous fns `lambda_<row>_<col>` (local-only). **A qualified name is read from the head's `namespace:`/`name:` FIELDS, never by splitting its text** (CLJ-D28) |
| kind | ✅ | `ns` → Module; `defprotocol`/`definterface` → Interface; `defrecord`/`deftype` → Class; `defn`/`defn-`/`defmacro`/`defmulti`/`defmethod`/`s/defn`/`mu/defn` and protocol+record methods → Function; record fields → Property; `def`/`defonce`/`declare` → Variable; `s/def`/`s/fdef` → Interface (`isSpec`) |
| qualified/container name | ✅ | `scope` = namespace, or `<ns>.<type>` for protocol/record members |
| ownerName / ownerKind | ✅ | namespace for top-level forms; protocol/record type for members; `""` for anonymous locals |
| range | ✅ | `nodeToRange` from `startPosition`/`endPosition` |
| parameters | ✅ | `extractParams` — the FIRST direct `vec_lit` (single arity) or arity-clause vectors (multi arity); destructuring resolved the way the reader binds it (`&` never a name, vector nesting recurses, map destructuring contributes `:keys`/`:strs`/`:syms`/`:as`/`{local :key}`, `:or` defaults skipped). **Known model limit:** arity clauses are merged by name, so `(defn h ([] 1) ([x] x))` reports `["x"]` with no per-arity structure (W23-c, registered, 342 corpus sites — `UniversalSymbol.parameters` is flat family-wide, so this is a cross-lane decision) |
| returnType / type | ❌ (N/A) | Clojure is dynamically typed; parameters carry type `Any` |
| documentation | ✅ | the form's own docstring and the contiguous `;;` block directly above it (a single-`;` note, a blank-line-separated header and a trailing comment on the previous form's line are all excluded) |
| complexity | ✅ | cyclomatic per function from the full conditional/loop family (CLJ-D16), mirrored onto `symbol.complexity` for per-symbol exposure; `totalCyclomaticComplexity` in file metadata |
| syntax errors | ✅ | `rootNode.hasError` → warning `ParseError`, never silently dropped |
| decorators/attributes | ❌ (non-goal) | `meta_lit` is never walked as code (CLJ-D5). It is READ for two things: `^:private`/`^{:private true}` → visibility, on `def`/`defn` **and** on `defprotocol`/`defrecord`/`deftype` (CLJ-D27) |
| visibility | ✅ | `defn-` and `^:private` on vars, fns, macros, protocols, records and types; top-level public forms export. A `(declare …)` var is public but **not an export** — a forward declaration is not a definition (CLJ-D23) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence |
| --- | --- | --- | --- |
| calls | ✅ | a bare non-core head under an active function, a thread step, or a `#(…)` head. A core-shaped head is suppressed by `isCoreCallSuppressed(name, pos)` — the ONE gate (CLJ-D18): suppressed unless the FILE binds the name at that point (order-aware shadow ranges) or an ns clause `:refer`/`:only`/`:rename`s it. `recur` → self-call with `isRecursion` | 0.9 / 1.0 |
| extends | ✅ | `(proxy [Super Ifaces] …)` only — the one place Clojure names a superclass | 0.8 |
| implements | ✅ | `defrecord`/`deftype` protocol symbols after the fields vector; `reify`/`extend-type`/`extend-protocol`/`proxy`. Aliases resolve through `namespaceAliases` | 0.85 |
| instantiates | ✅ | `(->Class …)`, `(Class. …)`, `(new Class …)`, and `#Foo[…]`/`#foo.Rec{…}` — the capitalisation rule is a final-segment char-code test on the AST name, and every target resolves through aliases | 0.8 |
| uses | ✅ | Java interop `(.method obj)` / `(.-field obj)` with `isFieldAccess` — never calls. `..` is NOT a member name: it is a core MACRO, so it goes through the same gate as any other core head (clojure/core.clj defines it) | 0.7 |
| imports | ✅ | ns `:require`/`:use`/`:import`/`:require-macros` clauses **and** the top-level directive forms, with `[lib :as a]`, `[lib :refer [a b]]`, `[lib :only (a b)]` (list OR vector name list, CLJ-D21), `[lib :rename {old new}]` (CLJ-D25), bare `sym_lit` libs, prefix lists in both vec and paren form, `(:import (pkg Cls…))` lists, and `:as-alias` (alias registered, no dependency edge) | — |
| exports | ✅ | ns-level public Function/Variable/Class/Interface/Module symbols, deduped; forward declarations excluded | — |
| overrides | ❌ (N/A) | `defmethod` shares the multimethod's var identity, so source and target would be identical. The line-distinct impl symbols are emitted (the 3-site model pinned by `defmethod-forms`) | — |
| references | ✅ | lib targets → ns References (`isLibraryDep`); a qualified call's namespace is referenced too. A self-require and a self-qualified call are lexical no-ops and emit no self-loop | 0.9 / 0.8 |
| contains | ✅ | owner → owned symbol by `ownerName` post-loop, deduped; anonymous locals excluded | 1.0 |
| <language-specific> | ✅ | `recur` self-calls with `isRecursion`; `isPure` impurity tracking on `!`-suffixed callees, `set!`/`swap!`/`alter` and interop forms; `isHigherOrder`/`usesSTM` from the HOF/STM sets | — |

**No `dependencies` relationship is emitted** for Clojure: the `references` edges with
`isLibraryDep` ARE the dependency graph (a library is a namespace, and a namespace is a symbol).

## Supported constructs

- Namespace declaration with `require`/`use`/`import`/`require-macros` clauses, reader-conditional
  clauses, and prefix lists — `Service.clj`, `prefix-require`, `cljc-aliases`, `lib-rules`
- `defprotocol` / `definterface` with method signatures, **including members named like core
  functions** (`alength`, `identity`, `key`, `count`) — `proto-members`
- `defrecord` / `deftype` with fields, protocol implementation, docstring before the fields
  vector, and method bodies; `^:private` honoured — `proto-members`, `record-doc`
- Constructor idioms `(->ClojureService prefix)`, `(Date. …)`, `(new java.util.Date …)`,
  and Clojure 1.12 record/class literals `#Foo[…]`, `#pkg.Rec{…}` — `ctors`, `tagged-ctors`
- `defmulti` + `defmethod`, including the 1.12 docstring form — `defmethod-forms`
- `(declare a b)` — a Variable per name, with `isForwardDeclaration`, no export — `lib-rules`
- `letfn` local functions, with the shadow ranges that make their names shadow correctly
- Threading macros `-> ->> some-> some->> cond-> cond->> doto as->` with thread-adjusted arity
  and bare-symbol steps — `threading`
- A file with **two `(ns …)` forms**: alias table and refer table are both per-namespace, and the
  refer table is **positional**, so a call before the second `ns` resolves against the first
  clause and a call after it does not — `two-namespaces`
- `s/def` / `s/fdef`, with an auto-resolved `::kw` name qualified against the current namespace
  (`:my.ns/kw`) — `two-namespaces`
- Qualified library calls through an alias, including a name that itself contains a slash
  (`h2x//`) — `qualified-names`
- Interop member/field access → Uses, never calls — `Negative.clj`, `dotdot`
- Anonymous function shorthand `#(f a b)`, whose head is the anon node's first named child —
  `anon-fn-calls`, `anon-shorthand`
- Framework/pattern detection is AST-driven from require forms plus structural patterns
  (Protocol Polymorphism, Multimethods, Threading, HOF, STM, Lazy Evaluation, Java Interop,
  Metaprogramming)

## Unsupported / explicit-unknown constructs

- **`defmethod` override family** (documented non-goal): source and target share one var identity.
- **`^Type` / `^{:meta}` metadata** parses cleanly, is never walked as code, and never leaks into
  a name; it is read only for `:private`.
- **Multi-arity parameter structure**: arity clauses are merged by name (W23-c, registered).
- **`:refer :all`**: names a whole library, so there is no name list to read and no individual
  name to register; the import row carries `["*"]`, which is the honest whole-lib reading.
- **`:rename` inside a quoted top-level directive** is read by the same code path as the ns-clause
  form, but is not separately pinned.
- **`promote`/`demote` and other reader-level directives** are data.

## Complexity envelope

Single-pass iterative stack walk (no recursion) with explicit exit frames; `Map`/null-prototype
lookups for the core set, aliases, refers, shadow ranges and both dedupe sets. The core-suppression
gate's cost is one null-prototype lookup per head, and the order-aware shadow table is a linear
scan over one or two ranges per name in practice. Two whole-tree pre-passes exist (the
comment/core shadow scan and the refer-segment bookkeeping), both O(n) and both single-stack.

Measured on the corpora of the M60 deep round (see `reviews/clojure/deep-review-2026-09-28.md`
for the full-extent differential): metabase 4,253 files → 84,414 symbols, 579,714 relationships,
0 thrown exceptions, 0 timeouts, 1 file with ERROR nodes (3 literal NUL bytes in the source —
a corpus data artifact, disclosed).

## Differential ground truth and evidence

- Truth side: `script/m14/differential.ts` → `deriveClojureEdges`, mirroring CLJ-D1…D29
  rule for rule. It imports `CLOJURE_CORE_BUILTINS` and `isAnonArgShorthand` **by reference** so
  the core surface cannot drift between the two sides.
- **F5, four corpora at full extent** (not a 60-file draw), read with
  `script/m14/tmp/clj-full-f5.ts` — which imports this repo's own `deriveClojureEdges` and
  `normTarget` and re-implements the harness's comparison semantics, so the number is the
  same claim `differential.ts` makes over every file instead of 60. (The cross-check has
  already earned its place: it is what caught a harness defect — a `//` comment that had
  deleted the `calls` label for 17 lanes — which read as a 19.8% coverage red for this lane
  while the analyzer was correct. See `reviews/clojure/deep-review-2026-09-28.md`, CLJ-H1.)

  | corpus | files | tree-truth | covered | MISSING | analyzer edges | unexplained |
  |---|---|---|---|---|---|---|
  | `clojure/clojure` | 143 | 6,875 | 6,875 (100%) | 0 | 3,279 | 0 |
  | `clj-kondo` | 444 | 8,087 | 8,087 (100%) | 0 | 4,456 | 0 |
  | `core.async` | 46 | 2,108 | 2,108 (100%) | 0 | 1,047 | 0 |
  | `metabase/metabase` | 4,253 | 239,192 | 239,192 (100%) | 0 | 122,916 | 0 |

- **F1 at scale**: 35 distinct node types over metabase's 4,253 files, every one classified
  against the spec's handled/silent sets, **0 unclassified**, 0 placeholder names, 0 empty names.
- **The core-suppression claim, measured rather than asserted**
  (`script/m14/tmp/clj-gate-census.ts`): every emitted `calls` edge naming a real clojure.core
  var is classified independently as FILE-DECLARED / REGION-BOUND / REFERRED / **RESIDUAL**.
  Result on three corpora: **0 RESIDUAL** (`clojure` 2,941 + 6, `clj-kondo` 64 + 11,
  `core.async` 27 + 2).
- Ground truth: `validation/m12/ground-truth/clojure.json`; differential result
  `validation/m12/results/clojure-differential.json`; corpus sample
  `validation/m12/results/clojure-corpus-sample.txt`; complexity
  `validation/m12/results/clojure-complexity.json`.
- Fixtures: `validation/m14/fixtures/clojure/` (42); mutants: `script/m14/mutate-analyzer.ts`
  (63 clojure mutants, all CAUGHT).

## Regex inventory

**None.** `validation/m12/results/regex-census.json` carries no entry for
`real-clojure-analyzer.ts`, and `reviews/regex-policy.md` states **0** for the lane. The baseline
was 2 (`/\.$/` constructor tests), both eliminated in the M12.04 grammar rewrite; the third and
last, `/^%(\d+|&)?$/`, was removed in the M60 deep round with the equivalence proof above
(CLJ-D20). Every remaining string surgery in the file is a char scan or a `Set` lookup, and the
conversions carry their equivalence argument inline.
