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
| contains | ✅ | real ownership only: module → its types/struct/fields/functions/macros (`contains MyApp.User -> new`), protocol/class → their methods, parent module → nested module. The struct is a distinct symbol contained by its module (`contains MyApp.User -> MyApp.User`). Never `global contains X`. **ELIXIR_FIX2-P6 (2026-10-05):** a symbol declared inside a `defmodule` whose name is a VARIABLE or a computed expression has NO owner, so no edge is published — measured 10 declarations in 5 files that were previously attributed to the enclosing module | 1.0 |
| implements | ✅ | `defimpl` → `implements forType -> protocol`; `@behaviour`/`@behavior` attribute → `implements module -> behaviour` | 0.9–1.0 |
| calls | ✅ | `call` nodes in body position with function sources. Alias-resolved qualified module calls (`Repo.get` with `alias MyApp.Repo` → `MyApp.Repo.get`); same-module calls stay leaf (`add_bid`); pipelines (`|>`) call the piped target. Resolution rules: qualified calls emit when the receiver is capitalized (a module/alias) — lowercase receivers are dynamic dispatch (`module.manifests()`) and emit nothing; unqualified calls emit ONLY when the target is declared in the enclosing module/class (checked post-walk against the full declaration set, so forward references resolve) — Kernel builtins (`length`, `is_*`, `function_exported?`) and imported functions are not local symbols and produce no edge. Exclusions: special forms (case/cond/quote/unquote/...), def signature heads, an attribute's own NAME and the declaration attributes (EX-D25 — a code-valued attribute is NOT excluded), member access (`order.side`), quoted code. Self-recursion IS emitted (Rust `calls find -> find` analog) | 1.0 |
| instantiates | ✅ | (a) `%Struct{...}` literals in body position (`instantiates new -> MyApp.User`) — never for `Map.put`-style module calls, never for pattern-position structs in a def head; plain `%{}` emits nothing. (b) `struct(User, attrs)` (ELXD19). (c) **`raise Mod` / `raise Mod, msg` / `reraise Mod, stack` (EX-D17)** — the same construction through `Kernel.raise`'s exception entry point, so it is an `instantiates` edge and never a call; 401 alias-named sites in 200 files of elixir@024beb1b carried no edge before the fix. A `__MODULE__` first argument resolves to the enclosing module; a bare `raise "msg"`, a bound exception, or a computed module name is **silent** (no static target to name). Self-construction (`raise __MODULE__` in the module's own body) is suppressed with the rest of the X class | 0.9 |
| imports | ✅ | **EX-EX7, promoted from `analyzer/ELIXIR4` (2026-10-10)** `import Mod` brings Mod's FUNCTIONS and MACROS into the enclosing scope unprefixed — an import statement in the sense the erlang lane established for `-import(Mod, [f/a])` (ER-D41), and the relationship `dependencies.ts` reads. Published BESIDE the module-dep `references` row, never instead of it: `framework-forms` and `import-only-forms` pin `references PlugUsage -> Plug.Conn` / `references OnlyUser -> Enum` on PASSING rows, and the module view reads that edge (§14). One edge per dependency at the dependency's own name-bearing line; a group form (`import Module.Types.{Helpers, Descr}`) expands per member (ELXD20/M60-924); a self-directive publishes neither edge (ELXD8). Class `import_based` (the tier name for a module-dependency directive). Measured (559-file corpus, production path): **278 edges in 150 files**, sources resolving in-file 255/278, targets external 249/278 by design (another file's module), 278/278 labelled, no fabricated endpoint | 1.0 |
| references | ✅ | module dependencies only: `use`/`import`/`alias`/`require` → `references module -> dep` (the FP-family module-dep contract, Clojure ns → required libs). A multi-alias expands one dependency per member (`alias Foo.{Bar, Baz}`, ELXD20) and **EX-D26 (2026-09-29)** widened the member filter to `identifier` nodes, so lowercase FUNCTION aliases (`alias Helper.{make, name}`) publish `references -> Helper.make` / `-> Helper.name` and register the local name; a bare call through such an alias then resolves (`make()` → `calls -> Helper.make`). Measured 0 sites in 938 files of the six corpora — a latent hole, fixed because it is one predicate wide. Body identifiers emit NOTHING (the old 47-edge references flood is removed) | 0.9 |
| uses | ✅ | **EX-EX3 × ELIXIR_FIX2-U1, reconciled (2026-10-07) — see §12** a MEMBER FIELD READ: a `call` whose target is a `dot`, with **no** `arguments` child, whose receiver is a lowercase variable or a `%`-literal (`%OntoUser{}.name`). Uppercase receiver = a module, so the same node shape is a remote reference and stays `calls` (Go's rule verbatim: "selectors that are the callee of a call_expression are skipped — the calls edge handles them"). Excluded with reasons: quoted block, def signature head, DECLARATION attribute value, `->` pattern position (ER-D7: a head pattern emits nothing). Two labels, deliberately countable apart: **`struct_field_read` at 0.9** when the file declares the field (gated on the declared-struct-field vocabulary, map-bound receivers dropped), **`usage_contextual` at 0.7** when the file declares no struct field at all, so there is nothing to verify against. A second producer of `uses` exists — the `use` directive, the language's mixin application, `isMixin: true` / `via: "use"` / `structural` at 0.9, one edge per dependency (§13). The pre-reconciliation FIX2 measurement (2,117 edges / 180 files, 96.43% of 2,244 construct sites, all at 0.7) is kept in §4 as the record of what that rule published; §12 has the current numbers and the collision they answer | 0.9 / 0.7 |
| exports | ✅ | **ELIXIR_FIX2-X2 (2026-10-05)** what the module PUBLISHES. Elixir has no `export` keyword — the language draws the surface with the DEFINITION FORM: `def`/`defmacro`/`defguard`/`defdelegate`/`@type`/`@opaque`/`@callback`/`defstruct`/a nested `defmodule` are reachable from outside the file; `defp`/`defmacrop`/`defguardp`/`@typep` are not. Measured 5,076 edges / 420 files (whole 601-file corpus, after ELIXIR_FIX2-P6 removed 6 edges that named an un-nameable module's members). The private half is the falsifier: 7,918 `defp`-family + 41 `@typep` corpus sites that an "is it a function" rule would publish. NOT published: a struct `Property` (membership rides `contains`, the exports-family ruling), an ownerless symbol (no owner to publish from), `owner === name` (the EX-L3 self-loop). `res.exports` (the ExportInfo LIST) is a different channel and is unchanged | 1.0 |
| overrides | ✅ | **EX-EX5 + EX-EX14 (2026-10-10): two producers, both promoted from the refused waves.** (a) `@impl` — Elixir's `@Override`: `@impl SomeProtocol` names the contract outright, an enclosing `defimpl Proto` names it, else exactly ONE `@behaviour`/`@behavior` target on the enclosing module, else (several targets) the `@callback` this module declares for exactly one of them; anything else stays SILENT (`@impl false`/`nil` explicitly denies). (b) `defoverridable` — the module marks `f/n` (`defoverridable f: 1`, or `[f: 1]`) and a LATER definition of the same `f/n` in the same module replaces it: the bash lane's BD8b shape, both endpoints naming the same identity with `overridesLine` (the prior declaration, 1-based), `markedLine` (the mark) and `redefinition: true`; a mark with nothing before it is an extension point, not an override, so it publishes nothing. NOT published, with the measurement: `use N` in another file + any `def f` (a FABRICATION — most defs in a `use N` module are new, 510 `use` sites / 325 files; the same-file `use N` + `defoverridable N` shape measures 0 sites in 601 files, kept in §5). Measured (559-file corpus, production path): **154 edges in 22 files**, 154/154 sources resolved, 25/154 targets resolved in-file and 129 external (the contract lives in the behaviour's file), 154/154 labelled, no fabricated endpoint. The pre-fold doc cell read "⚠ GAP-in-the-language, DOES NOT FIRE" — that claim is retired here, and the doc-truth gate caught the staleness when the producers landed | 1.0 |

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

---
# ELIXIR_FIX2 — the relationship-type ontology, with the measurement behind each verdict

Branch `analyzer/ELIXIR_FIX2`, 2026-10-05. Every number below was produced at
commit `590023910` on the **derived whole population**: 601 `.ex`/`.exs` files
under `fixtures/repositories/{elixir,otp}` (568 in `elixir`, 42 in `otp`, 9 of
them under `_build/`/`deps/` fixture trees that the walk excludes, and 0 files
under 8 bytes), produced by `readdir` — never a hand-written list, because the
honesty contract's rule is that a count without its denominator is a claim.

Instruments, all lane-owned, all recording the analyzer commit and the analyzer's
sha256 so a stale artifact cannot read as current:

| instrument | what it answers |
| --- | --- |
| `validation/m14/elixir/elixir-firing-census.ts` | which types FIRE through production `parseFile`, plus questions 4/5/6/7 as field tallies |
| `validation/m14/elixir/elixir-construct-census.ts` | does the LANGUAGE have the construct — instrument A (grammar inventory) and instrument B (parse-tree counts) |
| `validation/m14/elixir/elixir-emit-gap.ts` | for a construct the analyzer reads: how much of it is published, and every unpublished site's reason |
| `validation/m14/elixir/elixir-contains-audit.ts` | an INDEPENDENT oracle for the three DERIVATION labels, per file |
| `validation/m14/elixir/elixir-mutants.ts` | 17 SOURCE-level mutants, real fixture runner, subject restored by hash |
| `validation/m14/elixir/elixir-payload-latency.ts` | latency and serialized payload, before and after, same seam |
| `validation/m14/elixir/elixir-no-regex.ts` | regex literals across every file this lane owns, with the population declared |

## 1. The ten verdicts

| # | type | verdict | count / files | or the measurement that rules it |
| --- | --- | --- | --- | --- |
| 1 | `calls` | **EMITTED** | 49,007 / 536 | whole corpus, production path |
| 2 | `contains` | **EMITTED**, DERIVATION finding repaid | 9,849 / 463 | oracle now audits it: 9,061/9,063 matched, every residual classified (§6) |
| 3 | `references` | **EMITTED** | 930 / 380 | |
| 4 | `implements` | **EMITTED** | 191 / 66 | |
| 5 | `instantiates` | **EMITTED** | 1,187 / 164 | |
| 6 | `uses` | **GAP → implemented** (ELIXIR_FIX2-U1) | 2,117 / 180 | member field read; 2,244 construct sites, 96.43% published, 0 unexplained (§4) |
| 7 | `imports` | **EMITTED on the separate channel** | 931 / 381 | `ParseResult.imports` — never a `brain_relationship` row. Measured breakdown: `import` 315/164, `use` 510/325, `alias` 94/50, `require` 63/39 |
| 8 | `exports` | **GAP → implemented** (ELIXIR_FIX2-X2) | 5,076 / 420 | the language's public/private distinction; 7,959 private sites that must NOT export |
| 9 | `extends` | **RULED** | 0 | see §3 |
| 10 | `overrides` | **GAP in the language, implemented, DOES NOT FIRE on this corpus** | 0 edges / 601 files | see §5 |

Score: **7/10 fired**, `silent: extends imports overrides`, `imports[] 931 in 381
files`. Stated at four sample sizes in §8, because `firing-check`'s own header
warns that the sample moves the score.

**`script/m14/firing-check-v2.mjs` cannot measure this branch, and reports 5/10
for that reason alone.** Its `REPO` is the constant
`"$HOME/backbencher-brain"` (firing-check-v2.mjs:36) with no env
override, so it always imports the analyzer from the MAIN checkout. Running it
from this worktree produced byte-identical counts to running it from main
(`calls:11203 contains:1774 references:206 instantiates:43 implements:19` both
times, `5/10` both times) — proof that it never saw a line of this branch. The
`imports[]` channel it reports (206 in 157 files at `NFILES=200`) IS a real
measurement of the main checkout's analyzer, which has not changed. Fixing it is
master's: honour `BB_REPO` or derive `REPO` from `import.meta.dir`. The 7/10 above
comes from the lane census, which goes through the same production path
(`ASTEngine.parseFile` → `getParser` → `parse` → `getAnalyzer` → `analyze`) and
loads the analyzer from the working tree.

## 2. The six questions, per already-emitted type

Measured over the whole corpus by `elixir-firing-census.ts`. "Resolve" means both
endpoints bind to a symbol name seen anywhere in the run; an endpoint naming a
real module outside the corpus (GenServer, Bitwise, Kernel) counts as unresolved
by that measure and is reported as such rather than hidden.

| type | exists | fires | correct (oracle agrees) | labelled | resolved | confident | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 49,007 / 536 files | 100% oracle coverage on the compared labels (see §8 for the shared harness's own numbers) | yes — the callee/callable distinction is the receiver's first character, and both halves are pinned by fixtures and mutants | 24,273/49,007 = **49.5%** (targets are stdlib modules outside the corpus) | conf 0.8 × 48,955 and 0.9 × 52 — **100% heuristic**, every one carrying a `reasonCode` | 0 placeholder endpoints |
| `contains` | yes | 9,849 / 463 | **9,061/9,063 matched; 2 MISS + 18 UNEXPLAINED, all classified** (§6) | yes — ownership only, never a name edge | 9,849/9,849 = **100.0%** | conf 1.0, `structural` — 0 heuristic | 1 apparent placeholder endpoint, **adjudicated a true identifier** (§6) |
| `uses` | yes | 2,117 / 180 | **1,026/1,026 matched, 0 MISSING, 0 UNEXPLAINED** — the oracle's own defects are listed in §6 | yes — the receiver's first character separates a field read from a remote reference, and the two agree by construction | 874/2,117 = **41.3%** (a field name is not a symbol in the corpus) | conf 0.7 × 2,117 — **100% heuristic**, `reasonCode: elixir_member_field_read` on every one | 0 |
| `references` | yes | 930 / 380 | 100% on the compared labels | yes — the directive→module dependency contract | 630/930 = **67.7%** | conf 0.9 × 930 — 100% heuristic, `reasonCode` on all | 0 |
| `implements` | yes | 191 / 66 | 100% on the compared labels | yes — `defimpl`→protocol at 1.0 and `@behaviour`→behaviour at 0.9 are one relation | 167/191 = **87.4%** | conf 1.0 × 118, 0.9 × 73 — 73 heuristic, `reasonCode` on all | 0 |
| `exports` | yes | 5,076 / 420 | **4,618/4,620 matched; 2 MISS + 17 UNEXPLAINED, all classified** (§6) | yes — never a struct field, never an ownerless symbol, never the EX-L3 self-loop | 5,076/5,076 = **100.0%** | conf 1.0, `structural` — 0 heuristic | 0 |
| `instantiates` | yes | 1,187 / 164 | 100% on the compared labels | yes — never `calls`, never `references` | 508/1,187 = **42.8%** (`ArgumentError`, `KeyError`, `Date.Range` …) | conf 0.9 × 1,187 — 100% heuristic, `reasonCode` on all | 0 |

The oracle caveat is the harness's own: the oracle is a **separate walker over
the same grammar**, so a disagreement is a finding and an agreement is not proof
of correctness. A shape both walkers misread is invisible to both. That limit is
stated here rather than in a footnote because every "correct" cell above is
subject to it. What the oracle IS good for, and what this lane used it for, is
finding the oracle's own bugs — §6 lists five it found in its first version.

**Placeholder endpoints: 0. Empty symbol names: 0.** One endpoint spells `unknown`
and is adjudicated a true identifier in §6.

## 3. `extends` — RULED, with the measurement

**Instrument A — grammar inventory.** Substring counts over the *grammar
declaration* (`grammars/tree-sitter-elixir/grammar.js` — the grammar, never
project source), 0 for every one of: `extends`, `extend`, `superclass`,
`super_class`, `inherit`, `inherits`, `implements`, `interface`,
`abstract_class`, `class`, `override`, `overrides`, `defoverridable`, `require`,
`include`. `export`/`exports` appear once each, in the grammar's own prose. The
grammar **emits 45 distinct node types** across the corpus and not one of them
expresses a heritage clause.

**Instrument B — parse-tree counts**, because a reader will point at the three
constructs that *look* like inheritance, and each is a different relation:

| probe | sites / files | what it actually is |
| --- | --- | --- |
| `defmodule` with a dotted name | 1,754 / 534 | namespace ALIASING. `defmodule A.B.C` names the module `A.B.C`; it has no parent. Elixir's `defmodule Foo.Bar` is the same as nested `defmodule` |
| `defmodule` name repeated in one file | 24 / 16 | module reopening → `contains` |
| `defexception` | 56 / 19 | creates a struct that CONFORMS to `Exception`; no parent type |
| `defimpl` | 118 / 35 | protocol dispatch → `implements` (already emitted) |
| `@behaviour` / `@behavior` | 60 / 39 | conformance → `implements` (already emitted) |
| any call whose identifier is an inheritance keyword | **0 / 0** | — |

Elixir has no class hierarchy: dispatch is protocols (`implements`) and
conformance is behaviours (`implements`). An `extends` edge here would be a
fabrication, which is the expensive mistake the workstream warns about. The
ruling is falsifiable: a probe finding a non-zero count in the last row overturns
it, and the probe is re-run on every construct-census invocation.

## 4. `uses` — a GAP, and it was one

The language HAS the construct and the analyzer was reading it and throwing it
away. Measured tree shape: `user.name` is a **`call`** whose target is a `dot`
and which has **no `arguments` child** — the same node shape as a zero-arity
remote call. `isMemberAccess` (ELXD18) already separated the two by the receiver's
first character and **silenced** the field read entirely. Corpus: **2,244 sites /
182 files**.

The family contract for `uses` is exactly this edge: Go publishes selector field
access at 0.7 and states the skip rule verbatim; Erlang publishes a record member
read; Clojure publishes `.-field` and never `calls`.

**Recall against the construct, per site** — `elixir-emit-gap.ts`, an independent
shape probe with no exclusions at all, against what the analyzer published:

| | sites | files |
| --- | --- | --- |
| construct sites (probe B2b shape) | 2,244 | 182 |
| published | 2,164 | — |
| **recall** | **96.43%** | |
| emitted edges | 2,117 | 180 |

Published sites exceed emitted edges by 47: two reads of the same leaf on one
line dedupe into one edge on the `source\|type\|target\|line\|arity` key (EX-L2).
Every one of the **80** unpublished sites is named:

| reason | sites | example |
| --- | --- | --- |
| pattern position (`->` head is a destructure, ER-D7) | 31 | `erts/doc/docs.exs:27 md.kind` |
| def signature head | 31 | `lib/elixir/lib/code/formatter.ex:260 comment.previous_eol_count` |
| quoted code (quote is data) | 14 | `lib/elixir/lib/kernel.ex:5706 exception.message` |
| rule R7 as a string test — `users.unknown` | 4 | `lib/elixir/test/elixir/kernel_test.exs:950 users.unknown` |
| **unexplained** | **0** | — |

Deliberately **not** `uses`, each with its measurement:

* a capitalized receiver — a module, so it is a remote reference and the `calls`
  edge owns it (724 bare zero-arity remote references / 172 files);
* `recv[:key]` — an `access_call`, dispatching through the `Access` protocol
  (1,378 / 184 files). Reading it as a field read would label a protocol
  dispatch with the `implements` relation's job;
* a code-valued `@attr` read (2,181 / 209) — a value read, and the Erlang lane
  rules body-variable uses out of `uses` explicitly.

**R7 applied two ways, reported as an inconsistency for master.** R7's intent is a
statement about PROVENANCE — "no endpoint the analyzer emitted because it had
nothing to name" — not about spelling. Under `contains`, the corpus endpoint
`contains EExTest.Compiled -> unknown` was adjudicated a TRUE identifier
(`@file "unknown"` then `def unknown do`, ExUnit's synthetic-module convention).
Under `uses`, `users.unknown` is refused by the same spelling. Both readings are
defensible; the lane keeps the blanket string test for `uses` because a `uses`
target is consumed by `bb_impact` as a name to search for, and a target literally
spelled `unknown` there is indistinguishable from "unresolved" to a downstream
reader. The 4 sites are counted and reported rather than folded away. The rule
itself and `validation/m60/ledger.json` are master's.

## 5. `overrides` — the construct is real, the publishable form measures 0

Elixir's override construct is `defoverridable` (marks a default as replaceable)
plus `super(...)` (calls it). Measured: **26 sites / 14 files** and **17 / 4**.
The analyzer read neither before this change.

The overriding definition lives in the module that `use`s the provider — a
**different file** (510 `use` sites / 325 files) — and an analyzer that reads one
file publishes outgoing edges only. So the three shapes that fire were each
measured and each refused:

| shape | sites / files | verdict |
| --- | --- | --- |
| a file that both DECLARES provider N with `defoverridable` and `use`s N | **0 / 0** | the only shape with two distinct endpoints. Implemented; does not fire here |
| `defoverridable f: 1` + a later `def f` in the SAME module | 17 / 3 | a REAL override, but this lane merges a multi-clause head into ONE symbol, so both endpoints are the same string — 17 self-loops carrying no graph information |
| `use N` (another file) + any `def f` in the using module | — | a **fabrication**: most definitions in a `use N` module are new functions |
| a def name repeated across two modules in one file | 21 / 9 | not an override at all (`Registry.Supervisor.start_link` beside `Registry.Partition.start_link`) |
| `defimpl` twice for one protocol+type in one file | 0 / 0 | — |
| `@impl` annotations | 285 / 96 | a callback-conformance marker, already covered by `implements` |

The verdict is therefore **"the language has it, the analyzer reads it, this
corpus does not exercise the publishable form"** — and `use-defoverridable` is
where the branch fires, with three mutants (dropped, fabricated, whole-module)
that must die.

## 6. The DERIVATION findings, and the five oracle defects the reconciliation found

`script/m60/rel-type-coverage-gate.ts --langs=elixir` reports
`3 un-audited: ["contains","exports","uses"]` — up from `1` at handover, because
this branch added two types the differential does not audit. `deriveElixirEdges`
in `script/m14/differential.ts` pushes four labels and nothing else.

Lane-owned oracles in `script/m14/oracles/elixir-contains.ts` (the same convention
`script/m14/oracles/solidity.ts` sets) + `elixir-contains-audit.ts`:

| label | analyzer | oracle | matched | MISSING | UNEXPLAINED |
| --- | --- | --- | --- | --- | --- |
| `contains` | 9,849 | 9,063 | **9,061** | 2 | 18 |
| `uses` | 2,117 | 1,026 | **1,026** | 0 | 0 |
| `exports` | 5,076 | 4,620 | **4,618** | 2 | 17 |

`uses` went from 776/2,117 with a written "not reconciled" note to **1,026/1,026**.
It did not get there by tuning: writing the oracle properly surfaced five defects
in the oracle itself, each found by reading a residual rather than by adjusting a
threshold.

| id | oracle defect | what it cost |
| --- | --- | --- |
| O3 | `inArrowPattern` compared the WALKING CURSOR's index against the `->` arrow instead of the ORIGIN node's, so every member read in a `case`/`fn` clause body was classified as a pattern | 250 `uses` edges dropped |
| O3b | the `inDefHead` flag covered the single-line `, do: body` pair, which is code — the grammar nests that pair inside the def's `arguments` | `uses` misses in single-line defs |
| O4 | an un-nameable `defmodule` left the ENCLOSING module as owner of its members (the P6 defect class, other side of the wire) | 9 `contains` + 6 `exports` phantom edges |
| O4b | a name already declared private by `defp`/`defmacrop`/`defguardp`/`@typep` was still published as an export. Keyed on name ALONE first, which wrongly refused `defp of_guard/3` beside `def of_guard/5`; corrected to name **and arity**, and `@typep` moved to its own namespace because a type alias and a function may share a name (`typespec_test.exs:1056-1070` asserts exactly that) | 11 over-suppressions, then 2 under-suppressions, then 0 |
| O5 | a def-shaped call inside a def-shaped BODY published a symbol | `exports Kernel.Utils -> args`, the P2 phantom |

Plus one convention fix: the oracle used `""` for the file-level pseudo-source
where the analyzer writes `"Global"`. A convention mismatch is not a finding, it is
noise that hides real ones — 10 UNEXPLAINED and 10 MISSING pairs were the same
edges written two ways. And a dead store was removed (`memberStack`, declared and
never read).

**Every residual is classified:**

* **35 UNEXPLAINED** = 27 × `Unknown` — the analyzer's placeholder for
  `def unquote(name)` / `defmacro unquote(:"~~~")`, where the name is decided at
  compile time (base.ex:443/447/746, bitwise.ex:69, io/ansi.ex:117,
  special_forms.ex:66/147, and test fixtures). The oracle declines to invent a
  name, which is the only honest thing it can do. Already adjudicated in
  `reviews/elixir/deep-review-2026-09-28.md`; restated because the oracle makes it
  visible as a residual.
  + 8 × dynamic module names — `ModuleTest.__MODULE__.NonAtomAlias` (+ its member
  `hello`) and `ModuleTest.__MODULE__.NoVarWarning`, under both labels.
  + `ProtocolTest -> Integer` — `defimpl Multi, for: [Atom, Integer]`, the LIST
  form of `for:`. Declared, not fixed.
* **4 MISSING** = 2 distinct edges under two labels: `Kernel -> Macro.t` (a
  declaration the analyzer could not attribute) and
  `Kernel.GuardTest.RemoteUsage -> Remote.call`, where the analyzer says `Unknown`
  and the oracle says `Remote.call` for `defguard(Remote.call(...))` inside
  `defmodule(RemoteUsage, do: …)`. Elixir's compiler rejects both names
  ("invalid syntax in defguard"). Declared, not fixed.

**R7, measured rather than assumed.** The one apparent placeholder endpoint on
the corpus is `contains EExTest.Compiled -> unknown` at
`lib/eex/test/eex_test.exs:29`, and it is a **real identifier**: `@file "unknown"`
followed by `def unknown do`, ExUnit's synthetic-module convention. An oracle that
implemented R7 as a string test deleted this true edge, which is recorded in the
oracle's own header. See §4 for the other side of this coin.

## 7. Defects found and fixed on this branch

| id | defect | evidence |
| --- | --- | --- |
| **EX-A15 overwritten** | `defmacro (..)` published a macro named `"("` with arity 3 and `defmacro (---)` arity 4: the three `binary_operator` reads sat UNCONDITIONAL inside the parenthesized-operator branch and overwrote the name (`binaryPart` on a `block` returns the `(` token) | the lane's own fixture `paren-operator-forms` was FAILING on the inherited baseline (`fixture-baseline.json` says `elixir: 0` failures). Three versions measured: 53b5ec1ac correct, a7368a806 `Unknown` arity 0, 1ce88e403 `"("` arity 3 |
| **ELIXIR_FIX2-P2** | a def-shaped call inside a def-shaped BODY published a phantom symbol | `kernel/utils.ex:318` `defguard(args, expr, __CALLER__)` → a MACRO named `args` owned by `Kernel.Utils.defguard/2`. With bare arguments there is no nested `call` node, so the signature read takes `arguments`' first named child |
| **ELIXIR_FIX2-P3** | a `defmodule` with a non-alias argument published a module symbol named after the whole call | `kernel_test.exs:906/924/928` → `KernelTest.1 + 2, do: :ok`, `KernelTest.:"foo/bar", do: :ok`, `KernelTest.:"foo\\bar", do: :ok` — all three are `assert_raise ArgumentError` negative tests, so the argument is a COMPUTED module name. A bare identifier is a VARIABLE: `LoggerTest.name` (+ `debug`/`error`), `ExceptionTest.module` (+ `foo`), `ModuleTest.__MODULE__.NonAtomAlias` (+ `hello`) |
| **ELIXIR_FIX2-P6** | P3 created no module symbol but left the ENCLOSING module in scope, so everything inside an un-nameable module was attributed to it | **found by writing the `uses` oracle, not by reading the analyzer.** 10 declarations in 5 files, and the wrong edges: `contains ExceptionTest -> foo`, `exports ExceptionTest -> foo`, `contains MapTest -> name/age/hello/world`, `contains ModuleTest -> hello`. Fix: push an UNNAMED scope (`name` deliberately unchanged so no existing derivation moves; `unnamedModule` is the only new signal). Member symbols are still published — the declaration is real — but carry no owner. A `defstruct` inside an un-nameable module is not published at all: a struct's name IS its module's name |
| **ELIXIR_FIX2-V1** | `@typep` was published as `visibility: "public"` | 41 corpus sites / 12 files. `@typep` is Elixir's PRIVATE type alias, exactly as `defp` is not callable by name from another module, so any visibility-keyed rule would have exported all 41 |
| **ELIXIR_FIX2-C1** | no sub-1.0 edge carried a `reasonCode`, and NO edge carried an `evidenceClass` | M14-HONESTY-CONTRACT §4. Measured before: 49,007/49,007 `calls` at 0.8, 930/930 `references`, 1,187/1,187 `instantiates`, 73/73 `implements` with none, and `evidenceClass` absent on 61,188/61,188 edges. Now 0 without |
| **ELIXIR_FIX2-S1** | the census recorded `subjectCommit: "unrecorded"`, so an artifact measured BEFORE an analyzer fix read exactly like one measured after it | found re-verifying this branch's own evidence: the committed census said 10,849 symbols / 68,402 relationships and the analyzer produced 10,834 / 68,372. Both instruments now record HEAD, the analyzer's sha256, and whether it is dirty |
| **ELIXIR_FIX2-N1** | 3 regular expressions in this lane's own `elixir-payload-latency.ts` | `/from "\.\/engine"/g`, `/from "\.\/types"/g`, `/Analyzer$/`. Found by `elixir-no-regex.ts`, which exists because the shared gate scans `src/ast` only and its 4 hits are all in `real-svelte-analyzer.ts` |

Three defects in `elixir-emit-gap.ts` itself, recorded because each produced a
WRONG number that looked fine:

1. `childForFieldName("arguments")` returns null whether or not the call has
   arguments — the elixir grammar gives `arguments` no field name. The first probe
   read **2,725** "bare member reads" where the truth is 2,244, because every
   qualified call counted.
2. A chained read must descend into the inner call ONLY when that call is
   argument-less. `user.address.city` is two reads; `module.f(w).message` is one
   read whose leaf is `message`. The first version reported the second as `f`.
3. Population: 610 vs the other instruments' 601. The mix test fixtures carry
   `deps/` and `_build/` trees of generated `.ex` files. All three instruments now
   apply the same exclusion set.

## 8. Gates re-run, with the result

| gate | result |
| --- | --- |
| `bun script/m14/run-fixtures.ts --lang elixir` | **65 pass / 0 fail** (64 at P6, 61 at handover). `fixture baseline gate: no regressions` |
| `bun run validation/m14/elixir/elixir-mutants.ts` | **16/17 caught**, 1 declared equivalent with a corpus measurement, **0 unexplained survivors**. Subject sha256 verified IDENTICAL after the run. The scope-leak mutant SURVIVED the first version of the new fixture; a surviving mutant is a finding about the suite, so the fixture gained a declaration after the un-nameable modules, which is the only thing a leaked scope can affect |
| `NFILES=200 bun script/m14/firing-check-v2.mjs ELIXIR_FIX2` | **5/10, `silent: extends uses imports exports overrides`, `imports[] 206 in 157 files`** — a measurement of the MAIN checkout, because `REPO` is hardcoded at firing-check-v2.mjs:36. Run from this worktree it returns byte-identical numbers. See §1 |
| whole-corpus firing census (601 files, production `parseFile`) | **7/10**, 68,357 relationships, 10,829 symbols, 0 crashes, 0 files with parse errors |
| `bun run validation/m14/elixir/elixir-emit-gap.ts` | `uses` recall 96.43% with 0 unexplained; `exports` 8,155 public form sites → 5,076 edges, 2,838 sites with no edge on their own line, all named (2,076 merged-multi-clause, 762 ownerless declaration symbol), 0 unexplained. Independently reproduces the other two instruments' figures: construct 2,244/182, exports 5,076/420, private control 7,959 |
| `bun run validation/m14/elixir/elixir-contains-audit.ts` | see §6 |
| `bun run validation/m14/elixir/elixir-no-regex.ts` | **74 of 74 files** in the derived population, **0 regex literals, 0 `RegExp` constructors** |
| `bun script/m14/no-regex-gate.sh src/ast` | 4 regex literals in the whole tree, all in `real-svelte-analyzer.ts`; none in this lane |
| `bun run script/m12/verify-regex-census.ts` | missing 0, stale 0, unclassified 0 |
| `bun script/m60/rel-type-coverage-gate.ts --langs=elixir` | CHECK 1: **`3 un-audited: ["contains","exports","uses"]`** (was 1) — oracles written for all three and reconciling per §6, but the gate reads `script/m14/differential.ts` and cannot see a lane-owned oracle. CHECKS 2–4 clean. Baseline line: `104 recorded, 2 NEW, 103 repaid` |
| `bun script/m14/differential.ts --lang elixir --repo elixir` | three consecutive runs, 60 files each: rot 3 tree-truth 4,107 covered 100% MISSING 0 unexplained 23 (1.0%); rot 4 tree-truth 1,813 covered 100% MISSING 0 unexplained 11 (0.8%); rot 5 tree-truth 2,133 covered 100% MISSING 0 unexplained 12 (0.7%). **The harness rotates its sample every run** (`cold-pool … rot 3/4/5`), so these are three separate samples and NOT a before/after |
| `bun run validation/m14/elixir/elixir-payload-latency.ts` | see §9 |
| `bunx tsc --noEmit` | **0 errors**, whole repository (the branch's analyzer, oracle and six instruments included) |

### Sample sensitivity — the score is stated four times

| NFILES | score | note |
| --- | --- | --- |
| 25 | **7/10** | `imports[] 20 in 14 files` |
| 100 | **7/10** | `imports[] 115 in 63 files` |
| 200 | **7/10** | the reported number |
| 500 | **7/10** | `imports[] 770 in 318 files` |
| 601 (whole corpus, lane census) | **7/10** | 68,357 relationships |

The score does not move with the sample for this lane, which is the property the
`firing-check` header warns about. `imports[]` does move, by four orders of
magnitude, which is the reason the import verdict is stated as a channel and not
as a relationship count.

## 9. Payload and latency — REPORTED, not re-baselined

601 files, both analyzers measured through the **same seam in one process** (the
baseline is loaded from git at `63a48923e` into a temp dir outside `src/`), and
cross-checked against `ASTEngine.parseFile` on the same population (601 files,
68,357 edges — identical).

| | before | after | delta |
| --- | --- | --- | --- |
| edges | 61,188 | 68,357 | **+7,169 (+11.7%)** |
| serialized payload | 9,330,748 B | 16,248,987 B | **+6,918,239 B (+74.1%)** |
| …of which §4 `reasonCode`/`evidenceClass` metadata | 0 B | 5,646,790 B | **81.6% of the regression** |
| …of which the new edges (`exports` 1,002,197 B + `uses` 617,387 B) | — | 1,619,584 B | |
| edges-only payload (metadata stripped) | 9,330,748 B | 10,602,197 B | +1,271,449 B (+13.6%), tracking the edge count |
| wall time | 119,087 ms | 92,259 ms | **−22.5%** this run; **−4.2%** on an earlier run of the same code |

Two things the master should read here rather than the headline:

1. **The payload regression is real and 81.6% of it is the metadata §4 requires
   on every sub-1.0 edge, not the new relationships.** The edge-count growth is
   +11.7% and the edges-only payload growth tracks it at +13.6%. If the budget is
   about relationships, this branch is +11.7%; if it is about the graph `bb_graph`
   ships, §4's guarantee costs 5.6 MB across this lane alone, which is a
   programme-level decision, not a lane one.
2. **The latency figure is this box's load, not the analyzer.** Two runs of the
   same code read −4.2% and −22.5%. The instrument cannot separate them and does not
   claim to; what is attributable is that the first implementation of the §4
   metadata cloned the metadata object unconditionally on all 68,357 edges and
   cost a measured +24.7%, and cloning only when a key is missing brought the same
   measurement to +9.4%.

## 10. Limitations (non-empty, as the honesty contract requires)

1. **Dynamic dispatch.** A lowercase receiver holding a module is dynamic
   (`module.manifests()`, `module.fetch(container, key)` in `access.ex:252`), so no
   `calls` edge and no `uses` edge — that is 50.5% of the `calls` resolution
   figure and 58.7% of the `uses` one, and it is a language property, not a bug.
2. **Metaprogramming boundaries.** `def unquote(name)` and
   `defmacro unquote(:"~~~")` publish the symbol `Unknown` (20 corpus sites) and
   the `contains`/`exports` edges that follow it. Quoted code is data and emits
   nothing (M12.23), so a macro that GENERATES definitions contributes none of
   them — a known and accepted blind spot.
3. **Macro DSLs are read as module bodies.** `in_module do def foo(), do: bar()
   end` (`module_test.exs:471, 488`) and `for module <- modules do defmodule
   module do … end end` place declarations in a module the analyzer cannot name.
   The second shape is fixed (P6: no owner is published); the first is a test
   helper that defines a module at runtime, so `contains ModuleTest -> foo` names
   a module that does not exist. Declared, not fixed — it needs the DSL.
4. **Grammar-version drift.** The analyzer reads `operator_identifier`,
   `unary_operator`, `block`, `do_block`, `keywords`, `pair`, `access_call` and
   `struct` node types by name, and the grammar gives `arguments` NO field name —
   a fact that cost this lane's own probe a wrong count (§7). `memberReadLeaf` in
   particular depends on tree-sitter-elixir 0.3.5 parsing a member read as a
   zero-arity `call`; a grammar that gave `user.name` its own node type would
   silence `uses` entirely (and the `member-read-*` mutants would stop being
   catchable).
5. **Multi-clause merge.** A `defoverridable`-marked redefinition merges into ONE
   symbol, so the one same-module override Elixir has cannot be published with two
   distinct endpoints.
6. **Outgoing only.** Every edge this analyzer publishes points FROM the file being
   analyzed. Resolving who points AT a symbol is a separate subsystem that is not
   built; `bb_graph`'s reverse traversal cannot be served by this lane's output
   alone. 772 `calls` edges, 30 `references` and 15 `uses` edges carry the literal
   pseudo-source `Global`, which names no module.
7. **Cross-file `use` + `defoverridable`** — the shape that would make `overrides`
   fire at corpus scale — is unnameable from one file. Resolving it needs the
   `__using__` expansion, which is a compiler, not a tree walk.
8. **Two declared, unfixed symbol-level residuals**: `Kernel -> Macro.t` and
   `Kernel.GuardTest.RemoteUsage -> Remote.call`, both names Elixir's own compiler
   rejects. The oracle derives them, the analyzer does not, and the difference is
   recorded rather than closed.

## 11. Shared-harness needs, reported not made

`script/m14/**` is master's. Three changes are needed and none is made here:

1. **`firing-check-v2.mjs:36`** hardcodes `const REPO =
   "$HOME/backbencher-brain"`, so the instrument can only ever measure
   whatever is in the main checkout. Run from a worktree it silently reports the
   main checkout's analyzer. It already honours `BB_CORPUS`; it needs the same for
   the repo root, derived from `import.meta.dir` or an env var. Until then, the
   shared firing check and every lane's worktree numbers are different numbers
   about different code, and nothing in the output says so.
2. **`script/m14/differential.ts`** needs `deriveElixirContainsTruth`,
   `deriveElixirUsesTruth` and `deriveElixirExportsTruth` from
   `script/m14/oracles/elixir-contains.ts` wired into the `if (lang === "elixir")`
   block at line 22955, in the shape already used for clojure at 22983, and
   `contains`/`exports`/`uses` added to the elixir arm of the audited-label
   allowlist at line 23153 (currently `extends`, `implements`, `instantiates`,
   `overrides`, `calls`, `references`). All three oracles already return the
   harness's `{label, from, target}` shape and reconcile per §6, so this widens
   what is CHECKED without changing a verdict. Until it lands,
   `rel-type-coverage-gate` keeps reporting 3 un-audited labels for this lane.

## 12. `uses` — a spec collision between two authors, reconciled (2026-10-07)

Two pins constrain the SAME rule in opposite directions, and both landed on main in
the corpus commit `1719ff6b3` (2026-10-07) as declared failures:

| pin | authored | by | demands |
| --- | --- | --- | --- |
| `ontology-uses` (EX-EX3) | 37be14e7a, 2026-10-03 | the ontology wave | publish ONLY when the leaf names a struct field **this file** declares ("so a published target is always a real Property symbol"), at `struct_field_read`; and forbid the map key `m.domain`, the map-BOUND `m.id` (`%{} = m`), the chain's intermediate `u.profile`, and a `calls` edge to the literal receiver `%OntoUser{}.name` |
| `member-read-uses` (ELIXIR_FIX2-U1) | 2a169c958, 2026-10-05 | the FIX2 wave | publish member reads in a file that declares **no struct at all** — `user.name`, `user.address.city` (both `address` and `city`), `o.id` — at 0.7 with `usage_contextual` |

**This was not a defect in one of them — it is a collision, and it is measured as
one.** 37 distinct revisions of `src/ast/real-elixir-analyzer.ts` exist in the object
store: 32 reachable from a ref, plus **5 that no ref and no reflog points at**
(the unreachable layer `script/m14/preservation-audit.py --dangling` walks). 15 of
the 37 were run against the whole lane directly; of the other 22, every one carries
NEITHER `struct_field_read` nor `usage_contextual` in its source, and both pins
require at least one edge carrying one of those labels, so each fails a pin by
construction. **No revision of this file passes both pins.** The two nearest misses
are the lineage head (2,434 lines, 17 lane failures, `ontology-uses` red) and the
wave's realization (`5d6dbd58`, 2,614 lines, 18 lane failures, `member-read-uses`
red) — the wave replaced the unconditional rule with the declared-field gate, which
is exactly what turned the FIX2 pin red. Its neighbours (`2381`, `2297`, `2326`,
`2208`, `2226`, `2279`, `2384`, `2536`, and the 5 unreachable ones) each fail one or
both; `2326` is the best of that family at 13 failures and fails both.

### The reconciled rule

The gate is applied exactly when the file has the vocabulary to apply it:

| the file declares | `uses` publication | label | confidence |
| --- | --- | --- | --- |
| ≥1 struct field | only reads whose leaf is a declared field (`declaredStructFields`) | `struct_field_read` | 0.9 |
| no struct field at all | every staged member read | `usage_contextual` | 0.7 |

Two gates apply in BOTH branches, because neither depends on that vocabulary: a read
through a receiver a `%{} = m` / `%{a: a} = m` match bound to a MAP is dropped (a
map-key read is not a struct-field read, whatever the file declares — the corpus case
is `defp from_map(%{} = datetime_map)` reading eleven keys at
`calendar/datetime.ex:2063`), while `%Mod{} = u` binds a STRUCT and keeps publishing.
A `%`-literal receiver is exempt from that gate (it is a value, not a binding) and
**R7** keeps its spelling out of every `calls` target: a target carrying `%` or `{}`
names no symbol, which is what the three pins' forbids say about `%OntoUser{}.name`,
`%Helper{}.helper_fun` and `%URI{uri | path: "/bar"}.path`.

Staging is post-walk (`ctx.usesCandidates`, resolved after the walk) and not
emission-time, because a read can precede the `defstruct` that declares its field.
`metadata` on the result carries the countable split: `usesCandidates`,
`usesVerified`, `usesContextual`, `mapKeyReceiverDropped`.

`uses` has a SECOND producer, added the same day and measured in §13: the `use`
directive, which is the language's mixin application rather than a member read.

### Measurement — elixir corpus (568 files), before → after

| | before | after |
| --- | --- | --- |
| `uses` edges | 2,108 | 1,630 |
| — `struct_field_read` @0.9 | 0 | 168 |
| — `usage_contextual` @0.7 | 2,108 | 1,462 |
| `uses` files | 178 | 159 |
| `uses` distinct sources / targets | 480 / 379 | 378 / 303 |
| `uses` endpoints resolving file-local | 32.3% | **36.1%** |
| `uses` endpoints resolving project-wide | 64.4% | **70.3%** |
| `uses` edges resolving both ends | 1.4% | 1.7% |
| `calls` edges / distinct targets | 48,791 / 6,857 | 48,786 / 6,855 |

The other eight audited types are byte-identical in the same run — the change is
confined to this rule. The portable part of the result is the resolution column: the
1,630 surviving edges bind to symbols more often than the 2,108 did, which is what
"the remainder stay silent rather than fabricated" has to mean in numbers.

### What this rule gives up, stated

* In a file that declares struct fields, a read of a field declared in ANOTHER file
  is silent (the gate cannot verify it). That is the wave's measured trade and it is
  the price of the 36.1/70.3 above; the fallback branch exists only for files with no
  struct field vocabulary at all.
* The fallback's labels are weaker on purpose: `usage_contextual` is an unverified
  claim about the shape, not a statement that the field exists.
* The map-binding detector is LEXICAL within one definition: a `%{} = x` binding
  inside an anonymous `fn` is recorded against its enclosing definition, which can
  only drop reads, never publish one.

### Fixtures

`ontology-uses` passes (its 9 findings close) and `member-read-uses` is unchanged at
PASS — the first revision of this analyzer where both hold at once. Lane: 65 pass /
17 fail → **66 / 16**; whole-corpus fixtures 136 → 135 declared failures, no lane
regressed.

## 13. `use` → `uses` (mixin application) — emitted, and the LABEL two pins disagree about

`use Mod` is Elixir's mixin application: `Mod.__using__(opts)` runs inside the using
module and injects code into it, which is the claim the relationship family records as
`uses` (dart's `class A extends B with M1, M2`, css's `@include` of a `@mixin`). It is
published ALONGSIDE the `references` edge the same directive already produced — not as
a relabelling, because the module-dependency statement is what the module view reads —
with `isMixin: true`, `via: "use"`, `evidenceClass: "structural"` and
`reasonCode: elixir_use_mixin_application`. One edge per dependency at that
dependency's own name-bearing line, so the brace group `use UsesMixin.{Grouped,
AlsoGrouped}` publishes its two members at their own line and never the group text,
and a self-directive publishes neither edge (ELXD8).

| | |
| --- | --- |
| corpus (568 files), `uses` edges | 1,630 → **2,142** |
| — `structural` (this rule) | 0 → 512 |
| files with `uses` edges | 159 → 395 |
| endpoints resolving file-local | 36.1% → **39.6%** |
| endpoints resolving project-wide | 70.3% → **77.4%** |
| the other nine audited types | byte-identical |

`uses-mixin-forms` passes (5 `uses` rows + both `references` rows). `elx4-uses-mixin`
did NOT for the same reason, and the four findings were left visible instead of
smoothed over, because which label the lane publishes for a directive is the owner's
call. All four were LABEL disagreements, never missing edges: three `uses` rows asked
for `meta.evidenceClass: "usage_contextual"` and one `references` row for
`reference_qualified` where the dependency edge carried `structural_inference`. The
rule states `structural` because a directive's text *names* the module — the evidence
is syntax, not context — and `usage_contextual` is the `pushRel` default, which that
pin's wave recorded without changing.

**Reconciled 2026-10-10 — EX-ONTOLOGY-VOCAB (owner's ruling).** The lane publishes the
WAVE/TIER vocabulary the rest of the corpus already pins: `structural` on
`contains`/`exports`/`implements`/`instantiates`/`overrides`, `import_based` on
`imports`, `reference_qualified` on a target resolved through a name (so this group's
dependency edge now carries `reference_qualified` where it carried
`structural_inference`), and the member-read pair (`struct_field_read` at 0.9,
`usage_contextual` at 0.7) unchanged. Measured before the ruling: `exports ->
structural` is pinned by 23 lanes / 103 rows and `imports -> import_based` by 122 rows,
while the per-construct spellings (`public_visibility`, `import_directive`,
`module_directive`, `import_resolved_call`, `defoverridable_marker`) appear in this
lane's four `ontology-*` fixtures and nowhere else; both 2026-10-04 elixir waves
(`analyzer/ELIXIR4`, `analyzer/ELIXIR_EXPORTS2`) independently compute the tier names,
and each was refused by the previous fold on a union-parse fault rather than on merit.
Three pins moved with the ruling, each with the reason in its own `note`:
`export-surface` (`syntactic_declaration` retired), `struct-update`
(`structural_inference` retired) and `elx4-uses-mixin` (`usage_contextual` on the mixin
row retired, so one construct keeps one label across both pins). The four `ontology-*`
fixtures' remaining findings are EDGE findings — import directives, `@impl`-gated
overrides, the `@type`/`@callback` export surface, and the EX-EX11/11b guards — and
their labels were retired with the ruling.


## 14. The fold, 2026-10-10: three refused waves reconciled — 65/82 → 82/82, zero regressions

`docs/analyzers/BRANCH-INVENTORY-2026-10-07.md` §6/§10.5 named this lane as the next fold and
stated the reason it had not happened: three elixir analyzer revisions were refused by the
previous fold on **mechanical** grounds — `analyzer/ELIXIR` by `tsc` on a member union
(`TS2740 … 'never[]'`), `analyzer/ELIXIR_EXPORTS2` and `analyzer/ELIXIR4` by the union tooling's
own parse errors (`SYNTAX_ERR 2` / `SYNTAX_ERR 3`) — never because a measurement said they were
worse. That is the whole reason the work sat in refs while 15–17 pins failed on main.

### 14.1 What was measured first

Each revision was run as a whole file through the real harness
(`script/m14/lane-analyzer-probe.mjs`, which loads the branch's analyzer with THIS tree's runner
and fixtures, so the only variable is the analyzer). Against main's 14 failing fixtures at the
start of this fold, every one of them is fixed by at least one revision, and each revision also
BREAKS pins main passes:

| revision | fixes | breaks | refused for |
| --- | --- | --- | --- |
| `analyzer/ELIXIR_EXPORTS2` | 8 (`elx4-*`, `r7-*`, `exports-public-surface`, `overrides-defoverridable`) | 6 | union parse error |
| `analyzer/ELIXIR4` | 7 (`elx4-*` incl. `imports`/`overrides`, `r7-directive-names`) | 8 | union parse error |
| `analyzer/ELIXIR` | 5 (the four `ontology-*`, `elx4-unnamed-declarations`) | 9 | `tsc` on a member union |

So the fold is a **union**: main keeps every pin it already passes, and the producers only the
refused revisions have are promoted into main, one at a time, each verified by the fixture suite.

### 14.2 Two reconciliations, because the corpus held two generations of the same claim

The corpus (committed whole by `1719ff6b3`) contains pins from both generations, and they
disagree. Each disagreement was settled by the **corpus's own vote**, counted before the choice,
and the losing pin was moved with its reason written into its own `note`:

1. **The evidence-class vocabulary** (§13 has the ruling): `structural` / `import_based` /
   `reference_qualified` / `usage_contextual` (23 lanes / 103 `exports -> structural` rows; 122
   `imports -> import_based` rows; both refused waves compute the tier names) beats this lane's
   pre-wave `syntactic_declaration`/`structural_inference` and the per-construct generation
   (`public_visibility`, `import_directive`, `module_directive`, `import_resolved_call`,
   `defoverridable_marker`), which appear in this lane's four `ontology-*` pins and nowhere else.
2. **Behaviour claims** — settled the same way, by counting the pins and reading which are on
   PASSING rows:
   - `import Mod` publishes the module-dep `references` row AND `imports` (`framework-forms`,
     `import-only-forms`, `r7-directive-names` on the `references` side vs `ontology-directives`'
     forbid on the other). Both are true statements; EX-EX7's `imports` holds as an addition, not
     a replacement.
   - A PUBLIC `@type` alias IS part of the export surface (`export-surface` and `ontology-exports`
     pin it; `exports-public-surface`'s `handle` forbid was the lone dissent).
   - A nested `defmodule` IS exported by its parent (`export-surface` pins
     `exports Cc1.ExportSurface -> Cc1.ExportSurface.Inner`; `elx4-exports-surface`'s forbid was
     the lone dissent).
   - An `overrides` row's source carries its ARITY (`OverridesSurface.sample/0`) and its target is
     the MEMBER's own name (`sample`), and the row carries `markedLine` — all three pinned by
     `overrides-defoverridable` (six passing rows) against `elx4-overrides-defoverridable`'s and
     `ontology-overrides`' single-generation spellings.
   - `Unknown` (the analyzer's own sentinel) may never be an endpoint, but a definition the source
     genuinely names `unknown` IS a member (EX-EX11b), and `unquote`/`unquote_splicing` are macro
     syntax, never members (EX-EX11).

### 14.3 The producers promoted into main

| producer | promoted from | what it names |
| --- | --- | --- |
| `import` → `imports` | ELIXIR4 | the import statement itself (main published only the `references` half) |
| `extractDirectiveName` | ELIXIR4/EXPORTS2 | a directive's module name from its FIRST argument's own node — atoms keep their colon (`:lists`, `:gen_server`), option text is never the name, a computed name publishes nothing |
| `moduleNameOf` / `isAliasPath` / `joinModuleName` | ELIXIR4 | module names that are quoted atoms (`:"Elixir.A.B"`), atoms (`:atom_named`, absolute and unowned), or `__MODULE__`-relative (resolved against the enclosing module); `Elixir.`-absolute names are not re-prefixed |
| EX-EX13 head guard | ELIXIR | a directive-SHAPED call inside a declaration head (`defmacro import(module, opts)`) is the head |
| R7-NAMES attribute guard | this fold | a directive-shaped call inside an ATTRIBUTE (`@spec require(R7Alias) :: :ok`) is the attribute's text |
| EX-EX11/11b placeholders | EXPORTS2/ELIXIR | `Unknown`/`global` never endpoints (the symbol stays, marked `unresolvedName`); `unquote`/`unquote_splicing` never members; the mark + the guards |
| `recordOverride` + `defoverridable` marks | EXPORTS2 | the same-module override edge, with `overridesLine` + `markedLine` |
| `@impl` staging + consumption | ELIXIR | Elixir's `@Override`, resolved through `@behaviour`/`defimpl`/`@impl SomeProto`, silent when ambiguous |
| resolved-`:only` call re-labelling | ELIXIR | a call re-targeted through an `:only` import carries the class of the edge it published (`reference_qualified`), not the pre-resolution one |
| `exportForm` / `isCallbackDeclaration` | main + this fold | the `@callback`-only behaviour surface reaches the edge |

### 14.4 Measured after the fold (559-file corpus, production path, `script/m14/oracles/elixir-emission-audit.ts`)

```
type          edges   files   src-resolved  tgt-resolved  tgt-external  confidence        evidenceClass  R7
calls        48751     530    48115/48751   17709/48751         31042  0.8:48699 0.9:52  48751/48751    Global sources (legal), operator names
implements     191      66        191/191        95/191            96  0.9:73 1:118            191/191    -
uses          2134     388       2128/2134      212/2134          1922  0.7:1462 0.9:672        2134/2134    Global sources (legal)
imports        278     150        255/278        29/278           249  1:278                   278/278    Global sources (legal)
exports       5055     418       5055/5055     5055/5055             0  1:5055                  5055/5055    `|`-operator names only
contains      9822     461       9822/9822     9822/9822             0  1:9822                  9822/9822    `|`-operator names only
references     915     375        885/915         74/915           841  0.9:915                  915/915    Global sources (legal)
overrides      154      22        154/154         25/154           129  1:154                    154/154    -
instantiates  1187     164       1187/1187       372/1187           815  0.9:1187                1187/1187    -
```

`overrides` and `imports` are the two types this fold brought from zero (main published neither).
The 129 external `overrides` targets are the design: the contract a `@impl` names lives in the
behaviour's own file. The `Global` sources are the `.exs`-script shape (a directive with no
enclosing module), which this lane's law makes a LEGAL source and never a target. The audit's
`|`-operator hits are Elixir operators used as function names (`def a ||| b` → `|||/2`), not
fabricated text. The corpus here is the 559-file `elixir` checkout (§13's 568-file run was a
different revision, so its cells are not comparable number-for-number).

### 14.5 Verification, at this commit

- **Fixtures: 82/82 PASS, 0 FAIL** — the lane's whole suite, including every pin this fold moved.
  In the FULL suite (`bun run script/m14/run-fixtures.ts`, 1,447+ pins) elixir is the row that
  reports `{"pass":82,"fail":0}`.
- **Mutants: 87/87 CAUGHT** (`BB_MUTANT_ONLY="elixir/" bun run script/m14/mutate-analyzer.ts`).
- `npx tsc --noEmit` exit 0.
- `audit:fixture-provenance`: no fixture introduced or edited by this change fails.
- `audit:doc-truth-emissions`: the two elixir findings this fold created and closed — the
  `overrides (relationship)` cell claiming "DOES NOT FIRE" (now `✅`, §14.4) and the
  `imports (relationship)` row that did not exist (now present) — are gone from the report.
- The fixture BASELINE still records `elixir: 15`; this fold takes the lane to 0, and a baseline
  is deliberately not rewritten by a scoped run (`run-fixtures.ts` refuses `--update-baseline`
  outside a full run: "it would drop every lane the run did not cover"). Recorded here instead.

### 14.6 Instrument repairs made with the fold (each one hid evidence)

- `script/m14/oracles/elixir-emission-audit.ts`'s `REL_TYPES` listed `brain_import` (the
  CHANNEL) but not `imports` (the relationship), so the table counted exactly ONE such row — the
  first occurrence creates the tally and every later one lands in a bucket that is never printed.
  The enum now names `imports`; the 278/150 row above is what that repair revealed.
- The same audit's `PLACEHOLDERS` contained lower-case `unknown`, so it reported an R7 endpoint on
  a row `ontology-placeholder-names` pins as correct (EX-EX11b). Removed.

### 14.7 What is still NOT claimed

- `ctx.imports` (the `ImportInfo[]` channel) is unchanged by this fold, and for this lane
  `brain_import` remains silent — the relationship is the only `imports` channel that carries a
  line and an endpoint pair (§14.4's `imports` row is the relationship, not the channel).
- The `@impl` resolution order has no live corpus case for the `defimpl`-named form (1 site in the
  ontology wave's measurement, 0 in this revision's sample); it is implemented and fixture-pinned,
  not corpus-verified.
- Elixir has no `extends`; the type stays silent (§3).
