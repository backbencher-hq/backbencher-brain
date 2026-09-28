# real-erlang-analyzer.md

> **ER3 (2026-09-28).** This document was rewritten against the current tree
> after the wave found that the previous version described code that was never
> committed. Every number here is re-measured; the witness is named beside it.
> The full review is `reviews/erlang/m49-er3-grammar-truth.md`, the rulings are
> `script/m14/spec/erlang-completeness.json` (31 decisions, ER-D1..ER-D31).

## Language

- Analyzer file: `src/ast/real-erlang-analyzer.ts`
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
- **A dynamic remote** — `M:f(X)`, `erlang:F(X)`, `apply/3` (ER-D23). The bare
  leaf would conflate every module's `f`; nothing is emitted and the count is
  kept in the review's accounting.
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

`bun run script/m14/tmp/erlang-perf.ts --files 300 --ab` — run alone, no
concurrent census (a row measured under load is unscored, not evidence). Parse
held constant and not compared; the pre-ER3 analyzer was restored from git onto
the same 300 files.

| | pre-ER3 | ER3 |
|---|---|---|
| analyze | 21,987 ms | **11,335 ms** |
| ms/file | 43.4 | **37.8** |
| ms per 1k lines | 70.3 | **61.2** |
| relationships emitted | 34,982 | **75,892** |
| ms per emitted relationship | 0.63 | **0.15** |
| slowest single file | 828 ms | 549 ms |

Output volume: 253 relationships and 45 symbols per file. Single pass over
per-file structures, plus one bounded walk per type declaration and one pre-pass
over the top level — no nested loop over symbols.

## Corpus validation

| corpus | files | symbols | relationships | grammar-error files | crash files |
|---|---|---|---|---|---|
| otp | 3,874 | — | — | 117 (3.02%) | **0** |
| rebar3 | 264 | — | — | 15 (5.68%) | **0** |
| cowboy | 188 | — | — | **0** | **0** |
| **total** | **4,326** | — | — | **132 (3.05%)** | **0** |

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

## Line contract (M59 #825)

Every relationship carries `line_number`, 1-based, on the **name-bearing** node,
per-site. The include path STRING, not the `-include` keyword; the behaviour
ATOM, not `-behaviour(`; the remote callee LEAF; the record NAME; the member's
declaration for `contains`. The fixture `callsite-lines-825` splits constructs
across lines precisely so each of those is a distinguishable wrong answer.

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
