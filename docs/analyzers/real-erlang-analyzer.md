# real-erlang-analyzer.md

## Language

- Analyzer file: `src/ast/real-erlang-analyzer.ts`
- Parser: `tree-sitter-erlang` (pinned `wasm/tree-sitter-erlang.wasm`; npm
  tree-sitter-erlang downloaded and verified behaviorally identical on the
  corpus via the production `parseFile` path — 11 vs 11 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; tree:
  `-module`/`-export`/`-import`/`-include`/`-include_lib`/`-behaviour`/
  `-define`/`-record`/`-type` are `attribute` nodes; functions are
  `function` → `function_clause` → `clause_head`/`clause_body`; calls are
  `call` (`Module:func(...)` → `call` with a `module`/`function_name`
  pair child or `atom`/`identifier` for unqualified; local calls are
  `call` with a bare `identifier`); `#state{...}` construction is
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
| name | ✅ | `-module` → module name; `-record` → record name; `-define` → macro name (with `?` prefix); `-type` → type name; functions → the `clause_head` function name (arity-stripped); exported functions (`-export` arity match) are identical symbols (dedup) | 
| kind | ✅ | `-module` → `module`; `-record` → `struct` (Erlang records are the record-struct analog); `-define` → `macro`; `-type` → `type`; functions → `function` (OTP callbacks `handle_call`/`handle_cast`/`handle_info`/`init`/`terminate` marked via the gen_server/gen_statem behaviour metadata); fields of a record → `property` |
| qualified/container name | ✅ | `ownerName` = enclosing module for records/macros/types/functions; record fields owned by their record symbol (`contains record -> field`) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | from the `clause_head` variable children |
| visibility | ❌ (n/a) | Erlang has no visibility keyword — all functions are module exports or not; `-export` list recorded as metadata |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only: module → its records/macros/types/functions (`contains service -> handle_call`), record → its fields (`contains person -> id`). Sources the RECORD symbol, never the `#state` field text. | 1.0 |
| implements | ✅ | `-behaviour(gen_server)` → `implements service -> gen_server` (behaviour = the Erlang interface analog) | 0.9 |
| calls | ✅ | `call` nodes with function sources (source = the containing FUNCTION, not the module). Qualified module calls emit `calls submit -> make_payload`-style leaf targets; `Module:func(...)` emits the leaf `func`; local calls to functions declared in the same module resolve (forward references included — `submit` → `make_payload` declared later in the file). Self-recursion IS emitted. The module-level dedup bug that dropped `stop -> gen_server:cast` when both a local and qualified call shared a source was fixed — one `calls` edge per (source, target) | 1.0 |
| instantiates | ✅ | `record_expr` (`#state{...}`) in BODY position only → `instantiates new -> state`. Record literals in PATTERN position (function heads, `clause_head` `expr_args`) emit NOTHING. `record_update_expr` (`State#state{...}`) is a copy/update, not a construction — no instantiates | 0.9 |
| references | ✅ | module dependencies only: `-import`/`-include`/`-include_lib` → `references module -> dep` (the FP-family module-dep contract). Body identifier/variable uses emit NOTHING (variable `uses` noise removed) | 0.9 |
| uses | ❌ | record field access (`State#state.q` → `record_field_expr`) is a field read — no edge (fields already have `contains` ownership) | — |

## Noise-elimination contract (what produces NO edges)

- Record literals in pattern position (`#state{}` in function heads) — never
  instantiates.
- Variable uses (`Pid = spawn(...)`, `State` references) — no identifier
  reference edges; references are module deps only.
- `!` send operator — `binary_op_expr` in this grammar (the
  `send_expression` branch is dead); sends are not calls to any symbol.
- Attribute heads (`-export([...])`, `-spec`, `-record`, ...) — the attribute
  declares the symbol; its inner content is never a call.
- Macros in guard positions (`?WITH_STACKTRACE(...)`) — attribute/macro
  references only, never call edges.
- Params/locals never become symbols.

## Complexity model (live, verified against emitted shapes)

Cyclomatic complexity counts decision points from the pinned grammar's actual
emitted node types:

- Each function clause — `function_clause`/`fun_clause` (live; `fun` bodies
  count their clauses).
- `case_expr`/`if_expr`/`try_expr` — one each.
- `receive_expr` — one; a `receive_after` child adds one more ("Receive with
  Timeout" pattern).

The dead baseline entries (`receive_expression`, `after_clause`,
`send_expression`) were removed — those node types are never emitted by the
pinned grammar. The receive detection was verified live on real receive code
(`receive_expr`/`receive_after` confirmed via shape probe; shape-safety shows
9/9 analyzer node refs live, 0 dead).

## Regex census

Baseline at M12.01: **4 usages**. After M12.24 (pure-AST rewrite): **0
usages** — all four eliminated with pure char scans:

| Old regex | Replacement |
| --- | --- |
| record-paren strip (`#state{...}` → `state`) | `stripRecordParens` char scan |
| arity strip (`name/2` → `name`) | `stripArity` indexOf slash slice |
| function-name strip | pure `clause_head` identifier extraction |
| parse-type strip | pure `type` node text, no regex |

Census total 82 → **78**. The census gate passes (0 missing, 0 stale, 0
unclassified).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/erlang-complexity.json`):

- Fixtures: 2 files, 29 symbols, 40 relationships, ~236 ms
- Corpus subset: 225 files (rebar3@0c947d3b — the Erlang build tool itself),
  5,400 symbols, 19,207 relationships, ~7.3 s
- All loops single-pass over per-file structures; no nested symbol loops
  (verified by loop-structure scan — zero nested `for` over symbols).

## Corpus validation

`validation/m12/results/erlang-differential.json` (via
`script/m12/verify-analyzer.ts erlang`):

- Fixtures: `Service.erl` (positive) + `Negative.erl` (negative)
- **69/69 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
- Corpus error scan (`script/m12/erlang-corpus-errors.ts`): all 225 .erl files
  ≥ 1KB — **11 grammar-error files (4.9%), 0 crashes, 0 timeouts**. All 11
  classified honestly as grammar limitations, same category as Go's testdata:
  `?WITH_STACKTRACE(C,T,S)` macro expansion (arrow inside the macro body —
  unparseable without macro expansion; the macro test file itself parses fine)
  and 2 template files with `{{placeholder}}` syntax (not real Erlang).
- Shape-safety (`script/m12/erlang-node-types-compare.ts`): 9/9 analyzer
  node-type refs live against the pinned grammar's emitted types, 0 dead.

## Supported / unsupported constructs

Supported: modules, functions (multi-clause heads merged into one symbol,
arity-stripped), records (with fields), macros (`-define`, `?MACRO` use),
types (`-type`/`-spec`), behaviours (`-behaviour` implements), exports
(`-export`), imports/includes (references), module-qualified and local calls
(with forward references), record construction (`#r{}`) and update
(`State#r{...}`), `receive` with timeout, OTP pattern detection
(gen_server/gen_statem callback marking).

Not modeled (deliberately): `!` send (parses as `binary_op_expr` — no symbol
edge), macro expansion contents (unparseable by design — recorded as grammar
limitations), record field access (no edge), pattern-position record literals.
