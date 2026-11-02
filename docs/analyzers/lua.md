# lua.md

M14 ontology workstream, lua. **Wave 3 — the INCOMING pass.** Waves 1 and 2
established the ten verdicts and audited the outgoing edges. This pass measures the
other half: what a lua declaration is *reached by*, and whether the graph can walk
TO it. It adds **LUA-52** (a 0.95 edge claiming the wrong evidence tier, 2 edges),
**LUA-53** (270 declarations the analyzer publishes and pool-worker then deletes, 778
edges pointing at them — shared machinery, reported not edited), and **two defects in
this lane's own instruments**, one of which had been manufacturing false externals on
the largest bucket in the measurement. It also found that **10 of this lane's scripts
pinned the main checkout by absolute path, so their gates had never executed.**

Verdicts are unchanged: **9 EMITTED, 1 RULED**, gate exit 0, 0 FALSIFIED (§3.3). **REVISED 2026-10-26:** with the extended vocabulary the emitted set is **TEN** (`decorates` implemented at R3, corpus-rare at 1 edge) and **FOUR** values are ruled (`implements` grammar-absence; `part_of`, `renders`, `mixes_in` ontological) — see the canonical Relationship ontology at the top of this page and the spec's `BD-extended`. The §3.1 table below is the pre-extended measurement and is kept as its own record.

**The three waves are interleaved by section, not separated by one.** A `<details>`
wrapper was tried here and removed: it was never closed, so it swallowed the whole
document when rendered, and it could not have separated the waves anyway — §4 carries
LUA-46..49 (wave 2) next to LUA-52/53 (wave 3) because both are defects found by
measuring, and §6's tables are single-run figures that no wave's numbers reproduce.
**Read §5 before quoting any count**, and §3.1 for why the table was rebuilt rather than
edited. The per-wave history, in order:

- **Wave 1** established the ten verdicts and was merged.
- **Wave 2 — the adversarial pass** re-ran wave 1's own claims and found **four defects in
  the analyzer** the suite was green over (LUA-46, LUA-47, LUA-48, LUA-49) and **four in
  the lane's own oracle** (ORA-5..8), plus a shared-machinery defect in the arbiter that
  measures the wrong grammar for lua (§3.3). It built the ruling table and ran the arbiter
  with the wiring applied: 9 EMITTED, 1 RULED-SOUND, 0 FALSIFIED, exit 0.
- **Wave 3 — this pass** added LUA-52 (a 0.95 edge claiming the wrong evidence tier, 2
  edges), LUA-53 (a flag four call sites passed that no output could depend on, with 37
  suppressed edges measured and declared), the correction of §3.1's table, and the
  discovery that **three of this lane's own gates had never reported a verdict** — one
  because it did not parse, one because it expected 6 of 12 committed fixtures, one
  because it reported six false positives against correct analyzer code.

Every number here is reproducible from the scripts named in §9. All production
counts come from `parseFile` in `src/ast/pool-worker.ts` — the production entry
point, not `analyze()`, which skips the pool-worker stages.

**Read §5 before quoting any count from this document.** `parseFile` is not
deterministic: two runs over a provably identical draw of all 3,252 corpus files
disagree, and §5 names the 12 files responsible. Every total here is a
single-run observation with its sibling run beside it.

## Language

- **Analyzer file:** `src/ast/real-lua-analyzer.ts` — one class, `RealLuaAnalyzer`, implementing
  `ASTEngine.LanguageAnalyzer`; pure AST extraction, no regex fallback (see Regex inventory).
- **Parser:** `tree-sitter-lua` served as `wasm/tree-sitter-lua.wasm` — sha256
  `9ebb71c0a6acc4791ba7b46624900584024646af2ac9c3c036775c7e5c937f3a`, 50,917 bytes (the pin in
  `script/m14/spec/lua-completeness.json`). The engine resolves it through
  `resolveWasm("tree-sitter-lua/tree-sitter-lua.wasm")` with the `@tree-sitter-grammars/tree-sitter-lua`
  spec as the fallback spelling (`src/ast/engine.ts:1124-1128`); the grammar package the lane records
  is `@tree-sitter-grammars/tree-sitter-lua` 0.4.1 (§1).
- **Served vocabulary:** 137 node-type ids, 54 named slots = **46 unique named types** + 80 anonymous
  keyword/punctuation literals, measured on the served build's own `Language` object
  (`validation/m60/lua/grammar-inventory.json`; the served digest rides in
  `validation/m14/measurements/lua-extended-census.json` as `grammar.servedDigest`). The corpus
  produces 100 distinct node types across the draw (§1's instrument A).
- **Parse isolation, and it is Lua-only:** the engine does not use the shared cached parser for this
  language. Each parse builds a **private `Parser` + `Language` from fresh bytes**
  (`src/ast/engine.ts:1666-1682`), because lua's WASM binding's external-scanner state otherwise leaks
  from one file into the next. That is a fixed per-file cost paid for correctness, not an optimization
  miss.
- **Language detection:** `.lua` → `lua`, one spelling (`src/ast/language-detection.ts:167`, the
  ROUTER'S ONE TABLE). The whole-population arm prints its own scope line: `admitted extensions = .lua
  … (ONE spelling)`. The M12 corpus sweep separately listed `*.luau` in ITS OWN harness selector
  (`validation/m12/results/lua-corpus-errors.json` `extensions`); the production router admits no
  `.luau`, and that harness list is not a claims source for admission.
- **Wired in:** `src/ast/engine.ts getAnalyzer` → `case "lua"` → `RealLuaAnalyzer`
  (`src/ast/engine.ts:2397`); the wasm branch is `:1124`.
- **The only transcribed non-AST inputs:** the Lua 5.4 standard-library name lists
  `LUA54_TABLES` (the eight manual §6.1 tables) and `LUA54_GLOBALS` (the 26 basic-library functions).
  They are used only to attach an `external` claim, and the claim is never folded into `resolved`.
- **The corpus this page measures:** **3,255 admitted `*.lua`** under `$PWD/.corpus`, **git-TRACKED
  only**, **20 repositories** carrying an admitted file, 2 tracked-but-absent paths excluded, 0 over
  the 1 MiB cap — the whole-population arm of 2026-10-26
  (`validation/m14/measurements/lua-gate-whole-population-2026-10-26.txt`). Earlier waves drew
  3,250 / 3,252 from the same predicate and keep their own draw digests in the journal (§1, §5, §7a);
  a number from those runs is quoted with its draw, never merged with the 3,255 population.

## Symbol contract

Lua has no class or type declaration, so the extraction rules are about **which AST node binds a name**
and **which does not**. The journal's §10 is the measured census (83,745 symbols over the 3,252-file
draw: 74,701 `variable`, 4,810 `method`, 4,225 `function`, and 9 with kind `undefined` all from
pool-worker's regex fallback — 0 from the analyzer; **0 empty names**).

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `function_declaration`'s `name` field: a bare `identifier` is the function's own name; a `dot_index_expression` / `method_index_expression` is a member and the **field** is the name (`function M.foo` → `foo`, LUA-13/LUA-15). `variable_declaration` / `assignment_statement` `variable_list` children that are plain identifiers bind variables. A library-class call (`class("Name", …)`, `Object:extend("Name")`) publishes the string as a `class` symbol. |
| kind | ✅ | `Function` (`function_declaration`, including `local function`), `Method` (a `dot_index_expression`/`method_index_expression` name — receiver ⇒ method), `Variable` (local, global, table-valued), `Class` (library-class branch only; constructible, corpus-unexercised — the measured census has none, §10). Function-local variables are `Variable`; parameters, closures, field/index mutations and local re-assignments are not declarations. |
| qualified/container name | ✅ | `qualifiedName` on function/method symbols is the full written path (`M:add_item`, LUA-37), and `metadata.qualifiedName` / `metadata.ownerTable` carry it too. Identity, however, is container + **own name** (LUA-15): an edge target is never the path, so `contains` and `overrides` join on `(M, add_item)`. |
| ownerName / ownerKind | ✅ | `ownerName` is the **written receiver** of `function a.b` / `function a:b` — a name a consumer can resolve (LUA-37) — or the enclosing function's own symbol name (`frameSelfName`); it is never the scope LABEL (`Buffer:initialize` as a scope is a label, and filing `initialize` under it produced owners that resolved to nothing on 22.6% of `contains` sources). `ownerKind` = `Class` when a receiver was written, `Function` for a declaration scoped to a body. |
| range (start/end line + column) | ✅ | `nodeToRange` on the declaration node, 1-based. Synthesized `contains` edges carry the symbol's own declaration line rather than inventing one (LUA-01). |
| parameters | ✅ (limited) | On function/method symbols, `parameters` from the `parameters` node: `identifier` ⇒ `{ name, type: "Any" }`, `vararg_expression` ⇒ `{ name: "...", type: "Any", isVariadic: true }`. Lua has no static types, so `type` is the literal `"Any"`: the field states PRESENCE, not inference. PARAMETERS ARE NOT SYMBOLS — a parameter is a binding, not a declaration (the fleet's negative contract), and the walk records them for scope only. |
| returnType / type | ⛔ | Lua has no static return types and no declaration types; the analyzer publishes no `returnType`, and the result metadata states `hasTypeInference: false`. A `class(…, Parent)` argument is a RELATIONSHIP (`extends`), never a type field. |
| documentation/comments | ⛔ | No docstring extraction. The grammar's `comment` / `comment_content` nodes produce no symbols and no doc field. The `---@` forms are COMMENTS, not annotations: the whole-population extended census counted **19,082** annotation comment nodes and 0 `attribute` nodes (`validation/m14/measurements/lua-extended-census.json`), which is why `decorates` could not be built from them (see Relationship ontology). |
| complexity metrics | ✅ (result-level) | The result's `metadata` carries `complexity` (symbols + relationships), `linesOfCode`, `cyclomaticComplexity` (computed from the tree), `relationshipDensity`, `retainedRowKb`, `coroutineUsage` (counted from the calls the walk actually saw — LUA-02), `architecturalScore`, `codeQuality`. There is no per-symbol cyclomatic number, and the block is dropped at the pool-worker boundary (LUA-03), so read it from `lua-analyzer-direct.ts`, not from `parseFile`. |
| syntax errors | ✅ | `collectErrors` walks the tree once and pushes every `ERROR`/`MISSING` node into `result.errors` with a range and `severity: "warning"` (`src/ast/real-lua-analyzer.ts:2837`). The M12 corpus sweep read **0 error files / 0 error nodes / 0 crashes** over luvit's 199 files (`validation/m12/results/lua-corpus-errors.json`). |
| decorators/attributes | ⛔ (as a symbol field) | The language has no annotation syntax, so there is no symbol field to extract. Lua 5.4's `<const>` / `<close>` **`attribute` production** is a compile-time modifier that names a keyword — no decorator value exists and nothing is applied at run time. `decorates` is a RELATIONSHIP emitted from the runtime application idiom (`X = f(X)`); see the ontology row. |

## Relationship ontology

The vocabulary is the fleet's 14 values (`src/ast/types.ts`). Lua's emitted set is **ten**; four values
are **ruled**, each with a population and an instrument-counted falsifier
(`script/m14/spec/lua-completeness.json` BD-extended; census artifact
`validation/m14/measurements/lua-extended-census.json`). Each emitted row names the node/field it reads,
the confidence and `evidenceClass` it carries, and its whole-population edge count from
`validation/m14/instruments/lua/incoming-declaration.json`.

| type | emitted? | how resolved | confidence model |
| --- | --- | --- | --- |
| `calls` | yes — `function_call`'s `name` field; target is the callee's OWN name (final segment), source is the enclosing function label or `global`; a computed-index callee publishes nothing (LUA-22) | target matched by name against the file's own declaration table; 57,512 edges over the whole population | 1.0 `structural`; pool-worker's regex fallback, when it fires (12 named files, §5), contributes 0.4/0.5 edges with no `evidenceClass` and is counted apart |
| `uses` | yes — a BARE name read as a value: not a callee, not a member field, not an assignment target (LUA-46/47) | name-based against the file's own symbols; `labelShape` is `{bare}` by construction; 55,031 edges | 0.9 `usage_contextual`, `lua_name_read`: the node proves a READ, the binding it denotes is written nowhere (§6) |
| `contains` | yes — synthesized from symbol pairs: owner → the declaration's own name; the source is a resolvable name (`ownerName`, else the enclosing function's own name, else `global`), never the scope label (LUA-37) | owner/member identity, so the edge joins the symbol it names; carries the declaration's own line (LUA-01); 55,369 edges | 1.0 `structural` |
| `imports` | yes — `require("m")` / `module("m")` and `pcall`/`xpcall`-guarded `require`; the target is the module-path STRING, not a declaration | cannot resolve as a symbol by construction; carries `metadata.importProjectFile` when the shared file guard confirms the project carries the file (LUA-55); 6,605 edges | 1.0 `import_based`, `lua_require` |
| `references` | yes — a member READ: `M.f`, `M:f`, `M["f"]`; a call is not a read and a write is not a read (LUA-46) | target is the member's own name; 40,065 edges | 0.9 `import_based`, `lua_member_read`: the member may be declared in another file |
| `exports` | yes — a chunk-scope `return` that NAMES something (`return M`, `return { a = 1, ["b"] = 2 }`, `return setmetatable(M, mt)`); the source is the file's global scope | a Lua chunk is not a module, and inventing a module symbol from the filename would fabricate one; four nameless return shapes stay silent as a disclosure (`unpublishedSurface`); 5,171 edges | 1.0 `structural`, `lua_module_return` |
| `extends` | yes — two conventions, never fused: (a) `setmetatable(D, B)` / `setmetatable(D, {__index = B})` / `D.__index = B`; (b) a factory whose own `parameters` node declares a supertype-role parameter AND whose body folds it into a `__`-prefixed metamethod (LUA-51) | (a) both names are written at the call site; (b) both names written, the ROLE is the convention; self-links and table-constructor bases excluded (LUA-48); 171 edges | (a) 1.0 `structural`, `lua_metatable`; (b) 0.95 `usage_contextual`, `lua_factory_supertype` |
| `overrides` | yes — two constructs under two labels: `lua_redefinition` (the same name declared twice in one chunk; last wins) and `lua_inherited_member` (a member D declares that D also inherits through an `__index` chain) | redefinition from the declaration sequence; inherited member from the intersection of the two member sets over a supertype link; 67 edges (65 + 2) | redefinition 1.0 `structural`, `lua_redefinition`; inherited member 0.95 `usage_contextual`, `lua_inherited_member` (a convention, so not `structural`) |
| `instantiates` | yes — `Table:new(…)` / `Table.new(…)` / `Table.constructor(…)` where `Table` is a table this file declares | the constructor table is read from the file's own declaration pre-pass (order-independent); 122 edges | 1.0 `structural` |
| `implements` | no — RULED, `grammar-absence` (BD-implements): the served grammar produces 100 distinct node types and none of the six that would express a conformance clause (`implements_clause`, `extends_clause`, `superclass`, `interface_implementation`, `interface_declaration`, `trait_declaration`); Lua has no class/interface declaration and conformance is duck typing, written down nowhere | — (0 edges; falsifier: any of those six node types appearing in the inventory) | — |
| `decorates` | yes — R3, the runtime application idiom: a CHUNK-scope `X = f(X)` where X is a declared function and f is a declared WRAPPER FACTORY (its own body returns a function — the structural discriminator that separates it from 185 value-transform rebindings) | edge is decorated declaration → decorator (`fib -> cache`); 1 edge over the whole population — IMPLEMENTED AND CORPUS-RARE, pinned by `lua/decorator-application` (fire + 6 forbid arms) | 0.95 `usage_contextual`, `lua_decorator_application`: the application is a real call site; that it is a DECORATION is the convention |
| `renders` | no — RULED, `ontological`: 90 render-named calls measured; the 8 whose argument names a declared table are DATA (`template_env`, `buffer`, `extmarks`, chat/prompt templates), never a component symbol; 0 `html(function()…end)` host sites; no component/template production in the grammar | — (falsifier counted: `renders.renderComponentSites` = 0; a component production = 0) | — |
| `mixes_in` | no — RULED, `ontological`: 3 `include` method calls measured — 2 bare local helpers and lapis's own `self:include(other_cls.__parent)`; STRUCTURAL mixin sites (receiver class-like AND argument a class-like symbol): 0; no mixin/with/trait production in the grammar | — (falsifier counted: a structural include site = 0). The lapis `Widget:include` convention is the NAMED near miss: R3-expressible, not exercised with named endpoints | — |
| `part_of` | no — RULED, `ontological`: 6,998 loader sites (require 6,926 · load 32 · loadfile 28 · loadstring 10 · dofile 2) and every loader evaluates into a NEW chunk, so the contract's "shares the library's single scope" fails on every site; no include/splice production in the grammar | — (falsifier counted: a node type whose parse tree makes the included file's declarations children of the including chunk = 0) | — |
| `lua_require` | yes — the `metadata.relationshipType` label ON the `imports` edge (`addImport`, LUA-55) | same resolution as `imports`; the label is how a consumer tells a module load from any future import kind | inherits `imports`: 1.0 `import_based` |
| `lua_name_read` | yes — the label ON the `uses` edge (`emitNameRead`) | same resolution as `uses` | inherits `uses`: 0.9 `usage_contextual` |
| `lua_member_read` | yes — the label ON the `references` edge (`emitMemberRead`) | same resolution as `references` | inherits `references`: 0.9 `import_based` |
| `lua_module_return` | yes — the label ON the `exports` edge (`extractExport`) | same resolution as `exports` | inherits `exports`: 1.0 `structural` |
| `lua_metatable` | yes — the label ON the `setmetatable`/`__index` `extends` edge | same resolution as `extends` (a) | inherits: 1.0 `structural` |
| `lua_factory_supertype` | yes — the label ON the factory-argument `extends` edge (LUA-51) | same resolution as `extends` (b) | inherits: 0.95 `usage_contextual` |
| `lua_redefinition` | yes — the label ON the same-chunk redefinition `overrides` edge | same resolution as `overrides` shape 1 | inherits: 1.0 `structural` |
| `lua_inherited_member` | yes — the label ON the inherited-member `overrides` edge (LUA-52) | same resolution as `overrides` shape 2 | inherits: 0.95 `usage_contextual` |
| `lua_decorator_application` | yes — the label ON the `decorates` edge | same resolution as `decorates` | inherits: 0.95 `usage_contextual` |
| `externalClaim` | yes — an ADDITIVE claim on a `calls` or `references` edge whose target is a field of one of the eight documented Lua 5.4 tables (`lua54-stdlib`, with `externalReceiver`) or a bare documented global (`lua54-global`), only when this file declares no symbol under that name at or before the edge's line (LUA-54) | the arbiter verifies it against the corpus; a claim is never folded into `resolved` (LUA-54's 3,525 marked edges: 1,081 verified, 0 refuted, 0 unverifiable) | inherits the carrier edge's confidence; the claim is `metadata.external: true` beside `evidenceClass` |

## Supported constructs

Each bullet names the construct and the fixture that pins it (`validation/m14/fixtures/lua/`). All 16
fixtures run green under the shared runner (`bun script/m14/run-fixtures.ts --lang lua` → 16 pass / 0
fail).

- **Chunk structure and symbols:** `local`/global variables, table constructors and their fields,
  `function name`, `function Table.method`, `function Table:method`, `local function`, library-class
  declarations (`class("Name")`, `Object:extend("Name")`) — `local-declarations`, `read-classes`,
  `closure-scope`.
- **Calls and callee shapes:** plain calls, dot and colon member calls, computed-index callees (which
  publish nothing), `pcall`/`xpcall`-guarded require — `callee-shape`, `edge-lines`.
- **Reads:** bare-name reads (`uses`) vs member reads (`references`) vs calls, with the write/read and
  field/bare separations pinned — `read-classes`, `name-reads`.
- **Modules:** `require`, `module`, the file claim on a module path, and the five named export shapes
  (identifier, table literal with identifier/string keys, `setmetatable(M, mt)`; the four nameless
  shapes silent) — `export-edges`, `export-shapes`.
- **Types by convention:** `setmetatable(D, B)` / `{__index = B}` / `D.__index = B` / factory supertype
  argument; redefinition and inherited-member overrides — `extends-supertype`, `override-shapes`,
  `order-independent-ctor`.
- **Decorator idiom:** a chunk-scope `X = f(X)` where X is a declared function and f a declared wrapper
  factory — `decorator-application` (fires `fib -> cache`; forbids the value-transform class, the
  in-function rebinding, a non-self-application, the reversed direction, and a `structural` tier on the
  0.95 edge).
- **Scope and bindings:** closures inherit the enclosing locals (LUA-21), for-clause bindings are scoped
  to the loop and a later assignment is not a declaration (LUA-49), loop variables are deliberately not
  symbols (limitation 14) — `closure-scope`, `loop-bindings`.
- **Standard library:** the `external` claim on the eight documented tables and the 26 documented
  globals, pinned both ways — `stdlib-external`, `stdlib-globals`.
- **Explicitly NOT constructs** (declared, not silently dropped): `implements` (ruled), annotations (a
  comment is not an annotation), `<const>`/`<close>` attributes (a compile-time keyword, not a
  decorator), `for`-loop variables as symbols, aliasing and metaprogramming (limitation 10), and the
  four nameless export shapes (limitation 9).

## Regex inventory

**Zero regex literals in `real-lua-analyzer.ts`.** Two independent instruments:

| Line | Regex | Receiver category | Classification | Justification |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | `real-lua-analyzer.ts` contains no regex literal: every rule reads tree-sitter node types, fields and positions. The only `/…/`-looking text is prose inside comments. |

- `validation/m12/results/regex-census.json`: **50 analyzers scanned, `totalRegexUsages: 0`**, and no
  per-file entry names `real-lua-analyzer.ts`.
- `bash script/m14/no-regex-gate.sh` (AST-based census over HEAD blobs): **48 analyzers in scope, 6
  regex literals fleet-wide, ZERO in `real-lua-analyzer.ts`**.
- The journal's §9 row records the same reading at its own commit and adds the historical note that
  the only `/…/`-looking text was inside a comment; on HEAD the census finds no literal at all.

## Complexity envelope

One documented run exists for this analyzer, in `validation/m12/results/lua-corpus-complexity.json`
(the production `parseFile` path with the isolated Lua parser lifecycle):

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lua-corpus-tracked — kong @ `94b6c29509f6` | 1,309 | 51,869 | 58,680 | 210,049 | 246.9 | 279.4 | 361,639,936 B (≈345 MiB) |

The M12 artifact records 2 parse errors on that draw and no declared wall budget; it is the one row
with a stored artifact, and it is a **single-repository** run (kong) rather than the 20-repo population.

The whole-population **arm** of 2026-10-26 is the other measured cost point, from the gate's own
progress lines: `2000/3255 parsed (0 failed, 0 degraded) 93s` and `parse failures: 0 · degraded (regex
fallback): 0` (`validation/m14/measurements/lua-gate-whole-population-2026-10-26.txt`). That is the
gate path (parse + relationship derivation + resolution) and includes the per-file WASM-isolation cost;
the two figures are different instruments over different populations and are never averaged.

- **Hot-path audit:** one **iterative AST walk** (explicit stack, no recursion over the tree), plus five
  whole-file **pre-passes** — `collectErrors`, `collectDeclaredTables`, `collectSupertypeLinks`,
  `collectFactorySupertypeLinks`, `collectDecoratorFacts` — each O(nodes). Relationship identity is a
  `Set` keyed `(type, source, target)`; owner/member decisions read the current frame plus pre-pass
  maps. **No per-symbol scan of the symbol or relationship arrays and no O(n²) resolution path.** The
  two convention readers (`lua_factory_supertype`, `lua_inherited_member`) are map lookups, not scans.
- **Cost of the parse isolation:** one `Language.load` + `Parser` construction per file
  (`src/ast/engine.ts:1666-1682`) — a constant per-file overhead, not growing with file size.

## Differential ground truth

Two different instruments are often both called "the differential". Lua is covered by one of them.

- **M12 per-analyzer differential — PRESENT, small and hand-audited.**
  `validation/m12/ground-truth/lua.json` (`truthSource: "manual_audit"`) over two fixture files
  (`validation/m12/fixtures/lua/{Module,Negative}.lua`), compared by
  `validation/m12/results/lua-differential.json`: **41 expected / 41 true positives, 0 FP, 0 FN,
  0 unknown, 0 unsupported; precision 1.0, recall 1.0**; `passed: true`. Naming note: the identity
  contract keys relationship facts by `file:type:sourceId:targetId` with `attributes = { type }` only,
  so this measures extraction, not naming noise.
- **M14 shared differential — ABSENT for this language, and it is a GAP, not a pass.**
  `script/m14/differential.ts`'s `LANGS` has **no `lua` entry**, so `npx tsx script/m14/differential.ts
  --lang lua` measures **0 lanes**. Against that harness every lua type is a DERIVATION finding
  (spec `BD-no-oracle`). Closing it needs a `LANGS.lua` entry plus a baseline row in the shared file —
  a Lead-owned instrument, so it is reported here rather than edited.
- **The lane's own truth oracle — PRESENT, with a stated coverage boundary.**
  `script/m60/lua-truth-oracle.ts` derives truth from the **parse tree**, not from the analyzer's output,
  and diffs both directions. It audits **6 of the 10 emitted types** — `calls`, `contains`, `extends`,
  `instantiates`, `imports`, `exports` — at **0 missing / 0 unexplained** over 4 repositories
  (603 files, 60,142 truth edges; results in `validation/m60/results/lua-truth-oracle-{kong-400,luvit}.json`,
  journal §6). The **4 unaudited types are `uses`, `references`, `overrides`** (never derived by the
  oracle) **and `decorates`** (added after the oracle's last run; corpus-rare at 1 edge, pinned only by
  its fixture). This is a real limit: both defects the lane found in the read classes (LUA-46/47) sat in
  the unaudited set, and the oracle reported identical per-label verdicts before and after their fix
  because the defect was outside its coverage.
- **Mutation and invariants:** 16 fixtures green; 14 lane mutants across 7 mutation scripts (evidence
  tier, extends supertype, read classes, bindings, node identity, export shapes) all caught with clean
  restores; `verify-lua-evidence-tier.ts` reads 0 edges missing a tier and 0 sub-1.0 edges claiming
  `structural` (journal §9).

## Corpus validation

**Population of record:** the whole-population arm of 2026-10-26, one process over the admitted set
(`validation/m14/measurements/lua-gate-whole-population-2026-10-26.txt`; declaration derived by
`script/m14/sliced-declaration.ts` into `validation/m14/instruments/lua/incoming-declaration.json`).

- **Scope:** `3,255 parsed of 3,255 sampled (corpus has 3,255 .lua files across 20 repos)`, git-TRACKED
  set, 2 tracked-but-absent excluded, 0 over the 1 MiB cap; **parse failures 0 · degraded 0**.
- **Edges:** **220,114**, closing exactly: **137,508 resolved + 7,101 external + 45,818 ambiguous +
  29,687 otherUnresolved + 0 unclassed**. `extFAIL` / `bindFAIL` / `causeFAIL` all **0**. The five
  buckets are a declared coarsening of the eleven-term closure; every row publishes both, and every row
  closes on both with `unclassed: 0`.
- **Per-type rows** (from the declaration; `otherUnresolved` coarsens the unresolved/binding/cause
  terms):

| type | edges | resolved | external | ambiguous | otherUnresolved | unclassed |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | 57,512 | 25,323 | 3,153 | 18,600 | 10,436 | 0 |
| `uses` | 55,031 | 41,231 | 56 | 10,413 | 3,331 | 0 |
| `contains` | 55,369 | 55,369 | 0 | 0 | 0 | 0 |
| `imports` | 6,605 | 720 | 3,851 | 240 | 1,794 | 0 |
| `references` | 40,065 | 12,283 | 41 | 14,738 | 13,003 | 0 |
| `exports` | 5,171 | 2,275 | 0 | 1,821 | 1,075 | 0 |
| `extends` | 171 | 118 | 0 | 5 | 48 | 0 |
| `implements` | 0 | 0 | 0 | 0 | 0 | 0 |
| `overrides` | 67 | 66 | 0 | 1 | 0 | 0 |
| `instantiates` | 122 | 122 | 0 | 0 | 0 | 0 |
| `decorates` | 1 | 1 | 0 | 0 | 0 | 0 |
| `renders` | 0 | 0 | 0 | 0 | 0 | 0 |
| `mixes_in` | 0 | 0 | 0 | 0 | 0 | 0 |
| `part_of` | 0 | 0 | 0 | 0 | 0 | 0 |

- **Seven wall cause-rulings** are derived with the declaration, each with a population and a
  `{run, wouldFail}` falsifier (`calls`, `uses`, `imports`, `references`, `exports`, `extends`,
  `overrides`). The largest single wall is stated rather than waved at: the ambiguity is INSTRUMENT
  SCOPE over a bare-name key space — the lane's lexical instrument splits its multiSymbol population
  into B1_lineSettled 94,398 · B2b_fileAbsent 63,881 · B2c_noneVisible 5,111 ·
  **B3_indistinct 193 (0.12%)**, the only class the published name genuinely cannot separate
  (journal's appended incoming record; spec `BD-ambiguity-full`).
- **Fixtures:** `bun script/m14/run-fixtures.ts --lang lua` → **16 pass / 0 fail**, baseline gate: no
  regressions. The lane's earlier runner (`script/m60/run-lua-fixtures.ts`) is retained in the journal
  history (§9) where the shared runner's export invariant was still red for Lua.
- **The M12 corpus sweep** (a different, single-repository instrument): luvit 199 files / 3,724 symbols
  / 7,025 relationships, **0 error files / 0 error nodes / 0 crashes**
  (`validation/m12/results/lua-corpus-errors.json`).
- **Two disclosures, not defects:** 133 files "hold CONTENT AND RETURNED NOTHING" — the gate's own
  counter cannot tell comments/empty bodies (population complete) from a hole without reading them, and
  the analyzer's declarations are in the journal's §5; and `parseFile` is not deterministic on 12 named
  files (§5), so a count from an individual journal run carries its run.

---

**The lane journal follows from here — it is the measured evidence this summary rests on and is kept
verbatim.** §1 wiring and draw; §2 what each type means in Lua; §3 verdicts (the pre-extended era's
"9 emitted, 1 ruled" table, superseded by the ten/four count above); §4 LUA-46…LUA-55, the defects
found by measuring; §5 the 12 nondeterministic files; §6 the six questions and the oracle's blind spot;
§7 the DERIVATION debt; §8 declared limitations; §9 verification; §10 symbols; and the appended
incoming-pass record. **Where the journal and the canonical summary disagree, the summary is the
current measurement and the journal row carries its date.**

## 1. Language and wiring

- Analyzer: `src/ast/real-lua-analyzer.ts`
- Parser: `tree-sitter-lua` WASM at `wasm/tree-sitter-lua.wasm`
- Grammar: `@tree-sitter-grammars/tree-sitter-lua` 0.4.1
- Corpus: `$HOME/fixtures/repositories`, **3,252 tracked `*.lua`
  files** across 19 repos, every one parsed through `parseFile`. Not a sample: the
  draw predicate is `git ls-files '*.lua'` per repo, sorted, no cap, so the file
  set is identical on every machine. Every run records a `drawDigest` over
  `repo \t path \t byte-length` and all 16 shards of all four runs in this document
  agree on `c990daa339a9…`. Largest repos: kong (1,312 files, 26,183 `calls`
  edges), nvim-lspconfig (863), luvit (199), luarocks (162), snacks.nvim (141).

## 2. What each relationship type means IN LUA

Not the general meaning of the ten labels — what each one can carry when the
language is Lua, which is what makes nine of them applicable and one not.

| Type | Meaning in Lua, and where the construct is written |
| --- | --- |
| `calls` | A `function_call`'s `name` field. The TARGET is the bare callee name — `create` for `coroutine.create`, never the path. The SOURCE is the enclosing function label, or `global` at file scope. |
| `uses` | A **bare** name this scope reads as a value. Since M60 LUA-47 this is exclusively bare names: `labelShape` is `{bare: 54,829}` over the whole corpus, with no dotted, colon, payload or other shape. A qualified access's FIELD is not a `uses` — it is `references` or `calls`, and publishing it twice was the defect §4 records. |
| `contains` | A declaration inside a container: `global` -> the file-scope name, or `owner` -> the member's own name. Synthesized from symbol pairs, so it carries the symbol's declaration line and no node. |
| `imports` | `require("module")`, `module("module")`, and `require` guarded by `pcall`/`xpcall`. The module path is a STRING in the tree, so the endpoint may be declared in another file; `import_based`, and the 0.3% both-ends resolution rate is that fact rather than a defect. |
| `references` | A member read WITHOUT calling it: `M.field`, `M:field`, `M["field"]`. The target is the member's own name. Since LUA-46 a member that is only **written** produces no `references` edge at all. |
| `exports` | A chunk-scope `return` that NAMES something. Lua chunks are not modules, so the source is the file's global scope — this analyzer's existing convention for `imports` and file-scope `calls` — and no symbol is invented from the filename. |
| `extends` | Two conventions, both a convention rather than a keyword. `setmetatable(D, B)`, with a table constructor excluded as a target and both arguments required to be DIFFERENT names (LUA-48). And `local D = factory(..., B)` where the factory's own `parameters` node declares a supertype-role parameter and its body folds that parameter into a `__`-prefixed metamethod (LUA-51). Lua's only type relation. |
| `implements` | NOT APPLICABLE — see §3. |
| `overrides` | Two constructs under two labels, never fused: `lua_redefinition` (the same name declared twice in one chunk, last-wins) at 1.0, and `lua_inherited_member` (a member of D that D also inherits from a base B through `__index`) at 0.95. |
| `instantiates` | `Table:new(...)` / `Table.constructor(...)` / `Table.new(...)` where `Table` is a table declared in this file. |

## 3. Verdicts, with the count or the measurement

`EMITTED` = production `parseFile` produced it on the corpus. `RULED` = a written
reason **and** a corpus measurement, with the instrument and the falsifying probe
named. All ten types are settled; the arbiter is not — see §3.3.

### 3.1 The table

Machine-graded: `bun run script/m14/verify-doc-truth-emissions.ts` reads the
"Emitted?" column of this table and compares it against the analyzer's
`ASTEngine.RelationshipType.*` references, with comments and string literals
stripped first. Wave 1's table was not in a shape the gate could read, so lua's
emission claims were `NO_CLAIM_TABLE` — checked by nothing. This table is
ordered `implements` first **because of a defect in the gate**, not for reading
order: `parseClaimTable` sets its `started` flag on the first *body* row and
`continue`s past it, so **the first data row of every claim table in the tree is
silently dropped**. With `calls` first, lua measured
`UNDOCUMENTED [lua] calls (relationship)`. The bug is invisible for zig, whose
first row is `extends` and which does not emit it. Putting the one type this
analyzer does **not** emit first means the dropped row claims `no`, which is
correct anyway — but the ordering is load-bearing and is stated here rather than
left to look like a preference. The gate is shared machinery and is reported, not
edited (§9).

| Relationship type | Emitted? | edges | files | Repos, and where |
| --- | --- | --- | --- | --- |
| `implements` | no — RULED, instrument A: 100 distinct node types across 1,875 files and none of `implements_clause` / `extends_clause` / `superclass` / `interface_implementation` / `interface_declaration` / `trait_declaration`; Lua has no type declaration of any kind (§3.2) | 0 | 0 | — |
| `uses` | yes — emitted; 100% bare names by construction since LUA-47, 0.9 + `usage_contextual` on every edge, 26.4% of targets name-ambiguous (§6) | 54,829 | 2,394 | kong 27,209, luarocks 6,013, snacks.nvim 5,505, luvit 3,374, plenary.nvim 2,535 |
| `contains` | EMITTED; **56 fabricated edges removed by LUA-49** — a `contains` for a re-assignment of a for-clause binding, a declaration that never happened (§4) | 55,198 | 2,500 | kong 29,490, luarocks 5,680, snacks.nvim 4,783, luvit 3,053, lapis 2,702 |
| `imports` | EMITTED; the target is a module-path STRING, which is why 0.3% resolve at both ends (§6) | 6,601 | 2,161 | kong 3,535, luarocks 701, luvit 554, nvim-lspconfig 294, lapis 278 |
| `references` | yes — emitted since LUA-41 and narrowed by LUA-46, which removed 14,833 writes that were published as reads (§4) | 40,013 | 2,315 | kong 19,469, snacks.nvim 6,626, luarocks 2,599, lazy.nvim 1,881, nvim-lspconfig 1,586 |
| `exports` | EMITTED; 4 of 5,167 sources resolve, because a Lua chunk is not a module and no symbol is named after the file | 5,167 | 2,137 | nvim-lspconfig 2,212, kong 1,583, nvim-treesitter 332, lapis 306, luvit 186 |
| `extends` | EMITTED; instrument A is silent here by construction — `setmetatable(D, B)` is an ordinary `function_call` (§3.3). 171 before LUA-48, 169 after it, **171** after LUA-51: the 2 `extends M -> M` self-edges were fabrications (§4) and 2 written supertype clauses were unread (§4, LUA-51) | 171 | 130 | 169 `lua_metatable` at 1.0/`structural` + 2 `lua_factory_supertype` at 0.95/`usage_contextual` |
| `calls` | yes — emitted; every edge carries 1.0 and `structural` in this draw — the pool-worker regex fallback did not fire, and §5 names the 12 files where it does | 57,393 | 2,584 | kong 26,375, snacks.nvim 7,221, luarocks 5,603, luvit 3,398, nvim-lspconfig 2,517 |
| `overrides` | yes — emitted since LUA-44; 65 `lua_redefinition` at 1.0/`structural` and 2 `lua_inherited_member` at 0.95/`usage_contextual` since LUA-52; 97.0% of targets name-ambiguous, so the 19.4% resolution rate is not the whole story (§6) | 67 | 38 | luvit 29, kong 23, luarocks 10, snacks.nvim 4, plenary.nvim 1 |
| `instantiates` | EMITTED; instrument A is silent here by construction — `Table:new(...)` is an ordinary `function_call` (§3.3) | 122 | 65 | snacks.nvim 36, luvit 33, plenary.nvim 19, trouble.nvim 13, kong 10, lazy.nvim 4 |

**Total 219,561 relationships and 83,745 symbols** over the 3,252-file draw,
`script/m60/lua-ontology-census.ts --full` at commit `8d8860549`, artifact
`validation/m60/lua/ontology-census.json`. Draw predicate `git ls-files '*.lua'` per
repo, sorted, no cap, so the file set is identical on every machine: **3,252 files**,
which is what the previous four runs also drew.

**This table did not reproduce, and that is why it is re-measured rather than edited.**
The wave-2 table published `calls 57,057 | uses 54,562 | contains 54,898 | imports
6,547 | references 39,886 | exports 5,108 | extends 171 | overrides 66 | instantiates
122`, total 218,381 — while §5 of the same document recorded 218,547 and §6 recorded
`contains` 55,028. **One document, three totals for the same draw**, and §6's
`overrides` row said 66 edges with 1 `lua_inherited_member` where the census says 67
with 2. A table a machine gate reads, disagreeing with itself, is worse than no table.

The movement is the §5 nondeterminism, not a behaviour change: two runs of the census
a few minutes apart, same draw, same analyzer, differ **only** in the four labels the
fallback touches — `calls` 57,407 → 57,393, `uses` 54,856 → 54,829, `contains` 55,217 →
55,198, `references` 40,019 → 40,013 — and are **byte-identical** in the five the
fallback cannot reach: `imports` 6,601, `exports` 5,167, `extends` 171, `overrides` 67,
`instantiates` 122. Those five are the ones a count may be quoted from. The floor on
this machine under seven concurrent agents is ±0.05% on relationships; §5's own two-run
comparison measured ±0.26%.

Wave 1 shipped 302,783 edges and declared the 2.53x payload increase honestly. Waves
2-3 **remove 83,222 of them (27.5%)** because four were wrong (§4). Against the
pre-ontology baseline of 119,606 edges the net addition is 1.84x.

### 3.2 The one RULED type: `implements`

- **Instrument: A, grammar inventory.** The pinned grammar produced **100
  distinct node types** across a 1,875-file draw, enumerated with per-type counts
  in `validation/m60/lua/grammar-inventory.json`. **None** of the six node types
  that would express it appears: `implements_clause`, `extends_clause`,
  `superclass`, `interface_implementation`, `interface_declaration`,
  `trait_declaration`. Lua has no `class` keyword, no `interface` keyword, and no
  declaration form for a type at all, so the construct has no grammatical shape for
  an edge to be derived from. This is a fact about the language's vocabulary: no
  corpus could produce one of those nodes.
- **Instrument B, for the relation Lua CAN express.** Probe B6 counted 1,295
  supertype links across 453 files and every one is the relation `extends` already
  publishes. Probe B8 split 501 links into four buckets: 79 `crossTable` (both
  sides declared tables), 45 `derivedIsSelf` (`setmetatable(self, …)` inside a
  constructor), 3 `selfLink`, 374 `unresolvedBase` (the base argument is an
  expression — `setmetatable(opts or {}, defaults)` at
  kong/kong/api/arguments.lua — so no name is written for it). Of the 79
  `crossTable` links, exactly 1 has a member declared on both sides, which is why
  `lua_inherited_member` measures 1 edge against 79 inheritance links.
- **A language with exactly one type relation cannot have a second one.**
  Conformance in Lua is duck typing: structural, undeclared, and with no written
  clause for an edge to carry.
- **The second falsification condition now has a probe.** Wave 2 named one and
  implemented none: "a probe finding a constructor-like call immediately followed by a
  conformance test (`if type(x) ~= "table" then error(...) end`) at a rate worth an
  edge." A falsification condition with no probe is a wish, not a test, so this pass
  wrote it — `script/m60/lua-conformance-probe.ts`, a TREE walk (never a regex: a string
  in a Lua file can carry `class("D", Base)` too, and the workstream's own record is a
  regex that convicted a correct ruling) — and ran it over all 3,252 corpus files. It
  returns NON-ZERO on two buckets, so the ruling was re-adjudicated rather than assumed:

| Bucket | Hits | Files | What it would mean if it were a type clause |
| --- | --- | --- | --- |
| b1 a written supertype argument (`class("D", Base)`) | 4 | 1 | 0 with a NAME, 0 with a string, 4 with an EXPRESSION |
| b2 `assert(type(x) == "...")` | 288 | 99 | a shape check, no type named |
| b3 `if type(x) ~= "..." then error(...) end` | 322 | 87 | the same check as a guard |
| b4 a CALLED name meaning conformance | 14 | 3 | see below |
| b5 the denominator b2/b3 sit inside | 2,337 | 605 | — |
| b6 `__index = <name>` | 349 | 236 | the relation `extends` already publishes |

b1's 4 hits are all `luarocks/vendor/argparse.lua`, where `class` is that file's OWN
three-parameter helper `class(prototype, properties, parent)` called as `class({...})`
with a table of properties in argument 2 — not a supertype. **0 written supertype
arguments corpus-wide**, which is the overturn condition reading zero.

b4 is the one that needed adjudication, because **the corpus DOES name conformance** —
the ruling could not have been made on the grammar alone and be the whole story. All 14
sites are in 3 files and none is a type clause an edge could carry:

- luvit `core.instanceof(obj, Class)`, 11 sites. A runtime helper whose body lives in
  another module (`luvit/deps/core.lua:55`, walking the `meta.super` chain). The
  analyzer cannot know what it means without reading that module.
- kong `implements(plugin, method)`, 3 sites at `kong/db/dao/plugins.lua:123`. Its body
  is `type(plugin[method]) == "function"` — a CAPABILITY check on a method name.
  `implements(handler, "response")` would publish an edge claiming `handler` implements
  a TYPE named `response`.

So a name-keyed rule would publish a wrong edge for kong and a right-by-luck edge for
luvit, off 14 call sites in 3 files. That is the fabrication rule refusing a table cell,
and the ruling stands — now on a measurement rather than on the grammar alone. Artifact:
`validation/m60/lua/conformance-probe.json`.

- **What would overturn this ruling.** A non-zero count of any of the six node types
  above in the instrument-A artifact — which is what a Lua dialect with a `class`/
  `interface` declaration would introduce — or a b1 hit whose supertype argument is a
  NAME or a string. b1 currently reads 0 of that shape.

### 3.3 The ruling table, and the arbiter run WITH the wiring

`npx tsx script/m14/ontology-coverage-gate.ts lua` exits 2 and refuses to report,
because `RULED_BY_LANG` has no `lua` entry and the gate will not render a verdict
from an empty table. The table therefore lives beside the gate, in
**`script/m14/lua-ruled.ts`**, exporting `LUA_RULED`; the gate is shared and is
reported, not edited (§8).

Wiring is one import and one map entry:

    import { LUA_RULED } from "./lua-ruled"
    const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED }

**It is proved, not asserted.** `script/m60/lua-ruled-proof.ts` applies that patch to
a scratch copy of the real gate, checks the table's shape against the gate's OWN
`Ruled` type field by field, and runs it. Paste of the run:

    ontology coverage gate — lua
    corpus: 3250 admitted files

    type          status            detail
    ----------------------------------------------------------------------------------------
    calls         EMITTED           57,408 edges in 4+ files
    uses          EMITTED           54,855 edges in 4+ files
    contains      EMITTED           55,217 edges in 4+ files
    imports       EMITTED           6,601 edges in 4+ files
    references    EMITTED           40,019 edges in 4+ files
    exports       EMITTED           5,167 edges in 4+ files
    extends       EMITTED           171 edges in 4+ files
    implements    RULED-SOUND       NOT EMITTED; the grammar produced 128 distinct node
                                     types across the corpus and NONE expresses it.
                                     Written ruling: script/m14/spec/lua-completeness.json#BD-ontology
    overrides     EMITTED           67 edges in 4+ files
    instantiates  EMITTED           122 edges in 4+ files
    ----------------------------------------------------------------------------------------
    emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0

    gate exit code: 0

Run at commit `8d8860549`. Two readings in that table need their scope stated, because
both are the §5 floor or the R1 defect rather than a property of the lane:

- The four moving labels (`calls`, `uses`, `contains`, `references`) sit inside the
  nondeterminism floor; the five stable ones (`imports` 6,601, `exports` 5,167,
  `extends` 171, `overrides` 67, `instantiates` 122) match §3.1 exactly.
- `128 distinct node types` is **bash's** count — R1 below. Lua's is 100.

The gate admits **3,250** files where §3.1's census admits **3,252**: the gate filters on
`detectLanguageFromPath` per file and the census on `git ls-files '*.lua'`. Two files are
therefore in one draw and not the other. Neither total is wrong and they are not
interchangeable, so both are printed rather than reconciled.

**Coverage is reported as APPLICABLE, never as a flat 10 — and here the applicable
denominator is 10.** Nine types are EMITTED with counts, and the tenth is RULED with an
instrument, a probe, a measurement and a named falsification condition (§3.2). That is a
complete settlement of the ontology for this language, and it would be misreported as
"9/10 broken" by a denominator that counted only what fires.

**The table has ONE row and that is the whole of it.** Nine of the ten types are
EMITTED, and the gate's verdict loop checks EMITTED first, so a row for an emitted type
would be the claim that it is NOT emitted — false. A table padded to ten rows would
look more finished and be less true.

#### The gate's instrument A measures the WRONG GRAMMAR for lua — reported, not fixed

The run above prints **128** distinct node types. This lane's own instrument A over the
SAME 3,250 files with the SAME draw predicate reports **100**
(`validation/m60/lua/grammar-inventory.json`). 128 is bash's vocabulary, and the cause
is one line in the shared gate:

    const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"

`script/m14/differential.ts`'s `LANGS` has no `lua` entry, so the fallback fires and the
arbiter parses every Lua file with **tree-sitter-bash**. `lua-ruled-proof.ts` asserts
this rather than describing it, so the finding is reproducible.

The `implements` verdict survives it — bash's grammar has no `implements_clause` either,
so the absence is found in the wrong vocabulary and happens to be right — but two things
are wrong. The detail string's basis is false, and **the error points the dangerous
way**: a vocabulary that is too small can only ever find an ABSENCE, so any lane whose
real grammar DOES contain one of its candidate node types would read FALSIFIED-worthy
presence as absent, and a ruling that should be overturned would read RULED-SOUND. Every
lane that uses instrument A through this fallback inherits that.

#### What the old grammar-inventory artifact would have got wrong

Had the table been built from `validation/m60/lua/grammar-inventory.json` as it stood in
wave 2, it would have carried three rows claiming constructs that do not exist. The
artifact computed `instrumentASettlesIt: present.length === 0`, which asks "did any of
these node types appear?" — and for three of the four types that is a question about the
GRAMMAR's vocabulary, so the answer is `true` whatever corpus is supplied:

| Type | old `instrumentASettlesIt` | correct | why |
| --- | --- | --- | --- |
| `implements` | true | **true** | no type declaration exists in Lua at all |
| `overrides` | true | **false** | a redefinition IS a second `function_declaration` |
| `instantiates` | true | **false** | `Table:new(...)` is an ordinary `function_call` |
| `extends` | true | **false** | `setmetatable(D, B)` is an ordinary `function_call` |

So the gate would have reported `extends` and `instantiates` RULED-SOUND and been
contradicted by this lane's own 169 and 122 emitted edges. The artifact now carries
`silentByConstruction`, `nodeTypesAbsentInCorpus` (the honest arithmetic) and
`instrumentASettlesIt` separately, plus `instrumentThatSettlesIt` and a `why` per row.

## 4. Defects found by measuring rather than reading

### LUA-46 — a WRITE was published as a READ. 14,833 edges.

`emitMemberRead` excluded an assignment target with

    pt === "assignment_statement" && this.isSameNode(parent.namedChild(0), node)

but the wired grammar puts every target inside a `variable_list`. Measured on the
tree (`script/m60/lua-grammar-shape.ts`), `a = 1` parses as

    assignment_statement {name=identifier}
      variable_list {name=identifier}
        identifier "a"
      =
      expression_list
        number "1"

so a target's **parent is `variable_list`** and `namedChild(0)` of the
assignment_statement is that variable_list, never the target. The exclusion was
**dead code on every write in the language**. The method's own doc comment already
claimed "a member ASSIGNED TO is a write" — a comment asserting a behaviour is not
evidence that it exists, which this lane has now got wrong twice (LUA-30, and
here).

**Measured population**, 3,252 files: 84,354 assignment targets, of which 69,521
are bare identifiers (correctly not published) and **14,833 are qualified names**.
Each of those 14,833 published a `references` edge for a member that was written
and never read — `memberlist_protocol.fields = 1` at
docker/contrib/wireshark/memberlist.lua:41, `pinfo.cols.protocol = proto` at :126.
That is **6.9% of the 214,155 member-shaped nodes in the corpus** stating a read
that does not exist, and 4,461 of them duplicate a read of the same member on the
right-hand side of the same statement.

Reproduce: `npx tsx script/m60/lua-write-as-read.ts --full`.

### LUA-47 — a READ was published TWICE. 8,041 edges on a 400-file draw.

`emitNameRead` excluded `namedChild(0)` of a dot/method index expression, which is
the **RECEIVER**. The **FIELD** is `namedChild(1)` and also reached `uses`, while
`emitMemberRead` published the same member as `references` and `processCall`
published it as `calls`. One access, one span, two labels:

    local v = tbl.member      ->  uses -> member   AND  references -> member
    tbl:method()              ->  uses -> method   AND  calls      -> method
    local v = tbl.inner.member -> uses -> inner, uses -> member,
                                  references -> inner, references -> member

**Measured**, 400 corpus files: **8,041** member edges carry both a `uses` and a
`references` edge for the same member on the same line — **26.07%** of the corpus's
`uses`+`references` member edges. Corpus-wide the fix removes **77,874 `uses`
(−58.8%)** and **4,659 `references` (−10.5%)**.

Reproduce: `npx tsx script/m60/lua-uses-references-double-publish.ts --cap 400`.

**Why a green suite did not catch either one.** `lua/name-reads` is the fixture
that claims to pin this pair, and its forbid rows name `config` and `helper` —
both **RECEIVERS**. There is no row for `uses -> retries` or `uses -> record`,
which are both **FIELDS**, and no row for a write at all. The doc's §5 table said
"the head of a qualified name is not read on its own account; pinned for `config`
and `helper`" — true, and about the head. A suite that pins the head of a
qualified name and says nothing about its tail is green on a double publication of
the tail. `validation/m14/fixtures/lua/read-classes` now forbids all of those
cases, and `script/m60/mutate-lua-read-classes.ts` reinstates each defect in turn
and requires the suite to go red.

### LUA-48 — a table was published as its own base. 2 edges.

`setmetatable(D, D)` sets D's metatable to ITSELF — an idiom for making a module table
self-referential — and the guard published `extends D -> D`. A type relation to itself is
not expressible in Lua: no table is its own base.

Found by a probe built for a different reason. `script/m60/lua-labelling-audit.ts` counts
`source === target` edges per type, because a self-edge on a TYPE relation is a
fabrication by definition while a self-edge on `calls` is ordinary recursion. Over the
whole 3,252-file draw it reports **2 `extends` self-edges**, both this shape:
`return setmetatable(M, M)` at lazy.nvim/lua/lazy/state.lua:45 and
`local ret = setmetatable(M, M)` at trouble.nvim/lua/trouble/cache.lua:59. Both carried
confidence 1.0 and `evidenceClass: structural` — asserted as parse facts.

The same audit found **3 `contains` self-edges that are NOT this defect** and are left
alone: `function sum.sum(a, b)` at
luarocks/spec/fixtures/busted_project/sum.lua:3 is a method named `sum` on owner `sum`,
and a Lua table may carry a member with its own name. The discriminator is whether the
relation is TYPE-TO-TYPE or CONTAINER-TO-MEMBER; only the first is inexpressible.

Reproduce: `npx tsx script/m60/lua-labelling-audit.ts`.

### LUA-49 — a for-clause BINDS a name and the frame never heard of it. 56 edges.

`extractAssignment` suppresses a local re-assignment on one line —
`frame.localNames.has(name)` — and `localNames` was filled from exactly one place,
`variable_declaration`. Every other binding form in the language fell through it:

    for _, line in ipairs(lines) do
      line = line:match("(.-)%%") or line     <- a RE-assignment, and a declaration of nothing
    end

`line` is bound by the clause, so that statement re-assigns a local. The analyzer had no
record of the binding, published a `variable` SYMBOL for it, and
`addContainsRelationships` then published `contains get_packages -> line` — a containment
edge for a declaration that never happened, sitting on the assignment's line rather than
the clause's.

**Found by the ORACLE disagreeing, not by reading.** `lua-truth-oracle.ts` records
for-clause names and so correctly declined to derive the re-assignment; the two sides
disagreed on 4 unexplained `contains` edges over ~600 files. It is in the one label the
oracle DOES audit, which is the worst place for a disagreement, because a reader has no
reason to doubt the instrument.

Two wrong answers were available and the corpus picked the wrong one first:

| Attempt | Result |
| --- | --- |
| record the name in `localNames` | **wrong** — suppressed 18 REAL `contains` edges on kong alone, because an assignment AFTER a closed loop is a different binding. The oracle reported them as MISSING, which is how the scope bug on this side was found. |
| record the name WITH the loop's end offset, and fold the test inside `frame.callable` | **wrong** — exempted FILE-SCOPE loops, publishing 7 more fabricated `contains` edges (`_, v = next(v)` at kong/kong/db/schema/entities/clustering_data_planes.lua:7, `l = l:sub(2)` at plenary.nvim/lua/plenary/scandir.lua:22). |
| record the name WITH the loop's end offset, tested at every scope | **correct** — 0 missing and 0 unexplained `contains` on all four oracle repos |

Final measured state, per repo, 200-file draw, label `contains`:

| Repo | truth | observed | missing | unexplained |
| --- | --- | --- | --- | --- |
| kong | 6,820 | 6,820 | 0 | 0 |
| luarocks | 5,680 | 5,680 | 0 | 0 |
| snacks.nvim | 4,783 | 4,783 | 0 | 0 |
| plenary.nvim | 2,202 | 2,202 | 0 | 0 |

**What this fix deliberately does NOT do.** The loop BINDING itself is still not published
as a declaration. Lua binds `line` there, and neither a symbol nor a `contains` edge says
so — the edge that used to appear was on the wrong line for the wrong reason.
`for k, v in pairs(t)` is one of the most frequent constructs in Lua, so publishing every
loop variable is a symbol-count and graph-payload decision for the whole surface, not a
lane-local fix. Reported (§9, limitation 14) rather than done.

### LUA-51 — a WRITTEN supertype clause the analyzer never read. 2 edges.

`extends` was read from exactly one construct: `setmetatable(D, B)` at
real-lua-analyzer.ts:924. The `class` branch read only `firstString` — the class's own
NAME — and never looked at a parent argument. Lua's most widely vendored OOP factory
states its supertype as an ordinary call argument:

    luarocks/vendor/argparse.lua:38    local function class(prototype, properties, parent)
    luarocks/vendor/argparse.lua:277   local Command = class({...}, {...}, Parser)
    luarocks/vendor/argparse.lua:328   local Option  = class({...}, {...}, Argument)

Both are inheritance, and the callee body says so at :41 —
`if parent then cl.__prototype = deep_update(deep_update({}, parent.__prototype), prototype)`
— the new class's prototype is built FROM the parent's. Neither edge was emitted.

**Found by a probe that had to be rewritten to be able to see it.** The instrument that
prompted the hunt is `script/m60/lua-conformance-probe.ts` bucket b1, and b1 reads
`as[1]` — the SECOND argument — as the supertype. That is argparse's MIDDLE argument, a
table of properties, so all four of b1's hits landed in `other` and the bucket read 0
names. The probe GUESSED A POSITION, and the convention's position is a property of the
callee's own parameter list, which the same file writes down and which b1's own header
quoted. Rewritten to read the slot from that `parameters` node
(`script/m60/lua-supertype-arg-probe.ts`):

    written supertype arguments   7 across 5 files   (role-resolved)
    positional guess would count  0

This is the defect class the coverage gate's own header records for json's first `$ref`
probe: a probe that matches a SHAPE rather than a ROLE produces a number, and the number
is worth nothing. b1's 0 was a real number about the wrong slot.

**Why the reader folds the parent into a metamethod, which is the part that mattered.**
Of the 7, only 2 are inheritance. The other 5 are an ordinary tree-traversal parameter
that happens to be named `parent`:

    snacks.nvim/lua/snacks/layout.lua:186                        _each(widget, parent)
    snacks.nvim/lua/snacks/picker/source/lsp/init.lua:379, :387  add(result, parent)
    snacks.nvim/lua/snacks/picker/source/treesitter.lua:185      add(match, parent, depth)

A rule keyed on the parameter NAME publishes 5 fabricated `extends` edges, claiming a
widget's parent is a supertype. Requiring the call to be bound to a top-level name is
NOT enough either — it was the first implementation, and the fixture caught it, because
`local added = add({...}, walked)` is a top-level binding. What separates them is
whether the factory's body folds the parent into a `__`-prefixed metamethod of the object
it builds, which is what inheritance means in Lua:

    (a)  parent.__prototype          luarocks/vendor/argparse.lua:41
    (b)  cl.__super = parent         the same relation, other spelling

Both spellings are in the corpus, which is why the test accepts both. That is a
derivation over parse facts in the callee, not a name list, and it is what the fixture's
load-bearing forbid row pins.

**The edges, with their lines.** `extends` 169 → 171, no other type moves:

    luarocks/vendor/argparse.lua:302   Command -> Parser   0.95  usage_contextual
    luarocks/vendor/argparse.lua:351   Option  -> Argument 0.95  usage_contextual

Confidence 0.95 and `usage_contextual`, NOT 1.0 and NOT `structural`, deliberately. Both
endpoint names are written, which is what earns `extends` 1.0 on the `setmetatable` path;
what is a convention is the ROLE — that a parameter named `parent` means the supertype.
`overrides`' `lua_inherited_member` takes the same 0.95 for the same reason and cites the
same family precedent (real-objective-c-analyzer.ts:1020). The line is the line the
SUPERTYPE ARGUMENT is written on, which is the M59 rule (the name field, not the call's
own start) — `class({` opens at :277 and `Parser` is written at :302.

Reproduce: `npx tsx script/m60/lua-supertype-arg-probe.ts` and
`npx tsx script/m60/lua-extends-census.ts`.

### LUA-52 — a 0.95 edge claiming `structural`. 2 edges, and NO count can see it.

Found by the line-by-line read the dual-lens regime requires, and it is the third time
in this analyzer that a COMMENT was right and the CODE was not — LUA-30, LUA-46, here.

`evidenceClassFor` derives the tier from the TYPE alone:

    if (type === Imports || type === References) return "import_based"
    if (type === Uses) return "usage_contextual"
    return "structural"

so every `overrides` edge took `structural`. Two of the 67 are `lua_inherited_member` at
confidence **0.95** — and `structural` asserts "both endpoints are nodes this parse
saw", which is TRUE for those two edges and is NOT the claim being made. The claim is
that `Derived.run` SHADOWS `Base.run` through an `__index` chain, and nothing in the
tree says the link is meant as inheritance. That is `usage_contextual` by the family's
own definition (real-css-analyzer.ts:737).

**The analyzer had already written the rule it was breaking.** `addFactorySupertypeEdges`
states it at :1381 — "`evidenceClassFor` derives it from the TYPE alone … and a 0.95 edge
must not claim `structural`" — and `lua_inherited_member` is the analyzer's OTHER 0.95
edge, taken for the same reason, and it took the derived tier anyway. The two 0.95 edges
in this analyzer now carry the same tier for the same reason:

| edge | confidence | tier | both endpoints written? | the link is meant as inheritance because |
| --- | --- | --- | --- | --- |
| `extends` / `lua_factory_supertype` | 0.95 | `usage_contextual` | yes | a parameter named `parent` means the supertype — a convention |
| `overrides` / `lua_inherited_member` | 0.95 | `usage_contextual` | yes | `setmetatable`/`__index` means inheritance — a convention |

**Why every count-based gate was blind to it.** `overrides` is 67 edges before and after.
The census total, the arbiter's `EMITTED` row and the oracle's set diff all read
identically. A number that cannot distinguish the two states cannot establish that a fix
took effect, so the fix is verified on the FIELD, on the corpus edges themselves
(`script/m60/verify-lua-evidence-tier.ts`, 219,576 analyzer edges):

    sub-1.0 analyzer edges claiming `structural`:   0
    analyzer edges carrying no tier at all:         0
    0.95 lua_inherited_member -> usage_contextual        2

That script is also the honesty contract §4 leg measured rather than asserted, and its
`PASS` supersedes the `structural 66` / `absent 8` rows §6 used to carry, which counted
the pool-worker fallback edges in the same column as analyzer edges.

Fixture `lua/override-shapes` asserts the tier **per ROW** through `meta.evidenceClass`,
because `expectEvidenceClasses` is keyed by TYPE and `overrides` emits at two tiers by
design — a per-type assertion would be a tautology either way. The forbid half is the
load-bearing row: an implementation that derives the tier from the type alone satisfies
every expect row and fails exactly that one. Mutant
`script/m60/mutate-lua-evidence-tier.ts` deletes the key so the TYPE-derived tier applies
again — **1/1 caught**, and it is caught by deleting the fix rather than by writing a
different word, so the mutant reproduces the original mechanism.

### LUA-53 — a flag four call sites passed, and NO output could depend on it.

Also from the line-by-line read. `addRelationship` took a `dedupe` option:

    if (opts?.dedupe === false) {
      if (ctx.seenRelationships.has(key)) return
    } else if (ctx.seenRelationships.has(key)) return
    ctx.seenRelationships.add(key)

Both arms ran the SAME test and the key was recorded either way. **The flag could not
change a single emitted edge**, and four call sites passed `false` believing it did:
`addContainsRelationships:1717`, `addOverrideRelationships:1628` and `:1673`,
`addFactorySupertypeEdges:1392`. A flag whose value does not matter is a claim about the
output that no reader can check — the same shape as LUA-02's `isCoroutine` counter that
could only read 0 and LUA-10's dead `+5` scoring branch.

**Removed, and proved rather than asserted.** A count cannot prove inertness, because
inertness means the counts are equal by construction.
`script/m60/verify-lua-dedupe-invariant.ts` diffs the whole output instead:

- each version's source is placed at `src/ast/real-lua-analyzer.ts` and driven through
  production `parseFile` **in a fresh process**. This is forced by the code:
  `ASTEngine`'s `getAnalyzer` resolves lua with `await import("./real-lua-analyzer")` —
  the real path, chosen by a switch, with **no injection point**. Importing a second copy
  of the class and calling it directly would not be the production path, and the diff
  would compare one analyzer with itself — the shape of a check that cannot fail.
- **Serial**, because `parseFile` returns `extractFallback`'s output for a file whose
  grammar load lost a race (§5: 12 of 3,252 files vary between two passes of a provably
  identical draw). Under concurrency that noise would masquerade as a difference between
  versions.
- every relationship **and symbol**, one line each, carrying type, source, target,
  `line_number`, confidence, `evidenceClass`, `relationshipType`, `redefinition`,
  `member`, `overridesLine`, `receiver`, `memberPath`, `qualifiedName`; compared as a
  **multiset**, so a line repeated in one version and not the other cannot be masked by
  a set. The real file is restored in a `finally` and its sha256 verified.

    pre-fix (14153d8e2) : 32,271 relationships, 8,624 symbols
    post-fix            : 32,271 relationships, 8,624 symbols
    only in pre-fix 0   only in post-fix 0   duplicate multiset identical

**The 37 edges the dead flag was hiding are declared, not fixed.**
`script/m60/lua-dead-flag-probe.ts` rebuilds the dedup keys from the parse tree over all
3,252 files and counts what the dedup suppresses:

    redefinition attempts 90 over 53 distinct keys  ->  37 suppressed
    extreme: 13 attempts on one key, `overrides global enqueue`

A name declared **14 times** in one chunk publishes ONE `overrides` edge, and 13
redefinition lines are unrepresented. Making the flag work would add 37 edges sharing
`(type, source, target)` with an edge already stored — which is **LUA-01b**, a schema
question above this analyzer ("whether the store may hold two edges of one kind between
one pair of symbols"), and `bb_graph` would then see the duplicates. Declared as
limitation 17; the schema question is a §8 report item.

**The same probe's second finding: an unreachable call site.**
`detectFrameworks` is called on **every** `identifier` (:308-309) and returns immediately
unless the text contains a dot — and an `identifier` in the pinned grammar never does,
because a qualified name is a `dot_index_expression` with its own case arm. Measured
over the whole corpus: **782,443 identifier nodes, 0 containing a dot.** The arm is
unreachable on every file; framework detection runs through `processCall:872` and
`addImport:983-988`. Left in place and declared, because no count can prove a removal
changes nothing — the same lesson as LUA-53, one line away, and it is why LUA-53 is
proved by a diff instead.

### Three lane GATES that could not execute, or could not see

Found by running the §9 battery for the first time. **None of the three convicts the
analyzer; all three are defects in this lane's own instruments**, which is the same
shape as the four ORACLE defects below and the same lesson as them: an instrument is an
authority until it is measured.

| Gate | What was wrong | What it reports now |
| --- | --- | --- |
| `verify-lua-fixtures.ts` | **DID NOT PARSE.** Commit `c358309c9` correctly un-pinned its `REPO` constant and left a mismatched quote on the line below — `` const out = `${REPO}/…json" ``, a backtick opened and a double quote closed. The module failed to transform, so the lane's fixture gate had produced **no verdict at all** since. | runs; 0 missing, 0 unexpected |
| `verify-lua-fixtures.ts` `EXPECTED` | listed **6 of the 12** committed fixtures. Waves 1-2 added `read-classes`, `override-shapes`, `loop-bindings`, `extends-supertype`, `export-edges`, `name-reads` and the list was never extended — and had never been read, because of the line above. | all 12 listed, and `extra` now reports a fixture added without being listed |
| `verify-lua-grasped-fields.ts` | reported **6 FALSE POSITIVES and FAILED**: `field "name" (line 388) is asked of identifier, but the grammar only resolves it on: field, for_numeric_clause, function_call, function_declaration, parameters, variable_list` — convicting the code while printing the list that CONTAINS the type the guard names. | **PASS 7/7 checks, 3/3 planted mutants still caught** |

The `grasped-fields` defect is worth stating precisely, because both halves are in the
gate's site-attribution rather than in the analyzer:

1. Its rule 2 recognises a type guard only when written `parent.type === "field"`.
   `emitNameRead` and `emitMemberRead` write `const pt = parent.type` and then
   `pt === "field"` — the same evidence through a local alias. Rule 2 was blind, so
   attribution fell to rule 3, which types a site by its **caller's** dispatch. Rule 2's
   own comment records that exact rule as the false-positive path for LUA-09; the same
   false positive arrived by a different road.
2. Rule 2's walk started at `line - 2`, skipping the literal's **own** line — which is
   where the guard is written in the `if (pt === "x" && …childForFieldName(…))` form.
   Lines 475 and 476 were passing only because the walk found line 474's guard *above*
   them: attributed to the wrong guard, and right by luck.

The load-bearing number is **3/3 mutants still caught**. A gate fix that stops catching
its own mutants is a regression dressed as a repair.

### Four defects in the ORACLE itself, each of which had been reporting agreement

The instrument that found LUA-49 was itself wrong four times, and in each case the error
was invisible because the set-based comparison was unaffected. All four are in this lane's
own file; all four are fixed; the selftest still proves the comparison can fail.

| Id | Defect | How it was invisible | Measured effect |
| --- | --- | --- | --- |
| ORA-5 | the `fn-decl` branch of `contains` pushed unconditionally, so a scope-LABEL collision manufactured `contains X -> X` | the set diff read them as MISSING, i.e. as an ANALYZER defect, in a label audited at recall 1.0 | 3 false MISSING on snacks.nvim — `contains reveal -> reveal` inside `function M.reveal`, `contains walk -> walk` inside `function M.walk`, `contains update -> update`. The analyzer was right to drop all three. |
| ORA-6 | `perLabelObs` was incremented OUTSIDE the `!observed.has(k)` guard, so it counted rows seen, not distinct edges | `missing`/`unexplained` come from the set and were correct; only the published `observed` was wrong | `exports` observed read **exactly 2x** truth on kong AND snacks.nvim AND luarocks AND plenary.nvim. Four repos agreeing on an impossible ratio is what made it look like a property of the language. It reached this document: §6 published `exports \| 590 \| 1,184`. The true observed count is 590. |
| ORA-7 | `unexplainedSample` is a flat list capped at 25, and on this corpus it fills end to end with `uses`/`references` — the two labels with NO truth at all | a residual in an AUDITED label arrived as a bare integer with no file and no line | `contains unexplained=2` with no way to learn which two. Per-label samples (capped at 5) added; that is how ORA-8's 7 sites were found. |
| ORA-8 | for-clause names were never added to `localsIn`, only to a separate per-file set used for another exemption | the oracle invented truth and the analyzer — correctly — disagreed; the analyzer looked like the party at fault | 18 `contains` edges on kong's 200-file draw asserted a declaration that did not happen, plus 14 luarocks, 23 snacks.nvim, 1 plenary.nvim. |

The order matters and is worth stating: the analyzer was RIGHT on the ORA-5 and ORA-8
cases and the instrument was wrong, and the first version of the LUA-49 fix agreed with
the wrong instrument. **Fixing the analyzer to match a broken oracle would have shipped
18 deleted edges.** An oracle is an authority until it is measured, and this one had
never been run on a repo other than kong.

### Where the oracle now stands, on four repos instead of one

`script/m60/lua-truth-oracle.ts` over a 200-file draw per repo, 6 audited labels:

| Repo | files | calls | contains | extends | instantiates | imports | exports |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kong | 200 | 4948/4948 | 6820/6820 | 51/51 | 8/8 | 746/746 | 438/438 |
| snacks.nvim | 141 | 7221/7221 | 4783/4783 | — | 36/36 | 170/170 | 129/129 |
| luarocks | 150 | 5603/5603 | 5680/5680 | 16/16 | 1/1 | 701/701 | 125/125 |
| plenary.nvim | 112 | 2282/2282 | 2202/2202 | 11/11 | 19/19 | 167/167 | 94/94 |

Every cell is truth/observed with **missing 0 and unexplained 0**, and `lineWrong` is 0
of 60,142 checked. Wave 1 ran this on kong alone.

### The reserved-word class looks identical to bash's fabrication and has the opposite verdict

The BASH lane measured 30 `calls` edges whose target was a POSIX reserved word
(`fi`, `then`, `elif`) and **every one was a fabrication** — tree-sitter's error
recovery reads a keyword as a `command_name`. Lua's audit found 50 reserved-word
endpoints, which is the same shape. It is not the same defect.

Measured with an independent tree walk that shares no rule table with the analyzer
(`script/m60/lua-endpoint-attribution.ts`): **114 reserved-word occurrences across
35 files, of which 111 are a `string` node in the `field` position of a
`bracket_index_expression`** — a real member name written with bracket syntax —
and **3 are bare `identifier`s inside an `ERROR` node**. `references -> function`
is `kong/kong/llm/drivers/anthropic.lua:120`, `if v['function'] then`.
`calls -> true` is `plenary.nvim/tests/plenary/context_manager_spec.lua:94`,
`assert.is["true"](entered)`. Both state a fact the source writes. **111 of 114
(97.4%) are true; the fabrication signature is 3 occurrences, and this lane does not
claim them as fabrications because the edges are still true readings of text the
file contains.** The cost is that a reserved word can never resolve to a symbol,
which is a resolution fact and is in the table in §6.

### Two corpus files are not Lua, and the analyzer edges their bytes honestly

`plenary.nvim/scripts/vararg/rotate.lua` is a **Jinja template with a `.lua`
extension** — `{% for n in range(1, amount) %}`, 16 ERROR nodes. Every edge on its
lines 10–12 is derived from template syntax: `uses -> for`, `uses -> in`,
`calls -> range`, `calls -> A`, `references -> last`, `uses -> endfor`. The
analyzer parsed the bytes it was given correctly; the file is not the language.
Making the analyzer Jinja-aware would be a fabrication in the other direction, so
this is a **disclosure, not a fix**: 4 files of 3,252 carry a root-level ERROR
(`kong/spec/fixtures/invalid-module.lua`,
`nvim-treesitter/tests/indent/lua/{cond,func}.lua`, and `rotate.lua`).

### A probe that was measuring half the grammar

The first version of the attribution probe read only `identifier` nodes and
reported 3 reserved hits against the audit's 51 reserved-word **edges**. That was
not a contradiction of the analyzer; the probe was blind to `v['function']`, whose
name is carried by a `string` node. Fixed, and the fixed probe now reports both
node types separately so they are never summed into one claim. Recorded because a
probe that under-reports is more dangerous than one that over-reports: the
disagreement looked like an analyzer defect and was a defect in the instrument.

### A hypothesis of mine that the corpus falsified

Before looking at the tree I expected Lua's multi-target assignment
`a, b = b, a` to publish the second target as a `uses` edge, on the reading that
`namedChild(0)` only covers the first. **Falsified**: the corpus contains **0
multi-target assignments among 84,354 targets**, and the tree puts every target in
a `variable_list`, so `emitNameRead`'s existing `variable_list` exclusion covered
assignment targets all along. The fixture pins the shape anyway, from the contract,
because no fixture derived from real code can reach it — and that turned out to
carry the LUA-46 mutant (§7).

## 5. `parseFile` is not deterministic: 12 named files

**Read this before quoting any count.** Two runs over a **provably identical draw**
(`drawDigest c990daa339a9…`, 3,252 files), sharded into 8 fresh processes so WASM state
cannot accumulate across shards — which is the mitigation the aggregate recommends, and
it is **not sufficient**. The table is wave 2's pair of runs and is kept as the
measurement that established the floor; §3.1's table is a separate, later draw:

| | run 1 | run 2 | delta | as % |
| --- | --- | --- | --- | --- |
| symbols | 83,585 | 83,381 | −204 | −0.24% |
| relationships | 218,547 | 217,979 | −568 | −0.26% |
| `uses` | 54,562 | 54,374 | −188 | −0.34% |
| `references` | 39,886 | 39,807 | −79 | −0.20% |
| kindless symbols | 33 | 37 | +4 | — |

**Which labels the floor can move, measured again at HEAD.** Two census runs minutes
apart on the same draw and the same analyzer differ in `calls`, `uses`, `contains` and
`references` and are **byte-identical** in `imports`, `exports`, `extends`, `overrides`
and `instantiates`. The floor is not uniform across labels, and a table that quotes a
moving label as if it were a fixed one is the reason §3.1 was wrong: it published
`uses 54,562` and `overrides 66` from two different runs. **The five stable labels are
the ones a count may be quoted from.**

`script/m60/lua-nondeterminism.ts` records a per-file digest and runs the same
shard twice, which turns the corpus-wide delta into a **named file set**:

> **12 of 3,252 files (0.37%) differ between two passes, and 12 of 12 differ
> because one pass returned pool-worker's regex `extractFallback` output and the
> other parsed normally.** A fallback file contributes **0 symbols and 0
> relationships** — it is not wrong, it is *absent* from the graph for that run.

The 12: `hledger/tools/pandoc-drop-toc.lua`,
`hledger/tools/pandoc-drop-html-blocks.lua`,
`kong/spec/02-integration/05-proxy/31-stream_tls_spec.lua`,
`kong/spec/02-integration/05-proxy/32-query-params_spec.lua`,
`kong/spec/fixtures/custom_plugins/kong/plugins/tcp-trace-exporter/handler.lua`,
`kong/spec/fixtures/custom_plugins/kong/plugins/tcp-trace-exporter/schema.lua`,
`luarocks/src/luarocks/fetch/git_file.lua`,
`luarocks/src/luarocks/fetch/git_http.lua`,
`nvim-lspconfig/lsp/earthlyls.lua`, `nvim-lspconfig/lsp/elixirls.lua`,
`nvim-treesitter/tests/indent/lua/string.lua`,
`nvim-treesitter/tests/indent/lua/table.lua`.

Mechanism: `pool-worker.ts:1148` catches a grammar-load failure and returns
`extractFallback`'s output as `{success: true, errors: [], fallback: true}`. It
fires under concurrency with `Incompatible language version 0. Compatibility range
13 through 15.` **Not fixed here** — `pool-worker.ts` is shared (§8).

**The nondeterminism floor is the instrument this pass used as its control.** The
labels the LUA-46/47 fix does not touch move by ±0.1% between runs — `calls`
+51 in one direction and −63 in another, `contains` +50 and −89 — while `uses` and
`references` moved by 58.8% and 10.5%. The fix's effect is two orders of magnitude
outside the noise, which is the only reason it can be claimed as an effect at all.

## 6. The six questions, per emitted type

**Exists / Fires.** Settled by construction for all nine: each has a producing rule
and a non-zero count over 3,252 files. `implements` is RULED (§3.2).

### Correct — there IS an oracle, and its blindness is structural

Wave 1's document stated "there is NO independent lua oracle". **That was false and
contradicted the repository's own committed artifacts.** `script/m60/lua-truth-oracle.ts`
is 1,418 lines, derives truth from the wasm **parse tree** rather than from the
analyzer's output, diffs two directions over a real corpus, and ships results at
`validation/m60/results/lua-truth-oracle-{kong-400,luvit}.json`. It is standalone
rather than a `lang === "lua"` case in `differential.ts` because that file is
shared and 14k lines.

**The `observed` column in the wave-1 table was wrong and is corrected here.** Wave 1
published `exports | 590 | 1,184` — a clean 2.0x. That was ORA-6, a counter that counted
rows seen instead of distinct edges, and it was wrong on four repos in the same ratio,
which is what stopped it looking like a bug. Truth 590, observed **590**. No `missing` or
`unexplained` figure changes, because those come from a set and were always right — the
error was confined to one published column, and it had reached this document.

Measured after this pass, 200-file draw per repo, through the direct path:

| label | kong | snacks.nvim | luarocks | plenary.nvim | missing | unexplained |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | 4,948/4,948 | 7,221/7,221 | 5,603/5,603 | 2,282/2,282 | 0 | 0 |
| `contains` | 6,820/6,820 | 4,783/4,783 | 5,680/5,680 | 2,202/2,202 | 0 | 0 |
| `extends` | 51/51 | — | 16/16 | 11/11 | 0 | 0 |
| `instantiates` | 8/8 | 36/36 | 1/1 | 19/19 | 0 | 0 |
| `imports` | 746/746 | 170/170 | 701/701 | 167/167 | 0 | 0 |
| `exports` | 438/438 | 129/129 | 125/125 | 94/94 | 0 | 0 |
| `uses` | **no truth** | | | | — | unaudited |
| `references` | **no truth** | | | | — | unaudited |
| `overrides` | **no truth** | | | | — | unaudited |

603 files, 60,142 truth edges, 0 missing, 0 unexplained, 0 wrong lines. Before this pass
the same four repos read 3 false MISSING and 4 unexplained `contains`, and the exports
column read 2x. Wave 1 ran this on kong alone, which is why four defects in the
instrument survived it.

**The oracle derives no truth for `uses`, `references` or `overrides`** — the three
types wave 1 added — so it scores them as agreement-by-absence. The decisive test
is to run it against the defective analyzer:

| analyzer | SPURIOUS | per-label verdict for the 6 covered labels |
| --- | --- | --- |
| pre-fix (LUA-46/47 present) | 11,278 | identical |
| post-fix | 7,009 | identical |

The aggregate moved by 4,269 — the LUA-46 writes — and the oracle **reported the
same per-label verdict for every label it covers**, because the defect lives in the
three labels it does not derive. **An oracle whose coverage stops where the newest
code starts cannot audit the newest code.** That is the workstream's named failure
mode ("both say nothing, and nothing agrees with nothing") reproduced inside a
single lane, and it is the strongest available statement of the oracle's limit: a
grammar bug shared by both paths is invisible to both, and here the *coverage* gap
is invisible too.

### Labelled — the confusable pairs and the rule that separates them

| Pair | Separation | Pinned at |
| --- | --- | --- |
| `uses` vs `references` | a qualified access's FIELD is `references`; only a BARE name is `uses`. `uses` `labelShape` is `{bare: 54,829}` corpus-wide | `lua/read-classes` |
| `uses` vs `calls` | a callee member is `calls`, under either spelling | `lua/read-classes` |
| `uses` vs `contains` | a `variable_list` child binds a name; a `parameters` child binds one | `lua/read-classes`, `lua/name-reads` |
| `uses` vs a table key | a `field`'s key is a declaration site | `lua/name-reads` |
| `references` vs a WRITE | an assignment target is in a `variable_list` and is not a read | `lua/read-classes` |
| `references` vs `calls` | a member that is called is not merely read | `lua/read-classes` |
| `references` vs a computed index | `tbl[key]` has no member name; `tbl["key"]` does | `lua/read-classes` |
| `exports` vs a value | `return "literal"` publishes nothing | `lua/export-edges` |
| `overrides` vs `extends` | one member shared or not; `Derived.stop` is pinned as NOT an override | `lua/override-shapes` |
| `overrides` vs a metatable | `mt` is a metatable, not a base | `lua/override-shapes` |

### Resolved — per type, plus the population the rate cannot see

Resolution here is **name-based** against the symbols of the file's own tree, which
is the limitation wave 2 raised: a name carried by two symbols in one file scores as
resolved. So the last two columns are the population the rate is blind to.

| Type | Edges | Both ends resolve | Source | Target | Target ambiguous by name | of edges |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | 55,198 | **45.2%** | 25,116 | 54,956 | 16,028 | 29.1% |
| `extends` | 171 | **36.3%** | 108 | 117 | 2 | 1.2% |
| `uses` | 54,829 | **22.4%** | 17,678 | 39,557 | 14,654 | 26.7% |
| `overrides` | 67 | **19.4%** | 13 | 66 | **65** | **97.0%** |
| `instantiates` | 122 | **18.0%** | 22 | 122 | 2 | 1.6% |
| `calls` | 57,393 | **9.8%** | 14,421 | 16,790 | 2,523 | 4.4% |
| `references` | 40,013 | **4.7%** | 8,568 | 9,441 | 2,735 | 6.9% |
| `imports` | 6,601 | **0.3%** | 165 | 677 | 24 | 0.4% |
| `exports` | 5,167 | **0.1%** | 4 | 1,774 | 334 | 6.5% |

The CSS `references` reference point is 66.8% at both ends; lua's `references` is
4.7%. Three measured causes, none fixable by reading the tree harder:

1. **`global` is not a symbol.** Every file-scope edge is sourced from `global`,
   which is a scope label. That is most of `contains` at 45.2% despite 54,956 of
   55,198 targets resolving, and all of `exports` at 4 resolving sources of 5,167.
   The convention is pre-existing and load-bearing for `imports` and `calls`.
2. **Lua reads the standard library, not the file.** `string.format`,
   `table.insert`, `math.floor`, `ipairs`, `pairs` are members and functions whose
   declarations are in the C runtime and in no `.lua` file in the corpus. That is
   most of `references` and `calls`.
3. **`require` returns a name no file declares.** `imports` targets a module-path
   string; the module's own file declares symbols, not the path.

**Two populations a rate cannot see, both measured:**

- **Name collisions.** `overrides` resolves 66 of 67 targets, and **65 of those 67
  are ambiguous** — more than one symbol in the file carries the target name. The
  19.4% rate reads as a small shortfall; the truth is that 97% of the edges that
  "resolve" resolve to a name that denotes several symbols. `contains` is 29.1%
  and `uses` 26.7% on the same measure. A rate that is neither 100 nor 0 is hiding a
  population.
- **Sources that are not callable.** Of the `calls` edges whose source resolves,
  15,283 resolve: **14,377 to a `function`, 259 to a `method`, and 647 to a
  `variable`.** A `variable` is not itself callable, and whether it holds a
  function is written nowhere — 4.2% of resolved call sources. This is the shape
  the aggregate reported for zig (0.49% of named call sources not callable, hidden
  because the census resolves by name); lua's population is nearly ten times larger.

### Confident

`evidenceClass` and `metadata.relationshipType` are on **every analyzer-produced
edge**, and this is now a gate rather than a reading:
`script/m60/verify-lua-evidence-tier.ts` fails if any analyzer edge carries no tier, or
if any sub-1.0 confidence carries `structural`. Measured over the full 3,252-file draw,
**219,576 analyzer edges, 0 missing a tier, 0 violations**:

| Type | confidence | evidenceClass | relationshipType |
| --- | --- | --- | --- |
| `calls` | 1.0 × 57,393 | `structural` 57,393 | absent |
| `uses` | **0.9 × 54,829** | `usage_contextual` 54,829 | `lua_name_read` 54,829 |
| `references` | **0.9 × 40,013** | `import_based` 40,013 | `lua_member_read` 40,013 |
| `contains` | 1.0 × 55,198 | `structural` 55,198 | absent |
| `exports` | 1.0 × 5,167 | `structural` 5,167 | `lua_module_return` 5,167 |
| `imports` | 1.0 × 6,601 | `import_based` 6,601 | `lua_require` 6,601 |
| `extends` | 1.0 × 169; **0.95 × 2** | `structural` 169; `usage_contextual` 2 | `lua_metatable` 169; `lua_factory_supertype` 2 |
| `overrides` | 1.0 × 65; **0.95 × 2** | `structural` 65; `usage_contextual` 2 | `lua_redefinition` 65; `lua_inherited_member` 2 |
| `instantiates` | 1.0 × 122 | `structural` 122 | `instantiates` 122 |

**Zero analyzer edges below 0.7.** In the draw quoted here the pool-worker regex
fallback did not fire at all, so the 0.4/0.5 `calls` edges of earlier runs are absent;
when it does fire it contributes edges at 0.4 and 0.5 with **no** `evidenceClass`, and
§5 names the 12 files where that happens. Those edges are tallied apart in every artifact
(`fallbackFiles`, `fallbackEdges`) and are counted here as **not this analyzer's** — the
previous version of this table mixed them into the same column, which is why the
`structural 66` / `absent 8` rows it replaces were not readable.

**Heuristic ratio: 54,829 + 40,013 = 94,842 of 219,561 = 43.2% at 0.9**, every one
carrying `usage_contextual` or `import_based` as honesty contract §4 requires, plus 4
edges at 0.95 = 43.2% overall. The 0.9 is not a hedge: the node proves a name is READ
and the BINDING it denotes — local, upvalue, global, stdlib, or a field of a module this
file never read — is written nowhere.

`contains` and `calls` carry no `metadata.relationshipType`. That is not an omission of
a reason code: both are 1.0, and §4 requires a reason code for anything **below** 1.0.

**Overturn condition for this section.** One edge with confidence < 1.0 and
`evidenceClass: structural`, or one analyzer edge with no tier, fails
`verify-lua-evidence-tier.ts`. The check cannot show the rule is right for a type nobody
has exercised — it tests the tiers this corpus produces.

## 7. DERIVATION findings: 3, not 9 — and the correction is itself a finding

A DERIVATION finding is a type the analyzer emits that no differential audits.
Wave 1 reported **9 of 9**. That number was right about the shared harness and
wrong as a statement about the lane:

- `script/m14/differential.ts`'s `LANGS` has no `lua` entry, so
  `--lang lua` measures 0 lanes. Against the **shared** differential, all 9
  emitted types are unaudited.
- The standalone oracle audits **6 of the 9** at recall 1.0, now on **4 repos**
  (603 files, 60,142 truth edges) rather than kong alone, and at **0 missing and 0
  unexplained on every audited label** after this pass's four oracle fixes (§6).
  Recall 1.0 was already true on kong; the four-repo run is what turned 3 false MISSING
  and 4 unexplained `contains` into 0.
- The **3 that remain unaudited by anything** are `uses`, `references` and
  `overrides` — exactly the 3 wave 1 added, and unchanged by this pass. All four
  defects this pass found in the ANALYZER (LUA-46, LUA-47, LUA-48, LUA-49) were found
  by probes and by the oracle's *disagreement*, and two of them (LUA-48, LUA-49) are in
  `contains`/`extends`, which the oracle DOES audit — so the oracle earned its keep here.
  LUA-46 and LUA-47 are in the unaudited three, and the oracle scored both runs
  identically.

So: **9 DERIVATION findings against the shared differential, 3 against all
instruments combined.** The residual debt is `uses`, `references`, `overrides`, and
closing it needs truth derivation for those three in `lua-truth-oracle.ts` — which
is this lane's file and is doable, or a `LANGS.lua` entry plus a baseline row in
`script/m14/differential.ts`, which is shared (§8).

**Mutation.** `script/m60/mutate-lua-read-classes.ts` — 2 mutants, **2/2 caught**,
restore clean:

| Mutant | Defect reinstated | Caught by |
| --- | --- | --- |
| LUA-46 | `assignment_statement`/`namedChild(0)` in place of the `variable_list` exclusion | `forbidRelationships references -> a L80`, `references -> b L80` |
| LUA-47 | receiver-only rule, field exclusion removed | 7 rows: `uses -> member L42`, `uses -> inner L47`, `uses -> callee L52`, `uses -> plain L55`, `uses -> a L80`, `uses -> b L80`, `uses -> other L84` |

Recorded because it is not obvious: **LUA-46 is caught by exactly two rows, and
not by the `references -> member L71` / `references -> inner L75` rows**, because
`member` and `inner` were already published at L42 and L47 and `addRelationship`
dedupes on type+source+target, so the write's edge never reaches the store to be
compared. Those rows are correct contract rows that cannot fail on this file; the
two L80 rows carry the mutant. That is why the multi-target shape is pinned even
though the corpus contains none of it. `mutate-lua-node-identity.ts` (wave 1's) is
still caught, 8 forbid rows.

## 7a. M60 LUA-54 — cause C, and the rule that was rejected instead

`script/m14/incoming-gate.ts` counts an edge `unresolved` unless it resolves to exactly
one published declaration **or carries a declared external marker**. lua read
`external 0`: every standard-library edge counted against the lane. The mechanism is an
additive metadata key and it changes no edge count, which is what makes it the cheapest
lever on the incoming side and the easiest to abuse — a wrong `external` claim moves a
name out of `unresolved` without moving anything toward truth, and the arbiter's PASS then
means less than it did.

### The rule, and the one rejected on measurement

**Shipped.** Mark `external` when the edge's target is the field of a
`dot_index_expression` / `method_index_expression` whose receiver is an **identifier**
naming one of the eight documented Lua 5.4 standard tables (`string`, `table`, `math`,
`io`, `os`, `coroutine`, `debug`, `utf8` — reference manual §6, transcribed into
`LUA54_TABLES`), **and** this file declares no symbol under that receiver **at or before**
the edge's line. The receiver, the field, the declaration and the line are all read off
nodes; the only transcribed input is eight table names.

**Rejected.** "target is a bare name in a transcribed stdlib surface, and this file
declares nothing under that name." It marks **16,195** of 219,981 edges against the
shipped rule's 3,525 — **4.1x** — and it is a name-match **guess**. `insert` is in the
list because `table.insert` is documented; a bare `insert(x)` with no receiver is an
undefined **global** named `insert`, and Lua 5.4 publishes no such global. The
measurement that settles it: **0** edge targets a dotted `table.field` spelling anywhere
in the corpus, because the analyzer publishes the **final segment** of a member read
(LUA-13), so the name list cannot recover the receiver from the target. Both numbers are
in `validation/m60/lua/external-marking.json`, measured on the same walk.

### Measured

Production `parseFile`, whole-corpus draw of 3,252 `.lua` files from 199 repos
(drawDigest `502ef2f4...`), 3,250 parsed, 0 parse failures, 84,162 symbols, 219,981
relationships:

| type | edges | marked | receiver is a documented table |
| --- | --- | --- | --- |
| `calls` | 57,473 | **2,738** | `table` 1,367 · `string` 976 · `math` 455 · `os` 309 · `io` 217 · `coroutine` 110 · `debug` 90 · `utf8` 1 |
| `references` | 40,054 | **787** | as above |
| all others | 122,454 | **0** | — |
| **TOTAL** | **219,981** | **3,525** | 1.6% |

### The edge set did not move

`script/m60/verify-lua-stdlib-external.mts` hashes every edge as
`(file, type, source, target, line)` — metadata is not in the key, so a metadata-only
change cannot move it:

```
with the rule     219,981 edges   3,525 marked   edgeDigest bc0c38b6b77c23cacea92cfc613366cdf14e9699ccc89c56be963a69f21d5608
without           219,981 edges       0 marked   edgeDigest bc0c38b6b77c23cacea92cfc613366cdf14e9699ccc89c56be963a69f21d5608
```

The second row is reproducible with `git checkout <pre-LUA-54> -- src/ast/real-lua-analyzer.ts`.
The oracle agrees independently: `script/m60/lua-truth-oracle.ts` returns
`truth=61075 observed=107780` at **both** the pre-LUA-54 and post-LUA-54 analyzer — the
identical result, so the change is neutral to the correctness audit and not merely
invisible to a digest.

### Two classes deliberately NOT marked

- **`imports` module targets, 6,601 edges.** An `imports` target is a Lua **module**,
  not a declaration. One file cannot tell a sibling module from a luarocks rock, and
  `script/m60/classb-origin` measured both populations: **2,425** dotted targets whose
  module file is in the corpus draw against **3,060** whose file is absent. Marking all
  6,601 would assert the second count for the first. See R6.
- **scope-label targets, 176 edges.** And the committed audit's own `scope-label` bucket of
  469 is **contaminated**: it tests the name before the file's own declarations, so
  `kong/kong/cmd/utils/prefix_handler.lua:362` `contains write_env_file file` is bucketed
  as a label when `file` is a local from `local file = io.open(...)`. **293** of the
  whole-corpus draw's label-named targets are user variables named `file`/`owner`/`global`
  that the file does declare. A program may name a variable `file`.

### What is still not settled for lua's incoming side

`declared-elsewhere-in-corpus` — a bare name that IS declared somewhere in the corpus but
collides with more than one declaration — is **55,703 edges** at whole-corpus scale and is
the largest remaining class. It is cause A, and this lane's measurement says cause A is
**closed for lua by the language rather than fixable in the front end**: the ambiguity
class splits three ways and **`genuinelyAmbiguous` is 0 on every one of the ten types** —
`lexicallyUnique` 1,533 + `lexicallyInnerWins` 19 on `calls` alone, with every candidate
determined by a line-bounded visibility test. The published NAME cannot express a
resolution that `startLine`/`endLine`/`scope` already determine; what remains is the
walker's bare-name rule, which is shared machinery.

## 7b. LUA-55 — the `imports` residual is ONE shape, and the fix is a FILE claim, not an exclusion

**The largest named FIXABLE cause on this lane's incoming side, fixed with a before/after over the same
population.** Two whole-population gate runs, one change between them, both labelled:

    BEFORE  HEAD bad316c7d · analyzer bc9de4bc3fd0bd0b · 3,250 files · 0 failed · 0 degraded
    AFTER   HEAD beb03387f · analyzer d35f6e6f6d1f3339 · worktree change = the file claim ONLY

    imports  imports       6601     76        0         880        120        5645        0       0       0        0        0       0         0        0
    imports  imports       6601     76        0         880        120        1796        3849    0       0        0        0       0         0        0
    of those 4930 verified: 1081 by owner lookup in the key space, 3849 against the project's own pubspec files + file list

and the classifier (`script/m14/incoming-rule.ts`), `pool-worker.ts` and `engine.ts` are
**byte-identical** at both revisions, which is what makes the pair comparable rather than merely
sequential — the tree moved under this session (another lane committed twice), and the comparability
argument is digest-by-digest in `validation/m14/fixtures/lua/measurements/imports-file-claim.md` §0.

**What the edges share.** The gate's own marker-set table puts ALL 5,645 on ONE signature,
`luaSpecific+relationshipType`, and the shape split of the class is **dotted 5,485 · bare 97 · hyphen
33 · slash 28 · Upper 2** — so this is one cause and not five. It is the programme's most repeated
cause, *a module path is not a declaration*, of which this lane carries 5,645 of the 14,890 the cause
list can name across seven lanes.

**The mechanism, and the two it is NOT.** `require("a.b.c")` now carries
`metadata.importProjectFile` — the project-relative path of the `.lua` file the module names — whenever
the shared guard confirms one on disk. It is **not** the `metadata.moduleTarget` exclusion R6 proposed
(an exclusion says *do not look* and cannot be refuted), and it is **not** the `isExternal` marker this
lane priced and refused on 2026-10-09 (**1,560 of 5,485 REFUTED**: `imports lapis.application` has owner
`lapis`, and the project declares `lapis`). The candidate arithmetic is this lane's — dots become
directory separators, `X.lua` before `X/init.lua`, and four bases: the project root (`./?.lua`), the
requiring file's own directory (busted), the prefix ending at the file's first `lua/` segment (Neovim
runtimepath / OpenResty), and `<fileDir>/lua/` — while the admitted-extension clause, the
inside-the-project clause, the size cap and the `statSync` stay inside the shared guard.

**Priced before it was emitted**, and the price includes the refutation column: a labelled stride sample
of 358 of 3,250 files reads **544 VERIFY / 0 would-refute / 196 residue** of 740 sampled-unresolved,
with **candidate multiplicity `1=544`** (every claimed edge has exactly ONE admitted candidate, so the
base ORDER never decided an outcome) and **0 disagreements** between the probe and the landed guard over
740 edges. And the refutation column is **0 over the whole population by construction**: the guard binds
on `statSync`, the arbiter refutes on `git ls-files`, so the two can disagree only on a `.lua` file
present on disk and NOT tracked — measured **0 of 3,250**.

**The arbiter is one of the control's arms**, not an afterthought:
`tools/require-file-claim-control.ts` runs 10 arms and asserts each positive claim through
`verifyFileClaim` itself, plus four arms that must write NO claim (absent module, no `projectRoot`,
escaping target, a directory that is not a module file). **ALL ARMS PASS.** And the change is ADDITIVE,
measured rather than asserted: `tools/claim-preservation-dump.ts` over 181 files / 14,585 edges reports
**MOVED 0 · CLAIMED added 276 · removed 0 · changed 0**. Fixtures both arms:
`summary: {"lua":{"pass":13,"fail":0}}`.

**What it does not close**, stated because a fix that reports only its own effect is not a measurement:
the residue is real and counted (3,849 of the 5,645 moved to an `extOK` claim verified against the project's own file list and **1,796 remain unresolved**, on the same marker signature `luaSpecific+relationshipType` — the LuaRocks toolchain and the rocks this corpus does not vendor (`luarocks.util`, `luarocks.fs`, `luarocks.core.cfg`, `tap`, `argparse`, `compat53.module`, `pl.file`); the claim does not touch them, `extFAIL` stays 0, and `unresolved` is the TRUE reading for them.), and the claim asserts ONE thing — *the project
carries a `.lua` file this module name names* — and nothing about symbols, so it never raises
`resolved`.

### The lane's largest cause, RULED and now BOUNDED from the gate's own two tables

The largest not-resolved class is `uses` on `luaSpecific+relationshipType` — **44,797** (41,424 amb +
3,373 unres), 33.2% of the residual — and it is ruled, not fixed, by `BD-ambiguity-full`: the ambiguity
is INSTRUMENT SCOPE over a bare-name key space, with **B3_indistinct 193 (0.12%)** the only
inexpressible class. This session adds a bound that needs no corpus run, from an inclusion the gate's
own classifier guarantees (`sameFileUnproven` is returned only when a declaration of the target exists
in the edge's own file, so it cannot be an `unresolved` edge):

    |ambiguous ∩ ownFileAnswered| ≥ (sameFileUnproven + intended) − resolved

    calls ≥ 3,282 (10.8%) · uses ≥ 29,986 (72.4%) · imports ≥ 601 (68.3%) · references ≥ 5,608 (24.2%)
    exports ≥ 830 (26.4%) · extends ≥ 63 (91.3%) · overrides ≥ 65 (100%) · instantiates ≥ 72 (100%)

**What it does not say**: *the own file answers* is not *the own file answers UNIQUELY*, and the
resolver's own-file preference needs uniqueness — which is exactly the lexical instrument's B1/B2/B3
split. The bound therefore SUPPORTS the ruling and does not replace it. The full table, the instrument
finding it produced, and the falsifiers are in
`validation/m14/fixtures/lua/measurements/imports-file-claim.md` §§8–10.

### The next candidate fix that LOOKS priced and is not — read this before starting it

`calls` is 12,519 unresolved (marker `luaSpecific`) and the 2026-10-09 split's mark simulation records
**M2 — "a bare identifier target the project declares nowhere, restricted to `calls`" — as
marked 12,517 · externalVerified 12,517 · externalUnverified 0 · REFUTED 0**. On those numbers an
external claim on the class looks free, and it is the single largest remaining fixable-looking bucket on
this lane.

**It is not a price, and the reason is the one the handoff names as the gate's only real laundering
vector (§5k/§5l).** M2's rule was evaluated against the PROJECT key space — that is what the simulation
had — so its applicability condition IS the arbiter's refutation condition, and it verifies by
construction. A per-FILE analyzer does not own that key space: the implementable rule is "a bare name
this FILE does not declare", which the project can and does refute (another file declares it). The price
of the implementable rule has never been taken, and the number above is not it.

What a real price needs, in this order: the analyzer-side declared-name set per file, the project key
space, the refutation count of the file-scoped rule, and the cross-tab between them. The lane's existing
`stdlib-external` fixture and the `markStdlibExternal` rule are the wrong vehicle — that rule marks a
member read whose RECEIVER is one of the eight documented Lua 5.4 tables, deliberately not a bare name —
so this would be a new claim kind on `calls`, not an extension of that one.

## 8. Declared limitations

Lua is Turing-complete and dynamically typed. For a language in that class a blank
limitations list would be a defect, so these are the specific things this analyzer
does not do, each with its number.

1. **Every count in this document is a single-run observation.** §5 names the 12
   files that are absent from the graph in any given run. A rerun will differ by
   roughly ±0.25% on relationships. The digest is published so a reader can tell
   whether two runs used the same draw; it cannot make the run deterministic.
2. **3 types have no oracle.** `uses`, `references`, `overrides` are derived by the
   analyzer and compared against nothing (§7). Both defects this pass found are in
   that unaudited set, which is the strongest argument for closing it.
3. **A binding is not derivable.** `uses` fires on a bare name read; which binding
   that name denotes is written nowhere. Hence 0.9, `usage_contextual`, and 22.6%
   both-ends resolution.
4. **A reserved word can be a real name and can never resolve.** 111 bracket-literal
   keys corpus-wide (`v['function']`, `assert.is["true"]`) produce correct edges
   whose target no symbol can ever carry. 50 such edges reach the graph.
5. **4 of 3,252 corpus files are not parseable Lua**, one of them a Jinja template
   with a `.lua` extension whose edges are derived from template syntax (§4). The
   analyzer is not making the language more tolerant of this, on purpose.
6. **`setmetatable(self, …)` is not resolved.** 45 sites across 42 files
   (B8 `derivedIsSelf`). The derived table is only reachable by evaluating the
   constructor. This is why `lua_inherited_member` measures 1 edge against 79
   inheritance links.
7. **An expression base is not resolved.** 374 sites across 218 files
   (B8 `unresolvedBase`), e.g. `setmetatable(opts or {}, defaults)`. No name is
   written, so no edge target could be.
8. **Inheritance is a convention, not a keyword.** `extends` and `overrides` read
   `setmetatable`/`__index`, and since LUA-51 a factory whose body folds a
   supertype-role parameter into a `__`-prefixed metamethod. A table that inherits by
   another runtime mechanism — a C library's metatable, or a factory that composes the
   parent WITHOUT a `__` field — is not seen. `class("Name")` calls are recognised as a
   class DECLARATION (a symbol). The residual is measured rather than asserted: 13
   functions in the corpus declare a `parent`/`super`/`base` parameter, 7 of them are
   passed a name there, and LUA-51 reads 2 of those 7. The other 5 are tree traversal,
   and the discriminator that excludes them is the metamethod fold — so a factory that
   inherits by plain table composition, with no `__` field anywhere, stays unread and
   would be indistinguishable from traversal under this rule. That is the honest limit
   of the rule, and it is a rule chosen over publishing 5 fabricated edges.
9. **The module surface is only what a chunk-scope `return` names.** Four shapes
   carry no written name and stay silent, disclosed in `ctx.unpublishedSurface`:
   `return require("x")` (a re-export), `return "literal"`, `return function() end`,
   and a positional `return {1,2}`. Naming any of them would mean inventing a name.
10. **Aliasing and metaprogramming are invisible.** `local alias = M.run` then
    `alias()` is a `calls` edge to `alias`, not to `M.run`. Same for
    `for k, v in pairs(M)` and any table key read through a computed index.
11. **No module identity, and no cross-file resolution.** A Lua chunk is not a
    module, so file-scope edges are sourced from `global` and no symbol is named
    after the file. Every endpoint is resolved against the symbols of its OWN file,
    which is why `imports` sits at 0.3%. Both are deliberate refusals to fabricate
    rather than gaps.
12. **`overrides` rests on 67 edges in 38 files**, of which 65 are redefinitions and
    2 are inherited members. A number that small does not support a strong claim, and
    97% of its targets are name-ambiguous (§6).
13. **The suite's own reach is bounded.** `script/m14/run-fixtures.ts` **exits 0
    without executing any fixture** for `lua`, because its lane gate refuses `lua`
    for having expectation files with no runner lane in `LANGS`. This lane's 10
    fixtures and 167 assertions only run under `script/m60/run-lua-fixtures.ts`.
    Reporting a lane's fixture suite as passing without naming the runner would be
    reporting a number from a script that executes nothing.
14. **A loop variable is not published as a declaration.** `for _, line in ipairs(x)`
    binds `line` in Lua, and after LUA-49 nothing states that: the `contains` edge that
    used to appear was on the wrong line for the wrong reason, and the binding itself is
    now silent. `for k, v in pairs(t)` is one of the most frequent constructs in the
    language, so publishing every loop variable is a symbol-count and graph-payload
    decision for the whole surface rather than a lane-local fix. Reported, not done.
15. **The shared arbiter's instrument A measures bash's grammar for lua** (§3.3).
    `ontology-coverage-gate.ts` resolves its wasm from `differential`'s `LANGS` with a
    `?? "tree-sitter-bash.wasm"` fallback and `LANGS` has no `lua` entry, so the gate's
    "128 distinct node types" is bash's vocabulary. The `implements` verdict is
    unaffected; the basis string is false, and the error can only ever manufacture an
    ABSENCE, which is the direction that lets a wrong ruling survive.
16. **This lane's oracle had never been run outside kong until this pass**, and it had
    four defects that reported agreement while being wrong (§4). An oracle is an
    authority until it is measured; this one was not, for a whole wave.
17. **A name declared more than twice publishes ONE `overrides` edge.** The dedup in
    `addRelationship` is unconditional, and `script/m60/lua-dead-flag-probe.ts` measures
    what that costs over 3,252 files: **90 redefinition attempts over 53 distinct keys, so
    37 are suppressed**, the extreme being 13 attempts on `overrides global enqueue` — a
    name declared **14 times** in one chunk. The later declarations' own lines are
    unrepresented. This was previously dressed as a `dedupe` option that four call sites
    passed `false` to and that could not change any output (LUA-53, §4); the option is
    gone and the behaviour it misdescribed is declared here instead. Making it emit all
    90 would add 37 edges sharing `(type, source, target)` with an edge already stored,
    which is LUA-01b — a schema question above this analyzer — and `bb_graph` would then
    see the duplicates. Not decided here.
18. **One call site is unreachable and is left in place.**
    `processNode`'s `identifier` arm calls `detectFrameworks`, which returns immediately
    unless the text contains a dot. An `identifier` in the pinned grammar never does: a
    qualified name is a `dot_index_expression` with its own case arm. Measured over the
    whole corpus, **782,443 identifier nodes and 0 containing a dot**, so the arm cannot
    fire. Framework detection runs through `processCall:872` and `addImport:983-988`,
    which is why the framework gates pass. It is left rather than deleted because the
    only honest proof that removing a call changes nothing is the whole-output diff
    LUA-53 needed — and one line is not worth a 30-minute two-process proof. Declared,
    not hidden.
19. **Three of this lane's own gates had never reported a verdict** (§4): one did not
    parse, one expected 6 of 12 committed fixtures, and one reported six false positives
    against correct analyzer code. Every number in this document that comes from a gate
    was therefore produced by a gate that had not run before wave 3. That is the same
    failure as LUA-02's counter and LUA-10's scoring branch, one level up: the
    instruments were assumed rather than measured, and the assumption was three commits
    deep in two of the three cases.
20. **The heuristic ratio is 43.2% and that is the honest ceiling for this language.**
    `uses` and `references` — 94,842 of 219,561 edges — rest on a name in a value
    position, and which binding that name denotes is written nowhere. Raising either
    above 1.0 would be a claim about Lua's runtime that no parse can support.

## 8a. Reported to the supervisor, not applied here

Seven items need a file this lane does not own (§8 of the workstream doc). Each is
written so it can be applied without re-deriving it.

**R1 — `script/m14/ontology-coverage-gate.ts` measures the WRONG GRAMMAR for lua.** One
line, :240: `const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`.
`differential.ts`'s `LANGS` has no `lua` entry, so the fallback fires and every Lua file
is parsed with **tree-sitter-bash**. The gate prints `128 distinct node types`; lua's own
instrument A over the same draw reports **100**. The `implements` verdict survives —
bash's vocabulary has no `implements_clause` either — but **the error points the dangerous
way**: a vocabulary that is too small can only ever find an ABSENCE, so a lane whose real
grammar DOES contain one of its candidate node types reads presence as absent, and a
ruling that should be overturned reads RULED-SOUND. **Fix:** resolve the wasm from the
grammar the analyzer itself pins, or throw instead of falling back. Every lane using
instrument A through this fallback inherits it. Measured by
`script/m60/lua-ruled-proof.ts`, which asserts the fallback rather than describing it.

**R2 — wire `LUA_RULED` into the gate.** Two lines, §3.3: one import and one map entry.
Until they land, `npx tsx script/m14/ontology-coverage-gate.ts lua` **exits 2 and refuses
to report**, because a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED, which is a verdict about the table and not about the lane. The table
is proved by applying exactly that patch to a scratch copy and running the real gate.

**R3 — the shared fixture runner's export invariant is wrong for Lua.**
`script/m14/run-fixtures.ts` requires every export to resolve to a top-level symbol. In
Lua the module IS a returned object literal, so `return { alpha = 1 }` publishes `alpha`
as a **property of an object literal** and there is correctly no symbol named `alpha`;
the same holds for a `return` from inside a `do` block or a loop body, which the pinned
grammar places below `chunk`. Measured: 6 names — `fromDoBlock`, `fromLoop`, `alpha`,
`beta`, `gamma`, `nested`. The fix is to exempt the LANGUAGE beside the runner's existing
`isJsModuleBinding`, and the patch is written and proved in
`script/m14/lua-lane-registration.ts` PART 2. **Not** to give those names symbols: that
fabricates declarations out of table fields, which is the refusal of LUA-26 and LUA-35
restated. Until it lands, `script/m60/verify-lua-fixtures.ts` exits 1 and says
`BLOCKED ON THE SHARED RUNNER, not on the lane`.

**R4 — `script/m14/firing-check.ts` does not exist.** The workstream prompt names it as
the first command to run and as the instrument that drives `parseFile` and tallies per
type. There is no such file in this tree. The lane reports against
`ontology-coverage-gate.ts`, which drives the same production entry point, but two agents
pointed at the same instrument and one of the names is wrong.

**R5 — LUA-01b, the schema question the analyzer may not answer.** Whether the store may
hold two edges of one kind between one pair of symbols. It decides the 37 suppressed
`overrides` edges of limitation 17: emitting them means 37 edges sharing
`(type, source, target)` with an edge already stored, which `bb_graph` would read as
duplicates. The analyzer's dedup is unconditional and the option that used to pretend
otherwise is gone (LUA-53). The decision is a schema owner's.

**R6 — SUPERSEDED 2026-10-11. The gate HAS a bucket for "this type's target is a MODULE", and this
lane now uses it.** The bucket is not the `metadata.moduleTarget` exclusion proposed here; that
proposal is **WITHDRAWN by its own author**, because an exclusion says *do not look* while the thing
this class needs is a statement the project can **check**.

What exists instead, landed by the Lead in `57aa3be79` and shared by eight lanes:
`metadata.importProjectFile` (`FILE_CLAIM_KEY`, `src/ast/file-claim.ts`). A relationship whose target
names no declaration may state that the project carries the **FILE** the target names; the arbiter
(`verifyFileClaim`, `script/m14/incoming-rule.ts`) looks the candidate up in the project's own
admitted list and **REFUTES** it when it is not there. Three properties make it the right shape and
none of them was available to the `moduleTarget` proposal:

* it is **refutable** — a wrong claim costs an edge rather than excusing one, which is why the
  programme prices a claim before emitting it;
* it is read **only where the target names nothing** (`classifyEdge` consults it inside
  `if (decls === 0)`), so it can never raise `resolved` and never touches an edge the key space
  already answers — and, unlike the binding and `remoteRef` claims, it is **not** refuted by a
  target that does resolve, because it is never read there at all;
* the admitted-extension clause lives **inside the guard**, so this lane cannot relax it by editing
  its own spelling of it.

`require "kong.tools.table"` is still a module identifier that no symbol can carry, and the
3,060-vs-2,425 split is still invisible from one file — the claim does not pretend otherwise. What it
adds is the one fact about that pair a single file CAN be wrong about in a checkable way: whether
`kong/tools/table.lua` is in the project. The count, the price, and the split are now measured in
`validation/m14/fixtures/lua/measurements/` and in "LUA-55" below; the earlier pointer to
`validation/m60/lua/external-marking.json` records the *external-marker* split, which is a different
question and is NOT the mechanism this lane adopted.

**R7 — `validation/m60/results/lua-truth-oracle-kong.json` disagrees with its own command.**
The committed artifact records `truthEdges 61125 / observedEdges 107827`; a fresh run on
the same `repo=kong files=1312 parseErrorFiles=1` population returns `61075 / 107780`.
Two consecutive fresh runs are byte-identical, so the oracle is deterministic and the
**committed artifact is stale** by 50 truth edges and 47 observed edges. It is **not**
caused by LUA-54: the oracle returns the identical `truth=61075 observed=107780` at the
pre-LUA-54 analyzer `458f7ba97`, and TREE-DERIVED truth does not depend on the analyzer at
all. This lane does not own `validation/m60/results/` and has reverted its regeneration
rather than committing it. Reported with the command and both numbers so it can be
re-derived or discarded on a decision rather than an argument.

## 9. Verification

Every gate below was executed at commit `8d8860549` unless the row says otherwise. Six
of them had **never produced a verdict** before wave 3 (§4, limitation 19), so this
table is the first measurement of most of its own rows.

| Gate | Command | Result |
| --- | --- | --- |
| Lane fixtures | `npx tsx script/m60/run-lua-fixtures.ts` | **12 fixtures, 195 assertions, 0 failing** |
| Mutants — evidence tier (LUA-52) | `npx tsx script/m60/mutate-lua-evidence-tier.ts` | **1/1 caught**, 3 failing rows, restore clean |
| Mutants — `extends` supertype (LUA-50/51) | `npx tsx script/m60/mutate-lua-extends-supertype.ts` | **2/2 caught**, 7 failing rows, restore clean |
| Mutants — read classes (LUA-46/47) | `npx tsx script/m60/mutate-lua-read-classes.ts` | **2/2 caught**, 11 failing rows, restore clean |
| Mutants — bindings (LUA-49) | `npx tsx script/m60/mutate-lua-bindings.ts` | **3/3 caught**, 8 failing rows, restore clean |
| Mutants — node identity (LUA-45) | `npx tsx script/m60/mutate-lua-node-identity.ts` | caught, 8 forbid rows, restore clean |
| Mutants — export shapes | `npx tsx script/m60/mutate-lua-export-shapes.ts` | **5/5 caught**, restore byte-for-byte. M1 is caught by a check other than the one the script names, because `return { "a", "b" }` yields a number and the type check rejects it before the mutated fallback can fabricate a name |
| **Evidence tier** (honesty contract §4) | `npx tsx script/m60/verify-lua-evidence-tier.ts` | **PASS** — 219,576 analyzer edges, **0** missing a tier, **0** sub-1.0 claiming `structural` |
| **Dead-flag probe** (LUA-53) | `npx tsx script/m60/lua-dead-flag-probe.ts` | 90 redefinition attempts over 53 keys → **37 suppressed**; 782,443 identifier nodes, **0** containing a dot |
| **`dedupe` removal proof** (LUA-53) | `npx tsx script/m60/verify-lua-dedupe-invariant.ts --rev 14153d8e2` | **PASS** — 32,271 relationships and 8,624 symbols identical line for line; 0 only-in-either; restore sha256 verified |
| Grasp/field conformance | `npx tsx script/m60/verify-lua-grasped-fields.ts` | **PASS 7/7, 3/3 mutants caught** — after the §4 fix. It reported 6 false positives and exit 1 before it |
| Member identity | `npx tsx script/m60/verify-lua-member-identity.ts` | **PASS 17/17, 6/6 mutants caught** |
| Edge lines (M59) | `npx tsx script/m60/verify-lua-edge-lines.ts` | **PASS 7/7, 5/5 mutants caught** |
| Published claims | `npx tsx script/m60/verify-lua-published-claims.ts` | **PASS 11/11, 4/4 mutants caught** |
| Export shapes | `npx tsx script/m60/verify-lua-export-shapes.ts` | **42 passed, 0 failed** |
| Call targets | `npx tsx script/m60/verify-lua-call-targets.ts` | **29 passed, 0 failed** |
| Symbol integrity | `npx tsx script/m60/verify-lua-symbol-integrity.ts` | kong, 1,311 files, 51,984 symbols, **0 violations** across all five invariants; 5 disclosures (`selfOwned`) |
| Shared fixtures, via the lane | `npx tsx script/m60/verify-lua-fixtures.ts` | **FAIL — 2 failing, 0 missing, 0 unexpected.** Both are the shared runner's export invariant, which is wrong for Lua: `return { alpha = 1 }` makes the module an object literal, so its exports are properties with no declaration site. The patch is pasted and proved in `script/m14/lua-lane-registration.ts` PART 2 and is **not** applied here — `script/m14/run-fixtures.ts` is shared (§8) |
| Types | `npx tsc --noEmit -p tsconfig.json` | clean |
| Regex census | `npx tsx script/m12/verify-regex-census.ts` | gate exits 1 on **other lanes**; **0 entries name `real-lua-analyzer.ts`**. Verified independently: the only `/…/` literal in the analyzer is inside a comment at :934 |
| Doc-truth emissions | `bun run script/m14/verify-doc-truth-emissions.ts` | **0 findings for lua** (was `NO_CLAIM_TABLE`). The gate as a whole still exits 1 on findings belonging to other lanes |
| Honesty gate | `bun run script/m14/verify-honesty.ts` | 22 failures, **none naming lua**; all are the pre-existing shared freshness defect (`freshness rule flags every artifact`) |
| Ontology arbiter | `npx tsx script/m14/ontology-coverage-gate.ts lua` | **exit 2, refuses to report** — no `RULED_BY_LANG.lua`; wiring is a §8 report item (§3.3) |
| Ontology arbiter, **with the wiring applied** | `npx tsx script/m60/lua-ruled-proof.ts` | **9 EMITTED, 1 RULED-SOUND, 0 FALSIFIED, 0 unjustified, gate exit 0** (§3.3) |
| Shared differential | `npx tsx script/m14/differential.ts --lang lua` | 0 lanes; no `LANGS.lua` |
| Shared fixtures, direct | `npx tsx script/m14/run-fixtures.ts` | executes nothing for `lua` (limitation 13) |

**`script/m14/firing-check.ts`, named by the workstream prompt, DOES NOT EXIST** in this
tree, so the prompt's prescribed first command cannot be run. The equivalent instrument
is `script/m14/ontology-coverage-gate.ts`, which drives the same production entry point
(`parseFile` from `src/ast/pool-worker.ts`) and tallies per type — and it is the one
this lane reports against. Reported, not created: `script/m14/` is shared (§8).

Instruments, each committed and each independent of the analyzer's rule table:

| Script | What it measures |
| --- | --- |
| `script/m60/lua-wave2-audit.ts` | the census. Sharded, with a `drawDigest` so two runs are comparable on a *provable* draw. `--shard i/8` then `--merge` |
| `script/m60/lua-nondeterminism.ts` | per-file digests over two passes, naming the files that differ |
| `script/m60/lua-write-as-read.ts` | LUA-46's population: assignment targets by shape, and genuine member reads |
| `script/m60/lua-uses-references-double-publish.ts` | LUA-47's population: `uses`/`references` pairs on the same member and line |
| `script/m60/lua-grammar-shape.ts` | the parse-tree shape behind each exclusion, printing tree AND edges per case |
| `script/m60/lua-endpoint-attribution.ts` | reserved-word and literal endpoints by node type and role, with `insideError` |
| `script/m60/lua-grammar-inventory.ts` | instrument A: the 100 node types, and per-type `silentByConstruction` |
| `script/m60/lua-edge-where.ts` | attributes one edge to the source line that produced it |
| `script/m60/lua-truth-oracle.ts` | the independent oracle (§6), and the site of four defects of its own (§4) |
| `script/m60/lua-conformance-probe.ts` | instrument B for the ONE ruled type: every construct that would carry an `implements` edge (§3.2) |
| `script/m60/lua-labelling-audit.ts` | self-edges per type and non-bare target shapes — LUA-48's population (§4) |
| `script/m60/lua-ruled-proof.ts` | applies the gate wiring to a scratch copy, checks the table against the gate's own type, runs it (§3.3) |
| `validation/m60/lua-trace.sh` | the two-run determinism comparison, end to end |

**Complexity.** One iterative AST walk, plus three whole-file pre-passes
(`collectErrors`, `collectDeclaredTables`, `collectSupertypeLinks`) — the pre-pass list is now five with `collectFactorySupertypeLinks` (LUA-51) and `collectDecoratorFacts` (see the Complexity envelope section at the top of this page). Relationship
identity uses a set; declaration, owner and member decisions read the current frame
and pre-pass maps. No per-symbol scan of the symbol or relationship arrays and no
O(n²) resolution path. The two fixes added one parent-type test each and no new
traversal: `emitMemberRead` gained one `if`, `emitNameRead` split one `else if` into
two branches. An analyzer regex census reports **0 regexes** in
`real-lua-analyzer.ts`; every rule reads the AST.

## 10. Symbols

83,745 symbols over the 3,252-file draw: **74,701 `variable`, 4,810 `method`,
4,225 `function`, and 9 with kind `undefined`** — all 9 from pool-worker's regex
fallback (§5), none from the analyzer. **0 empty names.**

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

Function parameters retain identifier/vararg information; ranges are byte-precise
from the declaration node. Function-local variables are emitted as scoped
variables; parameters, anonymous function expressions, field/index mutations and
local reassignments are not declarations. No synthetic Love2D hooks, anonymous
coroutine symbols, or anonymous table classes are generated.
## Incoming pass (append-only record, 2026-10-09) — the claims, the split, the gaps, the silent types, the ambiguity

Appended rather than woven in: every number above was measured at another commit, and rewriting
them would destroy the comparison. Instrument for everything below:
`validation/m14/fixtures/lua/incoming-split.mts` (it IMPORTS `classifyEdge`/`externalClaimOf`/
`tally` from `script/m14/incoming-rule.ts` rather than copying them, so its columns cannot drift
from the gate's, and every run re-measures the gate exactly — `COMPARE … AGREE`).

### 1. The external claims are VERIFIED, not unverifiable

`incoming-gate --json lua lua 60`: `1802 resolved · 1305 ambiguous · 2222 unresolved of 5415 ·
markedExternal 86 · externalVerified 86 · externalUnverified 0 · externalRefuted 0`. The one marker
key is `external` (lua54-stdlib, `markStdlibExternal`), every marked target is a BARE IDENTIFIER
(`format`, `concat`, `open`) and has no arbiter owner, so the arbiter checks the target itself: 86
verified, 10 of the 96 marked edges the project answers (mark inert), and **0 refutable by
construction** — a bare-identifier claim is consulted only where the project answers the target
nothing. A corpus-wide arm (3,250 files) reads 3,525 marked edges with 1,081 verified, 0
unverifiable, 0 refuted.

The module-path class stays UNMARKED and now has its refutation count: marking every unresolved
edge refutes 11 claims, 9 of them `imports` whose owner segment is in-project (`kong.deprecation`
owner `kong`, `cjson.safe` owner `cjson`, `cmp.types` owner `cmp`).

### 2. The 2,222 unresolved, split

| bucket | edges | what it is |
|---|---|---|
| declared in the SAME project | 1,112 (50.0%) | 297 would read `resolved`, 815 `ambiguous` at a complete key space — SAMPLE REACH, not a defect |
| declared in the corpus, another project | 417 (18.8%) | production is project-scoped: not resolvable for this edge, not a defect |
| declared nowhere | 693 (31.2%) | 232 bare calls (`uint8`,`string` — `_ENV` host globals), 222 receiver-carrying field references, 125 module paths, 40 uses, 38 `Upper` constants, 10 HTTP headers, tail <10 |

Whole-corpus scope, so no column is read alone: 219,981 edges = 42,442 resolved · **140,782
ambiguous (64.0%)** · 35,676 unresolved. The sample inflates unresolved and deflates ambiguity.

### 3. The `gap` field, which this spec did not have

`script/m14/spec/lua-completeness.json` carried NO `gap` field — unstated, which the board cannot
distinguish from "no gaps". It now carries `_description` + six measured entries (LUA-G1..G6):
`implements` ruled by the grammar; the role-resolved supertype-as-argument class (7 sites in 5
files over 13 factories); the 45 `setmetatable(self, …)` + 374 expression-base sites; module paths
(6,601 edges, 2,425 in-corpus files vs 3,060 absent, 9 refutations if marked); the missing callee
shape on `calls` (5,631 host-global targets, fix named: publish what `callee()` already computes);
and the sample-reach half of the unresolved column.

### 4. The three "silent" types

The default stride (`firing-check.mjs LUA`, 120 of the lane's 400 kong files) reads `7 types fired —
implements overrides instantiates SILENT`. Whole-population: `NFILES=4000 bun
script/m14/firing-check.mjs LUA` reads **9 types fired, SILENT: implements**, with `instantiates:8
overrides:3`. Whole-corpus census type table (3,250 files, 219,981 edges): `overrides 67`,
`instantiates 122` — matching §3.1's 67-in-38-files and 122-in-65-files — and `implements` absent.
Two of the three were stride artifacts; the third is ruled by the grammar. No analyzer change.

### 5. The 1,305 ambiguous

684 multiFile (52.4%) · 312 oneFileDiffOwner (23.9%) · 303 oneFileSameOwnerSameKind (23.2%) · 6
oneFileSameOwnerDiffKind (0.5%), across 566 distinct names. The kinds and markers agree: these are
bare local/field names (`variable` 1,007 of the kind signatures), and `oneFileSameOwnerSameKind` IS
the `lua_redefinition` construct the `overrides` type publishes. Ruled irreducible at edge identity
(spec BD-ambiguity); the option that would move part of the multiFile bucket — targeting the
qualified path, as `json` does — is a change to what an edge NAMES, not a resolution repair, and it
would replace LUA-15's container+own-name identity.

### 6. One red fixture fixed, two remain red (pre-existing)

`lua/stdlib-external` was FAILING on its three positive rows because the expectation pinned
`"meta.external": "true"` — a STRING — while the analyzer publishes the BOOLEAN `true`, and the
runner compares with `!==`. A string marker is inert for the arbiter too (`EXTERNAL_KEYS` is read
with `=== true`), so the fixture was pinning the exact spelling the fleet warns about. Corrected to
`true`: **lua/stdlib-external now PASSES** (11 of 13 fixtures).

Still failing, and NOT touched by this pass — both are recorded `ok: false` in
`validation/m14/results/M14.0.F3.json`, i.e. red in the baseline before today:
`lua/export-edges` and `lua/export-shapes`, both with `export invariant violated: export(s) […]
do not resolve to a top-level symbol (membership rides Contains)`. That is a real contract question
about `exports` (whether an exported name must be answered by a symbol or may ride its `contains`
edge), it is the same class as the 52 unresolved `exports` edges in the sample arm, and it needs
its own ruling rather than a spelling fix.

### 7. The 140,782 ambiguous at the GATE'S key space — §5's proportions are a 60-FILE artifact

The residual is 80.2% and the ambiguous column is the whole of it: **140,782 of 219,981 edges**
(`residual-gate.ts --lane lua`, whole admitted population, production scope; artifact
`measurements/residual-gate-lua.txt`; `extFAIL`/`bindFAIL`/`causeFAIL` all 0). §5 above answered the
ambiguity question at 1,305 edges over a 60-file key space. This is the same question at the size
the gate measures.

**THE BUCKET ORDER SURVIVES; THE PROPORTIONS DO NOT.** The same four-way collision split, run at the
gate's own key space (`incoming-split.mts --nf 4000 --all` — the corpus is 3,250 files, so the
sample arm IS the full arm and the log prints both as identical; artifact
`measurements/incoming-split-lua-full.json`):

| bucket | §5, at 60 files | whole population (3,250 files) |
|---|---|---|
| multiFile | 684 (52.4%) | **131,914 (93.7%)** |
| oneFileDiffOwner | 312 (23.9%) | 3,778 (2.7%) |
| oneFileSameOwnerSameKind | 303 (23.2%) | 4,551 (3.2%) |
| oneFileSameOwnerDiffKind | 6 (0.5%) | 539 (0.4%) |
| distinct names | 566 | 15,326 |

A target's declarations can only span the files the key space contains, so a 60-file sample cannot
see the cross-file collisions the gate counts. **multiFile was never 52.4% of this lane's ambiguity;
it is 93.7% of it**, and a reader who took 52.4% as the size of the cross-file problem would have
sized the work at half of what it is.

**CAUSE #1, NAMED AND COUNTED: bare-name targets resolved against a global key space.** The gate's
marker-set table splits the 140,782 by metadata signature, and the largest single class mapping to
one type and one mechanism is `(no marker)` = **41,592 edges (29.5%)** — which is exactly the
`contains` count, because `addContainsRelationships` publishes `owner -> symbol.name` with `{}`
metadata, leaving the target a bare declaration name and the edge carrying nothing else. The full
table: `luaSpecific+relationshipType` 46,935 (33.3%) · `(no marker)` 41,592 (29.5%) ·
`luaSpecific` 29,121 (20.7%) · `luaSpecific+receiver+relationshipType` 21,129 (15.0%) · the four
`external…` signatures 1,940 (1.4%) · the two `overrides…` signatures 65.

**RULED LEGITIMATE — and the evidence is this lane's own lexical instrument, not an argument.**
`ambiguity-split.ts` over 3,250 files / 83,906 symbols / 219,981 edges / **0 parse failures, 0
fallback files** (`validation/m60/lua/ambiguity-split.json`) decomposes ITS OWN multiSymbol
population of 163,583 edges:

| class | edges | share |
|---|---|---|
| B1_lineSettled — Lua's ORDER rule names exactly ONE declaration at the edge's line, in its own file | 94,398 | 57.7% |
| B2b_fileAbsent — the target is absent from the edge's own file; the collision is entirely in others | 63,881 | 39.0% |
| B2c_noneVisible — the edge precedes every local declaration of that name | 5,111 | 3.1% |
| **B3_indistinct — the class the published NAME genuinely cannot separate** | **193** | **0.12%** |

`contains` alone: multiSymbol 43,854 → B1 43,739 (99.7%), **B2b 0**, B2c 0, **B3 115**. There is not
one `contains` edge in the corpus whose target is absent from its own file, and 99.7% are settled to
exactly one declaration by the ordinary rule at the line the edge already carries. So the edge is
TRUE and its target IS one declaration given `(file, line)`; what cannot use either is the arbiter's
bare-name lookup over a global key space. That is **instrument scope** — the same shape as LUA-G6 on
the unresolved column — and no analyzer change reaches it without replacing LUA-15's
container+own-name identity, which BD-ambiguity declined and this measurement does not reopen.

**THE TWO DEFINITIONS ARE NEVER ADDED.** The gate's `ambiguousByDecl` is 140,782 (its rule, its key
space); the lexical instrument's `multiSymbol` is 163,583 (bare name PLUS `qualifiedName`, deduped on
file/qualifiedName/kind/line). Every number here is quoted with its instrument, and 140,782 + 193 is
not a sum of anything.

**FALSIFIER, stated so this ruling can fail:** it holds only while the name-inexpressible class stays
small. If a later run shows B3_indistinct growing materially, or shows `contains` with a non-zero
B2b_fileAbsent, this ruling is refuted and the identity change becomes the work.

**NOT RUN, reported as such:** the first attempt at the collision split was killed by the lock, not
by the measurement — `flock -w 600 9` timed out (exit 9) while another lane held `.bb-heavy.lock`, so
the run never started. The re-run waited `-w 3600` and completed.

**NEXT CAUSE, from the same tables, for a later pass:** `calls` is the type whose ambiguity is
mostly NOT lexical — multiSymbol 41,851 → B1 11,473, **B2b 29,274 (70%)**, B2c 1,104, B3 0 — and its
marker signature is `luaSpecific` alone, i.e. it carries no receiver. LUA-G5 already names the fix
the analyzer computes and throws away (`callee()`'s shape, `:2177`), and that is where the B2b mass
for `calls` should be attacked.
