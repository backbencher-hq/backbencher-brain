# real-elixir-analyzer.md

## Language

- Analyzer file: `src/ast/real-elixir-analyzer.ts`
- Parser: `tree-sitter-elixir` **v0.3.5** (pinned `wasm/tree-sitter-elixir.wasm`,
  sha256 `ed99093c…`; **swapped in** by the 2026-09-26 grammar-pin round — the
  incumbent 2024 prebuilt was byte-identical to tree-sitter-wasms@0.1.13's build and
  carried one legacy anonymous token, `^^`, under which `x = ^^y` parsed into an
  ERROR node while v0.3.5 parses it cleanly, and the two builds produce identical
  trees on 773/773 corpus files; the npm tarball's source is vendored in
  `grammars/tree-sitter-elixir/`. Registry: `validation/m14/grammar-pins.json`;
  round: `reviews/functional-family/m60-grammar-pins.md`. `source` →
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
| kind | ✅ | `defmodule` → `module`; `@callback`/`@macrocallback` → `method` inside a protocol/impl, `function` otherwise (EX-D21); `defprotocol` → `interface`; `defimpl` → `class` (named by for-type, `implements` edge to protocol); `defstruct` → `struct` + field `property`s; `def`/`defp`/`defdelegate` → `function` (or `method` when inside a protocol/impl scope); `defmacro`/`defmacrop`/`defguard`/`defguardp` → `macro`; `@type` → `type` |
| qualified/container name | ✅ | `ownerName` = the innermost enclosing DECLARATION (M14 ledger #867 ruling) for **every** nested symbol: functions, types, struct, fields, protocol/impl members — and, since EX-A10, nested `defmodule`/`defprotocol` themselves, which previously carried only `scope` (`contains MyApp -> MyApp.User` was emitted, the symbol field was not) |
| range (start/end line + column) | ✅ | the declaration node; for a MERGED multi-clause head the extent runs to the **last clause's end** (EX-D16 — the same rule real-clean-analyzer.ts applies to a multi-clause `f x = …`) and every clause's exact range is published as `metadata.clauseRanges`, because a span cannot be discontiguous: 195 of 2,321 merged groups in elixir@024beb1b carry other declarations between their first and last clause |
| parameters | ✅ (metadata only) | `def` signature `arguments` children; `name = default` collapses to the name |
| isDeclaration | ✅ | `@callback`/`@macrocallback` (EX-D21) and a BODILESS `def` head (the protocol callback) are declarations, not definitions; a clause with a body makes the merged symbol a definition and the flag is removed. Structurally: no `do_block` and no `do:` pair inside the def's `arguments`. **Published twice, on purpose (EX-D24):** the top-level field AND `metadata.isDeclaration` — the pool worker carries exactly that one metadata key across the process boundary, so the top-level field alone left `brain_symbol.is_declaration` NULL for every elixir declaration (0 rows on a real index) |
| callbackSpec | ✅ (metadata) | the `@callback name(args) :: type` text, merged into the sibling `def`'s symbol (one function, one symbol). The `::` operator is found by a depth-bounded search, because a `when` constraint wraps it |
| visibility | ✅ | `defp`/`defmacrop` → `private`, else `public` |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only: module → its types/struct/fields/functions/macros (`contains MyApp.User -> new`), protocol/class → their methods, parent module → nested module. The struct is a distinct symbol contained by its module (`contains MyApp.User -> MyApp.User`). Never `global contains X`. | 1.0 |
| implements | ✅ | `defimpl` → `implements forType -> protocol`; `@behaviour`/`@behavior` attribute → `implements module -> behaviour` | 0.9–1.0 |
| calls | ✅ | `call` nodes in body position with function sources. Alias-resolved qualified module calls (`Repo.get` with `alias MyApp.Repo` → `MyApp.Repo.get`); same-module calls stay leaf (`add_bid`); pipelines (`|>`) call the piped target. Resolution rules: qualified calls emit when the receiver is capitalized (a module/alias) — lowercase receivers are dynamic dispatch (`module.manifests()`) and emit nothing; unqualified calls emit ONLY when the target is declared in the enclosing module/class (checked post-walk against the full declaration set, so forward references resolve) — Kernel builtins (`length`, `is_*`, `function_exported?`) and imported functions are not local symbols and produce no edge. Exclusions: special forms (case/cond/quote/unquote/...), def signature heads, an attribute's own NAME and the declaration attributes (EX-D25 — a code-valued attribute is NOT excluded), member access (`order.side`), quoted code. Self-recursion IS emitted (Rust `calls find -> find` analog) | 1.0 |
| instantiates | ✅ | (a) `%Struct{...}` literals in body position (`instantiates new -> MyApp.User`) — never for `Map.put`-style module calls, never for pattern-position structs in a def head; plain `%{}` emits nothing. (b) `struct(User, attrs)` (ELXD19). (c) **`raise Mod` / `raise Mod, msg` / `reraise Mod, stack` (EX-D17)** — the same construction through `Kernel.raise`'s exception entry point, so it is an `instantiates` edge and never a call; 401 alias-named sites in 200 files of elixir@024beb1b carried no edge before the fix. A `__MODULE__` first argument resolves to the enclosing module; a bare `raise "msg"`, a bound exception, or a computed module name is **silent** (no static target to name). Self-construction (`raise __MODULE__` in the module's own body) is suppressed with the rest of the X class | 0.9 |
| references | ✅ | module dependencies only: `use`/`import`/`alias`/`require` → `references module -> dep` (the FP-family module-dep contract, Clojure ns → required libs). A multi-alias expands one dependency per member (`alias Foo.{Bar, Baz}`, ELXD20) and **EX-D26 (2026-09-29)** widened the member filter to `identifier` nodes, so lowercase FUNCTION aliases (`alias Helper.{make, name}`) publish `references -> Helper.make` / `-> Helper.name` and register the local name; a bare call through such an alias then resolves (`make()` → `calls -> Helper.make`). Measured 0 sites in 938 files of the six corpora — a latent hole, fixed because it is one predicate wide. Body identifiers emit NOTHING (the old 47-edge references flood is removed) | 0.9 |
| uses | ❌ | member access on structs (`user.id`) is a field read — no edge (fields already have `contains` ownership) | — |

## Noise-elimination contract (what produces NO edges)

- Module attributes (`@moduledoc`, `@doc`, `@spec`, `@type`, `@behaviour`,
  `@default_limit`, ...) — the attribute's inner call is the declaration.
  **EX-D25 (2026-09-29): the rule is about the attribute's NAME, not its
  VALUE.** A code-valued attribute is compile-time code and its `calls` /
  `instantiates` (including `raise`) emit like any other code — `@section
  %Spark.Dsl.Section{build: Spark.Dsl.build(:x)}` built a struct that named no
  dependency at all (21 attributes / 21 struct literals in a 250-file ash
  sample). Two carve-outs: the attribute's own call node stays silent (it is
  the name, and relaxing the value would otherwise publish `calls->section`),
  and the DECLARATION attributes — `doc`/`moduledoc` (text), `spec`/`type`/
  `typep`/`opaque`/`callback`/`macrocallback` (a typespec's `%Mod{}` is a TYPE
  REFERENCE, not a construction: 27 sites in a 60-file elixir sample, 30 in
  ecto), `behaviour`/`behavior`/`derive`/`optional_callbacks` (already published
  as `implements`), `deprecated` — keep the silence. Directives and member
  reads stay gated: a `use`/`alias` cannot legitimately appear in an attribute
  value.
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

- The export list is the module's importable units: Module/Interface symbols
  (whatever their nesting — a nested module is addressable from outside its
  file, which is why EX-A10's `ownerName` cannot demote it) plus ownerless
  Function/Struct symbols (`!s.ownerName`, the `.exs` script shape). An owned
  `defstruct` Struct symbol is never re-exported under its module's name — the
  pre-ELXD3 export pass (`ownerName === name`) produced two exports named
  `StructFields` for one module, which the F3 export-uniqueness invariant
  rejects.

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

## Verification state (2026-09-28, `reviews/elixir/deep-review-2026-09-28.md`)

| gate | result |
| --- | --- |
| F3 fixtures | **61/61 PASS** (EX-D25/EX-D26 add `attribute-value-code`) |
| F4 mutants | **87/87 CAUGHT** (a 15-mutant payload wave found **9 survivors** — holes in this lane's own suite — and all 9 are now pinned; +4 callback, +1 parenthesized operator, +1 store-seam) |
| **Store round trip** (new gate class) | **CLEAN** — a real Elixir app through the production `indexProjectParallel`, read back in SQL: 0 symbols lost, 0 orphan members, **0** relationships with an unresolved source, **31/31** relationship sources equal the analyzer's declared source, 0 zero-lines, docstrings + `scope_kind` + `is_declaration` persisted, the merged multi-clause extent intact (22..23), 0 id-key collisions. Tool: `script/m14/tmp/elixir-store-roundtrip.ts` |
| **Master Review** (2026-09-29, `reviews/elixir/master-review-2026-09-29.md`) | two claims on the same 360-file fixed sample: **CLAIM 1 (line contract, M60) CLEAN** — 0 line-less edges and every `contains` line exactly the member's declaration line, checked per label with no window; **CLAIM 2 (per-site identity) 2,290/2,290 = 100.00%** — every `use`/`import`/`alias`/`require`, `%Mod{}`, `raise`, `struct`, `@behaviour`, `@derive`, `defimpl` and `Mod.fun()` site produced the edge it names, with the declared silences counted (1,466 pattern-position structs, 57 declaration-attribute constructs, self-directives). Tool: `script/m14/tmp/elixir-master-audit.ts` |
| Id / placeholder / determinism audit | **0** id collisions on the store's own key (`name`+`line_start`) and **0** non-deterministic files across 23,818 symbols over 1,586 files (elixir 559/10,745, ash 560/6,529, phoenix 205/2,338, ecto 126/2,351, wallaby 136/855, ecto_sql 80/1,105); **21** placeholder symbols (19 elixir + 2 phoenix), all genuinely dynamic (`def unquote(name)`, `defmacro unquote(verb)(...)` and friends) — the one missed static name (`defmacro (..)`) is fixed |
| F5 differential | 6 corpora, 360 files, **10,005 oracle edges: coverage 100.0%, MISSING 0, unexplained 0** (was 9,974 before EX-D25/EX-D26; the 31 new edges are the attribute-value and lowercase-multi-alias sites, mirrored in the oracle so both sides read the same rule); the same-sample A/B is **161 MISSING before → 0 after** |
| M12 differential | re-emitted **69/69, precision 1.000, recall 1.000** |
| Deep audit (oracle-blind) | line contract, source attribution, contains integrity, symbol sanity, edge surface and complexity: **CLEAN** on the 60-file ecto_sql slice (3,852 edges) |
| **Declaration coverage** (per FORM, not per node type) | **every live form 100%** over 294 files (elixir+phoenix+ash) and 171 files (ecto_sql+ecto+wallaby) — `defmodule` 554/554, `def` 1689/1689, `defp` 1728/1728, `@callback` 83/83, `@optional_callbacks` 5/5, `type` 235/235, `use` 318/318, `alias` 121/121, `raise` 255/255, … and two forms with no live site in the sample are reported as such, never as OK |
| Spec census | 697 files over 6 corpora: **116 distinct node types, 0 parse-error files, ZERO named types unclassified** |
| Perf | ms/def **flat** 2.22–4.25 from N=1,000 to N=4,000 on two synthetic ladders — no O(n²) term |

The six corpora are elixir@024beb1b, phoenix@0e02edbe, ecto@94d69279,
ecto_sql@44f561b8, ash@e3f9c80a and wallaby@13e1394d, run through
`script/m14/tmp/elixir-lane-diff.ts` — a fixed-sample, per-file, error-visible
re-run of this lane's F5 comparison, because the shared harness silently
converts an analyzer exception into a coverage collapse (R4 in the review) and
draws a different sample per run unless its pool is frozen. The declaration
census is `script/m14/tmp/elixir-declaration-census.ts`, and it is the instrument
that found the last real gap: classifying node types is the wrong granularity,
because a node type can be "handled" while the declaration it carries publishes
nothing.

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

Supported: modules (nested, and OWNED by the parent since EX-A10), parenthesized
operator definitions (`defmacro (..)`, EX-A15 — the operator token is a name), functions
(def/defp/defdelegate preserving local
names independently of remote `as:` targets, multi-clause heads merged with the
whole-function extent and per-clause ranges), macros (defmacro/defmacrop/defguard/
defguardp), protocols (defprotocol), protocol impls (defimpl), structs
(defstruct, bare and list forms), type aliases (@type/@typep/@opaque),
behaviours (@behaviour), directives (use/import/alias/require, `as:` aliases),
pipelines, struct literal instantiation, exception construction
(`raise`/`reraise`, EX-D17), OTP pattern detection
(GenServer/Supervisor/Task/Agent metadata — `use GenServer` is a `references`
edge plus `otpBehavior`, NOT an `implements` edge: the injected `@behaviour` is
a macro expansion, EX-D8; registered, with the reasoning, in
`reviews/elixir/deep-review-2026-09-28.md` R3).

Not modeled (deliberately): quoted-code contents (macro AST is data), anonymous
function internals (closure boundary), member access on structs (no edge),
Kernel builtin call sites.
