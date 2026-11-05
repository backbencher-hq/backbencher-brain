# erlang.md

> **2026-10-23, M14 CAMPAIGN ADDENDUM — READ THIS BEFORE READING A NUMBER.**
> The ER3 wave measured a corpus that no longer exists. On this checkout `.corpus` carries otp at a
> different revision, rebar3, and elixir (48 `.erl`); **cowboy is not in the corpus at all**. Every
> ER3 population figure in this document — 4,326 files, 4,617 files, the 3,939-file censuses, the
> `424,081 calls`-style whole-corpus tables — is **SUPERSEDED, not edited in place**, for the reason the
> cpp lane recorded: a number whose population changed must be superseded visibly, because a reader who
> finds it cannot otherwise tell whether it is wrong or merely old. The current state, the supersession
> table and the campaign's admitted population are in `validation/m14/verification/ERLANG-STATE.md`.
> **THE CAMPAIGN'S ADMITTED POPULATION IS 4,465 `.erl`/`.hrl` FILES OVER 3 REPOSITORIES** (otp 4,148 ·
> rebar3 269 · elixir 48; `git ls-files`, 1 MiB cap, 0 absent, 6 over cap; measured 2026-10-23), and the
> relationship vocabulary is the campaign's **14 values**, not the ten: since **ER-D46**
> `-include`/`-include_lib` publish **`part_of`** (file inclusion) instead of `references`, and
> `decorates`/`renders`/`mixes_in` are **RULED** with the evidence in
> `script/m14/spec/erlang-completeness.json` and `validation/m14/measurements/erlang-grammar-nodes.json`.
> Wherever this document still says an include is a `references` row, that is the PRE-ER-D46 reading.

> **ER3 (2026-09-28).** This document was rewritten against the current tree
> after the wave found that the previous version described code that was never
> committed. Every number here is re-measured; the witness is named beside it.
> The full review is `reviews/erlang/m49-er3-grammar-truth.md`, the rulings are
> `script/m14/spec/erlang-completeness.json` (31 decisions, ER-D1..ER-D31).

## Language

- Analyzer file: `src/ast/real-erlang-analyzer.ts`
- Parser: `tree-sitter-erlang` (pinned `wasm/tree-sitter-erlang.wasm`, sha256
  `8d20d814…`; the wired bytes are byte-identical to `@lumis-sh/wasm-erlang@0.26.0`,
  whose metadata names WhatsApp/tree-sitter-erlang v0.15.0 at rev `f21023bb` built
  with tree-sitter 0.26. The M12.24 A/B on the corpus had found 11 vs 11
  grammar-error files, 0 fixed, 0 regressed — no swap; upstream has moved past
  v0.15.0, but no newer source or build is obtainable offline, so that upgrade is
  not claimed, and npm's tree-sitter-erlang is a `0.0.1-security` placeholder with
  no build. Registry: `validation/m14/grammar-pins.json`; round:
  `reviews/functional-family/m60-grammar-pins.md`. Tree:
  `-module`/`-export`/`-import`/`-include`/`-include_lib`/`-behaviour`/
  `-define`/`-record`/`-type` are `attribute` nodes; functions are
  `fun_decl` → `function_clause` → `expr_args` + `clause_body`
  (a NEW `fun_decl` opens at every semicolon-separated clause, so merging
  clauses into one symbol is the analyzer's job — measured 2026-09-25); calls
  are `call` (`Module:func(...)` → `remote` → `remote_module` (atom) + the
  function `atom`; local calls are `call` with a bare `atom` callee);
  `#state{...}` construction is
  `record_expr`, `State#state{...}` update is `record_update_expr`,
  `State#state.q` access is `record_field_expr` (all three distinct node
  types); `receive ... end` is `receive_expr` with optional
  `receive_after`; the `!` send operator parses as `binary_op_expr`
  (the `send_expression` branch never fires in this grammar))
- Language detection: `.erl` → `erlang` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealErlangAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (paren strip, arity strip, record-name strip,
  type-name strip — pure char scans, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `-module` → module name (FIRST declaration wins, ER-D15); `-record` → record name; `-define` → macro name; `-type` → type name; `-opaque` → type name with `meta.isOpaque`; `-callback` → a Method symbol with the sig's arity and `meta.isCallback`; functions → the clause's `atom` name. Function IDENTITY is name + ARITY (#880/ER-D2): `pick/0` and `pick/1` are two symbols, and every semicolon-separated clause group of one name/arity merges into ONE symbol whose range spans every clause and whose `meta.clauseCount` states how many |
| kind | ✅ | `-module` → `module`; `-record` → `struct` (Erlang records are the record-struct analog); `-define` → `constant`; `-type`/`-opaque` → `type`; `-callback` → `method`; `-nifs` entries → `function` with `meta.isNif` (`-on_load` emits NOTHING — it names a function the module already declares, and a symbol there would be a second row for one entity); functions → `function`; fields of a record → `property` |
| complexity | ✅ | per SYMBOL: base 1 + case/receive/try arms (`cr_clause`, `catch_clause`), if arms (`if_clause`), a `receive_after`, `andalso`/`orelse`, plus one per extra clause (ER-D13). A clause HEAD is a match, not an arm |
| qualified/container name | ✅ | `ownerName` = enclosing module for records/macros/types/functions; record fields owned by their record symbol (`contains record -> field`) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | from the `clause_head` variable children |
| visibility | ❌ (n/a) | Erlang has no visibility keyword — all functions are module exports or not; `-export` list recorded as metadata |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ yes | `call` nodes in EVALUATION context (a clause head is a pattern; type syntax is DECL-ONLY, ER-D3). Local `f(...)` resolves only against the file's declared `(name, arity)` set — the forward-reference prepass (`ctx.declaredFnKeys`), BIFs excluded exactly by arity (ER-D45); remote `m:f(...)` keeps the module qualifier (`module:function`, ER-D1), extracted structurally from `remote_module` + the function atom, and `?MODULE:f(...)` expands to the current module (ER-D14). `metadata.callArity` is part of the edge identity (ER-D2). Per-site line is the callee's name node (src/ast/real-erlang-analyzer.ts:1605, 1632, 1674) | 0.9 — name-resolved: `usage_contextual` for a local target, `reference_qualified` for a qualified remote one. No heuristic tier: every target is read from a node |
| extends | ❌ no | No inheritance construct exists. The analyzer has **0** `RelationshipType.Extends` sites; the pinned grammar declares **0** inheritance productions (0 of 137 named node types and 0 of the 173 anonymous tokens; of 23 inheritance-shaped probes — `class_declaration`, `extends_clause`, `superclass`, `subclass`, … — 0 are in the grammar's table and 0 are produced by 3,939 corpus files, `script/m60/erlang-construct-probe.ts`), and **0** of the `-extends`/`-inherits`/`-subclass`/… attribute spellings occur. RULED grammar-absence (ER-D34; the ruling carries the corpus instrument) — Erlang's module composition is `-behaviour` → `implements` and `-include` → `part_of` | n/a — no edge to resolve |
| implements | ✅ yes | `-behaviour(B)` → the behaviour ATOM, one edge per directive, never a standalone symbol (ER-D6): a behaviour is a cross-module contract, so the edge is the whole claim. Line = the behaviour atom (src/ast/real-erlang-analyzer.ts:951) | 1.0 — `structural`: the claim IS the syntax |
| uses | ✅ yes | record member READ (`S#r.f`, `#r.f`) emits `uses` to the RECORD and to the FIELD; record UPDATE (`S#r{f = …}`) emits to the record and to each assigned field. EVALUATION contexts only — a head pattern emits nothing (ER-D7); `metadata.context` names `record member read` / `record field update` (sites: src/ast/real-erlang-analyzer.ts:1740, 1752, 1775, 1790) | 1.0 — `usage_contextual`: resolved against this module's declared record/field set |
| imports | ✅ yes — relationship edge **and** `import-site: ImportInfo[]` payload | `-import(Module, [f/a, …])` → the MODULE name, one edge per directive (ER-D41); `metadata.importedFunctions` carries the names and `metadata.isExternal:true` is ER-D20's classification (an OTP module cannot be declared in this file). The same fact is published through the **`import-site: ImportInfo[]` channel** (`ctx.imports.push`, `importType:"named"`, `isExternal:true`, `importedNames`/`items`) — and that payload channel ALSO carries `-include`/`-include_lib` paths with `importType:"include"`/`"include_lib"` and their own `isExternal`, while the include RELATION is `part_of` (ER-D46). Edge site src/ast/real-erlang-analyzer.ts:1052, payload :1024, include-payload :1123 | 1.0 — `import_based`: the directive is the syntax |
| exports | ✅ yes — relationship edge **and** `export-site: ExportInfo[]` payload | `-export([f/a])` and `-export_type([t/0])` → ONE `exports` edge per `fa` in the attribute (ER-D40): source = the module (else the file path, ER-D32), target = the bare name with the arity in `metadata.arity`, `metadata.exportForm` = `export`/`export_type`, line = the `fa`'s own name line (M59 #825). `-export([?MODULE/0])` resolves `?MODULE` to the module (ER-D28) and an UPPERCASE name is read as the grammar's `var` (ER-D42). ALSO published through the **`export-site: ExportInfo[]` channel** (`ctx.exports.push`, name + arity + kind, `metadata.isTypeExport` for `-export_type`; src/ast/real-erlang-analyzer.ts:975 payload, :1001 edge) | 1.0 — `structural`: an `-export` list is a public-surface declaration |
| contains | ✅ yes | declaration OWNERSHIP only: module → its records/macros/types/functions/callbacks, record → its fields (ER-D6, ER-D33). Source = the owning container (module symbol, else the file path for a module-less header, ER-D32); target = the member identity as the member's declaration publishes it; line = the member's NAME line, never the construct's (ER-D33; site src/ast/real-erlang-analyzer.ts:2066) | 1.0 — `structural`: a member's declaration list is the syntax |
| references | ✅ yes | four mention classes: the `-import` MODULE mention (ER-D41); macro USES (`?MACRO`, emitted whether or not defined here, ER-D8); fun VALUES (`fun f/1`, `fun m:f/2` — a value is not an invocation, ER-D9); type dependencies from `-type`/`-opaque`/`-nominal`/`-spec`/`-callback` bodies and record field types, APPLIED names only (ER-D10/ER-D31; the leaf-qualifier of a remote type is kept, ER-D1). `-include`/`-include_lib` are `part_of` since ER-D46 — a mention cannot say the file became part of this unit. Sites: src/ast/real-erlang-analyzer.ts:899, 1061, 1699, 1828, 1855, 1872, 1886, 2002 | 1.0 for the `-import` mention and record-type references; 0.9 for the module-name macro use, fun values, and applied type references inside a declaration (name-resolved across the file). `evidenceClass: reference_qualified` on every `references` row |
| overrides | ❌ no | No member can redefine a member it INHERITS: Erlang has no inheritance, nothing is inherited, and `-behaviour` is CONFORMANCE (`implements`, above). **0** `RelationshipType.Overrides` sites; the pinned grammar declares no override production; the 33 in-file `-callback`+definition pairs collapse to ONE symbol (ER-D30), so the edge would be a self-loop; the 2,548 callback-supply identities are the OPPOSITE direction from overriding and are already published as `implements`; the preprocessor's own `'redefine'` marker is declared 88 times and exercised 0 times in one file. RULED grammar-absence, reconciled against the contract's DIRECTION (ER-D50) | n/a — no edge to resolve |
| instantiates | ✅ yes | `record_expr` (`#state{…}`) in BODY/guard position only → the record name (ER-D4); a record literal in PATTERN position (clause head, `expr_args` before the guard/body) emits nothing; `record_update_expr` (`State#state{…}`) is a member WRITE (`uses`) and never a construction (site src/ast/real-erlang-analyzer.ts:1716) | 1.0 — `structural`: `#r{}` in evaluation position is the construction syntax |
| decorates | ❌ no | An Erlang attribute is COMPILE-TIME ANNOTATION or a compiler directive, and the vocabulary's contract requires an APPLIED CALLABLE the runtime applies to a declaration (src/ast/types.ts). Measured whole population: 36,352 annotation-attribute sites (`doc` 34,423 · `moduledoc` 1,381 · `dialyzer` 329 · `vsn` 87 · `author` 80 · `nifs` 27 · `on_load` 20 · `copyright` 5) plus 16,686 `-spec` and 429 `-callback` — passive metadata or contracts, never an applied callable; 0 decorator productions in the served grammar. RULED ontological (ER-D47; the proposal deliberately left annotations on existing values) | n/a — no edge to resolve |
| renders | ❌ no | 0 of the served build's 137 named node-type ids is a component-element production (`jsx_element`/`jsx_self_closing_element`/`jsx_opening_element`/`element` match zero; `bin_element` is a binary segment, adjudicated), 0 render sites over the 4,465-file population; the nearest thing Erlang has — 31,256 `wx`/`wxe` widget-construction sites — is `calls` (module:function), not a component render. RULED grammar-absence (ER-D48; the javascript inventory is the cross-grammar positive control) | n/a — no edge to resolve |
| mixes_in | ❌ no | 0 of the 137 named node-type ids is a mixin/with-clause/class production, 0 corpus sites; `try_class` (4,830 sites) is the exception CLASS of `try … catch C:R ->` (adjudicated, not a class declaration); Erlang has no classes and no supertype chain, and its composition constructs are counted elsewhere — `-behaviour` → `implements`, `-include` → `part_of`. RULED grammar-absence (ER-D49; groovy `trait_declaration` and scala `trait_definition` are the positive controls) | n/a — no edge to resolve |
| part_of | ✅ yes | `-include("x.hrl")` / `-include_lib("kernel/…")` — FILE INCLUSION (ER-D46): the header is spliced into this module's single compilation scope, cannot be compiled as a unit of its own, imports nothing. Source = the file carrying the directive (its module symbol, else its path, ER-D32); target = the path AS WRITTEN; `metadata.partRole:"library"` and `metadata.isFileInclusion:true` are MANDATORY on every row; line = the path STRING's line, not the keyword's (M59 #825; site src/ast/real-erlang-analyzer.ts:1138) | 1.0 — `import_based`: the tier follows the construct (a file-inclusion directive), not the old mention reading |

**This is the single claim table.** The measured per-type bodies below are kept, under
non-claim headings, because they carry the numbers and the probes this table cites:
`## Ontology measurements — …`. Where a measured body still describes the pre-ER-D46
reading of an include (it was a `references` row), the ER-D46 note beside it is current.

### Type dependencies: an applied name, never a bare one (ER3, 2026-09-25)

In Erlang type syntax a **bare unquoted atom is the atom LITERAL of that name**
(`-type day() :: monday | tuesday.` declares two literals; writing `integer`
without parens is the ATOM integer, not the type `integer()`), and a **map or
record field key is a DECLARATION** (`#{id := job_id()}` declares the field
`id`). Only an APPLIED name is a type use:

| Shape (pinned grammar) | Emits | Why |
| --- | --- | --- |
| `call` with an atom head — `binary()`, `atom()`, `term()` | `references <type> -> <name>` | an application |
| `call` under `remote(remote_module(atom M, ':'), atom T)` — `dict:dict()` | `references <type> -> M:T` | an application, qualification KEPT (ER-D1: a bare leaf would conflate every module's `dict`) |
| `record_expr` naming a record — `#ctx{server :: pid()}` | `references <type> -> ctx` **and** each field TYPE (`pid()`) | a record type is a declaration that depends on its record and on its field types |
| bare `atom` — `monday`, `undefined` | nothing | an atom literal |
| field key of a `map_field` / `record_field` — `id`, `server` | nothing | a declaration site |

The ER2 authoring counted every bare atom. The M12 differential caught the
consequence on its own fixtures: `references job -> id` and `references job ->
kind` were fabricated out of the map keys of `#{id := job_id()}` and RESOLVED to
the record properties of the same name. On the two pinned corpora the old rule
produced **4,043 type-dependency edges whose own site line does not apply the
name it cites** (OTP, 4,154 files) and **244** (rebar3, 269 files); after the
narrowing both are **0**, measured per edge against the site line
(`validation/m14/results/archive/erlang-er3-corpus-census.json`).

The same DECL-ONLY boundary now covers record types: a `record_expr` inside
`-type`/`-opaque`/`-spec` is a declaration of the record's SHAPE and emits no
`instantiates` (it produced **471** such edges inside OTP's type declarations,
now 0). Not a calls edge, not a construction — a type.

### Where a file-level edge's source lives

A module-less file (every `.hrl` header, and a `.erl` before its `-module`)
attributes its edges to the FILE PATH — which is what `ownerNameOf`
(`src/ast/real-erlang-analyzer.ts`) and `currentSource` both return, and which
`parseFile` supplies as an ABSOLUTE path.

**This section previously claimed the fallback is `Global`, and that is false.**
`Global` is the string the shared oracle uses
(`script/m14/oracles/erlang-contains.ts`, `NO_MODULE`); the analyzer never emits
it. Measured over the 3,939-file census (`validation/m14/tmp/erlang-ontology-census.json`):
**21,223 `contains` edges, 103 `references`, 13 `exports` and 1 `imports` edge
carry an absolute checkout path as their SOURCE, and 21,221 symbols carry one as
their `ownerName`.** That is 21,340 relationship endpoints and 21,221 symbols
whose identity changes with the checkout directory, on a repository where F5
compares `label + target` and never reads `from` — which is why nothing has ever
reported it.

It is NOT fixed here and the reason is stated rather than implied. ER-D32 is a
reviewed decision with its alternatives recorded (synthesising a module name from
the filename fabricates a module no compile can produce; an empty owner loses the
containment of every real declaration), and changing the owner changes
`ownerName` on 21,221 published symbols and the source of 21,340 edges — a
store-visible change to a published contract, not a lane-local edit. The cheapest
correct fix is a PROJECT-RELATIVE path, and the analyzer is not given a project
root: `parseFile(filePath, projectPath)` exists
(`src/ast/pool-worker.ts:712`) but `projectPath` is never forwarded into the
`AnalyzeContext` that reaches `analyze(rootNode, content, filePath, context)`
(`src/ast/engine.ts:1663`). Filed for the owner; measured here so it is a number
and not a story.

- Parser: `tree-sitter-erlang`, pinned at `wasm/tree-sitter-erlang.wasm`
- Language detection: `.erl` -> `erlang` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` -> `RealErlangAnalyzer`
- **Pure AST.** Every symbol and relationship derives from Tree-sitter nodes.
  The only string processing is on values already read out of a node, and it is
  pure char scans: **0 regexes** in the file (M12 census; the family metric is
  `validation/m49/regex-debt-register.json`, which has 0 erlang entries).

### The grammar, measured

`script/m14/tmp/erlang-grammar-census.ts` walked the pinned wasm over 4,326
corpus files (otp 3,874 / rebar3 264 / cowboy 188) and observed **213 node types,
122 of them named**. The wasm's own node-type table declares **137 named
entries (132 distinct — `binary_op_expr` appears 4x, `macro_call_expr` 2x,
`unary_op_expr` 2x)**. Every one of the 132 is classified exactly once in the
completeness spec: 104 `handled_verified`, 28 `internal_silent`, **0 gaps**
(`bun run script/m14/tmp/erlang-spec-verify.ts`).

The difference between 122 and 132 is why the classification is derived from the
grammar's table and not from a census: a corpus walk can only see what the corpus
happens to exercise.

Four shape facts the whole analyzer is built on, each measured:

| fact | measurement |
|---|---|
| every DECLARATION is a child of `source_file` | `module_attribute`, `spec`, `callback`, `record_decl`, `pp_define`, `type_alias`, `opaque`, `nominal`, the attribute forms — each with `source_file` as its only parent — **except when the file does not parse** (ER-D29) |
| the grammar gives **every clause its own `fun_decl`** | 18,444 `fun_decl` for 18,409 `function_clause`; `;` is a child of `fun_decl` 7,059 times. One Erlang function is one (name, arity) (ER-D26) |
| a comprehension generator's `<-` is **inside a `generator` node** | `lc_or_zc_expr -> generator -> {LHS, <-, RHS}`. Reading `lc_or_zc_expr`'s own children finds no operator (ER-D25) |
| a malformed `-record #r{...}` wraps the **whole file** in one `ERROR` node | `-module`, the record and the `-export` lists all become `ERROR`'s children (`rec_remote_unknown.erl`) |

### The kind partition is 8 emitted + 17 ruled, and the 8 + 17 is the enum

The store's `SymbolKind` has 25 distinct values (31 members, 6 backward-compat
aliases). This analyzer emits 8 of them and rules the other 17 with a reason
each, recorded in `symbol_kind_audit` in `script/m14/spec/erlang-completeness.json`.
The audit exists because `macro` was in the enum, named by the LSP identity list,
emitted by 8 analyzers — and emitted by no Erlang symbol at all until ER-D39.
The same pass over the relationship enum found two more (`exports`, `imports`).
Reading the analyzer for what looks missing finds none of those three; comparing
it against the enum finds all three.
## Symbol contract — the measured additions (2026-10-04)

This is the measured companion to the contract table above; the rows the older body
repeated twice are collapsed to one each, and the last one's "three declaration forms"
now names the FOUR metadata flags it lists (`isMacro` was the missing fourth).

| field | supported | how it is derived |
|---|---|---|
| `name` | yes | `-module` -> module · `-record` -> record · `-define` -> macro (`var` child of `macro_lhs`) · `-type`/`-opaque`/`-nominal` -> type · `-callback` -> method · clause head -> function, **including a `?MODULE()` head** (ER-D25/D28) |
| `kind` | yes | `module`, `struct` (a record), `property` (a record field), `macro` (a FUNCTION-LIKE `-define`), `constant` (an OBJECT-LIKE `-define`, which really is a compile-time value), `type`, `method` (a callback), `function` (ER-D39) |
| `ownerName` | yes | the module for functions/methods/types/records/macros; **the record** for its fields |
| `range` | yes | the declaration node; a function's range spans every clause of that (name, arity) |
| `parameters` | yes | one per clause-head element. A head is a PATTERN, so each carries `name` (only for a plain variable) and always `pattern`, plus `type` when a `-spec` supplies it (ER-D21) |
| `returnType` | yes | the `-spec` return expression. A `-spec` declares no symbol; the `fun_decl` does (ER-D3/D27) |
| `complexity` | yes | per symbol: 1 + decision points (ER-D17) |
| `visibility` | **N/A** | Erlang has no visibility keyword. `-export`/`-export_type` are the export lists: recorded on `ExportInfo` AND emitted as `exports` edges (ER-D40) |
| `isStatic` / `isAsync` / `isAbstract` / `decorators` / `genericParameters` | **N/A** | Erlang has no modifiers, decorators or generics. Erlang macros are not generic |
| `isNif` / `isOnLoad` | yes (metadata) | `-nifs`/`-on_load` ANNOTATE the declared function; they never mint a second symbol (ER-D22) |
| `isCallback` / `isOpaque` / `isNominal` / `isMacro` / `isFunctionLike` | yes (metadata) | the FOUR declaration/annotation flags that are easy to lose; `isFunctionLike` is what splits `macro` from `constant` (ER-D39) |

**Function identity is (name, arity).** `pick/0` and `pick/1` are two functions;
the second clause of either is the same function. A module that both declares
and defines a callback yields ONE symbol whose kind and line are the
**definition's** — the contract's line stays in `metadata.callbackLine` (ER-D30).

## Ontology measurements — the ten-type table (2026-10-04, pre-ER-D46 — kept as measured evidence)

> **Scope.** This table is the 2026-10-04 ten-type reading, kept because it is the measured
> body the claim table above cites. The current vocabulary is FOURTEEN values, and the
> canonical claim table is at the top of this page; four values are not rows here —
> `part_of` (emitted since ER-D46, measured below under the ten-type corpus reading) and the
> three ruled `decorates`/`renders`/`mixes_in`. Where a row still spells the pre-ER-D46
> reading of an include, the note beside it is current.

| relationship | derived from (per ER ruling) | notes |
| --- | --- | --- |
| `contains` | module -> function/method/type/record/macro, record -> field | the member's own declaration line |
| `implements` | `-behaviour(b)` | the edge only, never a symbol (ER-D6) |
| `calls` | local `f(...)` when `f` is declared in the file; remote `m:f(...)` with the module KEPT (ER-D1) | per-site, keyed by `metadata.callArity` (ER-D2). `?MODULE:f()` expands to this module (ER-D9) |
| `uses` | record member read (`S#r.f`, `#r.f`) and record update (`S#r{f=…}`) | java/kotlin member-read parity (ER-D24) |
| `instantiates` | a record construction outside pattern position | an UPDATE is `uses`, never `instantiates` (ER-D4) |
| `references` | import; a `?MACRO` use; a fun VALUE (`fun f/1`, `fun m:f/2`); a type dependency from a `-type`/`-opaque`/`-nominal`/`-spec`/`-callback` body, from a record field's type, and a record named in a type | a qualified TYPE keeps its module (ER-D31). **This row's `include`/`include_lib` half is historical**: since ER-D46 an include is `part_of`, not a reference |
| `exports` | `-export([f/a])` and `-export_type([t/0])`, one edge per `fa` in the attribute (ER-D40) | the module's public surface, which is a DIFFERENT statement from `contains` ("is a member"). Named at the `fa`'s own line; `-export([?MODULE/0])` resolves `?MODULE` to the module name (ER-D28) and an UPPERCASE name is read as the `var` the grammar types it to be (ER-D42) |
| `imports` | `-import(Mod, [f/a])` (ER-D41) | the dependency the module pass reads (`brain_import` rows, `dependencies.ts:27-28`), alongside the `references` mention of the same atom |
| `extends` | **never** | RULED with a measurement — see "The two ruled types, and what rules them" below. ER-D34 recorded it as N/A; the ruling now carries a corpus instrument and a corpus number, which N/A did not |
| `overrides` | **never** | **RULED — grammar-absence** (reconciled 2026-10-23 against the CONTRACT'S DIRECTION, not convenience). `-behaviour` is CONFORMANCE and belongs to `implements` (572 emitted rows); NOTHING IS INHERITED in Erlang, so no member can be redefined; the 33 in-file `-callback`+definition pairs collapse to ONE symbol (a self-loop is not a redefinition); and the 2,548 callback-supply identities are a module PROMISING to provide functions — **the opposite direction from overriding, which is a subclass replacing an inherited member**. The grammar declares no override production. See "`overrides` — RULED GRAMMAR-ABSENCE, reconciled" below |

`confidence` is 1.0 for structural edges and 0.9 for name-resolved ones. **No
edge is a heuristic guess** — the corpus dual lens reports a heuristic class of
0, because every target is read from a node.

- Record literals in pattern position (`#state{}` in function heads) — never
  instantiates.
- Variable uses (`Pid = spawn(...)`, `State` references) — no identifier
  reference edges; references are module deps only.
- `!` send operator — `binary_op_expr` in this grammar (the
  `send_expression` branch is dead); sends are not calls to any symbol.
- Attribute heads (`-export([...])`, `-spec`, `-record`, ...) — the attribute
  declares the symbol; its inner content is never a call.
- Macro uses (`?WITH_STACKTRACE(...)`, `?TIMEOUT`, `?MODULE`) — a `references`
  edge to the macro name (ER-D8), never a call edge; `?MODULE:` in remote-module
  position additionally resolves the call to the current module (ER-D14).
- Type syntax (`-spec`, `-callback`, `-type`, `-opaque`) — DECL-ONLY (ER-D3):
  `state()` there is a type application, never a call site. `-spec` records
  nothing standalone; `-callback` declares a Method symbol.
- Bare atoms and field keys inside type syntax (ER3): an atom literal
  (`monday | tuesday`) and a map/record field key (`id := binary()`) are
  declarations, never type dependencies — only applied names are.
- Record types in `-type`/`-opaque` (`#ctx{server :: pid()}`) — a declaration
  of a record's SHAPE, never an `instantiates` (ER3, the same DECL-ONLY
  boundary as calls).
- Params/locals never become symbols.

## Ontology measurements — the ten-type corpus reading (re-measured 2026-10-04; superseded by the 2026-10-23 campaign)

The ontology workstream (`docs/analyzers/ONTOLOGY-WORKSTREAM.md`) asks for one
verdict per (analyzer × type), each carried by a MEASUREMENT, and for the types
already emitted it asks six questions that source derivation cannot answer.

Everything in this section is measured through the production entry
(`src/ast/pool-worker.parseFile`) over **3,939 admitted `.erl`/`.hrl` files** —
otp `36e371a4ef0f` (3,891) + elixir `73b33255188c` (48) — sorted, one parse per
file, no sampling, no RNG, no clock inside any count
(`script/m60/erlang-ontology-census.ts`,
`validation/m14/tmp/erlang-ontology-census.json`). Corpus totals for that run:
**185,818 symbols, 929,359 relationships, 110 grammar-error files (2.79%), 0
crashes, 0 unknown symbol kinds, 0 empty names, 0 ownerless members.**

**Re-measured a second time in this wave and every count reproduced to the digit**,
at a different worker width and after this wave's source edit
(`validation/m14/tmp/erlang-ontology-census.json`): 185,818 symbols,
929,359 relationships, 110 grammar-error files, 0 crashes, and all ten per-type
counts and file counts identical. The determinism claim is therefore measured over
two runs rather than asserted.

> **The previous version of this section carried numbers that did not describe the
> analyzer it shipped with.** `exports` was recorded as 57,819 rows, which is the
> count the analyzer produced BEFORE ER-D42/ER-D43 landed in the same commit, and
> its `oracle-agreement` row was recorded before the lane oracle gained its
> `?MODULE`-in-an-export-list rule. Re-running the census against `HEAD~1`'s
> analyzer reproduced 57,819 to the digit and reproduced every other count exactly,
> which is how the staleness was caught: **one label differed from HEAD and nothing
> else did, and the label was the one the commit message was claiming to have fixed.**
> The oracle-agreement row is a second, independent instance of the same shape — the
> committed artifact's oracle section is 48 rows away from the oracle in the same
> commit — so this section is regenerated, not edited. The instrument also had a
> determinism claim it did not honour (below), and that is fixed too.

The shared arbiter `script/m14/ontology-coverage-gate.ts` **refuses to report for
erlang**: its `RULED_BY_LANG` table carries `bash` and `json` only, so the gate
exits 2 with "no RULING TABLE for erlang" — correctly, because a gate with an empty
table would call every un-emitted type unjustified, which is a verdict about the
table and not about the lane. That file is master-owned, so this section is the
lane's half of the same measurement over the same corpus. Re-confirmed at this
commit: exit 2, 3,939 admitted files, no RULING TABLE.

> **A second, unrelated defect in that shared gate, found this wave.** It counts
> emissions with `String(x.type ?? x.relationshipType ?? "")` against
> `ALL_TYPES = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates"]`
> — but `RelationshipType.Imports` serializes as **`brain_import`**
> (`src/ast/types.ts:69`, `Imports = "brain_import"`), which is not in that list.
> So the shared gate cannot see an Erlang `imports` edge and would report the type
> as not emitted on a lane that emits 300 of them. The census maps it explicitly and
> says so; the shared gate does not. Reported, not fixed — master-owned.

| type | verdict | count | files | where it comes from |
|---|---|---|---|---|
| `calls` | **EMITTED** | 424,081 | 3,152 | `call` in an evaluation context; local calls resolve against the file's declared NAME/ARITY set (ER-D45), remote calls keep `module:function` |
| `references` | **EMITTED** | 187,010 *(SUPERSEDED corpus)* | 3,164 | `-import` mentions, macro uses, fun values, type dependencies. The include paths this row used to carry are `part_of` since ER-D46 |
| `contains` | **EMITTED** | 182,162 | 3,847 | module → its records/macros/types/functions/callbacks; record → its fields |
| `uses` | **EMITTED** | 58,082 | 965 | record member read (`S#r.f`) and record update (`S#r{f=…}`) |
| `exports` | **EMITTED** | 64,354 | 3,079 | one `exports` edge per `fa` in `-export` / `-export_type` |
| `instantiates` | **EMITTED** | 12,798 | 1,053 | `record_expr` outside pattern position; an UPDATE is `uses`, never `instantiates` |
| `implements` | **EMITTED** | 572 | 550 | `-behaviour(B)` |
| `imports` | **EMITTED** | 300 | 238 | `-import(Mod, [f/a])` (ER-D41) |
| `extends` | **RULED** | 0 | 0 | instrument A + instrument B, below |
| `overrides` | **RULED — grammar-absence** (ER-D50, reconciled against the CONTRACT'S DIRECTION) | 0 | 0 | nothing is INHERITED in Erlang, so no member can redefine one; `-behaviour` is CONFORMANCE and is published as `implements` (572 rows on this population); the 33 in-file `-callback`+definition pairs collapse to ONE symbol (a self-loop); the 2,548 callback-supply identities are the OPPOSITE direction from overriding; the preprocessor's own `'redefine'` marker is declared 88 times and exercised 0 times in one file (probes below). The pinned grammar declares no override production. This row previously read GAP and then `RULED in-file · REPORTED cross-file` — see `### overrides — RULED GRAMMAR-ABSENCE, reconciled against the contract's DIRECTION` |

**The campaign wave added the NINTH emitted type, `part_of` (ER-D46), measured on a
different — larger — population.** The ten-type table above predates the relabel and must
not be read as current for includes: `-include`/`-include_lib` are `part_of` now,
**4,340 rows over 2,464 files on the 4,465-file admitted population** (otp 4,148 +
rebar3 269 + elixir 48; `validation/m14/measurements/erlang-extended-census.json`), which
is exactly the 4,340 include sites (plain 2,133 · lib 2,207) — a 1:1 relabel, so the row
this population carried as `references` fell by exactly that. The campaign also re-measured
every emitted type on that population through the production entry
(`pool-worker.ts:parseFile`), and the closure arm over the same 4,465 files closed at
**1,023,190 edges = resolved 667,137 + amb(decl) 90,324 + unresolved 265,727 + extOK 2 + 0**
(`validation/m14/measurements/erlang-gate-whole-2026-10-23.log`); see
`validation/m14/verification/ERLANG-STATE.md` for the supersession table.

### `overrides` — RULED GRAMMAR-ABSENCE, reconciled against the contract's DIRECTION

**THIS SECTION REPLACES TWO CONTRADICTORY VERDICTS THIS DOCUMENT CARRIED AT ONCE.** An earlier
correction said `overrides` was a **GAP** because the behaviour-callback supply construct "occurs
2,548 times"; a later section argued it was **RULED in-file, REPORTED cross-file**. **A DOC THAT
DISAGREES WITH ITSELF IS WORSE THAN ONE THAT IS WRONG, because a reader cannot tell which half to
cite.** Reconciled 2026-10-23, and the reconciliation is against the CONTRACT rather than against
convenience:

* `overrides` means **a member redefines a member it INHERITS**. Erlang has no inheritance
  (`extends` is grammar-absence, below): there is no parent implementation for an overriding
  declaration to replace.
* `-behaviour(B)` is a **CONFORMANCE** declaration. The fleet emits it as `implements` (572 rows),
  which is the label the vocabulary has for "this module satisfies that contract" — the reason this
  row is not a missing label.
* The **2,548 callback-supply identities** are a module **promising to provide** the functions a
  behaviour declares. That is a supply/conformance relation, **the opposite direction from
  overriding** — a subclass replacing an inherited member. The relation is already published one
  level up as `implements`.
* The **33** `-callback`+definition pairs in one file collapse to ONE symbol (ER-D30) on purpose, so
  the edge would be `f -> f`: a self-loop carries no information.
* The preprocessor's own `redefine` marker and the two-macro-alternative-body class measure **0**
  (`script/m60/erlang-override-construct-probe.ts`), and the pinned grammar declares no override
  production (`validation/m14/measurements/erlang-grammar-nodes.json`: 0 of 137 named ids).

So the verdict is **RULED — grammar-absence**, and the fixture `erlang/ontology-no-inheritance`
pins that NO `overrides` edge of any endpoints is emitted. The earlier GAP label is recorded here as
the reconciliation's subject rather than silently dropped. What is implemented is unchanged: no
`overrides` edge is emitted, and the cross-file material that looked like one is `implements`.

### What the instrument does and does not promise

Eight workers parse concurrently, so **"the first N examples collected" is a race.**
Two runs over the same corpus at the same commit produced different `exampleFiles`,
different `examplesSourceOnly` and a different `placeholders.examples` head, while
every COUNT agreed — and the previous version of this file claimed "two runs agree to
the digit", which was false about the part a reader looks at when a number surprises
them. Both halves are now separated and both are true:

* **every COUNT is deterministic** — sorted file list, one parse per file, every file
  taken exactly once by a shared cursor, no RNG, no sampling unless `--sample`, no
  clock read inside any count. Two consecutive runs now differ in exactly one leaf,
  the `at` timestamp;
* **every EXAMPLE LIST is deterministic too** — collected unordered, then sorted by
  (corpus file, line, text) before printing. `exampleFiles` names the first six
  DISTINCT files in corpus order, where it used to print one file name once per edge
  and therefore repeat a single name six times while saying nothing about which files.

The `at` field is metadata, not a verdict, and is expected to differ.

### The six questions, per emitted type

**(a) FIRES** — a non-zero count from the production entry on real corpus files: the
`count` and `files` columns above. Nothing in that table is derived from the source;
every one of the eight is a measured production run.

**(b) ORACLE AGREES** — a second walker over the **same grammar**. A grammar bug both
walkers inherit is invisible to this comparison by construction, so these numbers
bound *implementation disagreement* and nothing more; a shared-grammar defect would
agree with itself here and disagree with the language. The oracle set is the union of
the shared `differential.deriveErlangEdges` and the lane's own
`oracles/erlang-contains.ts` + `oracles/erlang-exports-imports.ts`, so three
walkers' worth of independence, still one grammar. Both comparison rules are reported:
the harness rule (`label + normTarget(target)`, which `differential.ts` grades on)
and the exact-target rule (what a consumer reading the raw target sees). In this run
the two rules agree on `unexplained` for every type, so one column is shown.

| type | truth targets | analyzer targets | MISSING | unexplained | coverage (harness rule) | coverage (exact target) |
|---|---|---|---|---|---|---|
| `calls` | 130,923 | 130,021 | 902 | 713 | 99.31% | 99.31% |
| `uses` | 11,187 | 11,087 | 100 | 0 | 99.11% | 99.11% |
| `contains` | 158,920 | 158,867 | 53 | 981 | 99.97% | 99.97% |
| `imports` | 287 | 287 | 0 | 0 | **100.00%** | **100.00%** |
| `references` | 35,715 | 35,538 | 177 | 7,458 | 99.50% | 99.50% |
| `exports` | 55,150 | 55,134 | 16 | 0 | 99.97% | 99.97% |
| `implements` | 572 | 572 | 0 | 0 | **100.00%** | **100.00%** |
| `instantiates` | 5,269 | 4,365 | 904 | 0 | 82.84% | 82.84% |

**Every one of these disagreements is now attributed to a named cause, and in five of
the six classes the cause is the ORACLE, not the analyzer.** The previous version named
three; this pass attributes all of them, because an unattributed `unexplained` is the
gate's word for a confident fabrication and leaving 713 of them unexplained is leaving
a defect class open.

1. **`calls`, 902 MISSING / 713 unexplained — both directions attributed.**
   *MISSING* (the oracle derives it, the analyzer does not) over a 400-file stride-9
   sample of the same corpus: **pattern position 2,824 · type syntax 1,290 · macro
   body 126 · attribute head 20 · not declared in this file 13 · UNEXPLAINED 2**, and
   the two are `?MODULE:new` in `epp_SUITE_data/pmod.erl` and `wxe_util:rec` in
   `wx/api_gen/wx_extra/wxListCtrl.erl` — the two grammar-damaged classes of ER-D38,
   where emitting nothing is the documented and correct behaviour. So the MISSING class
   is ER-D3/ER-D7/ER-D11/ER-D23 plus the damaged files, and **0 rows are unexplained.**
   *Unexplained* (the analyzer emits it, the oracle does not): over the same sample,
   **228 of 228** sit in files the oracle cannot name — `ad_expiring_account.erl` has
   no `-module` at all and `file_SUITE.erl` writes `-module(?FILE_SUITE)`, and the
   oracle's local-call gate requires a readable module name (`modName &&`), so it
   derives no local calls there at all. That is ER-D34/ER-D32: the analyzer attributes
   such a file to its path and still resolves its locals, which is right.
   **This class is what ER-D45 was found by**, and it is the reason `unexplained`
   moved 755 → 713 while `MISSING` did not move at all.
2. **`contains`, 981 unexplained / 53 missing.** `contains` is in the shared
   audited-label set (`differential.ts:23238`) and the lane's oracle
   `script/m14/oracles/erlang-contains.ts` EXISTS — and is **imported at
   `differential.ts:55` and never called**. Measured on the shared differential's own
   60-file otp draw at this commit: `COMPARED WITH NO TRUTH: contains (1665
   comparable, 0 truth)` with all 1,665 in `unexplained`. So the lane's LARGEST class
   is audited by an allowlist entry with nothing behind it, which is precisely the
   "audited but never produced" shape `overrides` was in for haskell. The derivation
   itself measures **99.97%** under the harness rule when it is run, so the oracle is
   sound and the WIRING is missing. The 981 that survive when it IS run are two
   oracle-side gaps, each verified by running both oracles on the named file:
   a **`-callback`-only member** (`z.erl`: `-module(z).` + `-callback z() -> term().`
   yields analyzer `contains z -> z` and **both** oracles empty), and a **macro whose
   name is a quoted atom** (`asn1_records.hrl`: the analyzer publishes 142 `contains`
   targets, the lane oracle 140, and the difference is exactly `'COMPLETE_ENCODE'`
   and `'TLV_DECODE'`). A callback and a quoted macro ARE members of the module, so
   the analyzer is right and both oracles are short.
3. **`instantiates`, 904 MISSING.** The shared oracle's pattern-position rule
   (`differential.ts`, `inHead`) recognises a clause HEAD and stops. It does not
   recognise a **case/receive/try arm pattern** or a **match's left side**, so it
   derives `instantiates` for `#wx{event=#wxClose{}} ->` in a `receive`
   (`otp/lib/wx/examples/simple/hello.erl:61`) and for `{ok, #file_info{…}} =
   file:read_file_info(…)` (`otp/lib/stdlib/test/tar_SUITE.erl:317`). The analyzer
   emits nothing for either, which is correct (ER-D7/ER-D4: a pattern is a MATCH).
   A fixer who "repaired" these 904 rows would introduce 904 wrong edges.
4. **`references`, 177 MISSING / 7,458 unexplained.** The unexplained bulk is the ER3
   narrowing itself: the shared oracle derives a type dependency for every atom it
   meets, and the analyzer emits only APPLIED names.
   `validation/m14/results/archive/erlang-er3-corpus-census.json` measured the old rule at
   4,043 OTP / 244 rebar3 rows whose own site line does not apply the name it cites,
   and 0 after the narrowing. The MISSING 177 are macro-body calls and include-path
   targets the filter drops (below).
5. **`exports`, 16 MISSING, 0 unexplained.** All 16 are rows the shared sanitizer in
   `src/ast/pool-worker.ts` deletes on the way out of `parseFile` — quoted atoms and
   OTP's sentence-length test-function names. Measured and attributed in "What
   `parseFile` does not deliver" below. The lane oracle and the analyzer agree on
   every row that survives; the loss is in neither of them.
6. **`uses`, 100 MISSING / 0 unexplained.** The oracle's `inHead` stops at a clause
   head, so it misses a member read or update inside a **match's left side**, which
   is a pattern (ER-D7).

**(c) LABELLED** — the metadata discriminator each class carries, histogrammed over the
whole corpus. A class with two discriminators has two shapes a consumer can tell apart;
a class with `(none)` gives it no way to.

```
calls         local function call=221,783   remote function call=202,298
uses          record member read=33,053     record field update=25,029
contains      (none)=182,162                imports (none)=300
references    macro use=121,946  type reference=56,382  fun value reference=4,500  (none)=4,182
exports       export=62,140                 export_type=2,214
instantiates  (none)=12,798                 implements  OTP behaviour callback implementation=572
```

`contains`, `imports` and `instantiates` carry no discriminator. For `contains`
and `instantiates` that is defensible — one shape each — and `imports` has exactly
one form in Erlang (`-import`), so the `(none)` is honest rather than a gap. The
one class where a discriminator WOULD earn its keep is `exports`, and it has one:
`meta.exportForm` separates `export` from `export_type`, which is what keeps a
consumer from reading a published TYPE as a published function. `calls` splits
local from remote, and after ER-D45 both halves mean the same thing: every local
edge now names a `(name, arity)` the file declares.

**(d) BOTH ENDPOINTS RESOLVE** — every endpoint checked against the symbol set the
SAME file publishes. An endpoint naming a module or a type declared in another file
cannot bind here and is not a defect, so it is named as its own class rather than
counted as a pass or a failure.

```
type          both ends bind   source binds / target is external   target-only   neither
contains      160,894 (88.3%)  35                                   21,231        2
exports        63,953 (99.3%)  384                                   12            5
calls         225,420 (53.2%) 198,632                               13           16
uses           31,387 (54.0%)  26,695                                0            0
instantiates    4,295 (33.6%)  8,501                                0            2
references     69,463 (37.1%) 117,388                               33          126
imports            3 ( 1.0%)      296                                  0            1
implements         3 ( 0.5%)      569                                  0            0
```

`implements` and `imports` sit near 0% **by construction**: the target is another
module's name by definition, and this is a per-file measurement. The number to read
is not "does it resolve" but "is the target a name at all" — `-behaviour(B)` where
`B` is written in the file, never synthesised.

**(e) CONFIDENT** — the full histogram for the whole corpus is two values wide per
class and **nothing erlang emits is below 0.7**:

```
calls 0.9:424,081     uses 1:58,082      contains 1:182,162    imports 1:300
references 0.9:61,247 / 1:125,763        exports 1:64,354      implements 1:572
instantiates 1:12,798
```

So no erlang edge is a heuristic, and none needs a reason code under the confidence
rule. The 0.9 on `calls` and on the name-resolved `references` rows (macro uses, fun
values and applied type references inside a declaration) is the name-resolved tier — the
census-era include rows were 0.9 too and are `part_of` since ER-D46; a remote callee is a
real name in the source, but the module half is not resolved to a symbol here. A declared
tier, not a guess.

**(f) R7 — no placeholder endpoints.** 0 unknown symbol kinds, 0 empty names, 0
invented sentinel names, 0 ownerless members across 185,818 symbols. On the
RELATIONSHIP side there is one large class and it is reported rather than hidden:
**21,344 endpoints whose source is an absolute checkout path** (`contains` 21,223,
`references` 103, `exports` 17, `imports` 1), and **21,221 symbols** carrying one as
their `ownerName` — the same defect seen from each end, which is ER-D32's
file-path owner meeting `parseFile`'s absolute path. Three smaller classes were
measured and reviewed, and the sentinel figure is restated because the previous
version of this section reported **40** under a three-name list that also counted
`undefined`; the census's own six-name list (`unknown`, `anonymous`,
`<anonymous>`, `??`, `TODO`, `UNKNOWN`) measures **69** endpoints — `target:sentinel`
50, `source:sentinel` 19 — plus **7** `source:windows-path`. The two figures are not
comparable and neither is wrong; the list is named so a reader can tell:

* **69 endpoints named `unknown`/`anonymous`/`TODO`. Reviewed and legitimate**:
  those are ordinary Erlang atoms and function names. `otp/lib/diameter/src/base/diameter_traffic.erl:1225`
  defines `unknown/1` as a two-clause predicate and `otp/lib/ssl/test/ssl_cipher_suite_SUITE.erl:283`
  defines `anonymous/0`; `otp/lib/kernel/src/socket.erl:1876` writes
  `-type sctp_operation_error() :: unknown`, where the name is the atom literal. The
  R7 sentinel list is written for languages where a symbol called `unknown` can only
  be a fallback, and the probe that found these is what flagged the list as wrong for
  this language. Reported rather than suppressed.
* **7 endpoints containing a backslash.** Quoted Erlang atoms, not paths —
  `'COMPLETE_ENCODE'`, `'#=@: difficult_case_name_äöå'` — so the probe's `windows-path`
  class is a false positive on a quoted atom. On the symbol side the same probe reports
  `name:windows-path` 14 and `ownerName:windows-path` 2, and the SAME names are the rows
  the shared sanitizer deletes; see below.
* `ownerName` empty on 3,666 symbols: those are `module` symbols, which correctly have
  no owner.

### What `parseFile` does not deliver, and the two places that is decided

`parseFile` is not a pass-through. It runs every relationship through
`filterNoiseRelationships` in `src/ast/pool-worker.ts`, and **that filter is not
Erlang-aware for quoted atoms**: an Erlang quoted atom is a real function name and
may contain anything the language allows. `script/m60/erlang-parsefile-drop.ts` runs
both paths per file over the whole corpus and keys both sides by `pushRel`'s own
identity, so a same-line multi-arity pair is two rows on each side and the comparison
is fair. See `validation/m14/tmp/erlang-parsefile-drop.json` for the per-rule
attribution; the short form is in the wave report.

The second place is the STORE. ER-D43 widened the analyzer's edge key so that
`-export([start/0, start/1])` on one line publishes two rows, and the census counts
that as **+6,535 rows**. The store's own identity does not carry the arity —
`src/ast/parallel-indexer.ts` builds
`relId = ${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine}` and inserts
with `INSERT OR IGNORE` — and both rows have the same target NAME and the same line.
`script/m60/erlang-exports-store-multiplicity.ts` measures this through the real
indexer on three shapes that separate the hypotheses: **A** same name, same line, two
arities; **B** same name, two lines, two arities; **C** two names, one line. Result:
A collapses, B and C do not. **So the recovered multiplicity is a `parseFile` fact and
not a graph fact**, and the fix belongs to the store's key, which is master-owned.
The analyzer is NOT reverted over it: the parse-level rows are strictly more faithful
than the rows they replaced, and every consumer that reads `parseFile` sees them.

### The two ruled types, and what rules them

`script/m60/erlang-construct-probe.ts`, over the same 3,939 files, one parse each
(`validation/m14/tmp/erlang-construct-probe.json`). It applies the two instruments
the shared gate's header names, and the choice of instrument is decided by the
question, not by convenience. Every number in this subsection was re-measured at this
commit and each reproduced the recorded value.

**`extends` — RULED.** The pinned wasm's OWN tables, which is instrument A (a grammar
inventory, not a corpus walk — a walk can only see what the corpus exercises):

| what | measurement |
|---|---|
| named node types the wasm's table DEFINES | 137 (132 distinct) of 338 total, plus 152 anonymous |
| **abstract supertype / subtype edges the grammar declares** | **NONE** — this is the grammar's own account of "this production IS-A that one", and it is empty |
| field names the grammar declares | 52 |
| of 23 inheritance-shaped node types probed (`class_declaration`, `interface_declaration`, `trait_declaration`, `inheritance_specifier`, `extends_clause`, `superclass`, `mixin`, `subclass`, …) | **0** are in the table, **0** are produced by the corpus |
| of the 52 field names, any matching `/^(super\|base\|parent\|extend\|inherit\|implements\|subtype\|ancestor)/i` | **0** |
| distinct node types observed on the corpus | 127 |

Instrument B, for a language that might spell the construct as an ATTRIBUTE instead of
a node type: **0 occurrences** of `-extends` / `-inherits` / `-subclass` /
`-parent_module` / `-base_module` / `-include_class` / `-of_type` in 3,939 files.

And the nearest thing Erlang HAS, counted rather than asserted: **2,992 type
declarations in 279 files apply another type the same file declares.** That is a type
DEPENDENCY and it is published as `references` (ER-D10, narrowed by ER3 to applied
names only). Publishing it as `extends` would put a fabricated edge on every map field
key and every atom literal — the pre-ER3 rule produced 4,043 such rows on OTP whose own
site line does not apply the name it cites.

**`overrides` — RULED GRAMMAR-ABSENCE, NOT EMITTED.** This is the type the ontology gate
exists for, so the ruling is stated as a set of measurements with the construct that would
overturn each one; the reconciliation against the contract's DIRECTION (ER-D50) is above:

| candidate construct | measurement | why it is not an `overrides` edge |
|---|---|---|
| an attribute publishing a definition as REPLACEABLE (Elixir's `defoverridable`) | **0** occurrences in 3,939 files | nothing marks a definition replaceable, so no row can say which definition replaces which |
| a node type whose name carries `overrid`/`replace` | 0 of the 132 named types, except OTP's binary `ssr_definition` / `ssr_replacement` compile directives and their 6 `replacement_*` guard forms, which select a binary-comprehension backend | a compile-time codegen switch, not a member |
| one `(name, arity)` declared in more than one preprocessor region | **87** sites in 46 files: **79 mutually exclusive `-ifdef`/`-else` branches, 8 same-macro `-ifdef` guards with no `-else`, 0 unconditional redefinitions** | Erlang's own compiler rejects two unconditional declarations of one identity, so the only legal cause is conditional compilation — and exactly ONE body survives preprocessing. Nothing replaces anything. The multiplicity is already published as `meta.clauseCount`, so the fact is not lost |
| a `-callback` declared AND the same identity defined in ONE file | **33** sites in 20 files | ER-D30 merges the pair into ONE symbol on purpose, so the edge would be `f → f`: a self-loop carrying no information |
| **a `-behaviour(B)` module supplying a callback B declares** | **378** `-callback` declarations in 83 files from **79** modules; **572** `-behaviour` sites in 550 files across 50 distinct behaviours; **43** behaviours whose callbacks are in this corpus; **560 of 572** implementation files match at least one of B's callback identities; **2,548** identities supplied by exact name AND arity (276 published in those behaviours) | **THE CONSTRUCT IS REAL AND LARGE. It is deliberately not published, and the reason is a fact about this repository rather than about Erlang.** The only production channel for cross-file member resolution is `AnalyzeContext.projectIndex`, and `src/ast/parallel-indexer.ts:1300` registers exactly one extension for it: `PROJECT_INDEX_EXTENSIONS = { ".sol": "solidity" }`. No `.erl` entry, so an arity-carrying index is never built. The two channels that DO exist carry a `Set<string>` of bare NAMES — `src/ast/override-context.ts:85` adds `s.name`, `src/ast/project-index.ts:313` adds `childForFieldName("name")` — and the batch indexer only runs the companion pass for `["perl", "python"]` (`parallel-indexer.ts`, the `for (const companionLang of …)` loop), so an Erlang companion is never built even in memory. Erlang's callback identity is name AND arity, because that is what OTP checks: `Module:behaviour_info(callbacks)` is compared against the module's exported `f/A` pairs. A name-only match would publish `code_change/2` as implementing `code_change/3`, at a confidence a reader cannot discount — and this repository has already measured that failure mode on another lane: 75.6% of perl's `overrides` edges are withdrawn once a companion exists (`src/ast/override-companion-pass.ts`) |

The last row is the one that LOOKS like a missing member-level relation, and it is not one: a
module supplying a behaviour's callbacks is a **CONFORMANCE** act (`implements`, emitted 572 times),
and the vocabulary's `overrides` requires a member that INHERITS its target. Every other lane that
publishes a member-level supply edge does it in-file across a real class hierarchy (Clojure's
`extend-type`, Haskell's `instance`); Erlang has no hierarchy, and its in-file 33 callback+definition
pairs collapse to one symbol (a self-loop). So the class is **RULED grammar-absence**, the fixture
`erlang/ontology-no-inheritance` pins that no `overrides` edge exists, and the reconciliation with the
document's earlier GAP wording is recorded in the section above.

### A fourth and fifth candidate the previous ruling never probed: the preprocessor's OWN override marker

The eight probes above are all probes of FUNCTIONS. Erlang has a **second declaration
namespace** — the preprocessor's — and the preprocessor has its own explicit
replaceability marker, which is the same role Elixir's `defoverridable` plays. If that
marker is exercised in the corpus, the in-file tier is not 33 self-loops and the ruling
above is wrong. It is not exercised, and the measurement is a new instrument:
`script/m60/erlang-override-construct-probe.ts`
(`validation/m14/tmp/erlang-override-construct-probe.json`), same 3,939 files, one parse
each, tree-level, no code shared with the analyzer.

**The marker's authority is OTP's own preprocessor, which is in the corpus.**
`otp/lib/stdlib/src/epp.erl`:

```erlang
-type macros() :: [atom() | {atom(), term()} | {atom(), term(), 'redefine'}].

scan_define_2(Arity, Def, {_,_,Key}=Mac, From, #epp{macs=Ms}=St) ->
    case Ms of
        #{Key:=Defs} when is_list(Defs) ->
            case proplists:is_defined(Arity, Defs) of
                true -> epp_reply(From, {error,{loc(Mac),epp,{redefine,Key}}}),
                ...
```

Two facts fall out of that, and the second one is the load-bearing one:

1. a second `-define` of an already-defined name is a **compile error**, unless the
   earlier definition carried the third argument — the `'redefine'` tag;
2. the dictionary is keyed **per arity**: `scan_define_2` takes an `Arity` argument and
   tests `proplists:is_defined(Arity, Defs)`. So a macro's identity is `(name, arity)`,
   exactly as a function's is.

| probe | count | files | what it decides |
|---|---|---|---|
| **M1** the `'redefine'` opt-in — `-define(NAME/A, V, true)`, the grammar's `replacement_guard_and` under a `pp_define` | **88** | **44** | the construct is **declared** 88 times, so "Erlang has no override marker" would be false |
| **M2** a replacement whose FIRST definition carried M1, same preprocessor branch | **0** | **0** | the marker is never **exercised** in one file |
| **M2** the same, two branches of ONE `-ifdef`/`-else` | 53 | 8 | not a redefinition: one body survives preprocessing |
| **M2** the same, two INDEPENDENT conditionals | 516 | 114 | **undecidable** without the `-D` flags the analyzer is not given; counted, not classified |
| **M2** a same-branch duplicate with NO marker | **0** | **0** | `epp` rejects these; none exists |
| **M3** `-undef(NAME)` — `pp_undef` | 26 | 12 | the preprocessor's **removal** operator; it is not a replacement, and no label here fits it |
| **M4** an includer re-defining a macro its project-local `-include`d header defines | **0** | **0**, of **1,610** resolvable include pairs (302 ambiguous, 100 absent) | the one cross-file tier that needs **no** project index, because an `.erl` and its header share one preprocessing context |
| **M5** `-compile({parse_transform, M})` | 5 | 4 | a parse transform names a **module**, not the declarations it rewrites — there is no endpoint to attach |

So the preprocessor tier is RULED: 88 declarations of replaceability and **zero**
replacements, in one file or across an include. `-undef` is a removal and `parse_transform`
has no member to name.

**Three measurement bugs this probe made and corrected, recorded because each one produced
a confident number that was wrong:**

- **Keying macros by NAME.** The first version reported **221** same-branch
  redefinitions in 83 files and **1** cross-file replacement in
  `otp/lib/diameter/test/diameter_watchdog_SUITE.erl:102` — where
  `-define(INFO(T), …)` at arity 1 replaces a header's `-define(INFO(), …)` at arity 0.
  Those are two macros, and 221 and 1 were the size of an `overrides` edge class. Keyed by
  `(name, arity)`, as `epp` keys it, both fall to **0**.
- **A region model that could not tell two conditionals apart.** `-ifdef`/`-else`/`-endif`
  are flat sibling markers here, so a region key of branch-index alone gives two SIBLING
  `-ifdef` blocks the same key. That reported `otp/lib/kernel/test/code_SUITE_data/other.erl`'s
  `-ifdef(VERSION_1)` and `-ifdef(VERSION_2)` blocks, each defining `VERSION/0`, as an
  unconditional redefinition — a compile error — when it is a pair of version-guarded
  bodies. Each conditional now carries a unique id.
- **A byte offset compared against a line number.** The region stamp was keyed on
  `d.startIndex` (a character offset) against a marker's `startIndex` via an accidental
  comparison with `d.line`, so every form fell through to the final stamp, every region
  came out equal, and the mutually-exclusive split measured **0** while confidently
  reporting a redefinition. Two different units on either side of a comparison: the
  number means nothing and looks like a number.

The marker was also verified to be unambiguous in context, since `replacement_guard_and` is
OTP's binary-replacement operator too: under a `pp_define` the three-argument form is the
only producer (`-define(A, (1 andalso 2)).` gives `paren_expr`, `-define(A, r(<<1:8>>) andalso <<2>>).`
gives `binary_op_expr`), so 88 is the marker and not the binary syntax.

### Why no cross-file member channel exists (measured; ER-D50 rules it unnecessary for `overrides`)

This section is the GAP reading's remedy list, kept because every limitation it measures is
REAL and verified by reading the code — the project index is registered for `.sol` only, the
two channels that exist carry bare NAMES, and the companion pass runs for perl/python. What
changed on 2026-10-23 is the RULING, not the measurement: ER-D50 rules the cross-file
callback-supply tier CONFORMANCE (`implements`), so these edits would not manufacture an
`overrides` edge and are reported to the owner rather than required by this lane. The table
below is the measured channel state:

Three files, all outside this lane:

| file | what it says today | verified at |
|---|---|---|
| `script/m14/differential.ts:55` | imports `deriveErlangContainsTruth`, and **never calls it** — `grep -n deriveErlangContainsTruth script/m14/differential.ts` returns exactly one line, the import | measured, below |
| `script/m14/differential.ts:23238` | `...(lang === "erlang" ? ["contains"] : [])` — the label is in the audited set with nothing behind it | measured, below |
| `src/ast/parallel-indexer.ts:1300` | `PROJECT_INDEX_EXTENSIONS = { ".sol": "solidity" }` — the only arity-carrying cross-file channel, and `.erl` is not registered | read |
| `src/ast/parallel-indexer.ts` | `for (const companionLang of ["perl", "python"])` — the companion pass is never built for Erlang even in memory | read |
| `src/ast/override-context.ts:85` / `src/ast/project-index.ts:313` | both build a `Set<string>` of bare **names** (`s.name`, `childForFieldName("name")`) — neither can express `(name, arity)`, and Erlang's callback identity is `(name, arity)` because that is what OTP checks: `Module:behaviour_info(callbacks)` is compared against the module's exported `f/A` pairs | read |

A name-only match would publish `code_change/2` as implementing `code_change/3` at a
confidence a reader cannot discount, and this repository has already measured that failure
mode on another lane: **75.6% of perl's `overrides` edges are withdrawn** once a companion
exists (`src/ast/override-companion-pass.ts`). So the plumbing gap is a real constraint on
the label's correctness, not an excuse — but it is a constraint about **this repository**,
and a GAP is the verdict it produces, not a RULED one.

## Evidence tiers (M14 section D)

Every relationship this analyzer emits states its `metadata.evidenceClass`. The model is the BEAM
sibling's (`real-elixir-analyzer.ts`) with one adaptation — Erlang writes the module qualifier with a
colon where Elixir writes a dot:

| tier | rows | why |
|---|---|---|
| `structural` | `contains`, `exports`, `implements`, `instantiates` | the claim IS the syntax (a declaration's member list, an `-export` entry, a `-behaviour` name) |
| `import_based` | `imports` (`-import`) and `part_of` (`-include`, `-include_lib` — ER-D46) | a directive dependency; this is the fall-through-bug class every lane has paid for (an import reported as usage). The tier follows the CONSTRUCT: an include is a file-inclusion directive, so it is import_based, not reference_qualified |
| `reference_qualified` | every `references` row, and a `calls` edge whose target keeps its module qualifier (`mod:fn`, ER-D1) | the callee/type was NAMED with its module — a reference resolved by spelling |
| `usage_contextual` | a bare `calls` target (`f(...)`), and `uses` | resolved against this module's declared set, i.e. context-dependent |

**MEASURED 2026-10-17: before this wave the analyzer stamped NOTHING** — every row carried no
`evidenceClass` at all (probe over every fixture source), so section D could not be satisfied and the
tier was left to the consumer's fall-through. The stamping is a terminal pass and additive: a site that
sets its own class keeps it. Pinned by fixtures: `attrs-er3` (all four tiers across one file — import,
include `part_of`, remote call, local call, contains) and `arity-distinct-calls` (remote calls
`reference_qualified` vs local calls `usage_contextual`, at the same arity-distinct call sites it
already pins).

## DERIVATION: the two labels that were emitted and compared against nothing

`script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reports, at HEAD and
after this wave:

```
erlang  2 un-audited: ["exports","imports"]
```

Both labels are EMITTED (**64,354** and 300 rows over the census corpus). Both have no
oracle derivation in the shared harness. That is the gate's own phrase for the state
where a defect in the class is invisible, and 64,354 rows is not a small class to leave
unaudited. CHECK 2 (reachability), CHECK 3 (unfiltered-default agreement) and CHECK 4
(every enum value constructed by some analyzer) are clean for erlang.

**Running that gate with `--langs=erlang` overwrites the shared evidence file.**
`validation/m60/results/rel-type-coverage.json` held 20 lanes; a scoped run replaced it
with erlang alone and deleted 1,419 lines, and the gate exited 0 having said
`evidence: validation/m60/results/rel-type-coverage.json`. Reported, not fixed — the
file is master-owned, and I restored it from `HEAD` after the run. A gate that
silently narrows shared evidence when handed one lane cannot be used to audit one lane
without that side effect.

It is worse than an unaudited class for one of the two, because **the lane's own spec
says otherwise**. `script/m14/spec/erlang-completeness.json` ER-D40 states of `exports`:

> "the oracle derives the same set from the same declaration, so the two sides agree
> without either one having to guess."

No such derivation existed. `deriveErlangEdges` in `differential.ts` reads
`import_attribute` and pushes `references`; there is no `export_attribute` case
anywhere in it. The comment described a resolution the code did not perform — and the
comment is what a reader would have checked instead of the code.

**What the lane owns**, in lane-owned files:

* `script/m14/oracles/erlang-exports-imports.ts` — the derivation. One `exports` row
  per `fa` in `-export` / `-export_type`, one `imports` row per `-import` naming the
  MODULE. It reads the `fa`'s three name spellings (`atom`, `var` for an UPPERCASE
  name, `macro_call_expr` for `?MODULE`), resolves `?MODULE` to the module, and refuses
  any other macro there rather than naming a member after a preprocessor constant. Two
  forms are deliberately NOT rows and say why in the header: `-include` (a textual inclusion,
  published by the analyzer as `part_of` since ER-D46 — the INCLUDE ORACLE derives `part_of` too, and
  this oracle deliberately derives only `exports`/`imports`) and `-compile({parse_transform, …})`
  (nothing comes into scope by name).
* `script/m14/verify-erlang-ontology-oracle.ts` — what makes it an instrument rather
  than an assertion. Three checks over the lane's fixture suite (27 at that measurement; 30 today) plus a stride-sampled 253
  corpus files: **agreement**, **reachability** (the oracle emits rows, so agreement is
  not vacuous — the state `overrides` was in for haskell), and **ability to fail**
  (three deliberately broken copies of the derivation, each of which must turn the same
  check red). At this commit: `exports` truth 3,830 / analyzer 3,828, MISSING 2,
  unexplained 0, identity-mismatch 0; `imports` truth 24 / analyzer 24, MISSING 0,
  unexplained 0, identity-mismatch 0; **3 of 3 broken copies detected**; CHECKS 2 and 3
  PASS. **CHECK 1 FAILS on those 2 rows**, and it is right to: they are the
  `pool-worker` sanitizer deleting `'\x{aaa}memory'` and `'func-\x{400}'`, so this lane
  gate is reporting a defect outside the lane rather than hiding it.

**The wiring HAS since landed (2026-10-23), so the quoted CHECK 1 above is the BEFORE
state.** Both edits are in `script/m14/differential.ts` at HEAD: `deriveErlangExportsTruth`
is imported at line 171 and its rows are pushed in the erlang block at line 25430, and the
erlang audited-label allowlist carries `["exports","imports"]` at line 25828. The same change
that landed the include relabel's mirror (`deriveErlangEdges`'s include branch → `part_of`,
the erlang `["part_of"]` allowance, and path-like exact matching for `part_of` so a header
path is not leaf-collapsed to `hrl`). Re-running CHECK 1 is NOT done here: that gate is
master-owned and a scoped run rewrites its shared evidence file (the warning below), so this
page records the source state and does not claim the gate's current output.

### And the third: `contains`, audited by an allowlist entry with nothing behind it

Not a DERIVATION finding — `rel-type-coverage-gate.ts` reports erlang `contains` as
audited, because `differential.ts:23238` adds it. But `differential.ts:55` imports
`deriveErlangContainsTruth` from `script/m14/oracles/erlang-contains.ts` and **never
calls it** (`grep -n deriveErlangContainsTruth script/m14/differential.ts` returns one
line, the import — re-checked this wave, still one line). Measured on the shared
differential's own 60-file otp draw at this commit:

```
[otp] erlang: COMPARED WITH NO TRUTH: contains (1652 comparable, 0 truth)
[otp] erlang: files=60 tree-truth=5142 covered=5111 (99.4%) MISSING=31 | analyzer-edges=3909 unexplained=1727 (44.2%) heuristic=0 hash=bab70bc0f59198e3 | unexplained-by-label: contains=1652,references=75
  1 lane(s) COMPARED A LABEL WITH NO TRUTH — the published coverage for those labels is not coverage
```

The committed version of this row said 1,665 comparable and 42.7%, taken when the
corpus draw also covered `rebar3`. **`rebar3` and `cowboy` are no longer on this
machine** (`$HOME/fixtures/repositories/` holds neither), and
`differential.ts`'s `LANG_REPOS.erlang` is still `rebar3`, so the erlang differential
now only runs with an explicit `--repo`. The census corpus (otp + elixir) is
unaffected and reproduced exactly twice, so the difference is the draw, not the
analyzer.

So the lane's largest class is compared against an empty truth set, and 44.2% of the
lane's edges on that draw are reported `unexplained` — which the harness is right to
call a confident fabrication and wrong to attribute to the analyzer, because the
oracle exists, is sound (99.97% under the harness rule when it is run, measured in
the table above), and is simply not wired. That is a master-owned one-line fix and it
is the single highest-value erlang item in this report.

With `corpusPath` supplied locally **for the measurement only, and the master-owned
file restored byte-for-byte afterwards** (`git diff` empty), the lane's own surface
audit runs and reports, on 60 files / 17,285 edges:

```
=== erlang — rebar3 + otp — 60 file(s), 17285 edge(s), 2873 symbol(s), 59 file(s) with edges (98.3%)
  lines         no line: 0 (none) | line 0: 0
  seam keys     edges missing a key: 0 (none)
  names         not a name / not in source: 0
  ghost targets 0
  parse errors  0
```

The gate is broken for **every** lane, though, and that is a finding rather than a
workaround — see the wave report.


### What the rulings and the fixes are pinned by

`validation/m14/fixtures/erlang/ontology-no-inheritance.erl` carries every construct
the probe measured as a candidate — a `-callback` satisfied in the same file, a
`-behaviour` module supplying a callback, two mutually exclusive `-ifdef` bodies, a
type applying another type — and **forbids the `overrides` and `extends` labels
outright**, with type-only forbid rows so the assertion does not depend on guessing
which endpoints a wrong implementation would pick.

`validation/m14/fixtures/erlang/arity-local-resolution.erl` carries ER-D45: an arity
that matches (`get(key, D)` against a declared `get/2`), an auto-import at another
arity (`get(D)` — `erlang:get/1`, the process dictionary), and a BIF whose name is
absent (`setelement/3`). The middle row is the one that failed 618 times.

`validation/m14/fixtures/erlang/arity-distinct-calls.erl` carries ER-D44: three
`endColumn` pins read off the pinned grammar's `fun_decl` extents, so the range cannot
silently regress to the `function_clause` that is one character shorter.

`script/m14/erlang-ontology-mutants.ts` holds **11** mutants — TEN prefixed
`ontology/` for the emitted and ruled relationship values and what would manufacture an
edge the language cannot express, and ONE prefixed `symbols/` for the lane's symbol-surface
defect — each a faithful reproduction of a reading a reasonable reader would reach for, and
all **11** are caught (the registry in the script is the count: 10 `ontology/` names and 1
`symbols/` name). A twelfth was REMOVED because it did not reproduce its own defect; the
removal and the new harness that replaced it are below.

`script/m14/erlang-source-revert.ts` holds **3** source reverts for the mutation class a
result transform cannot express, and all **3** are caught by a NAMED fixture.

| mutant | reproduces | caught by |
|---|---|---|
| `ontology/overrides-callback-satisfied-in-one-file` | a `-callback` its own file defines is an override | `ontology-no-inheritance` |
| `ontology/overrides-behaviour-callback-supply` | `-behaviour` + a matching name is a member-level override | `ontology-no-inheritance` |
| `ontology/overrides-preprocessor-alternative-body` | two `-ifdef` bodies is a redefinition | `ontology-no-inheritance` |
| `ontology/extends-from-type-dependency` | a type applying another type is a subtype relation | 7 fixtures |
| `ontology/extends-from-include` | `-include` is inheritance | `attrs-er3`, `callsite-lines-825`, `extended-part-of` |
| `ontology/extends-relabel-implements` | `-behaviour` is `extends`, not `implements` | 5 fixtures |
| `ontology/exports-drop-type-form` | `-export_type` can be published under the plain form | 2 fixtures |
| `ontology/exports-uppercase-name-dropped` | ER-D42 regression | `macros-er3` |
| `ontology/exports-same-line-multi-arity-collapsed` | ER-D43 regression | `arity-exports` |
| `ontology/imports-dropped` | ER-D41 regression | `export-import-macro-er3` |
| `symbols/function-range-ends-on-clause` | ER-D44 regression — the range ends on the `function_clause`, which is one character short | `arity-distinct-calls` |

`--self-test` inverts one mutant's expectation and requires the runner to report it as a
SURVIVOR and exit non-zero, so a green run of that script is evidence the loop works and
not evidence the mutants die. **Re-measured 2026-10-04: 11/11 CAUGHT** (down from 12 — the
twelfth was removed, below), and `--self-test` exits 1 with
`1 SURVIVOR(S): ontology/overrides-callback-satisfied-in-one-file`.

### One of the twelve was not reproducing its defect, and the harness could not tell

`symbols/local-call-gated-on-bare-name` (ER-D45) was registered as a **result transform**,
which mutates the analyzer's output. That is the right instrument for a rule that filters
or relabels rows and **the wrong instrument for a defect whose symptom is a row that was
never produced** — which ER-D45 is, because the bare-name gate emitted *more* `calls`
edges than the arity-exact gate does (`get(D)` beside a local `get/2`). A faithful
reproduction has to *add* an edge the post-fix analyzer correctly withholds, and no result
transform can see a site that produced nothing.

What it did instead was filter **out** local call edges whose `metadata.callArity` matched
no declared arity — a no-op for every correctly-emitted edge, except where a file declares
one name at several arities: `fold(fun(X, Y) -> X + Y end, 0)` in
`erlang/arity-distinct-calls` is arity 2, the file declares `fold/2` **and** `fold/3`, so
the filter read the arity-3 declaration as a mismatch and deleted a valid edge. The runner
then printed

```
CAUGHT  symbols/local-call-gated-on-bare-name   caught by: erlang/arity-distinct-calls
```

which is **indistinguishable in the output from a faithful kill**. It was caught by a
different bug and pinned a different behaviour, while the fixture that does pin ER-D45 —
`erlang/arity-local-resolution`, added by the same wave — was never touched by it.
Measured directly, by reverting the gate in the analyzer source:

```
bare-name gate:  erlang/arity-local-resolution FAIL, erlang/arity-distinct-calls PASS
```

That is the honesty contract's §7 red-team case (a check that passes for a reason
nobody stated), and it survived because "CAUGHT" looks the same either way. It is removed
from the result-transform registry, with the removal recorded in the file's own header.

### `script/m14/erlang-source-revert.ts` — the class a result transform cannot express

A **source** revert: rewrite the analyzer's own gate, run the fixture battery in a **child
process** (ESM caches the module by URL, so an in-process re-import would keep the old
analyzer and the check would measure nothing while reporting a pass), restore the bytes,
and require a **named** fixture to fail. Three properties make it a measurement:

1. the needle must be **present** — `find` absent is a MISS, not a skip, because a revert
   that silently matches nothing asserts nothing;
2. the **named** fixture must fail — `expectFailure` names the fixture whose assertion is
   supposed to catch this, so "the run went red somewhere" cannot pass for it;
3. the restore is **re-read and compared**, a backup sibling path is printed before the
   swap, and `process.on("exit")` restores too.

**Re-measured 2026-10-04: 3/3 CAUGHT, 0 missed**; `--self-test` exits **1** with
`1 MISS(ES): symbols/local-call-gated-on-bare-name`.

| revert | what it turns back | fixtures that went red | named fixture |
|---|---|---|---|
| `symbols/local-call-gated-on-bare-name` | `declaredFnKeys.has(fnKey(name, arity))` → "does this file declare the name at **any** arity" | `erlang/arity-local-resolution` | FAIL as required |
| `symbols/function-range-initial-from-clause` | `nodeToRange(declNode)` → `nodeToRange(clause ?? declNode)` | `erlang/arity-distinct-calls`, `erlang/clause-merge-range` | FAIL as required |
| `symbols/function-range-merge-from-clause` | `extendRange(symbol, node)` → `extendRange(symbol, clause ?? node)` | `erlang/clause-merge-range` | FAIL as required |

**And writing it found a fix with no fixture.** ER-D44 has two halves — the symbol's
**construction** range and the **merge** range — and only the first was pinned. On this
grammar every `;`-separated clause opens its own `fun_decl` and the `;` is a child of the
EARLIER one (`pick(0) -> zero;` is `fun_decl` [32,48) and `pick(X) -> X.` is `fun_decl`
[49,62), against `function_clause` [32,47) and [49,61)), so every multi-clause function IS
the merge path. `erlang/arity-distinct-calls` declares only **single**-clause functions, so
reverting the merge left every fixture passing — the revert was written, it MISSED, and
that is how the gap surfaced.

`erlang/clause-merge-range` closes it: two clauses, two clauses whose last clause ends a
line it does not start, and **three** clauses of one `(name, arity)`, with every end read
off the pinned grammar's `fun_decl` extents rather than off analyzer output —
`pick/1` [1038,1078) endColumn 10, `head/1` [1218,1267) endColumn 15, `wide/2`
[1360,1431) endColumn 12, and `expectSymbolCount` = 1 each so a reader asking for `wide`
finds one function rather than three. **30/30** lane fixtures pass with it (28 at that wave;
the campaign wave added `extended-part-of` and the ER-D46 relabel).

## What produces NO edge (the noise contract)

- **Pattern position.** A clause head makes everything below it a pattern; a
  `when` guard **computes**; a match or generator's pattern side is a pattern
  and its value side takes that boundary's own context (ER-D24). So
  `D#r.f == []` in a guard is a read, `[C || #cert{der=C} <- Certs]` binds,
  `Y = #r{} ->` in a case arm is a pattern, and `X = #r{}` in a body constructs.
- **A macro BODY's call** (ER-D11). A macro body is template text; its
  expansion sites are unknown because the grammar does not expand, so an edge
  from the template would name a line that is not a call site. Macro USES inside
  a body ARE emitted — a macro-to-macro dependency is static (measured 123 per
  300 corpus files); the suppressed calls number 119.
- **A bare atom in type syntax** (ER-D36). A type dependency is an APPLIED name:
  you must write `foo()` to apply a type, so a bare unquoted atom in type syntax is
  the ATOM LITERAL of that name. `-type day() :: monday | tuesday.` depends on
  nothing, and the `id` in `-type job() :: #{id := job_id()}.` is a field
  declaration, not a call. Emitting those edges resolves to a same-named type or
  record property elsewhere in the file and reads as a real dependency — it is the
  M12 false positive that started the ER3 wave, measured at 19 of them.
- **A dynamic remote** — `M:f(X)`, `erlang:F(X)`, `apply/3` (ER-D23). The bare
  leaf would conflate every module's `f`; nothing is emitted and the count is
  kept in the review's accounting.
- **A remote call whose MODULE is a macro** — `?FILE_MODULE:read_file_info(Priv)`,
  `?OTHER:start_link(M, S, A)` (ER-D35). Only `?MODULE` names this file's module
  (ER-D25, the self-dispatch idiom); every other macro there is a preprocessor
  constant the analyzer does not expand, so no callee is derivable. Substituting
  this file's module — which is what the code used to do for *every* macro in
  that position — reports `?FILE_MODULE:acceptor(A,B,C,D)` inside
  `httpd_acceptor.erl` as `httpd_acceptor:acceptor`, a self-call that is nowhere
  in the source: 922 fabricated edges over the corpus. The macro USE is still
  emitted at these sites; only the callee is underivable. Measured class size:
  3,322 sites. Also true of a fun value: `fun ?OTHER:f/1 end` emits the macro
  reference and nothing else.
- **BIFs.** A local call resolves only when the callee is declared in the file,
  which keeps `length/1`, `self/0`, `is_record/2` and every auto-import out of
  the call graph. `spawn/1`, `spawn_link/1`, `spawn_monitor/1` set the OTP
  process-spawning patterns instead.
- **The `!` send.** It is a `binary_op_expr` in this grammar; there is no
  `send_expression` node type, and a send calls no symbol.
- **Directives**: `-compile`, `-file`, `-feature`, `-deprecated`, `-undef`.
  `-deprecated([{now, 0, "…"}])` looks like a function list and is not — it
  holds a kind, a version and prose, never an `f/a` pair.
- **Maps** (ER-D5). `#{…}` is structural with no declared name, so construction,
  reads and updates emit nothing.
- **A type-syntax `call`.** Inside a `-type`/`-opaque`/`-spec`/`-callback` body,
  `term()` is a TYPE name, not a function call — those become `references`
  (ER-D16). `ann_type` is a type context in both positions: in a guard,
  `X :: integer()` is a type test while `is_integer(X)` beside it is a call.
- **Params and locals are never symbols.**

Cyclomatic complexity counts decision points per ARM, per SYMBOL (ER-D13),
from the pinned grammar's actual emitted node types:

- `cr_clause` — one per case/receive/try-of arm (the grammar uses one node
  type for all three), `if_clause` one per if arm, `catch_clause` one per
  catch arm, `receive_after` one ("Receive with Timeout" pattern).
- `andalso`/`orelse` (`binary_op_expr`) — one each.
- One per EXTRA clause of a function (`meta.clauseCount - 1`); a clause HEAD is
  a match, not an arm.
- The symbol carries the total (`symbol.complexity`); the file total is base 1
  plus every symbol's arm contribution, so the two cannot drift apart.

Pinned by `validation/m14/fixtures/erlang/record-ops-er2.expectation.json`
(`expectComplexity`: transitions 7 = base 1 + 3 case arms + 2 receive arms +
receive_after; guarded 4 = base 1 + 2 if arms + andalso; heady/get_count/idx 1)
and by mutant `erlang/complexity-arms-flattened`.

The dead baseline entries (`receive_expression`, `after_clause`,
`send_expression`) and the dead `string_literal` include fallback are gone —
those node types are never emitted by the pinned grammar.

## NIFs are declarations, not annotations (ER-D37)

`-nifs([f/a, …])` and `-on_load([g/0, …])` are read in both spellings the grammar
produces (`f / a` as a `binary_op_expr`, and an `fa` on the vendor-attribute error
path), and the two mean different things when a stub exists:

- An entry **with** an Erlang clause is annotated: the clause mints the function
  symbol and the attribute marks it `isNif` / `isOnLoad`. No duplicate symbol.
- A `-nifs` entry **without** a clause is **published** as a Function symbol
  (`declaredByNifsAttribute`, `clauseCount: 0`, line = the attribute's line). A NIF
  is implemented in C and its Erlang name is declared by the attribute; the compiler
  accepts `-nifs([n/1])` with no `n/1` anywhere in the file. Dropping those entries
  made every call to such a NIF dangle with nothing in the graph saying a function
  was declared.
- `-on_load` is deliberately not extended the same way: the compiler requires the
  named function to exist, so an entry with no symbol there is a genuine unresolved
  reference and is counted, not invented.

## When the grammar gives up (ER-D38)

Not every Erlang file is Erlang to this grammar. Two real classes in OTP are not:

- **wx's `api_gen` sources are code-generation templates.** The body is markup —
  `<<EXPORT:SortItems sortItems/2 SortItems:EXPORT>>` — and after it the top level
  returns as a run of ERROR nodes with loose `call`/`atom`/`ann_type` fragments
  between them and not one `fun_decl` in the file.
- **The pre-R16 two-argument module form**, `-module(pmod, [Props])`, is likewise
  unparseable.

A file with **no recoverable declaration of any kind** — no `fun_decl`,
`module_attribute`, `pp_define`, `record_decl`, `type_alias`/`opaque`/`nominal`,
`import_attribute`, `export_attribute`, `export_type_attribute`,
`pp_include`, `pp_include_lib` — **and** ERROR/MISSING nodes present, therefore
yields **no symbols and no relationships** and publishes its error count instead.
`metadata.grammarDamaged` says so.

Both halves of that condition are load-bearing, and each was added because the probe
caught the rule being wrong. Without the error requirement it labelled
comment-only and directive-only headers "damaged" — a header holding a single
`-compile({parse_transform, …})` is not a parse that went wrong. Without the include
forms it labelled include-only headers unreadable, when `-include("other.hrl")` is a
real dependency worth recording. Absence of a declaration is not evidence of damage;
the presence of ERROR nodes is.

Every edge recoverable from those fragments is fabricated: the lines and the nesting
are whatever error recovery produced, so `calls wxe_util:get_cbId@31` describes
structure the source does not have. 12 files corpus-wide.

The boundary is deliberately narrow, and the other side of it matters just as much:
a file with no functions and no `-module` but with `-define` blocks is derived
normally, including its file-scope macro references. `epp_SUITE_data/mac2.erl` is
four `-define`s and one `-plupp({?p, ?'p', ?P, ?'P'})` with no module and no
function, and it must keep yielding four macro constants, four `contains` edges and
four references.

Worth recording how this hole opened: it was made by a *correctness* fix earlier in
the same wave. ER-D32 gave `currentSource` a file-path fallback so file-scope
references would stop being dropped — and that removed the only thing suppressing the
wreckage, because an undefined source makes `pushRel` a no-op. Nothing noticed for a
full corpus run. A fix can open a hole as easily as close one, and it will not come
with a boundary unless someone writes one.

### ERROR and MISSING are `internal_silent` — the universal pair (M14 section A ruling)

The grammar's table never lists them (`nodeTypeForId` does not return the recovery nodes), and this
spec originally left them out on exactly that basis. **That reasoning is true about the grammar and
wrong about the consumer**: the completeness gate adds the pair it reuses from F1
(`script/m14/audit-analyzer-grammar.ts`: "ERROR and MISSING are produced by every tree-sitter parser
but are NOT listed by `nodeTypeForId`"), so a spec that omits them fails section A with
`2 node type(s) in NO bucket: ERROR, MISSING` — measured 2026-10-17, and the same shape the gate's own
header records for F1. They are classified **internal_silent**: the analyzer publishes no symbol and no
relationship for either, and reports every one on the `ParseResult.errors` channel — which is exactly
what the rest of this section describes.

## Complexity model

Per symbol: `1 + arms + extra clauses`, and the file total is `1 + every branch
point` (`metadata.complexity`).

| counted | not counted | why |
|---|---|---|
| `cr_clause` (10,968 per corpus: case + receive + try-of + `maybe … else`) | the `case`/`try`/`maybe` construct itself | its arms are counted once; a construct adding its own point would double-count |
| `if_clause` (908), `catch_clause` (585) | | |
| `receive_after` (929) — a timeout is a branch, and sets "Receive with Timeout" | | |
| `andalso` / `orelse` (142 / 81) | `and` / `or` / `band` / `bor` | only the short-circuit operators open a path; the rest are bitwise |
| one per comprehension | a per-element filter | elixir `for` parity; a filter is not statically countable |
| one per extra clause of a (name, arity) | | the grammar emits a `fun_decl` per clause (ER-D26) |
| | macro-body branches | a template's branches are not this function's |

## Regex inventory

**0 regexes in CODE.** No `RegExp` constructor, no regex literal, no `.match(`, `.replace(`,
`.test(`, `.search(`, `.matchAll(` anywhere in `src/ast/real-erlang-analyzer.ts`; the only two
occurrences of the word "RegExp" in the file are the header comments saying so (lines 4 and 40).
The four regexes the pre-rewrite analyzer used (record-paren strip, arity strip, function-name
strip, parse-type strip) are pure char scans: `stripQuotes`, `keepDigits`, `stripFirstParen`,
`digitsOf`.

## Complexity envelope

Measured over EVERY file in the corpus — otp@de741b7, rebar3@3c1b417,
cowboy@c965d1a, 4,326 `.erl` files — not a sample.

| what | measurement |
|---|---|
| files | 4,617 read (`.erl` AND `.hrl`), 4,617 examined, 139 grammar errors (3.01%), **0 unexamined** |
| symbols | 209,247 |
| relationships | 1,032,785 |
| relationship types emitted | `calls`, `references`, `contains`, `uses`, `exports`, `instantiates`, `implements`, `imports` — 8 of the CURRENT 14-value register (and of the ten-value reading this envelope was measured against). This envelope predates ER-D46: `part_of` is the NINTH emitted type since 2026-10-23, at 4,340 rows over the whole 4,465-file population (`validation/m14/measurements/erlang-extended-census.json`); the canonical per-type claim table is at the top of this page |
| dual lens vs an independently written oracle | **0** unexplained, **0** missing, **0** line mismatches, **0** symbol mismatches |
| unknown symbols through the production entry | 4,617 files, **0** unknown kinds, **0** empty names, **0** invented sentinel names, **0** ownerless members, all 26 symbol-free files accounted for with 0 suspect |
| parse-error taxonomy | **20 named causes, 0 unclassified**; 112 of the 139 failing files are not defects in anything |
| M60 line coverage (six dimensions) | 974,203 relationships, **100.000%** with an in-bounds, non-blank, 1-based line; 206,699 symbols with a start and end line |
| regexes in the analyzer | **0** (verified with comments stripped: no `RegExp`, no `.match/.replace/.test/.search/.matchAll`, no regex literal) |

Two deliberately-empty classes are counted rather than hidden:

| class | count | ruling |
|---|---|---|
| remote call / fun value whose **module** is a macro | 3,324 | ER-D35 |
| whole-file grammar damage, no declaration survived | 23 | ER-D38 |

### Performance

Interleaved min-of-11, both analyzers alternating inside one loop on the same trees,
so host interference can only ever ADD time and the minimum of each is the
interference-free estimate. Against the pre-ER3 analyzer restored from git:

| node-count quartile | files | node range | ER3 us/node | pre-ER3 us/node | ratio |
|---|---|---|---|---|---|
| Q1 | 30 | 17 - 338 | 1.4 | 1.4 | **1.0x** |
| Q2 | 30 | 382 - 1,375 | 2.9 | 2.3 | 1.2x |
| Q3 | 30 | 1,388 - 3,766 | 1.7 | 1.6 | **1.0x** |
| Q4 | 30 | 3,793 - 49,028 | 1.9 | 1.9 | **1.0x** |

At parity per node while publishing **2.08x more relationships per node**, the
rewrite no longer pays for its extra output. It is at parity, not faster: Q2 is
still 1.2x and the row says so.

This measurement was RED for most of the wave, at 6.7x on Q4, and the review
reported the cause unattributed after six ablations failed to find it. The cause was
one line: `prePassForms(rootNode)` called in the loop CONDITION and again in the loop
BODY, making the pre-pass O(forms^2) on every file. Six ablations missed it because
every one ablated SEMANTICS rather than counting INVOCATIONS.
**RED on cost, and the row carries its load context.** Measured with the
interleaved-minimum design (`bun run script/m14/tmp/erlang-scaling-robust.ts
--reps 5`): the two analyzers alternate inside one loop on the same trees, so
host interference can only add time and the minimum of each is the
interference-free estimate. This matters because the naive measurement on this
host — five other agent processes, 12 of 15 GB resident — produced a number that
was wrong in the WRONG DIRECTION (it reported the rewrite as faster; the
interference did not scale the two analyzers equally, so the ratio inverted).
Those naive rows are discarded, not reported.

Per-node cost by file-size quartile, against the pre-ER3 analyzer restored from
git:

| node-count quartile | files | node range | ER3 us/node | pre-ER3 us/node | ratio |
|---|---|---|---|---|---|
| Q1 | 30 | 17 - 338 | 1.0 | 0.0 | - |
| Q2 | 30 | 382 - 1,375 | 2.2 | 0.6 | 3.8x |
| Q3 | 30 | 1,388 - 3,766 | 3.3 | 0.9 | 3.7x |
| Q4 | 30 | 3,793 - 49,028 | **5.5** | **0.8** | **6.7x** |

**The pre-ER3 analyzer's per-node cost is flat in file size; this one's rises.**
There is a super-linear term, and six feature ablations (type-reference walks,
the pattern ancestor climb, the parameter payload, the `contains` pass, edge
emission, the per-node `isMissing` read, the scope `Set` lookups, the exit
markers) each moved the total by less than the run-to-run noise — so the cause is
**unattributed**, and named as such in `reviews/erlang/m49-er3-grammar-truth.md`
§9 rather than guessed at. The pre-ER3 flatness is the clue: it walked the same
trees with the same loop and cost 0.8 us/node on a 49,028-node file, so the term
is in the per-node work this rewrite added, not in the walk.

Output volume: 253 relationships and 45 symbols per file (vs 117 and 40 before),
i.e. 2.08x the relationships for 3.7-6.7x the per-node cost. The parts that are
attributed: the main walk is a single DFS, the pre-pass reads the top level
rather than re-walking the tree, each type declaration's reference walk covers
only its own subtree, and the pattern test climbs to the nearest boundary. No
nested loop over symbols.

### Payload and latency for the relationship-ontology wave (2026-10-04)

The workstream's rule is that adding edges is not free downstream: `bb_graph`'s
UN-NARROWED `relationshipTypes` default is 2.5-4.8x a filtered answer, so the lane's own
check is re-run after every change and a regressed budget is REPORTED, never
re-baselined. `script/m60/erlang-lane-payload.ts`, 200 files (every 19th of 3,939
admitted), BEFORE and AFTER in SEPARATE PROCESSES — which is the design the performance
record above requires, because an in-process A/B once inverted the ratio here.

The BEFORE row is produced by `--analyzer <path>`, which restores a named analyzer
source over the lane's file for the duration of the run and puts the committed bytes
back in an `exit` hook, with a sibling backup written first and its path printed so a
kill is recoverable. That flag was in this script's header and **was not implemented**,
so the previous wave's BEFORE row was a manual file swap — and a manual swap that gets
killed leaves the worktree holding the wrong analyzer with no marker, which is one way
a stale artifact gets committed.

| metric | BEFORE (HEAD~ analyzer) | AFTER (ER-D44/45 wave) | AFTER (this wave) | delta |
|---|---|---|---|---|
| relationships | 38,814 | 38,807 | **38,807** | 0 — this wave adds no edge |
| payload, all labels, median/file | 9,632 B (9.41 KiB) | 9,632 B (9.41 KiB) | **9.4 KiB** | unchanged |
| payload, `calls` only, median/file | 3.54 KiB | 3.52 KiB | **3.5 KiB** | -0.02 KiB |
| un-narrowed / filtered | 2.66x | 2.68x | **2.68x** | **+0.00 — no budget regressed** |
| latency median / p95 | 12.03 / 207.42 ms | 6.59 / 113.16 ms | **39.87 / 494.80 ms** | NOT INTERPRETABLE |

`script/m60/erlang-lane-payload.ts --label AFTER-VERIFY --out validation/m14/tmp/erlang-lane-payload-AFTER-VERIFY.json`, 200 files (every 19th of 3,939
admitted), 6,987 symbols, per-label `calls=18892 references=7898 contains=6801 uses=2497
exports=2394 instantiates=276 implements=32 imports=17`.

**The ratio is the budget and it did not move.** The lane has recorded 2.57x (before
ER-D42/43) and 2.68x (after), so 2.68x is inside the band already reported and no budget
was re-baselined.

**The latency row is still not a measurement of anything.** This wave's change adds no
edge and removes a `Set` insert and a dead method; none of that is in a loop whose cost
moves a median by 45%. The two runs sat on a host carrying ~10 load average with 4 GiB
available of 15, and the same host produced a WASM `memory access out of bounds` in the
census instrument at 8 workers (below). The honest reading is unchanged: **this lane has
no usable latency budget on a shared host at this load**, and the row is kept precisely
so a reader does not mistake it for a result.

**The latency row is not a measurement of this change and is not offered as one.** The
two runs sat on a host carrying fifteen sibling lanes with a load average of 18-20, and
the AFTER row happened to be taken during a quieter stretch. The change adds one `Set`
insert in the pre-pass and one `Set` lookup per local call, and changes a range's end
node; none of those is in a loop whose cost moves a median by 45%. The honest reading is
that this lane has no usable latency budget on a shared host at this load, and the row
is kept precisely so a reader does not mistake it for a result.

**The ratio moved 2.66x -> 2.68x, against the budget.** It moved because the FILTERED
side is `calls` and the ER-D44/45 wave removed 7 `calls` edges, while the all-labels figure
is a MEDIAN and 7 edges do not move a median. The lane has recorded 2.57x (before ER-D42/43)
and 2.66x (after), so 2.68x is inside the band this lane has already reported and no
budget was re-baselined.

### The instrument itself needed a fix to be repeatable

`script/m60/erlang-ontology-census.ts` ran 8 concurrent `parseFile` workers, each holding
its own tree-sitter WASM instance. On this host at 4 GiB available it died three times with

```
[BB-PARSE-ERR] erlang | …/simple_1_SUITE.erl  | memory access out of bounds
[BB-PARSE-ERR] erlang | …/refine_bug1.erl     | memory access out of bounds
[BB-PARSE-ERR] erlang | …/refine_failing.erl | memory access out of bounds
[BB-HANG] parser stuck 120s on … — exiting
```

**A different file each run**, which is the signature of a resource ceiling and not of a
grammar fault — a fault in the grammar names the same file every time. At
`--workers 2` the same 3,939 files parsed with **0** parse errors and **0** crashes, and
every count reproduced to the digit against the 8-worker run. The worker count is now an
argument (`--workers N`) and the header says why. A lane census that reports a different
crash count per run cannot support a claim of the shape this document makes, and the
honest fix was to make the instrument's width explicit rather than to quote whichever
number a run produced.

## What the line-by-line read found (M14 §6 dual lens, item 1)

A full read of all 2,293 lines (the file is 2,400 lines today) found **two members that nothing reads**, both removed:

| member | what it was | how it survived |
| --- | --- | --- |
| `calleeNameNode(call)` | a private method with a full doc comment describing "the `atom` that is a DIRECT child of the `remote`" | never called — `grep -c` returns 1, the definition. `tsconfig.json` sets `noUnusedLocals: false`, so nothing complained |
| `ErlangContext.declaredNames` | a `Set<string>` of bare function names, written on every `fun_decl` in the pre-pass | written, never read, once ER-D45 moved the gate to `declaredFnKeys`. Its comment claimed it was "kept for the name-level questions", which is a statement about a use that did not exist |

Both are the failure the gate cannot see: a member that is populated costs a `Set`
insert per function declaration on every file in every project and asserts nothing.
`declaredFnKeys` now carries the comment that explains why the bare name is not enough,
and the source-revert harness reproduces the bare-name rule against today's state rather
than against the deleted field — a revert that reintroduced `declaredNames` would fail to
typecheck rather than to reproduce the defect, which is a red harness measuring nothing.

No behavioural change: the census reproduced all ten per-type counts and the corpus
totals across the edit, and **30/30** fixtures pass today.

## Corpus validation

| corpus | files | symbols | relationships | grammar-error files | crash files |
|---|---|---|---|---|---|
| otp | 3,874 | — | — | 117 (3.02%) | **0** |
| rebar3 | 264 | — | — | 15 (5.68%) | **0** |
| cowboy | 188 | — | — | **0** | **0** |
| **total** | **4,326** | — | — | **132 (3.05%)** | **0** |

**The campaign wave re-measured the population this table's corpus no longer is.** The ER3
corpus above contains **cowboy**, which is not in `.corpus` today, while today's checkout adds
elixir (48 `.erl`) and an otp at a different revision. The current measurement, through the
production entry over the whole admitted set (2026-10-23):

| corpus (rev) | admitted | parsed | failed | symbols | relationships | grammar-error files | crash files |
|---|---|---|---|---|---|---|---|
| otp `9e84d463ac` + rebar3 `0c947d3b86` + elixir `024beb1bfc` | **4,465** | **4,465** | **0** | **203,984** | **1,023,190** | **138 (3.09%)** | **0** |

The population rule is the gate's own (per-repository `git ls-files`, 1 MiB cap, 0 absent, 6
over cap over 4,471 tracked paths; 199 symlinked directories followed) and the artifact is
`validation/m14/measurements/erlang-extended-census.json`; the closure arm over the same set is
`validation/m14/measurements/erlang-gate-whole-2026-10-23.log`. The current lane fixture suite
is **30/30** (`bun script/m14/run-fixtures.ts --lang erlang`).

- Fixtures: `Service.erl` (positive) + `Negative.erl` (negative)
- **86/86 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
  (69 before ER3/ER2: the truth was hand-audited against the pre-ER2 contract,
  which knew no `uses` edges and no macro/fun-value/type references at all.
  The 17 added facts are each justified from Erlang semantics in the truth's
  own `source` prose — `uses` for record member reads and updates, references
  for `?MACRO` uses, fun values and applied type names — never copied from the
  analyzer's output. `inputs` digest `d9f612f17026`, 62 files.)
- Corpus error scan (`script/m12/erlang-corpus-errors.ts`, mode
  `deterministic-first-400-sorted`): **12 error files of the first 400**
  (3.0%), 0 crashes. The exhaustive ER3 census over ALL 4,154 .erl/.hrl files
  of the OTP checkout (no sampling) found **122 (117 .erl + 5 .hrl = 2.9%)**,
  0 crashes, names recorded in the census artifact — the same rate on a 10×
  wider base. The classes are grammar limitations, not analyzer defects:
  `?WITH_STACKTRACE(C,T,S)`-style macro expansions (an arrow inside a macro
  body is unparseable without expansion), template files with
  `{{placeholder}}` syntax, and the intentional errors OTP's own test suites
  ship (`erts/emulator/test/*_SUITE_data`).
- Shape-safety (`script/m12/erlang-node-types-compare.ts`): 9/9 analyzer
  node-type refs live against the pinned grammar's emitted types, 0 dead.

### Exhaustive corpus census (ER3, 2026-09-25)

`script/m14/tmp/erlang-er3-corpus-census.ts` reads **every** `.erl` and `.hrl`
under a corpus, one parse per file, and compares the analyzer's edges against
the mirrored F5 oracle on the same tree — no sampling, and both sides of the
ER3 change are recorded in one artifact
(`validation/m14/results/archive/erlang-er3-corpus-census.json`):

| Corpus (rev) | files | oracle edges | analyzer edges | MISSING | UNEXPLAINED | type-ref sites that do not apply their name | record-type instantiates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OTP `9e84d463ac3d` pre | 4,154 | 429,888 | 198,341 | 1,376 | 4,344 | 4,043 | 471 |
| OTP post | 4,154 | 429,888 | 195,122 | **0** | **0** | **0** | **0** |
| rebar3 `0c947d3b86c5` pre | 269 | 17,057 | 9,261 | 50 | 265 | 244 | 26 |
| rebar3 post | 269 | 17,057 | 9,035 | **0** | **0** | **0** | **0** |
| elixir `024beb1bfcca` post | 48 | 3,088 | 1,746 | **0** | **0** | **0** | **0** |

The artifact also carries a **post2** copy of each post row, produced by the same
probe (rebar3 in one run, OTP in three deterministic shards summed by the
probe's own `--merge`, which reads the numbers back out of the artifact), and:
totals, edge-class groups and type-ref forms are identical to `post` to the
digit on both corpora — the pipeline is deterministic (single-threaded, sorted
file order, one parse per file), so a pre/post delta is code and not machine
noise.

The post/pre pair matches exactly on the class table: only the two ER3 classes
move (`references|type reference` 8,127 -> 5,204 on OTP, `instantiates` 5,731 ->
5,341), every other class — calls local/remote, uses, implements, macro uses,
fun values — is identical to the digit. MISSING/UNEXPLAINED are also 0 under
EXACT target matching (not just the harness's leaf-normalized rule). Two
identical post runs agreed on every total, class and form, so the deltas are
code and not machine noise.

## Supported constructs

The dominant parse-error cause is **not** a defect in anyone's file: OTP's own
compiler backend writes `-record #name{…}` without parentheses (36 of the 132),
an abstract-format form the pinned grammar does not accept. Full taxonomy, with
the 64 files still unnamed, in the review.

Through the **production entry** (`ASTEngine.parseFile`, 450 files, per-corpus
stride): 12,869 symbols, 68,846 relationships, **0 parse failures**,
**0 unknown kinds, 0 empty names, 0 sentinel names, 0 members without
`ownerName`**. The 6 symbol-free files are rebar3's ERL **templates**
(`-module({{name}})`) — not Erlang source, so 0 symbols is correct.

**Dual lens** (`erlang-census.ts` against the independently written
`erlang-oracle.ts`), 150 files: 38,560 relationships, **0 unexplained, 0
missing, 0 line-contract mismatches, 0 symbol mismatches**.

Not modeled (deliberately): `!` send (parses as `binary_op_expr` — no symbol
edge), macro expansion CONTENTS (unparseable by design — recorded as grammar
limitations), pattern-position record literals and member reads.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/erlang.json` — `truthSource: manual_audit`, source `Service.erl` (positive) + `Negative.erl` (negative), inputs digest `d9f612f17026`, 62 files.
- Result `validation/m12/results/erlang-differential.json`: `passed: true`, expected 69, truePositive 69, falsePositive 0, falseNegative 0, unknown 0, precision 1, recall 1.
- 86/86 facts on the live corpus, precision 1.000 recall 1.000 (69 pre-ER2; the 17 added facts are justified from Erlang semantics in the truth's own `source` prose — `uses` for record member reads/updates, references for `?MACRO` uses, fun values and applied type names — never copied from the analyzer's output).
- **This is a HISTORICAL artifact, not a measurement of the current analyzer.** The committed
  result's own `inputs` digest names a 20,347-byte `real-erlang-analyzer.ts` (the pre-ER1/ER2
  bytes) and it is sealed `2026-09-28`; the analyzer today is 2,400 lines. Re-running the m12
  differential needs the ground truth re-audited first: `validation/m12/ground-truth/erlang.json`
  still classifies `-include`/`-include_lib` as `references` in its truthSource prose (and carries
  `references` facts for `service.hrl` and `kernel/include/logger.hrl`), which ER-D46 relabelled to
  `part_of` — so a re-run against today's analyzer would report those rows MISSING and the
  `part_of` rows UNEXPLAINED until the truth is updated. That update is an OWNER action, outside
  this docs lane; the numbers above are not re-baselined and are not offered as current.

## Restoration record (ER1 + ER2, 2026-09-25)

The ER1/ER2 waves landed this contract on the working tree on 2026-09-18
(`reviews/erlang/m49-er1-arity-lines-dual-lens.md`,
`reviews/erlang/m49-er2-done-bar.md`), and their pins survived — the nine
fixtures, the identity verifier, `script/m14/spec/erlang-completeness.json`,
the review records and (part of) the mutant registry — while the analyzer
SOURCE did not: `git log --all -S record_field_expr --
src/ast/real-erlang-analyzer.ts` finds no commit that ever held it, and neither
did the differential oracle. Measured at HEAD before the restoration: 9 of 9
committed erlang fixtures FAIL, the F5 oracle derived only
calls/implements/instantiates, and 5,951 of 5,951 relationships on a 60-file
draw carried no line at all.

The contract above was therefore re-implemented against its own surviving spec
(fixtures first, rulings ER-D1..ER-D15) and re-measured:

| Witness | Result |
| --- | --- |
| `bun script/m14/run-fixtures.ts --lang erlang` | **9/9 PASS** at this wave (was 0/9) — **30/30 today**: the campaign wave added `extended-part-of` and relabelled the three include rows |
| `bun script/m14/verify-erlang-identity.ts` | **FAILING AT HEAD, and it was already failing before this wave** — `checkIdentity` asserts `source.slice(startIndex, endIndex) === "pick(0) -> zero;\npick(X) -> X."`, but `endIndex` is tree-sitter's EXCLUSIVE end and every analyzer's `nodeToRange` publishes it that way (`real-erlang-analyzer.ts:2254`, and identically in `real-elixir-analyzer.ts:1881`), so the correct expectation excludes the final `.`. Re-measured with only that one assertion corrected: PASS, **19/19 output mutations CAUGHT** (this table said 13). The script is master-owned and is reported, not fixed |
| `BB_MUTANT_ONLY="erlang/" bun script/m14/mutate-analyzer.ts` | **54/54 CAUGHT** at this wave (this table said 20/20 — the registry has grown since), each by its intended fixture. A further **11/11** ontology mutants live lane-side in `script/m14/erlang-ontology-mutants.ts` (10 at this wave; the `ontology/extends-from-include` mutant was moved to the `part_of` label after it survived as a stale filter), with a `--self-test` that inverts one expectation and requires the runner to report it as a SURVIVOR |
| `bun script/m60/lane-surface-audit.ts --lang erlang --limit 60` | **0 unlined of 8,645 edges** (was 5,951/5,951 unlined); labels calls/contains/references/uses/instantiates/implements; 0 ghosts |
| `bun script/m14/differential.ts --lang erlang` | **rebar3 3,328/3,328 covered, MISSING 0, unexplained 0** · **otp 4,585/4,585, MISSING 0, unexplained 0** — with `uses` and `references` now COMPARED kinds |
| `bun script/m14/verify-corpus-census.ts --lang erlang` | PASS files=60 err=1 types=102 blind=0 |
| `npx tsc --noEmit` | clean |

The shape probes this round added are committed as evidence:
`script/m14/tmp/erlang-er2-shapes2.ts` (fun_decl/expr_args arity, the `?MODULE:`
module position, the guard's ancestry — the pattern-position boundary is
`guard`/`clause_body`, never the clause itself).

## Ownership when there is no module (ER-D32)

An `.erl` file may declare **no `-module` at all**: it is an include fragment
that gets textually included into another module. OTP ships them —
`lib/syntax_tools/examples/merl/basic_test.erl` has its `-module(basic_test).`
line commented out, with a comment on line 1 saying it is for including in
another module.

Nothing in such a file names the module it will end up in, and the analyzer
cannot know it. Its members are therefore owned by the **file path**: the
outermost container that definitely holds them, and the only identity the file
has. The alternatives were both rejected — synthesizing a module name from the
filename fabricates a module no compile can produce, and an empty owner loses
the containment of every real declaration. Every module-scope declaration routes
through one helper (`ownerNameOf`) rather than repeating the fallback, because
the duplicated version had already drifted: macros took the bare module name
while functions, records, types and callbacks took the path, so in a module-less
file a macro had no owner and the function beside it did.

A file-scope unit is top-level for the export rule: an `-export` in an include
fragment names an importable bare name, and the harness counts a symbol owned by
its own file as one.

When the module name arrives **through a macro** — `-module(?FILE_SUITE).`, the
Common Test convention (ER-D34) — the module symbol is named by what the macro
**expands to**, never by the macro's own name, and the macro reference is
emitted as well. A macro whose body is not a bare atom
(`-define(BAD, atom_to_list(x))`) mints no module symbol at all: an unknown name
is not a reason to guess, and the macro use is still recorded, sourced to the
file and tagged `moduleNameResolved: false`.

## Line contract (M59 #825)

Every relationship carries `line_number`, 1-based, on the **name-bearing** node,
per-site. The include path STRING, not the `-include` keyword; the behaviour
ATOM, not `-behaviour(`; the remote callee LEAF; the record NAME; the member's
declaration for `contains`. The fixture `callsite-lines-825` splits constructs
across lines precisely so each of those is a distinguishable wrong answer.

`contains` follows the same rule and it is the one that bites: the member's
declaration NODE can start a line above the member's NAME. A multi-line
`-define(\n  worker(S, Worker, Failer, State),\n …)` puts the keyword on 208 and
the name on 209 — which is what OTP's `snmpm_net_if.erl` does in both branches
of its conditional-compilation block, and the analyzer originally reported 208
and 219. `contains` now reads the name line every declaration already records
(ER-D33), which also fixed the merged callback/definition case: after a
`-callback` is satisfied by a real definition, `contains` follows the
DEFINITION, not the contract (ER-D30). `line-owner-er3` writes every kind of
declaration split across lines, requires the name lines and forbids the construct
lines.

## Supported / unsupported, honestly

**Supported:** modules; functions with (name, arity) identity, multi-clause
merged, forward references resolved, macro-headed `?MODULE()` clauses;
records with fields, defaults and field types; macros (declaration, uses,
macro-to-macro references, function-like arity); types (`-type`, `-opaque`,
OTP 28 `-nominal`) and the full type-reference graph from types, records, specs
and callbacks; behaviours; exports (function and type); imports and includes
with an external/internal classification; NIF and on_load annotations; optional
callbacks; local and remote calls with per-site arity; `?MODULE` expansion;
fun values; record construction, reads, index reads and updates; comprehensions;
`case`/`if`/`try`/`receive`/OTP 28 `maybe`; the `!` send as a pattern.

**Not modeled, and why:**

- **Macro expansion.** The call graph through a macro is missing by
  construction (ER-D11); a macro-to-macro dependency graph is emitted instead.
- **Dynamic dispatch** (ER-D23). Only a typespec-directed resolution closes it.
- **A macro-headed clause that is not `?MODULE`** (ER-D28). Naming the macro
  would fabricate a function (`-define(DOUBLE(X), helper(X))` + `?DOUBLE(X) -> X`
  declares `helper/1`).
- **Inheritance.** Erlang has none.
- **The abstract-format `-record #r{}`** the pinned grammar cannot parse.
