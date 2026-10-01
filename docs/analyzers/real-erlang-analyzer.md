# real-erlang-analyzer.md

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
  functions are `fun_decl` → `function_clause` → `expr_args` + `clause_body`
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

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only: module → its records/macros/types/functions (`contains service -> handle_call`), record → its fields (`contains person -> id`). Sources the RECORD symbol, never the `#state` field text. | 1.0 |
| implements | ✅ | `-behaviour(gen_server)` → `implements service -> gen_server` (behaviour = the Erlang interface analog) | 0.9 |
| calls | ✅ | `call` nodes in EVALUATION contexts (a clause head is a pattern; type syntax is DECL-ONLY — ER-D3). Source = the named function, else the enclosing `-record` (a field default, ER-D12), else the module. Remote calls keep `module:function` (ER-D1) with STRUCTURAL extraction (the module atom of `remote_module`, the function atom of `remote`) and `?MODULE:` expands to the current module (ER-D14, `meta.macroModule`); local calls resolve against the file's declared name/ARITY set (forward references included). Self-recursion IS emitted. `meta.callArity` is the call's `expr_args` named-child count, comments excluded, and it is part of the edge identity: `f/1` and `f/2` sites are distinct edges (ER-D2) | 0.9 |
| instantiates | ✅ | `record_expr` (`#state{...}`) in BODY/guard position only → `instantiates run -> state`. Record literals in PATTERN position (function heads, `expr_args` before the guard/body) emit NOTHING. `record_update_expr` (`State#state{...}`) is a member WRITE, not a construction — no instantiates (ER-D4) | 1.0 |
| uses | ✅ | record member READ (`State#state.q`, `#state.label` index reads) → `uses -> <record>` AND `uses -> <field>`; record member UPDATE (`State#state{count = X}`) → `uses -> <record>` and → each assigned field. Evaluation contexts only: a head pattern emits nothing (ER-D7, closes ER-G4). `meta.context` is `record member read` or `record field update` | 1.0 |
| references | ✅ | module dependencies (`-include`/`-include_lib` path string, `-import` module); macro USES (`?TIMEOUT`, `?MODULE`, `?SERVER_HEADER` — emitted whether or not the macro is defined here, ER-D8, closes ER-G1); fun VALUES (`fun f/1` bare, `fun lists:map/2` qualified — a value is not an invocation, ER-D9, closes ER-G2); type dependencies from `-type`/`-opaque` to every type name the expression APPLIES (ER-D10 narrowed by ER3, closes ER-G5). Body variable uses emit NOTHING | 1.0 |

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
(`validation/m14/results/erlang-er3-corpus-census.json`).

The same DECL-ONLY boundary now covers record types: a `record_expr` inside
`-type`/`-opaque`/`-spec` is a declaration of the record's SHAPE and emits no
`instantiates` (it produced **471** such edges inside OTP's type declarations,
now 0). Not a calls edge, not a construction — a type.

### Where a file-level edge's source lives

A module-less file (every `.hrl` header, and a `.erl` before its `-module`)
attributes its include/behaviour/import edges to `Global` — the same fallback
the expression paths use (`callSource`). These three sites used to fall back to
the FILE PATH, so all 290 module-less headers of the pinned corpora hung their
edges off an absolute checkout path: an identity that changes with the
checkout, and one no gate could see (F5 compares `label + target` and never
reads `from`).

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

## Symbol contract

| field | supported | how it is derived |
|---|---|---|
| `name` | yes | `-module` -> module · `-record` -> record · `-define` -> macro (`var` child of `macro_lhs`) · `-type`/`-opaque`/`-nominal` -> type · `-callback` -> method · clause head -> function, **including a `?MODULE()` head** (ER-D25/D28) |
| `kind` | yes | `module`, `struct` (a record), `property` (a record field), `constant` (a macro), `type`, `method` (a callback), `function` |
| `ownerName` | yes | the module for functions/methods/types/records/macros; **the record** for its fields |
| `range` | yes | the declaration node; a function's range spans every clause of that (name, arity) |
| `parameters` | yes | one per clause-head element. A head is a PATTERN, so each carries `name` (only for a plain variable) and always `pattern`, plus `type` when a `-spec` supplies it (ER-D21) |
| `returnType` | yes | the `-spec` return expression. A `-spec` declares no symbol; the `fun_decl` does (ER-D3/D27) |
| `complexity` | yes | per symbol: 1 + decision points (ER-D17) |
| `visibility` | **N/A** | Erlang has no visibility keyword. `-export`/`-export_type` are the export lists, recorded on `ExportInfo` |
| `isStatic` / `isAsync` / `isAbstract` / `decorators` / `genericParameters` | **N/A** | Erlang has no modifiers, decorators or generics. Erlang macros are not generic |
| `isNif` / `isOnLoad` | yes (metadata) | `-nifs`/`-on_load` ANNOTATE the declared function; they never mint a second symbol (ER-D22) |
| `isCallback` / `isOpaque` / `isNominal` / `isMacro` | yes (metadata) | the three declaration forms that are easy to lose |

**Function identity is (name, arity).** `pick/0` and `pick/1` are two functions;
the second clause of either is the same function. A module that both declares
and defines a callback yields ONE symbol whose kind and line are the
**definition's** — the contract's line stays in `metadata.callbackLine` (ER-D30).

## Relationship ontology

| relationship | emitted for | notes |
|---|---|---|
| `contains` | module -> function/method/type/record/macro, record -> field | the member's own declaration line |
| `implements` | `-behaviour(b)` | the edge only, never a symbol (ER-D6) |
| `calls` | local `f(...)` when `f` is declared in the file; remote `m:f(...)` with the module KEPT (ER-D1) | per-site, keyed by `metadata.callArity` (ER-D2). `?MODULE:f()` expands to this module (ER-D9) |
| `uses` | record member read (`S#r.f`, `#r.f`) and record update (`S#r{f=…}`) | java/kotlin member-read parity (ER-D24) |
| `instantiates` | a record construction outside pattern position | an UPDATE is `uses`, never `instantiates` (ER-D4) |
| `references` | include / include_lib / import; a `?MACRO` use; a fun VALUE (`fun f/1`, `fun m:f/2`); a type dependency from a `-type`/`-opaque`/`-nominal`/`-spec`/`-callback` body, from a record field's type, and a record named in a type | a qualified TYPE keeps its module (ER-D31) |
| `extends` / `overrides` | **never** | **Erlang has no inheritance.** Ruled N/A |
| `exports` (as a relationship) | **never** | the language export list is `ExportInfo`; no analyzer in the family emits an exports *relationship* for it |

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
`import_attribute`, `export_attribute`, `export_type_attribute` — therefore yields
**no symbols and no relationships**, and publishes its error count instead.
`metadata.grammarDamaged` says so.

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

## Regex census

**0 regexes.** No `RegExp`, no `.match(`, `.replace(`, `.test(`, `.search(` in
the file. The four regexes the pre-rewrite analyzer used (record-paren strip,
arity strip, function-name strip, parse-type strip) are pure char scans:
`stripQuotes`, `keepDigits`, `stripFirstParen`, `digitsOf`.

## Measured envelope

Measured over EVERY file in the corpus — otp@de741b7, rebar3@3c1b417,
cowboy@c965d1a, 4,326 `.erl` files — not a sample.

| what | measurement |
|---|---|
| files | 4,326 read, 4,326 examined, 132 grammar errors (3.05%), **0 unexamined** |
| symbols | 181,529 |
| relationships | 994,670 |
| relationship types emitted | `calls`, `references`, `contains`, `uses`, `instantiates`, `implements` |
| dual lens vs an independently written oracle | **0** unexplained, **0** missing, **0** line mismatches, **0** symbol mismatches |
| unknown symbols through the production entry | **0** unknown kinds, **0** empty names, **0** invented sentinel names, **0** ownerless members |
| M60 line coverage (six dimensions) | 974,192 relationships, **100.000%** with an in-bounds, non-blank, 1-based line; 206,699 symbols with a start and end line |
| regexes in the analyzer | **0** (verified with comments stripped: no `RegExp`, no `.match/.replace/.test/.search/.matchAll`, no regex literal) |

Two deliberately-empty classes are counted rather than hidden:

| class | count | ruling |
|---|---|---|
| remote call / fun value whose **module** is a macro | 3,324 | ER-D35 |
| whole-file grammar damage, no declaration survived | 12 | ER-D38 |

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

## Corpus validation

| corpus | files | symbols | relationships | grammar-error files | crash files |
|---|---|---|---|---|---|
| otp | 3,874 | — | — | 117 (3.02%) | **0** |
| rebar3 | 264 | — | — | 15 (5.68%) | **0** |
| cowboy | 188 | — | — | **0** | **0** |
| **total** | **4,326** | — | — | **132 (3.05%)** | **0** |

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
(`validation/m14/results/erlang-er3-corpus-census.json`):

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

## Supported / unsupported constructs

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
| `bun script/m14/run-fixtures.ts --lang erlang` | **9/9 PASS** (was 0/9) |
| `bun script/m14/verify-erlang-identity.ts` | PASS — 4 functions, 2 export arities, call-site arity + site lines on local and remote calls, **13/13 output mutations CAUGHT** |
| `BB_MUTANT_ONLY="erlang/" bun script/m14/mutate-analyzer.ts` | **20/20 CAUGHT** (9 recovered + 11 re-authored for the ER2 surface), each by its intended fixture |
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
