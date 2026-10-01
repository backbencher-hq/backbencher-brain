# real-elixir-analyzer.md

## Language

- Analyzer file: `src/ast/real-elixir-analyzer.ts`
- Parser: `tree-sitter-elixir` (pinned `wasm/tree-sitter-elixir.wasm`; npm
  tree-sitter-elixir 0.3.5 downloaded and verified behaviorally identical on
  the corpus via the production `parseFile` path — 0 vs 0 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; `source` →
  `call` (identifier target) tree: `defmodule`/`def`/`defp`/`defmacro`/
  `defprotocol`/`defimpl`/`defstruct`/`use`/`import`/`alias`/`require` are all
  calls whose first child is the keyword identifier; module attributes are
  `unary_operator` (`@` + call); struct literals are `map` nodes with a
  `struct` child; pipelines are `binary_operator` (`|>`); function bodies are
  `do_block` or single-line `do:` keyword pairs)
- Language detection: `.ex` → `elixir` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealElixirAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (quote strip, paren strip, keyword-colon strip —
  pure char scans, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `defmodule` → module name from the `arguments` `alias` (nested modules qualified: `MyApp.User`); `def`/`defp`/`defdelegate` → the signature `call`'s identifier (`defdelegate` preserves the local declaration — `defdelegate rstrip(b), to: M, as: :trim_trailing` → `rstrip`; `as:` names the remote target, not the declaration); `defmacro`/`defmacrop`/`defguard`/`defguardp` → macro; `defstruct` → struct named by the enclosing module; struct fields → `atom` elements of the bare list (`[:id, :name]`, colon-stripped) and `pair > keyword` for the keyword form; `@type`/`@typep`/`@opaque` → the `::` left-side identifier; `defprotocol` → protocol name; `defimpl` → class named by the `for:` target type |
| kind | ✅ | `defmodule` → `module`; `defprotocol` → `interface`; `defimpl` → `class` (named by for-type, `implements` edge to protocol); `defstruct` → `struct` + field `property`s; `def`/`defp`/`defdelegate` → `function` (or `method` when inside a protocol/impl scope); `defmacro`/`defmacrop`/`defguard`/`defguardp` → `macro`; `@type` → `type` |
| qualified/container name | ✅ | `ownerName` = enclosing module (functions, types, struct, fields); protocol/impl members owned by their protocol/class; nested modules owned by the parent (`contains MyApp -> MyApp.User`) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | `def` signature `arguments` children; `name = default` collapses to the name |
| visibility | ✅ | `defp`/`defmacrop` → `private`, else `public` |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only: module → its types/struct/fields/functions/macros (`contains MyApp.User -> new`), protocol/class → their methods, parent module → nested module. The struct is a distinct symbol contained by its module (`contains MyApp.User -> MyApp.User`). Never `global contains X`. | 1.0 |
| implements | ✅ | `defimpl` → `implements forType -> protocol`; `@behaviour`/`@behavior` attribute → `implements module -> behaviour` | 0.9–1.0 |
| calls | ✅ | `call` nodes in body position with function sources. Alias-resolved qualified module calls (`Repo.get` with `alias MyApp.Repo` → `MyApp.Repo.get`); same-module calls stay leaf (`add_bid`); pipelines (`|>`) call the piped target. Resolution rules: qualified calls emit when the receiver is capitalized (a module/alias) — lowercase receivers are dynamic dispatch (`module.manifests()`) and emit nothing; unqualified calls emit ONLY when the target is declared in the enclosing module/class (checked post-walk against the full declaration set, so forward references resolve) — Kernel builtins (`length`, `is_*`, `function_exported?`) and imported functions are not local symbols and produce no edge. Exclusions: special forms (case/cond/quote/unquote/...), def signature heads, module attributes, member access (`order.side`), quoted code. Self-recursion IS emitted (Rust `calls find -> find` analog) | 1.0 |
| instantiates | ✅ | `%Struct{...}` literals in body position only (`instantiates new -> MyApp.User`). Never for `Map.put`-style module calls; never for pattern-position structs in def heads; `%{}` plain maps and `%__MODULE__{}` emit nothing | 0.9 |
| references | ✅ | module dependencies only: `use`/`import`/`alias`/`require` → `references module -> dep` (the FP-family module-dep contract, Clojure ns → required libs). Body identifiers emit NOTHING (the old 47-edge references flood is removed) | 0.9 |
| uses | ❌ | member access on structs (`user.id`) is a field read — no edge (fields already have `contains` ownership) | — |

## Noise-elimination contract (what produces NO edges)

- Module attributes (`@moduledoc`, `@doc`, `@spec`, `@type`, `@behaviour`,
  `@default_limit`, ...) — the attribute's inner call is the declaration.
- Def signature heads (`def new(...)`, `def serialize(...)`) — never
  self-calls. Distinguishes `, do:` bodies (real calls) from heads via the
  `pair`-boundary check.
- Member access (`order.side`, `book.bids`) — `dot` target with no `arguments`
  is a field read, not an invocation.
- Kernel builtins (`length`, `is_list`, `elem`, `hd`, ...) and special forms
  (`case`, `cond`, `quote`, `unquote`, `super`, ...) — FP-family precedent
  (Clojure core builtins excluded).
- Quoted code (`quote do ... end`) is data, not executable module code: no
  symbols, no calls, no directives — the Clojure quoted-data rule.
- Anonymous functions (`fn x -> x + 1`) and captures — pattern marking only,
  never synthetic lambda symbols (M11.11 closure boundary).
- Params/locals never become symbols.

## Export contract

- The export list is the module's importable units: ownerless Module/Function/
  Interface/Struct symbols only (`!s.ownerName`). An owned `defstruct` Struct
  symbol is never re-exported under its module's name — the pre-ELXD3 export
  pass (`ownerName === name`) produced two exports named `StructFields` for one
  module, which the F3 export-uniqueness invariant rejects.

## Complexity model (live, verified against emitted shapes)

Cyclomatic complexity counts decision points from the pinned grammar's actual
emitted node types:

- `if`/`unless`/`case`/`cond`/`receive`/`with`/`for`/`def`/`defp`/`defmacro`/
  `defmacrop` — call nodes whose identifier matches (verified live).
- `and`/`or`/`&&`/`||` — binary operators.
- Each case/cond/if/with clause — `stab_clause` directly under a `do_block`
  (fn-clause stab_clauses under `anonymous_function` are not counted).
- `rescue_block`/`catch_block`/`after_block`/`else_block` — try/rescue/catch/
  after/else decision branches (`try` itself is NOT a call in this grammar).

The dead baseline entries (`try`, `rescue`, `catch`, `after`, `do_block`,
`function_clause`, `case_clause`/`cond_clause`/`receive_clause`/`try_clause`)
were removed — those node types are never emitted.

## Regex census

Baseline at M12.01: **4 usages**. After M12.23 (pure-AST rewrite): **0
usages** — all four eliminated with pure char scans:

| Line | Old regex | Replacement |
| --- | --- | --- |
| 130 | `/['"]/g` (attribute quote strip) | `stripQuotes` char scan |
| 244 | `/[()]/g` (extractName paren strip) | `stripParens` char scan |
| 331 | `/:.*$/` (struct-field keyword strip) | `stripAfterColon` indexOf slice |
| 492 | `/".*"/` (directive quote strip) | directive uses edge removed entirely (references contract) |

Census total 86 → **82**. The census gate passes (0 missing, 0 stale, 0
unclassified).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/elixir-complexity.json`):

- Fixtures: 2 files, 32 symbols, 38 relationships, ~188 ms
- Corpus subset: 243 files (elixir@024beb1b — the Elixir language itself),
  7,597 symbols, 25,125 relationships, ~6.1 s
- All loops single-pass over per-file structures. Owner lookups (GenServer/
  Supervisor marking) use an O(1) `symbolByName` map — no per-def O(n) scans.

## Corpus validation

`validation/m12/results/elixir-differential.json` (via
`script/m12/verify-analyzer.ts elixir`):

- Fixtures: `Service.ex` (positive) + `Negative.ex` (negative)
- **70/70 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
- Corpus error scan (`script/m12/elixir-corpus-errors.ts`): all 243 .ex files
  ≥ 1KB — **0 grammar errors, 0 crashes, 0 timeouts**
- Shape-safety (`script/m12/elixir-node-types-compare.ts`): 16/18 analyzer
  node-type refs live against the pinned grammar's emitted types; the 2
  remaining (`ERROR`, `MISSING`) are the tree-sitter error-path checks that
  only fire when syntax errors occur (0 on this corpus, essential defensively).

## Supported / unsupported constructs

Supported: modules (nested), functions (def/defp/defdelegate preserving local
names independently of remote `as:` targets, multi-clause heads merged), macros (defmacro/defmacrop/defguard/
defguardp), protocols (defprotocol), protocol impls (defimpl), structs
(defstruct, bare and list forms), type aliases (@type/@typep/@opaque),
behaviours (@behaviour), directives (use/import/alias/require, `as:` aliases),
pipelines, struct literal instantiation, OTP pattern detection
(GenServer/Supervisor/Task/Agent metadata).

Not modeled (deliberately): quoted-code contents (macro AST is data), anonymous
function internals (closure boundary), member access on structs (no edge),
Kernel builtin call sites.
