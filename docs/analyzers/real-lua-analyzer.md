# real-lua-analyzer.md

M14 ontology workstream, lua. Every number below is reproducible from
`validation/m60/lua/ontology-census.json` and
`validation/m60/lua/grammar-inventory.json`, both produced by the scripts named
in §7, both measured through `parseFile` from `src/ast/pool-worker.ts` — the
production entry point, not `analyze()`, which skips the pool-worker stages.

## 1. Language and wiring

- Analyzer: `src/ast/real-lua-analyzer.ts`
- Parser: `tree-sitter-lua` WASM at `wasm/tree-sitter-lua.wasm`, sha256
  `9ebb71c0a6acc4791ba7b46624900584024646af2ac9c3c036775c7e5c937f3a`, 50,917 bytes
- Grammar: `@tree-sitter-grammars/tree-sitter-lua` 0.4.1
- Corpus: `$HOME/fixtures/repositories`, 120 repos, **3,250 tracked
  `*.lua` files**, every one of them parsed. Not a sample: the draw predicate is
  `git ls-files '*.lua'` per repo, sorted, no cap, so the file set is identical on
  every machine. 19 repos carry the 3,250 files; the largest are kong (1,312),
  nvim-lspconfig (863), luvit (199), luarocks (162), snacks.nvim (141).

The grammar is loaded from a private byte buffer per file. The previous
pinned artifact/runtime combination retained external scanner state across
files, and parser reuse could turn a valid function declaration into a malformed
variable and produce false syntax errors. The isolated lifecycle is a correctness
requirement, not a fixture-only workaround.

## 2. What each relationship type means IN LUA

This is not the general meaning of the ten labels. It is what each one can carry
when the language is Lua, which is what makes some of them applicable and one of
them not.

| Type | Meaning in Lua, and where the construct is written |
| --- | --- |
| `calls` | A `function_call`'s name field. The TARGET is the bare callee name — `create` for `coroutine.create`, never the path. The SOURCE is the enclosing function/method label, or `global` at file scope. |
| `uses` | A name this scope READS as a value. Lua has no lexical declaration site that makes this interesting: a read of a local, an upvalue, a global, a stdlib function, or a field of a required module all arrive as the same bare identifier, and which one it is not written anywhere. 0.9 confidence, `usage_contextual`, for that reason. |
| `contains` | A declaration inside a container: `global` -> the file-scope name, or `owner` -> the member's own name. Synthesized after the walk from symbol pairs, so it carries a line and no node. |
| `imports` | `require("module")`, `module("module")`, and `require` guarded by `pcall`/`xpcall`. The module path is a STRING in the tree, so the endpoint may be declared outside this file; `import_based`, and the 0.3% resolution rate is that fact rather than a defect. |
| `references` | A member read WITHOUT calling it: `M.field`, `M:field`, `M["field"]`. The target is the member's own name. This is the closest lua analogue to css's `var(--x)`: the read asserts a dependency on a NAME whose owning module is not written in this file. |
| `exports` | A chunk-scope `return` that NAMES something. Lua chunks are not modules, so the source is the file's global scope — this analyzer's existing convention for `imports` and file-scope `calls` — and no symbol is invented from the filename. |
| `extends` | `setmetatable(D, B)`, the metatable relation, with a table constructor excluded as a target. Lua's only type relation. |
| `implements` | NOT APPLICABLE — see §4. |
| `overrides` | Two distinct constructs under two labels: `lua_redefinition` (the same name declared twice in one chunk, last-wins) and `lua_inherited_member` (a member of D that D also inherits from a base B through `__index`). Never fused. |
| `instantiates` | `Table:new(...)` / `Table.constructor(...)` / `Table.new(...)` where `Table` is a table declared in this file. |

## 3. Verdicts, with the count or the measurement

`EMITTED` = production `parseFile` produced it. `RULED` = a written reason plus a
corpus measurement, with the instrument and the falsifying probe named.

| Type | Verdict | Edges | Files | Where |
| --- | --- | --- | --- | --- |
| `calls` | EMITTED | 57,392 | 2,583 | kong, luvit, luarocks, nvim plugins |
| `uses` | EMITTED (was RULED, wrong) | 133,189 | 2,666 | probe B4 counted 295,019 bare-name reads across 3,116 files before this was written |
| `contains` | EMITTED | 55,320 | 2,500 | every file with a declaration |
| `imports` | EMITTED | 6,601 | 2,161 | 6,927 import entries |
| `references` | EMITTED (was RULED, wrong) | 44,755 | 2,340 | probe B3 counted 198,720 qualified reads across 2,643 files before this was written |
| `exports` | EMITTED (was RULED, wrong) | 5,167 | 2,137 | 5,173 export entries were already published as a LIST; no edge said so |
| `extends` | EMITTED | 171 | 132 | `setmetatable` sites |
| `implements` | **RULED** | 0 | 0 | instrument A — §4 |
| `overrides` | EMITTED (was RULED, wrong) | 66 | 38 | kong 23, luvit 29, luarocks 9, plenary.nvim 1, snacks.nvim 4 |
| `instantiates` | EMITTED | 122 | 65 | `Table:new` sites |

**Total 119,606 -> 302,783 edges, a 2.53x payload increase.** Of the total, 6
edges come from pool-worker's regex fallback rather than this analyzer (§6), so
302,777 are analyzer-produced. The increase is the honest cost of four types that
were previously invisible: `uses`, `references`, `exports` and `overrides` were
all measured present on this corpus before they were emitted. Per §6 of the
workstream this is reported as a payload regression with numbers rather than
quietly absorbed; no budget file was re-baselined.

Four of these ten types were ruled inapplicable at handover and were wrong. The
ruling that was wrong in the instructive way is `overrides`: the lua grammar
produces 100 node types and none of them is `override_specifier` or
`redefinition`, so instrument A is silent here BY CONSTRUCTION — a redefinition
is simply a second `function_declaration`, and a grammar cannot see a repeat.
Only instrument B could falsify that ruling, and it did: 65 occurrences across
37 files.

### 4. The one RULED type: `implements`

- **Instrument: A, grammar inventory.** The pinned grammar produced **100
  distinct node types** across 1,875 corpus files, enumerated with per-type counts
  in `validation/m60/lua/grammar-inventory.json`. **None** of the six node types
  that would express it is among them: `implements_clause`, `extends_clause`,
  `superclass`, `interface_implementation`, `interface_declaration`,
  `trait_declaration`. Lua has no `class` keyword, no `interface` keyword and no
  declaration form for a type at all, so the construct has no grammatical shape
  for an edge to be derived from. This is a fact about the language, not a failure
  to find something.
- **Instrument B, for the relation Lua CAN express.** Probe B6 counted 1,295
  supertype links across 453 files, and every one is the relation `extends`
  already publishes. Probe B8 split them into four buckets over 501 links: 79
  `crossTable` (both sides are declared tables), 45 `derivedIsSelf`
  (`setmetatable(self, …)` inside a constructor), 3 `selfLink`, 374
  `unresolvedBase` (the base argument is an expression — `setmetatable(opts or {},
  defaults)` at kong/kong/api/arguments.lua — so no name is written for it).
  A language with exactly one type relation cannot have a second one. Conformance
  in Lua is duck typing: structural, undeclared, and with no written clause for
  an edge to carry.
- **What would overturn this ruling.** A non-zero count of any of the six node
  types above in the instrument-A artifact — which is what a Lua dialect with a
  `class`/`interface` declaration would introduce. Or a probe finding a
  constructor-like call immediately followed by a conformance test
  (`if type(x) ~= "table" then error(...) end`) at a rate worth an edge. Probe
  B8's `crossTable` bucket is the closest thing to a counter-example this corpus
  contains and it measures 79 links, of which exactly 1 has a member declared on
  both sides.

Instrument A is also recorded as settling `extends`, `instantiates` and
`overrides` — and in the `overrides` row it is recorded as NOT settling them,
because the inventory is silent there. A grammar inventory that claimed to settle
`overrides` would repeat json's `exports` error: a grammar cannot see a
convention, and Lua's inheritance and module surface are both conventions over
ordinary constructs.

## 5. The six questions, per emitted type

**Exists / Fires** are settled by construction for every type in §3: each has a
producing rule in the analyzer and a non-zero production count over 3,250 files.
The `Fires` column that matters is the delta between the probe and the edge count,
because a rule reachable only from a branch that never matches is dead code:

| Type | Probe occurrences | Edges emitted | Ratio | Why the gap |
| --- | --- | --- | --- | --- |
| `uses` | 295,019 | 133,189 | 45.1% | the exclusions: callees are `calls`, declarations are `contains`, writes are neither, receivers belong to `references` |
| `references` | 198,720 | 44,755 | 22.5% | callee members are `calls`; a computed index (`dao[method .. k]`) has no name; a number or variable-held key is not a member name |
| `exports` | 2,335 surfaces | 5,167 edges | — | a surface with N named members yields N edges, so edges exceed surfaces |
| `overrides` | 65 redefinitions (B1) | 65 `lua_redefinition` | 100% | exact match; B1 counts one hit per label, and the corpus's duplicates are all pairs |
| `overrides` | 79 crossTable links (B8) | 1 `lua_inherited_member` | 1.3% | an override additionally requires a member name declared on BOTH tables |

**Correct** — there is NO independent lua oracle. `script/m14/oracles/` has no
`lua.ts` and `script/m14/differential.ts`'s `LANGS` has 27 languages and no lua,
so `--lang lua` measures 0 lanes. Nothing in this lane has been compared against a
second implementation. Every correctness claim here rests on the analyzer plus an
instrument that shares no rule table with it — the probes read the parse tree
directly and the fixtures were authored from the role contracts — and **a grammar
bug shared by the analyzer and a probe would be invisible to both.** Where a
probe was found wrong the probe was corrected and the correction published, not
dropped: B2's single hit was a self-inheritance artifact (§6).

**Labelled** — no neighbouring-label confusion survives on the fixture suite. The
pairs that could be confused and the rule that separates them:

| Confusable pair | Separation, and where it is pinned |
| --- | --- |
| `uses` vs `calls` | a callee is `calls`; `forbidRelationships uses -> …` on every callee site — `lua/name-reads` |
| `uses` vs `contains` | a `variable_list` child is a declaration; pinned at the declaration line AND at the read line — `lua/name-reads` |
| `uses` vs `references` | the head of a qualified name is not read on its own account; pinned for `config` and `helper` — `lua/name-reads` |
| `references` vs `calls` | a member that is a call's callee is `calls`; pinned for `record` — `lua/name-reads` |
| `references` vs a table key | a `field`'s key is a declaration site; pinned for `retries` at the literal — `lua/name-reads` |
| `exports` vs a value | `return "literal"` publishes nothing; pinned — `lua/export-edges` |
| `overrides` vs `extends` | one member shared or not; `Derived.stop` is pinned as NOT an override — `lua/override-shapes` |
| `overrides` vs a metatable | `mt` is a metatable, not a base; resolving its `__index` is the two-hop read — `lua/override-shapes` |

**Resolved** — both endpoints bind to real symbols, per type. The CSS `references`
reference point is 66.8%; lua's is far below it and the reason is the language,
not a defect, but the number is the finding:

| Type | Edges | Both ends resolve | Source resolves | Target resolves |
| --- | --- | --- | --- | --- |
| `contains` | 55,320 | **45.2%** | 25,216 | 55,078 |
| `overrides` | 66 | **18.2%** | 12 | 65 |
| `instantiates` | 122 | **18.0%** | 22 | 122 |
| `uses` | 133,189 | **10.6%** | 33,508 | 54,825 |
| `calls` | 57,392 | **9.8%** | 14,448 | 16,810 |
| `references` | 44,755 | **4.6%** | 9,508 | 10,250 |
| `imports` | 6,601 | **0.3%** | 165 | 677 |
| `exports` | 5,167 | **0.1%** | 4 | 1,774 |

Three separate causes, all measured, none of them a fixable defect:

1. **`global` is not a symbol.** Every file-scope edge is sourced from `global`,
   which is a scope label. That is why `contains` sits at 45.2% despite 99.9% of
   its targets resolving, and why `exports` has 4 resolving sources out of 5,167.
   The convention is pre-existing and load-bearing for `imports` and `calls`.
2. **Lua reads standard library, not the file.** `string.format`, `table.insert`,
   `math.floor`, `ipairs`, `pairs` are members and functions whose declarations
   are in the C runtime and never in any `.lua` file in the corpus. This is the
   whole of `references` at 4.6% and most of `calls` at 9.8%.
3. **`require` returns a name no file declares.** `imports` targets a module path
   string; the module's own file declares symbols, not the path. 0.3% is the
   honest rate for a string endpoint.

**Confident** — `evidenceClass` is on **every** analyzer-produced edge: 302,777 of
302,777. The `absent` bucket in the artifact's per-type tally is exactly the 6
fallback edges of §6 and nothing else. **Zero** analyzer edges fall below 0.7
(the 6 `calls` edges under 0.7 are the fallback's, at 0.4 and 0.5). The mapping is
the css family's (`real-css-analyzer.ts:737`): `structural` where both endpoints
are nodes this parse saw, `usage_contextual` where the link rests on a name in a
value position (`uses`), `import_based` where the endpoint may be declared outside
this tree (`imports`, `references`).

## 6. Defects found by measuring rather than reading

**`web-tree-sitter` returns a fresh wrapper per access, so `===` never matches.**
The `uses`/`references` exclusions were first written as
`parent.namedChild(0) === node`. Every receiver and callee exclusion silently
never fired. Cost: 3 edges on the 15-line fixture `lua/name-reads.lua` that each
state one qualified access twice under two labels, and that fixture dropping from
26 edges to 19 (`lua/export-shapes` 25 -> 16). Fixed by `isSameNode`, which
compares `type` + `startIndex` + `endIndex` — the family's own idiom
(`real-c-analyzer.ts:2336`, `:2525`, `:6012`). Regression-pinned by
`script/m60/mutate-lua-node-identity.ts`, which re-derives the identity comparison
from the fixed source, requires the suite to go red under it (4 forbid rows fail)
and re-verifies the restore.

**`uses`/`references` targets must be the member's own name, not the path.**
`overrides` first put the declaration's label in the target, producing
`labelShape {bare 54, dotted 8, colon 4}` across the corpus while `contains` used
the bare member for the same declaration — so a consumer joining the two edge
types on `(source, target)` would miss. Now `{bare 65, dotted 1}`; the path is
`meta.qualifiedName`. Pinned in `lua/override-shapes`, which forbids
`Derived -> Derived.run`.

**Probe B2's single hit was a false positive, and it was found by reading the
file.** B2 reported `_lmdb.get overrides _lmdb.get` on
kong/spec/01-unit/01-db/11-declarative_lmdb_spec.lua. The source is
`local _lmdb_mt = { __index = _lmdb }` at L76 and `setmetatable(_lmdb, _lmdb_mt)`
at L83 — the derived and the base are both `_lmdb`, so it is self-inheritance. A
self-link still LOOKS like an override. B8 supersedes B2 and keeps the artifact
visible: its `selfLink` bucket measures 3 sites across 3 files. This is the
workstream's named failure mode — a probe matching a shape rather than a role,
the same class as a `["k"] = 1` table key read as a filename — and the lesson
generalises: a probe whose count goes to zero with no explanation is
indistinguishable from one that was quietly widened.

**Probe B7 was also wrong, and its number was not used.** B7 counted 46 "bare
table calls" the `instantiates` rule declines. Every one is a false positive: at
kong/kong/plugins/datadog/handler.lua:84 the callee `get_consumer_id` is a LOCAL
holding a function, which shadows a module table of the same name declared
elsewhere in the file, and the probe matched on name equality with no scope and no
`__call` check — a plain Lua table is not callable at all. `instantiates` is left
at 122 edges. Closing the genuine `__call` construction would need a
role-anchored probe first.

**A grammar-load failure degrades silently, and it is nondeterministic.**
`pool-worker.ts:1148` catches the error and returns `extractFallback`'s output as
`{success: true, errors: [], fallback: true}` — a regex text extractor standing in
for the analyzer, with no way to tell from `errors` that it happened. It fires
under concurrency with `Incompatible language version 0. Compatibility range 13
through 15.` Two runs of the unchanged code over the unchanged corpus reported 7
fallback files / 9 symbols in one and 6 files / 8 symbols in the next. Measured
contribution to this lane: **6 edges and 7 symbols of 302,783 and 83,917**, all
`calls`, all at confidence 0.4–0.5 with no `evidenceClass` — 99.998% of every
number in this document is analyzer-produced, and the artifact tallies the
remainder apart (`production.fallbackProducer`) so none of it is attributed to
this lane. Not fixed here: `pool-worker.ts` is shared (§8).

**The `unknown`-endpoint check was a shape match, and Lua has a variable named
`unknown`.** The first census reported 4 edges with an endpoint equal to the
literal `unknown`. The analyzer never writes that placeholder — kong/kong/router/
utils.lua:300 contains `local unknown = 0` and line 341 `unknown = unknown + 1`,
so the name is real. Analyzer-emitted `unknown` placeholders: **0**.

## 7. Declared limitations

Lua is Turing-complete and dynamically typed. For a language in that class a
blank limitations list would be a defect, so these are the specific things this
analyzer does not do, each with the reason and the measurement where one exists.

1. **No independent oracle.** Every type here is a DERIVATION finding: 9 of 9
   emitted types are stored and compared against nothing. This is the largest
   single limit on every claim in this document. Writing one needs
   `script/m14/oracles/lua.ts` plus a `LANGS` entry and a baseline row — all
   shared (§8).
2. **A binding is not derivable.** `uses` fires on a name read; which binding that
   name denotes — local, upvalue, global, stdlib, or a field of a module this file
   never read — is not written anywhere in the tree. Hence 0.9 and
   `usage_contextual`, and hence the 10.6% resolution rate. Closing it needs scope
   and import resolution, not more reading of the same tree.
3. **`setmetatable(self, …)` is not resolved.** 45 sites across 42 files
   (B8 `derivedIsSelf`). The derived table is only reachable by evaluating the
   constructor, and nothing in the tree says which table it returns. This is why
   `lua_inherited_member` measures 1 edge against 79 inheritance links.
4. **An expression base is not resolved.** 374 sites across 218 files (B8
   `unresolvedBase`), e.g. `setmetatable(opts or {}, defaults)`. No name is
   written, so no edge target could be.
5. **Inheritance is a convention, not a keyword.** `extends` and `overrides` read
   `setmetatable`/`__index`. A table that inherits by some other runtime mechanism
   — a C library's metatable, `class()` from a third-party module — is not seen.
   `class("Name")` calls are recognized as a class DECLARATION (a symbol) but the
   library's own inheritance convention is not inferred.
6. **The module surface is only what a chunk-scope `return` names.** The four
   shapes that carry no written name stay silent and are recorded in
   `ctx.unpublishedSurface` as a disclosure: `return require("x")` (a re-export),
   `return "literal"`, `return function() end`, and a positional `return {1,2}`.
   Naming any of them would mean inventing a name.
7. **Aliasing and metaprogramming are invisible.** `local alias = M.run` then
   `alias()` is a `calls` edge to `alias`, not to `M.run`. Joining it requires the
   alias table this analyzer does not build. Same for
   `for k, v in pairs(M)` and any table key read through a computed index.
8. **No module identity.** A Lua chunk is not a module, so file-scope edges are
   sourced from `global` and no symbol is named after the file. That is why
   `exports` resolves 4 of 5,167 sources, and it is a deliberate refusal to
   fabricate rather than a gap.
9. **Cross-file resolution is not attempted.** Every endpoint is resolved against
   the symbols of ITS OWN file, which is why `imports` sits at 0.3%. A store-level
   join would be a different measurement.
10. **Parser health.** 4 files of 3,250 report a parse error and 3 files contain
    ERROR nodes (18 nodes, 1 missing node) — measured by
    `validation/m60/lua/grammar-inventory.json` over its 1,875-file draw, and the
    census's own figures for the full draw. These are recorded, not suppressed.

## 8. Verification

- Fixtures: `validation/m14/fixtures/lua/` — 9 fixtures, **96 assertions, 0
  failing**, run by `npx tsx script/m60/run-lua-fixtures.ts`. Six predate this
  wave and three are new (`name-reads`, `override-shapes`, `export-edges`).
- Mutant: `npx tsx script/m60/mutate-lua-node-identity.ts` — the node-identity
  mutation is CAUGHT (4 forbid rows fail) and the restore is re-verified.
- Census: `npx tsx script/m60/lua-ontology-census.ts --full` ->
  `validation/m60/lua/ontology-census.json`. Three instruments that share no rule
  table: production counts through `parseFile`, instrument A, instrument B.
- Instrument A: `npx tsx script/m60/lua-grammar-inventory.ts` ->
  `validation/m60/lua/grammar-inventory.json` (the full 100-type vocabulary with
  per-type counts, and per ruled type the node types that would mean it exists).
- Also in `script/m60/`: `lua-fallback-probe.ts` (the degraded-parse question),
  `lua-overrides-check.ts` (the emitted `overrides` edges against the lines probes
  B1/B2 named), `lua-parse-flap.ts` (is the parse failure a file defect or a
  race — run it with `BB_FLAP_ROUNDS` lowered; 12 rounds exhausts the 4 GB heap
  because the wasm pool is not freed between passes).
- Complexity: one iterative AST walk, plus three whole-file pre-passes
  (`collectErrors`, `collectDeclaredTables`, `collectSupertypeLinks`). Relationship
  identity uses a set; declaration, owner and member decisions read the current
  frame and pre-pass maps. No per-symbol scan of the symbol or relationship
  arrays and no O(n²) resolution path. `uses` and `references` add two constant
  work per node, and the census records the production cost: 142,252 ms for 3,250
  files through `parseFile` at 8-way concurrency.

## 9. Symbols

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `local name = value` | `variable` | `variable_declaration` -> `assignment_statement`, simple identifier |
| `name = value` | `variable` | module-level `assignment_statement`, simple identifier |
| `function name(...)` | `function` | `function_declaration` whose name field is an identifier |
| `function Table.method(...)` | `method` | name is a `dot_index_expression`; the table is the owner |
| `function Table:method(...)` | `method` | name is a `method_index_expression`; the table is the owner |
| `local function name(...)` | `function` | the same declaration carrying a `local` token |
| table-valued declaration | `variable` with table metadata | RHS is a `table_constructor`; field keys come from AST fields |
| `class("Name")` | `class` | a library class declaration call |

83,917 symbols over the 3,250-file draw: 74,873 `variable`, 4,810 `method`,
4,225 `function`, and 9 with kind `undefined` — all 9 from pool-worker's regex
fallback (§6), none from the analyzer. **0 empty names.** Function parameters
retain identifier/vararg information; ranges are byte-precise from the
declaration node. Function-local variables are emitted as scoped variables;
parameters, anonymous function expressions, field/index mutations and local
reassignments are not declarations. No synthetic Love2D hooks, anonymous
coroutine symbols, or anonymous table classes are generated.

An analyzer regex census reports **0 regexes** in `real-lua-analyzer.ts`; every
rule reads the AST.
