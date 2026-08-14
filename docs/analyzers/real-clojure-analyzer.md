# real-clojure-analyzer.md

## Language

- Analyzer file: `src/ast/real-clojure-analyzer.ts`
- Parser: `@yogthos/tree-sitter-clojure` 0.0.14 (WASM, via project pipeline `engine.ts resolveWasm`; `wasm/tree-sitter-clojure.wasm` + `~/.bb/wasm` cache)
- Language detection: extension `.clj` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealClojureAnalyzer`

**Grammar provenance (M12.04 upgrade):** the previously wired `tree-sitter-clojure` 0.4.0 failed on 128/141 corpus files because it could not parse `^Type` type hints and `^{:meta}` metadata maps — pervasive in the Clojure compiler's own source. Upgraded to `@yogthos/tree-sitter-clojure` 0.0.14 (built WASM swapped in `wasm/` and the cache), which parses **all 141 files with zero errors**. The new grammar has a completely different, field-rich AST vocabulary: every parenthesized form is `list_lit` with `value:` children; a symbol is `sym_lit` carrying structured `name:` (`sym_name`) and optional `namespace:` (`sym_ns`) fields; metadata is `meta_lit`; vectors/maps/keywords are `vec_lit`/`map_lit`/`kwd_lit`; `#(...)` shorthand is `anon_fn_lit`. There are **no interop or qualified_symbol nodes** — dotted names (`com.example.foo`) and constructor idioms (`Date.`, `->ClojureService`) are single `sym_lit` nodes. The analyzer was rewritten against this vocabulary (pure AST access, zero regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) | 
| --- | --- | --- |
| name | ✅ | `list_lit` head `sym_lit` → `name:` field; `ns` name child; protocol/record members from their `sym_lit`/`list_lit` heads; anonymous fns `lambda_<row>_<col>` (local-only) | 
| kind | ✅ | `ns` → Module; `defprotocol` → Interface (`isProtocol`); `defrecord`/`deftype` → Class (`isRecord`/`isType`); `defn`/`defn-`/`defmacro`/`defmulti`/`defmethod`/protocol+record methods → Function; record fields → Property; `def`/`defonce` → Variable; `s/def`/`s/fdef` → Interface (`isSpec`) | 
| qualified/container name | ✅ | `scope` = namespace (or `<ns>.<type>` for protocol/record members) | 
| ownerName / ownerKind | ✅ | enclosing namespace for top-level forms; protocol/record type for members; `""` for anonymous locals (never namespace-owned) | 
| range (start/end line + column) | ✅ | `nodeToRange` from `startPosition`/`endPosition` | 
| parameters | ✅ | `extractParams` collects `sym_lit` names from every parameter vector — direct `vec_lit` (single-arity) and arity-clause `list_lit`→`vec_lit` (multi-arity); deduped, typed `Any` | 
| returnType / type | ❌ (N/A) | Clojure is dynamically typed; no return-type extraction (parameters carry type `Any`) | 
| documentation/comments | ✅ | `comment` forms and `;;` comments are skipped by the walk (never become symbols/relationships); docstrings are not surfaced as symbol docs | 
| complexity metrics | ✅ | cyclomatic complexity per function from `COMPLEXITY_BUILTINS` (`if`/`cond`/`when`/`case`/`for`/`loop`/`when-let`/`if-let`) counted in `metadata.complexity`; `totalCyclomaticComplexity` in file metadata | 
| syntax errors | ✅ | `rootNode.hasError` → warning `ParseError` (never silently dropped) | 
| decorators/attributes | ✅ | `^Type`/`^{:meta}` metadata (`meta_lit`) is skipped by the walk — not surfaced as symbol decorators (documented non-goal) | 
| modifiers/visibility | ✅ | `defn-` → private; top-level public forms → `public` (ns-level export list) | 

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model | 
| --- | --- | --- | --- |
| calls | ✅ | non-builtin `sym_lit` form heads under an active function → Calls; qualified (`str/join`) resolved through `namespaceAliases` to the real lib (`clojure.string/join`); builtin/special forms never produce Calls (see Negative fixture); `recur`/self-call → self Calls with `isRecursion` | 0.9 / 1.0 (recursion) | 
| extends | ❌ (N/A) | Clojure has no class inheritance (records implement protocols, not extend classes) | — | 
| implements | ✅ | `defrecord`/`deftype` protocol symbols after the fields vector → Implements (`ClojureService` → `Formatter`) | 0.85 | 
| instantiates | ✅ | `(->ClassName ...)` (PascalCase after `->`, pure char-code check — no regex) and `(ClassName.)` constructor idioms → Instantiates (`create-service` → `ClojureService`, `Date.` → `Date`) | 0.8 | 
| uses | ✅ | Java interop `(.method obj)` / `(.-field obj)` → Uses with `isFieldAccess` (`interop-access` → `toString`, `length`) — never Calls | 0.7 | 
| imports | ✅ | `ns` `:require`/`:use`/`:import` clauses → ImportInfo: `[lib :as alias]`, `[lib :refer [a b]]`, bare `sym_lit` libs, and `(:import (pkg Class...))` lists; aliases tracked in `namespaceAliases` | — | 
| exports | ✅ | ns-level public Function/Variable/Class/Interface/Module symbols → ExportInfo (deduped) | — | 
| overrides | ❌ (N/A) | `defmethod` shares the multimethod's var identity (Clojure semantics: it adds a dispatch method to the `defmulti` var, it does not create a new var), so the Overrides family is inapplicable intra-namespace — source and target would be identical. Line-distinct impl symbols are emitted; documented non-goal | — | 
| references | ✅ | `:require`/`:use`/`:import` lib targets → ns → lib References (`isLibraryDep`); qualified-call namespaces also referenced (`uses-lib` → `clojure.string`, `clojure.set`, `io.other`) | 0.9 / 0.8 | 
| contains | ✅ | owner → owned symbols via `ownerName` post-loop (deduped); namespace contains top-level forms, protocol/record contain members; anonymous locals excluded | 1.0 | 
| depends | ✅ | lib requires/imports → ns References (library dependency edges) | 0.9 | 
| field_access | ✅ | interop field access `(.-field obj)` → Uses with `isFieldAccess` metadata (covered under uses) | 0.7 | 
| <language-specific> | ✅ | `recur` self-Calls; `isPure` impurity tracking on `!`-suffixed and `def`/`set!`/`swap!` builtins | 1.0 | 

## Supported constructs

- Namespace declaration with require/use/import clauses: `(ns com.example.clojure.service (:require [clojure.string :as str] [clojure.set :as set] [io.other :refer [foo bar]]) (:import (java.util Date)))` → Module symbol, aliases, import items, lib References — `Service.clj`
- `defprotocol` interfaces with method signatures: `Formatter` + `format-value` (method symbol owned by the protocol) — `Service.clj`
- `defrecord` with fields, protocol implementation, and body methods: `ClojureService [prefix]` + `Formatter` + `(format-value [_ value] ...)` → Class + Property + Implements + method — `Service.clj`
- Constructor idioms `(->ClojureService prefix)` → Instantiates — `Service.clj`
- `defmulti` + `defmethod` multimethods with per-dispatch impl symbols (`area :circle`, `area :square`) — `Service.clj`
- `defmacro` (Metaprogramming pattern) — `Service.clj`
- `def` / `defonce` variables (`constant-value`, `singleton`) — `Service.clj`
- Multi-arity `defn` (`([a] a) ([a b] (+ a b))`) — all arity params captured — `Service.clj`
- Qualified library calls `(str/join "," x)`, `(set/union #{1} #{2})` → Calls resolved to full lib paths — `Service.clj`
- Builtin calls produce **no** Calls edges (`map`/`filter`/`str`/`inc`/`pos?`) — `Negative.clj`
- Quoted symbols are data, not references — `'foo` produces no References edge — `Negative.clj`
- Interop member/field access `(.toString obj)` / `(.-length obj)` → Uses, never Calls — `Negative.clj`
- Anonymous function shorthand `#(* % %)` → local `lambda_<row>_<col>` symbol (no global symbol, no namespace contains) — `Negative.clj`
- Framework/pattern detection is **AST-driven** from require forms (`REQUIRED_LIB_PATTERNS`: Ring/Compojure/Reagent/Re-frame/Datomic/clojure.test/core.async) plus structural patterns (Protocol-based Polymorphism, Multimethods, Threading Macros, Higher-Order Functions, STM, Lazy Evaluation, Java Interoperability, Metaprogramming)

## Unsupported / explicit-unknown constructs

- **`defmethod` override family** (documented non-goal): a `defmethod` shares the `defmulti` var identity in Clojure semantics, so no Overrides edge is emitted (source == target would be degenerate). The dispatch impls are still extracted as line-distinct Function symbols (`isMethodImpl`).
- **`^Type` hints / `^{:meta}` metadata** are parsed cleanly by the upgraded grammar but not surfaced as symbol decorators (non-goal); they also never leak into names.
- **Docstrings** (`(defn f "doc" ...)`) are not surfaced as symbol documentation (non-goal; comments are skipped so they never pollute relationships).
- **`ns` aliasing of dotted names**: `sym_lit` `name:` field holds the full dotted text for plain symbols, so 4-part namespaces (`com.example.clojure.service`) and dotted libs reconstruct correctly — no interop-splitting (the old 0.4.0 grammar's core defect, now gone).
- **Regex usage: none.** The analyzer is fully regex-free — the census gate confirms zero entries for `clojure`.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

Baseline at M12.01: **2 usages** (both `/\.$/` constructor-call checks). After the M12.04 rewrite against the `@yogthos` grammar AST: **0 usages** — the Clojure analyzer is fully regex-free. The final `^[A-Z]` PascalCase threading check was replaced with a pure char-code range test. The census gate confirms `clojure entries: NONE`.

Eliminated (all): constructor-dot regex (`/\.$/`) → `sym_lit` `name:` field ends-with check on structured fields; PascalCase regex (`/^[A-Z]/`) → `charCodeAt` range check; `^:` keyword fallbacks → `kwd_lit` `name:` field.

Rule: **zero unclassified regex** — trivially satisfied (no regex remains).

## Complexity envelope

From `validation/m12/results/clojure-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 21 | 29 | 141.9 | 148 | 204 | 175.0 MB |
| corpus (clojure @ 2cea6925, full 141 tracked `.clj`) | 141 | 4,450 | 8,708 | 2,047.7 | 2,173 | 4,253 | 444.1 MB |

Declared budget: fixture wall < 500 ms; corpus (141 files) < 20 s, symbols/s ≥ 1,000, relationships/s ≥ 3,000. **Met.** (Old grammar baseline on the same corpus: 2,955 symbols / 5,378 rels in 15.3 s — the upgrade roughly doubled extraction density and cut wall time ~7×.)

Hot-path audit: single-pass iterative stack walk (no recursion) with explicit exit frames; `Map`-based lookups (`CLOJURE_CORE_BUILTINS`, `namespaceAliases`, `seenContains`, `seenExports`); per-form dispatch is O(1) on the `list_lit` head. No O(n²) or per-symbol O(n) scans in the hot paths; the post-loop contains pass is one linear scan with a Set dedupe.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/clojure.json` (authority: `manual_audit` of fixture semantics — namespace/require/import contracts, protocol/record structure, multimethod dispatch, multi-arity, interop)
- Result: `validation/m12/results/clojure-differential.json`
- **Precision 1.000 / Recall 1.000** over **48 facts**: TP 48, FP 0, FN 0, unknown 0, unsupported 0
  - Two fixtures: `Service.clj` (positive — 15 symbols / 22 relationships) and `Negative.clj` (negative — 6 symbols / 7 relationships; builtins produce no calls, quoted symbols no references, interop is Uses, anonymous fns are locals)
  - M11 frozen truth preserved: `Formatter` interface, `ClojureService` class, `prefix` property, `create-service` function all re-verified at 1.000/1.000 (71/71 via `validation/m11/probe-jvm.ts`)
- Facts are compared **as emitted** — the harness performs no post-processing (see `script/m12/verify-analyzer.ts` honesty note)
- Cross-language fix landed in this milestone: the blanket hyphen block in `filterNoiseRelationships` (pool-worker) was removed — hyphens are valid identifiers in Clojure/Lisp-family and shell languages (`create-service`, `multi-arity`, `format-value`), and CSS leakage was already handled by the language-specific branch. Without it, legitimate Clojure contains/calls edges were silently dropped.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `clojure@2cea69253b9ed27436e93632b9a27c2f99088a49` (clean, pinned revision; full tracked corpus via `git ls-files`)
- Measured: **141 tracked `*.clj` files** (deterministic, full corpus) — `validation/m12/results/clojure-corpus-sample.txt`
- **141 files, 4,450 symbols, 8,708 relationships, 0 thrown exceptions, 0 timeouts, 0 grammar errors** — the grammar upgrade (`@yogthos` 0.0.14) parses the compiler's `^Type` hints and `^{:meta}` metadata maps that the old 0.4.0 grammar failed on (128/141 errored); verified by explicit error-counting re-parse, not just the measure tool

## Evidence pointers

- Fixtures: `validation/m12/fixtures/clojure/` (Service.clj, Negative.clj)
- Ground truth: `validation/m12/ground-truth/clojure.json`
- Differential: `validation/m12/results/clojure-differential.json`
- Complexity: `validation/m12/results/clojure-complexity.json`
- Corpus sample list: `validation/m12/results/clojure-corpus-sample.txt`
- Docs: this file

## Issue

Closes M12.04 (GitHub issue #143).
