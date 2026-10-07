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
| references | ✅ | module dependencies only: `use`/`import`/`alias`/`require` → `references module -> dep` (the FP-family module-dep contract, Clojure ns → required libs). A multi-alias expands one dependency per member (`alias Foo.{Bar, Baz}`, ELXD20) and **EX-D26 (2026-09-29)** widened the member filter to `identifier` nodes, so lowercase FUNCTION aliases (`alias Helper.{make, name}`) publish `references -> Helper.make` / `-> Helper.name` and register the local name; a bare call through such an alias then resolves (`make()` → `calls -> Helper.make`). Measured 0 sites in 938 files of the six corpora — a latent hole, fixed because it is one predicate wide. Body identifiers emit NOTHING (the old 47-edge references flood is removed) | 0.9 |
| uses | ✅ | **ELIXIR_FIX2-U1 (2026-10-05)** a MEMBER FIELD READ: a `call` whose target is a `dot`, with **no** `arguments` child, whose receiver's first character is lowercase — `user.name`, `o.id`, `user.address.city` (2 edges: `address`, `city`, because the grammar nests `call(dot(call(dot(user,address)),city))`). Uppercase receiver = a module, so the same node shape is a remote reference and stays `calls` (Go's rule verbatim: "selectors that are the callee of a call_expression are skipped — the calls edge handles them"). Excluded with reasons: quoted block, def signature head, DECLARATION attribute value, `->` pattern position (ER-D7: a head pattern emits nothing). Measured 2,117 edges / 180 files from 2,244 construct sites (96.43% published; the 80 unpublished sites are each named in §4). `memberReadLeaf` sits next to `isMemberAccess` on purpose: if the two ever disagree a field read is either double-labelled or silently dropped | 0.7 |
| exports | ✅ | **ELIXIR_FIX2-X2 (2026-10-05)** what the module PUBLISHES. Elixir has no `export` keyword — the language draws the surface with the DEFINITION FORM: `def`/`defmacro`/`defguard`/`defdelegate`/`@type`/`@opaque`/`@callback`/`defstruct`/a nested `defmodule` are reachable from outside the file; `defp`/`defmacrop`/`defguardp`/`@typep` are not. Measured 5,076 edges / 420 files (whole 601-file corpus, after ELIXIR_FIX2-P6 removed 6 edges that named an un-nameable module's members). The private half is the falsifier: 7,918 `defp`-family + 41 `@typep` corpus sites that an "is it a function" rule would publish. NOT published: a struct `Property` (membership rides `contains`, the exports-family ruling), an ownerless symbol (no owner to publish from), `owner === name` (the EX-L3 self-loop). `res.exports` (the ExportInfo LIST) is a different channel and is unchanged | 1.0 |
| overrides | ⚠ GAP-in-the-language, DOES NOT FIRE on this corpus | **ELIXIR_FIX2-O1/O2 (2026-10-05)** Elixir HAS the construct: `defoverridable` (26 corpus sites / 14 files) and `super(...)` (17 / 4), and the analyzer read NEITHER before. It reads both now and publishes only the shape with two DISTINCT endpoints — a file that both DECLARES a provider N (with `defoverridable`) and `use`s N, which measures **0 sites in 601 files**. Not published, each with its measurement: `use N` in another file + any `def f` (a FABRICATION — most defs in a `use N` module are new, 510 `use` sites / 325 files); `defoverridable f: 1` + a later `def f` in the SAME module (17 sites / 3 files — a real override, but this lane merges a multi-clause head into ONE symbol so both endpoints are the same string: 17 self-loops carrying no graph information); a def name repeated across two modules in one file (21 / 9, and not an override at all). Fixture `use-defoverridable` is where the branch fires | 0.9 |

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
| `contains` | yes | 9,849 / 463 | **9,061/9,063 matched; 2 MISS + 18 UNEXPLAINED, all classified** (§6) | yes — ownership only, never a name edge | 9,849/9,849 = **100.0%** | conf 1.0, `syntactic_declaration` — 0 heuristic | 1 apparent placeholder endpoint, **adjudicated a true identifier** (§6) |
| `uses` | yes | 2,117 / 180 | **1,026/1,026 matched, 0 MISSING, 0 UNEXPLAINED** — the oracle's own defects are listed in §6 | yes — the receiver's first character separates a field read from a remote reference, and the two agree by construction | 874/2,117 = **41.3%** (a field name is not a symbol in the corpus) | conf 0.7 × 2,117 — **100% heuristic**, `reasonCode: elixir_member_field_read` on every one | 0 |
| `references` | yes | 930 / 380 | 100% on the compared labels | yes — the directive→module dependency contract | 630/930 = **67.7%** | conf 0.9 × 930 — 100% heuristic, `reasonCode` on all | 0 |
| `implements` | yes | 191 / 66 | 100% on the compared labels | yes — `defimpl`→protocol at 1.0 and `@behaviour`→behaviour at 0.9 are one relation | 167/191 = **87.4%** | conf 1.0 × 118, 0.9 × 73 — 73 heuristic, `reasonCode` on all | 0 |
| `exports` | yes | 5,076 / 420 | **4,618/4,620 matched; 2 MISS + 17 UNEXPLAINED, all classified** (§6) | yes — never a struct field, never an ownerless symbol, never the EX-L3 self-loop | 5,076/5,076 = **100.0%** | conf 1.0, `syntactic_declaration` — 0 heuristic | 0 |
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
